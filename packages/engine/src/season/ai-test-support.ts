import {
  type SeasonDraftCandidate,
  type SeasonDraftCatalog,
  type SeasonLeagueGenerationResult,
} from '@hoop-rush/data-contracts';
import { buildSeasonDraftCatalog, buildSeasonLeague } from '@hoop-rush/test-fixtures';
import type { SeasonRosterMemberInput } from './roster-rules.ts';
export const CATALOG = buildSeasonDraftCatalog({
  franchiseIds: ['lakers', 'celtics', 'bulls', 'warriors', 'heat', 'knicks', 'spurs', 'jazz'],
  eras: ['1980s', '1990s', '2000s', '2010s'],
  playersPerPool: 20,
});
export const LEAGUE = buildSeasonLeague();
export function humanRoster(
  catalog: SeasonDraftCatalog,
  franchiseId: string,
  eraId: string,
): string[] {
  const pool = catalog.candidates.filter((c) => c.franchiseId === franchiseId && c.eraId === eraId);
  if (pool.length < 10) throw new Error('pool too small for a human roster');
  const indices =
    pool.length >= 20 ? [0, 1, 2, 3, 4, 5, 7, 8, 10, 17] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const picks = indices
    .map((i) => pool[i])
    .filter((c): c is SeasonDraftCandidate => c !== undefined);
  if (picks.length !== 10) throw new Error('human roster incomplete');
  return picks.map((c) => c.playerVersionId);
}
export function membersOf(
  result: SeasonLeagueGenerationResult,
  franchiseId: string,
  catalog: SeasonDraftCatalog = CATALOG,
): SeasonRosterMemberInput[] {
  const roster = result.rosters.find((r) => r.franchiseId === franchiseId);
  if (!roster) throw new Error(`no roster for ${franchiseId}`);
  return roster.players.map((player) => {
    const candidate = catalog.candidates.find((c) => c.playerVersionId === player.playerVersionId);
    if (!candidate) throw new Error('roster references an unknown candidate');
    return { playerVersionId: player.playerVersionId, playable: candidate.positions.playable };
  });
}
