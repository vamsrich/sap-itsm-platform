import { Page, expect } from '@playwright/test';

export type Role = 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'PROJECT_MANAGER' | 'AGENT_FICO' | 'AGENT_MM' | 'AGENT_SD' | 'AGENT_PP' | 'USER_FINANCE' | 'USER_PROCUREMENT';

interface Credentials {
  email: string;
  password: string;
}

export const TEST_USERS: Record<Role, Credentials> = {
  SUPER_ADMIN:      { email: 'admin@intraedge.com',                       password: 'Admin@123456' },
  COMPANY_ADMIN:    { email: 'it.admin@globalmanufacturing.de',           password: 'Admin@123456' },
  PROJECT_MANAGER:  { email: 'priya.sharma@intraedge.com',                password: 'Admin@123456' },
  AGENT_FICO:       { email: 'rajesh.kumar@intraedge.com',                password: 'Admin@123456' },
  AGENT_MM:         { email: 'anitha.reddy@intraedge.com',                password: 'Admin@123456' },
  AGENT_SD:         { email: 'vikram.nair@intraedge.com',                 password: 'Admin@123456' },
  AGENT_PP:         { email: 'deepa.menon@intraedge.com',                 password: 'Admin@123456' },
  USER_FINANCE:     { email: 'finance.user@globalmanufacturing.de',       password: 'Admin@123456' },
  USER_PROCUREMENT: { email: 'procurement.user@globalmanufacturing.de',   password: 'Admin@123456' },
};

/**
 * Logs in as a test user. Navigates to login page, fills credentials, submits.
 * Throws if login fails.
 */
export async function loginAs(page: Page, role: Role): Promise<void> {
  const creds = TEST_USERS[role];
  await page.goto('/');
  // Wait for login page to load — adjust selector when we see actual UI
  await page.waitForLoadState('networkidle');

  // Best-effort selectors — refine when we see the real login page in the smoke test
  await page.fill('input[type="email"], input[name="email"]', creds.email);
  await page.fill('input[placeholder="••••••••"]', creds.password);
  await page.click('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")');

  // Post-login URL is hardcoded in src/pages/LoginPage.tsx (navigate('/dashboard'))
  await page.waitForURL(/\/dashboard/, { timeout: 10000 });
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();

  // Wait for dashboard data to finish loading (occludes layout header)
  await expect(page.getByText(/loading your tickets/i)).toBeHidden({ timeout: 15000 });
}
