import { expect, type Page } from '@playwright/test';

/** Search the global player index and open its first exact-name card. */
export async function openPlayerPicker(page: Page, name: string): Promise<void> {
  const search = page.getByRole('searchbox', { name: 'Search players by name' });
  await search.fill(name);
  const card = page.getByRole('button', { name: new RegExp(name) }).first();
  await expect(card).toBeVisible();
  await card.click();
}
