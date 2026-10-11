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
  buildGameSimulationInput,
  buildSimulationPlayer,
  buildStrongWeakFixture,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import {
  checkSeasonGameResult,
  createEngineContext,
  createSeasonEffectsState,
  fnv1a32,
  gameResultDigest,
  simulateGame,
  simulateSeasonGame,
  simulateSeasonGameWithEffects,
} from '@hoop-rush/engine';
import { writeFileSync } from 'node:fs';

function goldenDigests(): void {
  const ctx = createEngineContext();
  const equalInput = buildGameSimulationInput({
    seed: seedSchema.parse(seedFromString('golden-1')),
  });
  const equalResult = simulateGame(equalInput, ctx);
  const svsw = buildStrongWeakFixture();
  const svswInput = buildGameSimulationInput({
    seed: seedSchema.parse(seedFromString('golden-svsw')),
    home: svsw.strong,
    away: svsw.weak,
  });
  const svswResult = simulateGame(svswInput, ctx);
  writeFileSync(
    new URL('./scratch-golden-equal.json', import.meta.url),
    JSON.stringify(equalResult),
  );
  writeFileSync(new URL('./scratch-golden-svsw.json', import.meta.url), JSON.stringify(svswResult));
  console.log('=== golden digests ===');
  console.log('EQUAL hash:', String(fnv1a32(gameResultDigest(equalResult))));
  console.log('SVSW hash:', String(fnv1a32(gameResultDigest(svswResult))));
  console.log('EQUAL json:', JSON.stringify(equalResult));
  console.log('SVSW json:', JSON.stringify(svswResult));
}

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

function buildInput(
  seedName: string,
  overrides: Partial<SeasonGameSimulationInput> = {},
): SeasonGameSimulationInput {
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
    ...overrides,
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

function searchFxSeeds(): void {
  console.log('=== fx-probe divergence search ===');
  const context = createEngineContext();
  const divergent: string[] = [];
  for (let n = 0; n <= 60 && divergent.length < 4; n += 1) {
    const seedName = `fx-probe-${String(n)}`;
    const input = withStamina(buildInput(seedName));
    const state = fatiguedState(input);
    const first = simulateSeasonGameWithEffects(input, context, state);
    if (first.result.outcome !== 'completed') continue;
    const replay = simulateSeasonGame(input, createEngineContext());
    const same = JSON.stringify(first.result) === JSON.stringify(replay);
    if (!same) divergent.push(seedName);
  }
  console.log('divergent seeds:', divergent.join(', ') || 'NONE');
}

function searchOtSeeds(): void {
  console.log('=== ot-probe race search ===');
  const context = createEngineContext();
  const racing: string[] = [];
  for (let n = 0; n <= 200 && racing.length < 6; n += 1) {
    const seedName = `ot-probe-${String(n)}`;
    const input = buildInput(seedName, { gameRule: 'first-to-seven-overtime' });
    const result = simulateSeasonGame(input, context);
    if (result.outcome === 'completed' && result.overtimeRace !== undefined) racing.push(seedName);
  }
  console.log('racing seeds:', racing.join(', ') || 'NONE');
}

goldenDigests();
searchFxSeeds();
searchOtSeeds();

const fxInput = withStamina(buildInput('fx-probe-1'));
const fxState = fatiguedState(fxInput);
const fxContext = createEngineContext();
const fxFirst = simulateSeasonGameWithEffects(fxInput, fxContext, fxState);
console.log('=== fx-probe-1 full audit ===');
console.log(
  'repeat identical:',
  JSON.stringify(simulateSeasonGameWithEffects(fxInput, fxContext, fxState).result) ===
    JSON.stringify(fxFirst.result),
);
console.log(
  'audit withState(obj):',
  JSON.stringify(checkSeasonGameResult(fxFirst.result, fxInput, { effectsState: fxState })),
);
console.log(
  'audit withState(pos):',
  JSON.stringify(checkSeasonGameResult(fxFirst.result, fxInput, fxState)),
);
console.log(
  'audit skipDeterminism:',
  JSON.stringify(
    checkSeasonGameResult(fxFirst.result, fxInput, { skipDeterminism: true }).filter((f) =>
      f.startsWith('determinism:'),
    ),
  ),
);
