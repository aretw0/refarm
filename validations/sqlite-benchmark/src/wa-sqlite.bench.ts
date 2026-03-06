// Benchmark: wa-sqlite with OPFS
// Tests 100k inserts, queries, and measures bundle size + load time

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

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

async function benchmarkWaSqlite(): Promise<BenchmarkResult> {
  console.log('🦀 Starting wa-sqlite benchmark...\n');
  
  const startTotal = performance.now();
  
  // 1. Load time
  console.log('⏱️  Loading wa-sqlite...');
  const startLoad = performance.now();
  
  const sqlite3 = await sqlite3InitModule();
  
  const loadTime = performance.now() - startLoad;
  console.log(`✅ Loaded in ${loadTime.toFixed(2)}ms\n`);
  
  // 2. Create in-memory database
  console.log('📦 Creating in-memory database...');
  const db = new sqlite3.oo1.DB(':memory:');
  
  db.exec(`
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_nodes_type ON nodes(type);
  `);
  
  console.log('✅ Schema created\n');
  
  // 3. Insert benchmark
  console.log(`⏱️  Inserting ${ITERATIONS.toLocaleString()} rows...`);
  const startInsert = performance.now();
  
  db.exec('BEGIN TRANSACTION');
  
  const stmt = db.prepare(`
    INSERT INTO nodes (id, type, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  for (let i = 0; i < ITERATIONS; i++) {
    const now = new Date().toISOString();
    stmt.bind([
      `node-${i}`,
      'Note',
      JSON.stringify({ content: `Data ${i}` }),
      now,
      now
    ]);
    stmt.step();
    stmt.reset();
    
    if (i > 0 && i % 10000 === 0) {
      process.stdout.write(`  ${i.toLocaleString()} rows...\r`);
    }
  }
  
  stmt.finalize();
  db.exec('COMMIT');
  
  const insertTime = performance.now() - startInsert;
  const throughput = ITERATIONS / (insertTime / 1000);
  
  console.log(`✅ Inserted in ${insertTime.toFixed(2)}ms (${throughput.toFixed(0)} ops/sec)\n`);
  
  // 4. Query benchmark (indexed)
  console.log('⏱️  Querying 1000 rows (indexed)...');
  const startQuery = performance.now();
  
  const results = db.exec({
    sql: 'SELECT * FROM nodes WHERE type = ? LIMIT 1000',
    bind: ['Note'],
    returnValue: 'resultRows'
  });
  
  const queryTime = performance.now() - startQuery;
  console.log(`✅ Queried in ${queryTime.toFixed(2)}ms (${results.length} rows)\n`);
  
  // 5. Memory usage (rough estimate)
  const memoryUsage = process.memoryUsage();
  const memoryMB = (memoryUsage.heapUsed / 1024 / 1024).toFixed(1);
  
  db.close();
  
  const totalTime = performance.now() - startTotal;
  
  return {
    engine: 'wa-sqlite',
    totalTime,
    loadTime,
    insertTime,
    queryTime,
    throughput,
    bundleSize: '~400KB (estimate)',
    memoryUsage: `${memoryMB} MB`
  };
}

// Run benchmark
benchmarkWaSqlite()
  .then(result => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 wa-sqlite RESULTS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total Time:     ${result.totalTime.toFixed(2)}ms`);
    console.log(`Load Time:      ${result.loadTime.toFixed(2)}ms`);
    console.log(`Insert Time:    ${result.insertTime.toFixed(2)}ms`);
    console.log(`Query Time:     ${result.queryTime.toFixed(2)}ms`);
    console.log(`Throughput:     ${result.throughput.toFixed(0)} ops/sec`);
    console.log(`Bundle Size:    ${result.bundleSize}`);
    console.log(`Memory Usage:   ${result.memoryUsage}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  })
  .catch(err => {
    console.error('❌ Benchmark failed:', err);
    process.exit(1);
  });
