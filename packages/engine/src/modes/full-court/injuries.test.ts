import { expect, test } from 'bun:test';
import {
  FULL_COURT_HEALTH_PROFILE_VERSION,
  fullCourtHealthProfileSetSchema,
  playerIdSchema,
  type FullCourtHealthProfileSet,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../sim/kernel.ts';
import { fullCourtTestRoster, fullCourtTestSeed } from './game-test-support.ts';
import {
  drawFullCourtInjuries,
  fullCourtInjuryExposureFactor,
  fullCourtInjuryParticipants,
  fullCourtInjurySeed,
  projectFullCourtInjuryReturn,
  validateFullCourtFutureDays,
  type FullCourtInjuryParticipant,
} from './injuries.ts';

const CATALOG_HASH = 'a'.repeat(64);
const EVIDENCE_HASH = 'b'.repeat(64);
const context = createEngineContext();

function profilesOf(
  rows: ReadonlyArray<{
    readonly playerVersionId: string;
    readonly rate?: number;
    readonly durationCounts?: readonly [number, number, number, number];
  }>,
): FullCourtHealthProfileSet {
  const cohorts: Record<string, unknown> = {};
  const players: Record<string, unknown> = {};
  rows.forEach((row, index) => {
    const cohortId = `test-cohort-${String(index)}`;
    cohorts[cohortId] = {
      observedAppearances: 1_000,
      durationCounts: row.durationCounts ?? [1, 0, 0, 0],
    };
    players[row.playerVersionId] = {
      cohortId,
      episodesPer10kAppearances: row.rate ?? 0,
      playerEvidence: { source: 'population' },
    };
  });
  return fullCourtHealthProfileSetSchema.parse({
    version: FULL_COURT_HEALTH_PROFILE_VERSION,
    catalogHash: CATALOG_HASH,
    evidenceHash: EVIDENCE_HASH,
    cohorts,
    players,
  });
}

function versionIdOf(player: SimulationPlayer): string {
  const versionId = player.playerVersionId;
  if (versionId === undefined) throw new Error('test player is missing a player version id');
  return versionId;
}

function participantOf(
  player: SimulationPlayer,
  overrides: Partial<FullCourtInjuryParticipant> = {},
): FullCourtInjuryParticipant {
  return {
    playerId: player.playerId,
    playerVersionId: player.playerVersionId,
    historicalMpg: player.anchors?.minutesPerGame ?? null,
    seconds: 2_400,
    available: true,
    ...overrides,
  };
}

test('named seeds split every game, team, and player stream', () => {
  const seed = fullCourtTestSeed('injury-seeds');
  const otherSeed = fullCourtTestSeed('injury-seeds-other');
  const [player, teammate] = fullCourtTestRoster('injury-seed', 2);
  if (player === undefined || teammate === undefined) throw new Error('Missing seed players');
  const base = fullCourtInjurySeed(seed, 'home', versionIdOf(player));
  expect(base).toMatch(/^[0-9a-f]{16,64}$/);
  expect(fullCourtInjurySeed(seed, 'home', versionIdOf(player))).toBe(base);
  expect(fullCourtInjurySeed(seed, 'away', versionIdOf(player))).not.toBe(base);
  expect(fullCourtInjurySeed(seed, 'home', versionIdOf(teammate))).not.toBe(base);
  expect(fullCourtInjurySeed(otherSeed, 'home', versionIdOf(player))).not.toBe(base);
});

test('exposure scales actual seconds against historical minutes and stays bounded', () => {
  expect(fullCourtInjuryExposureFactor(1_800, 30)).toBe(1);
  expect(fullCourtInjuryExposureFactor(3_600, 30)).toBe(2);
  expect(fullCourtInjuryExposureFactor(4_800, 30)).toBe(2);
  expect(fullCourtInjuryExposureFactor(600, 30)).toBe(0.5);
  expect(fullCourtInjuryExposureFactor(0, 30)).toBe(0.5);
  expect(fullCourtInjuryExposureFactor(2_400, null)).toBe(1);
  expect(fullCourtInjuryExposureFactor(2_400, 0)).toBe(1);
});

test('a longer outing against the same minutes raises the seeded injury count', () => {
  const [player] = fullCourtTestRoster('injury-workload', 1);
  if (player === undefined) throw new Error('Missing workload player');
  const profiles = profilesOf([{ playerVersionId: versionIdOf(player), rate: 3_000 }]);
  let short = 0;
  let long = 0;
  for (let index = 0; index < 50; index += 1) {
    const seed = fullCourtTestSeed(`injury-workload-${String(index)}`);
    const draw = (seconds: number) =>
      drawFullCourtInjuries({
        seed,
        dayOffset: 0,
        teamId: 'home',
        participants: [participantOf(player, { seconds })],
        profiles,
        futureDays: [2, 4],
        context,
      });
    short += draw(600).length;
    long += draw(3_600).length;
  }
  expect(short).toBeGreaterThan(0);
  expect(long).toBeGreaterThan(short);
});

test('missed games resolve through supplied days and project conservatively past them', () => {
  expect(projectFullCourtInjuryReturn(0, [3, 5, 7], 1)).toEqual({
    availableFromDay: 4,
    projected: false,
  });
  expect(projectFullCourtInjuryReturn(0, [3, 5, 7], 3)).toEqual({
    availableFromDay: 8,
    projected: false,
  });
  // Largest observed spacing (three days) carries the two uncovered games.
  expect(projectFullCourtInjuryReturn(0, [3, 5], 4)).toEqual({
    availableFromDay: 12,
    projected: true,
  });
  // With no calendar at all, the two-day minimum is used.
  expect(projectFullCourtInjuryReturn(10, [], 2)).toEqual({
    availableFromDay: 15,
    projected: true,
  });
  expect(() => projectFullCourtInjuryReturn(0, [3, 3], 1)).toThrow('increasing integers');
  expect(() => projectFullCourtInjuryReturn(0, [0], 1)).toThrow('increasing integers');
  expect(() => projectFullCourtInjuryReturn(0, [3.5], 1)).toThrow('increasing integers');
  expect(() => projectFullCourtInjuryReturn(0, [3], 0)).toThrow('positive integer');
});

test('future days must be strictly after the completed game', () => {
  expect(() => validateFullCourtFutureDays([3, 5], 0)).not.toThrow();
  expect(() => validateFullCourtFutureDays([2], 2)).toThrow('increasing integers');
  expect(() => validateFullCourtFutureDays([5, 4], 0)).toThrow('increasing integers');
});

test('participants map by player id to version and historical minutes', () => {
  const roster = fullCourtTestRoster('injury-map', 2);
  const [active, reserve] = roster;
  if (active === undefined || reserve === undefined) throw new Error('Missing mapped players');
  const participants = fullCourtInjuryParticipants(roster, [
    { playerId: active.playerId, seconds: 1_200, available: true },
    { playerId: reserve.playerId, seconds: 0, available: false },
  ]);
  expect(participants[0]).toMatchObject({
    playerVersionId: active.playerVersionId,
    historicalMpg: 30,
    seconds: 1_200,
    available: true,
  });
  expect(participants[1]).toMatchObject({ seconds: 0, available: false });
  expect(() =>
    fullCourtInjuryParticipants(roster, [
      { playerId: playerIdSchema.parse('unknown-player'), seconds: 100, available: true },
    ]),
  ).toThrow('unknown player');
});

test('DNPs, resting, injured, and unmapped players never consume a draw', () => {
  const roster = fullCourtTestRoster('injury-skip', 4);
  const [dnp, injured, unmapped, sampled] = roster;
  if (dnp === undefined || injured === undefined || unmapped === undefined || sampled === undefined)
    throw new Error('Missing skip players');
  const profiles = profilesOf(
    roster
      .filter((player) => player !== unmapped)
      .map((player) => ({ playerVersionId: versionIdOf(player), rate: 100_000 })),
  );
  const events = drawFullCourtInjuries({
    seed: fullCourtTestSeed('injury-skip'),
    dayOffset: 0,
    teamId: 'home',
    participants: [
      participantOf(dnp, { seconds: 0 }),
      participantOf(injured, { available: false }),
      participantOf(unmapped, { playerVersionId: undefined }),
      participantOf(sampled),
    ],
    profiles,
    futureDays: [2, 4],
    context,
  });
  expect(events.map((event) => event.playerId)).toEqual([sampled.playerId]);
  expect(events[0]).toMatchObject({
    teamId: 'home',
    playerVersionId: versionIdOf(sampled),
    onsetDay: 0,
    gamesMissed: 1,
    availableFromDay: 3,
    projected: false,
  });
});

test('cohort duration counts drive missed games and replay deterministically', () => {
  const [player] = fullCourtTestRoster('injury-duration', 1);
  if (player === undefined) throw new Error('Missing duration player');
  const profiles = profilesOf([
    { playerVersionId: versionIdOf(player), rate: 100_000, durationCounts: [0, 0, 0, 1] },
  ]);
  const input = {
    seed: fullCourtTestSeed('injury-duration'),
    dayOffset: 0,
    teamId: 'home',
    participants: [participantOf(player)],
    profiles,
    futureDays: [3, 5],
    context,
  };
  const first = drawFullCourtInjuries(input);
  const second = drawFullCourtInjuries(input);
  expect(first).toEqual(second);
  expect(first).toHaveLength(1);
  const event = first[0];
  if (event === undefined) throw new Error('Expected a duration event');
  expect(event.gamesMissed).toBeGreaterThanOrEqual(14);
  expect(event.gamesMissed).toBeLessThanOrEqual(27);
  expect(event.projected).toBe(true);
  // Last supplied day plus the uncovered games at the largest observed spacing.
  expect(event.availableFromDay).toBe(5 + (event.gamesMissed - 2) * 3 + 1);
  expect(Object.keys(event).sort()).toEqual([
    'availableFromDay',
    'cohortId',
    'gamesMissed',
    'onsetDay',
    'playerId',
    'playerVersionId',
    'projected',
    'teamId',
  ]);
});

test('profile version and cohort membership are validated before sampling', () => {
  const [player] = fullCourtTestRoster('injury-profile', 1);
  if (player === undefined) throw new Error('Missing profile player');
  const profiles = profilesOf([{ playerVersionId: versionIdOf(player), rate: 100_000 }]);
  const input = {
    seed: fullCourtTestSeed('injury-profile'),
    dayOffset: 0,
    teamId: 'home',
    participants: [participantOf(player)],
    futureDays: [2],
    context,
  };
  const wrongVersion = { ...profiles, version: 'full-court-health-profile-v2' };
  expect(() =>
    drawFullCourtInjuries({
      ...input,
      profiles: wrongVersion as unknown as FullCourtHealthProfileSet,
    }),
  ).toThrow('Unsupported Full Court health profile');
  const unknownCohort = structuredClone(profiles);
  const profile = unknownCohort.players[versionIdOf(player)];
  if (profile === undefined) throw new Error('Missing test profile');
  profile.cohortId = 'missing-cohort';
  expect(() => drawFullCourtInjuries({ ...input, profiles: unknownCohort })).toThrow(
    'unknown cohort',
  );
});
