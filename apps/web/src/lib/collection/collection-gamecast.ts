import type {
  CollectionGameEvent,
  CollectionGameRecordUnion,
  CollectionGameResultUnion,
  CollectionRewardReason,
} from '@hoop-rush/data-contracts';

export type WatchMode = 'fast' | 'standard' | 'slow';
export const STANDARD_EVENT_MS = 250;
export const SLOW_EVENT_MS = 650;

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

export function eventLabel(event: CollectionGameEvent): string {
  const score = `You ${String(event.homeScore)} · CPU ${String(event.awayScore)}`;
  switch (event.kind) {
    case 'possession':
      return `Q${String(event.period)} ${clockLabel(event.secondsRemaining)} — ${score}${event.pointsScored > 0 ? ` (+${String(event.pointsScored)})` : ''}`;
    case 'substitution':
      return `Q${String(event.period)} ${clockLabel(event.secondsRemaining)} — Substitution (${event.reason})`;
    case 'period-end':
      return `End of Q${String(event.period)} — ${score}`;
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
