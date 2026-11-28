import { expect, test } from 'bun:test';
import type { FullCourtCoachingRule } from '@hoop-rush/data-contracts';
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
  fullCourtBestLineup,
  fullCourtGamecastFrames,
  fullCourtLiveBoxFold,
  fullCourtPossessionCursor,
  fullCourtRotationSummary,
  fullCourtSubstitutionReasonLabel,
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
      label: 'Game 1 of 82',
      onclose: () => {},
    },
  }).body;
  expect(body).toContain('Opening Five');
  expect(body).toContain('Next possession');
  expect(body).toContain('Play-by-play feed');
  expect(body).toContain('Game 1 of 82');
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

test('opens the broadcast at tipoff and folds per-player lines as the cursor advances', () => {
  const { season } = fullCourtTestSeasonLock();
  const fixture = season.games.find(
    (game) => game.homeTeamId === season.userTeamId || game.awayTeamId === season.userTeamId,
  );
  if (fixture === undefined) throw new Error('Expected a user fixture');
  const input = fullCourtRegularSeasonGameInput(season, fixture.gameId);
  const { result, tape } = simulateRecordedFullCourtGame(input, createEngineContext());
  const userSide = fixture.homeTeamId === season.userTeamId ? 'home' : 'away';
  const game = {
    kind: 'played' as const,
    result,
    tape,
    health: {
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
    },
    injuries: [],
  };

  // The tape carries per-player deltas so a broadcast can show a live box.
  const tripDeltas = tape.flatMap((event) => (event.kind === 'trip' ? [event.deltas] : []));
  expect(tripDeltas.some((deltas) => deltas !== undefined)).toBe(true);

  const fold = fullCourtLiveBoxFold(game);
  expect(fold.linesAt(0).home.every((line) => line.points === 0)).toBe(true);

  // Halfway through, the live lines are a strict prefix of the final box.
  const halfway = fold.linesAt(Math.floor(tape.length / 2));
  const finalLines = fold.linesAt(tape.length);
  for (const [index, line] of finalLines.home.entries()) {
    expect(halfway.home[index]?.points ?? 0).toBeLessThanOrEqual(line.points);
  }
  expect(finalLines.home.reduce((total, line) => total + line.points, 0)).toBe(
    result.home.box.points,
  );
  expect(finalLines.away.reduce((total, line) => total + line.points, 0)).toBe(
    result.away.box.points,
  );
  // A backward seek rebuilds identically instead of drifting.
  expect(fold.linesAt(1).home.map((line) => line.points)).toEqual(
    fullCourtLiveBoxFold(game)
      .linesAt(1)
      .home.map((line) => line.points),
  );

  const report = buildFullCourtGameReport({
    kind: 'played',
    gameId: fixture.gameId,
    userSide,
    result,
    tape,
  });
  expect(report.status).toBe('played');

  const body = render(FullCourtGamecast, {
    props: {
      game,
      userTeamId: season.userTeamId,
      label: 'Game 1 of 82',
      note: 'vs Opponent',
      onclose: () => {},
    },
  }).body;
  expect(body).toContain('Full Court gamecast');
  expect(body).toContain('Game 1 of 82');
  expect(body).toContain('vs Opponent');
  expect(body).toContain('Skip to final');
  expect(body).toContain('Pause');
  expect(body).toContain('Skip and continue');
});

test('summarizes the recorded rotation and qualifies its lineups for the recap', () => {
  const { season } = fullCourtTestSeasonLock();
  const fixture = season.games[0];
  if (fixture === undefined) throw new Error('Expected an opening fixture');
  const input = fullCourtRegularSeasonGameInput(season, fixture.gameId);
  const { result, tape } = simulateRecordedFullCourtGame(input, createEngineContext());
  const userSide = result.home.teamId === season.userTeamId ? 0 : 1;
  const team = userSide === 0 ? result.home : result.away;
  const summary = fullCourtRotationSummary(team, userSide, tape);

  expect(summary.substitutions.length).toBeGreaterThan(0);
  const firstSubstitution = summary.firstSubstitution;
  expect(firstSubstitution).not.toBeNull();
  if (firstSubstitution === null) throw new Error('Expected a recorded substitution');
  expect(summary.reasonSummary).toContain(
    fullCourtSubstitutionReasonLabel(firstSubstitution.reason),
  );
  expect(summary.playersUsed).toBeGreaterThan(0);
  expect(summary.starterMinutes + summary.benchMinutes).toBeCloseTo(
    team.players.reduce((total, player) => total + player.minutes, 0),
    5,
  );

  const report = buildFullCourtGameReport({
    kind: 'played',
    gameId: fixture.gameId,
    userSide: userSide === 0 ? 'home' : 'away',
    result,
    tape,
  });
  expect(report.status).toBe('played');
  if (report.status === 'played') {
    const best = fullCourtBestLineup(report.lineupRows);
    if (best !== null) {
      expect(best.sampleMet).toBe(true);
      expect(best.netRatingPer100).not.toBeNull();
    }
  }
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
      label: 'Game 1 of 82',
      onclose: () => {},
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
