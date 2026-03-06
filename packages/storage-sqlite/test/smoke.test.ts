import { describe, expect, it } from "vitest";

import type { QueryOptions, Row, StorageAdapter } from "../src/index";
import { runMigrations } from "../src/index";

// TODO: Replace with InMemorySQLiteAdapter (real better-sqlite3 :memory:) in Sprint 1
// This minimal fake is sufficient for smoke test baseline only
class FakeAdapter implements StorageAdapter {
  private appliedMigrationIds = new Set<number>();
  public executedStatements: string[] = [];

  async open(_name: string): Promise<StorageAdapter> {
    return this;
  }

  async execute(sql: string, options?: QueryOptions): Promise<number> {
    this.executedStatements.push(sql.trim());
    if (sql.includes("INSERT INTO _migrations") && options?.params?.[0] != null) {
      this.appliedMigrationIds.add(Number(options.params[0]));
    }
    return 1;
  }

  // NOTE: Always returns { id } regardless of T - unsafe but acceptable for smoke test
  // Real adapter must return complete rows matching T
  async query<T extends Row = Row>(_sql: string): Promise<T[]> {
    return Array.from(this.appliedMigrationIds)
      .sort((a, b) => a - b)
      .map((id) => ({ id } as unknown as T));
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  async close(): Promise<void> {
    return;
  }
}

describe("@refarm/storage-sqlite smoke", () => {
  it("applies each migration once", async () => {
    const adapter = new FakeAdapter();
    const migrations = ["CREATE TABLE a(id INTEGER)", "CREATE TABLE b(id INTEGER)"];

    await runMigrations(adapter, migrations);
    await runMigrations(adapter, migrations);

    const appliedMigrationWrites = adapter.executedStatements.filter((sql) =>
      sql.includes("INSERT INTO _migrations"),
    );

    expect(appliedMigrationWrites).toHaveLength(2);
  });
});
