import type {
  HavocBattleEvent,
  HavocBattleResult,
  HavocBattleScoringEntry,
  HavocHomeAway,
  HavocParticipantLine,
  HavocParticipantKind,
  Position,
} from '@hoop-rush/data-contracts';
import type { GamecastBattleVisibleState } from './gamecast-battle-playback';

/**
 * Playback line derivation for neutral home/away battle broadcasts.
 *
 * Havoc multiplayer and Cap Rush render `HavocBattleResult`/`HavocBattleTape` output, which is a
 * different shape from the five-man `GamecastBroadcast` tape. These helpers fold the visible
 * playback state into per-instance box lines (starters, replacements, clones), keep team bonuses
 * separate, and preserve negative scoring totals. Nothing here depends on the room or mode.
 */

export interface GamecastBattleParticipantLine {
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

export interface GamecastBattleSideBox {
  side: HavocHomeAway;
  displayName: string;
  score: number;
  bonusPoints: number;
  lines: GamecastBattleParticipantLine[];
}

type ParticipantSource = Pick<
  HavocParticipantLine,
  'instanceId' | 'displayName' | 'kind' | 'slot' | 'ownerInstanceId'
> &
  Partial<Pick<HavocParticipantLine, 'sourcePlayerId'>>;

const SIDES: readonly HavocHomeAway[] = ['home', 'away'];

function blankLine(participant: ParticipantSource): GamecastBattleParticipantLine {
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

function fallbackLine(instanceId: string): GamecastBattleParticipantLine {
  return blankLine({
    instanceId,
    displayName: `Instance ${instanceId.slice(-4)}`,
    kind: 'starter',
    slot: 'PG',
    ownerInstanceId: null,
  });
}

function finalLine(participant: HavocParticipantLine): GamecastBattleParticipantLine {
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
  resolve: (instanceId: string) => GamecastBattleParticipantLine,
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
 * Incremental live-box fold interface shared by both playback paths.
 */
export interface GamecastBattleLiveBoxFold {
  boxesAt(visible: GamecastBattleVisibleState): GamecastBattleSideBox[];
}

type SideResolver = (instanceId: string) => GamecastBattleParticipantLine;

/**
 * One fold over a battle's events and scoring.
 *
 * Recorded broadcasts reveal items in order, so the folder keeps its line maps
 * and folds only newly appended entries. The streaming path pushes individual
 * events and scoring entries as its cursor advances. Both share this core, so
 * the live boxes agree no matter which path produced the visible window.
 */
class BattleBoxLines {
  private readonly lines = new Map<HavocHomeAway, Map<string, GamecastBattleParticipantLine>>();
  private bonuses = new Map<HavocHomeAway, number>();

  constructor(result: Pick<HavocBattleResult, 'home' | 'away'>) {
    for (const side of SIDES) {
      const sideLines = new Map<string, GamecastBattleParticipantLine>();
      for (const participant of result[side].participants) {
        sideLines.set(participant.instanceId, blankLine(participant));
      }
      this.lines.set(side, sideLines);
      this.bonuses.set(side, 0);
    }
  }

  clear(result: Pick<HavocBattleResult, 'home' | 'away'>): void {
    for (const side of SIDES) {
      const sideLines = this.lines.get(side);
      if (sideLines === undefined) continue;
      sideLines.clear();
      for (const participant of result[side].participants) {
        sideLines.set(participant.instanceId, blankLine(participant));
      }
    }
    this.bonuses = new Map();
  }

  private resolve: (side: HavocHomeAway) => SideResolver = (side) => (instanceId) => {
    const sideLines = this.lines.get(side);
    if (!sideLines) return fallbackLine(instanceId);
    const existing = sideLines.get(instanceId);
    if (existing) return existing;
    const created = fallbackLine(instanceId);
    sideLines.set(instanceId, created);
    return created;
  };

  applyEvent(event: HavocBattleEvent): void {
    const side = eventSideOf(event);
    if (side === null) return;
    foldEventInto(this.resolve(side), event);
  }

  applyScoring(entry: HavocBattleScoringEntry): void {
    if (entry.kind === 'bonus') {
      this.bonuses.set(entry.side, (this.bonuses.get(entry.side) ?? 0) + entry.points);
      return;
    }
    const line = this.resolve(entry.side)(entry.actorInstanceId);
    line.points += entry.points;
    line.adjustments += entry.points - entry.nominalPoints;
  }

  boxes(
    result: Pick<HavocBattleResult, 'home' | 'away'>,
    visible: Pick<GamecastBattleVisibleState, 'homeScore' | 'awayScore'>,
  ): GamecastBattleSideBox[] {
    return SIDES.map((side) => {
      const team = result[side];
      const visibleScore = side === 'home' ? visible.homeScore : visible.awayScore;
      const bonus = this.bonuses.get(side) ?? 0;
      return {
        side,
        displayName: team.displayName,
        score: visibleScore + bonus,
        bonusPoints: bonus,
        lines: [...(this.lines.get(side)?.values() ?? [])].map((line) => ({ ...line })),
      };
    });
  }
}

/**
 * Incremental live-box fold over a visible window.
 *
 * The visible state exposes its events and scoring as arrays the playback fold
 * grows in place, so each frame can fold only the newly revealed entries. A
 * backward seek rebuilds those arrays, which the identity check below treats as
 * a reset; the result stays identical to folding the whole window from zero.
 */
class LiveBoxFolder implements GamecastBattleLiveBoxFold {
  private readonly result: Pick<HavocBattleResult, 'home' | 'away'>;
  private readonly lines: BattleBoxLines;
  private eventsRef: readonly HavocBattleEvent[] | null = null;
  private scoringRef: readonly HavocBattleScoringEntry[] | null = null;
  private foldedEvents = 0;
  private foldedScoring = 0;

  constructor(result: Pick<HavocBattleResult, 'home' | 'away'>) {
    this.result = result;
    this.lines = new BattleBoxLines(result);
  }

  private reset(): void {
    this.lines.clear(this.result);
    this.foldedEvents = 0;
    this.foldedScoring = 0;
  }

  boxesAt(visible: GamecastBattleVisibleState): GamecastBattleSideBox[] {
    if (this.eventsRef !== visible.events || this.scoringRef !== visible.scoring) {
      this.reset();
      this.eventsRef = visible.events;
      this.scoringRef = visible.scoring;
    }
    for (let index = this.foldedEvents; index < visible.events.length; index += 1) {
      const event = visible.events[index];
      if (event === undefined) continue;
      this.lines.applyEvent(event);
    }
    this.foldedEvents = visible.events.length;
    for (let index = this.foldedScoring; index < visible.scoring.length; index += 1) {
      const entry = visible.scoring[index];
      if (entry === undefined) continue;
      this.lines.applyScoring(entry);
    }
    this.foldedScoring = visible.scoring.length;
    return this.lines.boxes(this.result, visible);
  }
}

/**
 * Stateful box folder for the append-only playback stream: push newly revealed
 * events and scoring entries, then read the boxes for the visible scores.
 */
export class GamecastBattleBoxFolder {
  private readonly result: Pick<HavocBattleResult, 'home' | 'away'>;
  private readonly lines: BattleBoxLines;

  constructor(result: Pick<HavocBattleResult, 'home' | 'away'>) {
    this.result = result;
    this.lines = new BattleBoxLines(result);
  }

  applyEvent(event: HavocBattleEvent): void {
    this.lines.applyEvent(event);
  }

  applyScoring(entry: HavocBattleScoringEntry): void {
    this.lines.applyScoring(entry);
  }

  boxes(
    visible: Pick<GamecastBattleVisibleState, 'homeScore' | 'awayScore'>,
  ): GamecastBattleSideBox[] {
    return this.lines.boxes(this.result, visible);
  }
}

/** Box lines folded from the visible playback window. */
export function gamecastBattleLiveBoxes(
  result: Pick<HavocBattleResult, 'home' | 'away'>,
  visible: GamecastBattleVisibleState,
): GamecastBattleSideBox[] {
  return gamecastBattleLiveBoxFold(result).boxesAt(visible);
}

/**
 * Create a resettable fold cursor for live boxes. Reuse one per broadcast so
 * each frame processes only newly revealed playback items.
 */
export function gamecastBattleLiveBoxFold(
  result: Pick<HavocBattleResult, 'home' | 'away'>,
): GamecastBattleLiveBoxFold {
  return new LiveBoxFolder(result);
}

/** Final box lines copied from the completed result, including negative participant totals. */
export function gamecastBattleFinalBoxes(
  result: Pick<HavocBattleResult, 'home' | 'away'>,
): GamecastBattleSideBox[] {
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
