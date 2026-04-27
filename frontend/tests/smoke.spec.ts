import { test, expect } from '@playwright/test';
import { loginAs } from './lib/auth';

test.describe('Smoke tests — Phase 1 foundation', () => {
  test('Railway frontend is reachable and renders', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Take a screenshot for visual confirmation; saved under tests/reports/artifacts on failure or via --output
    await expect(page).toHaveTitle(/.+/);
  });

  test('USER (finance) can log in', async ({ page }) => {
    await loginAs(page, 'USER_FINANCE');
    // Verify we're past login: URL no longer contains 'login'
    await expect(page).not.toHaveURL(/login/);
    await page.screenshot({ path: 'tests/reports/artifacts/post-login-finance-user.png' });
  });
});
