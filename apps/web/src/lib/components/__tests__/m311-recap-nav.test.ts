import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import type { SeasonBlockRecap } from '@hoop-rush/data-contracts';
import CheckpointRecap from '$lib/components/season/CheckpointRecap.svelte';
import ChampionSummary from '$lib/components/season/ChampionSummary.svelte';
import StandingsTable from '$lib/components/season/StandingsTable.svelte';
import { mockSvelteKitApp } from '../../../test/svelte-testing';

mockSvelteKitApp();

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

function baseRecap(): SeasonBlockRecap {
  return {
    schemaVersion: 1,
    recapVersion: 'season-recap-v6',
    runId: 'run-1',
    blockIndex: 0,
    completedRounds: 10,
    humanRecord: null,
    standingsMovement: [],
    notablePerformances: [],
    streaks: [],
    versionSpotlights: [],
    upcomingHumanGames: [],
    injuryEvidence: {
      injuries: 0,
      bySeverity: { minor: 0, moderate: 0, major: 0, 'season-ending': 0 },
      sameGameReturns: 0,
      seasonEnding: 0,
      returnedThisBlock: 0,
      activeAtBlockEnd: 0,
      humanTeamInjuries: [],
    },
    objectiveEvidence: null,
    challengeEvidence: undefined,
    tradeEvidence: { tradesAccepted: 0, influenceDelta: 0 },
    freeAgencyEvidence: {
      windowIndex: null,
      signings: [],
      influenceDelta: 0,
      seasonSignings: 0,
      seasonSpend: 0,
    },
    influenceBalance: { humanBalance: 5 },
  } as unknown as SeasonBlockRecap;
}

function challengeResults(): SeasonBlockRecap['challengeEvidence'] {
  return [
    { challengeId: 'protect-glass', success: true, reward: 1, evaluationFacts: FACTS },
    { challengeId: 'take-care', success: false, reward: 1, evaluationFacts: FACTS },
    { challengeId: 'winning-block', success: true, reward: 1, evaluationFacts: FACTS },
  ] as unknown as SeasonBlockRecap['challengeEvidence'];
}

function legacyObjective(): SeasonBlockRecap['objectiveEvidence'] {
  return {
    objectiveId: 'win-six',
    success: false,
    evaluationFacts: {
      games: 10,
      wins: 4,
      pointsAllowed: 1000,
      reboundMargin: 4,
      tipsWithAtLeastEightAvailable: 10,
      tipsTotal: 10,
      benchMinutes: 400,
      turnovers: 100,
    },
  };
}

function renderRecap(recap: SeasonBlockRecap) {
  return render(CheckpointRecap, {
    props: {
      recap,
      humanRecord: null,
      franchiseName: (id: string) => id,
      playerName: () => 'Unknown player',
      manifest: null,
    },
  });
}

describe('checkpoint recap evidence (M3.11.1)', () => {
  it('renders challenge evidence without any health events', () => {
    const { container } = renderRecap({ ...baseRecap(), challengeEvidence: challengeResults() });
    const challenges = container.querySelector('[data-recap-challenge-evidence]');
    expect(challenges).not.toBeNull();
    expect(challenges?.textContent).toContain('Winning Block');
    expect(challenges?.textContent).toContain('Hit · +1 Influence');
    expect(challenges?.textContent).toContain('Missed');
    expect(container.querySelector('[aria-labelledby="recap-injury-heading"]')).toBeNull();
    expect(container.querySelector('[aria-labelledby="recap-goal-heading"]')).toBeNull();
  });

  it('falls back to the legacy goal only when challenge evidence is absent', () => {
    const legacy = {
      ...baseRecap(),
      objectiveEvidence: legacyObjective(),
    };
    const { container } = renderRecap(legacy);
    expect(container.querySelector('[data-recap-challenge-evidence]')).toBeNull();
    const goal = container.querySelector('[aria-labelledby="recap-goal-heading"]');
    expect(goal).not.toBeNull();
    expect(goal?.textContent).toContain('win-six');
    expect(goal?.textContent).toContain('Missed');
  });

  it('prefers challenges over the legacy goal when both exist', () => {
    const both = {
      ...baseRecap(),
      challengeEvidence: challengeResults(),
      objectiveEvidence: legacyObjective(),
    };
    const { container } = renderRecap(both);
    expect(container.querySelector('[data-recap-challenge-evidence]')).not.toBeNull();
    expect(container.querySelector('[aria-labelledby="recap-goal-heading"]')).toBeNull();
  });
});

describe('season navigation destinations (M3.11.1)', () => {
  function standingsProps() {
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
    return {
      standings: { rows: [row('celtics'), row('lakers')] },
      league: {
        teams: [
          { franchiseId: 'celtics', conference: 'east', division: 'atlantic' },
          { franchiseId: 'lakers', conference: 'west', division: 'pacific' },
        ],
      },
      humanFranchiseId: 'celtics',
      franchiseName: (id: string) => id,
      streakOf: () => null,
      manifest: null,
    };
  }

  it('links standings rows to the canonical franchise detail path', () => {
    const { container } = render(StandingsTable, { props: standingsProps() });
    const links = [...container.querySelectorAll('[data-season-standings-link]')];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const href = link.getAttribute('href') ?? '';
      expect(href).toContain('/season/run/teams?franchiseId=');
      expect(href).not.toContain('teams/?franchiseId=');
    }
  });

  it('links the champion summary to the final bracket and history', () => {
    const { container } = render(ChampionSummary, {
      props: {
        championFranchiseId: 'celtics',
        franchiseName: (id: string) => id,
        franchiseAbbrev: (id: string) => id,
        manifest: null,
        completion: { championFranchiseId: 'celtics', finalizedAtStateRevision: 9 },
        humanWon: true,
      },
    });
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/season/run/postseason');
    expect(hrefs).toContain('/season/run/history');
  });
});

describe('completed and champion summaries (M3.11.1)', () => {
  it('hides finalized-state revision metadata from the champion summary', () => {
    const { container } = render(ChampionSummary, {
      props: {
        championFranchiseId: 'celtics',
        franchiseName: (id: string) => id,
        franchiseAbbrev: (id: string) => id,
        manifest: null,
        completion: { championFranchiseId: 'celtics', finalizedAtStateRevision: 9 },
        humanWon: false,
      },
    });
    const text = container.textContent;
    expect(text).toContain('celtics');
    expect(text).not.toContain('state 9');
    expect(text).not.toContain('finalizedAtStateRevision');
  });
});
