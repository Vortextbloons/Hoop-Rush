import type { ContextualPlayerValue, ContextualReason, LineupFitEvaluation, MatchupEvaluation, SimulationPlayer, SimulationTeam, } from '@hoop-rush/data-contracts';
import { clamp } from '../domain/math.ts';
type ReasonDraft = Omit<ContextualReason, 'priority'> & {
    priority: number;
};
function average(values: readonly number[]): number {
    return values.length === 0 ? 50 : values.reduce((sum, value) => sum + value, 0) / values.length;
}
function overall(player: SimulationPlayer): number {
    return player.overall ?? player.ratingProfile?.canonicalOverall ?? 50;
}
function creation(player: SimulationPlayer): number {
    const r = player.ratings;
    return ((r.ballHandling * 0.4 + r.passing * 0.35 + r.offensiveIq * 0.25) * 0.9 +
        player.tendencies.usageRate * 0.1);
}
function shooting(player: SimulationPlayer): number {
    return (player.ratings.threePoint * 0.55 +
        player.ratings.midrange * 0.2 +
        player.ratings.freeThrow * 0.1 +
        player.tendencies.threePointRate * 0.15);
}
function defense(player: SimulationPlayer): number {
    return (player.ratings.perimeterDefense * 0.42 +
        player.ratings.interiorDefense * 0.28 +
        player.ratings.defensiveIq * 0.18 +
        player.ratings.steal * 0.06 +
        player.ratings.block * 0.06);
}
function rebounding(player: SimulationPlayer): number {
    return player.ratings.offensiveRebound * 0.35 + player.ratings.defensiveRebound * 0.65;
}
function size(player: SimulationPlayer): number {
    return (player.heightInches ?? 78) * 2.2 + (player.weightLbs ?? 210) * 0.08;
}
function rimProtection(player: SimulationPlayer): number {
    return (player.ratings.interiorDefense * 0.4 +
        player.ratings.block * 0.3 +
        player.ratings.strength * 0.15 +
        player.ratings.vertical * 0.15);
}
function rimPressure(player: SimulationPlayer): number {
    return (player.tendencies.rimFrequency * 0.45 +
        player.ratings.insideScoring * 0.35 +
        player.ratings.closeShot * 0.2);
}
function sortReasons(reasons: ReasonDraft[]): ContextualReason[] {
    return reasons
        .filter((reason) => Math.abs(reason.measuredValue - reason.comparisonValue) >= 0.01)
        .sort((a, b) => b.priority - a.priority || a.code.localeCompare(b.code))
        .slice(0, 5)
        .map((reason) => reason);
}
function positiveReason(code: ContextualReason['code'], label: string, measuredValue: number, comparisonValue: number, priority: number): ReasonDraft {
    return { code, direction: 'positive', label, measuredValue, comparisonValue, priority };
}
function negativeReason(code: ContextualReason['code'], label: string, measuredValue: number, comparisonValue: number, priority: number): ReasonDraft {
    return { code, direction: 'negative', label, measuredValue, comparisonValue, priority };
}
export function evaluateLineupFit(candidate: SimulationPlayer, teammates: readonly SimulationPlayer[]): LineupFitEvaluation {
    const baseOverall = Math.round(overall(candidate));
    if (teammates.length === 0) {
        return { baseOverall, fitDelta: 0, reasons: [] };
    }
    const bestCreation = Math.max(...teammates.map(creation));
    const bestShooting = Math.max(...teammates.map(shooting));
    const bestDefense = Math.max(...teammates.map(defense));
    const bestRebounding = Math.max(...teammates.map(rebounding));
    const creationGap = creation(candidate) - bestCreation;
    const shootingGap = shooting(candidate) - bestShooting;
    const defenseGap = defense(candidate) - bestDefense;
    const reboundGap = rebounding(candidate) - bestRebounding;
    const averageShooting = average(teammates.map(shooting));
    const averageCreation = average(teammates.map(creation));
    const averageDefense = average(teammates.map(defense));
    const averageRebounding = average(teammates.map(rebounding));
    const nonShooters = teammates.filter((player) => shooting(player) < 55).length;
    const highUsage = teammates.filter((player) => player.tendencies.usageRate >= 23).length;
    const averageSize = average(teammates.map(size));
    let score = 0;
    const reasons: ReasonDraft[] = [];
    if (averageCreation < 68 && creationGap > 0) {
        score += clamp((creation(candidate) - averageCreation) / 24, 0, 1.8);
        reasons.push(positiveReason('missing-creation', 'Supplies missing creation', creation(candidate), averageCreation, 90));
    }
    if (averageShooting < 64 && shootingGap > 0) {
        score += clamp((shooting(candidate) - averageShooting) / 28, 0, 1.4);
        reasons.push(positiveReason('spacing-supply', 'Supplies missing spacing', shooting(candidate), averageShooting, 84));
    }
    if (averageDefense < 64 && defenseGap > 0) {
        score += clamp((defense(candidate) - averageDefense) / 32, 0, 1.2);
        reasons.push(positiveReason('defensive-coverage', 'Covers a defensive gap', defense(candidate), averageDefense, 78));
    }
    if (averageRebounding < 64 && reboundGap > 0) {
        score += clamp((rebounding(candidate) - averageRebounding) / 30, 0, 1.1);
        reasons.push(positiveReason('size-and-rebounding', 'Adds size and rebounding', rebounding(candidate), averageRebounding, 76));
    }
    if (nonShooters >= 2 && shooting(candidate) < 55) {
        score -= clamp((55 - shooting(candidate)) / 18, 0, 1.5);
        reasons.push(negativeReason('spacing-redundancy', 'Adds another non-shooter', shooting(candidate), 55, 88));
    }
    if (highUsage >= 2 && candidate.tendencies.usageRate >= 23) {
        score -= clamp((candidate.tendencies.usageRate + highUsage * 4 - 55) / 20, 0, 1.5);
        reasons.push(negativeReason('role-competition', 'Competes for on-ball possessions', candidate.tendencies.usageRate, 55 - highUsage * 4, 86));
    }
    if (candidate.tendencies.usageRate >= 26 && creation(candidate) < 62) {
        score -= 0.8;
        reasons.push(negativeReason('role-competition', 'High usage without matching creation', candidate.tendencies.usageRate, creation(candidate), 74));
    }
    if (size(candidate) > averageSize + 12 && reboundGap > 0)
        score += 0.35;
    return {
        baseOverall,
        fitDelta: clamp(Math.round(score), -4, 4),
        reasons: sortReasons(reasons),
    };
}
export function evaluateMatchup(candidate: SimulationPlayer, lineup: readonly SimulationPlayer[], opponent: SimulationTeam): MatchupEvaluation {
    const baseOverall = Math.round(overall(candidate));
    const opponentPlayers = opponent.players;
    const opponentRimPressure = average(opponentPlayers.map(rimPressure));
    const opponentCreation = average(opponentPlayers.map(creation));
    const opponentShooting = average(opponentPlayers.map(shooting));
    const opponentTurnoverPressure = average(opponentPlayers.map((player) => player.ratings.perimeterDefense * 0.7 + player.ratings.steal * 0.3));
    const opponentRebounding = average(opponentPlayers.map(rebounding));
    const opponentFoulPressure = average(opponentPlayers.map((player) => player.tendencies.foulRate));
    const lineupRimProtection = average(lineup.map(rimProtection));
    const lineupPerimeterDefense = average(lineup.map(defense));
    const lineupShooting = average(lineup.map(shooting));
    const lineupRebounding = average(lineup.map(rebounding));
    let score = 0;
    const reasons: ReasonDraft[] = [];
    const candidateRimProtection = rimProtection(candidate);
    if (opponentRimPressure >= 62 && candidateRimProtection > lineupRimProtection) {
        score += clamp((candidateRimProtection - lineupRimProtection) / 22, 0, 1.5);
        reasons.push(positiveReason('rim-protection', 'Rim protection versus high rim frequency', candidateRimProtection, opponentRimPressure, 94));
    }
    const candidateDefense = defense(candidate);
    if (opponentCreation >= 64 && candidateDefense > lineupPerimeterDefense) {
        score += clamp((candidateDefense - lineupPerimeterDefense) / 28, 0, 1.3);
        reasons.push(positiveReason('perimeter-defense', 'Perimeter defense versus high creation', candidateDefense, opponentCreation, 89));
    }
    if (opponentShooting >= 64 && lineupPerimeterDefense < 64 && candidateDefense < 60) {
        score -= 0.9;
        reasons.push(negativeReason('perimeter-creation', 'Can be targeted by perimeter creation', candidateDefense, opponentShooting, 87));
    }
    if (opponentTurnoverPressure >= 64 && candidate.tendencies.turnoverRate > 14) {
        score -= clamp((candidate.tendencies.turnoverRate - 14) / 10, 0, 1.2);
        reasons.push(negativeReason('turnover-pressure', 'Turnover risk versus pressure defense', candidate.tendencies.turnoverRate, opponentTurnoverPressure, 83));
    }
    if (opponentRebounding >= 64 && rebounding(candidate) < lineupRebounding) {
        score -= clamp((opponentRebounding - rebounding(candidate)) / 34, 0, 1.1);
        reasons.push(negativeReason('size-and-rebounding', 'Needs rebounding against a strong glass team', rebounding(candidate), opponentRebounding, 80));
    }
    if (opponentFoulPressure >= 7 && candidate.tendencies.foulRate <= 5) {
        score += 0.35;
        reasons.push(positiveReason('foul-pressure', 'Disciplined defender against foul pressure', candidate.tendencies.foulRate, opponentFoulPressure, 60));
    }
    if (opponentShooting < 58 && lineupShooting > 62 && candidateRimProtection >= 60)
        score += 0.25;
    return {
        baseOverall,
        matchupDelta: clamp(Math.round(score), -3, 3),
        reasons: sortReasons(reasons),
    };
}
export function evaluateContextualPlayerValue(candidate: SimulationPlayer, teammates: readonly SimulationPlayer[], opponent?: SimulationTeam): ContextualPlayerValue {
    const fit = evaluateLineupFit(candidate, teammates);
    const lineup = [...teammates, candidate];
    const matchup = opponent
        ? evaluateMatchup(candidate, lineup, opponent)
        : { baseOverall: fit.baseOverall, matchupDelta: 0, reasons: [] };
    return {
        baseOverall: fit.baseOverall,
        fitDelta: fit.fitDelta,
        matchupDelta: matchup.matchupDelta,
        effectiveValue: clamp(fit.baseOverall + fit.fitDelta + matchup.matchupDelta, 0, 100),
        fitReasons: fit.reasons,
        matchupReasons: matchup.reasons,
    };
}
export function evaluateLineupMatchup(lineup: SimulationTeam, opponent: SimulationTeam): MatchupEvaluation {
    const firstPlayer = lineup.players.at(0);
    if (!firstPlayer) {
        return { baseOverall: 50, matchupDelta: 0, reasons: [] };
    }
    const averagePlayer: SimulationPlayer = {
        ...firstPlayer,
        playerId: `${lineup.teamId}-lineup-average`,
        displayName: lineup.displayName,
        overall: Math.round(average(lineup.players.map(overall))),
        ratings: Object.fromEntries(Object.keys(firstPlayer.ratings).map((key) => [
            key,
            average(lineup.players.map((player) => player.ratings[key as keyof SimulationPlayer['ratings']])),
        ])) as SimulationPlayer['ratings'],
        tendencies: Object.fromEntries(Object.keys(firstPlayer.tendencies).map((key) => [
            key,
            average(lineup.players.map((player) => player.tendencies[key as keyof SimulationPlayer['tendencies']])),
        ])) as SimulationPlayer['tendencies'],
    };
    return evaluateMatchup(averagePlayer, lineup.players, opponent);
}
