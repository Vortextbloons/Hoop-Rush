import { describe, expect, it } from 'vitest';
import type { HavocBattleInput } from '@hoop-rush/data-contracts';
import { havocBattleInputSchema } from '@hoop-rush/data-contracts';
import { buildHavocLockedInputs } from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../../sim/kernel.ts';
import {
  battleToSoloResult,
  battleToSoloTape,
  soloToBattleInput,
  soloToBattleResult,
  soloToBattleTape,
} from './core/battle-adapters.ts';
import { auditHavocBattleGame } from './core/battle-audit.ts';
import {
  havocBattleGameInputDigest,
  havocBattleGameResultDigest,
  havocBattleGameTapeDigest,
} from './core/battle-digests.ts';
import { simulateHavocBattleGame } from './core/battle-game.ts';
import { havocGameInputDigest, havocGameResultDigest, havocGameTapeDigest } from './digests.ts';
import { simulateHavocGame } from './game.ts';
import { buildHavocGameInput } from './input.ts';
import { buildScenarioTeam } from './runtime-test-support.ts';

const DIGEST_PATTERN = /^[0-9a-f]{32}$/;

function lockedBattleInput(): HavocBattleInput {
  const locked = buildHavocLockedInputs();
  const soloInput = buildHavocGameInput({ locked, gameNumber: 1, variant: 'havoc' });
  return soloToBattleInput(soloInput);
}

/** Both sides field tier-1 profile-operation mutations in a battle input. */
function twoSidedBattleInput(): HavocBattleInput {
  const locked = buildHavocLockedInputs();
  const base = buildHavocGameInput({ locked, gameNumber: 1, variant: 'havoc' });
  const home = buildScenarioTeam('human', [
    { slot: 'PG', mutations: ['sniper-gene', 'glass-eater', 'point-god'] },
    { slot: 'SG', mutations: [] },
    { slot: 'SF', mutations: [] },
    { slot: 'PF', mutations: [] },
    { slot: 'C', mutations: [] },
  ]);
  const away = buildScenarioTeam('opponent', [
    { slot: 'PG', mutations: [] },
    { slot: 'SG', mutations: ['sniper-gene', 'glass-eater', 'point-god'] },
    { slot: 'SF', mutations: [] },
    { slot: 'PF', mutations: [] },
    { slot: 'C', mutations: [] },
  ]);
  return havocBattleInputSchema.parse({
    ...base,
    home: { ...home, side: 'home' },
    away: { ...away, side: 'away' },
  });
}

describe('havoc battle runtime', () => {
  it('simulates and audits a locked fixture game on the battle contracts', () => {
    const input = lockedBattleInput();
    const context = createEngineContext();
    const first = simulateHavocBattleGame(input, context);
    const second = simulateHavocBattleGame(input, context);

    const audit = auditHavocBattleGame(input, first.result, first.tape);
    expect(audit.findings).toEqual([]);
    expect(audit.ok).toBe(true);

    const inputDigest = havocBattleGameInputDigest(input);
    const resultDigest = havocBattleGameResultDigest(first.result);
    const tapeDigest = havocBattleGameTapeDigest(first.tape);
    for (const digest of [inputDigest, resultDigest, tapeDigest]) {
      expect(digest).toMatch(DIGEST_PATTERN);
    }
    expect(first.result.inputDigest).toBe(inputDigest);
    expect(first.result.home.side).toBe('home');
    expect(first.result.away.side).toBe('away');

    expect(havocBattleGameResultDigest(second.result)).toBe(resultDigest);
    expect(havocBattleGameTapeDigest(second.tape)).toBe(tapeDigest);
  });

  it('round-trips battle results and tapes through the solo contracts losslessly', () => {
    const locked = buildHavocLockedInputs();
    const soloInput = buildHavocGameInput({ locked, gameNumber: 1, variant: 'havoc' });
    const context = createEngineContext();
    const battleInput = soloToBattleInput(soloInput);
    const battle = simulateHavocBattleGame(battleInput, context);

    const soloResult = battleToSoloResult(
      battle.result,
      soloInput.humanSide,
      havocGameInputDigest(soloInput),
    );
    const soloTape = battleToSoloTape(battle.tape, soloInput.humanSide);
    const soloSimulation = simulateHavocGame(soloInput, context);
    expect(havocGameResultDigest(soloResult)).toBe(havocGameResultDigest(soloSimulation.result));
    expect(havocGameTapeDigest(soloTape)).toBe(havocGameTapeDigest(soloSimulation.tape));

    const reBattleResult = soloToBattleResult(
      soloResult,
      soloInput.humanSide,
      havocBattleGameInputDigest(battleInput),
    );
    const reBattleTape = soloToBattleTape(soloTape, soloInput.humanSide);
    expect(havocBattleGameResultDigest(reBattleResult)).toBe(
      havocBattleGameResultDigest(battle.result),
    );
    expect(havocBattleGameTapeDigest(reBattleTape)).toBe(havocBattleGameTapeDigest(battle.tape));
  });

  it('keeps battle digest prefixes distinct from the solo digests', () => {
    const locked = buildHavocLockedInputs();
    const soloInput = buildHavocGameInput({ locked, gameNumber: 1, variant: 'havoc' });
    const context = createEngineContext();
    const battleInput = soloToBattleInput(soloInput);
    const battle = simulateHavocBattleGame(battleInput, context);
    const solo = simulateHavocGame(soloInput, context);
    expect(havocBattleGameInputDigest(battleInput)).not.toBe(havocGameInputDigest(soloInput));
    expect(havocBattleGameResultDigest(battle.result)).not.toBe(havocGameResultDigest(solo.result));
    expect(havocBattleGameTapeDigest(battle.tape)).not.toBe(havocGameTapeDigest(solo.tape));
  });

  it('runs a two-sided battle with tier-1 profile mutations deterministically', () => {
    const input = twoSidedBattleInput();
    expect(input.home.starters[0]?.mutationPackage).toHaveLength(3);
    expect(input.away.starters[1]?.mutationPackage).toHaveLength(3);

    const context = createEngineContext();
    const first = simulateHavocBattleGame(input, context);
    const second = simulateHavocBattleGame(input, context);
    const audit = auditHavocBattleGame(input, first.result, first.tape);
    expect(audit.ok, audit.findings.map((finding) => finding.code).join(',')).toBe(true);

    const resultDigest = havocBattleGameResultDigest(first.result);
    const tapeDigest = havocBattleGameTapeDigest(first.tape);
    expect(resultDigest).toMatch(DIGEST_PATTERN);
    expect(tapeDigest).toMatch(DIGEST_PATTERN);
    expect(havocBattleGameResultDigest(second.result)).toBe(resultDigest);
    expect(havocBattleGameTapeDigest(second.tape)).toBe(tapeDigest);
  });
});
