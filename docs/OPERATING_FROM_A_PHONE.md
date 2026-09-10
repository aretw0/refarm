# Operating the node from a phone

Written 2026-08-28, after an operator spent an evening deriving these steps by hand to attempt
one thing: finish an OAuth re-authentication without walking to the PC. Nothing below is refarm's
own machinery, and all of it sits between an operator and using refarm from where they are.

Every number and every flag here was measured on a real node. Where something is NOT knowable
from the node, this document says so rather than guessing.

## Before any of this: you probably do not need a tunnel

refarm's OAuth flow accepts a PASTED redirect. Open the auth URL on the phone, authenticate, let
the browser fail to reach `localhost` — the address bar holds the `code` — and paste the whole URL
into the prompt. `parseCodeFromInput` takes either the full URL or a bare `code=...` fragment.

    callback-wait.ts   "falling back to pasted redirect URL"
                       "switching to pasted redirect URL" after the callback times out

What that still requires is somewhere to paste. Not a browser, not the network, not Tailscale — a
text field. Closing THAT is a consent-contract change (an answer that carries a value, ISS-081),
not infrastructure. Everything below is for the cases where a shell is genuinely what you want.

## Does your case even need a tunnel?

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

VERIFIABLE FROM THE NODE AFTER ALL, and this document said otherwise for a few hours. The policy
is pushed to every node as part of its netmap:

    tailscale debug netmap | jq .SSHPolicy

    rules[].principals   the node IPs allowed to originate — your phone's IP is either here or
                         it is not, and that is the whole question
    rules[].sshUsers     `{"*": "="}` maps any user to the same name, so a plain login works
    rules[].action       `holdAndDelegate` is CHECK MODE: Tailscale may ask you to approve the
                         session in a browser the first time. That is the policy working, not an
                         error.

`tailscale status --json` genuinely does not carry it, which is what the first draft measured and
then over-generalised into "the node cannot see the ACL". A probe that finds nothing has found
nothing in the place it looked.

WHAT IS STILL NOT VERIFIABLE is the policy SOURCE — the netmap shows the compiled rules this node
received, not the text in the admin console. Editing it remains a step at
<https://login.tailscale.com/admin/acls>.

A PROBE THAT DOES NOT WORK, so nobody repeats it: `tailscale ssh <this-node>` from the node to
ITSELF does not exercise the policy. Tailscale SSH intercepts connections from PEERS; a
self-connection reaches the real port 22, where there is no `sshd`, and answers
`connection refused`. That measures the absence of a daemon, not the presence of a rule.

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

## Answering from the phone, without any of the above

Measured 2026-08-28. A question that wants a VALUE — "paste the redirect URL" — now travels to a
declared channel and the answer travels back, so the tunnel section above is for people who
genuinely want a shell rather than for completing a re-authentication.

    REFARM_OAUTH_CALLBACK_MODE=manual refarm sow --model-provider openai-codex --reconfigure

The browser fails to reach `localhost` on the phone, which is expected; the address bar holds the
`code`. The question arrives in the channel with a reply box, and the answer must be a REPLY to
that message. A loose message in the chat is ignored on purpose: capturing "the next message"
would let any unrelated line — in a group, anyone else's — settle a pending question.

### Two steps, two different reasons, and only one needs an attention window

`refarm delivery test <channel>` needs NOTHING armed. It routes with `attending: true` because it
IS the operator attending: it asks before sending, every time.

`refarm sow` does, when the channel is declared `unattended: false`. That declaration is the
operator's own recorded answer to "does this channel reach you when you are NOT attending —
phone in a pocket, terminal closed?", and D8 honours it by skipping the channel unless a window
is open:

    refarm intention arm --profile mobile-ready --window-ms 900000   temporary, changes nothing
    refarm delivery add                                              rewrites the declaration

Prescribing the same preparation for both makes the first look like arbitrary ceremony. It is
not: one is attention present, the other is a command acting alone.
