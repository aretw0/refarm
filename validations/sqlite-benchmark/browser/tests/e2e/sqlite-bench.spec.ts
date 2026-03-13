import { test, expect } from '@playwright/test';

test('runs sqlite benchmark and collects metrics', async ({ page }) => {
  page.on('console', msg => console.log(`[Browser]: ${msg.text()}`));
  page.on('requestfailed', request => {
    console.log(`[Network Error]: ${request.url()} - ${request.failure()?.errorText}`);
  });
  page.on('response', response => {
    if (response.status() >= 400) {
      console.log(`[Network Error]: ${response.url()} - Status ${response.status()}`);
    }
  });
  await page.goto('/');
  await page.click('#run-all');
  
  // Wait for benchmark to finish (we added bench-done class in main.ts)
  await page.waitForSelector('.bench-done', { timeout: 60000 });
  
  const logs = await page.innerText('#logs');
  console.log('--- Raw Results ---');
  console.log(logs);
  
  // Basic validation that we got results for both
  expect(logs).toContain('sql.js');
  expect(logs).toContain('sqlite-wasm (OPFS)');
});
