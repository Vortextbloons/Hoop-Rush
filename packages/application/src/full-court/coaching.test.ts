import { expect, test } from 'bun:test';
import {
  FULL_COURT_DEFAULT_TACTICS,
  idSchema,
  playerIdSchema,
  seedSchema,
  type FullCourtBlueprint,
  type FullCourtCoachingPlan,
} from '@hoop-rush/data-contracts';
import { buildFullCourtBlueprintHierarchy, type FullCourtSeasonLock } from '@hoop-rush/engine';
import { buildSimulationPlayer } from '@hoop-rush/test-fixtures';
import { FULL_COURT_HISTORICAL_PRESETS } from './coaching-presets.ts';
import {
  applyFullCourtBlueprintToPlan,
  saveFullCourtBlueprint,
  saveFullCourtCoaching,
} from './coaching.ts';

test('saves edited tactics as a portable blueprint', async () => {
  const saved: FullCourtBlueprint[] = [];
  const tactics = { ...FULL_COURT_HISTORICAL_PRESETS[0].tactics, defense: 'pressure' } as const;
  const blueprint = await saveFullCourtBlueprint('  My motion offense  ', tactics, {
    create: (value) => {
      saved.push(value);
      return Promise.resolve();
    },
  });

  expect(blueprint).toEqual({ schemaVersion: 1, name: 'My motion offense', tactics });
  expect(saved).toEqual([blueprint]);
});

test('does not write an invalid strategy name', async () => {
  await expect(
    saveFullCourtBlueprint('  ', FULL_COURT_HISTORICAL_PRESETS[0].tactics, {
      create: () => Promise.reject(new Error('Invalid input reached storage')),
    }),
  ).rejects.toThrow('Enter a strategy name.');
});

const ROSTER = Array.from({ length: 8 }, (_value, index) =>
  buildSimulationPlayer({ playerId: playerIdSchema.parse(`p${String(index + 1)}`) }),
);
const RUN_ID = idSchema.parse('run-hierarchy');
const LOCK = {
  digest: seedSchema.parse('a'.repeat(32)),
  season: {
    runId: RUN_ID,
    userTeamId: 'user',
    teams: [{ teamId: 'user', roster: ROSTER }],
  },
} as unknown as FullCourtSeasonLock;

function hierarchyPlan(hierarchy: FullCourtCoachingPlan['hierarchy']): FullCourtCoachingPlan {
  return {
    schemaVersion: 1,
    tactics: { ...FULL_COURT_DEFAULT_TACTICS },
    ...(hierarchy === undefined ? {} : { hierarchy }),
  };
}

test('saves a coaching plan with a roster scoring hierarchy', async () => {
  const saved: FullCourtCoachingPlan[] = [];
  const plan = hierarchyPlan({
    primaryPlayerId: 'p1',
    secondaryPlayerId: 'p2',
    floorGeneralPlayerId: 'p3',
  });
  const result = await saveFullCourtCoaching(
    { command: 'set-full-court-coaching', runId: RUN_ID, plan },
    LOCK,
    {
      save: (runId, value) => {
        expect(runId).toBe(RUN_ID);
        saved.push(value);
        return Promise.resolve();
      },
    },
  );

  expect(result.hierarchy).toEqual(plan.hierarchy);
  expect(saved).toEqual([plan]);
});

test('rejects a scoring hierarchy naming a player outside the roster', async () => {
  await expect(
    saveFullCourtCoaching(
      {
        command: 'set-full-court-coaching',
        runId: RUN_ID,
        plan: hierarchyPlan({ primaryPlayerId: 'outside-player' }),
      },
      LOCK,
      { save: () => Promise.reject(new Error('Invalid input reached storage')) },
    ),
  ).rejects.toThrow('The saved scoring hierarchy includes a player outside your roster.');
});

test('saves and reapplies a blueprint with portable scoring roles across runs without overwriting rotations or rules', async () => {
  const saved: FullCourtBlueprint[] = [];
  const sourceRoster = Array.from({ length: 8 }, (_value, index) =>
    buildSimulationPlayer({
      playerId: playerIdSchema.parse(`src-${String(index + 1)}`),
      displayName: `Source ${String(index + 1)}`,
      positions: [
        index === 0 ? 'PG' : index === 1 ? 'SG' : index === 2 ? 'SF' : index === 3 ? 'PF' : 'C',
      ],
    }),
  );
  const hierarchy = buildFullCourtBlueprintHierarchy({
    hierarchy: {
      primaryPlayerId: 'src-3',
      secondaryPlayerId: 'src-6',
      floorGeneralPlayerId: 'src-1',
    },
    roster: sourceRoster,
  });
  const blueprint = await saveFullCourtBlueprint(
    'Motion Wing',
    { pace: 'fast', offense: 'ball-movement', defense: 'pressure' },
    {
      create: (value) => {
        saved.push(value);
        return Promise.resolve();
      },
    },
    { hierarchy },
  );

  expect(blueprint.hierarchy).toEqual(hierarchy);
  expect(saved).toEqual([blueprint]);

  const targetRoster = Array.from({ length: 8 }, (_value, index) =>
    buildSimulationPlayer({
      playerId: playerIdSchema.parse(`dst-${String(index + 1)}`),
      displayName: `Target ${String(index + 1)}`,
      positions: [
        index === 0 ? 'PG' : index === 1 ? 'SG' : index === 2 ? 'SF' : index === 3 ? 'PF' : 'C',
      ],
    }),
  );
  const existingPlan: FullCourtCoachingPlan = {
    schemaVersion: 1,
    tactics: { ...FULL_COURT_DEFAULT_TACTICS },
    interfaceLevel: 'mastermind',
    rotation: {
      startingFive: ['dst-1', 'dst-2', 'dst-3', 'dst-4', 'dst-5'],
      minuteTargets: {
        'dst-1': 36,
        'dst-2': 36,
        'dst-3': 36,
        'dst-4': 36,
        'dst-5': 36,
        'dst-6': 30,
        'dst-7': 20,
        'dst-8': 10,
      },
      closingFive: ['dst-1', 'dst-2', 'dst-3', 'dst-4', 'dst-6'],
    },
    rules: [
      {
        ruleId: 'rule-1',
        kind: 'foul-trouble',
        playerId: 'dst-1',
        foulLimit: 4,
      },
    ],
  };

  const applied = applyFullCourtBlueprintToPlan({
    blueprint,
    plan: existingPlan,
    roster: targetRoster,
  });
  expect(applied.plan.tactics).toEqual(blueprint.tactics);
  expect(applied.plan.rotation).toEqual(existingPlan.rotation);
  expect(applied.plan.rules).toEqual(existingPlan.rules);
  expect(applied.plan.interfaceLevel).toBe('mastermind');
  expect(applied.plan.hierarchy).toEqual({
    primaryPlayerId: 'dst-3',
    secondaryPlayerId: 'dst-6',
    floorGeneralPlayerId: 'dst-1',
  });

  // Tactics-only blueprint preserves existing hierarchy and rotation.
  const tacticsOnly = applyFullCourtBlueprintToPlan({
    blueprint: {
      schemaVersion: 1,
      name: 'Legacy Tactics',
      tactics: { pace: 'slow', offense: 'interior', defense: 'protect-paint' },
    },
    plan: applied.plan,
    roster: targetRoster,
  });
  expect(tacticsOnly.plan.tactics).toEqual({
    pace: 'slow',
    offense: 'interior',
    defense: 'protect-paint',
  });
  expect(tacticsOnly.plan.hierarchy).toEqual(applied.plan.hierarchy);
  expect(tacticsOnly.plan.rotation).toEqual(existingPlan.rotation);
});
