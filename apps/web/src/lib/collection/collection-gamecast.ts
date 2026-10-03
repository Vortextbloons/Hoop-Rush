import type {
  CollectionGameEvent,
  CollectionGameRecordUnion,
  CollectionGameResultUnion,
  CollectionRewardReason,
} from '@hoop-rush/data-contracts';

export type WatchMode = 'fast' | 'standard' | 'slow';
export const STANDARD_EVENT_MS = 900;
export const SLOW_EVENT_MS = 1400;
export const QUICK_CAST_BEAT_MS = 800;

export function quickCastEvents(events: readonly CollectionGameEvent[]): CollectionGameEvent[] {
  const highlights: CollectionGameEvent[] = [];
  const periods = [...new Set(events.map((event) => event.period))];
  for (const period of periods) {
    const plays = events.filter((event) => event.period === period && event.kind === 'possession');
    const highlight =
      plays.findLast((event) => event.kind === 'possession' && event.pointsScored >= 3) ??
      plays.findLast((event) => event.kind === 'possession' && event.pointsScored > 0);
    if (highlight) highlights.push(highlight);
  }
  const final = events.findLast((event) => event.kind === 'final');
  const selected =
    highlights.length <= 4 ? highlights : [...highlights.slice(0, 2), ...highlights.slice(-2)];
  return final ? [...selected, final] : selected;
}

export function cadenceFor(mode: WatchMode): number | null {
  if (mode === 'fast') return null;
  return mode === 'standard' ? STANDARD_EVENT_MS : SLOW_EVENT_MS;
}

export function visibleEvents(
  events: readonly CollectionGameEvent[],
  mode: WatchMode,
): CollectionGameEvent[] {
  if (mode === 'slow') return [...events];
  if (mode === 'fast') return events.filter((event) => event.kind === 'final');
  return events.filter((event) => event.kind !== 'possession' || event.pointsScored > 0);
}

export function clockLabel(secondsRemaining: number): string {
  const clamped = Math.max(0, Math.floor(secondsRemaining));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

export function eventLabel(
  event: CollectionGameEvent,
  nameOf?: (cardId: string) => string,
): string {
  const score = `You ${String(event.homeScore)} · CPU ${String(event.awayScore)}`;
  const period = event.period > 4 ? `OT${String(event.period - 4)}` : `Q${String(event.period)}`;
  switch (event.kind) {
    case 'possession': {
      const scorer = event.statDeltas.find((delta) => delta.points > 0);
      const action =
        scorer && nameOf
          ? ` · ${nameOf(scorer.cardId)} +${String(scorer.points)}`
          : event.pointsScored > 0
            ? ` (+${String(event.pointsScored)})`
            : '';
      return `${period} ${clockLabel(event.secondsRemaining)} — ${score}${action}`;
    }
    case 'substitution':
      return `${period} ${clockLabel(event.secondsRemaining)} — ${nameOf ? `${nameOf(event.playerInCardId)} in · ${nameOf(event.playerOutCardId)} out` : 'Substitution'} (${event.reason})`;
    case 'period-end':
      return `End of ${period} — ${score}`;
    case 'final':
      return `Final — ${score}`;
  }
}

export interface GameExplanationFacts {
  winner: 'home' | 'away';
  homeScore: number;
  awayScore: number;
  overtimePeriods: number;
  rewardCoins: number;
  rewardReason: CollectionRewardReason;
  topHome: { cardId: string; points: number } | null;
  topAway: { cardId: string; points: number } | null;
  leadChanges: number;
  biggestLead: { side: 'home' | 'away' | 'tied'; points: number };
  exceptions: number;
}

function leaderOf(homeScore: number, awayScore: number): 'home' | 'away' | 'tied' {
  if (homeScore === awayScore) return 'tied';
  return homeScore > awayScore ? 'home' : 'away';
}

function rewardFactsOf(record: CollectionGameRecordUnion): {
  coins: number;
  reason: CollectionRewardReason;
} {
  if (record.gameVersion === 'collection-game-v1') {
    return { coins: record.reward.amount, reason: record.reward.reason };
  }
  const outcome = record.reward.components.find((component) => component.kind === 'outcome');
  return {
    coins: record.reward.total,
    reason: outcome?.reason ?? (record.reward.playerWin ? 'game-win-reward' : 'game-loss-reward'),
  };
}

export function explanationFacts(
  record: CollectionGameRecordUnion,
  events: readonly CollectionGameEvent[],
): GameExplanationFacts {
  const { result } = record;
  const reward = rewardFactsOf(record);
  if (result.outcome !== 'completed') {
    return {
      winner: result.winner,
      homeScore: result.winner === 'home' ? 2 : 0,
      awayScore: result.winner === 'home' ? 0 : 2,
      overtimePeriods: 0,
      rewardCoins: reward.coins,
      rewardReason: reward.reason,
      topHome: null,
      topAway: null,
      leadChanges: 0,
      biggestLead: { side: result.winner, points: 2 },
      exceptions: 0,
    };
  }
  const completed: Extract<CollectionGameResultUnion, { outcome: 'completed' }> = result;
  const topOf = (players: ReadonlyArray<{ cardId: string; points: number }>) => {
    let top: { cardId: string; points: number } | null = null;
    for (const player of players) {
      if (top === null || player.points > top.points) {
        top = { cardId: player.cardId, points: player.points };
      }
    }
    return top;
  };
  let leadChanges = 0;
  let biggestLead: GameExplanationFacts['biggestLead'] = { side: 'tied', points: 0 };
  let previous = leaderOf(0, 0);
  let seenLead = false;
  for (const event of events) {
    if (event.kind !== 'possession' && event.kind !== 'period-end') continue;
    const leader = leaderOf(event.homeScore, event.awayScore);
    if (seenLead && leader !== 'tied' && previous !== 'tied' && leader !== previous) {
      leadChanges += 1;
    }
    if (leader !== 'tied') seenLead = true;
    previous = leader;
    const margin = Math.abs(event.homeScore - event.awayScore);
    if (margin > biggestLead.points) {
      biggestLead = { side: leader === 'tied' ? 'tied' : leader, points: margin };
    }
  }
  return {
    winner: completed.winner,
    homeScore: completed.home.score,
    awayScore: completed.away.score,
    overtimePeriods: completed.overtimePeriods,
    rewardCoins: reward.coins,
    rewardReason: reward.reason,
    topHome: topOf(completed.home.players),
    topAway: topOf(completed.away.players),
    leadChanges,
    biggestLead,
    exceptions:
      completed.home.foulLimitExceptions.length + completed.away.foulLimitExceptions.length,
  };
}
