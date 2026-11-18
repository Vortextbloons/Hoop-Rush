import type { CapRushMultiplayerSeatId, CapRushMultiplayerState } from '@hoop-rush/data-contracts';
import {
  capRushMultiplayerHumanFinals,
  evaluateCapRushMultiplayerAchievements,
  type CapRushMultiplayerAchievementFacts,
} from '@hoop-rush/engine';

type CapRushMultiplayerAchievement = ReturnType<
  typeof evaluateCapRushMultiplayerAchievements
>[number];

function rivalSeat(seat: CapRushMultiplayerSeatId): CapRushMultiplayerSeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/**
 * Builds pure achievement facts from accepted room state. Payroll uses the
 * locked player salaries (the report's `payrollDollars`), never mutation spend.
 */
export function capRushMultiplayerAchievementFacts(input: {
  readonly state: CapRushMultiplayerState;
  readonly seat: CapRushMultiplayerSeatId;
}): CapRushMultiplayerAchievementFacts | null {
  const locked = input.state.locked;
  if (locked === null) return null;

  const rivalId = rivalSeat(input.seat);
  const participantTeamId = locked.seats[input.seat].franchise.franchiseId;
  const rivalTeamId = locked.seats[rivalId].franchise.franchiseId;
  const report = input.state.report;
  const championTeamId =
    report?.championTeamId ??
    input.state.completion?.championTeamId ??
    input.state.postseason?.championTeamId ??
    null;
  const championSeat =
    championTeamId === participantTeamId
      ? input.seat
      : championTeamId === rivalTeamId
        ? rivalId
        : null;

  const payrollDollars = {
    p1: report?.seats.p1.payrollDollars ?? locked.seats.p1.payrollDollars,
    p2: report?.seats.p2.payrollDollars ?? locked.seats.p2.payrollDollars,
  };

  const headToHead = (input.state.season?.games ?? [])
    .filter(
      (game) =>
        (game.homeTeamId === participantTeamId || game.homeTeamId === rivalTeamId) &&
        (game.awayTeamId === participantTeamId || game.awayTeamId === rivalTeamId) &&
        (game.winnerTeamId === participantTeamId || game.winnerTeamId === rivalTeamId),
    )
    .sort((left, right) => left.slot - right.slot)
    .map((game) => ({
      gameId: game.gameId,
      winnerSeat: game.winnerTeamId === participantTeamId ? input.seat : rivalId,
    }));

  const finalsSeries =
    input.state.postseason === null
      ? null
      : capRushMultiplayerHumanFinals(locked, input.state.postseason);
  const finalsTeamIds =
    finalsSeries === null ? [] : [finalsSeries.highTeamId, finalsSeries.lowTeamId];
  const finals =
    championTeamId !== null &&
    finalsTeamIds.includes(participantTeamId) &&
    finalsTeamIds.includes(rivalTeamId)
      ? { participantTeamId, rivalTeamId, winnerTeamId: championTeamId }
      : null;

  return {
    participantId: input.seat,
    rivalId,
    championSeat,
    payrollDollars,
    headToHead,
    finals,
  };
}

export function capRushMultiplayerAchievements(input: {
  readonly state: CapRushMultiplayerState;
  readonly seat: CapRushMultiplayerSeatId;
}): CapRushMultiplayerAchievement[] {
  const facts = capRushMultiplayerAchievementFacts(input);
  return facts === null ? [] : evaluateCapRushMultiplayerAchievements(facts);
}
