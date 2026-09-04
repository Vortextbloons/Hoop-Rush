import { describe, expect, it } from 'vitest';
import { buildRun } from './season-schemas-fixtures.ts';
import type { SeasonEffectsState } from './season-effects.ts';
import { SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION, seasonPostseasonWorkerCompleteMessageSchema, seasonPostseasonWorkerErrorMessageSchema, seasonPostseasonWorkerProgressMessageSchema, seasonPostseasonWorkerRequestSchema, type SeasonPostseasonWorkerCompleteMessage, type SeasonPostseasonWorkerStartRequest, } from './season-postseason-worker.ts';
import { commandIdSchema } from './ids.ts';
const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
const COMMAND_ID = commandIdSchema.parse('adv-0123456789abcdef');
const TARGET = 'pi-east-seven-eight';
function fixtureEffects(run: ReturnType<typeof buildRun>): SeasonEffectsState {
    const playerStates = run.rosters.flatMap((roster) => roster.players.map((player) => ({
        playerVersionId: player.playerVersionId,
        fatigueBasisPoints: 0,
        recentLoadBasisPoints: 0,
        lastCompletedRound: 82,
    })));
    const pairStates: SeasonEffectsState['pairStates'] = [];
    for (const roster of run.rosters) {
        const ids = roster.players.map((player) => player.playerVersionId).sort();
        for (let i = 0; i < ids.length; i += 1) {
            const a = ids[i];
            if (a === undefined)
                continue;
            for (let j = i + 1; j < ids.length; j += 1) {
                const b = ids[j];
                if (b === undefined)
                    continue;
                pairStates.push({ a, b, sharedPossessions: 0 });
            }
        }
    }
    return {
        schemaVersion: 2,
        playerStates,
        inactivePlayerStates: [],
        pairStates,
        archivedPairs: [],
    };
}
function baseRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const run = buildRun();
    return {
        schemaVersion: SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION,
        type: 'season-postseason-start',
        requestId: 'spw-1',
        runId: run.runId,
        rootSeed: SEED,
        commandId: COMMAND_ID,
        expectedStateRevision: 0,
        expectedStateDigest: '0'.repeat(32),
        humanFranchiseId: 'lakers',
        targetGameId: TARGET,
        catalogUrl: 'https://example.test/season/draft-catalog.json',
        catalogHash: '0'.repeat(64),
        profileUrl: 'https://example.test/season/era-sim.json',
        profileHash: '0'.repeat(64),
        run,
        effects: fixtureEffects(run),
        regularSeasonSummaries: [],
        ...overrides,
    };
}
describe('season postseason worker wire (M2.6)', () => {
    it('accepts a valid start request (schema version 1, full run + effects)', () => {
        const parsed = seasonPostseasonWorkerRequestSchema.safeParse(baseRequest());
        expect(parsed.success).toBe(true);
        if (!parsed.success)
            return;
        const request = parsed.data as SeasonPostseasonWorkerStartRequest;
        expect(request.schemaVersion).toBe(1);
        expect(request.type).toBe('season-postseason-start');
        expect(request.commandId).toBe(COMMAND_ID);
        expect(request.targetGameId).toBe(TARGET);
        expect(request.run.stage).toBe('regular-season');
        expect(request.effects.playerStates).toHaveLength(300);
    });
    it('rejects a start request whose run fails the snapshot schema', () => {
        const base = baseRequest();
        const parsed = seasonPostseasonWorkerRequestSchema.safeParse({
            ...base,
            run: { ...(base.run as Record<string, unknown>), games: [] },
        });
        expect(parsed.success).toBe(false);
    });
    it('rejects a start request with a regular-season (non-postseason) target', () => {
        const parsed = seasonPostseasonWorkerRequestSchema.safeParse(baseRequest({ targetGameId: 's000001' }));
        expect(parsed.success).toBe(false);
    });
    it('rejects a stale wire family (schema 5 block envelopes never parse)', () => {
        const parsed = seasonPostseasonWorkerRequestSchema.safeParse({
            schemaVersion: 5,
            type: 'season-block-start',
            requestId: 'sb-1',
        });
        expect(parsed.success).toBe(false);
        const wrongFamily = seasonPostseasonWorkerRequestSchema.safeParse({
            ...baseRequest(),
            schemaVersion: 5,
        });
        expect(wrongFamily.success).toBe(false);
    });
    it('parses the cancel and warm requests of the postseason family', () => {
        const cancel = seasonPostseasonWorkerRequestSchema.safeParse({
            schemaVersion: 1,
            type: 'season-postseason-cancel',
            requestId: 'spw-1',
        });
        expect(cancel.success).toBe(true);
        const warm = seasonPostseasonWorkerRequestSchema.safeParse({
            schemaVersion: 1,
            type: 'season-postseason-warm',
            requestId: 'warm-1',
            catalogUrl: 'https://example.test/season/draft-catalog.json',
            catalogHash: '0'.repeat(64),
            profileUrl: 'https://example.test/season/era-sim.json',
            profileHash: '0'.repeat(64),
        });
        expect(warm.success).toBe(true);
        expect(seasonPostseasonWorkerRequestSchema.safeParse({
            schemaVersion: 5,
            type: 'season-block-warm',
            requestId: 'warm-1',
            catalogUrl: 'u',
            catalogHash: '0'.repeat(64),
            profileUrl: 'p',
            profileHash: '0'.repeat(64),
        }).success).toBe(false);
    });
    it('parses an accepted complete message (one atomic commit of facts)', () => {
        const run = buildRun();
        const message: SeasonPostseasonWorkerCompleteMessage = {
            schemaVersion: 1,
            type: 'season-postseason-complete',
            requestId: 'spw-1',
            result: {
                status: 'accepted',
                stage: 'play-in',
                advancedGameIds: [TARGET],
                summaries: [],
                run,
                nextDecision: 'none',
                nextGameId: null,
                aiNextGameId: 'pi-east-nine-ten',
            },
        };
        const parsed = seasonPostseasonWorkerCompleteMessageSchema.safeParse(message);
        expect(parsed.success).toBe(true);
    });
    it('parses a rejected complete message with the typed advance rejection', () => {
        const message: SeasonPostseasonWorkerCompleteMessage = {
            schemaVersion: 1,
            type: 'season-postseason-complete',
            requestId: 'spw-1',
            result: {
                status: 'rejected',
                commandId: COMMAND_ID,
                rejection: {
                    code: 'wrong-game',
                    targetGameId: TARGET,
                    nextGameId: 'pi-east-nine-ten',
                },
            },
        };
        const parsed = seasonPostseasonWorkerCompleteMessageSchema.safeParse(message);
        expect(parsed.success).toBe(true);
    });
    it('rejects a complete message whose rejection is not an advance rejection', () => {
        const parsed = seasonPostseasonWorkerCompleteMessageSchema.safeParse({
            schemaVersion: 1,
            type: 'season-postseason-complete',
            requestId: 'spw-1',
            result: {
                status: 'rejected',
                commandId: COMMAND_ID,
                rejection: { code: 'objective-not-offered', blockIndex: 0 },
            },
        });
        expect(parsed.success).toBe(false);
    });
    it('parses progress and error messages of the postseason family', () => {
        expect(seasonPostseasonWorkerProgressMessageSchema.safeParse({
            schemaVersion: 1,
            type: 'season-postseason-progress',
            requestId: 'spw-1',
            gamesCompleted: 1,
            gamesTotal: 0,
            latestGameId: TARGET,
            latestResult: {
                gameId: TARGET,
                homeFranchiseId: 'lakers',
                homeScore: 110,
                awayScore: 90,
                awayFranchiseId: 'clippers',
            },
        }).success).toBe(true);
        expect(seasonPostseasonWorkerErrorMessageSchema.safeParse({
            schemaVersion: 1,
            type: 'season-postseason-error',
            requestId: 'spw-1',
            code: 'invariant-failure',
            message: 'series unpaired before its feeders complete',
            seed: SEED,
            gameId: TARGET,
        }).success).toBe(true);
        expect(seasonPostseasonWorkerErrorMessageSchema.safeParse({
            schemaVersion: 1,
            type: 'season-postseason-error',
            requestId: 'spw-1',
            code: 'season-block-cancelled',
            message: 'x',
            seed: null,
            gameId: null,
        }).success).toBe(false);
    });
});
