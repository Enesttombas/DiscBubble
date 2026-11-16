'use strict';
// Deletability classification: pure module, fake tree data only. Never touches the real disk.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/classify.js');

const GB = 1073741824, MB = 1048576, DAY = 86400;
const NOW = Date.UTC(2026, 10, 12) / 1000;
const ago = d => NOW - d * DAY;
// Tree builders: file and folder. A folder's size is the sum of its children.
const F = (n, s, m) => ({ n, s: Math.round(s), f: 1, ...(m ? { m } : {}) });
const D = (n, c, m) => {
  const mm = Math.max(m || 0, ...c.map(x => x.m || 0));
  return { n, s: c.reduce((t, x) => t + x.s, 0), c, ...(mm ? { m: mm } : {}) };
};
const run = tree => C.annotate(C.fromTree(tree), { now: NOW });
const find = (root, rel) => {
  let n = root;
  for (const p of rel.split('\\')) { n = (n.children || []).find(c => c.data.n === p); if (!n) throw new Error('not found: ' + rel); }
  return n;
};
const model = (org, name, gb) => D('models--' + org + '--' + name, [D('blobs', [F('a', gb * GB * 0.99), F('b', gb * GB * 0.01)]), D('snapshots', [F('x', 1)])], ago(40));

// A real-world .cache layout (2026-11-12) as fake data.
const cacheTree = () => D('C:\\Users\\me\\.cache', [
  D('huggingface', [D('hub', [
    model('tencent', 'Hunyuan3D-2', 17.06), model('tencent', 'Hunyuan3D-2mini', 7.12), model('openbmb', 'VoxCPM2', 4.62),
    model('Systran', 'faster-whisper-large-v3', 2.88), model('mobiuslabsgmbh', 'faster-whisper-large-v3-turbo', 1.51),
    model('Systran', 'faster-whisper-medium', 1.43), model('Systran', 'faster-whisper-small', 0.45),
  ]), D('xet', [D('logs', [F('x.log', 8 * MB)])])]),
  D('codex-runtimes', [D('codex-primary-runtime', [D('dependencies', [F('node.exe', 1.36 * GB)])])]),
  D('codebase-memory-mcp', [F('t6-repo.db', 0.32 * GB), F('t5-repo.db', 0.29 * GB)]),
  D('hyperframes', [D('history', [F('h1', 1.07 * GB)]), D('chrome', [F('c', 0.26 * GB)])]),
  D('torch', [D('hub', [D('checkpoints', [F('resnet.pth', 0.19 * GB)])])]),
]);

test('.cache is not green; huggingface is re-downloadable; Hunyuan3D-2 is re-downloadable, with size and model name', () => {
  const r = run(cacheTree());
  assert.notEqual(r.sf, 'safe');
  assert.equal(r.sf, 'check', '.cache holds an unrecognized 1 GB+ share: review first');
  const hf = find(r, 'huggingface');
  assert.equal(hf.sf, 'cost');
  assert.match(hf.why, /35\.\d GB/);
  const hy = find(r, 'huggingface\\hub\\models--tencent--Hunyuan3D-2');
  assert.equal(hy.sf, 'cost');
  assert.match(hy.why, /17\.1 GB/);
  assert.match(hy.why, /tencent\/Hunyuan3D-2\b/);
  assert.match(hy.why, /^If deleted, 17\.1 GB is downloaded again \(tencent\/Hunyuan3D-2\)\. Tools that use this model will not work until the download completes\.$/);
  // Files inside a model stay re-downloadable and do not turn green.
  assert.equal(find(r, 'huggingface\\hub\\models--tencent--Hunyuan3D-2\\blobs\\a').sf, 'cost');
});

test('recognized children of .cache are classified one by one, unrecognized ones need review', () => {
  const r = run(cacheTree());
  assert.equal(find(r, 'torch').sf, 'cost');
  assert.match(find(r, 'torch').why, /PyTorch/);
  assert.equal(find(r, 'codex-runtimes').sf, 'check');
  assert.equal(find(r, 'hyperframes').sf, 'check');
  assert.equal(find(r, 'codex-runtimes\\codex-primary-runtime\\dependencies\\node.exe').sf, 'check');
});

test('.cache gives the same result when the user folder is scanned', () => {
  const r = run(D('C:\\Users\\me', [cacheTree()].map(x => ({ ...x, n: '.cache' }))));
  assert.equal(find(r, '.cache').sf, 'check');
  assert.equal(find(r, '.cache\\huggingface\\hub\\models--tencent--Hunyuan3D-2').sf, 'cost');
});

test('a model folder scanned as the root is still re-downloadable', () => {
  const r = run({ ...model('tencent', 'Hunyuan3D-2', 17.06), n: 'C:\\Users\\me\\.cache\\huggingface\\hub\\models--tencent--Hunyuan3D-2' });
  assert.equal(r.sf, 'cost');
  assert.match(r.why, /tencent\/Hunyuan3D-2/);
});

test('things recreated automatically are green', () => {
  const r = run(D('C:\\Users\\me', [D('AppData', [D('Local', [
    D('Temp', [F('a.tmp', 300 * MB), D('x', [F('y', 200 * MB)])]),
    D('NVIDIA', [D('DXCache', [F('s.bin', 400 * MB)])]),
    D('Google', [D('Chrome', [D('User Data', [D('Default', [
      D('Code Cache', [D('js', [F('c', 120 * MB)])]),
      D('Cache', [D('Cache_Data', [F('f_0001', 600 * MB)])]),
    ])])])]),
    D('npm-cache', [D('_cacache', [F('c', 900 * MB)])]),
    D('CrashDumps', [F('app.dmp', 200 * MB)]),
  ])]), D('proj', [D('__pycache__', [F('m.pyc', 60 * MB)]), F('big.log', 80 * MB)])]));
  for (const p of ['AppData\\Local\\Temp', 'AppData\\Local\\NVIDIA\\DXCache', 'AppData\\Local\\Google\\Chrome\\User Data\\Default\\Code Cache',
    'AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cache', 'AppData\\Local\\npm-cache', 'AppData\\Local\\CrashDumps', 'proj\\__pycache__', 'proj\\big.log'])
    assert.equal(find(r, p).sf, 'safe', p);
});

test('package caches and virtual environments are re-downloadable, with a consequence sentence', () => {
  const r = run(D('C:\\Users\\me', [
    D('.gradle', [D('caches', [F('j.jar', 2 * GB)])]),
    D('.nuget', [D('packages', [F('p.nupkg', GB)])]),
    D('.cargo', [D('registry', [F('r', GB)]), D('bin', [F('cargo.exe', 30 * MB)])]),
    D('AppData', [D('Local', [D('pip', [D('cache', [F('w.whl', 700 * MB)])]), D('uv', [D('cache', [F('u', 500 * MB)])])])]),
    D('proj', [D('.venv', [D('Lib', [D('site-packages', [F('t.pyd', GB)])])]), F('main.py', 5000, ago(3))]),
  ]));
  for (const p of ['.gradle', '.nuget', '.cargo\\registry', 'AppData\\Local\\pip', 'AppData\\Local\\uv', 'proj\\.venv']) {
    const n = find(r, p);
    assert.equal(n.sf, 'cost', p);
    assert.ok(n.why && n.why.length > 10, p + ' sentence');
  }
  assert.match(find(r, '.gradle').why, /Gradle/);
  assert.equal(find(r, '.cargo\\bin').sf, 'check', 'tools installed with cargo are not a cache');
});

test('node_modules: old project is re-downloadable, active project needs review; sentence has age and npm install', () => {
  const r = run(D('C:\\Users\\me\\Documents', [
    D('old', [D('node_modules', [F('x.js', 400 * MB, ago(250))]), F('index.js', 4000, ago(245))]),
    D('new', [D('node_modules', [F('x.js', 400 * MB, ago(300))]), F('index.js', 4000, ago(9))]),
  ]));
  const old = find(r, 'old\\node_modules'), cur = find(r, 'new\\node_modules');
  assert.equal(old.sf, 'cost');
  assert.match(old.why, /npm install/);
  assert.match(old.why, /untouched for 8 months/);
  assert.equal(cur.sf, 'check');
  assert.match(cur.why, /active last week/);
  assert.match(cur.why, /npm install/);
});

test('suggestions: .cache is not suggested whole as safe; models are suggested one by one as re-downloadable', () => {
  const r = run(cacheTree());
  const sugs = C.suggest(r);
  assert.ok(!sugs.some(s => s.n === r || s.n.data.n === 'huggingface'), '.cache / huggingface are not suggested as one piece');
  const hy = sugs.find(s => s.n.data.n === 'models--tencent--Hunyuan3D-2');
  assert.ok(hy);
  assert.equal(hy.conf, 'cost');
  assert.match(hy.why, /If deleted, 17\.1 GB is downloaded again \(tencent\/Hunyuan3D-2\)/);
  assert.ok(sugs.every(s => s.conf !== 'safe' || s.n.sf === 'safe'));
  const t = C.sugTotals(sugs);
  assert.equal(t.safe, 0);
  assert.ok(t.cost > 33 * GB);
});

test('badge split and a safe suggestion next to a mixed folder', () => {
  const r = run(D('C:\\Users\\me', [D('AppData', [D('Local', [D('Temp', [F('a.tmp', 2 * GB)])])]), D('.cache', [D('huggingface', [D('hub', [model('a', 'b', 3)])])])]));
  const t = C.sugTotals(C.suggest(r));
  assert.ok(Math.abs(t.safe - 2 * GB) < MB);
  assert.ok(Math.abs(t.cost - 3 * GB) < MB);
});

test('system is still a system file; Windows\\Temp is green', () => {
  const r = run(D('C:\\', [D('Windows', [D('System32', [F('k.dll', GB)]), D('Temp', [F('t', 200 * MB)])])]));
  assert.equal(find(r, 'Windows\\System32').sf, 'never');
  assert.equal(find(r, 'Windows\\Temp').sf, 'safe');
});

test('tier names and risk levels come from one source', () => {
  const names = Object.fromEntries(Object.entries(C.SAFE).map(([k, s]) => [k, [s.name, s.risk]]));
  assert.deepEqual(names, {
    safe: ['Safe to delete', 'No risk'], cost: ['Re-downloadable', 'Low risk'], check: ['Review first', 'Medium risk'],
    keep: ['Personal data', 'High risk'], prog: ['Program', 'High risk'], never: ['System file', 'Critical'], unk: ['Unclassified', 'Unknown'],
  });
  for (const s of Object.values(C.SAFE)) assert.match(s.desc, /^[^.]+\. [^.]+\.$/, 'description: contents sentence + consequence sentence');
});

test('age sentence', () => {
  assert.equal(C.ageText(NOW - 9 * DAY, NOW), 'active last week');
  assert.equal(C.ageText(NOW - 250 * DAY, NOW), 'untouched for 8 months');
  assert.equal(C.ageText(NOW - 800 * DAY, NOW), 'untouched for 2 years');
  assert.equal(C.ageText(0, NOW), '');
});

// Found on a real C: scan (2026-11-16); paths here are fake.
test('temp-like names inside Windows stay system files, except the known cleanup folders', () => {
  const r = run(D('C:\\', [D('Windows', [
    D('WinSxS', [D('Temp', [D('InFlight', [F('a', 200 * MB)])]), F('x.dll', 3 * GB)]),
    D('assembly', [D('NativeImages_v4', [D('Temp', [F('t', 60 * MB)])])]),
    D('System32', [D('config', [F('SOFTWARE.LOG1', 80 * MB)]), F('k.dll', GB)]),
    D('Temp', [F('t.bin', 60 * MB)]), D('Prefetch', [F('p.pf', 60 * MB)]), D('Logs', [F('cbs.log', 60 * MB)]),
    F('MEMORY.DMP', 2 * GB),
  ])]));
  for (const p of ['Windows\\WinSxS\\Temp', 'Windows\\WinSxS\\Temp\\InFlight', 'Windows\\assembly\\NativeImages_v4\\Temp', 'Windows\\System32\\config\\SOFTWARE.LOG1'])
    assert.equal(find(r, p).sf, 'never', p);
  for (const p of ['Windows\\Temp', 'Windows\\Prefetch', 'Windows\\Logs', 'Windows\\MEMORY.DMP'])
    assert.equal(find(r, p).sf, 'safe', p);
  assert.ok(!C.suggest(r).some(s => /winsxs|assembly|system32/.test(s.n.lp)), 'nothing under WinSxS, assembly or System32 is suggested');
});

test('a Python installation is a program, not a virtual environment', () => {
  const py = D('pythoncore-3.14-64', [
    D('Lib', [D('site-packages', [F('big.pyd', 5 * GB)])]), D('Scripts', [F('pip.exe', MB)]),
    D('DLLs', [F('_ssl.pyd', 20 * MB)]), D('include', [F('Python.h', MB)]), F('python.exe', MB),
  ]);
  const venv = D('env', [D('Lib', [D('site-packages', [F('big.pyd', GB)])]), D('Scripts', [F('python.exe', MB)])], ago(90));
  const r = run(D('C:\\', [D('Users', [D('me', [D('AppData', [D('Local', [D('Python', [py])])]), D('proj', [venv])])])]));
  const n = find(r, 'Users\\me\\AppData\\Local\\Python\\pythoncore-3.14-64');
  assert.equal(n.sf, 'prog');
  assert.ok(!C.suggest(r).some(s => s.n === n), 'the interpreter is not suggested for deletion');
  assert.equal(find(r, 'Users\\me\\proj\\env').sf, 'cost', 'a real environment without pyvenv.cfg is still recognized');
});

test('tmp and temp folders inside personal folders are personal data, AppData\\Local\\Temp is still green', () => {
  const r = run(D('C:\\', [D('Users', [D('me', [
    D('Documents', [D('work', [D('tmp', [F('notes.bin', 400 * MB)]), D('temp', [F('draft.bin', 400 * MB)])])]),
    D('AppData', [D('Local', [D('Temp', [F('t.bin', 400 * MB)])])]),
  ])])]));
  assert.equal(find(r, 'Users\\me\\Documents\\work\\tmp').sf, 'keep');
  assert.equal(find(r, 'Users\\me\\Documents\\work\\temp').sf, 'keep');
  assert.equal(find(r, 'Users\\me\\AppData\\Local\\Temp').sf, 'safe');
  assert.deepEqual(C.suggest(r).map(s => s.n.data.n), ['Temp']);
});
