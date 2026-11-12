const fs = require('fs');
const path = require('path');

function drives() {
  const out = [];
  for (let c = 67; c <= 90; c++) {
    const root = String.fromCharCode(c) + ':\\';
    try {
      const s = fs.statfsSync(root);
      out.push({ path: root, total: s.blocks * s.bsize, free: s.bavail * s.bsize });
    } catch {}
  }
  return out;
}

// Tree: {n: name, s: bytes, c?: children, m?: last modified (unix seconds; for a folder, its newest file)}. Small items are grouped under "small items".
async function scan(root, onProgress, signal) {
  const st = { files: 0, dirs: 0, bytes: 0, cur: root };
  let tick = Date.now();
  const LIMIT = 48;
  let active = 0;
  const waiters = [];
  const acquire = () => (active < LIMIT ? (active++, Promise.resolve()) : new Promise(r => waiters.push(r)));
  const release = () => { const w = waiters.shift(); if (w) w(); else active--; };

  async function walk(dir, name) {
    if (signal.aborted) return { n: name, s: 0 };
    let ents;
    await acquire();
    try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch { release(); return { n: name, s: 0 }; }
    release();
    st.dirs++; st.cur = dir;
    const kids = [];
    const jobs = [];
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) jobs.push(walk(full, e.name));
      else jobs.push((async () => {
        await acquire();
        try { const x = await fs.promises.lstat(full); st.files++; st.bytes += x.size; return { n: e.name, s: x.size, f: 1, m: Math.floor(x.mtimeMs / 1000) }; }
        catch { return null; } finally { release(); }
      })());
      if (Date.now() - tick > 80) { tick = Date.now(); onProgress(st); await new Promise(r => setImmediate(r)); }
    }
    for (const k of await Promise.all(jobs)) if (k && k.s > 0) kids.push(k);
    const total = kids.reduce((a, k) => a + k.s, 0), m = kids.reduce((a, k) => Math.max(a, k.m || 0), 0);
    return m ? { n: name, s: total, c: kids, m } : { n: name, s: total, c: kids };
  }

  const tree = await walk(root, root);
  return { tree, st };
}

// Merges items below the size threshold into a single "small items" leaf; caps the node count.
function prune(node, min) {
  if (!node.c) return node;
  const keep = []; let rest = 0, restN = 0, restM = 0;
  for (const k of node.c) {
    if (k.s >= min) keep.push(prune(k, min)); else { rest += k.s; restN++; restM = Math.max(restM, k.m || 0); }
  }
  if (rest > 0) keep.push({ n: `${restN.toLocaleString('en-US')} small items`, s: rest, f: 1, o: 1, ...(restM ? { m: restM } : {}) });
  keep.sort((a, b) => b.s - a.s);
  return { n: node.n, s: node.s, c: keep, ...(node.m ? { m: node.m } : {}) };
}

module.exports = { drives, scan, prune };
