'use strict';
// Disk Bubble — canvas circle packing, single focus node + animated zoom.
const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
const BG = '#0c0d11';

const { CATS, CAT, GRP, SAFE, fmt, ageText } = Classify;
const GRPDESC = {
  system: 'Windows, drivers, recovery. Do not delete.',
  user: 'The user folder: documents, downloads, desktop.',
  app: 'Program Files, AppData: installed apps.',
  game: 'Game libraries; large and re-downloadable.',
  temp: 'Temp, cache, model and package stores. The Safety view shows the effect of deleting.',
  other: 'Unclassified folders.',
};
const TURDESC = {
  video: 'Movies, shows, screen recordings', image: 'Photos and graphics', audio: 'Music, voice recordings', vm: 'Virtual disks (VirtualBox, Hyper-V)',
  iso: 'ISO and install images', arch: 'zip, rar, 7z archives', backup: 'Backups (.bak, .old)', doc: 'PDF and Office documents',
  code: 'Source code and data files', db: 'Database files', exe: 'Executable programs', lib: 'DLL and driver files; do not delete',
  gamefile: "Games' own data files", log: 'Logs and crash dumps; deletable', cache: 'Cache; regenerated if deleted', model: 'Hugging Face, torch, ollama; re-downloaded if deleted',
  devcache: 'node_modules, .gradle etc.; re-downloaded if deleted', update: 'Windows update leftovers', tmp: 'Temporary files', other: 'Unclassified files',
};
let colorMode = 'safe', filt = null, stats = { grp: {}, sub: {}, safe: {} }, sugs = [];
const colorOf = n => (colorMode === 'safe' ? SAFE[n.sf].col : colorMode === 'grp' ? GRP[n.grp].col : n.cat.col);
const matchF = n => !filt || (filt.kind === 'grp' ? n.grp === filt.id : filt.kind === 'safe' ? n.sf === filt.id : !!n.cat && n.cat.id === filt.id);
const tintOf = n => (colorMode === 'safe' ? SAFE[n.sf].col : colorMode === 'grp' ? GRP[n.grp].col : n.tint);

const ease = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const outBack = t => { const c = 1.4; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

let W = 0, H = 0, dpr = 1;
let root = null, focus = null, prevFocus = null;
let view = [0, 0, 1], from = null, to = null, zoomT0 = 0;
let cands = [], drawn = [];
let hovered = null, mouse = { x: 0, y: 0 };
let introT0 = 0, dirty = true, raf = 0, es = null, activeDrive = null;
const hot = new Set();

function resize() {
  const r = cv.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  W = r.width; H = r.height;
  $('key').classList.toggle('hidden', W <= 900);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  invalidate();
}
new ResizeObserver(resize).observe(cv);

function invalidate() { dirty = true; if (!raf) raf = requestAnimationFrame(frame); }

const pathOf = d => {
  const parts = [];
  for (let a = d; a.parent; a = a.parent) if (!a.data.o) parts.push(a.data.n);
  return root.data.n.replace(/\\$/, '') + (parts.length ? '\\' + parts.reverse().join('\\') : '\\');
};
const isDir = d => !!d.children;

function candidates(f) {
  return f.descendants().filter(d => d.depth <= f.depth + 6);
}

function setFocus(d, animate = true) {
  if (!d || d === focus) return;
  prevFocus = focus;
  const merged = new Set([...cands, ...candidates(d)]);
  cands = [...merged].sort((a, b) => a.depth - b.depth);
  focus = d;
  from = view.slice(); to = [d.x, d.y, d.r];
  zoomT0 = performance.now();
  if (!animate) { view = to.slice(); from = null; cands = candidates(d); }
  renderSide(); renderCrumbs();
  invalidate();
}

function build(tree) {
  treeData = tree;
  const h = d3.hierarchy(tree, d => d.c).sum(d => (d.c && d.c.length ? 0 : d.s)).sort((a, b) => b.value - a.value);
  d3.pack().size([1000, 1000]).padding(3)(h);
  h.each(n => { n.dl = Math.min(n.depth, 3) * 0.07 + (((n.x * 7 + n.y * 13) % 97) / 97) * 0.35; n.hv = 0; });
  Classify.annotate(h, { now: Date.now() / 1000 }); // lp, grp, cat, sf, why
  stats = { grp: {}, sub: {}, safe: {} };
  h.each(n => {
    stats.safe[n.sf] = (stats.safe[n.sf] || 0) + (n.children ? 0 : n.value);
    if (!n.cat) return;
    stats.sub[n.cat.id] = (stats.sub[n.cat.id] || 0) + n.value;
    stats.grp[n.grp] = (stats.grp[n.grp] || 0) + n.value;
  });
  h.eachAfter(n => { n.uni = !n.children ? n.sf : n.children.every(c => c.uni === n.sf) ? n.sf : null; });
  h.eachAfter(n => {
    if (!n.children) { n.cb = { [n.cat.id]: n.value }; return; }
    n.cb = {};
    for (const c of n.children) for (const k in c.cb) n.cb[k] = (n.cb[k] || 0) + c.cb[k];
    let best = 'other', bv = -1;
    for (const k in n.cb) if (k !== 'small' && n.cb[k] > bv) { bv = n.cb[k]; best = k; }
    n.tint = CAT[best].col;
  });
  sugs = Classify.suggest(h);
  updateSugBtn();
  root = h; focus = null; prevFocus = null; cands = [];
  view = [h.x, h.y, h.r];
  introT0 = performance.now();
  setFocus(h, false);
  $('empty').classList.add('hidden');
  renderLegend();
}

function renderLegend() {
  const mode = colorMode, st = stats[mode === 'safe' ? 'safe' : mode === 'grp' ? 'grp' : 'sub'], title = { safe: 'Safety scale', grp: 'Importance groups', type: 'File types' }[mode];
  let items;
  if (mode === 'safe') items = Object.entries(SAFE).map(([id, s]) => ({ id, name: s.name, risk: s.risk, col: s.col, desc: s.desc }));
  else if (mode === 'grp') items = Object.entries(GRP).map(([id, g]) => ({ id, name: g.name, col: g.col, desc: GRPDESC[id] }));
  else items = CATS.filter(c => c.id !== 'small' && st[c.id]).sort((x, y) => st[y.id] - st[x.id]).map(c => ({ id: c.id, name: c.name, col: c.col, desc: TURDESC[c.id] || '' }));
  $('key').innerHTML = `<h5>${title}</h5>` + items.map(c => `<button class="kitem${filt && filt.id === c.id ? ' on' : ''}${st[c.id] ? '' : ' zero'}" data-id="${c.id}"><i style="background:${c.col}"></i><span><b>${c.name}${c.risk ? `<span class="rk">${c.risk}</span>` : ''}</b><small>${c.desc}</small></span><em>${st[c.id] ? fmt(st[c.id]) : ''}</em></button>`).join('') +
    '<p>Click a color: filter · double-click: show only that · Esc: clear</p>';
  $('key').querySelectorAll('.kitem').forEach(b => { b.onclick = () => toggleFilter(b.dataset.id); b.ondblclick = () => soloFilter(b.dataset.id); });
  $('legend').innerHTML = '<span style="opacity:.6">click: enter · space / Esc: go up · right-click: menu · Ctrl/Shift: multi-select</span>';
}

function renderCrumbs() {
  const chain = []; for (let a = focus; a; a = a.parent) chain.unshift(a);
  $('crumbs').innerHTML = '';
  chain.forEach((a, i) => {
    const s = document.createElement('span');
    s.textContent = i === 0 ? a.data.n : a.data.n;
    s.onclick = () => setFocus(a);
    $('crumbs').appendChild(s);
  });
}

// ---- side panel: multi-select, category filter, suggestions ----
let sel = new Set(), anchor = -1, sideNodes = [], sideTab = 'dirs';
const CF = { safe: 'Safe', cost: 'Re-downloadable', check: 'Review first' };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
// The "If deleted:" label is not repeated when the sentence already states the effect of deleting.
const effOf = w => (/delet/i.test(w) ? w : 'If deleted: ' + w);
function bigFiles() {
  const out = [];
  root.each(n => { if (!n.children && !n.data.o) out.push(n); });
  return out.sort((a, b) => b.value - a.value).slice(0, 30);
}
// Topmost nodes in the selected category (importance: folders, type: files).
function filterNodes() {
  const out = [], f = filt, key = f.kind === 'grp' ? n => n.grp : f.kind === 'safe' ? n => n.uni : null;
  (function w(n) {
    if (n.data.o) return;
    if (key) { if (n.parent && key(n) === f.id && (key(n.parent) !== f.id || !n.parent.parent)) { out.push(n); return; } }
    else if (!n.children && n.cat && n.cat.id === f.id) { out.push(n); return; }
    (n.children || []).forEach(w);
  })(root);
  return out.sort((x, y) => y.value - x.value).slice(0, 40);
}
// Double-click: only the selected category's files, in re-packed bubbles.
let fullTree = null;
function soloTree() {
  const keep = n => {
    if (n.data.o) return null;
    if (!n.children) return matchF(n) ? { n: n.data.n, s: n.data.s } : null;
    const c = n.children.map(keep).filter(Boolean);
    return c.length ? { n: n.data.n, s: c.reduce((t, x) => t + x.s, 0), c } : null;
  };
  return keep(root);
}
function exitSolo() {
  if (!fullTree) return;
  const t = fullTree; fullTree = null; build(t);
}
function soloFilter(id) {
  if (fullTree) exitSolo();
  const kind = colorMode === 'grp' ? 'grp' : colorMode === 'safe' ? 'safe' : 'sub';
  filt = { kind, id };
  const t = soloTree();
  if (!t) { filt = null; return toast('No files in this category'); }
  const keepStats = stats, full = treeData;
  fullTree = full; sel = new Set(); anchor = -1;
  build(t);
  stats = keepStats; filt = { kind, id };
  renderLegend(); renderSide(); invalidate();
  toast('Showing only this category · Esc: go back');
}
function toggleFilter(id) {
  if (fullTree) { exitSolo(); filt = null; renderLegend(); renderSide(); invalidate(); return; }
  const kind = colorMode === 'grp' ? 'grp' : colorMode === 'safe' ? 'safe' : 'sub';
  filt = filt && filt.id === id && filt.kind === kind ? null : { kind, id };
  sel = new Set(); anchor = -1;
  renderLegend(); renderSide(); invalidate();
}
function clearFilter() { if (fullTree) exitSolo(); filt = null; renderLegend(); renderSide(); invalidate(); }
function paintSel() {
  document.querySelectorAll('#list li').forEach((li, i) => li.classList.toggle('sel', sel.has(sideNodes[i])));
  const n = sel.size;
  $('selbar').classList.toggle('on', n > 0);
  if (n) $('selInfo').textContent = n + ' selected · ' + fmt(sumOf(topOnly([...sel])));
}
function selSafe() {
  sel = new Set(sugs.filter(s => s.conf === 'safe').map(s => s.n)); anchor = 0; paintSel();
}
function rowClick(ev, c, i) {
  if (ev.shiftKey && anchor >= 0) {
    const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
    if (!(ev.ctrlKey || ev.metaKey)) sel = new Set();
    for (let k = a; k <= b; k++) if (!sideNodes[k].data.o) sel.add(sideNodes[k]);
  } else if (ev.ctrlKey || ev.metaKey) {
    sel.has(c) ? sel.delete(c) : sel.add(c);
    anchor = i;
  } else { sel = new Set([c]); anchor = i; }
  paintSel();
}
function mkRow(ul, c, i, html) {
  const li = document.createElement('li');
  li.style.animationDelay = Math.min(i, 20) * 18 + 'ms';
  li.innerHTML = html;
  li.title = pathOf(c);
  li.onmouseenter = () => { hovered = c; hot.add(c); invalidate(); showTip(c, null); };
  li.onmouseleave = () => { hovered = null; invalidate(); hideTip(); };
  li.onclick = ev => rowClick(ev, c, i);
  li.ondblclick = () => { sel = new Set(); paintSel(); isDir(c) ? setFocus(c) : c.parent && setFocus(c.parent); };
  li.oncontextmenu = ev => {
    ev.preventDefault(); hideTip();
    if (!sel.has(c)) { sel = new Set([c]); anchor = i; paintSel(); }
    showMenu([...sel], ev);
  };
  ul.appendChild(li);
  return li;
}
const grpSub = c => {
  const g = GRP[c.grp];
  return `<i style="background:${g.col}"></i>${g.name}${c.cat ? ' · ' + c.cat.name : ''}${c.sf === 'safe' || c.sf === 'cost' ? ' · ' + SAFE[c.sf].name.toLowerCase() : ''}`;
};
function renderRows(nodes, title, subFn) {
  $('sideTitle').textContent = title;
  const ul = $('list'); ul.innerHTML = '';
  sideNodes = nodes;
  sel = new Set([...sel].filter(n => nodes.includes(n)));
  nodes.forEach((c, i) => {
    const li = mkRow(ul, c, i, `<div class="row"><span class="nm"></span><span class="sz">${fmt(c.value)}</span></div><div class="sub">${subFn(c, i)}</div>`);
    li.querySelector('.nm').textContent = c.data.n;
  });
  paintSel();
}
function renderSug() {
  const t = Classify.sugTotals(sugs);
  renderRows(sugs.map(s => s.n), 'Cleanup suggestions', (c, i) => `<b class="cf cf-${sugs[i].conf}">${CF[sugs[i].conf]}</b> ${esc(sugs[i].why)}`);
  $('tools').innerHTML = sugs.length
    ? `<span>Safe: ${t.nSafe} items · ${fmt(t.safe)} · Re-downloadable: ${fmt(t.cost)}</span><button onclick="selSafe()">Select safe</button>`
    : '<span>No items suggested for deletion.</span>';
}
// ---- Drivers tab: old / unused driver packages ----
let drv = null, drvSel = new Set();
async function loadDrivers() {
  $('sideTitle').textContent = 'Unneeded drivers';
  $('list').innerHTML = '<li class="drvmsg">Analyzing driver packages…</li>';
  sideNodes = []; paintSel();
  let r; try { r = await native.drivers(); } catch (e) { r = { error: String(e) }; }
  if (sideTab !== 'drv') return;
  drv = r; renderDrv();
}
function drvTools() {
  const it = drv && drv.items || [], safe = it.filter(d => d.conf === 'safe'), chosen = it.filter(d => drvSel.has(d.pub));
  $('tools').innerHTML = `<span>${safe.length} safe · ${fmt(safe.reduce((s, d) => s + d.size, 0))}</span>` +
    `<button onclick="drvSafe()">Select safe</button>` +
    `<button class="danger" onclick="drvRemove()">Remove${chosen.length ? ` (${chosen.length} · ${fmt(chosen.reduce((s, d) => s + d.size, 0))})` : ''}</button>`;
}
function renderDrv() {
  const ul = $('list'); ul.innerHTML = '';
  $('tools').innerHTML = ''; sideNodes = []; paintSel();
  $('sideTitle').textContent = 'Unneeded drivers';
  if (!drv || drv.error) { $('tools').innerHTML = `<span>${(drv && drv.error) || 'Error'}</span>`; return; }
  if (!drv.items.length) { $('tools').innerHTML = '<span>No unneeded drivers found.</span>'; return; }
  drvTools();
  drv.items.forEach((d, i) => {
    const li = document.createElement('li');
    li.style.animationDelay = Math.min(i, 20) * 18 + 'ms';
    li.classList.toggle('sel', drvSel.has(d.pub));
    li.innerHTML = '<div class="row"><span class="nm"></span><span class="sz"></span></div><div class="sub"></div>';
    li.querySelector('.nm').textContent = d.orig;
    li.querySelector('.sz').textContent = d.size ? fmt(d.size) : '—';
    li.querySelector('.sub').innerHTML = `<b class="cf cf-${d.conf}">${CF[d.conf]}</b>`;
    li.querySelector('.sub').append(document.createTextNode(`${d.provider} · ${d.cls} · ${d.ver} — ${d.why}`));
    li.title = d.pub + (d.folder ? ' · ' + d.folder : '');
    li.onclick = () => { drvSel.has(d.pub) ? drvSel.delete(d.pub) : drvSel.add(d.pub); li.classList.toggle('sel'); drvTools(); };
    ul.appendChild(li);
  });
}
function drvSafe() { drvSel = new Set(drv.items.filter(d => d.conf === 'safe').map(d => d.pub)); renderDrv(); }
async function drvRemove() {
  const list = drv.items.filter(d => drvSel.has(d.pub));
  if (!list.length) return toast('Select drivers first');
  const total = list.reduce((s, d) => s + d.size, 0);
  const yes = await confirmBox(`Remove ${list.length} driver packages?`, 'Total ' + fmt(total),
    list.slice(0, 4).map(d => d.orig + ' · ' + d.ver).join('\n') + (list.length > 4 ? `\nand ${list.length - 4} more packages` : ''),
    "Packages are removed from the Driver Store with Windows' own tool (pnputil). Windows won't remove a package that is in use.");
  if (!yes) return toast('Cancelled');
  const ok = [], fail = [];
  for (let i = 0; i < list.length; i++) {
    toast(`Removing ${i + 1}/${list.length}: ${list[i].orig}…`, false, true);
    const r = await native.driverRemove(list[i].pub);
    r.ok ? ok.push(list[i]) : fail.push(r.error);
  }
  drv.items = drv.items.filter(d => !ok.includes(d)); ok.forEach(d => drvSel.delete(d.pub));
  renderDrv();
  if (ok.length) setTimeout(refreshDrives, 600);
  if (fail.length) toast(`${ok.length} packages removed, ${fail.length} could not be removed: ${fail[0]}`, true);
  else toast(`${ok.length} driver packages removed · ${fmt(ok.reduce((s, d) => s + d.size, 0))}`);
}

// ---- "Suggested deletions" dialog: detailed list, show in Explorer, bulk permanent delete ----
let dlgSel = new Set();
const dlgOpen = () => $('sugdlg').classList.contains('on');
// The row's muted second line only says how the item is removed; the consequence sentence appears once, in .sdwhy.
const HOW = {
  trash: 'Moved to the Recycle Bin; can be restored until the bin is emptied.',
  remove: 'Deleted permanently; does not go to the Recycle Bin.',
};
// Badge: safe and re-downloadable are totalled separately; items to review appear only in the tooltip.
function updateSugBtn() {
  const t = Classify.sugTotals(sugs), b = $('sugBtn');
  b.hidden = !sugs.length;
  b.innerHTML = 'Suggested deletions <em>Safe ' + fmt(t.safe) + ' · Re-downloadable ' + fmt(t.cost) + '</em>';
  b.title = t.nSafe + ' safe items · ' + t.nCost + ' re-downloadable items' + (t.nCheck ? ' · ' + t.nCheck + ' to review (' + fmt(t.check) + ')' : '');
}
// Delete method in the suggestions dialog: safe items are deleted permanently, re-downloadable and above go to the Recycle Bin.
const sugKind = n => (n.sf === 'safe' ? 'remove' : 'trash');
function openSugDlg() {
  if (!sugs.length) return toast('Nothing suggested for deletion');
  dlgSel = new Set(); renderSugDlg(); $('sugdlg').classList.add('on');
}
function closeSugDlg() { $('sugdlg').classList.remove('on'); }
function dlgFoot() {
  const ch = sugs.filter(s => dlgSel.has(s.n));
  $('sdInfo').textContent = ch.length ? ch.length + ' selected · ' + fmt(sumOf(ch.map(s => s.n))) : 'Check the items you want to delete';
  const ks = new Set(ch.map(s => sugKind(s.n)));
  $('sdDel').textContent = (!ks.size || (ks.size === 1 && ks.has('remove')) ? 'Delete permanently' : ks.size === 1 ? 'Move to Recycle Bin' : 'Delete') + (ch.length ? ' (' + ch.length + ')' : '');
  $('sdDel').disabled = !ch.length;
}
function renderSugDlg() {
  const ul = $('sdList'); ul.innerHTML = '';
  const t = Classify.sugTotals(sugs);
  $('sdSub').textContent = sugs.length + ' suggestions · Safe ' + t.nSafe + ' · ' + fmt(t.safe) + ' · Re-downloadable ' + t.nCost + ' · ' + fmt(t.cost) + (t.nCheck ? ' · Review first ' + t.nCheck + ' · ' + fmt(t.check) : '');
  sugs.forEach(s => {
    const n = s.n, g = GRP[n.grp], li = document.createElement('li');
    li.className = 'sdrow' + (dlgSel.has(n) ? ' sel' : '');
    li.innerHTML = '<input type="checkbox" tabindex="-1"><div class="sdmain"><div class="sdtop"><b></b><span class="sdsz"></span></div>' +
      '<div class="sdpath"></div><div class="sdbadges"></div><div class="sdwhy"></div><div class="sdeff"></div></div><button class="sdrev">Show in Explorer</button>';
    li.querySelector('b').textContent = n.data.n + (isDir(n) ? ' (folder)' : '');
    li.querySelector('.sdsz').textContent = fmt(n.value);
    li.querySelector('.sdpath').textContent = pathOf(n);
    li.querySelector('.sdbadges').innerHTML = '<span class="cf cf-' + s.conf + '">' + SAFE[n.sf].name + ' · ' + SAFE[n.sf].risk + '</span>' +
      '<span class="sdtag"><i style="background:' + g.col + '"></i>' + g.name + (n.cat ? ' · ' + n.cat.name : '') + '</span>' +
      (n.data.m ? '<span class="sdtag">' + ageText(n.data.m, Date.now() / 1000) + '</span>' : '');
    li.querySelector('.sdwhy').textContent = s.why;
    li.querySelector('.sdeff').textContent = HOW[sugKind(n)];
    const cb = li.querySelector('input'); cb.checked = dlgSel.has(n);
    const flip = () => { dlgSel.has(n) ? dlgSel.delete(n) : dlgSel.add(n); cb.checked = dlgSel.has(n); li.classList.toggle('sel', dlgSel.has(n)); dlgFoot(); };
    li.onclick = e => { if (!e.target.closest('.sdrev') && e.target !== cb) flip(); };
    cb.onchange = () => { dlgSel.has(n) !== cb.checked && flip(); };
    li.querySelector('.sdrev').onclick = () => native.reveal(pathOf(n));
    ul.appendChild(li);
  });
  dlgFoot();
}
function dlgPick(fn) { dlgSel = new Set(sugs.filter(fn).map(s => s.n)); renderSugDlg(); }
async function dlgDelete() {
  const list = sugs.filter(s => dlgSel.has(s.n)).map(s => s.n);
  if (!list.length) return;
  closeSugDlg();
  await doRemove(list, sugKind);
  if (!removing && sugs.length) openSugDlg();
}
addEventListener('keydown', e => {
  if (e.key === 'Escape' && dlgOpen() && !$('modal').classList.contains('on')) { e.stopImmediatePropagation(); closeSugDlg(); }
}, true);
$('sugBtn').onclick = openSugDlg;
$('sdClose').onclick = closeSugDlg;
$('sdSafe').onclick = () => dlgPick(s => s.conf === 'safe');
$('sdAll').onclick = () => dlgPick(() => true);
$('sdNone').onclick = () => dlgPick(() => false);
$('sdDel').onclick = dlgDelete;
$('sugdlg').onmousedown = e => { if (e.target === $('sugdlg')) closeSugDlg(); };

function setTab(t) {
  sideTab = t; filt = null; sel = new Set(); anchor = -1;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  renderLegend(); renderSide(); invalidate();
}
function setMode(m) {
  colorMode = m; filt = null;
  document.querySelectorAll('#mode button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  renderLegend(); renderSide(); invalidate();
}
function renderSide() {
  $('tools').innerHTML = '';
  if (filt) {
    const nm = (filt.kind === 'grp' ? GRP : filt.kind === 'safe' ? SAFE : CAT)[filt.id].name;
    return renderRows(filterNodes(), nm + ' · ' + fmt(stats[filt.kind][filt.id] || 0), grpSub);
  }
  if (sideTab === 'big') return renderRows(bigFiles(), 'Largest files', grpSub);
  if (sideTab === 'sug') return renderSug();
  if (sideTab === 'drv') return drv ? renderDrv() : loadDrivers();
  $('sideTitle').textContent = focus.data.n + ' · ' + fmt(focus.value);
  const ul = $('list'); ul.innerHTML = '';
  sideNodes = (focus.children || []).slice(0, 18);
  sel = new Set([...sel].filter(n => sideNodes.includes(n)));
  sideNodes.forEach((c, i) => {
    const col = c.children ? tintOf(c) : colorOf(c);
    const li = mkRow(ul, c, i, `<div class="fill" style="width:${(c.value / focus.value * 100).toFixed(1)}%;background:${col}"></div>` +
      `<div class="row"><span class="nm"></span><span class="sz">${fmt(c.value)}</span></div>`);
    li.querySelector('.nm').textContent = c.data.n;
  });
  paintSel();
}

function showTip(d, e) {
  const t = $('tip');
  const pct = d.parent ? (d.value / d.parent.value * 100).toLocaleString('en-US', { maximumFractionDigits: 1 }) + '% of parent folder' : '';
  t.innerHTML = `<b>${d.data.n.replace(/</g, '&lt;')}</b><em>${fmt(d.value)}</em> ${pct ? '· ' + pct : ''}` +
    `<small class="grp"><i style="background:${GRP[d.grp].col}"></i>${GRP[d.grp].name} · ${GRP[d.grp].tag}</small>` +
    `<small class="grp"><i style="background:${SAFE[d.sf].col}"></i>${SAFE[d.sf].name} · ${SAFE[d.sf].risk}</small>` +
    (d.why && d.sf !== 'never' ? `<small>${esc(effOf(d.why))}</small>` : '') +
    (d.data.m ? `<small>Last modified: ${ageText(d.data.m, Date.now() / 1000)}</small>` : '') +
    (isDir(d) ? `<small>${d.children.length} items</small>` : '') + `<small>${pathOf(d).replace(/</g, '&lt;')}</small>`;
  t.classList.add('on');
  if (e) placeTip(e);
}
function placeTip(e) {
  const t = $('tip'), r = $('stage').getBoundingClientRect();
  let x = e.clientX - r.left + 16, y = e.clientY - r.top + 16;
  if (x + t.offsetWidth > r.width - 8) x = e.clientX - r.left - t.offsetWidth - 16;
  if (y + t.offsetHeight > r.height - 8) y = e.clientY - r.top - t.offsetHeight - 16;
  t.style.left = x + 'px'; t.style.top = y + 'px';
}
const hideTip = () => $('tip').classList.remove('on');

function fit(text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 1, hi = text.length;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; ctx.measureText(text.slice(0, m) + '…').width <= maxW ? (lo = m) : (hi = m - 1); }
  return lo > 1 ? text.slice(0, lo) + '…' : '';
}

function frame(now) {
  raf = 0;
  let busy = false;
  if (to && from) {
    const t = clamp((now - zoomT0) / 560);
    const e = ease(t);
    view = [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e,
      Math.exp(Math.log(from[2]) + (Math.log(to[2]) - Math.log(from[2])) * e)];
    if (t >= 1) { from = null; cands = candidates(focus); } else busy = true;
  }
  const introT = root ? (now - introT0) / 1100 : 2;
  if (introT < 1.9) busy = true;
  for (const d of hot) {
    d.hv += ((d === hovered ? 1 : 0) - d.hv) * 0.22;
    if (d !== hovered && d.hv < 0.01) { d.hv = 0; hot.delete(d); } else if (Math.abs((d === hovered ? 1 : 0) - d.hv) > 0.01) busy = true;
  }
  draw(introT);
  if (busy || dirty) { dirty = false; if (busy) raf = requestAnimationFrame(frame); }
}

function draw(introT) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  drawn = [];
  if (!root) return;
  const kw = W > 900 ? 252 : 0, k = Math.min(W - kw, H) / 2 / view[2] * 0.9, cx = (W - kw) / 2, cy = H / 2 + 8;
  const fd = focus.depth;
  const labels = [];
  for (const d of cands) {
    const sr0 = d.r * k;
    if (sr0 < 1.2) continue;
    const x = (d.x - view[0]) * k + cx, y = (d.y - view[1]) * k + cy;
    if (x + sr0 < 0 || x - sr0 > W || y + sr0 < 0 || y - sr0 > H) continue;
    let sc = 1;
    if (introT < 1.9) { sc = outBack(clamp((introT * 1.6 - d.dl) / 0.7)); if (sc <= 0) continue; }
    const r = sr0 * sc;
    const rel = d.depth - fd;
    const dir = isDir(d);
    const lod = clamp((sr0 - 2) / 14);
    drawn.push({ d, x, y, r });
    if (dir) {
      const hv = d.hv;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832);
      ctx.fillStyle = rgba(tintOf(d), (0.05 + 0.008 * Math.max(rel, 0) + 0.06 * hv) * lod);
      ctx.fill();
      ctx.lineWidth = 1 + hv;
      ctx.strokeStyle = rgba(tintOf(d), (0.28 + 0.6 * hv) * lod);
      ctx.stroke();
      if (sr0 > 54 && (rel === 1 || (rel === 2 && d.r < d.parent.r * 0.85))) labels.push({ d, x, y, r, dir: 1, a: clamp((sr0 - 54) / 30) });
    } else {
      const col = colorOf(d), hv = d.hv;
      const rr = r * (1 + 0.035 * hv);
      ctx.globalAlpha = lod * (matchF(d) ? 1 : 0.08);
      if (rr > 14) {
        const g = ctx.createRadialGradient(x - rr * .3, y - rr * .35, rr * .1, x, y, rr);
        g.addColorStop(0, rgba(col, 1)); g.addColorStop(1, rgba(col, .62));
        ctx.fillStyle = g;
      } else ctx.fillStyle = rgba(col, .85);
      ctx.beginPath(); ctx.arc(x, y, Math.max(rr - 0.6, 0.5), 0, 6.2832); ctx.fill();
      if (hv > 0.02) { ctx.lineWidth = 2; ctx.strokeStyle = `rgba(255,255,255,${0.85 * hv})`; ctx.stroke(); }
      ctx.globalAlpha = 1;
      if (sr0 > 30 && matchF(d)) labels.push({ d, x, y, r, dir: 0, a: clamp((sr0 - 30) / 20) });
    }
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (const l of labels) {
    ctx.globalAlpha = l.a;
    if (l.dir) {
      ctx.font = '600 12px "Segoe UI Variable Text","Segoe UI",sans-serif';
      const s = fit(l.d.data.n, l.r * 1.5);
      if (!s) continue;
      const ty = l.y - l.r + 15;
      ctx.lineWidth = 4; ctx.strokeStyle = BG; ctx.strokeText(s, l.x, ty);
      ctx.fillStyle = 'rgba(232,234,240,.92)'; ctx.fillText(s, l.x, ty);
    } else {
      ctx.font = '600 12px "Segoe UI Variable Text","Segoe UI",sans-serif';
      const s = fit(l.d.data.n, l.r * 1.65);
      if (!s) continue;
      ctx.fillStyle = 'rgba(12,13,17,.88)';
      ctx.fillText(s, l.x, l.y - (l.r > 44 ? 6 : 0));
      if (l.r > 44) { ctx.font = '11px "Segoe UI Variable Text","Segoe UI",sans-serif'; ctx.fillStyle = 'rgba(12,13,17,.6)'; ctx.fillText(fmt(l.d.value), l.x, l.y + 9); }
    }
  }
  ctx.globalAlpha = 1;
}

function pick(mx, my) {
  for (let i = drawn.length - 1; i >= 0; i--) {
    const n = drawn[i];
    if (n.r > 2.5 && Math.hypot(mx - n.x, my - n.y) <= n.r) return n.d;
  }
  return null;
}

cv.addEventListener('mousemove', e => {
  const r = cv.getBoundingClientRect();
  mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
  if (from) return;
  const h = pick(mouse.x, mouse.y);
  if (h !== hovered) {
    if (hovered) hot.add(hovered);
    hovered = h; if (h) hot.add(h);
    cv.style.cursor = h && isDir(h) && h !== focus ? 'pointer' : 'default';
    h ? showTip(h, e) : hideTip();
    invalidate();
  } else if (h) placeTip(e);
});
cv.addEventListener('mouseleave', () => { if (hovered) hot.add(hovered); hovered = null; hideTip(); invalidate(); });
cv.addEventListener('click', () => {
  if (!root || from) return;
  const h = hovered;
  if (h && isDir(h) && h !== focus) setFocus(h);
  else if (!h || h === focus) focus.parent && setFocus(focus.parent);
});
// ---- right-click menu ----
let treeData = null;
const topOnly = list => list.filter(n => !list.some(o => o !== n && n.ancestors().includes(o)));
const sumOf = list => list.reduce((s, n) => s + n.value, 0);

function removeNodes(list) {
  const names = [];
  for (let a = focus; a.parent; a = a.parent) names.unshift(a.data.n);
  for (const d of list) {
    const pd = d.parent.data;
    pd.c.splice(pd.c.indexOf(d.data), 1);
    for (let a = d.parent; a; a = a.parent) a.data.s -= d.value;
    if (fullTree) { // also remove from the full tree
      const nm = []; for (let a = d; a.parent; a = a.parent) nm.unshift(a.data.n);
      let p = fullTree; const chain = [p];
      for (let i = 0; i < nm.length - 1 && p; i++) { p = (p.c || []).find(x => x.n === nm[i]); if (p) chain.push(p); }
      if (p && p.c) { const k = p.c.findIndex(x => x.n === nm[nm.length - 1]); if (k >= 0) { p.c.splice(k, 1); chain.forEach(x => { x.s -= d.value; }); } }
    }
  }
  sel = new Set(); anchor = -1;
  build(treeData);
  introT0 = -1e9;
  let f = root;
  for (const n of names) { const c = (f.children || []).find(x => x.data.n === n); if (!c) break; f = c; }
  setFocus(f, false);
}

let toastT = 0;
function toast(msg, bad, sticky) {
  const t = $('toast');
  t.textContent = msg; t.className = 'on' + (bad ? ' bad' : '');
  clearTimeout(toastT);
  if (!sticky) toastT = setTimeout(() => (t.className = ''), bad ? 9000 : 3500);
}
async function refreshDrives() {
  const ds = await native.drives();
  document.querySelectorAll('.drive').forEach(el => {
    const d = ds.find(x => x.path === el.dataset.p);
    if (!d) return;
    el.querySelector('small').textContent = fmt(d.free) + ' free / ' + fmt(d.total);
    el.querySelector('span').style.width = ((d.total - d.free) / d.total * 100) + '%';
  });
}

function confirmDelete(list, kindOf) {
  const one = list.length === 1, ks = new Set(list.map(kindOf)), mixed = ks.size > 1, tr = !ks.has('remove');
  // On re-downloadable and higher tiers the "if deleted" sentence shows in the confirmation.
  const costly = list.filter(n => n.sf !== 'safe' && n.why);
  const eff = costly.length ? costly.slice(0, 3).map(n => (one ? '' : n.data.n + ': ') + effOf(n.why)).join(' · ') + (costly.length > 3 ? ` (+${costly.length - 3} more items)` : '') + ' ' : '';
  return confirmBox(mixed ? `Delete ${list.length} items?` : tr ? (one ? 'Move to Recycle Bin?' : `Move ${list.length} items to Recycle Bin?`) : one ? 'Delete permanently?' : `Delete ${list.length} items permanently?`,
    one ? list[0].data.n + ' · ' + fmt(list[0].value) + (isDir(list[0]) ? ' · folder' : '') : 'Total ' + fmt(sumOf(list)),
    one ? pathOf(list[0]) : list.slice(0, 4).map(n => n.data.n + ' · ' + fmt(n.value)).join('\n') + (list.length > 4 ? `\nand ${list.length - 4} more items` : ''),
    eff + (mixed ? 'Safe items are deleted permanently; the others are moved to the Recycle Bin.' : tr ? 'It can be restored from the Recycle Bin; disk space is freed when the bin is emptied.' : 'This item will not go to the Recycle Bin and cannot be restored.'),
    mixed ? 'Delete' : tr ? 'Move to Recycle Bin' : 'Delete permanently');
}
function confirmBox(title, name, detail, note, yes) {
  return new Promise(res => {
    const m = $('modal');
    $('mTitle').textContent = title; $('mName').textContent = name; $('mPath').textContent = detail; $('mNote').textContent = note;
    $('mYes').textContent = yes || 'Delete permanently';
    m.classList.add('on');
    $('mNo').focus();
    const done = v => { m.classList.remove('on'); removeEventListener('keydown', key, true); res(v); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } };
    addEventListener('keydown', key, true);
    $('mNo').onclick = () => done(false);
    $('mYes').onclick = () => done(true);
    m.onmousedown = e => { if (e.target === m) done(false); };
  });
}

let removing = false, rq = [], rqCancel = false, pq = null, progRaf = 0;
// Delete queue: new deletions are queued while one runs; ✕ really stops the running operation and clears the queue.
function progEl() {
  let p = $('prog');
  if (!p) {
    p = document.createElement('div'); p.id = 'prog';
    p.innerHTML = '<div class="pt"><span class="pdot"></span><b></b><em></em><button class="px" title="Cancel" aria-label="Cancel">✕</button></div><div class="pn"></div><div class="pq"></div><div class="pbar"><i></i></div>';
    document.body.appendChild(p);
    p.querySelector('.px').onclick = () => {
      if (!removing) return;
      rqCancel = true; rq.length = 0;
      p.querySelector('b').textContent = 'Cancelling…';
      native.cancelRemove();
    };
  }
  return p;
}
function progDraw() {
  const p = progEl(), q = pq;
  if (!q) return;
  if (!rqCancel) p.querySelector('b').textContent = (q.kind === 'trash' ? 'Moving to Recycle Bin' : 'Deleting') + ' ' + (q.done + 1) + '/' + q.total;
  p.querySelector('.pn').textContent = q.cur.data.n + ' · ' + fmt(q.cur.value);
  p.querySelector('.pq').textContent = rq.length ? 'Queued: ' + rq.length + ' items · ' + rq.slice(0, 2).map(x => x.n.data.n).join(', ') + (rq.length > 2 ? '…' : '') : '';
  p.classList.add('on');
}
function progStart() {
  cancelAnimationFrame(progRaf);
  const tick = () => {
    const q = pq; if (!q) return;
    const part = 1 - Math.exp(-(performance.now() - q.t0) / 4000); // approaches 90% as time goes on
    const f = Math.min(0.97, (q.bytesDone + q.cur.value * 0.9 * part) / (q.bytesTotal || 1));
    const p = $('prog'); p.querySelector('i').style.width = (f * 100).toFixed(1) + '%';
    p.querySelector('em').textContent = Math.round(f * 100) + '%';
    progRaf = requestAnimationFrame(tick);
  };
  tick();
}
function progHide() { cancelAnimationFrame(progRaf); const p = $('prog'); if (p) p.classList.remove('on'); }
// kind: 'trash' | 'remove', or a function that picks it per node (suggestions dialog).
async function doRemove(nodes, kind) {
  const kindOf = typeof kind === 'function' ? kind : () => kind;
  const busy = new Set([...rq.map(x => x.n), ...(pq ? [pq.cur] : [])]);
  const list = topOnly(nodes.filter(n => n.parent && !n.data.o && !busy.has(n)));
  if (!list.length) return;
  if (!(await confirmDelete(list, kindOf))) return toast('Cancelled');
  list.forEach(n => rq.push({ n, kind: kindOf(n) }));
  if (removing) {
    if (pq) { pq.total += list.length; pq.bytesTotal += sumOf(list); progDraw(); }
    return toast(list.length + ' items queued');
  }
  await runQueue();
}
async function runQueue() {
  removing = true; rqCancel = false;
  const ok = [], fail = [], kinds = new Set();
  let kind = rq[0].kind;
  pq = { done: 0, total: rq.length, bytesDone: 0, bytesTotal: sumOf(rq.map(x => x.n)), cur: null, kind, t0: 0 };
  while (rq.length) {
    const it = rq.shift(); kind = it.kind;
    pq.cur = it.n; pq.kind = kind; pq.t0 = performance.now();
    progDraw(); progStart();
    let r;
    try { r = await native[kind](pathOf(it.n)); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
    if (rqCancel && !r.ok) { fail.push(r.error || 'cancelled'); break; }
    r.ok ? (ok.push(it.n), kinds.add(kind)) : fail.push(r.error || 'could not delete');
    pq.done++; pq.bytesDone += it.n.value;
    if (rqCancel) break;
  }
  const cancelled = rqCancel;
  removing = false; rqCancel = false; rq = []; pq = null; progHide();
  const top = topOnly(ok);
  if (top.length) { removeNodes(top); setTimeout(refreshDrives, 600); }
  const size = fmt(sumOf(top)), what = kinds.size > 1 ? 'removed (safe items permanently deleted, the others moved to the Recycle Bin)' : (kinds.has('trash') || (!kinds.size && kind === 'trash')) ? 'moved to Recycle Bin' : 'permanently deleted';
  if (cancelled) return toast(`Cancelled: ${ok.length} items ${what} (${size}); the rest was left untouched`, true);
  if (!fail.length) toast(`${ok.length} items ${what} · ${size}` + (kinds.has('trash') ? ' (space is freed when the bin is emptied)' : ' freed'));
  else {
    toast(`${ok.length} items ${what}, ${fail.length} items could not be deleted: ${fail[0]}`, true);
    if (fail.some(m => /admin rights/.test(m)) && await confirmBox('Admin rights required', 'These files are in a protected folder (e.g. Program Files).', 'Relaunch the app as administrator to delete them. Windows will ask for permission once.', 'Relaunch as administrator now?')) native.relaunchAdmin();
  }
}

function showMenu(nodes, e) {
  const list = topOnly(nodes.filter(n => n.parent && !n.data.o));
  if (!list.length) return;
  const m = $('menu');
  const items = [];
  if (list.length === 1) items.push(['Show in Explorer', () => native.reveal(pathOf(list[0]))]);
  items.push(['Move to Recycle Bin', () => doRemove(list, 'trash')]);
  items.push(['Delete permanently…', () => doRemove(list, 'remove'), 'danger']);
  m.innerHTML = '<div class="mh"><b></b><span></span></div>';
  m.querySelector('b').textContent = list.length === 1 ? list[0].data.n : list.length + ' items selected';
  m.querySelector('span').textContent = fmt(sumOf(list));
  items.forEach(([t, fn, cls]) => {
    const b = document.createElement('button');
    b.textContent = t;
    if (cls) b.className = cls;
    b.onclick = () => { hideMenu(); fn(); };
    m.appendChild(b);
  });
  m.classList.add('on');
  m.style.left = Math.max(8, Math.min(e.clientX, innerWidth - m.offsetWidth - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(e.clientY, innerHeight - m.offsetHeight - 8)) + 'px';
}
const hideMenu = () => $('menu').classList.remove('on');
addEventListener('mousedown', e => { if (!e.target.closest('#menu')) hideMenu(); });
addEventListener('blur', hideMenu);

cv.addEventListener('contextmenu', e => {
  e.preventDefault();
  hideTip();
  if (hovered && !hovered.data.o && hovered.parent) showMenu([hovered], e);
});
addEventListener('keydown', e => {
  if ($('modal').classList.contains('on') || dlgOpen() || !root) return;
  const k = e.key;
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'a') { e.preventDefault(); sel = new Set(sideNodes.filter(n => !n.data.o)); anchor = 0; paintSel(); return; }
  if (k === 'Delete' && sel.size) { e.preventDefault(); doRemove([...sel], e.shiftKey ? 'remove' : 'trash'); return; }
  if (k === 'Escape' && sel.size) { sel = new Set(); anchor = -1; paintSel(); return; }
  if (k === 'Escape' && filt) { clearFilter(); return; }
  if ((k === 'Escape' || k === 'Backspace' || k === ' ') && focus && focus.parent && !from) { e.preventDefault(); setFocus(focus.parent); }
});

// ---- scanning ----
let shown = 0, target = 0, counterRaf = 0;
function countTo(n) {
  target = n;
  if (counterRaf) return;
  const step = () => {
    shown += (target - shown) * 0.2;
    if (Math.abs(target - shown) < 1) shown = target;
    $('scanNum').textContent = Math.round(shown).toLocaleString('en-US');
    counterRaf = shown === target ? 0 : requestAnimationFrame(step);
  };
  counterRaf = requestAnimationFrame(step);
}

let scanT0 = 0, scanExp = 0, scanLast = 0, scanTimer = 0;
const fmtT = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
function scanTick() {
  const s = (performance.now() - scanT0) / 1000;
  $('sTime').textContent = fmtT(s);
  $('sSpd').textContent = s > 1 ? Math.round(scanLast / s).toLocaleString('en-US') + ' files/s' : '';
  if (scanExp) {
    const f = Math.min(0.98, scanLast / scanExp);
    orb.set(f);
    $('sbar').classList.remove('ind'); $('sbar').firstChild.style.transform = 'scaleX(' + f.toFixed(3) + ')'; $('sPct').textContent = Math.round(f * 100) + '%';
  } else { orb.set(null); $('sbar').classList.add('ind'); $('sPct').textContent = ''; }
}
async function startScan(p) {
  shown = target = 0; scanLast = 0; scanT0 = performance.now();
  try { scanExp = +localStorage.getItem('hb-files-' + p) || 0; } catch { scanExp = 0; }
  $('sbar').firstChild.style.transform = 'scaleX(0)';
  clearInterval(scanTimer); scanTimer = setInterval(scanTick, 200); scanTick();
  $('picker').classList.add('hidden'); orb.start();
  $('scanNum').textContent = '0';
  $('scanPath').textContent = tailPath(p);
  $('scan').classList.remove('hidden'); $('empty').classList.add('hidden');
  $('stats').textContent = '';
  const r = await native.scan(p);
  clearInterval(scanTimer);
  if (!r) { orb.stop(); return; }
  if (r.error) { orb.stop(); $('scan').classList.add('hidden'); $('stats').textContent = r.error; return; }
  try { localStorage.setItem('hb-files-' + p, r.files); } catch {}
  $('sbar').classList.remove('ind'); $('sbar').firstChild.style.transform = 'scaleX(1)'; $('sPct').textContent = '100%';
  countTo(r.files);
  $('stats').textContent = `${r.files.toLocaleString('en-US')} files · ${r.dirs.toLocaleString('en-US')} folders · ${(r.ms / 1000).toFixed(1)} s`;
  setTimeout(() => { $('scan').classList.add('hidden'); orb.stop(); build(r.tree); }, 400);
}
// Show only the last folder name instead of the long path, middle-truncated if too long
const tailPath = p => { const s = String(p).split(/[\\/]+/).filter(Boolean); const x = s[s.length - 1] || ''; return x.length > 26 ? x.slice(0, 12) + '…' + x.slice(-12) : x; };
native.onProgress(s => { scanLast = s.files; countTo(s.files); $('scanPath').textContent = tailPath(s.cur); });

async function init() {
  renderLegend();
  const ds = await native.drives();
  const box = $('drives');
  ds.forEach(d => {
    const el = document.createElement('div');
    el.className = 'drive';
    const used = d.total - d.free;
    el.innerHTML = `<b>${d.path.slice(0, 2)}</b><small>${fmt(d.free)} free / ${fmt(d.total)}</small><div class="bar"><span style="width:0"></span></div>`;
    box.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => (el.querySelector('span').style.width = (used / d.total * 100) + '%')));
    el.onclick = () => { document.querySelectorAll('.drive').forEach(x => x.classList.remove('on')); el.classList.add('on'); startScan(d.path); };
  });
  const q = new URLSearchParams(location.search).get('scan');
  const pick = p => { $('picker').classList.add('hidden'); document.querySelectorAll('.drive').forEach(x => x.classList.toggle('on', x.dataset.p === p)); startScan(p); };
  document.querySelectorAll('.drive').forEach((el, i) => (el.dataset.p = ds[i].path));
  if (q) startScan(q);
  else if (ds.length === 1) pick(ds[0].path);
  else if (ds.length > 1) {
    const pk = $('picker');
    pk.innerHTML = '<b>Which drive do you want to scan?</b><div class="bubbles"></div>';
    const maxT = Math.max(...ds.map(d => d.total));
    ds.forEach((d, i) => {
      const used = (d.total - d.free) / d.total, size = 130 + 110 * Math.sqrt(d.total / maxT);
      const b = document.createElement('div');
      b.className = 'pbub'; b.style.cssText = `width:${size}px;height:${size}px;animation-delay:${i * 90}ms,${i * 400}ms;--u:${(used * 100).toFixed(0)}%;--uf:${used.toFixed(3)};--fc:${used > 0.9 ? '#ff6b6b' : used > 0.75 ? '#ffa940' : '#6fe3a0'}`;
      b.innerHTML = `<span class="l">${d.path.slice(0, 2)}</span><span class="s">${fmt(d.total - d.free)} used</span><span class="s">${fmt(d.total)}</span>`;
      b.onclick = () => pick(d.path);
      pk.querySelector('.bubbles').appendChild(b);
    });
    pk.classList.remove('hidden'); $('empty').classList.add('hidden');
  }
}
init();
