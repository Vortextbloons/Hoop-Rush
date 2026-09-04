import { describe, expect, it } from 'vitest';
import { SEASON_COMMAND_LOG_VERSION, SEASON_EMPTY_COMMAND_LOG_DIGEST, buildRun, canonicalJson, playInGameIdOf, playoffGameIdOf, postseasonPhaseOfGameId, seasonAlmanacDigest, seasonAlmanacSchema, seasonAwardsDigest, seasonAwardsSchema, seasonCommandLogDigest, seasonCommandLogEntrySchema, seasonCommandLogSchema, seasonPostseasonSummaryDigest, seasonPostseasonSummarySchema, seasonReplayExportDigest, seasonReplayExportSchema, seasonRunCompletionSchema, seasonRunSchema, seasonRunStageSchema, seasonStartPostseasonCommandSchema, seasonAdvancePostseasonCommandSchema, seasonDigestHex, type SeasonAlmanac, type SeasonAwards, type SeasonCommandLogEntry, type SeasonPostseasonSummary, type SeasonRun, type SeasonRunStage, } from './index.ts';
import { buildPostseason, fixturePlayerId, SEED } from './season-schemas-fixtures.ts';
const DIGEST_32 = '0'.repeat(32);
function completedPostseason(seed: string, champion: string) {
    const pending = (seriesId: string, round: string, conference: 'east' | 'west') => ({
        seriesId,
        round,
        conference,
        higherSeed: null,
        lowerSeed: null,
        homeCourtFranchiseId: null,
        challengerFranchiseId: null,
        homeCourtWins: 0,
        challengerWins: 0,
        games: [],
        winnerFranchiseId: null,
    });
    const conferenceBracket = (conference: 'east' | 'west') => ({
        conference,
        seeds: Array.from({ length: 8 }, (_, i) => `team-${String(i + 1)}`),
        firstRound: [1, 2, 3, 4].map((n) => pending(`${conference}-first-round-${String(n)}`, 'first-round', conference)),
        semifinals: [1, 2].map((n) => pending(`${conference}-semifinal-${String(n)}`, 'conference-semifinal', conference)),
        conferenceFinal: pending(`${conference}-conference-final`, 'conference-final', conference),
    });
    return {
        ...buildPostseason(seed),
        playIn: {
            east: {
                ...buildPostseason(seed).playIn.east,
                playoffSeeds: Array.from({ length: 8 }, (_, i) => `team-${String(i + 1)}`),
            },
            west: {
                ...buildPostseason(seed).playIn.west,
                playoffSeeds: Array.from({ length: 8 }, (_, i) => `team-${String(i + 1)}`),
            },
        },
        bracket: {
            schemaVersion: 1,
            postseasonVersion: 'postseason-v2',
            east: conferenceBracket('east'),
            west: conferenceBracket('west'),
            finals: {
                seriesId: 'finals',
                round: 'finals',
                conference: null,
                higherSeed: null,
                lowerSeed: null,
                homeCourtFranchiseId: champion,
                challengerFranchiseId: champion === 'lakers' ? 'celtics' : 'lakers',
                homeCourtWins: 4,
                challengerWins: 2,
                games: [
                    {
                        gameId: 'po-finals-g1',
                        gameNumber: 1,
                        homeFranchiseId: champion,
                        awayFranchiseId: champion === 'lakers' ? 'celtics' : 'lakers',
                        status: 'final',
                        homeScore: 100,
                        awayScore: 90,
                        winnerFranchiseId: champion,
                    },
                    {
                        gameId: 'po-finals-g2',
                        gameNumber: 2,
                        homeFranchiseId: champion,
                        awayFranchiseId: champion === 'lakers' ? 'celtics' : 'lakers',
                        status: 'final',
                        homeScore: 100,
                        awayScore: 90,
                        winnerFranchiseId: champion,
                    },
                    {
                        gameId: 'po-finals-g3',
                        gameNumber: 3,
                        homeFranchiseId: champion === 'lakers' ? 'celtics' : 'lakers',
                        awayFranchiseId: champion,
                        status: 'final',
                        homeScore: 90,
                        awayScore: 100,
                        winnerFranchiseId: champion,
                    },
                    {
                        gameId: 'po-finals-g4',
                        gameNumber: 4,
                        homeFranchiseId: champion === 'lakers' ? 'celtics' : 'lakers',
                        awayFranchiseId: champion,
                        status: 'final',
                        homeScore: 90,
                        awayScore: 100,
                        winnerFranchiseId: champion,
                    },
                    {
                        gameId: 'po-finals-g5',
                        gameNumber: 5,
                        homeFranchiseId: champion,
                        awayFranchiseId: champion === 'lakers' ? 'celtics' : 'lakers',
                        status: 'final',
                        homeScore: 100,
                        awayScore: 90,
                        winnerFranchiseId: champion,
                    },
                    {
                        gameId: 'po-finals-g6',
                        gameNumber: 6,
                        homeFranchiseId: champion === 'lakers' ? 'celtics' : 'lakers',
                        awayFranchiseId: champion,
                        status: 'final',
                        homeScore: 90,
                        awayScore: 100,
                        winnerFranchiseId: champion,
                    },
                ],
                winnerFranchiseId: champion,
            },
            championFranchiseId: champion,
        },
        championFranchiseId: champion,
    };
}
function baseRun(stage: SeasonRunStage = 'regular-season'): SeasonRun {
    return { ...buildRun(), stage };
}
function basePostseasonSummary(overrides: Record<string, unknown> = {}): SeasonPostseasonSummary {
    const players = Array.from({ length: 10 }, (_, i) => ({
        playerVersionId: fixturePlayerId(i),
        seconds: 1800,
        points: 10,
        fieldGoalsMade: 4,
        fieldGoalsAttempted: 9,
        threePointersMade: 1,
        threePointersAttempted: 3,
        freeThrowsMade: 1,
        freeThrowsAttempted: 1,
        offensiveRebounds: 1,
        defensiveRebounds: 3,
        assists: 3,
        steals: 1,
        blocks: 0,
        turnovers: 1,
        fouls: 2,
    }));
    const box = (franchiseId: string) => ({
        franchiseId,
        points: 100,
        fieldGoalsMade: 40,
        fieldGoalsAttempted: 90,
        threePointersMade: 10,
        threePointersAttempted: 30,
        freeThrowsMade: 10,
        freeThrowsAttempted: 12,
        offensiveRebounds: 10,
        defensiveRebounds: 30,
        assists: 25,
        steals: 8,
        blocks: 5,
        turnovers: 12,
        fouls: 18,
        possessions: 100,
    });
    const base: Record<string, unknown> = {
        schemaVersion: 1,
        summaryVersion: 'postseason-summary-v1',
        runId: 'fixture-run-1',
        gameId: 'pi-east-seven-eight',
        phase: 'play-in',
        round: 'seven-eight',
        seriesId: null,
        gameNumber: 1,
        conference: 'east',
        homeFranchiseId: 'lakers',
        awayFranchiseId: 'celtics',
        winnerFranchiseId: 'lakers',
        loserFranchiseId: 'celtics',
        status: 'final',
        homeScore: 104,
        awayScore: 99,
        forfeitLoserFranchiseId: null,
        homeBox: box('lakers'),
        awayBox: box('celtics'),
        homePlayers: players,
        awayPlayers: players,
        rotationEvidence: {
            home: { playersUsed: 10, substitutions: 24 },
            away: { playersUsed: 10, substitutions: 22 },
        },
        injuryEvents: [],
        ...overrides,
    };
    return seasonPostseasonSummarySchema.parse({ ...base, resultDigest: '0'.repeat(32) });
}
describe('season run stage and completion (M2.6)', () => {
    it('accepts every valid stage and rejects illegal values', () => {
        for (const stage of ['regular-season', 'play-in', 'playoffs', 'completed'] as const) {
            expect(seasonRunStageSchema.parse(stage)).toBe(stage);
        }
        expect(() => seasonRunStageSchema.parse('postseason')).toThrow();
        expect(() => seasonRunStageSchema.parse('')).toThrow();
    });
    it('a completed run must carry a champion and completion state', () => {
        const completed = {
            ...baseRun('completed'),
            postseason: completedPostseason(SEED, 'lakers'),
            completion: {
                championFranchiseId: 'lakers',
                almanacDigest: 'a'.repeat(32),
                finalizedAtStateRevision: 17,
            },
            awards: {
                schemaVersion: 1,
                awardsVersion: 'awards-v1',
                runId: 'fixture-run-1',
                mvp: { playerVersionId: fixturePlayerId(0), franchiseId: 'lakers' },
                defensivePlayerOfYear: { playerVersionId: fixturePlayerId(1), franchiseId: 'celtics' },
                sixthManOfYear: { playerVersionId: fixturePlayerId(2), franchiseId: 'lakers' },
                allLeagueFirstTeam: Array.from({ length: 5 }, (_, index) => ({
                    playerVersionId: fixturePlayerId(3 + index),
                    franchiseId: 'lakers',
                })),
                digest: '0'.repeat(32),
            },
        };
        expect(seasonRunSchema.parse(completed).stage).toBe('completed');
        expect(() => seasonRunSchema.parse({
            ...completed,
            completion: null,
            postseason: completedPostseason(SEED, 'lakers'),
        })).toThrow();
        expect(() => seasonRunSchema.parse({
            ...completed,
            postseason: { ...completedPostseason(SEED, 'lakers'), championFranchiseId: null },
        })).toThrow();
        expect(() => seasonRunSchema.parse({ ...completed, completion: null })).toThrow();
        expect(seasonRunSchema.parse(baseRun('regular-season')).completion).toBeNull();
        expect(() => seasonRunSchema.parse({
            ...baseRun('regular-season'),
            completion: {
                championFranchiseId: 'lakers',
                almanacDigest: 'a'.repeat(32),
                finalizedAtStateRevision: 0,
            },
        })).toThrow();
    });
    it('completion state reconciles with the postseason champion', () => {
        const completion = seasonRunCompletionSchema.parse({
            championFranchiseId: 'lakers',
            almanacDigest: 'a'.repeat(32),
            finalizedAtStateRevision: 9,
        });
        expect(completion.finalizedAtStateRevision).toBe(9);
        expect(() => seasonRunCompletionSchema.parse({
            championFranchiseId: 'lakers',
            almanacDigest: 'not-a-digest',
            finalizedAtStateRevision: 0,
        })).toThrow();
        expect(() => seasonRunCompletionSchema.parse({
            championFranchiseId: '',
            almanacDigest: 'a'.repeat(32),
            finalizedAtStateRevision: 0,
        })).toThrow();
    });
});
describe('postseason game ids (M2.6)', () => {
    it('derives stable ids reproducibly from the same inputs', () => {
        expect(playInGameIdOf('east', 'seven-eight')).toBe('pi-east-seven-eight');
        expect(playInGameIdOf('east', 'seven-eight')).toBe(playInGameIdOf('east', 'seven-eight'));
        expect(playInGameIdOf('west', 'final')).toBe('pi-west-final');
        expect(playoffGameIdOf('east-first-round-1', 1)).toBe('po-east-first-round-1-g1');
        expect(playoffGameIdOf('finals', 7)).toBe('po-finals-g7');
        expect(playoffGameIdOf('finals', 7)).toBe(playoffGameIdOf('finals', 7));
        expect(playoffGameIdOf('east-first-round-1', 2)).not.toBe(playoffGameIdOf('east-first-round-1', 1));
        expect(postseasonPhaseOfGameId('pi-east-seven-eight')).toBe('play-in');
        expect(postseasonPhaseOfGameId('po-finals-g7')).toBe('playoffs');
    });
    it('rejects malformed postseason ids in command targets', () => {
        const base = {
            schemaVersion: 11,
            commandId: 'cmd-ps-1',
            runId: 'fixture-run-1',
            expectedStateRevision: 0,
            expectedStateDigest: DIGEST_32,
        };
        expect(seasonStartPostseasonCommandSchema.safeParse({ ...base, command: 'start-postseason' })
            .success).toBe(true);
        expect(seasonAdvancePostseasonCommandSchema.safeParse({
            ...base,
            command: 'advance-postseason',
            targetGameId: 's000001',
        }).success).toBe(false);
        expect(seasonAdvancePostseasonCommandSchema.safeParse({
            ...base,
            command: 'advance-postseason',
            targetGameId: 'po-finals-g8',
        }).success).toBe(false);
        expect(seasonAdvancePostseasonCommandSchema.safeParse({
            ...base,
            command: 'advance-postseason',
            targetGameId: 'pi-east',
        }).success).toBe(false);
    });
});
describe('postseason summaries (M2.6, postseason-summary-v1)', () => {
    it('round-trips a final play-in summary and derives its digest', () => {
        const summary = basePostseasonSummary();
        const parsed = seasonPostseasonSummarySchema.parse(summary);
        expect(parsed.winnerFranchiseId).toBe('lakers');
        const digest = seasonPostseasonSummaryDigest(summary);
        expect(digest).toMatch(/^[0-9a-f]{32}$/);
        expect(seasonPostseasonSummaryDigest(parsed)).toBe(digest);
        expect(seasonPostseasonSummaryDigest({ ...parsed, resultDigest: 'f'.repeat(32) })).toBe(digest);
    });
    it('round-trips a playoff summary with its series identity', () => {
        const summary = seasonPostseasonSummarySchema.parse(basePostseasonSummary({
            gameId: 'po-finals-g7',
            phase: 'playoffs',
            round: 'finals',
            seriesId: 'finals',
            gameNumber: 7,
            conference: 'west',
            homeFranchiseId: 'warriors',
            awayFranchiseId: 'celtics',
            winnerFranchiseId: 'warriors',
            loserFranchiseId: 'celtics',
        }));
        expect(summary.seriesId).toBe('finals');
    });
    it('rejects mismatched phase/series/game-number combinations', () => {
        expect(() => seasonPostseasonSummarySchema.parse(basePostseasonSummary({
            gameId: 'po-finals-g7',
            phase: 'playoffs',
            round: 'seven-eight',
            seriesId: 'finals',
            gameNumber: 7,
        }))).toThrow();
        expect(() => seasonPostseasonSummarySchema.parse(basePostseasonSummary({ seriesId: 'finals' }))).toThrow();
        expect(() => seasonPostseasonSummarySchema.parse(basePostseasonSummary({ awayScore: 104 }))).toThrow();
        expect(() => seasonPostseasonSummarySchema.parse(basePostseasonSummary({ winnerFranchiseId: 'celtics' }))).toThrow();
        const forfeit = seasonPostseasonSummarySchema.parse(basePostseasonSummary({
            status: 'forfeit',
            winnerFranchiseId: 'lakers',
            loserFranchiseId: 'celtics',
            homeScore: 2,
            awayScore: 0,
            forfeitLoserFranchiseId: 'celtics',
            homePlayers: [],
            awayPlayers: [],
            rotationEvidence: {
                home: { playersUsed: 0, substitutions: 0 },
                away: { playersUsed: 0, substitutions: 0 },
            },
        }));
        expect(forfeit.status).toBe('forfeit');
        expect(() => seasonPostseasonSummarySchema.parse(basePostseasonSummary({
            status: 'forfeit',
            winnerFranchiseId: 'lakers',
            loserFranchiseId: 'celtics',
            homeScore: 100,
            awayScore: 0,
            forfeitLoserFranchiseId: 'celtics',
        }))).toThrow();
    });
});
describe('awards, almanac, and replay exports (M2.6)', () => {
    function awards(): SeasonAwards {
        return seasonAwardsSchema.parse({
            schemaVersion: 1,
            awardsVersion: 'awards-v1',
            runId: 'fixture-run-1',
            mvp: { playerVersionId: fixturePlayerId(0), franchiseId: 'lakers' },
            defensivePlayerOfYear: { playerVersionId: fixturePlayerId(1), franchiseId: 'celtics' },
            sixthManOfYear: { playerVersionId: fixturePlayerId(2), franchiseId: 'lakers' },
            allLeagueFirstTeam: Array.from({ length: 5 }, (_, index) => ({
                playerVersionId: fixturePlayerId(3 + index),
                franchiseId: 'lakers',
            })),
            digest: '0'.repeat(32),
        });
    }
    it('round-trips awards with a deterministic digest', () => {
        const parsed = seasonAwardsSchema.parse(awards());
        expect(parsed.allLeagueFirstTeam).toHaveLength(5);
        const digest = seasonAwardsDigest(parsed);
        expect(digest).toMatch(/^[0-9a-f]{32}$/);
        expect(seasonAwardsDigest(seasonAwardsSchema.parse({ ...parsed, digest: 'f'.repeat(32) }))).toBe(digest);
        expect(() => seasonAwardsSchema.parse({ ...parsed, mvp: { playerVersionId: 'bad' } })).toThrow();
    });
    it('round-trips an almanac whose digest reconciles with the run completion', () => {
        const almanac: SeasonAlmanac = seasonAlmanacSchema.parse({
            schemaVersion: 1,
            almanacVersion: 'almanac-v1',
            runId: 'fixture-run-1',
            rootSeed: SEED,
            championFranchiseId: 'lakers',
            postseasonDigest: 'b'.repeat(32),
            commandLogDigest: 'c'.repeat(32),
            awardsDigest: 'd'.repeat(32),
            tradeGradesDigest: 'e'.repeat(32),
            digest: '0'.repeat(32),
        });
        const parsed = seasonAlmanacSchema.parse(almanac);
        const digest = seasonAlmanacDigest(parsed);
        expect(digest).toMatch(/^[0-9a-f]{32}$/);
        expect(seasonAlmanacDigest(seasonAlmanacSchema.parse({ ...parsed, digest: 'f'.repeat(32) }))).toBe(digest);
    });
    it('round-trips a replay export whose digest reconciles with its summary', () => {
        const summary = basePostseasonSummary();
        const exportArtifact = {
            schemaVersion: 1,
            replayExportVersion: 'replay-export-v1',
            runId: 'fixture-run-1',
            gameId: summary.gameId,
            summary,
            digest: '0'.repeat(32),
        };
        const parsed = seasonReplayExportSchema.parse(exportArtifact);
        const digest = seasonReplayExportDigest(parsed);
        expect(digest).toMatch(/^[0-9a-f]{32}$/);
        expect(seasonReplayExportDigest(seasonReplayExportSchema.parse({ ...parsed, digest: 'f'.repeat(32) }))).toBe(digest);
        expect(digest).not.toBe(seasonPostseasonSummaryDigest(summary));
    });
});
describe('command log (M2.6, command-log-v1)', () => {
    function entry(ordinal: number, overrides: Partial<SeasonCommandLogEntry> = {}): SeasonCommandLogEntry {
        return seasonCommandLogEntrySchema.parse({
            runId: 'fixture-run-1',
            ordinal,
            command: {
                schemaVersion: 11,
                command: 'start-postseason',
                commandId: `cmd-ps-${String(ordinal)}`,
                runId: 'fixture-run-1',
                expectedStateRevision: ordinal,
                expectedStateDigest: DIGEST_32,
            },
            preStateRevision: ordinal,
            preStateDigest: DIGEST_32,
            postStateRevision: ordinal + 1,
            postStateDigest: '1'.repeat(32),
            resultDigest: '2'.repeat(32),
            previousLogDigest: SEASON_EMPTY_COMMAND_LOG_DIGEST,
            relatedGameIds: [],
            transactionIds: [],
            ...overrides,
        });
    }
    it('hashes stably across repeated derivation and re-parsing', () => {
        const entries = [entry(0), entry(1), entry(2)];
        const log = seasonCommandLogSchema.parse({
            schemaVersion: 1,
            commandLogVersion: SEASON_COMMAND_LOG_VERSION,
            runId: 'fixture-run-1',
            entries,
        });
        const digest = seasonCommandLogDigest(log.entries);
        expect(digest).toMatch(/^[0-9a-f]{32}$/);
        expect(seasonCommandLogDigest(entries)).toBe(digest);
        expect(seasonCommandLogDigest(log.entries.map((item) => JSON.parse(JSON.stringify(item)) as SeasonCommandLogEntry))).toBe(digest);
        expect(seasonCommandLogDigest([entry(0), entry(1), entry(2, { resultDigest: '3'.repeat(32) })])).not.toBe(digest);
        expect(seasonCommandLogDigest([
            entry(0),
            entry(1),
            entry(2, { relatedGameIds: ['pi-east-seven-eight'] }),
        ])).not.toBe(digest);
        expect(SEASON_EMPTY_COMMAND_LOG_DIGEST).toBe(seasonDigestHex(canonicalJson([])));
    });
    it('rejects corrupt entries (bad ordinals, missing concurrency facts, malformed commands)', () => {
        expect(() => entry(0, { ordinal: -1 })).toThrow();
        expect(() => entry(0, { preStateDigest: 'bad' })).toThrow();
        expect(() => seasonCommandLogEntrySchema.parse({
            runId: 'fixture-run-1',
            ordinal: 0,
            command: {
                schemaVersion: 11,
                command: 'start-postseason',
                commandId: 'cmd-ps-0',
                runId: 'other-run',
                expectedStateRevision: 0,
                expectedStateDigest: DIGEST_32,
            },
            preStateRevision: 0,
            preStateDigest: DIGEST_32,
            postStateRevision: 1,
            postStateDigest: '1'.repeat(32),
            resultDigest: '2'.repeat(32),
            previousLogDigest: SEASON_EMPTY_COMMAND_LOG_DIGEST,
            relatedGameIds: [],
            transactionIds: [],
        })).toThrow();
    });
    it('the log version is pinned on the artifact', () => {
        expect(seasonCommandLogSchema.safeParse({
            schemaVersion: 1,
            commandLogVersion: 'command-log-v2',
            runId: 'fixture-run-1',
            entries: [],
        }).success).toBe(true);
        expect(seasonCommandLogSchema.safeParse({
            schemaVersion: 1,
            commandLogVersion: 'command-log-v99' as unknown as 'command-log-v2',
            runId: 'fixture-run-1',
            entries: [],
        }).success).toBe(false);
    });
});
