import { expect, type Page } from '@playwright/test';

export async function expectCommittedGame(page: Page): Promise<void> {
  await expect(page.getByText(/\d+\/82 committed/)).not.toHaveText('0/82 committed', {
    timeout: 15_000,
  });
}
