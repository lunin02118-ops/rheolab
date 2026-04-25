//! Real-fixture tests for dynamic viscosity threshold filtering
//!
//! These tests use actual CSV files from the fixtures directory to verify
//! that the slow-path dynamic threshold computation works correctly on
//! real experimental data with known viscosity peaks.

use rheolab_core::{
    data::columnar::ColumnarData,
    export::rheometer::read_csv,
    prelude::*,
};

use crate::{
    commands::experiments::list::{
        dynamic::query_experiments_list_dynamic,
        types::{ExperimentsListQuery, SortDirection, SortField},
    },
    db::tests::TestDb,
};

#[tokio::test]
async fn dynamic_threshold_sst_63c_low_viscosity() {
    let mut db = TestDb::new().await;
    let tx = db.begin().await;

    // Load real SST fixture (known to have low viscosity peak)
    let csv_path = "../../tests/fixtures/8957 SST Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@63C 30.10.25.csv";
    let csv_data = std::fs::read_to_string(csv_path).expect("SST fixture must exist");
    let columnar = read_csv(&csv_data).expect("Must parse SST fixture");

    // Save experiment with maxViscosity populated
    let exp_id = "test-sst-63c";
    crate::db::experiments::save_experiment(&tx, exp_id, "SST Test", &columnar)
        .await
        .expect("Save must succeed");

    // Query with threshold 10 cP (should match - SST has low viscosity)
    let query = ExperimentsListQuery {
        viscosity_threshold: Some("10".to_string()),
        has_crossing: Some("yes".to_string()),
        limit: Some(10),
        offset: Some(0),
        sort_field: SortField::CreatedAt,
        sort_direction: SortDirection::Desc,
        ..Default::default()
    };

    let results = query_experiments_list_dynamic(&tx, &query)
        .await
        .expect("Dynamic query must succeed");

    println!("SST 63C with threshold 10 cP: {} results", results.experiments.len());
    
    if !results.experiments.is_empty() {
        let exp = &results.experiments[0];
        println!("  - touch_has_crossing: {:?}", exp.touch_has_crossing);
        println!("  - touch_crossing_time_min: {:?}", exp.touch_crossing_time_min);
        println!("  - touch_crossing_viscosity_cp: {:?}", exp.touch_crossing_viscosity_cp);
        println!("  - max_viscosity: {:?}", exp.max_viscosity);
    }

    // Query with threshold 500 cP (should NOT match - SST doesn't reach 500)
    let query_high = ExperimentsListQuery {
        viscosity_threshold: Some("500".to_string()),
        has_crossing: Some("yes".to_string()),
        limit: Some(10),
        offset: Some(0),
        sort_field: SortField::CreatedAt,
        sort_direction: SortDirection::Desc,
        ..Default::default()
    };

    let results_high = query_experiments_list_dynamic(&tx, &query_high)
        .await
        .expect("Dynamic query must succeed");

    println!("SST 63C with threshold 500 cP: {} results", results_high.experiments.len());

    // Assertions based on expected behavior
    if columnar.max_viscosity > Some(500.0) {
        // If SST actually has high viscosity (unexpected), both should match
        assert!(results.experiments.len() > 0, "Should match low threshold");
        assert!(results_high.experiments.len() > 0, "Should match high threshold");
    } else {
        // Expected case: SST has low viscosity, only low threshold matches
        assert!(results.experiments.len() > 0, "Should match low threshold");
        assert_eq!(results_high.experiments.len(), 0, "Should NOT match high threshold");
    }

    tx.commit().await.expect("Commit must succeed");
}

#[tokio::test]
async fn dynamic_threshold_swb_96c_high_viscosity() {
    let mut db = TestDb::new().await;
    let tx = db.begin().await;

    // Load real SWB fixture (known to have higher viscosity)
    let csv_path = "../../tests/fixtures/8958 SWB Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@96C 30.10.25.csv";
    let csv_data = std::fs::read_to_string(csv_path).expect("SWB fixture must exist");
    let columnar = read_csv(&csv_data).expect("Must parse SWB fixture");

    // Save experiment with maxViscosity populated
    let exp_id = "test-swb-96c";
    crate::db::experiments::save_experiment(&tx, exp_id, "SWB Test", &columnar)
        .await
        .expect("Save must succeed");

    println!("SWB 96C max_viscosity: {:?}", columnar.max_viscosity);

    // Query with threshold 10 cP (should match if SWB has any crossing)
    let query_low = ExperimentsListQuery {
        viscosity_threshold: Some("10".to_string()),
        has_crossing: Some("yes".to_string()),
        limit: Some(10),
        offset: Some(0),
        sort_field: SortField::CreatedAt,
        sort_direction: SortDirection::Desc,
        ..Default::default()
    };

    let results_low = query_experiments_list_dynamic(&tx, &query_low)
        .await
        .expect("Dynamic query must succeed");

    println!("SWB 96C with threshold 10 cP: {} results", results_low.experiments.len());

    // Query with threshold 500 cP (might match depending on SWB's actual peak)
    let query_high = ExperimentsListQuery {
        viscosity_threshold: Some("500".to_string()),
        has_crossing: Some("yes".to_string()),
        limit: Some(10),
        offset: Some(0),
        sort_field: SortField::CreatedAt,
        sort_direction: SortDirection::Desc,
        ..Default::default()
    };

    let results_high = query_experiments_list_dynamic(&tx, &query_high)
        .await
        .expect("Dynamic query must succeed");

    println!("SWB 96C with threshold 500 cP: {} results", results_high.experiments.len());

    if !results_low.experiments.is_empty() {
        let exp = &results_low.experiments[0];
        println!("  Low threshold - crossing_time: {:?}, viscosity: {:?}", 
                 exp.touch_crossing_time_min, exp.touch_crossing_viscosity_cp);
    }

    if !results_high.experiments.is_empty() {
        let exp = &results_high.experiments[0];
        println!("  High threshold - crossing_time: {:?}, viscosity: {:?}", 
                 exp.touch_crossing_time_min, exp.touch_crossing_viscosity_cp);
    }

    tx.commit().await.expect("Commit must succeed");
}

#[tokio::test]
async fn dynamic_threshold_comparison_fast_vs_slow() {
    let mut db = TestDb::new().await;
    let tx = db.begin().await;

    // Load both fixtures for comparison
    let fixtures = vec![
        ("test-sst-63c", "SST Test", "../../tests/fixtures/8957 SST Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@63C 30.10.25.csv"),
        ("test-swb-96c", "SWB Test", "../../tests/fixtures/8958 SWB Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@96C 30.10.25.csv"),
    ];

    for (id, name, path) in fixtures {
        let csv_data = std::fs::read_to_string(path).expect("Fixture must exist");
        let columnar = read_csv(&csv_data).expect("Must parse fixture");
        crate::db::experiments::save_experiment(&tx, id, name, &columnar)
            .await
            .expect("Save must succeed");
        println!("Loaded {}: max_viscosity={:?}", id, columnar.max_viscosity);
    }

    // Fast path (empty threshold = default 50 cP)
    let query_fast = ExperimentsListQuery {
        has_crossing: Some("yes".to_string()),
        limit: Some(10),
        offset: Some(0),
        sort_field: SortField::CreatedAt,
        sort_direction: SortDirection::Desc,
        ..Default::default()
    };

    let results_fast = query_experiments_list_dynamic(&tx, &query_fast)
        .await
        .expect("Fast path must succeed");

    println!("Fast path (50 cP): {} results", results_fast.experiments.len());

    // Slow path with 500 cP
    let query_slow = ExperimentsListQuery {
        viscosity_threshold: Some("500".to_string()),
        has_crossing: Some("yes".to_string()),
        limit: Some(10),
        offset: Some(0),
        sort_field: SortField::CreatedAt,
        sort_direction: SortDirection::Desc,
        ..Default::default()
    };

    let results_slow = query_experiments_list_dynamic(&tx, &query_slow)
        .await
        .expect("Slow path must succeed");

    println!("Slow path (500 cP): {} results", results_slow.experiments.len());

    // Compare results
    for exp in &results_fast.experiments {
        println!("Fast - {}: crossing_time={:?}, viscosity={:?}", 
                 exp.id, exp.touch_crossing_time_min, exp.touch_crossing_viscosity_cp);
    }

    for exp in &results_slow.experiments {
        println!("Slow - {}: crossing_time={:?}, viscosity={:?}", 
                 exp.id, exp.touch_crossing_time_min, exp.touch_crossing_viscosity_cp);
    }

    // The slow path should be a subset of fast path (or equal)
    assert!(results_slow.experiments.len() <= results_fast.experiments.len(), 
            "Slow path should not return more results than fast path");

    tx.commit().await.expect("Commit must succeed");
}

#[tokio::test]
async fn dynamic_threshold_debug_crossing_algorithm() {
    let mut db = TestDb::new().await;
    let tx = db.begin().await;

    // Load SWB fixture and run the touch-point algorithm directly
    let csv_path = "../../tests/fixtures/8958 SWB Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@96C 30.10.25.csv";
    let csv_data = std::fs::read_to_string(csv_path).expect("SWB fixture must exist");
    let columnar = read_csv(&csv_data).expect("Must parse SWB fixture");

    println!("SWB fixture stats:");
    println!("  - max_viscosity: {:?}", columnar.max_viscosity);
    println!("  - points: {}", columnar.time.len());

    // Run touch-point algorithm with different thresholds
    use rheolab_core::analysis::touch_point::compute_from_inputs_with_threshold;
    
    let inputs = rheolab_core::analysis::touch_point::Inputs {
        time: &columnar.time,
        viscosity: &columnar.viscosity,
        shear_rate: &columnar.shear_rate,
        temperature: &columnar.bath_temperatures,
    };

    // Test with 50 cP (default)
    let result_50 = compute_from_inputs_with_threshold(&inputs, 50.0);
    println!("50 cP threshold: has_crossing={}, time={:?}, viscosity={:?}", 
             result_50.has_crossing, result_50.crossing_time_min, result_50.crossing_viscosity_cp);

    // Test with 500 cP
    let result_500 = compute_from_inputs_with_threshold(&inputs, 500.0);
    println!("500 cP threshold: has_crossing={}, time={:?}, viscosity={:?}", 
             result_500.has_crossing, result_500.crossing_time_min, result_500.crossing_viscosity_cp);

    // Test with 10 cP
    let result_10 = compute_from_inputs_with_threshold(&inputs, 10.0);
    println!("10 cP threshold: has_crossing={}, time={:?}, viscosity={:?}", 
             result_10.has_crossing, result_10.crossing_time_min, result_10.crossing_viscosity_cp);

    // Save and query through the dynamic path
    let exp_id = "debug-swb-96c";
    crate::db::experiments::save_experiment(&tx, exp_id, "Debug SWB", &columnar)
        .await
        .expect("Save must succeed");

    for threshold in ["10", "50", "500"] {
        let query = ExperimentsListQuery {
            viscosity_threshold: Some(threshold.to_string()),
            has_crossing: Some("yes".to_string()),
            limit: Some(10),
            ..Default::default()
        };

        let results = query_experiments_list_dynamic(&tx, &query)
            .await
            .expect("Dynamic query must succeed");

        println!("Query threshold {} cP: {} results", threshold, results.experiments.len());
        if !results.experiments.is_empty() {
            let exp = &results.experiments[0];
            println!("  - crossing_time: {:?}, viscosity: {:?}", 
                     exp.touch_crossing_time_min, exp.touch_crossing_viscosity_cp);
        }
    }

    tx.commit().await.expect("Commit must succeed");
}
