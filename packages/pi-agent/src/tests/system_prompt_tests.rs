use super::*;

#[test]
fn model_system_env_var_is_readable() {
    std::env::set_var("MODEL_SYSTEM", "You are a test agent.");
    let val = std::env::var("MODEL_SYSTEM").unwrap();
    assert_eq!(val, "You are a test agent.");
    std::env::remove_var("MODEL_SYSTEM");
}

#[test]
fn model_system_absent_does_not_panic() {
    std::env::remove_var("MODEL_SYSTEM");
    // react() uses default system prompt when MODEL_SYSTEM is unset — must not panic on native stub
    let (content, _, _, _, _, _, _, _) = react("ping");
    assert!(!content.is_empty());
}
