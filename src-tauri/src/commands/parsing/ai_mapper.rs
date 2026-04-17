use std::collections::{BTreeMap, HashMap};

use async_trait::async_trait;
use rheolab_core::parser::types::{AiContextCandidate, AiMappedColumn, AiMappingResponse};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

pub const DEFAULT_GROQ_MODEL: &str = "meta-llama/llama-4-scout-17b-16e-instruct";
pub const GROQ_PROMPT_VERSION: &str = "2026-03-17.ai-column-mapper.v1";

const ALLOWED_FIELDS: &[&str] = &[
    "time_sec",
    "viscosity_cp",
    "temperature_c",
    "bath_temperature_c",
    "speed_rpm",
    "shear_rate_s1",
    "shear_stress_pa",
    "pressure_bar",
];

#[async_trait]
pub trait AiColumnMapper: Send + Sync {
    async fn map_columns(
        &self,
        candidates: &[AiContextCandidate],
        requested_model: Option<&str>,
    ) -> Result<AiMappingResponse>;

    fn provider_name(&self) -> &'static str;
    fn prompt_version(&self) -> &'static str;
    fn resolve_model_name(&self, requested_model: Option<&str>) -> String;
}

#[derive(Debug, Clone)]
pub struct GroqAiColumnMapper {
    api_key: String,
}

impl GroqAiColumnMapper {
    pub fn new(api_key: String) -> Self {
        Self { api_key }
    }
}

#[derive(Debug, Clone)]
pub struct StubAiColumnMapper {
    response: std::result::Result<AiMappingResponse, String>,
    model_name: String,
}

impl StubAiColumnMapper {
    pub fn success(response: AiMappingResponse) -> Self {
        Self {
            response: Ok(response),
            model_name: "stub-ai-column-mapper".to_string(),
        }
    }

    pub fn failure(message: impl Into<String>) -> Self {
        Self {
            response: Err(message.into()),
            model_name: "stub-ai-column-mapper".to_string(),
        }
    }

    pub fn with_model_name(mut self, model_name: impl Into<String>) -> Self {
        self.model_name = model_name.into();
        self
    }
}

#[async_trait]
impl AiColumnMapper for StubAiColumnMapper {
    async fn map_columns(
        &self,
        _candidates: &[AiContextCandidate],
        _requested_model: Option<&str>,
    ) -> Result<AiMappingResponse> {
        self.response.clone().map_err(AppError::Parse)
    }

    fn provider_name(&self) -> &'static str {
        "stub"
    }

    fn prompt_version(&self) -> &'static str {
        "stub"
    }

    fn resolve_model_name(&self, _requested_model: Option<&str>) -> String {
        self.model_name.clone()
    }
}

#[async_trait]
impl AiColumnMapper for GroqAiColumnMapper {
    async fn map_columns(
        &self,
        candidates: &[AiContextCandidate],
        requested_model: Option<&str>,
    ) -> Result<AiMappingResponse> {
        if candidates.is_empty() {
            return Err(AppError::Parse("AI context candidates are empty".to_string()));
        }

        #[derive(Serialize)]
        struct Message {
            role: String,
            content: String,
        }

        #[derive(Serialize)]
        struct ChatRequest {
            model: String,
            messages: Vec<Message>,
            temperature: f32,
            max_tokens: u32,
            response_format: ResponseFormat,
        }

        #[derive(Serialize)]
        struct ResponseFormat {
            #[serde(rename = "type")]
            kind: &'static str,
        }

        #[derive(Deserialize)]
        struct ChatChoice {
            message: ChatMessage,
        }

        #[derive(Deserialize)]
        struct ChatMessage {
            content: String,
        }

        #[derive(Deserialize)]
        struct ChatResponse {
            choices: Vec<ChatChoice>,
        }

        let prompt = build_prompt(candidates)?;
        let body = ChatRequest {
            model: self.resolve_model_name(requested_model),
            messages: vec![
                Message {
                    role: "system".to_string(),
                    content: "You are a rheology data parsing assistant. Respond only with valid JSON that follows the requested schema.".to_string(),
                },
                Message {
                    role: "user".to_string(),
                    content: prompt,
                },
            ],
            temperature: 0.0,
            max_tokens: 800,
            response_format: ResponseFormat { kind: "json_object" },
        };

        let client = reqwest::Client::new();
        let response = client
            .post("https://api.groq.com/openai/v1/chat/completions")
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(AppError::Parse(format!("Groq API error {}: {}", status, text)));
        }

        let chat: ChatResponse = response.json().await?;
        let raw = chat
            .choices
            .first()
            .map(|choice| choice.message.content.trim().to_string())
            .unwrap_or_default();

        parse_ai_mapping_response(&raw, candidates)
    }

    fn provider_name(&self) -> &'static str {
        "groq"
    }

    fn prompt_version(&self) -> &'static str {
        GROQ_PROMPT_VERSION
    }

    fn resolve_model_name(&self, requested_model: Option<&str>) -> String {
        requested_model.unwrap_or(DEFAULT_GROQ_MODEL).to_string()
    }
}

fn build_prompt(candidates: &[AiContextCandidate]) -> Result<String> {
    let candidates_json = serde_json::to_string(candidates)?;
    let allowed_fields_json = serde_json::to_string(ALLOWED_FIELDS)?;

    Ok(format!(
        "Map rheology file columns to canonical fields.\n\
Return only valid JSON without markdown.\n\
Schema:\n\
{{\n  \"selected_candidate\": <integer>,\n  \"mapping\": {{\n    \"time_sec\": {{ \"index\": 0, \"confidence\": 0.99 }}\n  }}\n}}\n\
Rules:\n\
- selected_candidate must be one of the provided candidates.\n\
- mapping keys may only be these canonical fields: {allowed_fields_json}\n\
- index is a zero-based column index from the selected candidate header row.\n\
- confidence is optional and must be between 0 and 1.\n\
- Do not invent fields. Omit fields you cannot identify confidently.\n\
- Prefer the candidate that looks like the real raw-data table, not metadata blocks.\n\
- Use unit_row and sample_rows to distinguish sample temperature vs bath/heater temperature.\n\
- time_sec may be seconds, minutes, hh:mm:ss, or Excel-exported variants; still map the time column itself.\n\
Candidates JSON:\n{candidates_json}\n"
    ))
}

pub(crate) fn parse_ai_mapping_response(
    raw_content: &str,
    candidates: &[AiContextCandidate],
) -> Result<AiMappingResponse> {
    #[derive(Debug, Deserialize)]
    struct RawAiMappingResponse {
        selected_candidate: usize,
        mapping: HashMap<String, AiMappedColumn>,
    }

    let clean = raw_content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let raw: RawAiMappingResponse = serde_json::from_str(clean)
        .map_err(|error| AppError::Parse(format!("AI response JSON parse error: {} (raw: {})", error, clean)))?;

    let response = AiMappingResponse {
        selected_candidate: raw.selected_candidate,
        mapping: raw.mapping.into_iter().collect::<BTreeMap<_, _>>(),
    };
    validate_ai_mapping_response(&response, candidates)?;
    Ok(response)
}

pub(crate) fn validate_ai_mapping_response(
    response: &AiMappingResponse,
    candidates: &[AiContextCandidate],
) -> Result<()> {
    if response.selected_candidate >= candidates.len() {
        return Err(AppError::Parse(format!(
            "AI selected_candidate {} is out of range for {} candidates",
            response.selected_candidate,
            candidates.len()
        )));
    }

    if response.mapping.is_empty() {
        return Err(AppError::Parse("AI returned an empty mapping".to_string()));
    }

    let header_len = candidates[response.selected_candidate].header_cells.len();
    let mut seen_indexes: HashMap<usize, String> = HashMap::new();

    for (field, column) in &response.mapping {
        if !ALLOWED_FIELDS.contains(&field.as_str()) {
            return Err(AppError::Parse(format!(
                "AI returned unsupported canonical field '{}'",
                field
            )));
        }

        if column.index >= header_len {
            return Err(AppError::Parse(format!(
                "AI mapped field '{}' to out-of-range column index {} (header has {} columns)",
                field,
                column.index,
                header_len
            )));
        }

        if let Some(confidence) = column.confidence {
            if !(0.0..=1.0).contains(&confidence) {
                return Err(AppError::Parse(format!(
                    "AI returned invalid confidence {} for field '{}'",
                    confidence,
                    field
                )));
            }
        }

        if let Some(existing_field) = seen_indexes.insert(column.index, field.clone()) {
            return Err(AppError::Parse(format!(
                "AI assigned duplicate column index {} to '{}' and '{}'",
                column.index,
                existing_field,
                field
            )));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rheolab_core::parser::types::{AiContextCandidate, AiContextRow, ColumnMapping};

    fn sample_candidate() -> AiContextCandidate {
        AiContextCandidate {
            source_sheet: Some("Raw".to_string()),
            section_start_row: 10,
            header_row_index: 12,
            header_cells: vec![
                "Time".to_string(),
                "Viscosity".to_string(),
                "Temp".to_string(),
                "Pressure".to_string(),
            ],
            unit_row: Some(AiContextRow {
                row_index: 13,
                cells: vec!["s".to_string(), "cP".to_string(), "C".to_string(), "bar".to_string()],
            }),
            sample_rows: vec![AiContextRow {
                row_index: 14,
                cells: vec!["1".to_string(), "100".to_string(), "25".to_string(), "1".to_string()],
            }],
            instrument_hint: Some("BSL Model R1".to_string()),
            heuristic_mapping: ColumnMapping::default(),
        }
    }

    #[test]
    fn parse_ai_mapping_response_rejects_unknown_fields() {
        let error = parse_ai_mapping_response(
            r#"{"selected_candidate":0,"mapping":{"mystery":{"index":0,"confidence":0.9}}}"#,
            &[sample_candidate()],
        )
        .expect_err("unknown field must fail");

        assert!(error.to_string().contains("unsupported canonical field"));
    }

    #[test]
    fn parse_ai_mapping_response_rejects_duplicate_indexes() {
        let error = parse_ai_mapping_response(
            r#"{"selected_candidate":0,"mapping":{"time_sec":{"index":0,"confidence":0.9},"viscosity_cp":{"index":0,"confidence":0.8}}}"#,
            &[sample_candidate()],
        )
        .expect_err("duplicate indexes must fail");

        assert!(error.to_string().contains("duplicate column index"));
    }

    #[test]
    fn parse_ai_mapping_response_accepts_valid_payload() {
        let result = parse_ai_mapping_response(
            r#"{"selected_candidate":0,"mapping":{"time_sec":{"index":0,"confidence":0.99},"viscosity_cp":{"index":1,"confidence":0.95}}}"#,
            &[sample_candidate()],
        )
        .expect("valid payload should parse");

        assert_eq!(result.selected_candidate, 0);
        assert_eq!(result.mapping.get("time_sec").map(|field| field.index), Some(0));
        assert_eq!(result.mapping.get("viscosity_cp").map(|field| field.index), Some(1));
    }
}
