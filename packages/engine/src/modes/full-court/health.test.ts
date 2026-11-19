import { expect, test } from 'bun:test';
import { FULL_COURT_HEALTH_VERSION, fullCourtTeamHealthSchema } from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../sim/kernel.ts';
import { checkFullCourtGameResult } from './game.ts';
import { fullCourtTestInput, fullCourtTestRoster } from './game-test-support.ts';
import { runFullCourtGameWithHealth } from './health.ts';

const context = createEngineContext();

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
