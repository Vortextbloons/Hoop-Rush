import { test } from '@playwright/test';
test('capture team page errors', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text().slice(0, 2000)}`));
  page.on('pageerror', (e) =>
    logs.push(`PAGEERROR: ${String(e.message).slice(0, 3000)}\n${String(e.stack).slice(0, 4000)}`),
  );
  page.on('requestfailed', (r) => logs.push(`REQFAIL: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => {
    if (r.status() >= 400) logs.push(`BADRESP: ${r.status()} ${r.url()}`);
  });
  await page.goto('/ultimate/run/team', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(8000);
  console.log('LOGS-START\n' + logs.join('\n---\n') + '\nLOGS-END');
  console.log('URL:' + page.url());
  const visible = await page
    .getByText(/Build your starting five|Loading your team|Couldn't load|Starter first/)
    .allTextContents()
    .catch((e) => [`ERR ${String(e)}`]);
  console.log('VISIBLE-START\n' + visible.join('\n---\n') + '\nVISIBLE-END');
  const body = await page.content();
  console.log('BODY-START\n' + body.slice(0, 10000) + '\nBODY-END');
});
