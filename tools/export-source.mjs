// Export a new, history-free source tree. Never push the internal working tree.
import { readFileSync, writeFileSync, mkdirSync, rmSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { filesIn } from './artifact-audit.mjs';
import { zipFiles } from './zip.mjs';
const output='artifacts/public-source';
const roots=['src','dev','server','icons'];
const explicit=['index.html','styles.css','manifest.webmanifest','LICENSE','.nvmrc','.gitignore','package.json','package-lock.json',
  'release/config.json','release/icon.png','release/icon.svg',
  ...['build.mjs','verify.mjs','artifact-audit.mjs','zip.mjs','release-ui.mjs','make-release-icon.mjs','export-source.mjs','preview.mjs','dev-server.mjs','maptest.js','simtest.js','soundtest.js','pagecheck.js'].map(p=>'tools/'+p)];
const originals=[...explicit,...roots.flatMap(dir=>filesIn(dir).map(p=>dir+'/'+p)),...filesIn('tools/tests').map(p=>'tools/tests/'+p),...filesIn('release/public').map(p=>'release/public/'+p)].sort();
const entries=originals.map(file=>[file,readFileSync(file)]);
for(const [file,data] of entries) {
  if(lstatSync(file).isSymbolicLink()) throw new Error('Symlink: '+file);
  if(!/\.(png|jpe?g|webp)$/.test(file)) {
    const s=data.toString('utf8');
    if(/\u002fUsers\u002f|\u002fprivate\u002f(?:tmp|var)\u002f|gh[pousr]_[a-zA-Z0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(s)) throw new Error('Private path or credential pattern: '+file);
  }
}
// Public templates replace internal documentation; retained under release/public for re-export.
for(const file of filesIn('release/public')) entries.push([file,readFileSync('release/public/'+file)]);
if(new Set(entries.map(([p])=>p)).size!==entries.length) throw new Error('Duplicate export path');
rmSync(output,{recursive:true,force:true});mkdirSync(output,{recursive:true});
const sha=data=>createHash('sha256').update(data).digest('hex');
for(const [file,data] of entries) { mkdirSync(path.dirname(output+'/'+file),{recursive:true});writeFileSync(output+'/'+file,data); }
const archive=zipFiles(entries);
writeFileSync('artifacts/MetaFight-source-0.1.0.zip',archive);
writeFileSync('artifacts/public-source-manifest.json',JSON.stringify({published:false,repository:JSON.parse(readFileSync('release/config.json')).repository,zip:{path:'artifacts/MetaFight-source-0.1.0.zip',bytes:archive.length,sha256:sha(archive)},files:entries.map(([file,data])=>({file,bytes:data.length,sha256:sha(data)}))},null,2)+'\n');
console.log(JSON.stringify({output,files:entries.length,bytes:archive.length,sha256:sha(archive),published:false}));
