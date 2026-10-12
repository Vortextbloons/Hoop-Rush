import { describe, expect, it } from 'vitest';
import {
  assembleSeasonBlockCandidate,
  simulateSeasonBlock,
  seasonBlockGameSteps,
  type SeasonBlockIterationAccumulator,
} from './index.ts';
import { buildTestRun, pipelineInput } from '../block-test-support.ts';

describe('seasonBlockGameSteps', () => {
  it('assembles the same checkpoint as simulateSeasonBlock', () => {
    const { run, catalog } = buildTestRun();
    const input = pipelineInput(run, catalog, 0);
    const monolithic = simulateSeasonBlock(input);
    let accumulator: SeasonBlockIterationAccumulator | null = null;
    for (const step of seasonBlockGameSteps({ input, blockIndex: 0 })) {
      if (step.kind === 'complete') accumulator = step.accumulator;
    }
    if (accumulator === null) throw new Error('missing complete step');
    const assembled = assembleSeasonBlockCandidate({
      input,
      summaries: accumulator.summaries,
      retainedDetails: accumulator.retainedDetails,
      effects: accumulator.effects,
      health: accumulator.health,
    });
    expect(assembled.digest).toBe(monolithic.digest);
  });
});
