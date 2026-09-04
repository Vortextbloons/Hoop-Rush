import { createEngineContext, simulateGame, checkGameResult, type EngineContext, } from '@hoop-rush/engine';
import { FIXED_FIVE_WORKER_WIRE_VERSION, fixedFiveWorkerMessageSchema, fixedFiveWorkerRequestSchema, type FixedFiveWorkerComplete, type FixedFiveWorkerError, type FixedFiveWorkerProgress, type FixedFiveWorkerResultEntry, type FixedFiveWorkerResults, } from '@hoop-rush/data-contracts';
import { fixedFiveDuelGameSeed, fixedFiveH2HSeed, fixedFiveSharedGameSeed, findWeakestOpponent, } from '@hoop-rush/engine';
const BATCH = 4;
let currentRequestId: string | null = null;
let requestToken = 0;
let lastProgressAt = 0;
function post(message: FixedFiveWorkerProgress | FixedFiveWorkerResults | FixedFiveWorkerComplete | FixedFiveWorkerError): void {
    fixedFiveWorkerMessageSchema.parse(message);
    self.postMessage(message);
}
function postError(requestId: string, message: string): void {
    self.postMessage({
        schemaVersion: FIXED_FIVE_WORKER_WIRE_VERSION,
        type: 'fixed-five-error',
        requestId,
        message: message.slice(0, 512),
    } satisfies FixedFiveWorkerError);
}
function maybeProgress(requestId: string, completedGames: number, totalGames: number, force = false): void {
    const now = Date.now();
    if (!force && now - lastProgressAt < 250)
        return;
    lastProgressAt = now;
    post({
        schemaVersion: FIXED_FIVE_WORKER_WIRE_VERSION,
        type: 'fixed-five-progress',
        requestId,
        completedGames,
        totalGames,
    });
}
self.onmessage = (event: MessageEvent<unknown>): void => {
    const parsed = fixedFiveWorkerRequestSchema.safeParse(event.data);
    if (!parsed.success) {
        postError(currentRequestId ?? 'unknown', 'fixed-five worker received an invalid request');
        return;
    }
    const request = parsed.data;
    if (request.type === 'fixed-five-cancel') {
        if (request.requestId === currentRequestId)
            requestToken += 1;
        return;
    }
    currentRequestId = request.requestId;
    requestToken += 1;
    const token = requestToken;
    lastProgressAt = 0;
    const context: EngineContext = createEngineContext({ engineVersion: request.engineVersion });
    void (async () => {
        const pending: FixedFiveWorkerResultEntry[] = [];
        function flush(requestId: string): void {
            if (pending.length === 0)
                return;
            post({
                schemaVersion: FIXED_FIVE_WORKER_WIRE_VERSION,
                type: 'fixed-five-results',
                requestId,
                entries: pending.splice(0, pending.length),
            });
        }
        try {
            if (request.type === 'fixed-five-duel') {
                let p1Wins = 0;
                let p2Wins = 0;
                let delivered = 0;
                for (let gameNumber = 1; gameNumber <= 7; gameNumber += 1) {
                    if (token !== requestToken)
                        return;
                    if (p1Wins === 4 || p2Wins === 4)
                        break;
                    const seed = fixedFiveDuelGameSeed(request.rootSeed, gameNumber);
                    const displayHomeP1 = gameNumber % 2 === 1;
                    const result = simulateGame({
                        schemaVersion: 2,
                        seed,
                        gameNumber,
                        dataVersion: request.dataVersion,
                        profile: request.profile,
                        home: displayHomeP1 ? request.p1Team : request.p2Team,
                        away: displayHomeP1 ? request.p2Team : request.p1Team,
                    }, context);
                    const failures = checkGameResult(result);
                    if (failures.length > 0)
                        throw new Error(`duel game ${String(gameNumber)} failed invariants`);
                    const homeIsP1 = result.home.teamId === request.p1Team.teamId;
                    if ((result.winner === 'home') === homeIsP1)
                        p1Wins += 1;
                    else
                        p2Wins += 1;
                    delivered += 1;
                    pending.push({ tag: 'duel', game: result });
                    if (pending.length >= BATCH)
                        flush(request.requestId);
                    maybeProgress(request.requestId, delivered, 7, delivered === 7 || p1Wins === 4 || p2Wins === 4);
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
                if (token !== requestToken)
                    return;
                flush(request.requestId);
                post({
                    schemaVersion: FIXED_FIVE_WORKER_WIRE_VERSION,
                    type: 'fixed-five-complete',
                    requestId: request.requestId,
                    gamesDelivered: delivered,
                    cancelled: false,
                });
                return;
            }
            const h2hSet = new Set<number>();
            const weakestId = findWeakestOpponent(request.bracket).opponentId;
            for (const entry of request.bracket.schedule) {
                if (entry.opponentId === weakestId)
                    h2hSet.add(entry.gameNumber);
            }
            const total = 82 + 82 - h2hSet.size;
            let delivered = 0;
            for (let gameNumber = request.startGameNumber; gameNumber <= 82 && token === requestToken; gameNumber += 1) {
                const entry = request.bracket.schedule[gameNumber - 1];
                if (!entry)
                    continue;
                if (h2hSet.has(gameNumber)) {
                    const seed = fixedFiveH2HSeed(request.rootSeed, gameNumber);
                    const result = simulateGame({
                        schemaVersion: 2,
                        seed,
                        gameNumber,
                        dataVersion: request.dataVersion,
                        profile: request.profile,
                        home: request.p1Team,
                        away: request.p2Team,
                    }, context);
                    const failures = checkGameResult(result);
                    if (failures.length > 0)
                        throw new Error(`H2H game ${String(gameNumber)} failed invariants`);
                    pending.push({ tag: 'h2h', game: result });
                    delivered += 1;
                }
                else {
                    const opponent = request.bracket.opponents.find((o) => o.opponentId === entry.opponentId);
                    if (!opponent)
                        throw new Error(`unknown opponent ${entry.opponentId}`);
                    for (const participant of ['p1', 'p2'] as const) {
                        if (token !== requestToken)
                            return;
                        const seed = fixedFiveSharedGameSeed(request.rootSeed, participant, gameNumber);
                        const home = participant === 'p1' ? request.p1Team : request.p2Team;
                        const result = simulateGame({
                            schemaVersion: 2,
                            seed,
                            gameNumber,
                            dataVersion: request.dataVersion,
                            profile: request.profile,
                            home,
                            away: {
                                teamId: opponent.teamId,
                                displayName: opponent.displayName,
                                players: opponent.players,
                            },
                        }, context);
                        const failures = checkGameResult(result);
                        if (failures.length > 0)
                            throw new Error(`shared82 game ${String(gameNumber)} failed invariants`);
                        pending.push({ tag: participant, game: result });
                        delivered += 1;
                    }
                }
                if (pending.length >= BATCH)
                    flush(request.requestId);
                maybeProgress(request.requestId, delivered, total);
                if (gameNumber % BATCH === 0)
                    await new Promise((resolve) => setTimeout(resolve, 0));
            }
            if (token !== requestToken)
                return;
            flush(request.requestId);
            maybeProgress(request.requestId, delivered, total, true);
            post({
                schemaVersion: FIXED_FIVE_WORKER_WIRE_VERSION,
                type: 'fixed-five-complete',
                requestId: request.requestId,
                gamesDelivered: delivered,
                cancelled: false,
            });
        }
        catch (error) {
            if (token !== requestToken)
                return;
            postError(request.requestId, error instanceof Error ? error.message : String(error));
        }
    })();
};
export {};
