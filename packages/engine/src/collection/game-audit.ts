import {
  canonicalJson,
  type CollectionCatalog,
  type CollectionGameEvent,
  type CollectionGameRecordUnion,
  type CollectionGameResultUnion,
  type CollectionPreparedGameUnion,
  type EraSimulationProfile,
} from '@hoop-rush/data-contracts';
import { auditSideAccounting } from '../sim/accounting-core.ts';
import {
  OVERTIME_PERIOD_SECONDS,
  REGULATION_PERIOD_SECONDS,
  REGULATION_TOTAL_SECONDS,
} from '../sim/periods.ts';
import { sameUnit } from '../season/season-game.ts';
import { verifyDifficultyRatingAdjustments } from './difficulty.ts';
import {
  collectionGameEventDigest,
  collectionGameResultDigest,
  simulateCollectionGame,
} from './game.ts';
import { evaluateCollectionObjective } from './objectives.ts';
import { collectionGameRewardReceiptFor } from './rewards.ts';

const PLAYER_SECONDS_PER_SIDE = (side: { players: Array<{ seconds: number }> }): number =>
  side.players.reduce((sum, player) => sum + player.seconds, 0);

export function checkCollectionGameResult(
  result: CollectionGameResultUnion,
  events: readonly CollectionGameEvent[],
  prepared: CollectionPreparedGameUnion,
  catalog: CollectionCatalog,
  profile: EraSimulationProfile,
): string[] {
  const failures: string[] = [];
  if (prepared.gameVersion !== 'collection-game-v1') {
    failures.push(...verifyDifficultyRatingAdjustments(prepared, catalog));
  }
  let reproduced: ReturnType<typeof simulateCollectionGame>;
  try {
    reproduced = simulateCollectionGame(prepared, catalog, profile);
  } catch (error) {
    return [`reproduction failed: ${(error as Error).message}`];
  }
  if (canonicalJson(reproduced.result) !== canonicalJson(result)) {
    failures.push('determinism: re-running the prepared input produced a different result');
  }
  if (canonicalJson(reproduced.events) !== canonicalJson([...events])) {
    failures.push('determinism: re-running the prepared input produced different events');
  }
  if (collectionGameResultDigest(result) !== collectionGameResultDigest(reproduced.result)) {
    failures.push('result digest mismatch');
  }
  if (result.gameId !== prepared.gameId || result.gameSequence !== prepared.gameSequence) {
    failures.push('result game identity does not match the prepared input');
  }
  if (result.outcome === 'forfeit') {
    const winnerScore = result.winner === 'home' ? result.homeScore : result.awayScore;
    const loserScore = result.winner === 'home' ? result.awayScore : result.homeScore;
    if (winnerScore !== 2 || loserScore !== 0) {
      failures.push('forfeit: official result must be 2-0');
    }
    return failures;
  }
  const ot = result.overtimePeriods;
  const expectedGameSeconds = REGULATION_TOTAL_SECONDS + OVERTIME_PERIOD_SECONDS * ot;
  const expectedPlayerSeconds = 5 * expectedGameSeconds;
  if (result.home.periodScores.length !== 4 + ot || result.away.periodScores.length !== 4 + ot) {
    failures.push(`period count != 4 + OT (${String(4 + ot)})`);
  }
  const sides = [
    { key: 'home' as const, side: result.home, team: prepared.playerTeam },
    { key: 'away' as const, side: result.away, team: prepared.cpuTeam },
  ];
  for (const { key, side, team } of sides) {
    const roster = [...team.starters, ...team.bench];
    if (side.players.length !== roster.length) {
      failures.push(
        `${key}: player count ${String(side.players.length)} != roster ${String(roster.length)}`,
      );
    }
    for (let i = 0; i < side.players.length; i += 1) {
      if (side.players[i]?.cardId !== roster[i]) {
        failures.push(`${key}: result order does not match the prepared roster`);
        break;
      }
    }
    if (PLAYER_SECONDS_PER_SIDE(side) !== expectedPlayerSeconds) {
      failures.push(
        `${key}: player seconds (${String(PLAYER_SECONDS_PER_SIDE(side))}) != ${String(expectedPlayerSeconds)}`,
      );
    }
    for (const player of side.players) {
      if (!Number.isInteger(player.seconds)) {
        failures.push(`${key}: ${player.cardId} seconds are not integers`);
      }
      if (Math.abs(player.minutes - player.seconds / 60) > 1e-9) {
        failures.push(`${key}: ${player.cardId} minutes != seconds / 60`);
      }
    }
    const accounting = auditSideAccounting(side.players, side.box, side.shotZones, (p) => p.cardId);
    if (accounting.playerPointsTotal !== side.box.points) {
      failures.push(`${key}: player points != team points`);
    }
    if (!accounting.pointsIdentityOk) failures.push(`${key}: team points identity broken`);
    if (accounting.makesExceed.length > 0) failures.push(`${key}: makes exceed attempts`);
    if (accounting.assistsExceedMade) failures.push(`${key}: assists exceed made field goals`);
    if (!accounting.reboundBucketsOk) failures.push(`${key}: rebound buckets do not sum`);
    for (const row of accounting.reconciliations) {
      if (row.playerTotal !== row.teamValue) {
        failures.push(`${key}: player ${row.label} != team ${row.label}`);
      }
    }
    if (!accounting.reboundOpportunitiesOk)
      failures.push(`${key}: rebound opportunities != misses`);
    if (!accounting.assistedUnassistedOk) failures.push(`${key}: assisted + unassisted != made FG`);
    if (!accounting.contestedShotsOk) failures.push(`${key}: contested shots mismatch`);
    if (!accounting.offensiveReboundChancesOk) {
      failures.push(`${key}: offensive-rebound chances != 5 * opportunities`);
    }
    for (const zone of accounting.zoneSplits) {
      if (zone.playerAttempts !== zone.teamAttempts || zone.playerMakes !== zone.teamMakes) {
        failures.push(`${key}: zone splits (${zone.zone}) != team summary`);
      }
    }
    for (const usage of accounting.usageViolations) {
      failures.push(`${key}: usage identity broken for ${usage.playerKey}`);
    }
    for (const assist of accounting.assistOpportunityViolations) {
      failures.push(`${key}: assist opportunities < assists for ${assist.playerKey}`);
    }
    const periodTotal = side.periodScores.reduce((a, b) => a + b, 0);
    if (periodTotal !== side.score || side.score !== side.box.points) {
      failures.push(`${key}: period scores do not reconcile with the box`);
    }
    stintAudit(failures, key, result, roster);
    substitutionAudit(failures, key, result, roster);
    deviationAudit(failures, key, result, team);
    for (const exception of side.foulLimitExceptions) {
      if (!roster.includes(exception.cardId)) {
        failures.push(`${key}: foul-limit exception for unrostered ${exception.cardId}`);
      }
    }
  }
  const homeScore = result.home.score;
  const awayScore = result.away.score;
  if (homeScore !== awayScore && result.winner !== (homeScore > awayScore ? 'home' : 'away')) {
    failures.push('winner does not match the final scores');
  }
  eventAudit(failures, [...events], result);
  return failures;
}

function stintAudit(
  failures: string[],
  sideKey: 'home' | 'away',
  result: Extract<CollectionGameResultUnion, { outcome: 'completed' }>,
  roster: readonly string[],
): void {
  const side = result[sideKey];
  const stints = result.unitStints.filter((s) => s.side === sideKey);
  for (const stint of stints) {
    if (stint.durationSeconds !== stint.startSecondsRemaining - stint.endSecondsRemaining) {
      failures.push(`${sideKey}: stint duration != start - end (period ${String(stint.period)})`);
    }
    if (new Set(stint.players).size !== 5) {
      failures.push(`${sideKey}: stint unit must be five distinct players`);
    }
    for (const cardId of stint.players) {
      if (!roster.includes(cardId)) {
        failures.push(`${sideKey}: stint contains unrostered ${cardId}`);
      }
    }
  }
  const first = stints[0];
  if (first !== undefined) {
    if (first.period !== 1 || first.startSecondsRemaining !== REGULATION_PERIOD_SECONDS) {
      failures.push(`${sideKey}: first stint must open at (1, 720)`);
    }
  }
  for (let i = 1; i < stints.length; i += 1) {
    const prev = stints[i - 1];
    const cur = stints[i];
    if (prev === undefined || cur === undefined) continue;
    if (cur.period === prev.period) {
      if (cur.startSecondsRemaining !== prev.endSecondsRemaining) {
        failures.push(`${sideKey}: stint gap in period ${String(prev.period)}`);
      }
    } else if (cur.period === prev.period + 1) {
      if (prev.endSecondsRemaining !== 0) {
        failures.push(`${sideKey}: stint crossing period ${String(prev.period)} does not end at 0`);
      }
      const expectedStart = cur.period <= 4 ? REGULATION_PERIOD_SECONDS : OVERTIME_PERIOD_SECONDS;
      if (cur.startSecondsRemaining !== expectedStart) {
        failures.push(`${sideKey}: stint opening period ${String(cur.period)} has a bad clock`);
      }
    } else {
      failures.push(
        `${sideKey}: stint period jump ${String(prev.period)} -> ${String(cur.period)}`,
      );
    }
  }
  const last = stints[stints.length - 1];
  if (last !== undefined) {
    if (last.period !== 4 + result.overtimePeriods || last.endSecondsRemaining !== 0) {
      failures.push(`${sideKey}: last stint must end at the final zero`);
    }
  }
  const stintSeconds = stints.reduce((sum, stint) => sum + stint.durationSeconds, 0);
  const expectedGameSeconds =
    REGULATION_TOTAL_SECONDS + OVERTIME_PERIOD_SECONDS * result.overtimePeriods;
  if (stintSeconds !== expectedGameSeconds) {
    failures.push(`${sideKey}: stint seconds != game length`);
  }
  const secondsByCard = new Map<string, number>();
  for (const stint of stints) {
    for (const cardId of stint.players) {
      secondsByCard.set(cardId, (secondsByCard.get(cardId) ?? 0) + stint.durationSeconds);
    }
  }
  for (const player of side.players) {
    if ((secondsByCard.get(player.cardId) ?? 0) !== player.seconds) {
      failures.push(`${sideKey}: ${player.cardId} seconds != stint seconds`);
    }
  }
}

function substitutionAudit(
  failures: string[],
  sideKey: 'home' | 'away',
  result: Extract<CollectionGameResultUnion, { outcome: 'completed' }>,
  roster: readonly string[],
): void {
  const subs = result.substitutions.filter((s) => s.side === sideKey);
  const stints = result.unitStints.filter((s) => s.side === sideKey);
  for (const sub of subs) {
    if (!roster.includes(sub.playerInCardId) || !roster.includes(sub.playerOutCardId)) {
      failures.push(`${sideKey}: substitution references an unrostered card`);
    }
    if (sub.playerInCardId === sub.playerOutCardId) {
      failures.push(`${sideKey}: substitution with identical in/out card`);
    }
    if (!sub.unit.includes(sub.playerInCardId) || sub.unit.includes(sub.playerOutCardId)) {
      failures.push(`${sideKey}: substitution unit inconsistent with in/out`);
    }
    const matchingStint = stints.find(
      (stint) =>
        (stint.period === sub.period &&
          stint.startSecondsRemaining === sub.secondsRemaining &&
          sameUnit(stint.players, sub.unit)) ||
        (stint.period === sub.period + 1 &&
          stint.startSecondsRemaining ===
            (stint.period <= 4 ? REGULATION_PERIOD_SECONDS : OVERTIME_PERIOD_SECONDS) &&
          sameUnit(stint.players, sub.unit)),
    );
    if (matchingStint === undefined) {
      failures.push(`${sideKey}: substitution has no matching unit stint`);
    }
  }
  for (let i = 1; i < stints.length; i += 1) {
    const prev = stints[i - 1];
    const cur = stints[i];
    if (prev === undefined || cur === undefined) continue;
    if (sameUnit(prev.players, cur.players)) continue;
    const backed = subs.some(
      (sub) =>
        sameUnit(sub.unit, cur.players) &&
        ((sub.period === cur.period && sub.secondsRemaining === cur.startSecondsRemaining) ||
          (sub.period === cur.period - 1 && sub.secondsRemaining === 0)),
    );
    if (!backed) {
      failures.push(`${sideKey}: unit change without a substitution record`);
    }
  }
  const finalPeriod = 4 + result.overtimePeriods;
  for (const foulOut of result.foulOuts) {
    if (foulOut.side !== sideKey) continue;
    if (foulOut.period === finalPeriod && foulOut.secondsRemaining === 0) continue;
    const player = result[sideKey].players.find((p) => p.cardId === foulOut.cardId);
    if (player === undefined || player.fouls < 6) {
      failures.push(`${sideKey}: foul-out for a player with fewer than six fouls`);
    }
    const backed = subs.some(
      (sub) =>
        sub.reason === 'foul-out' &&
        sub.playerOutCardId === foulOut.cardId &&
        sub.period === foulOut.period &&
        sub.secondsRemaining === foulOut.secondsRemaining,
    );
    if (!backed) {
      failures.push(`${sideKey}: foul-out without a removal substitution`);
    }
  }
}

function deviationAudit(
  failures: string[],
  sideKey: 'home' | 'away',
  result: Extract<CollectionGameResultUnion, { outcome: 'completed' }>,
  team: { targetMinutes: ReadonlyArray<{ cardId: string; minutes: number }> },
): void {
  const regSeconds = new Map<string, number>();
  for (const stint of result.unitStints) {
    if (stint.side !== sideKey || stint.period > 4) continue;
    for (const cardId of stint.players) {
      regSeconds.set(cardId, (regSeconds.get(cardId) ?? 0) + stint.durationSeconds);
    }
  }
  const targets = new Map(team.targetMinutes.map((entry) => [entry.cardId, entry.minutes * 60]));
  const devs = result.deviations.filter((d) => d.side === sideKey);
  const devIds = new Set(devs.map((d) => d.cardId));
  for (const player of result[sideKey].players) {
    const actual = regSeconds.get(player.cardId) ?? 0;
    const target = targets.get(player.cardId) ?? 0;
    if (actual !== target && !devIds.has(player.cardId)) {
      failures.push(`${sideKey}: missing deviation for ${player.cardId}`);
    }
    if (actual === target && devIds.has(player.cardId)) {
      failures.push(`${sideKey}: spurious deviation for ${player.cardId}`);
    }
  }
  let balance = 0;
  for (const dev of devs) {
    balance += dev.actualSeconds - dev.targetSeconds;
    if (dev.reasons.length === 0) {
      failures.push(`${sideKey}: deviation for ${dev.cardId} has no reasons`);
    }
    if (targets.get(dev.cardId) === undefined) {
      failures.push(`${sideKey}: deviation for unrostered ${dev.cardId}`);
    }
  }
  if (balance !== 0) failures.push(`${sideKey}: deviation seconds do not balance`);
}

const EVENT_DELTA_KEYS = [
  'points',
  'fieldGoalsMade',
  'fieldGoalsAttempted',
  'threePointMade',
  'threePointAttempted',
  'freeThrowMade',
  'freeThrowAttempted',
  'offensiveRebounds',
  'defensiveRebounds',
  'assists',
  'steals',
  'blocks',
  'turnovers',
  'fouls',
];

const BOX_OF_DELTA: Record<string, string> = {
  points: 'points',
  fieldGoalsMade: 'fieldGoals.made',
  fieldGoalsAttempted: 'fieldGoals.attempted',
  threePointMade: 'threes.made',
  threePointAttempted: 'threes.attempted',
  freeThrowMade: 'freeThrows.made',
  freeThrowAttempted: 'freeThrows.attempted',
  offensiveRebounds: 'rebounds.offensive',
  defensiveRebounds: 'rebounds.defensive',
  assists: 'assists',
  steals: 'steals',
  blocks: 'blocks',
  turnovers: 'turnovers',
  fouls: 'fouls',
};

function boxValue(player: Record<string, unknown>, path: string): number {
  let current: unknown = player;
  for (const part of path.split('.')) {
    if (typeof current !== 'object' || current === null) return 0;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'number' ? current : 0;
}

function eventAudit(
  failures: string[],
  events: CollectionGameEvent[],
  result: Extract<CollectionGameResultUnion, { outcome: 'completed' }>,
): void {
  for (let i = 0; i < events.length; i += 1) {
    if (events[i]?.eventOrder !== i) {
      failures.push(`event ${String(i)} has a bad eventOrder`);
      break;
    }
  }
  const final = events[events.length - 1];
  if (final?.kind !== 'final') failures.push('last event must be the final');
  if (events.filter((e) => e.kind === 'final').length !== 1) {
    failures.push('exactly one final event is required');
  }
  let lastPeriod = 0;
  let lastClock = Number.POSITIVE_INFINITY;
  let runningHome = 0;
  let runningAway = 0;
  const folded = new Map<string, Record<string, number>>();
  const fold = (cardId: string): Record<string, number> => {
    let entry = folded.get(cardId);
    if (entry === undefined) {
      entry = Object.fromEntries(EVENT_DELTA_KEYS.map((key) => [key, 0]));
      folded.set(cardId, entry);
    }
    return entry;
  };
  for (const event of events) {
    if (event.period < lastPeriod) {
      failures.push('events are not ordered by period');
      break;
    }
    if (event.period === lastPeriod && event.secondsRemaining > lastClock) {
      failures.push('event clocks do not descend within a period');
      break;
    }
    lastPeriod = event.period;
    lastClock = event.secondsRemaining;
    if (event.kind === 'possession') {
      const beforeHome = runningHome;
      const beforeAway = runningAway;
      runningHome = event.homeScore;
      runningAway = event.awayScore;
      const scored =
        event.offenseSide === 'home' ? runningHome - beforeHome : runningAway - beforeAway;
      if (scored !== event.pointsScored) {
        failures.push(`possession ${String(event.possessionNumber)} points do not match the score`);
      }
      if (event.pointsScored < 0 || event.pointsScored > 4) {
        failures.push(`possession ${String(event.possessionNumber)} has impossible points`);
      }
      for (const delta of event.statDeltas) {
        const entry = fold(`${delta.side}:${delta.cardId}`);
        for (const key of EVENT_DELTA_KEYS) {
          entry[key] = (entry[key] ?? 0) + ((delta as unknown as Record<string, number>)[key] ?? 0);
        }
      }
    } else if (event.kind === 'period-end') {
      runningHome = event.homeScore;
      runningAway = event.awayScore;
      const periodIndex = event.period - 1;
      if (
        event.periodHomeScore !== (result.home.periodScores[periodIndex] ?? -1) ||
        event.periodAwayScore !== (result.away.periodScores[periodIndex] ?? -1)
      ) {
        failures.push(`period-end ${String(event.period)} does not match the result`);
      }
    } else if (event.kind === 'final') {
      if (event.winner !== result.winner) failures.push('final event winner mismatch');
      runningHome = event.homeScore;
      runningAway = event.awayScore;
    } else {
      runningHome = event.homeScore;
      runningAway = event.awayScore;
    }
  }
  if (runningHome !== result.home.score || runningAway !== result.away.score) {
    failures.push('event scores do not reconcile with the final');
  }
  for (const [sideKey, side] of [
    ['home', result.home],
    ['away', result.away],
  ] as const) {
    for (const player of side.players) {
      const entry =
        folded.get(`${sideKey}:${player.cardId}`) ??
        Object.fromEntries(EVENT_DELTA_KEYS.map((k) => [k, 0]));
      const record = player as unknown as Record<string, unknown>;
      for (const key of EVENT_DELTA_KEYS) {
        const path = BOX_OF_DELTA[key];
        if (path === undefined) continue;
        if ((entry[key] ?? 0) !== boxValue(record, path)) {
          failures.push(`event deltas for ${player.cardId} do not reconcile (${key})`);
          break;
        }
      }
    }
  }
  const subEvents = events.filter((e) => e.kind === 'substitution');
  if (subEvents.length !== result.substitutions.length) {
    failures.push('substitution events do not match the result substitutions');
  }
}

export function checkCollectionGameRecord(
  record: CollectionGameRecordUnion,
  catalog: CollectionCatalog,
  profile: EraSimulationProfile,
): string[] {
  const failures = checkCollectionGameResult(
    record.result,
    record.events,
    record.prepared,
    catalog,
    profile,
  );
  if (collectionGameEventDigest(record.events) !== record.eventDigest) {
    failures.push('event digest does not match the record');
  }
  if (collectionGameResultDigest(record.result) !== record.resultDigest) {
    failures.push('result digest does not match the record');
  }
  if (record.gameVersion === 'collection-game-v1') {
    return failures;
  }
  const evaluation = evaluateCollectionObjective({
    prepared: record.prepared,
    result: record.result,
  });
  if (canonicalJson(evaluation) !== canonicalJson(record.objectiveEvaluation)) {
    failures.push('objective evaluation does not reproduce from the prepared input');
  }
  const receipt = collectionGameRewardReceiptFor({
    gameId: record.gameId,
    prepared: record.prepared,
    result: record.result,
    evaluation,
  });
  if (canonicalJson(receipt) !== canonicalJson(record.reward)) {
    failures.push('reward receipt does not reproduce from the prepared input');
  }
  return failures;
}
