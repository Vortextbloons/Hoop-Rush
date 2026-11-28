import {
  capRushConferenceRoundName,
  franchiseAbbreviation,
  type CapRushPayrollStatus,
  type FullCourtHistoryRecord,
  type FullCourtTactics,
} from '@hoop-rush/data-contracts';
import {
  fullCourtPayrollDollars,
  fullCourtPayrollStatus,
  fullCourtWarChestDollars,
} from '@hoop-rush/engine';
import {
  capStatusClass,
  capStatusLabel,
  formatMillions,
} from '#lib/features/cap-rush/cap-rush-presentation.js';
import { fullCourtVariantLabel } from './full-court-draft-presentation.js';

const TACTICS_LABELS: {
  readonly pace: Readonly<Record<FullCourtTactics['pace'], string>>;
  readonly offense: Readonly<Record<FullCourtTactics['offense'], string>>;
  readonly defense: Readonly<Record<FullCourtTactics['defense'], string>>;
} = {
  pace: { slow: 'Slow', balanced: 'Balanced', fast: 'Fast' },
  offense: {
    balanced: 'Balanced',
    perimeter: 'Perimeter',
    interior: 'Interior',
    'ball-movement': 'Ball movement',
  },
  defense: { balanced: 'Balanced', pressure: 'Pressure', 'protect-paint': 'Protect paint' },
};

const ACHIEVEMENT_NAMES: Readonly<Record<FullCourtHistoryRecord['achievements'][number], string>> =
  {
    'bench-mob': 'Bench Mob',
    'the-chess-match': 'The Chess Match',
  };

export interface FullCourtHistoryRosterRow {
  readonly playerId: string;
  readonly playerVersionId: string;
  readonly displayName: string;
  readonly seasonKey: string;
  readonly teamAbbreviation: string;
  readonly position: string;
  readonly overall: number;
  readonly salaryLabel: string;
  readonly minutesTarget: number | null;
  readonly starter: boolean;
  readonly closer: boolean;
}

export interface FullCourtHistoryEntryView {
  readonly runId: string;
  readonly completedDateLabel: string;
  readonly teamName: string;
  readonly variant: FullCourtHistoryRecord['draft']['variant'];
  readonly variantLabel: string;
  readonly regularRecordLabel: string;
  readonly pointDiffLabel: string;
  /** Null for legacy archives written before compact bench totals existed. */
  readonly benchSummaryLabel: string | null;
  readonly benchBestGameLabel: string | null;
  readonly playoffStatus: FullCourtHistoryRecord['playoffs']['status'];
  readonly playoffLabel: string;
  readonly playoffTone: 'positive' | 'negative' | 'neutral';
  readonly championName: string;
  readonly seriesWon: number;
  readonly payrollLabel: string;
  readonly capStatus: CapRushPayrollStatus;
  readonly capStatusLabel: string;
  readonly capStatusClass: string;
  readonly warChestSpentLabel: string;
  readonly warChestRemainingLabel: string;
  readonly scoutingSpentLabel: string;
  readonly spinSpentLabel: string;
  readonly strategySummary: string;
  readonly customRotation: boolean;
  readonly roster: readonly FullCourtHistoryRosterRow[];
  readonly achievements: readonly {
    readonly id: FullCourtHistoryRecord['achievements'][number];
    readonly name: string;
  }[];
}

export function presentFullCourtHistoryEntry(
  record: FullCourtHistoryRecord,
): FullCourtHistoryEntryView {
  const payrollDollars = fullCourtPayrollDollars(record.draft.picks);
  const capStatus = fullCourtPayrollStatus(payrollDollars, record.draft.money);
  const warChestRemaining = fullCourtWarChestDollars(record.draft);
  const warChestSpent = record.draft.money.startingWarChestDollars - warChestRemaining;
  const scoutingSpent = record.draft.spending
    .filter((entry) => entry.kind === 'scouting')
    .reduce((sum, entry) => sum + entry.dollars, 0);
  const spinSpent = record.draft.spending
    .filter((entry) => entry.kind === 'spin')
    .reduce((sum, entry) => sum + entry.dollars, 0);

  const rotation = record.coaching.rotation;
  const starters = new Set(rotation?.startingFive ?? []);
  const closers = new Set(rotation?.closingFive ?? []);
  const roster = [...record.draft.picks]
    .sort(
      (left, right) =>
        right.player.originalOverall - left.player.originalOverall ||
        left.pickOrdinal - right.pickOrdinal,
    )
    .map((pick): FullCourtHistoryRosterRow => {
      const target =
        rotation !== undefined && Object.hasOwn(rotation.minuteTargets, pick.player.playerId)
          ? (rotation.minuteTargets[pick.player.playerId] ?? null)
          : null;
      return {
        playerId: pick.player.playerId,
        playerVersionId: pick.player.playerVersionId,
        displayName: pick.player.displayName,
        seasonKey: pick.player.seasonKey,
        teamAbbreviation: franchiseAbbreviation(pick.player.franchiseId),
        position: pick.player.positions.join('/'),
        overall: pick.player.originalOverall,
        salaryLabel: formatMillions(pick.salaryDollars),
        minutesTarget: target,
        starter: starters.has(pick.player.playerId),
        closer: closers.has(pick.player.playerId),
      };
    });

  const { tactics } = record.coaching;
  const strategySummary = [
    `${TACTICS_LABELS.pace[tactics.pace]} pace`,
    `${TACTICS_LABELS.offense[tactics.offense]} offense`,
    `${TACTICS_LABELS.defense[tactics.defense]} defense`,
  ].join(' · ');

  const { playoffs, regularSeason } = record;
  const playoffLabel =
    playoffs.status === 'champion'
      ? 'Champions'
      : playoffs.status === 'eliminated'
        ? `Eliminated · ${playoffs.eliminatedRound === null ? 'Playoffs' : capRushConferenceRoundName(playoffs.eliminatedRound)}`
        : 'Missed playoffs';
  const playoffTone =
    playoffs.status === 'champion'
      ? 'positive'
      : playoffs.status === 'eliminated'
        ? 'negative'
        : 'neutral';

  const bench = record.bench;
  const benchSummaryLabel =
    bench === undefined
      ? null
      : `Bench scoring: ${String(bench.totalBenchPoints)} total · ${String(bench.averageBenchPoints)} average over ${String(bench.gamesRecorded)} game${bench.gamesRecorded === 1 ? '' : 's'}`;
  const benchBestGameLabel =
    bench?.bestGame === undefined || bench.bestGame === null
      ? null
      : `Best bench game: ${String(bench.bestGame.benchPoints)} points in game ${String(bench.bestGame.gameNumber)}`;

  return {
    runId: record.runId,
    completedDateLabel: new Date(record.completedAtIso).toLocaleDateString(),
    teamName: record.teamName,
    variant: record.draft.variant,
    variantLabel: fullCourtVariantLabel(record.draft),
    regularRecordLabel: `${String(regularSeason.wins)}–${String(regularSeason.losses)}`,
    pointDiffLabel:
      regularSeason.pointDifferential > 0
        ? `+${String(regularSeason.pointDifferential)}`
        : String(regularSeason.pointDifferential),
    benchSummaryLabel,
    benchBestGameLabel,
    playoffStatus: playoffs.status,
    playoffLabel,
    playoffTone,
    championName: playoffs.championName,
    seriesWon: playoffs.seriesWon,
    payrollLabel: formatMillions(payrollDollars),
    capStatus,
    capStatusLabel: capStatusLabel(capStatus),
    capStatusClass: capStatusClass(capStatus),
    warChestSpentLabel: formatMillions(warChestSpent),
    warChestRemainingLabel: formatMillions(warChestRemaining),
    scoutingSpentLabel: formatMillions(scoutingSpent),
    spinSpentLabel: formatMillions(spinSpent),
    strategySummary,
    customRotation: rotation !== undefined,
    roster,
    achievements: record.achievements.map((id) => ({ id, name: ACHIEVEMENT_NAMES[id] })),
  };
}
