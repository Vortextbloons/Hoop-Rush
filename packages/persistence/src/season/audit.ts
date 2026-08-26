import { blockIndexForRound, postseasonGameIdSchema, SEASON_GAMES_PER_ROUND, SEASON_INFLUENCE_CAP, SEASON_ENDING_MISSED_GAMES_SENTINEL, SEASON_ROTATION_SIZE, SEASON_TEAM_COUNT, type SeasonAcceptedBlock, type SeasonFreeAgencySigning, type SeasonGame, type SeasonGameSummary, type SeasonLeague, type SeasonPendingBlockCandidate, type SeasonRetainedGameDetail, type SeasonRoster, type SeasonSchedule, } from '@hoop-rush/data-contracts';
import type { StoredSeasonRunRecord } from '../schemas/season-run-record.ts';
import type { SeasonRunEngineSeam } from './engine-seam-types.ts';
import { auditReplayDivergences } from './replay.ts';
export interface SeasonRunAuditFacts {
    league: SeasonLeague;
    rosters: readonly SeasonRoster[];
    schedule: SeasonSchedule;
    humanFranchiseId: string;
    stored: StoredSeasonRunRecord;
    summaries: readonly SeasonGameSummary[];
    retainedDetails: readonly SeasonRetainedGameDetail[];
    acceptedBlocks: readonly SeasonAcceptedBlock[];
    pending: SeasonPendingBlockCandidate | null;
}
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b)
        return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((value, index) => deepEqual(value, b[index]));
    }
    if (isPlainObject(a) && isPlainObject(b)) {
        const aKeys = Object.keys(a).sort();
        const bKeys = Object.keys(b).sort();
        if (aKeys.length !== bKeys.length)
            return false;
        return aKeys.every((key, index) => {
            if (key !== bKeys[index])
                return false;
            return deepEqual(a[key], b[key]);
        });
    }
    return false;
}
function sortById<T>(rows: readonly T[], idOf: (row: T) => string): T[] {
    return [...rows].sort((a, b) => (idOf(a) < idOf(b) ? -1 : 1));
}
function expectedCompletedRoundsAt(blockIndex: number): number {
    return blockIndex === 8 ? 82 : (blockIndex + 1) * 10;
}
export function auditSeasonRunState(facts: SeasonRunAuditFacts, seam: SeasonRunEngineSeam): string[] {
    const failures: string[] = [];
    const { stored, summaries, retainedDetails, acceptedBlocks } = facts;
    const leagueFranchiseIds = new Set(facts.league.teams.map((team) => team.franchiseId));
    const scheduleById = new Map(facts.schedule.games.map((game) => [game.gameId, game]));
    const summaryIds = new Set<string>();
    const summariesPerRound = new Map<number, number>();
    for (const summary of summaries) {
        if (summaryIds.has(summary.gameId)) {
            failures.push(`duplicate summary row for game ${summary.gameId}`);
        }
        summaryIds.add(summary.gameId);
        const scheduled = scheduleById.get(summary.gameId);
        if (scheduled === undefined) {
            failures.push(`summary ${summary.gameId} does not exist in the schedule`);
            continue;
        }
        if (scheduled.round !== summary.round ||
            scheduled.homeFranchiseId !== summary.homeFranchiseId ||
            scheduled.awayFranchiseId !== summary.awayFranchiseId) {
            failures.push(`summary ${summary.gameId} identity does not match its schedule game ` +
                `(round ${String(summary.round)}/${String(scheduled.round)}, ` +
                `${summary.homeFranchiseId}@${summary.awayFranchiseId} vs ` +
                `${scheduled.homeFranchiseId}@${scheduled.awayFranchiseId})`);
        }
        if (summary.round > stored.completedRounds) {
            failures.push(`summary ${summary.gameId} round ${String(summary.round)} exceeds completedRounds ` +
                String(stored.completedRounds));
        }
        summariesPerRound.set(summary.round, (summariesPerRound.get(summary.round) ?? 0) + 1);
    }
    if (summaries.length !== stored.completedRounds * SEASON_GAMES_PER_ROUND) {
        failures.push(`summary count ${String(summaries.length)} does not match completedRounds ` +
            `${String(stored.completedRounds)} (${String(stored.completedRounds * SEASON_GAMES_PER_ROUND)} expected)`);
    }
    for (let round = 1; round <= stored.completedRounds; round += 1) {
        const count = summariesPerRound.get(round) ?? 0;
        if (count !== SEASON_GAMES_PER_ROUND) {
            failures.push(`round ${String(round)} holds ${String(count)} summaries, expected ${String(SEASON_GAMES_PER_ROUND)}`);
        }
    }
    let games: readonly SeasonGame[] = [];
    try {
        games = seam.reconstructSeasonGames(facts.schedule, summaries);
    }
    catch (error) {
        failures.push(`reconstructSeasonGames failed: ${errorMessage(error)}`);
    }
    const played = games.filter((game) => game.status !== 'scheduled');
    try {
        const expectedStandings = seam.reduceSeasonStandings(facts.league, played);
        if (!deepEqual(expectedStandings, stored.standings)) {
            failures.push('stored standings do not reconcile with the finalized game records');
        }
    }
    catch (error) {
        failures.push(`standings reduction failed: ${errorMessage(error)}`);
    }
    try {
        const expectedTeams = sortById(seam.foldSeasonTeamAggregates(facts.league, summaries), (row) => row.franchiseId);
        if (!deepEqual(expectedTeams, sortById(stored.teamAggregates, (row) => row.franchiseId))) {
            failures.push('stored team aggregates do not reconcile with the stored summaries');
        }
    }
    catch (error) {
        failures.push(`team aggregate fold failed: ${errorMessage(error)}`);
    }
    try {
        const expectedPlayers = sortById(seam.foldSeasonPlayerAggregates(facts.rosters, summaries), (row) => row.playerVersionId);
        if (!deepEqual(expectedPlayers, sortById(stored.playerAggregates, (row) => row.playerVersionId))) {
            failures.push('stored player aggregates do not reconcile with the stored summaries');
        }
    }
    catch (error) {
        failures.push(`player aggregate fold failed: ${errorMessage(error)}`);
    }
    const expectedRevision = acceptedBlocks.length;
    if (stored.revision !== expectedRevision) {
        failures.push(`stored revision ${String(stored.revision)} does not match accepted-block count ${String(expectedRevision)}`);
    }
    const blockSummaryCounts = new Map<number, number>();
    for (const summary of summaries) {
        const blockIndex = blockIndexForRound(summary.round);
        blockSummaryCounts.set(blockIndex, (blockSummaryCounts.get(blockIndex) ?? 0) + 1);
    }
    let previousCompletedRounds = 0;
    let previousStateRevision = -1;
    acceptedBlocks.forEach((block, index) => {
        if (block.revision !== index + 1) {
            failures.push(`accepted block ${String(block.blockIndex)} carries revision ${String(block.revision)}, expected ${String(index + 1)}`);
        }
        if (block.blockIndex !== block.revision - 1) {
            failures.push(`accepted block ${String(block.blockIndex)} does not match revision ${String(block.revision)}`);
        }
        const boundary = expectedCompletedRoundsAt(block.blockIndex);
        if (block.completedRounds !== boundary) {
            failures.push(`accepted block ${String(block.blockIndex)} completedRounds ${String(block.completedRounds)} does not match its boundary ${String(boundary)}`);
        }
        if (block.completedRounds < previousCompletedRounds) {
            failures.push('accepted-block completedRounds regresses along the chain');
        }
        previousCompletedRounds = block.completedRounds;
        const storedCount = blockSummaryCounts.get(block.blockIndex) ?? 0;
        if (block.summaryCount !== storedCount) {
            failures.push(`accepted block ${String(block.blockIndex)} summaryCount ${String(block.summaryCount)} does not match stored rows (${String(storedCount)})`);
        }
        if (block.stateRevision <= previousStateRevision) {
            failures.push(`accepted block ${String(block.blockIndex)} stateRevision ${String(block.stateRevision)} does not advance the state chain (previous ${String(previousStateRevision)})`);
        }
        previousStateRevision = block.stateRevision;
    });
    const last = acceptedBlocks[acceptedBlocks.length - 1];
    if (last === undefined) {
        if (stored.completedRounds !== 0) {
            failures.push(`checkpoint completedRounds ${String(stored.completedRounds)} with no accepted block`);
        }
        if (stored.lastCommandId !== null || stored.lastCheckpointDigest !== null) {
            failures.push('checkpoint carries cursor facts with no accepted block');
        }
        if (stored.recap !== null) {
            failures.push('checkpoint carries a recap with no accepted block');
        }
        if (stored.checkpointState !== null) {
            failures.push('checkpoint carries checkpointState with no accepted block');
        }
    }
    else {
        if (stored.completedRounds !== last.completedRounds) {
            failures.push(`checkpoint completedRounds ${String(stored.completedRounds)} does not match the last accepted block`);
        }
        if (stored.lastCommandId !== last.commandId) {
            failures.push('checkpoint lastCommandId does not match the last accepted block');
        }
        if (stored.lastRotationDigest !== last.rotationDigest) {
            failures.push('checkpoint lastRotationDigest does not match the last accepted block');
        }
        if (stored.lastCheckpointDigest !== last.checkpointDigest) {
            failures.push('checkpoint lastCheckpointDigest does not match the last accepted block');
        }
        const lockedDigest = seam.seasonRotationSetDigest(stored.run.rotations);
        if (stored.trade === null && lockedDigest !== last.rotationDigest) {
            failures.push(`stored rotations digest ${lockedDigest} does not match the last accepted lock ${last.rotationDigest}`);
        }
        const recap = stored.recap;
        if (recap !== null) {
            if (recap.runId !== stored.run.runId || recap.blockIndex !== last.blockIndex) {
                failures.push('checkpoint recap does not describe the last accepted block');
            }
            if (recap.completedRounds !== stored.completedRounds) {
                failures.push('checkpoint recap completedRounds does not match the checkpoint');
            }
        }
        else {
            failures.push('checkpoint carries no recap after an accepted block');
        }
    }
    const summaryById = new Map(summaries.map((summary) => [summary.gameId, summary]));
    const detailCountsPerBlock = new Map<number, number>();
    for (const detail of retainedDetails) {
        const summary = summaryById.get(detail.gameId);
        if (summary === undefined) {
            failures.push(`retained detail ${detail.gameId} has no stored summary`);
            continue;
        }
        if (summary.round !== detail.round) {
            failures.push(`retained detail ${detail.gameId} round ${String(detail.round)} does not match its summary`);
        }
        if (detail.homeFranchiseId !== facts.humanFranchiseId &&
            detail.awayFranchiseId !== facts.humanFranchiseId) {
            failures.push(`retained detail ${detail.gameId} does not involve the human franchise ${facts.humanFranchiseId}`);
        }
        if (detail.runId !== stored.run.runId) {
            failures.push(`retained detail ${detail.gameId} runId does not match the checkpoint`);
        }
        const blockIndex = blockIndexForRound(detail.round);
        detailCountsPerBlock.set(blockIndex, (detailCountsPerBlock.get(blockIndex) ?? 0) + 1);
    }
    for (const [blockIndex, count] of detailCountsPerBlock) {
        if (count > 10) {
            failures.push(`block ${String(blockIndex)} retains ${String(count)} details, exceeding the 10-game policy`);
        }
    }
    const { effects } = stored;
    const rosterIds = seam.seasonRosterPlayerVersionIds(facts.rosters);
    const rosterIdSet = new Set(rosterIds);
    const rotationIds = seam.seasonRotationPlayerVersionIds(stored.run.rotations);
    const rotationIdSet = new Set(rotationIds);
    const expectedPlayerCount = SEASON_ROTATION_SIZE * SEASON_TEAM_COUNT;
    const effectIds = new Set<string>();
    for (const player of effects.playerStates) {
        if (effectIds.has(player.playerVersionId)) {
            failures.push(`duplicate effects player state ${player.playerVersionId}`);
        }
        effectIds.add(player.playerVersionId);
        if (player.fatigueBasisPoints < 0 || player.fatigueBasisPoints > 10000) {
            failures.push(`effects player ${player.playerVersionId} fatigueBasisPoints ${String(player.fatigueBasisPoints)} is outside 0..10000`);
        }
        if (player.recentLoadBasisPoints < 0 || player.recentLoadBasisPoints > 10000) {
            failures.push(`effects player ${player.playerVersionId} recentLoadBasisPoints ${String(player.recentLoadBasisPoints)} is outside 0..10000`);
        }
        if (player.lastCompletedRound < 0 || player.lastCompletedRound > 82) {
            failures.push(`effects player ${player.playerVersionId} lastCompletedRound ${String(player.lastCompletedRound)} is outside 0..82`);
        }
        if (player.lastCompletedRound > stored.completedRounds) {
            failures.push(`effects player ${player.playerVersionId} lastCompletedRound ${String(player.lastCompletedRound)} exceeds checkpoint completedRounds ${String(stored.completedRounds)}`);
        }
    }
    if (effects.playerStates.length !== expectedPlayerCount) {
        failures.push(`effects player state count ${String(effects.playerStates.length)} is not ${String(expectedPlayerCount)}`);
    }
    if (rotationIds.length !== expectedPlayerCount ||
        rotationIds.some((id) => !effectIds.has(id)) ||
        effectIds.size !== rotationIdSet.size ||
        [...effectIds].some((id) => !rotationIdSet.has(id))) {
        failures.push('effects active player set does not match the 30 locked rotations');
    }
    const inactiveEffectIds = new Set<string>();
    for (const player of effects.inactivePlayerStates) {
        if (inactiveEffectIds.has(player.playerVersionId)) {
            failures.push(`duplicate inactive effects player state ${player.playerVersionId}`);
        }
        inactiveEffectIds.add(player.playerVersionId);
        if (!rosterIdSet.has(player.playerVersionId)) {
            failures.push(`inactive effects player ${player.playerVersionId} is outside the 30 rosters`);
        }
    }
    const pairKeys = new Set<string>();
    for (const pair of effects.pairStates) {
        const key = seam.seasonPairKey(pair.a, pair.b);
        if (pairKeys.has(key)) {
            failures.push(`duplicate effects pair ${key}`);
        }
        pairKeys.add(key);
        if (!seam.seasonPairIsCanonical(pair.a, pair.b)) {
            failures.push(`effects pair ${key} is not canonical (a < b)`);
        }
        if (!effectIds.has(pair.a) || !effectIds.has(pair.b)) {
            failures.push(`effects pair ${key} has a member outside the player states`);
        }
        if (pair.sharedPossessions < 0 || pair.sharedPossessions > 10000000) {
            failures.push(`effects pair ${key} sharedPossessions ${String(pair.sharedPossessions)} is outside 0..10000000`);
        }
    }
    if (effects.pairStates.length !== 1350) {
        failures.push(`effects pair state count ${String(effects.pairStates.length)} is not 1350`);
    }
    const expectedPairKeys = new Set<string>();
    for (const rotation of stored.run.rotations) {
        const ids = [...rotation.starters, ...rotation.benchOrder].sort();
        if (ids.length !== SEASON_ROTATION_SIZE) {
            failures.push(`rotation ${rotation.franchiseId} does not name ten rotation members`);
            continue;
        }
        for (let i = 0; i < ids.length; i += 1) {
            const a = ids[i];
            if (a === undefined)
                continue;
            for (let j = i + 1; j < ids.length; j += 1) {
                const b = ids[j];
                if (b === undefined)
                    continue;
                expectedPairKeys.add(seam.seasonPairKey(a, b));
            }
        }
    }
    if (expectedPairKeys.size !== pairKeys.size ||
        [...expectedPairKeys].some((key) => !pairKeys.has(key))) {
        failures.push('effects active pairs do not match the 45 canonical pairs of each rotation');
    }
    const archivedKeys = new Set<string>();
    for (const pair of effects.archivedPairs) {
        const key = `${pair.franchiseId}\u0000${pair.a}\u0000${pair.b}`;
        if (archivedKeys.has(key)) {
            failures.push(`duplicate archived effects pair ${key}`);
        }
        archivedKeys.add(key);
        if (!seam.seasonPairIsCanonical(pair.a, pair.b)) {
            failures.push(`archived effects pair ${key} is not canonical (a < b)`);
        }
        if (!rosterIdSet.has(pair.a) || !rosterIdSet.has(pair.b)) {
            failures.push(`archived effects pair ${key} has a member outside the 30 rosters`);
        }
        if (!leagueFranchiseIds.has(pair.franchiseId)) {
            failures.push(`archived effects pair ${key} references unknown franchise ${pair.franchiseId}`);
        }
    }
    const ownershipCount = stored.run.ownership.length;
    if (ownershipCount < SEASON_TEAM_COUNT * 10 || ownershipCount > SEASON_TEAM_COUNT * 15) {
        failures.push(`ownership row count ${String(ownershipCount)} is outside 300-450`);
    }
    const rosterOwnerOf = new Map<string, string>();
    for (const roster of facts.rosters) {
        for (const player of roster.players) {
            if (rosterOwnerOf.has(player.playerVersionId)) {
                failures.push(`player ${player.playerVersionId} appears on two rosters`);
            }
            rosterOwnerOf.set(player.playerVersionId, roster.franchiseId);
        }
    }
    const ownershipIds = new Set<string>();
    for (const row of stored.run.ownership) {
        if (ownershipIds.has(row.playerVersionId)) {
            failures.push(`duplicate ownership row ${row.playerVersionId}`);
        }
        ownershipIds.add(row.playerVersionId);
        const rosterOwner = rosterOwnerOf.get(row.playerVersionId);
        if (rosterOwner === undefined) {
            failures.push(`ownership row ${row.playerVersionId} references a player outside the rosters`);
        }
        else if (row.ownerFranchiseId !== rosterOwner) {
            failures.push(`ownership row ${row.playerVersionId} names owner ${row.ownerFranchiseId}, roster owner is ${rosterOwner}`);
        }
    }
    for (const roster of facts.rosters) {
        for (const player of roster.players) {
            if (!ownershipIds.has(player.playerVersionId)) {
                failures.push(`roster player ${player.playerVersionId} has no ownership row`);
            }
        }
    }
    const { freeAgency } = stored.run;
    const signingById = new Map<string, SeasonFreeAgencySigning>();
    const signingCountsFromSignings = new Map<string, number>();
    const seasonSpendFromSignings = new Map<string, number>();
    freeAgency.windows.forEach((window, index) => {
        if (window.windowIndex !== index) {
            failures.push(`free-agency window at position ${String(index)} carries windowIndex ${String(window.windowIndex)}`);
        }
        if (window.blockIndex !== 2 + index * 2) {
            failures.push(`free-agency window ${String(index)} opened by block ${String(window.blockIndex)}, expected block ${String(2 + index * 2)}`);
        }
        if (window.blockIndex > (last?.blockIndex ?? -1)) {
            failures.push(`free-agency window ${String(index)} opened by block ${String(window.blockIndex)} that is not accepted`);
        }
        const declared = new Set(Object.keys(window.declarations));
        for (const franchiseId of leagueFranchiseIds) {
            if (!declared.has(franchiseId)) {
                if (window.status === 'open' && franchiseId === facts.humanFranchiseId)
                    continue;
                failures.push(`free-agency window ${String(index)} misses declaration for ${franchiseId}`);
            }
        }
        for (const declaration of Object.values(window.declarations)) {
            if (declaration.windowIndex !== window.windowIndex) {
                failures.push(`free-agency declaration ${declaration.franchiseId} names window ${String(declaration.windowIndex)}, expected ${String(window.windowIndex)}`);
            }
        }
        const candidateVersions = new Set(window.candidates.map((candidate) => candidate.playerVersionId));
        for (const signing of window.signings) {
            if (signingById.has(signing.signingId)) {
                failures.push(`duplicate free-agency signing ${signing.signingId}`);
            }
            signingById.set(signing.signingId, signing);
            if (signing.windowIndex !== window.windowIndex) {
                failures.push(`free-agency signing ${signing.signingId} names window ${String(signing.windowIndex)}, expected ${String(window.windowIndex)}`);
            }
            if (!candidateVersions.has(signing.playerVersionId)) {
                failures.push(`free-agency signing ${signing.signingId} is not a window candidate`);
            }
            const owner = rosterOwnerOf.get(signing.playerVersionId);
            if (owner === undefined || owner !== signing.franchiseId) {
                failures.push(`free-agency signing ${signing.signingId} does not reconcile with ownership (${signing.playerVersionId} -> ${String(owner)})`);
            }
            if (signing.appliedAtStateRevision > stored.stateRevision) {
                failures.push(`free-agency signing ${signing.signingId} applied at revision ${String(signing.appliedAtStateRevision)} beyond the stored stateRevision ${String(stored.stateRevision)}`);
            }
            const transactionIds = new Set(stored.transactions.map((entry) => entry.transactionId));
            if (!transactionIds.has(signing.transactionId)) {
                failures.push(`free-agency signing ${signing.signingId} links unknown transaction ${signing.transactionId}`);
            }
            const ledgerEntryIds = new Set(stored.influence.ledger.map((entry) => entry.entryId));
            if (!ledgerEntryIds.has(signing.ledgerEntryId)) {
                failures.push(`free-agency signing ${signing.signingId} links unknown influence ledger entry ${signing.ledgerEntryId}`);
            }
            signingCountsFromSignings.set(signing.franchiseId, (signingCountsFromSignings.get(signing.franchiseId) ?? 0) + 1);
            seasonSpendFromSignings.set(signing.franchiseId, (seasonSpendFromSignings.get(signing.franchiseId) ?? 0) + signing.influenceCost);
        }
    });
    for (const franchiseId of leagueFranchiseIds) {
        const recordedSignings = freeAgency.signingCounts[franchiseId];
        const counted = signingCountsFromSignings.get(franchiseId) ?? 0;
        if (recordedSignings !== counted) {
            failures.push(`free-agency signingCounts for ${franchiseId} is ${String(recordedSignings)}, signings reconcile ${String(counted)}`);
        }
        const recordedSpend = freeAgency.seasonSpend[franchiseId];
        const spent = seasonSpendFromSignings.get(franchiseId) ?? 0;
        if (recordedSpend !== spent) {
            failures.push(`free-agency seasonSpend for ${franchiseId} is ${String(recordedSpend)}, signings reconcile ${String(spent)}`);
        }
    }
    const { health } = stored;
    const healthRosterIds = seam.seasonRosterPlayerVersionIds(facts.rosters);
    const healthRosterIdSet = new Set(healthRosterIds);
    const healthInjuryIds = new Set<string>();
    for (const injury of health.injuries) {
        if (healthInjuryIds.has(injury.injuryId)) {
            failures.push(`duplicate injury record ${injury.injuryId}`);
        }
        healthInjuryIds.add(injury.injuryId);
        if (!healthRosterIdSet.has(injury.playerVersionId)) {
            failures.push(`injury ${injury.injuryId} references player ${injury.playerVersionId} outside the 30 rosters`);
        }
        if (!leagueFranchiseIds.has(injury.franchiseId)) {
            failures.push(`injury ${injury.injuryId} references franchise ${injury.franchiseId} outside the league`);
        }
        if (scheduleById.get(injury.gameId) === undefined &&
            !postseasonGameIdSchema.safeParse(injury.gameId).success) {
            failures.push(`injury ${injury.injuryId} occurrence game ${injury.gameId} is not scheduled`);
        }
        if (injury.seasonEnding &&
            injury.missedGamesRemaining !== SEASON_ENDING_MISSED_GAMES_SENTINEL) {
            failures.push(`season-ending injury ${injury.injuryId} must carry the missed-games sentinel ${String(SEASON_ENDING_MISSED_GAMES_SENTINEL)}`);
        }
        if (!injury.sameGameReturn && injury.sameGameReturned !== null) {
            failures.push(`injury ${injury.injuryId} resolved a same-game return without the eligibility roll`);
        }
        if (injury.recurrenceWindowRoundsRemaining > 0 && injury.actualReturnRound === null) {
            failures.push(`injury ${injury.injuryId} carries a recurrence window without an actual return`);
        }
    }
    const { influence } = stored;
    const balancesFromLedger = new Map<string, number>();
    for (const entry of influence.ledger) {
        const before = balancesFromLedger.get(entry.franchiseId) ?? 0;
        if (entry.balanceAfter !== before + entry.appliedDelta) {
            failures.push(`influence ledger entry ${entry.entryId} does not reconcile ` +
                `(balanceBefore ${String(before)} + appliedDelta ${String(entry.appliedDelta)} != balanceAfter ${String(entry.balanceAfter)})`);
        }
        if (entry.appliedDelta !== entry.requestedDelta) {
            if (entry.appliedDelta !== 0 ||
                entry.requestedDelta <= 0 ||
                before + entry.requestedDelta <= SEASON_INFLUENCE_CAP) {
                failures.push(`influence ledger entry ${entry.entryId} appliedDelta ${String(entry.appliedDelta)} does not match requestedDelta ${String(entry.requestedDelta)}`);
            }
        }
        balancesFromLedger.set(entry.franchiseId, entry.balanceAfter);
    }
    for (const franchiseId of leagueFranchiseIds) {
        const storedBalance = influence.balances[franchiseId];
        const ledgerBalance = balancesFromLedger.get(franchiseId) ?? 0;
        if (storedBalance === undefined) {
            failures.push(`influence balances miss franchise ${franchiseId}`);
        }
        else if (storedBalance !== ledgerBalance) {
            failures.push(`influence balance for ${franchiseId} is ${String(storedBalance)}, ledger recomputes ${String(ledgerBalance)}`);
        }
    }
    for (const rehabInjuryId of Object.keys(influence.rehabs)) {
        if (!healthInjuryIds.has(rehabInjuryId)) {
            failures.push(`influence rehab state references unknown injury ${rehabInjuryId}`);
        }
    }
    for (const [franchiseId, windowStates] of Object.entries(influence.windows)) {
        if (!leagueFranchiseIds.has(franchiseId)) {
            failures.push(`influence windows reference unknown franchise ${franchiseId}`);
        }
        const seen = new Set<number>();
        for (const windowState of windowStates) {
            if (seen.has(windowState.windowIndex)) {
                failures.push(`influence window spend ${franchiseId}/${String(windowState.windowIndex)} recorded twice`);
            }
            seen.add(windowState.windowIndex);
            if (windowState.windowIndex < 0 || windowState.windowIndex > 2) {
                failures.push(`influence window spend ${franchiseId} carries out-of-range windowIndex ${String(windowState.windowIndex)}`);
            }
        }
    }
    const { transactions } = stored;
    let previousAppliedAt = -1;
    const transactionIds = new Set<string>();
    for (const entry of transactions) {
        if (transactionIds.has(entry.transactionId)) {
            failures.push(`duplicate transaction entry ${entry.transactionId}`);
        }
        transactionIds.add(entry.transactionId);
        if (entry.appliedAtStateRevision < previousAppliedAt) {
            failures.push(`transaction ${entry.transactionId} appliedAtStateRevision ${String(entry.appliedAtStateRevision)} regresses along the log`);
        }
        previousAppliedAt = entry.appliedAtStateRevision;
        if (entry.appliedAtStateRevision > stored.stateRevision) {
            failures.push(`transaction ${entry.transactionId} appliedAtStateRevision ${String(entry.appliedAtStateRevision)} exceeds the stored stateRevision ${String(stored.stateRevision)}`);
        }
    }
    let recomputedDigest: string | null = null;
    let digestFailure: string | null = null;
    try {
        recomputedDigest = seam.seasonRunStateDigest({
            stateRevision: stored.stateRevision,
            stage: stored.run.stage,
            postseason: stored.run.postseason,
            awards: stored.run.awards,
            completion: stored.run.completion,
            checkpointState: stored.checkpointState,
            health: stored.health,
            influence: stored.influence,
            transactions: stored.transactions,
            trade: stored.trade,
            objectives: stored.objectives,
            campaign: stored.campaign ?? null,
            rosters: stored.run.rosters,
            ownership: stored.run.ownership,
            rotations: stored.run.rotations,
            effects: stored.effects,
            freeAgency: stored.run.freeAgency,
        });
    }
    catch (error) {
        digestFailure = `state digest recomputation failed: ${errorMessage(error)}`;
    }
    if (last !== undefined) {
        if (stored.stateRevision < last.stateRevision) {
            failures.push(`stored stateRevision ${String(stored.stateRevision)} regresses behind the last accepted block ${String(last.stateRevision)}`);
        }
        const expectedCheckpointState = {
            runId: stored.run.runId,
            blockIndex: last.blockIndex,
            completedRounds: last.completedRounds,
            revision: last.revision,
            commandId: last.commandId,
            rotationDigest: last.rotationDigest,
            checkpointDigest: last.checkpointDigest,
        };
        if (!deepEqual(stored.checkpointState, expectedCheckpointState)) {
            failures.push('checkpointState does not match the last accepted block');
        }
        if (stored.trade === null && stored.stateRevision === last.stateRevision) {
            if (digestFailure !== null) {
                failures.push(digestFailure);
            }
            else if (recomputedDigest !== last.stateDigest) {
                failures.push('run.effects diverged from the last checkpoint effects without a trade window ' +
                    '(last block stateDigest does not recompute over the stored facts)');
            }
        }
    }
    if (digestFailure !== null) {
        failures.push(digestFailure);
    }
    else if (recomputedDigest !== stored.stateDigest) {
        failures.push('stored stateDigest does not recompute over the stored mutable state');
        try {
            const divergences = auditReplayDivergences(stored, recomputedDigest, seam);
            for (const divergence of divergences) {
                if (divergence.kind !== 'state-digest') {
                    failures.push(`${divergence.kind}: ${divergence.message}`);
                }
            }
        }
        catch {
        }
    }
    const { trade } = stored;
    const windowBlockIndexByIndex: Record<number, number> = {};
    for (const [blockIndex, windowIndex] of Object.entries(seam.windowBlockIndexToIndex)) {
        windowBlockIndexByIndex[windowIndex] = Number(blockIndex);
    }
    if (trade !== null) {
        if (trade.windows.length === 0) {
            failures.push('trade state holds no windows');
        }
        if (trade.windows.length > 3) {
            failures.push(`trade state holds ${String(trade.windows.length)} windows, max 3`);
        }
        const lastAcceptedBlockIndex = last?.blockIndex ?? -1;
        trade.windows.forEach((window, index) => {
            const expectedWindowIndex = index;
            const expectedBlockIndex = windowBlockIndexByIndex[expectedWindowIndex];
            if (window.windowIndex !== expectedWindowIndex) {
                failures.push(`trade window at position ${String(index)} carries windowIndex ${String(window.windowIndex)}, expected ${String(expectedWindowIndex)}`);
            }
            if (window.blockIndex !== expectedBlockIndex) {
                failures.push(`trade window ${String(window.windowIndex)} opened by block ${String(window.blockIndex)}, expected block ${String(expectedBlockIndex)}`);
            }
            if (window.blockIndex > lastAcceptedBlockIndex) {
                failures.push(`trade window ${String(window.windowIndex)} opened by block ${String(window.blockIndex)} that is not accepted`);
            }
            const offerIds = new Set<string>();
            for (const offer of window.offers) {
                if (offerIds.has(offer.offerId)) {
                    failures.push(`duplicate trade offer ${offer.offerId} in window ${String(window.windowIndex)}`);
                }
                offerIds.add(offer.offerId);
                if (offer.windowIndex !== window.windowIndex) {
                    failures.push(`trade offer ${offer.offerId} windowIndex ${String(offer.windowIndex)} does not match its window`);
                }
            }
            if (window.status === 'closed' && window.offers.some((offer) => offer.status === 'open')) {
                failures.push(`closed trade window ${String(window.windowIndex)} still carries open offers`);
            }
        });
    }
    const pending = facts.pending;
    if (pending !== null) {
        if (pending.runId !== stored.run.runId) {
            failures.push(`pending block runId ${pending.runId} does not match the checkpoint`);
        }
        if (pending.blockIndex < acceptedBlocks.length) {
            failures.push(`pending block ${String(pending.blockIndex)} was already committed`);
        }
    }
    return failures;
}
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
