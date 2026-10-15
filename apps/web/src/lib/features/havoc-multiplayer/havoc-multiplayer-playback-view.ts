import type {
  HavocBattleEvent,
  HavocBattleResult,
  HavocHomeAway,
  HavocParticipantLine,
  HavocParticipantKind,
  Position,
} from '@hoop-rush/data-contracts';
import type { HavocMultiplayerVisibleState } from './havoc-multiplayer-playback';

/**
 * Playback line derivation for Havoc broadcasts.
 *
 * The multiplayer room renders `HavocBattleResult`/`HavocBattleTape` output, which is a different
 * shape from the five-man `GamecastBroadcast` tape. These helpers fold the presenter's
 * `visible` playback state into per-instance box lines (starters, replacements, clones), keep team
 * bonuses separate, and preserve negative scoring totals. Nothing here depends on the room: the
 * same helpers can back the solo Havoc gamecast.
 */

export interface HavocMultiplayerParticipantLine {
  instanceId: string;
  sourcePlayerId?: string;
  displayName: string;
  kind: HavocParticipantKind;
  slot: Position;
  ownerInstanceId: string | null;
  points: number;
  adjustments: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
}

export interface HavocMultiplayerSideBox {
  side: HavocHomeAway;
  displayName: string;
  score: number;
  bonusPoints: number;
  lines: HavocMultiplayerParticipantLine[];
}

type ParticipantSource = Pick<
  HavocParticipantLine,
  'instanceId' | 'displayName' | 'kind' | 'slot' | 'ownerInstanceId'
> &
  Partial<Pick<HavocParticipantLine, 'sourcePlayerId'>>;

const SIDES: readonly HavocHomeAway[] = ['home', 'away'];

function blankLine(participant: ParticipantSource): HavocMultiplayerParticipantLine {
  return {
    instanceId: participant.instanceId,
    sourcePlayerId: participant.sourcePlayerId,
    displayName: participant.displayName,
    kind: participant.kind,
    slot: participant.slot,
    ownerInstanceId: participant.ownerInstanceId,
    points: 0,
    adjustments: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
  };
}

function fallbackLine(instanceId: string): HavocMultiplayerParticipantLine {
  return blankLine({
    instanceId,
    displayName: `Instance ${instanceId.slice(-4)}`,
    kind: 'starter',
    slot: 'PG',
    ownerInstanceId: null,
  });
}

function finalLine(participant: HavocParticipantLine): HavocMultiplayerParticipantLine {
  return {
    ...blankLine(participant),
    points: participant.points,
    adjustments: participant.adjustments,
    fieldGoalsMade: participant.fieldGoals.made,
    fieldGoalsAttempted: participant.fieldGoals.attempted,
    freeThrowsMade: participant.freeThrows.made,
    freeThrowsAttempted: participant.freeThrows.attempted,
    rebounds: participant.rebounds.total,
    assists: participant.assists,
    steals: participant.steals,
    blocks: participant.blocks,
    turnovers: participant.turnovers,
    fouls: participant.fouls,
  };
}

function eventSideOf(event: HavocBattleEvent): HavocHomeAway | null {
  switch (event.kind) {
    case 'shot-attempt':
    case 'free-throw-attempt':
    case 'rebound':
    case 'assist':
    case 'steal':
    case 'block':
    case 'turnover':
    case 'turnover-cancelled':
    case 'foul':
      return event.side;
    default:
      return null;
  }
}

function foldEventInto(
  resolve: (instanceId: string) => HavocMultiplayerParticipantLine,
  event: HavocBattleEvent,
): void {
  switch (event.kind) {
    case 'shot-attempt': {
      const line = resolve(event.shooterInstanceId);
      line.fieldGoalsAttempted += 1;
      if (event.made) line.fieldGoalsMade += 1;
      break;
    }
    case 'free-throw-attempt': {
      const line = resolve(event.shooterInstanceId);
      line.freeThrowsAttempted += 1;
      if (event.made) line.freeThrowsMade += 1;
      break;
    }
    case 'rebound':
      resolve(event.playerInstanceId).rebounds += 1;
      break;
    case 'assist':
      resolve(event.assisterInstanceId).assists += 1;
      break;
    case 'steal':
      resolve(event.stealerInstanceId).steals += 1;
      break;
    case 'block':
      resolve(event.blockerInstanceId).blocks += 1;
      break;
    case 'turnover':
      resolve(event.playerInstanceId).turnovers += 1;
      break;
    case 'turnover-cancelled': {
      const line = resolve(event.playerInstanceId);
      line.turnovers = Math.max(0, line.turnovers - 1);
      break;
    }
    case 'foul':
      resolve(event.foulerInstanceId).fouls += 1;
      break;
    default:
      break;
  }
}

/**
 * Box lines folded from the visible playback window. Scores include visible team bonuses so the
 * live score converges on the final result (`participant points + team bonus = team points`).
 */
export function havocMultiplayerLiveBoxes(
  result: Pick<HavocBattleResult, 'home' | 'away'>,
  visible: HavocMultiplayerVisibleState,
): HavocMultiplayerSideBox[] {
  const lines = new Map<HavocHomeAway, Map<string, HavocMultiplayerParticipantLine>>();
  const bonuses = new Map<HavocHomeAway, number>();
  for (const side of SIDES) {
    const sideLines = new Map<string, HavocMultiplayerParticipantLine>();
    for (const participant of result[side].participants) {
      sideLines.set(participant.instanceId, blankLine(participant));
    }
    lines.set(side, sideLines);
    bonuses.set(side, 0);
  }
  const resolve =
    (side: HavocHomeAway) =>
    (instanceId: string): HavocMultiplayerParticipantLine => {
      const sideLines = lines.get(side);
      if (!sideLines) return fallbackLine(instanceId);
      const existing = sideLines.get(instanceId);
      if (existing) return existing;
      const created = fallbackLine(instanceId);
      sideLines.set(instanceId, created);
      return created;
    };
  for (const event of visible.events) {
    const side = eventSideOf(event);
    if (side === null) continue;
    foldEventInto(resolve(side), event);
  }
  for (const entry of visible.scoring) {
    if (entry.kind === 'bonus') {
      bonuses.set(entry.side, (bonuses.get(entry.side) ?? 0) + entry.points);
      continue;
    }
    const line = resolve(entry.side)(entry.actorInstanceId);
    line.points += entry.points;
    if (entry.kind === 'adjustment') line.adjustments += entry.points;
  }
  return SIDES.map((side) => {
    const team = result[side];
    const visibleScore = side === 'home' ? visible.homeScore : visible.awayScore;
    const bonus = bonuses.get(side) ?? 0;
    return {
      side,
      displayName: team.displayName,
      score: visibleScore + bonus,
      bonusPoints: bonus,
      lines: [...(lines.get(side)?.values() ?? [])],
    };
  });
}

/** Final box lines copied from the completed result, including negative participant totals. */
export function havocMultiplayerFinalBoxes(
  result: Pick<HavocBattleResult, 'home' | 'away'>,
): HavocMultiplayerSideBox[] {
  return SIDES.map((side) => {
    const team = result[side];
    return {
      side,
      displayName: team.displayName,
      score: team.points,
      bonusPoints: team.teamBonusPoints,
      lines: team.participants.map((participant) => finalLine(participant)),
    };
  });
}
