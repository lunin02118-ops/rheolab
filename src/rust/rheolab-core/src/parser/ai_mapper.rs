use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use wasm_bindgen_futures::JsFuture;

#[derive(Serialize)]
pub struct AIMappingRequest {
    pub headers: Vec<String>,
    pub model: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Deserialize)]
pub struct AIMappingResponse {
    pub mapping: Option<HashMap<String, usize>>,
    pub error: Option<String>,
}

pub async fn call_ai_mapper(
    callback: &js_sys::Function,
    headers: Vec<String>,
    model: Option<String>,
    api_key: Option<String>,
) -> Result<HashMap<String, usize>, String> {
    let request = AIMappingRequest {
        headers,
        model,
        api_key,
    };

    let js_request = serde_wasm_bindgen::to_value(&request)
        .map_err(|e| format!("Failed to serialize request: {}", e))?;

    let this = JsValue::NULL;
    let promise = callback
        .call1(&this, &js_request)
        .map_err(|e| format!("Callback call failed: {:?}", e))?;

    let result = JsFuture::from(js_sys::Promise::from(promise))
        .await
        .map_err(|e| format!("Promise rejected: {:?}", e))?;

    let response: AIMappingResponse = serde_wasm_bindgen::from_value(result)
        .map_err(|e| format!("Failed to deserialize response: {}", e))?;

    if let Some(err) = response.error {
        return Err(err);
    }

    response.mapping.ok_or_else(|| "No mapping returned".to_string())
}
