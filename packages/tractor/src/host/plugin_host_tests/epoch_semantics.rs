// Epoch-interruption semantics proof suite.
//
// Before wiring effort-cancel to force-interrupt a wedged plugin via the epoch
// (SLICE 2), we must PROVE how the shared epoch clock behaves — it is a global
// footgun: `Engine::increment_epoch()` advances one clock for every store on
// that engine, so a naive "cancel = crank the epoch" would spuriously trap
// neighbouring plugins whose own budget has not elapsed.
//
// These tests establish, against the real wasmtime engine, the exact guarantees
// the force-interrupt design must honour. They operate on raw sync
// Engine/Store/Module (the P1 path) so the semantics are isolated from the rest
// of the host. Each proof is asserted, not assumed.
//
// Run: cargo test --lib host::plugin_host::tests::epoch_
//
// Wrapped in its own module so the wasmtime imports here can't collide with the
// sibling files include!()d into the same test module.

mod epoch_semantics {
// These proofs construct raw Store::new(&engine, ()) on purpose: they test the
// epoch primitive itself against a bare `()` data type that cannot even carry a
// HasEpochGuard, so the new_armed_store factory does not apply here.
#![allow(clippy::disallowed_methods)]
use wasmtime::{Config, Engine, Instance, Module, Store, Trap, TypedFunc, UpdateDeadline};

/// A module whose `spin` export busy-loops forever (no yield point). Only the
/// epoch can break it. `noop` returns immediately — a well-behaved guest.
const SPIN_WAT: &str = r#"
(module
  (func $spin (export "spin") (loop $l (br $l)))
  (func $noop (export "noop"))
)
"#;

fn epoch_engine() -> Engine {
    let mut config = Config::new();
    config.epoch_interruption(true);
    Engine::new(&config).expect("engine")
}

/// PROOF 1: with epoch_interruption on and NO deadline armed, any guest call
/// traps immediately (the default deadline is 0). This is why every store MUST
/// arm a deadline — the footgun that broke the lifecycle calls in SLICE 1.
#[test]
fn epoch_default_deadline_zero_traps_immediately() {
    let engine = epoch_engine();
    let module = Module::new(&engine, SPIN_WAT).unwrap();
    let mut store = Store::new(&engine, ());
    let instance = Instance::new(&mut store, &module, &[]).unwrap();
    // Call the WELL-BEHAVED noop — it would return instantly, but with no
    // deadline armed even it traps.
    let noop: TypedFunc<(), ()> = instance.get_typed_func(&mut store, "noop").unwrap();
    let result = noop.call(&mut store, ());
    assert_eq!(
        result.unwrap_err().downcast_ref::<Trap>(),
        Some(&Trap::Interrupt),
        "no deadline armed => immediate epoch trap even for a noop guest"
    );
}

/// PROOF 2: a spinning guest with a finite deadline traps once the global epoch
/// is advanced past that deadline — this is the SLICE 1 timeout mechanism.
#[test]
fn epoch_spin_traps_when_epoch_advances_past_deadline() {
    let engine = epoch_engine();
    let module = Module::new(&engine, SPIN_WAT).unwrap();
    let mut store = Store::new(&engine, ());
    let instance = Instance::new(&mut store, &module, &[]).unwrap();
    store.set_epoch_deadline(3); // trap after 3 ticks beyond current

    // Advance the epoch from another thread while the guest spins.
    let engine2 = engine.clone();
    let ticker = std::thread::spawn(move || {
        for _ in 0..10 {
            std::thread::sleep(std::time::Duration::from_millis(5));
            engine2.increment_epoch();
        }
    });

    let spin: TypedFunc<(), ()> = instance.get_typed_func(&mut store, "spin").unwrap();
    let result = spin.call(&mut store, ());
    ticker.join().unwrap();
    assert_eq!(
        result.unwrap_err().downcast_ref::<Trap>(),
        Some(&Trap::Interrupt),
        "a spinning guest traps once the epoch passes its deadline"
    );
}

/// PROOF 3 — THE CENTRAL FOOTGUN: `increment_epoch()` advances ONE clock shared
/// by every store on the engine. A store whose deadline is FAR in the future is
/// unaffected by an advance that only crosses a NEARER store's deadline — but
/// only because the guest reloads the (absolute) deadline and compares. This
/// proves that a "cancel = advance the epoch" scheme is safe for a neighbour
/// ONLY if the neighbour's absolute deadline stays beyond the advance. We prove
/// the danger directly: advancing the epoch past a neighbour's deadline DOES
/// trap the neighbour. Hence force-interrupt must NOT rely on cranking the
/// global epoch far enough to catch the target — it would catch neighbours too.
#[test]
fn epoch_advance_traps_every_store_whose_absolute_deadline_is_crossed() {
    let engine = epoch_engine();
    let module = Module::new(&engine, SPIN_WAT).unwrap();

    // Two independent stores ("plugins") on the SAME engine.
    let mut store_a = Store::new(&engine, ());
    let inst_a = Instance::new(&mut store_a, &module, &[]).unwrap();
    let mut store_b = Store::new(&engine, ());
    let inst_b = Instance::new(&mut store_b, &module, &[]).unwrap();

    // Both arm the SAME small relative deadline at the same current epoch.
    store_a.set_epoch_deadline(3);
    store_b.set_epoch_deadline(3);

    // Advance the epoch by 5 — past BOTH absolute deadlines.
    for _ in 0..5 {
        engine.increment_epoch();
    }

    // Store A spins → traps (deadline crossed).
    let spin_a: TypedFunc<(), ()> = inst_a.get_typed_func(&mut store_a, "spin").unwrap();
    let a = spin_a.call(&mut store_a, ());
    assert_eq!(
        a.unwrap_err().downcast_ref::<Trap>(),
        Some(&Trap::Interrupt),
        "store A traps: its deadline was crossed"
    );

    // Store B — a NEIGHBOUR that was NOT the cancel target — ALSO traps, because
    // the single global epoch crossed its absolute deadline too. THIS is the
    // footgun the force-interrupt design must avoid: you cannot crank the global
    // epoch to catch one plugin without catching every plugin whose deadline is
    // nearer than the crank distance.
    let spin_b: TypedFunc<(), ()> = inst_b.get_typed_func(&mut store_b, "spin").unwrap();
    let b = spin_b.call(&mut store_b, ());
    assert_eq!(
        b.unwrap_err().downcast_ref::<Trap>(),
        Some(&Trap::Interrupt),
        "PROOF: a neighbour whose absolute deadline is crossed ALSO traps — global epoch is shared"
    );
}

/// PROOF 4 — THE SAFE PRIMITIVE for force-interrupt: an `epoch_deadline_callback`
/// lets a store DECIDE, when its deadline is reached, whether to trap (`Err`) or
/// extend (`Continue`). This is the escape from PROOF 3's footgun: install a
/// callback that traps ONLY when this store's cancel flag is set, and otherwise
/// re-arms. Then advancing the global epoch wakes every store's callback, but a
/// non-cancelled neighbour re-arms (survives) while only the flagged target
/// traps. This is the mechanism SLICE 2 must use — proven here in isolation.
#[test]
fn epoch_callback_traps_only_flagged_store_survives_neighbour() {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let engine = epoch_engine();
    let module = Module::new(&engine, SPIN_WAT).unwrap();

    let flag_a = Arc::new(AtomicBool::new(false));
    let flag_b = Arc::new(AtomicBool::new(false));

    // Store A: the cancel target. Callback traps when flag_a is set.
    let mut store_a = Store::new(&engine, ());
    let inst_a = Instance::new(&mut store_a, &module, &[]).unwrap();
    let fa = flag_a.clone();
    store_a.epoch_deadline_callback(move |_ctx| {
        if fa.load(Ordering::SeqCst) {
            Err(Trap::Interrupt.into())
        } else {
            Ok(UpdateDeadline::Continue(1))
        }
    });
    store_a.set_epoch_deadline(1);

    // Store B: a neighbour. Same callback shape, flag never set → always re-arms.
    let mut store_b = Store::new(&engine, ());
    let inst_b = Instance::new(&mut store_b, &module, &[]).unwrap();
    let fb = flag_b.clone();
    store_b.epoch_deadline_callback(move |_ctx| {
        if fb.load(Ordering::SeqCst) {
            Err(Trap::Interrupt.into())
        } else {
            Ok(UpdateDeadline::Continue(1))
        }
    });
    store_b.set_epoch_deadline(1);

    // "Cancel" store A only.
    flag_a.store(true, Ordering::SeqCst);

    // A background ticker advances the global epoch so both callbacks fire
    // repeatedly. B must survive (keeps re-arming); A must trap.
    let engine2 = engine.clone();
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let ticker = std::thread::spawn(move || {
        while !stop2.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(2));
            engine2.increment_epoch();
        }
    });

    // Store A spins → its callback sees the flag → traps.
    let spin_a: TypedFunc<(), ()> = inst_a.get_typed_func(&mut store_a, "spin").unwrap();
    let a = spin_a.call(&mut store_a, ());
    assert_eq!(
        a.unwrap_err().downcast_ref::<Trap>(),
        Some(&Trap::Interrupt),
        "the flagged (cancelled) store traps via its callback"
    );

    // Store B: call the WELL-BEHAVED noop many times while the epoch keeps
    // advancing. Its callback always re-arms, so no call ever traps — the
    // neighbour is unharmed by the global epoch cranking that killed A.
    let noop_b: TypedFunc<(), ()> = inst_b.get_typed_func(&mut store_b, "noop").unwrap();
    for _ in 0..50 {
        noop_b
            .call(&mut store_b, ())
            .expect("neighbour store B must survive: its callback re-arms, never traps");
        std::thread::sleep(std::time::Duration::from_millis(1));
    }

    stop.store(true, Ordering::SeqCst);
    ticker.join().unwrap();
}
} // mod epoch_semantics
