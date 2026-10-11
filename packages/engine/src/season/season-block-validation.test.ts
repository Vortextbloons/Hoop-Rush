import { describe, expect, it } from 'vitest';
import {
  SEASON_FREE_AGENCY_VERSION,
  SEASON_OBJECTIVE_CATALOG,
  SEASON_OBJECTIVE_VERSION,
  commandIdSchema,
  idSchema,
  type SeasonFreeAgencyState,
  type SeasonFreeAgencyWindowState,
  type SeasonObjectiveState,
} from '@hoop-rush/data-contracts';
import {
  handleSubmitSeasonBlockCommand,
  seasonBlockRejection,
  type SeasonBlockSimulationInput,
} from './block.ts';
import { buildTestRun, pipelineInput } from './block-test-support.ts';

function validInput(): SeasonBlockSimulationInput {
  const { run, catalog } = buildTestRun();
  return pipelineInput(run, catalog, 0);
}

describe('seasonBlockRejection', () => {
  it('accepts the next block boundary', () => {
    expect(seasonBlockRejection(validInput())).toBeNull();
  });

  it('rejects run mismatches, duplicates, stale cursors, and non-boundary blocks', () => {
    const input = validInput();
    expect(
      seasonBlockRejection({
        ...input,
        command: { ...input.command, runId: idSchema.parse('other-run') },
      }),
    ).toEqual({ code: 'run-mismatch', expectedRunId: input.run.runId });
    expect(seasonBlockRejection(input, [input.command.commandId])).toEqual({
      code: 'duplicate-command',
      commandId: input.command.commandId,
    });
    expect(
      seasonBlockRejection({ ...input, command: { ...input.command, expectedRevision: 1 } }),
    ).toMatchObject({ code: 'stale-cursor', currentRevision: 0 });
    expect(
      seasonBlockRejection({ ...input, command: { ...input.command, blockIndex: 1 } }),
    ).toEqual({
      code: 'non-boundary-block',
      expectedBlockIndex: 0,
      submittedBlockIndex: 1,
    });
  });

  it('rejects rotation digest drift', () => {
    const input = validInput();
    const rejection = seasonBlockRejection({
      ...input,
      command: { ...input.command, rotationDigest: 'f'.repeat(32) },
    });
    expect(rejection).toMatchObject({ code: 'invalid-rotations' });
    if (rejection === null || rejection.code !== 'invalid-rotations') {
      throw new Error('expected invalid-rotations');
    }
    expect(rejection.franchiseFailures.length).toBeGreaterThan(0);
    expect(rejection.franchiseFailures[0]?.reasons[0]).toContain('digest');
  });

  it('rejects an open free-agency window before the next block', () => {
    const input = validInput();
    // Only `status` and `windowIndex` are read by the rejection; the window is not parsed here.
    const openWindow = {
      windowIndex: 0,
      blockIndex: 2,
      status: 'open' as const,
      candidates: [],
      declarations: {},
      traces: [],
      signings: [],
    } as unknown as SeasonFreeAgencyWindowState;
    const franchiseIds = input.run.league.teams.map((team) => team.franchiseId);
    const freeAgency: SeasonFreeAgencyState = {
      schemaVersion: 1,
      freeAgencyVersion: SEASON_FREE_AGENCY_VERSION,
      windows: [openWindow],
      canonicalCandidates: {},
      signingCounts: Object.fromEntries(franchiseIds.map((id) => [id, 0])),
      seasonSpend: Object.fromEntries(franchiseIds.map((id) => [id, 0])),
    };
    expect(seasonBlockRejection({ ...input, freeAgency })).toEqual({
      code: 'free-agency-unresolved',
      windowIndex: 0,
      blockIndex: 0,
    });
  });

  it('requires the offered objective for legacy blocks when an objective state is supplied', () => {
    const input = validInput();
    const objectives: SeasonObjectiveState = {
      schemaVersion: 1,
      objectiveVersion: SEASON_OBJECTIVE_VERSION,
      catalog: [...SEASON_OBJECTIVE_CATALOG],
      selections: {},
    };
    expect(seasonBlockRejection({ ...input, objectives })).toEqual({
      code: 'invalid-objective',
      expected: 'required',
      blockIndex: 0,
    });
  });
});

describe('handleSubmitSeasonBlockCommand', () => {
  it('rejects a replay of an accepted command without simulating', () => {
    const input = validInput();
    const result = handleSubmitSeasonBlockCommand({
      ...input,
      acceptedCommandIds: [commandIdSchema.parse(input.command.commandId)],
    });
    expect(result).toEqual({
      status: 'rejected',
      rejection: { code: 'duplicate-command', commandId: input.command.commandId },
    });
  });
});
