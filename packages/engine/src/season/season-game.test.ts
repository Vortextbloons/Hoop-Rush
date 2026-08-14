import { describe, expect, it } from 'vitest';
import {
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_NEUTRAL_HOME_COURT,
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
import { checkSeasonGameResult } from './season-game-audit.ts';
import { simulateSeasonGame } from './season-game.ts';

const ctx = createEngineContext();

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

    closingFive: [ids[1], ids[5], ids[6], ids[7], ids[8]].map((id) => {
      if (id === undefined) throw new Error('fixture closing five missing player');
      return id;
    }),
    minutePolicy: { policyVersion: SEASON_MINUTE_POLICY_VERSION, strategy: 'balanced' },
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
    returns: [],
    homeCourt: SEASON_NEUTRAL_HOME_COURT,
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
      if (
        result.outcome === 'completed' &&
        result.foulOuts.some(
          (event) =>
            event.side === 'away' && event.playerVersionId === away.players[4]?.playerVersionId,
        )
      ) {
        found = input;
        foundResult = result;
      }
    }
    expect(found).not.toBeNull();
    expect(foundResult).not.toBeNull();
    if (found === null || foundResult === null) {
      throw new Error('expected a game with a foul-out');
    }
    const magnetEvent = foundResult.foulOuts.find(
      (event) =>
        event.side === 'away' && event.playerVersionId === away.players[4]?.playerVersionId,
    );
    expect(magnetEvent).toBeDefined();
    const magnetPlayer = foundResult.away.players.find(
      (player) => player.playerVersionId === away.players[4]?.playerVersionId,
    );
    expect(magnetPlayer?.fouls).toBe(6);
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

  it('applies same-period removals in descending game-clock order', () => {
    const away = buildSeasonTeam('away');
    const early = away.players[0];
    const late = away.players[1];
    if (early === undefined || late === undefined) throw new Error('fixture missing starters');
    const { result } = run('removal-order', {
      away,
      awayRotation: buildSeasonRotation(away),
      removals: [
        {
          side: 'away',
          playerVersionId: late.playerVersionId,
          period: 2,
          secondsRemaining: 120,
          reason: 'injected-injury-removal',
        },
        {
          side: 'away',
          playerVersionId: early.playerVersionId,
          period: 2,
          secondsRemaining: 600,
          reason: 'injected-injury-removal',
        },
      ],
    });
    if (result.outcome !== 'completed') throw new Error('expected a completed game');
    const earlyEvent = result.removals.find(
      (event) => event.playerVersionId === early.playerVersionId,
    );
    const lateEvent = result.removals.find(
      (event) => event.playerVersionId === late.playerVersionId,
    );
    expect(earlyEvent?.secondsRemaining).toBeGreaterThan(lateEvent?.secondsRemaining ?? 0);
    expect(earlyEvent?.secondsRemaining).toBeLessThanOrEqual(600);
    expect(lateEvent?.secondsRemaining).toBeLessThanOrEqual(120);
  });

  it('defers a bench injury until the player has actual court exposure', () => {
    const away = buildSeasonTeam('away');
    const benchPlayer = away.players[9];
    if (benchPlayer === undefined) throw new Error('fixture missing bench player');
    const { result } = run('bench-removal-exposure', {
      away,
      awayRotation: buildSeasonRotation(away),
      removals: [
        {
          side: 'away',
          playerVersionId: benchPlayer.playerVersionId,
          period: 1,
          secondsRemaining: 700,
          reason: 'injected-injury-removal',
        },
      ],
    });
    if (result.outcome !== 'completed') throw new Error('expected a completed game');
    const event = result.removals.find(
      (removal) => removal.playerVersionId === benchPlayer.playerVersionId,
    );
    expect(event).toBeDefined();
    expect(event?.secondsRemaining).toBeLessThan(700);
    const player = result.away.players.find(
      (row) => row.playerVersionId === benchPlayer.playerVersionId,
    );
    expect(player?.seconds).toBeGreaterThan(0);
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

describe('season game returns (M2.5 §11)', () => {
  it('applies a same-game return at the next legal boundary after the removal', () => {
    const away = buildSeasonTeam('away');
    const target = away.players[0];
    if (target === undefined) throw new Error('fixture missing player');
    const { input, result } = run('return-1', {
      away,
      awayRotation: buildSeasonRotation(away),
      removals: [
        {
          side: 'away',
          playerVersionId: target.playerVersionId,
          period: 2,
          secondsRemaining: 600,
          reason: 'injury',
        },
      ],
      returns: [
        {
          side: 'away',
          playerVersionId: target.playerVersionId,
          period: 2,
          secondsRemaining: 300,
          reason: 'injury-return',
        },
      ],
    });
    if (result.outcome !== 'completed') throw new Error('expected a completed game');
    const removalEvents = result.removals.filter(
      (event) => event.playerVersionId === target.playerVersionId,
    );
    expect(removalEvents).toHaveLength(1);
    expect(removalEvents[0]?.reason).toBe('injury');
    const returnEvents = result.away.returns.filter(
      (event) => event.playerVersionId === target.playerVersionId,
    );
    expect(returnEvents).toHaveLength(1);
    const returnEvent = returnEvents[0];
    if (returnEvent === undefined) throw new Error('expected a return event');
    expect(returnEvent.reason).toBe('injury-return');
    expect(returnEvent.period).toBe(2);

    expect(returnEvent.secondsRemaining).toBeLessThanOrEqual(300);

    const stints = result.unitStints.filter((stint) => stint.side === 'away');
    const playedAfter = stints.some(
      (stint) =>
        stint.players.includes(target.playerVersionId) &&
        (stint.period > returnEvent.period ||
          (stint.period === returnEvent.period &&
            stint.startSecondsRemaining <= returnEvent.secondsRemaining)),
    );
    expect(playedAfter).toBe(true);
    const deviation = result.deviations.find(
      (entry) => entry.side === 'away' && entry.playerVersionId === target.playerVersionId,
    );
    expect(deviation?.reasons).toContain('injected-injury-removal');
    expect(deviation?.reasons).toContain('injury-return');
    expect(checkSeasonGameResult(result, input)).toEqual([]);
  });

  it('a return clock before the removal clock records both events without violating invariants', () => {
    const away = buildSeasonTeam('away');
    const target = away.players[1];
    if (target === undefined) throw new Error('fixture missing player');
    const { input, result } = run('return-2', {
      away,
      awayRotation: buildSeasonRotation(away),
      removals: [
        {
          side: 'away',
          playerVersionId: target.playerVersionId,
          period: 3,
          secondsRemaining: 300,
          reason: 'injury',
        },
      ],
      returns: [
        {
          side: 'away',
          playerVersionId: target.playerVersionId,
          period: 3,
          secondsRemaining: 400,
          reason: 'injury-return',
        },
      ],
    });
    if (result.outcome !== 'completed') throw new Error('expected a completed game');
    expect(
      result.away.returns.some((event) => event.playerVersionId === target.playerVersionId),
    ).toBe(true);
    expect(
      result.removals.some(
        (event) => event.playerVersionId === target.playerVersionId && event.reason === 'injury',
      ),
    ).toBe(true);
    expect(checkSeasonGameResult(result, input)).toEqual([]);
  });

  it('an injury-reason removal flows through the existing removal path', () => {
    const away = buildSeasonTeam('away');
    const target = away.players[2];
    if (target === undefined) throw new Error('fixture missing player');
    const { input, result } = run('return-3', {
      away,
      awayRotation: buildSeasonRotation(away),
      removals: [
        {
          side: 'away',
          playerVersionId: target.playerVersionId,
          period: 1,
          secondsRemaining: 600,
          reason: 'injury',
        },
      ],
    });
    if (result.outcome !== 'completed') throw new Error('expected a completed game');
    const event = result.removals.find((entry) => entry.playerVersionId === target.playerVersionId);
    expect(event?.reason).toBe('injury');
    const deviation = result.deviations.find(
      (entry) => entry.side === 'away' && entry.playerVersionId === target.playerVersionId,
    );
    expect(deviation?.reasons).toContain('injected-injury-removal');
    expect(result.away.returns).toEqual([]);
    expect(checkSeasonGameResult(result, input)).toEqual([]);
  });

  it('zero injury input stays byte-identical with empty return records', () => {
    const input = buildSeasonGameInput();
    const a = simulateSeasonGame(input, ctx);
    const b = simulateSeasonGame(input, ctx);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    if (a.outcome !== 'completed') throw new Error('expected a completed game');
    expect(a.home.returns).toEqual([]);
    expect(a.away.returns).toEqual([]);
    expect(checkSeasonGameResult(a, input)).toEqual([]);
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
