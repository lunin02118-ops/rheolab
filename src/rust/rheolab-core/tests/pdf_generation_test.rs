use rheolab_core::report_generator::generate_pdf_report;
use std::fs::File;
use std::io::Write;
use base64::{Engine as _, engine::general_purpose::STANDARD};

#[test]
fn test_pdf_generation_with_svg() {
    // Simple SVG for testing
    let svg_content = r#"<svg width="400" height="200" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="white" />
  <circle cx="50" cy="50" r="40" stroke="green" stroke-width="4" fill="yellow" />
  <text x="10" y="150" font-family="Arial" font-size="20" fill="black">Hello SVG Chart!</text>
</svg>"#;
    
    // Base64 encode SVG
    let svg_base64 = STANDARD.encode(svg_content);
    let chart_image = format!("data:image/svg+xml;base64,{}", svg_base64);

    // Construct JSON input
    let json_input = format!(r#"{{
        "metadata": {{
            "filename": "test_report_svg",
            "test_date": "2023-10-27",
            "company_name": "Test Company LLC",
            "instrument_type": "RheoMeter 3000",
            "geometry": "R1B1"
        }},
        "settings": {{
            "language": "ru",
            "unit_system": "metric",
            "show_calibration": true
        }},
        "cycle_results": [
            {{
                "cycle_no": 1,
                "time_min": 10.5,
                "temp_c": 25.0,
                "pressure_bar": 100.0,
                "n_prime": 0.5,
                "k_prime": 0.1,
                "r2": 0.99,
                "visc_at_40": 150.0,
                "visc_at_100": 80.0,
                "visc_at_170": 40.0,
                "bingham_pv": 12.0,
                "bingham_yp": 5.0,
                "bingham_r2": 0.98
            }}
        ],
        "recipe": [
            {{
                "name": "Water",
                "concentration": 98.0,
                "unit": "kg/m3",
                "category": "Base"
            }},
             {{
                "name": "Polymer",
                "concentration": 2.0,
                "unit": "kg/m3",
                "category": "Gelling Agent"
            }}
        ],
        "chart_image_base64": "{}"
    }}"#, chart_image);

    println!("Generating PDF with SVG chart...");
    let result = generate_pdf_report(&json_input);
    
    match result {
        Ok(pdf_bytes) => {
            let output_path = "test_output_svg.pdf";
            let mut file = File::create(output_path).expect("Failed to create file");
            file.write_all(&pdf_bytes).expect("Failed to write PDF");
            println!("PDF generated successfully: {}", output_path);
            
            // Verify PDF header
            assert!(pdf_bytes.starts_with(b"%PDF-"), "Output is not a valid PDF");
        },
        Err(e) => {
            panic!("PDF generation failed: {}", e);
        }
    }
}
