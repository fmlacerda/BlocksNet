// Copies the game files into www/ for the phone apps (Capacitor packs that folder into the app).
// The game has no build step: www/ is the same set of files rowbusters.com serves, i.e. the repo
// minus what .assetsignore lists, minus the app projects themselves.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'www');   // tests build elsewhere
const ignore = new Set(fs.readFileSync(path.join(ROOT, '.assetsignore'), 'utf8')
  .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')));
['www', 'ios', 'android', 'capacitor.config.json', '.well-known'].forEach(n => ignore.add(n));

fs.rmSync(OUT, { recursive: true, force: true });
let n = 0;
(function copy(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (ignore.has(e.name) || ignore.has(r)) continue;
    const from = path.join(dir, e.name), to = path.join(OUT, r);
    if (e.isDirectory()) copy(from, r);
    else { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); n++; }
  }
})(ROOT, '');
// The app also gets Capacitor's small bridge script (the website doesn't need it), loaded first.
fs.copyFileSync(path.join(ROOT, 'node_modules/@capacitor/core/dist/capacitor.js'), path.join(OUT, 'js/vendor/capacitor.js'));
const page = path.join(OUT, 'index.html');
const html = fs.readFileSync(page, 'utf8');
const first = html.indexOf('<script src="js/');
if (first < 0) throw new Error('index.html: no game scripts found');
fs.writeFileSync(page, html.slice(0, first) + '<script src="js/vendor/capacitor.js"></script>\n' + html.slice(first));
console.log(`www/: ${n + 1} files`);
