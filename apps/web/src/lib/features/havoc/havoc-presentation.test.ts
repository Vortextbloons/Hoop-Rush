import { describe, expect, it } from 'vitest';
import {
  HAVOC_TIER_COLORS,
  foldHavocSeasonStats,
  formatSignedPoints,
  havocEventTextOf,
  havocMvpFormulaLabel,
  havocObjectiveStatusOf,
  havocRecordLabel,
  havocScoringTextOf,
  mutationNameOf,
} from './havoc-presentation';
import { HAVOC_MVP_INDEX_WEIGHTS, havocGameSummarySchema } from '@hoop-rush/data-contracts';
import {
  FAKE_HUMAN_STARTER_IDS,
  buildCloneGameResult,
  buildFakeGameResult,
  buildFakeTape,
  buildNegativeScoreTape,
  buildPendingComparisonRunState,
} from './testing/havoc-fake-service.ts';

function summaryOf(gameNumber: number, humanScore: number, opponentScore: number) {
  return havocGameSummarySchema.parse({
    schemaVersion: 1,
    gameNumber,
    variant: 'havoc',
    seed: 'a'.repeat(16),
    humanSide: 'home',
    humanScore,
    opponentScore,
    outcome: humanScore > opponentScore ? 'win' : 'loss',
    periods: {
      human: [
        Math.trunc(humanScore / 4),
        Math.trunc(humanScore / 4),
        Math.trunc(humanScore / 4),
        humanScore - Math.trunc(humanScore / 4) * 3,
      ],
      opponent: [
        Math.trunc(opponentScore / 4),
        Math.trunc(opponentScore / 4),
        Math.trunc(opponentScore / 4),
        opponentScore - Math.trunc(opponentScore / 4) * 3,
      ],
    },
    overtimePeriods: 0,
    adjustments: 0,
    resultDigest: 'b'.repeat(32),
    inputDigest: 'c'.repeat(32),
  });
}

describe('havoc presentation helpers', () => {
  it('labels tiers by color and text', () => {
    expect(HAVOC_TIER_COLORS[1]).toBe('#37B7CC');
    expect(HAVOC_TIER_COLORS[2]).toBe('#E8AD38');
    expect(HAVOC_TIER_COLORS[3]).toBe('#B39AE8');
    expect(mutationNameOf('four-point-dunk')).toBe('Four-Point Dunk');
  });

  it('describes the objective through the first loss and beyond', () => {
    const pending = buildPendingComparisonRunState({
      havocCursor: 40,
      havocWins: 40,
      havocLosses: 0,
    });
    expect(havocObjectiveStatusOf(viewOf(pending)).tone).toBe('alive');
    const lost = buildPendingComparisonRunState({ havocCursor: 40, havocWins: 39, havocLosses: 1 });
    expect(havocObjectiveStatusOf(viewOf(lost)).tone).toBe('lost');
    expect(havocObjectiveStatusOf(viewOf(lost)).detail).toContain('1 loss');
  });

  it('formats signed points and records honestly', () => {
    expect(formatSignedPoints(4)).toBe('+4');
    expect(formatSignedPoints(-1)).toBe('-1');
    expect(havocRecordLabel(55, 27)).toBe('55–27');
  });

  it('renders factual event text from payloads only', () => {
    const tape = buildNegativeScoreTape(1);
    const context = {
      playerName: () => 'Marcus Webb',
      homeName: 'Hoop Havoc Five',
      awayName: 'Rival City Rockets',
      humanSide: 'home' as const,
    };
    const scoring = tape.scoring[2];
    if (scoring === undefined) throw new Error('negative tape scoring missing');
    const text = havocScoringTextOf(scoring, context.playerName);
    expect(text).toContain('Marcus Webb');
    expect(text).toContain('-1');
    expect(text).toContain('Double or Nothing');
    const endEvent = tape.events[tape.events.length - 1];
    if (endEvent === undefined) throw new Error('tape game-end missing');
    expect(endEvent.kind).toBe('game-end');
    expect(havocEventTextOf(endEvent, context)).toContain('Final');
  });

  it('folds player and mutation totals from real result structures', () => {
    const first = buildCloneGameResult(1);
    const second = buildFakeGameResult(summaryOf(2, 101, 97));
    const stats = foldHavocSeasonStats([first, second]);
    expect(stats.games).toBe(2);
    const clone = stats.players.find((player) => player.kind === 'clone');
    expect(clone?.games).toBe(1);
    expect(clone?.points).toBe(12);
    const fourPoint = stats.mutations.find((mutation) => mutation.mutationId === 'four-point-dunk');
    expect(fourPoint?.triggers).toBe(3);
    expect(fourPoint?.pointsDelta).toBe(6);
  });

  it('spells out the MVP formula with its weights', () => {
    const formula = havocMvpFormulaLabel({ ...HAVOC_MVP_INDEX_WEIGHTS });
    expect(formula).toContain('10 × points');
    expect(formula).toContain('30 × blocks');
    expect(formula).toContain('− 10 × turnovers');
  });

  it('keeps tape summaries consistent with the ledger', () => {
    const tape = buildFakeTape(summaryOf(3, 12, 9));
    const human = tape.scoring
      .filter((entry) => entry.side === 'human')
      .reduce((total, entry) => total + entry.points, 0);
    const opponent = tape.scoring
      .filter((entry) => entry.side === 'opponent')
      .reduce((total, entry) => total + entry.points, 0);
    expect(human).toBe(12);
    expect(opponent).toBe(9);
    expect(tape.events.some((event) => event.kind === 'game-end')).toBe(true);
    expect(FAKE_HUMAN_STARTER_IDS).toHaveLength(5);
  });
});

function viewOf(state: ReturnType<typeof buildPendingComparisonRunState>) {
  return {
    runId: state.runId,
    revision: state.revision,
    phase: state.phase,
    havocCursor: state.havocCursor,
    normalCursor: state.normalCursor,
    havocWins: state.havocAggregate.wins,
    havocLosses: state.havocAggregate.losses,
    normalWins: state.normalAggregate.wins,
    normalLosses: state.normalAggregate.losses,
    perfectSeason: state.perfectSeason,
    comparisonStatus: state.comparisonStatus,
    completionState: state.completionState,
    lineup: [],
    nextGameNumber: null,
    nextOpponentDisplayName: null,
    nextHumanHome: null,
  };
}
