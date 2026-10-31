import type { OpponentBracket, SeasonDraftCatalog, Seed } from '@hoop-rush/data-contracts';
import { POSITIONS, havocInstanceSeed, opponentBracketSchema } from '@hoop-rush/data-contracts';
import { createRng } from '../../sim/rng.ts';

type Candidate = SeasonDraftCatalog['candidates'][number];

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

export function buildCapRushHistoricalField(
  bracket: OpponentBracket,
  catalog: SeasonDraftCatalog,
  runSeed: Seed,
): OpponentBracket {
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
          return lineup === null ? [] : [{ seasonKey, lineup }];
        });
      if (choices.length === 0)
        throw new Error(`Cap Rush has no historical lineup for ${opponent.teamId}`);
      const rng = createRng(
        havocInstanceSeed(runSeed, 'cap-rush-historical-field-v1', opponent.teamId),
      );
      const chosen = rng.pick(choices);
      return {
        ...opponent,
        seasonKey: chosen.seasonKey,
        displayName: `${opponent.displayName.replace(/\s*\(?\d{4}-\d{2,4}\)?\s*/g, ' ').trim()} ${chosen.seasonKey}`,
        lineup: {
          structure: POSITIONS,
          assignments: chosen.lineup.map((player, slotIndex) => ({
            slotIndex,
            playerId: player.playerId,
            positions: player.positions.playable,
          })),
        },
        players: chosen.lineup.map((player) => ({
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
