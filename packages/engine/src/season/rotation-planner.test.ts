import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Position, SeasonRotation } from '@hoop-rush/data-contracts';
import { SEASON_MINUTE_POLICY_VERSION, SEASON_ROTATION_VERSION } from '@hoop-rush/data-contracts';
import { canPlay } from '../domain/positions.ts';
import {
  chooseInitialUnit,
  enumerateLegalFives,
  planUnit,
  type PlannerMember,
  type PlannerRotationContext,
  type PlannerUnitRequest,
} from './rotation-planner.ts';

/**
 * Season Run M2.2 rotation planner tests (rotation-planner-v1): deterministic
 * legal-five enumeration, tipoff selection, projected target-minute
 * deviation scoring with hand-computed fixtures (including a checkpoint-delta
 * flip), the frozen tie-break order, closing-window and overtime preference,
 * no-legal-five nulls, and fast-check property tests over randomized rosters.
 */

const SLOTS = ['G', 'G', 'F', 'F', 'C'] as const;

const STARTER_POS: readonly (readonly Position[])[] = [['PG'], ['SG'], ['SF'], ['PF'], ['C']];
const STARTERS = ['pv-01', 'pv-02', 'pv-03', 'pv-04', 'pv-05'];
const BENCH = ['pv-06', 'pv-07', 'pv-08', 'pv-09', 'pv-10'];

const MEMBERS: PlannerMember[] = [
  { playerVersionId: 'pv-01', playable: ['PG'] },
  { playerVersionId: 'pv-02', playable: ['SG'] },
  { playerVersionId: 'pv-03', playable: ['SF'] },
  { playerVersionId: 'pv-04', playable: ['PF'] },
  { playerVersionId: 'pv-05', playable: ['C'] },
  { playerVersionId: 'pv-06', playable: ['PG', 'SG'] },
  { playerVersionId: 'pv-07', playable: ['SF', 'PF'] },
  { playerVersionId: 'pv-08', playable: ['PF', 'C'] },
  { playerVersionId: 'pv-09', playable: ['SF'] },
  { playerVersionId: 'pv-10', playable: ['C'] },
];

function buildRotation(overrides: Partial<SeasonRotation> = {}): SeasonRotation {
  return {
    franchiseId: 'lakers',
    starters: [...STARTERS],
    benchOrder: [...BENCH],
    targetMinutes: [
      ...STARTERS.map((playerVersionId) => ({ playerVersionId, minutes: 32 })),
      ...BENCH.map((playerVersionId) => ({ playerVersionId, minutes: 16 })),
    ],
    closingFive: [...STARTERS],
    minutePolicy: { policyVersion: SEASON_MINUTE_POLICY_VERSION, strategy: 'balanced' },
    rotationVersion: SEASON_ROTATION_VERSION,
    ...overrides,
  };
}

function plannerContext(rotation: SeasonRotation = buildRotation()): PlannerRotationContext {
  const members = new Map(MEMBERS.map((member) => [member.playerVersionId, member.playable]));
  const targets = new Map(
    rotation.targetMinutes.map((entry) => [entry.playerVersionId, entry.minutes * 60]),
  );
  return { rotation, members, targets };
}

function request(overrides: Partial<PlannerUnitRequest> = {}): PlannerUnitRequest {
  return {
    side: 'home',
    currentUnit: [...STARTERS],
    unavailable: new Set<string>(),
    actualSeconds: new Map(MEMBERS.map((member) => [member.playerVersionId, 0])),
    period: 1,
    secondsRemaining: 720,
    closingWindow: false,
    scoreMargin: 0,
    ...overrides,
  };
}

function isLegalUnit(
  unit: readonly string[],
  members: ReadonlyMap<string, readonly Position[]>,
): boolean {
  if (unit.length !== 5 || new Set(unit).size !== 5) return false;
  return unit.every((playerVersionId, slot) => {
    const playable = members.get(playerVersionId);
    const requirement = SLOTS[slot];
    return requirement !== undefined && playable !== undefined && canPlay(playable, requirement);
  });
}

function unitKey(unit: readonly string[]): string {
  return [...unit].join('|');
}

/** Order-independent brute-force legal-five enumeration for set comparison. */
function bruteForceLegalFives(
  members: readonly PlannerMember[],
  available: ReadonlySet<string>,
): string[][] {
  const results: string[][] = [];
  const playableById = new Map(members.map((member) => [member.playerVersionId, member.playable]));
  const candidateIds = members
    .map((member) => member.playerVersionId)
    .filter((id) => available.has(id));
  const used = new Set<string>();
  const unit: string[] = [];
  const solve = (slot: number): void => {
    if (slot >= SLOTS.length) {
      results.push([...unit]);
      return;
    }
    const requirement = SLOTS[slot];
    if (requirement === undefined) return;
    for (const playerVersionId of candidateIds) {
      if (used.has(playerVersionId)) continue;
      const playable = playableById.get(playerVersionId);
      if (playable === undefined || !canPlay(playable, requirement)) continue;
      used.add(playerVersionId);
      unit.push(playerVersionId);
      solve(slot + 1);
      unit.pop();
      used.delete(playerVersionId);
    }
  };
  solve(0);
  return results;
}

/** The planner's frozen checkpoint delta: seconds to the next whole minute. */
function checkpointDelta(secondsRemaining: number): number {
  const raw = secondsRemaining % 60 === 0 ? 60 : secondsRemaining % 60;
  return Math.min(raw, secondsRemaining);
}

/** The planner's frozen deviation score, recomputed independently. */
function deviationScoreOf(
  unit: readonly string[],
  delta: number,
  context: PlannerRotationContext,
  actualSeconds: ReadonlyMap<string, number>,
): number {
  const onCourt = new Set(unit);
  let total = 0;
  for (const playerVersionId of [...context.rotation.starters, ...context.rotation.benchOrder]) {
    const targetSeconds = context.targets.get(playerVersionId) ?? 0;
    const actual = actualSeconds.get(playerVersionId) ?? 0;
    const projected = actual + (onCourt.has(playerVersionId) ? delta : 0);
    total += Math.abs(projected - targetSeconds);
  }
  return total;
}

describe('enumerateLegalFives (rotation-planner-v1)', () => {
  it('enumerates every legal five in deterministic order over the full roster', () => {
    const context = plannerContext();
    const members = MEMBERS;
    const available = new Set(members.map((member) => member.playerVersionId));
    const first = enumerateLegalFives(members, available);
    const second = enumerateLegalFives(members, available);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(first[0]).toEqual(STARTERS);
    for (const unit of first) {
      expect(isLegalUnit(unit, context.members)).toBe(true);
    }
    const brute = bruteForceLegalFives(members, available);
    expect(first.map(unitKey).sort()).toEqual(brute.map(unitKey).sort());
  });

  it('never includes unavailable players and still matches the brute-force set', () => {
    const context = plannerContext();
    const unavailable = new Set(['pv-01', 'pv-08']);
    const available = new Set(
      MEMBERS.map((member) => member.playerVersionId).filter((id) => !unavailable.has(id)),
    );
    const units = enumerateLegalFives(MEMBERS, available);
    expect(units.length).toBeGreaterThan(0);
    for (const unit of units) {
      expect(isLegalUnit(unit, context.members)).toBe(true);
      for (const playerVersionId of unit) expect(unavailable.has(playerVersionId)).toBe(false);
    }
    const brute = bruteForceLegalFives(MEMBERS, available);
    expect(units.map(unitKey).sort()).toEqual(brute.map(unitKey).sort());
  });

  it('returns an empty list when no legal five can be formed', () => {
    const available = new Set(['pv-01', 'pv-02', 'pv-03', 'pv-04']);
    expect(enumerateLegalFives(MEMBERS, available)).toEqual([]);
  });
});

describe('chooseInitialUnit (rotation-planner-v1)', () => {
  it('returns the configured starters when all are available and legal', () => {
    const context = plannerContext();
    expect(chooseInitialUnit(context, new Set())).toEqual(STARTERS);
  });

  it('falls back to the first deterministic contingency when a starter is unavailable', () => {
    const context = plannerContext();
    const result = chooseInitialUnit(context, new Set(['pv-04']));
    expect(result).toEqual(['pv-01', 'pv-02', 'pv-03', 'pv-07', 'pv-05']);
    expect(isLegalUnit(result ?? [], context.members)).toBe(true);
  });

  it('falls back when a starter has no position data in the context', () => {
    const context = plannerContext();
    const degraded = { ...context, members: new Map(context.members) };
    degraded.members.delete('pv-04');
    const result = chooseInitialUnit(degraded, new Set());
    expect(result).not.toEqual(STARTERS);
    expect(isLegalUnit(result ?? [], degraded.members)).toBe(true);
  });

  it('returns null when no legal five exists', () => {
    const context = plannerContext();
    expect(
      chooseInitialUnit(context, new Set(['pv-05', 'pv-06', 'pv-07', 'pv-08', 'pv-09', 'pv-10'])),
    ).toBeNull();
  });
});

describe('planUnit normal scoring (rotation-planner-v1)', () => {
  const centerCompetition = (): { context: PlannerRotationContext; base: PlannerUnitRequest } => {
    const context = plannerContext();
    const actualSeconds = new Map([
      ['pv-01', 1920],
      ['pv-02', 1920],
      ['pv-03', 1920],
      ['pv-04', 1920],
      ['pv-05', 1900],
      ['pv-06', 960],
      ['pv-07', 960],
      ['pv-08', 960],
      ['pv-09', 960],
      ['pv-10', 950],
    ]);
    const base = request({
      currentUnit: ['pv-01', 'pv-02', 'pv-03', 'pv-04', 'pv-10'],
      unavailable: new Set(['pv-06', 'pv-07', 'pv-08', 'pv-09']),
      actualSeconds,
    });
    return { context, base };
  };

  it('prefers the deeper under-target player as the checkpoint delta grows', () => {
    const { context, base } = centerCompetition();
    const atFive = planUnit(context, { ...base, secondsRemaining: 605 });
    expect(atFive).toEqual(['pv-01', 'pv-02', 'pv-03', 'pv-04', 'pv-10']);
    const atFiftyFive = planUnit(context, { ...base, secondsRemaining: 655 });
    expect(atFiftyFive).toEqual(['pv-01', 'pv-02', 'pv-03', 'pv-04', 'pv-05']);
  });

  it('returns the current unit when it ties for best (retention tie-break)', () => {
    const { context, base } = centerCompetition();
    const current = ['pv-01', 'pv-02', 'pv-03', 'pv-04', 'pv-05'];
    const result = planUnit(context, { ...base, currentUnit: current, secondsRemaining: 605 });
    expect(result).toEqual(current);
  });

  it('breaks score ties by bench hierarchy when the current unit is not a candidate', () => {
    const context = plannerContext();
    const actualSeconds = new Map(MEMBERS.map((member) => [member.playerVersionId, 1920]));
    actualSeconds.set('pv-06', 960);
    actualSeconds.set('pv-07', 960);
    actualSeconds.set('pv-08', 960);
    actualSeconds.set('pv-09', 960);
    actualSeconds.set('pv-10', 960);
    const result = planUnit(context, {
      ...request({
        currentUnit: ['pv-06', 'pv-02', 'pv-03', 'pv-04', 'pv-05'],
        unavailable: new Set(['pv-05']),
        actualSeconds,
      }),
    });
    // The current unit (pv-06/pv-02/pv-03/pv-04) minus the fouled-out pv-05:
    // candidates retaining all four current players add a center; the earlier
    // bench role (pv-08, index 2) wins over pv-10 (index 4).
    expect(result).toEqual(['pv-02', 'pv-06', 'pv-03', 'pv-04', 'pv-08']);
  });

  it('uses bench hierarchy over later roles after equal retention ties', () => {
    const context = plannerContext();
    const actualSeconds = new Map(MEMBERS.map((member) => [member.playerVersionId, 1920]));
    actualSeconds.set('pv-06', 960);
    actualSeconds.set('pv-07', 960);
    actualSeconds.set('pv-08', 960);
    actualSeconds.set('pv-09', 960);
    actualSeconds.set('pv-10', 960);
    const result = planUnit(context, {
      ...request({
        currentUnit: ['pv-06', 'pv-02', 'pv-03', 'pv-09', 'pv-05'],
        unavailable: new Set(['pv-04', 'pv-05', 'pv-06', 'pv-09']),
        actualSeconds,
      }),
    });
    expect(result).toEqual(['pv-01', 'pv-02', 'pv-03', 'pv-07', 'pv-08']);
  });

  it('uses canonical slot-sequence ids as the final tie-break', () => {
    const context = plannerContext();
    const actualSeconds = new Map(MEMBERS.map((member) => [member.playerVersionId, 1920]));
    actualSeconds.set('pv-06', 960);
    actualSeconds.set('pv-07', 960);
    actualSeconds.set('pv-08', 960);
    actualSeconds.set('pv-09', 960);
    actualSeconds.set('pv-10', 960);
    const result = planUnit(context, {
      ...request({
        currentUnit: ['pv-06', 'pv-02', 'pv-08', 'pv-03', 'pv-05'],
        unavailable: new Set(['pv-04', 'pv-06']),
        actualSeconds,
      }),
    });
    // pv-01/pv-02/pv-03/pv-08/pv-05 can be arranged two ways; both tie on
    // score, retention, and hierarchy, so the slot-sequence order decides.
    expect(result).toEqual(['pv-01', 'pv-02', 'pv-03', 'pv-08', 'pv-05']);
  });

  it('returns null when no legal five exists', () => {
    const context = plannerContext();
    const result = planUnit(context, {
      ...request({ unavailable: new Set(['pv-05', 'pv-06', 'pv-07', 'pv-08', 'pv-09', 'pv-10']) }),
    });
    expect(result).toBeNull();
  });
});

describe('planUnit closing window and overtime (rotation-planner-v1)', () => {
  const closingCompetition = (): { context: PlannerRotationContext; base: PlannerUnitRequest } => {
    const rotation = buildRotation({ closingFive: ['pv-01', 'pv-02', 'pv-03', 'pv-04', 'pv-10'] });
    const context = plannerContext(rotation);
    const actualSeconds = new Map([
      ['pv-01', 1920],
      ['pv-02', 1920],
      ['pv-03', 1920],
      ['pv-04', 1920],
      ['pv-05', 1900],
      ['pv-06', 960],
      ['pv-07', 960],
      ['pv-08', 960],
      ['pv-09', 960],
      ['pv-10', 950],
    ]);
    const base = request({
      currentUnit: ['pv-01', 'pv-02', 'pv-03', 'pv-04', 'pv-10'],
      unavailable: new Set(['pv-06', 'pv-07', 'pv-08', 'pv-09']),
      actualSeconds,
      secondsRemaining: 655,
    });
    return { context, base };
  };

  it('prefers the configured closing five inside the window even when scoring favors another unit', () => {
    const { context, base } = closingCompetition();
    const windowed = planUnit(context, { ...base, closingWindow: true, secondsRemaining: 300 });
    expect(windowed).toEqual(['pv-01', 'pv-02', 'pv-03', 'pv-04', 'pv-10']);
    const unwindowed = planUnit(context, { ...base, closingWindow: false });
    expect(unwindowed).toEqual(['pv-01', 'pv-02', 'pv-03', 'pv-04', 'pv-05']);
  });

  it('prefers the closing five at every overtime tip without chasing targets', () => {
    const { context, base } = closingCompetition();
    const overtime = planUnit(context, {
      ...base,
      period: 5,
      closingWindow: false,
      secondsRemaining: 300,
    });
    expect(overtime).toEqual(['pv-01', 'pv-02', 'pv-03', 'pv-04', 'pv-10']);
  });

  it('falls back to closing-preference ordering when a closer has fouled out in overtime', () => {
    const { context, base } = closingCompetition();
    const foulOut = planUnit(context, {
      ...base,
      period: 5,
      closingWindow: false,
      unavailable: new Set(['pv-06', 'pv-07', 'pv-08', 'pv-09', 'pv-10']),
    });
    expect(foulOut).toEqual(['pv-01', 'pv-02', 'pv-03', 'pv-04', 'pv-05']);
  });

  it('ranks contingencies by closing-five overlap before continuity', () => {
    const context = plannerContext(
      buildRotation({ closingFive: ['pv-01', 'pv-02', 'pv-03', 'pv-04', 'pv-10'] }),
    );
    const result = planUnit(context, {
      ...request({
        currentUnit: ['pv-01', 'pv-02', 'pv-03', 'pv-08', 'pv-05'],
        unavailable: new Set(['pv-10']),
        closingWindow: true,
      }),
    });
    expect(result).toEqual(['pv-01', 'pv-02', 'pv-03', 'pv-04', 'pv-05']);
  });

  it('ranks contingencies by current continuity when closing overlap ties', () => {
    const context = plannerContext(
      buildRotation({ closingFive: ['pv-01', 'pv-02', 'pv-03', 'pv-04', 'pv-10'] }),
    );
    const result = planUnit(context, {
      ...request({
        currentUnit: ['pv-01', 'pv-02', 'pv-03', 'pv-09', 'pv-05'],
        unavailable: new Set(['pv-04', 'pv-10']),
        closingWindow: true,
      }),
    });
    expect(result).toEqual(['pv-01', 'pv-02', 'pv-03', 'pv-09', 'pv-05']);
  });

  it('chooses the continuity-best contingency when the current unit is not a candidate', () => {
    const context = plannerContext(
      buildRotation({ closingFive: ['pv-01', 'pv-02', 'pv-03', 'pv-04', 'pv-10'] }),
    );
    const result = planUnit(context, {
      ...request({
        currentUnit: ['pv-06', 'pv-02', 'pv-08', 'pv-03', 'pv-05'],
        unavailable: new Set(['pv-04', 'pv-06', 'pv-10']),
        closingWindow: true,
      }),
    });
    expect(result).toEqual(['pv-01', 'pv-02', 'pv-03', 'pv-08', 'pv-05']);
  });

  it('returns null in the closing window when no legal five exists', () => {
    const context = plannerContext();
    const result = planUnit(context, {
      ...request({
        unavailable: new Set(['pv-05', 'pv-06', 'pv-07', 'pv-08', 'pv-09', 'pv-10']),
        closingWindow: true,
      }),
    });
    expect(result).toBeNull();
  });
});

describe('planUnit determinism (rotation-planner-v1)', () => {
  it('produces identical decisions for identical inputs', () => {
    const context = plannerContext();
    const planned = request({ unavailable: new Set(['pv-04']), actualSeconds: new Map() });
    const first = planUnit(context, planned);
    const second = planUnit(context, planned);
    expect(first).toEqual(second);
  });
});

describe('planner property tests (rotation-planner-v1)', () => {
  const benchPosArb = fc.constantFrom<readonly Position[]>(
    ['PG'],
    ['SG'],
    ['SF'],
    ['PF'],
    ['C'],
    ['PG', 'SG'],
    ['SF', 'PF'],
    ['PF', 'C'],
    ['PG', 'SF'],
  );

  const rosterArb = fc
    .array(benchPosArb, { minLength: 5, maxLength: 5 })
    .map((benchPositions): { members: PlannerMember[] } => {
      const members: PlannerMember[] = [
        ...STARTERS.map((playerVersionId, index) => ({
          playerVersionId,
          playable: STARTER_POS[index] ?? [],
        })),
        ...benchPositions.map((positions, index) => ({
          playerVersionId: `pv-${String(index + 6).padStart(2, '0')}`,
          playable: positions,
        })),
      ];
      return { members };
    });

  const idsArb = fc.constantFrom(...MEMBERS.map((member) => member.playerVersionId));
  const unavailableArb = fc.array(idsArb, { maxLength: 2 }).map((ids) => new Set(ids));

  it('planned units are always legal, available, deterministic, and score-minimal', () => {
    fc.assert(
      fc.property(
        rosterArb,
        unavailableArb,
        fc.array(fc.integer({ min: 0, max: 2880 }), { minLength: 10, maxLength: 10 }),
        fc.integer({ min: 0, max: 720 }),
        fc.integer({ min: 1, max: 6 }),
        fc.boolean(),
        fc.integer({ min: 0, max: 40 }),
        (
          { members },
          unavailable,
          seconds,
          secondsRemaining,
          period,
          closingWindow,
          scoreMargin,
        ) => {
          const rotation = buildRotation();
          const context: PlannerRotationContext = {
            rotation,
            members: new Map(members.map((member) => [member.playerVersionId, member.playable])),
            targets: new Map(
              rotation.targetMinutes.map((entry) => [entry.playerVersionId, entry.minutes * 60]),
            ),
          };
          const actualSeconds = new Map(
            members.map((member, index) => [member.playerVersionId, seconds[index] ?? 0]),
          );
          const planned = request({
            currentUnit: [...STARTERS],
            unavailable,
            actualSeconds,
            period,
            secondsRemaining,
            closingWindow,
            scoreMargin,
          });
          const available = new Set(
            members.map((member) => member.playerVersionId).filter((id) => !unavailable.has(id)),
          );
          const candidates = enumerateLegalFives(members, available);
          const unit = planUnit(context, planned);

          if (candidates.length === 0) {
            expect(unit).toBeNull();
            expect(chooseInitialUnit(context, unavailable)).toBeNull();
            return;
          }
          expect(unit).not.toBeNull();
          if (unit === null) return;
          expect(isLegalUnit(unit, context.members)).toBe(true);
          for (const playerVersionId of unit) expect(unavailable.has(playerVersionId)).toBe(false);

          const closing = context.rotation.closingFive;
          if (
            (closingWindow || period > 4) &&
            isLegalUnit(closing, context.members) &&
            !closing.some((id) => unavailable.has(id))
          ) {
            expect(unit).toEqual(closing);
          } else if (!closingWindow && period <= 4) {
            const delta = checkpointDelta(secondsRemaining);
            const scores = candidates.map((candidate) =>
              deviationScoreOf(candidate, delta, context, actualSeconds),
            );
            expect(deviationScoreOf(unit, delta, context, actualSeconds)).toBe(Math.min(...scores));
          } else {
            const overlap = (candidate: readonly string[]) =>
              candidate.filter((id) => closing.includes(id)).length;
            expect(overlap(unit)).toBe(Math.max(...candidates.map(overlap)));
          }

          expect(planUnit(context, planned)).toEqual(unit);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('chooseInitialUnit is deterministic and prefers legal starters', () => {
    fc.assert(
      fc.property(rosterArb, unavailableArb, ({ members }, unavailable) => {
        const rotation = buildRotation();
        const context: PlannerRotationContext = {
          rotation,
          members: new Map(members.map((member) => [member.playerVersionId, member.playable])),
          targets: new Map(
            rotation.targetMinutes.map((entry) => [entry.playerVersionId, entry.minutes * 60]),
          ),
        };
        const first = chooseInitialUnit(context, unavailable);
        const second = chooseInitialUnit(context, unavailable);
        expect(first).toEqual(second);
        const startersAvailable = STARTERS.every((id) => !unavailable.has(id));
        if (startersAvailable) {
          expect(first).toEqual(STARTERS);
        } else if (first !== null) {
          expect(isLegalUnit(first, context.members)).toBe(true);
          for (const playerVersionId of first) expect(unavailable.has(playerVersionId)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('enumeration matches brute force and is deterministic', () => {
    fc.assert(
      fc.property(rosterArb, unavailableArb, ({ members }, unavailable) => {
        const available = new Set(
          members.map((member) => member.playerVersionId).filter((id) => !unavailable.has(id)),
        );
        const first = enumerateLegalFives(members, available);
        expect(enumerateLegalFives(members, available)).toEqual(first);
        const brute = bruteForceLegalFives(members, available);
        expect(first.map(unitKey).sort()).toEqual(brute.map(unitKey).sort());
      }),
      { numRuns: 100 },
    );
  });
});
