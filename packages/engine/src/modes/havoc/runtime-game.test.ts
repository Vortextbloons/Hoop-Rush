import { describe, expect, it } from 'bun:test';
import {
  buildHavocGameInput as buildFixtureGameInput,
  buildHavocLockedInputs,
} from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../../sim/kernel.ts';
import { simulateAuditedHavocGame, simulateHavocGame } from './game.ts';
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

  it('pins default 24/24 results and tapes under engine v25', () => {
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

const DEFAULT_HAVOC_RESULT_DIGEST = '89e81ea121e47055e8c7f35fb4b9fb11';
const DEFAULT_HAVOC_TAPE_DIGEST = '9f8bd3d106f82f25be45f7277e4bfea1';
const LOCKED_HAVOC_RESULT_DIGEST = '426645d994b0e85527cef4e341805da9';
const LOCKED_HAVOC_TAPE_DIGEST = '7a0469ab4fb58a8784c87a71565093bb';
const LOCKED_NORMAL_RESULT_DIGEST = 'd959de165fa4d1721248f364a92d85e6';
const LOCKED_NORMAL_TAPE_DIGEST = '27f2ff970b885e5b12f167098aa36a47';
