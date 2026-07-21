import type { GovernancePocResult } from "./governance-poc.js";

/** HTML-escape a string for safe interpolation into the dashboard markup. */
function esc(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * Render the governance PoC result as an HTML dashboard — the "shows well" artifact the
 * writeup photographs: the weighted scorecard (criteria × score × weight), the gate verdict,
 * the per-combination outcomes, and the operational metrics. Pure string builder (no DOM),
 * projected through the surface's content seam like the extension graph. Deterministic.
 */
export function governanceToHtml(result: GovernancePocResult): string {
	const { scorecard, metrics, combinations } = result;
	const gateClass = scorecard.gate === "continue" ? "governance-gate--continue" : "governance-gate--revise";

	const criteriaRows = scorecard.criteria
		.map(
			(c) =>
				// An unexercised criterion shows a dash, not a number: printing 0.0 would read as a
				// failing score, and printing nothing would hide that the criterion exists.
				`<tr><td>${esc(c.name)}</td><td class="num">${c.score === null ? "—" : c.score.toFixed(1)}</td><td class="num">${c.weight}</td><td>${esc(c.note)}</td></tr>`,
		)
		.join("");

	const outcomeRows = combinations
		.map(
			(c) =>
				`<tr><td>${esc(c.extension)}</td><td>${esc(c.mode)}</td><td class="outcome outcome--${esc(c.outcome)}">${esc(c.outcome)}</td></tr>`,
		)
		.join("");

	return `<section class="refarm-stack" data-governance-dashboard>
  <h2>Governança de extensões — placar de viabilidade</h2>
  <p class="governance-score">
    Placar: <strong>${scorecard.score.toFixed(2)} / 5</strong>
    <span class="governance-gate ${gateClass}">gate: ${esc(scorecard.gate)}</span>
  </p>
  <table class="governance-table governance-scorecard">
    <thead><tr><th>Critério</th><th>Nota</th><th>Peso</th><th>Observação</th></tr></thead>
    <tbody>${criteriaRows}</tbody>
  </table>
  <h3>Resultados por combinação (política × extensão)</h3>
  <table class="governance-table governance-outcomes">
    <thead><tr><th>Extensão</th><th>Modo</th><th>Desfecho</th></tr></thead>
    <tbody>${outcomeRows}</tbody>
  </table>
  <ul class="governance-metrics">
    <li>Combinações: ${metrics.combinationsRun}</li>
    <li>Bloqueadas (fora do grant): ${metrics.blockedOutOfGrant}</li>
    <li>Falhas isoladas: ${metrics.isolatedFailures}</li>
    <li>Falhas abortadas: ${metrics.abortedFailures}</li>
    <li>Portões de revisão humana: ${metrics.humanReviewGates}</li>
    <li>Cobertura de telemetria: ${Math.round(metrics.telemetryCoverage * 100)}%</li>
  </ul>
</section>`;
}
