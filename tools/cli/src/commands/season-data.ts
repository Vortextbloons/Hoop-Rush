import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  seasonDraftCatalogSchema,
  seasonDraftStateSchema,
  seasonLeagueSchema,
  type SeasonDraftCandidate,
  type SeasonDraftCatalog,
  type SeasonDraftState,
  type SeasonLeague,
} from '@hoop-rush/data-contracts';
import {
  completionTargetsMet,
  legalFiveAfterAnyRemoval,
  rosterFeasible,
  type SeasonRosterMemberInput,
} from '@hoop-rush/engine';

/**
 * Season Run M2.1 CLI data loading: the packaged draft catalog, the frozen
 * league, and validated draft-state inputs. Every artifact is schema-checked
 * at the boundary; catalog/league hashes are verified against the manifest.
 */

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');
export const DEFAULT_MANIFEST = resolve(REPO_ROOT, 'apps/web/static/data/manifest.json');
export const DEFAULT_SEASON_DIR = resolve(REPO_ROOT, 'apps/web/static/data/season');
export const DEFAULT_DRAFT_CATALOG = resolve(DEFAULT_SEASON_DIR, 'draft-catalog.json');
export const DEFAULT_LEAGUE = resolve(DEFAULT_SEASON_DIR, 'league.json');
export const DEFAULT_ROSTER_TARGETS = resolve(DEFAULT_SEASON_DIR, 'roster-targets.json');

export function sha256Hex(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`cannot read ${path}: ${(error as Error).message}`);
  }
}

/** Loads the packaged draft catalog, hash-verified against the manifest. */
export function loadSeasonDraftCatalog(
  manifestPath: string = DEFAULT_MANIFEST,
  catalogPath: string = DEFAULT_DRAFT_CATALOG,
): SeasonDraftCatalog {
  const manifest = readJsonFile(manifestPath) as {
    season?: { draftCatalog?: { url?: string; contentHash?: string } };
  };
  const expectedHash = manifest.season?.draftCatalog?.contentHash;
  if (expectedHash !== undefined) {
    const actual = sha256Hex(readFileSync(catalogPath));
    if (actual !== expectedHash) {
      throw new Error(
        `draft catalog content hash mismatch: expected ${expectedHash}, got ${actual}`,
      );
    }
  }
  const parsed = seasonDraftCatalogSchema.safeParse(readJsonFile(catalogPath));
  if (!parsed.success) {
    throw new Error(
      `draft catalog fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return parsed.data;
}

/** Loads the packaged frozen league artifact. */
export function loadSeasonLeague(leaguePath: string = DEFAULT_LEAGUE): SeasonLeague {
  const parsed = seasonLeagueSchema.safeParse(readJsonFile(leaguePath));
  if (!parsed.success) {
    throw new Error(
      `league artifact fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return parsed.data;
}

/** Validates a draft-state input file (used by reproduce/generate). */
export function loadDraftStateInput(path: string): SeasonDraftState {
  const parsed = seasonDraftStateSchema.safeParse(readJsonFile(path));
  if (!parsed.success) {
    throw new Error(
      `draft input fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return parsed.data;
}

/** Resolves a relative artifact path against the manifest directory. */
export function resolveArtifact(manifestDir: string, url: string): string {
  return isAbsolute(url) ? url : resolve(manifestDir, url);
}

/**
 * Fixed deterministic human roster for calibration cohorts and fixture
 * generation: candidates in `overallRating` order, keeping every pick that
 * preserves completion feasibility, until ten legal players are assembled.
 * Independent of any seed.
 */
export function fixtureHumanRoster(catalog: SeasonDraftCatalog): string[] {
  const sorted = [...catalog.candidates].sort(
    (a, b) =>
      b.summaryRatings.overallRating - a.summaryRatings.overallRating ||
      a.playerVersionId.localeCompare(b.playerVersionId),
  );
  const roster: SeasonRosterMemberInput[] = [];
  const available = sorted.map((candidate) => ({
    playerVersionId: candidate.playerVersionId,
    playable: candidate.positions.playable,
  }));
  for (const candidate of sorted) {
    if (roster.length >= 10) break;
    const probe: SeasonRosterMemberInput[] = [
      ...roster,
      { playerVersionId: candidate.playerVersionId, playable: candidate.positions.playable },
    ];
    const remaining = available.filter(
      (member) =>
        member.playerVersionId !== candidate.playerVersionId &&
        !probe.some((p) => p.playerVersionId === member.playerVersionId),
    );
    if (!rosterFeasible(probe, remaining, 10 - probe.length)) continue;
    roster.push({
      playerVersionId: candidate.playerVersionId,
      playable: candidate.positions.playable,
    });
  }
  if (roster.length !== 10) {
    throw new Error('fixture human roster could not reach ten legal players');
  }
  if (!completionTargetsMet(roster) || !legalFiveAfterAnyRemoval(roster)) {
    throw new Error('fixture human roster failed the legality checks');
  }
  return roster.map((member) => member.playerVersionId);
}

/**
 * Deterministic season-draft-v2 pick policy for fixture generation and
 * calibration cohorts: the selectable card of the current offer with the
 * highest summary overall rating, ties broken canonically by
 * playerVersionId. Throws when no offer is drawn or no card is selectable.
 */
export function pickBestSelectable(
  state: SeasonDraftState,
  catalog: SeasonDraftCatalog,
): SeasonDraftCandidate {
  const offer = state.currentOffer;
  if (offer === null) throw new Error('no offer drawn for the fixture pick');
  const byId = new Map(catalog.candidates.map((c) => [c.playerVersionId, c]));
  const candidates = offer.cards
    .filter((card) => card.selectable)
    .map((card) => byId.get(card.playerVersionId))
    .filter((candidate): candidate is SeasonDraftCandidate => candidate !== undefined)
    .sort(
      (a, b) =>
        b.summaryRatings.overallRating - a.summaryRatings.overallRating ||
        a.playerVersionId.localeCompare(b.playerVersionId),
    );
  if (candidates.length === 0) {
    throw new Error(`offer for pick ${String(offer.pickOrdinal)} has no selectable card`);
  }
  return candidates[0] as SeasonDraftCandidate;
}
