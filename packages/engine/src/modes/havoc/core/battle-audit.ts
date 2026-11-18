import type {
  HavocAuditFinding,
  HavocBattleInput,
  HavocBattleResult,
  HavocBattleTape,
  HavocBattleTeamInput,
  HavocGameAudit,
  HavocHomeAway,
  HavocParticipantKind,
  HavocScoringSource,
  HavocTeamResult,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_PERSONAL_FOUL_LIMIT,
  havocBattleResultSchema,
  havocScoringSourceSchema,
} from '@hoop-rush/data-contracts';
import { OVERTIME_PERIOD_SECONDS, REGULATION_PERIOD_SECONDS } from '../../../sim/clock.ts';
import type { SideIndex } from '../../../sim/recorder.ts';
import { havocBattleGameInputDigest } from './battle-digests.ts';
import {
  BATTLE_LEDGER_EVENT,
  BATTLE_LEDGER_EVENT_FIELDS,
  BATTLE_LEDGER_SCORING_FIELDS,
  BATTLE_LEDGER_SCORING_KIND,
  BATTLE_LEDGER_SCORING_SOURCES,
  type HavocBattleLedger,
  type HavocBattleLedgerParticipant,
} from './battle-ledger.ts';
import { HAVOC_SCORING_SOURCE_MUTATION } from './battle-scoring.ts';

const REGULATION_SECONDS = 4 * REGULATION_PERIOD_SECONDS;
const SCORING_SOURCES: ReadonlySet<string> = new Set(havocScoringSourceSchema.options);

interface AuditParticipant {
  instanceId: string;
  sideIndex: SideIndex;
  kind: HavocParticipantKind;
  slot: string;
  ownerInstanceId: string | null;
  sourcePlayerId: string;
  sourcePlayerVersionId: string | null;
  mutations: Set<string>;
}

interface FoulState {
  committed: number;
  charged: number;
}

/**
 * Facts the recording simulation already established for its own output.
 *
 * Callers outside the simulator keep the default, independent validation: the
 * result is re-parsed and the input digest recomputed from the supplied input.
 * The simulation may pass these because it built the result through the
 * validated path and already computed the digest; the remaining checks are
 * unchanged either way.
 */
export interface HavocBattleAuditFacts {
  /** Digest already computed for exactly this input. */
  readonly inputDigest?: string;
  /** The result came straight out of the simulator's validated builder. */
  readonly resultValidated?: boolean;
}

/**
 * Shared identity, result-ledger, court-time, and rollup checks. Both the full
 * tape audit and the playback-free compact ledger audit use these unchanged.
 * Returns `null` when the result fails its schema, which stops the audit.
 */
function auditBattleIdentity(
  input: HavocBattleInput,
  result: HavocBattleResult,
  facts: HavocBattleAuditFacts,
  fail: (code: string, message: string) => void,
): Map<string, AuditParticipant> | null {
  if (facts.resultValidated !== true) {
    const parsed = havocBattleResultSchema.safeParse(result);
    if (!parsed.success) {
      fail(
        'result-schema',
        `result does not satisfy havocBattleResultSchema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
      );
      return null;
    }
  }
  if (result.gameNumber !== input.gameNumber)
    fail('input-identity', 'result game number differs from input');
  if (result.variant !== input.variant) fail('input-identity', 'result variant differs from input');
  if (result.seed !== input.seed) fail('input-identity', 'result seed differs from input');
  if (result.home.teamId !== input.home.teamId || result.away.teamId !== input.away.teamId) {
    fail('input-identity', 'result team ids differ from input');
  }
  if (
    result.home.displayName !== input.home.displayName ||
    result.away.displayName !== input.away.displayName
  ) {
    fail('input-identity', 'result team display names differ from input');
  }
  if (result.inputDigest !== (facts.inputDigest ?? havocBattleGameInputDigest(input))) {
    fail('input-digest', 'result input digest does not match the supplied input');
  }
  if (result.winner !== (result.home.points > result.away.points ? 'home' : 'away')) {
    fail('winner', 'result winner disagrees with the scoreline');
  }

  const participants = new Map<string, AuditParticipant>();
  const addTeamParticipants = (
    team: HavocTeamResult,
    sideIndex: SideIndex,
    source: HavocBattleTeamInput,
  ): void => {
    for (const participant of [...source.starters, ...source.replacements, ...source.clones]) {
      participants.set(participant.instanceId, {
        instanceId: participant.instanceId,
        sideIndex,
        kind: participant.kind,
        slot: participant.slot,
        ownerInstanceId: participant.ownerInstanceId,
        sourcePlayerId: participant.source.playerId,
        sourcePlayerVersionId: participant.source.playerVersionId,
        mutations: new Set(participant.mutationPackage.map((entry) => entry.mutationId)),
      });
    }
    for (const line of team.participants) {
      const participant = participants.get(line.instanceId);
      if (participant === undefined) {
        fail('identity', `result line ${line.instanceId} is not an input participant`);
        continue;
      }
      if (participant.sideIndex !== sideIndex) {
        fail('identity', `result line ${line.instanceId} is on the wrong side`);
      }
      if (participant.kind !== line.kind)
        fail('identity', `result line ${line.instanceId} kind mismatch`);
      if (participant.slot !== line.slot)
        fail('identity', `result line ${line.instanceId} slot mismatch`);
      if (participant.ownerInstanceId !== line.ownerInstanceId) {
        fail('identity', `result line ${line.instanceId} owner mismatch`);
      }
      if (participant.sourcePlayerId !== line.sourcePlayerId) {
        fail('identity', `result line ${line.instanceId} source player mismatch`);
      }
      if (participant.sourcePlayerVersionId !== line.sourcePlayerVersionId) {
        fail('identity', `result line ${line.instanceId} source version mismatch`);
      }
      if (line.kind === 'clone' && line.ownerInstanceId === null) {
        fail('identity', `clone line ${line.instanceId} has no owner`);
      }
    }
  };
  addTeamParticipants(result.home, 0, input.home);
  addTeamParticipants(result.away, 1, input.away);
  for (const starter of input.home.starters) {
    if (!result.home.participants.some((line) => line.instanceId === starter.instanceId)) {
      fail('identity', `home starter ${starter.instanceId} missing from the result`);
    }
  }
  for (const starter of input.away.starters) {
    if (!result.away.participants.some((line) => line.instanceId === starter.instanceId)) {
      fail('identity', `away starter ${starter.instanceId} missing from the result`);
    }
  }

  checkResultInternals(result, fail);

  const overtimePeriods = Math.max(0, result.home.periods.length - 4);
  const gameSeconds = REGULATION_SECONDS + overtimePeriods * OVERTIME_PERIOD_SECONDS;
  checkCourtTime(result, gameSeconds, fail);

  for (const rollup of result.rollups) {
    if (!participants.has(rollup.ownerInstanceId)) {
      fail('rollup', `rollup owner ${rollup.ownerInstanceId} is not a participant`);
    } else if (!participants.get(rollup.ownerInstanceId)?.mutations.has(rollup.mutationId)) {
      fail('rollup', `rollup ${rollup.mutationId} owner does not own the mutation`);
    }
  }
  return participants;
}

export function auditHavocBattleGame(
  input: HavocBattleInput,
  result: HavocBattleResult,
  tape?: HavocBattleTape,
  facts: HavocBattleAuditFacts = {},
): HavocGameAudit {
  const findings: HavocAuditFinding[] = [];
  const fail = (code: string, message: string): void => {
    if (findings.length < 200) findings.push({ code, message: message.slice(0, 512) });
  };

  const participants = auditBattleIdentity(input, result, facts, fail);
  if (participants === null) return { ok: false, findings };

  if (tape !== undefined) {
    if (tape.gameNumber !== input.gameNumber)
      fail('tape-identity', 'tape game number differs from input');
    if (tape.variant !== input.variant) fail('tape-identity', 'tape variant differs from input');
    if (tape.seed !== input.seed) fail('tape-identity', 'tape seed differs from input');
    checkTape(tape, result, input, participants, fail);
  }

  return { ok: findings.length === 0, findings };
}

/**
 * Audits the kernel's compact numeric ledger directly. It performs exactly the
 * checks `checkTape` performs, but without materializing typed event or scoring
 * objects. Used only by callers that never deliver a playback tape.
 */
export function auditHavocBattleLedger(
  input: HavocBattleInput,
  result: HavocBattleResult,
  ledger: HavocBattleLedger,
  facts: HavocBattleAuditFacts = {},
): HavocGameAudit {
  const findings: HavocAuditFinding[] = [];
  const fail = (code: string, message: string): void => {
    if (findings.length < 200) findings.push({ code, message: message.slice(0, 512) });
  };

  const participants = auditBattleIdentity(input, result, facts, fail);
  if (participants === null) return { ok: false, findings };

  checkLedger(ledger, result, input, fail);

  return { ok: findings.length === 0, findings };
}

function checkResultInternals(
  result: HavocBattleResult,
  fail: (code: string, message: string) => void,
): void {
  for (const team of [result.home, result.away]) {
    const periodSum = team.periods.reduce((sum, points) => sum + points, 0);
    if (periodSum !== team.points) {
      fail(
        'period-ledger',
        `${team.side} period totals ${String(periodSum)} != team points ${String(team.points)}`,
      );
    }
    const participantPoints = team.participants.reduce((sum, line) => sum + line.points, 0);
    if (participantPoints + team.teamBonusPoints !== team.points) {
      fail(
        'points-ledger',
        `${team.side} participant points ${String(participantPoints)} + bonus ${String(team.teamBonusPoints)} != team points ${String(team.points)}`,
      );
    }
    for (const line of team.participants) {
      if (line.fieldGoals.made > line.fieldGoals.attempted) {
        fail('counts', `${line.instanceId} made field goals exceed attempts`);
      }
      if (line.threes.made > line.threes.attempted)
        fail('counts', `${line.instanceId} made threes exceed attempts`);
      if (line.threes.made > line.fieldGoals.made)
        fail('counts', `${line.instanceId} made threes exceed field goals`);
      if (line.freeThrows.made > line.freeThrows.attempted) {
        fail('counts', `${line.instanceId} made free throws exceed attempts`);
      }
      if (line.rebounds.offensive + line.rebounds.defensive !== line.rebounds.total) {
        fail('counts', `${line.instanceId} rebound buckets do not sum to the total`);
      }
      if (line.secondsPlayed < 0) fail('court-time', `${line.instanceId} has negative seconds`);
      if (line.minutes !== Math.round(line.secondsPlayed / 60)) {
        fail('court-time', `${line.instanceId} minutes disagree with seconds`);
      }
      if (line.chargedFouls > line.fouls) {
        fail('fouls', `${line.instanceId} charged fouls exceed committed fouls`);
      }
      const nominal =
        (line.fieldGoals.made - line.threes.made) * 2 + line.threes.made * 3 + line.freeThrows.made;
      if (line.adjustments !== line.points - nominal) {
        fail('points-ledger', `${line.instanceId} adjustments disagree with points minus nominal`);
      }
    }
    const nominal =
      (team.fieldGoals.made - team.threes.made) * 2 + team.threes.made * 3 + team.freeThrows.made;
    if (team.adjustments !== team.points - nominal) {
      fail('points-ledger', `${team.side} adjustments disagree with points minus nominal`);
    }
    const lineMadeFg = team.participants.reduce((sum, line) => sum + line.fieldGoals.made, 0);
    const lineMadeThree = team.participants.reduce((sum, line) => sum + line.threes.made, 0);
    const lineMadeFt = team.participants.reduce((sum, line) => sum + line.freeThrows.made, 0);
    const lineFga = team.participants.reduce((sum, line) => sum + line.fieldGoals.attempted, 0);
    const lineTpa = team.participants.reduce((sum, line) => sum + line.threes.attempted, 0);
    const lineFta = team.participants.reduce((sum, line) => sum + line.freeThrows.attempted, 0);
    if (lineMadeFg !== team.fieldGoals.made || lineFga !== team.fieldGoals.attempted) {
      fail('counts', `${team.side} participant field goals disagree with the team line`);
    }
    if (lineMadeThree !== team.threes.made || lineTpa !== team.threes.attempted) {
      fail('counts', `${team.side} participant threes disagree with the team line`);
    }
    if (lineMadeFt !== team.freeThrows.made || lineFta !== team.freeThrows.attempted) {
      fail('counts', `${team.side} participant free throws disagree with the team line`);
    }
  }
}

function checkTape(
  tape: HavocBattleTape,
  result: HavocBattleResult,
  input: HavocBattleInput,
  participants: ReadonlyMap<string, AuditParticipant>,
  fail: (code: string, message: string) => void,
): void {
  const sideIndexBySide = new Map<HavocHomeAway, SideIndex>([
    [input.home.side, 0],
    [input.away.side, 1],
  ]);
  const sidePoints: [number, number] = [0, 0];
  const periodPoints: [number[], number[]] = [
    Array.from({ length: result.home.periods.length }, () => 0),
    Array.from({ length: result.home.periods.length }, () => 0),
  ];
  const actorPoints = new Map<string, number>();
  const freeThrowAttempts = new Map<
    number,
    { made: boolean; shooterInstanceId: string; side: HavocHomeAway }
  >();
  const shotAttempts = new Map<
    number,
    { made: boolean; shooterInstanceId: string; side: HavocHomeAway }
  >();
  for (const event of tape.events) {
    if (event.kind === 'free-throw-attempt') {
      freeThrowAttempts.set(event.sequence, {
        made: event.made,
        shooterInstanceId: event.shooterInstanceId,
        side: event.side,
      });
    } else if (event.kind === 'shot-attempt') {
      shotAttempts.set(event.sequence, {
        made: event.made,
        shooterInstanceId: event.shooterInstanceId,
        side: event.side,
      });
    }
  }
  let lastEvent = -1;
  let lastScore = -1;
  for (const entry of tape.scoring) {
    if (entry.sequence <= lastScore)
      fail('scoring-order', 'scoring sequences must strictly increase');
    lastScore = entry.sequence;
    const actor = participants.get(entry.actorInstanceId);
    const sideIndex = sideIndexBySide.get(entry.side);
    if (entry.gameNumber !== input.gameNumber)
      fail('scoring-entry', 'scoring entry game number mismatch');
    if (actor === undefined) {
      fail(
        'actor-eligibility',
        `scoring entry actor ${entry.actorInstanceId} is not a participant`,
      );
      continue;
    }
    const isBonus = entry.kind === 'bonus';
    const bonusOrigin =
      isBonus && entry.originalEventSequence !== null
        ? (shotAttempts.get(entry.originalEventSequence) ??
          freeThrowAttempts.get(entry.originalEventSequence))
        : undefined;
    if (isBonus) {
      if (sideIndex === undefined || actor.sideIndex === sideIndex) {
        fail('actor-eligibility', 'bonus scoring actor is not opposing the scoring side');
      }
      if (bonusOrigin === undefined) {
        fail('scoring-entry', 'bonus scoring entry references no shot attempt');
      } else if (bonusOrigin.made || bonusOrigin.shooterInstanceId !== entry.actorInstanceId) {
        fail('scoring-entry', 'bonus scoring entry does not reference its own missed attempt');
      }
    } else if (sideIndex === undefined || actor.sideIndex !== sideIndex) {
      fail(
        'actor-eligibility',
        `scoring entry actor ${entry.actorInstanceId} is on the wrong side`,
      );
    }
    if (entry.beneficiaryInstanceId !== null && !participants.has(entry.beneficiaryInstanceId)) {
      fail(
        'actor-eligibility',
        `scoring beneficiary ${entry.beneficiaryInstanceId} is not a participant`,
      );
    }
    let points = entry.nominalPoints;
    let dunkBonus = 0;
    for (const addend of entry.addends) {
      const rawSource: string = addend.source;
      if (!isScoringSource(addend.source))
        fail('scoring-entry', `unknown scoring source ${rawSource}`);
      if (addend.source === 'four-point-dunk') dunkBonus += addend.points;
      else points += addend.points;
    }
    for (const multiplier of entry.multipliers) {
      const rawSource: string = multiplier.source;
      if (!isScoringSource(multiplier.source))
        fail('scoring-entry', `unknown scoring source ${rawSource}`);
      points *= multiplier.factor;
    }
    points += dunkBonus;
    if (points !== entry.points) {
      fail(
        'points-ledger',
        `scoring entry ${String(entry.sequence)} points ${String(entry.points)} != resolved ${String(points)}`,
      );
    }
    const sources = [...entry.addends, ...entry.multipliers].map((component) => component.source);
    for (const ownerId of entry.owners) {
      const owner = participants.get(ownerId);
      if (owner === undefined) {
        fail('scoring-entry', `scoring owner ${ownerId} is not a participant`);
        continue;
      }
      if (!sources.some((source) => owner.mutations.has(HAVOC_SCORING_SOURCE_MUTATION[source]))) {
        fail(
          'scoring-entry',
          `owner ${ownerId} does not own any scoring source on entry ${String(entry.sequence)}`,
        );
      }
      if (isBonus) {
        if (owner.sideIndex !== actor.sideIndex) {
          fail('scoring-entry', `bonus owner ${ownerId} is not on the actor's side`);
        }
      } else if (owner.sideIndex !== sideIndex)
        fail('scoring-entry', `owner ${ownerId} is not on the scoring side`);
    }
    if (sources.length > 0 && entry.owners.length === 0) {
      fail(
        'scoring-entry',
        `scoring entry ${String(entry.sequence)} has no owners for its sources`,
      );
    }
    sidePoints[sideIndex ?? 0] += entry.points;
    const bucket = periodPoints[sideIndex ?? 0];
    const periodIndex = entry.period - 1;
    if (periodIndex >= 0 && periodIndex < bucket.length) {
      bucket[periodIndex] = (bucket[periodIndex] ?? 0) + entry.points;
    } else {
      fail('period-ledger', `scoring entry ${String(entry.sequence)} period out of range`);
    }
    if (!isBonus) {
      actorPoints.set(
        entry.actorInstanceId,
        (actorPoints.get(entry.actorInstanceId) ?? 0) + entry.points,
      );
    }
  }
  for (const side of [0, 1] as const) {
    const team = side === 0 ? result.home : result.away;
    if (sidePoints[side] !== team.points) {
      fail(
        'points-ledger',
        `${team.side} ledger points ${String(sidePoints[side])} != result ${String(team.points)}`,
      );
    }
    for (let index = 0; index < team.periods.length; index += 1) {
      if ((periodPoints[side][index] ?? 0) !== team.periods[index]) {
        fail(
          'period-ledger',
          `${team.side} period ${String(index + 1)} ledger ${String(periodPoints[side][index] ?? 0)} != result ${String(team.periods[index])}`,
        );
      }
    }
  }
  for (const line of [...result.home.participants, ...result.away.participants]) {
    const points = actorPoints.get(line.instanceId) ?? 0;
    if (points !== line.points) {
      fail(
        'points-ledger',
        `${line.instanceId} ledger points ${String(points)} != line ${String(line.points)}`,
      );
    }
  }

  const counts = new Map<string, number>();
  const active = new Map<string, AuditParticipant>();
  for (const starter of input.home.starters) {
    const participant = participants.get(starter.instanceId);
    if (participant !== undefined) active.set(participant.instanceId, participant);
  }
  for (const starter of input.away.starters) {
    const participant = participants.get(starter.instanceId);
    if (participant !== undefined) active.set(participant.instanceId, participant);
  }
  const foulReplay = new Map<string, FoulState>();
  const turnedOver = new Set<number>();
  const cancelled = new Set<number>();
  const turnoverSide = new Map<string, number>();
  const cancelledTurnoverSide = new Map<string, number>();
  const cancelledTurnoverPlayer = new Map<string, number>();
  const turnoversBySequence = new Map<number, { side: HavocHomeAway; playerInstanceId: string }>();
  const clockViolationSide = new Map<string, number>();
  const possessionOffense = new Map<number, HavocHomeAway>();
  for (const event of tape.events) {
    if (event.kind === 'possession-start') {
      possessionOffense.set(event.possessionId, event.offenseSide);
    }
  }
  const queued = new Map<string, number>();
  const queuedCounts = new Map<string, number>();
  const cloneEntered = new Set<string>();
  const cloneExited = new Set<string>();
  const grantCounts = new Map<string, number>();
  const foulOwners = new Map<number, { side: HavocHomeAway; hasDoubleOwner: boolean }>();
  const doubleGiftCounts = new Map<number, number>();
  const increment = (key: string): void => {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  const requireActive = (instanceId: string, code: string): AuditParticipant | null => {
    const participant = active.get(instanceId);
    if (participant === undefined) {
      fail(code, `${instanceId} is not an active actor at its event`);
      return null;
    }
    return participant;
  };
  for (const event of tape.events) {
    if (event.sequence <= lastEvent) fail('event-order', 'event sequences must strictly increase');
    lastEvent = event.sequence;
    if (event.gameNumber !== input.gameNumber) fail('event', 'event game number mismatch');
    switch (event.kind) {
      case 'period-start':
      case 'period-end':
      case 'game-end':
        break;
      case 'possession-start': {
        if (!sideIndexBySide.has(event.offenseSide))
          fail('event', 'possession offense side unknown');
        break;
      }
      case 'shot-attempt': {
        const shooter = requireActive(event.shooterInstanceId, 'actor-eligibility');
        if (shooter !== null && shooter.sideIndex !== sideIndexBySide.get(event.side)) {
          fail('actor-eligibility', 'shot shooter is on the wrong side');
        }
        increment(`${event.side}:fga`);
        if (event.made) increment(`${event.side}:fgm`);
        if (event.nominalPoints === 3) {
          increment(`${event.side}:tpa`);
          if (event.made) increment(`${event.side}:tpm`);
        }
        break;
      }
      case 'free-throw-attempt': {
        const shooter = requireActive(event.shooterInstanceId, 'actor-eligibility');
        if (shooter !== null && shooter.sideIndex !== sideIndexBySide.get(event.side)) {
          fail('actor-eligibility', 'free-throw shooter is on the wrong side');
        }
        increment(`${event.side}:fta`);
        if (event.made) increment(`${event.side}:ftm`);
        break;
      }
      case 'rebound': {
        const rebounder = requireActive(event.playerInstanceId, 'actor-eligibility');
        if (rebounder !== null && rebounder.sideIndex !== sideIndexBySide.get(event.side)) {
          fail('actor-eligibility', 'rebounder is on the wrong side');
        }
        increment(`${event.playerInstanceId}:rebounds`);
        if (event.offensive) increment(`${event.playerInstanceId}:oreb`);
        else increment(`${event.playerInstanceId}:dreb`);
        break;
      }
      case 'assist': {
        requireActive(event.assisterInstanceId, 'actor-eligibility');
        requireActive(event.scorerInstanceId, 'actor-eligibility');
        if (event.assisterInstanceId === event.scorerInstanceId) {
          fail('assists', 'assist credited to the scorer');
        }
        increment(`${event.assisterInstanceId}:assists`);
        increment(`${event.side}:assists`);
        break;
      }
      case 'steal': {
        requireActive(event.stealerInstanceId, 'actor-eligibility');
        increment(`${event.stealerInstanceId}:steals`);
        increment(`${event.side}:steals`);
        break;
      }
      case 'block': {
        requireActive(event.blockerInstanceId, 'actor-eligibility');
        requireActive(event.shooterInstanceId, 'actor-eligibility');
        increment(`${event.blockerInstanceId}:blocks`);
        increment(`${event.side}:blocks`);
        break;
      }
      case 'turnover': {
        requireActive(event.playerInstanceId, 'actor-eligibility');
        turnedOver.add(event.sequence);
        increment(`${event.playerInstanceId}:turnovers`);
        turnoversBySequence.set(event.sequence, {
          side: event.side,
          playerInstanceId: event.playerInstanceId,
        });
        turnoverSide.set(event.side, (turnoverSide.get(event.side) ?? 0) + 1);
        if (cancelled.has(event.sequence)) {
          cancelledTurnoverSide.set(event.side, (cancelledTurnoverSide.get(event.side) ?? 0) + 1);
          cancelledTurnoverPlayer.set(
            event.playerInstanceId,
            (cancelledTurnoverPlayer.get(event.playerInstanceId) ?? 0) + 1,
          );
        }
        break;
      }
      case 'turnover-cancelled': {
        if (!turnedOver.has(event.originalSequence)) {
          fail('turnovers', 'turnover cancellation references no recorded turnover');
        }
        if (!cancelled.has(event.originalSequence)) {
          cancelled.add(event.originalSequence);
          const prior = turnoversBySequence.get(event.originalSequence);
          if (prior !== undefined) {
            cancelledTurnoverSide.set(prior.side, (cancelledTurnoverSide.get(prior.side) ?? 0) + 1);
            cancelledTurnoverPlayer.set(
              prior.playerInstanceId,
              (cancelledTurnoverPlayer.get(prior.playerInstanceId) ?? 0) + 1,
            );
          }
        }
        break;
      }
      case 'foul': {
        const fouler = participants.get(event.foulerInstanceId);
        if (fouler === undefined) {
          fail('actor-eligibility', `foul fouler ${event.foulerInstanceId} is not a participant`);
          break;
        }
        requireActive(event.foulerInstanceId, 'actor-eligibility');
        if (fouler.sideIndex !== sideIndexBySide.get(event.side)) {
          fail('fouls', 'fouler is on the wrong side');
        }
        const state = foulReplay.get(event.foulerInstanceId) ?? { committed: 0, charged: 0 };
        state.committed += 1;
        state.charged += 1;
        foulReplay.set(event.foulerInstanceId, state);
        if (event.technicalFreeThrows === 1) {
          if (state.committed < HAVOC_PERSONAL_FOUL_LIMIT) {
            fail('fouls', 'technical free throw before the sixth personal foul');
          }
          if (fouler.kind !== 'replacement') {
            fail('fouls', 'technical free throw by a non-replacement');
          }
        }
        if (event.shooting && event.shooterInstanceId !== null) {
          requireActive(event.shooterInstanceId, 'actor-eligibility');
        }
        increment(`${event.foulerInstanceId}:fouls`);
        increment(`${event.side}:fouls`);
        const foulSideIndex = sideIndexBySide.get(event.side);
        const hasDoubleOwner =
          foulSideIndex !== undefined &&
          [...active.values()].some(
            (participant) =>
              participant.sideIndex === foulSideIndex &&
              participant.mutations.has('double-or-nothing'),
          );
        foulOwners.set(event.sequence, { side: event.side, hasDoubleOwner });
        break;
      }
      case 'foul-relief': {
        const state = foulReplay.get(event.ownerInstanceId);
        if (state === undefined) {
          fail('fouls', 'foul relief without a prior foul');
          break;
        }
        if (state.charged > 0) state.charged -= 1;
        if (state.charged !== event.chargedFoulsAfter) {
          fail('fouls', 'foul relief charge count disagrees with the replay');
        }
        break;
      }
      case 'substitution': {
        const out = active.get(event.outInstanceId);
        if (out === undefined) {
          fail('actor-eligibility', 'substitution removes an inactive participant');
        } else {
          active.delete(event.outInstanceId);
        }
        const incoming = participants.get(event.inInstanceId);
        if (incoming === undefined) {
          fail('actor-eligibility', 'substitution adds an unknown participant');
        } else {
          active.set(event.inInstanceId, incoming);
        }
        if (event.reason === 'foul-out') {
          const state = foulReplay.get(event.outInstanceId);
          if ((state?.charged ?? 0) < HAVOC_PERSONAL_FOUL_LIMIT) {
            fail('fouls', 'foul-out substitution before six charged fouls');
          }
          if (incoming !== undefined && out !== undefined) {
            if (incoming.kind !== 'replacement')
              fail('clones', 'foul-out substitution did not use a replacement');
            if (incoming.ownerInstanceId !== out.instanceId) {
              fail('clones', 'replacement owner does not match the fouled-out starter');
            }
          }
        }
        break;
      }
      case 'clone': {
        if (event.outcome === 'entered') {
          if (cloneEntered.has(event.cloneInstanceId)) fail('clones', 'clone entered twice');
          cloneEntered.add(event.cloneInstanceId);
          const clone = participants.get(event.cloneInstanceId);
          if (clone === undefined || clone.kind !== 'clone') {
            fail('clones', 'clone event references a non-clone participant');
          } else {
            active.set(clone.instanceId, clone);
          }
          const owner = participants.get(event.ownerInstanceId);
          if (owner === undefined || !owner.mutations.has('clone-army')) {
            fail('clones', 'clone owner does not own clone-army');
          }
        } else {
          if (cloneExited.has(event.cloneInstanceId)) fail('clones', 'clone exited twice');
          cloneExited.add(event.cloneInstanceId);
          if (!cloneEntered.has(event.cloneInstanceId)) {
            fail('clones', 'clone exited without entering');
          }
          active.delete(event.cloneInstanceId);
        }
        break;
      }
      case 'shot-clock-violation': {
        if (event.limitSeconds < 1 || event.limitSeconds > 60)
          fail('clock', 'invalid shot clock limit');
        clockViolationSide.set(
          event.offenseSide,
          (clockViolationSide.get(event.offenseSide) ?? 0) + 1,
        );
        break;
      }
      case 'extra-possession': {
        const key = `${event.side}:${event.ownerInstanceId}`;
        if (event.outcome === 'queued') {
          queued.set(key, (queued.get(key) ?? 0) + 1);
          queuedCounts.set(key, (queuedCounts.get(key) ?? 0) + 1);
        } else if (event.outcome === 'started') {
          if ((queued.get(key) ?? 0) <= 0)
            fail('extra-possessions', 'extra possession started without a grant');
          queued.set(key, Math.max(0, (queued.get(key) ?? 0) - 1));
          if (event.possessionId === null) {
            fail('extra-possessions', 'started extra possession has no possession id');
          } else if (possessionOffense.get(event.possessionId) !== event.side) {
            fail('extra-possessions', 'started extra possession has no matching possession-start');
          }
        } else if ((queued.get(key) ?? 0) <= 0) {
          fail('extra-possessions', 'extra possession expired without a grant');
        } else {
          queued.set(key, Math.max(0, (queued.get(key) ?? 0) - 1));
        }
        break;
      }
      case 'rebound-loop': {
        const key = `${event.side}:${event.ownerInstanceId}`;
        grantCounts.set(key, (grantCounts.get(key) ?? 0) + event.granted);
        const owner = participants.get(event.ownerInstanceId);
        if (owner === undefined || !owner.mutations.has('rebound-loop')) {
          fail('extra-possessions', 'rebound loop owner does not own rebound-loop');
        }
        break;
      }
      case 'time-lord': {
        const sideIndex = sideIndexBySide.get(event.side);
        if (sideIndex === undefined) {
          fail('time-lord', 'time-lord event side is unknown');
          break;
        }
        const ownOwner = [...active.values()].some(
          (participant) =>
            participant.sideIndex === sideIndex && participant.mutations.has('time-lord'),
        );
        const opposingOwner = [...active.values()].some(
          (participant) =>
            participant.sideIndex !== sideIndex && participant.mutations.has('time-lord'),
        );
        const expected = ownOwner ? 30 : opposingOwner ? 12 : 24;
        if (event.fullSeconds !== expected) {
          fail(
            'time-lord',
            `${event.side} time-lord clock ${String(event.fullSeconds)} != expected ${String(expected)} (own owner ${String(ownOwner)}, opposing owner ${String(opposingOwner)})`,
          );
        }
        break;
      }
      case 'body-snatcher': {
        const owner = participants.get(event.ownerInstanceId);
        const target = participants.get(event.targetInstanceId);
        if (owner === undefined || !owner.mutations.has('body-snatcher')) {
          fail('body-snatcher', 'body-snatcher owner does not own the mutation');
        }
        if (target === undefined || target.kind !== 'starter') {
          fail('body-snatcher', 'body-snatcher target is not a starter');
        }
        if (owner !== undefined && target !== undefined && owner.sideIndex === target.sideIndex) {
          fail('body-snatcher', 'body-snatcher target is not an opponent');
        }
        break;
      }
      case 'great-equalizer': {
        const owner = participants.get(event.ownerInstanceId);
        if (owner === undefined || !owner.mutations.has('the-great-equalizer')) {
          fail('equalizer', 'equalizer owner does not own the mutation');
        }
        for (const cappedId of event.cappedInstanceIds) {
          const capped = participants.get(cappedId);
          if (capped === undefined) fail('equalizer', `capped participant ${cappedId} unknown`);
          else if (owner !== undefined && capped.sideIndex === owner.sideIndex) {
            fail('equalizer', 'equalizer capped a teammate');
          }
        }
        break;
      }
      case 'four-point-dunk':
      case 'and-one-bonus': {
        requireActive(event.shooterInstanceId, 'actor-eligibility');
        break;
      }
      case 'double-or-nothing-foul': {
        const foul = foulOwners.get(event.foulSequence);
        if (foul === undefined) {
          fail('double-or-nothing', 'extra free throw references no recorded foul');
        } else {
          if (foul.side !== event.side) {
            fail('double-or-nothing', 'extra free throw side differs from its foul');
          }
          if (!foul.hasDoubleOwner) {
            fail('double-or-nothing', 'extra free throw without an active Double or Nothing owner');
          }
        }
        const owner = requireActive(event.ownerInstanceId, 'actor-eligibility');
        if (owner != null) {
          if (!owner.mutations.has('double-or-nothing')) {
            fail('double-or-nothing', 'extra free throw owner does not own Double or Nothing');
          }
          if (owner.sideIndex !== sideIndexBySide.get(event.side)) {
            fail('double-or-nothing', 'extra free throw owner is not on the fouling side');
          }
        }
        doubleGiftCounts.set(
          event.foulSequence,
          (doubleGiftCounts.get(event.foulSequence) ?? 0) + 1,
        );
        break;
      }
      case 'golden-assist': {
        requireActive(event.assisterInstanceId, 'actor-eligibility');
        break;
      }
      case 'heat-check':
      case 'putback':
      case 'possession-refund':
      case 'bounty':
      case 'roulette': {
        requireActive(event.ownerInstanceId, 'actor-eligibility');
        break;
      }
      case 'buzzer-bandit': {
        const owner = requireActive(event.ownerInstanceId, 'actor-eligibility');
        requireActive(event.shooterInstanceId, 'actor-eligibility');
        if (owner !== null && !owner.mutations.has('buzzer-bandit')) {
          fail('buzzer-bandit', 'buzzer bandit event without the mutation');
        }
        if (event.ownerInstanceId !== event.shooterInstanceId) {
          fail('buzzer-bandit', 'buzzer bandit event does not reference its owner');
        }
        break;
      }
      case 'charity-casino': {
        const owner = requireActive(event.ownerInstanceId, 'actor-eligibility');
        if (owner !== null && !owner.mutations.has('charity-casino')) {
          fail('charity-casino', 'charity casino event without the mutation');
        }
        break;
      }
      case 'fusion-dance': {
        const owner = participants.get(event.ownerInstanceId);
        if (owner === undefined || !owner.mutations.has('fusion-dance')) {
          fail('fusion-dance', 'fusion dance owner does not own the mutation');
        }
        const donor = participants.get(event.donorInstanceId);
        if (donor === undefined || donor.kind !== 'starter') {
          fail('fusion-dance', 'fusion dance donor is not a starter');
        }
        if (owner !== undefined && donor !== undefined && owner.sideIndex !== donor.sideIndex) {
          fail('fusion-dance', 'fusion dance donor is not a teammate');
        }
        break;
      }
      case 'darwinism': {
        const owner = requireActive(event.ownerInstanceId, 'actor-eligibility');
        if (owner !== null && !owner.mutations.has('basketball-darwinism')) {
          fail('darwinism', 'darwinism event without the mutation');
        }
        requireActive(event.shooterInstanceId, 'actor-eligibility');
        break;
      }
      case 'cold-blooded': {
        const owner = participants.get(event.ownerInstanceId);
        if (owner === undefined || !owner.mutations.has('cold-blooded')) {
          fail('cold-blooded', 'cold blooded event without the mutation');
          break;
        }
        if (event.outcome === 'consumed') requireActive(event.ownerInstanceId, 'actor-eligibility');
        if (event.outcome === 'penalty') {
          const entry = tape.scoring.find(
            (candidate) => candidate.sequence === event.scoringSequence,
          );
          if (entry === undefined || entry.kind !== 'bonus' || entry.side === event.side) {
            fail('cold-blooded', 'cold blooded penalty is not an opposing bonus');
          }
        }
        break;
      }
      case 'triple-threat': {
        const owner = participants.get(event.ownerInstanceId);
        if (owner === undefined || !owner.mutations.has('triple-threat')) {
          fail('triple-threat', 'triple threat event without the mutation');
          break;
        }
        if (event.outcome === 'earned') requireActive(event.ownerInstanceId, 'actor-eligibility');
        break;
      }
      case 'oops-all-centers': {
        const owner = participants.get(event.ownerInstanceId);
        if (owner === undefined || !owner.mutations.has('oops-all-centers')) {
          fail('oops-all-centers', 'oops all centers event without the mutation');
        }
        if (event.resizedInstanceIds.length !== 5) {
          fail('oops-all-centers', 'oops all centers must resize all five starters');
        }
        break;
      }
      case 'hostile-takeover': {
        const owner = participants.get(event.ownerInstanceId);
        if (owner === undefined || !owner.mutations.has('hostile-takeover')) {
          fail('hostile-takeover', 'hostile takeover event without the mutation');
        }
        const from = participants.get(event.fromInstanceId);
        const to = participants.get(event.toInstanceId);
        if (from === undefined || to === undefined) {
          fail('hostile-takeover', 'hostile takeover references an unknown participant');
        } else if (owner !== undefined) {
          if (from.sideIndex !== owner.sideIndex) {
            fail('hostile-takeover', 'hostile takeover source is not a teammate');
          }
          if (to.sideIndex === owner.sideIndex) {
            fail('hostile-takeover', 'hostile takeover target is not an opponent');
          }
        }
        break;
      }
      default:
        break;
    }
  }

  for (const [sequence, foul] of foulOwners) {
    const gifts = doubleGiftCounts.get(sequence) ?? 0;
    if (foul.hasDoubleOwner && gifts !== 1) {
      fail(
        'double-or-nothing',
        `foul ${String(sequence)} should grant exactly one extra free throw`,
      );
    } else if (!foul.hasDoubleOwner && gifts !== 0) {
      fail(
        'double-or-nothing',
        `foul ${String(sequence)} grants extra free throws without a Double or Nothing owner`,
      );
    }
  }
  for (const [instanceId, state] of foulReplay) {
    const line = findLine(result, instanceId);
    if (line === undefined) continue;
    if (line.fouls !== state.committed) {
      fail(
        'fouls',
        `${instanceId} committed fouls ${String(state.committed)} != line ${String(line.fouls)}`,
      );
    }
    if (line.chargedFouls !== state.charged) {
      fail(
        'fouls',
        `${instanceId} charged fouls ${String(state.charged)} != line ${String(line.chargedFouls)}`,
      );
    }
  }
  for (const line of [...result.home.participants, ...result.away.participants]) {
    if (!foulReplay.has(line.instanceId) && line.fouls !== 0) {
      fail('fouls', `${line.instanceId} has recorded fouls but no foul events`);
    }
  }

  for (const side of [0, 1] as const) {
    const team = side === 0 ? result.home : result.away;
    const sideName = side === 0 ? input.home.side : input.away.side;
    const total = (suffix: string): number => counts.get(`${sideName}:${suffix}`) ?? 0;
    if (total('fgm') !== team.fieldGoals.made)
      fail('counts', `${team.side} made field goals disagree with the tape`);
    if (total('fga') !== team.fieldGoals.attempted)
      fail('counts', `${team.side} field-goal attempts disagree with the tape`);
    if (total('tpm') !== team.threes.made)
      fail('counts', `${team.side} made threes disagree with the tape`);
    if (total('tpa') !== team.threes.attempted)
      fail('counts', `${team.side} three attempts disagree with the tape`);
    if (total('ftm') !== team.freeThrows.made)
      fail('counts', `${team.side} made free throws disagree with the tape`);
    if (total('fta') !== team.freeThrows.attempted)
      fail('counts', `${team.side} free-throw attempts disagree with the tape`);
    if (total('assists') !== team.assists)
      fail('counts', `${team.side} assists disagree with the tape`);
    if (total('steals') !== team.steals)
      fail('counts', `${team.side} steals disagree with the tape`);
    if (total('blocks') !== team.blocks)
      fail('counts', `${team.side} blocks disagree with the tape`);
    if (total('fouls') !== team.fouls) fail('counts', `${team.side} fouls disagree with the tape`);
    const officialTurnovers =
      (turnoverSide.get(sideName) ?? 0) - (cancelledTurnoverSide.get(sideName) ?? 0);
    const violations = clockViolationSide.get(sideName) ?? 0;
    if (officialTurnovers + violations !== team.turnovers) {
      fail(
        'turnovers',
        `${team.side} official turnovers ${String(officialTurnovers)} + clock violations ${String(violations)} != result ${String(team.turnovers)}`,
      );
    }
  }
  for (const line of [...result.home.participants, ...result.away.participants]) {
    const canceledForPlayer = cancelledTurnoverPlayer.get(line.instanceId) ?? 0;
    const official = (counts.get(`${line.instanceId}:turnovers`) ?? 0) - canceledForPlayer;
    if (official > line.turnovers) {
      fail(
        'turnovers',
        `${line.instanceId} official turnover events ${String(official)} exceed line ${String(line.turnovers)}`,
      );
    }
    if ((counts.get(`${line.instanceId}:assists`) ?? 0) !== line.assists) {
      fail('counts', `${line.instanceId} assists disagree with the tape`);
    }
    if ((counts.get(`${line.instanceId}:steals`) ?? 0) !== line.steals) {
      fail('counts', `${line.instanceId} steals disagree with the tape`);
    }
    if ((counts.get(`${line.instanceId}:blocks`) ?? 0) !== line.blocks) {
      fail('counts', `${line.instanceId} blocks disagree with the tape`);
    }
    if ((counts.get(`${line.instanceId}:fouls`) ?? 0) !== line.fouls) {
      fail('counts', `${line.instanceId} fouls disagree with the tape`);
    }
    if ((counts.get(`${line.instanceId}:rebounds`) ?? 0) !== line.rebounds.total) {
      fail('counts', `${line.instanceId} rebounds disagree with the tape`);
    }
    if ((counts.get(`${line.instanceId}:oreb`) ?? 0) !== line.rebounds.offensive) {
      fail('counts', `${line.instanceId} offensive rebounds disagree with the tape`);
    }
    if ((counts.get(`${line.instanceId}:dreb`) ?? 0) !== line.rebounds.defensive) {
      fail('counts', `${line.instanceId} defensive rebounds disagree with the tape`);
    }
  }

  for (const [key, pending] of queued) {
    if (pending !== 0) fail('extra-possessions', `unexpired extra possessions remain for ${key}`);
  }
  for (const [key, granted] of grantCounts) {
    if ((queuedCounts.get(key) ?? 0) !== granted) {
      fail(
        'extra-possessions',
        `rebound loop grants ${String(granted)} != queued extra possessions ${String(queuedCounts.get(key) ?? 0)}`,
      );
    }
  }
}

function findLine(
  result: HavocBattleResult,
  instanceId: string,
): HavocBattleResult['home']['participants'][number] | undefined {
  for (const line of [...result.home.participants, ...result.away.participants]) {
    if (line.instanceId === instanceId) return line;
  }
  return undefined;
}

function ledgerSide(value: number): 0 | 1 {
  return value === 0 ? 0 : 1;
}

function ledgerScoringSourceName(source: number): HavocScoringSource {
  return BATTLE_LEDGER_SCORING_SOURCES[source] ?? 'roulette';
}

/**
 * The compact twin of {@link checkTape}. It consumes the kernel's numeric
 * event/scoring records and participant index directly, avoiding thousands of
 * typed objects and string-keyed count maps for games that never play back a
 * tape. Every check, message, and accumulator matches the tape audit.
 */
function checkLedger(
  ledger: HavocBattleLedger,
  result: HavocBattleResult,
  input: HavocBattleInput,
  fail: (code: string, message: string) => void,
): void {
  const participants = ledger.participants;
  const participantAt = (index: number): HavocBattleLedgerParticipant | undefined =>
    participants[index];
  const instance = (index: number): string => participants[index]?.instanceId ?? '';
  const eventValue = (record: number, field: number): number =>
    ledger.events[record * BATTLE_LEDGER_EVENT_FIELDS + field] ?? 0;
  const scoringValue = (record: number, field: number): number =>
    ledger.scoring[record * BATTLE_LEDGER_SCORING_FIELDS + field] ?? 0;
  const resultLines = [...result.home.participants, ...result.away.participants];
  const resultLineById = new Map(resultLines.map((line) => [line.instanceId, line]));
  const participantIndexById = new Map(
    participants.map((participant, index) => [participant.instanceId, index]),
  );

  const sidePoints: [number, number] = [0, 0];
  const periodPoints: [number[], number[]] = [
    Array.from({ length: result.home.periods.length }, () => 0),
    Array.from({ length: result.home.periods.length }, () => 0),
  ];
  const actorPoints = new Array<number>(participants.length).fill(0);
  /** First scoring entry's side for bonus entries, or -1 for any other kind. */
  const scoringSideBySequence = new Map<number, number>();
  const freeThrowAttempts = new Map<number, { made: boolean; shooterIndex: number }>();
  const shotAttempts = new Map<number, { made: boolean; shooterIndex: number }>();
  for (let record = 0; record < ledger.eventCount; record += 1) {
    const kind = eventValue(record, 0);
    if (kind === BATTLE_LEDGER_EVENT.freeThrowAttempt) {
      freeThrowAttempts.set(eventValue(record, 1), {
        made: eventValue(record, 7) !== 0,
        shooterIndex: eventValue(record, 5),
      });
    } else if (kind === BATTLE_LEDGER_EVENT.shotAttempt) {
      shotAttempts.set(eventValue(record, 1), {
        made: eventValue(record, 9) !== 0,
        shooterIndex: eventValue(record, 5),
      });
    }
  }
  let lastScore = -1;
  for (let record = 0; record < ledger.scoringCount; record += 1) {
    const sequence = scoringValue(record, 0);
    if (sequence <= lastScore) fail('scoring-order', 'scoring sequences must strictly increase');
    lastScore = sequence;
    const side = ledgerSide(scoringValue(record, 5));
    const kind = scoringValue(record, 6);
    const actorIndex = scoringValue(record, 7);
    const actor = participantAt(actorIndex);
    const isBonus = kind === BATTLE_LEDGER_SCORING_KIND.bonus;
    if (!scoringSideBySequence.has(sequence)) {
      scoringSideBySequence.set(sequence, isBonus ? side : -1);
    }
    if (scoringValue(record, 1) !== input.gameNumber)
      fail('scoring-entry', 'scoring entry game number mismatch');
    if (actor === undefined) {
      fail('actor-eligibility', `scoring entry actor ${instance(actorIndex)} is not a participant`);
      continue;
    }
    const originalSequence = scoringValue(record, 11);
    const bonusOrigin =
      isBonus && originalSequence >= 0
        ? (shotAttempts.get(originalSequence) ?? freeThrowAttempts.get(originalSequence))
        : undefined;
    if (isBonus) {
      if (actor.sideIndex === side) {
        fail('actor-eligibility', 'bonus scoring actor is not opposing the scoring side');
      }
      if (bonusOrigin === undefined) {
        fail('scoring-entry', 'bonus scoring entry references no shot attempt');
      } else if (bonusOrigin.made || bonusOrigin.shooterIndex !== actorIndex) {
        fail('scoring-entry', 'bonus scoring entry does not reference its own missed attempt');
      }
    } else if (actor.sideIndex !== side) {
      fail('actor-eligibility', `scoring entry actor ${actor.instanceId} is on the wrong side`);
    }
    const beneficiaryIndex = scoringValue(record, 8);
    if (beneficiaryIndex >= 0 && participantAt(beneficiaryIndex) === undefined) {
      fail(
        'actor-eligibility',
        `scoring beneficiary ${instance(beneficiaryIndex)} is not a participant`,
      );
    }
    let points = scoringValue(record, 9);
    let dunkBonus = 0;
    const sources: HavocScoringSource[] = [];
    const addendCount = scoringValue(record, 12);
    for (let index = 0; index < addendCount; index += 1) {
      const source = ledgerScoringSourceName(scoringValue(record, 20 + index * 2));
      const rawSource: string = source;
      sources.push(source);
      if (!isScoringSource(source)) fail('scoring-entry', `unknown scoring source ${rawSource}`);
      const addendPoints = scoringValue(record, 21 + index * 2);
      if (source === 'four-point-dunk') dunkBonus += addendPoints;
      else points += addendPoints;
    }
    const multiplierCount = scoringValue(record, 13);
    for (let index = 0; index < multiplierCount; index += 1) {
      const source = ledgerScoringSourceName(scoringValue(record, 36 + index * 2));
      const rawSource: string = source;
      sources.push(source);
      if (!isScoringSource(source)) fail('scoring-entry', `unknown scoring source ${rawSource}`);
      points *= scoringValue(record, 37 + index * 2) === 3 ? 3 : 2;
    }
    points += dunkBonus;
    if (points !== scoringValue(record, 10)) {
      fail(
        'points-ledger',
        `scoring entry ${String(sequence)} points ${String(scoringValue(record, 10))} != resolved ${String(points)}`,
      );
    }
    const ownerCount = scoringValue(record, 14);
    for (let index = 0; index < ownerCount; index += 1) {
      const ownerIndex = scoringValue(record, 15 + index);
      const owner = participantAt(ownerIndex);
      if (owner === undefined) {
        fail('scoring-entry', `scoring owner ${instance(ownerIndex)} is not a participant`);
        continue;
      }
      if (!sources.some((source) => owner.mutations.has(HAVOC_SCORING_SOURCE_MUTATION[source]))) {
        fail(
          'scoring-entry',
          `owner ${owner.instanceId} does not own any scoring source on entry ${String(sequence)}`,
        );
      }
      if (isBonus) {
        if (owner.sideIndex !== actor.sideIndex) {
          fail('scoring-entry', `bonus owner ${owner.instanceId} is not on the actor's side`);
        }
      } else if (owner.sideIndex !== side) {
        fail('scoring-entry', `owner ${owner.instanceId} is not on the scoring side`);
      }
    }
    if (sources.length > 0 && ownerCount === 0) {
      fail('scoring-entry', `scoring entry ${String(sequence)} has no owners for its sources`);
    }
    sidePoints[side] += scoringValue(record, 10);
    const periodIndex = scoringValue(record, 2) - 1;
    const bucket = periodPoints[side];
    if (periodIndex >= 0 && periodIndex < bucket.length) {
      bucket[periodIndex] = (bucket[periodIndex] ?? 0) + scoringValue(record, 10);
    } else {
      fail('period-ledger', `scoring entry ${String(sequence)} period out of range`);
    }
    if (!isBonus) {
      actorPoints[actorIndex] = (actorPoints[actorIndex] ?? 0) + scoringValue(record, 10);
    }
  }
  for (const side of [0, 1] as const) {
    const team = side === 0 ? result.home : result.away;
    if (sidePoints[side] !== team.points) {
      fail(
        'points-ledger',
        `${team.side} ledger points ${String(sidePoints[side])} != result ${String(team.points)}`,
      );
    }
    for (let index = 0; index < team.periods.length; index += 1) {
      if ((periodPoints[side][index] ?? 0) !== team.periods[index]) {
        fail(
          'period-ledger',
          `${team.side} period ${String(index + 1)} ledger ${String(periodPoints[side][index] ?? 0)} != result ${String(team.periods[index])}`,
        );
      }
    }
  }
  for (const line of resultLines) {
    const index = participantIndexById.get(line.instanceId);
    const points = index === undefined ? 0 : (actorPoints[index] ?? 0);
    if (points !== line.points) {
      fail(
        'points-ledger',
        `${line.instanceId} ledger points ${String(points)} != line ${String(line.points)}`,
      );
    }
  }

  const active = new Set<number>();
  for (let index = 0; index < participants.length; index += 1) {
    if (participants[index]?.kind === 'starter') active.add(index);
  }
  const requireActive = (index: number, code: string): HavocBattleLedgerParticipant | null => {
    const participant = participantAt(index);
    if (participant === undefined || !active.has(index)) {
      fail(code, `${instance(index)} is not an active actor at its event`);
      return null;
    }
    return participant;
  };
  const foulSeen = new Array<boolean>(participants.length).fill(false);
  const foulCommitted = new Array<number>(participants.length).fill(0);
  const foulCharged = new Array<number>(participants.length).fill(0);
  const turnedOver = new Set<number>();
  const cancelled = new Set<number>();
  const turnoverSide: [number, number] = [0, 0];
  const cancelledTurnoverSide: [number, number] = [0, 0];
  const cancelledTurnoverPlayer = new Array<number>(participants.length).fill(0);
  const turnoversBySequence = new Map<number, { side: 0 | 1; playerIndex: number }>();
  const clockViolationSide: [number, number] = [0, 0];
  const possessionOffense = new Map<number, 0 | 1>();
  const queued = new Map<number, number>();
  const queuedCounts = new Map<number, number>();
  const cloneEntered = new Set<number>();
  const cloneExited = new Set<number>();
  const grantCounts = new Map<number, number>();
  const foulOwners = new Map<number, { side: 0 | 1; hasDoubleOwner: boolean }>();
  const doubleGiftCounts = new Map<number, number>();
  const sideFga: [number, number] = [0, 0];
  const sideFgm: [number, number] = [0, 0];
  const sideTpa: [number, number] = [0, 0];
  const sideTpm: [number, number] = [0, 0];
  const sideFta: [number, number] = [0, 0];
  const sideFtm: [number, number] = [0, 0];
  const sideAssists: [number, number] = [0, 0];
  const sideSteals: [number, number] = [0, 0];
  const sideBlocks: [number, number] = [0, 0];
  const sideFouls: [number, number] = [0, 0];
  const playerRebounds = new Array<number>(participants.length).fill(0);
  const playerOreb = new Array<number>(participants.length).fill(0);
  const playerDreb = new Array<number>(participants.length).fill(0);
  const playerAssists = new Array<number>(participants.length).fill(0);
  const playerSteals = new Array<number>(participants.length).fill(0);
  const playerBlocks = new Array<number>(participants.length).fill(0);
  const playerFouls = new Array<number>(participants.length).fill(0);
  const playerTurnovers = new Array<number>(participants.length).fill(0);

  for (let record = 0; record < ledger.eventCount; record += 1) {
    const kind = eventValue(record, 0);
    if (kind === BATTLE_LEDGER_EVENT.possessionStart) {
      possessionOffense.set(eventValue(record, 5), ledgerSide(eventValue(record, 6)));
    }
  }

  let lastEvent = -1;
  for (let record = 0; record < ledger.eventCount; record += 1) {
    const sequence = eventValue(record, 1);
    if (sequence <= lastEvent) fail('event-order', 'event sequences must strictly increase');
    lastEvent = sequence;
    if (eventValue(record, 2) !== input.gameNumber) fail('event', 'event game number mismatch');
    switch (eventValue(record, 0)) {
      case BATTLE_LEDGER_EVENT.periodStart:
      case BATTLE_LEDGER_EVENT.periodEnd:
      case BATTLE_LEDGER_EVENT.gameEnd:
        break;
      case BATTLE_LEDGER_EVENT.possessionStart:
        break;
      case BATTLE_LEDGER_EVENT.shotAttempt: {
        const shooterIndex = eventValue(record, 5);
        const shooter = requireActive(shooterIndex, 'actor-eligibility');
        const side = ledgerSide(eventValue(record, 6));
        if (shooter !== null && shooter.sideIndex !== side) {
          fail('actor-eligibility', 'shot shooter is on the wrong side');
        }
        sideFga[side] += 1;
        if (eventValue(record, 9) !== 0) {
          sideFgm[side] += 1;
        }
        if (eventValue(record, 10) === 3) {
          sideTpa[side] += 1;
          if (eventValue(record, 9) !== 0) sideTpm[side] += 1;
        }
        break;
      }
      case BATTLE_LEDGER_EVENT.freeThrowAttempt: {
        const shooterIndex = eventValue(record, 5);
        const shooter = requireActive(shooterIndex, 'actor-eligibility');
        const side = ledgerSide(eventValue(record, 6));
        if (shooter !== null && shooter.sideIndex !== side) {
          fail('actor-eligibility', 'free-throw shooter is on the wrong side');
        }
        sideFta[side] += 1;
        if (eventValue(record, 7) !== 0) sideFtm[side] += 1;
        break;
      }
      case BATTLE_LEDGER_EVENT.rebound: {
        const rebounderIndex = eventValue(record, 5);
        const rebounder = requireActive(rebounderIndex, 'actor-eligibility');
        const side = ledgerSide(eventValue(record, 6));
        if (rebounder !== null && rebounder.sideIndex !== side) {
          fail('actor-eligibility', 'rebounder is on the wrong side');
        }
        playerRebounds[rebounderIndex] = (playerRebounds[rebounderIndex] ?? 0) + 1;
        if (eventValue(record, 7) !== 0) {
          playerOreb[rebounderIndex] = (playerOreb[rebounderIndex] ?? 0) + 1;
        } else {
          playerDreb[rebounderIndex] = (playerDreb[rebounderIndex] ?? 0) + 1;
        }
        break;
      }
      case BATTLE_LEDGER_EVENT.assist: {
        const assisterIndex = eventValue(record, 5);
        const scorerIndex = eventValue(record, 6);
        requireActive(assisterIndex, 'actor-eligibility');
        requireActive(scorerIndex, 'actor-eligibility');
        if (assisterIndex === scorerIndex) fail('assists', 'assist credited to the scorer');
        playerAssists[assisterIndex] = (playerAssists[assisterIndex] ?? 0) + 1;
        const side = ledgerSide(eventValue(record, 7));
        sideAssists[side] += 1;
        break;
      }
      case BATTLE_LEDGER_EVENT.steal: {
        const stealerIndex = eventValue(record, 5);
        requireActive(stealerIndex, 'actor-eligibility');
        playerSteals[stealerIndex] = (playerSteals[stealerIndex] ?? 0) + 1;
        const side = ledgerSide(eventValue(record, 6));
        sideSteals[side] += 1;
        break;
      }
      case BATTLE_LEDGER_EVENT.block: {
        const blockerIndex = eventValue(record, 5);
        const shooterIndex = eventValue(record, 6);
        requireActive(blockerIndex, 'actor-eligibility');
        requireActive(shooterIndex, 'actor-eligibility');
        playerBlocks[blockerIndex] = (playerBlocks[blockerIndex] ?? 0) + 1;
        const side = ledgerSide(eventValue(record, 7));
        sideBlocks[side] += 1;
        break;
      }
      case BATTLE_LEDGER_EVENT.turnover: {
        const playerIndex = eventValue(record, 5);
        requireActive(playerIndex, 'actor-eligibility');
        turnedOver.add(sequence);
        playerTurnovers[playerIndex] = (playerTurnovers[playerIndex] ?? 0) + 1;
        const side = ledgerSide(eventValue(record, 6));
        turnoversBySequence.set(sequence, { side, playerIndex });
        turnoverSide[side] += 1;
        if (cancelled.has(sequence)) {
          cancelledTurnoverSide[side] += 1;
          cancelledTurnoverPlayer[playerIndex] = (cancelledTurnoverPlayer[playerIndex] ?? 0) + 1;
        }
        break;
      }
      case BATTLE_LEDGER_EVENT.turnoverCancelled: {
        const originalSequence = eventValue(record, 7);
        if (!turnedOver.has(originalSequence)) {
          fail('turnovers', 'turnover cancellation references no recorded turnover');
        }
        if (!cancelled.has(originalSequence)) {
          cancelled.add(originalSequence);
          const prior = turnoversBySequence.get(originalSequence);
          if (prior !== undefined) {
            cancelledTurnoverSide[prior.side] += 1;
            cancelledTurnoverPlayer[prior.playerIndex] =
              (cancelledTurnoverPlayer[prior.playerIndex] ?? 0) + 1;
          }
        }
        break;
      }
      case BATTLE_LEDGER_EVENT.foul: {
        const foulerIndex = eventValue(record, 5);
        const fouler = participantAt(foulerIndex);
        if (fouler === undefined) {
          fail('actor-eligibility', `foul fouler ${instance(foulerIndex)} is not a participant`);
          break;
        }
        requireActive(foulerIndex, 'actor-eligibility');
        const side = ledgerSide(eventValue(record, 6));
        if (fouler.sideIndex !== side) fail('fouls', 'fouler is on the wrong side');
        foulSeen[foulerIndex] = true;
        foulCommitted[foulerIndex] = (foulCommitted[foulerIndex] ?? 0) + 1;
        foulCharged[foulerIndex] = (foulCharged[foulerIndex] ?? 0) + 1;
        if (eventValue(record, 10) === 1) {
          if ((foulCommitted[foulerIndex] ?? 0) < HAVOC_PERSONAL_FOUL_LIMIT) {
            fail('fouls', 'technical free throw before the sixth personal foul');
          }
          if (fouler.kind !== 'replacement') {
            fail('fouls', 'technical free throw by a non-replacement');
          }
        }
        if (eventValue(record, 7) !== 0 && eventValue(record, 8) >= 0) {
          requireActive(eventValue(record, 8), 'actor-eligibility');
        }
        playerFouls[foulerIndex] = (playerFouls[foulerIndex] ?? 0) + 1;
        sideFouls[side] += 1;
        let hasDoubleOwner = false;
        for (const activeIndex of active) {
          const activeParticipant = participantAt(activeIndex);
          if (
            activeParticipant?.sideIndex === side &&
            activeParticipant.mutations.has('double-or-nothing')
          ) {
            hasDoubleOwner = true;
            break;
          }
        }
        foulOwners.set(sequence, { side, hasDoubleOwner });
        break;
      }
      case BATTLE_LEDGER_EVENT.foulRelief: {
        const ownerIndex = eventValue(record, 5);
        if (foulSeen[ownerIndex] !== true) {
          fail('fouls', 'foul relief without a prior foul');
          break;
        }
        if ((foulCharged[ownerIndex] ?? 0) > 0) {
          foulCharged[ownerIndex] = (foulCharged[ownerIndex] ?? 0) - 1;
        }
        if (foulCharged[ownerIndex] !== eventValue(record, 8)) {
          fail('fouls', 'foul relief charge count disagrees with the replay');
        }
        break;
      }
      case BATTLE_LEDGER_EVENT.substitution: {
        const outIndex = eventValue(record, 5);
        const out = participantAt(outIndex);
        if (out === undefined || !active.has(outIndex)) {
          fail('actor-eligibility', 'substitution removes an inactive participant');
        } else {
          active.delete(outIndex);
        }
        const inIndex = eventValue(record, 6);
        const incoming = participantAt(inIndex);
        if (incoming === undefined) {
          fail('actor-eligibility', 'substitution adds an unknown participant');
        } else {
          active.add(inIndex);
        }
        if ((foulCharged[outIndex] ?? 0) < HAVOC_PERSONAL_FOUL_LIMIT) {
          fail('fouls', 'foul-out substitution before six charged fouls');
        }
        if (incoming !== undefined && out !== undefined) {
          if (incoming.kind !== 'replacement') {
            fail('clones', 'foul-out substitution did not use a replacement');
          }
          if (incoming.ownerInstanceId !== out.instanceId) {
            fail('clones', 'replacement owner does not match the fouled-out starter');
          }
        }
        break;
      }
      case BATTLE_LEDGER_EVENT.clone: {
        const outcome = eventValue(record, 5);
        const ownerIndex = eventValue(record, 6);
        const cloneIndex = eventValue(record, 7);
        if (outcome === 0) {
          if (cloneEntered.has(cloneIndex)) fail('clones', 'clone entered twice');
          cloneEntered.add(cloneIndex);
          const clone = participantAt(cloneIndex);
          if (clone === undefined || clone.kind !== 'clone') {
            fail('clones', 'clone event references a non-clone participant');
          } else {
            active.add(cloneIndex);
          }
          const owner = participantAt(ownerIndex);
          if (owner === undefined || !owner.mutations.has('clone-army')) {
            fail('clones', 'clone owner does not own clone-army');
          }
        } else {
          if (cloneExited.has(cloneIndex)) fail('clones', 'clone exited twice');
          cloneExited.add(cloneIndex);
          if (!cloneEntered.has(cloneIndex)) fail('clones', 'clone exited without entering');
          active.delete(cloneIndex);
        }
        break;
      }
      case BATTLE_LEDGER_EVENT.shotClockViolation: {
        const limit = eventValue(record, 7);
        if (limit < 1 || limit > 60) fail('clock', 'invalid shot clock limit');
        const side = ledgerSide(eventValue(record, 6));
        clockViolationSide[side] += 1;
        break;
      }
      case BATTLE_LEDGER_EVENT.extraPossession: {
        const ownerIndex = eventValue(record, 6);
        const side = ledgerSide(eventValue(record, 7));
        const key = side * participants.length + ownerIndex;
        const outcome = eventValue(record, 5);
        if (outcome === 0) {
          queued.set(key, (queued.get(key) ?? 0) + 1);
          queuedCounts.set(key, (queuedCounts.get(key) ?? 0) + 1);
        } else if (outcome === 1) {
          if ((queued.get(key) ?? 0) <= 0) {
            fail('extra-possessions', 'extra possession started without a grant');
          }
          queued.set(key, Math.max(0, (queued.get(key) ?? 0) - 1));
          const possessionId = eventValue(record, 8);
          if (possessionId < 0) {
            fail('extra-possessions', 'started extra possession has no possession id');
          } else if (possessionOffense.get(possessionId) !== side) {
            fail('extra-possessions', 'started extra possession has no matching possession-start');
          }
        } else if ((queued.get(key) ?? 0) <= 0) {
          fail('extra-possessions', 'extra possession expired without a grant');
        } else {
          queued.set(key, Math.max(0, (queued.get(key) ?? 0) - 1));
        }
        break;
      }
      case BATTLE_LEDGER_EVENT.reboundLoop: {
        const ownerIndex = eventValue(record, 5);
        const side = ledgerSide(eventValue(record, 6));
        const key = side * participants.length + ownerIndex;
        grantCounts.set(key, (grantCounts.get(key) ?? 0) + eventValue(record, 8));
        const owner = participantAt(ownerIndex);
        if (owner === undefined || !owner.mutations.has('rebound-loop')) {
          fail('extra-possessions', 'rebound loop owner does not own rebound-loop');
        }
        break;
      }
      case BATTLE_LEDGER_EVENT.timeLord: {
        const side = ledgerSide(eventValue(record, 5));
        let ownOwner = false;
        let opposingOwner = false;
        for (const activeIndex of active) {
          const activeParticipant = participantAt(activeIndex);
          if (!activeParticipant?.mutations.has('time-lord')) continue;
          if (activeParticipant.sideIndex === side) ownOwner = true;
          else opposingOwner = true;
        }
        const expected = ownOwner ? 30 : opposingOwner ? 12 : 24;
        if (eventValue(record, 6) !== expected) {
          fail(
            'time-lord',
            `${side === 0 ? 'home' : 'away'} time-lord clock ${String(eventValue(record, 6))} != expected ${String(expected)} (own owner ${String(ownOwner)}, opposing owner ${String(opposingOwner)})`,
          );
        }
        break;
      }
      case BATTLE_LEDGER_EVENT.bodySnatcher: {
        const ownerIndex = eventValue(record, 6);
        const targetIndex = eventValue(record, 7);
        const owner = participantAt(ownerIndex);
        const target = participantAt(targetIndex);
        if (owner === undefined || !owner.mutations.has('body-snatcher')) {
          fail('body-snatcher', 'body-snatcher owner does not own the mutation');
        }
        if (target === undefined || target.kind !== 'starter') {
          fail('body-snatcher', 'body-snatcher target is not a starter');
        }
        if (owner !== undefined && target !== undefined && owner.sideIndex === target.sideIndex) {
          fail('body-snatcher', 'body-snatcher target is not an opponent');
        }
        break;
      }
      case BATTLE_LEDGER_EVENT.greatEqualizer: {
        const ownerIndex = eventValue(record, 6);
        const owner = participantAt(ownerIndex);
        if (owner === undefined || !owner.mutations.has('the-great-equalizer')) {
          fail('equalizer', 'equalizer owner does not own the mutation');
        }
        const cappedCount = eventValue(record, 7);
        for (let index = 0; index < cappedCount; index += 1) {
          const cappedIndex = eventValue(record, 8 + index);
          const capped = participantAt(cappedIndex);
          if (capped === undefined) {
            fail('equalizer', `capped participant ${instance(cappedIndex)} unknown`);
          } else if (owner !== undefined && capped.sideIndex === owner.sideIndex) {
            fail('equalizer', 'equalizer capped a teammate');
          }
        }
        break;
      }
      case BATTLE_LEDGER_EVENT.fourPointDunk:
      case BATTLE_LEDGER_EVENT.andOneBonus: {
        requireActive(eventValue(record, 5), 'actor-eligibility');
        break;
      }
      case BATTLE_LEDGER_EVENT.goldenAssist: {
        requireActive(eventValue(record, 5), 'actor-eligibility');
        break;
      }
      case BATTLE_LEDGER_EVENT.doubleOrNothingFoul: {
        const foulSequence = eventValue(record, 7);
        const foul = foulOwners.get(foulSequence);
        if (foul === undefined) {
          fail('double-or-nothing', 'extra free throw references no recorded foul');
        } else {
          const side = ledgerSide(eventValue(record, 6));
          if (foul.side !== side) {
            fail('double-or-nothing', 'extra free throw side differs from its foul');
          }
          if (!foul.hasDoubleOwner) {
            fail('double-or-nothing', 'extra free throw without an active Double or Nothing owner');
          }
        }
        const ownerIndex = eventValue(record, 5);
        const owner = requireActive(ownerIndex, 'actor-eligibility');
        if (owner !== null) {
          if (!owner.mutations.has('double-or-nothing')) {
            fail('double-or-nothing', 'extra free throw owner does not own Double or Nothing');
          }
          if (owner.sideIndex !== ledgerSide(eventValue(record, 6))) {
            fail('double-or-nothing', 'extra free throw owner is not on the fouling side');
          }
        }
        doubleGiftCounts.set(foulSequence, (doubleGiftCounts.get(foulSequence) ?? 0) + 1);
        break;
      }
      case BATTLE_LEDGER_EVENT.heatCheck:
      case BATTLE_LEDGER_EVENT.putback:
      case BATTLE_LEDGER_EVENT.bounty: {
        requireActive(eventValue(record, 6), 'actor-eligibility');
        break;
      }
      case BATTLE_LEDGER_EVENT.possessionRefund:
      case BATTLE_LEDGER_EVENT.roulette: {
        requireActive(eventValue(record, 5), 'actor-eligibility');
        break;
      }
      case BATTLE_LEDGER_EVENT.buzzerBandit: {
        const ownerIndex = eventValue(record, 6);
        const shooterIndex = eventValue(record, 7);
        const owner = requireActive(ownerIndex, 'actor-eligibility');
        requireActive(shooterIndex, 'actor-eligibility');
        if (owner !== null && !owner.mutations.has('buzzer-bandit')) {
          fail('buzzer-bandit', 'buzzer bandit event without the mutation');
        }
        if (ownerIndex !== shooterIndex) {
          fail('buzzer-bandit', 'buzzer bandit event does not reference its owner');
        }
        break;
      }
      case BATTLE_LEDGER_EVENT.charityCasino: {
        const owner = requireActive(eventValue(record, 6), 'actor-eligibility');
        if (owner !== null && !owner.mutations.has('charity-casino')) {
          fail('charity-casino', 'charity casino event without the mutation');
        }
        break;
      }
      case BATTLE_LEDGER_EVENT.fusionDance: {
        const owner = participantAt(eventValue(record, 6));
        const donor = participantAt(eventValue(record, 7));
        if (owner === undefined || !owner.mutations.has('fusion-dance')) {
          fail('fusion-dance', 'fusion dance owner does not own the mutation');
        }
        if (donor === undefined || donor.kind !== 'starter') {
          fail('fusion-dance', 'fusion dance donor is not a starter');
        }
        if (owner !== undefined && donor !== undefined && owner.sideIndex !== donor.sideIndex) {
          fail('fusion-dance', 'fusion dance donor is not a teammate');
        }
        break;
      }
      case BATTLE_LEDGER_EVENT.darwinism: {
        const ownerIndex = eventValue(record, 5);
        const owner = requireActive(ownerIndex, 'actor-eligibility');
        if (owner !== null && !owner.mutations.has('basketball-darwinism')) {
          fail('darwinism', 'darwinism event without the mutation');
        }
        requireActive(eventValue(record, 7), 'actor-eligibility');
        break;
      }
      case BATTLE_LEDGER_EVENT.coldBlooded: {
        const ownerIndex = eventValue(record, 6);
        const owner = participantAt(ownerIndex);
        if (owner === undefined || !owner.mutations.has('cold-blooded')) {
          fail('cold-blooded', 'cold blooded event without the mutation');
          break;
        }
        const outcome = eventValue(record, 5);
        if (outcome === 1) requireActive(ownerIndex, 'actor-eligibility');
        if (outcome === 3) {
          const penaltySide = scoringSideBySequence.get(eventValue(record, 9));
          if (
            penaltySide === undefined ||
            penaltySide < 0 ||
            penaltySide === ledgerSide(eventValue(record, 7))
          ) {
            fail('cold-blooded', 'cold blooded penalty is not an opposing bonus');
          }
        }
        break;
      }
      case BATTLE_LEDGER_EVENT.tripleThreat: {
        const ownerIndex = eventValue(record, 6);
        const owner = participantAt(ownerIndex);
        if (owner === undefined || !owner.mutations.has('triple-threat')) {
          fail('triple-threat', 'triple threat event without the mutation');
          break;
        }
        if (eventValue(record, 5) === 1) requireActive(ownerIndex, 'actor-eligibility');
        break;
      }
      case BATTLE_LEDGER_EVENT.oopsAllCenters: {
        const owner = participantAt(eventValue(record, 6));
        if (owner === undefined || !owner.mutations.has('oops-all-centers')) {
          fail('oops-all-centers', 'oops all centers event without the mutation');
        }
        if (eventValue(record, 8) !== 5) {
          fail('oops-all-centers', 'oops all centers must resize all five starters');
        }
        break;
      }
      case BATTLE_LEDGER_EVENT.hostileTakeover: {
        const owner = participantAt(eventValue(record, 6));
        if (owner === undefined || !owner.mutations.has('hostile-takeover')) {
          fail('hostile-takeover', 'hostile takeover event without the mutation');
        }
        const from = participantAt(eventValue(record, 8));
        const to = participantAt(eventValue(record, 9));
        if (from === undefined || to === undefined) {
          fail('hostile-takeover', 'hostile takeover references an unknown participant');
        } else if (owner !== undefined) {
          if (from.sideIndex !== owner.sideIndex) {
            fail('hostile-takeover', 'hostile takeover source is not a teammate');
          }
          if (to.sideIndex === owner.sideIndex) {
            fail('hostile-takeover', 'hostile takeover target is not an opponent');
          }
        }
        break;
      }
      default:
        break;
    }
  }

  for (const [sequence, foul] of foulOwners) {
    const gifts = doubleGiftCounts.get(sequence) ?? 0;
    if (foul.hasDoubleOwner && gifts !== 1) {
      fail(
        'double-or-nothing',
        `foul ${String(sequence)} should grant exactly one extra free throw`,
      );
    } else if (!foul.hasDoubleOwner && gifts !== 0) {
      fail(
        'double-or-nothing',
        `foul ${String(sequence)} grants extra free throws without a Double or Nothing owner`,
      );
    }
  }
  for (let index = 0; index < participants.length; index += 1) {
    if (foulSeen[index] !== true) continue;
    const line = resultLineById.get(instance(index));
    if (line === undefined) continue;
    if (line.fouls !== foulCommitted[index]) {
      fail(
        'fouls',
        `${instance(index)} committed fouls ${String(foulCommitted[index])} != line ${String(line.fouls)}`,
      );
    }
    if (line.chargedFouls !== foulCharged[index]) {
      fail(
        'fouls',
        `${instance(index)} charged fouls ${String(foulCharged[index])} != line ${String(line.chargedFouls)}`,
      );
    }
  }
  for (const line of resultLines) {
    const index = participantIndexById.get(line.instanceId);
    if (index === undefined || foulSeen[index] !== true) {
      if (line.fouls !== 0) {
        fail('fouls', `${line.instanceId} has recorded fouls but no foul events`);
      }
    }
  }

  for (const side of [0, 1] as const) {
    const team = side === 0 ? result.home : result.away;
    if (sideFgm[side] !== team.fieldGoals.made)
      fail('counts', `${team.side} made field goals disagree with the tape`);
    if (sideFga[side] !== team.fieldGoals.attempted)
      fail('counts', `${team.side} field-goal attempts disagree with the tape`);
    if (sideTpm[side] !== team.threes.made)
      fail('counts', `${team.side} made threes disagree with the tape`);
    if (sideTpa[side] !== team.threes.attempted)
      fail('counts', `${team.side} three attempts disagree with the tape`);
    if (sideFtm[side] !== team.freeThrows.made)
      fail('counts', `${team.side} made free throws disagree with the tape`);
    if (sideFta[side] !== team.freeThrows.attempted)
      fail('counts', `${team.side} free-throw attempts disagree with the tape`);
    if (sideAssists[side] !== team.assists)
      fail('counts', `${team.side} assists disagree with the tape`);
    if (sideSteals[side] !== team.steals)
      fail('counts', `${team.side} steals disagree with the tape`);
    if (sideBlocks[side] !== team.blocks)
      fail('counts', `${team.side} blocks disagree with the tape`);
    if (sideFouls[side] !== team.fouls) fail('counts', `${team.side} fouls disagree with the tape`);
    const officialTurnovers = turnoverSide[side] - cancelledTurnoverSide[side];
    const violations = clockViolationSide[side];
    if (officialTurnovers + violations !== team.turnovers) {
      fail(
        'turnovers',
        `${team.side} official turnovers ${String(officialTurnovers)} + clock violations ${String(violations)} != result ${String(team.turnovers)}`,
      );
    }
  }
  for (const line of resultLines) {
    const index = participantIndexById.get(line.instanceId);
    const official =
      (index === undefined ? 0 : (playerTurnovers[index] ?? 0)) -
      (index === undefined ? 0 : (cancelledTurnoverPlayer[index] ?? 0));
    if (official > line.turnovers) {
      fail(
        'turnovers',
        `${line.instanceId} official turnover events ${String(official)} exceed line ${String(line.turnovers)}`,
      );
    }
    if (index === undefined) continue;
    if ((playerAssists[index] ?? 0) !== line.assists)
      fail('counts', `${line.instanceId} assists disagree with the tape`);
    if ((playerSteals[index] ?? 0) !== line.steals)
      fail('counts', `${line.instanceId} steals disagree with the tape`);
    if ((playerBlocks[index] ?? 0) !== line.blocks)
      fail('counts', `${line.instanceId} blocks disagree with the tape`);
    if ((playerFouls[index] ?? 0) !== line.fouls)
      fail('counts', `${line.instanceId} fouls disagree with the tape`);
    if ((playerRebounds[index] ?? 0) !== line.rebounds.total)
      fail('counts', `${line.instanceId} rebounds disagree with the tape`);
    if ((playerOreb[index] ?? 0) !== line.rebounds.offensive)
      fail('counts', `${line.instanceId} offensive rebounds disagree with the tape`);
    if ((playerDreb[index] ?? 0) !== line.rebounds.defensive)
      fail('counts', `${line.instanceId} defensive rebounds disagree with the tape`);
  }

  for (const [key, pending] of queued) {
    if (pending === 0) continue;
    const side = key >= participants.length ? 1 : 0;
    const ownerIndex = key - side * participants.length;
    fail(
      'extra-possessions',
      `unexpired extra possessions remain for ${side === 0 ? 'home' : 'away'}:${instance(ownerIndex)}`,
    );
  }
  for (const [key, granted] of grantCounts) {
    if ((queuedCounts.get(key) ?? 0) !== granted) {
      fail(
        'extra-possessions',
        `rebound loop grants ${String(granted)} != queued extra possessions ${String(queuedCounts.get(key) ?? 0)}`,
      );
    }
  }
}

function isScoringSource(value: string): value is HavocScoringSource {
  return SCORING_SOURCES.has(value);
}

function checkCourtTime(
  result: HavocBattleResult,
  gameSeconds: number,
  fail: (code: string, message: string) => void,
): void {
  for (const team of [result.home, result.away]) {
    let cloneSeconds = 0;
    let totalSeconds = 0;
    let nonCloneSeconds = 0;
    for (const line of team.participants) {
      if (line.secondsPlayed > gameSeconds) {
        fail('court-time', `${line.instanceId} played more than the game duration`);
      }
      totalSeconds += line.secondsPlayed;
      if (line.kind === 'clone') cloneSeconds += line.secondsPlayed;
      else nonCloneSeconds += line.secondsPlayed;
    }
    if (team.courtSeconds !== 5 * gameSeconds + cloneSeconds) {
      fail(
        'court-time',
        `${team.side} court seconds ${String(team.courtSeconds)} != 5*game + clone seconds (${String(5 * gameSeconds + cloneSeconds)})`,
      );
    }
    if (totalSeconds !== team.courtSeconds) {
      fail(
        'court-time',
        `${team.side} participant seconds ${String(totalSeconds)} != team court seconds`,
      );
    }
    if (nonCloneSeconds !== 5 * gameSeconds) {
      fail(
        'court-time',
        `${team.side} non-clone seconds ${String(nonCloneSeconds)} != 5*game seconds`,
      );
    }
  }
}
