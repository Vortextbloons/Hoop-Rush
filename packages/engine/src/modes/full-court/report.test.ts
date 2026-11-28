import { describe, expect, it } from 'bun:test';
import { FULL_COURT_HEALTH_VERSION } from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../sim/kernel.ts';
import {
  buildFullCourtGameReport,
  fullCourtCompletedGameFacts,
  fullCourtLineupKey,
  type FullCourtForfeitGameReport,
  type FullCourtGameReport,
  type FullCourtPlayedGameReport,
} from './report.ts';
import { simulateRecordedFullCourtGame } from './game.ts';
import { fullCourtTestInput, fullCourtTestRoster } from './game-test-support.ts';
import { fullCourtScoreOutcome } from './score.ts';

const ctx = createEngineContext();

function playedReport(input: {
  readonly seed: string;
  readonly homeSize?: number;
  readonly awaySize?: number;
  readonly minuteTargets?: Readonly<Record<string, number>>;
}) {
  const homeRoster = fullCourtTestRoster('home', input.homeSize ?? 10, (index) => ({
    rating: 70 + (index % 4),
  }));
  const awayRoster = fullCourtTestRoster('away', input.awaySize ?? 10, (index) => ({
    rating: 71 + (index % 3),
  }));
  const { result, tape } = simulateRecordedFullCourtGame(
    fullCourtTestInput({
      seed: input.seed,
      homeRoster,
      awayRoster,
      ...(input.minuteTargets === undefined
        ? {}
        : { homeRotation: { minuteTargets: input.minuteTargets } }),
    }),
    ctx,
  );
  const report = buildFullCourtGameReport(
    { kind: 'played', gameId: `fc-${input.seed}`, userSide: 'home', result, tape },
    { sampleThreshold: 20 },
  );
  return { result, tape, report: asPlayed(report) };
}

function asPlayed(report: FullCourtGameReport): FullCourtPlayedGameReport {
  if (report.status !== 'played') throw new Error('expected a played report');
  return report;
}

function asForfeit(report: FullCourtGameReport): FullCourtForfeitGameReport {
  if (report.status !== 'forfeit') throw new Error('expected a forfeit report');
  return report;
}

function sumRows(
  report: FullCourtPlayedGameReport,
  field: keyof FullCourtPlayedGameReport['lineupRows'][number],
): number {
  return report.lineupRows.reduce((total, row) => {
    const value = row[field];
    if (typeof value !== 'number') throw new Error(`row field ${field} is not numeric`);
    return total + value;
  }, 0);
}

describe('Full Court game report', () => {
  it('reconciles lineup minutes, possessions, points, and net rating from stints and tape', () => {
    const { result, report } = playedReport({ seed: 'report-rows', homeSize: 7, awaySize: 9 });
    const opponent = result.away;
    const user = result.home;

    expect(report.status).toBe('played');
    expect(report.userSide).toBe('home');
    expect(report.sampleThreshold).toBe(20);
    expect(report.lineupRows.length).toBe(
      new Set(user.stints.map((stint) => fullCourtLineupKey(stint.playerIds))).size,
    );
    expect(sumRows(report, 'seconds')).toBe(user.liveSeconds);
    expect(sumRows(report, 'offensivePossessions')).toBe(user.box.possessions);
    expect(sumRows(report, 'defensivePossessions')).toBe(opponent.box.possessions);
    expect(sumRows(report, 'pointsFor')).toBe(user.box.points);
    expect(sumRows(report, 'pointsAgainst')).toBe(opponent.box.points);

    for (const row of report.lineupRows) {
      expect(row.playerIds).toHaveLength(5);
      expect(row.playerIds).toEqual([...row.playerIds].sort());
      expect(row.key).toBe(row.playerIds.join('|'));
      expect(row.pacePossessions).toBe((row.offensivePossessions + row.defensivePossessions) / 2);
      expect(row.netPoints).toBe(row.pointsFor - row.pointsAgainst);
      expect(row.netRatingPer100).toBe(
        row.offensivePossessions === 0 || row.defensivePossessions === 0
          ? null
          : Math.round(
              (row.pointsFor / row.offensivePossessions -
                row.pointsAgainst / row.defensivePossessions) *
                1000,
            ) / 10,
      );
      expect(row.sampleMet).toBe(row.pacePossessions >= report.sampleThreshold);
    }
  });

  it('keeps a five that returns in a later stint as one row', () => {
    let found: {
      readonly result: ReturnType<typeof playedReport>['result'];
      readonly report: FullCourtPlayedGameReport;
      readonly repeatedKey: string;
    } | null = null;
    for (let attempt = 0; attempt < 30 && found === null; attempt += 1) {
      const { result, report } = playedReport({
        seed: `report-repeat-${String(attempt)}`,
        homeSize: 7,
        awaySize: 7,
      });
      const keys = result.home.stints.map((stint) => fullCourtLineupKey(stint.playerIds));
      const repeatedKey = keys.find((key, index) => keys.indexOf(key) !== index);
      if (repeatedKey !== undefined) found = { result, report, repeatedKey };
    }
    expect(found).not.toBeNull();
    if (found === null) return;

    const row = found.report.lineupRows.find((entry) => entry.key === found.repeatedKey);
    expect(row).toBeDefined();
    if (row === undefined) return;
    const expectedSeconds = found.result.home.stints
      .filter((stint) => fullCourtLineupKey(stint.playerIds) === found.repeatedKey)
      .reduce((total, stint) => total + stint.seconds, 0);
    expect(row.seconds).toBe(expectedSeconds);
  });

  it('reports bench scoring from the players who actually played', () => {
    const homeSize = 12;
    const roster = fullCourtTestRoster('bench', homeSize, (index) => ({ rating: 68 + index }));
    const targetMinutes = [36, 34, 32, 30, 28, 24, 20, 16, 10, 6, 0, 0];
    const minuteTargets = Object.fromEntries(
      roster.map((player, index) => [player.playerId, targetMinutes[index] ?? 0]),
    );
    const { result, report } = playedReport({
      seed: 'report-bench',
      homeSize,
      awaySize: 9,
      minuteTargets,
    });

    const expectedBench = result.home.players.filter(
      (player) => !player.startedGame && player.seconds > 0,
    );
    expect(expectedBench.length).toBeGreaterThan(0);
    expect(report.bench.players.map((player) => player.playerId).sort()).toEqual(
      expectedBench.map((player) => player.playerId).sort(),
    );
    expect(report.bench.points).toBe(
      expectedBench.reduce((total, player) => total + player.points, 0),
    );
    expect(report.bench.starterPoints + report.bench.points).toBe(result.home.box.points);
    expect(report.bench.teamPoints).toBe(result.home.box.points);
    expect(report.bench.share).toBe(
      Math.round((report.bench.points / result.home.box.points) * 1000) / 1000,
    );
    expect(report.bench.players.every((player) => player.seconds > 0)).toBe(true);
  });

  it('builds completed-game facts that sum back to the reported score', () => {
    const { report } = playedReport({ seed: 'report-facts', homeSize: 9 });
    const facts = fullCourtCompletedGameFacts(report);
    expect(facts).not.toBeNull();
    if (facts === null) return;
    expect(facts.gameId).toBe(report.gameId);
    expect(facts.gameNumber).toBe(report.gameNumber);
    expect(facts.teamPoints).toBe(report.userPoints);
    expect(facts.starterPoints + facts.benchPoints + facts.teamBonusPoints).toBe(facts.teamPoints);
    expect(facts.teamBonusPoints).toBe(report.teamBonusPoints);
    expect(facts.benchPlayerCount).toBe(report.bench.players.length);
  });

  it('rejects a tape whose score does not reconcile with the box score', () => {
    const { result, tape } = simulateRecordedFullCourtGame(
      fullCourtTestInput({ seed: 'report-tamper', homeRoster: fullCourtTestRoster('home', 9) }),
      ctx,
    );
    const tampered = tape.map((event) =>
      event.kind === 'trip' ? { ...event, homeScore: event.homeScore + 1 } : event,
    );
    expect(() =>
      buildFullCourtGameReport({
        kind: 'played',
        gameId: 'fc-tamper',
        userSide: 'home',
        result,
        tape: tampered,
      }),
    ).toThrow(/tape score/);
  });

  it('attributes emergency technical points to the five on the floor', () => {
    const roster = fullCourtTestRoster('stuck', 5, () => ({ rating: 74, foulRate: 100 }));
    const { result, tape } = simulateRecordedFullCourtGame(
      fullCourtTestInput({ seed: 'stuck-2', homeRoster: roster }),
      ctx,
    );
    expect(tape.some((event) => event.kind === 'technical')).toBe(true);
    const report = asPlayed(
      buildFullCourtGameReport({
        kind: 'played',
        gameId: 'fc-technical',
        userSide: 'home',
        result,
        tape,
      }),
    );
    expect(sumRows(report, 'pointsFor')).toBe(result.home.box.points);
    expect(sumRows(report, 'pointsAgainst')).toBe(result.away.box.points);
    expect(sumRows(report, 'offensivePossessions')).toBe(result.home.box.possessions);
    expect(sumRows(report, 'defensivePossessions')).toBe(result.away.box.possessions);
  });

  it('reconciles all 200 Standard seeds per lineup against recorded stints', () => {
    const homeRoster = fullCourtTestRoster('audit-home', 10, (index) => ({
      rating: 70 + (index % 4),
    }));
    const awayRoster = fullCourtTestRoster('audit-away', 10, (index) => ({
      rating: 71 + (index % 3),
    }));

    for (let index = 0; index < 200; index += 1) {
      const { result, tape } = simulateRecordedFullCourtGame(
        fullCourtTestInput({
          seed: `report-batch-${String(index)}`,
          homeRoster,
          awayRoster,
        }),
        ctx,
      );
      const report = asPlayed(
        buildFullCourtGameReport({
          kind: 'played',
          gameId: `fc-batch-${String(index)}`,
          userSide: 'home',
          result,
          tape,
        }),
      );
      const expectedByKey = new Map<
        string,
        { seconds: number; points: number; possessions: number }
      >();
      for (const stint of result.home.stints) {
        const key = fullCourtLineupKey(stint.playerIds);
        const current = expectedByKey.get(key) ?? { seconds: 0, points: 0, possessions: 0 };
        current.seconds += stint.seconds;
        current.points += stint.points;
        current.possessions += stint.possessions;
        expectedByKey.set(key, current);
      }
      expect(report.lineupRows).toHaveLength(expectedByKey.size);
      for (const row of report.lineupRows) {
        const expected = expectedByKey.get(row.key);
        expect(expected).toBeDefined();
        if (expected === undefined) continue;
        expect(row.seconds).toBe(expected.seconds);
        expect(row.pointsFor).toBe(expected.points);
        expect(row.offensivePossessions).toBe(expected.possessions);
      }
    }
  });

  it('computes netRatingPer100 as true ORtg minus DRtg from independent possession counts', () => {
    const { result, tape } = simulateRecordedFullCourtGame(
      fullCourtTestInput({
        seed: 'ortg-drtg',
        homeRoster: fullCourtTestRoster('ortg-home', 10),
        awayRoster: fullCourtTestRoster('ortg-away', 10),
      }),
      ctx,
    );
    const report = asPlayed(
      buildFullCourtGameReport({
        kind: 'played',
        gameId: 'fc-ortg-drtg',
        userSide: 'home',
        result,
        tape,
      }),
    );
    const asymmetric = report.lineupRows.find(
      (row) =>
        row.offensivePossessions > 0 &&
        row.defensivePossessions > 0 &&
        row.offensivePossessions !== row.defensivePossessions,
    );
    expect(asymmetric).toBeDefined();
    if (asymmetric === undefined) return;
    const expectedOrtgMinusDrtg =
      Math.round(
        (asymmetric.pointsFor / asymmetric.offensivePossessions -
          asymmetric.pointsAgainst / asymmetric.defensivePossessions) *
          1000,
      ) / 10;
    expect(asymmetric.netRatingPer100).toBe(expectedOrtgMinusDrtg);
  });

  it('rejects a tape that misplaces points between lineups even when final scores match', () => {
    const homeRoster = fullCourtTestRoster('misplace-h', 10);
    const awayRoster = fullCourtTestRoster('misplace-a', 10);
    let found: {
      result: ReturnType<typeof playedReport>['result'];
      tape: ReturnType<typeof playedReport>['tape'];
    } | null = null;
    for (let attempt = 0; attempt < 20 && found === null; attempt += 1) {
      const run = simulateRecordedFullCourtGame(
        fullCourtTestInput({ seed: `misplace-${String(attempt)}`, homeRoster, awayRoster }),
        ctx,
      );
      const distinctKeys = new Set(
        run.result.home.stints.map((s) => fullCourtLineupKey(s.playerIds)),
      );
      if (distinctKeys.size >= 2) found = run;
    }
    expect(found).not.toBeNull();
    if (found === null) return;
    const { result, tape } = found;
    const firstStint = result.home.stints[0];
    if (firstStint === undefined) throw new Error('expected an opening stint');
    const firstKey = fullCourtLineupKey(firstStint.playerIds);
    let prevHomeScore = 0;
    const otherTripIndex = tape.findIndex((event) => {
      if (event.kind === 'technical') {
        if (event.made && event.side === 0) prevHomeScore += 1;
        return false;
      }
      if (event.kind !== 'trip') return false;
      const scored = event.homeScore !== prevHomeScore;
      prevHomeScore = event.homeScore;
      return scored && fullCourtLineupKey(event.homeUnit) !== firstKey;
    });
    expect(otherTripIndex).toBeGreaterThan(-1);
    const tampered = tape.map((event, index) =>
      index === otherTripIndex && event.kind === 'trip'
        ? { ...event, homeUnit: firstStint.playerIds }
        : event,
    );
    expect(() =>
      buildFullCourtGameReport({
        kind: 'played',
        gameId: 'fc-misplace',
        userSide: 'home',
        result,
        tape: tampered,
      }),
    ).toThrow(/reconcile/);
  });
});

describe('Full Court forfeit report', () => {
  it('reports a user forfeit without inventing points or lineups', () => {
    const report = asForfeit(
      buildFullCourtGameReport({
        kind: 'forfeit',
        gameId: 'fc-forfeit-user',
        gameNumber: 12,
        userSide: 'home',
        losingSides: ['home'],
      }),
    );
    expect(report.status).toBe('forfeit');
    expect(report.userForfeit).toBe(true);
    expect(report.opponentForfeit).toBe(false);
    expect(report.userWon).toBe(false);
    expect(report.lineupRows).toEqual([]);
    expect(report.bench).toBeNull();
    expect(fullCourtCompletedGameFacts(report)).toBeNull();
  });

  it('treats an opponent forfeit as a user win and a double forfeit as no winner', () => {
    const win = asForfeit(
      buildFullCourtGameReport({
        kind: 'forfeit',
        gameId: 'fc-forfeit-opponent',
        gameNumber: 13,
        userSide: 'away',
        losingSides: ['home'],
      }),
    );
    expect(win.status).toBe('forfeit');
    expect(win.userWon).toBe(true);
    expect(win.userForfeit).toBe(false);
    expect(win.opponentForfeit).toBe(true);

    const double = asForfeit(
      buildFullCourtGameReport({
        kind: 'forfeit',
        gameId: 'fc-forfeit-double',
        gameNumber: 14,
        userSide: 'home',
        losingSides: ['home', 'away'],
      }),
    );
    expect(double.status).toBe('forfeit');
    expect(double.userWon).toBeNull();
    expect(double.userForfeit).toBe(true);
    expect(double.opponentForfeit).toBe(true);
  });

  it('rejects an empty losing side list', () => {
    expect(() =>
      buildFullCourtGameReport({
        kind: 'forfeit',
        gameId: 'fc-forfeit-invalid',
        gameNumber: 15,
        userSide: 'home',
        losingSides: [],
      }),
    ).toThrow(/forfeit/);
  });
});
