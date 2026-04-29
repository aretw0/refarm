use std::sync::Mutex;

static ENV_LOCK: Mutex<()> = Mutex::new(());

mod config_and_dedup;
mod usage_phase;
mod step_phase;
mod wire_format;
mod tool_phase;
mod loop_setup;
mod loop_runner;
mod response_contract;
mod state_contract_loops;
mod equivalence;
