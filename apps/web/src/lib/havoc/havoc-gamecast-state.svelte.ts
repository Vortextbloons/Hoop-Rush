import type {
  HavocEvent,
  HavocGameResult,
  HavocMutationId,
  HavocParticipantKind,
  HavocScoringEntry,
  HavocSide,
  Position,
} from '@hoop-rush/data-contracts';
import { POSITIONS } from '@hoop-rush/data-contracts';
import type { HavocService, HavocWatchSession } from './havoc-service-contract.ts';
import {
  formatHavocClock,
  havocEventMutationIdOf,
  havocEventTextOf,
  havocPeriodLabel,
  havocScoringTextOf,
} from '$lib/components/havoc/havoc-presentation';
import { HavocServiceError } from './havoc-service-contract.ts';

export type HavocPlaybackSpeed = 1 | 2 | 4 | 8;

export interface HavocGamecastParticipant {
  instanceId: string;
  displayName: string;
  kind: HavocParticipantKind;
  slot: Position;
  ownerInstanceId: string | null;
}

export interface HavocGamecastLine {
  instanceId: string;
  displayName: string;
  kind: HavocParticipantKind;
  slot: Position;
  points: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  rebounds: number;
  offensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
}

export interface HavocGamecastItem {
  key: string;
  kind: 'event' | 'scoring';
  period: number;
  clockSeconds: number;
  index: number;
  text: string;
  mutationId: HavocMutationId | null;
  side: HavocSide | null;
  pointsDelta: number;
  event: HavocEvent | null;
  scoring: HavocScoringEntry | null;
}

const BASE_INTERVAL_MS = 260;

function fallbackName(instanceId: string): string {
  return `Instance ${instanceId.slice(-4)}`;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export class HavocGamecastState {
  readonly session: HavocWatchSession;
  readonly result: HavocGameResult | null;
  items = $state.raw<HavocGamecastItem[]>([]);
  cursor = $state(0);
  playing = $state(false);
  speed = $state<HavocPlaybackSpeed>(1);
  accepted = $state(false);
  accepting = $state(false);
  error = $state<string | null>(null);
  announcement = $state('');

  private readonly service: HavocService;
  private readonly participants = new Map<string, HavocGamecastParticipant>();
  private readonly humanSide: 'home' | 'away';
  private readonly homeName: string;
  private readonly awayName: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  private isDestroyed(): boolean {
    return this.destroyed;
  }

  constructor(service: HavocService, session: HavocWatchSession, result: HavocGameResult | null) {
    this.service = service;
    this.session = session;
    this.result = result;
    this.humanSide = session.summary.humanSide;
    this.homeName = result?.home.displayName ?? 'Home';
    this.awayName = result?.away.displayName ?? 'Opponent';
    if (result !== null) {
      for (const participant of [...result.home.participants, ...result.away.participants]) {
        this.participants.set(participant.instanceId, {
          instanceId: participant.instanceId,
          displayName: participant.displayName,
          kind: participant.kind,
          slot: participant.slot,
          ownerInstanceId: participant.ownerInstanceId,
        });
      }
    }
    const context = {
      playerName: (instanceId: string) =>
        this.participants.get(instanceId)?.displayName ?? fallbackName(instanceId),
      homeName: this.homeName,
      awayName: this.awayName,
      humanSide: this.humanSide,
    };
    const items: HavocGamecastItem[] = [];
    session.tape.events.forEach((event, index) => {
      items.push({
        key: `event-${String(event.sequence)}`,
        kind: 'event',
        period: event.period,
        clockSeconds: event.clockSeconds,
        index,
        text: havocEventTextOf(event, context),
        mutationId: havocEventMutationIdOf(event),
        side: null,
        pointsDelta: 0,
        event,
        scoring: null,
      });
    });
    session.tape.scoring.forEach((entry, index) => {
      items.push({
        key: `scoring-${String(entry.sequence)}`,
        kind: 'scoring',
        period: entry.period,
        clockSeconds: entry.clockSeconds,
        index,
        text: havocScoringTextOf(entry, context.playerName),
        mutationId: null,
        side: entry.side,
        pointsDelta: entry.points,
        event: null,
        scoring: entry,
      });
    });
    items.sort(
      (a, b) =>
        a.period - b.period ||
        b.clockSeconds - a.clockSeconds ||
        (a.kind === b.kind ? a.index - b.index : a.kind === 'event' ? -1 : 1),
    );
    this.items = items;
    if (prefersReducedMotion()) this.speed = 4;
  }

  get humanName(): string {
    return this.humanSide === 'home' ? this.homeName : this.awayName;
  }

  get opponentName(): string {
    return this.humanSide === 'home' ? this.awayName : this.homeName;
  }

  get finished(): boolean {
    return this.cursor >= this.items.length;
  }

  get humanScore(): number {
    let total = 0;
    for (let index = 0; index < this.cursor; index += 1) {
      const item = this.items[index];
      if (item?.kind === 'scoring' && item.side === 'human') total += item.pointsDelta;
    }
    return total;
  }

  get opponentScore(): number {
    let total = 0;
    for (let index = 0; index < this.cursor; index += 1) {
      const item = this.items[index];
      if (item?.kind === 'scoring' && item.side === 'opponent') total += item.pointsDelta;
    }
    return total;
  }

  get period(): number {
    if (this.cursor === 0) return 1;
    return this.items[this.cursor - 1]?.period ?? 1;
  }

  get clockSeconds(): number {
    if (this.cursor === 0) return 720;
    return this.items[this.cursor - 1]?.clockSeconds ?? 720;
  }

  get clockLabel(): string {
    return `${havocPeriodLabel(this.period)} · ${formatHavocClock(this.clockSeconds)}`;
  }

  visibleItems(): HavocGamecastItem[] {
    return this.items.slice(0, this.cursor);
  }

  liveLines(): HavocGamecastLine[] {
    const lines = new Map<string, HavocGamecastLine>();
    const ensure = (instanceId: string): HavocGamecastLine => {
      const existing = lines.get(instanceId);
      if (existing !== undefined) return existing;
      const participant = this.participants.get(instanceId);
      const line: HavocGamecastLine = {
        instanceId,
        displayName: participant?.displayName ?? fallbackName(instanceId),
        kind: participant?.kind ?? 'starter',
        slot: participant?.slot ?? 'PG',
        points: 0,
        fieldGoalsMade: 0,
        fieldGoalsAttempted: 0,
        freeThrowsMade: 0,
        freeThrowsAttempted: 0,
        rebounds: 0,
        offensiveRebounds: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
      };
      lines.set(instanceId, line);
      return line;
    };
    for (const participant of this.participants.values()) ensure(participant.instanceId);
    for (let index = 0; index < this.cursor; index += 1) {
      const item = this.items[index];
      if (item === undefined) break;
      const event = item.event;
      if (event !== null) {
        switch (event.kind) {
          case 'shot-attempt': {
            const line = ensure(event.shooterInstanceId);
            line.fieldGoalsAttempted += 1;
            if (event.made) line.fieldGoalsMade += 1;
            break;
          }
          case 'free-throw-attempt': {
            const line = ensure(event.shooterInstanceId);
            line.freeThrowsAttempted += 1;
            if (event.made) line.freeThrowsMade += 1;
            break;
          }
          case 'rebound': {
            const line = ensure(event.playerInstanceId);
            line.rebounds += 1;
            if (event.offensive) line.offensiveRebounds += 1;
            break;
          }
          case 'assist':
            ensure(event.assisterInstanceId).assists += 1;
            break;
          case 'steal':
            ensure(event.stealerInstanceId).steals += 1;
            break;
          case 'block':
            ensure(event.blockerInstanceId).blocks += 1;
            break;
          case 'turnover':
            ensure(event.playerInstanceId).turnovers += 1;
            break;
          case 'turnover-cancelled': {
            const line = ensure(event.playerInstanceId);
            line.turnovers = Math.max(0, line.turnovers - 1);
            break;
          }
          case 'foul':
            ensure(event.foulerInstanceId).fouls += 1;
            break;
          default:
            break;
        }
      }
      const scoring = item.scoring;
      if (scoring !== null) {
        ensure(scoring.actorInstanceId).points += scoring.points;
      }
    }
    const kindRank = (kind: HavocParticipantKind): number =>
      kind === 'starter' ? 0 : kind === 'replacement' ? 1 : 2;
    return [...lines.values()].sort(
      (a, b) =>
        kindRank(a.kind) - kindRank(b.kind) ||
        POSITIONS.indexOf(a.slot) - POSITIONS.indexOf(b.slot) ||
        a.displayName.localeCompare(b.displayName),
    );
  }

  play(): void {
    if (this.playing || this.finished) return;
    this.playing = true;
    this.schedule();
  }

  pause(): void {
    this.playing = false;
    this.clearTimer();
  }

  setSpeed(speed: HavocPlaybackSpeed): void {
    this.speed = speed;
    if (this.playing) {
      this.clearTimer();
      this.schedule();
    }
  }

  advance(count = 1): void {
    if (count <= 0) return;
    this.cursor = Math.min(this.items.length, this.cursor + count);
    this.updateAnnouncement();
  }

  private schedule(): void {
    this.clearTimer();
    const interval = Math.max(40, Math.round(BASE_INTERVAL_MS / this.speed));
    this.timer = setInterval(() => {
      this.advance(1);
      if (this.finished) this.pause();
    }, interval);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private updateAnnouncement(): void {
    const last = this.items[this.cursor - 1];
    if (last === undefined) return;
    if (
      last.kind === 'scoring' ||
      last.event?.kind === 'period-end' ||
      last.event?.kind === 'game-end'
    ) {
      this.announcement = `${last.text}. ${this.humanName} ${String(this.humanScore)}, ${this.opponentName} ${String(this.opponentScore)}.`;
    }
  }

  async accept(): Promise<boolean> {
    if (this.accepted) return true;
    if (this.accepting) return false;
    this.accepting = true;
    this.error = null;
    try {
      const result = await this.service.acceptGame({
        gameNumber: this.session.gameNumber,
        variant: this.session.variant,
      });
      if (this.isDestroyed()) return false;
      if (result.status === 'rejected') {
        this.error = result.rejection?.message ?? 'The game was rejected.';
        return false;
      }
      this.accepted = true;
      return true;
    } catch (error) {
      if (!this.isDestroyed()) {
        this.error = error instanceof HavocServiceError ? error.message : String(error);
      }
      return false;
    } finally {
      this.accepting = false;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.pause();
  }
}
