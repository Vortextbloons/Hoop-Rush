import { expect, test, type Page } from '@playwright/test';

const FALLBACK_ERROR = 'Enter the 4-digit code from the host.';

test.describe('fixed-five join: guest sees the room', () => {
  test.describe.configure({ timeout: 120_000 });

  async function createRoom(page: Page): Promise<string> {
    await page.goto('/multiplayer');
    await expect(page.getByRole('heading', { name: /Two humans/i })).toBeVisible();
    await page.getByRole('button', { name: /Start a room/i }).click();
    await page.getByRole('button', { name: /Create room/i }).click();
    const digitSpans = page.locator('span.font-mono').filter({ hasText: /^[0-9]$/ });
    await expect(digitSpans.first()).toBeVisible({ timeout: 15_000 });
    let code = '';
    const count = await digitSpans.count();
    for (let i = 0; i < Math.min(4, count); i += 1) {
      code += (await digitSpans.nth(i).innerText()).trim();
    }
    expect(code).toMatch(/^[0-9]{4}$/);
    await page.getByRole('button', { name: /Enter lobby/i }).click();
    await expect(page.getByRole('heading', { name: new RegExp(`room ${code}`, 'i') })).toBeVisible(
      { timeout: 15_000 },
    );
    const url = page.url();
    const roomId = url.split('/multiplayer/room/')[1]?.split(/[?#]/)[0] ?? 'unknown';
    console.log(`E2E_ROOM ${roomId}`);
    return code;
  }

  async function joinAsGuest(page: Page, rawCode: string, typeIt = false): Promise<void> {
    await page.goto('/multiplayer');
    await expect(page.getByRole('heading', { name: /Two humans/i })).toBeVisible();
    await page.getByRole('button', { name: /Join a room/i }).click();
    if (typeIt) {
      await page.locator('#join-code').click();
      await page.keyboard.type(rawCode, { delay: 30 });
    } else {
      await page.locator('#join-code').fill(rawCode);
    }
    await page.getByRole('button', { name: /^Join/i }).click();
  }

  async function expectGuestInRoom(
    guest: Page,
    code: string,
  ): Promise<void> {
    // The user's exact symptom: stuck on the join screen with the fallback error.
    await expect(guest.getByText(FALLBACK_ERROR)).toHaveCount(0);
    await expect(
      guest.getByRole('heading', { name: new RegExp(`room ${code}`, 'i') }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(guest.getByText(FALLBACK_ERROR)).toHaveCount(0);
  }

  test('guest joins with a clean code and sees the room, never the fallback error', async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    try {
      const code = await createRoom(host);
      await joinAsGuest(guest, code);
      await expectGuestInRoom(guest, code);
      // Both lanes render for the guest.
      await expect(guest.getByText(/OPPONENT/i).first()).toBeVisible();
    } finally {
      await hostContext.close().catch(() => {});
      await guestContext.close().catch(() => {});
    }
  });

  test('guest joins with a dirty code (spaces) and still sees the room', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    try {
      const code = await createRoom(host);
      const dirty = code.split('').join(' ');
      await joinAsGuest(guest, dirty, true);
      await expectGuestInRoom(guest, code);
    } finally {
      await hostContext.close().catch(() => {});
      await guestContext.close().catch(() => {});
    }
  });
});
