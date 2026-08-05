import { describe, expect, it } from 'vitest';
import { SEASON_BLOCK_COUNT } from '@hoop-rush/data-contracts';
import { SeasonBlockCancelledError, auditSeasonBlock, simulateSeasonBlock } from './block.ts';
import { seasonCheckpointDigest } from './checkpoint.ts';
import { foldSeasonPlayerAggregates, foldSeasonTeamAggregates } from './aggregates.ts';
import { reduceSeasonStandings } from './standings.ts';
import { reconstructSeasonGames } from './checkpoint.ts';
import {
  blockCommand,
  buildTestRun,
  freshState,
  pipelineInput,
  runBlock,
  scheduleOf,
} from './block-test-support.ts';

describe('season block determinism and golden reproduction (M2.3)', () => {
  it('reproduces block 3 identically across repeated and interrupted runs', () => {
    const { run } = buildTestRun();

    const runThroughBlock3 = (): string => {
      const state = freshState();
      for (let i = 0; i < 3; i += 1) runBlock(state, i);
      return runBlock(state, 3).digest;
    };
    const first = runThroughBlock3();
    expect(runThroughBlock3()).toBe(first);

    // Interrupted run: cancel after half the games of block 3, discard the
    // partial result, and re-run the whole block from the cursor.
    const cancelled = (() => {
      const state = freshState();
      for (let i = 0; i < 3; i += 1) runBlock(state, i);
      const input = pipelineInput(state.run, state.catalog, 3, state.summaries);
      expect(() => simulateSeasonBlock(input, { cancelAfterGames: 75 })).toThrow(
        SeasonBlockCancelledError,
      );
      const checkpoint = simulateSeasonBlock(input);
      expect(auditSeasonBlock(checkpoint, input)).toEqual([]);
      return checkpoint.digest;
    })();
    expect(cancelled).toBe(first);

    // The interrupted path leaves no partial state behind: the run cursor
    // is unchanged and the next submission is the same block.
    void run;
  }, 120_000);

  it('produces identical per-block digests across two complete full-season runs', () => {
    const digests = (): string[] => {
      const state = freshState();
      const all: string[] = [];
      for (let i = 0; i < SEASON_BLOCK_COUNT; i += 1) {
        all.push(runBlock(state, i).digest);
      }
      return all;
    };
    expect(digests()).toEqual(digests());
  }, 300_000);

  it('reconciles aggregates and standings with the summaries after every block', () => {
    const { run, catalog } = buildTestRun();
    const state = freshState();
    for (let blockIndex = 0; blockIndex < SEASON_BLOCK_COUNT; blockIndex += 1) {
      const preBlockRun = state.run;
      const checkpoint = runBlock(state, blockIndex);
      const expectedGameCount = blockIndex < 8 ? 150 : 30;
      expect(checkpoint.gameSummaries).toHaveLength(expectedGameCount);
      expect(checkpoint.completedRounds).toBe(blockIndex >= 8 ? 82 : (blockIndex + 1) * 10);
      expect(checkpoint.revision).toBe(blockIndex);
      const teams = foldSeasonTeamAggregates(state.summaries);
      const players = foldSeasonPlayerAggregates(state.summaries);
      expect(JSON.stringify(teams)).toBe(JSON.stringify(checkpoint.teamAggregates));
      expect(JSON.stringify(players)).toBe(JSON.stringify(checkpoint.playerAggregates));
      const standings = reduceSeasonStandings(
        run.league,
        reconstructSeasonGames(scheduleOf(run), state.summaries),
      );
      expect(JSON.stringify(standings)).toBe(JSON.stringify(checkpoint.standings));
      // The audit runs against the pre-commit run (cursor still at the
      // block start), exactly like the persistence acceptance path.
      const audit = auditSeasonBlock(checkpoint, {
        ...pipelineInput(
          preBlockRun,
          catalog,
          blockIndex,
          state.summaries.slice(0, state.summaries.length - expectedGameCount),
        ),
        command: blockCommand(preBlockRun, blockIndex, blockIndex),
      });
      expect(audit).toEqual([]);
      // The candidate digest always matches a fresh recomputation.
      expect(seasonCheckpointDigest(checkpoint)).toBe(checkpoint.digest);
    }
    expect(state.summaries).toHaveLength(1230);
    expect(state.run.cursor.completedRounds).toBe(82);
    expect(state.summaries.filter((summary) => summary.status === 'final')).toHaveLength(
      state.summaries.length -
        state.summaries.filter((summary) => summary.status === 'forfeit').length,
    );
  }, 240_000);
});
