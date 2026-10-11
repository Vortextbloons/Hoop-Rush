import { describe, expect, it } from 'vitest';
import {
  blockRoundRange,
  seasonDigestHex,
  type SeasonGameSummary,
  type SeasonRetainedGameDetail,
} from '@hoop-rush/data-contracts';
import {
  assembleSeasonBlockCandidate,
  auditSeasonBlock,
  buildEvolutionDataSource,
  completeSeasonBlockCommit,
  deriveSeasonPostBlockState,
  seasonBlockGamesOf,
  simulateSeasonBlock,
  simulateSeasonBlockGame,
} from './block/index.ts';
import { buildTestRun, pipelineInput, scheduleOf } from './block-test-support.ts';

describe('season block pipeline golden pins', () => {
  it('simulates the opening block with a clean audit and frozen digests', () => {
    const { run, catalog } = buildTestRun();
    const input = pipelineInput(run, catalog, 0);
    const checkpoint = simulateSeasonBlock(input);
    expect(auditSeasonBlock(checkpoint, input)).toEqual([]);
    expect(checkpoint.completedRounds).toBe(10);
    expect(checkpoint.digest).toMatchInlineSnapshot(`"5ca91d146a8e1438bdc83c6e5360e584"`);

    const replayed = simulateSeasonBlock(input);
    expect(replayed.digest).toBe(checkpoint.digest);

    const schedule = scheduleOf(run);
    const evolutionData = buildEvolutionDataSource({
      run,
      candidate: checkpoint,
      priorSummaries: [],
      schedule,
    });
    const stateFacts = deriveSeasonPostBlockState({
      run,
      candidate: checkpoint,
      commandId: input.command.commandId,
      rotationDigest: input.command.rotationDigest,
      humanFranchiseId: 'lakers',
      evolutionData,
    });
    expect(stateFacts.stateDigest).toMatchInlineSnapshot(`"f9b47db8d9efe4d4f1ffa02e6ffa6fa8"`);

    const committed = completeSeasonBlockCommit({
      run,
      candidate: checkpoint,
      commandId: input.command.commandId,
      rotationDigest: input.command.rotationDigest,
      humanFranchiseId: 'lakers',
      catalog,
      effects: input.effects,
      schedule,
      priorSummaries: [],
    });
    expect(committed.stateDigest).toMatchInlineSnapshot(`"b95dc8c352e7b54f0ccad391768fe5f3"`);
    expect(committed.window).toBeNull();
    expect(committed.freeAgencyWindow).toBeNull();
    expect(committed.checkpointState.commandId).toBe(input.command.commandId);
    expect(committed.checkpointState.checkpointDigest).toBe(checkpoint.digest);
  });

  it('assembles the same candidate from recorded per-game outcomes', () => {
    const { run, catalog } = buildTestRun();
    const input = pipelineInput(run, catalog, 0);
    const schedule = scheduleOf(run);
    const summaries: SeasonGameSummary[] = [];
    const retainedDetails: SeasonRetainedGameDetail[] = [];
    let effects = input.effects;
    let health = input.health;
    let previousRound = blockRoundRange(input.command.blockIndex).fromRound - 1;
    for (const game of seasonBlockGamesOf(schedule, 0)) {
      const outcome = simulateSeasonBlockGame(input, game, effects, health, {
        skipRecoveryTick: !(previousRound !== 0 && game.round > previousRound),
      });
      if ('interruption' in outcome) throw new Error('unexpected interruption');
      effects = outcome.effects;
      health = outcome.health;
      previousRound = game.round;
      summaries.push(outcome.summary);
      if (outcome.retainedDetail !== null) retainedDetails.push(outcome.retainedDetail);
    }
    const assembled = assembleSeasonBlockCandidate(
      input,
      summaries,
      retainedDetails,
      effects,
      health,
    );
    const monolithic = simulateSeasonBlock(input);
    expect(assembled.digest).toBe(monolithic.digest);
  });

  it('pins one human game in the opening block', () => {
    const { run, catalog } = buildTestRun();
    const input = pipelineInput(run, catalog, 0);
    const game = seasonBlockGamesOf(scheduleOf(run), 0).find(
      (entry) => entry.homeFranchiseId === 'lakers' || entry.awayFranchiseId === 'lakers',
    );
    if (game === undefined) throw new Error('no human game in block 0');
    const first = simulateSeasonBlockGame({
      input,
      game,
      effects: input.effects,
      health: input.health,
    });
    if ('interruption' in first) throw new Error('unexpected interruption');
    const second = simulateSeasonBlockGame({
      input,
      game,
      effects: input.effects,
      health: input.health,
    });
    if ('interruption' in second) throw new Error('unexpected interruption');
    expect(JSON.stringify(second.summary)).toBe(JSON.stringify(first.summary));
    expect(seasonDigestHex(JSON.stringify(first.summary))).toMatchInlineSnapshot(
      `"81b86d2ccd14ad885a868c625b433c9c"`,
    );
  });
});
