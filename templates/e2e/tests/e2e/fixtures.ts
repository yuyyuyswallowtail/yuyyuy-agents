import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

export type E2eUser = { role: string; email: string; password: string };

// Read at run time (global setup writes the file before the tests start).
export const users = (): E2eUser[] => JSON.parse(readFileSync('storage/e2e-users.json', 'utf8'));

// matrix: { "/path": { "guest": false, "*": true, "viewer": false } }  (role key wins over "*", default is allowed)
export const matrix = (): Record<string, Record<string, boolean>> =>
  JSON.parse(readFileSync('tests/e2e/access-matrix.json', 'utf8'));

export async function login(page: Page, u: E2eUser): Promise<void> {
  await page.goto('/login');
  await page.locator('input[name="email"]').fill(u.email);
  await page.locator('input[name="password"]').fill(u.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForLoadState('networkidle');
}

// Full-page screenshots feed the vision review (gemma3) and human reviewers.
export async function shot(page: Page, role: string, slug: string): Promise<void> {
  mkdirSync('storage/e2e-screens', { recursive: true });
  await page.screenshot({ path: `storage/e2e-screens/${role}-${slug}.jpg`, type: 'jpeg', quality: 55, fullPage: true });
}

export { test, expect };
