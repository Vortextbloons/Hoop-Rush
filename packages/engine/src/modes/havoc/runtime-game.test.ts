import { describe, expect, it } from 'bun:test';
import {
  buildHavocGameInput as buildFixtureGameInput,
  buildHavocLockedInputs,
} from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../../sim/kernel.ts';
import {
  simulateAuditedHavocGame,
  simulateAuditedHavocSummaryGame,
  simulateHavocGame,
} from './game.ts';
import { havocGameResultDigest, havocGameTapeDigest } from './digests.ts';
import { auditHavocGame } from './audit.ts';
import { buildHavocGameInput } from './input.ts';

describe('havoc runtime smoke', () => {
  it('simulates a full game deterministically', () => {
    const input = buildFixtureGameInput();
    const context = createEngineContext();
    const first = simulateHavocGame(input, context);
    const second = simulateHavocGame(input, context);
    expect(havocGameTapeDigest(first.tape)).toBe(havocGameTapeDigest(second.tape));
    expect(havocGameResultDigest(first.result)).toBe(havocGameResultDigest(second.result));
    const events = first.tape.events;
    const kinds = new Set(events.map((event) => event.kind));
    expect(kinds.has('period-start')).toBe(true);
    expect(kinds.has('shot-attempt')).toBe(true);
    expect(kinds.has('game-end')).toBe(true);
    expect(first.result.home.participants.length).toBeGreaterThanOrEqual(5);
    expect(first.tape.scoring.length).toBeGreaterThan(0);
    const audit = auditHavocGame(input, first.result, first.tape);
    expect(audit.findings).toEqual([]);
    expect(audit.ok).toBe(true);
  });

  it('simulates a game from locked inputs through both variants', () => {
    const locked = buildHavocLockedInputs();
    const context = createEngineContext();
    const havoc = buildHavocGameInput({ locked, gameNumber: 1, variant: 'havoc' });
    const normal = buildHavocGameInput({ locked, gameNumber: 1, variant: 'normal' });
    expect(havoc.seed).toBe(normal.seed);
    for (const team of [normal.home, normal.away]) {
      expect(team.clones.length).toBe(0);
      expect(team.starters.length).toBe(5);
      expect(team.starters.every((starter) => starter.mutationPackage.length === 0)).toBe(true);
    }
    const havocGame = simulateHavocGame(havoc, context);
    const normalGame = simulateHavocGame(normal, context);
    expect(havocGame.result.variant).toBe('havoc');
    expect(normalGame.result.variant).toBe('normal');
    for (const team of [normalGame.result.home, normalGame.result.away]) {
      expect(team.participants.length).toBeGreaterThanOrEqual(5);
      expect(team.participants.every((line) => line.kind !== 'clone')).toBe(true);
    }
  });

  it('audits before conversion with identical results, tapes, and audit findings', () => {
    const locked = buildHavocLockedInputs();
    const context = createEngineContext();
    for (const variant of ['havoc', 'normal'] as const) {
      for (let gameNumber = 1; gameNumber <= 12; gameNumber += 1) {
        const input = buildHavocGameInput({ locked, gameNumber, variant });
        const expected = simulateHavocGame(input, context);
        const actual = simulateAuditedHavocGame(input, context);
        expect(actual.result).toEqual(expected.result);
        expect(actual.tape).toEqual(expected.tape);
        expect(actual.audit).toEqual(auditHavocGame(input, expected.result, expected.tape));
        expect(actual.audit.ok).toBe(true);
      }
    }
  });

  it('keeps the tape-free audited path equal to the recorded path', () => {
    const locked = buildHavocLockedInputs();
    const context = createEngineContext();
    for (const variant of ['havoc', 'normal'] as const) {
      for (let gameNumber = 1; gameNumber <= 12; gameNumber += 1) {
        const input = buildHavocGameInput({ locked, gameNumber, variant });
        const recorded = simulateAuditedHavocGame(input, context);
        const summary = simulateAuditedHavocSummaryGame(input, context);
        expect(summary.result).toEqual(recorded.result);
        expect(havocGameResultDigest(summary.result)).toBe(havocGameResultDigest(recorded.result));
        expect(summary.audit).toEqual(recorded.audit);
        expect(summary.audit.ok).toBe(true);
      }
    }
  });

  it('pins default 24/24 results and tapes under engine v26', () => {
    const context = createEngineContext();
    const fixture = simulateHavocGame(buildFixtureGameInput(), context);
    expect(havocGameResultDigest(fixture.result)).toBe(DEFAULT_HAVOC_RESULT_DIGEST);
    expect(havocGameTapeDigest(fixture.tape)).toBe(DEFAULT_HAVOC_TAPE_DIGEST);
    const locked = buildHavocLockedInputs();
    const havoc = simulateHavocGame(
      buildHavocGameInput({ locked, gameNumber: 1, variant: 'havoc' }),
      context,
    );
    const normal = simulateHavocGame(
      buildHavocGameInput({ locked, gameNumber: 1, variant: 'normal' }),
      context,
    );
    expect(havocGameResultDigest(havoc.result)).toBe(LOCKED_HAVOC_RESULT_DIGEST);
    expect(havocGameTapeDigest(havoc.tape)).toBe(LOCKED_HAVOC_TAPE_DIGEST);
    expect(havocGameResultDigest(normal.result)).toBe(LOCKED_NORMAL_RESULT_DIGEST);
    expect(havocGameTapeDigest(normal.tape)).toBe(LOCKED_NORMAL_TAPE_DIGEST);
    for (const game of [fixture, havoc, normal]) {
      expect(game.tape.events.every((event) => event.kind !== 'time-lord')).toBe(true);
      expect(game.tape.events.every((event) => event.kind !== 'shot-clock-violation')).toBe(true);
    }
  });
});

const DEFAULT_HAVOC_RESULT_DIGEST = 'ca928d4fd5a8d7bbfbcf434115e811ff';
const DEFAULT_HAVOC_TAPE_DIGEST = '4f77783c1f435ef046a1d55e3ae57b6c';
const LOCKED_HAVOC_RESULT_DIGEST = '78cea5f6d86e48b25ed29730c14577c6';
const LOCKED_HAVOC_TAPE_DIGEST = 'a26d5dd8822ec81c05b6bb9ab9cd92a8';
const LOCKED_NORMAL_RESULT_DIGEST = '5d80424f23b7836b4804a29d4450015f';
const LOCKED_NORMAL_TAPE_DIGEST = '15b6c05eda5d508ab59129049d89278e';
