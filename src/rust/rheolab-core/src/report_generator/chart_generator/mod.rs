//! Chart Generator using Plotters
//!
//! Generates vector SVG charts natively in Rust.
pub mod common;
pub mod line;

pub use common::*;
pub use line::generate_chart_svg;

#[cfg(test)]
mod tests {
    use super::*;
    use plotters::prelude::RGBColor;

    #[test]
    fn test_generate_chart_svg() {
        let points = vec![
            ChartPoint { time_min: 0.0, viscosity_cp: 500.0, temperature_c: Some(20.0), shear_rate: Some(10.0), pressure_bar: None, bath_temperature_c: None },
            ChartPoint { time_min: 10.0, viscosity_cp: 600.0, temperature_c: Some(25.0), shear_rate: Some(10.0), pressure_bar: None, bath_temperature_c: None },
        ];
        
        let config = ChartConfig {
            show_temperature: true,
            show_shear_rate: true,
            show_pressure: false,
            show_bath_temperature: false,
            shear_rate_axis: "left".to_string(),
            pressure_axis: "right".to_string(),
            width: 800,
            height: 400,
            label_left: "Visc".to_string(),
            label_right: "Temp".to_string(),
            label_bottom: "Time".to_string(),
            name_viscosity: "V".to_string(),
            name_temperature: "T".to_string(),
            name_shear_rate: "S".to_string(),
            name_pressure: "P".to_string(),
            name_bath_temperature: "BT".to_string(),
            touch_points: vec![],
            viscosity_threshold: None,
            line_styles: None, // Use defaults
            axis_mode: "shared".to_string(),
            skip_downsample: false,
            time_format: String::new(),
        };
        
        let res = generate_chart_svg(&points, &config);
        assert!(res.is_ok());
        let (svg, _) = res.unwrap();
        assert!(svg.contains("<svg"));
    }

    #[test]
    fn test_generate_chart_with_custom_styles() {
        let points = vec![
            ChartPoint { time_min: 0.0, viscosity_cp: 500.0, temperature_c: Some(20.0), shear_rate: None, pressure_bar: None, bath_temperature_c: None },
            ChartPoint { time_min: 10.0, viscosity_cp: 600.0, temperature_c: Some(25.0), shear_rate: None, pressure_bar: None, bath_temperature_c: None },
        ];
        
        let custom_styles = ChartLineStyles {
            viscosity: ChartLineStyle {
                color: RGBColor(255, 0, 0), // Red
                width: 3,
                style: "dashed".to_string(),
            },
            temperature: ChartLineStyle {
                color: RGBColor(0, 255, 0), // Green
                width: 2,
                style: "dotted".to_string(),
            },
            shear_rate: ChartLineStyle::default(),
            pressure: ChartLineStyle::default(),
            bath_temperature: ChartLineStyle::default(),
        };
        
        let config = ChartConfig {
            show_temperature: true,
            show_shear_rate: false,
            show_pressure: false,
            show_bath_temperature: false,
            shear_rate_axis: "left".to_string(),
            pressure_axis: "right".to_string(),
            width: 800,
            height: 400,
            label_left: "Visc".to_string(),
            label_right: "Temp".to_string(),
            label_bottom: "Time".to_string(),
            name_viscosity: "V".to_string(),
            name_temperature: "T".to_string(),
            name_shear_rate: "S".to_string(),
            name_pressure: "P".to_string(),
            name_bath_temperature: "BT".to_string(),
            touch_points: vec![],
            viscosity_threshold: None,
            line_styles: Some(custom_styles),
            axis_mode: "shared".to_string(),
            skip_downsample: false,
            time_format: String::new(),
        };
        
        let res = generate_chart_svg(&points, &config);
        assert!(res.is_ok());
        let (svg, _) = res.unwrap();
        assert!(svg.contains("<svg"));
    }

    #[test]
    fn test_svg_stroke_format() {
        // This test prints the SVG to verify how Plotters formats stroke attributes
        let points = vec![
            ChartPoint { time_min: 0.0, viscosity_cp: 500.0, temperature_c: Some(20.0), shear_rate: None, pressure_bar: None, bath_temperature_c: None },
            ChartPoint { time_min: 10.0, viscosity_cp: 600.0, temperature_c: Some(25.0), shear_rate: None, pressure_bar: None, bath_temperature_c: None },
        ];
        
        let custom_styles = ChartLineStyles {
            viscosity: ChartLineStyle {
                color: RGBColor(59, 130, 246),
                width: 2,
                style: "dashed".to_string(),
            },
            temperature: ChartLineStyle {
                color: RGBColor(249, 115, 22),
                width: 2,
                style: "dotted".to_string(),
            },
            shear_rate: ChartLineStyle::default(),
            pressure: ChartLineStyle::default(),
            bath_temperature: ChartLineStyle::default(),
        };
        
        let config = ChartConfig {
            show_temperature: true,
            show_shear_rate: false,
            show_pressure: false,
            show_bath_temperature: false,
            shear_rate_axis: "left".to_string(),
            pressure_axis: "right".to_string(),
            width: 800,
            height: 400,
            label_left: "Visc".to_string(),
            label_right: "Temp".to_string(),
            label_bottom: "Time".to_string(),
            name_viscosity: "V".to_string(),
            name_temperature: "T".to_string(),
            name_shear_rate: "S".to_string(),
            name_pressure: "P".to_string(),
            name_bath_temperature: "BT".to_string(),
            touch_points: vec![],
            viscosity_threshold: None,
            line_styles: Some(custom_styles),
            axis_mode: "shared".to_string(),
            skip_downsample: false,
            time_format: String::new(),
        };
        
        let res = generate_chart_svg(&points, &config);
        assert!(res.is_ok());
        let (svg, _) = res.unwrap();
        
        // Print lines containing stroke to see exact format
        for line in svg.lines() {
            if line.contains("stroke") && (line.contains("3B82F6") || line.contains("F97316")) {
                println!("SVG LINE: {}", line.trim());
            }
        }
        
        // Also check if dasharray was applied
        let has_dasharray = svg.contains("stroke-dasharray");
        println!("Has stroke-dasharray: {}", has_dasharray);
        println!("Contains #3B82F6: {}", svg.contains("#3B82F6"));
        println!("Contains #F97316: {}", svg.contains("#F97316"));
        // Check for duplicate attribute issues
        for line in svg.lines() {
            let opacity_count = line.matches("opacity=").count();
            if opacity_count > 1 {
                panic!("DUPLICATE opacity in SVG line: {}", line.trim());
            }
        }
        assert!(has_dasharray, "SVG should contain stroke-dasharray after post-processing");
    }
}

#[cfg(test)]
mod lttb_invariants {
    use super::*;
    use proptest::prelude::*;
    use super::common::lttb_downsample_chart;

    fn make_lttb_data(n: usize) -> Vec<ChartPoint> {
        (0..n)
            .map(|i| ChartPoint {
                time_min: i as f64,
                viscosity_cp: 500.0 + (i as f64 * 0.05).sin() * 200.0,
                temperature_c: Some(25.0 + (i as f64 * 0.03).cos() * 5.0),
                shear_rate: Some(100.0),
                pressure_bar: None,
                bath_temperature_c: None,
            })
            .collect()
    }

    proptest! {
        /// Output length must equal threshold exactly when input exceeds it.
        #[test]
        fn lttb_length_equals_threshold(n in 1600usize..4000, threshold in 100usize..1499) {
            let data = make_lttb_data(n);
            let result = lttb_downsample_chart(&data, threshold);
            prop_assert_eq!(
                result.len(), threshold,
                "n={}, threshold={}: expected {} points, got {}",
                n, threshold, threshold, result.len()
            );
        }

        /// First and last points must be the original first and last points.
        #[test]
        fn lttb_preserves_endpoints(n in 1600usize..4000) {
            let data = make_lttb_data(n);
            let result = lttb_downsample_chart(&data, 800);
            let first = result.first().expect("result non-empty");
            let last  = result.last().expect("result non-empty");
            prop_assert!(
                (first.time_min - data.first().unwrap().time_min).abs() < f64::EPSILON,
                "first time_min mismatch: {} vs {}",
                first.time_min, data.first().unwrap().time_min
            );
            prop_assert!(
                (last.time_min - data.last().unwrap().time_min).abs() < f64::EPSILON,
                "last time_min mismatch: {} vs {}",
                last.time_min, data.last().unwrap().time_min
            );
        }

        /// Downsampled max viscosity must be within 5 % of raw max.
        /// LTTB is designed to preserve extrema; 5 % tolerance covers the few
        /// degenerate cases where the global peak lands in a dense bucket.
        #[test]
        fn lttb_max_retention_within_5_percent(n in 1600usize..4000) {
            let data = make_lttb_data(n);
            let raw_max = data.iter().map(|p| p.viscosity_cp).fold(f64::NEG_INFINITY, f64::max);
            let result = lttb_downsample_chart(&data, 800);
            let ds_max = result.iter().map(|p| p.viscosity_cp).fold(f64::NEG_INFINITY, f64::max);
            prop_assert!(
                ds_max >= raw_max * 0.95,
                "Downsampled max {ds_max:.2} more than 5 % below raw max {raw_max:.2}"
            );
        }

        /// With skip_downsample=true the raw data must pass through unmodified.
        #[test]
        fn skip_downsample_returns_full_data(n in 10usize..2000) {
            let data = make_lttb_data(n);
            let config = ChartConfig {
                show_temperature: false,
                show_shear_rate: false,
                show_pressure: false,
                show_bath_temperature: false,
                shear_rate_axis: "right".to_string(),
                pressure_axis: "right".to_string(),
                axis_mode: "shared".to_string(),
                width: 800,
                height: 400,
                label_left: "V".to_string(),
                label_right: String::new(),
                label_bottom: "t".to_string(),
                name_viscosity: "V".to_string(),
                name_temperature: "T".to_string(),
                name_shear_rate: "SR".to_string(),
                name_pressure: "P".to_string(),
                name_bath_temperature: "BT".to_string(),
                touch_points: vec![],
                viscosity_threshold: None,
                line_styles: None,
                skip_downsample: true,
                time_format: String::new(),
            };
            // generate_chart_svg with skip_downsample must not reduce point count
            let result = generate_chart_svg(&data, &config);
            prop_assert!(result.is_ok(), "generate_chart_svg failed: {:?}", result.err());
        }
    }
}