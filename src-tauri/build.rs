fn main() {
    // F-03: Fail release builds when the updater public key is still a placeholder.
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        let conf = std::fs::read_to_string("tauri.conf.json")
            .expect("Cannot read tauri.conf.json in build.rs");
        if conf.contains("REPLACE_WITH_TAURI_UPDATER_PUBKEY") {
            panic!(
                "\n\n\
                 ╔══════════════════════════════════════════════════════════════╗\n\
                 ║  FATAL: tauri.conf.json still contains placeholder updater  ║\n\
                 ║  pubkey — release builds MUST have a real keypair.          ║\n\
                 ║                                                             ║\n\
                 ║  Generate one with:                                         ║\n\
                 ║    cargo tauri signer generate -w .keys/updater.key         ║\n\
                 ║                                                             ║\n\
                 ║  Then set the pubkey in tauri.conf.json → plugins.updater   ║\n\
                 ╚══════════════════════════════════════════════════════════════╝\n"
            );
        }
    }

    tauri_build::build()
}
