// @ts-nocheck
import initSqlJs from "sql.js";

const ITERATIONS = 10000;

const logsEl = document.getElementById("logs")!;

function addLog(msg: string) {
  const div = document.createElement("div");
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logsEl.appendChild(div);
  logsEl.scrollTop = logsEl.scrollHeight;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isUnsupportedOpfsError(error: unknown) {
  const message = getErrorMessage(error);
  return (
    message.includes("Missing required OPFS APIs") ||
    message.includes("OPFS not supported") ||
    message.includes("sqlite3_vfs") ||
    message.includes("no such vfs: opfs")
  );
}

function createSqliteWorkerClient() {
  const worker = new Worker("/sqlite3-worker1.mjs", { type: "module" });
  const pending = new Map<
    string,
    {
      resolve: (message: any) => void;
      reject: (error: Error) => void;
    }
  >();

  let isReady = false;
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;

  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const cleanup = () => {
    pending.clear();
    worker.terminate();
  };

  worker.addEventListener("message", (event) => {
    const message = event.data;

    if (
      message?.type === "sqlite3-api" &&
      message?.result === "worker1-ready"
    ) {
      isReady = true;
      readyResolve();
      return;
    }

    const messageId = message?.messageId;
    if (!messageId || !pending.has(messageId)) {
      return;
    }

    const request = pending.get(messageId)!;
    pending.delete(messageId);

    if (message.type === "error") {
      request.reject(new Error(message.result?.message ?? "sqlite worker error"));
      return;
    }

    request.resolve(message);
  });

  worker.addEventListener("error", (event) => {
    const error = new Error(event.message || "sqlite worker failed to start");

    if (!isReady) {
      readyReject(error);
    }

    for (const request of pending.values()) {
      request.reject(error);
    }

    cleanup();
  });

  const call = async (type: string, args?: Record<string, unknown>, dbId?: string) => {
    await ready;

    const messageId = `${type}-${crypto.randomUUID()}`;
    return new Promise<any>((resolve, reject) => {
      pending.set(messageId, { resolve, reject });
      worker.postMessage({ type, messageId, dbId, args });
    });
  };

  return {
    ready,
    async open(filename: string, vfs: string) {
      const message = await call("open", { filename, vfs });
      return message.result as {
        dbId: string;
        filename: string;
        persistent: boolean;
        vfs: string;
      };
    },
    async exec(
      dbId: string,
      args: string | Record<string, unknown>,
    ) {
      const message = await call("exec", args, dbId);
      return message.result;
    },
    async close(dbId: string, unlink = false) {
      await call("close", { unlink }, dbId);
      cleanup();
    },
    terminate() {
      cleanup();
    },
  };
}

async function runSqlJs() {
  addLog("--- Starting sql.js (In-Memory) ---");
  const startLoad = performance.now();
  const SQL = await initSqlJs({
    locateFile: (file) => `/${file}`,
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
  addLog(
    `Insert ${ITERATIONS} rows: ${insertTime.toFixed(
      2,
    )}ms (${throughput.toFixed(0)} ops/s)`,
  );

  const startQuery = performance.now();
  db.exec("SELECT * FROM nodes WHERE id = 'id-5000'");
  const queryTime = performance.now() - startQuery;
  addLog(`Query: ${queryTime.toFixed(2)}ms`);

  return {
    engine: "sql.js",
    load: loadTime,
    insert: insertTime,
    query: queryTime,
    throughput,
  };
}

async function runSqliteWasm() {
  addLog("--- Starting sqlite-wasm (OPFS) ---");
  const startLoad = performance.now();
  const workerClient = createSqliteWorkerClient();
  await workerClient.ready;
  const loadTime = performance.now() - startLoad;
  addLog(`Load: ${loadTime.toFixed(2)}ms`);

  let dbId: string | undefined;

  try {
    const database = await workerClient.open("/refarm-bench.db", "opfs");
    dbId = database.dbId;

    if (!database.persistent || database.vfs !== "opfs") {
      addLog("sqlite-wasm (OPFS): unavailable in this browser runtime");
      await workerClient.close(dbId, true);
      return;
    }

    await workerClient.exec(
      dbId,
      "DROP TABLE IF EXISTS nodes; CREATE TABLE nodes(id TEXT, data TEXT);",
    );

    const startInsert = performance.now();
    await workerClient.exec(
      dbId,
      {
        sql: `
          BEGIN TRANSACTION;
          WITH RECURSIVE seq(x) AS (
            VALUES(0)
            UNION ALL
            SELECT x + 1 FROM seq WHERE x < ${ITERATIONS - 1}
          )
          INSERT INTO nodes(id, data)
          SELECT 'id-' || x, 'data-' || x FROM seq;
          COMMIT;
        `,
        countChanges: true,
      },
    );
    const insertTime = performance.now() - startInsert;
    const throughput = ITERATIONS / (insertTime / 1000);
    addLog(
      `Insert ${ITERATIONS} rows (OPFS): ${insertTime.toFixed(
        2,
      )}ms (${throughput.toFixed(0)} ops/s)`,
    );

    const startQuery = performance.now();
    const queryResult = await workerClient.exec(dbId, {
      sql: "SELECT * FROM nodes WHERE id = 'id-5000'",
      rowMode: "object",
      resultRows: [],
    });
    const queryTime = performance.now() - startQuery;

    if (!queryResult.resultRows?.length) {
      throw new Error("sqlite-wasm query did not return the expected row");
    }

    addLog(`Query: ${queryTime.toFixed(2)}ms`);

    await workerClient.close(dbId, true);
    dbId = undefined;

    return {
      engine: "sqlite-wasm (OPFS)",
      load: loadTime,
      insert: insertTime,
      query: queryTime,
      throughput,
      unavailable: false,
    };
  } catch (error) {
    if (isUnsupportedOpfsError(error)) {
      addLog("sqlite-wasm (OPFS): unavailable in this browser runtime");
      if (dbId) {
        await workerClient.close(dbId, true);
      } else {
        workerClient.terminate();
      }
      return {
        engine: "sqlite-wasm (OPFS)",
        load: loadTime,
        insert: 0,
        query: 0,
        throughput: 0,
        unavailable: true,
      };
    }

    addLog(`❌ sqlite-wasm failed: ${getErrorMessage(error)}`);
    if (dbId) {
      await workerClient.close(dbId, true);
    } else {
      workerClient.terminate();
    }
    return;
  }
}

document.getElementById("run-all")?.addEventListener("click", async () => {
  const res1 = await runSqlJs();
  const res2 = await runSqliteWasm();

  if (res1 && res2) {
    addLog("--- Summary ---");
    if (res2.unavailable) {
      addLog(
        `Throughput: sql.js (${res1.throughput.toFixed(
          0,
        )}) vs OPFS (unavailable in this browser)`,
      );
    } else {
      addLog(
        `Throughput: sql.js (${res1.throughput.toFixed(
          0,
        )}) vs OPFS (${res2.throughput.toFixed(0)})`,
      );
    }
    document.body.classList.add("bench-done");
  }
});
