import type { HavocBattleEvent, HavocBattleScoringEntry } from '@hoop-rush/data-contracts';
import {
  gamecastBattleAbilityLineOf,
  gamecastBattleAbilityNames,
  gamecastBattleFeedLineOf,
  gamecastBattleParticipantNames,
  gamecastBattlePlaybackItems,
  type GamecastBattleAbilityLine,
  type GamecastBattleFeedLine,
  type GamecastBattleOutput,
  type GamecastBattlePlaybackItem,
  type GamecastBattleVisibleState,
} from './gamecast-battle-playback';
import { GamecastBattleBoxFolder, type GamecastBattleSideBox } from './gamecast-battle-view';

export interface GamecastBattlePlaybackFrame {
  readonly visible: GamecastBattleVisibleState;
  readonly feed: readonly GamecastBattleFeedLine[];
  readonly boxes: readonly GamecastBattleSideBox[];
  readonly abilities: readonly GamecastBattleAbilityLine[];
  readonly abilityCount: number;
}

const ABILITY_LINE_LIMIT = 64;
const DEFAULT_PERIOD_SECONDS = 720;

/**
 * Append-only playback fold for recorded broadcasts. The cap-rush and havoc broadcasts tick at
 * 100ms; rebuilding the revealed prefix, feed, and boxes on every tick is quadratic work. Moving
 * forward only folds newly revealed items and keeps the ability feed bounded.
 */
export class GamecastBattlePlaybackStream {
  readonly items: readonly GamecastBattlePlaybackItem[];
  private readonly output: GamecastBattleOutput;
  private readonly names: ReadonlyMap<string, string>;
  private readonly abilitySource: ReturnType<typeof gamecastBattleAbilityNames>;
  private folder: GamecastBattleBoxFolder;
  private events: HavocBattleEvent[] = [];
  private scoring: HavocBattleScoringEntry[] = [];
  private feedLines: GamecastBattleFeedLine[] = [];
  private abilityLines: GamecastBattleAbilityLine[] = [];
  private abilityCount = 0;
  private homeScore = 0;
  private awayScore = 0;
  private period = 1;
  private clockSeconds = DEFAULT_PERIOD_SECONDS;
  private cursor = 0;

  constructor(output: GamecastBattleOutput) {
    this.output = output;
    this.items = gamecastBattlePlaybackItems(output.tape);
    this.names = gamecastBattleParticipantNames(output);
    this.abilitySource = gamecastBattleAbilityNames(output.result);
    this.folder = new GamecastBattleBoxFolder(output.result);
  }

  frame(visibleCount: number): GamecastBattlePlaybackFrame {
    const count = Number.isNaN(visibleCount)
      ? 0
      : Math.max(0, Math.min(this.items.length, Math.trunc(visibleCount)));
    if (count < this.cursor) this.reset();
    for (let index = this.cursor; index < count; index += 1) {
      const item = this.items[index];
      if (item !== undefined) this.apply(item);
    }
    this.cursor = count;
    return {
      visible: {
        homeScore: this.homeScore,
        awayScore: this.awayScore,
        period: this.period,
        clockSeconds: this.clockSeconds,
        events: [...this.events],
        scoring: [...this.scoring],
      },
      feed: [...this.feedLines],
      boxes: this.folder.boxes(this.output.result, {
        homeScore: this.homeScore,
        awayScore: this.awayScore,
      }),
      abilities: [...this.abilityLines],
      abilityCount: this.abilityCount,
    };
  }

  private apply(item: GamecastBattlePlaybackItem): void {
    this.period = item.period;
    this.clockSeconds = item.clockSeconds;
    if (item.event !== null) {
      this.events.push(item.event);
      this.folder.applyEvent(item.event);
      const line = gamecastBattleAbilityLineOf(item.event, this.abilitySource);
      if (line !== null) {
        this.abilityCount += 1;
        this.abilityLines.push(line);
        if (this.abilityLines.length > ABILITY_LINE_LIMIT) this.abilityLines.shift();
      }
    }
    if (item.scoring !== null) {
      this.scoring.push(item.scoring);
      this.folder.applyScoring(item.scoring);
      const line = gamecastBattleFeedLineOf(item, this.names);
      if (line !== null) this.feedLines.push(line);
      if (item.scoring.kind !== 'bonus') {
        if (item.scoring.side === 'home') this.homeScore += item.scoring.points;
        else this.awayScore += item.scoring.points;
      }
    }
  }

  private reset(): void {
    this.folder = new GamecastBattleBoxFolder(this.output.result);
    this.events = [];
    this.scoring = [];
    this.feedLines = [];
    this.abilityLines = [];
    this.abilityCount = 0;
    this.homeScore = 0;
    this.awayScore = 0;
    this.period = 1;
    this.clockSeconds = DEFAULT_PERIOD_SECONDS;
    this.cursor = 0;
  }
}
