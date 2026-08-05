import { expect, type Page } from '@playwright/test';

/** Search the global player index and open its first exact-name card. */
export async function openPlayerPicker(page: Page, name: string): Promise<void> {
  const search = page.getByRole('searchbox', { name: 'Search players by name' });
  await search.fill(name);
  const card = page.getByRole('button', { name: new RegExp(name) }).first();
  await expect(card).toBeVisible();
  await card.click();
}

/**
 * Picks a player, waits for the placement dialog, and places them at the
 * named slot (e.g. "Point Guard slot 1").
 */
export async function placeAtSlot(page: Page, name: string, slotLabel: string): Promise<void> {
  await openPlayerPicker(page, name);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: `Place ${name} at ${slotLabel}`, exact: true }).click();
}
