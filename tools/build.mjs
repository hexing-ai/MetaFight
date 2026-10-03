import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { filesIn, auditArtifact } from './artifact-audit.mjs';
import { zipFiles } from './zip.mjs';
import { releaseHtml, releaseReadiness, releaseMetadata } from './release-ui.mjs';

const target = process.argv[2] || 'all';
const stage = process.argv[3] || 'm05';
if (!['m05', 'm1', 'm2', 'm3', 'release'].includes(stage)) throw new Error('Unknown stage');
const publicBuild = stage === 'release';
const releaseConfig = JSON.parse(readFileSync('release/config.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(releaseConfig.version)) throw new Error('Invalid release version');
const readiness = releaseReadiness(releaseConfig);
const uiDir = stage === 'm05' ? 'dev/probe' : publicBuild ? 'dev/m3' : 'dev/' + stage;
if (!['all', 'web', 'xiaohongshu'].includes(target)) throw new Error('Unknown target');
const sha = data => createHash('sha256').update(data).digest('hex');
const inputs = [...filesIn('src').map(p => 'src/' + p), ...filesIn(uiDir).map(p => uiDir + '/' + p), ...['tools/build.mjs', 'tools/zip.mjs', 'tools/artifact-audit.mjs', 'tools/release-ui.mjs', 'release/config.json', 'release/icon.png', 'package.json', 'package-lock.json', 'LICENSE']].sort();
const sourceFiles = inputs.map(file => ({ file, sha256: sha(readFileSync(file)) }));
const sourceHash = sha(JSON.stringify(sourceFiles));
let commit = 'unversioned'; try {
  const gitOptions = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
  if (execFileSync('git', ['rev-parse', '--show-toplevel'], gitOptions).trim() === process.cwd()) commit = execFileSync('git', ['rev-parse', 'HEAD'], gitOptions).trim();
} catch { /* source archive; do not inherit an enclosing repository's commit */ }
const license = readFileSync('LICENSE', 'utf8');
mkdirSync('artifacts', { recursive: true });
for (const channel of target === 'all' ? ['web', 'xiaohongshu'] : [target]) {
  const dir = 'dist/' + (stage === 'm05' ? '' : stage + '/') + channel;
  const buildId = stage + '-' + channel + '-' + sourceHash.slice(0, 12);
  const zipPath = 'artifacts/' + buildId + '.zip';
  const auditScript = '.codex/minitool-zip-builder/scripts/audit_artifact.mjs';
  if (channel === 'xiaohongshu' && !existsSync(auditScript)) throw new Error('官方Skill未安装，不能生成平台包');
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const result = await build({ entryPoints: ['src/metafight/' + (stage === 'm05' ? 'probe.js' : publicBuild ? 'm3.js' : stage + '.js')], outfile: dir + '/app.js', bundle: true,
    format: 'iife', platform: 'browser', target: ['es2017', 'chrome61'], minify: true, legalComments: 'inline', metafile: true,
    define: { __CHANNEL__: JSON.stringify(channel), __BUILD_ID__: JSON.stringify(buildId), __LICENSE_TEXT__: JSON.stringify('MetaFight 使用 WebReal，原许可全文如下。\n\n' + license), __DEV_PROBE__: String(!publicBuild), __M3_VISUALS__: String(stage === 'm3' || publicBuild), __RELEASE_META__: JSON.stringify(releaseMetadata(releaseConfig, channel)), globalThis: 'window' },
  });
  let html = readFileSync(uiDir + '/index.html', 'utf8');
  if (publicBuild) html = releaseHtml(html, channel, releaseConfig.version);
  writeFileSync(dir + '/index.html', html);
  writeFileSync(dir + '/style.css', readFileSync(uiDir + '/style.css'));
  if (stage === 'm3' || publicBuild) {
    mkdirSync(dir + '/assets', {recursive:true});
    for (const file of filesIn('dev/m3/assets').filter(p => /\.jpg$/.test(p))) writeFileSync(dir + '/assets/' + file, readFileSync('dev/m3/assets/' + file));
  }
  if (publicBuild) writeFileSync(dir + '/icon.png', readFileSync('release/icon.png'));
  if (publicBuild && channel === 'web') {
    for (const name of ['app.js', 'style.css']) {
      const data = readFileSync(dir + '/' + name), ext = path.extname(name);
      const versioned = name.slice(0, -ext.length) + '.' + sha(data).slice(0, 12) + ext;
      writeFileSync(dir + '/' + versioned, data); rmSync(dir + '/' + name);
      html = html.replace('./' + name, './' + versioned);
    }
    writeFileSync(dir + '/index.html', html);
  }
  const audit = auditArtifact(dir);
  const moduleFiles = Object.keys(result.metafile.inputs);
  if (moduleFiles.some(p => /src\/(?:main|input|touch|net\/)/.test(p))) audit.errors.push('原版入口、锁定输入或联网模块进入产物');
  const scriptFile = filesIn(dir).find(f => /^app(?:\.[a-f0-9]+)?\.js$/.test(f));
  const script = readFileSync(dir + '/' + scriptFile, 'utf8');
  if (!script.includes('Permission is hereby granted')) audit.errors.push('MIT全文缺失');
  if (publicBuild && /metafightProbe|performanceStart|performanceExport|warmupTargetMs|6对6开发候选/.test(script)) audit.errors.push('发布包残留开发工具');
  if (audit.errors.length) throw new Error(audit.errors.join('\n'));
  const official = [];
  if (channel === 'xiaohongshu') {
    const r = spawnSync(process.execPath, [auditScript, dir], { encoding: 'utf8' });
    official.push({ target: dir, exitCode: r.status, output: r.stdout + r.stderr });
    if (r.status !== 0) throw new Error(r.stdout + r.stderr);
  }
  const outputs = filesIn(dir).map(file => ({ file, bytes: readFileSync(path.join(dir, file)).length, sha256: sha(readFileSync(path.join(dir, file))) }));
  let zip = null;
  if (channel === 'xiaohongshu') {
    const data = zipFiles(outputs.map(r => [r.file, readFileSync(path.join(dir, r.file))]));
    if (data.length > 10 * 1024 * 1024) throw new Error('ZIP超10MiB');
    if (data.length > 2 * 1024 * 1024) audit.warnings.push('ZIP超过建议2MiB');
    writeFileSync(zipPath, data);
    const r = spawnSync(process.execPath, [auditScript, zipPath], { encoding: 'utf8' });
    official.push({ target: zipPath, exitCode: r.status, output: r.stdout + r.stderr });
    if (r.status !== 0) { rmSync(zipPath); throw new Error(r.stdout + r.stderr); }
    zip = { path: zipPath, bytes: data.length, sha256: sha(data), method: 'ZIP_STORED' };
  }
  const report = { channel, stage: publicBuild ? 'release candidate, not published' : stage + ' development build, not public game', buildId, commit, sourceHash, sourceFiles, moduleFiles,
    release: publicBuild ? { version: releaseConfig.version, readiness } : null,
    audit, official, outputs, zip, runtimeValidation: 'Platform PC simulator and Android/iOS scans pending; browser evidence separate' };
  writeFileSync('artifacts/' + (stage === 'm05' ? '' : stage + '-') + channel + '-build-report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ channel, buildId, sourceHash, files: outputs.length, zip, status: 'STATIC_PASS / PLATFORM_PENDING' }));
}
