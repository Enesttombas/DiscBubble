use serde_json::Value;
use std::{env, fs, process::Command, time::SystemTime};

#[test]
fn reports_sparse_and_compressed_disk_usage_and_keeps_logical_size() {
    let id = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos();
    let root = env::temp_dir().join(format!("bubblescan-test-{id}"));
    let data = root.join("data");
    fs::create_dir_all(&data).unwrap();
    let sparse = data.join("sparse.bin");
    let file = fs::File::create(&sparse).unwrap();
    assert!(Command::new("fsutil.exe").args(["sparse", "setflag"]).arg(&sparse).status().unwrap().success());
    file.set_len(1 << 30).unwrap();
    drop(file);
    fs::write(data.join("normal.bin"), vec![1; 8192]).unwrap();
    let compressed = data.join("compressed.bin");
    fs::write(&compressed, vec![1; 1 << 20]).unwrap();
    assert!(Command::new("compact.exe").args(["/C", "/Q"]).arg(&compressed).status().unwrap().success());

    let output = root.join("scan.json");
    let status = Command::new(env!("CARGO_BIN_EXE_bubblescan"))
        .arg(&data).arg("--out").arg(&output).args(["--mode", "walk"]).status().unwrap();
    let result: Value = serde_json::from_slice(&fs::read(output).unwrap()).unwrap();
    fs::remove_dir_all(root).unwrap();
    assert!(status.success());
    let tree = &result["tree"];
    assert_eq!(result["sizeFallbacks"], 0);
    assert_eq!(tree["l"], (1u64 << 30) + (1 << 20) + 8192);
    let children = tree["c"].as_array().unwrap();
    let sparse = children.iter().find(|n| n["n"] == "sparse.bin").unwrap();
    assert_eq!(sparse["s"], 0);
    assert_eq!(sparse["l"], 1u64 << 30);
    let compressed = children.iter().find(|n| n["n"] == "compressed.bin").unwrap();
    let disk = compressed["s"].as_u64().unwrap();
    assert!((1..1 << 20).contains(&disk));
    assert_eq!(compressed["l"], 1 << 20);
    assert_eq!(tree["s"], disk + 8192);
}
