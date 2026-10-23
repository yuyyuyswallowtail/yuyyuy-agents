import { test, expect, users, matrix, login, shot } from './fixtures';

const slug = (p: string) => p.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';
const sentToLogin = (url: string) => new URL(url).pathname.startsWith('/login');
// a page is "denied" when it answers 403/404 or bounces to the login page (unless the login page itself was requested)
const isDenied = (path: string, url: string, status: number) =>
  [403, 404].includes(status) || (sentToLogin(url) && !path.startsWith('/login'));

test('guests only see the pages marked public', async ({ page }) => {
  for (const [path, rule] of Object.entries(matrix())) {
    const res = await page.goto(path);
    const allowed = rule.guest ?? false;
    const denied = isDenied(path, page.url(), res?.status() ?? 0);
    expect(denied, `${path} as guest`).toBe(!allowed);
  }
});

test('every role reaches exactly the pages the matrix grants', async ({ page, context }) => {
  for (const u of users()) {
    await context.clearCookies();
    await login(page, u);
    expect(sentToLogin(page.url()), `${u.role} could not sign in`).toBe(false);
    for (const [path, rule] of Object.entries(matrix())) {
      const res = await page.goto(path);
      const expected = rule[u.role] ?? rule['*'] ?? true;
      const status = res?.status() ?? 0;
      const denied = isDenied(path, page.url(), status);
      expect(denied, `${u.role} on ${path} (status ${status})`).toBe(!expected);
      if (expected) await shot(page, u.role, slug(path));
    }
  }
});
