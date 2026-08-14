# GitHub identity for Refarm: two logins, one app

**Status:** reference. Nothing here is required to use Refarm today.
**Companion:** [`model-provider-strata.md`](model-provider-strata.md), the runtime contract this
serves. That document defines what a provider *is*; this one is what the operator does about it.
**Researched:** 2026-08-14, against GitHub's own documentation and against a live device-flow
request.

## Why this document exists

The operator asked whether GitHub and GitHub Copilot are the same login, whether registering an app
is required to use Copilot as a model provider, and whether an OAuth App must become a GitHub App.
All three have factual answers, and two had been answered wrongly in conversation before anyone
measured. This is the durable version, so the next person does not have to re-derive it.

## They are two logins, and the proof is what each one CANNOT do

Refarm authenticates the same GitHub account twice, for two unrelated purposes:

| | platform (`refarm sow --github`) | model provider (`github-copilot`) |
| --- | --- | --- |
| scope requested | `repo read:org` | `read:user` |
| can read your repositories | **yes** | **no** |
| can call the Copilot API | no | yes, after an exchange step |
| extra step after OAuth | none | exchange for a short-lived Copilot token |
| stored as | `githubToken`, flat in the silo | `oauthCredentials["github-copilot"]` |
| runtime variable | (none) | `GITHUB_COPILOT_ACCESS_TOKEN` |

This is not one login filed in two places. **Neither credential can do the other's job**, and that
is the point: revoking Refarm's repository access does not cost you the model quota, and revoking
the model credential does not cost you repository access.

Refarm's own vocabulary keeps them apart too. `github` is a CREDENTIAL provider; `github-copilot` is
a MODEL provider. `refarm sow --github` selects the first; `refarm sow --model-provider
github-copilot` selects the second. `packages/config/src/model-routing.js` lists `github-copilot`
among `SUBSCRIPTION_MODEL_PROVIDERS` and deliberately leaves it out of
`RUNTIME_SUBSCRIPTION_MODEL_PROVIDERS`.

## Scopes are per authorization, not per app

This is the fact that collapses the apparent problem. In a GitHub **OAuth App**, the scopes are
requested at authorization time, not configured on the app. One app can therefore carry both
logins, asking for `repo read:org` in one flow and `read:user` in the other, without either
inheriting the other's power.

So "two logins" does not imply "two apps".

## Where Refarm's app already is, and why you may not find it

Refarm ships a default client id in `apps/refarm/src/credentials/github.ts`:

```ts
// Device flow does not use a client_secret — this value is safe to commit.
const DEFAULT_CLIENT_ID = "Ov23lier7kyBcgIUQsih";
```

**The prefix tells you which kind of app it is, and therefore which menu it lives in:**

| prefix | kind | GitHub menu |
| --- | --- | --- |
| `Ov23…` | OAuth App | Settings → Developer settings → **OAuth Apps** |
| `Iv1.` / `Iv23…` | GitHub App | Settings → Developer settings → **GitHub Apps** |

Looking under **GitHub Apps** and finding nothing does not mean the app is missing. Refarm's is an
OAuth App.

Verified live on 2026-08-14: a device-code request with this client id and `scope=read:user`
returns a valid `device_code`, so **the app exists and has Device Flow enabled**. What that check
cannot tell you is *whose account owns it* — see "Is it yours?" below.

## Was registering it necessary?

**No, not to make Copilot work.** The reason is worth knowing, because it is the difference between
Refarm and the tools it is being compared to.

`@earendil-works/pi-ai` — the model library behind pi — does **not** register its own app. Read from
the installed package on 2026-08-14:

```js
const CLIENT_ID = decode("SXYxLmI1MDdhMDhjODdlY2ZlOTg=");   // → Iv1.b507a08c87ecfe98
const COPILOT_HEADERS = {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Copilot-Integration-Id": "vscode-chat",
};
```

That client id belongs to the Copilot editor-plugin family, not to pi, and it is base64-obfuscated
in the source. Together with those headers, **pi works by presenting itself as VS Code.**

So an own app is not a technical prerequisite. It is what lets Refarm say *"I am Refarm"* instead of
*"I am VS Code"*, and it is the only way the access does not depend on a borrowed identifier that
GitHub can fence without warning. That makes it a posture rather than a blocker, and one worth
taking deliberately rather than in a hurry.

The governing design says the same thing in stronger words: Refarm "refuses any dependency on
another product's OAuth client id, integration id, or version impersonation"
([`2026-08-06-account-aware-copilot-kimi-providers-design.md`](superpowers/specs/2026-08-06-account-aware-copilot-kimi-providers-design.md), D6a).

## Is it yours?

Confirmed 2026-08-14: **yes.** The operator registered `refarm` under his own **OAuth Apps**, and
`Ov23lier7kyBcgIUQsih` is that registration.

## The client-identity inventory, and what it reveals

Refarm ships three OAuth client ids. Only one of them is Refarm's:

| provider | client id | whose registration |
| --- | --- | --- |
| `github` (platform) | `Ov23lier7kyBcgIUQsih` | **Refarm's own OAuth App** |
| `anthropic` | `9d1c250a-e61b-44d9-88ed-5944d1962f5e` | pi's, and the source says so: *"Client ID is the Pi-validated OAuth App registered with Anthropic"* |
| `openai-codex` | `app_EMoamEEZ73f0CkXaXp7hrann` | the Codex CLI's own id |
| `github-copilot` | not built yet | would be Refarm's, reusing the GitHub App above |

So the GitHub App is not half a step. It is **the only sovereign client identity Refarm currently
has**, and the pattern to extend to the others. The criticism this document makes of pi's borrowed
Copilot id applies to Refarm's own Anthropic and Codex ids, and naming that here is cheaper than
discovering it during an incident.

## Does it need to become a GitHub App?

**No, and for this job the OAuth App is the better fit.** Researched against GitHub's own comparison
on 2026-08-14:

- **OAuth Apps are not deprecated.** There is no deprecation notice, they remain supported, and they
  are *required* for enterprise-level resources.
- GitHub prefers GitHub Apps for three stated reasons: *"fine-grained permissions, more control over
  which repositories the app can access, and short-lived tokens."* **None of the three applies to a
  login that requests `read:user` and touches no repository.**
- Token lifetime actively favours the OAuth App here. *"OAuth app tokens are long-lived by
  default"*, while GitHub App user tokens are short-lived. The Copilot flow wants exactly that: a
  durable outer GitHub token that it exchanges, repeatedly, for short-lived Copilot tokens. A short
  outer token would make unattended work impossible without re-authenticating.
- Both support user authentication, and GitHub's Copilot SDK documentation says of the choice:
  *"Both work. GitHub Apps offer finer-grained permissions and are recommended for new projects."*

Where a GitHub App would genuinely earn its place is the **platform** login, not the Copilot one:
`repo read:org` is a coarse grant, and fine-grained repository permissions are the reason GitHub
prefers Apps. That is a future refinement of one half, not a migration of the whole.

## Recreating the app if it is lost

The app is external infrastructure with no copy in this repository, and `refarm backup` cannot carry
it. If it is deleted, the client id changes and every operator's stored authorization stops working.
What must be true to recreate it is exactly the table below, plus this: it is registered on the
**personal account**, not an organization, and it grants nothing by itself — an OAuth App holds no
permissions, only the right to ask a user for scopes.

## The registration itself: what each field means

Settings → Developer settings → **OAuth Apps** → **New OAuth App**. This is the record of how
Refarm's app is configured, and therefore how to recreate it.

| field | what to put | what it actually does |
| --- | --- | --- |
| Application name | `refarm` | shown on the authorization screen you will see |
| **Homepage URL** | `https://github.com/aretw0/refarm` | **required by the form, not verified.** GitHub's documentation says only "type the full URL to your app's website", with nothing about reachability, ownership, or it being a real site. A repository URL is fine, and Refarm's `package.json` already declares `https://refarm.dev`. |
| Authorization callback URL | the same URL | required by the form; **device flow never uses it** |
| Webhook → Active | **unchecked** | Refarm receives no events |
| **Enable Device Flow** | **checked** | the only checkbox that changes behaviour. It is what allows login by typing a code, with no browser on the machine, and therefore what lets you authenticate a headless node, or from a phone. |

There is no scope field. Scopes are requested per authorization, as above.

No client secret is needed: the device flow does not use one, which is why the client id above is
safe to commit.

After creating it, point Refarm at it — either in `~/.refarm/config.json`:

```json
{ "providers": { "github": { "clientId": "Ov23…" } } }
```

or with `REFARM_PROVIDER_GITHUB_CLIENT_ID=Ov23…`.

## The question an own app does not answer — answered, 2026-08-14

Registering your own app makes refarm's identity sovereign. It does **not** make GitHub accept that
identity at the Copilot token exchange, and now we know it does not:

```
refarm sow --model-provider github-copilot --alias pessoal
  → device flow completed, GitHub issued a user token
  → GitHub did not accept this identity at copilot_internal/v2/token (HTTP 403)
```

**403, not 401.** That distinction is the whole finding. 401 would mean the token was invalid; 403
means authenticated and *not authorised*. Refarm's OAuth App works — the device flow completed and
GitHub issued the user token. The undocumented exchange is what declines, which confirms the
hypothesis that it honours some client identities and not others.

The node was untouched: no secret written, no catalog created, the existing credential still valid.
The write order — secret, then descriptor, then retire the legacy entry — put the refusal before the
first write.

## Three ways forward, and they are TWO axes, not three options

This is the distinction that keeps the feature from becoming three implementations:

**Same transport, different identity.** Refarm's own identity, an imitated editor client, and a
granted integration id all use the same endpoint, the same device flow, the same token parsing and
the same refresh. They differ in a client id and three headers. So the identity is a **declared
profile**, and the adapter does not change shape.

**A different axis entirely.** The official Copilot SDK/CLI owns the agent loop: it is a runtime,
not a model transport. The governing design forbids presenting the two as implementations of one
adapter, and refarm does not. It will arrive as its own capability, with its own consent and
sessions, or not at all.

## The identity profile

Declared in `.refarm/config.json`, and **defaulting to refarm's own identity** — the one measured at
403 — because imitation must be chosen rather than inherited.

| value | what refarm presents | status |
| --- | --- | --- |
| *(absent)* / `refarm` | refarm's OAuth App, `User-Agent: refarm/<version>` | honest; **measured 403** at the exchange |
| `editor-imitation` | the Copilot editor plugin's client id and its version headers | works; a risk the operator accepts explicitly |
| `integration` + `integrationId` | refarm's OWN client id, with the granted id in `Copilot-Integration-Id` | sovereign and authorised, once GitHub grants one |

Declared by hand in `~/.refarm/config.json`, which is the path that always works
(`declaring-is-authoring`, A2):

```jsonc
{
  "providers": {
    "githubCopilot": {
      "identity": "editor-imitation"
      // later, once an id is granted:
      // "identity": "integration", "integrationId": "refarm-cli"
    }
  }
}
```

`refarm config set` does not accept these keys yet — it holds a deliberately small typed allowlist,
and refusing an unknown key is the behaviour that told us so rather than writing something nobody
validates.

Four rules the implementation enforces, each because the opposite is a real failure:

- **Every unrecognised or half-declared value falls back to refarm's own identity.** Falling back to
  imitation would let a typo impersonate another product; an empty integration id would send a
  header that means nothing. Failing visibly at the exchange is better than either.
- **Both halves or neither.** A borrowed client id without its matching headers, or the reverse, is
  a shape no real client sends: it impersonates *and* it fails.
- **A granted id keeps refarm's own client id.** Pairing a granted id with a borrowed client id
  would be imitation wearing a licence.
- **The node says which profile is in use**, in `refarm credential list`, including when no
  credential exists yet — which is exactly when it matters, because the profile governs the login
  that has not happened.

## What is still open

- Whether the imitation route keeps working, and for how long. It reaches an undocumented endpoint
  by presenting another product's identity; GitHub may fence it without notice, and that is the
  stated risk rather than a surprise.
- Whether an integration id can be requested at all through a public channel. If it can, it is the
  only route that is both sovereign and supported.
- The SDK/CLI runtime track, which is unbuilt and is a different axis. It remains Public Preview,
  and its own repository says it may not be suitable for production.

## Sources

- [Creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
- [Copilot SDK — GitHub OAuth setup](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth)
- [No supported public API for individual Copilot usage — community discussion #185848](https://github.com/orgs/community/discussions/185848)
