import type { OpponentBracket, SeasonDraftCatalog, Seed } from '@hoop-rush/data-contracts';
import { POSITIONS, havocInstanceSeed, opponentBracketSchema } from '@hoop-rush/data-contracts';
import { createRng, type Rng } from '../../sim/rng.ts';

type Candidate = SeasonDraftCatalog['candidates'][number];

const LEAGUE_TARGET_MIN = 65;
const LEAGUE_TARGET_MAX = 85;
const LEAGUE_BAND_RADIUS = 15;

function strengthOf(lineup: readonly Candidate[]): number {
  return (
    lineup.reduce((sum, player) => sum + player.summaryRatings.overallRating, 0) / lineup.length
  );
}

function lineupOf(candidates: readonly Candidate[]): Candidate[] | null {
  const ordered = [...candidates].sort(
    (a, b) =>
      (b.anchors?.minutesPerGame ?? 0) - (a.anchors?.minutesPerGame ?? 0) ||
      a.playerVersionId.localeCompare(b.playerVersionId),
  );
  const selected: Candidate[] = [];
  const used = new Set<string>();
  function assign(slot: number): boolean {
    const position = POSITIONS[slot];
    if (position === undefined) return true;
    for (const player of ordered) {
      if (used.has(player.playerId) || !player.positions.playable.includes(position)) continue;
      selected.push(player);
      used.add(player.playerId);
      if (assign(slot + 1)) return true;
      selected.pop();
      used.delete(player.playerId);
    }
    return false;
  }
  return assign(0) ? selected : null;
}

function varyLineup(lineup: Candidate[], roster: readonly Candidate[], rng: Rng): Candidate[] {
  const variants: Candidate[][] = [lineup];
  for (const [slot, starter] of lineup.entries()) {
    const position = POSITIONS[slot];
    for (const player of [...roster].sort((a, b) =>
      a.playerVersionId.localeCompare(b.playerVersionId),
    )) {
      if (
        position === undefined ||
        !player.positions.playable.includes(position) ||
        lineup.some((selected) => selected.playerId === player.playerId) ||
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
  const target =
    LEAGUE_TARGET_MIN +
    ((leagueRng.next() + leagueRng.next()) / 2) * (LEAGUE_TARGET_MAX - LEAGUE_TARGET_MIN);
  const seasons = new Map<string, Map<string, Candidate[]>>();
  for (const player of catalog.candidates) {
    if (player.anchors === undefined) continue;
    let franchise = seasons.get(player.franchiseId);
    if (franchise === undefined) {
      franchise = new Map<string, Candidate[]>();
      seasons.set(player.franchiseId, franchise);
    }
    let roster = franchise.get(player.seasonKey);
    if (roster === undefined) {
      roster = [];
      franchise.set(player.seasonKey, roster);
    }
    roster.push(player);
  }
  return opponentBracketSchema.parse({
    ...bracket,
    opponents: bracket.opponents.map((opponent) => {
      const choices = [...(seasons.get(opponent.teamId) ?? new Map<string, Candidate[]>())]
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([seasonKey, roster]) => {
          const lineup = lineupOf(roster);
          if (lineup === null) return [];
          const varied = varyLineup(
            lineup,
            roster,
            createRng(
              havocInstanceSeed(
                runSeed,
                'cap-rush-historical-lineup-v3',
                opponent.teamId,
                seasonKey,
              ),
            ),
          );
          return [{ seasonKey, lineup: varied, distance: Math.abs(strengthOf(varied) - target) }];
        });
      if (choices.length === 0)
        throw new Error(`Cap Rush has no historical lineup for ${opponent.teamId}`);
      const rng = createRng(
        havocInstanceSeed(runSeed, 'cap-rush-historical-field-v3', opponent.teamId),
      );
      const inBand = choices.filter((choice) => choice.distance <= LEAGUE_BAND_RADIUS);
      const nearestDistance = Math.min(...choices.map((choice) => choice.distance));
      const eligible =
        inBand.length > 0
          ? inBand
          : choices.filter((choice) => choice.distance === nearestDistance);
      const chosen = rng.weightedPick(
        eligible,
        eligible.map((choice) => 1 + Math.max(0, 1 - choice.distance / LEAGUE_BAND_RADIUS)),
      );
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
