use base64::{engine::general_purpose::STANDARD, Engine as _};
use rheolab_core::report_generator::generate_pdf_report;
use std::fs::File;
use std::io::Write;

#[test]
fn test_pdf_with_recharts_like_svg() {
    // SVG that mimics Recharts output structure - using proper escaping
    let svg_content = r##"<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400">
  <rect width="100%" height="100%" fill="white"/>
  
  <!-- Grid lines -->
  <g stroke="#e0e0e0" stroke-width="1">
    <line x1="60" y1="50" x2="60" y2="350"/>
    <line x1="60" y1="350" x2="750" y2="350"/>
    <line x1="60" y1="275" x2="750" y2="275" stroke-dasharray="3,3"/>
    <line x1="60" y1="200" x2="750" y2="200" stroke-dasharray="3,3"/>
    <line x1="60" y1="125" x2="750" y2="125" stroke-dasharray="3,3"/>
    <line x1="60" y1="50" x2="750" y2="50" stroke-dasharray="3,3"/>
  </g>
  
  <!-- Y-axis labels -->
  <g fill="#666666" font-size="12" font-family="Arial">
    <text x="55" y="355" text-anchor="end">0</text>
    <text x="55" y="280" text-anchor="end">250</text>
    <text x="55" y="205" text-anchor="end">500</text>
    <text x="55" y="130" text-anchor="end">750</text>
    <text x="55" y="55" text-anchor="end">1000</text>
  </g>
  
  <!-- X-axis labels -->
  <g fill="#666666" font-size="12" font-family="Arial">
    <text x="60" y="370" text-anchor="middle">0</text>
    <text x="233" y="370" text-anchor="middle">50</text>
    <text x="406" y="370" text-anchor="middle">100</text>
    <text x="579" y="370" text-anchor="middle">150</text>
    <text x="750" y="370" text-anchor="middle">200</text>
  </g>
  
  <!-- Axis titles -->
  <text x="405" y="395" text-anchor="middle" fill="#333333" font-size="14" font-family="Arial">Time (min)</text>
  <text x="20" y="200" text-anchor="middle" fill="#3b82f6" font-size="14" font-family="Arial" transform="rotate(-90 20 200)">Viscosity (cP)</text>
  
  <!-- Viscosity line (blue) - simulating real data pattern -->
  <path d="M60,100 L80,95 L100,110 L120,90 L140,120 L160,85 L180,130 L200,80 L220,140 L240,75 L260,150 L280,70 L300,160 L320,65 L340,170 L360,60 L380,180 L400,55 L420,190 L440,50 L460,200 L480,180 L500,220 L520,200 L540,240 L560,220 L580,260 L600,240 L620,280 L640,260 L660,300 L680,280 L700,320 L720,300 L740,340" 
        stroke="#3b82f6" stroke-width="2" fill="none"/>
  
  <!-- Temperature line (orange) -->
  <path d="M60,200 L100,198 L140,202 L180,195 L220,205 L260,190 L300,210 L340,185 L380,215 L420,180 L460,220 L500,175 L540,225 L580,170 L620,230 L660,165 L700,235 L740,160" 
        stroke="#f97316" stroke-width="2" fill="none"/>
  
  <!-- Shear rate line (purple, dashed) -->
  <path d="M60,300 L100,295 L140,305 L180,290 L220,310 L260,285 L300,315 L340,280 L380,320 L420,275 L460,325 L500,270 L540,330 L580,265 L620,335 L660,260 L700,340 L740,255" 
        stroke="#a855f7" stroke-width="2" fill="none" stroke-dasharray="5,5"/>
  
  <!-- Legend -->
  <g transform="translate(300, 20)">
    <line x1="0" y1="0" x2="20" y2="0" stroke="#3b82f6" stroke-width="2"/>
    <text x="25" y="4" fill="#666666" font-size="12" font-family="Arial">Viscosity</text>
    
    <line x1="100" y1="0" x2="120" y2="0" stroke="#f97316" stroke-width="2"/>
    <text x="125" y="4" fill="#666666" font-size="12" font-family="Arial">Temperature</text>
    
    <line x1="220" y1="0" x2="240" y2="0" stroke="#a855f7" stroke-width="2" stroke-dasharray="5,5"/>
    <text x="245" y="4" fill="#666666" font-size="12" font-family="Arial">Shear Rate</text>
  </g>
</svg>"##;

    // Base64 encode SVG
    let svg_base64 = STANDARD.encode(svg_content);
    let chart_image = format!("data:image/svg+xml;base64,{}", svg_base64);

    // Construct JSON input with realistic data
    let json_input = format!(
        r#"{{
        "metadata": {{
            "filename": "complex_chart_test",
            "test_date": "2024-01-15",
            "company_name": "RheoLab Enterprise",
            "instrument_type": "Chandler 5550",
            "geometry": "R1B5",
            "test_id": "TEST-001"
        }},
        "settings": {{
            "language": "ru",
            "unit_system": "SI",
            "show_calibration": false,
            "show_temperature": true,
            "show_shear_rate": true
        }},
        "cycle_results": [
            {{
                "cycle_no": 1,
                "time_min": 30.5,
                "temp_c": 85.0,
                "pressure_bar": 50.0,
                "n_prime": 0.45,
                "k_prime": 0.12,
                "r2": 0.995,
                "visc_at_40": 850.0,
                "visc_at_100": 420.0,
                "visc_at_170": 180.0
            }},
            {{
                "cycle_no": 2,
                "time_min": 60.0,
                "temp_c": 90.0,
                "pressure_bar": 48.0,
                "n_prime": 0.42,
                "k_prime": 0.11,
                "r2": 0.992,
                "visc_at_40": 720.0,
                "visc_at_100": 350.0,
                "visc_at_170": 150.0
            }}
        ],
        "recipe": [
            {{
                "name": "WG-9000F",
                "concentration": 3.4,
                "unit": "kg/m3",
                "category": "Gelling Agent"
            }},
            {{
                "name": "WCL",
                "concentration": 2.8,
                "unit": "kg/m3",
                "category": "Crosslinker"
            }}
        ],
        "chart_image_base64": "{}"
    }}"#,
        chart_image
    );

    println!("Generating PDF with complex Recharts-like SVG chart...");
    println!("SVG content length: {} bytes", svg_content.len());

    let result = generate_pdf_report(&json_input);

    match result {
        Ok(pdf_bytes) => {
            let output_path = "test_output_complex_svg.pdf";
            let mut file = File::create(output_path).expect("Failed to create file");
            file.write_all(&pdf_bytes).expect("Failed to write PDF");
            println!(
                "PDF generated successfully: {} ({} bytes)",
                output_path,
                pdf_bytes.len()
            );

            // Verify PDF header
            assert!(pdf_bytes.starts_with(b"%PDF-"), "Output is not a valid PDF");
            assert!(
                pdf_bytes.len() > 10000,
                "PDF seems too small, chart may not be embedded"
            );
        }
        Err(e) => {
            panic!("PDF generation failed: {}", e);
        }
    }
}
