import type {
  OpponentBracket,
  SeasonDraftCatalog,
  SeasonKey,
  Seed,
} from '@hoop-rush/data-contracts';
import { POSITIONS, havocInstanceSeed, opponentBracketSchema } from '@hoop-rush/data-contracts';
import { createRng, type Rng } from '../../sim/rng.ts';
import {
  adjacentHistoricalPlayers,
  chooseHistoricalTeam,
  groupHistoricalRosters,
  historicalLeagueStrengthTarget,
  historicalLineupOf,
} from '../historical-rosters.ts';

type Candidate = SeasonDraftCatalog['candidates'][number];

function strengthOf(lineup: readonly Candidate[]): number {
  return (
    lineup.reduce((sum, player) => sum + player.summaryRatings.overallRating, 0) / lineup.length
  );
}

function varyLineup(lineup: Candidate[], roster: readonly Candidate[], rng: Rng): Candidate[] {
  const variants: Candidate[][] = [lineup];
  const ordered = [...roster].sort((a, b) => a.playerVersionId.localeCompare(b.playerVersionId));
  for (const [slot, starter] of lineup.entries()) {
    const position = POSITIONS[slot];
    for (const player of ordered) {
      if (
        position === undefined ||
        !player.positions.playable.includes(position) ||
        lineup.some(
          (selected, index) =>
            selected.playerId === player.playerId &&
            (index !== slot || selected.seasonKey === player.seasonKey),
        ) ||
        Math.abs(player.summaryRatings.overallRating - starter.summaryRatings.overallRating) > 2 ||
        (player.anchors?.minutesPerGame ?? 0) < (starter.anchors?.minutesPerGame ?? 0) * 0.8
      )
        continue;
      variants.push(lineup.map((selected, index) => (index === slot ? player : selected)));
    }
  }
  return rng.pick(variants);
}

export function buildCapRushHistoricalField(
  bracket: OpponentBracket,
  catalog: SeasonDraftCatalog,
  runSeed: Seed,
): OpponentBracket {
  const leagueRng = createRng(havocInstanceSeed(runSeed, 'cap-rush-league-strength-v1'));
  const target = historicalLeagueStrengthTarget(leagueRng);
  const seasons = groupHistoricalRosters(catalog);
  return opponentBracketSchema.parse({
    ...bracket,
    opponents: bracket.opponents.map((opponent) => {
      const franchiseSeasons =
        seasons.get(opponent.teamId) ?? new Map<SeasonKey, readonly Candidate[]>();
      const choices = [...franchiseSeasons]
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([seasonKey, roster]) => {
          const lineup = historicalLineupOf(roster, seasonKey);
          const adjacent = adjacentHistoricalPlayers(franchiseSeasons, seasonKey);
          const candidates = [...roster, ...adjacent];
          const varied =
            lineup === null
              ? (historicalLineupOf(candidates, seasonKey, 1) ??
                historicalLineupOf(candidates, seasonKey, 2))
              : varyLineup(
                  lineup,
                  candidates,
                  createRng(
                    havocInstanceSeed(
                      runSeed,
                      'cap-rush-historical-lineup-v3',
                      opponent.teamId,
                      seasonKey,
                    ),
                  ),
                );
          if (varied === null) return [];
          return [{ seasonKey, lineup: varied, distance: Math.abs(strengthOf(varied) - target) }];
        });
      if (choices.length === 0)
        throw new Error(`Cap Rush has no historical lineup for ${opponent.teamId}`);
      const rng = createRng(
        havocInstanceSeed(runSeed, 'cap-rush-historical-field-v3', opponent.teamId),
      );
      const chosen = chooseHistoricalTeam(choices, rng);
      const lineup = chosen.lineup;
      return {
        ...opponent,
        seasonKey: chosen.seasonKey,
        displayName: `${opponent.displayName.replace(/\s*\(?\d{4}-\d{2,4}\)?\s*/g, ' ').trim()} ${chosen.seasonKey}`,
        lineup: {
          structure: POSITIONS,
          assignments: lineup.map((player, slotIndex) => ({
            slotIndex,
            playerId: player.playerId,
            positions: player.positions.playable,
          })),
        },
        players: lineup.map((player) => ({
          playerId: player.playerId,
          playerVersionId: player.playerVersionId,
          displayName: player.displayName,
          positions: player.positions.playable,
          heightInches: player.heightInches,
          weightLbs: player.weightLbs,
          ratings: player.detailedRatings,
          tendencies: player.tendencies,
          anchors: player.anchors,
          overall: player.summaryRatings.overallRating,
          reconstructedThreePoint: player.reconstructedThreePoint,
        })),
      };
    }),
  });
}
