// Cross-platform web verification; no official platform tooling required.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const commands = [
  ['tools/build.mjs', 'web'],
  ['tools/build.mjs', 'web', 'release'],
  ...['maptest', 'simtest', 'soundtest', 'pagecheck'].map(name => ['tools/' + name + '.js']),
  ['--test', ...readdirSync('tools/tests').filter(name => name.endsWith('.test.mjs')).sort().map(name => 'tools/tests/' + name)],
];
for (const args of commands) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, METAFIGHT_WEB_ONLY: '1' } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
