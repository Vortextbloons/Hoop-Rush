import { expect, test } from 'bun:test';
import type { FullCourtCoachingRule } from '@hoop-rush/data-contracts';
import { buildFullCourtWatchedReplay } from '@hoop-rush/application/full-court';
import {
  buildFullCourtGameReport,
  createEngineContext,
  fullCourtRegularSeasonGameInput,
  simulateRecordedFullCourtGame,
  type FullCourtTapeEvent,
} from '@hoop-rush/engine';
import { simulateFullCourtBuzzerBanditTestGame } from '../../../../../../packages/engine/src/modes/full-court/game-test-support.ts';
import { render } from 'svelte/server';
import FullCourtGamecast from './FullCourtGamecast.svelte';
import {
  fullCourtGamecastFrames,
  fullCourtWatchedReplayOutcome,
  fullCourtWatchedReplaySummary,
} from './full-court-gamecast.ts';
import { fullCourtTestSeasonLock } from './full-court-test-support.ts';

test('projects a recorded game to the final score and recorded active fives', () => {
  const { season } = fullCourtTestSeasonLock();
  const fixture = season.games[0];
  if (fixture === undefined) throw new Error('Expected an opening fixture');
  const input = fullCourtRegularSeasonGameInput(season, fixture.gameId);
  const { result, tape } = simulateRecordedFullCourtGame(input, createEngineContext());
  const frames = fullCourtGamecastFrames(result, tape);
  expect(frames).toHaveLength(tape.length + 1);
  expect(frames[0]).toMatchObject({ homeScore: 0, awayScore: 0, clockSeconds: 720 });
  expect(frames.at(-1)).toMatchObject({
    homeScore: result.home.box.points,
    awayScore: result.away.box.points,
    clockSeconds: 0,
  });
  const homeIds = new Set<string>(result.home.players.map((player) => player.playerId));
  const awayIds = new Set<string>(result.away.players.map((player) => player.playerId));
  for (const [index, event] of tape.entries()) {
    if (event.kind !== 'trip') continue;
    expect(frames[index + 1]).toMatchObject({ homeUnit: event.homeUnit, awayUnit: event.awayUnit });
    expect(event.homeUnit.every((id) => homeIds.has(id))).toBe(true);
    expect(event.awayUnit.every((id) => awayIds.has(id))).toBe(true);
  }
  expect(frames.some((frame) => frame.caption?.includes(' replaces '))).toBe(true);
});

test('records coaching-rule substitutions in the same order as the summary', () => {
  const { season } = fullCourtTestSeasonLock();
  const fixture = season.games[0];
  if (fixture === undefined) throw new Error('Expected an opening fixture');
  const input = fullCourtRegularSeasonGameInput(season, fixture.gameId);
  const ids = input.home.roster.map((player) => player.playerId);
  const rules: FullCourtCoachingRule[] = [
    {
      ruleId: 'gamecast-closing',
      kind: 'closing-lineup',
      secondsRemainingMax: 48 * 60,
      scoreMarginMax: 40,
      lineup: ids.slice(3, 8),
    },
  ];
  const { result, tape } = simulateRecordedFullCourtGame(
    {
      ...input,
      home: {
        ...input.home,
        rotation: { startingFive: ids.slice(0, 5), rules },
      },
    },
    createEngineContext(),
  );
  const frames = fullCourtGamecastFrames(result, tape);
  expect(frames).toHaveLength(tape.length + 1);
  const ruleFrames = frames.filter((frame) => frame.caption?.includes('coach rule'));
  const incoming = rules[0]?.kind === 'closing-lineup' ? rules[0].lineup : [];
  const starters = new Set<string>(ids.slice(0, 5));
  const missing = incoming.filter((id) => !starters.has(id)).length;
  expect(missing).toBeGreaterThan(0);
  expect(ruleFrames.length).toBeGreaterThanOrEqual(missing);
  expect(frames.at(-1)).toMatchObject({
    homeScore: result.home.box.points,
    awayScore: result.away.box.points,
  });
  // The final projected five matches the final recorded lineup stint.
  const lastStint = result.home.stints.at(-1);
  expect(lastStint?.playerIds.length).toBe(5);
  expect(frames.at(-1)?.homeUnit).toEqual(lastStint?.playerIds);
});

test('captions deducted and simultaneous split scoring without hiding negative live scores', () => {
  const { result, tape } = simulateFullCourtBuzzerBanditTestGame({ seed: 'bz-replay-2' });
  const signedFrames = fullCourtGamecastFrames(result, tape);
  expect(signedFrames.some((frame) => frame.homeScore < 0)).toBe(true);
  expect(signedFrames.some((frame) => frame.caption?.includes('loses 1 point'))).toBe(true);

  const homeUnit = result.home.stints[0]?.playerIds ?? [];
  const awayUnit = result.away.stints[0]?.playerIds ?? [];
  const framedTape: FullCourtTapeEvent[] = [
    {
      kind: 'trip',
      period: 0,
      clockSeconds: 700,
      secondsElapsed: 20,
      offense: 0,
      ended: true,
      nextPossessionStart: 'madeBasket',
      homeScore: 1,
      awayScore: 1,
      homeUnit,
      awayUnit,
    },
    {
      kind: 'trip',
      period: 0,
      clockSeconds: 680,
      secondsElapsed: 20,
      offense: 1,
      ended: true,
      nextPossessionStart: 'madeBasket',
      homeScore: 0,
      awayScore: 1,
      homeUnit,
      awayUnit,
    },
  ];
  const frames = fullCourtGamecastFrames(result, framedTape);
  expect(frames[1]?.caption).toBe(
    `${result.home.displayName} scores 1 point · ${result.away.displayName} scores 1 point`,
  );
  expect(frames[2]?.caption).toBe(`${result.home.displayName} loses 1 point`);
});

test('rehydrates a saved watched replay into Gamecast from tipoff without rolling possessions', () => {
  const { season } = fullCourtTestSeasonLock();
  const fixture = season.games.find(
    (game) => game.homeTeamId === season.userTeamId || game.awayTeamId === season.userTeamId,
  );
  if (fixture === undefined) throw new Error('Expected a user fixture');
  const input = fullCourtRegularSeasonGameInput(season, fixture.gameId);
  const { result, tape } = simulateRecordedFullCourtGame(input, createEngineContext());
  const userSide = fixture.homeTeamId === season.userTeamId ? 'home' : 'away';
  const replay = buildFullCourtWatchedReplay({
    phase: 'regular',
    runId: season.runId,
    seasonLockDigest: season.runSeed,
    lockDigest: season.runSeed,
    gameId: fixture.gameId,
    slot: fixture.slot,
    dayOffset: fixture.dayOffset,
    userTeamId: season.userTeamId,
    game: {
      kind: 'played',
      result,
      tape,
      health: {
        home: {
          version: 'full-court-health-v1',
          teamId: fixture.homeTeamId,
          throughDay: fixture.dayOffset,
          players: {},
        },
        away: {
          version: 'full-court-health-v1',
          teamId: fixture.awayTeamId,
          throughDay: fixture.dayOffset,
          players: {},
        },
      },
      injuries: [],
    },
  });

  const summary = fullCourtWatchedReplaySummary(replay);
  expect(summary.gameId).toBe(fixture.gameId);
  expect(summary.gameLabel).toBe('Game 1');
  expect(summary.replayNote).toContain('Starts from tipoff');

  const outcome = fullCourtWatchedReplayOutcome(replay);
  expect(outcome.result).toEqual(result);
  expect(outcome.tape).toEqual(tape);

  const report = buildFullCourtGameReport({
    kind: 'played',
    gameId: fixture.gameId,
    userSide,
    result: outcome.result,
    tape: outcome.tape ?? [],
  });
  expect(report.status).toBe('played');

  const body = render(FullCourtGamecast, {
    props: {
      game: outcome,
      userTeamId: season.userTeamId,
      replayNote: summary.replayNote,
      onClose: () => {},
    },
  }).body;
  expect(body).toContain('Gamecast');
  expect(body).toContain('Starts from tipoff');
  expect(body).toContain('Skip to final');
  expect(body).toContain('Pause');
});
