import type { IncomingMessage, ServerResponse } from "node:http";

import { SAS_HTTP_BASE } from "@refarm.dev/emoji-sas-v1";

import {
	resolveBlockDistDir,
	resolvePackageAsset,
	serveBlockModule,
	servePackageAsset,
} from "./web-serve-block-lib.js";

/**
 * `/attend` — answering the farm's pending questions from a browser.
 *
 * The last of the three surfaces the pending-prompt design named: the terminal that
 * asked, the kit command in a pocket, and a browser. It adds NOTHING to the wire. Every
 * route it calls, every status it reads and every field it renders was already there and
 * already tested; what was missing was a surface, and what unblocked it was E3 — a
 * credential a page can hold because it is scoped, expiring and revocable on its own.
 *
 * ── WHERE THE PAGE LIVES, AND WHY NOT IN THE STATIC ROOT ─────────────────────────
 *
 * `refarm web serve`'s root IS the cold-bootstrap kit: `.refarm/dist/farm-client`, whose
 * `install.mjs` and `manifest.json` the operator's phone bootstraps from and whose
 * manifest `farm-update` polls on every run, on every device, forever.
 *
 * Putting the page there would mean three bad things and no good one:
 *
 *   1. it would enter `manifest.json`, so every enrolled device would download a page it
 *      will never open, and pay for the manifest change on the next update;
 *   2. it would not exist until `refarm dist publish` had been re-run — a page whose
 *      availability depends on a publishing step is a page that is missing exactly when
 *      someone reaches for it;
 *   3. it needs `/auth/sas/lib/index.js`, which is a ROUTE on this listener and not a
 *      file under any root, so half of it could not be served from the kit anyway.
 *
 * So it is a route, exactly as `/auth/verify` already is: a page that belongs to the
 * NODE, not to the kit. The kit is untouched — no new file, no manifest entry, no
 * `dist publish`, and cold bootstrap is byte-identical to what it was.
 *
 * ── THE THREE ROUTES, AND THE FOURTH THAT IS NOT HERE ────────────────────────────
 *
 *   - `GET /attend` — the page. Self-contained: inline CSS, inline module script, no
 *     CDN, no font, no framework. It has to work in a phone browser over a tailnet,
 *     which is a place with no second chance to fetch something.
 *   - `GET /attend/lib/*.js` — `@refarm.dev/attend-web-v1`'s compiled modules. The page
 *     imports the same reader, the same refusal classifier and the same view model that
 *     the tests run in Node.
 *   - the SAS exchange and its own lib are NOT re-mounted here; the page imports
 *     `/auth/sas/lib/index.js` from the surface that already owns it.
 *
 * `GET /prompts` and `POST /prompts/:id/answer` are not served here either, and that is
 * the point: they are the daemon's, and this listener PROXIES them (see
 * `SIDECAR_API_PREFIXES` in `web-serve.ts`). The page therefore calls them same-origin
 * with no CORS to arrange and no credential to widen, and the Rust gate — which reads
 * scoped credentials, and declares `prompt:answer` on exactly those two routes — remains
 * the only thing that decides whether the request is allowed.
 */

/** Where the page lives. */
export const ATTEND_PAGE_PATH = "/attend";
const ATTEND_LIB_PREFIX = `${ATTEND_PAGE_PATH}/lib/`;
const ATTEND_BLOCK = "@refarm.dev/attend-web-v1";
const OPERATION_LIB_PREFIX = `${ATTEND_PAGE_PATH}/operations-lib/`;
const OPERATION_BLOCK = "@refarm.dev/operation-web-v1";
const LOCALIZATION_LIB_PREFIX = `${ATTEND_PAGE_PATH}/localization-lib/`;
const LOCALIZATION_BLOCK = "@refarm.dev/localization-v1";
const DS_LIB_PREFIX = `${ATTEND_PAGE_PATH}/ds-lib/`;
const DS_ASSET_PREFIX = `${ATTEND_PAGE_PATH}/ds/`;
const DS_BLOCK = "@refarm.dev/ds";

export interface AttendSurface {
	/** Handle the request if it belongs to this surface. Returns whether it did. */
	handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean>;
}

/**
 * The page.
 *
 * Written as one string rather than a file on disk so that it cannot be half-deployed:
 * the page and the server that serves it ship in the same artifact, and there is no
 * arrangement under which a built `refarm` has one and not the other.
 *
 * Everything with judgement in it lives in `@refarm.dev/attend-web-v1` and is tested in
 * Node. What is left here is a builder too dumb to be wrong: it switches on
 * `view.control` and appends elements. That split is deliberate — it is what lets "each
 * prompt kind renders correctly" be a unit test rather than a claim about a browser
 * nobody watched.
 */
function attendPage(): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Pending questions — refarm</title>
<script type="importmap">{"imports":{"@refarm.dev/localization-v1":"${LOCALIZATION_LIB_PREFIX}index.js","@refarm.dev/ds/html":"${DS_LIB_PREFIX}html.js"}}</script>
<link rel="stylesheet" href="${DS_ASSET_PREFIX}tokens.css">
<link rel="stylesheet" href="${DS_ASSET_PREFIX}theme.css">
<link rel="stylesheet" href="${DS_ASSET_PREFIX}components.css">
<style>
  :root { color-scheme: light dark; font-family: system-ui, -apple-system, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 1rem; max-width: 40rem; margin-inline: auto; line-height: 1.5;
         background: var(--background); color: var(--foreground); }
  h1 { font-size: 1.2rem; margin: 0; }
  header { display: flex; flex-wrap: wrap; gap: .5rem 1rem; align-items: baseline;
           justify-content: space-between; padding-bottom: .75rem; border-bottom: 1px solid; }
  .muted { opacity: .7; font-size: .85rem; }
  #banner:empty { display: none; }
  #banner { margin: .75rem 0; padding: .6rem .8rem; border: 1px solid currentColor;
            border-radius: .4rem; }
  #banner.bad { color: #b3261e; }
  #banner.ok { color: #1a7f37; }
  .card { border: 1px solid; border-radius: .5rem; padding: .9rem; margin: .9rem 0; }
  .ds-operation-toolbar { display: flex; justify-content: flex-end; margin-block: .5rem; }
  .ds-operation-details { margin-block: .5rem; }
  .ds-operation-details summary { cursor: pointer; color: var(--muted-foreground); }
  .ds-operation-command { display: block; margin-top: .4rem; overflow-wrap: anywhere; }
  .ds-grid { grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr)); }
  .asker { font-size: .8rem; opacity: .75; font-family: ui-monospace, monospace;
           word-break: break-all; }
  .question { font-size: 1.05rem; margin: .4rem 0 .7rem; }
  .travels { border: 1px solid currentColor; border-radius: .4rem; padding: .5rem .7rem;
             margin-bottom: .7rem; font-size: .9rem; color: #8a5300; }
  .choice { display: block; margin: .3rem 0; }
  input[type=text], input[type=password] { width: 100%; padding: .55rem; font: inherit;
    border-radius: .4rem; border: 1px solid; background: transparent; color: inherit; }
  button:not(.ds-btn) { font: inherit; padding: .5rem 1rem; border-radius: .4rem; border: 1px solid;
                        background: transparent; color: inherit; cursor: pointer; margin: .25rem .4rem .25rem 0; }
  button[disabled] { opacity: .5; cursor: default; }
  .verdict { margin-top: .6rem; font-size: .9rem; }
  /* The seven emoji are COMPARED against another screen, position by position —
     they are a row to scan, not prose to read. So they are centred with equal
     space either side and equal-width cells, deliberately different from the
     left-aligned text around them, and each wrapped line stays centred on a
     narrow phone. */
  .row { display: flex; flex-wrap: wrap; justify-content: center; align-items: flex-start;
         gap: .9rem 1.1rem; margin: 1.4rem auto; }
  .cell { text-align: center; flex: 0 0 auto; min-width: 4.5rem; }
  .glyph { font-size: 2.2rem; line-height: 1.1; }
  .name { font-size: .75rem; opacity: .75; }
  code { font-family: ui-monospace, monospace; font-size: .85em; }
</style>
</head>
<body data-ds-theme="verde-jardim">
<header>
  <h1>refarm</h1>
  <div class="muted" id="credential">no credential yet</div>
</header>
<div id="banner"></div>
<div id="operations"></div>
<h2 id="questions-title">Pending questions</h2>
<main id="main"></main>

<script type="module">
// The SAS exchange from the surface that owns it, and the attending half from its own
// block. Both are the node's OWN compiled modules — nothing is fetched from anywhere
// else, and there is nothing to fetch from anywhere else.
import { startSasVerification } from "${SAS_HTTP_BASE}/lib/index.js";
import {
  ATTEND_LIFETIME_MS,
  ATTEND_SCOPE,
  attendPromptView,
  attendCredentialFromGrant,
  checkAttendAnswer,
  clearAttendCredential,
  createAttendClient,
  createMemoryAttendStorage,
  describeAttendExpiry,
  describeAttendRefusal,
  describeAttendWireNotice,
  describeAttendingDevice,
  loadAttendCredential,
  nextAttendPollDelayMs,
  nextAttendRetryDelayMs,
  renderAttendPromptHtml,
  refusalIsTerminal,
  refusalNeedsNewCredential,
  saveAttendCredential,
} from "${ATTEND_LIB_PREFIX}index.js";
import {
  createOperationClient,
  createOperationMessages,
  describeOperationRefusal,
  describeOperationRun,
  renderOperationSurfaceHtml,
} from "${OPERATION_LIB_PREFIX}index.js";

const main = document.getElementById("main");
const banner = document.getElementById("banner");
const credentialLine = document.getElementById("credential");
const operations = document.getElementById("operations");
const operationMessages = createOperationMessages(navigator.languages ?? [navigator.language]);

document.documentElement.lang = operationMessages.locale;

/** localStorage when the browser allows it, memory when it does not. A page in private
 *  mode must still work for this session rather than throw on its first write. */
const storage = (() => {
  try {
    const probe = "refarm.attend.probe";
    globalThis.localStorage.setItem(probe, "1");
    globalThis.localStorage.removeItem(probe);
    return globalThis.localStorage;
  } catch {
    return createMemoryAttendStorage();
  }
})();

let credential = null;
const client = createAttendClient({ token: () => (credential ? credential.token : null) });
const operationClient = createOperationClient({ token: () => (credential ? credential.token : null) });

/** Cards currently on screen, by prompt id, so a prompt that VANISHES can be told about
 *  rather than silently removed — the whole of P2 from this side. */
const cards = new Map();

function say(text, kind) {
  banner.textContent = text ?? "";
  banner.className = kind ?? "";
}

function showCredential() {
  if (!credential) {
    credentialLine.textContent = "no credential yet";
    return;
  }
  // The expiry is SHOWN, always. A credential whose lifetime the operator cannot see is
  // one they cannot reason about.
  credentialLine.textContent =
    credential.scope.join(", ") + " — " + describeAttendExpiry(credential, Date.now());
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ── The handshake, driven from this page ─────────────────────────────────────────
//
// No token is ever typed or pasted. The page generates a keypair, shows seven emoji, and
// the operator confirms at the node — where the CLI shows what is being authorised before
// it asks. What comes back may answer prompts and nothing else, and it dies on a deadline
// the node chose.

async function handshake() {
  main.replaceChildren();
  cards.clear();
  const panel = el("section", "card");
  panel.append(el("h2", null, "This browser has no credential"));
  panel.append(
    el("p", null,
      "Compare the seven below with the ones shown by \`refarm auth verify\` at the node, " +
      "in the same order. If they differ in any way, answer no there."),
  );
  const row = el("div", "row");
  const state = el("p", "muted", "Starting…");
  panel.append(row, state);
  main.append(panel);

  let handle;
  try {
    handle = await startSasVerification({
      client: navigator.userAgent.slice(0, 100),
      scope: [ATTEND_SCOPE, "operation:read", "operation:start"],
      lifetimeMs: ATTEND_LIFETIME_MS,
    });
  } catch (error) {
    // A refused start is the node saying no (rate limit, ceiling), not a transport fault.
    state.textContent = "The node refused to start a verification: " + (error?.message ?? error);
    return false;
  }

  for (const emoji of handle.emoji) {
    const cell = el("div", "cell");
    cell.append(el("div", "glyph", emoji.emoji), el("div", "name", emoji.description));
    row.append(cell);
  }
  state.textContent = "Waiting for the node — run \`refarm auth verify\` there.";

  const outcome = await handle.await();
  if (outcome.state !== "granted") {
    // A mismatch is never retried, and the page must not offer to. Reloading starts a
    // NEW exchange, which is a different thing and looks different at the node.
    state.textContent = "Aborted: " + outcome.detail;
    return false;
  }
  credential = attendCredentialFromGrant(outcome, Date.now());
  saveAttendCredential(storage, credential);
  showCredential();
  say("Verified. This surface may answer prompts and operate only the node's admitted catalog.", "ok");
  main.replaceChildren();
  void loadOperations();
  return true;
}

// ── Admitted operations ────────────────────────────────────────────────────────

async function watchOperation(run, state) {
  let current = run;
  while (current.state === "running") {
    state.textContent = describeOperationRun(operationMessages, current);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const outcome = await operationClient.status(current.runId);
    if (!outcome.ok) {
      state.textContent = describeOperationRefusal(operationMessages, outcome.refusal);
      return;
    }
    current = outcome.run;
  }
  state.textContent = describeOperationRun(operationMessages, current);
  await loadOperations();
}

function bindOperationActions() {
  operations.querySelector("[data-operation-refresh]")?.addEventListener("click", () => void loadOperations());
  for (const start of operations.querySelectorAll("[data-operation-start]")) {
    const operationId = start.getAttribute("data-operation-start");
    const state = start.closest(".ds-card")?.querySelector("[data-operation-state]");
    if (!operationId || !state) continue;
    start.addEventListener("click", async () => {
      start.disabled = true;
      state.textContent = operationMessages.t("starting");
      const outcome = await operationClient.start(operationId);
      if (!outcome.ok) {
        state.textContent = describeOperationRefusal(operationMessages, outcome.refusal);
        start.disabled = false;
        return;
      }
      void watchOperation(outcome.run, state);
    });
  }
}

async function loadOperations() {
  if (!credential) return;
  operations.innerHTML = renderOperationSurfaceHtml({ messages: operationMessages });
  const outcome = await operationClient.list();
  if (!outcome.ok) {
    operations.innerHTML = renderOperationSurfaceHtml({
      messages: operationMessages,
      status: describeOperationRefusal(operationMessages, outcome.refusal),
      statusKind: "error",
    });
    bindOperationActions();
    return;
  }
  operations.innerHTML = renderOperationSurfaceHtml({
    messages: operationMessages,
    operations: outcome.operations,
  });
  bindOperationActions();
}

/** Drop the credential and get another. The ONE response that leads here is 401/403. */
async function reauthenticate() {
  credential = null;
  clearAttendCredential(storage);
  showCredential();
  return handshake();
}

// ── Rendering one prompt ─────────────────────────────────────────────────────────
//
// The shared block projects the view through the design system. This app binds the
// browser behaviour only; it does not carry a second prompt renderer.

function renderCard(pending) {
  const view = attendPromptView(pending, Date.now());
  const template = document.createElement("template");
  template.innerHTML = renderAttendPromptHtml(view);
  const card = template.content.firstElementChild;
  const verdict = card.querySelector("[data-attend-verdict]");
  const controlBox = card.querySelector("[data-attend-control]");

  const settle = (text) => {
    card.dataset.state = "settled";
    controlBox.replaceChildren();
    verdict.textContent = text;
  };

  async function submit(value) {
    if (value === null) {
      verdict.textContent = "Pick one of the options first.";
      return;
    }
    // The shape's own constraint, checked here so a select cannot even be SENT with a
    // value that was never offered. Never quotes what was typed.
    const checked = checkAttendAnswer(pending.prompt, value);
    if (!checked.ok) {
      verdict.textContent = checked.reason;
      return;
    }
    for (const button of controlBox.querySelectorAll("button")) button.disabled = true;
    verdict.textContent = "Sending…";

    const outcome = await client.answer(pending.id, checked.value);
    if (outcome.ok) {
      settle("✔ Answered from this browser.");
      cards.get(pending.id).settled = true;
      return;
    }
    if (refusalNeedsNewCredential(outcome.refusal)) {
      // The answer was NOT sent anywhere it could be honoured. Say so before
      // re-handshaking, so nobody believes a secret they typed has landed.
      say(describeAttendRefusal(outcome.refusal, describeAttendingDevice), "bad");
      await reauthenticate();
      return;
    }
    // 409 and 404 are settlements, not failures: the question is answered, it simply was
    // not answered here. 409 names the device that won (P2).
    settle(describeAttendRefusal(outcome.refusal, describeAttendingDevice));
    cards.get(pending.id).settled = true;
    for (const button of controlBox.querySelectorAll("button")) button.disabled = false;
  }

  for (const answer of controlBox.querySelectorAll("[data-attend-answer]")) {
    answer.addEventListener("click", () => submit(answer.getAttribute("data-attend-answer") === "true"));
  }
  const select = controlBox.querySelector("[data-attend-submit-select]");
  select?.addEventListener("click", () => {
    const picked = controlBox.querySelector("input[type=radio]:checked");
    void submit(picked ? picked.value : null);
  });
  const input = controlBox.querySelector("[data-attend-input]");
  const sendInput = controlBox.querySelector("[data-attend-submit-input]");
  const submitInput = () => void submit(input.value);
  sendInput?.addEventListener("click", submitInput);
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitInput();
  });
  return { node: card, settle, settled: false };
}

// ── The loop ─────────────────────────────────────────────────────────────────────

function reconcile(prompts) {
  const seen = new Set();
  for (const pending of prompts) {
    seen.add(pending.id);
    if (cards.has(pending.id)) continue;
    const card = renderCard(pending);
    cards.set(pending.id, card);
    main.append(card.node);
  }
  for (const [id, card] of cards) {
    if (seen.has(id) || card.settled) continue;
    // P2, the case nobody was mid-answer for: the question is gone from the node, so it
    // was settled somewhere else while this page was watching. It must NOT simply vanish.
    // The node publishes no settlements — deliberately, so this surface cannot be used to
    // read one — so the winning device's name arrives only with a 409, which is what an
    // answer sent from here would have received.
    card.settled = true;
    card.settle("↩ Settled elsewhere while this page was open. Answer at the terminal to see where.");
  }
  // "Nothing pending" is a STATE, not a one-shot message: it appears when there is
  // nothing on screen and leaves the moment a question arrives. Written as an element
  // that is added and removed rather than by clearing \`main\`, which would take the
  // settled cards — the record of what just happened — away with it.
  const empty = document.getElementById("empty");
  if (cards.size === 0 && !empty) {
    const note = el("p", "muted", "Nothing pending.");
    note.id = "empty";
    main.append(note);
  } else if (cards.size > 0 && empty) {
    empty.remove();
  }
}

let emptyRounds = 0;
let failures = 0;

async function tick() {
  if (!credential) {
    const ok = await handshake();
    return ok ? 0 : null;
  }
  // Judged here as a courtesy so the operator is not left mid-form; the gate is the rule.
  if (loadAttendCredential(storage, Date.now()) === null) {
    credential = null;
    showCredential();
    const ok = await handshake();
    return ok ? 0 : null;
  }
  showCredential();

  const outcome = await client.list();
  if (!outcome.ok) {
    if (refusalNeedsNewCredential(outcome.refusal)) {
      say(describeAttendRefusal(outcome.refusal, describeAttendingDevice), "bad");
      const ok = await reauthenticate();
      return ok ? 0 : null;
    }
    // The node declared a wire version this page cannot speak. A page cached in a
    // browser is a frozen client, exactly as the kit on a phone is, and the honest
    // response is to STOP and say what fixes it — not to keep polling and paint
    // "Nothing pending" over a farm full of questions, which is what the reader
    // dropping every unrecognised entry would otherwise look like.
    if (refusalIsTerminal(outcome.refusal)) {
      say(describeAttendRefusal(outcome.refusal, describeAttendingDevice), "bad");
      main.replaceChildren();
      cards.clear();
      return null;
    }
    // Unreachable is the network, and the page says exactly that rather than blaming the
    // credential. It backs off hard instead of hammering a node that is down.
    failures += 1;
    say(describeAttendRefusal(outcome.refusal, describeAttendingDevice), "bad");
    return nextAttendRetryDelayMs(failures);
  }

  failures = 0;
  // \`unknown\` — the node declared no wire version — is admitted, and SAID. Collapsing
  // it into "compatible" is how a silent break happens; refusing it would take a
  // working surface off the air over a peer merely being older. A matching version
  // returns null here and the banner clears, because a banner that is always on is a
  // banner nobody reads.
  say(describeAttendWireNotice(outcome.wire) ?? "");
  reconcile(outcome.prompts);
  emptyRounds = outcome.prompts.length > 0 ? 0 : emptyRounds + 1;
  // The cadence the NODE advertised is the floor. This page never asks faster.
  return nextAttendPollDelayMs(emptyRounds, { base: outcome.pollIntervalMs });
}

async function loop() {
  for (;;) {
    let delay;
    try {
      delay = await tick();
    } catch (error) {
      say("Unexpected: " + (error?.message ?? error), "bad");
      delay = nextAttendRetryDelayMs((failures += 1));
    }
    // \`null\` means an aborted handshake: stop, loudly, rather than grinding. A mismatch
    // is the one signal the exchange exists to produce and must never be retried in a
    // loop.
    if (delay === null) return;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

credential = loadAttendCredential(storage, Date.now());
showCredential();
if (credential) void loadOperations();
void loop();
</script>
</body>
</html>
`;
}

export function createAttendSurface(): AttendSurface {
	const distDir = resolveBlockDistDir(ATTEND_BLOCK);
	const operationDistDir = resolveBlockDistDir(OPERATION_BLOCK);
	const localizationDistDir = resolveBlockDistDir(LOCALIZATION_BLOCK);
	const dsDistDir = resolveBlockDistDir(DS_BLOCK);
	const dsAssets = new Map([
		["tokens.css", resolvePackageAsset(DS_BLOCK, "tokens.css")],
		["theme.css", resolvePackageAsset(DS_BLOCK, "themes/verde-jardim.css")],
		["components.css", resolvePackageAsset(DS_BLOCK, "components.css")],
	]);
	const page = attendPage();

	return {
		async handle(req, res, pathname): Promise<boolean> {
			if (pathname === ATTEND_PAGE_PATH) {
				res.statusCode = 200;
				res.setHeader("Content-Type", "text/html; charset=utf-8");
				// Never cached: the page carries the module URLs it imports, and a stale copy
				// pointing at a lib that moved is a blank screen with no explanation.
				res.setHeader("Cache-Control", "no-store");
				res.end(req.method === "HEAD" ? undefined : page);
				return true;
			}
			if (pathname.startsWith(ATTEND_LIB_PREFIX)) {
				await serveBlockModule(distDir, pathname.slice(ATTEND_LIB_PREFIX.length), req, res);
				return true;
			}
			if (pathname.startsWith(OPERATION_LIB_PREFIX)) {
				await serveBlockModule(
					operationDistDir,
					pathname.slice(OPERATION_LIB_PREFIX.length),
					req,
					res,
				);
				return true;
			}
			if (pathname.startsWith(LOCALIZATION_LIB_PREFIX)) {
				await serveBlockModule(
					localizationDistDir,
					pathname.slice(LOCALIZATION_LIB_PREFIX.length),
					req,
					res,
				);
				return true;
			}
			if (pathname.startsWith(DS_LIB_PREFIX)) {
				await serveBlockModule(dsDistDir, pathname.slice(DS_LIB_PREFIX.length), req, res);
				return true;
			}
			if (pathname.startsWith(DS_ASSET_PREFIX)) {
				const name = pathname.slice(DS_ASSET_PREFIX.length);
				await servePackageAsset(dsAssets.get(name) ?? null, "text/css; charset=utf-8", req, res);
				return true;
			}
			return false;
		},
	};
}
