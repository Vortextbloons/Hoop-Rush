import {
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_NEUTRAL_HOME_COURT,
  SEASON_ROTATION_PRESET_TARGETS,
  SEASON_ROTATION_VERSION,
  franchiseIdSchema,
  playerIdSchema,
  playerVersionId,
  type Position,
  type SeasonEffectsState,
  type SeasonGameSimulationInput,
  type SeasonGameTeamInput,
  type SeasonRotation,
  type SeasonStaminaInput,
  seedSchema,
} from '@hoop-rush/data-contracts';
import {
  buildEraSimulationProfile,
  buildSimulationPlayer,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import {
  checkSeasonGameResult,
  createEngineContext,
  createSeasonEffectsBuffer,
  createSeasonEffectsState,
  simulateSeasonGame,
  simulateSeasonGameWithEffects,
} from '@hoop-rush/engine';

const POSITION_PLAN: ReadonlyArray<readonly Position[]> = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
  ['PG', 'SG'],
  ['SF', 'PF'],
  ['SG', 'SF'],
  ['C'],
  ['PF', 'C'],
];

function buildSeasonTeam(side: 'home' | 'away'): SeasonGameTeamInput {
  const franchiseId = side === 'home' ? 'lakers' : 'celtics';
  const players = POSITION_PLAN.map((positions, index) => {
    const playerId = playerIdSchema.parse(`p-sg-${side}-${String(index + 1)}`);
    const base = buildSimulationPlayer();
    return {
      playerVersionId: playerVersionId(playerId, franchiseId, '1990s', '1995-96'),
      playerId,
      displayName: `${side} player ${String(index + 1)}`,
      positions: [...positions],
      heightInches: 76,
      weightLbs: 200,
      ratings: { ...base.ratings },
      tendencies: { ...base.tendencies },
    };
  });
  return {
    teamId: side === 'home' ? 'home-team' : 'away-team',
    displayName: side === 'home' ? 'Home Team' : 'Away Team',
    franchiseId: franchiseIdSchema.parse(franchiseId),
    players,
  };
}

function buildRotation(team: SeasonGameTeamInput): SeasonRotation {
  const ids = team.players.map((player) => player.playerVersionId);
  const starters = ids.slice(0, 5);
  const bench = ids.slice(5);
  const targets = SEASON_ROTATION_PRESET_TARGETS.balanced;
  return {
    franchiseId: team.franchiseId,
    starters,
    benchOrder: bench,
    targetMinutes: [
      ...starters.map((playerVersionId) => ({ playerVersionId, minutes: targets.starters })),
      ...bench.map((playerVersionId, index) => ({
        playerVersionId,
        minutes: targets.bench[index] ?? 0,
      })),
    ],
    closingFive: [ids[1], ids[5], ids[6], ids[7], ids[8]].map((id) => {
      if (id === undefined) throw new Error('fixture closing five missing player');
      return id;
    }),
    minutePolicy: { policyVersion: SEASON_MINUTE_POLICY_VERSION, strategy: 'balanced' },
    rotationVersion: SEASON_ROTATION_VERSION,
  };
}

function buildInput(seedName: string): SeasonGameSimulationInput {
  const home = buildSeasonTeam('home');
  const away = buildSeasonTeam('away');
  return {
    schemaVersion: 1,
    seed: seedSchema.parse(seedFromString(seedName)),
    gameNumber: 1,
    dataVersion: 'data-v1',
    profile: buildEraSimulationProfile(),
    home,
    away,
    homeRotation: buildRotation(home),
    awayRotation: buildRotation(away),
    availability: [...home.players, ...away.players].map((player) => ({
      playerVersionId: player.playerVersionId,
      available: true,
    })),
    removals: [],
    returns: [],
    homeCourt: SEASON_NEUTRAL_HOME_COURT,
  };
}

function staminaOf(team: SeasonGameTeamInput): SeasonStaminaInput[] {
  return team.players.map((player, index) => ({
    schemaVersion: 1,
    playerVersionId: player.playerVersionId,
    rating: index < 5 ? 80 : 65,
    historicalMpg: index < 5 ? 28 : 16,
    derivationVersion: 'season-stamina-v2',
  }));
}

function withStamina(input: SeasonGameSimulationInput): SeasonGameSimulationInput {
  const attach = (team: SeasonGameTeamInput): SeasonGameTeamInput => ({
    ...team,
    players: team.players.map((player, index) => ({
      ...player,
      stamina: staminaOf(team)[index],
    })),
  });
  return { ...input, home: attach(input.home), away: attach(input.away) };
}

function fatiguedState(input: SeasonGameSimulationInput): SeasonEffectsState {
  const all: SeasonStaminaInput[] = [...staminaOf(input.home), ...staminaOf(input.away)];
  for (let n = all.length; n < 300; n += 1) {
    all.push({
      schemaVersion: 1,
      playerVersionId: playerVersionId(
        `p-lowfix-filler-${String(n)}`,
        `fx-${String(n % 30)}`,
        '1990s',
        '1995-96',
      ),
      rating: 60,
      historicalMpg: 12,
      derivationVersion: 'season-stamina-v2',
    });
  }
  const base = createSeasonEffectsState(all);
  return {
    ...base,
    playerStates: base.playerStates.map((player) => ({
      ...player,
      fatigueBasisPoints: 600,
      recentLoadBasisPoints: 3000,
      lastCompletedRound: 10,
    })),
  };
}

const input = withStamina(buildInput('fx-probe-0'));
const state = fatiguedState(input);

const homeStamina = new Map(input.home.players.map((p) => [p.playerVersionId, p.stamina] as const));
const awayStamina = new Map(input.away.players.map((p) => [p.playerVersionId, p.stamina] as const));
const fatiguedBuffer = createSeasonEffectsBuffer(state, homeStamina, awayStamina);
const zeroState = createSeasonEffectsState(
  (() => {
    const roster = [...staminaOf(input.home), ...staminaOf(input.away)];
    for (let n = roster.length; n < 300; n += 1) {
      roster.push({
        schemaVersion: 1,
        playerVersionId: playerVersionId(
          `p-zero-filler-${String(n)}`,
          `zx-${String(n % 30)}`,
          '1990s',
          '1995-96',
        ),
        rating: 60,
        historicalMpg: 12,
        derivationVersion: 'season-stamina-v2',
      });
    }
    return roster;
  })(),
);
const zeroBuffer = createSeasonEffectsBuffer(zeroState, homeStamina, awayStamina);

const rosterId = input.home.players[0].playerVersionId;
console.log('roster version id:', rosterId);
console.log(
  'fatigued makeAdjustment:',
  fatiguedBuffer.hook.makeAdjustment({ shooterVersion: rosterId, offenseSide: 0, defenseSide: 1 }),
);
console.log(
  'zero     makeAdjustment:',
  zeroBuffer.hook.makeAdjustment({ shooterVersion: rosterId, offenseSide: 0, defenseSide: 1 }),
);
console.log(
  'fatigued turnoverAdjustment:',
  fatiguedBuffer.hook.turnoverAdjustment({ handlerVersion: rosterId, offenseSide: 0 }),
);
console.log(
  'zero     turnoverAdjustment:',
  zeroBuffer.hook.turnoverAdjustment({ handlerVersion: rosterId, offenseSide: 0 }),
);

const context = createEngineContext();
const first = simulateSeasonGameWithEffects(input, context, state);
const replay = simulateSeasonGame(input, createEngineContext());
console.log('fatigued outcome:', first.result.outcome);
console.log('replay   outcome:', replay.outcome);
console.log('identical:', JSON.stringify(first.result) === JSON.stringify(replay));
console.log(
  'audit no-state determinism failures:',
  JSON.stringify(
    checkSeasonGameResult(first.result, input).filter((f) => f.startsWith('determinism:')),
  ),
);
