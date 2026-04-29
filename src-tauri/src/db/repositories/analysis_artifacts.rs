use crate::analysis_cache::AnalysisCacheKey;
use crate::error::Result;
use crate::utils::time::now_rfc3339;
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
pub struct AnalysisArtifactRecord {
    pub id: String,
    pub experiment_id: String,
    pub experiment_data_hash: String,
    pub geometry: String,
    pub analysis_settings_hash: String,
    pub report_viscosity_rates_hash: String,
    pub rheolab_core_version: String,
    pub algorithm_version: u32,
    pub artifact_encoding: String,
    pub artifact_blob: Vec<u8>,
    pub artifact_bytes: i64,
    pub created_at: String,
    pub updated_at: String,
    pub last_accessed_at: Option<String>,
    pub hit_count: i64,
}

pub fn get_analysis_artifact(
    conn: &rusqlite::Connection,
    key: &AnalysisCacheKey,
) -> Result<Option<AnalysisArtifactRecord>> {
    let mut record = query_analysis_artifact(conn, key)?;
    if let Some(record) = record.as_mut() {
        let now = now_rfc3339();
        conn.execute(
            "UPDATE AnalysisArtifact \
             SET lastAccessedAt = ?1, hitCount = hitCount + 1 \
             WHERE id = ?2",
            params![now, record.id],
        )?;
        record.last_accessed_at = Some(now);
        record.hit_count += 1;
    }
    Ok(record)
}

pub fn put_analysis_artifact(
    conn: &rusqlite::Connection,
    key: &AnalysisCacheKey,
    artifact_encoding: &str,
    artifact_blob: &[u8],
) -> Result<AnalysisArtifactRecord> {
    let id = analysis_artifact_id(key)?;
    let now = now_rfc3339();
    let artifact_bytes = artifact_blob.len() as i64;

    conn.execute(
        "INSERT INTO AnalysisArtifact (
             id, experimentId, experimentDataHash, geometry,
             analysisSettingsHash, reportViscosityRatesHash,
             rheolabCoreVersion, algorithmVersion,
             artifactEncoding, artifactBlob, artifactBytes,
             createdAt, updatedAt, lastAccessedAt, hitCount
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, NULL, 0)
         ON CONFLICT (
             experimentId, experimentDataHash, geometry,
             analysisSettingsHash, reportViscosityRatesHash,
             rheolabCoreVersion, algorithmVersion
         )
         DO UPDATE SET
             artifactEncoding = excluded.artifactEncoding,
             artifactBlob = excluded.artifactBlob,
             artifactBytes = excluded.artifactBytes,
             updatedAt = excluded.updatedAt",
        params![
            id,
            &key.experiment_id,
            &key.experiment_data_hash,
            &key.geometry,
            &key.analysis_settings_hash,
            &key.report_viscosity_rates_hash,
            &key.rheolab_core_version,
            key.algorithm_version,
            artifact_encoding,
            artifact_blob,
            artifact_bytes,
            now,
        ],
    )?;

    query_analysis_artifact(conn, key)?.ok_or_else(|| {
        "AnalysisArtifact row was not readable after upsert"
            .to_string()
            .into()
    })
}

pub fn delete_analysis_artifact(
    conn: &rusqlite::Connection,
    key: &AnalysisCacheKey,
) -> Result<usize> {
    let deleted = conn.execute(
        "DELETE FROM AnalysisArtifact
         WHERE experimentId = ?1
           AND experimentDataHash = ?2
           AND geometry = ?3
           AND analysisSettingsHash = ?4
           AND reportViscosityRatesHash = ?5
           AND rheolabCoreVersion = ?6
           AND algorithmVersion = ?7",
        params![
            &key.experiment_id,
            &key.experiment_data_hash,
            &key.geometry,
            &key.analysis_settings_hash,
            &key.report_viscosity_rates_hash,
            &key.rheolab_core_version,
            key.algorithm_version,
        ],
    )?;
    Ok(deleted)
}

pub fn delete_analysis_artifacts_for_experiment(
    conn: &rusqlite::Connection,
    experiment_id: &str,
) -> Result<usize> {
    let deleted = conn.execute(
        "DELETE FROM AnalysisArtifact WHERE experimentId = ?1",
        params![experiment_id],
    )?;
    Ok(deleted)
}

pub fn prune_analysis_artifacts_by_version(
    conn: &rusqlite::Connection,
    rheolab_core_version: &str,
    algorithm_version: u32,
) -> Result<usize> {
    let deleted = conn.execute(
        "DELETE FROM AnalysisArtifact
         WHERE rheolabCoreVersion <> ?1 OR algorithmVersion <> ?2",
        params![rheolab_core_version, algorithm_version],
    )?;
    Ok(deleted)
}

pub fn prune_analysis_artifacts_lru(
    conn: &rusqlite::Connection,
    max_total_bytes: i64,
) -> Result<usize> {
    let total: i64 = conn.query_row(
        "SELECT COALESCE(SUM(artifactBytes), 0) FROM AnalysisArtifact",
        [],
        |row| row.get(0),
    )?;
    if total <= max_total_bytes {
        return Ok(0);
    }

    let mut rows = conn.prepare(
        "SELECT id, artifactBytes FROM AnalysisArtifact
         ORDER BY COALESCE(lastAccessedAt, updatedAt), updatedAt, id",
    )?;
    let candidates = rows
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut remaining = total;
    let mut deleted = 0usize;
    for (id, bytes) in candidates {
        if remaining <= max_total_bytes {
            break;
        }
        let count = conn.execute("DELETE FROM AnalysisArtifact WHERE id = ?1", params![id])?;
        if count > 0 {
            remaining -= bytes;
            deleted += count;
        }
    }

    Ok(deleted)
}

fn query_analysis_artifact(
    conn: &rusqlite::Connection,
    key: &AnalysisCacheKey,
) -> Result<Option<AnalysisArtifactRecord>> {
    conn.query_row(
        "SELECT id, experimentId, experimentDataHash, geometry,
                analysisSettingsHash, reportViscosityRatesHash,
                rheolabCoreVersion, algorithmVersion,
                artifactEncoding, artifactBlob, artifactBytes,
                createdAt, updatedAt, lastAccessedAt, hitCount
         FROM AnalysisArtifact
         WHERE experimentId = ?1
           AND experimentDataHash = ?2
           AND geometry = ?3
           AND analysisSettingsHash = ?4
           AND reportViscosityRatesHash = ?5
           AND rheolabCoreVersion = ?6
           AND algorithmVersion = ?7
         LIMIT 1",
        params![
            &key.experiment_id,
            &key.experiment_data_hash,
            &key.geometry,
            &key.analysis_settings_hash,
            &key.report_viscosity_rates_hash,
            &key.rheolab_core_version,
            key.algorithm_version,
        ],
        row_to_record,
    )
    .optional()
    .map_err(Into::into)
}

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<AnalysisArtifactRecord> {
    let algorithm_version: i64 = row.get(7)?;
    Ok(AnalysisArtifactRecord {
        id: row.get(0)?,
        experiment_id: row.get(1)?,
        experiment_data_hash: row.get(2)?,
        geometry: row.get(3)?,
        analysis_settings_hash: row.get(4)?,
        report_viscosity_rates_hash: row.get(5)?,
        rheolab_core_version: row.get(6)?,
        algorithm_version: algorithm_version as u32,
        artifact_encoding: row.get(8)?,
        artifact_blob: row.get(9)?,
        artifact_bytes: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        last_accessed_at: row.get(13)?,
        hit_count: row.get(14)?,
    })
}

fn analysis_artifact_id(key: &AnalysisCacheKey) -> Result<String> {
    let bytes = serde_json::to_vec(key)?;
    let digest = Sha256::digest(bytes);
    Ok(format!("aa_{}", hex::encode(digest)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis_cache::{
        build_analysis_cache_key, hash_experiment_data_bytes, ANALYSIS_ARTIFACT_ENCODING,
        ANALYSIS_CACHE_ALGORITHM_VERSION,
    };
    use crate::db::migration::run_migrations;
    use rheolab_core::schedule_detector::ScheduleConfig;
    use rheolab_core::{ExpertSettings, RHEOLAB_CORE_VERSION};

    fn open_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        run_migrations(&conn).unwrap();
        conn.execute(
            "INSERT INTO User (id, name, email, role, isActive, createdAt, updatedAt)
             VALUES ('desktop-local-admin', 'Admin', 'admin@test', 'admin', 1,
                     datetime('now'), datetime('now'))",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO Experiment
             (id, createdAt, updatedAt, originalFilename, testDate, instrumentType,
              durationSeconds, avgTemperatureC, name, waterSource, waterParams, fluidType,
              testGroup, metrics, rawPoints, userId)
             VALUES ('exp_aaaaaaaaaaaaaaaaaaaa', datetime('now'), datetime('now'), 'f.csv',
              '2026-04-29', 'Grace', 10, 25, 'Exp', 'Lab', '{}', 'Gel',
              'Group', '{}', '[]', 'desktop-local-admin')",
            [],
        )
        .unwrap();
        conn
    }

    fn key(data: &[u8]) -> AnalysisCacheKey {
        build_analysis_cache_key(
            "exp_aaaaaaaaaaaaaaaaaaaa",
            &hash_experiment_data_bytes(data),
            "R1B5",
            &ExpertSettings::default(),
            &ScheduleConfig::default(),
            &[40, 100, 170],
        )
        .unwrap()
    }

    #[test]
    fn put_then_get_returns_artifact_and_marks_hit() {
        let conn = open_db();
        let key = key(b"data");
        let written =
            put_analysis_artifact(&conn, &key, ANALYSIS_ARTIFACT_ENCODING, b"artifact").unwrap();
        assert_eq!(written.hit_count, 0);

        let read = get_analysis_artifact(&conn, &key).unwrap().unwrap();
        assert_eq!(read.artifact_blob, b"artifact");
        assert_eq!(read.artifact_bytes, 8);
        assert_eq!(read.hit_count, 1);
        assert!(read.last_accessed_at.is_some());
    }

    #[test]
    fn put_same_key_overwrites_artifact_without_duplicate() {
        let conn = open_db();
        let key = key(b"data");
        put_analysis_artifact(&conn, &key, ANALYSIS_ARTIFACT_ENCODING, b"old").unwrap();
        put_analysis_artifact(&conn, &key, ANALYSIS_ARTIFACT_ENCODING, b"new").unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM AnalysisArtifact", [], |row| {
                row.get(0)
            })
            .unwrap();
        let read = get_analysis_artifact(&conn, &key).unwrap().unwrap();
        assert_eq!(count, 1);
        assert_eq!(read.artifact_blob, b"new");
    }

    #[test]
    fn different_key_stores_second_artifact() {
        let conn = open_db();
        put_analysis_artifact(&conn, &key(b"data-a"), ANALYSIS_ARTIFACT_ENCODING, b"a").unwrap();
        put_analysis_artifact(&conn, &key(b"data-b"), ANALYSIS_ARTIFACT_ENCODING, b"b").unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM AnalysisArtifact", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn delete_by_experiment_removes_rows() {
        let conn = open_db();
        put_analysis_artifact(&conn, &key(b"data"), ANALYSIS_ARTIFACT_ENCODING, b"a").unwrap();
        let deleted =
            delete_analysis_artifacts_for_experiment(&conn, "exp_aaaaaaaaaaaaaaaaaaaa").unwrap();
        assert_eq!(deleted, 1);
        assert!(get_analysis_artifact(&conn, &key(b"data"))
            .unwrap()
            .is_none());
    }

    #[test]
    fn experiment_delete_cascades_artifacts() {
        let conn = open_db();
        put_analysis_artifact(&conn, &key(b"data"), ANALYSIS_ARTIFACT_ENCODING, b"a").unwrap();
        conn.execute(
            "DELETE FROM Experiment WHERE id = 'exp_aaaaaaaaaaaaaaaaaaaa'",
            [],
        )
        .unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM AnalysisArtifact", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn prune_by_version_removes_old_rows() {
        let conn = open_db();
        put_analysis_artifact(&conn, &key(b"data"), ANALYSIS_ARTIFACT_ENCODING, b"a").unwrap();
        let deleted = prune_analysis_artifacts_by_version(
            &conn,
            RHEOLAB_CORE_VERSION,
            ANALYSIS_CACHE_ALGORITHM_VERSION + 1,
        )
        .unwrap();
        assert_eq!(deleted, 1);
    }

    #[test]
    fn prune_lru_respects_total_byte_limit() {
        let conn = open_db();
        put_analysis_artifact(&conn, &key(b"data-a"), ANALYSIS_ARTIFACT_ENCODING, b"aaaa").unwrap();
        put_analysis_artifact(&conn, &key(b"data-b"), ANALYSIS_ARTIFACT_ENCODING, b"bbbb").unwrap();

        let deleted = prune_analysis_artifacts_lru(&conn, 4).unwrap();
        assert_eq!(deleted, 1);
        let remaining: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(artifactBytes), 0) FROM AnalysisArtifact",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 4);
    }
}
