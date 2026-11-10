import { describe, expect, it, spyOn } from 'bun:test';
import { havocBattleInputSchema, havocBattleTapeSchema } from '@hoop-rush/data-contracts';
import { buildHavocGameInput } from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../../sim/kernel.ts';
import { simulateAuditedHavocGame, simulateAuditedHavocSummaryGame } from './solo/simulate.ts';

describe('audited Havoc summaries', () => {
  it('preserves recorded results and audits without parsing an unused tape', () => {
    const input = buildHavocGameInput();
    const context = createEngineContext();
    const recorded = simulateAuditedHavocGame(input, context);
    const parse = spyOn(havocBattleTapeSchema, 'parse');
    const parseInput = spyOn(havocBattleInputSchema, 'parse');
    try {
      const summary = simulateAuditedHavocSummaryGame(input, context);
      expect(summary).toEqual({ result: recorded.result, audit: recorded.audit });
      expect(summary.audit.ok).toBe(true);
      expect(parse).not.toHaveBeenCalled();
      expect(parseInput).toHaveBeenCalledTimes(1);
    } finally {
      parse.mockRestore();
      parseInput.mockRestore();
    }
  });

  it('still rejects malformed external inputs', () => {
    const input = buildHavocGameInput();
    expect(() =>
      simulateAuditedHavocSummaryGame({ ...input, gameNumber: -1 }, createEngineContext()),
    ).toThrow();
  });
});
