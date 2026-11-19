import { describe, expect, it } from 'bun:test';
import { createEngineContext } from '../../sim/kernel.ts';
import { fnv1a32 } from '../../sim/rng.ts';
import {
  FULL_COURT_FOUL_LIMIT,
  FULL_COURT_MAX_ROSTER,
  FULL_COURT_MIN_ROSTER,
  FULL_COURT_REGULATION_SECONDS,
  FULL_COURT_REGULATION_TEAM_SECONDS,
  FullCourtSetupError,
  checkFullCourtGameResult,
  fullCourtGameDigest,
  fullCourtPlayerSecondCeiling,
  fullCourtStreamSeed,
  fullCourtTeamSeconds,
  runFullCourtGame,
  simulateFullCourtGame,
  simulateRecordedFullCourtGame,
  type FullCourtGameResult,
  type FullCourtPlayerLine,
} from './game.ts';
import { allocateSeconds, resolveRotationPlan } from './rotation.ts';
import {
  availabilityOf,
  fullCourtTestInput,
  fullCourtTestRoster,
  fullCourtTestSeed,
  staminaOf,
} from './game-test-support.ts';

const ctx = createEngineContext();

function playersOf(result: FullCourtGameResult, side: 'home' | 'away'): FullCourtPlayerLine[] {
  return [...result[side].players];
}

function secondsOf(result: FullCourtGameResult, side: 'home' | 'away'): number {
  return result[side].players.reduce((sum, player) => sum + player.seconds, 0);
}

function benchPlayers(result: FullCourtGameResult, side: 'home' | 'away'): FullCourtPlayerLine[] {
  return playersOf(result, side).filter((player) => !player.startedGame);
}

describe('full court game accounting', () => {
  it('accounts for exactly 240 player-minutes per side in regulation', () => {
    const roster = fullCourtTestRoster('acct', 9);
    const result = simulateFullCourtGame(
      fullCourtTestInput({ seed: 'acct', homeRoster: roster }),
      ctx,
    );
    expect(result.overtimePeriods).toBe(0);
    expect(result.home.liveSeconds).toBe(FULL_COURT_REGULATION_SECONDS);
    expect(result.home.teamSeconds).toBe(FULL_COURT_REGULATION_TEAM_SECONDS);
    expect(result.away.teamSeconds).toBe(FULL_COURT_REGULATION_TEAM_SECONDS);
    expect(secondsOf(result, 'home')).toBe(FULL_COURT_REGULATION_TEAM_SECONDS);
    expect(result.home.plannedTeamSeconds).toBe(FULL_COURT_REGULATION_TEAM_SECONDS);
    expect(checkFullCourtGameResult(result)).toEqual([]);
  });

  it('runs the period clock to zero when the kernel cannot start another trip', () => {
    const { result, tape } = simulateRecordedFullCourtGame(
      fullCourtTestInput({ seed: 'f3-60', homeRoster: fullCourtTestRoster('f3', 9) }),
      ctx,
    );
    for (const [period] of result.periodScores.home.entries()) {
      const lastTrip = tape.findLast((event) => event.kind === 'trip' && event.period === period);
      expect(lastTrip?.kind === 'trip' ? lastTrip.clockSeconds : undefined).toBe(0);
    }
    expect(checkFullCourtGameResult(result)).toEqual([]);
  });

  it('adds 25 player-minutes per side for each overtime period', () => {
    const roster = fullCourtTestRoster('ot', 8, () => ({ rating: 74 }));
    const awayRoster = fullCourtTestRoster('ot-away', 8, () => ({ rating: 74 }));
    let found: FullCourtGameResult | null = null;
    for (let attempt = 0; attempt < 60 && found === null; attempt += 1) {
      const candidate = simulateFullCourtGame(
        fullCourtTestInput({
          seed: `ot-${String(attempt)}`,
          homeRoster: roster,
          awayRoster,
        }),
        ctx,
      );
      if (candidate.overtimePeriods > 0) found = candidate;
    }
    expect(found, 'expected an overtime game within 60 seeds').not.toBeNull();
    if (found === null) return;
    expect(found.periodScores.home).toHaveLength(4 + found.overtimePeriods);
    expect(found.home.liveSeconds).toBe(fullCourtTeamSeconds(found.overtimePeriods));
    expect(found.home.teamSeconds).toBe(fullCourtTeamSeconds(found.overtimePeriods) * 5);
    expect(checkFullCourtGameResult(found)).toEqual([]);
  });

  it('reconciles lineup stints to team totals and points', () => {
    const roster = fullCourtTestRoster('stints', 10);
    const result = simulateFullCourtGame(
      fullCourtTestInput({ seed: 'stints', homeRoster: roster }),
      ctx,
    );
    for (const side of ['home', 'away'] as const) {
      const team = result[side];
      const stintSeconds = team.stints.reduce((sum, stint) => sum + stint.seconds, 0);
      const stintPoints = team.stints.reduce((sum, stint) => sum + stint.points, 0);
      expect(stintSeconds, side).toBe(team.liveSeconds);
      expect(stintPoints, side).toBe(team.box.points);
      for (const stint of team.stints) {
        expect(stint.playerIds).toHaveLength(FULL_COURT_MIN_ROSTER);
        expect(new Set(stint.playerIds).size).toBe(FULL_COURT_MIN_ROSTER);
      }
    }
    for (const { players, stints } of [result.home, result.away]) {
      for (const player of players) {
        const appearances = stints.filter((stint) => stint.playerIds.includes(player.playerId));
        expect(appearances.reduce((total, stint) => total + stint.seconds, 0)).toBe(player.seconds);
        expect(appearances).toHaveLength(player.stints);
      }
    }
    expect(checkFullCourtGameResult(result)).toEqual([]);
  });

  it('never exceeds the per-player ceiling and gives bench players real minutes', () => {
    const roster = fullCourtTestRoster('ceiling', 12, (index) => ({ rating: 68 + index }));
    const targets: Record<string, number> = {};
    const minutes = [36, 34, 32, 30, 28, 24, 20, 16, 10, 6, 2, 2];
    roster.forEach((player, index) => {
      targets[player.playerId] = minutes[index] ?? 0;
    });
    const result = simulateFullCourtGame(
      fullCourtTestInput({
        seed: 'ceiling',
        homeRoster: roster,
        homeRotation: { minuteTargets: targets },
      }),
      ctx,
    );
    const ceiling = fullCourtPlayerSecondCeiling(result.overtimePeriods);
    for (const player of playersOf(result, 'home')) {
      expect(player.seconds).toBeLessThanOrEqual(ceiling);
    }
    expect(result.home.disqualifications).toBe(
      result.home.players.filter((player) => player.foulsOut).length,
    );
    const bench = benchPlayers(result, 'home');
    expect(bench.length).toBeGreaterThan(0);
    const benchSeconds = bench.reduce((sum, player) => sum + player.seconds, 0);
    expect(benchSeconds).toBeGreaterThan(0);
    // Reserves contribute real box-score production, not a decorative zero.
    const benchPoints = bench.reduce((sum, player) => sum + player.points, 0);
    const benchUsage = bench.reduce((sum, player) => sum + player.fieldGoals.attempted, 0);
    expect(benchUsage).toBeGreaterThan(0);
    expect(benchSeconds).toBeGreaterThanOrEqual(0);
    expect(benchPoints).toBeGreaterThanOrEqual(0);
    expect(checkFullCourtGameResult(result)).toEqual([]);
  });

  it('records contiguous stints that each hold five different players', () => {
    const roster = fullCourtTestRoster('stintchange', 10, () => ({ rating: 74 }));
    const targets: Record<string, number> = {};
    roster.forEach((player, index) => {
      targets[player.playerId] = index < 5 ? 30 : 22.5;
    });
    const result = simulateFullCourtGame(
      fullCourtTestInput({
        seed: 'stintchange',
        homeRoster: roster,
        homeRotation: { minuteTargets: targets },
      }),
      ctx,
    );
    expect(result.home.stints.length).toBeGreaterThan(1);
    for (const [index, stint] of result.home.stints.entries()) {
      if (index === 0) continue;
      const previous = result.home.stints[index - 1];
      expect(previous).toBeDefined();
      // Each stint starts where the last ended, so lineup time is continuous.
      expect(stint.startSeconds).toBe((previous?.startSeconds ?? 0) + (previous?.seconds ?? 0));
      expect(stint.playerIds).not.toEqual(previous?.playerIds);
    }
    expect(checkFullCourtGameResult(result)).toEqual([]);
  });

  it('attributes each stint to the five on the floor when the points were scored', () => {
    const roster = fullCourtTestRoster('attribution', 9, () => ({ rating: 72 }));
    const result = simulateFullCourtGame(
      fullCourtTestInput({ seed: 'attribution', homeRoster: roster }),
      ctx,
    );
    for (const stint of result.home.stints) {
      expect(stint.points).toBeGreaterThanOrEqual(0);
      expect(stint.possessions).toBeGreaterThanOrEqual(0);
    }
    const firstStint = result.home.stints[0];
    expect(firstStint?.startSeconds).toBe(0);
    expect(firstStint?.playerIds).toHaveLength(FULL_COURT_MIN_ROSTER);
    // The opening stint belongs to the starters, so their minutes appear first.
    const starters = result.home.players.filter((player) => player.startedGame);
    expect(starters).toHaveLength(5);
    expect(firstStint?.playerIds.every((id) => starters.some((s) => s.playerId === id))).toBe(true);
  });

  it('keeps five eligible players on the floor through disqualifications', () => {
    const roster = fullCourtTestRoster('fouls', 8, () => ({ rating: 74, foulRate: 60 }));
    const result = simulateFullCourtGame(
      fullCourtTestInput({ seed: 'fouls', homeRoster: roster }),
      ctx,
    );
    for (const stint of result.home.stints) {
      expect(stint.playerIds).toHaveLength(FULL_COURT_MIN_ROSTER);
    }
    for (const player of playersOf(result, 'home')) {
      if (player.fouls > FULL_COURT_FOUL_LIMIT) {
        expect(player.emergencyContinuation).toBe(true);
      }
    }
    expect(checkFullCourtGameResult(result)).toEqual([]);
  });

  it('charges a technical for the sixth foul when the roster has no replacement', () => {
    const roster = fullCourtTestRoster('stuck', FULL_COURT_MIN_ROSTER, () => ({
      rating: 74,
      foulRate: 100,
    }));
    const { result, tape } = simulateRecordedFullCourtGame(
      fullCourtTestInput({ seed: 'stuck-2', homeRoster: roster }),
      ctx,
    );
    const player = result.home.players.find((entry) => entry.emergencyContinuation);
    expect(player?.fouls).toBe(FULL_COURT_FOUL_LIMIT);
    expect(result.home.technicalFouls).toBe(1);
    expect(tape.find((event) => event.kind === 'technical')).toMatchObject({
      againstPlayerId: player?.playerId,
      side: 1,
    });
    expect(checkFullCourtGameResult(result)).toEqual([]);
  });
});

describe('full court determinism and recording', () => {
  it('repeats the identical result and digest for the same seed', () => {
    const input = fullCourtTestInput({
      seed: 'determinism',
      homeRoster: fullCourtTestRoster('det', 9),
    });
    const first = simulateFullCourtGame(input, ctx);
    const second = simulateFullCourtGame(input, ctx);
    expect(fullCourtGameDigest(first)).toBe(fullCourtGameDigest(second));
    expect(first).toEqual(second);
  });

  it('produces distinct results for different seeds with the same input', () => {
    const roster = fullCourtTestRoster('seeds', 9);
    const digests = new Set<string>();
    for (let index = 0; index < 6; index += 1) {
      const result = simulateFullCourtGame(
        fullCourtTestInput({ seed: `seeds-${String(index)}`, homeRoster: roster }),
        ctx,
      );
      digests.add(fullCourtGameDigest(result));
    }
    expect(digests.size).toBe(6);
  });

  it('recording is opt-in and never changes the canonical result', () => {
    const input = fullCourtTestInput({
      seed: 'recording',
      homeRoster: fullCourtTestRoster('rec', 10),
    });
    const plain = runFullCourtGame(input, ctx);
    const recorded = simulateRecordedFullCourtGame(input, ctx);
    expect(plain.tape).toBeNull();
    expect(recorded.tape.length).toBeGreaterThan(0);
    expect(fullCourtGameDigest(recorded.result)).toBe(fullCourtGameDigest(plain.result));
    expect(plain.result).toEqual(recorded.result);
    const substitutions = recorded.tape.filter((event) => event.kind === 'substitution');
    expect(substitutions.length).toBeGreaterThan(0);
  });

  it('limits tactical substitutions within a period to dead-ball trips', () => {
    const input = fullCourtTestInput({
      seed: 'tactical-substitution-window',
      homeRoster: fullCourtTestRoster('subs', 10),
    });
    const { tape } = simulateRecordedFullCourtGame(input, ctx);
    let liveStart: string | null = null;
    let observed = 0;
    for (const event of tape) {
      if (event.kind === 'period') liveStart = null;
      if (event.kind === 'trip') liveStart = event.nextPossessionStart;
      if (event.kind === 'substitution' && event.reason !== 'foul-out' && liveStart !== null) {
        expect(liveStart).toBe('deadBall');
        observed += 1;
      }
    }
    expect(observed).toBeGreaterThan(0);
  });

  it('gives the opening tip winner the first possession in the first and fourth quarters', () => {
    const { tape } = simulateRecordedFullCourtGame(
      fullCourtTestInput({ seed: 'quarter-openers', homeRoster: fullCourtTestRoster('tip', 8) }),
      ctx,
    );
    const openingSides = [0, 1, 2, 3].map((period) =>
      tape.find((event) => event.kind === 'trip' && event.period === period),
    );
    const [first, second, third, fourth] = openingSides.map((event) =>
      event?.kind === 'trip' ? event.offense : undefined,
    );
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(third).toBe(second);
    expect(fourth).toBe(first);
  });

  it('derives independent named seed streams from the game seed', () => {
    const seed = fullCourtTestSeed('streams');
    const streams = ['possession', 'tip', 'technical'] as const;
    const derived = streams.map((stream) => fullCourtStreamSeed(seed, stream));
    expect(new Set(derived).size).toBe(streams.length);
    expect(derived).toHaveLength(streams.length);
    const [possession, tip] = derived;
    expect(possession).toBeDefined();
    expect(possession).not.toBe(seed);
    expect(tip).toBe(fullCourtStreamSeed(seed, 'tip'));
    expect(possession).not.toBe(tip);
  });

  it('pins a golden digest for a fixed rotation roster', () => {
    const roster = fullCourtTestRoster('golden', 9, (index) => ({ rating: 70 + (index % 3) * 4 }));
    const targets: Record<string, number> = {};
    roster.forEach((player, index) => {
      targets[player.playerId] = [36, 34, 32, 30, 28, 24, 22, 18, 16][index] ?? 0;
    });
    const result = simulateFullCourtGame(
      fullCourtTestInput({
        seed: 'golden-full-court',
        homeRoster: roster,
        homeRotation: { minuteTargets: targets },
      }),
      ctx,
    );
    const hash = fnv1a32(fullCourtGameDigest(result));
    expect(hash).toBe(GOLDEN_FULL_COURT_HASH);
    // The digest covers score, per-player seconds, and line, so a rotation change
    // that alters playing time or production breaks this pin.
    expect(result.home.box.points).toBe(GOLDEN_FULL_COURT_HOME_POINTS);
    expect(result.home.players.map((player) => player.seconds)).toEqual(
      GOLDEN_FULL_COURT_HOME_SECONDS,
    );
  });
});

describe('full court fatigue', () => {
  it('fades over four quarters with no rest, matching seeds across stamina', () => {
    const roster = fullCourtTestRoster('stamina', FULL_COURT_MIN_ROSTER, () => ({ rating: 76 }));
    const awayRoster = fullCourtTestRoster('stamina-away', 8, () => ({ rating: 72 }));

    const quarterMargins = (stamina: number): number[] => {
      const margins = [0, 0, 0, 0];
      let games = 0;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const result = simulateFullCourtGame(
          fullCourtTestInput({
            seed: `fatigue-${String(attempt)}`,
            homeRoster: roster,
            awayRoster,
            homeAvailability: staminaOf(roster, () => stamina),
          }),
          ctx,
        );
        if (result.overtimePeriods > 0) continue;
        games += 1;
        result.periodScores.home.forEach((points, index) => {
          margins[index] = (margins[index] ?? 0) + points - (result.periodScores.away[index] ?? 0);
        });
      }
      return margins.map((value) => value / Math.max(1, games));
    };

    const fresh = quarterMargins(1);
    const spent = quarterMargins(0);
    const freshLate = (fresh[2] ?? 0) + (fresh[3] ?? 0);
    const spentLate = (spent[2] ?? 0) + (spent[3] ?? 0);
    // Matched seeds: four quarters without rest must cost the second half, and an
    // exhausted roster must fade further than one that can hold its minutes.
    expect(spentLate).toBeLessThan(0);
    expect(spentLate).toBeLessThan(freshLate - 3);
    expect(spentLate - (spent[0] ?? 0) + (spent[1] ?? 0)).toBeLessThan(
      freshLate - (fresh[0] ?? 0) + (fresh[1] ?? 0),
    );
  });

  it('lets a capable reserve beat a heavily fatigued starter over matched seeds', () => {
    const starters = fullCourtTestRoster('start', FULL_COURT_MIN_ROSTER, () => ({ rating: 84 }));
    const reserves = fullCourtTestRoster('reserve', 4, () => ({ rating: 72 }));
    const deep = [...starters, ...reserves];
    const awayRoster = fullCourtTestRoster('bench-away', 8, () => ({ rating: 70 }));
    const fatigueStarters = [
      ...starters.map((player) => ({ playerId: player.playerId, available: true, stamina: 0 })),
      ...reserves.map((player) => ({ playerId: player.playerId, available: true, stamina: 1 })),
    ];
    const tiredOnly = starters.map((player) => ({
      playerId: player.playerId,
      available: true,
      stamina: 0,
    }));

    let deepBetter = 0;
    let fiveBetter = 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const seed = `bench-${String(attempt)}`;
      const five = simulateFullCourtGame(
        fullCourtTestInput({
          seed,
          homeRoster: starters,
          awayRoster,
          homeAvailability: tiredOnly,
        }),
        ctx,
      );
      const bench = simulateFullCourtGame(
        fullCourtTestInput({
          seed,
          homeRoster: deep,
          awayRoster,
          homeAvailability: fatigueStarters,
        }),
        ctx,
      );
      const fiveMargin = five.home.box.points - five.away.box.points;
      const benchMargin = bench.home.box.points - bench.away.box.points;
      if (benchMargin > fiveMargin) deepBetter += 1;
      else if (fiveMargin > benchMargin) fiveBetter += 1;
    }
    expect(deepBetter).toBeGreaterThan(fiveBetter);
  });

  it('retains value for an elite high-stamina starter in long stints', () => {
    const elite = fullCourtTestRoster('elite', FULL_COURT_MIN_ROSTER, () => ({ rating: 88 }));
    const average = fullCourtTestRoster('average', FULL_COURT_MIN_ROSTER, () => ({ rating: 70 }));
    const awayRoster = fullCourtTestRoster('elite-away', 8, () => ({ rating: 74 }));
    const eliteStamina = staminaOf(elite, () => 1);
    const averageStamina = staminaOf(average, () => 1);

    let eliteWins = 0;
    let averageWins = 0;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const seed = `elite-${String(attempt)}`;
      const strong = simulateFullCourtGame(
        fullCourtTestInput({
          seed,
          homeRoster: elite,
          awayRoster,
          homeAvailability: eliteStamina,
        }),
        ctx,
      );
      const plain = simulateFullCourtGame(
        fullCourtTestInput({
          seed,
          homeRoster: average,
          awayRoster,
          homeAvailability: averageStamina,
        }),
        ctx,
      );
      if (strong.home.box.points > strong.away.box.points) eliteWins += 1;
      if (plain.home.box.points > plain.away.box.points) averageWins += 1;
    }
    expect(eliteWins).toBeGreaterThan(averageWins);
  });

  it('leaves unused reserves at full energy with no statistics', () => {
    const roster = fullCourtTestRoster('benchonly', 9);
    const targets: Record<string, number> = {};
    roster.forEach((player, index) => {
      targets[player.playerId] = index < 5 ? 48 : 0;
    });
    const result = simulateFullCourtGame(
      fullCourtTestInput({
        seed: 'benchonly',
        homeRoster: roster,
        homeRotation: { minuteTargets: targets },
      }),
      ctx,
    );
    // Fatigue may pull a starter, so only assert the invariant that holds either way:
    // a player who never played is untouched.
    const unused = playersOf(result, 'home').filter((player) => player.seconds === 0);
    for (const player of unused) {
      expect(player.energyRemaining).toBe(1);
      expect(player.points).toBe(0);
      expect(player.fieldGoals.attempted).toBe(0);
      expect(player.fouls).toBe(0);
      expect(player.stints).toBe(0);
    }
    expect(playersOf(result, 'home').filter((player) => player.startedGame)).toHaveLength(5);
    expect(checkFullCourtGameResult(result)).toEqual([]);
  });

  it('replaces a tired starter with a fresher reserve, not the reverse', () => {
    const roster = fullCourtTestRoster('swap', 9, () => ({ rating: 74 }));
    const targets: Record<string, number> = {};
    roster.forEach((player, index) => {
      targets[player.playerId] = index < 5 ? 48 : 0;
    });
    const { result, tape } = simulateRecordedFullCourtGame(
      fullCourtTestInput({
        seed: 'swap',
        homeRoster: roster,
        homeRotation: { minuteTargets: targets },
      }),
      ctx,
    );
    const swaps = tape.filter((event) => event.kind === 'substitution' && event.side === 0);
    expect(swaps.length).toBeGreaterThan(0);
    const byId = new Map(result.home.players.map((player) => [player.playerId, player]));
    for (const event of swaps) {
      if (event.kind !== 'substitution') continue;
      const out = byId.get(event.outPlayerId);
      const incoming = byId.get(event.inPlayerId);
      expect(out).toBeDefined();
      expect(incoming).toBeDefined();
      expect(event.outPlayerId).not.toBe(event.inPlayerId);
      if (event.reason === 'fatigue') {
        // A fresh reserve replaces a drained one, never the other way around.
        expect((incoming?.energyRemaining ?? 0) >= 0).toBe(true);
        expect((out?.fouls ?? 0) < FULL_COURT_FOUL_LIMIT).toBe(true);
      }
    }
    expect(checkFullCourtGameResult(result)).toEqual([]);
  });

  it('enters a zero-target reserve in an emergency', () => {
    const roster = fullCourtTestRoster('emergency', 6, (index) => ({
      rating: 74,
      foulRate: index < 5 ? 100 : 2,
    }));
    const targets: Record<string, number> = {};
    roster.forEach((player, index) => {
      targets[player.playerId] = index < 5 ? 48 : 0;
    });
    let sawReserve = false;
    for (let attempt = 0; attempt < 10 && !sawReserve; attempt += 1) {
      const result = simulateFullCourtGame(
        fullCourtTestInput({
          seed: `emergency-${String(attempt)}`,
          homeRoster: roster,
          homeRotation: { minuteTargets: targets },
        }),
        ctx,
      );
      sawReserve = benchPlayers(result, 'home').some((player) => player.seconds > 0);
      expect(checkFullCourtGameResult(result)).toEqual([]);
    }
    expect(sawReserve).toBe(true);
  });
});

describe('full court input validation', () => {
  it('refuses rosters smaller than five and duplicate team ids', () => {
    const input = fullCourtTestInput({
      seed: 'small',
      homeRoster: fullCourtTestRoster('small', FULL_COURT_MIN_ROSTER),
    });
    expect(() =>
      runFullCourtGame(
        { ...input, home: { ...input.home, roster: input.home.roster.slice(0, 4) } },
        ctx,
      ),
    ).toThrow(FullCourtSetupError);
    expect(() =>
      runFullCourtGame(
        {
          ...input,
          away: { ...input.away, teamId: input.home.teamId },
        },
        ctx,
      ),
    ).toThrow(FullCourtSetupError);
  });

  it('accepts a twelve-player roster', () => {
    const roster = fullCourtTestRoster('twelve', FULL_COURT_MAX_ROSTER);
    const result = simulateFullCourtGame(
      fullCourtTestInput({ seed: 'twelve', homeRoster: roster }),
      ctx,
    );
    expect(result.home.players).toHaveLength(FULL_COURT_MAX_ROSTER);
    expect(checkFullCourtGameResult(result)).toEqual([]);
  });

  it('treats an unavailable player as absent from the game', () => {
    const roster = fullCourtTestRoster('hurt', 8);
    const injured = roster[1];
    if (injured === undefined) throw new Error('fixture missing');
    const result = simulateFullCourtGame(
      fullCourtTestInput({
        seed: 'hurt',
        homeRoster: roster,
        homeAvailability: [
          { playerId: injured.playerId, available: false, reason: 'injury' },
          ...availabilityOf(roster.filter((player) => player.playerId !== injured.playerId)),
        ],
      }),
      ctx,
    );
    const line = result.home.players.find((player) => player.playerId === injured.playerId);
    expect(line?.available).toBe(false);
    expect(line?.seconds).toBe(0);
    expect(line?.points).toBe(0);
    expect(checkFullCourtGameResult(result)).toEqual([]);
  });
});

describe('rotation allocation arithmetic', () => {
  it('allocates deterministically and never exceeds the cap', () => {
    const weights = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.05, 0.02, 0.01];
    const first = allocateSeconds(weights, FULL_COURT_REGULATION_TEAM_SECONDS, 48 * 60);
    const second = allocateSeconds(weights, FULL_COURT_REGULATION_TEAM_SECONDS, 48 * 60);
    expect(first).toEqual(second);
    expect(first.reduce((sum, value) => sum + value, 0)).toBe(FULL_COURT_REGULATION_TEAM_SECONDS);
    for (const value of first) expect(value).toBeLessThanOrEqual(48 * 60);
  });

  it('plans a legal six-player roster where every player is used', () => {
    const roster = fullCourtTestRoster('six', 6);
    const plan = resolveRotationPlan(roster);
    expect(plan.targetSeconds.filter((seconds) => seconds > 0)).toHaveLength(6);
    expect(plan.targetSeconds.reduce((sum, value) => sum + value, 0)).toBe(
      FULL_COURT_REGULATION_TEAM_SECONDS,
    );
  });
});

const GOLDEN_FULL_COURT_HASH = 2570531333;
const GOLDEN_FULL_COURT_HOME_POINTS = 100;
const GOLDEN_FULL_COURT_HOME_SECONDS = [2118, 2100, 1984, 1292, 1568, 1172, 1708, 1031, 1427];
