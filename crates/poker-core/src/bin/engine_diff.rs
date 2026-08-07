//! WP-034: dump Rust engine differential traces (fixtures or action streams).
//!
//! ```text
//! cargo run -p poker-core --bin engine_diff -- dump-fixtures [FIXTURES_DIR]
//! cargo run -p poker-core --bin engine_diff -- dump-stream STREAM.json
//! ```

use poker_core::{dump_all_fixture_traces, dump_stream_trace, DiffBundle, DiffStream};
use std::env;
use std::fs;
use std::path::PathBuf;
use std::process;

fn fixtures_dir_default() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/game-rules/fixtures")
}

fn usage() -> ! {
    eprintln!(
        "Usage:\n  engine_diff dump-fixtures [FIXTURES_DIR]\n  engine_diff dump-stream STREAM.json"
    );
    process::exit(2);
}

fn main() {
    let mut args = env::args().skip(1);
    let cmd = args.next().unwrap_or_else(|| usage());

    match cmd.as_str() {
        "dump-fixtures" => {
            let dir = args
                .next()
                .map(PathBuf::from)
                .unwrap_or_else(fixtures_dir_default);
            let bundle = dump_all_fixture_traces(&dir).unwrap_or_else(|e| {
                eprintln!("dump-fixtures error: {e}");
                process::exit(1);
            });
            println!("{}", serde_json::to_string_pretty(&bundle).unwrap());
        }
        "dump-stream" => {
            let path = args.next().map(PathBuf::from).unwrap_or_else(|| usage());
            let raw = fs::read_to_string(&path).unwrap_or_else(|e| {
                eprintln!("read {}: {e}", path.display());
                process::exit(1);
            });
            let streams: Vec<DiffStream> = if raw.trim_start().starts_with('[') {
                serde_json::from_str(&raw).unwrap_or_else(|e| {
                    eprintln!("parse streams: {e}");
                    process::exit(1);
                })
            } else {
                let one: DiffStream = serde_json::from_str(&raw).unwrap_or_else(|e| {
                    eprintln!("parse stream: {e}");
                    process::exit(1);
                });
                vec![one]
            };
            let mut fixtures = Vec::new();
            for s in &streams {
                match dump_stream_trace(s) {
                    Ok(t) => fixtures.push(t),
                    Err(e) => {
                        eprintln!("stream {}: {e}", s.id);
                        process::exit(1);
                    }
                }
            }
            let bundle = DiffBundle {
                engine: "rust",
                work_packet: "WP-034",
                fixture_count: fixtures.len(),
                fixtures,
            };
            println!("{}", serde_json::to_string_pretty(&bundle).unwrap());
        }
        _ => usage(),
    }
}
