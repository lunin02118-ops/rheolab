-- Phase 4b live profiling — EXPLAIN QUERY PLAN on the seed fixture.
-- Run with:
--   sqlite3 outputs/seed/rheolab-fixture-seed-small.db < scripts/audit/explain-plan.sql
--
-- Read-only: every probe runs under PRAGMA query_only=ON so the seed DB cannot
-- mutate.  Keep this script idempotent and commit only the deterministic parts —
-- captured output goes under runtime/audit/ which is gitignored.

.headers on
.mode column
PRAGMA query_only = ON;

.print
.print ===== Inventory =====
SELECT 'Experiment'             AS tbl, COUNT(*) AS rows FROM Experiment
UNION ALL SELECT 'ExperimentData',           COUNT(*) FROM ExperimentData
UNION ALL SELECT 'ExperimentReagent',        COUNT(*) FROM ExperimentReagent
UNION ALL SELECT 'ReagentCatalog',           COUNT(*) FROM ReagentCatalog
UNION ALL SELECT 'TouchPointPrecompute',     COUNT(*) FROM TouchPointPrecompute
UNION ALL SELECT 'Calibration',              COUNT(*) FROM Calibration
UNION ALL SELECT 'Laboratory',               COUNT(*) FROM Laboratory
UNION ALL SELECT 'ImportBatch',              COUNT(*) FROM ImportBatch;

.print
.print ===== Q1. PK lookup: SELECT … FROM Experiment WHERE id = ? =====
EXPLAIN QUERY PLAN
SELECT id, name, fieldName, operatorName
FROM Experiment WHERE id = 'fixture_exp_id_does_not_matter';

.print
.print ===== Q2. Dedup probe (save path) =====
EXPLAIN QUERY PLAN
SELECT id, createdAt FROM Experiment
WHERE originalFilename = 'sample.csv'
  AND testDate = '2024-01-01'
  AND name = 'whatever' COLLATE NOCASE
LIMIT 1;

.print
.print ===== Q3. Default list page (no filter) =====
EXPLAIN QUERY PLAN
SELECT id, name, createdAt FROM Experiment
ORDER BY createdAt DESC, id DESC
LIMIT 50;

.print
.print ===== Q4. List filtered by testType (post-v0005) =====
-- Should now use idx_experiment_testtype_createdat_id_desc and avoid temp sort.
EXPLAIN QUERY PLAN
SELECT id FROM Experiment
WHERE testType = 'static'
ORDER BY createdAt DESC, id DESC
LIMIT 50;

.print
.print ===== Q5. List filtered by laboratoryId =====
EXPLAIN QUERY PLAN
SELECT id FROM Experiment
WHERE laboratoryId = 'lab_xyz'
ORDER BY createdAt DESC, id DESC
LIMIT 50;

.print
.print ===== Q6. Sync delta (updatedAt) =====
EXPLAIN QUERY PLAN
SELECT id FROM Experiment
WHERE updatedAt > '2024-01-01T00:00:00Z'
ORDER BY updatedAt;

.print
.print ===== Q7. Filter-metadata DISTINCT (sidebar) =====
EXPLAIN QUERY PLAN
SELECT DISTINCT instrumentType FROM Experiment
WHERE instrumentType IS NOT NULL
ORDER BY instrumentType COLLATE NOCASE;

EXPLAIN QUERY PLAN
SELECT DISTINCT testType FROM Experiment
WHERE testType IS NOT NULL AND TRIM(testType) != ''
ORDER BY testType COLLATE NOCASE;

.print
.print ===== Q8. Reagent dedup AFTER F1 fix (COLLATE NOCASE) =====
EXPLAIN QUERY PLAN
SELECT COUNT(*) FROM ReagentCatalog
WHERE name = 'PolyAcryl' COLLATE NOCASE;

EXPLAIN QUERY PLAN
SELECT COUNT(*) FROM ReagentCatalog
WHERE id != 'r1' AND name = 'PolyAcryl' COLLATE NOCASE;

.print
.print ===== Q8b. Reagent dedup BEFORE F1 (LOWER) — for comparison =====
EXPLAIN QUERY PLAN
SELECT COUNT(*) FROM ReagentCatalog
WHERE LOWER(name) = LOWER('PolyAcryl');

.print
.print ===== Q9. Reagent join (list query EXISTS subquery) =====
EXPLAIN QUERY PLAN
SELECT 1 FROM ExperimentReagent er
LEFT JOIN ReagentCatalog rc ON er.reagentId = rc.id
WHERE er.experimentId = 'someid'
  AND (er.reagentName LIKE '%foo%' COLLATE NOCASE OR rc.name LIKE '%foo%' COLLATE NOCASE);

.print
.print ===== Q10. TouchPointPrecompute partial-index lookups =====
EXPLAIN QUERY PLAN
SELECT * FROM TouchPointPrecompute
WHERE thresholdCp = 50.0 AND hasCrossing = 1;

EXPLAIN QUERY PLAN
SELECT * FROM TouchPointPrecompute
WHERE thresholdCp = 50.0 AND crossingTimeMin > 5.0;

EXPLAIN QUERY PLAN
SELECT * FROM TouchPointPrecompute
WHERE thresholdCp = 50.0 AND viscosityAtTargetCp BETWEEN 100 AND 200;

.print
.print ===== Q11. Touch-point backfill scan (LEFT JOIN … IS NULL) =====
EXPLAIN QUERY PLAN
SELECT e.id FROM Experiment e
LEFT JOIN TouchPointPrecompute tpp
       ON tpp.experimentId = e.id AND tpp.thresholdCp = 50.0
WHERE tpp.experimentId IS NULL;

.print
.print ===== Q12. ExperimentData blob fetch by experimentId =====
EXPLAIN QUERY PLAN
SELECT dataBlob FROM ExperimentData WHERE experimentId = 'someid';

.print
.print ===== Q13. Batch fetch — IN clause =====
EXPLAIN QUERY PLAN
SELECT id FROM Experiment WHERE id IN ('a','b','c','d','e');

.print
.print ===== Q14. ReagentCatalog list (post-v0005) =====
-- Should now use idx_reagent_category_name_nocase and avoid temp sort.
EXPLAIN QUERY PLAN
SELECT id, name, category FROM ReagentCatalog
ORDER BY category COLLATE NOCASE, name COLLATE NOCASE;

.print
.print ===== Q14b. ReagentCatalog list with LOWER() (pre-v0005, comparison) =====
-- Kept for plan diff demonstration only — production SQL no longer uses LOWER().
EXPLAIN QUERY PLAN
SELECT id, name, category FROM ReagentCatalog
ORDER BY LOWER(category), LOWER(name);

.print
.print ===== End =====
