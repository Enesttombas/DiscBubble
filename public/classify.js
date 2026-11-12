// Disk Bubble — deletability classification. Pure module: no DOM, no disk access.
// In the browser it is the `Classify` global, in Node it is module.exports (node --test).
// Input: a d3-hierarchy node or fromTree() output ({data:{n,s,c,m,o}, children, parent, value}).
(function (G) {
  'use strict';
  const KB = 1024, MB = KB * KB, GB = MB * KB, DAY = 86400;

  const CATS = [
    { id: 'video', name: 'Video', col: '#ff7a7a', ext: 'mp4 mkv avi mov wmv webm m4v flv' },
    { id: 'image', name: 'Image', col: '#ffb85e', ext: 'jpg jpeg png gif bmp webp heic svg raw psd tif tiff ico' },
    { id: 'audio', name: 'Audio', col: '#c78bff', ext: 'mp3 wav flac m4a ogg aac wma' },
    { id: 'vm', name: 'Virtual machine', col: '#4fa3ff', ext: 'vhd vhdx vmdk vdi qcow2 ova' },
    { id: 'iso', name: 'Disk image', col: '#5ec8ff', ext: 'iso img wim esd' },
    { id: 'arch', name: 'Archive', col: '#3fd0d4', ext: 'zip rar 7z tar gz xz cab' },
    { id: 'backup', name: 'Backup', col: '#9fd36b', ext: 'bak bkp old' },
    { id: 'doc', name: 'Document', col: '#6fe3a0', ext: 'pdf doc docx xls xlsx ppt pptx txt md csv rtf epub' },
    { id: 'code', name: 'Code / data', col: '#8a9bff', ext: 'js ts py cs cpp c h java rs go json html css xml sql ipynb map' },
    { id: 'db', name: 'Database', col: '#6a7dff', ext: 'db sqlite sqlite3 mdf ldf' },
    { id: 'exe', name: 'Program', col: '#ff8fb5', ext: 'exe msi msix' },
    { id: 'lib', name: 'Library / driver', col: '#ff6fa0', ext: 'dll sys pdb obj lib node so' },
    { id: 'gamefile', name: 'Game data', col: '#d99bff', ext: '' },
    { id: 'log', name: 'Log / dump', col: '#e0c070', ext: 'log dmp etl' },
    { id: 'model', name: 'Model store', col: '#e6d36a', ext: '' },
    { id: 'cache', name: 'Cache', col: '#ffa24d', ext: '' },
    { id: 'devcache', name: 'Developer cache', col: '#ff9a6b', ext: '' },
    { id: 'update', name: 'Windows leftovers', col: '#ff8a5e', ext: '' },
    { id: 'tmp', name: 'Temp file', col: '#ffc26b', ext: 'tmp' },
    { id: 'other', name: 'Other', col: '#8d96aa', ext: '' },
    { id: 'small', name: 'Small items', col: '#4a5062', ext: '' },
  ];
  const EXT = {};
  CATS.forEach(c => c.ext.split(' ').forEach(e => e && (EXT[e] = c)));
  const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));

  // ---- importance groups ----
  const GRP = {
    system: { name: 'System', col: '#ff6b8b', tag: 'Critical · do not delete' },
    user: { name: 'Personal files', col: '#6fe3a0', tag: 'Important' },
    app: { name: 'Application', col: '#5ec8ff', tag: 'Normal' },
    game: { name: 'Game', col: '#c78bff', tag: 'Normal · large, deletable' },
    temp: { name: 'Cache / temp', col: '#ffb85e', tag: 'Regenerable · the Safety view shows the effect of deleting' },
    other: { name: 'Other', col: '#8d96aa', tag: 'Unclassified' },
  };

  // ---- safety scale (order = risk order = display order) · risk: the tier's short risk level ----
  const SAFE = {
    safe: { name: 'Safe to delete', risk: 'No risk', col: '#3ddc84', desc: 'Temp files, GPU and browser caches, logs. If deleted, they are recreated automatically when needed.' },
    cost: { name: 'Re-downloadable', risk: 'Low risk', col: '#d6d24c', desc: 'Models, package stores, node_modules, virtual environments. If deleted, they are downloaded or reinstalled again; the related tool does not work until then.' },
    check: { name: 'Review first', risk: 'Medium risk', col: '#ffa940', desc: 'Large games, disk images, archives, videos, unrecognized caches. If deleted, they do not come back without a new download or a backup.' },
    keep: { name: 'Personal data', risk: 'High risk', col: '#4f9dff', desc: 'Documents, photos, projects. If deleted, they can only be restored from a backup.' },
    prog: { name: 'Program', risk: 'High risk', col: '#b48cff', desc: 'Installed applications. Deleting their files breaks the application; uninstall it from Settings instead.' },
    never: { name: 'System file', risk: 'Critical', col: '#ff5252', desc: 'Windows and system files. If deleted, Windows may fail to start or work correctly.' },
    unk: { name: 'Unclassified', risk: 'Unknown', col: '#8d96aa', desc: 'Unrecognized content. The effect of deleting it is unknown; inspect the contents first.' },
  };
  const RANK = { safe: 0, cost: 1, check: 2, unk: 3, keep: 4, prog: 5, never: 6 };

  const fmt = b => {
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
    while (b >= 1024 && i < 4) { b /= 1024; i++; }
    return b.toLocaleString('en-US', { maximumFractionDigits: b < 10 && i ? 2 : b < 100 && i ? 1 : 0 }) + ' ' + u[i];
  };
  // Time since the last modification, in words.
  function ageText(m, now) {
    if (!m) return '';
    const d = (now - m) / DAY;
    if (d < 1) return 'active today';
    if (d < 7) return 'active this week';
    if (d < 14) return 'active last week';
    if (d < 30) return 'active ' + Math.floor(d) + ' days ago';
    if (d < 365) { const n = Math.max(1, Math.floor(d / 30.44)); return 'untouched for ' + n + (n === 1 ? ' month' : ' months'); }
    const y = Math.floor(d / 365);
    return 'untouched for ' + y + (y === 1 ? ' year' : ' years');
  }
  const ACTIVE_DAYS = 30;
  const extOf = nm => (nm.includes('.') ? nm.slice(nm.lastIndexOf('.') + 1) : '');

  // ---- signature table ----
  // t: tier · kind: leaf (children inherit), split (children one by one; unrecognized ones inherit),
  // container (generic name: children one by one; unrecognized ones are "Review first"), unknown (unrecognized; still searched below)
  // why: consequence sentence (string or (node, context) => string) · model: model store category · sug: suggest outside safe/cost
  const S = (id, t, kind, why, x) => ({ id, t, kind, why, ...x });
  const hfName = nm => { const r = nm.replace(/^(models|datasets|spaces)--/, ''), i = r.indexOf('--'); return i < 0 ? r : r.slice(0, i) + '/' + r.slice(i + 2); };
  const SIG = {
    hf: S('hf', 'cost', 'split', n => `Hugging Face model store. If deleted, ${fmt(n.value)} is downloaded again. Tools that use these models will not work until the download completes.`, { model: 1 }),
    hfhub: S('hfhub', 'cost', 'split', n => `Hugging Face models. If deleted, ${fmt(n.value)} is downloaded again. Tools that use these models will not work until the download completes.`, { model: 1 }),
    hfmodel: S('hfmodel', 'cost', 'leaf', (n, x) => `If deleted, ${fmt(n.value)} is downloaded again (${hfName(x.name)}). Tools that use this model will not work until the download completes.`, { model: 1 }),
    hfdata: S('hfdata', 'cost', 'leaf', (n, x) => `If deleted, the ${fmt(n.value)} dataset is downloaded again` + (/^datasets--/i.test(x.name) ? ` (${hfName(x.name)})` : '') + '. Tools that use this dataset will not work until the download completes.', { model: 1 }),
    torch: S('torch', 'cost', 'leaf', n => `PyTorch hub models. If deleted, ${fmt(n.value)} is downloaded again. Tools that use these models will not work until the download completes.`, { model: 1 }),
    ollama: S('ollama', 'cost', 'leaf', n => `Ollama models. If deleted, ${fmt(n.value)} is downloaded again (ollama pull). The models are unavailable until the download completes.`, { model: 1 }),
    lmstudio: S('lmstudio', 'cost', 'leaf', n => `LM Studio models. If deleted, ${fmt(n.value)} is downloaded again. The models are unavailable until the download completes.`, { model: 1 }),
    gradle: S('gradle', 'cost', 'leaf', n => `Gradle dependencies. If deleted, ${fmt(n.value)} is downloaded again. The next build takes longer.`),
    nuget: S('nuget', 'cost', 'leaf', n => `.NET packages. If deleted, ${fmt(n.value)} is downloaded again (dotnet restore). The next build takes longer.`),
    cargo: S('cargo', 'cost', 'container', 'Rust tool folder. If deleted, the registry is downloaded again; installed tools in bin are removed.'),
    cargoreg: S('cargoreg', 'cost', 'leaf', n => `Rust crates. If deleted, ${fmt(n.value)} is downloaded again. The next build takes longer.`),
    maven: S('maven', 'cost', 'leaf', n => `Maven dependencies. If deleted, ${fmt(n.value)} is downloaded again. The next build takes longer.`),
    pip: S('pip', 'cost', 'leaf', n => `pip cache. If deleted, packages are downloaded again when needed (${fmt(n.value)}). Installed environments are not affected.`),
    uv: S('uv', 'cost', 'leaf', n => `uv package cache. If deleted, ${fmt(n.value)} is downloaded again. Rebuilding environments takes longer.`),
    pnpm: S('pnpm', 'cost', 'leaf', n => `pnpm store. If deleted, ${fmt(n.value)} is downloaded again. Projects need pnpm install again.`),
    yarn: S('yarn', 'cost', 'leaf', n => `Yarn cache. If deleted, packages are downloaded again when needed (${fmt(n.value)}).`),
    gomod: S('gomod', 'cost', 'leaf', n => `Go modules. If deleted, ${fmt(n.value)} is downloaded again. The next build takes longer.`),
    conda: S('conda', 'cost', 'leaf', n => `Conda package cache. If deleted, ${fmt(n.value)} is downloaded again.`),
    condaenv: S('condaenv', 'cost', 'leaf', 'Conda environment. If deleted, the environment has to be rebuilt. Projects that use it will not run until the rebuild completes.'),
    venv: S('venv', 'cost', 'leaf', 'Python virtual environment. If deleted, it has to be reinstalled (pip install -r requirements.txt). The project will not run until the install completes.'),
    nodemod: S('nodemod', 'cost', 'leaf', null, { age: 1 }),
    temp: S('temp', 'safe', 'leaf', 'Temp files. If deleted, nothing breaks; files in use are skipped.'),
    gpu: S('gpu', 'safe', 'leaf', 'Graphics shader cache. If deleted, it is rebuilt on the next launch.'),
    browser: S('browser', 'safe', 'leaf', 'Browser / app cache. If deleted, pages load fresh the first time.'),
    pyc: S('pyc', 'safe', 'leaf', 'Python bytecode cache. If deleted, it is regenerated automatically.'),
    prefetch: S('prefetch', 'safe', 'leaf', 'Windows cache. If deleted, Windows rebuilds it.'),
    dumps: S('dumps', 'safe', 'leaf', 'Crash dumps. If deleted, only debugging information is lost.'),
    recycle: S('recycle', 'safe', 'leaf', 'Recycle Bin contents. If deleted, they cannot be restored.'),
    npm: S('npm', 'safe', 'leaf', 'npm cache. If deleted, packages are downloaded again when needed; projects are not affected.'),
    winlog: S('winlog', 'safe', 'leaf', 'Windows logs. If deleted, nothing breaks.'),
    wudl: S('wudl', 'safe', 'leaf', 'Downloaded Windows update files. If deleted, they are downloaded again when needed.'),
    logfile: S('logfile', 'safe', 'leaf', 'Log / dump file. If deleted, nothing breaks.'),
    tmpfile: S('tmpfile', 'safe', 'leaf', 'Temp file. If deleted, nothing breaks.'),
    winold: S('winold', 'check', 'leaf', 'Previous Windows installation. If deleted, rolling back to the previous Windows version is no longer possible.', { sug: 1, upd: 1 }),
    winbt: S('winbt', 'check', 'leaf', 'Windows update setup leftovers. If deleted, an update in progress cannot complete.', { sug: 1, upd: 1 }),
    generic: S('generic', 'safe', 'container', 'Generic cache folder. Its contents are classified one by one; the effect of deleting depends on the contents.'),
    unrec: S('unrec', 'check', 'unknown', 'In a cache folder, but not recognized. If deleted, the related tool may need a reinstall or a new data download. Inspect the contents before deleting.'),
    loosefile: S('loosefile', 'safe', 'leaf', 'Cache file. If deleted, it is recreated.'),
    loosemodel: S('loosemodel', 'cost', 'leaf', n => `Model file. If deleted, ${fmt(n.value)} is downloaded again. Tools that use this model will not work until the download completes.`, { model: 1 }),
  };
  const NAME_SIG = {
    temp: 'temp', tmp: 'temp',
    'code cache': 'browser', gpucache: 'browser', cache_data: 'browser', cache2: 'browser', inetcache: 'browser', webcache: 'browser',
    dawncache: 'gpu', dawngraphitecache: 'gpu', dawnwebgpucache: 'gpu', graphitedawncache: 'gpu', grshadercache: 'gpu',
    shadercache: 'gpu', dxcache: 'gpu', glcache: 'gpu', d3dscache: 'gpu', nv_cache: 'gpu', vkcache: 'gpu',
    __pycache__: 'pyc', prefetch: 'prefetch', crashdumps: 'dumps', '$recycle.bin': 'recycle', 'npm-cache': 'npm', '.npm': 'npm',
    'windows.old': 'winold', '$windows.~bt': 'winbt', '$windows.~ws': 'winbt',
    huggingface: 'hf', node_modules: 'nodemod', '.ollama': 'ollama', '.lmstudio': 'lmstudio', 'lm-studio': 'lmstudio',
    '.gradle': 'gradle', '.nuget': 'nuget', '.cargo': 'cargo', '.m2': 'maven', '.pnpm-store': 'pnpm', '.venv': 'venv', venv: 'venv',
    '.cache': 'generic', cache: 'generic', caches: 'generic',
  };
  const MODEL_EXT = new Set(['safetensors', 'gguf', 'ggml', 'pt', 'pth', 'ckpt', 'onnx', 'h5', 'msgpack', 'tflite']);
  const isVenv = kids => {
    if (!kids) return false;
    const k = new Map(kids.map(c => [c.n.toLowerCase(), c]));
    if (k.has('pyvenv.cfg')) return true;
    const lib = k.get('lib');
    return !!(lib && lib.c && lib.c.some(c => c.n.toLowerCase() === 'site-packages') && (k.has('scripts') || k.has('bin')));
  };
  // A node's own signature (no context): name + path + contents if needed.
  function sigOf(nm, lp, isDir, kids) {
    if (!isDir) {
      const e = extOf(nm);
      if (e === 'tmp') return SIG.tmpfile;
      if (e === 'log' || e === 'dmp' || e === 'etl') return SIG.logfile;
      return null;
    }
    if (/\\huggingface\\hub$/.test(lp)) return SIG.hfhub;
    if (/\\huggingface\\hub\\models--[^\\]+$/.test(lp)) return SIG.hfmodel;
    if (/\\huggingface\\hub\\datasets--[^\\]+$/.test(lp) || /\\huggingface\\datasets$/.test(lp)) return SIG.hfdata;
    if (/\\\.cache\\torch$/.test(lp) || /\\torch\\hub$/.test(lp)) return SIG.torch;
    if (/\\ollama\\models$/.test(lp)) return SIG.ollama;
    if (/\\lm ?studio\\models$/.test(lp)) return SIG.lmstudio;
    if (/\\\.cargo\\(registry|git)$/.test(lp)) return SIG.cargoreg;
    if (/\\nuget\\(v3-cache|plugins-cache)$/.test(lp)) return SIG.nuget;
    if ((nm === 'pip' || nm === 'uv') && /\\(appdata\\local|\.cache)\\(pip|uv)$/.test(lp)) return SIG[nm];
    if (/\\pnpm\\store$/.test(lp) || /\\appdata\\local\\pnpm-cache$/.test(lp)) return SIG.pnpm;
    if (/\\yarn\\(cache|berry\\cache)$/.test(lp)) return SIG.yarn;
    if (/\\go\\pkg\\mod$/.test(lp)) return SIG.gomod;
    if (/(conda3?|\\\.conda)\\pkgs$/.test(lp)) return SIG.conda;
    if (/(conda3?|\\\.conda)\\envs\\[^\\]+$/.test(lp)) return SIG.condaenv;
    if (/\\softwaredistribution\\download$/.test(lp)) return SIG.wudl;
    if (/^[a-z]:\\windows\\logs$/.test(lp)) return SIG.winlog;
    const k = NAME_SIG[nm];
    if (k) return SIG[k];
    if (isVenv(kids)) return SIG.venv;
    return null;
  }

  // ---- importance group (path-based rules) ----
  const GAME_NAMES = new Set(['steamapps', 'steam', 'epic games', 'riot games', 'battle.net', 'ubisoft', 'ubisoft game launcher', 'gog games', 'gog galaxy',
    'xboxgames', 'games', 'ea games', 'origin games', 'genshin impact', 'minecraft', 'valorant']);
  function ruleGrp(lp, name) {
    if (/^[a-z]:\\(windows|system volume information|recovery|boot|config\.msi|msocache|\$[^\\]*)$/.test(lp)
      || /^[a-z]:\\(pagefile|hiberfil|swapfile)\.sys$/.test(lp) || /\\programdata\\microsoft$/.test(lp)) return 'system';
    if (GAME_NAMES.has(name)) return 'game';
    if (/^[a-z]:\\(program files( \(x86\))?|programdata)$/.test(lp) || /\\users\\[^\\]+\\appdata$/.test(lp) || /\\windowsapps$/.test(lp)) return 'app';
    if (/^[a-z]:\\users\\[^\\]+$/.test(lp)) return 'user';
    return null;
  }
  // A node's context: importance group + active signature. pc: the parent's context.
  function decide(name, lp, isDir, pc, kids) {
    const nm = name.toLowerCase(), ps = pc && pc.sig;
    if (ps && ps.kind === 'leaf') return { grp: pc.grp, sig: ps, inh: true, src: pc.src };
    let own = sigOf(nm, lp, isDir, kids);
    if (own && own.kind === 'container' && pc && pc.grp === 'system' && !ps) own = null; // generic "cache" names inside system stay do-not-touch
    if (own) return { grp: own.id === 'unrec' ? 'other' : 'temp', sig: own, inh: false, src: name };
    if (ps && ps.kind === 'container') {
      const sig = isDir ? SIG.unrec : MODEL_EXT.has(extOf(nm)) ? SIG.loosemodel : SIG.loosefile;
      return { grp: isDir ? 'other' : 'temp', sig, inh: false, src: name };
    }
    if (ps) return { grp: pc.grp, sig: ps, inh: true, src: pc.src };
    return { grp: ruleGrp(lp, nm) || (pc ? pc.grp : 'other'), sig: null, inh: false, src: null };
  }
  // Starting context from the scanned root's parent folders.
  function seedCtx(rootPath) {
    const parts = String(rootPath).replace(/[\\/]+$/, '').split(/[\\/]+/);
    let pc = null, lp = '';
    for (let i = 0; i < parts.length - 1; i++) {
      lp = (lp ? lp.replace(/\\$/, '') + '\\' : '') + parts[i].toLowerCase();
      if (lp.length === 2) lp += '\\';
      pc = decide(parts[i], lp, true, pc, null);
    }
    return { pc, name: parts[parts.length - 1] || String(rootPath), lp: String(rootPath).replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase() };
  }

  function catOf(n) {
    if (n.data.o) return CAT.small;
    const nm = n.data.n.toLowerCase(), k = EXT[extOf(nm)];
    if (n.grp === 'temp' && n.sig) {
      if (n.sig.upd || /softwaredistribution/.test(n.lp)) return CAT.update;
      if (n.sig.model) return CAT.model;
      if (n.sig.t === 'cost' || n.sig.id === 'pyc' || n.sig.id === 'npm') return CAT.devcache;
      if (k && k.id === 'log') return CAT.log;
      return /cache/.test(n.lp) ? CAT.cache : CAT.tmp;
    }
    if (n.grp === 'game' && !k) return CAT.gamefile;
    return k || CAT.other;
  }
  // Tier of a node without a signature (the previous rules).
  function plainTier(n) {
    if (n.grp === 'system') return 'never';
    if (!n.children && n.cat) {
      const id = n.cat.id;
      if (['vm', 'iso', 'arch', 'backup'].includes(id) && n.value >= GB) return 'check';
      if (id === 'video' && n.value >= 2 * GB) return 'check';
    }
    if (n.grp === 'game') return 'check';
    if (n.grp === 'user') return 'keep';
    if (n.grp === 'app') return 'prog';
    return 'unk';
  }
  // node_modules: the project's (siblings') last modification decides the tier and the sentence.
  function nodeModules(n, now) {
    let m = 0;
    if (n.parent) for (const c of n.parent.children || []) if (c !== n && c.data.n.toLowerCase() !== 'node_modules' && c.data.m > m) m = c.data.m;
    const age = ageText(m, now);
    if (!m) return { t: 'cost', why: 'If deleted, `npm install` is needed. The project will not run until the install completes.' };
    if ((now - m) / DAY < ACTIVE_DAYS) return { t: 'check', why: `Active project (${age}). If deleted, \`npm install\` is needed; the project will not run until the install completes.` };
    return { t: 'cost', why: `Project ${age}. If deleted, \`npm install\` is needed; the project will not run until the install completes.` };
  }
  function evalSig(sig, n, src, now) {
    if (sig.id === 'nodemod') return nodeModules(n, now);
    return { t: sig.t, why: typeof sig.why === 'function' ? sig.why(n, { name: src || n.data.n, now }) : sig.why };
  }

  const pre = (n, fn) => { fn(n); if (n.children) for (const c of n.children) pre(c, fn); };
  const post = (n, fn) => { if (n.children) for (const c of n.children) post(c, fn); fn(n); };

  // Classifies the tree. Each node gets: lp, grp, sig, inh, cat, sf0/why0 (own), sf/why (with contents), mixed, maxRank.
  function annotate(h, o) {
    const now = (o && o.now) || Date.now() / 1000;
    pre(h, n => {
      let ctx;
      if (!n.parent) {
        const s = seedCtx(n.data.n);
        n.lp = s.lp.length === 2 ? s.lp + '\\' : s.lp;
        ctx = decide(s.name, n.lp, !!n.children, s.pc, n.data.c);
      } else {
        n.lp = n.parent.lp.replace(/\\$/, '') + '\\' + n.data.n.toLowerCase();
        ctx = n.data.o ? { grp: n.parent.grp, sig: n.parent.sig, inh: true, src: n.parent.ctx.src } : decide(n.data.n, n.lp, !!n.children, n.parent.ctx, n.data.c);
      }
      n.ctx = ctx; n.grp = ctx.grp; n.sig = ctx.sig; n.inh = ctx.inh;
      n.cat = n.children ? null : catOf(n);
      if (n.data.o && n.parent) { n.sf0 = n.parent.sf0; n.why0 = n.parent.why0; }
      else if (n.sig && n.inh && n.parent && n.parent.sig === n.sig && n.sig.kind !== 'split') { n.sf0 = n.parent.sf0; n.why0 = n.parent.why0; }
      else if (n.sig) { const r = evalSig(n.sig, n, ctx.src, now); n.sf0 = r.t; n.why0 = r.why; }
      else { n.sf0 = plainTier(n); n.why0 = SAFE[n.sf0].desc; }
    });
    // A folder's color reflects the riskiest meaningful share of its contents (only raised on deletable tiers).
    post(h, n => {
      n.sf = n.sf0; n.why = n.why0; n.mixed = false; n.maxRank = RANK[n.sf0];
      if (!n.children) return;
      for (const c of n.children) if (c.maxRank > n.maxRank) n.maxRank = c.maxRank;
      if (RANK[n.sf0] > RANK.cost) return;
      const risky = n.children.filter(c => !c.data.o && RANK[c.sf] > RANK[n.sf0] && (c.value >= 0.05 * n.value || c.value >= GB));
      if (!risky.length) return;
      n.sf = risky.reduce((w, c) => (RANK[c.sf] > RANK[w] ? c.sf : w), n.sf0); n.mixed = true;
      risky.sort((a, b) => b.value - a.value);
      n.why = 'Mixed contents: ' + risky.slice(0, 3).map(c => `${c.data.n} ${fmt(c.value)} (${SAFE[c.sf].name.toLowerCase()})`).join(', ') + '. Do not delete the folder as a whole; review the items one by one.';
    });
    return h;
  }

  // Rule-based suggestions: the topmost matching node is taken, its children are not visited.
  // A signed node is suggested only if nothing inside it is riskier; model stores are suggested one by one.
  function suggest(h, limit) {
    const out = [];
    (function w(n) {
      if (n.data.o) return;
      if (n.parent && n.grp !== 'system') {
        let r = null;
        if (n.sig) {
          const own = !n.inh && !n.mixed && n.sig.kind !== 'split' && n.maxRank === RANK[n.sf];
          if (own && n.value >= 50 * MB && (n.sf === 'safe' || n.sf === 'cost' || n.sig.sug)) r = [n.sf, n.why];
        } else {
          const dir = !!n.children;
          if (dir && n.grp === 'game' && n.parent.grp !== 'game' && n.value >= GB) r = ['check', 'Game library. If deleted, it has to be downloaded again from the store. Can be deleted if it is no longer played.'];
          else if (!dir && ['vm', 'iso', 'arch', 'backup'].includes(n.cat.id) && n.value >= GB) r = ['check', 'Large ' + n.cat.name.toLowerCase() + '. If deleted, it does not come back. Can be deleted if it is no longer needed.'];
          else if (!dir && n.cat.id === 'video' && n.value >= 2 * GB) r = ['check', 'Large video. If deleted, it does not come back. Confirm that a backup exists before deleting.'];
        }
        if (r) { out.push({ n, conf: r[0], why: r[1] }); return; }
      }
      (n.children || []).forEach(w);
    })(h);
    return out.sort((a, b) => b.n.value - a.n.value).slice(0, limit || 40);
  }
  function sugTotals(sugs) {
    const t = { safe: 0, cost: 0, check: 0, nSafe: 0, nCost: 0, nCheck: 0 };
    for (const s of sugs) { const k = s.conf === 'safe' ? 'safe' : s.conf === 'cost' ? 'cost' : 'check'; t[k] += s.n.value; t['n' + k[0].toUpperCase() + k.slice(1)]++; }
    return t;
  }

  // d3-like node tree from the scanner JSON (for tests and the command line).
  function fromTree(data, parent) {
    const n = { data, parent: parent || null, depth: parent ? parent.depth + 1 : 0 };
    if (data.c && data.c.length) {
      n.children = data.c.map(c => fromTree(c, n)).sort((a, b) => b.value - a.value);
      n.value = n.children.reduce((t, c) => t + c.value, 0);
    } else n.value = data.s || 0;
    return n;
  }

  const api = { CATS, CAT, EXT, GRP, SAFE, RANK, fmt, ageText, sigOf, ruleGrp, decide, catOf, annotate, suggest, sugTotals, fromTree };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else G.Classify = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
