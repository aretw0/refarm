import { createHash } from "node:crypto";

import {
	readProvenance,
	stampProvenance,
	verifyProvenance,
	type FieldsBag,
	type NoteProvenance,
} from "@refarm.dev/provenance-contract-v1";
import {
	createInMemoryTaskAdapter,
	type Task,
	type TaskStatus,
} from "@refarm.dev/task-contract-v1";
import { describe, expect, it } from "vitest";

/**
 * CONSUMER PROOF — the CCM work-item side of the multi-vault ocamento (spec
 * `docs/superpowers/specs/2026-07-27-multi-vault-ocamento-convergence.md`, step A).
 *
 * reqbench-t3 already proves the RM (requirements) side: OSLC/Jazz artifacts → `records-contract-v1`
 * + `provenance-contract-v1` (see `oslc.ts` / `crawl.test.ts`). What was NOT yet proven is the CCM
 * (work-item / demand) side: does an operational vault's real ticket shape — rcdc5's `ccm_*`
 * scraper frontmatter (`renderWorkItemMarkdown`, `WorkItemContent`) — express cleanly as
 * `task:v1` (`Task` + FSM) + `provenance:v1` (its source envelope)? This test answers yes, and in
 * doing so DE-RISKS the migration without rcdc5 having to consume refarm yet.
 *
 * SOVEREIGN BOUNDARY (operator's rule): the generic lattice (task:v1 / provenance:v1) carries NO
 * SERPRO vocabulary. The CCM status vocabulary, the UST/codar codes, the project-area names — all of
 * that lives in the PRODUCT-LAYER projection below (this file stands in for rcdc5's thin product
 * layer), never in the contract. Refarm owns the generic; the vault owns the vocab.
 */

/** rcdc5's scraper output shape (field names from `packages/scraper-playwright/src/ccm/renderer.ts`).
 * `ccm_*` = adapter-owned/immutable (the sync contract); `rcdc5_*` = the human overlay preserved
 * across re-syncs; `id/title/type/tags` = the generic PARA identity. Synthetic values only. */
interface Rcdc5CcmWorkItem {
	// generic identity
	id: string;
	title: string;
	type: string;
	tags: string[];
	// ccm_* — adapter-owned, immutable, the sync contract
	ccm_work_item_id: string;
	ccm_work_item_type: string;
	ccm_status: string;
	ccm_priority: string;
	ccm_owner: string;
	ccm_created_by: string;
	ccm_created_at: string;
	ccm_modified: string;
	ccm_parent_uri: string | null;
	ccm_work_item_uri: string;
	ccm_source_url: string;
	ccm_last_sync_at: string;
	ccm_project_area: string;
	// rcdc5_* — the human/team overlay, preserved across re-syncs
	rcdc5_revisao_status: string;
	rcdc5_revisao_responsavel: string;
}

// ── PRODUCT LAYER (SERPRO/CCM-specific — would live in rcdc5, not in refarm) ──────────────────

/** The CCM status vocabulary → the generic task:v1 FSM. This map is business vocab: it belongs to
 * the vault's product layer. task:v1 never learns these strings. */
const CCM_STATUS_TO_TASK: Record<string, TaskStatus> = {
	Novo: "pending",
	"Em Atendimento": "active",
	"Em Andamento": "active",
	Impedido: "blocked",
	Resolvido: "done",
	"Concluído": "done",
	Cancelado: "cancelled",
	Reaberto: "active",
};

function ccmStatusToTaskStatus(ccm: string): TaskStatus {
	return CCM_STATUS_TO_TASK[ccm] ?? "pending";
}

/** Project a CCM work-item onto the generic task:v1 create shape. Note what maps to what:
 * owner → assigned_to, project_area → context_id, parent_uri → parent_task_id. */
function ccmWorkItemToTask(wi: Rcdc5CcmWorkItem): Omit<Task, "@id" | "created_at_ns" | "updated_at_ns"> {
	return {
		"@type": "Task",
		title: wi.title,
		status: ccmStatusToTaskStatus(wi.ccm_status),
		created_by: wi.ccm_created_by,
		assigned_to: wi.ccm_owner,
		context_id: wi.ccm_project_area,
		parent_task_id: wi.ccm_parent_uri,
		tags: wi.tags,
	};
}

/** Project the CCM sync/source fields onto provenance:v1 — WHERE the note came from. The extra
 * source locators ride in provenance's open `[extra]` bag (never a contract fork). */
function ccmWorkItemToProvenance(wi: Rcdc5CcmWorkItem, rawBody: string): NoteProvenance {
	return {
		channel: "ccm-scrape",
		originLink: wi.ccm_source_url,
		collectedAt: wi.ccm_last_sync_at,
		contentSha256: createHash("sha256").update(rawBody).digest("hex"),
		privacy: "internal",
		// open extras — the domain's own origin facts, kept without forking the contract
		ccm_work_item_uri: wi.ccm_work_item_uri,
		ccm_project_area: wi.ccm_project_area,
	};
}

// ── FIXTURE (synthetic; no real SERPRO data) ──────────────────────────────────────────────────

const WORK_ITEM: Rcdc5CcmWorkItem = {
	id: "demanda-84172",
	title: "EFD — ajustar cálculo de crédito presumido",
	type: "demanda",
	tags: ["sistema/efd", "ccm/demanda"],
	ccm_work_item_id: "84172",
	ccm_work_item_type: "Demanda",
	ccm_status: "Em Atendimento",
	ccm_priority: "Alta",
	ccm_owner: "analista.exemplo",
	ccm_created_by: "solicitante.exemplo",
	ccm_created_at: "2026-06-30T13:00:00.000Z",
	ccm_modified: "2026-07-20T09:30:00.000Z",
	ccm_parent_uri: "https://alm.example/ccm/resources/EPIC-900",
	ccm_work_item_uri: "https://alm.example/ccm/resources/84172",
	ccm_source_url: "https://alm.example/ccm/web/projects/EFD#action=com.ibm.team.workitem.viewWorkItem&id=84172",
	ccm_last_sync_at: "2026-07-21T06:00:00.000Z",
	ccm_project_area: "EFD Contribuições",
	rcdc5_revisao_status: "revisado",
	rcdc5_revisao_responsavel: "eu",
};

const RAW_BODY = "# EFD — ajustar cálculo\n\nDescrição do artefato CCM (corpo bruto scrapeado).";

describe("CCM work-item → task:v1 + provenance:v1 (ocamento step A)", () => {
	it("maps the work-item onto task:v1 — FSM, owner→assigned_to, parent→parent_task_id, project→context", async () => {
		const adapter = createInMemoryTaskAdapter();
		const task = await adapter.create(ccmWorkItemToTask(WORK_ITEM));

		expect(task["@type"]).toBe("Task");
		expect(task["@id"]).toMatch(/^urn:sovereign:task:v1:/);
		expect(task.status).toBe<TaskStatus>("active"); // "Em Atendimento" → active
		expect(task.assigned_to).toBe("analista.exemplo");
		expect(task.created_by).toBe("solicitante.exemplo");
		expect(task.context_id).toBe("EFD Contribuições");
		expect(task.parent_task_id).toBe("https://alm.example/ccm/resources/EPIC-900");
		expect(task.tags).toEqual(["sistema/efd", "ccm/demanda"]);
		// the adapter stamps the Log-vs-State timestamps
		expect(task.created_at_ns).toBeGreaterThan(0);
		expect(task.updated_at_ns).toBe(task.created_at_ns);
	});

	it("records the CCM sync origin as provenance:v1 and it verifies", () => {
		const fields = stampProvenance({} as FieldsBag, ccmWorkItemToProvenance(WORK_ITEM, RAW_BODY));
		const provenance = readProvenance(fields);
		const result = verifyProvenance(provenance);

		expect(result.valid).toBe(true);
		expect(result.failures).toEqual([]);
		expect(provenance?.channel).toBe("ccm-scrape");
		expect(provenance?.originLink).toContain("id=84172");
		// the source locators survive in the open extras — no contract fork needed
		expect((provenance as Record<string, unknown>).ccm_project_area).toBe("EFD Contribuições");
	});

	it("preserves the rcdc5_* human overlay OUTSIDE the generic contracts (dual-namespace)", () => {
		const task = ccmWorkItemToTask(WORK_ITEM);
		// the generic Task carries no rcdc5_* overlay keys — the overlay is not the source-of-truth
		expect(Object.keys(task).some((k) => k.startsWith("rcdc5_"))).toBe(false);
		// the overlay rides on the note's own fields bag, alongside (not inside) provenance
		const noteFields: FieldsBag = stampProvenance(
			{ rcdc5_revisao_status: WORK_ITEM.rcdc5_revisao_status, rcdc5_revisao_responsavel: WORK_ITEM.rcdc5_revisao_responsavel },
			ccmWorkItemToProvenance(WORK_ITEM, RAW_BODY),
		);
		expect(noteFields.rcdc5_revisao_status).toBe("revisado");
		expect(noteFields.rcdc5_revisao_responsavel).toBe("eu");
	});

	it("the append-only TaskEvent log drives the derived by_status summary (Log-vs-State keystone)", async () => {
		const adapter = createInMemoryTaskAdapter();
		const task = await adapter.create(ccmWorkItemToTask(WORK_ITEM));

		// a re-sync sees the ticket resolved: the STATE change is an appended EVENT, not a rewrite
		await adapter.appendEvent({
			"@type": "TaskEvent",
			task_id: task["@id"],
			event: "status_changed",
			actor: "ccm-scrape",
			payload: { from: "active", to: "done", ccm_status: "Resolvido" },
		});
		await adapter.update(task["@id"], { status: "done" });

		const events = await adapter.events?.(task["@id"]);
		expect(events).toHaveLength(1);
		expect(events?.[0]?.event).toBe("status_changed");

		const summary = await adapter.summary?.();
		expect(summary?.total).toBe(1);
		expect(summary?.by_status.done).toBe(1);
	});

	it("carries NO SERPRO vocabulary in the generic contract objects (sovereign boundary)", () => {
		const task = ccmWorkItemToTask(WORK_ITEM);
		// only generic task:v1 keys survive — no ccm_*/rcdc5_* namespaces and no SERPRO field names
		// (ust/codar/siged) leak into the contract object. Checked on KEYS, not a substring of values
		// (a value like "ajustar" legitimately contains "ust").
		const LEAKY_KEY = /^(ccm_|rcdc5_)|ust|codar|siged/i;
		expect(Object.keys(task).filter((k) => LEAKY_KEY.test(k))).toEqual([]);
		// the raw CCM status vocabulary was TRANSLATED by the product-layer map, never carried through
		expect(Object.values(task)).not.toContain("Em Atendimento");
		expect(task.status).toBe<TaskStatus>("active");
	});
});
