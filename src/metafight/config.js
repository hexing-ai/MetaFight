import { RUN_SPEED, P_RADIUS, P_HEIGHT, P_EYE, PITCH_LIMIT, YAW_UNITS, WEAPONS } from '../constants.js';

// Product contracts for M1. The M0.5 probe deliberately keeps its old rules.
// Only candidate population/fixture and seed may vary; public rules stay fixed.
export const GAME_DEFAULTS = Object.freeze({
  schemaVersion: 1, configVersion: 'metafight-v2-gentle', mapVersion: 'cargo-greybox-v2',
  mode: 'tdm', fixture: 'match', teamSize: 4, seed: 20261001,
  scoreLimit: 50, timeLimitSec: 300, fixedHz: 60,
  maxHp: 100, magazineSize: 30, reserveAmmo: 'unlimited',
  roundsPerMinute: 600, reloadSec: 2, bodyDamage: 25, headDamage: 50,
  respawnSec: 3, protectionSec: 2, armour: false, friendlyFire: false,
  assistAngleDeg: 3, assistSensitivityScale: 0.75,
  botReactionMinSec: 0.8, botReactionMaxSec: 1.2,
  botBurstShots: 3, botBurstPauseMinSec: 0.7, botBurstPauseMaxSec: 1,
  botAimYawErrorDeg: 3.5, botAimPitchErrorDeg: 1.5,
  // Inherited values remain tuning candidates, not validated mobile feel.
  moveSpeed: RUN_SPEED, radius: P_RADIUS, height: P_HEIGHT, eyeHeight: P_EYE,
  pitchLimit: PITCH_LIMIT, yawUnits: YAW_UNITS, range: WEAPONS[0].range,
});

export function validateGameConfig(raw = {}, { development = false } = {}) {
  const errors = [];
  const reject = (field, reason) => errors.push({ field, reason });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) {
    return { ok: false, errors: [{ field: 'config', reason: '配置必须为普通对象' }] };
  }
  const value = { ...GAME_DEFAULTS };
  for (const key of Object.keys(raw)) {
    if (!Object.prototype.hasOwnProperty.call(GAME_DEFAULTS, key)) {
      reject(key, '未知配置项'); continue;
    }
    value[key] = raw[key];
    if (!['fixture', 'teamSize', 'seed'].includes(key) && raw[key] !== GAME_DEFAULTS[key]) {
      reject(key, '当前产品规则固定，不接受覆盖');
    }
  }
  if (!Number.isInteger(value.seed) || value.seed < -2147483648 || value.seed > 2147483647) reject('seed', '种子须为32位有符号整数');
  const allowedFixtures = development ? ['match', 'fixed-targets', 'load-8', 'load-12', 'match-12'] : ['match'];
  if (!allowedFixtures.includes(value.fixture)) reject('fixture', '该场景未开放');
  const expectedTeamSize = development && ['load-12', 'match-12'].includes(value.fixture) ? 6 : 4;
  if (value.teamSize !== expectedTeamSize) reject('teamSize', '人数须与场景匹配：每队' + expectedTeamSize + '人');
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: Object.freeze(value) };
}

export function createGameConfig(raw, options) {
  const result = validateGameConfig(raw, options);
  if (!result.ok) {
    const error = new Error('游戏配置无效：' + result.errors.map(e => e.field + ' ' + e.reason).join('；'));
    error.code = 'INVALID_GAME_CONFIG'; error.details = result.errors; throw error;
  }
  return result.value;
}

export function simulationRules(config, options) {
  // Revalidate callers/JSON imports instead of trusting a mutable lookalike.
  const c = createGameConfig(config, options);
  return Object.freeze({
    bodyCount: c.teamSize * 2,
    shotIntervalTicks: c.fixedHz * 60 / c.roundsPerMinute,
    reloadTicks: c.reloadSec * c.fixedHz,
    respawnTicks: c.respawnSec * c.fixedHz,
    protectionTicks: c.protectionSec * c.fixedHz,
    timeLimitTicks: c.timeLimitSec * c.fixedHz,
  });
}
