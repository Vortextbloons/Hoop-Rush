import { describe, expect, it } from 'vitest';
import type { HavocBattleEvent } from './havoc-battle.ts';
import {
  havocBattleEventSchema,
  havocBattleInputSchema,
  havocBattleMutationRollupSchema,
  havocBattleResultSchema,
  havocBattleScoringEntrySchema,
  havocBattleTapeSchema,
  havocBattleTeamInputSchema,
} from './havoc-battle.ts';
import type { HavocEvent } from './havoc-game.ts';
import {
  havocEventSchema,
  havocGameInputSchema,
  havocGameResultSchema,
  havocGameTapeSchema,
  havocMutationRollupSchema,
  havocScoringEntrySchema,
  havocTeamInputSchema,
} from './havoc-game.ts';
import {
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_RULES_VERSION,
  HAVOC_SCHEMA_VERSION,
  HAVOC_SEED_DERIVATION_VERSION,
} from './havoc-versions.ts';
import { HAVOC_TENDENCY_FIELDS } from './havoc-mutations.ts';
import { POSITIONS } from './positions.ts';
import type { Position } from './positions.ts';
import { SHOT_ZONES } from './result.ts';
import { REQUIRED_RATING_KEYS } from './simulation.ts';

type AssertExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// The catalog unions include side-less members, so narrow to the side-bearing variants.
type SoloEventSide = Extract<HavocEvent, { side: unknown }>['side'];
type BattleEventSide = Extract<HavocBattleEvent, { side: unknown }>['side'];
const soloEventSideIsExact: AssertExact<SoloEventSide, 'human' | 'opponent'> = true;
const battleEventSideIsExact: AssertExact<BattleEventSide, 'home' | 'away'> = true;
const soloSideAssignment: SoloEventSide = 'human';
const battleSideAssignment: BattleEventSide = 'home';

const HOME_BASE = 100;
const AWAY_BASE = 1000;
const SEED = 'a'.repeat(16);

const instanceId = (value: number): string => `hvi-${value.toString(16).padStart(32, '0')}`;
const playerId = (value: number): string => `player-${String(value)}`;

function ratings(): Record<string, number> {
  return Object.fromEntries(REQUIRED_RATING_KEYS.map((key) => [key, 70]));
}

function tendencies(): Record<string, number> {
  return Object.fromEntries(HAVOC_TENDENCY_FIELDS.map((key) => [key, 50]));
}

function sourcePlayer(id: number) {
  return {
    playerId: playerId(id),
    playerVersionId: null,
    displayName: `Player ${String(id)}`,
    franchiseId: null,
    eraId: null,
    seasonKey: null,
    positions: ['PG'],
    originalOverall: 80,
    overallSource: 'catalog',
    profile: { ratings: ratings(), tendencies: tendencies() },
    physical: { heightInches: 78, weightLbs: 200 },
  };
}

function effectiveProfile() {
  return {
    ratings: ratings(),
    tendencies: tendencies(),
    physical: {
      baselineHeightInches: 78,
      baselineHeightSource: 'source',
      heightInches: 78,
      weightLbs: 200,
      wingspanDeltaInches: 0,
      reachUnits: 0,
    },
    authoritativeChannels: [],
  };
}

interface ParticipantOptions {
  readonly kind?: 'starter' | 'replacement' | 'clone';
  readonly ownerInstanceId?: string | null;
  readonly mutationIds?: readonly string[];
  readonly sourceId?: number;
}

function participant(id: number, slot: Position, options: ParticipantOptions = {}) {
  return {
    instanceId: instanceId(id),
    kind: options.kind ?? 'starter',
    slot,
    ownerInstanceId: options.ownerInstanceId ?? null,
    mutationPackage: (options.mutationIds ?? []).map((mutationId) => ({ mutationId })),
    source: sourcePlayer(options.sourceId ?? id),
    effective: effectiveProfile(),
  };
}

interface TeamOptions {
  readonly side: 'human' | 'opponent' | 'home' | 'away';
  readonly base: number;
  readonly mutations?: Partial<Record<Position, readonly string[]>>;
  readonly clones?: number;
}

function buildTeam(options: TeamOptions) {
  const starters = POSITIONS.map((slot, index) =>
    participant(options.base + index, slot, {
      mutationIds: options.mutations?.[slot] ?? [],
    }),
  );
  const replacements = starters.map((starter, index) =>
    participant(options.base + 50 + index, starter.slot, {
      kind: 'replacement',
      ownerInstanceId: starter.instanceId,
      sourceId: options.base + index,
    }),
  );
  const owner = starters[0];
  const clones =
    owner === undefined
      ? []
      : Array.from({ length: options.clones ?? 0 }, (_, index) =>
          participant(options.base + 100 + index, owner.slot, {
            kind: 'clone',
            ownerInstanceId: owner.instanceId,
            sourceId: options.base,
          }),
        );
  return {
    side: options.side,
    teamId: `team-${options.side}`,
    displayName: `Team ${options.side}`,
    starters,
    replacements,
    clones,
  };
}

function calibrationTarget(value: number) {
  return { value, tolerance: 5, minimumSample: 1 };
}

function zoneRecord(value: number) {
  return Object.fromEntries(SHOT_ZONES.map((zone) => [zone, value]));
}

function zoneTargets(value: number) {
  return Object.fromEntries(SHOT_ZONES.map((zone) => [zone, calibrationTarget(value)]));
}

function buildProfile() {
  return {
    schemaVersion: 1,
    eraId: 'era-test',
    profileVersion: 'profile-v1',
    dataVersion: 'data-v1',
    seasons: ['1999-00'],
    baselineReport: 'baseline',
    parameters: {
      pace: 100,
      league3PARate: 0.3,
      leagueTsPct: 0.55,
      leagueFtaPerFga: 0.25,
      leagueFtPct: 0.75,
      turnoverPerPossession: 0.13,
      stealShareOfTurnovers: 0.5,
      offensiveReboundRate: 0.28,
      assistRate: 0.6,
      foulsPerPossession: 0.2,
      shootingFoulShare: 0.4,
      freeThrowAnchorRating: 75,
      assistAnchorRating: 75,
      zoneMix: zoneRecord(0.2),
      source: 'test',
    },
    targets: {
      possessionsPerGame: calibrationTarget(100),
      pointsPerGame: calibrationTarget(100),
      offensiveRating: calibrationTarget(110),
      fieldGoalPct: calibrationTarget(0.46),
      efgPct: calibrationTarget(0.52),
      tsPct: calibrationTarget(0.56),
      threePointRate: calibrationTarget(0.3),
      threePointPct: calibrationTarget(0.36),
      freeThrowsAttemptedPerGame: calibrationTarget(20),
      freeThrowPct: calibrationTarget(0.76),
      turnoversPerGame: calibrationTarget(14),
      turnoversPerPossession: calibrationTarget(0.13),
      offensiveReboundsPerGame: calibrationTarget(10),
      offensiveReboundRate: calibrationTarget(0.28),
      assistsPerGame: calibrationTarget(24),
      assistRate: calibrationTarget(0.6),
      personalFoulsPerGame: calibrationTarget(20),
      zoneMix: zoneTargets(0.2),
      closeGameRate: calibrationTarget(0.2),
      blowoutRate: calibrationTarget(0.2),
      overtimeRate: calibrationTarget(0.06),
      strongVsWeakWinRate: calibrationTarget(0.7),
      equalLineupHomeWinRate: calibrationTarget(0.55),
    },
  };
}

function buildVersionSet() {
  return {
    schemaVersion: HAVOC_SCHEMA_VERSION,
    rulesVersion: HAVOC_RULES_VERSION,
    mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
    seedDerivationVersion: HAVOC_SEED_DERIVATION_VERSION,
    engineVersion: 'engine-v1',
    profileVersion: 'profile-v1',
    dataVersion: 'data-v1',
    catalogVersion: 'catalog-v1',
    catalogHash: 'a'.repeat(64),
    bracketHash: 'b'.repeat(64),
    profileHash: 'c'.repeat(64),
  };
}

interface BattleInputOptions {
  readonly home?: ReturnType<typeof buildTeam>;
  readonly away?: ReturnType<typeof buildTeam>;
  readonly variant?: 'havoc' | 'normal';
}

function buildBattleInput(options: BattleInputOptions = {}) {
  return {
    schemaVersion: HAVOC_SCHEMA_VERSION,
    rulesVersion: HAVOC_RULES_VERSION,
    mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
    gameNumber: 1,
    variant: options.variant ?? 'havoc',
    seed: SEED,
    profile: buildProfile(),
    home: options.home ?? buildTeam({ side: 'home', base: HOME_BASE }),
    away: options.away ?? buildTeam({ side: 'away', base: AWAY_BASE }),
    versionSet: buildVersionSet(),
  };
}

interface SoloInputOptions {
  readonly home?: ReturnType<typeof buildTeam>;
  readonly away?: ReturnType<typeof buildTeam>;
  readonly humanSide?: 'home' | 'away';
}

function buildSoloInput(options: SoloInputOptions = {}) {
  return {
    schemaVersion: HAVOC_SCHEMA_VERSION,
    rulesVersion: HAVOC_RULES_VERSION,
    mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
    gameNumber: 1,
    variant: 'havoc',
    seed: SEED,
    profile: buildProfile(),
    humanSide: options.humanSide ?? 'home',
    home: options.home ?? buildTeam({ side: 'human', base: HOME_BASE }),
    away: options.away ?? buildTeam({ side: 'opponent', base: AWAY_BASE }),
    versionSet: buildVersionSet(),
  };
}

const eventBase = {
  sequence: 0,
  gameNumber: 1,
  period: 1,
  clockSeconds: 0,
};

const battleShotEvent = {
  ...eventBase,
  kind: 'shot-attempt',
  possessionId: 0,
  shooterInstanceId: instanceId(1),
  side: 'home',
  zone: 'rim',
  shotKind: 'layup',
  made: true,
  nominalPoints: 2,
};

const soloShotEvent = { ...battleShotEvent, side: 'human' };

const battleScoringEntry = {
  sequence: 0,
  gameNumber: 1,
  period: 1,
  clockSeconds: 30,
  possessionId: 0,
  side: 'home',
  kind: 'field-goal',
  actorInstanceId: instanceId(1),
  beneficiaryInstanceId: null,
  nominalPoints: 2,
  addends: [],
  multipliers: [],
  points: 2,
  owners: [],
  originalEventSequence: null,
};

const soloScoringEntry = { ...battleScoringEntry, side: 'human' };

const battleRollup = {
  ownerInstanceId: instanceId(1),
  mutationId: 'time-lord',
  side: 'home',
  triggers: 1,
  pointsDelta: 0,
  freeThrowsGranted: 0,
  turnoversCancelled: 0,
  extraPossessionsEarned: 0,
  extraPossessionsUsed: 0,
  extraPossessionsExpired: 0,
  swapSeconds: 0,
  capSeconds: 0,
  activeSeconds: 0,
  ratingChanges: 0,
};

function participantLine(id: number, slot: Position) {
  return {
    instanceId: instanceId(id),
    kind: 'starter',
    slot,
    ownerInstanceId: null,
    sourcePlayerId: playerId(id),
    sourcePlayerVersionId: null,
    displayName: `Player ${String(id)}`,
    secondsPlayed: 2880,
    minutes: 48,
    points: 10,
    fieldGoals: { made: 4, attempted: 8 },
    threes: { made: 1, attempted: 3 },
    freeThrows: { made: 1, attempted: 2 },
    rebounds: { total: 5, offensive: 1, defensive: 4 },
    assists: 3,
    steals: 1,
    blocks: 0,
    turnovers: 1,
    fouls: 2,
    chargedFouls: 0,
    adjustments: 0,
  };
}

function participantLines(base: number) {
  return POSITIONS.map((slot, index) => participantLine(base + index, slot));
}

function teamResult(side: 'home' | 'away', points: number) {
  return {
    side,
    teamId: `team-${side}`,
    displayName: `Team ${side}`,
    points,
    fieldGoals: { made: 40, attempted: 80 },
    threes: { made: 10, attempted: 30 },
    freeThrows: { made: 10, attempted: 12 },
    rebounds: { total: 40, offensive: 8, defensive: 28, team: 4 },
    assists: 20,
    steals: 7,
    blocks: 4,
    turnovers: 12,
    fouls: 18,
    adjustments: 0,
    teamBonusPoints: 0,
    periods: [25, 25, 25, 23],
    courtSeconds: 2880,
    participants: participantLines(side === 'home' ? HOME_BASE : AWAY_BASE),
  };
}

interface BattleResultOptions {
  readonly homePoints?: number;
  readonly awayPoints?: number;
  readonly winner?: 'home' | 'away';
  readonly rollupSide?: string;
}

function buildBattleResult(options: BattleResultOptions = {}) {
  const homePoints = options.homePoints ?? 100;
  const awayPoints = options.awayPoints ?? 98;
  return {
    schemaVersion: HAVOC_SCHEMA_VERSION,
    gameNumber: 1,
    variant: 'havoc',
    seed: SEED,
    engineVersion: 'engine-v1',
    rulesVersion: HAVOC_RULES_VERSION,
    mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
    profileVersion: 'profile-v1',
    dataVersion: 'data-v1',
    home: teamResult('home', homePoints),
    away: teamResult('away', awayPoints),
    winner: options.winner ?? (homePoints > awayPoints ? 'home' : 'away'),
    overtimePeriods: 0,
    inputDigest: 'a'.repeat(32),
    rollups: [{ ...battleRollup, side: options.rollupSide ?? 'home' }],
    highlights: [],
  };
}

describe('havoc battle contracts', () => {
  it('accepts battle teams on the home and away sides only', () => {
    expect(havocBattleTeamInputSchema.safeParse(buildTeam({ side: 'home', base: 1 })).success).toBe(
      true,
    );
    expect(havocBattleTeamInputSchema.safeParse(buildTeam({ side: 'away', base: 1 })).success).toBe(
      true,
    );
    expect(
      havocBattleTeamInputSchema.safeParse(buildTeam({ side: 'human', base: 1 })).success,
    ).toBe(false);
  });

  it('accepts both teams owning mutations and clones, including a shared team-exclusive one', () => {
    const input = buildBattleInput({
      home: buildTeam({
        side: 'home',
        base: HOME_BASE,
        mutations: { PG: ['time-lord'] },
        clones: 1,
      }),
      away: buildTeam({
        side: 'away',
        base: AWAY_BASE,
        mutations: { PG: ['time-lord'] },
        clones: 1,
      }),
    });
    const parsed = havocBattleInputSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.home.starters[0]?.mutationPackage).toEqual([{ mutationId: 'time-lord' }]);
    expect(parsed.data.away.starters[0]?.mutationPackage).toEqual([{ mutationId: 'time-lord' }]);
    expect(parsed.data.home.clones).toHaveLength(1);
    expect(parsed.data.away.clones).toHaveLength(1);
    expect(Object.hasOwn(parsed.data, 'humanSide')).toBe(false);
  });

  it('rejects home and away side-label mismatches', () => {
    expect(
      havocBattleInputSchema.safeParse(
        buildBattleInput({
          home: buildTeam({ side: 'away', base: HOME_BASE }),
          away: buildTeam({ side: 'home', base: AWAY_BASE }),
        }),
      ).success,
    ).toBe(false);
    expect(
      havocBattleInputSchema.safeParse(
        buildBattleInput({ home: buildTeam({ side: 'human', base: HOME_BASE }) }),
      ).success,
    ).toBe(false);
    expect(
      havocBattleInputSchema.safeParse(
        buildBattleInput({ away: buildTeam({ side: 'opponent', base: AWAY_BASE }) }),
      ).success,
    ).toBe(false);
  });

  it('rejects mutations and clones in the normal variant on either team', () => {
    expect(
      havocBattleInputSchema.safeParse(
        buildBattleInput({
          variant: 'normal',
          home: buildTeam({ side: 'home', base: HOME_BASE, mutations: { PG: ['sniper-gene'] } }),
        }),
      ).success,
    ).toBe(false);
    expect(
      havocBattleInputSchema.safeParse(
        buildBattleInput({
          variant: 'normal',
          away: buildTeam({ side: 'away', base: AWAY_BASE, clones: 1 }),
        }),
      ).success,
    ).toBe(false);
    expect(
      havocBattleInputSchema.safeParse(
        buildBattleInput({
          variant: 'normal',
          home: buildTeam({ side: 'home', base: HOME_BASE }),
          away: buildTeam({ side: 'away', base: AWAY_BASE }),
        }),
      ).success,
    ).toBe(true);
  });

  it('rejects duplicate instance ids within a battle team', () => {
    const home = buildTeam({ side: 'home', base: HOME_BASE });
    const firstStarter = home.starters[0];
    const firstReplacement = home.replacements[0];
    if (firstStarter === undefined || firstReplacement === undefined) return;
    const duplicated = {
      ...home,
      replacements: [
        { ...firstReplacement, instanceId: firstStarter.instanceId },
        ...home.replacements.slice(1),
      ],
    };
    expect(havocBattleInputSchema.safeParse(buildBattleInput({ home: duplicated })).success).toBe(
      false,
    );
  });

  it('rejects two owners of a team-exclusive mutation on one team', () => {
    expect(
      havocBattleInputSchema.safeParse(
        buildBattleInput({
          home: buildTeam({
            side: 'home',
            base: HOME_BASE,
            mutations: { PG: ['time-lord'], SG: ['time-lord'] },
          }),
        }),
      ).success,
    ).toBe(false);
  });

  it('parses battle events and rejects solo side labels', () => {
    expect(havocBattleEventSchema.safeParse(battleShotEvent).success).toBe(true);
    expect(havocBattleEventSchema.safeParse({ ...battleShotEvent, side: 'human' }).success).toBe(
      false,
    );
    expect(havocBattleEventSchema.safeParse({ ...battleShotEvent, side: 'opponent' }).success).toBe(
      false,
    );
    expect(
      havocBattleEventSchema.safeParse({
        ...eventBase,
        kind: 'possession-start',
        possessionId: 0,
        offenseSide: 'away',
      }).success,
    ).toBe(true);
    expect(
      havocBattleEventSchema.safeParse({
        ...eventBase,
        kind: 'possession-start',
        possessionId: 0,
        offenseSide: 'human',
      }).success,
    ).toBe(false);
  });

  it('parses battle scoring entries and rejects solo side labels', () => {
    expect(havocBattleScoringEntrySchema.safeParse(battleScoringEntry).success).toBe(true);
    expect(havocBattleScoringEntrySchema.safeParse(soloScoringEntry).success).toBe(false);
  });

  it('parses battle mutation rollups and rejects solo side labels', () => {
    expect(havocBattleMutationRollupSchema.safeParse(battleRollup).success).toBe(true);
    expect(
      havocBattleMutationRollupSchema.safeParse({ ...battleRollup, side: 'human' }).success,
    ).toBe(false);
  });

  it('parses battle tapes and rejects solo side labels inside events', () => {
    const tape = {
      schemaVersion: HAVOC_SCHEMA_VERSION,
      gameNumber: 1,
      variant: 'havoc',
      seed: SEED,
      events: [
        { ...eventBase, kind: 'period-start' },
        {
          sequence: 1,
          gameNumber: 1,
          period: 4,
          clockSeconds: 0,
          kind: 'game-end',
          homeScore: 100,
          awayScore: 98,
          winner: 'home',
        },
      ],
      scoring: [battleScoringEntry],
    };
    expect(havocBattleTapeSchema.safeParse(tape).success).toBe(true);
    expect(
      havocBattleTapeSchema.safeParse({
        ...tape,
        events: [battleShotEvent, ...tape.events.slice(1)],
      }).success,
    ).toBe(true);
    expect(
      havocBattleTapeSchema.safeParse({
        ...tape,
        events: [soloShotEvent, ...tape.events.slice(1)],
      }).success,
    ).toBe(false);
    expect(havocBattleTapeSchema.safeParse({ ...tape, scoring: [soloScoringEntry] }).success).toBe(
      false,
    );
  });

  it('parses battle results and enforces the result refinements', () => {
    const parsed = havocBattleResultSchema.safeParse(buildBattleResult());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(Object.hasOwn(parsed.data, 'humanSide')).toBe(false);
    expect(parsed.data.home.side).toBe('home');
    expect(parsed.data.away.side).toBe('away');
    expect(
      havocBattleResultSchema.safeParse(buildBattleResult({ rollupSide: 'human' })).success,
    ).toBe(false);
    expect(
      havocBattleResultSchema.safeParse(buildBattleResult({ homePoints: 100, awayPoints: 100 }))
        .success,
    ).toBe(false);
    expect(
      havocBattleResultSchema.safeParse(
        buildBattleResult({ homePoints: 100, awayPoints: 98, winner: 'away' }),
      ).success,
    ).toBe(false);
    const base = buildBattleResult();
    expect(
      havocBattleResultSchema.safeParse({
        ...base,
        away: { ...base.away, periods: [25, 25, 25, 23, 5] },
      }).success,
    ).toBe(false);
  });

  it('pins the event side labels at the type level', () => {
    expect(soloEventSideIsExact).toBe(true);
    expect(battleEventSideIsExact).toBe(true);
    expect(soloSideAssignment).toBe('human');
    expect(battleSideAssignment).toBe('home');
  });
});

describe('havoc solo contract regression', () => {
  it('keeps accepting human mutations and clones', () => {
    expect(
      havocGameInputSchema.safeParse(
        buildSoloInput({
          home: buildTeam({
            side: 'human',
            base: HOME_BASE,
            mutations: { PG: ['sniper-gene'] },
            clones: 1,
          }),
        }),
      ).success,
    ).toBe(true);
  });

  it('keeps rejecting opponent mutations and clones', () => {
    expect(
      havocGameInputSchema.safeParse(
        buildSoloInput({
          away: buildTeam({
            side: 'opponent',
            base: AWAY_BASE,
            mutations: { PG: ['sniper-gene'] },
          }),
        }),
      ).success,
    ).toBe(false);
    expect(
      havocGameInputSchema.safeParse(
        buildSoloInput({ away: buildTeam({ side: 'opponent', base: AWAY_BASE, clones: 1 }) }),
      ).success,
    ).toBe(false);
  });

  it('keeps rejecting human/opponent side mismatches', () => {
    expect(
      havocGameInputSchema.safeParse(
        buildSoloInput({
          home: buildTeam({ side: 'opponent', base: HOME_BASE }),
          away: buildTeam({ side: 'human', base: AWAY_BASE }),
        }),
      ).success,
    ).toBe(false);
    expect(
      havocGameInputSchema.safeParse(
        buildSoloInput({
          humanSide: 'away',
          home: buildTeam({ side: 'human', base: HOME_BASE }),
          away: buildTeam({ side: 'opponent', base: AWAY_BASE }),
        }),
      ).success,
    ).toBe(false);
    expect(havocTeamInputSchema.safeParse(buildTeam({ side: 'home', base: 1 })).success).toBe(
      false,
    );
  });

  it('keeps parsing solo events, scoring, tapes, rollups, and results', () => {
    expect(havocEventSchema.safeParse(soloShotEvent).success).toBe(true);
    expect(havocEventSchema.safeParse(battleShotEvent).success).toBe(false);
    expect(havocScoringEntrySchema.safeParse(soloScoringEntry).success).toBe(true);
    expect(havocScoringEntrySchema.safeParse(battleScoringEntry).success).toBe(false);
    expect(havocMutationRollupSchema.safeParse({ ...battleRollup, side: 'human' }).success).toBe(
      true,
    );
    expect(havocMutationRollupSchema.safeParse(battleRollup).success).toBe(false);
    const tape = {
      schemaVersion: HAVOC_SCHEMA_VERSION,
      gameNumber: 1,
      variant: 'havoc',
      seed: SEED,
      events: [soloShotEvent],
      scoring: [soloScoringEntry],
    };
    expect(havocGameTapeSchema.safeParse(tape).success).toBe(true);
    const result = {
      ...buildBattleResult(),
      humanSide: 'home',
      rollups: [{ ...battleRollup, side: 'human' }],
    };
    expect(havocGameResultSchema.safeParse(result).success).toBe(true);
    expect(
      havocGameResultSchema.safeParse({
        ...result,
        rollups: [battleRollup],
      }).success,
    ).toBe(false);
  });
});
