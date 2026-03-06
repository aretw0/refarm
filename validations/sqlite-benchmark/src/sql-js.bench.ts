// Benchmark: sql.js
// Tests 100k inserts, queries, and measures bundle size + load time

import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

interface BenchmarkResult {
  engine: string;
  totalTime: number;
  loadTime: number;
  insertTime: number;
  queryTime: number;
  throughput: number;
  bundleSize: string;
  memoryUsage: string;
}

const ITERATIONS = 100_000;

async function benchmarkSqlJs(): Promise<BenchmarkResult> {
  console.log("📦 Starting sql.js benchmark...\n");

  const startTotal = performance.now();

  // 1. Load time
  console.log("⏱️  Loading sql.js...");
  const startLoad = performance.now();

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const SQL = await initSqlJs({
    locateFile: (file: string) =>
      path.join(currentDir, "../node_modules/sql.js/dist", file),
  });

  const loadTime = performance.now() - startLoad;
  console.log(`✅ Loaded in ${loadTime.toFixed(2)}ms\n`);

  // 2. Create in-memory database
  console.log("📦 Creating in-memory database...");
  const db = new SQL.Database();

  db.run(`
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_nodes_type ON nodes(type);
  `);

  console.log("✅ Schema created\n");

  // 3. Insert benchmark
  console.log(`⏱️  Inserting ${ITERATIONS.toLocaleString()} rows...`);
  const startInsert = performance.now();

  db.run("BEGIN TRANSACTION");

  const stmt = db.prepare(`
    INSERT INTO nodes (id, type, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < ITERATIONS; i++) {
    const now = new Date().toISOString();
    stmt.run([
      `node-${i}`,
      "Note",
      JSON.stringify({ content: `Data ${i}` }),
      now,
      now,
    ]);

    if (i > 0 && i % 10000 === 0) {
      process.stdout.write(`  ${i.toLocaleString()} rows...\r`);
    }
  }

  stmt.free();
  db.run("COMMIT");

  const insertTime = performance.now() - startInsert;
  const throughput = ITERATIONS / (insertTime / 1000);

  console.log(
    `✅ Inserted in ${insertTime.toFixed(2)}ms (${throughput.toFixed(0)} ops/sec)\n`,
  );

  // 4. Query benchmark (indexed)
  console.log("⏱️  Querying 1000 rows (indexed)...");
  const startQuery = performance.now();

  const results = db.exec("SELECT * FROM nodes WHERE type = ? LIMIT 1000", [
    "Note",
  ]);

  const queryTime = performance.now() - startQuery;
  const rowCount = results[0]?.values.length || 0;
  console.log(`✅ Queried in ${queryTime.toFixed(2)}ms (${rowCount} rows)\n`);

  // 5. Memory usage (rough estimate)
  const memoryUsage = process.memoryUsage();
  const memoryMB = (memoryUsage.heapUsed / 1024 / 1024).toFixed(1);

  db.close();

  const totalTime = performance.now() - startTotal;

  return {
    engine: "sql.js",
    totalTime,
    loadTime,
    insertTime,
    queryTime,
    throughput,
    bundleSize: "~700KB (estimate)",
    memoryUsage: `${memoryMB} MB`,
  };
}

// Run benchmark
benchmarkSqlJs()
  .then((result) => {
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📊 sql.js RESULTS");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`Total Time:     ${result.totalTime.toFixed(2)}ms`);
    console.log(`Load Time:      ${result.loadTime.toFixed(2)}ms`);
    console.log(`Insert Time:    ${result.insertTime.toFixed(2)}ms`);
    console.log(`Query Time:     ${result.queryTime.toFixed(2)}ms`);
    console.log(`Throughput:     ${result.throughput.toFixed(0)} ops/sec`);
    console.log(`Bundle Size:    ${result.bundleSize}`);
    console.log(`Memory Usage:   ${result.memoryUsage}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  })
  .catch((err) => {
    console.error("❌ Benchmark failed:", err);
    process.exit(1);
  });
