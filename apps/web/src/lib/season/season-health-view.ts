import {
  SEASON_ENDING_MISSED_GAMES_SENTINEL,
  type SeasonCompactInjuryEvent,
  type SeasonGameSummary,
  type SeasonHealthState,
  type SeasonInjuryRecord,
  type SeasonInjurySeverity,
  type SeasonInjuryType,
  type SeasonRoster,
  type SeasonRotation,
} from '@hoop-rush/data-contracts';

/**
 * M2.5 health presentation (season-health-v1). Pure derivations of display
 * facts from the recorded health state and game summaries: availability
 * status per player, recovery estimates from the remaining-games countdown
 * and the committed schedule, recurrence windows, the compact checkpoint
 * health strip rows, and the per-player injury timeline for the roster tab.
 *
 * Availability mirrors the frozen engine derivation ("unavailable at a
 * game's tipoff iff they have an active injury that is not same-game-returned
 * and has missed games remaining"); the engine stays the authority, this
 * module only renders recorded facts.
 */

export type InjuryStatus = 'active' | 'returned' | 'none';

/** Records that keep a player unavailable at the next tipoff. */
export function activeInjuriesOf(
  health: SeasonHealthState,
  playerVersionId: string,
): SeasonInjuryRecord[] {
  return health.injuries.filter(
    (record) =>
      record.playerVersionId === playerVersionId &&
      record.missedGamesRemaining > 0 &&
      record.sameGameReturned !== true,
  );
}

/** Availability status of one player from the recorded health state. */
export function injuryStatusOf(health: SeasonHealthState, playerVersionId: string): InjuryStatus {
  if (activeInjuriesOf(health, playerVersionId).length > 0) return 'active';
  const hasRecord = health.injuries.some((record) => record.playerVersionId === playerVersionId);
  if (hasRecord) return 'returned';
  return 'none';
}

export interface RecoveryEstimate {
  /** Team games still missed at the last recorded boundary. */
  remainingGames: number;
  /** Earliest round the player can be back (round of the remaining-th future team game). */
  returnRoundMin: number | null;
  /** Latest round the player can be back (same cadence: per team game). */
  returnRoundMax: number | null;
  seasonEnding: boolean;
}

/**
 * Recovery estimate for one injury record. `futureTeamGames` is the player's
 * franchise games strictly after the occurrence game, round-ascending; the
 * recovery cadence is one countdown per team game, so the return round is the
 * round of the `remainingGames`-th future team game (exact when the schedule
 * is known; min == max).
 */
export function recoveryEstimate(
  record: SeasonInjuryRecord,
  futureTeamGames: readonly { gameId: string; round: number }[],
): RecoveryEstimate {
  const seasonEnding =
    record.seasonEnding || record.missedGamesRemaining >= SEASON_ENDING_MISSED_GAMES_SENTINEL;
  const remainingGames = seasonEnding ? record.missedGamesRemaining : record.missedGamesRemaining;
  if (remainingGames <= 0 || futureTeamGames.length === 0) {
    return { remainingGames, returnRoundMin: null, returnRoundMax: null, seasonEnding };
  }
  const target = futureTeamGames[Math.min(remainingGames, futureTeamGames.length) - 1];
  const round = target?.round ?? null;
  return {
    remainingGames,
    returnRoundMin: remainingGames <= futureTeamGames.length ? round : null,
    returnRoundMax: remainingGames <= futureTeamGames.length ? round : null,
    seasonEnding,
  };
}

/** Recurrence flag: the +40 bp recurrence window is open after an actual return. */
export function recurrenceOf(record: SeasonInjuryRecord): boolean {
  return record.recurrenceWindowRoundsRemaining > 0;
}

export interface AvailabilityStripRow {
  playerVersionId: string;
  displayName: string;
  status: InjuryStatus;
  /** Return round range of the active injury (null when unknown or none). */
  returnRange: { min: number | null; max: number | null } | null;
  recurrence: boolean;
  /** The next human game where the player is out, when the player is out. */
  nextGameConsequence: string | null;
}

/**
 * Compact per-player availability rows for the checkpoint health strip.
 * `franchiseGames` (the player's franchise games, any order) enables the
 * return-round estimate; `names` overrides roster display names.
 */
export function availabilityStripRows(
  health: SeasonHealthState,
  roster: SeasonRoster,
  rotations: readonly SeasonRotation[],
  franchiseGames?: readonly { gameId: string; round: number }[],
  names?: ReadonlyMap<string, string>,
): AvailabilityStripRow[] {
  void rotations;
  const gamesByFranchise =
    franchiseGames === undefined
      ? null
      : franchiseGames.filter((game) => game.round > 0).sort((a, b) => a.round - b.round);
  const rows: AvailabilityStripRow[] = [];
  for (const entry of roster.players) {
    const playerVersionId = entry.playerVersionId;
    const records = health.injuries.filter((record) => record.playerVersionId === playerVersionId);
    const active = records.filter(
      (record) => record.missedGamesRemaining > 0 && record.sameGameReturned !== true,
    );
    const status: InjuryStatus =
      active.length > 0 ? 'active' : records.length > 0 ? 'returned' : 'none';
    let returnRange: AvailabilityStripRow['returnRange'] = null;
    let nextGameConsequence: string | null = null;
    const activeRecord = active[0];
    if (activeRecord !== undefined) {
      const record = activeRecord;
      const occurrenceRound = occurrenceRoundOf(record, franchiseGames);
      const future =
        gamesByFranchise === null
          ? []
          : gamesByFranchise.filter((game) => game.round > occurrenceRound);
      const estimate = recoveryEstimate(record, future);
      if (estimate.seasonEnding) {
        nextGameConsequence = 'Out for the rest of the season';
      } else if (estimate.remainingGames > 0) {
        const gameWord = estimate.remainingGames === 1 ? 'game' : 'games';
        const round = estimate.returnRoundMin;
        nextGameConsequence = `Out for the next ${String(estimate.remainingGames)} ${gameWord}${
          round !== null ? ` · back around R${String(round)}` : ''
        }`;
        if (round !== null) returnRange = { min: round, max: round };
      }
    } else if (status === 'returned') {
      const returnRound = records.find((record) => record.actualReturnRound !== null);
      const recurrence = records.some(recurrenceOf);
      if (recurrence) {
        nextGameConsequence = `Back · recurrence risk ${String(
          records.find(recurrenceOf)?.recurrenceWindowRoundsRemaining ?? 0,
        )} games`;
      } else if (returnRound?.actualReturnRound !== undefined) {
        nextGameConsequence = `Available · back since R${String(returnRound.actualReturnRound)}`;
      } else {
        nextGameConsequence = 'Available';
      }
    }
    rows.push({
      playerVersionId,
      displayName: names?.get(playerVersionId) ?? entry.displayName,
      status,
      returnRange,
      recurrence: records.some(recurrenceOf),
      nextGameConsequence,
    });
  }
  return rows;
}

function occurrenceRoundOf(
  record: SeasonInjuryRecord,
  games: readonly { gameId: string; round: number }[] | undefined,
): number {
  if (games === undefined) return 0;
  return games.find((game) => game.gameId === record.gameId)?.round ?? 0;
}

/** One recorded injury fact on a player's timeline (health record + game facts). */
export interface InjuryTimelineEntry {
  injuryId: string;
  gameId: string;
  type: SeasonInjuryType;
  severity: SeasonInjurySeverity;
  /** Natural occurrence or a failed risky rehab (+1 rehabModifier). */
  source: 'natural' | 'risky-rehab-failure';
  seasonEnding: boolean;
  sameGameReturn: boolean;
  missedGamesTotal: number;
  missedGamesRemaining: number;
  actualReturnRound: number | null;
  recurrence: boolean;
  removedClock: { period: number; seconds: number } | null;
  returnedInGame: boolean;
  returnClock: { period: number; seconds: number } | null;
}

export interface InjuryTimelinePlayer {
  playerVersionId: string;
  displayName: string;
  entries: InjuryTimelineEntry[];
}

/**
 * Per-player injury history for the roster tab: the run-scoped health
 * records of the franchise's players, enriched with the compact in-game
 * facts (removal/return clocks) from the accepted game summaries.
 */
export function humanInjuryTimeline(
  health: SeasonHealthState,
  roster: SeasonRoster,
  franchiseId: string,
  summaries?: readonly SeasonGameSummary[],
): InjuryTimelinePlayer[] {
  const eventsByGame = new Map<string, SeasonCompactInjuryEvent[]>();
  for (const summary of summaries ?? []) {
    if (summary.homeFranchiseId !== franchiseId && summary.awayFranchiseId !== franchiseId) {
      continue;
    }
    for (const event of summary.injuryEvents) {
      const list = eventsByGame.get(event.playerVersionId) ?? [];
      list.push(event);
      eventsByGame.set(event.playerVersionId, list);
    }
  }
  const players: InjuryTimelinePlayer[] = [];
  for (const entry of roster.players) {
    const records = health.injuries.filter(
      (record) =>
        record.playerVersionId === entry.playerVersionId && record.franchiseId === franchiseId,
    );
    if (records.length === 0) continue;
    const entries: InjuryTimelineEntry[] = records.map((record) => {
      const gameEvent = (eventsByGame.get(entry.playerVersionId) ?? [])[0];
      return {
        injuryId: record.injuryId,
        gameId: record.gameId,
        type: record.type,
        severity: record.severity,
        source: record.rehabModifier > 0 ? 'risky-rehab-failure' : 'natural',
        seasonEnding: record.seasonEnding,
        sameGameReturn: record.sameGameReturn,
        missedGamesTotal: record.missedGamesTotal,
        missedGamesRemaining: record.missedGamesRemaining,
        actualReturnRound: record.actualReturnRound,
        recurrence: recurrenceOf(record),
        removedClock: gameEvent?.removedClock ?? null,
        returnedInGame: gameEvent?.returned ?? false,
        returnClock: gameEvent?.returnClock ?? null,
      };
    });
    entries.sort((a, b) => (a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0));
    players.push({
      playerVersionId: entry.playerVersionId,
      displayName: entry.displayName,
      entries,
    });
  }
  players.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return players;
}

export const INJURY_TYPE_LABEL: Record<SeasonInjuryType, string> = {
  'lower-body': 'Lower body',
  'soft-tissue': 'Soft tissue',
  'upper-body': 'Upper body',
  illness: 'Illness',
};

/** Severity band labels + badge classes (mirror of FATIGUE_BAND_LABEL/BADGE). */
export const INJURY_SEVERITY_LABEL: Record<SeasonInjurySeverity, string> = {
  minor: 'Minor',
  moderate: 'Moderate',
  major: 'Major',
  'season-ending': 'Season-ending',
};

export const INJURY_SEVERITY_BADGE: Record<SeasonInjurySeverity, string> = {
  minor: 'bg-positive/15 text-positive',
  moderate: 'bg-primary/15 text-primary',
  major: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  'season-ending': 'bg-destructive/15 text-destructive',
};

/** Severity band presentation (label + badge class), like `FATIGUE_BAND_LABEL`. */
export function injuryBandOf(severity: SeasonInjurySeverity): {
  label: string;
  badge: string;
} {
  return { label: INJURY_SEVERITY_LABEL[severity], badge: INJURY_SEVERITY_BADGE[severity] };
}
