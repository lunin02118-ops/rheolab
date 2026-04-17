use std::fs;
use rheolab_core::report_generator::pdf::generate_pdf_report;

fn main() {
    let json_path = "../../../tests/fixtures/report_data.json";
    let output_path = "../../../rust_report_v33.pdf";

    println!("Reading JSON from: {}", json_path);
    let json_content = fs::read_to_string(json_path).expect("Failed to read JSON");

    println!("Generating PDF...");
    match generate_pdf_report(&json_content) {
        Ok(bytes) => {
            fs::write(output_path, bytes).expect("Failed to write PDF");
            println!("PDF saved to: {}", output_path);
        },
        Err(e) => {
            eprintln!("Error generating PDF: {}", e);
        }
    }
}
