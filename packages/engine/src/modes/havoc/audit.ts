import type {
  HavocAuditFinding,
  HavocGameAudit,
  HavocGameInput,
  HavocGameResult,
  HavocGameTape,
  HavocParticipantKind,
  HavocScoringSource,
  HavocSide,
  HavocTeamResult,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_PERSONAL_FOUL_LIMIT,
  havocGameResultSchema,
  havocScoringSourceSchema,
} from '@hoop-rush/data-contracts';
import { OVERTIME_PERIOD_SECONDS, REGULATION_PERIOD_SECONDS } from '../../sim/clock.ts';
import type { SideIndex } from '../../sim/recorder.ts';
import {
  havocGameInputDigest,
  havocGameResultDigest,
  havocGameSummaryOf,
  havocGameTapeDigest,
} from './digests.ts';
import { HAVOC_SCORING_SOURCE_MUTATION } from './game.ts';

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

export function auditHavocGame(
  input: HavocGameInput,
  result: HavocGameResult,
  tape?: HavocGameTape,
): HavocGameAudit {
  const findings: HavocAuditFinding[] = [];
  const fail = (code: string, message: string): void => {
    if (findings.length < 200) findings.push({ code, message: message.slice(0, 512) });
  };

  const parsed = havocGameResultSchema.safeParse(result);
  if (!parsed.success) {
    fail(
      'result-schema',
      `result does not satisfy havocGameResultSchema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
    return { ok: false, findings };
  }
  if (result.gameNumber !== input.gameNumber)
    fail('input-identity', 'result game number differs from input');
  if (result.variant !== input.variant) fail('input-identity', 'result variant differs from input');
  if (result.seed !== input.seed) fail('input-identity', 'result seed differs from input');
  if (result.humanSide !== input.humanSide)
    fail('input-identity', 'result human side differs from input');
  if (result.home.teamId !== input.home.teamId || result.away.teamId !== input.away.teamId) {
    fail('input-identity', 'result team ids differ from input');
  }
  if (
    result.home.displayName !== input.home.displayName ||
    result.away.displayName !== input.away.displayName
  ) {
    fail('input-identity', 'result team display names differ from input');
  }
  if (result.inputDigest !== havocGameInputDigest(input)) {
    fail('input-digest', 'result input digest does not match the supplied input');
  }
  if (result.winner !== (result.home.points > result.away.points ? 'home' : 'away')) {
    fail('winner', 'result winner disagrees with the scoreline');
  }

  const participants = new Map<string, AuditParticipant>();
  const addTeamParticipants = (
    team: HavocTeamResult,
    sideIndex: SideIndex,
    source: HavocGameInput['home'],
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

  if (tape !== undefined) {
    if (tape.gameNumber !== input.gameNumber)
      fail('tape-identity', 'tape game number differs from input');
    if (tape.variant !== input.variant) fail('tape-identity', 'tape variant differs from input');
    if (tape.seed !== input.seed) fail('tape-identity', 'tape seed differs from input');
    if (havocGameTapeDigest(tape).length !== 32)
      fail('tape-digest', 'tape digest is not a 32-hex value');
    checkTape(tape, result, input, participants, fail);
    const summary = havocGameSummaryOf(result, havocGameResultDigest(result));
    if (summary.resultDigest !== havocGameResultDigest(result)) {
      fail('summary', 'summary result digest does not round-trip');
    }
    if (summary.inputDigest !== result.inputDigest)
      fail('summary', 'summary input digest mismatch');
    const human = result.humanSide === 'home' ? result.home : result.away;
    if (
      summary.humanScore !== human.points ||
      summary.periods.human.length !== human.periods.length
    ) {
      fail('summary', 'summary human line disagrees with the result');
    }
  }

  return { ok: findings.length === 0, findings };
}

function checkResultInternals(
  result: HavocGameResult,
  fail: (code: string, message: string) => void,
): void {
  for (const team of [result.home, result.away]) {
    const periodSum = team.periods.reduce((sum, points) => sum + points, 0);
    if (periodSum !== team.points) {
      fail(
        'period-ledger',
        `${team.side} period totals ${periodSum} != team points ${team.points}`,
      );
    }
    const participantPoints = team.participants.reduce((sum, line) => sum + line.points, 0);
    if (participantPoints !== team.points) {
      fail(
        'points-ledger',
        `${team.side} participant points ${participantPoints} != team points ${team.points}`,
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
  tape: HavocGameTape,
  result: HavocGameResult,
  input: HavocGameInput,
  participants: ReadonlyMap<string, AuditParticipant>,
  fail: (code: string, message: string) => void,
): void {
  const sideIndexBySide = new Map<HavocSide, SideIndex>([
    [input.home.side, 0],
    [input.away.side, 1],
  ]);
  const sidePoints: [number, number] = [0, 0];
  const periodPoints: [number[], number[]] = [
    Array.from({ length: result.home.periods.length }, () => 0),
    Array.from({ length: result.home.periods.length }, () => 0),
  ];
  const actorPoints = new Map<string, number>();
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
    if (sideIndex === undefined || actor.sideIndex !== sideIndex) {
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
    for (const addend of entry.addends) {
      if (!isScoringSource(addend.source))
        fail('scoring-entry', `unknown scoring source ${addend.source}`);
      points += addend.points;
    }
    for (const multiplier of entry.multipliers) {
      if (!isScoringSource(multiplier.source))
        fail('scoring-entry', `unknown scoring source ${multiplier.source}`);
      points *= multiplier.factor;
    }
    if (points !== entry.points) {
      fail(
        'points-ledger',
        `scoring entry ${entry.sequence} points ${entry.points} != resolved ${points}`,
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
          `owner ${ownerId} does not own any scoring source on entry ${entry.sequence}`,
        );
      }
      if (owner.sideIndex !== sideIndex)
        fail('scoring-entry', `owner ${ownerId} is not on the scoring side`);
    }
    if (sources.length > 0 && entry.owners.length === 0) {
      fail('scoring-entry', `scoring entry ${entry.sequence} has no owners for its sources`);
    }
    sidePoints[sideIndex ?? 0] += entry.points;
    const bucket = periodPoints[sideIndex ?? 0];
    const periodIndex = entry.period - 1;
    if (periodIndex >= 0 && periodIndex < bucket.length) {
      bucket[periodIndex] = (bucket[periodIndex] ?? 0) + entry.points;
    } else {
      fail('period-ledger', `scoring entry ${entry.sequence} period out of range`);
    }
    actorPoints.set(
      entry.actorInstanceId,
      (actorPoints.get(entry.actorInstanceId) ?? 0) + entry.points,
    );
  }
  for (const side of [0, 1] as const) {
    const team = side === 0 ? result.home : result.away;
    if (sidePoints[side] !== team.points) {
      fail(
        'points-ledger',
        `${team.side} ledger points ${sidePoints[side]} != result ${team.points}`,
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
      fail('points-ledger', `${line.instanceId} ledger points ${points} != line ${line.points}`);
    }
  }

  // ---- counting statistics and actor eligibility ---------------------------
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
  const possessionOffense = new Map<number, HavocSide>();
  for (const event of tape.events) {
    if (event.kind === 'possession-start') {
      possessionOffense.set(event.possessionId, event.offenseSide);
    }
  }
  const queued = new Map<string, number>();
  const cloneEntered = new Set<string>();
  const cloneExited = new Set<string>();
  const grantCounts = new Map<string, number>();
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
        break;
      }
      case 'turnover-cancelled': {
        if (!turnedOver.has(event.originalSequence)) {
          fail('turnovers', 'turnover cancellation references no recorded turnover');
        }
        cancelled.add(event.originalSequence);
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
        break;
      }
      case 'extra-possession': {
        const key = `${event.side}:${event.ownerInstanceId}`;
        if (event.outcome === 'queued') {
          queued.set(key, (queued.get(key) ?? 0) + 1);
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
        const hasOwner = [...participants.values()].some((participant) =>
          participant.mutations.has('time-lord'),
        );
        if (!hasOwner) fail('time-lord', 'time-lord event without an owner anywhere');
        if (event.fullSeconds !== 30 && event.fullSeconds !== 12 && event.fullSeconds !== 24) {
          fail('time-lord', 'unexpected time-lord full clock');
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
      default:
        break;
    }
  }

  // foul replays against the final lines
  for (const [instanceId, state] of foulReplay) {
    const line = findLine(result, instanceId);
    if (line === undefined) continue;
    if (line.fouls !== state.committed) {
      fail('fouls', `${instanceId} committed fouls ${state.committed} != line ${line.fouls}`);
    }
    if (line.chargedFouls !== state.charged) {
      fail('fouls', `${instanceId} charged fouls ${state.charged} != line ${line.chargedFouls}`);
    }
  }
  for (const line of [...result.home.participants, ...result.away.participants]) {
    if (!foulReplay.has(line.instanceId) && line.fouls !== 0) {
      fail('fouls', `${line.instanceId} has recorded fouls but no foul events`);
    }
  }

  // counting reconciliations
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
    const officialTurnovers = tape.events.filter(
      (event) =>
        event.kind === 'turnover' &&
        sideIndexBySide.get(event.side) === side &&
        !cancelled.has(event.sequence),
    ).length;
    const violations = tape.events.filter(
      (event) =>
        event.kind === 'shot-clock-violation' && sideIndexBySide.get(event.offenseSide) === side,
    ).length;
    if (officialTurnovers + violations !== team.turnovers) {
      fail(
        'turnovers',
        `${team.side} official turnovers ${officialTurnovers} + clock violations ${violations} != result ${team.turnovers}`,
      );
    }
  }
  for (const line of [...result.home.participants, ...result.away.participants]) {
    const canceledForPlayer = tape.events.filter(
      (event) =>
        event.kind === 'turnover' &&
        event.playerInstanceId === line.instanceId &&
        cancelled.has(event.sequence),
    ).length;
    const official = (counts.get(`${line.instanceId}:turnovers`) ?? 0) - canceledForPlayer;
    if (official > line.turnovers) {
      fail(
        'turnovers',
        `${line.instanceId} official turnover events ${official} exceed line ${line.turnovers}`,
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
  for (const [key] of grantCounts) {
    if ((queued.get(key) ?? 0) < 0) fail('extra-possessions', `negative queue for ${key}`);
  }
}

function findLine(
  result: HavocGameResult,
  instanceId: string,
): HavocGameResult['home']['participants'][number] | undefined {
  for (const line of [...result.home.participants, ...result.away.participants]) {
    if (line.instanceId === instanceId) return line;
  }
  return undefined;
}

function isScoringSource(value: string): value is HavocScoringSource {
  return SCORING_SOURCES.has(value);
}

function checkCourtTime(
  result: HavocGameResult,
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
        `${team.side} court seconds ${team.courtSeconds} != 5*game + clone seconds (${5 * gameSeconds + cloneSeconds})`,
      );
    }
    if (totalSeconds !== team.courtSeconds) {
      fail('court-time', `${team.side} participant seconds ${totalSeconds} != team court seconds`);
    }
    if (nonCloneSeconds !== 5 * gameSeconds) {
      fail('court-time', `${team.side} non-clone seconds ${nonCloneSeconds} != 5*game seconds`);
    }
  }
}
