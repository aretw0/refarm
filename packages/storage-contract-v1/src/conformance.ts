import {
  STORAGE_CAPABILITY,
  type StorageConformanceResult,
  type StorageProvider,
  type StorageRecord,
} from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

export async function runStorageV1Conformance(
  provider: StorageProvider,
): Promise<StorageConformanceResult> {
  const failures: string[] = [];

  if (provider.capability !== STORAGE_CAPABILITY) {
    failures.push("provider.capability must be 'storage:v1'");
  }

  if (!provider.pluginId || provider.pluginId.trim().length === 0) {
    failures.push("provider.pluginId must be a non-empty string");
  }

  const sample: StorageRecord = {
    id: `conformance-${Date.now()}`,
    type: "conformance:test",
    payload: JSON.stringify({ hello: "refarm" }),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  try {
    await provider.put(sample);
  } catch (error) {
    failures.push(`put() threw: ${String(error)}`);
  }

  try {
    const got = await provider.get(sample.id);
    if (!got) {
      failures.push("get() returned null after put()");
    } else {
      if (got.id !== sample.id) failures.push("get() returned wrong id");
      if (got.type !== sample.type) failures.push("get() returned wrong type");
    }
  } catch (error) {
    failures.push(`get() threw: ${String(error)}`);
  }

  try {
    const rows = await provider.query({ type: sample.type, limit: 10, offset: 0 });
    const hasSample = rows.some((row) => row.id === sample.id);
    if (!hasSample) failures.push("query() did not return inserted row");
  } catch (error) {
    failures.push(`query() threw: ${String(error)}`);
  }

  try {
    await provider.delete(sample.id);
    const afterDelete = await provider.get(sample.id);
    if (afterDelete !== null) failures.push("delete() did not remove row");
  } catch (error) {
    failures.push(`delete()/post-delete get() threw: ${String(error)}`);
  }

  const failed = failures.length;
  return {
    pass: failed === 0,
    total: 6,
    failed,
    failures,
  };
}
