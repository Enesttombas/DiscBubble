// Disk Bubble — Electron main process: window + IPC that runs the Rust scanner (bin/bubblescan.exe).
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { drives } = require('./scanner');

let win, child = null, cancelled = false;
const EXE = path.join(__dirname, 'bin', 'bubblescan.exe').replace('app.asar', 'app.asar.unpacked');
const IS_ADMIN = (() => { try { require('child_process').execSync('net session', { stdio: 'ignore', windowsHide: true }); return true; } catch { return false; } })();
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 760, minHeight: 520,
    backgroundColor: '#0c0d11', show: false, title: 'Disk Bubble',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0c0d11', symbolColor: '#8a90a0', height: 56 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'public', 'index.html'));
  win.once('ready-to-show', () => win.show());
}

const psq = s => "'" + s.replace(/'/g, "''") + "'";

// Runs the Rust scanner. elevated=true → via UAC (if denied there is no result file and it returns null).
function runScanner(root, mode, elevated, sender) {
  const base = path.join(os.tmpdir(), 'bubblescan-' + process.pid + '-' + Date.now());
  const out = base + '.json', prog = base + '.p';
  const args = [root.replace(/[\\/]+$/, '') || root, '--out', out, '--progress', prog, '--mode', mode];
  if (/^[A-Za-z]:$/.test(args[0]) === false) args[0] = root;
  return new Promise(resolve => {
    let finished = false;
    const tick = setInterval(() => {
      try {
        const [n, ...cur] = fs.readFileSync(prog, 'utf8').split('\n');
        sender.send('scan:p', { files: +n || 0, cur: cur.join('\n') });
      } catch {}
    }, 100);
    const done = () => {
      if (finished) return;
      finished = true;
      clearInterval(tick);
      const r = readJson(out);
      [out, prog].forEach(x => fs.rmSync(x, { force: true }));
      resolve(r);
    };
    if (elevated && !IS_ADMIN) {
      const list = args.map(a => psq('"' + a + '"')).join(',');
      const ps = `Start-Process -FilePath ${psq(EXE)} -ArgumentList ${list} -Verb RunAs -WindowStyle Hidden -Wait`;
      child = spawn('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true });
    } else {
      child = spawn(EXE, args, { windowsHide: true });
    }
    child.on('error', done);
    child.on('exit', done);
  });
}

ipcMain.handle('drives', () => drives());
// The root, drive roots and the Windows folder are never deleted.
const protectedPath = p => /^[A-Za-z]:[\\/]?$/.test(p) || /^[A-Za-z]:[\\/]windows[\\/]?$/i.test(p) || /[\\/]driverstore([\\/]|$)/i.test(p);
ipcMain.handle('trash', async (_e, p) => {
  if (protectedPath(p)) return { ok: false, error: /driverstore/i.test(p) ? "Driver packages are not deleted as files; remove them from the Drivers tab." : 'This path is protected.' };
  try { await shell.trashItem(p); } catch (err) { return { ok: false, error: 'Could not move to Recycle Bin: ' + String(err.message || err) }; }
  return fs.existsSync(p) ? { ok: false, error: 'Could not move, the file is still there (it may be in use).' } : { ok: true };
});
// Delete: cmd rd for folders (much faster than node rm), fs.rm for files. Error text = real reason.
let curRm = null, rmCancelled = false;
const cmdRun = line => new Promise(res => {
  const out = [];
  const c = spawn('cmd.exe', ['/d', '/s', '/c', line], { windowsHide: true, windowsVerbatimArguments: true });
  curRm = c;
  c.stdout.on('data', d => out.push(d)); c.stderr.on('data', d => out.push(d));
  c.on('error', e => res({ code: -1, out: String(e) }));
  c.on('exit', code => { if (curRm === c) curRm = null; res({ code, out: Buffer.concat(out).toString('utf8') }); });
});
// First file left after deletion (this is the locked one).
function firstFile(d) {
  try {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (!e.isDirectory()) return f;
      const r = firstFile(f); if (r) return r;
    }
  } catch {}
  return null;
}
// Finds the programs locking a file via Windows Restart Manager (runs only on the error path).
const RM_PS = fs.readFileSync(path.join(__dirname, 'rm-lock.ps1'), 'utf8');
function lockers(file) {
  return new Promise(res => {
    const out = [];
    const enc = Buffer.from(RM_PS, 'utf16le').toString('base64');
    const c = spawn('powershell.exe', ['-NoProfile', '-EncodedCommand', enc], { windowsHide: true, env: { ...process.env, HB_FILE: file } });
    c.stdout.on('data', d => out.push(d));
    c.on('error', () => res(''));
    c.on('exit', () => res(Buffer.concat(out).toString('utf8').trim()));
  });
}
async function removePath(p) {
  let st; try { st = fs.lstatSync(p); } catch { return null; }
  const LP = String.fromCharCode(92, 92, 63, 92); // long path prefix
  const q = p.length > 240 && !p.startsWith(LP) ? LP + p : p;
  if (st.isDirectory() && !st.isSymbolicLink()) {
    const r = await cmdRun(`"chcp 65001>nul & rd /s /q "${q}""`);
    if (!fs.existsSync(p)) return null;
    if (rmCancelled) return 'cancelled (folder may be partially deleted)';
    // rd output is garbled by the console code page; don't trust it, find the first remaining file and ask who locks it.
    const left = firstFile(p), who = left ? await lockers(left) : '';
    return (left ? 'in use: ' + left : 'some items could not be deleted') + (who ? ' — program to close: ' + who : IS_ADMIN ? ' — another program may be using it' : ' — admin rights may be required');
  }
  try { await fs.promises.rm(q, { force: true, maxRetries: 2, retryDelay: 200 }); } catch (e) { return e.code === 'EPERM' || e.code === 'EBUSY' ? 'file is in use or protected (' + e.code + ')' : String(e.code || e.message); }
  return fs.existsSync(p) ? 'file is in use' : null;
}
// Only on user request: relaunches the app as administrator (Windows shows a UAC prompt).
ipcMain.handle('relaunchAdmin', () => {
  const exe = process.execPath;
  spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Process -FilePath ' + psq(exe) + ' -Verb RunAs'], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.quit(), 300);
});
ipcMain.handle('cancelRemove', () => {
  rmCancelled = true;
  if (curRm && curRm.pid) spawn('taskkill', ['/pid', String(curRm.pid), '/t', '/f'], { windowsHide: true });
});
ipcMain.handle('remove', async (_e, p) => {
  if (protectedPath(p)) return { ok: false, error: /driverstore/i.test(p) ? "Driver packages are not deleted as files; remove them from the Drivers tab." : 'This path is protected.' };
  const err = await removePath(p);
  const was = rmCancelled; rmCancelled = false;
  if (was && !err) return { ok: true };
  return err ? { ok: false, error: 'Could not delete: ' + err + (IS_ADMIN ? '' : ' (app is not running as admin)') } : { ok: true };
});
// ---- Driver Store analysis: old / unused third-party packages ----
const FR = path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'DriverStore', 'FileRepository');
const run = (cmd, args) => new Promise(res => {
  const out = [];
  const c = spawn(cmd, args, { windowsHide: true });
  c.stdout.on('data', d => out.push(d)); c.stderr.on('data', d => out.push(d));
  c.on('error', e => res({ code: -1, out: String(e) }));
  c.on('exit', code => res({ code, out: Buffer.concat(out).toString('utf8') }));
});
const vcmp = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
};
function dirSize(d) {
  let s = 0;
  try {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) s += dirSize(p); else try { s += fs.statSync(p).size; } catch {}
    }
  } catch {}
  return s;
}
async function driverScan() {
  const pn = await run('pnputil.exe', ['/enum-drivers']);
  // Labels vary by language; field order is fixed: published name, original name, provider, class, GUID, "date version".
  const pkgs = pn.out.split(/\r?\n\s*\r?\n/).map(b => b.split(/\r?\n/).filter(l => l.includes(':')).map(l => l.slice(l.indexOf(':') + 1).trim()))
    .filter(f => f.length >= 6 && /^oem\d+\.inf$/i.test(f[0]) && /\s\d+(\.\d+)+$/.test(f[5]))
    .map(f => ({ pub: f[0].toLowerCase(), orig: f[1], provider: f[2], cls: f[3], date: f[5].split(/\s+/)[0], ver: f[5].split(/\s+/).pop() }));
  if (!pkgs.length) return { error: 'Could not read the driver list.' };
  const cim = await run('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_PnPSignedDriver | ForEach-Object { $_.InfName }']);
  const used = new Set(cim.out.split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(Boolean));
  if (cim.code !== 0 || !used.size) return { error: 'Could not get the list of drivers in use; safe analysis is not possible.' };
  const newest = {};
  for (const p of pkgs) { const k = p.orig.toLowerCase() + '|' + p.provider; if (!newest[k] || vcmp(p.ver, newest[k]) > 0) newest[k] = p.ver; }
  let dirs = []; try { dirs = fs.readdirSync(FR); } catch {}
  const items = [];
  for (const p of pkgs) {
    if (used.has(p.pub)) continue;
    const top = newest[p.orig.toLowerCase() + '|' + p.provider];
    const old = vcmp(p.ver, top) < 0;
    let size = 0, folder = null;
    const cand = dirs.filter(d => d.toLowerCase().startsWith(p.orig.toLowerCase() + '_'));
    try {
      const ref = fs.readFileSync(path.join(process.env.SystemRoot || 'C:\Windows', 'INF', p.pub));
      folder = cand.find(d => { try { return Buffer.compare(fs.readFileSync(path.join(FR, d, p.orig)), ref) === 0; } catch { return false; } }) || null;
    } catch {}
    if (!folder && cand.length === 1) folder = cand[0];
    if (folder) size = dirSize(path.join(FR, folder));
    const comp = /^(SoftwareComponent|Extension|Firmware|AudioProcessingObject)$/i.test(p.cls);
    items.push({ ...p, size, folder, conf: old && !comp ? 'safe' : 'check',
      why: old && comp ? `Old version; ${top} is installed. Component/extension package: Windows won't remove it if in use` : old ? `Old version; ${top} is installed, no device uses this one` : 'No connected device uses it; hardware not plugged in (reinstalled if you plug it in)' });
  }
  items.sort((a, b) => (a.conf === b.conf ? b.size - a.size : a.conf === 'safe' ? -1 : 1));
  return { items, total: pkgs.length };
}
ipcMain.handle('drivers', () => driverScan());
// No /force: Windows itself refuses to remove a package in use.
ipcMain.handle('driverRemove', async (_e, pub) => {
  if (!/^oem\d+\.inf$/i.test(pub)) return { ok: false, error: 'Invalid package name.' };
  const r = await run('pnputil.exe', ['/delete-driver', pub]);
  return r.code === 0 ? { ok: true } : { ok: false, error: 'Could not remove (code ' + r.code + '): ' + r.out.trim().split(/\r?\n/).pop() };
});

ipcMain.handle('reveal', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('cancel', () => { cancelled = true; if (child) child.kill(); });
ipcMain.handle('scan', async (e, root) => {
  cancelled = false;
  const t0 = Date.now();
  const isRoot = /^[A-Za-z]:[\\/]?$/.test(root);
  let r = null;
  if (isRoot) r = await runScanner(root, 'mft', true, e.sender);
  if (cancelled) return null;
  if (!r || r.error) r = await runScanner(root, 'walk', false, e.sender);
  if (cancelled) return null;
  if (!r || r.error) return { error: (r && r.error) || 'scan failed' };
  r.ms = Date.now() - t0;
  return r;
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
