# Operating the node from a phone

Written 2026-08-28, after an operator spent an evening deriving these steps by hand to attempt
one thing: finish an OAuth re-authentication without walking to the PC. Nothing below is refarm's
own machinery, and all of it sits between an operator and using refarm from where they are.

Every number and every flag here was measured on a real node. Where something is NOT knowable
from the node, this document says so rather than guessing.

## First: does your case even need a tunnel?

It depends on the provider's OAuth flow, not on refarm.

| provider | flow | from a phone? |
| --- | --- | --- |
| GitHub / Copilot | device code (`urn:ietf:params:oauth:grant-type:device_code`) | **Yes, today, with no setup.** The node prints a code and a URL; you open the URL on any device and type the code. The node polls. |
| openai-codex | authorization code, `redirect_uri = http://localhost:1455/auth/callback` | Needs the callback to reach the node — see below |
| anthropic | authorization code, `redirect_uri = http://localhost:53692/callback` | same |

Device code exists precisely for machines with no browser — TVs, CLIs, headless nodes — so the
provider ACCEPTS that whoever authenticates is elsewhere. The other two assume the browser and the
process share a machine. That is a choice the provider made, and it is the whole reason one of
these rows is easy and two are not.

## Why a plain network relay does not work

The callback server binds loopback only:

    apps/refarm/src/credentials/oauth/callback-server.ts
    server.listen(port, "127.0.0.1", ...)

That is a deliberate restriction: the code that exchanges an authorization `code` for a token is
not reachable from the network. So pointing a phone at the node's tailnet IP hits a port that is
not listening there.

An `ssh -L` forward works because it originates the connection ON THE NODE'S OWN LOOPBACK. It
uses the door the restriction left open rather than going around it.

## The path, and who owns each step

### 1. On the node — offer SSH over the tailnet

    tailscale up --ssh

This changes the node's posture: it accepts SSH from your tailnet, authenticated by tailnet
identity rather than by keys. No `sshd` and no `termux-services` are needed on either side.

VERIFIABLE FROM THE NODE: `tailscale debug prefs` reports `RunSSH`.

### 2. In the admin console — permit it

`tailscale up --ssh` OFFERS SSH; the tailnet policy DECIDES it. Without a rule the attempt is
refused with a message that reads like a client problem and is not:

    tailscale: tailnet policy does not permit you to SSH as user "<you>"

At <https://login.tailscale.com/admin/acls>, add:

```json
"ssh": [
  {
    "action": "accept",
    "src":    ["autogroup:member"],
    "dst":    ["autogroup:self"],
    "users":  ["autogroup:nonroot", "<your-unix-user>"]
  }
]
```

`autogroup:self` restricts this to devices owned by the same person — your phone talking to your
PC, and nothing else.

NOT VERIFIABLE FROM THE NODE, and this is why it is a step rather than a check: the policy lives
on the coordination server. `tailscale status --json` does not carry it and the CLI does not expose
it. A node can report that it OFFERS SSH; whether the tailnet permits it is learned by trying, or
through the Tailscale API with a key.

### 3. On the phone — Termux

    pkg install openssh

You do NOT need `sshd` on the phone, and therefore not `termux-services` either. Termux suggests
them for running a server; here the phone is the CLIENT.

### 4. The forward, and the flow

    ssh -L 1455:localhost:1455 <you>@<node-hostname>

Then, in that same SSH session — so the command runs on the node while you stay on the phone:

    refarm sow --model-provider openai-codex --reconfigure

Open the URL it prints in the phone's browser. When the provider redirects to
`http://localhost:1455/auth/callback`, the forward carries it to the node and the exchange
completes.

Use `53692` instead of `1455` for anthropic; the paths differ too, but only the port matters to
the forward.

## When it fails, where to look

| symptom | what it means |
| --- | --- |
| `tailnet policy does not permit you to SSH as user "…"` | step 2 — the ACL rule is missing |
| SSH connects, browser says connection refused at `localhost:1455` | the forward is not up, or the flow on the node is not currently listening (the callback server runs only while `sow` waits) |
| the phone does not appear in `tailscale status` | Tailscale on the phone is disconnected — it drops off after long idle periods |

## What refarm could do about this, and has not

A node can measure steps 1, 3 and 4's prerequisites and cannot measure step 2. The honest shape
is therefore a report that checks what is local and HANDS OVER the exact snippet and URL for what
is not — the same boundary `refarm process install` draws when it writes a unit and hands over the
`systemctl` line rather than running it.

Tracked as ISS-180, together with the phone-setup scripts already being promoted in `coop-vault`,
because a third set of them would repeat exactly what this repository has spent a week removing.
