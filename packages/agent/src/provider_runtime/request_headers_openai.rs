use super::request_headers_common::content_type_json_header;

pub(crate) fn openai_compat_headers() -> Vec<(String, String)> {
    vec![content_type_json_header()]
}
