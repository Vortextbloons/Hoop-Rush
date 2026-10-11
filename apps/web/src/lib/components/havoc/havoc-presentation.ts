import type {
  HavocComparison,
  HavocDraftPick,
  HavocEvent,
  HavocGameResult,
  HavocHomeAway,
  HavocMutationEntry,
  HavocMutationId,
  HavocParticipantKind,
  HavocScoringEntry,
  HavocSide,
  HavocStatLine,
  HavocTier,
} from '@hoop-rush/data-contracts';
import type { HavocLineupSlotView, HavocRunView } from '$lib/havoc/havoc-service-contract';
import { HAVOC_GAME_COUNT, POSITIONS } from '@hoop-rush/data-contracts';
import { havocMutationDefinitionOf } from '@hoop-rush/engine';

export const HAVOC_TIER_COLORS: Record<HavocTier, string> = {
  1: '#37B7CC',
  2: '#E8AD38',
  3: '#B39AE8',
};

export function havocTierLabel(tier: HavocTier): string {
  return `Tier ${String(tier)}`;
}

export function havocRecordLabel(wins: number, losses: number): string {
  return `${String(wins)}–${String(losses)}`;
}

export function formatHavocClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

export function havocPeriodLabel(period: number): string {
  if (period <= 4) return `Q${String(period)}`;
  return `OT${String(period - 4)}`;
}

export function formatSignedPoints(points: number): string {
  return points > 0 ? `+${String(points)}` : String(points);
}

export function havocParticipantKindLabel(kind: HavocParticipantKind): string {
  if (kind === 'starter') return 'Starter';
  if (kind === 'replacement') return 'Replacement';
  return 'Clone';
}

export function mutationNameOf(mutationId: HavocMutationId): string {
  return havocMutationDefinitionOf(mutationId).name;
}

export function mutationDescriptionOf(mutationId: HavocMutationId): string {
  return havocMutationDefinitionOf(mutationId).description;
}

export function mutationDownsideOf(mutationId: HavocMutationId): string {
  return havocMutationDefinitionOf(mutationId).downside;
}

export function mutationTierOf(mutationId: HavocMutationId): HavocTier {
  return havocMutationDefinitionOf(mutationId).tier;
}

const HAVOC_SCORING_SOURCE_LABELS: Record<string, string> = {
  roulette: 'Basketball Roulette',
  'four-point-dunk': 'Four-Point Dunk',
  'reverse-basketball': 'Reverse Basketball',
  'golden-assist': 'Golden Assist',
  'double-or-nothing': 'Double or Nothing',
  'heat-check': 'Heat Check',
  'second-chance-jackpot': 'Second Chance Jackpot',
  'the-bounty': 'The Bounty',
};

export function havocScoringSourceLabel(source: string): string {
  return HAVOC_SCORING_SOURCE_LABELS[source] ?? source;
}

export interface HavocObjectiveStatus {
  tone: 'alive' | 'lost' | 'perfect' | 'finished';
  label: string;
  detail: string;
}

export function havocObjectiveStatusOf(run: HavocRunView): HavocObjectiveStatus {
  const gamesLeft = HAVOC_GAME_COUNT - run.havocCursor;
  if (gamesLeft <= 0) {
    if (run.perfectSeason) {
      return { tone: 'perfect', label: '82–0', detail: 'Perfect season. No losses.' };
    }
    return {
      tone: 'finished',
      label: havocRecordLabel(run.havocWins, run.havocLosses),
      detail: 'Season complete.',
    };
  }
  if (run.havocLosses === 0) {
    return {
      tone: 'alive',
      label: '82–0 alive',
      detail: `${String(gamesLeft)} games left and no losses yet.`,
    };
  }
  const losses = run.havocLosses === 1 ? '1 loss' : `${String(run.havocLosses)} losses`;
  return {
    tone: 'lost',
    label: '82–0 off the table',
    detail: `${losses} so far. The record is still the goal — keep playing.`,
  };
}

export function havocComparisonStatusLabel(status: HavocRunView['comparisonStatus']): string {
  if (status === 'not-started') return 'Not started';
  if (status === 'running') return 'In progress';
  if (status === 'complete') return 'Complete';
  return 'Unsupported for these versions';
}

export function havocCompletionStateLabel(state: HavocRunView['completionState']): string {
  if (state === 'draft') return 'Drafting';
  if (state === 'season') return 'Havoc season complete';
  if (state === 'comparison') return 'Normal season complete';
  if (state === 'complete') return 'Complete';
  return 'Abandoned';
}

export function lineupSlotsFromPicks(picks: readonly HavocDraftPick[]): HavocLineupSlotView[] {
  return picks.map((pick) => ({
    slot: pick.slot,
    displayName: pick.card.source.displayName,
    nickname: pick.card.nickname,
    playerVersionId: pick.card.source.playerVersionId,
    playerId: pick.card.source.playerId,
    franchiseId: pick.card.source.franchiseId,
    seasonKey: pick.card.source.seasonKey,
    tier: pick.card.tier,
    overall: pick.card.source.originalOverall,
    mutations: pick.card.mutations,
  }));
}

export interface HavocEventNameContext {
  playerName: (instanceId: string) => string;
  homeName: string;
  awayName: string;
  humanSide: HavocHomeAway;
}

function sideTeamNameOf(context: HavocEventNameContext, side: HavocSide): string {
  if (side === 'human') {
    return context.humanSide === 'home' ? context.homeName : context.awayName;
  }
  return context.humanSide === 'home' ? context.awayName : context.homeName;
}

export function havocEventMutationIdOf(event: HavocEvent): HavocMutationId | null {
  switch (event.kind) {
    case 'four-point-dunk':
      return 'four-point-dunk';
    case 'golden-assist':
      return 'golden-assist';
    case 'heat-check':
      return 'heat-check';
    case 'putback':
      return 'second-chance-jackpot';
    case 'and-one-bonus':
      return 'and-one-machine';
    case 'turnover-cancelled':
      return 'possession-refund';
    case 'possession-refund':
      return 'possession-refund';
    case 'rebound-loop':
      return 'rebound-loop';
    case 'bounty':
      return 'the-bounty';
    case 'foul-relief':
      return 'foul-thief';
    case 'roulette':
      return 'basketball-roulette';
    case 'clone':
      return 'clone-army';
    case 'time-lord':
      return 'time-lord';
    case 'body-snatcher':
      return 'body-snatcher';
    case 'great-equalizer':
      return 'the-great-equalizer';
    default:
      return null;
  }
}

export function havocEventTextOf(event: HavocEvent, context: HavocEventNameContext): string {
  const name = (instanceId: string): string => context.playerName(instanceId);
  switch (event.kind) {
    case 'period-start':
      return `Start of ${havocPeriodLabel(event.period)}`;
    case 'period-end':
      return `End of ${havocPeriodLabel(event.period)}: ${context.homeName} ${String(event.homeScore)}, ${context.awayName} ${String(event.awayScore)}`;
    case 'possession-start':
      return `${sideTeamNameOf(context, event.offenseSide)} possession ${String(event.possessionId)}`;
    case 'shot-attempt':
      return `${name(event.shooterInstanceId)} ${event.made ? 'makes' : 'misses'} a ${event.shotKind} (${String(event.nominalPoints)} pts)`;
    case 'free-throw-attempt':
      return `${name(event.shooterInstanceId)} ${event.made ? 'makes' : 'misses'} a free throw${event.bonus ? ' (bonus)' : ''}`;
    case 'rebound':
      return `${name(event.playerInstanceId)} ${event.offensive ? 'offensive' : 'defensive'} rebound`;
    case 'assist':
      return `${name(event.assisterInstanceId)} assists ${name(event.scorerInstanceId)}`;
    case 'steal':
      return `${name(event.stealerInstanceId)} steal`;
    case 'block':
      return `${name(event.blockerInstanceId)} blocks ${name(event.shooterInstanceId)}`;
    case 'turnover':
      return `${name(event.playerInstanceId)} turnover`;
    case 'turnover-cancelled':
      return `${name(event.playerInstanceId)} turnover cancelled (Possession Refund)`;
    case 'foul': {
      const shooter =
        event.shooterInstanceId === null ? '' : ` on ${name(event.shooterInstanceId)}`;
      const bonus =
        event.freeThrowsAwarded > 0 ? ` — ${String(event.freeThrowsAwarded)} free throws` : '';
      const technical = event.technicalFreeThrows > 0 ? ' — technical free throw' : '';
      return `${name(event.foulerInstanceId)} foul${shooter}${bonus}${technical}`;
    }
    case 'substitution':
      return `${name(event.outInstanceId)} leaves (${event.reason}) — ${name(event.inInstanceId)} enters`;
    case 'shot-clock-violation':
      return `${sideTeamNameOf(context, event.offenseSide)} shot-clock violation (${String(event.limitSeconds)}s)`;
    case 'extra-possession':
      return `Extra possession ${event.outcome} for ${name(event.ownerInstanceId)}`;
    case 'clone':
      return `Clone ${event.outcome} — ${name(event.cloneInstanceId)}${event.reason === null ? '' : ` (${event.reason})`}`;
    case 'time-lord':
      return `Time Lord: ${sideTeamNameOf(context, event.side)} full clock ${String(event.fullSeconds)}s, rebound clock ${String(event.reboundSeconds)}s (${event.source})`;
    case 'body-snatcher':
      return `Body Snatcher ${event.outcome}: ${name(event.ownerInstanceId)} takes ${name(event.targetInstanceId)}`;
    case 'great-equalizer':
      return `The Great Equalizer ${event.outcome} — ${String(event.cappedInstanceIds.length)} opponent${event.cappedInstanceIds.length === 1 ? '' : 's'} capped`;
    case 'four-point-dunk':
      return `${name(event.shooterInstanceId)} four-point dunk (+1)`;
    case 'golden-assist':
      return `${name(event.assisterInstanceId)} golden assist (+1)`;
    case 'heat-check':
      return `Heat Check ${event.outcome}`;
    case 'putback':
      return `Second Chance Jackpot ${event.outcome}`;
    case 'and-one-bonus':
      return `${name(event.shooterInstanceId)} and-one: +${String(event.bonusFreeThrows)} bonus free throw${event.bonusFreeThrows === 1 ? '' : 's'}`;
    case 'possession-refund':
      return `${name(event.ownerInstanceId)} possession refund — turnover cancelled`;
    case 'rebound-loop':
      return `${name(event.ownerInstanceId)} Rebound Loop #${String(event.reboundOrdinal)}: +${String(event.granted)} extra possession`;
    case 'bounty': {
      const blocked =
        event.blockedInstanceId === null ? '' : ` on ${name(event.blockedInstanceId)}`;
      return `The Bounty ${event.outcome}${blocked}`;
    }
    case 'foul-relief':
      return `${name(event.ownerInstanceId)} foul relief — charged fouls now ${String(event.chargedFoulsAfter)}`;
    case 'roulette':
      return `${name(event.ownerInstanceId)} Basketball Roulette #${String(event.attemptOrdinal)}: rolled ${String(event.rolled)} on a ${String(event.nominal)}-point attempt`;
    case 'game-end':
      return `Final: ${context.homeName} ${String(event.homeScore)}, ${context.awayName} ${String(event.awayScore)}`;
  }
}

export function havocScoringTextOf(
  entry: HavocScoringEntry,
  playerName: (instanceId: string) => string,
): string {
  const actor = playerName(entry.actorInstanceId);
  const parts: string[] = [];
  if (entry.kind !== 'adjustment') {
    parts.push(`${String(entry.nominalPoints)} nominal`);
  }
  const dunkAddends = entry.addends.filter((addend) => addend.source === 'four-point-dunk');
  for (const addend of entry.addends) {
    if (addend.source === 'four-point-dunk') continue;
    parts.push(`${havocScoringSourceLabel(addend.source)} ${formatSignedPoints(addend.points)}`);
  }
  for (const multiplier of entry.multipliers) {
    parts.push(`${havocScoringSourceLabel(multiplier.source)} ×2`);
  }
  for (const addend of dunkAddends) {
    parts.push(`${havocScoringSourceLabel(addend.source)} ${formatSignedPoints(addend.points)}`);
  }
  const label =
    entry.kind === 'field-goal'
      ? 'field goal'
      : entry.kind === 'free-throw'
        ? 'free throw'
        : 'adjustment';
  const detail = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  return `${actor} ${formatSignedPoints(entry.points)} pts — ${label}${detail}`;
}

export interface HavocPlayerSeasonLine {
  instanceId: string;
  displayName: string;
  kind: HavocParticipantKind;
  slot: string;
  sourcePlayerId: string;
  games: number;
  secondsPlayed: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  adjustments: number;
}

export interface HavocMutationSeasonLine {
  mutationId: HavocMutationId;
  triggers: number;
  pointsDelta: number;
  freeThrowsGranted: number;
  turnoversCancelled: number;
  extraPossessionsEarned: number;
  extraPossessionsUsed: number;
  extraPossessionsExpired: number;
}

export interface HavocSeasonStats {
  games: number;
  players: HavocPlayerSeasonLine[];
  mutations: HavocMutationSeasonLine[];
}

export function foldHavocSeasonStats(results: readonly HavocGameResult[]): HavocSeasonStats {
  const players = new Map<string, HavocPlayerSeasonLine>();
  const mutations = new Map<HavocMutationId, HavocMutationSeasonLine>();
  for (const result of results) {
    const human = result.humanSide === 'home' ? result.home : result.away;
    for (const participant of human.participants) {
      const existing = players.get(participant.instanceId);
      const line: HavocPlayerSeasonLine = existing ?? {
        instanceId: participant.instanceId,
        displayName: participant.displayName,
        kind: participant.kind,
        slot: participant.slot,
        sourcePlayerId: participant.sourcePlayerId,
        games: 0,
        secondsPlayed: 0,
        points: 0,
        rebounds: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
        adjustments: 0,
      };
      line.games += 1;
      line.secondsPlayed += participant.secondsPlayed;
      line.points += participant.points;
      line.rebounds += participant.rebounds.total;
      line.assists += participant.assists;
      line.steals += participant.steals;
      line.blocks += participant.blocks;
      line.turnovers += participant.turnovers;
      line.fouls += participant.fouls;
      line.adjustments += participant.adjustments;
      players.set(participant.instanceId, line);
    }
    for (const rollup of result.rollups) {
      const existing = mutations.get(rollup.mutationId);
      const line: HavocMutationSeasonLine = existing ?? {
        mutationId: rollup.mutationId,
        triggers: 0,
        pointsDelta: 0,
        freeThrowsGranted: 0,
        turnoversCancelled: 0,
        extraPossessionsEarned: 0,
        extraPossessionsUsed: 0,
        extraPossessionsExpired: 0,
      };
      line.triggers += rollup.triggers;
      line.pointsDelta += rollup.pointsDelta;
      line.freeThrowsGranted += rollup.freeThrowsGranted;
      line.turnoversCancelled += rollup.turnoversCancelled;
      line.extraPossessionsEarned += rollup.extraPossessionsEarned;
      line.extraPossessionsUsed += rollup.extraPossessionsUsed;
      line.extraPossessionsExpired += rollup.extraPossessionsExpired;
      mutations.set(rollup.mutationId, line);
    }
  }
  return {
    games: results.length,
    players: [...players.values()].sort((a, b) => b.points - a.points),
    mutations: [...mutations.values()].sort((a, b) => b.triggers - a.triggers),
  };
}

export function havocMvpFormulaLabel(weights: HavocComparison['mvpIndexWeights']): string {
  const term = (value: number, label: string, first: boolean): string => {
    if (first) return value < 0 ? `− ${String(-value)} × ${label}` : `${String(value)} × ${label}`;
    return value < 0 ? `− ${String(-value)} × ${label}` : `+ ${String(value)} × ${label}`;
  };
  return [
    term(weights.points, 'points', true),
    term(weights.rebounds, 'rebounds', false),
    term(weights.assists, 'assists', false),
    term(weights.steals, 'steals', false),
    term(weights.blocks, 'blocks', false),
    term(weights.turnovers, 'turnovers', false),
  ].join(' ');
}

export function statLineProductionIndex(line: HavocStatLine): number {
  return (
    10 * line.points +
    12 * line.rebounds.total +
    15 * line.assists +
    30 * line.steals +
    30 * line.blocks -
    10 * line.turnovers
  );
}

export function positionIndexLabel(slot: string): string {
  const index = POSITIONS.indexOf(slot as (typeof POSITIONS)[number]);
  return index >= 0 ? `Pick ${String(index + 1)}` : slot;
}

export function havocFieldLabel(field: string): string {
  const spaced = field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function mutationEntriesSummary(entries: readonly HavocMutationEntry[]): string {
  return entries.map((entry) => mutationNameOf(entry.mutationId)).join(', ');
}

export function havocDeltaTitle(winsGained: number): string {
  if (winsGained >= 20) return 'Game changers';
  if (winsGained >= 10) return 'Power surge';
  if (winsGained > 0) return 'Extra edge';
  if (winsGained == 0) return 'Even split';
  if (winsGained > -10) return 'Power tradeoff';
  if (winsGained > -20) return 'Backfire';
  return 'Havoc overload';
}
