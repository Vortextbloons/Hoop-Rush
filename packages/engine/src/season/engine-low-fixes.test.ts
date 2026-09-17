import { describe, expect, it } from 'vitest';
import {
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_NEUTRAL_HOME_COURT,
  SEASON_ROTATION_PRESET_TARGETS,
  SEASON_ROTATION_VERSION,
  franchiseIdSchema,
  playerIdSchema,
  playerVersionId,
  seasonNamespaceSeed,
  seedSchema,
  type Position,
  type SeasonEffectsState,
  type SeasonGameSimulationInput,
  type SeasonGameTeamInput,
  type SeasonRotation,
  type SeasonStaminaInput,
} from '@hoop-rush/data-contracts';
import {
  buildEraSimulationProfile,
  buildSimulationPlayer,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../sim/context.ts';
import { createSeasonEffectsState } from './effects.ts';
import { checkSeasonGameResult } from './season-game-audit.ts';
import { simulateSeasonGame, simulateSeasonGameWithEffects } from './season-game.ts';
import { seasonBlockGamesOf, simulateSeasonBlockGame } from './block.ts';
import { buildTestRun, pipelineInput, scheduleOf } from './block-test-support.ts';

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
      stamina: {
        schemaVersion: 1,
        playerVersionId: player.playerVersionId,
        rating: index < 5 ? 80 : 65,
        historicalMpg: index < 5 ? 28 : 16,
        derivationVersion: 'season-stamina-v2',
      },
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

describe('season low fixes', () => {
  it('routes the first-to-seven overtime tip through the injected rng factory', () => {
    const base = createEngineContext();
    const seen: string[] = [];
    const spy = {
      ...base,
      rngFactory: (seed: string) => {
        seen.push(seed);
        return base.rngFactory(seed);
      },
    };
    let raced = false;
    for (const seedName of ['ot-probe-21', 'ot-probe-34', 'ot-probe-67', 'ot-probe-130']) {
      seen.length = 0;
      const input = buildInput(seedName, { gameRule: 'first-to-seven-overtime' });
      const result = simulateSeasonGame(input, spy);
      if (result.outcome !== 'completed' || result.overtimeRace === undefined) continue;
      raced = true;
      expect(seen).toContain(seasonNamespaceSeed(input.seed, 'overtime-tip'));
      const again = simulateSeasonGame(input, spy);
      expect(JSON.stringify(again)).toBe(JSON.stringify(result));
      break;
    }
    expect(raced).toBe(true);
  });

  it('audits with-effects results against an effects replay instead of a neutral one', () => {
    const input = withStamina(buildInput('fx-probe-0'));
    const state = fatiguedState(input);
    const context = createEngineContext();
    const first = simulateSeasonGameWithEffects(input, context, state);
    const second = simulateSeasonGameWithEffects(input, context, state);
    expect(JSON.stringify(second.result)).toBe(JSON.stringify(first.result));
    if (first.result.outcome !== 'completed') return;
    expect(
      checkSeasonGameResult(first.result, input).filter((failure) =>
        failure.startsWith('determinism:'),
      ),
    ).not.toEqual([]);
    expect(checkSeasonGameResult(first.result, input, { effectsState: state })).toEqual([]);
    expect(checkSeasonGameResult(first.result, input, state)).toEqual([]);
    expect(
      checkSeasonGameResult(first.result, input, { skipDeterminism: true }).filter((failure) =>
        failure.startsWith('determinism:'),
      ),
    ).toEqual([]);
  });

  it('rejects non-finite numeric input at the season game boundary', () => {
    const context = createEngineContext();
    const withNaNRating = buildInput('nan-rating');
    withNaNRating.home.players[0] = {
      ...withNaNRating.home.players[0]!,
      ratings: { ...withNaNRating.home.players[0]!.ratings, threePoint: NaN },
    };
    expect(() => simulateSeasonGame(withNaNRating, context)).toThrow(/non-finite/);
    const withInfiniteTendency = buildInput('inf-tendency');
    withInfiniteTendency.away.players[3] = {
      ...withInfiniteTendency.away.players[3]!,
      tendencies: { ...withInfiniteTendency.away.players[3]!.tendencies, usageRate: Infinity },
    };
    expect(() => simulateSeasonGame(withInfiniteTendency, context)).toThrow(/non-finite/);
    const withNaNStamina = withStamina(buildInput('nan-stamina'));
    withNaNStamina.home.players[1] = {
      ...withNaNStamina.home.players[1]!,
      stamina: { ...withNaNStamina.home.players[1]!.stamina!, rating: NaN },
    };
    expect(() => simulateSeasonGame(withNaNStamina, context)).toThrow(/non-finite/);
    expect(() =>
      simulateSeasonGameWithEffects(withNaNStamina, context, fatiguedState(withNaNStamina)),
    ).toThrow(/non-finite/);
  });

  it('keeps deep-four games auditing clean after the free-throw constant swap', () => {
    const input = buildInput('deep-four-lowfix', { gameRule: 'deep-four' });
    const result = simulateSeasonGame(input, createEngineContext());
    expect(result.outcome).toBe('completed');
    expect(checkSeasonGameResult(result, input)).toEqual([]);
  });

  it('collects tip availability without duplicating on a same-reference retry', () => {
    const { run, catalog } = buildTestRun();
    const schedule = scheduleOf(run);
    const game = seasonBlockGamesOf(schedule, 0).find(
      (entry) => entry.homeFranchiseId === 'lakers' || entry.awayFranchiseId === 'lakers',
    );
    if (game === undefined) throw new Error('no human game in block 0');
    const input = pipelineInput(run, catalog, 0);
    const args = { input, game, effects: input.effects, health: input.health };
    const first = simulateSeasonBlockGame(args);
    if ('interruption' in first) throw new Error('unexpected human interruption');
    const afterFirst = [...(input.collectedTipAvailability ?? [])];
    expect(afterFirst.filter((entry) => entry.gameId === game.gameId)).toHaveLength(1);
    const referenceBeforeRetry = input.collectedTipAvailability;
    const second = simulateSeasonBlockGame(args);
    if ('interruption' in second) throw new Error('unexpected human interruption on retry');
    expect(input.collectedTipAvailability).not.toBe(referenceBeforeRetry);
    expect(input.collectedTipAvailability).toEqual(afterFirst);
    expect(JSON.stringify(second.summary)).toBe(JSON.stringify(first.summary));
  });
});
