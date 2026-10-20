// Scan benchmark: builds a synthetic folder tree, then times the Node scanner (scanner.js)
// against the Rust bubblescan walk mode on the same tree. Usage: node bench/scan-bench.cjs [runs] [files]
// Needs scanner-rs/target/release/bubblescan.exe (cargo build --release in scanner-rs).
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const { scan } = require('../scanner');

const RUNS = +process.argv[2] || 7, FILES = +process.argv[3] || 60000;
const EXE = path.join(__dirname, '..', 'scanner-rs', 'target', 'release', 'bubblescan.exe');
const root = path.join(os.tmpdir(), 'discbubble-bench-tree');

function build() {
  fs.rmSync(root, { recursive: true, force: true });
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const top = ['projects', 'videos', 'cache', 'node_modules', 'photos', 'games'];
  let made = 0;
  while (made < FILES) {
    const d = path.join(root, top[made % top.length], 'a' + (made % 40), 'b' + (made % 7), 'c' + (made % 13));
    fs.mkdirSync(d, { recursive: true });
    for (let i = 0; i < 20 && made < FILES; i++, made++)
      fs.writeFileSync(path.join(d, 'f' + made + '.bin'), Buffer.alloc(1 + Math.floor(rnd() * rnd() * 20000)));
  }
}
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];

(async () => {
  build();
  const node = [], rust = []; let nf = 0, rf = 0;
  for (let i = 0; i < RUNS + 1; i++) {
    const t = Date.now();
    const r = await scan(root, () => {}, new AbortController().signal);
    const ms = Date.now() - t; nf = r.st.files;
    const out = path.join(os.tmpdir(), 'discbubble-bench.json');
    const t2 = process.hrtime.bigint();
    const p = spawnSync(EXE, [root, '--out', out, '--mode', 'walk']);
    const ms2 = Number(process.hrtime.bigint() - t2) / 1e6;
    if (p.status !== 0) { console.error('bubblescan rc', p.status); process.exit(1); }
    rf = JSON.parse(fs.readFileSync(out, 'utf8')).files;
    if (i > 0) { node.push(ms); rust.push(Math.round(ms2)); }   // run 0 = warm-up
  }
  const res = { files: { node: nf, rust: rf }, runs: RUNS, node_ms: node, rust_ms: rust,
    node_median: pct(node, .5), rust_median: pct(rust, .5), os: os.release(), cpus: os.cpus().length };
  console.log(JSON.stringify(res));
  fs.rmSync(root, { recursive: true, force: true });
})();
