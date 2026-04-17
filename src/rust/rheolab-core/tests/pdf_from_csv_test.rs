use rheolab_core::report_generator::generate_pdf_report;
use rheolab_core::schedule_detector::{detect_schedule, ScheduleConfig};
use rheolab_core::{detect_anchor_cycles_internal, calculate_grace_internal, ExpertSettings, GraceInputParams};
use std::fs::File;
use std::io::{Read, Write};
use std::path::PathBuf;

#[test]
fn test_full_pipeline_simulation() {
    // 1. Load Real Data File (Simulate User Upload)
    let mut d = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    d.push("../../../tests/fixtures/8958 SWB Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@96C 30.10.25.csv");
    
    if !d.exists() {
        println!("Skipping test: fixture not found at {:?}", d);
        return;
    }

    println!("Loading file: {:?}", d);
    let mut file = File::open(&d).expect("Failed to open CSV file");
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).expect("Failed to read CSV file");
    // Handle potential non-UTF8 encoding (Windows-1251 is common for Russian files, but we'll try lossy utf8 first)
    let content = String::from_utf8_lossy(&buffer);

    // 2. Parse Data (Simulate Parser)
    // Format: Header lines, then empty lines, then data
    // Col 0: Time (HH:MM:SS)
    // Col 1: Temp
    // Col 4: Shear Rate
    // Col 5: Shear Stress
    // Col 6: Viscosity
    // Col 7: Pressure

    let mut data_points = Vec::new();
    
    for line in content.lines() {
        // Skip empty lines or headers without time
        if !line.contains(":") { continue; }

        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() < 8 { continue; }

        // Try to parse Time (HH:MM:SS)
        let time_parts: Vec<&str> = parts[0].split(':').collect();
        if time_parts.len() != 3 { continue; }
        
        let h: Result<f64, _> = time_parts[0].parse();
        let m: Result<f64, _> = time_parts[1].parse();
        let s: Result<f64, _> = time_parts[2].parse();

        if h.is_err() || m.is_err() || s.is_err() { continue; }
        
        let time_sec = h.unwrap() * 3600.0 + m.unwrap() * 60.0 + s.unwrap();

        // Parse other columns
        let temp_c: f64 = parts[1].parse().unwrap_or(0.0);
        let shear_rate: f64 = parts[4].parse().unwrap_or(0.0);
        let shear_stress: f64 = parts[5].parse().unwrap_or(0.0);
        let viscosity_cp: f64 = parts[6].parse().unwrap_or(0.0);
        let pressure_bar: f64 = parts[7].parse().unwrap_or(0.0);

        // Filter valid points (optional, but good for cleanliness)
        if shear_rate >= 0.0 {
             data_points.push(rheolab_core::types::RheoPoint {
                time_sec,
                viscosity_cp,
                temperature_c: temp_c,
                shear_rate: Some(shear_rate),
                shear_stress: Some(shear_stress),
                pressure_bar: Some(pressure_bar),
                rpm: None,
                bath_temperature_c: None,
            });
        }
    }

    println!("Parsed {} data points", data_points.len());
    assert!(data_points.len() > 0, "Failed to parse any data points");

    // 3. Detect Schedule (Simulate Schedule Detection)
    let config = ScheduleConfig::default();
    let steps = detect_schedule(&data_points, &config);
    println!("Detected {} steps", steps.len());

    // 4. Detect Cycles (Simulate Cycle Detection)
    // Note: This file might be SWB, so Anchor/SST cycles might not be found.
    // We run the detector anyway.
    let cycles = detect_anchor_cycles_internal(&steps);
    println!("Detected {} cycles", cycles.len());

    // 5. Calculate Results (Simulate Grace Calculation)
    let mut cycle_results_json = Vec::new();
    let settings = ExpertSettings::default();

    for cycle in &cycles {
        let mut cycle_points = Vec::new();
        for step in &cycle.steps {
            for p in &step.points {
                 if let (Some(rate), Some(stress)) = (p.shear_rate, p.shear_stress) {
                     if rate > 0.0 && stress > 0.0 {
                        cycle_points.push((rate, stress));
                     }
                 }
            }
        }

        let avg_temp = cycle.steps.iter().map(|s| s.avg_temperature).sum::<f64>() / cycle.steps.len() as f64;
        let avg_pressure = cycle.steps.iter().map(|s| s.avg_pressure).sum::<f64>() / cycle.steps.len() as f64;
        let start_time = cycle.steps.first().map(|s| s.start_time).unwrap_or(0.0);
        let end_time = cycle.steps.last().map(|s| s.end_time).unwrap_or(0.0);

        let params = GraceInputParams {
            cycle_no: cycle.id,
            time_min: start_time / 60.0,
            end_time_min: end_time / 60.0,
            temp_c: avg_temp,
            pressure_bar: avg_pressure,
        };

        if let Some(result) = calculate_grace_internal(
            &cycle_points,
            "R1B5",
            &settings,
            &params
        ) {
            // Manually map GraceCycleResult to ReportInput's CycleResult JSON structure
            let result_json = format!(r#"{{
                "cycle_no": {},
                "time_min": {},
                "temp_c": {},
                "pressure_bar": {},
                "n_prime": {},
                "k_prime": {},
                "r2": {},
                "visc_at_40": {},
                "visc_at_100": {},
                "visc_at_170": {},
                "bingham_pv": {},
                "bingham_yp": {},
                "bingham_r2": {}
            }}"#, 
                result.cycle_no,
                result.time_min,
                result.temp_c,
                result.pressure_bar,
                result.n_prime,
                result.kv_pasn, // Map kv_pasn to k_prime
                result.r2,
                result.viscosities.get("40").unwrap_or(&0.0),
                result.viscosities.get("100").unwrap_or(&0.0),
                result.viscosities.get("170").unwrap_or(&0.0),
                result.bingham_pv_pas,
                result.bingham_yp_pa,
                result.bingham_r2
            );
            cycle_results_json.push(result_json);
        }
    }

    println!("Calculated results for {} cycles", cycle_results_json.len());

    // 6. Prepare Report Input JSON
    
    // A. Generate Real Chart SVG from Data
    let svg_width = 800.0;
    let svg_height = 400.0;
    let margin = 40.0;
    
    // Find ranges
    let min_time = data_points.first().map(|p| p.time_sec).unwrap_or(0.0);
    let max_time = data_points.last().map(|p| p.time_sec).unwrap_or(100.0);
    let max_visc = data_points.iter().map(|p| p.viscosity_cp).fold(0.0, f64::max);
    let max_temp = data_points.iter().map(|p| p.temperature_c).fold(0.0, f64::max);

    // Scales
    let x_scale = (svg_width - 2.0 * margin) / (max_time - min_time).max(1.0);
    let y_scale_visc = (svg_height - 2.0 * margin) / max_visc.max(1.0);
    let y_scale_temp = (svg_height - 2.0 * margin) / max_temp.max(1.0);

    // Generate Paths
    let mut path_visc = String::new();
    let mut path_temp = String::new();

    for (i, p) in data_points.iter().enumerate() {
        let x = margin + (p.time_sec - min_time) * x_scale;
        let y_visc = svg_height - margin - (p.viscosity_cp * y_scale_visc);
        let y_temp = svg_height - margin - (p.temperature_c * y_scale_temp);

        if i == 0 {
            path_visc.push_str(&format!("M {:.1} {:.1}", x, y_visc));
            path_temp.push_str(&format!("M {:.1} {:.1}", x, y_temp));
        } else {
            path_visc.push_str(&format!(" L {:.1} {:.1}", x, y_visc));
            path_temp.push_str(&format!(" L {:.1} {:.1}", x, y_temp));
        }
    }

    let real_svg = format!(r##"<svg viewBox="0 0 {} {}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        <!-- Grid -->
        <line x1="{}" y1="{}" x2="{}" y2="{}" stroke="#eee" stroke-width="1"/>
        <line x1="{}" y1="{}" x2="{}" y2="{}" stroke="#eee" stroke-width="1"/>
        
        <!-- Viscosity (Blue) -->
        <path d="{}" fill="none" stroke="blue" stroke-width="2"/>
        
        <!-- Temperature (Red) -->
        <path d="{}" fill="none" stroke="red" stroke-width="2" stroke-dasharray="4"/>
        
        <!-- Axes -->
        <line x1="{}" y1="{}" x2="{}" y2="{}" stroke="black" stroke-width="1"/>
        <line x1="{}" y1="{}" x2="{}" y2="{}" stroke="black" stroke-width="1"/>
        
        <!-- Labels -->
        <text x="{}" y="{}" font-family="Arial" font-size="12" fill="black">Time (s)</text>
        <text x="{}" y="{}" font-family="Arial" font-size="12" fill="blue">Viscosity (cP)</text>
        <text x="{}" y="{}" font-family="Arial" font-size="12" fill="red">Temperature (C)</text>
    </svg>"##, 
        svg_width, svg_height,
        margin, margin, margin, svg_height - margin, // Y axis line
        margin, svg_height - margin, svg_width - margin, svg_height - margin, // X axis line
        path_visc, 
        path_temp,
        margin, margin, margin, svg_height - margin,
        margin, svg_height - margin, svg_width - margin, svg_height - margin,
        svg_width / 2.0, svg_height - 10.0,
        10.0, 20.0,
        svg_width - 100.0, 20.0
    );

    let chart_base64 = base64::encode(&real_svg);
    let chart_data_uri = format!("data:image/svg+xml;base64,{}", chart_base64);

    // B. Inject a mock cycle if none detected (to show the table in PDF)
    if cycle_results_json.is_empty() {
        println!("No cycles detected (expected for SWB file), injecting a mock cycle for demonstration...");
        let mock_cycle = r#"{
            "cycle_no": 1,
            "time_min": 10.5,
            "temp_c": 96.0,
            "pressure_bar": 200.0,
            "n_prime": 0.55,
            "k_prime": 1.2,
            "r2": 0.998,
            "visc_at_40": 150.0,
            "visc_at_100": 120.0,
            "visc_at_170": 95.0,
            "bingham_pv": 0.05,
            "bingham_yp": 5.0,
            "bingham_r2": 0.995
        }"#;
        cycle_results_json.push(mock_cycle.to_string());
    }

    // Include ALL raw data points
    let raw_data_json: Vec<String> = data_points.iter().map(|p| {
        format!(r#"{{"time_sec": {}, "viscosity_cp": {}, "temperature_c": {}, "shear_rate": {}, "pressure_bar": {}}}"#,
            p.time_sec,
            p.viscosity_cp,
            p.temperature_c,
            p.shear_rate.unwrap_or(0.0),
            p.pressure_bar.unwrap_or(0.0)
        )
    }).collect();

    let json_input = format!(r#"{{
        "metadata": {{
            "filename": "8958 SWB Mamontovskoe.csv",
            "test_date": "2025-10-30",
            "company_name": "Test Company LLC",
            "instrument_type": "RheoMeter 5550",
            "geometry": "R1B5"
        }},
        "settings": {{
            "language": "en",
            "unit_system": "metric",
            "show_calibration": false,
            "show_touch_points": false,
            "viscosity_shear_rates": [40, 100, 170]
        }},
        "cycle_results": [{}],
        "recipe": [],
        "raw_data": [{}],
        "chart_image_base64": "{}"
    }}"#, cycle_results_json.join(","), raw_data_json.join(","), chart_data_uri);

    // 7. Generate PDF (Simulate Report Generation)
    println!("Generating PDF from pipeline data...");
    let result = generate_pdf_report(&json_input);

    match result {
        Ok(pdf_bytes) => {
            // Output to outputs folder
            let mut output_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            output_path.push("../../../outputs/pipeline_report_v2.pdf");
            
            let mut file = File::create(&output_path).expect("Failed to create output file");
            file.write_all(&pdf_bytes).expect("Failed to write PDF");
            println!("PDF generated successfully: {:?}", output_path);
            println!("PDF size: {} bytes", pdf_bytes.len());
            println!("SVG size: {} chars", real_svg.len());
            
            assert!(pdf_bytes.starts_with(b"%PDF-"), "Output is not a valid PDF");
            assert!(pdf_bytes.len() > 1000, "PDF seems too small");
        },
        Err(e) => {
            panic!("PDF generation failed: {}", e);
        }
    }
}
