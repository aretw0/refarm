import { expect, test } from '@playwright/test';

function extractMs(value: string): number {
  const match = value.match(/([\d.]+)\s*ms/i);
  if (!match) {
    throw new Error(`Could not parse milliseconds from: ${value}`);
  }
  return Number(match[1]);
}

function extractKb(value: string): number {
  const match = value.match(/([\d.]+)\s*kb/i);
  if (!match) {
    throw new Error(`Could not parse kilobytes from: ${value}`);
  }
  return Number(match[1]);
}

test('runs full plugin lifecycle and validates metrics', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: /Plugin Inspector/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /1.* Carregar Plugin/i })).toBeEnabled();

  await page.getByRole('button', { name: /1.* Carregar Plugin/i }).click();
  await expect(page.getByText('Plugin carregado')).toBeVisible();

  const loadTimeText = (await page.locator('#load-time').textContent()) ?? '';
  const wasmSizeText = (await page.locator('#wasm-size').textContent()) ?? '';

  expect(extractMs(loadTimeText)).toBeLessThan(1_000);
  expect(extractKb(wasmSizeText)).toBeGreaterThan(50);
  expect(extractKb(wasmSizeText)).toBeLessThan(500);

  await page.getByRole('button', { name: /2.* Setup/i }).click();
  await expect(page.getByText(/Setup conclu[ií]do/)).toBeVisible();
  await expect(page.getByText('Hello from Rust WASM setup')).toBeVisible();

  await page.getByRole('button', { name: /3.* Ingest/i }).click();
  await expect(page.getByText(/Ingest conclu[ií]do/)).toBeVisible();
  await expect(page.getByText('Stored node with ID: urn:hello-world:note-1')).toBeVisible();

  await page.getByRole('button', { name: /4.* Metadata/i }).click();
  await expect(page.getByText('Plugin: Hello World Plugin v0.1.0')).toBeVisible();

  await page.getByRole('button', { name: /5.* Teardown/i }).click();
  await expect(page.getByText(/Teardown conclu[ií]do/)).toBeVisible();
  await expect(page.getByRole('button', { name: /1.* Carregar Plugin/i })).toBeEnabled();
});
