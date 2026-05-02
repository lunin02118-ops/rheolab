//! Central IPC command registry.
//!
//! Exposes the `register_tauri_commands!()` macro that expands to a
//! `tauri::generate_handler![...]` invocation listing every command exposed
//! to the frontend. Centralising the list here keeps `lib.rs` short and
//! makes it trivial to audit the IPC surface.
//!
//! The macro form is required because `tauri::generate_handler!` must be
//! expanded at the call site (it generates type-level plumbing keyed to the
//! Tauri runtime). Returning it from a function would erase the concrete
//! types the framework needs.

/// Generate the Tauri invoke-handler with the full IPC surface.
///
/// Used once in `lib.rs::run()` via `.invoke_handler($crate::register_tauri_commands!())`.
#[macro_export]
macro_rules! register_tauri_commands {
    () => {
        tauri::generate_handler![
            // Backup commands — RISK: HIGH (writes/deletes DB files)
            $crate::commands::backup::backup_list,
            $crate::commands::backup::backup_create,
            $crate::commands::backup::backup_restore,
            $crate::commands::backup::backup_delete,
            $crate::commands::backup::backup_open_folder,
            $crate::commands::backup::backup_import_db,
            $crate::commands::backup::backup_export_db,
            // API keys commands (desktop settings domain)
            $crate::commands::api_keys::api_keys_list,
            $crate::commands::api_keys::api_keys_create,
            $crate::commands::api_keys::api_keys_set_active,
            $crate::commands::api_keys::api_keys_delete,
            $crate::commands::api_keys::api_keys_active,
            $crate::commands::api_keys::api_keys_check_active,
            $crate::commands::api_keys::api_keys_validate,
            // Experiments commands — RISK: HIGH (writes user data)
            $crate::commands::experiments::experiments_list,
            $crate::commands::experiments::experiments_count,
            $crate::commands::experiments::experiments_get,
            $crate::commands::experiments::experiments_detail_meta_by_id,
            $crate::commands::experiments::experiments_raw_table_page_by_id,
            $crate::commands::experiments::experiments_get_batch,
            $crate::commands::experiments::experiments_check_existence,
            $crate::commands::experiments::experiments_save,
            $crate::commands::experiments::experiments_delete,
            $crate::commands::experiments::experiments_last_context,
            $crate::commands::experiments::experiments_water_sources,
            $crate::commands::experiments::experiments_filter_metadata,
            $crate::commands::experiments::experiments_export_laboratories,
            $crate::commands::experiments::experiments_export_to_file,
            $crate::commands::experiments::experiments_import,
            // Binary chart series commands (Sprint 6)
            $crate::commands::series::experiments_series_meta,
            $crate::commands::series::experiments_series_overview,
            $crate::commands::series::experiments_series_window,
            $crate::commands::series::series_decode_cache_stats,
            // Reagents commands — RISK: MEDIUM (writes catalog data)
            $crate::commands::reagents::reagents_list,
            $crate::commands::reagents::reagents_create,
            $crate::commands::reagents::reagents_update,
            $crate::commands::reagents::reagents_delete,
            $crate::commands::reagents::reagents_export,
            $crate::commands::reagents::reagents_import,
            $crate::commands::reagents::reagents_seed,
            // Operator commands — RISK: MEDIUM (writes personnel data)
            $crate::commands::operators::operators_list,
            $crate::commands::operators::operators_create,
            $crate::commands::operators::operators_update,
            $crate::commands::operators::operators_delete,
            // Laboratory commands — RISK: MEDIUM (writes lab data)
            $crate::commands::laboratories::laboratories_list,
            $crate::commands::laboratories::laboratories_create,
            $crate::commands::laboratories::laboratories_update,
            $crate::commands::laboratories::laboratories_delete,
            // Test fixtures commands (desktop demo workflow)
            $crate::commands::fixtures::test_fixtures_list,
            $crate::commands::fixtures::test_fixtures_read,
            $crate::commands::fixtures::test_fixtures_parse,
            // Native parsing commands (desktop workflow without browser WASM bootstrap)
            $crate::commands::parsing::parsing_parse_file,
            $crate::commands::parsing::parsing_release_cache,
            $crate::commands::parsing::parsing_cache_stats,
            // Native reports commands — RISK: LOW (license-gated, returns bytes)
            $crate::commands::reports::reports_generate_pdf,
            $crate::commands::reports::reports_generate_excel,
            $crate::commands::reports::reports_generate_pdf_by_id,
            $crate::commands::reports::reports_generate_excel_by_id,
            // Native comparison reports by IDs (ADR-0010/ADR-0013) — RISK: LOW (license-gated)
            $crate::commands::reports::reports_generate_comparison_pdf_by_ids,
            $crate::commands::reports::reports_generate_comparison_excel_by_ids,
            // Runtime jobs and AnalysisArtifact cache maintenance
            $crate::commands::jobs::jobs_list,
            $crate::commands::jobs::jobs_get,
            $crate::commands::jobs::jobs_cancel,
            $crate::commands::jobs::analysis_cache_stats,
            $crate::commands::jobs::analysis_cache_prune,
            $crate::commands::jobs::experiments_projection_status,
            $crate::commands::jobs::experiments_projection_rebuild,
            // Native analysis pipeline commands
            $crate::commands::analysis::analysis_analyze_full,
            $crate::commands::analysis::analysis_analyze_experiment_by_id,
            $crate::commands::analysis::analysis_detect_steps,
            $crate::commands::analysis::analysis_regroup_by_pattern,
            // Logger commands
            $crate::commands::logger::log_info,
            $crate::commands::logger::log_error,
            // Native window chrome polish
            $crate::commands::window_chrome::window_set_theme_chrome,
            // Licensing commands — RISK: HIGH (activation/deactivation state)
            $crate::commands::licensing::licensing_machine_id,
            $crate::commands::licensing::licensing_debug_fingerprint,
            $crate::commands::licensing::licensing_was_ever_licensed,
            $crate::commands::licensing::licensing_checkpoint_db,
            $crate::commands::licensing::licensing_reset_experiments,
            $crate::commands::licensing::licensing_reset_all_experiments,
            // V2 License engine commands
            $crate::commands::licensing::licensing_check,
            $crate::commands::licensing::licensing_get_status,
            $crate::commands::licensing::licensing_activate_full,
            $crate::commands::licensing::licensing_deactivate,
            $crate::commands::licensing::licensing_can_save,
            $crate::commands::licensing::licensing_register_experiment,
            $crate::commands::licensing::get_update_channel,
            $crate::commands::licensing::is_e2e_mode,
            // V2 data flow commands — RISK: MEDIUM (writes sync/artifact data)
            $crate::commands::data_flows::import_batches_list,
            $crate::commands::data_flows::import_batches_get,
            $crate::commands::data_flows::experiment_payloads_list,
            $crate::commands::data_flows::parser_artifacts_list,
            $crate::commands::data_flows::parser_artifacts_get,
            $crate::commands::data_flows::report_artifacts_list,
            $crate::commands::data_flows::report_artifacts_save,
            $crate::commands::data_flows::report_artifacts_delete,
            $crate::commands::data_flows::search_projections_list,
            $crate::commands::data_flows::sync_status,
            $crate::commands::data_flows::sync_outbox_list,
            $crate::commands::data_flows::sync_outbox_mark_synced,
            $crate::commands::data_flows::sync_outbox_retry,
            $crate::commands::data_flows::sync_inbox_receive,
            $crate::commands::data_flows::sync_inbox_list,
            $crate::commands::data_flows::conflicts_list,
            $crate::commands::data_flows::conflicts_resolve,
            // Sync engine commands — RISK: HIGH (file-based delta sync, resolves conflicts)
            $crate::commands::sync_engine::sync_export_delta,
            $crate::commands::sync_engine::sync_import_delta,
            $crate::commands::sync_engine::sync_resolve_conflict,
            $crate::commands::sync_engine::sync_list_conflicts,
        ]
    };
}
