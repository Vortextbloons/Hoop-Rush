import type { SeasonGameSimulationInput, SeasonGameSimulationResult, } from '@hoop-rush/data-contracts';
import { auditSideAccounting } from '../sim/accounting-core.ts';
import { createEngineContext } from '../sim/context.ts';
import { OVERTIME_PERIOD_SECONDS, REGULATION_PERIOD_SECONDS, REGULATION_TOTAL_SECONDS, } from '../sim/periods.ts';
import { SEASON_ROSTER_SIZE } from './roster-rules.ts';
import { chooseInitialUnit, type PlannerRotationContext } from './rotation-planner.ts';
import { sameUnit, simulateSeasonGame } from './season-game.ts';
const REGULATION_PLAYER_SECONDS = 5 * REGULATION_TOTAL_SECONDS;
const OVERTIME_PLAYER_SECONDS = 5 * OVERTIME_PERIOD_SECONDS;
export function checkSeasonGameResult(result: SeasonGameSimulationResult, input: SeasonGameSimulationInput): string[] {
    const failures: string[] = [];
    const replay = simulateSeasonGame(input, createEngineContext());
    if (JSON.stringify(replay) !== JSON.stringify(result)) {
        failures.push('determinism: re-running the same input produced a different result');
    }
    const homeIds = new Set(input.home.players.map((p) => p.playerVersionId));
    const awayIds = new Set(input.away.players.map((p) => p.playerVersionId));
    for (const id of homeIds) {
        if (awayIds.has(id))
            failures.push(`cross-team ownership: ${id} rostered on both sides`);
    }
    if (result.outcome === 'no-legal-five-both') {
        if (sideHasLegalFiveAtTipoff(input, 'home')) {
            failures.push('no-legal-five-both: home can field a legal five at tipoff');
        }
        if (sideHasLegalFiveAtTipoff(input, 'away')) {
            failures.push('no-legal-five-both: away can field a legal five at tipoff');
        }
        return failures;
    }
    if (result.outcome === 'forfeit') {
        const loserSide = result.winner === 'home' ? 'away' : 'home';
        if (result.losingFranchiseId !== input[loserSide].franchiseId) {
            failures.push('forfeit: losingFranchiseId does not match the losing side');
        }
        const winnerScore = result.winner === 'home' ? result.homeScore : result.awayScore;
        const loserScore = result.winner === 'home' ? result.awayScore : result.homeScore;
        if (winnerScore !== 2 || loserScore !== 0) {
            failures.push(`forfeit: official result must be 2-0 (got ${String(winnerScore)}-${String(loserScore)})`);
        }
        if (result.trigger === 'no-legal-five-tipoff' && sideHasLegalFiveAtTipoff(input, loserSide)) {
            failures.push('forfeit: losing side can field a legal five at tipoff');
        }
        return failures;
    }
    const ot = result.overtimePeriods;
    const expectedTotalSeconds = REGULATION_PLAYER_SECONDS + OVERTIME_PLAYER_SECONDS * ot;
    for (const sideKey of ['home', 'away'] as const) {
        const side = result[sideKey];
        const teamInput = input[sideKey];
        const box = side.box;
        const players = side.players;
        const playerIds = players.map((p) => p.playerVersionId);
        if (players.length !== SEASON_ROSTER_SIZE) {
            failures.push(`${sideKey}: expected ten player results, got ${String(players.length)}`);
        }
        if (new Set(playerIds).size !== playerIds.length) {
            failures.push(`${sideKey}: duplicate playerVersionIds in results`);
        }
        for (const player of players) {
            if (!teamInput.players.some((r) => r.playerVersionId === player.playerVersionId)) {
                failures.push(`${sideKey}: result references an unrostered version ${player.playerVersionId}`);
            }
        }
        const playerSeconds = players.reduce((sum, p) => sum + p.seconds, 0);
        if (playerSeconds !== expectedTotalSeconds) {
            failures.push(`${sideKey}: player seconds (${String(playerSeconds)}) != ${String(expectedTotalSeconds)}`);
        }
        for (const p of players) {
            if (!Number.isInteger(p.seconds)) {
                failures.push(`${sideKey}: ${p.playerVersionId} seconds are not integers`);
            }
            if (Math.abs(p.minutes - p.seconds / 60) > 1e-9) {
                failures.push(`${sideKey}: ${p.playerVersionId} minutes != seconds / 60`);
            }
        }
        const accounting = auditSideAccounting(players, box, side.shotZones, (p) => p.playerVersionId);
        if (accounting.playerPointsTotal !== box.points) {
            failures.push(`${sideKey}: player points != team points`);
        }
        if (!accounting.pointsIdentityOk) {
            failures.push(`${sideKey}: team points != 2*2fg + 3*3fg + ft`);
        }
        if (accounting.makesExceed.length > 0) {
            failures.push(`${sideKey}: makes exceed attempts`);
        }
        if (accounting.assistsExceedMade)
            failures.push(`${sideKey}: assists exceed made field goals`);
        if (!accounting.reboundBucketsOk) {
            failures.push(`${sideKey}: rebound buckets do not sum to total`);
        }
        for (const row of accounting.reconciliations) {
            if (row.playerTotal !== row.teamValue) {
                failures.push(`${sideKey}: player ${row.label} (${String(row.playerTotal)}) != team ${row.label} (${String(row.teamValue)})`);
            }
        }
        if (!accounting.reboundOpportunitiesOk) {
            failures.push(`${sideKey}: rebound opportunities != misses`);
        }
        if (!accounting.assistedUnassistedOk) {
            failures.push(`${sideKey}: assisted + unassisted != made field goals`);
        }
        if (!accounting.contestedShotsOk) {
            failures.push(`${sideKey}: player contested shots != team contested shots`);
        }
        if (!accounting.offensiveReboundChancesOk) {
            failures.push(`${sideKey}: player offensive-rebound chances != 5 * rebound opportunities`);
        }
        const other = result[sideKey === 'home' ? 'away' : 'home'];
        const otherMisses = other.box.fieldGoals.attempted -
            other.box.fieldGoals.made +
            (other.box.freeThrows.attempted - other.box.freeThrows.made);
        if (players.reduce((acc, p) => acc + p.diagnostics.defensiveReboundChances, 0) !==
            otherMisses * 5) {
            failures.push(`${sideKey}: player defensive-rebound chances != 5 * opponent misses`);
        }
        for (const zone of accounting.zoneSplits) {
            if (zone.playerAttempts !== zone.teamAttempts || zone.playerMakes !== zone.teamMakes) {
                failures.push(`${sideKey}: player zone splits (${zone.zone}) != team zone summary`);
            }
        }
        const violationCount = Math.max(accounting.assistOpportunityViolations.length, accounting.usageViolations.length);
        for (let i = 0; i < violationCount; i += 1) {
            const assist = accounting.assistOpportunityViolations[i];
            if (assist !== undefined) {
                failures.push(`${sideKey}: ${assist.playerKey} assist opportunities < assists`);
            }
            const usage = accounting.usageViolations[i];
            if (usage !== undefined) {
                failures.push(`${sideKey}: ${usage.playerKey} usage identity broken`);
            }
        }
        const periodTotal = side.periodScores.reduce((a, b) => a + b, 0);
        if (side.periodScores.length !== 4 + ot) {
            failures.push(`${sideKey}: period count (${String(side.periodScores.length)}) != 4 + OT (${String(4 + ot)})`);
        }
        if (periodTotal !== side.score || side.score !== box.points) {
            failures.push(`${sideKey}: period scores do not reconcile with the box`);
        }
        stintAudit(failures, sideKey, result, input);
    }
    const homeScore = result.home.score;
    const awayScore = result.away.score;
    if (homeScore !== awayScore && result.winner !== (homeScore > awayScore ? 'home' : 'away')) {
        failures.push('winner does not match the final scores');
    }
    for (const sideKey of ['home', 'away'] as const) {
        substitutionAudit(failures, sideKey, result, input);
        deviationAudit(failures, sideKey, result, input);
    }
    return failures;
}
function stintAudit(failures: string[], sideKey: 'home' | 'away', result: Extract<SeasonGameSimulationResult, {
    outcome: 'completed';
}>, input: SeasonGameSimulationInput): void {
    const stints = result.unitStints.filter((s) => s.side === sideKey);
    for (let i = 0; i < stints.length; i += 1) {
        const stint = stints[i];
        if (stint === undefined)
            continue;
        if (stint.durationSeconds !== stint.startSecondsRemaining - stint.endSecondsRemaining) {
            failures.push(`${sideKey}: stint duration != start - end (period ${String(stint.period)})`);
        }
        if (stint.endSecondsRemaining > stint.startSecondsRemaining) {
            failures.push(`${sideKey}: stint end clock exceeds start clock`);
        }
        if (new Set(stint.players).size !== 5) {
            failures.push(`${sideKey}: stint unit must be five distinct players`);
        }
    }
    const first = stints[0];
    if (first !== undefined) {
        if (first.period !== 1 || first.startSecondsRemaining !== REGULATION_PERIOD_SECONDS) {
            failures.push(`${sideKey}: first stint must open at (1, 720)`);
        }
        const initial = initialUnitAtTipoff(input, sideKey);
        if (initial !== null && !sameUnit(first.players, initial)) {
            failures.push(`${sideKey}: tipoff unit does not match the planner's initial unit`);
        }
    }
    for (let i = 1; i < stints.length; i += 1) {
        const prev = stints[i - 1];
        const cur = stints[i];
        if (prev === undefined || cur === undefined)
            continue;
        if (cur.period === prev.period) {
            if (cur.startSecondsRemaining !== prev.endSecondsRemaining) {
                failures.push(`${sideKey}: stint gap in period ${String(prev.period)}`);
            }
        }
        else if (cur.period === prev.period + 1) {
            if (prev.endSecondsRemaining !== 0) {
                failures.push(`${sideKey}: stint crossing period ${String(prev.period)} does not end at 0`);
            }
            const expectedStart = cur.period <= 4 ? REGULATION_PERIOD_SECONDS : OVERTIME_PERIOD_SECONDS;
            if (cur.startSecondsRemaining !== expectedStart) {
                failures.push(`${sideKey}: stint opening period ${String(cur.period)} does not start at ${String(expectedStart)}`);
            }
        }
        else {
            failures.push(`${sideKey}: stint period jump ${String(prev.period)} -> ${String(cur.period)}`);
        }
    }
    const last = stints[stints.length - 1];
    if (last !== undefined) {
        if (last.period !== 4 + result.overtimePeriods || last.endSecondsRemaining !== 0) {
            failures.push(`${sideKey}: last stint must end at the final period's zero`);
        }
    }
    const stintSeconds = stints.reduce((sum, stint) => sum + stint.durationSeconds, 0);
    const expectedGameSeconds = REGULATION_TOTAL_SECONDS + OVERTIME_PERIOD_SECONDS * result.overtimePeriods;
    if (stintSeconds !== expectedGameSeconds) {
        failures.push(`${sideKey}: stint seconds (${String(stintSeconds)}) != game length (${String(expectedGameSeconds)})`);
    }
    const secondsByPlayer = new Map<string, number>();
    for (const stint of stints) {
        for (const playerVersionId of stint.players) {
            secondsByPlayer.set(playerVersionId, (secondsByPlayer.get(playerVersionId) ?? 0) + stint.durationSeconds);
        }
    }
    for (const player of result[sideKey].players) {
        const fromStints = secondsByPlayer.get(player.playerVersionId) ?? 0;
        if (fromStints !== player.seconds) {
            failures.push(`${sideKey}: ${player.playerVersionId} seconds (${String(player.seconds)}) != stint seconds (${String(fromStints)})`);
        }
    }
}
function substitutionAudit(failures: string[], sideKey: 'home' | 'away', result: Extract<SeasonGameSimulationResult, {
    outcome: 'completed';
}>, input: SeasonGameSimulationInput): void {
    const subs = result.substitutions.filter((s) => s.side === sideKey);
    const stints = result.unitStints.filter((s) => s.side === sideKey);
    const unavailable = new Set<string>();
    for (const entry of input.availability) {
        if (entry.available)
            continue;
        if (input[sideKey].players.some((p) => p.playerVersionId === entry.playerVersionId)) {
            unavailable.add(entry.playerVersionId);
        }
    }
    for (let i = 0; i < subs.length; i += 1) {
        const sub = subs[i];
        if (sub === undefined)
            continue;
        if (sub.period < 1 ||
            sub.period > 12 ||
            !Number.isInteger(sub.secondsRemaining) ||
            sub.secondsRemaining < 0 ||
            sub.secondsRemaining > REGULATION_PERIOD_SECONDS) {
            failures.push(`${sideKey}: substitution outside legal clock bounds`);
        }
        if (sub.playerIn === sub.playerOut) {
            failures.push(`${sideKey}: substitution with identical in/out player`);
        }
        if (!sub.unit.includes(sub.playerIn) || sub.unit.includes(sub.playerOut)) {
            failures.push(`${sideKey}: substitution unit inconsistent with playerIn/playerOut`);
        }
        if (unavailable.has(sub.playerIn)) {
            failures.push(`${sideKey}: substitution brings an unavailable player in`);
        }
        const atPeriodEnd = sub.secondsRemaining === 0;
        const matchingStint = stints.find((stint) => {
            if (stint.period === sub.period + 1 &&
                stint.startSecondsRemaining ===
                    (stint.period <= 4 ? REGULATION_PERIOD_SECONDS : OVERTIME_PERIOD_SECONDS) &&
                sameUnit(stint.players, sub.unit)) {
                return true;
            }
            return (stint.period === sub.period &&
                stint.startSecondsRemaining === sub.secondsRemaining &&
                sameUnit(stint.players, sub.unit));
        });
        if (matchingStint === undefined) {
            failures.push(`${sideKey}: substitution at (${String(sub.period)}, ${String(sub.secondsRemaining)}) has no matching unit stint`);
        }
        const previousUnit = stints.find((stint) => {
            if (atPeriodEnd) {
                return stint.period === sub.period && stint.endSecondsRemaining === 0;
            }
            return stint.period === sub.period && stint.endSecondsRemaining === sub.secondsRemaining;
        });
        if (previousUnit !== undefined && !previousUnit.players.includes(sub.playerOut)) {
            failures.push(`${sideKey}: ${sub.playerOut} was not on the floor at the substitution`);
        }
        const finalPeriod = 4 + result.overtimePeriods;
        for (const event of result.foulOuts) {
            if (event.side !== sideKey)
                continue;
            if (event.period === finalPeriod && event.secondsRemaining === 0)
                continue;
            const backed = subs.some((sub) => sub.reason === 'foul-out' &&
                sub.playerOut === event.playerVersionId &&
                sub.period === event.period &&
                sub.secondsRemaining === event.secondsRemaining);
            if (!backed) {
                failures.push(`${sideKey}: foul-out of ${event.playerVersionId} at (${String(event.period)}, ${String(event.secondsRemaining)}) has no removal substitution`);
            }
        }
        for (const sub of subs) {
            if (sub.reason !== 'foul-out' && sub.reason !== 'injected-injury-removal')
                continue;
            const boundaryHasEvent = (sub.reason === 'foul-out' ? result.foulOuts : result.removals).some((event) => event.side === sideKey &&
                event.period === sub.period &&
                event.secondsRemaining === sub.secondsRemaining);
            const playerWasRemoved = (sub.reason === 'foul-out' ? result.foulOuts : result.removals).some((event) => event.side === sideKey &&
                event.playerVersionId === sub.playerOut &&
                (event.period < sub.period ||
                    (event.period === sub.period && event.secondsRemaining >= sub.secondsRemaining)));
            if (!boundaryHasEvent && !playerWasRemoved) {
                failures.push(`${sideKey}: ${sub.reason} substitution without a matching event`);
            }
        }
    }
    for (let i = 1; i < stints.length; i += 1) {
        const prev = stints[i - 1];
        const cur = stints[i];
        if (prev === undefined || cur === undefined)
            continue;
        if (sameUnit(prev.players, cur.players))
            continue;
        const backed = subs.some((sub) => sameUnit(sub.unit, cur.players) &&
            ((sub.period === cur.period && sub.secondsRemaining === cur.startSecondsRemaining) ||
                (sub.period === cur.period - 1 && sub.secondsRemaining === 0)));
        if (!backed) {
            failures.push(`${sideKey}: unit change at (${String(cur.period)}, ${String(cur.startSecondsRemaining)}) without a substitution record`);
        }
    }
    const momentBefore = (a: {
        period: number;
        secondsRemaining: number;
    }, b: {
        period: number;
        secondsRemaining: number;
    }): boolean => a.period < b.period || (a.period === b.period && a.secondsRemaining > b.secondsRemaining);
    for (const stint of stints) {
        for (const playerVersionId of stint.players) {
            if (unavailable.has(playerVersionId)) {
                failures.push(`${sideKey}: stint contains pregame-unavailable ${playerVersionId}`);
            }
        }
    }
    for (const event of [
        ...result.foulOuts.filter((e) => e.side === sideKey),
        ...result.removals.filter((e) => e.side === sideKey),
    ]) {
        for (const stint of stints) {
            if (!stint.players.includes(event.playerVersionId))
                continue;
            const playsPast = stint.period > event.period ||
                (stint.period === event.period && stint.endSecondsRemaining < event.secondsRemaining);
            if (!playsPast)
                continue;
            const reenabledBeforeStintStart = result[sideKey].returns.some((ret) => ret.playerVersionId === event.playerVersionId &&
                !momentBefore({ period: stint.period, secondsRemaining: stint.startSecondsRemaining }, ret));
            if (reenabledBeforeStintStart)
                continue;
            failures.push(`${sideKey}: ${event.playerVersionId} plays in period ${String(stint.period)} after removal in period ${String(event.period)}`);
        }
    }
    for (const event of result[sideKey].returns) {
        const removal = result.removals.find((entry) => entry.side === sideKey && entry.playerVersionId === event.playerVersionId);
        if (removal === undefined)
            continue;
        for (const stint of stints) {
            if (!stint.players.includes(event.playerVersionId))
                continue;
            const stintStart = { period: stint.period, secondsRemaining: stint.startSecondsRemaining };
            const stintEnd = { period: stint.period, secondsRemaining: stint.endSecondsRemaining };
            const afterRemoval = momentBefore(removal, stintEnd);
            const beforeReturn = momentBefore(stintStart, event);
            if (afterRemoval && beforeReturn) {
                failures.push(`${sideKey}: ${event.playerVersionId} plays between the removal and (${String(event.period)}, ${String(event.secondsRemaining)}) return`);
            }
        }
    }
    for (const event of result.foulOuts) {
        if (event.side !== sideKey)
            continue;
        const player = result[sideKey].players.find((p) => p.playerVersionId === event.playerVersionId);
        if (player === undefined || player.fouls < 6) {
            failures.push(`${sideKey}: foul-out for a player with fewer than six fouls`);
        }
    }
    const playerFouls = result[sideKey].players.reduce((sum, p) => sum + p.fouls, 0);
    if (playerFouls !== result[sideKey].box.fouls) {
        failures.push(`${sideKey}: player fouls != team fouls`);
    }
}
function deviationAudit(failures: string[], sideKey: 'home' | 'away', result: Extract<SeasonGameSimulationResult, {
    outcome: 'completed';
}>, input: SeasonGameSimulationInput): void {
    const rotation = sideKey === 'home' ? input.homeRotation : input.awayRotation;
    const regSeconds = new Map<string, number>();
    for (const stint of result.unitStints) {
        if (stint.side !== sideKey || stint.period > 4)
            continue;
        for (const playerVersionId of stint.players) {
            regSeconds.set(playerVersionId, (regSeconds.get(playerVersionId) ?? 0) + stint.durationSeconds);
        }
    }
    const targets = new Map<string, number>();
    for (const entry of rotation.targetMinutes) {
        targets.set(entry.playerVersionId, entry.minutes * 60);
    }
    const devs = result.deviations.filter((d) => d.side === sideKey);
    const devIds = new Set(devs.map((d) => d.playerVersionId));
    for (const player of result[sideKey].players) {
        const actual = regSeconds.get(player.playerVersionId) ?? 0;
        const target = targets.get(player.playerVersionId) ?? 0;
        const hasDeviation = devIds.has(player.playerVersionId);
        if (actual !== target && !hasDeviation) {
            failures.push(`${sideKey}: missing deviation for ${player.playerVersionId}`);
        }
        if (actual === target && hasDeviation) {
            failures.push(`${sideKey}: spurious deviation for ${player.playerVersionId}`);
        }
    }
    for (const dev of devs) {
        if (dev.reasons.length === 0) {
            failures.push(`${sideKey}: deviation for ${dev.playerVersionId} has no reasons`);
        }
        if (dev.reasons.some((reason) => !isDeviationReason(reason))) {
            failures.push(`${sideKey}: deviation with an unknown reason`);
        }
        if (targets.get(dev.playerVersionId) === undefined) {
            failures.push(`${sideKey}: deviation for an unrostered version ${dev.playerVersionId}`);
        }
    }
    const unavailable = new Set<string>();
    for (const entry of input.availability) {
        if (!entry.available &&
            input[sideKey].players.some((p) => p.playerVersionId === entry.playerVersionId)) {
            unavailable.add(entry.playerVersionId);
        }
    }
    for (const dev of devs) {
        if (unavailable.has(dev.playerVersionId) && !dev.reasons.includes('pregame-unavailable')) {
            failures.push(`${sideKey}: ${dev.playerVersionId} missing pregame-unavailable reason`);
        }
        if (result.foulOuts.some((e) => e.side === sideKey && e.playerVersionId === dev.playerVersionId) &&
            !dev.reasons.includes('foul-out')) {
            failures.push(`${sideKey}: ${dev.playerVersionId} missing foul-out reason`);
        }
        if (result.removals.some((e) => e.side === sideKey && e.playerVersionId === dev.playerVersionId) &&
            !dev.reasons.includes('injected-injury-removal')) {
            failures.push(`${sideKey}: ${dev.playerVersionId} missing injected-injury-removal reason`);
        }
        if (result[sideKey].returns.some((e) => e.playerVersionId === dev.playerVersionId) &&
            !dev.reasons.includes('injury-return')) {
            failures.push(`${sideKey}: ${dev.playerVersionId} missing injury-return reason`);
        }
    }
    let balance = 0;
    for (const dev of devs)
        balance += dev.actualSeconds - dev.targetSeconds;
    if (balance !== 0) {
        failures.push(`${sideKey}: deviation seconds do not balance (${String(balance)})`);
    }
}
function isDeviationReason(reason: string): boolean {
    return (reason === 'dead-ball-timing' ||
        reason === 'closing-preference' ||
        reason === 'foul-out' ||
        reason === 'pregame-unavailable' ||
        reason === 'injected-injury-removal' ||
        reason === 'contingency-legality' ||
        reason === 'injury-return');
}
function sideHasLegalFiveAtTipoff(input: SeasonGameSimulationInput, sideKey: 'home' | 'away'): boolean {
    return initialUnitAtTipoff(input, sideKey) !== null;
}
function initialUnitAtTipoff(input: SeasonGameSimulationInput, sideKey: 'home' | 'away'): string[] | null {
    const team = input[sideKey];
    const rotation = sideKey === 'home' ? input.homeRotation : input.awayRotation;
    const unavailable = new Set<string>();
    for (const entry of input.availability) {
        if (!entry.available && team.players.some((p) => p.playerVersionId === entry.playerVersionId)) {
            unavailable.add(entry.playerVersionId);
        }
    }
    for (const removal of input.removals) {
        if (removal.side === sideKey &&
            removal.period === 1 &&
            removal.secondsRemaining >= REGULATION_PERIOD_SECONDS) {
            unavailable.add(removal.playerVersionId);
        }
    }
    const context: PlannerRotationContext = {
        rotation,
        members: new Map(team.players.map((p) => [p.playerVersionId, p.positions])),
        targets: new Map(rotation.targetMinutes.map((t) => [t.playerVersionId, t.minutes * 60])),
    };
    return chooseInitialUnit(context, unavailable);
}
