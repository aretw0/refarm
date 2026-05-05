import { runConformanceTests } from "./conformance.js";
import { InMemoryStreamTransport } from "./in-memory.js";

runConformanceTests("InMemoryStreamTransport", () => new InMemoryStreamTransport());
