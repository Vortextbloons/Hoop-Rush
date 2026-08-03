import { expect, test } from '@playwright/test';

async function draftLakers1990s(page: import('@playwright/test').Page) {
  await page.goto('/sandbox');
  const search = page.getByRole('searchbox', { name: 'Search players by name' });
  await search.fill('Nick Van Exel');
  await page
    .getByRole('button', { name: /Nick Van Exel/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Place Nick Van Exel at Point Guard slot 1', exact: true })
    .click();
  await search.fill('Magic Johnson');
  await page
    .getByRole('button', { name: /Magic Johnson/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Place Magic Johnson at Shooting Guard slot 2', exact: true })
    .click();
  await search.fill('Kobe Bryant');
  await page
    .getByRole('button', { name: /Kobe Bryant/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Place Kobe Bryant at Small Forward slot 3', exact: true })
    .click();
  await search.fill('James Worthy');
  await page
    .getByRole('button', { name: /James Worthy/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: 'Place James Worthy at Power Forward slot 4', exact: true })
    .click();
  await search.fill('Shaquille');
  await page
    .getByRole('button', { name: /Shaquille O'Neal/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: "Place Shaquille O'Neal at Center slot 5", exact: true })
    .click();
}

test('lakers 1990s headshots fall back past the NBA CDN placeholder', async ({ page }) => {
  await draftLakers1990s(page);

  // The five drafted cards settle their images (loaded or broken) or the
  // fallback chain ended on initials (no img element).
  await expect
    .poll(
      async () => {
        const settled = await page.evaluate(() => {
          const imgs = [...document.querySelectorAll('img')];
          const pending = imgs.filter((img) => !img.complete).length;
          return 5 - pending;
        });
        return settled;
      },
      { timeout: 30_000 },
    )
    .toBe(5);

  const stats = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')].filter(
      (img): img is HTMLImageElement => img instanceof HTMLImageElement,
    );
    const loaded = imgs.filter((img) => img.naturalWidth > 0);
    const broken = imgs.filter((img) => img.complete && img.naturalWidth === 0);
    return {
      withImg: imgs.length,
      loaded: loaded.length,
      broken: broken.length,
      nba: loaded.filter((img) => img.src.includes('cdn.nba.com/headshots')).length,
      bbref: loaded.filter((img) => img.src.includes('basketball-reference')).length,
      wiki: loaded.filter((img) => img.src.includes('wikimedia')).length,
    };
  });

  expect(stats.broken).toBe(0);
  // Every card settled: a loaded headshot or deterministic initials.
  expect(stats.withImg).toBe(stats.loaded);
  expect(stats.loaded + (5 - stats.withImg)).toBe(5);
  expect(stats.loaded).toBeGreaterThanOrEqual(4);
  // The backup layers must actually surface where the CDN falls back.
  expect(stats.bbref + stats.wiki).toBeGreaterThan(0);
});
