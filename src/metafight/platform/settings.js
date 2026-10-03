export const SETTINGS_KEY = 'metafight.settings.v1';
export const DEFAULTS = Object.freeze({ schemaVersion: 1, revision: 0, volume: 0.35, sensitivity: 1, quality: 'low', assist: true, guideDone: false });

export function validateSettings(value) {
  if (!value || value.schemaVersion !== 1 || !Number.isInteger(value.revision) || value.revision < 0
    || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1
    || !Number.isFinite(value.sensitivity) || value.sensitivity < 0.25 || value.sensitivity > 3
    || !['low', 'medium'].includes(value.quality) || typeof value.assist !== 'boolean'
    || typeof value.guideDone !== 'boolean') throw new Error('设置格式不兼容，保留原数据');
  const result = {};
  for (const key of Object.keys(DEFAULTS)) result[key] = value[key];
  return result;
}

export function deadline(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { const e = new Error('存储响应超时'); e.timeout = true; reject(e); }, ms);
    Promise.resolve(promise).then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

export async function createSettings(channel, host, timeoutMs = 1500) {
  const api = host.xhs && host.xhs.miniTool;
  let launch = host.xhs && host.xhs.launchOptions;
  let buildVersion = Number(launch && launch.miniToolEnv && launch.miniToolEnv.buildVersion) || 0;
  if (channel === 'xiaohongshu' && !buildVersion && api && typeof api.getLaunchOptions === 'function') {
    try {
      launch = await deadline(api.getLaunchOptions(), timeoutMs);
      buildVersion = Number(launch && launch.miniToolEnv && launch.miniToolEnv.buildVersion) || 0;
    } catch { /* Unknown client version uses the documented compatibility path. */ }
  }
  const modern = channel === 'xiaohongshu' && Math.floor(buildVersion / 1000) >= 9460;
  const local = {
    get: () => host.localStorage.getItem(SETTINGS_KEY),
    set: data => host.localStorage.setItem(SETTINGS_KEY, data),
  };
  const backend = modern ? {
    async get() {
      if (!api || typeof api.getStorage !== 'function') throw new Error('平台存储能力缺失');
      const result = await api.getStorage({ key: SETTINGS_KEY });
      return result.data;
    },
    set(data) {
      if (!api || typeof api.setStorage !== 'function') throw new Error('平台存储能力缺失');
      return api.setStorage({ key: SETTINGS_KEY, data });
    },
  } : local;
  let value = { ...DEFAULTS }, queue = Promise.resolve(), blocked = false, sequence = 0;
  let status = '尚未读取';
  async function call(fn) {
    try { return await deadline(Promise.resolve().then(fn), timeoutMs); }
    catch (error) {
      // A native write cannot be cancelled. Never send a newer write past an
      // unresolved timed-out operation that could later overwrite it.
      if (error.timeout) blocked = true;
      throw error;
    }
  }
  const store = {
    backend: modern ? 'xhs-storage' : channel === 'web' ? 'web-localStorage' : 'legacy-localStorage',
    sdkPresent: !!api, buildVersion,
    get value() { return { ...value }; },
    get status() { return status; },
    async load() {
      const start = sequence;
      try {
        let raw = await call(() => backend.get());
        let migrate = false;
        if (modern && (raw === null || raw === undefined || raw === '')) {
          try { raw = local.get(); migrate = raw !== null && raw !== undefined && raw !== ''; } catch { /* no legacy data */ }
        }
        if (raw !== null && raw !== undefined && raw !== '') {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.schemaVersion !== 1) blocked = true;
          const loaded = validateSettings(parsed);
          if (start !== sequence) return { ok: false, stale: true };
          value = loaded;
          if (migrate) {
            await call(() => backend.set(JSON.stringify(loaded)));
            const verified = validateSettings(JSON.parse(await call(() => backend.get())));
            if (JSON.stringify(verified) !== JSON.stringify(loaded)) throw new Error('迁移校验失败');
          }
          status = migrate ? '旧设置已迁移并核验' : '已读取保存的设置';
        } else status = '使用默认设置';
        return { ok: true };
      } catch (error) {
        if (start === sequence) status = '读取失败：本次使用会话设置';
        return { ok: false, error: error.message };
      }
    },
    save(patch) {
      value = validateSettings({ ...value, ...patch, schemaVersion: 1, revision: value.revision + 1 });
      const next = { ...value }, current = ++sequence;
      status = '正在保存';
      const task = queue.then(async () => {
        try {
          if (blocked) throw new Error('存储状态未确定或版本不兼容，请重新打开后再试');
          await call(() => backend.set(JSON.stringify(next)));
          if (current === sequence) status = '已保存，请关闭重进核对';
          return { ok: true, revision: next.revision };
        } catch (error) {
          if (current === sequence) status = '未能保存：仅本次会话有效';
          return { ok: false, error: error.message, revision: next.revision };
        }
      });
      queue = task.then(() => undefined);
      return task;
    },
  };
  await store.load();
  return store;
}
