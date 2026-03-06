// WASM Plugin Host - Validação Refarm
// Carrega hello-world-plugin.wasm e testa comunicação via WIT

interface PluginMetadata {
  name: string;
  version: string;
  description: string;
  supportedTypes: string[];
  requiredCapabilities: string[];
}

interface PluginInstance {
  setup(): void;
  ingest(): number;
  push(payload: string): void;
  teardown(): void;
  metadata(): PluginMetadata;
}

// Simulated storage (in-memory for validation)
const mockStorage = new Map<string, any>();

// Kernel bridge implementation (host-provided functions)
const kernelBridge = {
  log(level: string, message: string) {
    addLog(level, message);
  },
  
  storeNode(jsonLd: string): string {
    try {
      const node = JSON.parse(jsonLd);
      const id = node['@id'] || `urn:node:${Date.now()}`;
      mockStorage.set(id, node);
      return id;
    } catch (e) {
      throw new Error(`Invalid JSON-LD: ${e}`);
    }
  },
  
  getNode(id: string): string | null {
    const node = mockStorage.get(id);
    return node ? JSON.stringify(node) : null;
  }
};

// UI State
let pluginInstance: PluginInstance | null = null;
const statusEl = document.getElementById('status')!;
const logsEl = document.getElementById('logs')!;
const loadBtn = document.getElementById('load-btn') as HTMLButtonElement;
const setupBtn = document.getElementById('setup-btn') as HTMLButtonElement;
const ingestBtn = document.getElementById('ingest-btn') as HTMLButtonElement;
const metadataBtn = document.getElementById('metadata-btn') as HTMLButtonElement;
const teardownBtn = document.getElementById('teardown-btn') as HTMLButtonElement;

// Metrics
const metrics = {
  loadTime: document.getElementById('load-time')!,
  setupTime: document.getElementById('setup-time')!,
  ingestTime: document.getElementById('ingest-time')!,
  wasmSize: document.getElementById('wasm-size')!,
};

function addLog(level: string, message: string) {
  const entry = document.createElement('div');
  entry.className = `log-entry log-${level}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] [${level.toUpperCase()}] ${message}`;
  logsEl.appendChild(entry);
  logsEl.scrollTop = logsEl.scrollHeight;
}

function setStatus(text: string, type: 'pending' | 'success' | 'error') {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatMs(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

// 1. Load Plugin
loadBtn.addEventListener('click', async () => {
  try {
    setStatus('⏳ Carregando plugin...', 'pending');
    addLog('info', 'Fetching hello-world-plugin.wasm...');
    
    const start = performance.now();
    
    // Fetch WASM file
    const wasmPath = '/hello-world-plugin.wasm';
    const response = await fetch(wasmPath);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch WASM: ${response.status} ${response.statusText}`);
    }
    
    const wasmBytes = await response.arrayBuffer();
    const wasmSize = wasmBytes.byteLength;
    metrics.wasmSize.textContent = formatBytes(wasmSize);
    
    addLog('info', `WASM file loaded (${formatBytes(wasmSize)})`);
    
    // Instantiate WASM component
    // NOTE: In real implementation, use @bytecodealliance/jco
    // For this validation, we'll create a mock that simulates the interface
    
    // Mock plugin instance (replace with real jco.instantiate in production)
    pluginInstance = await mockInstantiatePlugin(wasmBytes);
    
    const elapsed = performance.now() - start;
    metrics.loadTime.textContent = formatMs(elapsed);
    
    setStatus('✅ Plugin carregado', 'success');
    addLog('info', `Plugin instantiated in ${formatMs(elapsed)}`);
    
    // Enable next buttons
    setupBtn.disabled = false;
    metadataBtn.disabled = false;
    loadBtn.disabled = true;
    
  } catch (error) {
    setStatus('❌ Erro ao carregar plugin', 'error');
    addLog('error', `${error}`);
  }
});

// 2. Setup
setupBtn.addEventListener('click', async () => {
  if (!pluginInstance) return;
  
  try {
    setStatus('⏳ Executando setup...', 'pending');
    const start = performance.now();
    
    pluginInstance.setup();
    
    const elapsed = performance.now() - start;
    metrics.setupTime.textContent = formatMs(elapsed);
    
    setStatus('✅ Setup concluído', 'success');
    addLog('info', `Setup completed in ${formatMs(elapsed)}`);
    
    ingestBtn.disabled = false;
  } catch (error) {
    setStatus('❌ Erro no setup', 'error');
    addLog('error', `${error}`);
  }
});

// 3. Ingest
ingestBtn.addEventListener('click', async () => {
  if (!pluginInstance) return;
  
  try {
    setStatus('⏳ Executando ingest...', 'pending');
    const start = performance.now();
    
    const count = pluginInstance.ingest();
    
    const elapsed = performance.now() - start;
    metrics.ingestTime.textContent = formatMs(elapsed);
    
    setStatus('✅ Ingest concluído', 'success');
    addLog('info', `Ingest completed: ${count} nodes in ${formatMs(elapsed)}`);
    
    teardownBtn.disabled = false;
  } catch (error) {
    setStatus('❌ Erro no ingest', 'error');
    addLog('error', `${error}`);
  }
});

// 4. Metadata
metadataBtn.addEventListener('click', () => {
  if (!pluginInstance) return;
  
  try {
    const metadata = pluginInstance.metadata();
    addLog('info', `Plugin: ${metadata.name} v${metadata.version}`);
    addLog('info', `Description: ${metadata.description}`);
    addLog('info', `Supported types: ${metadata.supportedTypes.join(', ')}`);
  } catch (error) {
    addLog('error', `${error}`);
  }
});

// 5. Teardown
teardownBtn.addEventListener('click', () => {
  if (!pluginInstance) return;
  
  try {
    pluginInstance.teardown();
    setStatus('✅ Teardown concluído', 'success');
    
    // Reset
    pluginInstance = null;
    loadBtn.disabled = false;
    setupBtn.disabled = true;
    ingestBtn.disabled = true;
    metadataBtn.disabled = true;
    teardownBtn.disabled = true;
  } catch (error) {
    setStatus('❌ Erro no teardown', 'error');
    addLog('error', `${error}`);
  }
});

// Mock WASM instantiation (replace with real jco in production)
async function mockInstantiatePlugin(wasmBytes: ArrayBuffer): Promise<PluginInstance> {
  // This is a MOCK for validation UI
  // In production, use: import { instantiate } from '@bytecodealliance/jco'
  
  addLog('warn', 'Using MOCK plugin instance (replace with real jco.instantiate)');
  
  return {
    setup() {
      kernelBridge.log('info', '🦀 Hello from Rust WASM setup!');
    },
    
    ingest(): number {
      kernelBridge.log('info', '📥 Ingesting data...');
      
      const node = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Note',
        '@id': 'urn:hello-world:note-1',
        'name': 'Hello from WASM!',
        'text': 'This note was created by a Rust plugin running in the browser',
        'dateCreated': '2026-03-06T00:00:00Z'
      });
      
      const nodeId = kernelBridge.storeNode(node);
      kernelBridge.log('info', `✅ Stored node with ID: ${nodeId}`);
      
      return 1;
    },
    
    push(payload: string) {
      kernelBridge.log('info', '📤 Push not implemented in hello-world');
    },
    
    teardown() {
      kernelBridge.log('info', '👋 Goodbye from Rust WASM!');
    },
    
    metadata(): PluginMetadata {
      return {
        name: 'Hello World Plugin',
        version: '0.1.0',
        description: 'Minimal validation plugin for WASM + WIT',
        supportedTypes: ['Note'],
        requiredCapabilities: []
      };
    }
  };
}

// Initial log
addLog('info', 'Host initialized. Ready to load plugin.');
addLog('warn', 'Place hello-world-plugin.wasm in public/ folder');
