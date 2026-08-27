# The node comes back by itself

**Status:** design approved 2026-08-27. Implements ISS-172.

## What forced this

MEASURED 2026-08-26/27, with this session's own evidence: the operator rebooted his machine
mid-session and the node did not come back. `refarm check --next-action` answered
`runtime:not-ready` and a human had to run `refarm runtime ensure --wait`.

    uptime -s                       2026-08-25 23:13:31
    refarm-web-serve.service        ExecMainStartTimestamp 23:13:42, NRestarts=0
    tractor daemon (pid 925716)     ELAPSED 13:14 at 2026-08-27 03:50 -> started BY HAND

`refarm web serve` came back eleven seconds after a cold boot, with nobody logged in. The daemon
that IS the control plane did not, because nothing declares it.

The spec `2026-08-05-what-executes-a-declared-automation-design.md` said so twenty days earlier and
nothing moved.

## What already exists, measured

Every row below was measured on this node on 2026-08-27, not inferred.

| fact | value | why it matters |
| --- | --- | --- |
| `loginctl show-user` | `Linger=yes` | user units start at BOOT, without a login. The prerequisite is already satisfied. |
| `refarm process status --json` | emits `supervised: true`, `backend: "systemd-user"` per process | the "is it supervised" fact already exists and needs no new detector |
| generated unit naming | `refarm-<name>.service` | `web-serve` -> `refarm-web-serve.service` |
| `autostart` in config | `always`, and it is DEMAND-driven | a command that needs the runtime starts it; it is not a boot autostart, so it does not race a supervisor |
| `runtimeNodeArgs(refarmHome)` | pure, derives `--plugin` per installed plugin then `--refarm-dir` | the plugin list is COMPUTED, never stored |
| `packages/tractor/src/daemon/shutdown.rs` | SIGINT and SIGTERM resolve to one `drain_for_shutdown` | a supervisor's SIGTERM is already the graceful path |
| systemd, measured with a throwaway unit | explicit `systemctl stop` leaves a `Restart=always` unit `inactive`; `kill -9` restores it (`NRestarts=1`) | operator intent is honoured, a crash is healed -- no flag needed to get both |

## The two forces that decide the design

### F1 -- a frozen argv freezes the plugin set

`refarm runtime status --json` reports:

    tractor --plugin ~/.refarm/plugins/refarm_agent/plugin.wasm \
            --plugin ~/.refarm/plugins/refarm_lsp-code-ops/plugin.wasm \
            --refarm-dir ~/.refarm

Writing THAT STRING into a unit file freezes the plugin list at the moment of writing. Install a
third plugin and the node that returns from a reboot loads two, while `refarm plugin status` --
which reads the live channel list -- reports honestly about a daemon running a different set. A
correct model, a correct consumer, and a hand-copied projection between them that stops tracking.

This is the repository's most expensive recurring shape and it must not be repeated in systemd.
The rule this spec adopts:

> A unit file stores the CALL that derives its arguments, never the derived arguments.

### F2 -- refarm proposes systemctl lines, it does not run them

`apps/refarm/src/commands/process.ts` states the boundary and names its precedent:

> WHAT THIS COMMAND DOES NOT DO, deliberately: it never runs `systemctl --user enable`, `start` or
> `stop`. [...] refarm does the part that can be shown, reviewed and undone, and does not reach
> into a running session on the operator's behalf.

So `refarm runtime stop` may not acquire the authority `refarm process install` declined. Under
supervision it REFUSES and hands over the exact line.

## Decisions

### D1 -- a foreground start verb that re-derives at every start

Add `refarm runtime start --foreground`.

It resolves engine selection and `runtimeNodeArgs(refarmHome)` at CALL time, launches the runtime
binary with `stdio: "inherit"`, stays alive as its parent, and exits with the child's exit code.
It never daemonises, never writes a pid file for itself, and prints nothing the existing
background start does not.

WHY A PARENT AND NOT A REPLACEMENT: Node cannot replace its own process image (there is no
`execve` binding), so the wrapper is a real process. That has one consequence the implementation
must handle, D2b below.

WHY NOT A GENERATED WRAPPER SCRIPT: a script regenerated on plugin install is a derived value
stored at install time -- F1 again, one layer down. The derivation must happen when the daemon
starts.

IT CARRIES THE ENVIRONMENT TOO, and this was measured after the spec's first draft. The launcher
prefers `scripts/tractor-start.sh` where it exists, and that script does more than assemble
arguments: it evaluates `refarm model env --shell --include-secrets` before `exec`. An INSTALLED
node has no repo scripts and takes the PATH fallback, which carries arguments only. Measured
2026-08-19 and recorded in `runtime-node-env.ts`:

    the runtime came up healthy, with the right plugins and the right sovereign directory,
    and refused every dispatch --
    [blocked: ... declared provider 'github-copilot', which this node did not authorise]

So `--foreground` resolves `await runtimeNodeEnv()` and hands it to the child, exactly as
`runtime start | ensure | restart` already do. A unit that ran the raw argv would not merely freeze
the plugin set (F1) -- it would supervise a node that reports `ready` and can do nothing, which is
the worst failure shape available because the supervisor would keep it alive.

THIS IS ALSO WHY D4 IS NOT A FREE PASS. Autostart's own spawn does NOT carry that environment
today (ISS-177, filed 2026-08-27). Supervision narrows the blast radius to unsupervised hosts; it
does not fix it. The order is: fix the environment, then supervise.

### D2 -- `runtime stop` and `runtime restart` refuse under supervision

Both consult the `supervised` fact already emitted by `refarm process status --json` for the
declared daemon process. When it is `true`:

    refarm runtime stop     -> refuses, hands over `systemctl --user stop refarm-runtime.service`
    refarm runtime restart  -> refuses, hands over `systemctl --user restart refarm-runtime.service`

The refusal uses the existing `ProcessHandoffRefusal` shape, which exists for exactly this case:
"there is exactly one command that fixes it, and the refusal should hand it over rather than
describe it."

When `supervised` is false, both behave exactly as they do today. `stopRuntimeProcess` is
unchanged.

WHY REFUSING IS BETTER THAN RUNNING IT: today `runtime stop` sends SIGTERM by pid. Under
`Restart=always` that reads as a crash and the daemon returns in five seconds -- the operator's
intent silently defeated. Refusing is not friction; it is the only honest answer once ownership
has moved, and it teaches WHERE it moved.

### D2b -- the wrapper forwards the stop signal

The generated unit template sets `KillMode=mixed`, which sends SIGTERM to the MAIN process only.
With D1's wrapper, the main process is the Node wrapper, not tractor. The wrapper must forward
SIGTERM and SIGINT to the child and then wait for it, so the daemon's existing
`drain_for_shutdown` runs. Without forwarding, `TimeoutStopSec=20` elapses and systemd SIGKILLs
the group -- turning the graceful path back into the hard kill `shutdown.rs` was written to end.

MEASURE BEFORE PINNING: the template's `TimeoutStopSec=20` was written for processes that drain
nothing. Whether a real drain finishes inside twenty seconds is UNKNOWN and the implementation
must measure it on this node before the number is accepted. If it does not fit, the number
changes with the measurement recorded beside it.

### D3 -- the declaration is an ordinary `processes` entry

The daemon is declared through `refarm process add` and installed through `refarm process
install`, the same path `web-serve` and `credential-renew` already use. No new install surface, no
`refarm runtime install`.

    name              runtime
    unit              refarm-runtime.service
    command           <refarm bin> runtime start --foreground
    workingDirectory  the operator's home
    restart           always

The declaration lands in `~/.refarm/config.json` where the operator can read it, and
`refarm process status` reports it beside the other two.

NOT NAMED `tractor`, deliberately: that file already carries a top-level `"tractor"` key meaning
engine selection. A `processes.tractor` would put two different things under one word in one file
-- the collision of intention this whole lane exists to remove. `runtime` also matches the verb
that manages it, so the refusal in D2 reads as one thought: `refarm runtime stop` hands over
`systemctl --user stop refarm-runtime.service`.

### D4 -- `autostart` is untouched

`autostart: always` is demand-driven: it fires when a command needs the runtime and finds it down.
Under supervision it never fires, because the daemon is up. It stays as the recovery path for an
unsupervised node -- a fresh checkout, another host, a unit deliberately stopped. Two owners would
be a race; a supervisor plus a demand-driven fallback is not.

### D5 -- the generated template's SIGTERM comment is stale for this process

The template writes:

    # Ordered termination comes from the supervisor, not from the process: refarm's processes
    # handle no SIGTERM today, so systemd asks, waits this long, then kills.

That is true of the Node processes it was written for and FALSE of tractor, which has handled
SIGTERM since `daemon/shutdown.rs`. Left as is, the next reader concludes the daemon is hard-killed
on every restart. The template gains a caveat naming the exception, or the comment is derived from
the process rather than fixed -- the implementation picks, and says which.

## Guards, and each must be SHOWN to fire

Per CLAUDE.md section 9, no guard lands until it has been observed failing.

1. **The argv is derived, not frozen.** A test that calls the `--foreground` argv builder twice
   against a fixture home, adding a plugin between the calls, and asserts the second argv contains
   the third `--plugin`. FIRED BY: pinning the argv to a constant -- the second assertion must go
   red naming the missing plugin.

2. **Stop refuses under supervision.** A test with `supervised: true` asserting `runtime stop`
   returns the refusal carrying the exact `systemctl --user stop refarm-runtime.service` string,
   and does NOT call `stopRuntimeProcess`. FIRED BY: flipping the branch to always stop -- the
   test must go red on the spy, not only on the message.

3. **SIGTERM reaches the daemon.** A test that starts the wrapper against a stub child, sends
   SIGTERM to the wrapper, and asserts the child received SIGTERM and the wrapper exited with the
   child's code. FIRED BY: removing the forwarder -- the child must be seen never receiving it.

4. **The node returns from a cold restart, measured on this node.** Not a unit test: stop the
   unit, `systemctl --user start refarm-runtime.service`, and assert `refarm runtime status --json`
   reports `ready: true` with the daemon's parent being systemd. The number that gets written into
   the ledger is the measured one.

## Out of scope

- `refarm node install` installing the unit. The declaration is the operator's, through consent.
- The answer half of ISS-077 and the handoff gap of ISS-173. Separate items, separate lanes.
- Supervising anything else. `web-serve` and `credential-renew` are already supervised; nothing
  else in this repo is a long-running process today.
