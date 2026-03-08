import { vi } from "vitest";

/**
 * Creates a reusable mock of the Tractor engine for testing plugins and adapters.
 */
export function createTractorMock() {
  return {
    observe: vi.fn(),
    emitTelemetry: vi.fn(),
    emit: vi.fn(),
    setPluginState: vi.fn(),
    queryNodes: vi.fn().mockResolvedValue([]),
    l8n: {
      t: vi.fn((key: string) => key), // identity fallback for tests
    },
    plugins: {
      getAllPlugins: vi.fn(() => []),
    }
  };
}
