pub(crate) fn parse_response_json(bytes: &[u8]) -> Result<serde_json::Value, String> {
    serde_json::from_slice(bytes).map_err(|e| format!("parse: {e}"))
}
