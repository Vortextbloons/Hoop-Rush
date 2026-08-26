import { seasonDigestHex, type SeasonCandidateCheckpoint, type SeasonGame, type SeasonGameSummary, type SeasonSchedule, } from '@hoop-rush/data-contracts';
import { seasonBlockRecapCanonical } from './recap.ts';
export function reconstructSeasonGames(schedule: SeasonSchedule, summaries: readonly SeasonGameSummary[]): SeasonGame[] {
    const summaryByGameId = new Map(summaries.map((summary) => [summary.gameId, summary]));
    return schedule.games.map((game) => {
        const summary = summaryByGameId.get(game.gameId);
        if (summary === undefined) {
            return {
                gameId: game.gameId,
                round: game.round,
                homeFranchiseId: game.homeFranchiseId,
                awayFranchiseId: game.awayFranchiseId,
                status: 'scheduled' as const,
                homeScore: null,
                awayScore: null,
                forfeitLoserFranchiseId: null,
            };
        }
        if (summary.status === 'forfeit') {
            return {
                gameId: game.gameId,
                round: game.round,
                homeFranchiseId: game.homeFranchiseId,
                awayFranchiseId: game.awayFranchiseId,
                status: 'forfeit' as const,
                homeScore: null,
                awayScore: null,
                forfeitLoserFranchiseId: summary.forfeitLoserFranchiseId,
            };
        }
        return {
            gameId: game.gameId,
            round: game.round,
            homeFranchiseId: game.homeFranchiseId,
            awayFranchiseId: game.awayFranchiseId,
            status: 'final' as const,
            homeScore: summary.homeScore,
            awayScore: summary.awayScore,
            forfeitLoserFranchiseId: null,
        };
    });
}
export type SeasonCheckpointFacts = Omit<SeasonCandidateCheckpoint, 'digest'>;
export function canonicalJson(value: unknown): string {
    if (value === null)
        return 'null';
    if (Array.isArray(value)) {
        return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
    }
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        const parts: string[] = [];
        for (const key of keys) {
            const entry = record[key];
            if (entry === undefined)
                continue;
            parts.push(`${JSON.stringify(key)}:${canonicalJson(entry)}`);
        }
        return `{${parts.join(',')}}`;
    }
    return JSON.stringify(value);
}
function standingsCanonical(candidate: SeasonCheckpointFacts): unknown {
    return {
        schemaVersion: candidate.standings.schemaVersion,
        standingsVersion: candidate.standings.standingsVersion,
        rows: [...candidate.standings.rows].sort((a, b) => (a.franchiseId < b.franchiseId ? -1 : 1)),
    };
}
export function seasonCheckpointCanonical(candidate: SeasonCheckpointFacts): string {
    return canonicalJson({
        schemaVersion: candidate.schemaVersion,
        checkpointVersion: candidate.checkpointVersion,
        runId: candidate.runId,
        rootSeed: candidate.rootSeed,
        versions: candidate.versions,
        blockIndex: candidate.blockIndex,
        completedRounds: candidate.completedRounds,
        revision: candidate.revision,
        rotationDigest: candidate.rotationDigest,
        standings: standingsCanonical(candidate),
        teamAggregates: [...candidate.teamAggregates].sort((a, b) => a.franchiseId < b.franchiseId ? -1 : 1),
        playerAggregates: [...candidate.playerAggregates].sort((a, b) => a.playerVersionId < b.playerVersionId ? -1 : 1),
        gameSummaries: [...candidate.gameSummaries].sort((a, b) => (a.gameId < b.gameId ? -1 : 1)),
        retainedDetails: [...candidate.retainedDetails].sort((a, b) => (a.gameId < b.gameId ? -1 : 1)),
        recap: seasonBlockRecapCanonical(candidate.recap),
        effects: canonicalJson({
            schemaVersion: candidate.effects.schemaVersion,
            playerStates: [...candidate.effects.playerStates].sort((a, b) => a.playerVersionId < b.playerVersionId ? -1 : 1),
            pairStates: [...candidate.effects.pairStates].sort((a, b) => a.a < b.a ? -1 : a.a > b.a ? 1 : a.b < b.b ? -1 : a.b > b.b ? 1 : 0),
        }),
        health: canonicalJson({
            schemaVersion: candidate.health.schemaVersion,
            healthVersion: candidate.health.healthVersion,
            injuries: [...candidate.health.injuries].sort((a, b) => (a.injuryId < b.injuryId ? -1 : 1)),
        }),
        influence: canonicalJson({
            schemaVersion: candidate.influence.schemaVersion,
            influenceVersion: candidate.influence.influenceVersion,
            balances: candidate.influence.balances,
            ledger: [...candidate.influence.ledger].sort((a, b) => (a.entryId < b.entryId ? -1 : 1)),
            windows: Object.fromEntries(Object.entries(candidate.influence.windows)
                .sort(([a], [b]) => (a < b ? -1 : 1))
                .map(([franchiseId, windows]) => [
                franchiseId,
                [...windows].sort((a, b) => a.windowIndex - b.windowIndex),
            ])),
            rehabs: Object.fromEntries(Object.entries(candidate.influence.rehabs).sort(([a], [b]) => (a < b ? -1 : 1))),
        }),
        transactions: [...candidate.transactions].sort((a, b) => a.transactionId < b.transactionId ? -1 : 1),
        objective: candidate.objective,
        campaign: (candidate as unknown as {
            campaign?: unknown;
        }).campaign
            ? canonicalJson((candidate as unknown as {
                campaign: unknown;
            }).campaign)
            : undefined,
        trade: (candidate as unknown as {
            trade?: unknown;
        }).trade
            ? canonicalJson((candidate as unknown as {
                trade: unknown;
            }).trade)
            : undefined,
        expectedStateRevision: candidate.expectedStateRevision,
        expectedStateDigest: candidate.expectedStateDigest,
        stateRevision: candidate.stateRevision,
        stateDigest: candidate.stateDigest,
    });
}
export function seasonCheckpointDigest(candidate: SeasonCheckpointFacts): string {
    return seasonDigestHex(seasonCheckpointCanonical(candidate));
}
