// bubblescan — disk scanner. Modes: walk (read_dir + rayon), mft (raw NTFS $MFT, needs admin).
// Usage: bubblescan <path> --out file [--progress file] [--mode auto|walk|mft]
use rayon::prelude::*;
use serde_json::{json, Value};
use std::fs::{self, File, OpenOptions};
use std::os::windows::fs::{FileExt, OpenOptionsExt};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::Relaxed};
use std::sync::Mutex;
use std::time::{Duration, Instant, UNIX_EPOCH};

struct Node {
    name: String,
    size: u64,
    file: bool,
    m: u64, // last modified (unix seconds); for a folder, its newest child
    kids: Vec<Node>,
}

static FILES: AtomicU64 = AtomicU64::new(0);
static DIRS: AtomicU64 = AtomicU64::new(0);
static CUR: Mutex<String> = Mutex::new(String::new());

// ---------- walk mode ----------
fn walk(dir: &Path, name: String) -> Node {
    let mut kids = Vec::new();
    let mut subdirs = Vec::new();
    if let Ok(rd) = fs::read_dir(dir) {
        DIRS.fetch_add(1, Relaxed);
        if let Ok(mut c) = CUR.try_lock() {
            *c = dir.to_string_lossy().into_owned();
        }
        for e in rd.flatten() {
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            let n = e.file_name().to_string_lossy().into_owned();
            if ft.is_dir() {
                subdirs.push((e.path(), n));
            } else if let Ok(m) = e.metadata() {
                FILES.fetch_add(1, Relaxed);
                if m.len() > 0 {
                    let mt = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
                    kids.push(Node { name: n, size: m.len(), file: true, m: mt, kids: vec![] });
                }
            }
        }
    }
    let sub: Vec<Node> = subdirs.into_par_iter().map(|(p, n)| walk(&p, n)).collect();
    kids.extend(sub.into_iter().filter(|k| k.size > 0));
    let size = kids.iter().map(|k| k.size).sum();
    let m = kids.iter().map(|k| k.m).max().unwrap_or(0);
    Node { name, size, file: false, m, kids }
}

// ---------- mft mode ----------
struct Entry {
    parent: u64,
    name: String,
    size: u64,
    m: u64,
    dir: bool,
}

fn u16le(b: &[u8], o: usize) -> u16 { u16::from_le_bytes([b[o], b[o + 1]]) }
fn u32le(b: &[u8], o: usize) -> u32 { u32::from_le_bytes(b[o..o + 4].try_into().unwrap()) }
fn u64le(b: &[u8], o: usize) -> u64 { u64::from_le_bytes(b[o..o + 8].try_into().unwrap()) }

fn fixup(rec: &mut [u8]) -> bool {
    if &rec[0..4] != b"FILE" { return false; }
    let (off, cnt) = (u16le(rec, 4) as usize, u16le(rec, 6) as usize);
    if cnt < 2 || off + cnt * 2 > rec.len() { return false; }
    for i in 1..cnt {
        let end = i * 512;
        if end > rec.len() { break; }
        if rec[end - 2..end] != rec[off..off + 2] { return false; }
        let (a, b) = (rec[off + i * 2], rec[off + i * 2 + 1]);
        rec[end - 2] = a;
        rec[end - 1] = b;
    }
    true
}

// Extension record: a fragmented file's VCN 0 $DATA header may live here → (base record, real size).
fn ext_size(rec: &[u8]) -> Option<(u64, u64)> {
    let base = u64le(rec, 0x20) & 0xFFFF_FFFF_FFFF;
    let mut off = u16le(rec, 0x14) as usize;
    while off + 16 <= rec.len() {
        let ty = u32le(rec, off);
        if ty == 0xFFFF_FFFF { break; }
        let len = u32le(rec, off + 4) as usize;
        if len < 16 || off + len > rec.len() { break; }
        if ty == 0x80 && rec[off + 8] != 0 && rec[off + 9] == 0 && off + 0x38 <= rec.len() && u64le(rec, off + 0x10) == 0 {
            return Some((base, u64le(rec, off + 0x30)));
        }
        off += len;
    }
    None
}

fn parse_record(rec: &mut [u8]) -> (Option<Entry>, Option<(u64, u64)>) {
    if !fixup(rec) { return (None, None); }
    let flags = u16le(rec, 0x16);
    if flags & 1 == 0 { return (None, None); }
    if u64le(rec, 0x20) & 0xFFFF_FFFF_FFFF != 0 { return (None, ext_size(rec)); }
    (parse_base(rec, flags), None)
}

fn parse_base(rec: &[u8], flags: u16) -> Option<Entry> {
    let mut off = u16le(rec, 0x14) as usize;
    let (mut parent, mut name, mut ns, mut size, mut mt) = (0u64, None::<String>, 255u8, 0u64, 0u64);
    while off + 16 <= rec.len() {
        let ty = u32le(rec, off);
        if ty == 0xFFFF_FFFF { break; }
        let len = u32le(rec, off + 4) as usize;
        if len < 16 || off + len > rec.len() { break; }
        let nonres = rec[off + 8] != 0;
        let nlen = rec[off + 9];
        if ty == 0x10 && !nonres {
            // $STANDARD_INFORMATION: +0x08 modification time (FILETIME, 100 ns since 1601)
            let c = off + u16le(rec, off + 0x14) as usize;
            if c + 0x10 <= rec.len() {
                mt = (u64le(rec, c + 8) / 10_000_000).saturating_sub(11_644_473_600);
            }
        } else if ty == 0x30 && !nonres {
            let c = off + u16le(rec, off + 0x14) as usize;
            if c + 0x42 <= rec.len() {
                let n = rec[c + 0x41];
                let l = rec[c + 0x40] as usize;
                if (name.is_none() || (n != 2 && ns == 2)) && c + 0x42 + l * 2 <= rec.len() {
                    let u: Vec<u16> = (0..l).map(|i| u16le(rec, c + 0x42 + i * 2)).collect();
                    name = Some(String::from_utf16_lossy(&u));
                    ns = n;
                    parent = u64le(rec, c) & 0xFFFF_FFFF_FFFF;
                }
            }
        } else if ty == 0x80 && nlen == 0 {
            size = if nonres { u64le(rec, off + 0x30) } else { u32le(rec, off + 0x10) as u64 };
        }
        off += len;
    }
    Some(Entry { parent, name: name?, size, m: mt, dir: flags & 2 != 0 })
}

fn runs(rec: &[u8]) -> Option<(Vec<(u64, u64)>, u64)> {
    let mut off = u16le(rec, 0x14) as usize;
    while off + 16 <= rec.len() {
        let ty = u32le(rec, off);
        if ty == 0xFFFF_FFFF { break; }
        let len = u32le(rec, off + 4) as usize;
        if ty == 0x80 && rec[off + 8] != 0 {
            let real = u64le(rec, off + 0x30);
            let mut p = off + u16le(rec, off + 0x20) as usize;
            let (mut lcn, mut out) = (0i64, vec![]);
            while p < off + len && rec[p] != 0 {
                let (ls, os) = ((rec[p] & 15) as usize, (rec[p] >> 4) as usize);
                let mut l = 0u64;
                for i in 0..ls { l |= (rec[p + 1 + i] as u64) << (8 * i); }
                let mut o = 0i64;
                for i in 0..os { o |= (rec[p + 1 + ls + i] as i64) << (8 * i); }
                if os > 0 && rec[p + ls + os] & 0x80 != 0 { o -= 1i64 << (8 * os); }
                lcn += o;
                out.push((lcn as u64, l));
                p += 1 + ls + os;
            }
            return Some((out, real));
        }
        off += len.max(16);
    }
    None
}

fn scan_mft(drive: char) -> Result<Node, String> {
    let f = OpenOptions::new().read(true).share_mode(7).open(format!("\\\\.\\{}:", drive)).map_err(|e| e.to_string())?;
    let mut boot = vec![0u8; 4096];
    f.seek_read(&mut boot, 0).map_err(|e| e.to_string())?;
    if &boot[3..7] != b"NTFS" { return Err("not NTFS".into()); }
    let cluster = u16le(&boot, 0x0B) as u64 * boot[0x0D] as u64;
    let rs = boot[0x40] as i8;
    let rec_size = if rs > 0 { rs as u64 * cluster } else { 1u64 << (-(rs as i32)) } as usize;
    let mft_off = u64le(&boot, 0x30) * cluster;
    let mut first = vec![0u8; rec_size.max(4096)];
    f.seek_read(&mut first, mft_off).map_err(|e| e.to_string())?;
    first.truncate(rec_size);
    if !fixup(&mut first) { return Err("MFT record corrupt".into()); }
    let (rl, real) = runs(&first).ok_or("no MFT data")?;
    let total = (real / rec_size as u64) as usize;
    *CUR.lock().unwrap() = "Reading MFT…".into();
    let mut ents: Vec<Option<Entry>> = Vec::with_capacity(total);
    let mut exts: Vec<(u64, u64)> = Vec::new();
    const CH: usize = 16 << 20;
    'outer: for (lcn, len) in rl {
        let (mut pos, end) = (lcn * cluster, lcn * cluster + len * cluster);
        while pos < end {
            let n = ((end - pos) as usize).min(CH);
            let mut buf = vec![0u8; n];
            f.seek_read(&mut buf, pos).map_err(|e| e.to_string())?;
            let got: Vec<(Option<Entry>, Option<(u64, u64)>)> = buf.par_chunks_mut(rec_size).map(parse_record).collect();
            FILES.fetch_add(got.iter().filter_map(|g| g.0.as_ref()).filter(|e| !e.dir).count() as u64, Relaxed);
            for (e, x) in got {
                ents.push(e);
                if let Some(x) = x { exts.push(x); }
            }
            pos += n as u64;
            if ents.len() >= total { break 'outer; }
        }
    }
    for (b, s) in exts {
        if let Some(Some(e)) = ents.get_mut(b as usize) {
            if !e.dir && e.size == 0 { e.size = s; }
        }
    }
    // tree: child lists
    let mut kids: Vec<Vec<u32>> = vec![vec![]; ents.len()];
    for (i, e) in ents.iter().enumerate() {
        if let Some(e) = e {
            let p = e.parent as usize;
            if i != 5 && p < ents.len() && p != i && ents[p].is_some() { kids[p].push(i as u32); }
        }
    }
    fn build(i: usize, ents: &[Option<Entry>], kids: &[Vec<u32>], depth: u32) -> Node {
        let e = ents[i].as_ref().unwrap();
        if !e.dir || depth > 200 {
            return Node { name: e.name.clone(), size: e.size, file: true, m: e.m, kids: vec![] };
        }
        DIRS.fetch_add(1, Relaxed);
        let k: Vec<Node> = kids[i].iter().map(|&c| build(c as usize, ents, kids, depth + 1)).filter(|n| n.size > 0).collect();
        let m = k.iter().map(|n| n.m).max().unwrap_or(0);
        Node { name: e.name.clone(), size: k.iter().map(|n| n.size).sum(), file: false, m, kids: k }
    }
    if ents.len() <= 5 || ents[5].is_none() { return Err("no root".into()); }
    let mut root = build(5, &ents, &kids, 0);
    root.name = format!("{}:\\", drive);
    Ok(root)
}

// ---------- common ----------
fn prune(n: Node, min: u64) -> Value {
    // "m" is written only when known (keeps the output small)
    let with_m = |mut v: Value, m: u64| { if m > 0 { v["m"] = json!(m); } v };
    if n.file {
        return with_m(json!({"n": n.name, "s": n.size, "f": 1}), n.m);
    }
    let (mut keep, mut rest, mut rest_n, mut rest_m) = (Vec::new(), 0u64, 0u64, 0u64);
    for k in n.kids {
        if k.size >= min { keep.push(k); } else { rest += k.size; rest_n += 1; rest_m = rest_m.max(k.m); }
    }
    keep.sort_by(|a, b| b.size.cmp(&a.size));
    let mut c: Vec<Value> = keep.into_iter().map(|k| prune(k, min)).collect();
    if rest > 0 {
        c.push(with_m(json!({"n": format!("{} small items", rest_n), "s": rest, "f": 1, "o": 1}), rest_m));
    }
    with_m(json!({"n": n.name, "s": n.size, "c": c}), n.m)
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let arg = |k: &str| a.iter().position(|x| x == k).and_then(|i| a.get(i + 1)).cloned();
    let mut path = a.get(1).cloned().unwrap_or_default();
    if path.len() == 2 { path.push('\\'); }
    let out = arg("--out").unwrap_or_else(|| "out.json".into());
    let prog = arg("--progress");
    let mode = arg("--mode").unwrap_or_else(|| "auto".into());
    rayon::ThreadPoolBuilder::new().num_threads(32).build_global().ok();

    let stop = std::sync::Arc::new(AtomicBool::new(false));
    if let Some(p) = prog {
        let s = stop.clone();
        std::thread::spawn(move || {
            while !s.load(Relaxed) {
                let cur = CUR.lock().map(|c| c.clone()).unwrap_or_default();
                let _ = fs::write(&p, format!("{}\n{}", FILES.load(Relaxed), cur));
                std::thread::sleep(Duration::from_millis(80));
            }
        });
    }
    let t0 = Instant::now();
    let b = path.as_bytes();
    let is_root = b.len() >= 2 && b[1] == b':' && path[2..].trim_matches(|c| c == '\\' || c == '/').is_empty();
    let mut used = "walk";
    let mut note = String::new();
    let mut tree = None;
    if is_root && mode != "walk" {
        match scan_mft(b[0] as char) {
            Ok(t) => { used = "mft"; tree = Some(t); }
            Err(e) => {
                note = e;
                if mode == "mft" { let _ = fs::write(&out, json!({"error": note}).to_string()); std::process::exit(2); }
                FILES.store(0, Relaxed); DIRS.store(0, Relaxed);
            }
        }
    }
    let tree = tree.unwrap_or_else(|| walk(Path::new(&path), path.clone()));
    stop.store(true, Relaxed);
    let min = (tree.size / 30000).max(4096);
    let r = json!({"tree": prune(tree, min), "files": FILES.load(Relaxed), "dirs": DIRS.load(Relaxed),
        "ms": t0.elapsed().as_millis() as u64, "mode": used, "note": note});
    fs::write(&out, r.to_string()).expect("write failed");
    let _ = File::open(&out);
}
