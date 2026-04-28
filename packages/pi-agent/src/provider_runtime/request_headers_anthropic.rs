use super::request_headers_common::content_type_json_header;

pub(crate) fn anthropic_headers() -> Vec<(String, String)> {
    vec![
        content_type_json_header(),
        ("anthropic-version".to_string(), "2023-06-01".to_string()),
    ]
}
