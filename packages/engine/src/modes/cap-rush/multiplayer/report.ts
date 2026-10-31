import type {
  CapRushLeagueGame,
  CapRushMultiplayerLockedInputs,
  CapRushMultiplayerPlayoffState,
  CapRushMultiplayerReport,
  CapRushMultiplayerSeatId,
  CapRushMultiplayerSeatReport,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_MULTIPLAYER_REPORT_VERSION,
  CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
  capRushMultiplayerReportSchema,
} from '@hoop-rush/data-contracts';
import { capRushWinsPerMillion } from '../report.ts';
import { capRushMultiplayerSeatRecord } from './league.ts';

function spinSpendOf(
  input: CapRushMultiplayerLockedInputs,
  seat: CapRushMultiplayerSeatId,
): number {
  const lock = input.seats[seat];
  return [lock.spin, ...(lock.additionalSpins ?? [])].reduce(
    (total, receipt) => total + (receipt?.priceDollars ?? 0),
    0,
  );
}

function seatReportOf(input: {
  readonly locked: CapRushMultiplayerLockedInputs;
  readonly games: readonly CapRushLeagueGame[];
  readonly postseason: CapRushMultiplayerPlayoffState | null;
  readonly seat: CapRushMultiplayerSeatId;
}): CapRushMultiplayerSeatReport {
  const lock = input.locked.seats[input.seat];
  const record = capRushMultiplayerSeatRecord(input.locked, input.games, input.seat);
  return {
    seat: input.seat,
    franchiseId: lock.franchise.franchiseId,
    displayName: lock.franchise.displayName,
    wins: record.wins,
    losses: record.losses,
    pointsFor: record.pointsFor,
    pointsAgainst: record.pointsAgainst,
    payrollDollars: lock.payrollDollars,
    payrollStatus: lock.payrollStatus,
    spinSpendDollars: spinSpendOf(input.locked, input.seat),
    winsPerMillion: capRushWinsPerMillion(record.wins, lock.payrollDollars),
    outcome: input.postseason?.outcomes[input.seat] ?? { status: 'pending', round: null },
    roster: lock.picks,
  };
}

export function buildCapRushMultiplayerReport(input: {
  readonly locked: CapRushMultiplayerLockedInputs;
  readonly games: readonly CapRushLeagueGame[];
  readonly postseason: CapRushMultiplayerPlayoffState | null;
  readonly completedAtIso: string;
}): CapRushMultiplayerReport {
  const champion =
    input.postseason?.championTeamId ??
    (() => {
      throw new Error('cap rush multiplayer: a report requires a champion');
    })();
  return capRushMultiplayerReportSchema.parse({
    version: CAP_RUSH_MULTIPLAYER_REPORT_VERSION,
    schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
    roomId: input.locked.roomId,
    rootSeed: input.locked.rootSeed,
    variant: input.locked.variant,
    championTeamId: champion,
    seats: {
      p1: seatReportOf({ ...input, seat: 'p1' }),
      p2: seatReportOf({ ...input, seat: 'p2' }),
    },
    finalsMvp: input.postseason?.finalsMvp ?? null,
    completedAtIso: input.completedAtIso,
  });
}
