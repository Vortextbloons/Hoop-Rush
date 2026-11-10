import type { Position } from '@hoop-rush/data-contracts';
import { CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS, POSITIONS } from '@hoop-rush/data-contracts';

export interface CapRushMultiplayerFeasibilityPlayer {
  readonly playerId: string;
  readonly position: Position;
  readonly minimumBidDollars: number;
}

export interface CapRushMultiplayerFeasibilitySeat {
  readonly committedDollars: number;
  readonly reservedDollars: number;
  readonly filledPositions: readonly Position[];
}

export interface CapRushMultiplayerFeasibilityInput {
  readonly players: readonly CapRushMultiplayerFeasibilityPlayer[];
  readonly unavailablePlayerIds: ReadonlySet<string>;
  readonly seats: {
    readonly p1: CapRushMultiplayerFeasibilitySeat;
    readonly p2: CapRushMultiplayerFeasibilitySeat;
  };
  readonly limitDollars?: number;
}

interface PairCost {
  readonly p1: number;
  readonly p2: number;
}

function cheapest(
  players: readonly CapRushMultiplayerFeasibilityPlayer[],
  position: Position,
  unavailable: ReadonlySet<string>,
  count: number,
): CapRushMultiplayerFeasibilityPlayer[] {
  return players
    .filter((player) => player.position === position && !unavailable.has(player.playerId))
    .sort(
      (left, right) =>
        left.minimumBidDollars - right.minimumBidDollars ||
        (left.playerId < right.playerId ? -1 : left.playerId > right.playerId ? 1 : 0),
    )
    .slice(0, count);
}

/**
 * Exact joint completion check. Market players carry one fixed position, so positions are
 * independent and only the two-seat assignment at each position couples them: at most 2^5
 * combinations. Feasibility is monotone in cost, so the two cheapest available players per
 * shared position are sufficient.
 */
export function capRushMultiplayerCompletionFeasible(
  input: CapRushMultiplayerFeasibilityInput,
): boolean {
  const limit = input.limitDollars ?? CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS;
  const seats = [input.seats.p1, input.seats.p2];
  let combinations: PairCost[] = [{ p1: 0, p2: 0 }];
  for (const position of POSITIONS) {
    const need = seats.map((seat) => !seat.filledPositions.includes(position));
    const p1Needs = need[0] === true;
    const p2Needs = need[1] === true;
    if (!p1Needs && !p2Needs) continue;
    if (p1Needs && p2Needs) {
      const [first, second] = cheapest(input.players, position, input.unavailablePlayerIds, 2);
      if (first === undefined || second === undefined) return false;
      const options: PairCost[] = [
        { p1: first.minimumBidDollars, p2: second.minimumBidDollars },
        { p1: second.minimumBidDollars, p2: first.minimumBidDollars },
      ];
      combinations = combinations.flatMap((base) =>
        options.map((option) => ({
          p1: base.p1 + option.p1,
          p2: base.p2 + option.p2,
        })),
      );
      continue;
    }
    const [only] = cheapest(input.players, position, input.unavailablePlayerIds, 1);
    if (only === undefined) return false;
    combinations = combinations.map((base) => ({
      p1: base.p1 + (p1Needs ? only.minimumBidDollars : 0),
      p2: base.p2 + (p2Needs ? only.minimumBidDollars : 0),
    }));
  }
  return combinations.some(
    (combination) =>
      input.seats.p1.committedDollars + input.seats.p1.reservedDollars + combination.p1 <= limit &&
      input.seats.p2.committedDollars + input.seats.p2.reservedDollars + combination.p2 <= limit,
  );
}
