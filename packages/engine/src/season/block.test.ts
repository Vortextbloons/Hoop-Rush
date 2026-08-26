import { beforeAll, describe, expect, it } from 'vitest';
import { seasonSubmitBlockCommandSchema, type SeasonCandidateCheckpoint, } from '@hoop-rush/data-contracts';
import { SeasonBlockValidationError, auditSeasonBlock, handleSubmitSeasonBlockCommand, seasonAcceptedBlockCount, seasonNextBlockIndex, simulateSeasonBlock, type SeasonBlockSimulationInput, } from './block.ts';
import { seasonCheckpointDigest } from './checkpoint.ts';
import { seasonRotationSetDigest } from './rotation.ts';
import { blockCommand, buildTestRun, pipelineInput } from './block-test-support.ts';
let input: SeasonBlockSimulationInput;
let checkpoint: ReturnType<typeof simulateSeasonBlock>;
let accepted: ReturnType<typeof handleSubmitSeasonBlockCommand>;
beforeAll(() => {
    const { run, catalog } = buildTestRun();
    input = pipelineInput(run, catalog, 0);
    accepted = handleSubmitSeasonBlockCommand({ ...input, acceptedCommandIds: [] });
    if (accepted.status !== 'accepted')
        throw new Error('expected the command to be accepted');
    checkpoint = accepted.checkpoint;
}, 60000);
describe('season block pipeline (M2.3)', () => {
    it('simulates block 0 with 150 summaries, 30 team rows, 300 player rows, and a clean audit', () => {
        expect(checkpoint.gameSummaries).toHaveLength(150);
        expect(checkpoint.teamAggregates).toHaveLength(30);
        expect(checkpoint.playerAggregates).toHaveLength(300);
        expect(checkpoint.completedRounds).toBe(10);
        expect(checkpoint.revision).toBe(0);
        expect(checkpoint.blockIndex).toBe(0);
        expect(checkpoint.digest).toMatch(/^[0-9a-f]{32}$/);
        expect(seasonCheckpointDigest(checkpoint)).toBe(checkpoint.digest);
        expect(auditSeasonBlock(checkpoint, input)).toEqual([]);
    });
    it('keeps game-id order stable and unique across the block', () => {
        const ids = checkpoint.gameSummaries.map((summary) => summary.gameId);
        expect(new Set(ids).size).toBe(150);
        expect([...ids].sort()).toEqual(ids);
    });
    it('treats every outcome as a valid summary (final or typed forfeit)', () => {
        for (const summary of checkpoint.gameSummaries) {
            if (summary.status === 'forfeit') {
                expect(summary.homeScore + summary.awayScore).toBe(2);
                expect(summary.homePlayers).toHaveLength(0);
                expect(summary.awayPlayers).toHaveLength(0);
                expect(summary.overtimePeriods).toBe(0);
                expect(summary.forfeitLoserFranchiseId === summary.homeFranchiseId ||
                    summary.forfeitLoserFranchiseId === summary.awayFranchiseId).toBe(true);
            }
            else {
                expect(summary.homePlayers).toHaveLength(10);
                expect(summary.awayPlayers).toHaveLength(10);
                expect(summary.forfeitLoserFranchiseId).toBeNull();
            }
        }
    });
    it('flags tampered candidates at the audit boundary', () => {
        const auditFailures = (mutate: (c: SeasonCandidateCheckpoint) => SeasonCandidateCheckpoint) => auditSeasonBlock(mutate(checkpoint), input);
        expect(auditFailures((c) => ({ ...c, runId: 'other-run' }))).toEqual(expect.arrayContaining(['candidate runId does not match the run']));
        expect(auditFailures((c) => ({ ...c, digest: '0'.repeat(32) }))).toEqual(expect.arrayContaining([expect.stringContaining('digest mismatch')]));
        expect(auditFailures((c) => ({ ...c, revision: 3 }))).toEqual(expect.arrayContaining([expect.stringContaining('does not match the run cursor')]));
        expect(auditFailures((c) => ({ ...c, gameSummaries: c.gameSummaries.slice(1) }))).toEqual(expect.arrayContaining([expect.stringContaining('exactly 150')]));
        const first = checkpoint.gameSummaries[0];
        if (first === undefined)
            throw new Error('expected fixture summaries');
        expect(auditFailures((c) => ({
            ...c,
            gameSummaries: [...c.gameSummaries, first],
        }))).toEqual(expect.arrayContaining([expect.stringContaining('duplicate game ids')]));
        const outsideGame = input.schedule.games.find((game) => game.round === 11);
        const detail = checkpoint.retainedDetails[0];
        if (outsideGame !== undefined && detail !== undefined) {
            expect(auditFailures((c) => ({
                ...c,
                retainedDetails: [{ ...detail, gameId: outsideGame.gameId }],
            }))).toEqual(expect.arrayContaining([expect.stringContaining('retained detail')]));
        }
    });
});
describe('season block command validation', () => {
    it('accepts a valid command and rejects a stale cursor', () => {
        expect(accepted.status).toBe('accepted');
        if (accepted.status !== 'accepted')
            return;
        expect(accepted.checkpoint.digest).toMatch(/^[0-9a-f]{32}$/);
        const { run, catalog } = buildTestRun();
        const stale = handleSubmitSeasonBlockCommand({
            ...pipelineInput(run, catalog, 0),
            command: blockCommand(run, 0, 1),
            acceptedCommandIds: ['block-0-0'],
        });
        expect(stale.status).toBe('rejected');
        if (stale.status !== 'rejected')
            return;
        expect(stale.rejection.code).toBe('stale-cursor');
        if (stale.rejection.code !== 'stale-cursor')
            return;
        expect(stale.rejection.currentRevision).toBe(0);
        expect(stale.rejection.currentCompletedRounds).toBe(0);
    });
    it('rejects duplicate commands before simulating', () => {
        const { run, catalog } = buildTestRun();
        const command = blockCommand(run, 0, 0);
        const result = handleSubmitSeasonBlockCommand({
            ...pipelineInput(run, catalog, 0),
            command,
            acceptedCommandIds: [command.commandId],
        });
        expect(result.status).toBe('rejected');
        if (result.status !== 'rejected')
            return;
        expect(result.rejection.code).toBe('duplicate-command');
    });
    it('rejects non-boundary blocks and run mismatches', () => {
        const { run, catalog } = buildTestRun();
        const boundary = handleSubmitSeasonBlockCommand({
            ...pipelineInput(run, catalog, 0),
            command: blockCommand(run, 2, 0),
            acceptedCommandIds: [],
        });
        expect(boundary.status).toBe('rejected');
        if (boundary.status !== 'rejected')
            return;
        expect(boundary.rejection.code).toBe('non-boundary-block');
        if (boundary.rejection.code !== 'non-boundary-block')
            return;
        expect(boundary.rejection.expectedBlockIndex).toBe(0);
        expect(boundary.rejection.submittedBlockIndex).toBe(2);
        const mismatch = handleSubmitSeasonBlockCommand({
            ...pipelineInput(run, catalog, 0),
            command: { ...blockCommand(run, 0, 0), runId: 'other-run' },
            acceptedCommandIds: [],
        });
        expect(mismatch.status).toBe('rejected');
        if (mismatch.status !== 'rejected')
            return;
        expect(mismatch.rejection.code).toBe('run-mismatch');
        if (mismatch.rejection.code !== 'run-mismatch')
            return;
        expect(mismatch.rejection.expectedRunId).toBe(run.runId);
    });
    it('rejects a stale rotation lock and an illegal rotation', () => {
        const { run, catalog } = buildTestRun();
        const tampered = handleSubmitSeasonBlockCommand({
            ...pipelineInput(run, catalog, 0),
            command: { ...blockCommand(run, 0, 0), rotationDigest: '0'.repeat(32) },
            acceptedCommandIds: [],
        });
        expect(tampered.status).toBe('rejected');
        if (tampered.status !== 'rejected')
            return;
        expect(tampered.rejection.code).toBe('invalid-rotations');
        if (tampered.rejection.code !== 'invalid-rotations')
            return;
        expect(tampered.rejection.franchiseFailures.length).toBe(30);
        const illegalRotation = run.rotations.map((rotation, index) => {
            if (index !== 0)
                return rotation;
            const closingFive = [...rotation.closingFive];
            const first = closingFive[0];
            closingFive[0] = closingFive[4] ?? '';
            closingFive[4] = first ?? '';
            return { ...rotation, closingFive };
        });
        const illegalRun = { ...run, rotations: illegalRotation };
        const illegal = handleSubmitSeasonBlockCommand({
            ...pipelineInput(run, catalog, 0),
            run: illegalRun,
            command: {
                ...blockCommand(run, 0, 0),
                rotationDigest: seasonRotationSetDigest(illegalRotation),
            },
            acceptedCommandIds: [],
        });
        expect(illegal.status).toBe('rejected');
        if (illegal.status !== 'rejected')
            return;
        expect(illegal.rejection.code).toBe('invalid-rotations');
        if (illegal.rejection.code !== 'invalid-rotations')
            return;
        expect(illegal.rejection.franchiseFailures.length).toBeGreaterThan(0);
    });
    it('throws through the pipeline path for invalid commands', () => {
        const { run, catalog } = buildTestRun();
        const input = pipelineInput(run, catalog, 0);
        expect(() => simulateSeasonBlock({ ...input, command: blockCommand(run, 0, 3) })).toThrow(SeasonBlockValidationError);
    });
    it('treats a completed season as non-boundary', () => {
        const { run, catalog } = buildTestRun();
        const completed = {
            ...run,
            cursor: { schemaVersion: 1 as const, completedRounds: 82 },
        };
        const result = handleSubmitSeasonBlockCommand({
            ...pipelineInput(run, catalog, 0),
            run: completed,
            command: blockCommand(completed, 8, 9),
            acceptedCommandIds: [],
        });
        expect(result.status).toBe('rejected');
        if (result.status !== 'rejected')
            return;
        expect(result.rejection.code).toBe('non-boundary-block');
        if (result.rejection.code !== 'non-boundary-block')
            return;
        expect(result.rejection.expectedBlockIndex).toBe(8);
    });
    it('derives cursor helpers from the completed-round value', () => {
        expect(seasonAcceptedBlockCount(0)).toBe(0);
        expect(seasonAcceptedBlockCount(10)).toBe(1);
        expect(seasonAcceptedBlockCount(80)).toBe(8);
        expect(seasonAcceptedBlockCount(82)).toBe(9);
        expect(seasonNextBlockIndex(0)).toBe(0);
        expect(seasonNextBlockIndex(20)).toBe(2);
        expect(seasonNextBlockIndex(82)).toBeNull();
    });
    it('rejects invalid command ids at the schema boundary', () => {
        const { run } = buildTestRun();
        const command = blockCommand(run, 0, 0);
        const malformed = { ...command, commandId: 'bad id!' };
        expect(seasonSubmitBlockCommandSchema.safeParse(malformed).success).toBe(false);
    });
});
