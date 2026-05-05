use super::*;

#[test]
fn llm_system_env_var_is_readable() {
    std::env::set_var("LLM_SYSTEM", "You are a test agent.");
    let val = std::env::var("LLM_SYSTEM").unwrap();
    assert_eq!(val, "You are a test agent.");
    std::env::remove_var("LLM_SYSTEM");
}

#[test]
fn llm_system_absent_does_not_panic() {
    std::env::remove_var("LLM_SYSTEM");
    // react() uses default system prompt when LLM_SYSTEM is unset — must not panic on native stub
    let (content, _, _, _, _, _, _, _) = react("ping");
    assert!(!content.is_empty());
}
