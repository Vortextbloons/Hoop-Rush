import { expect, test } from 'bun:test';
import type { FullCourtCoachingRule } from '@hoop-rush/data-contracts';
import { buildFullCourtWatchedReplay } from '@hoop-rush/application/full-court';
import {
  buildFullCourtGameReport,
  createEngineContext,
  fullCourtRegularSeasonGameInput,
  simulateRecordedFullCourtGame,
  unitNameForPlayerIds,
  type FullCourtTapeEvent,
} from '@hoop-rush/engine';
import {
  fullCourtTestInput,
  fullCourtTestRoster,
} from '../../../../../../packages/engine/src/modes/full-court/game-test-support.ts';
import { render } from 'svelte/server';
import FullCourtGamecast from './FullCourtGamecast.svelte';
import {
  fullCourtGamecastFrames,
  fullCourtPossessionCursor,
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

  const completed = tape.flatMap((event, index) =>
    event.kind === 'trip' && event.ended ? [index + 1] : [],
  );
  expect(completed.length).toBeGreaterThan(2);
  let cursor = 0;
  for (const next of completed) {
    expect(fullCourtPossessionCursor(frames, cursor, 1)).toBe(next);
    expect(fullCourtPossessionCursor(frames, next, -1)).toBe(cursor);
    expect(frames[next]?.homeUnit).toHaveLength(5);
    expect(frames[next]?.awayUnit).toHaveLength(5);
    expect(frames[next]?.caption).toBeTruthy();
    cursor = next;
  }
  expect(fullCourtPossessionCursor(frames, cursor, 1)).toBe(frames.length - 1);
});

test('shows a named unit only when the recorded five matches', () => {
  const { season } = fullCourtTestSeasonLock();
  const fixture = season.games[0];
  if (fixture === undefined) throw new Error('Expected an opening fixture');
  const input = fullCourtRegularSeasonGameInput(season, fixture.gameId);
  const openingFive = input.home.roster.slice(0, 5).map((player) => player.playerId);
  const unit = { name: 'Opening Five', playerIds: openingFive };
  const { result, tape } = simulateRecordedFullCourtGame(
    {
      ...input,
      home: {
        ...input.home,
        rotation: { ...input.home.rotation, units: [unit] },
      },
    },
    createEngineContext(),
  );
  const homeRosterIds = result.home.players.map((player) => player.playerId);
  expect(unitNameForPlayerIds(result.home.units, homeRosterIds, openingFive)).toBe('Opening Five');
  expect(
    unitNameForPlayerIds(result.home.units, homeRosterIds, [
      ...openingFive.slice(0, 4),
      result.home.players[5]?.playerId ?? '',
    ]),
  ).toBeNull();

  const health = {
    home: {
      version: 'full-court-health-v1' as const,
      teamId: fixture.homeTeamId,
      throughDay: fixture.dayOffset,
      players: {},
    },
    away: {
      version: 'full-court-health-v1' as const,
      teamId: fixture.awayTeamId,
      throughDay: fixture.dayOffset,
      players: {},
    },
  };
  const body = render(FullCourtGamecast, {
    props: {
      game: { kind: 'played', result, tape, health, injuries: [] },
      userTeamId: season.userTeamId,
      onClose: () => {},
    },
  }).body;
  expect(body).toContain('Opening Five');
  expect(body.match(/active five"/g)).toHaveLength(2);
  expect(body).toContain('Next possession');
  expect(body).toContain('Play-by-play feed');
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

test('captions simultaneous split scoring from signed tape events', () => {
  const homeRoster = fullCourtTestRoster('gc-home', 8);
  const awayRoster = fullCourtTestRoster('gc-away', 8);
  const { result } = simulateRecordedFullCourtGame(
    fullCourtTestInput({ seed: 'gc-split-score', homeRoster, awayRoster }),
    createEngineContext(),
  );
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

test('highlights actual rotation and substitution evidence in the finished recap', () => {
  const { season } = fullCourtTestSeasonLock();
  const fixture = season.games[0];
  if (fixture === undefined) throw new Error('Expected an opening fixture');
  const input = fullCourtRegularSeasonGameInput(season, fixture.gameId);
  const { result, tape } = simulateRecordedFullCourtGame(input, createEngineContext());
  const health = {
    home: {
      version: 'full-court-health-v1' as const,
      teamId: fixture.homeTeamId,
      throughDay: fixture.dayOffset,
      players: {},
    },
    away: {
      version: 'full-court-health-v1' as const,
      teamId: fixture.awayTeamId,
      throughDay: fixture.dayOffset,
      players: {},
    },
  };
  const userSide = result.home.teamId === season.userTeamId ? 0 : 1;
  const substitutions = tape.filter(
    (event) => event.kind === 'substitution' && event.side === userSide,
  );
  expect(substitutions.length).toBeGreaterThan(0);

  const body = render(FullCourtGamecast, {
    props: {
      game: { kind: 'played', result, tape, health, injuries: [] },
      userTeamId: season.userTeamId,
      onClose: () => {},
    },
  }).body;

  expect(body).toContain('starter minutes');
  expect(body).toContain('bench minutes');
  expect(body).toContain(`${substitutions.length} substitution`);
  expect(body).toContain('First change:');
});

test('renders full Cap Rush style box scores and team totals when finished', () => {
  const { season } = fullCourtTestSeasonLock();
  const fixture = season.games[0];
  if (fixture === undefined) throw new Error('Expected an opening fixture');
  const input = fullCourtRegularSeasonGameInput(season, fixture.gameId);
  const { result } = simulateRecordedFullCourtGame(input, createEngineContext());
  const health = {
    home: {
      version: 'full-court-health-v1' as const,
      teamId: fixture.homeTeamId,
      throughDay: fixture.dayOffset,
      players: {},
    },
    away: {
      version: 'full-court-health-v1' as const,
      teamId: fixture.awayTeamId,
      throughDay: fixture.dayOffset,
      players: {},
    },
  };
  const body = render(FullCourtGamecast, {
    props: {
      game: { kind: 'played', result, tape: null, health, injuries: [] },
      userTeamId: season.userTeamId,
      onClose: () => {},
    },
  }).body;

  expect(body).toContain('box score');
  expect(body).toContain('STL');
  expect(body).toContain('BLK');
  expect(body).toContain('TO');
  expect(body).toContain('PF');
  expect(body).toContain('FG%');
  expect(body).toContain('TS%');
  expect(body).toContain('Team');
});
