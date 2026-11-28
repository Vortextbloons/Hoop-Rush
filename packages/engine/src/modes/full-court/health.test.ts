import { expect, test } from 'bun:test';
import {
  FULL_COURT_HEALTH_PROFILE_VERSION,
  FULL_COURT_HEALTH_VERSION,
  fullCourtHealthProfileSetSchema,
  fullCourtTeamHealthSchema,
  type FullCourtHealthProfileSet,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../sim/kernel.ts';
import { checkFullCourtGameResult } from './game.ts';
import { fullCourtTestInput, fullCourtTestRoster } from './game-test-support.ts';
import { runFullCourtGameWithHealth } from './health.ts';
import { buildFullCourtGameLineups, buildFullCourtGameLineupsFromFacts } from './report.ts';

const context = createEngineContext();

function injuryProfilesOf(
  players: readonly SimulationPlayer[],
  rate = 100_000,
  durationCounts: readonly [number, number, number, number] = [1, 0, 0, 0],
): FullCourtHealthProfileSet {
  const records: Record<string, unknown> = {};
  for (const player of players) {
    if (player.playerVersionId === undefined) throw new Error('Missing test player version');
    records[player.playerVersionId] = {
      cohortId: 'test-cohort',
      episodesPer10kAppearances: rate,
      playerEvidence: { source: 'population' },
    };
  }
  return fullCourtHealthProfileSetSchema.parse({
    version: FULL_COURT_HEALTH_PROFILE_VERSION,
    catalogHash: 'a'.repeat(64),
    evidenceHash: 'b'.repeat(64),
    cohorts: { 'test-cohort': { observedAppearances: 1_000, durationCounts } },
    players: records,
  });
}

test('actual minutes carry workload into a back-to-back and days off clear it', () => {
  const homeRoster = fullCourtTestRoster('health', 5);
  const game = fullCourtTestInput({ seed: 'health', homeRoster });
  const opener = runFullCourtGameWithHealth(game, 0, context);
  if (opener.kind !== 'played') throw new Error('Expected a playable opener');
  const saved = fullCourtTeamHealthSchema.parse(JSON.parse(JSON.stringify(opener.health.home)));
  const nextDay = runFullCourtGameWithHealth(game, 1, context, { health: { home: saved } });
  const afterRest = runFullCourtGameWithHealth(game, 4, context, { health: { home: saved } });
  if (nextDay.kind !== 'played' || afterRest.kind !== 'played') {
    throw new Error('Expected two playable games');
  }
  expect(afterRest.result).toEqual(opener.result);
  expect(nextDay.result).not.toEqual(afterRest.result);
  for (const player of homeRoster) {
    expect(nextDay.health.home.players[player.playerId]?.loadBasisPoints ?? 0).toBeGreaterThan(
      afterRest.health.home.players[player.playerId]?.loadBasisPoints ?? 0,
    );
  }
  expect(nextDay.health.home.throughDay).toBe(1);
  expect(saved.throughDay).toBe(0);
  expect(() => runFullCourtGameWithHealth(game, 1, context, { health: nextDay.health })).toThrow(
    'does not precede the fixture',
  );
});

test('repeated heavy minutes outlast acute fatigue and recover with rest', () => {
  const homeRoster = fullCourtTestRoster('cumulative', 8, () => ({ minutesPerGame: 38 }));
  const player = homeRoster[0];
  if (player === undefined) throw new Error('Expected a player');
  const game = fullCourtTestInput({
    seed: 'cumulative',
    homeRoster,
    homeRotation: {
      startingFive: homeRoster.slice(0, 5).map((entry) => entry.playerId),
      minuteTargets: Object.fromEntries(
        homeRoster.map((entry, index) => [entry.playerId, index < 5 ? 44 : index === 5 ? 20 : 0]),
      ),
    },
  });
  const load = (health: ReturnType<typeof fullCourtTeamHealthSchema.parse>) =>
    health.players[player.playerId]?.cumulativeLoadBasisPoints ?? 0;
  const opener = runFullCourtGameWithHealth(game, 0, context);
  if (opener.kind !== 'played') throw new Error('Expected an opening game');
  const fresh = runFullCourtGameWithHealth(game, 2, context, {
    health: { home: opener.health.home },
  });
  if (fresh.kind !== 'played') throw new Error('Expected a second game');
  expect(fresh.result).toEqual(opener.result);

  let home = fresh.health.home;
  for (const day of [4, 6, 8, 10, 12]) {
    const next = runFullCourtGameWithHealth(game, day, context, { health: { home } });
    if (next.kind !== 'played') throw new Error('Expected a playable schedule');
    expect(checkFullCourtGameResult(next.result)).toEqual([]);
    home = next.health.home;
  }
  expect(load(home)).toBeGreaterThan(load(fresh.health.home));
  const loaded = runFullCourtGameWithHealth(game, 14, context, { health: { home } });
  expect(loaded).toEqual(runFullCourtGameWithHealth(game, 14, context, { health: { home } }));
  if (loaded.kind !== 'played') throw new Error('Expected a game');
  const energy = (result: typeof loaded.result) =>
    result.home.players.find((line) => line.playerId === player.playerId)?.energyRemaining ?? 0;
  expect(energy(loaded.result)).toBeLessThan(energy(fresh.result));

  const rested = runFullCourtGameWithHealth(game, 14, context, {
    health: { home },
    restingPlayerIds: { home: [player.playerId] },
  });
  if (rested.kind !== 'played') throw new Error('Expected a playable rest game');
  expect(load(rested.health.home)).toBeLessThan(load(home));
});

test('a documented injury forces a forfeit until the calendar return day', () => {
  const [injured, ...reserves] = fullCourtTestRoster('short-health', 5);
  const awayRoster = fullCourtTestRoster('short-away', 5);
  const awayInjured = awayRoster[0];
  if (injured === undefined || awayInjured === undefined) throw new Error('Missing fixture player');
  const game = fullCourtTestInput({
    seed: 'short-health',
    homeRoster: [injured, ...reserves],
    awayRoster,
  });
  const home = fullCourtTeamHealthSchema.parse({
    version: FULL_COURT_HEALTH_VERSION,
    teamId: game.home.teamId,
    throughDay: 0,
    players: { [injured.playerId]: { loadBasisPoints: 6000, availableFromDay: 4 } },
  });
  const forfeited = runFullCourtGameWithHealth(game, 3, context, { health: { home } });
  if (forfeited.kind !== 'forfeit') throw new Error('Expected a forfeit');
  expect(forfeited.sides).toEqual(['home']);
  expect(forfeited.winner).toBe('away');
  expect(forfeited.health.home.players[injured.playerId]).toEqual({
    loadBasisPoints: 0,
    availableFromDay: 4,
  });
  const bothUnavailable = runFullCourtGameWithHealth(game, 3, context, {
    health: {
      home,
      away: {
        ...home,
        teamId: game.away.teamId,
        players: { [awayInjured.playerId]: { loadBasisPoints: 0, availableFromDay: 4 } },
      },
    },
  });
  expect(bothUnavailable).toMatchObject({ kind: 'forfeit', sides: ['home', 'away'], winner: null });
  const returned = runFullCourtGameWithHealth(game, 4, context, { health: forfeited.health });
  if (returned.kind !== 'played') throw new Error('Expected a game on the return day');
  expect(returned.health.home.players[injured.playerId]?.availableFromDay).toBeNull();
  expect(checkFullCourtGameResult(returned.result)).toEqual([]);
});

test('voluntary rest blocks an illegal rotation and valid rest has replay parity', () => {
  const homeRoster = fullCourtTestRoster('rest-health', 6);
  const game = fullCourtTestInput({ seed: 'rest-health', homeRoster });
  const playerIds = homeRoster.map((player) => player.playerId);
  expect(
    runFullCourtGameWithHealth(game, 0, context, {
      restingPlayerIds: { home: playerIds.slice(0, 2) },
    }),
  ).toEqual({ kind: 'rest-conflict', sides: ['home'] });
  const restingPlayerIds = { home: playerIds.slice(0, 1) };
  const summary = runFullCourtGameWithHealth(game, 0, context, { restingPlayerIds });
  const recorded = runFullCourtGameWithHealth(game, 0, context, { restingPlayerIds, record: true });
  if (summary.kind !== 'played' || recorded.kind !== 'played') throw new Error('Expected a game');
  expect(recorded.result).toEqual(summary.result);
  expect(recorded.health).toEqual(summary.health);
  expect(recorded.tape?.length).toBeGreaterThan(0);
  expect(summary.result.home.players[0]).toMatchObject({ available: false, seconds: 0 });
  expect(Object.keys(summary.health.home.players)).not.toContain(playerIds[0]);
});

test('accumulates compact lineup facts through health without a playback tape', () => {
  const game = fullCourtTestInput({
    seed: 'health-lineups',
    homeRoster: fullCourtTestRoster('health-lineups', 9),
  });
  const factsOnly = runFullCourtGameWithHealth(game, 0, context, { lineupFacts: true });
  const recorded = runFullCourtGameWithHealth(game, 0, context, { record: true });
  if (factsOnly.kind !== 'played' || recorded.kind !== 'played') {
    throw new Error('Expected a playable game');
  }
  expect(factsOnly.result).toEqual(recorded.result);
  expect(factsOnly.health).toEqual(recorded.health);
  expect(factsOnly.tape).toBeNull();
  if (factsOnly.lineupFacts == null || recorded.tape === null) {
    throw new Error('Expected compact lineup facts and a playback tape');
  }
  for (const side of ['home', 'away'] as const) {
    expect(
      buildFullCourtGameLineupsFromFacts({
        kind: 'played',
        gameId: 'fc-health-lineups',
        userSide: side,
        result: factsOnly.result,
        facts: factsOnly.lineupFacts,
      }),
    ).toEqual(
      buildFullCourtGameLineups({
        kind: 'played',
        gameId: 'fc-health-lineups',
        userSide: side,
        result: recorded.result,
        tape: recorded.tape,
      }),
    );
  }
});

test('experimental injuries are opt-in and leave the completed game unchanged', () => {
  const homeRoster = fullCourtTestRoster('injury-opt-in', 6);
  const game = fullCourtTestInput({ seed: 'injury-opt-in', homeRoster });
  const baseline = runFullCourtGameWithHealth(game, 0, context);
  if (baseline.kind !== 'played') throw new Error('Expected a playable opener');
  expect(baseline.injuries).toEqual([]);
  const enabled = runFullCourtGameWithHealth(game, 0, context, {
    injuryProfiles: injuryProfilesOf(homeRoster),
    futureGameDays: { home: [2, 4, 6, 8, 10, 12] },
  });
  if (enabled.kind !== 'played') throw new Error('Expected a playable injury game');
  expect(enabled.result).toEqual(baseline.result);
  expect(enabled.health).not.toEqual(baseline.health);
  expect(checkFullCourtGameResult(enabled.result)).toEqual([]);
  expect(enabled.injuries.length).toBeGreaterThan(0);
  expect(enabled.injuries.every((event) => event.teamId === game.home.teamId)).toBe(true);
  for (const event of enabled.injuries) {
    expect(event.onsetDay).toBe(0);
    expect(event.gamesMissed).toBe(1);
    expect(event.availableFromDay).toBe(3);
    expect(event.projected).toBe(false);
    expect(enabled.health.home.players[event.playerId]?.availableFromDay).toBe(3);
  }
  expect(fullCourtTeamHealthSchema.parse(enabled.health.home)).toEqual(enabled.health.home);
});

test('injury draws cover both teams and persist on each side', () => {
  const homeRoster = fullCourtTestRoster('injury-both-home', 6);
  const awayRoster = fullCourtTestRoster('injury-both-away', 6);
  const game = fullCourtTestInput({
    seed: 'injury-both',
    homeRoster,
    awayRoster,
  });
  const futureGameDays = [2, 4, 6, 8, 10, 12];
  const outcome = runFullCourtGameWithHealth(game, 0, context, {
    injuryProfiles: injuryProfilesOf([...homeRoster, ...awayRoster]),
    futureGameDays: { home: futureGameDays, away: futureGameDays },
  });
  if (outcome.kind !== 'played') throw new Error('Expected a playable injury game');

  const injuredTeams = new Set(outcome.injuries.map((event) => event.teamId));
  expect(injuredTeams.has(game.home.teamId)).toBe(true);
  expect(injuredTeams.has(game.away.teamId)).toBe(true);
  for (const event of outcome.injuries) {
    const side = event.teamId === game.home.teamId ? 'home' : 'away';
    expect(outcome.health[side].players[event.playerId]?.availableFromDay).toBe(
      event.availableFromDay,
    );
    expect(outcome.health[side].throughDay).toBe(0);
  }
});

test('injury draws replay deterministically and match Gamecast recording', () => {
  const homeRoster = fullCourtTestRoster('injury-replay', 6);
  const game = fullCourtTestInput({ seed: 'injury-replay', homeRoster });
  const options = {
    injuryProfiles: injuryProfilesOf(homeRoster),
    futureGameDays: { home: [2, 4, 6, 8, 10, 12] },
  };
  const replay = runFullCourtGameWithHealth(game, 0, context, options);
  const recorded = runFullCourtGameWithHealth(game, 0, context, { ...options, record: true });
  if (replay.kind !== 'played' || recorded.kind !== 'played') {
    throw new Error('Expected two playable games');
  }
  expect(recorded.result).toEqual(replay.result);
  expect(recorded.health).toEqual(replay.health);
  expect(recorded.injuries).toEqual(replay.injuries);
  expect(recorded.tape?.length).toBeGreaterThan(0);
});

test('a time-loss injury holds the player out and clears on the return day', () => {
  const homeRoster = fullCourtTestRoster('injury-return', 6);
  const game = fullCourtTestInput({ seed: 'injury-return', homeRoster });
  const target = homeRoster[0];
  if (target === undefined) throw new Error('Missing injury target');
  const profiles = injuryProfilesOf([target]);
  const opener = runFullCourtGameWithHealth(game, 0, context, {
    injuryProfiles: profiles,
    futureGameDays: { home: [3, 5, 7] },
  });
  if (opener.kind !== 'played') throw new Error('Expected a playable opener');
  const injury = opener.injuries.find((event) => event.playerId === target.playerId);
  if (injury === undefined) throw new Error('Expected the target injury');
  expect(injury).toMatchObject({
    onsetDay: 0,
    gamesMissed: 1,
    availableFromDay: 4,
    projected: false,
  });
  expect(
    opener.result.home.players.find((player) => player.playerId === target.playerId)?.seconds,
  ).toBeGreaterThan(0);

  const heldOut = runFullCourtGameWithHealth(game, 1, context, {
    health: opener.health,
    injuryProfiles: profiles,
    futureGameDays: { home: [3, 5, 7] },
  });
  if (heldOut.kind !== 'played') throw new Error('Expected the next fixture to play');
  expect(
    heldOut.result.home.players.find((player) => player.playerId === target.playerId),
  ).toMatchObject({ available: false, seconds: 0 });
  expect(heldOut.injuries).toEqual([]);
  expect(heldOut.health.home.players[target.playerId]?.availableFromDay).toBe(4);

  const returned = runFullCourtGameWithHealth(game, 4, context, { health: heldOut.health });
  if (returned.kind !== 'played') throw new Error('Expected a game on the return day');
  expect(
    returned.result.home.players.find((player) => player.playerId === target.playerId),
  ).toMatchObject({ available: true });
  expect(
    returned.result.home.players.find((player) => player.playerId === target.playerId)?.seconds,
  ).toBeGreaterThan(0);
  expect(returned.health.home.players[target.playerId]?.availableFromDay ?? null).toBeNull();
  expect(checkFullCourtGameResult(returned.result)).toEqual([]);
});

test('forfeits and voluntary rest never produce an injury draw', () => {
  const homeRoster = fullCourtTestRoster('injury-exclusions', 7);
  const game = fullCourtTestInput({
    seed: 'injury-exclusions',
    homeRoster,
    awayRoster: fullCourtTestRoster('injury-exclusions-away', 5),
  });
  const resting = homeRoster[0];
  const injured = homeRoster[1];
  if (resting === undefined || injured === undefined) throw new Error('Missing exclusion players');
  const prior = fullCourtTeamHealthSchema.parse({
    version: FULL_COURT_HEALTH_VERSION,
    teamId: game.home.teamId,
    throughDay: 0,
    players: { [injured.playerId]: { loadBasisPoints: 0, availableFromDay: 4 } },
  });
  const played = runFullCourtGameWithHealth(game, 1, context, {
    health: { home: prior },
    restingPlayerIds: { home: [resting.playerId] },
    injuryProfiles: injuryProfilesOf([resting, injured]),
    futureGameDays: { home: [3, 5] },
  });
  if (played.kind !== 'played') throw new Error('Expected a playable game');
  expect(played.injuries).toEqual([]);
  expect(played.health.home.players[injured.playerId]?.availableFromDay).toBe(4);
  expect(played.health.home.players[resting.playerId]).toBeUndefined();
  expect(
    played.result.home.players.find((player) => player.playerId === resting.playerId),
  ).toMatchObject({ available: false, seconds: 0 });

  const shortRoster = fullCourtTestRoster('injury-forfeit', 5);
  const forfeitGame = fullCourtTestInput({
    seed: 'injury-forfeit',
    homeRoster: shortRoster,
    awayRoster: fullCourtTestRoster('injury-forfeit-away', 5),
  });
  const unavailable = shortRoster[0];
  if (unavailable === undefined) throw new Error('Missing forfeit player');
  const short = fullCourtTeamHealthSchema.parse({
    version: FULL_COURT_HEALTH_VERSION,
    teamId: forfeitGame.home.teamId,
    throughDay: 0,
    players: { [unavailable.playerId]: { loadBasisPoints: 0, availableFromDay: 4 } },
  });
  const forfeited = runFullCourtGameWithHealth(forfeitGame, 3, context, {
    health: { home: short },
    injuryProfiles: injuryProfilesOf(shortRoster),
    futureGameDays: { home: [5, 7] },
  });
  if (forfeited.kind !== 'forfeit') throw new Error('Expected a forfeit');
  expect(forfeited).not.toHaveProperty('injuries');
  expect(forfeited.health.home.players[unavailable.playerId]).toEqual({
    loadBasisPoints: 0,
    availableFromDay: 4,
  });
  for (const player of shortRoster.slice(1)) {
    expect(forfeited.health.home.players[player.playerId]).toBeUndefined();
  }
});

test('an injury near the end of the calendar carries a projected return date', () => {
  const homeRoster = fullCourtTestRoster('injury-projected', 6);
  const game = fullCourtTestInput({ seed: 'injury-projected', homeRoster });
  const outcome = runFullCourtGameWithHealth(game, 100, context, {
    injuryProfiles: injuryProfilesOf(homeRoster, 100_000, [0, 0, 0, 1]),
    futureGameDays: { home: [102] },
  });
  if (outcome.kind !== 'played') throw new Error('Expected a playable game');
  expect(outcome.injuries.length).toBeGreaterThan(0);
  for (const event of outcome.injuries) {
    expect(event.projected).toBe(true);
    expect(event.gamesMissed).toBeGreaterThanOrEqual(14);
    // One supplied day, then the two-day minimum for every uncovered game.
    expect(event.availableFromDay).toBeGreaterThanOrEqual(102 + 13 * 2 + 1);
    expect(outcome.health.home.players[event.playerId]?.availableFromDay).toBe(
      event.availableFromDay,
    );
  }
});
