import { describe, expect, test } from 'bun:test';
import { buildHavocGameInput } from '@hoop-rush/test-fixtures';
import { seedSchema } from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../../sim/kernel.ts';
import { soloToBattleInput } from './battle-adapters.ts';
import { auditHavocBattleGame } from './battle-audit.ts';
import {
  simulateAuditedHavocBattleGame,
  simulateAuditedHavocBattleSummary,
  simulateValidatedHavocBattleGame,
} from './battle-game.ts';

describe('audited battle summaries', () => {
  test('preserves results, accounting, and playback across seeded games', () => {
    for (let index = 0; index < 8; index += 1) {
      const input = soloToBattleInput(buildHavocGameInput());
      input.seed = seedSchema.parse(index.toString(16).padStart(16, '0'));
      const recorded = simulateValidatedHavocBattleGame(input, createEngineContext());
      const summary = simulateAuditedHavocBattleGame(input, createEngineContext());
      expect(summary.result).toEqual(recorded.result);
      expect(summary.audit).toEqual(auditHavocBattleGame(input, recorded.result, recorded.tape));
      expect(summary.audit.ok).toBe(true);
      expect(summary.tape).toEqual(recorded.tape);
    }
  });

  test('compact audited summaries match the tape-backed result and audit', () => {
    for (let index = 0; index < 12; index += 1) {
      const input = soloToBattleInput(buildHavocGameInput());
      input.seed = seedSchema.parse(index.toString(16).padStart(16, '0'));
      const recorded = simulateValidatedHavocBattleGame(input, createEngineContext());
      const compact = simulateAuditedHavocBattleSummary(input, createEngineContext());
      expect(compact.result).toEqual(recorded.result);
      expect(compact.audit).toEqual(auditHavocBattleGame(input, recorded.result, recorded.tape));
      expect(compact.audit.ok).toBe(true);
    }
  });
});
