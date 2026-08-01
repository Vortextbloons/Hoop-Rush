import { expect, test } from '@playwright/test';

async function draftLakers1990s(page: import('@playwright/test').Page) {
  await page.goto('/sandbox');
  await page.getByRole('button', { name: 'Franchise' }).click();
  await page.getByRole('option', { name: /Los Angeles Lakers/ }).click();
  await page.getByRole('button', { name: 'Decade' }).click();
  await page.getByRole('option', { name: '1990s', exact: true }).click();
  await expect(page.getByText(/44 players/)).toBeVisible();
}

test('lakers 1990s headshots fall back past the NBA CDN placeholder', async ({ page }) => {
  await draftLakers1990s(page);
  await page.waitForTimeout(3000);

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
  expect(stats.withImg).toBe(40);
  expect(stats.bbref + stats.nba + stats.wiki).toBe(stats.loaded);
  expect(stats.loaded).toBe(40);
});
