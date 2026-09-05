import assert from "node:assert/strict";
import test from "node:test";

import { GITHUB_MATRIX_JOB_LIMIT, capMatrix } from "./github-matrix-builder.mjs";

function matrixOf(size) {
	return { include: Array.from({ length: size }, (_, i) => ({ strategy: "forward", package: `pkg-${i}`, name: `f ${i}` })) };
}

test("a matrix within GitHub's limit passes through untouched", () => {
	const matrix = matrixOf(3);
	assert.deepEqual(capMatrix(matrix), { matrix, overflow: false, size: 3 });
	const atLimit = matrixOf(GITHUB_MATRIX_JOB_LIMIT);
	assert.equal(capMatrix(atLimit).overflow, false);
});

test("a matrix above GitHub's 256-job limit becomes empty and says so", () => {
	// PR #59 (2026-08-30): 154 changed packages produced 496 configurations, the matrix-runner
	// job was never created, and the workflow reported failure with nothing to read.
	const capped = capMatrix(matrixOf(496));
	assert.deepEqual(capped, { matrix: { include: [] }, overflow: true, size: 496 });
});

test("the limit is GitHub's, not ours", () => {
	assert.equal(GITHUB_MATRIX_JOB_LIMIT, 256);
});
