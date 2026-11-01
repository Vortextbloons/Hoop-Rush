import type {
  HavocBattleEvent,
  HavocBattleMutationRollup,
  HavocBattleScoringEntry,
  HavocHighlight,
  HavocMutationId,
} from '@hoop-rush/data-contracts';
import { type SideIndex } from '../../../sim/recorder.ts';
import type { HavocParticipants } from './battle-participants.ts';
import type {
  Attribution,
  HavocBattleEventPayload,
  HavocBattleScoringPayload,
  ParticipantState,
  RollupCounters,
  TeamRuntime,
} from './battle-runtime-types.ts';
import { HAVOC_SCORING_SOURCE_MUTATION } from './battle-scoring.ts';
const HAVOC_HIGHLIGHT_LIMIT = 16;
export function zeroRollup(): RollupCounters {
  return {
    triggers: 0,
    pointsDelta: 0,
    freeThrowsGranted: 0,
    turnoversCancelled: 0,
    extraPossessionsEarned: 0,
    extraPossessionsUsed: 0,
    extraPossessionsExpired: 0,
    swapPoints: 0,
    ratingChanges: 0,
  };
}
interface LedgerOptions {
  period(): number;
  possessionId(): number;
  clock(): number;
}
export class HavocMutationLedger {
  readonly events: HavocBattleEvent[] = [];
  readonly scoring: HavocBattleScoringEntry[] = [];
  private eventSeq = 0;
  private scoreSeq = 0;
  private readonly gameNumber: number;
  private readonly participants: HavocParticipants;
  private readonly options: LedgerOptions;
  constructor(gameNumber: number, participants: HavocParticipants, options: LedgerOptions) {
    this.gameNumber = gameNumber;
    this.participants = participants;
    this.options = options;
  }
  private get teams(): [TeamRuntime, TeamRuntime] {
    return this.participants.teams;
  }
  private get period(): number {
    return this.options.period();
  }
  private get possessionId(): number {
    return this.options.possessionId();
  }
  rollupFor(
    participant: ParticipantState,
    mutationId: HavocMutationId,
  ): RollupCounters | undefined {
    let counters = participant.rollup.get(mutationId);
    if (counters === undefined && participant.mutations.has(mutationId)) {
      counters = zeroRollup();
      participant.rollup.set(mutationId, counters);
    }
    return counters;
  }
  attribute(attributions: readonly Attribution[]): void {
    for (const attribution of attributions) {
      const counters = this.rollupFor(
        attribution.owner,
        HAVOC_SCORING_SOURCE_MUTATION[attribution.mutationId],
      );
      if (counters === undefined) continue;
      counters.pointsDelta += attribution.points;
    }
  }
  pushEvent(event: HavocBattleEventPayload): number {
    const full = {
      sequence: this.eventSeq,
      gameNumber: this.gameNumber,
      period: this.period,
      clockSeconds: this.options.clock(),
      ...event,
    };
    this.events.push(full);
    const sequence = this.eventSeq;
    this.eventSeq += 1;
    return sequence;
  }
  pushScoring(entry: HavocBattleScoringPayload): number {
    const full: HavocBattleScoringEntry = {
      sequence: this.scoreSeq,
      gameNumber: this.gameNumber,
      period: this.period,
      clockSeconds: this.options.clock(),
      possessionId: this.possessionId,
      ...entry,
    };
    this.scoring.push(full);
    const sequence = this.scoreSeq;
    this.scoreSeq += 1;
    const scorer = this.participants.globalById(full.actorInstanceId);
    if (
      scorer !== null &&
      scorer.swapWith !== null &&
      (full.kind === 'field-goal' || full.kind === 'free-throw')
    ) {
      const counters = this.rollupFor(scorer, 'body-snatcher');
      if (counters !== undefined) counters.swapPoints += full.points;
    }
    return sequence;
  }
  rollupsOf(): HavocBattleMutationRollup[] {
    const rollups: HavocBattleMutationRollup[] = [];
    for (const team of this.teams) {
      for (const participant of team.participants) {
        if (participant.mutations.size === 0) continue;
        const activeSeconds = Math.round(participant.activeSeconds);
        for (const mutationId of participant.mutations) {
          const counters = participant.rollup.get(mutationId) ?? zeroRollup();
          rollups.push({
            ownerInstanceId: participant.instanceId,
            mutationId,
            side: team.side,
            triggers: counters.triggers,
            pointsDelta: counters.pointsDelta,
            freeThrowsGranted: counters.freeThrowsGranted,
            turnoversCancelled: counters.turnoversCancelled,
            extraPossessionsEarned: counters.extraPossessionsEarned,
            extraPossessionsUsed: counters.extraPossessionsUsed,
            extraPossessionsExpired: counters.extraPossessionsExpired,
            swapPoints: counters.swapPoints,
            swapSeconds:
              mutationId === 'body-snatcher' || mutationId === 'fusion-dance' ? activeSeconds : 0,
            capSeconds: mutationId === 'the-great-equalizer' ? activeSeconds : 0,
            activeSeconds,
            ratingChanges: counters.ratingChanges,
          });
        }
      }
    }
    return rollups.slice(0, 40);
  }
  highlightsOf(overtimePeriods: number): HavocHighlight[] {
    const highlights: HavocHighlight[] = [];
    for (const entry of this.scoring) {
      if (highlights.length >= HAVOC_HIGHLIGHT_LIMIT) break;
      if (entry.addends.length === 0 && entry.multipliers.length === 0) continue;
      const source = entry.addends[0]?.source ?? entry.multipliers[0]?.source;
      if (source === undefined) continue;
      highlights.push({
        kind: 'mutation',
        period: entry.period,
        clockSeconds: entry.clockSeconds,
        instanceId: entry.actorInstanceId,
        mutationId: HAVOC_SCORING_SOURCE_MUTATION[source],
        pointsDelta: entry.points - entry.nominalPoints,
      });
    }
    for (const team of this.teams) {
      for (const participant of team.participants) {
        if (highlights.length >= HAVOC_HIGHLIGHT_LIMIT) break;
        if (
          (participant.kind === 'starter' && participant.replaced) ||
          (participant.kind === 'clone' && participant.cloneExited)
        ) {
          highlights.push({
            kind: 'foul-out',
            period: this.period,
            clockSeconds: 0,
            instanceId: participant.instanceId,
            mutationId: null,
            pointsDelta: 0,
          });
        }
      }
    }
    const periodTotals = this.periodTotals();
    for (const side of [0, 1] as const) {
      if (highlights.length >= HAVOC_HIGHLIGHT_LIMIT) break;
      const negativeIndex = periodTotals[side].findIndex((points) => points < 0);
      if (negativeIndex >= 0) {
        highlights.push({
          kind: 'negative-score',
          period: negativeIndex + 1,
          clockSeconds: 0,
          instanceId: null,
          mutationId: null,
          pointsDelta: periodTotals[side][negativeIndex] ?? 0,
        });
      }
    }
    void overtimePeriods;
    return highlights.slice(0, HAVOC_HIGHLIGHT_LIMIT);
  }
  periodTotals(): [number[], number[]] {
    const totals: [number[], number[]] = [
      Array.from({ length: this.period }, () => 0),
      Array.from({ length: this.period }, () => 0),
    ];
    for (const entry of this.scoring) {
      const index = entry.period - 1;
      const side = entry.side === this.teams[0].side ? 0 : 1;
      totals[side][index] = (totals[side][index] ?? 0) + entry.points;
    }
    return totals;
  }
  sidePoints(side: SideIndex): number {
    const target = this.teams[side].side;
    let points = 0;
    for (const entry of this.scoring) {
      if (entry.side === target) points += entry.points;
    }
    return points;
  }
  participantPoints(instanceId: string): number {
    let points = 0;
    for (const entry of this.scoring) {
      if (entry.actorInstanceId === instanceId && entry.kind !== 'bonus') points += entry.points;
    }
    return points;
  }
  teamBonusPoints(sideIndex: SideIndex): number {
    const side = this.teams[sideIndex].side;
    let points = 0;
    for (const entry of this.scoring) {
      if (entry.side === side && entry.kind === 'bonus') points += entry.points;
    }
    return points;
  }
}
