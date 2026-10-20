// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Dipanggil hooks Claude Code: oper kejadiannya ke PoinTify, lalu keluar.
    if std::env::args().skip(1).any(|a| a == "--hook") {
        std::process::exit(pointify_lib::hook_relay());
    }
    pointify_lib::run()
}
