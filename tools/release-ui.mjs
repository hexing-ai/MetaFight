export function releaseHtml(source, channel, version) {
  let html = source.replace('M3-D / 稳定性测试', '公开测试候选 · ' + version)
    .replace(/<label for="fixture">[\s\S]*?<\/select>/, '')
    .replace(/\s*<section id="performanceControls"[\s\S]*?<\/section>/, '')
    .replace('查看测试记录', '版本与错误信息')
    .replace('<button id="license">', '<button id="privacy">隐私说明</button><button id="assets">素材来源</button><button id="feedback">问题反馈</button><button id="license">')
    .replace('测试记录与许可', '版本信息与说明')
    .replace('<h2 id="detailsTitle">测试记录</h2>', '<h2 id="detailsTitle">版本信息</h2>')
    .replace('<link rel="stylesheet"', '<link rel="icon" href="./icon.png">\n  <link rel="stylesheet"');
  if (channel === 'web') html = html.replace('<pre id="detailsText">', '<a id="feedbackLink" class="hidden feedback-link" rel="noreferrer">前往反馈页面</a><pre id="detailsText">');
  if (/performanceControls|id="fixture"|开发候选|6对6/.test(html)) throw new Error('Release UI retained development controls');
  return html;
}

export function releaseReadiness(config) {
  const missing = [];
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(config.repository)) missing.push('GitHub repository owner/name');
  if (!config.webFeedbackUrl) missing.push('Verified web feedback URL');
  else if (!/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/issues(?:\/new)?$/.test(config.webFeedbackUrl)) throw new Error('Feedback URL must be an HTTPS GitHub Issues route');
  if (!config.xiaohongshuFeedback.trim()) missing.push('Verified Xiaohongshu in-app feedback instructions');
  return { configurationReady: missing.length === 0, missing, publicReleaseApproved: false,
    note: 'Configuration checks do not establish link reachability, device acceptance, platform review or publication approval.' };
}

export function releaseMetadata(config, channel) {
  return { version: config.version, supportNote: config.supportNote,
    ...(channel === 'web' ? { webFeedbackUrl: config.webFeedbackUrl } : { xiaohongshuFeedback: config.xiaohongshuFeedback }) };
}
