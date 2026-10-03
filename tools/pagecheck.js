// Checks the page and the module graph, without a browser.
//
//   node tools/pagecheck.js
//
// The simulation is covered by simtest and the arenas by maptest; this is for
// the half of a browser game that neither of those can see. Every one of these
// is a failure that shows up as a blank screen and a line in a console nobody
// has open:
//
//   an element main.js looks up that the page has not got
//   an import that points at a file that is not there
//   a script tag that is not a module, so none of the imports work at all
//   an icon or a manifest the page promises and does not ship
//
// It is a linter with a very short list, and the list is entirely made of
// things that have gone wrong here at least once.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const fail = (what) => {
  console.error(`  ✗ ${what}`);
  failures++;
};
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

// --- the page -----------------------------------------------------------------

const html = read('index.html');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

if (!/<script type="module" src="src\/main\.js">/.test(html)) {
  fail('index.html does not load src/main.js as a module');
}
if (!/<canvas id="screen"/.test(html)) fail('index.html has no canvas to draw on');
if (!/<canvas id="hud"/.test(html)) fail('index.html has no canvas for the HUD');
if (!/viewport-fit=cover/.test(html)) fail('the viewport tag will not fill a notched phone');
if (!/user-scalable=no/.test(html)) fail('a two finger pinch will zoom the game');

const main = read('src/main.js');
for (const m of main.matchAll(/getElementById\('([^']+)'\)/g)) {
  if (!ids.has(m[1])) fail(`main.js looks up #${m[1]}, which the page has not got`);
}
const touch = read('src/touch.js');
for (const m of touch.matchAll(/querySelector\('#([^']+)'\)/g)) {
  if (!ids.has(m[1])) fail(`touch.js looks up #${m[1]}, which the page has not got`);
}
// Every button the touch layer reads has to exist, or the phone has no trigger.
const touchActions = new Set([...html.matchAll(/data-touch="([^"]+)"/g)].map((m) => m[1]));
for (const need of ['fire', 'jump', 'next']) {
  if (!touchActions.has(need)) fail(`the page has no touch button for "${need}"`);
}

// --- what the page promises to ship -------------------------------------------

for (const m of html.matchAll(/(?:href|src)="((?!https?:|data:)[^"#]+)"/g)) {
  const file = m[1].replace(/^\.\//, '');
  if (!existsSync(path.join(ROOT, file))) fail(`index.html points at ${file}, which is not there`);
}
const manifest = JSON.parse(read('manifest.webmanifest'));
for (const icon of manifest.icons) {
  if (!existsSync(path.join(ROOT, icon.src))) fail(`the manifest promises ${icon.src}`);
}

// --- the module graph ---------------------------------------------------------

function walk(dir, out = []) {
  for (const entry of readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, entry);
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (entry.endsWith('.js')) out.push(rel);
  }
  return out;
}

const files = [...walk('src'), ...walk('tools'), ...walk('server')];
let imports = 0;
for (const file of files) {
  const source = read(file);
  // Comments are stripped before the rules below are applied: half of them are
  // about not calling Math.random, and they say so.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const m of source.matchAll(/from '(\.[^']+)'/g)) {
    imports++;
    const target = path.resolve(path.dirname(path.join(ROOT, file)), m[1]);
    if (!existsSync(target)) fail(`${file} imports ${m[1]}, which is not there`);
  }
  // The simulation may not reach for anything a headless test has not got.
  if (file.startsWith(path.join('src', 'game')) || file === path.join('src', 'util.js')) {
    if (/\bdocument\b|\bwindow\b|\bnavigator\b/.test(code)) {
      fail(`${file} touches the DOM, and the simulation must not`);
    }
    if (/Math\.random\(/.test(code)) {
      fail(`${file} calls Math.random, which would desync the netcode`);
    }
    if (/Math\.(sin|cos|atan2)\(/.test(code)) {
      fail(`${file} calls Math.${/Math\.(sin|cos|atan2)\(/.exec(code)[1]}, which is not pinned down by IEEE 754 - use util.js`);
    }
  }
}

// --- the styles the page asks for ---------------------------------------------

const css = read('styles.css');
for (const cls of ['overlay', 'panel', 'hidden', 'btns', 'roster', 'fineprint']) {
  if (!css.includes(`.${cls}`)) fail(`styles.css has no rule for .${cls}`);
}

// --- and the scripts package.json advertises ----------------------------------

const pkg = JSON.parse(read('package.json'));
for (const [name, cmd] of Object.entries(pkg.scripts)) {
  // Boolean Node flags (including --test) precede the script, not a file path.
  for (const m of cmd.matchAll(/\bnode\s+(?:--[\w-]+(?:=[^\s]+)?\s+)*([\w./][\w./-]*)/g)) {
    if (!existsSync(path.join(ROOT, m[1]))) fail(`npm run ${name} runs ${m[1]}, which is not there`);
  }
}

if (failures) {
  console.error(`\n${failures} problem${failures === 1 ? '' : 's'} with the page.`);
  process.exit(1);
}
console.log(`  ${ids.size} elements, ${imports} imports, ${files.length} files, and they all line up.`);
console.log('\nThe page is wired up correctly.');
