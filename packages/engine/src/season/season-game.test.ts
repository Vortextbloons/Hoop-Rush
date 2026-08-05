import { describe, expect, it } from 'vitest';
import {
  SEASON_ROTATION_PRESET_TARGETS,
  SEASON_ROTATION_VERSION,
  seasonGameSimulationResultSchema,
  playerVersionId,
  type Position,
  type SeasonGameSimulationInput,
  type SeasonGameTeamInput,
  type SeasonRotation,
  type SeasonRotationPreset,
  type SeasonRemoval,
} from '@hoop-rush/data-contracts';
import {
  buildEraSimulationProfile,
  buildSimulationPlayer,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../sim/context.ts';
import { checkSeasonGameResult, simulateSeasonGame } from './season-game.ts';

const ctx = createEngineContext();

/**
 * Ten-player Season fixture in a legal shape: slots 0-4 are the single
 * position starters (PG, SG, SF, PF, C); slots 5-9 are the bench (combo
 * guard, combo forward, wing, second center, big) so every rotation and
 * contingency stays legal. Both sides are equal by default (mirror of the
 * Classic equal fixture), so planner behavior is exercised symmetrically.
 */
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

function buildSeasonTeam(
  side: 'home' | 'away',
  overrides: Partial<SeasonGameTeamInput> = {},
): SeasonGameTeamInput {
  const franchiseId = side === 'home' ? 'lakers' : 'celtics';
  const players = POSITION_PLAN.map((positions, index) => {
    const playerId = `p-sg-${side}-${String(index + 1)}`;
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
    franchiseId,
    players,
    ...overrides,
  };
}

/** Authored v2 rotation: balanced preset targets, legal closing five. */
function buildSeasonRotation(team: SeasonGameTeamInput): SeasonRotation {
  const ids = team.players.map((p) => p.playerVersionId);
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
    // Legal ordered closing five: SG, combo-G, combo-F, wing, second C.
    closingFive: [ids[1], ids[5], ids[6], ids[7], ids[8]].map((id) => {
      if (id === undefined) throw new Error('fixture closing five missing player');
      return id;
    }),
    rotationVersion: SEASON_ROTATION_VERSION,
  };
}

function buildSeasonGameInput(
  overrides: Partial<SeasonGameSimulationInput> = {},
): SeasonGameSimulationInput {
  const home = buildSeasonTeam('home');
  const away = buildSeasonTeam('away');
  return {
    schemaVersion: 1,
    seed: seedFromString('season-game-1'),
    gameNumber: 1,
    dataVersion: 'data-v1',
    profile: buildEraSimulationProfile(),
    home,
    away,
    homeRotation: buildSeasonRotation(home),
    awayRotation: buildSeasonRotation(away),
    availability: [...home.players, ...away.players].map((p) => ({
      playerVersionId: p.playerVersionId,
      available: true,
    })),
    removals: [],
    ...overrides,
  };
}

function run(seed = 'season-game-1', overrides: Partial<SeasonGameSimulationInput> = {}) {
  const input = buildSeasonGameInput({ seed: seedFromString(seed), ...overrides });
  return { input, result: simulateSeasonGame(input, ctx) };
}

describe('season game controller (M2.2)', () => {
  it('completes a valid game and passes the full audit', () => {
    const { input, result } = run();
    expect(result.outcome).toBe('completed');
    expect(checkSeasonGameResult(result, input)).toEqual([]);
  });

  it('produces a byte-identical result for the same input and seed', () => {
    const input = buildSeasonGameInput();
    const a = simulateSeasonGame(input, ctx);
    const b = simulateSeasonGame(input, ctx);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('reconciles exact seconds: 14,400 per side in regulation plus 1,500 per OT', () => {
    for (const seed of ['seconds-1', 'seconds-2', 'seconds-3']) {
      const { result } = run(seed);
      if (result.outcome !== 'completed') continue;
      const expected = 14400 + result.overtimePeriods * 1500;
      for (const side of [result.home, result.away]) {
        const total = side.players.reduce((sum, p) => sum + p.seconds, 0);
        expect(total).toBe(expected);
        for (const player of side.players) {
          expect(Number.isInteger(player.seconds)).toBe(true);
          expect(player.minutes).toBe(player.seconds / 60);
        }
      }
    }
  });

  it('every rostered player plays under balanced targets (all targets positive)', () => {
    const { input, result } = run('rotation-1');
    if (result.outcome !== 'completed') throw new Error('expected a completed game');
    for (const side of [result.home, result.away]) {
      for (const player of side.players) {
        expect(player.seconds).toBeGreaterThan(0);
        void input;
      }
    }
  });

  it('starts with the configured starters at tipoff', () => {
    const { input, result } = run('tipoff-1');
    if (result.outcome !== 'completed') throw new Error('expected a completed game');
    for (const sideKey of ['home', 'away'] as const) {
      const rotation = sideKey === 'home' ? input.homeRotation : input.awayRotation;
      const firstStint = result.unitStints.find((s) => s.side === sideKey && s.period === 1);
      expect(firstStint).toBeDefined();
      expect(new Set(firstStint?.players)).toEqual(new Set(rotation.starters));
    }
  });

  it('runs real rotation substitutions with dead-ball timestamps', () => {
    const { result } = run('subs-1');
    if (result.outcome !== 'completed') throw new Error('expected a completed game');
    const subs = result.substitutions;
    expect(subs.length).toBeGreaterThan(0);
    expect(subs.some((s) => s.reason === 'rotation-plan')).toBe(true);
    for (const sub of subs) {
      expect(sub.period).toBeGreaterThanOrEqual(1);
      expect(sub.period).toBeLessThanOrEqual(12);
      expect(Number.isInteger(sub.secondsRemaining)).toBe(true);
      expect(sub.secondsRemaining).toBeGreaterThanOrEqual(0);
      expect(sub.secondsRemaining).toBeLessThanOrEqual(720);
      expect(new Set(sub.unit).size).toBe(5);
      expect(sub.unit).toContain(sub.playerIn);
      expect(sub.unit).not.toContain(sub.playerOut);
    }
  });

  it('plays everyone 48 minutes when targets force it (tight preset has bench at 5 min)', () => {
    // Tight preset: bench [20,14,9,7,5] — total 240, all positive.
    const { result } = run('tight-1', {
      homeRotation: buildSeasonRotationPreset(buildSeasonTeam('home'), 'tight'),
      awayRotation: buildSeasonRotationPreset(buildSeasonTeam('away'), 'tight'),
    });
    if (result.outcome !== 'completed') throw new Error('expected a completed game');
    for (const side of [result.home, result.away]) {
      const total = side.players.reduce((sum, p) => sum + p.seconds, 0);
      expect(total).toBe(14400 + result.overtimePeriods * 1500);
    }
  });

  it('foul-out: a fouled-out player sits at the next pause and keeps six fouls', () => {
    // One away defender with an extreme foul profile absorbs the team's
    // fouls and fouls out well within the game.
    const magnet = { strength: 95, interiorDefense: 95 };
    const magnetTendencies = { ...buildSimulationPlayer().tendencies, foulRate: 100 };
    const home = buildSeasonTeam('home');
    const away = buildSeasonTeam('away', {
      players: buildSeasonTeam('away').players.map((player, index) =>
        index === 4
          ? {
              ...player,
              ratings: { ...player.ratings, ...magnet },
              tendencies: { ...magnetTendencies },
            }
          : player,
      ),
    });
    let found: SeasonGameSimulationInput | null = null;
    let foundResult: ReturnType<typeof simulateSeasonGame> | null = null;
    for (let i = 0; i < 40 && found === null; i += 1) {
      const { input, result } = run(`foulout-${String(i)}`, { home, away });
      if (result.outcome === 'completed' && result.foulOuts.length > 0) {
        found = input;
        foundResult = result;
      }
    }
    expect(found).not.toBeNull();
    expect(foundResult).not.toBeNull();
    if (found === null || foundResult === null) {
      throw new Error('expected a game with a foul-out');
    }
    for (const event of foundResult.foulOuts) {
      expect(event.side).toBe('away');
      expect(event.playerVersionId).toBe(away.players[4]?.playerVersionId);
      const player = foundResult.away.players.find(
        (p) => p.playerVersionId === event.playerVersionId,
      );
      expect(player?.fouls).toBe(6);
    }
    expect(checkSeasonGameResult(foundResult, found)).toEqual([]);
    const outPlayer = foundResult.away.players.find(
      (p) => p.playerVersionId === away.players[4]?.playerVersionId,
    );
    expect(outPlayer?.seconds).toBeLessThan(14400);
  });

  it('injected removal applies at the next legal boundary and is recorded', () => {
    const away = buildSeasonTeam('away');
    const removalTarget = away.players[0];
    if (removalTarget === undefined) throw new Error('fixture missing player');
    const removal: SeasonRemoval = {
      side: 'away',
      playerVersionId: removalTarget.playerVersionId,
      period: 2,
      secondsRemaining: 360,
      reason: 'injected-injury-removal',
    };
    const { input, result } = run('removal-1', {
      away,
      awayRotation: buildSeasonRotation(away),
      removals: [removal],
    });
    if (result.outcome !== 'completed') throw new Error('expected a completed game');
    const events = result.removals.filter((r) => r.side === 'away');
    expect(events.length).toBe(1);
    const event = events[0];
    if (event === undefined) throw new Error('expected a removal event');
    expect(event.playerVersionId).toBe(removalTarget.playerVersionId);
    expect(event.period).toBe(2);
    expect(event.secondsRemaining).toBeLessThanOrEqual(360);
    // The removed player never plays past the removal boundary.
    for (const stint of result.unitStints.filter((s) => s.side === 'away')) {
      if (!stint.players.includes(removalTarget.playerVersionId)) continue;
      if (stint.period > 2) throw new Error('removed player played after the removal');
      if (stint.period === 2 && stint.endSecondsRemaining > 360) {
        throw new Error('removed player played past the removal clock');
      }
    }
    const deviation = result.deviations.find(
      (d) => d.side === 'away' && d.playerVersionId === removalTarget.playerVersionId,
    );
    expect(deviation?.reasons).toContain('injected-injury-removal');
    expect(checkSeasonGameResult(result, input)).toEqual([]);
  });

  it('pregame unavailability selects a contingency unit and marks causes', () => {
    const home = buildSeasonTeam('home');
    const unavailable = home.players[0];
    if (unavailable === undefined) throw new Error('fixture missing player');
    const availability = [...home.players, ...buildSeasonTeam('away').players].map((p) => ({
      playerVersionId: p.playerVersionId,
      available: p.playerVersionId !== unavailable.playerVersionId,
    }));
    const { input, result } = run('unavail-1', { home, availability });
    if (result.outcome !== 'completed') throw new Error('expected a completed game');
    const firstStint = result.unitStints.find((s) => s.side === 'home' && s.period === 1);
    expect(firstStint?.players).not.toContain(unavailable.playerVersionId);
    const deviation = result.deviations.find(
      (d) => d.side === 'home' && d.playerVersionId === unavailable.playerVersionId,
    );
    expect(deviation).toBeDefined();
    expect(deviation?.reasons).toContain('pregame-unavailable');
    expect(deviation?.actualSeconds).toBe(0);
    // The contingency replacement carries the contingency-legality cause.
    const replacement = firstStint?.players.find(
      (id) => !homeRotationStarters(input, 'home').includes(id),
    );
    const replacementDeviation = result.deviations.find(
      (d) => d.side === 'home' && d.playerVersionId === replacement,
    );
    expect(replacementDeviation?.reasons).toContain('contingency-legality');
    expect(checkSeasonGameResult(result, input)).toEqual([]);
  });

  it('two historical versions of one person stay separate on one roster', () => {
    const home = buildSeasonTeam('home');
    const sharedPlayerId = 'p-shared-person';
    const twin0 = {
      ...(home.players[0] as NonNullable<SeasonGameTeamInput['players'][number]>),
      playerId: sharedPlayerId,
    };
    const twin5 = {
      ...(home.players[5] as NonNullable<SeasonGameTeamInput['players'][number]>),
      playerId: sharedPlayerId,
    };
    const players = home.players.map((p, index) => (index === 0 ? twin0 : index === 5 ? twin5 : p));
    const { input, result } = run('twins-1', { home: { ...home, players } });
    if (result.outcome !== 'completed') throw new Error('expected a completed game');
    const records = result.home.players.filter((p) => p.playerId === sharedPlayerId);
    expect(records.length).toBe(2);
    expect(records[0]?.playerVersionId).toBe(twin0.playerVersionId);
    expect(records[1]?.playerVersionId).toBe(twin5.playerVersionId);
    // Distinct roster records: each version owns its own line.
    const seconds = records.map((r) => r.seconds);
    expect(seconds[0]).toBeGreaterThan(0);
    expect(seconds[1]).toBeGreaterThan(0);
    expect(checkSeasonGameResult(result, input)).toEqual([]);
  });

  it('emits deviations with non-empty reasons and balanced seconds', () => {
    const { input, result } = run('dev-1');
    if (result.outcome !== 'completed') throw new Error('expected a completed game');
    expect(result.deviations.length).toBeGreaterThan(0);
    for (const deviation of result.deviations) {
      expect(deviation.reasons.length).toBeGreaterThan(0);
      expect(deviation.actualSeconds).not.toBe(deviation.targetSeconds);
    }
    for (const sideKey of ['home', 'away'] as const) {
      const balance = result.deviations
        .filter((d) => d.side === sideKey)
        .reduce((sum, d) => sum + d.actualSeconds - d.targetSeconds, 0);
      expect(balance).toBe(0);
    }
    void input;
  });

  it('finds overtime games and keeps every invariant', () => {
    let found: SeasonGameSimulationInput | null = null;
    let foundResult: ReturnType<typeof simulateSeasonGame> | null = null;
    for (let i = 0; i < 200 && found === null; i += 1) {
      const { input, result } = run(`season-ot-${String(i)}`);
      if (result.outcome === 'completed' && result.overtimePeriods > 0) {
        found = input;
        foundResult = result;
      }
    }
    expect(found).not.toBeNull();
    if (found === null || foundResult === null) {
      throw new Error('expected to find an overtime game across seeds');
    }
    expect(foundResult.home.periodScores.length).toBe(4 + foundResult.overtimePeriods);
    expect(checkSeasonGameResult(foundResult, found)).toEqual([]);
  });

  it('finds closing-window games and keeps every invariant', () => {
    let found: SeasonGameSimulationInput | null = null;
    let foundResult: ReturnType<typeof simulateSeasonGame> | null = null;
    for (let i = 0; i < 200 && found === null; i += 1) {
      const { input, result } = run(`closing-${String(i)}`);
      if (
        result.outcome === 'completed' &&
        result.substitutions.some((s) => s.reason === 'closing-preference')
      ) {
        found = input;
        foundResult = result;
      }
    }
    expect(found).not.toBeNull();
    if (found === null || foundResult === null) {
      throw new Error('expected to find a closing-window game across seeds');
    }
    expect(checkSeasonGameResult(foundResult, found)).toEqual([]);
  });

  it('completed results parse against the Season result schema', () => {
    const { result } = run('schema-1');
    const parsed = seasonGameSimulationResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });
});

describe('season game forfeits (M2.2)', () => {
  function allCenters(side: 'home' | 'away'): SeasonGameTeamInput {
    const base = buildSeasonTeam(side);
    return {
      ...base,
      players: base.players.map((player, index) => ({
        ...player,
        positions: ['C'] as Position[],
        playerVersionId: playerVersionId(
          `p-sg-${side}-c-${String(index)}`,
          base.franchiseId,
          '1990s',
          '1995-96',
        ),
      })),
    };
  }

  it('forfeits 2-0 when one team cannot field a legal five at tipoff', () => {
    const away = allCenters('away');
    const { input, result } = run('forfeit-away', {
      away,
      awayRotation: buildSeasonRotation(away),
    });
    expect(result.outcome).toBe('forfeit');
    if (result.outcome !== 'forfeit') throw new Error('expected a forfeit');
    expect(result.winner).toBe('home');
    expect(result.losingFranchiseId).toBe('celtics');
    expect(result.trigger).toBe('no-legal-five-tipoff');
    expect(result.homeScore).toBe(2);
    expect(result.awayScore).toBe(0);
    expect(checkSeasonGameResult(result, input)).toEqual([]);
    const parsed = seasonGameSimulationResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it('records an away winner when the home team forfeits', () => {
    const home = allCenters('home');
    const { input, result } = run('forfeit-home', {
      home,
      homeRotation: buildSeasonRotation(home),
    });
    expect(result.outcome).toBe('forfeit');
    if (result.outcome !== 'forfeit') throw new Error('expected a forfeit');
    expect(result.winner).toBe('away');
    expect(result.losingFranchiseId).toBe('lakers');
    expect(result.homeScore).toBe(0);
    expect(result.awayScore).toBe(2);
    expect(checkSeasonGameResult(result, input)).toEqual([]);
  });

  it('returns no-legal-five-both when both teams are invalid before tipoff', () => {
    const { input, result } = run('both-invalid', {
      home: allCenters('home'),
      away: allCenters('away'),
      homeRotation: buildSeasonRotation(allCenters('home')),
      awayRotation: buildSeasonRotation(allCenters('away')),
    });
    expect(result.outcome).toBe('no-legal-five-both');
    expect(checkSeasonGameResult(result, input)).toEqual([]);
  });

  it('forfeits after an injected removal leaves no legal five', () => {
    const away = buildSeasonTeam('away');
    const centers = away.players
      .filter((p) => p.positions.includes('C'))
      .slice(0, 3)
      .map((p) => p.playerVersionId);
    expect(centers.length).toBe(3);
    const removals: SeasonRemoval[] = centers.map((playerVersionId, index) => ({
      side: 'away',
      playerVersionId,
      period: 1,
      secondsRemaining: 600 - index,
      reason: 'injected-injury-removal',
    }));
    const { input, result } = run('forfeit-removal', { away, removals });
    expect(result.outcome).toBe('forfeit');
    if (result.outcome !== 'forfeit') throw new Error('expected a forfeit');
    expect(result.winner).toBe('home');
    expect(result.losingFranchiseId).toBe('celtics');
    expect(result.trigger).toBe('no-legal-five-after-removal');
    expect(checkSeasonGameResult(result, input)).toEqual([]);
  });
});

function buildSeasonRotationPreset(team: SeasonGameTeamInput, preset: SeasonRotationPreset) {
  const rotation = buildSeasonRotation(team);
  const targets = SEASON_ROTATION_PRESET_TARGETS[preset];
  return {
    ...rotation,
    targetMinutes: [
      ...rotation.starters.map((playerVersionId) => ({
        playerVersionId,
        minutes: targets.starters,
      })),
      ...rotation.benchOrder.map((playerVersionId, index) => ({
        playerVersionId,
        minutes: targets.bench[index] ?? 0,
      })),
    ],
  };
}

function homeRotationStarters(input: SeasonGameSimulationInput, sideKey: 'home' | 'away') {
  return sideKey === 'home' ? input.homeRotation.starters : input.awayRotation.starters;
}
