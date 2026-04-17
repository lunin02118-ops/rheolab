use crate::types::RheoStep;
use serde::Serialize;

#[derive(Serialize)]
pub struct ParasiticFilterResult {
    #[serde(rename = "filteredSteps")]
    pub filtered_steps: Vec<RheoStep>,
    #[serde(rename = "removedIds")]
    pub removed_ids: Vec<i32>,
    pub reasoning: Vec<String>,
}

pub fn filter_parasitic_steps(steps: &[RheoStep]) -> ParasiticFilterResult {
    let mut parasitic_ids: Vec<i32> = Vec::new();
    let mut reasoning: Vec<String> = Vec::new();

    // 1. Global scan
    for step in steps {
        if step.duration < 3.0 {
            parasitic_ids.push(step.id);
            reasoning.push(format!("Шаг {}: очень короткий (<3с), шум", step.id));
        }
    }

    // 2. Contextual analysis
    for i in 0..steps.len() {
        let current = &steps[i];
        if parasitic_ids.contains(&current.id) {
            continue;
        }

        let prev = if i > 0 { Some(&steps[i - 1]) } else { None };
        let next = if i < steps.len() - 1 { Some(&steps[i + 1]) } else { None };

        // A. Lead-in
        if let Some(next_step) = next {
            let rate_diff = (current.avg_shear_rate - next_step.avg_shear_rate).abs();
            let max_rate = current.avg_shear_rate.max(next_step.avg_shear_rate).max(1.0);
            let rel_diff = rate_diff / max_rate;

            if rel_diff < 0.20 && current.duration < 30.0 && next_step.duration > 50.0 {
                parasitic_ids.push(current.id);
                reasoning.push(format!("Шаг {}: переходный перед смешиванием", current.id));
                continue;
            }
        }

        // B. Trailing noise
        if let Some(prev_step) = prev {
            let rate_diff = (current.avg_shear_rate - prev_step.avg_shear_rate).abs();
            let max_rate = current.avg_shear_rate.max(prev_step.avg_shear_rate).max(1.0);
            let rel_diff = rate_diff / max_rate;

            if rel_diff < 0.20 && current.duration < 15.0 && prev_step.duration > 50.0 {
                parasitic_ids.push(current.id);
                reasoning.push(format!("Шаг {}: шум после смешивания", current.id));
                continue;
            }
        }

        // C. Sandwiched
        if prev.is_some() && next.is_some() && current.duration <= 5.0 {
            parasitic_ids.push(current.id);
            reasoning.push(format!("Шаг {}: переход ({:.1}с)", current.id, current.duration));
            continue;
        }

        // D. 95 s-1 outlier
        if (current.avg_shear_rate - 95.0).abs() < 5.0 && current.duration < 40.0 {
            let has_better_mixing = steps.iter().any(|s| (s.avg_shear_rate - 100.0).abs() < 5.0 && s.duration > 50.0);
            if has_better_mixing {
                parasitic_ids.push(current.id);
                reasoning.push(format!("Шаг {}: артефакт ~95 с-1", current.id));
                continue;
            }
        }

        // E. Advanced Universal
        if let (Some(prev_step), Some(next_step)) = (prev, next) {
            if current.duration < 25.0 {
                let prev_rate = prev_step.avg_shear_rate;
                let next_rate = next_step.avg_shear_rate;
                let curr_rate = current.avg_shear_rate;

                let min_neighbor = prev_rate.min(next_rate);
                let max_neighbor = prev_rate.max(next_rate);

                let is_in_between = curr_rate > min_neighbor + 2.0 && curr_rate < max_neighbor - 2.0;

                let close_to_prev = (curr_rate - prev_rate).abs() < 10.0;
                let close_to_next = (curr_rate - next_rate).abs() < 10.0;
                let is_not_exact_match = !close_to_prev && !close_to_next;

                let avg_neighbor_duration = (prev_step.duration + next_step.duration) / 2.0;
                let is_very_short = current.duration < 10.0;
                let is_relatively_short = current.duration < avg_neighbor_duration * 0.4;

                let should_filter = (is_in_between && (is_very_short || is_relatively_short)) ||
                                    (is_very_short && is_not_exact_match);

                if should_filter {
                    parasitic_ids.push(current.id);
                    reasoning.push(format!("Шаг {}: переходный ({:.0} s-1 между {:.0} и {:.0}, {:.0}с)", 
                        current.id, curr_rate, prev_rate, next_rate, current.duration));
                    continue;
                }
            }
        }
    }

    // Filter
    // De-duplicate ids
    parasitic_ids.sort();
    parasitic_ids.dedup();

    let filtered_steps: Vec<RheoStep> = steps.iter()
        .filter(|s| !parasitic_ids.contains(&s.id))
        .cloned()
        .collect();

    ParasiticFilterResult {
        filtered_steps,
        removed_ids: parasitic_ids,
        reasoning,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_step(id: i32, start: f64, duration: f64, rate: f64) -> RheoStep {
        RheoStep {
            id,
            start_time: start,
            end_time: start + duration,
            duration,
            avg_shear_rate: rate,
            avg_shear_stress: rate * 0.1,
            avg_viscosity: 100.0,
            avg_temperature: 25.0,
            avg_pressure: 0.0,
            points: vec![],
            calc_points_count: 10,
            is_ramp: false,
            start_index: 0,
            end_index: 10,
            is_split_start: false,
        }
    }

    #[test]
    fn test_filter_very_short_steps() {
        let steps = vec![
            create_test_step(1, 0.0, 2.0, 100.0),   // Too short (<3s)
            create_test_step(2, 2.0, 30.0, 75.0),   // Normal
            create_test_step(3, 32.0, 1.5, 50.0),   // Too short  
        ];
        
        let result = filter_parasitic_steps(&steps);
        
        assert!(result.removed_ids.contains(&1));
        assert!(result.removed_ids.contains(&3));
        assert_eq!(result.filtered_steps.len(), 1);
    }

    #[test]
    fn test_filter_lead_in_step() {
        let steps = vec![
            create_test_step(1, 0.0, 20.0, 100.0),  // Lead-in (short, similar rate to next)
            create_test_step(2, 20.0, 120.0, 100.0), // Long mixing step
        ];
        
        let result = filter_parasitic_steps(&steps);
        
        // First step is a lead-in before long mixing
        assert!(result.removed_ids.contains(&1));
    }

    #[test]
    fn test_filter_trailing_noise() {
        let steps = vec![
            create_test_step(1, 0.0, 120.0, 100.0), // Long mixing
            create_test_step(2, 120.0, 10.0, 100.0), // Short trailing noise
        ];
        
        let result = filter_parasitic_steps(&steps);
        
        // Second step is trailing noise after long mixing
        assert!(result.removed_ids.contains(&2));
    }

    #[test]
    fn test_filter_sandwiched_step() {
        let steps = vec![
            create_test_step(1, 0.0, 30.0, 100.0),
            create_test_step(2, 30.0, 4.0, 75.0),   // Sandwiched (<=5s)
            create_test_step(3, 34.0, 30.0, 50.0),
        ];
        
        let result = filter_parasitic_steps(&steps);
        
        assert!(result.removed_ids.contains(&2));
    }

    #[test]
    fn test_no_filtering_for_valid_steps() {
        let steps = vec![
            create_test_step(1, 0.0, 60.0, 100.0),
            create_test_step(2, 60.0, 60.0, 75.0),
            create_test_step(3, 120.0, 60.0, 50.0),
        ];
        
        let result = filter_parasitic_steps(&steps);
        
        assert_eq!(result.removed_ids.len(), 0);
        assert_eq!(result.filtered_steps.len(), 3);
    }

    #[test]
    fn test_reasoning_messages() {
        let steps = vec![
            create_test_step(1, 0.0, 2.0, 100.0),  // Too short
        ];
        
        let result = filter_parasitic_steps(&steps);
        
        assert!(result.reasoning.len() > 0);
        assert!(result.reasoning[0].contains("3с"));
    }
}

