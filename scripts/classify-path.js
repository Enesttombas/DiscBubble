'use strict';
// Read-only check: scans a folder with bin\bubblescan.exe (walk mode), runs the classification module and prints the result.
// No delete or Recycle Bin calls. Usage: node scripts/classify-path.js "C:\Users\me\.cache" [depth]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const C = require('../public/classify.js');

const root = process.argv[2];
const depth = +process.argv[3] || 2;
if (!root) { console.error('usage: node scripts/classify-path.js <folder> [depth]'); process.exit(1); }
const out = path.join(os.tmpdir(), 'classify-path-' + process.pid + '.json');
const t0 = Date.now();
execFileSync(path.join(__dirname, '..', 'bin', 'bubblescan.exe'), [root, '--out', out, '--mode', 'walk'], { windowsHide: true });
const r = JSON.parse(fs.readFileSync(out, 'utf8'));
const size = fs.statSync(out).size;
fs.rmSync(out, { force: true });
const h = C.annotate(C.fromTree(r.tree), { now: Date.now() / 1000 });
console.log(`scan ${r.ms} ms (total ${Date.now() - t0} ms) · ${r.files} files · output ${size} bytes · m field: ${'m' in r.tree ? 'present' : 'missing'}`);
(function w(n, d) {
  if (d > depth || n.data.o) return;
  console.log(`${'  '.repeat(d)}${n.data.n} · ${C.fmt(n.value)} · ${n.sf} (${C.SAFE[n.sf].name} · ${C.SAFE[n.sf].risk}) · ${n.why}`);
  (n.children || []).slice(0, 8).forEach(c => w(c, d + 1));
})(h, 0);
const sugs = C.suggest(h), t = C.sugTotals(sugs);
console.log(`\nsuggestions: Safe ${C.fmt(t.safe)} · Re-downloadable ${C.fmt(t.cost)} · Review first ${C.fmt(t.check)}`);
sugs.slice(0, 12).forEach(s => console.log(`  [${s.conf}] ${s.n.data.n} · ${C.fmt(s.n.value)} · ${s.why}`));
