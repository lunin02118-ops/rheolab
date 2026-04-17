/**
 * BSL/SWB File Full Pipeline Integration Test
 * 
 * Tests the complete pipeline: parse → enforce_physics → detect_schedule → 
 * filter_parasitic → detect_cycles → process_cycle on the actual BSL file
 * "90 второй 26.02.2024 1717.da.xlsx"
 */

use std::fs;
use std::path::PathBuf;

use rheolab_core::parser::rheo_parser::parse_rheo_data;
use rheolab_core::parser::physics_engine::enforce_physics_and_geometry;
use rheolab_core::schedule_detector::{detect_schedule, ScheduleConfig};
use rheolab_core::{detect_anchor_cycles_internal, is_sst_pattern, process_cycle_internal};
use rheolab_core::calculate_grace_internal;
use rheolab_core::{ExpertSettings, GraceInputParams};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

#[test]
fn test_bsl_swb_90_parse() {
    let path = fixtures_dir().join("bsl_swb_90.xlsx");
    let data = fs::read(&path).expect("Failed to read BSL fixture");
    
    let result = parse_rheo_data(&data, "90 второй 26.02.2024 1717.da.xlsx");
    
    match &result {
        Ok(r) => {
            println!("[BSL] Parse OK: {} points", r.data.len());
            println!("[BSL] Instrument: {:?}", r.metadata.instrument_type);
            println!("[BSL] Geometry: {:?}", r.metadata.geometry);
            println!("[BSL] Date: {:?}", r.metadata.test_date);
            
            assert!(r.data.len() > 100, "Expected significant number of data points");
            
            // Check first 5 points
            for (i, p) in r.data.iter().take(5).enumerate() {
                println!("[BSL] Point {}: time={:.1}s, visc={:.1}cP, temp={:.1}°C, SR={:?}, SS={:?}, RPM={:?}, P={:?}",
                    i, p.time_sec, p.viscosity_cp, p.temperature_c,
                    p.shear_rate, p.shear_stress, p.rpm, p.pressure_bar);
            }
            
            // Check that RPM is populated (BSL has "Скорость" column)
            let has_rpm = r.data.iter().any(|p| p.rpm.is_some() && p.rpm.unwrap() > 0.0);
            println!("[BSL] Has RPM data: {}", has_rpm);
            assert!(has_rpm, "BSL file should have RPM data from 'Скорость' column");
        },
        Err(e) => {
            panic!("[BSL] Parse FAILED: {}", e);
        }
    }
}

#[test]
fn test_bsl_swb_90_enforce_physics() {
    let path = fixtures_dir().join("bsl_swb_90.xlsx");
    let data = fs::read(&path).expect("Failed to read BSL fixture");
    let mut result = parse_rheo_data(&data, "90 второй 26.02.2024 1717.da.xlsx").expect("Parse failed");
    
    let geometry = result.metadata.geometry.clone();
    println!("[BSL] Pre-physics: {} points, geometry: {:?}", result.data.len(), geometry);
    
    // Check SR before enforce_physics
    let sr_count_before = result.data.iter().filter(|p| p.shear_rate.is_some() && p.shear_rate.unwrap() > 0.0).count();
    println!("[BSL] Points with SR before physics: {}/{}", sr_count_before, result.data.len());
    
    let physics_result = enforce_physics_and_geometry(&mut result.data, geometry.as_deref());
    
    println!("[BSL] Physics: sr_recovered={}, rpm_corrected={}", physics_result.sr_recovered, physics_result.rpm_corrected);
    
    let sr_count_after = result.data.iter().filter(|p| p.shear_rate.is_some() && p.shear_rate.unwrap() > 0.0).count();
    println!("[BSL] Points with SR after physics: {}/{}", sr_count_after, result.data.len());
    
    // After enforce_physics, all points with viscosity+stress should have SR
    assert!(sr_count_after > sr_count_before, "enforce_physics should recover shear rates");
    
    // Show unique SR values
    let mut unique_srs: Vec<f64> = result.data.iter()
        .filter_map(|p| p.shear_rate)
        .map(|sr| (sr * 10.0).round() / 10.0)
        .collect();
    unique_srs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    unique_srs.dedup();
    println!("[BSL] Unique SR values (rounded to 0.1): {:?}", &unique_srs[..std::cmp::min(20, unique_srs.len())]);
    
    // Show first 5 points after physics
    for (i, p) in result.data.iter().take(5).enumerate() {
        println!("[BSL] Post-physics Point {}: time={:.1}s, visc={:.1}, SR={:?}, SS={:?}, RPM={:?}",
            i, p.time_sec, p.viscosity_cp, p.shear_rate, p.shear_stress, p.rpm);
    }
}

#[test]
fn test_bsl_swb_90_schedule_detection() {
    let path = fixtures_dir().join("bsl_swb_90.xlsx");
    let data = fs::read(&path).expect("Failed to read BSL fixture");
    let mut result = parse_rheo_data(&data, "90 второй 26.02.2024 1717.da.xlsx").expect("Parse failed");
    
    let geometry = result.metadata.geometry.clone();
    enforce_physics_and_geometry(&mut result.data, geometry.as_deref());
    
    let config = ScheduleConfig::default();
    let steps = detect_schedule(&result.data, &config);
    
    println!("[BSL] Detected {} steps:", steps.len());
    for (i, s) in steps.iter().enumerate() {
        println!("  Step {}: id={}, t=[{:.1}-{:.1}], dur={:.1}s, avgSR={:.2}, avgSS={:.2}, avgVisc={:.2}, pts={}",
            i, s.id, s.start_time, s.end_time, s.duration, 
            s.avg_shear_rate, s.avg_shear_stress, s.avg_viscosity, s.points.len());
    }
    
    assert!(steps.len() > 1, "Should detect multiple steps in a multi-RPM BSL file");
}

#[test]
fn test_bsl_swb_90_cycle_detection() {
    let path = fixtures_dir().join("bsl_swb_90.xlsx");
    let data = fs::read(&path).expect("Failed to read BSL fixture");
    let mut result = parse_rheo_data(&data, "90 второй 26.02.2024 1717.da.xlsx").expect("Parse failed");
    
    let geometry = result.metadata.geometry.clone();
    enforce_physics_and_geometry(&mut result.data, geometry.as_deref());
    
    let config = ScheduleConfig::default();
    let steps = detect_schedule(&result.data, &config);
    
    // Note: we skip parasitic filtering for this test since it's internal
    println!("[BSL] Testing cycle detection on {} steps", steps.len());
    
    // Check SST pattern
    let is_sst = is_sst_pattern(&steps);
    println!("[BSL] Is SST pattern: {}", is_sst);
    
    // Try anchor detection
    let cycles = detect_anchor_cycles_internal(&steps);
    println!("[BSL] Detected {} cycles via anchor detection:", cycles.len());
    for (i, c) in cycles.iter().enumerate() {
        let rates: Vec<i32> = c.steps.iter().map(|s| s.avg_shear_rate.round() as i32).collect();
        println!("  Cycle {}: id={}, type={:?}, steps={}, rates={:?}", i, c.id, c.cycle_type, c.steps.len(), rates);
    }
}

#[test]  
fn test_bsl_swb_90_full_pipeline() {
    let path = fixtures_dir().join("bsl_swb_90.xlsx");
    let data = fs::read(&path).expect("Failed to read BSL fixture");
    let mut result = parse_rheo_data(&data, "90 второй 26.02.2024 1717.da.xlsx").expect("Parse failed");
    
    let geometry_str = result.metadata.geometry.clone().unwrap_or_else(|| "R1B5".to_string());
    enforce_physics_and_geometry(&mut result.data, Some(&geometry_str));
    
    let config = ScheduleConfig::default();
    let steps = detect_schedule(&result.data, &config);
    
    // Cycle detection 
    let cycles = detect_anchor_cycles_internal(&steps);
    
    println!("[BSL Full Pipeline] {} points → {} steps → {} cycles", result.data.len(), steps.len(), cycles.len());
    
    // Process each cycle for calculation
    for (i, cycle) in cycles.iter().enumerate() {
        println!("\n  Processing cycle {} (id={}, {} steps):", i, cycle.id, cycle.steps.len());
        
        let processed = process_cycle_internal(cycle);
        println!("    After processing: {} steps", processed.len());
        
        // Build data points for Grace calculation
        let mut data_points: Vec<(f64, f64)> = Vec::new();
        for step in &processed {
            for p in &step.points {
                let rate = p.shear_rate.unwrap_or(0.0);
                let stress = p.shear_stress.unwrap_or(0.0);
                if rate > 1e-9 && stress > 1e-9 {
                    data_points.push((rate, stress));
                }
            }
            if data_points.is_empty() && step.avg_shear_rate > 1e-9 && step.avg_shear_stress > 1e-9 {
                data_points.push((step.avg_shear_rate, step.avg_shear_stress));
            }
        }
        
        println!("    Data points for Grace: {}", data_points.len());
        
        if data_points.len() >= 2 {
            let settings = ExpertSettings {
                points_to_average: 1,
                viscosity_shear_rates: vec![100.0, 170.0, 511.0],
            };
            let cycle_info = GraceInputParams {
                cycle_no: cycle.cycle_index.unwrap_or(0),
                time_min: 0.0,
                end_time_min: 0.0,
                temp_c: 25.0,
                pressure_bar: 0.0,
            };
            
            match calculate_grace_internal(&data_points, &geometry_str, &settings, &cycle_info) {
                Some(grace) => {
                    println!("    Grace result: n'={:.4}, K'={:.4}", grace.n_prime, grace.kv_pasn);
                },
                None => {
                    println!("    Grace: no result (insufficient data)");
                }
            }
        }
    }
    
    println!("\n[BSL Full Pipeline] COMPLETED SUCCESSFULLY");
}
