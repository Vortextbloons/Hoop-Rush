import { describe, expect, it } from 'vitest';
import type { SeasonRun } from '@hoop-rush/data-contracts';
import {
  TRADE_GRADE_NEUTRAL_FALLBACK,
  challengeEvidenceOfRun,
  deriveBlockRecap,
  displayPlayerName,
  formatInfluenceBalance,
  recapChallengeView,
  tradeGradeViewModel,
  UNKNOWN_PLAYER_DISPLAY_NAME,
} from './season-presentation';

const FACTS = {
  games: 10,
  wins: 6,
  threePointersMade: 30,
  threePointersAttempted: 80,
  threePointPct: 0.375,
  reboundMargin: 4,
  turnovers: 120,
  turnoversPerGame: 12,
  beatLeader: null,
  beatHigher: null,
  sweptBlock: false,
};

function evaluation(blockIndex: number) {
  return {
    blockIndex,
    results: [
      { challengeId: 'winning-block', blockIndex, success: true, facts: FACTS },
      { challengeId: 'take-care', blockIndex, success: false, facts: FACTS },
      { challengeId: 'protect-glass', blockIndex, success: true, facts: FACTS },
    ],
  };
}

function runWithChallenges(evaluations: unknown[]): SeasonRun {
  return {
    health: { injuries: [] },
    transactions: [],
    influence: { balances: {}, ledger: [] },
    challenges: { evaluations },
  } as unknown as SeasonRun;
}

function standingsOf() {
  const row = (franchiseId: string) => ({
    franchiseId,
    wins: 5,
    losses: 5,
    gamesPlayed: 10,
    homeWins: 3,
    homeLosses: 2,
    awayWins: 2,
    awayLosses: 3,
    conferenceWins: 3,
    conferenceLosses: 3,
    divisionWins: 1,
    divisionLosses: 1,
    pointsFor: 1000,
    pointsAgainst: 990,
    headToHead: [],
  });
  return { rows: [row('celtics'), row('lakers')] };
}

function leagueOf() {
  return {
    teams: [
      { franchiseId: 'celtics', conference: 'east', division: 'atlantic' },
      { franchiseId: 'lakers', conference: 'west', division: 'pacific' },
    ],
  };
}

describe('shared identity and influence foundation (M3.11.1)', () => {
  it('falls back to Unknown player instead of raw ids', () => {
    expect(UNKNOWN_PLAYER_DISPLAY_NAME).toBe('Unknown player');
    expect(displayPlayerName('  ')).toBe('Unknown player');
    expect(displayPlayerName(null)).toBe('Unknown player');
    expect(displayPlayerName(undefined)).toBe('Unknown player');
    expect(displayPlayerName('Jaylen Brown')).toBe('Jaylen Brown');
  });

  it('formats influence as ◆ balance / cap', () => {
    expect(formatInfluenceBalance(5, 8)).toBe('◆ 5 / 8');
    expect(formatInfluenceBalance(0, 8)).toBe('◆ 0 / 8');
  });
});

describe('challenge evidence derivation (M3.11.1)', () => {
  it('derives sorted challenge evidence with catalog rewards from run facts', () => {
    const evidence = challengeEvidenceOfRun(runWithChallenges([evaluation(2)]), 2);
    expect(evidence?.map((entry) => entry.challengeId)).toEqual([
      'protect-glass',
      'take-care',
      'winning-block',
    ]);
    expect(evidence?.map((entry) => entry.reward)).toEqual([1, 1, 1]);
    expect(evidence?.find((entry) => entry.challengeId === 'take-care')?.success).toBe(false);
  });

  it('returns undefined when the block has no challenge evaluation', () => {
    expect(challengeEvidenceOfRun(runWithChallenges([evaluation(0)]), 1)).toBeUndefined();
    expect(challengeEvidenceOfRun(runWithChallenges([]), 0)).toBeUndefined();
    expect(challengeEvidenceOfRun({} as SeasonRun, 0)).toBeUndefined();
  });

  it('deriveBlockRecap carries challenge evidence from the run', () => {
    const run = runWithChallenges([evaluation(0)]);
    const recap = deriveBlockRecap({
      runId: 'run-1',
      blockIndex: 0,
      completedRounds: 10,
      standings: standingsOf() as never,
      league: leagueOf() as never,
      blockSummaries: [],
      allSummaries: [],
      rosters: [],
      games: [],
      humanFranchiseId: 'celtics',
      run,
    });
    expect(recap.objectiveEvidence).toBeNull();
    expect(recap.challengeEvidence?.map((entry) => entry.challengeId)).toEqual([
      'protect-glass',
      'take-care',
      'winning-block',
    ]);
  });

  it('prefers challenges over legacy objectives and falls back only for old histories', () => {
    const withBoth = recapChallengeView({
      challengeEvidence: [
        {
          challengeId: 'winning-block',
          success: true,
          reward: 1,
          evaluationFacts: FACTS,
        },
      ],
      objectiveEvidence: {
        objectiveId: 'win-six',
        success: true,
        evaluationFacts: {
          games: 10,
          wins: 6,
          pointsAllowed: 1000,
          reboundMargin: 4,
          tipsWithAtLeastEightAvailable: 10,
          tipsTotal: 10,
          benchMinutes: 400,
          turnovers: 100,
        },
      },
    } as never);
    expect(withBoth?.kind).toBe('challenges');

    const legacyOnly = recapChallengeView({
      challengeEvidence: undefined,
      objectiveEvidence: { objectiveId: 'win-six', success: false, evaluationFacts: null },
    } as never);
    expect(legacyOnly).toEqual({
      kind: 'legacy-objective',
      objectiveId: 'win-six',
      success: false,
    });

    const neither = recapChallengeView({
      challengeEvidence: undefined,
      objectiveEvidence: null,
    } as never);
    expect(neither).toBeNull();
  });
});

describe('trade grade presentation (M3.11.1)', () => {
  it('exposes label, window, and the first reason without raw scores', () => {
    const view = tradeGradeViewModel({
      gradeId: 'g1',
      windowIndex: 1,
      offerId: 'o1',
      franchiseId: 'celtics',
      receivedPlayerVersionIds: ['pv-a'],
      sentPlayerVersionIds: ['pv-b'],
      sample: 12,
      neutral: false,
      components: { production: 60, availability: 60, minutes: 60, trend: 60 },
      score: 62,
      label: 'B',
      reasons: ['Outscored after the deal.'],
    } as never);
    expect(view).toEqual({
      label: 'B',
      windowLabel: 'Window 2',
      detail: 'Outscored after the deal.',
      neutral: false,
    });
    expect(view).not.toHaveProperty('score');
  });

  it('renders the neutral fallback instead of a thin grade', () => {
    const view = tradeGradeViewModel({
      gradeId: 'g2',
      windowIndex: 0,
      offerId: 'o2',
      franchiseId: 'celtics',
      receivedPlayerVersionIds: ['pv-a'],
      sentPlayerVersionIds: ['pv-b'],
      sample: 2,
      neutral: true,
      components: { production: 50, availability: 50, minutes: 50, trend: 50 },
      score: 50,
      label: 'C',
      reasons: ['Small sample.'],
    } as never);
    expect(view.detail).toBe(TRADE_GRADE_NEUTRAL_FALLBACK);
    expect(view.detail).toBe('Not enough post-trade games to grade.');
  });
});
