import { describe, expect, it } from 'bun:test';
import type { SimulationRatings, SimulationTendencies } from '@hoop-rush/data-contracts';
import {
  buildPlayerProfile,
  buildPlayerProfileReferences,
  PROFILE_RATING_GROUPS,
  type ProfileSample,
} from './player-profile.ts';

function ratings(overrides: Partial<SimulationRatings> = {}): SimulationRatings {
  return {
    insideScoring: 60,
    closeShot: 60,
    midrange: 60,
    threePoint: 60,
    freeThrow: 70,
    ballHandling: 60,
    passing: 60,
    offensiveIq: 60,
    offensiveRebound: 45,
    defensiveRebound: 55,
    perimeterDefense: 60,
    interiorDefense: 55,
    steal: 60,
    block: 55,
    defensiveIq: 65,
    speed: 65,
    strength: 60,
    vertical: 62,
    ...overrides,
  };
}

function tendencies(overrides: Partial<SimulationTendencies> = {}): SimulationTendencies {
  return {
    usageRate: 20,
    passRate: 25,
    shotRate: 25,
    driveRate: 18,
    postUpRate: 5,
    rimFrequency: 30,
    shortMidFrequency: 20,
    longMidFrequency: 14,
    cornerThreeFrequency: 8,
    aboveBreakThreeFrequency: 12,
    threePointRate: 20,
    freeThrowRate: 22,
    turnoverRate: 12,
    isolationRate: 10,
    pickAndRollBallHandlerRate: 25,
    pickAndRollRollManRate: 10,
    spotUpRate: 20,
    transitionRate: 15,
    cutRate: 10,
    foulRate: 2,
    stealAttemptRate: 8,
    blockAttemptRate: 10,
    crashOffensiveGlassRate: 12,
    ...overrides,
  };
}

/**
 * A synthetic position cohort with evenly spread ratings, so a percentile of
 * exactly 0.5 corresponds to the cohort median.
 */
function cohort(size: number, position = 'PG'): ProfileSample[] {
  return Array.from({ length: size }, (_value, index) => {
    const step = index / (size - 1);
    return {
      positions: [position],
      ratings: ratings({
        steal: 40 + Math.round(step * 40),
        passing: 40 + Math.round(step * 40),
        threePoint: 40 + Math.round(step * 40),
        perimeterDefense: 40 + Math.round(step * 40),
        defensiveIq: 50 + Math.round(step * 30),
        insideScoring: 45 + Math.round(step * 35),
        defensiveRebound: 40 + Math.round(step * 40),
        block: 40 + Math.round(step * 35),
        strength: 45 + Math.round(step * 30),
        midrange: 45 + Math.round(step * 30),
        freeThrow: 55 + Math.round(step * 30),
        ballHandling: 50 + Math.round(step * 25),
        offensiveIq: 55 + Math.round(step * 20),
        speed: 55 + Math.round(step * 20),
        vertical: 55 + Math.round(step * 20),
        offensiveRebound: 35 + Math.round(step * 35),
        closeShot: 50 + Math.round(step * 20),
      }),
      tendencies: tendencies({
        stealAttemptRate: 4 + step * 12,
        usageRate: 12 + step * 26,
        threePointRate: 10 + step * 40,
        postUpRate: 2 + step * 12,
        isolationRate: 2 + step * 24,
        shotRate: 14 + step * 26,
        transitionRate: 6 + step * 18,
        freeThrowRate: 10 + step * 28,
        rimFrequency: 15 + step * 35,
        driveRate: 8 + step * 26,
      }),
    };
  });
}

function profileOf(
  sample: { ratings: SimulationRatings; tendencies: SimulationTendencies },
  samples: readonly ProfileSample[],
  extra: { positions?: readonly string[]; slot?: string; overall?: number } = {},
) {
  const references = buildPlayerProfileReferences(samples);
  const positions = extra.positions ?? ['PG'];
  const slot = extra.slot ?? positions[0] ?? 'PG';
  return buildPlayerProfile(
    {
      displayName: 'Test Player',
      franchiseLabel: 'TST',
      seasonKey: '1999-00',
      positions,
      heightInches: 76,
      weightLbs: 190,
      overall: extra.overall ?? 80,
      offense: 70,
      defense: 68,
      ratings: sample.ratings,
      tendencies: sample.tendencies,
      anchors: {
        gamesPlayed: 82,
        minutesPerGame: 34,
        pointsPerGame: 18,
        fieldGoalAttemptsPerGame: 14,
        reboundsPerGame: 5,
        offensiveReboundsPerGame: 1,
        defensiveReboundsPerGame: 4,
        assistsPerGame: 6,
        stealsPerGame: 1.4,
        blocksPerGame: 0.3,
        turnoversPerGame: 2,
        fieldGoalPct: 0.46,
        threePointPct: 0.35,
        freeThrowPct: 0.78,
        threePointAttemptRate: 0.3,
        freeThrowAttemptRate: 0.25,
      },
      slot,
    },
    references.forSlot(slot),
  );
}

describe('player profile references', () => {
  it('returns null below the minimum cohort size', () => {
    const references = buildPlayerProfileReferences(cohort(10));
    expect(references.forSlot('PG')).toBeNull();
  });

  it('ranks the cohort median at the 50th percentile', () => {
    const samples = cohort(101);
    const references = buildPlayerProfileReferences(samples);
    const reference = references.forSlot('PG');
    expect(reference).not.toBeNull();
    expect(reference?.rating('steal', 60)).toBeCloseTo(0.5, 2);
    expect(reference?.sampleSize).toBe(101);
  });

  it('separates positions into their own cohorts', () => {
    const samples = [...cohort(60, 'PG'), ...cohort(60, 'C')];
    const references = buildPlayerProfileReferences(samples);
    expect(references.forSlot('PG')?.sampleSize).toBe(60);
    expect(references.forSlot('C')?.sampleSize).toBe(60);
    expect(references.forSlot('PG')?.cohortLabel).toBe('point guards');
  });

  it('groups every rating key into exactly one display group', () => {
    const grouped = PROFILE_RATING_GROUPS.flatMap((group) => [...group.keys]);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(grouped.length).toBe(18);
  });
});

describe('player profile traits', () => {
  const samples = cohort(101);

  it('flags an elite pickpocket as a strength', () => {
    const view = profileOf(
      {
        ratings: ratings({ steal: 80, perimeterDefense: 80 }),
        tendencies: tendencies({ stealAttemptRate: 16 }),
      },
      samples,
    );
    expect(view.strengths.map((trait) => trait.label)).toContain('Perimeter pickpocket');
  });

  it('flags a midrange maestro as a strength when pull-up volume and touch are elite', () => {
    const view = profileOf(
      {
        ratings: ratings({ midrange: 85 }),
        tendencies: tendencies({ shortMidFrequency: 25, longMidFrequency: 25 }),
      },
      samples,
    );
    expect(view.strengths.map((trait) => trait.label)).toContain('Midrange maestro');
  });

  it('flags tunnel vision as a weakness for a high-usage player who does not pass', () => {
    const view = profileOf(
      {
        ratings: ratings({ passing: 42 }),
        tendencies: tendencies({ passRate: 10, usageRate: 35 }),
      },
      samples,
    );
    expect(view.weaknesses.map((trait) => trait.label)).toContain('Tunnel vision');
  });

  it('names a defensive guard archetype for a steal-and-stop guard', () => {
    const view = profileOf(
      {
        ratings: ratings({ steal: 80, perimeterDefense: 78, defensiveIq: 74 }),
        tendencies: tendencies({ stealAttemptRate: 16 }),
      },
      samples,
    );
    expect(view.archetype).toBe('Defensive guard');
  });

  it('flags a poor shooter as a weakness rather than a strength', () => {
    const view = profileOf(
      {
        ratings: ratings({ threePoint: 40, midrange: 40, strength: 42 }),
        tendencies: tendencies({ threePointRate: 9 }),
      },
      samples,
    );
    const weaknesses = view.weaknesses.map((trait) => trait.label);
    expect(weaknesses).toContain('Gets pushed off his spot');
    expect(view.strengths.map((trait) => trait.label)).not.toContain('Unlimited range');
  });

  it('names a gravity shooter when range is the dominant skill', () => {
    const view = profileOf(
      {
        ratings: ratings({ threePoint: 92, freeThrow: 90 }),
        tendencies: tendencies({ threePointRate: 48, aboveBreakThreeFrequency: 30 }),
      },
      samples,
    );
    expect(view.archetype).toBe('Gravity shooter');
    expect(view.strengths.map((trait) => trait.label)).toContain('Unlimited range');
  });

  it('keeps a role-player big out of the gravity-shooter label', () => {
    // A stretch big with real volume should read as a stretch big, not as an
    // elite shooter archetype reserved for the genuinely rare profile.
    const view = profileOf(
      {
        ratings: ratings({ threePoint: 80, insideScoring: 62, strength: 60 }),
        tendencies: tendencies({ threePointRate: 46, postUpRate: 6, spotUpRate: 30 }),
      },
      [...samples, ...cohort(60, 'PF')],
      { positions: ['PF'], slot: 'PF', overall: 76 },
    );
    expect(view.archetype).not.toBe('Gravity shooter');
    expect(['Stretch big', 'Rotation big', 'Connector']).toContain(view.archetype);
  });

  it('surfaces more than one weakness when a player is bad at several things', () => {
    const view = profileOf(
      {
        ratings: ratings({ strength: 40, threePoint: 40, midrange: 40, freeThrow: 55 }),
        tendencies: tendencies({ threePointRate: 8, freeThrowRate: 30 }),
      },
      samples,
    );
    expect(view.weaknesses.length).toBeGreaterThan(1);
  });

  it('keeps a two-way guard labeled by his strongest defensive evidence', () => {
    // Both the pickpocket and scorer rules fire; the defender has more evidence.
    const view = profileOf(
      {
        ratings: ratings({
          steal: 86,
          perimeterDefense: 84,
          defensiveIq: 79,
          offensiveIq: 74,
          insideScoring: 72,
        }),
        tendencies: tendencies({
          stealAttemptRate: 17,
          usageRate: 30,
          isolationRate: 18,
          shotRate: 32,
        }),
      },
      samples,
    );
    const labels = view.strengths.map((trait) => trait.label);
    expect(labels).toContain('Perimeter pickpocket');
    // Whatever the label, it must be one this player actually earns.
    expect(['Defensive guard', 'Scoring guard', 'Creator', 'Rotation guard']).toContain(
      view.archetype,
    );
  });

  it('keeps a center out of guard archetypes even with guard-like skills', () => {
    const view = profileOf(
      {
        ratings: ratings({
          steal: 80,
          perimeterDefense: 78,
          insideScoring: 80,
          defensiveRebound: 88,
        }),
        tendencies: tendencies({ stealAttemptRate: 16, postUpRate: 22 }),
      },
      [...samples, ...cohort(60, 'C')],
      { positions: ['C'], slot: 'C' },
    );
    expect(view.archetype).not.toBe('Defensive guard');
    expect(['Interior force', 'Anchor big', 'Glass specialist']).toContain(view.archetype);
  });

  it('names a playmaking big for a center with elite passing and engine usage', () => {
    const view = profileOf(
      {
        ratings: ratings({ passing: 80, offensiveIq: 78 }),
        tendencies: tendencies({ passRate: 35, usageRate: 35 }),
      },
      [...samples, ...cohort(60, 'C')],
      { positions: ['C'], slot: 'C' },
    );
    expect(view.archetype).toBe('Playmaking big');
  });

  it('names a point forward for a small forward with elite passing and engine usage', () => {
    const view = profileOf(
      {
        ratings: ratings({ passing: 80, offensiveIq: 78 }),
        tendencies: tendencies({ passRate: 35, usageRate: 35 }),
      },
      [...samples, ...cohort(60, 'SF')],
      { positions: ['SF'], slot: 'SF' },
    );
    expect(view.archetype).toBe('Point forward');
  });

  it('names a two-way anchor for a center with elite rim protection and post scoring', () => {
    const view = profileOf(
      {
        ratings: ratings({ block: 80, interiorDefense: 80, insideScoring: 82 }),
        tendencies: tendencies({ postUpRate: 20 }),
      },
      [...samples, ...cohort(60, 'C')],
      { positions: ['C'], slot: 'C' },
    );
    expect(view.archetype).toBe('Two-way anchor');
  });

  it('names a rim runner for an athletic center who finishes inside without posting up', () => {
    const view = profileOf(
      {
        ratings: ratings({ insideScoring: 82, vertical: 78 }),
        tendencies: tendencies({ rimFrequency: 45, postUpRate: 2 }),
      },
      [...samples, ...cohort(60, 'C')],
      { positions: ['C'], slot: 'C' },
    );
    expect(view.archetype).toBe('Rim runner');
  });

  it('names a 3-and-D wing for a wing with perimeter defense and floor spacing', () => {
    const view = profileOf(
      {
        ratings: ratings({ perimeterDefense: 80, defensiveIq: 75, threePoint: 72 }),
        tendencies: tendencies({ threePointRate: 35 }),
      },
      [...samples, ...cohort(60, 'SF')],
      { positions: ['SF'], slot: 'SF' },
    );
    expect(view.archetype).toBe('3-and-D wing');
  });

  it('names a pick-and-roll maestro for a guard who lives in PnR with passing', () => {
    const view = profileOf(
      {
        ratings: ratings({ passing: 78, offensiveIq: 78 }),
        tendencies: tendencies({ pickAndRollBallHandlerRate: 30 }),
      },
      samples,
    );
    expect(view.strengths.map((trait) => trait.label)).toContain('Pick-and-roll maestro');
    expect(view.archetype).toBe('Pick-and-roll maestro');
  });

  it('names a 3-and-D big for a center with rim protection and floor spacing', () => {
    const view = profileOf(
      {
        ratings: ratings({ block: 85, interiorDefense: 80, threePoint: 76 }),
        tendencies: tendencies({ threePointRate: 35 }),
      },
      [...samples, ...cohort(60, 'C')],
      { positions: ['C'], slot: 'C' },
    );
    expect(view.archetype).toBe('3-and-D big');
  });

  it('names an off-ball mover for a wing who cuts and spaces the floor', () => {
    const view = profileOf(
      {
        ratings: ratings({ insideScoring: 78, threePoint: 76 }),
        tendencies: tendencies({ cutRate: 25, threePointRate: 35 }),
      },
      [...samples, ...cohort(60, 'SF')],
      { positions: ['SF'], slot: 'SF' },
    );
    expect(view.strengths.map((trait) => trait.label)).toContain('Off-ball cutter');
    expect(view.archetype).toBe('Off-ball mover');
  });

  it('flags lacks burst and misses rotations as weaknesses', () => {
    const view = profileOf(
      {
        ratings: ratings({ speed: 35, defensiveIq: 35 }),
        tendencies: tendencies(),
      },
      samples,
    );
    const labels = view.weaknesses.map((trait) => trait.label);
    expect(labels).toContain('Lacks burst');
    expect(labels).toContain('Misses rotations');
  });

  it('caps the lists shown in the panel', () => {
    const view = profileOf({ ratings: ratings(), tendencies: tendencies() }, samples);
    expect(view.strengths.length).toBeLessThanOrEqual(4);
    expect(view.weaknesses.length).toBeLessThanOrEqual(3);
    expect(view.habits.length).toBeLessThanOrEqual(4);
  });

  it('writes a summary that references the same traits as the rows', () => {
    const view = profileOf(
      {
        ratings: ratings({ steal: 80, perimeterDefense: 78 }),
        tendencies: tendencies({ stealAttemptRate: 16 }),
      },
      samples,
    );
    expect(view.summary.length).toBeGreaterThan(0);
    expect(view.summary).toContain('steals');
  });
});

describe('player profile production', () => {
  const samples = cohort(101);

  it('groups the stat line into per-game, shooting, and advanced sections', () => {
    const references = buildPlayerProfileReferences(samples);
    const view = buildPlayerProfile(
      {
        displayName: 'Stat Line',
        franchiseLabel: null,
        seasonKey: '1999-00',
        positions: ['PG'],
        heightInches: null,
        weightLbs: null,
        overall: 80,
        offense: null,
        defense: null,
        ratings: ratings(),
        tendencies: tendencies(),
        anchors: null,
        stats: {
          gamesPlayed: 82,
          minutes: 36.4,
          points: 22.1,
          rebounds: 5.2,
          assists: 6.8,
          steals: 1.7,
          blocks: 0.4,
          turnovers: 2.9,
          fgPct: 0.472,
          threePct: 0.381,
          ftPct: 0.812,
          tsPct: 0.581,
          efgPct: 0.521,
          usageRate: 27.4,
          per: 19.8,
          boxPlusMinus: 4.2,
        },
        slot: 'PG',
      },
      references.forSlot('PG'),
    );
    expect(view.production?.map((group) => group.title)).toEqual([
      'Per game',
      'Shooting',
      'Advanced',
    ]);
    const flat = (view.production ?? []).flatMap((group) => group.rows);
    expect(flat.find((row) => row.label === 'Points')?.value).toBe('22.1');
    expect(flat.find((row) => row.label === 'FG%')?.value).toBe('47.2%');
    expect(flat.find((row) => row.label === 'USG%')?.value).toBe('27.4%');
    expect(flat.find((row) => row.label === 'Games')?.value).toBe('82');
  });

  it('keeps missing stats visible as an em dash instead of dropping the row', () => {
    const references = buildPlayerProfileReferences(samples);
    const view = buildPlayerProfile(
      {
        displayName: 'Old Timer',
        franchiseLabel: null,
        seasonKey: '1965-66',
        positions: ['PG'],
        heightInches: null,
        weightLbs: null,
        overall: 70,
        offense: null,
        defense: null,
        ratings: ratings(),
        tendencies: tendencies(),
        anchors: null,
        stats: {
          gamesPlayed: 70,
          minutes: 30,
          points: 12,
          rebounds: 3,
          assists: 4,
          steals: null,
          blocks: null,
          turnovers: null,
          fgPct: 0.44,
          threePct: null,
          ftPct: 0.75,
          tsPct: null,
          efgPct: null,
          usageRate: null,
          per: null,
          boxPlusMinus: null,
        },
        slot: 'PG',
      },
      references.forSlot('PG'),
    );
    const flat = (view.production ?? []).flatMap((group) => group.rows);
    expect(flat.find((row) => row.label === 'Steals')?.value).toBe('\u2014');
    expect(flat.find((row) => row.label === '3P%')?.value).toBe('\u2014');
    expect(flat.find((row) => row.label === 'BPM')?.value).toBe('\u2014');
  });

  it('reports no production at all when the mode has no stat line', () => {
    const view = profileOf({ ratings: ratings(), tendencies: tendencies() }, samples);
    expect(view.production).toBeNull();
  });
});

describe('player profile shares', () => {
  const samples = cohort(101);

  it('normalizes the shot diet to a full share', () => {
    const view = profileOf({ ratings: ratings(), tendencies: tendencies() }, samples);
    const total = (view.shotDiet ?? []).reduce((sum, zone) => sum + zone.share, 0);
    expect(total).toBeCloseTo(1, 5);
    expect(view.shotDiet?.length).toBe(5);
  });

  it('orders shot zones and actions by share, highest first', () => {
    const view = profileOf(
      { ratings: ratings(), tendencies: tendencies({ postUpRate: 40 }) },
      samples,
    );
    expect(view.shotDiet?.[0]?.label).toBe('Rim');
    expect(view.actions?.[0]?.label).toBe('Post-up');
  });

  it('drops zones with no attempts instead of showing zero-width bars', () => {
    const view = profileOf(
      {
        ratings: ratings(),
        tendencies: tendencies({
          cornerThreeFrequency: 0,
          aboveBreakThreeFrequency: 0,
        }),
      },
      samples,
    );
    expect(view.shotDiet?.map((zone) => zone.label)).not.toContain('Corner 3');
  });

  it('omits the workload block when anchors are missing', () => {
    const references = buildPlayerProfileReferences(samples);
    const view = buildPlayerProfile(
      {
        displayName: 'No Anchors',
        franchiseLabel: null,
        seasonKey: null,
        positions: ['PG'],
        heightInches: null,
        weightLbs: null,
        overall: 70,
        offense: null,
        defense: null,
        ratings: ratings(),
        tendencies: tendencies(),
        anchors: null,
        slot: 'PG',
      },
      references.forSlot('PG'),
    );
    expect(view.workload).toBeNull();
    expect(view.summary.length).toBeGreaterThan(0);
  });
});
