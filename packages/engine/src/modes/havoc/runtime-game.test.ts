import { describe, expect, it } from 'vitest';
import {
  buildHavocGameInput as buildFixtureGameInput,
  buildHavocLockedInputs,
} from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../../sim/kernel.ts';
import { simulateHavocGame } from './game.ts';
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

  it('keeps default 24/24 digests byte-identical to the pre-Time-Lord-fix baseline', () => {
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

// Captured after the foul-avoidance calibration; default 24/24 games must not drift
// again without an explicit behavior change.
const DEFAULT_HAVOC_RESULT_DIGEST = 'c600303650ef19aa6a10484c6ccac186';
const DEFAULT_HAVOC_TAPE_DIGEST = '4dcada61bfa5b995ed96cf237bf8e3b1';
const LOCKED_HAVOC_RESULT_DIGEST = 'a1e08c56cf91c28289366e2cf517b366';
const LOCKED_HAVOC_TAPE_DIGEST = 'f246ced818f50974ec7a84925edd6f08';
const LOCKED_NORMAL_RESULT_DIGEST = '6f043858f5bb72445e702b9e0c4c7368';
const LOCKED_NORMAL_TAPE_DIGEST = 'c903a35e900ef912423b7c6cbee5b4ee';
