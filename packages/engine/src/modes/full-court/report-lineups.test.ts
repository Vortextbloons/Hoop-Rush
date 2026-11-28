import { describe, expect, it } from 'bun:test';
import { fullCourtGameLineupsSchema } from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../sim/kernel.ts';
import {
  checkFullCourtGameResult,
  fullCourtGameDigest,
  runFullCourtGame,
  simulateRecordedFullCourtGame,
  type FullCourtTapeEvent,
} from './game.ts';
import { fullCourtTestInput, fullCourtTestRoster } from './game-test-support.ts';
import {
  buildFullCourtGameLineups,
  buildFullCourtGameLineupsFromFacts,
  fullCourtLineupKey,
  type FullCourtLineupFactsOptions,
} from './report.ts';

const ctx = createEngineContext();

function lineupsOf(
  seed: string,
  options: FullCourtLineupFactsOptions = {},
  homeSize = 10,
  awaySize = 9,
) {
  const { result, tape } = simulateRecordedFullCourtGame(
    fullCourtTestInput({
      seed,
      homeRoster: fullCourtTestRoster(`${seed}-home`, homeSize, (index) => ({
        rating: 70 + (index % 4),
      })),
      awayRoster: fullCourtTestRoster(`${seed}-away`, awaySize, (index) => ({
        rating: 71 + (index % 3),
      })),
    }),
    ctx,
  );
  const summary = buildFullCourtGameLineups(
    {
      kind: 'played',
      gameId: `fc-${seed}`,
      userSide: 'home',
      result,
      tape,
    },
    options,
  );
  return { result, tape, summary };
}

function sum(
  summary: ReturnType<typeof buildFullCourtGameLineups>,
  field:
    'seconds' | 'offensivePossessions' | 'defensivePossessions' | 'pointsFor' | 'pointsAgainst',
): number {
  return (
    summary.lineups.reduce((total, lineup) => total + lineup[field], 0) + summary.omitted[field]
  );
}

describe('Full Court compact lineups', () => {
  it('reconciles actual fives with the game report and validates the contract', () => {
    const { result, summary } = lineupsOf('lineup-compact', { sampleThreshold: 20 });
    const parsed = fullCourtGameLineupsSchema.parse(summary);

    expect(parsed.side).toBe('home');
    expect(parsed.lineups.length).toBe(
      new Set(result.home.stints.map((stint) => fullCourtLineupKey(stint.playerIds))).size,
    );
    expect(sum(parsed, 'seconds')).toBe(result.home.liveSeconds);
    expect(sum(parsed, 'offensivePossessions')).toBe(result.home.box.possessions);
    expect(sum(parsed, 'defensivePossessions')).toBe(result.away.box.possessions);
    expect(sum(parsed, 'pointsFor')).toBe(result.home.box.points);
    expect(sum(parsed, 'pointsAgainst')).toBe(result.away.box.points);
    expect(parsed.omitted).toEqual({
      lineups: 0,
      seconds: 0,
      offensivePossessions: 0,
      defensivePossessions: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    });
    for (const lineup of parsed.lineups) {
      expect(lineup.playerIds).toEqual([...lineup.playerIds].sort());
      expect(lineup.players.map((player) => player.playerId)).toEqual(lineup.playerIds);
    }
  });

  it('caps low-usage groups without hiding their totals', () => {
    const { result, summary } = lineupsOf('lineup-cap', { maxLineups: 1 });
    const parsed = fullCourtGameLineupsSchema.parse(summary);

    expect(parsed.lineups).toHaveLength(1);
    expect(parsed.omitted.lineups).toBeGreaterThan(0);
    expect(sum(parsed, 'seconds')).toBe(result.home.liveSeconds);
    expect(sum(parsed, 'pointsFor')).toBe(result.home.box.points);
    expect(sum(parsed, 'pointsAgainst')).toBe(result.away.box.points);
  });

  it('produces identical results and facts with and without a requested tape', () => {
    const input = fullCourtTestInput({
      seed: 'lineup-determinism',
      homeRoster: fullCourtTestRoster('determinism-home', 10),
      awayRoster: fullCourtTestRoster('determinism-away', 10),
    });
    const first = simulateRecordedFullCourtGame(input, ctx);
    const second = simulateRecordedFullCourtGame(input, ctx);
    const unrecorded = runFullCourtGame(input, ctx);
    const factsOnly = runFullCourtGame(input, ctx, { lineupFacts: true });

    expect(second.result).toEqual(first.result);
    expect(second.tape).toEqual(first.tape);
    expect(unrecorded.result).toEqual(first.result);
    expect(unrecorded.tape).toBeNull();
    expect(unrecorded.lineupFacts).toBeNull();
    expect(factsOnly.result).toEqual(first.result);
    expect(fullCourtGameDigest(factsOnly.result)).toBe(fullCourtGameDigest(first.result));
    expect(factsOnly.tape).toBeNull();
    if (factsOnly.lineupFacts === null) throw new Error('expected compact lineup facts');

    const inputFor = (tape: readonly FullCourtTapeEvent[], userSide: 'home' | 'away') => ({
      kind: 'played' as const,
      gameId: 'fc-lineup-determinism',
      userSide,
      result: first.result,
      tape,
    });
    for (const side of ['home', 'away'] as const) {
      expect(
        buildFullCourtGameLineupsFromFacts(
          {
            kind: 'played',
            gameId: 'fc-lineup-determinism',
            userSide: side,
            result: first.result,
            facts: factsOnly.lineupFacts,
          },
          { sampleThreshold: 20 },
        ),
      ).toEqual(buildFullCourtGameLineups(inputFor(first.tape, side), { sampleThreshold: 20 }));
    }
    expect(
      buildFullCourtGameLineups(inputFor(second.tape, 'home'), { sampleThreshold: 20 }),
    ).toEqual(buildFullCourtGameLineups(inputFor(first.tape, 'home'), { sampleThreshold: 20 }));
  });

  it('matches tape-derived facts across substitutions, technicals, and overtime', () => {
    const cases: Array<{
      readonly name: string;
      readonly seed: string;
      readonly input: ReturnType<typeof fullCourtTestInput>;
    }> = [
      {
        name: 'substitutions',
        seed: 'lineup-parity-subs',
        input: fullCourtTestInput({
          seed: 'lineup-parity-subs',
          homeRoster: fullCourtTestRoster('parity-subs-home', 10),
          awayRoster: fullCourtTestRoster('parity-subs-away', 9),
        }),
      },
      {
        name: 'technical fouls',
        seed: 'lineup-stuck',
        input: fullCourtTestInput({
          seed: 'lineup-stuck',
          homeRoster: fullCourtTestRoster('parity-stuck', 5, () => ({
            rating: 74,
            foulRate: 100,
          })),
        }),
      },
      {
        name: 'overtime',
        seed: 'ot-1',
        input: fullCourtTestInput({
          seed: 'ot-1',
          homeRoster: fullCourtTestRoster('parity-ot-home', 10),
          awayRoster: fullCourtTestRoster('parity-ot-away', 10, () => ({ rating: 71 })),
        }),
      },
    ];

    for (const testCase of cases) {
      const recorded = simulateRecordedFullCourtGame(testCase.input, ctx);
      const factsOnly = runFullCourtGame(testCase.input, ctx, { lineupFacts: true });
      const { result } = recorded;
      expect(checkFullCourtGameResult(result)).toEqual([]);
      expect(factsOnly.result).toEqual(result);
      expect(fullCourtGameDigest(factsOnly.result)).toBe(fullCourtGameDigest(result));
      expect(factsOnly.tape).toBeNull();
      if (factsOnly.lineupFacts === null) throw new Error(`missing facts for ${testCase.name}`);
      expect(
        fullCourtGameLineupsSchema.parse(
          buildFullCourtGameLineupsFromFacts({
            kind: 'played',
            gameId: `fc-${testCase.seed}`,
            userSide: 'home',
            result,
            facts: factsOnly.lineupFacts,
          }),
        ).side,
      ).toBe('home');

      for (const side of ['home', 'away'] as const) {
        const fromTape = buildFullCourtGameLineups({
          kind: 'played',
          gameId: `fc-${testCase.seed}`,
          userSide: side,
          result,
          tape: recorded.tape,
        });
        const fromFacts = buildFullCourtGameLineupsFromFacts({
          kind: 'played',
          gameId: `fc-${testCase.seed}`,
          userSide: side,
          result,
          facts: factsOnly.lineupFacts,
        });
        expect(fromFacts).toEqual(fromTape);
      }

      if (testCase.name === 'substitutions') {
        expect(recorded.tape.some((event) => event.kind === 'substitution')).toBe(true);
      }
      if (testCase.name === 'technical fouls') {
        expect(recorded.tape.some((event) => event.kind === 'technical')).toBe(true);
      }
      if (testCase.name === 'overtime') {
        expect(result.overtimePeriods).toBeGreaterThan(0);
      }
    }
  });

  it('attributes emergency technical points to the actual five', () => {
    const roster = fullCourtTestRoster('lineup-stuck', 5, () => ({
      rating: 74,
      foulRate: 100,
    }));
    const { result, tape } = simulateRecordedFullCourtGame(
      fullCourtTestInput({ seed: 'lineup-stuck', homeRoster: roster }),
      ctx,
    );
    expect(tape.some((event) => event.kind === 'technical')).toBe(true);

    const summary = fullCourtGameLineupsSchema.parse(
      buildFullCourtGameLineups({
        kind: 'played',
        gameId: 'fc-lineup-stuck',
        userSide: 'home',
        result,
        tape,
      }),
    );
    expect(sum(summary, 'pointsFor')).toBe(result.home.box.points);
    expect(sum(summary, 'pointsAgainst')).toBe(result.away.box.points);
    expect(sum(summary, 'offensivePossessions')).toBe(result.home.box.possessions);
    expect(sum(summary, 'defensivePossessions')).toBe(result.away.box.possessions);
  });
});
