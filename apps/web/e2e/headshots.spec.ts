import { expect, test } from '@playwright/test';

async function draftLakers1990s(page: import('@playwright/test').Page) {
  await page.goto('/sandbox');
  await page.getByRole('button', { name: 'Franchise' }).click();
  await page.getByRole('option', { name: /Los Angeles Lakers/ }).click();
  await page.getByRole('button', { name: 'Decade' }).click();
  await page.getByRole('option', { name: '1990s', exact: true }).click();
  await expect(page.getByRole('heading', { name: /LAL · 1990s/ })).toBeVisible();
  await expect(page.getByText(/44 players/)).toBeVisible();
}

test('lakers 1990s headshots fall back past the NBA CDN placeholder', async ({ page }) => {
  await draftLakers1990s(page);

  // A card is settled once its img has completed (loaded or broken) or the
  // fallback chain ended on initials (no img element). Lazy images below the
  // fold never start until scrolled into view, and a stalled CDN request is
  // advanced past by the PlayerFace load timeout.
  await expect
    .poll(
      async () => {
        const settled = await page.evaluate(() => {
          const lists = [...document.querySelectorAll('ul')].filter((ul) => {
            const buttons = [...ul.querySelectorAll('button')];
            return buttons.length > 0 && buttons.every((b) => b.textContent.match(/O \d+/));
          });
          const list = lists[0];
          if (!list) return 0;
          const imgs = [...list.querySelectorAll('img')];
          const pending = imgs.filter((img) => !img.complete).length;
          if (pending > 0) list.scrollTop = list.scrollHeight;
          return list.querySelectorAll('button').length - pending;
        });
        return settled;
      },
      { timeout: 30_000 },
    )
    .toBe(44);

  const stats = await page.evaluate(() => {
    const playerButtons = [...document.querySelectorAll('ul button')].filter((btn) =>
      btn.textContent.match(/O \d+/),
    );
    const playerImgs = playerButtons
      .map((btn) => btn.querySelector('img'))
      .filter((img): img is HTMLImageElement => img instanceof HTMLImageElement);
    const loaded = playerImgs.filter((img) => img.naturalWidth > 0);
    const broken = playerImgs.filter((img) => img.complete && img.naturalWidth === 0);
    const nba = loaded.filter((img) => img.src.includes('cdn.nba.com/headshots'));
    const bbref = loaded.filter((img) => img.src.includes('basketball-reference'));
    const wiki = loaded.filter((img) => img.src.includes('wikimedia'));
    return {
      playerCount: playerButtons.length,
      withImg: playerImgs.length,
      loaded: loaded.length,
      broken: broken.length,
      nba: nba.length,
      bbref: bbref.length,
      wiki: wiki.length,
    };
  });

  expect(stats.playerCount).toBe(44);
  expect(stats.broken).toBe(0);
  // Every card settled: a loaded headshot or deterministic initials.
  expect(stats.withImg).toBe(stats.loaded);
  expect(stats.bbref + stats.nba + stats.wiki).toBe(stats.loaded);
  expect(stats.loaded + (44 - stats.withImg)).toBe(44);
  // The fallback chain should still surface a real photo for the large
  // majority even when the NBA CDN resets concurrent requests; six 1990s
  // Lakers have no bbref photo, so their cards depend on the CDN alone.
  expect(stats.loaded).toBeGreaterThanOrEqual(38);
  // The two backup layers (bbref + wiki photos) must actually surface: if a
  // pool build drops altIds (nbaHeadshotAvailable/photoUrl), players without
  // a real CDN photo settle on the generic CDN silhouette and no non-CDN
  // image ever loads. At least one bbref or wiki photo must appear.
  expect(stats.bbref + stats.wiki).toBeGreaterThan(0);
});
