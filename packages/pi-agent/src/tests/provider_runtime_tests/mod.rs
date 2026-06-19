use std::sync::Mutex;

static ENV_LOCK: Mutex<()> = Mutex::new(());

mod config_and_dedup;
mod equivalence_errors;
mod equivalence_paths;
mod loop_runner;
mod loop_setup;
mod response_contract;
mod state_contract_loops;
mod step_phase;
mod tool_phase;
mod usage_phase;
mod wire_format;
