use crate::error::Result;
use chrono::Utc;
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

pub(crate) fn new_id() -> String {
    Uuid::new_v4().to_string()
}

pub(crate) fn now_iso() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

pub(crate) fn content_fingerprint(data: &str) -> String {
    let digest = Sha256::digest(data.as_bytes());
    hex::encode(digest)
}

/// Build a compact reference JSON that replaces the full payload in auxiliary tables.
/// Avoids the 4× storage multiplier: Experiment table already holds the canonical data.
pub(crate) fn compact_ref(experiment_id: &str, payload_json: &str) -> String {
    let fp = content_fingerprint(payload_json);
    format!(r#"{{"experimentId":"{}","fingerprint":"{}"}}"#, experiment_id, fp)
}

/// Create an ImportBatch row. Returns the generated batch id.
pub(crate) fn create_import_batch(
    conn: &Connection,
    source_lab_id: Option<&str>,
    source_system: Option<&str>,
    source_app_version: Option<&str>,
    imported_by_user_id: Option<&str>,
    file_name: Option<&str>,
    notes: Option<&str>,
) -> Result<String> {
    let id = new_id();
    let now = now_iso();
    conn.execute(
        "INSERT INTO ImportBatch \
         (id, sourceLabId, sourceSystem, sourceAppVersion, importedByUserId, \
          fileName, notes, experimentsImported, duplicatesDetected, status, createdAt, updatedAt) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 0, 'in_progress', ?8, ?8)",
        params![
            id,
            source_lab_id,
            source_system,
            source_app_version,
            imported_by_user_id,
            file_name,
            notes,
            now,
        ],
    )?;
    Ok(id)
}

/// Finalise an ImportBatch with counts.
pub(crate) fn finalise_import_batch(
    conn: &Connection,
    batch_id: &str,
    imported: usize,
    duplicates: usize,
    status: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE ImportBatch SET experimentsImported = ?1, duplicatesDetected = ?2, \
         status = ?3, updatedAt = ?4 WHERE id = ?5",
        params![imported as i64, duplicates as i64, status, now_iso(), batch_id],
    )?;
    Ok(())
}

/// Create an ExperimentPayload row.
pub(crate) fn create_experiment_payload(
    conn: &Connection,
    experiment_id: &str,
    import_batch_id: Option<&str>,
    payload_json: &str,
    source_lab_id: Option<&str>,
    source_system: Option<&str>,
    source_app_version: Option<&str>,
    is_canonical: bool,
) -> Result<String> {
    let id = new_id();
    let fingerprint = content_fingerprint(payload_json);

    // Determine next payload version for this experiment
    let version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(payloadVersion), 0) + 1 FROM ExperimentPayload \
             WHERE experimentId = ?1",
            params![experiment_id],
            |row| row.get(0),
        )
        .unwrap_or(1);

    conn.execute(
        "INSERT INTO ExperimentPayload \
         (id, experimentId, importBatchId, payloadVersion, payloadFormat, \
          payloadJson, contentFingerprint, sourceLabId, sourceSystem, \
          sourceAppVersion, isCanonical, createdAt) \
         VALUES (?1, ?2, ?3, ?4, 'json', ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            id,
            experiment_id,
            import_batch_id,
            version,
            payload_json,
            fingerprint,
            source_lab_id,
            source_system,
            source_app_version,
            is_canonical as i32,
            now_iso(),
        ],
    )?;
    Ok(id)
}

/// Create a ParserArtifact row.
pub(crate) fn create_parser_artifact(
    conn: &Connection,
    experiment_id: &str,
    import_batch_id: Option<&str>,
    parser_version: &str,
    schema_version: &str,
    artifact_json: &str,
) -> Result<String> {
    let id = new_id();
    let fingerprint = content_fingerprint(artifact_json);

    conn.execute(
        "INSERT INTO ParserArtifact \
         (id, experimentId, importBatchId, parserVersion, schemaVersion, \
          artifactJson, contentFingerprint, promotedToHot, createdAt) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)",
        params![
            id,
            experiment_id,
            import_batch_id,
            parser_version,
            schema_version,
            artifact_json,
            fingerprint,
            now_iso(),
        ],
    )?;
    Ok(id)
}

/// Create a ReportArtifact row.
pub(crate) fn create_report_artifact(
    conn: &Connection,
    experiment_id: &str,
    import_batch_id: Option<&str>,
    report_type: &str,
    template_version: Option<&str>,
    settings_json: Option<&str>,
    storage_path: Option<&str>,
    binary_sha256: Option<&str>,
    size_bytes: Option<i64>,
) -> Result<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO ReportArtifact \
         (id, experimentId, importBatchId, reportType, templateVersion, \
          settingsJson, storagePath, binarySha256, sizeBytes, createdAt) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            id,
            experiment_id,
            import_batch_id,
            report_type,
            template_version,
            settings_json,
            storage_path,
            binary_sha256,
            size_bytes,
            now_iso(),
        ],
    )?;
    Ok(id)
}

/// Log a search projection event.
pub(crate) fn log_search_projection(
    conn: &Connection,
    experiment_id: Option<&str>,
    operation: &str,
    projection_version: &str,
    details_json: Option<&str>,
) -> Result<()> {
    let id = new_id();
    conn.execute(
        "INSERT INTO SearchProjectionLog \
         (id, experimentId, operation, projectionVersion, detailsJson, createdAt) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            id,
            experiment_id,
            operation,
            projection_version,
            details_json,
            now_iso(),
        ],
    )?;
    Ok(())
}

/// Append a SyncOutbox entry for an entity mutation.
pub(crate) fn append_sync_outbox(
    conn: &Connection,
    entity_type: &str,
    entity_id: &str,
    operation: &str,
    payload_json: &str,
) -> Result<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO SyncOutbox \
         (id, entityType, entityId, operation, payloadJson, status, retryCount, createdAt) \
         VALUES (?1, ?2, ?3, ?4, ?5, 'pending', 0, ?6)",
        params![id, entity_type, entity_id, operation, payload_json, now_iso()],
    )?;
    Ok(id)
}
