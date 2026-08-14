/// <reference types="node" />
import { expect, type Page } from '@playwright/test';
import {
  seasonDraftCatalogSchema,
  type SeasonDraftCatalog,
  type SeasonDraftCandidate,
} from '@hoop-rush/data-contracts';
import { rosterFeasible, type SeasonRosterMemberInput } from '@hoop-rush/engine';

/**
 * Shared Season Run e2e scaffolding (season.spec.ts): the packaged draft
 * catalog (lazy-loaded once per worker so a fetch or data-schema drift fails
 * tests with a clear message instead of failing collection at module scope),
 * the feasibility-safe DraftPlanner, offer readers, and one draft round.
 * Full-draft, AI-generation, and block-submission journeys are covered by
 * engine and persistence unit tests.
 */

/** The base URL mirrors the web app's own asset loading (the preview server). */
const seasonDraftBaseUrl = (): string =>
  process.env.HOOP_RUSH_E2E_BASE_URL ?? 'http://localhost:4173';

let catalogPromise: Promise<SeasonDraftCatalog> | null = null;

/**
 * Fetches and zod-validates the packaged draft catalog, once per worker. The
 * preview server must be up by the time the draft helpers first run, never at
 * module (collection) time; call it from beforeAll or let first use trigger
 * it lazily.
 */
export function loadDraftCatalog(): Promise<SeasonDraftCatalog> {
  catalogPromise ??= (async () => {
    const url = `${seasonDraftBaseUrl()}/data/season/draft-catalog.json`;
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new Error(
        `season draft catalog could not be fetched from ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      throw new Error(
        `season draft catalog request failed: HTTP ${String(response.status)} ${response.statusText} (${url})`,
      );
    }
    const value: unknown = await response.json();
    try {
      return seasonDraftCatalogSchema.parse(value);
    } catch (error) {
      throw new Error(
        `season draft catalog at ${url} does not match the seasonDraftCatalogSchema: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  })();
  return catalogPromise;
}

/**
 * Mirrors the engine's pick feasibility probe so the e2e always selects a
 * candidate that keeps the 4G/4F/3C completion targets feasible — the engine
 * rejects picks that would dead-end the draft, and a dead end is permanent.
 */
export class DraftPlanner {
  private picked: SeasonRosterMemberInput[] = [];

  reset(): void {
    this.picked = [];
  }

  /** Chooses the first pool candidate the engine's feasibility probe accepts. */
  async choose(candidates: SeasonDraftCandidate[]): Promise<SeasonDraftCandidate> {
    const catalog = await loadDraftCatalog();
    const pickedIds = new Set(this.picked.map((p) => p.playerVersionId));
    const available = catalog.candidates
      .filter((candidate) => !pickedIds.has(candidate.playerVersionId))
      .map((candidate): SeasonRosterMemberInput => ({
        playerVersionId: candidate.playerVersionId,
        playable: candidate.positions.playable,
      }));
    for (const candidate of candidates) {
      const probe: SeasonRosterMemberInput[] = [
        ...this.picked,
        {
          playerVersionId: candidate.playerVersionId,
          playable: candidate.positions.playable,
        },
      ];
      const remaining = 10 - probe.length;
      const stillAvailable = available.filter(
        (member) => member.playerVersionId !== candidate.playerVersionId,
      );
      if (rosterFeasible(probe, stillAvailable, remaining)) return candidate;
    }
    throw new Error('no feasibility-safe candidate in the revealed pool');
  }

  record(candidate: SeasonDraftCandidate): void {
    this.picked.push({
      playerVersionId: candidate.playerVersionId,
      playable: candidate.positions.playable,
    });
  }
}

/** Reads the drawn offer's eight cards (name + season + positions) from the board. */
export async function offerCardCandidates(page: Page): Promise<SeasonDraftCandidate[]> {
  const catalog = await loadDraftCatalog();
  const section = page.locator('section[aria-labelledby="season-offer-heading"]');
  const cards = section.locator('li');
  const count = await cards.count();
  const result: SeasonDraftCandidate[] = [];
  for (let i = 0; i < count; i += 1) {
    const text = await cards.nth(i).innerText();
    const lines = text.split('\n').map((line) => line.trim());
    const name = lines.find((line) => catalog.candidates.some((c) => c.displayName === line));
    const season = lines
      .find((line) => /^\d{4}-\d{2}/.test(line))
      ?.split('·')[0]
      ?.trim();
    const candidate = catalog.candidates.find(
      (c) => c.displayName === name && c.seasonKey === season,
    );
    if (candidate !== undefined) result.push(candidate);
  }
  return result;
}

/** Drafts one round: draw the eight-card offer, then pick a feasibility-safe card. */
export async function draftOneRound(page: Page, planner: DraftPlanner) {
  await page.getByRole('button', { name: /^Draw round \d+ offer$/ }).click();
  await expect(page.getByText(/^Offer · pick \d+$/)).toBeVisible();

  const candidates = await offerCardCandidates(page);
  expect(candidates.length).toBe(8);
  const target = await planner.choose(candidates);

  await page
    .locator('section[aria-labelledby="season-offer-heading"]')
    .locator('li')
    .filter({ hasText: `${target.displayName} ${target.seasonKey}` })
    .getByRole('button', { name: 'Pick' })
    .click();
  await expect(page.getByText(/^Offer · pick \d+$/)).toHaveCount(0, { timeout: 5000 });
  planner.record(target);
}
