import {
	resolveGroupAction,
	isCapabilityGroup,
	type CapabilityInput,
	type CapabilityRegistry,
} from "@refarm.dev/cli/capabilities";
import { parseChatLine } from "@refarm.dev/cli/chat-repl";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";

import { mountedHttpHandler } from "./mount.js";
import { surfaceModel, type SurfaceModel } from "./surface-model.js";

/** How the web surface's REPL reaches the agent for a free-text message. Injected: a
 * host wires its runtime (the sidecar prompt sink); absent → the REPL reports the agent
 * is not connected, so the verb/command half still works without a daemon. */
export type SendPrompt = (text: string) => Promise<string>;

/**
 * The live WEB UI — the visual twin of mountedCliCommands. Where the CLI projects the
 * registry into commands, this projects the neutral {@link surfaceModel} into a real
 * HTML page: a section-grouped dashboard of the verbs that declared `renderers.web`,
 * each an actionable card that POSTs to the SAME endpoint mountedHttpHandler serves. A
 * consumer stands up an extensible web surface with one call — the T2 citizen dashboard
 * a work app then extends by adding verbs (they appear as cards) or a custom title.
 *
 * Self-contained: inline CSS/JS, no external assets, light + dark theme. It is a
 * surface a person operates, so it's information-design — cards, sections, a clear
 * header — not a landing page.
 */

export interface WebUiOptions {
	/** The page title / product name (the surface is white-label). */
	title?: string;
	/** A one-line subtitle under the title. */
	subtitle?: string;
	/** The prefix the verb endpoints mount under (matches the http handler). */
	prefix?: string;
	/** How the REPL sends a free-text message to the agent. Injected; when absent, the
	 * REPL still runs verbs + commands (the agent line reports "not connected"). */
	sendPrompt?: SendPrompt;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Render the neutral surface model into a full HTML document — the dashboard. */
export function renderWebUi(model: SurfaceModel, options: WebUiOptions = {}): string {
	const title = escapeHtml(options.title ?? "Refarm surface");
	const subtitle = escapeHtml(options.subtitle ?? "Your verbs, one surface");
	const prefix = options.prefix ?? "/capabilities";

	const sections = model.sections
		.map((section) => {
			const cards = section.items
				.map((item) => {
					const endpoint = item.http
						? `${item.http.method} ${prefix}${item.http.path}`
						: "";
					const invoke = item.http
						? `data-method="${escapeHtml(item.http.method)}" data-path="${escapeHtml(prefix + item.http.path)}"`
						: "";
					return `
        <button class="card" ${invoke} ${item.http ? "" : "disabled"}>
          <span class="card-name">${escapeHtml(item.name)}</span>
          <span class="card-summary">${escapeHtml(item.summary)}</span>
          ${endpoint ? `<span class="card-endpoint">${escapeHtml(endpoint)}</span>` : ""}
        </button>`;
				})
				.join("");
			return `
      <section class="surface-section">
        <h2>${escapeHtml(section.section)}</h2>
        <div class="cards">${cards}</div>
      </section>`;
		})
		.join("");

	const emptyNote =
		model.sections.length === 0
			? `<p class="empty">No verb declares a web surface yet. Add <code>renderers.web</code> to a verb and it appears here.</p>`
			: "";

	// The result panel + the fetch wiring: clicking a card invokes its endpoint and
	// shows the JSON envelope. Minimal, inline — a person operates this surface.
	return `<!doctype html>
<html lang="en" data-theme="auto">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  :root {
    --bg: #f7f7f6; --panel: #ffffff; --ink: #1a1a1a; --muted: #6b6b6b;
    --line: #e6e6e3; --accent: #2f6f4f; --accent-ink: #ffffff; --code: #f0f0ee;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14161a; --panel: #1c1f24; --ink: #ecedee; --muted: #9aa0a6;
      --line: #2a2e34; --accent: #4c9a72; --accent-ink: #0d1410; --code: #23272d;
    }
  }
  :root[data-theme="dark"] {
    --bg: #14161a; --panel: #1c1f24; --ink: #ecedee; --muted: #9aa0a6;
    --line: #2a2e34; --accent: #4c9a72; --accent-ink: #0d1410; --code: #23272d;
  }
  :root[data-theme="light"] {
    --bg: #f7f7f6; --panel: #ffffff; --ink: #1a1a1a; --muted: #6b6b6b;
    --line: #e6e6e3; --accent: #2f6f4f; --accent-ink: #ffffff; --code: #f0f0ee;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
  header {
    padding: 28px 24px 20px; border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  header h1 { margin: 0; font-size: 22px; letter-spacing: -0.01em; }
  header p { margin: 4px 0 0; color: var(--muted); }
  main { max-width: 1000px; margin: 0 auto; padding: 24px; }
  .surface-section { margin-bottom: 28px; }
  .surface-section h2 {
    font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--muted); margin: 0 0 10px;
  }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
  .card {
    display: flex; flex-direction: column; gap: 4px; text-align: left;
    padding: 14px 16px; border: 1px solid var(--line); border-radius: 10px;
    background: var(--panel); color: var(--ink); cursor: pointer;
    font: inherit; transition: border-color .12s, transform .12s;
  }
  .card:hover:not(:disabled) { border-color: var(--accent); transform: translateY(-1px); }
  .card:disabled { opacity: .55; cursor: default; }
  .card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .card-name { font-weight: 600; }
  .card-summary { color: var(--muted); font-size: 13px; }
  .card-endpoint {
    margin-top: 4px; font: 12px ui-monospace, monospace; color: var(--muted);
    background: var(--code); padding: 2px 6px; border-radius: 5px; align-self: flex-start;
  }
  .empty { color: var(--muted); }
  #result {
    margin-top: 8px; border: 1px solid var(--line); border-radius: 10px;
    background: var(--panel); overflow-x: auto; display: none;
  }
  #result.show { display: block; }
  #result pre { margin: 0; padding: 14px 16px; font: 13px/1.5 ui-monospace, monospace; }
  #result h2 { margin: 0; padding: 10px 16px; border-bottom: 1px solid var(--line); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  .repl-section { margin-bottom: 28px; }
  .repl-section h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0 0 10px; }
  .repl-log {
    border: 1px solid var(--line); border-radius: 10px 10px 0 0; background: var(--panel);
    min-height: 80px; max-height: 260px; overflow-y: auto; padding: 12px 16px;
    font: 13px/1.6 ui-monospace, monospace;
  }
  .repl-line { white-space: pre-wrap; word-break: break-word; }
  .repl-you { color: var(--accent); }
  .repl-out { color: var(--ink); }
  .repl-form {
    display: flex; align-items: center; gap: 8px; border: 1px solid var(--line);
    border-top: none; border-radius: 0 0 10px 10px; background: var(--panel); padding: 10px 16px;
  }
  .repl-prompt { color: var(--accent); font: 13px ui-monospace, monospace; }
  .repl-input {
    flex: 1; border: none; background: transparent; color: var(--ink);
    font: 14px ui-monospace, monospace; outline: none;
  }
</style>
</head>
<body>
<header>
  <h1>${title}</h1>
  <p>${subtitle}</p>
</header>
<main>
  <section class="repl-section">
    <h2>Console</h2>
    <div id="repl-log" class="repl-log"></div>
    <form id="repl-form" class="repl-form">
      <span class="repl-prompt">&gt;</span>
      <input id="repl-input" class="repl-input" autocomplete="off"
        placeholder="a message for the agent, or /help, /status, /&lt;verb&gt;…" />
    </form>
  </section>
  ${sections}
  ${emptyNote}
  <div id="result"><h2>Result</h2><pre id="result-body"></pre></div>
</main>
<script>
  const panel = document.getElementById("result");
  const body = document.getElementById("result-body");
  function showResult(v) {
    body.textContent = typeof v === "string" ? v : JSON.stringify(v, null, 2);
    panel.classList.add("show");
  }
  for (const card of document.querySelectorAll(".card[data-path]")) {
    card.addEventListener("click", async () => {
      const method = card.getAttribute("data-method");
      const path = card.getAttribute("data-path");
      showResult("…");
      try {
        const res = await fetch(path, {
          method,
          headers: { "content-type": "application/json" },
          body: method === "GET" ? undefined : "{}",
        });
        showResult(await res.json());
      } catch (e) { showResult("request failed: " + String(e)); }
    });
  }

  // The REPL — the same command grammar as the TUI (parseChatLine runs server-side at
  // /repl). A line is a slash command / verb, or free text sent to the agent.
  const log = document.getElementById("repl-log");
  const input = document.getElementById("repl-input");
  function append(role, text) {
    const line = document.createElement("div");
    line.className = "repl-line repl-" + role;
    line.textContent = (role === "you" ? "> " : "") + text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }
  document.getElementById("repl-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const line = input.value.trim();
    if (!line) return;
    append("you", line);
    input.value = "";
    try {
      const res = await fetch("/repl", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ line }),
      });
      const out = await res.json();
      append("out", out.reply ?? JSON.stringify(out.result ?? out, null, 2));
    } catch (err) { append("out", "error: " + String(err)); }
  });
</script>
</body>
</html>
`;
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		let data = "";
		req.on("data", (c) => (data += c));
		req.on("end", () => resolve(data));
		req.on("error", () => resolve(""));
	});
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json",
		"content-length": Buffer.byteLength(payload),
	});
	res.end(payload);
}

/**
 * The REPL endpoint — the coherent base a web surface shares with the TUI. It runs the
 * SAME grammar (parseChatLine): a `/verb …` line dispatches the verb; free text goes to
 * the agent via the injected sendPrompt; /help and /status are built-ins. This is why
 * web and TUI have parity — one command engine, not two.
 */
async function handleRepl(
	req: IncomingMessage,
	res: ServerResponse,
	registry: CapabilityRegistry,
	capabilityNames: ReadonlySet<string>,
	sendPrompt?: SendPrompt,
): Promise<void> {
	let line = "";
	try {
		line = (JSON.parse(await readBody(req)) as { line?: string }).line ?? "";
	} catch {
		writeJson(res, 400, { ok: false, error: "bad-request" });
		return;
	}
	const command = parseChatLine(line, capabilityNames);

	if (command.kind === "message") {
		if (!command.text) {
			writeJson(res, 200, { ok: true, reply: "" });
			return;
		}
		if (!sendPrompt) {
			writeJson(res, 200, { ok: true, reply: "(agent not connected — inject sendPrompt to enable)" });
			return;
		}
		try {
			writeJson(res, 200, { ok: true, reply: await sendPrompt(command.text) });
		} catch (e) {
			writeJson(res, 200, { ok: false, reply: `agent error: ${String(e)}` });
		}
		return;
	}

	if (command.kind === "help") {
		const verbs = registry.list().map((e) => `/${e.name}`).sort().join("  ");
		writeJson(res, 200, {
			ok: true,
			reply: `Commands: /help  /status  and the verbs:\n${verbs}\nOr type free text to ask the agent.`,
		});
		return;
	}

	if (command.kind === "capability") {
		const entry = registry.list().find((e) => e.name.toLowerCase() === command.name);
		if (!entry) {
			writeJson(res, 200, { ok: false, reply: `unknown verb: ${command.name}` });
			return;
		}
		try {
			let result: unknown;
			if (isCapabilityGroup(entry)) {
				const resolved = resolveGroupAction(entry, command.argv);
				result = resolved
					? await resolved.action.run(resolved.input)
					: { ok: false, error: "could not resolve group action" };
			} else {
				const input: CapabilityInput = { args: {}, options: {}, json: true };
				result = await entry.run(input);
			}
			writeJson(res, 200, { ok: true, result });
		} catch (e) {
			writeJson(res, 200, { ok: false, reply: `verb error: ${String(e)}` });
		}
		return;
	}

	// Other built-in commands (status/reload/…) aren't wired to a web action here; a
	// host can extend. Report the parsed intent so the surface stays honest.
	writeJson(res, 200, { ok: true, reply: `(${command.kind} is not handled on this web surface yet)` });
}

/**
 * Stand up the web UI as a live server: the dashboard HTML at `/`, the REPL at `/repl`,
 * and every verb's JSON endpoint under the prefix (delegated to mountedHttpHandler).
 * Returns the server + a close() that destroys sockets so it never hangs — the same
 * shape as serveCapabilities.
 */
export function serveWebUi(
	registry: CapabilityRegistry,
	options: WebUiOptions & { port?: number } = {},
): {
	server: Server;
	listening: Promise<{ port: number }>;
	close: () => Promise<void>;
} {
	const html = renderWebUi(surfaceModel(registry), options);
	const apiHandler = mountedHttpHandler(registry, { prefix: options.prefix });
	// The slash names the REPL grammar recognizes as verbs (else free text → agent).
	const capabilityNames = new Set(registry.list().map((e) => e.name.toLowerCase()));

	const handler = (req: IncomingMessage, res: ServerResponse): void => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		if (req.method === "GET" && url.pathname === "/") {
			res.writeHead(200, {
				"content-type": "text/html; charset=utf-8",
				"content-length": Buffer.byteLength(html),
			});
			res.end(html);
			return;
		}
		if (req.method === "POST" && url.pathname === "/repl") {
			void handleRepl(req, res, registry, capabilityNames, options.sendPrompt);
			return;
		}
		apiHandler(req, res);
	};

	const server = createServer(handler);
	server.keepAliveTimeout = 1_000;
	const sockets = new Set<import("node:net").Socket>();
	server.on("connection", (s) => {
		sockets.add(s);
		s.on("close", () => sockets.delete(s));
	});
	const listening = new Promise<{ port: number }>((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port ?? 0, () => {
			const addr = server.address();
			const port = typeof addr === "object" && addr ? addr.port : (options.port ?? 0);
			resolve({ port });
		});
	});
	const close = () =>
		new Promise<void>((resolve) => {
			for (const s of sockets) s.destroy();
			sockets.clear();
			server.close(() => resolve());
		});
	return { server, listening, close };
}
