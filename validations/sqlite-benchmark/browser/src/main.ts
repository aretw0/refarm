// @ts-nocheck
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import initSqlJs from 'sql.js';

const ITERATIONS = 10000;

const logsEl = document.getElementById('logs')!;

function addLog(msg: string) {
  const div = document.createElement('div');
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logsEl.appendChild(div);
  logsEl.scrollTop = logsEl.scrollHeight;
}

async function runSqlJs() {
  addLog('--- Starting sql.js (In-Memory) ---');
  const startLoad = performance.now();
  const SQL = await initSqlJs({
    locateFile: file => `/${file}`
  });
  const loadTime = performance.now() - startLoad;
  addLog(`Load: ${loadTime.toFixed(2)}ms`);

  const db = new SQL.Database();
  db.run("CREATE TABLE nodes(id TEXT, data TEXT)");

  const startInsert = performance.now();
  const stmt = db.prepare("INSERT INTO nodes VALUES (?, ?)");
  for (let i = 0; i < ITERATIONS; i++) {
    stmt.run([`id-${i}`, `data-${i}`]);
  }
  stmt.free();
  const insertTime = performance.now() - startInsert;
  const throughput = ITERATIONS / (insertTime / 1000);
  addLog(`Insert ${ITERATIONS} rows: ${insertTime.toFixed(2)}ms (${throughput.toFixed(0)} ops/s)`);

  const startQuery = performance.now();
  db.exec("SELECT * FROM nodes WHERE id = 'id-5000'");
  const queryTime = performance.now() - startQuery;
  addLog(`Query: ${queryTime.toFixed(2)}ms`);
  
  return { engine: 'sql.js', load: loadTime, insert: insertTime, query: queryTime, throughput };
}

async function runSqliteWasm() {
  addLog('--- Starting sqlite-wasm (OPFS) ---');
  const startLoad = performance.now();
  const sqlite3 = await sqlite3InitModule();
  const loadTime = performance.now() - startLoad;
  addLog(`Load: ${loadTime.toFixed(2)}ms`);

  const opfs = sqlite3.opfs;
  if (!opfs) {
    addLog('❌ OPFS not supported in this browser!');
    return;
  }

  // Cleanup old db
  try { await sqlite3.opfs.delete('/refarm-bench.db'); } catch(e) {}

  const db = new sqlite3.oo1.OpfsDb('/refarm-bench.db');
  db.exec("CREATE TABLE nodes(id TEXT, data TEXT)");

  const startInsert = performance.now();
  db.exec("BEGIN TRANSACTION");
  const stmt = db.prepare("INSERT INTO nodes(id, data) VALUES (?, ?)");
  for (let i = 0; i < ITERATIONS; i++) {
    stmt.bind([`id-${i}`, `data-${i}`]).step();
    stmt.reset();
  }
  stmt.finalize();
  db.exec("COMMIT");
  const insertTime = performance.now() - startInsert;
  const throughput = ITERATIONS / (insertTime / 1000);
  addLog(`Insert ${ITERATIONS} rows (OPFS): ${insertTime.toFixed(2)}ms (${throughput.toFixed(0)} ops/s)`);

  const startQuery = performance.now();
  db.exec("SELECT * FROM nodes WHERE id = 'id-5000'");
  const queryTime = performance.now() - startQuery;
  addLog(`Query: ${queryTime.toFixed(2)}ms`);

  db.close();
  return { engine: 'sqlite-wasm (OPFS)', load: loadTime, insert: insertTime, query: queryTime, throughput };
}

document.getElementById('run-all')?.addEventListener('click', async () => {
  const res1 = await runSqlJs();
  const res2 = await runSqliteWasm();
  
  if (res1 && res2) {
    addLog('--- Summary ---');
    addLog(`Throughput: sql.js (${res1.throughput.toFixed(0)}) vs OPFS (${res2.throughput.toFixed(0)})`);
    document.body.classList.add('bench-done');
  }
});
