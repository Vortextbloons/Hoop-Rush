import { seasonAwardsDigest, type SeasonAwards, type SeasonGameSummary, type SeasonRoster, } from '@hoop-rush/data-contracts';
export interface SeasonAwardsInput {
    runId: string;
    rosters: SeasonRoster[];
    summaries: SeasonGameSummary[];
}
export const SEASON_AWARD_MIN_GAME_SHARE = 0.7;
export const SEASON_AWARD_FULL_SEASON_GAMES = 82;
const CONSISTENCY_PENALTY = 0.08;
const DEFENSE_WEIGHTS = { steal: 0.6, block: 0.6, defensiveRebound: 0.15 } as const;
const PLAYMAKING_ASSIST_WEIGHT = 0.5;
const TEAM_BONUS = { win: 0.75, loss: -0.75 } as const;
const DPOY = { steal: 2.0, block: 2.0, defensiveRebound: 0.5, advantage: 3.0 } as const;
interface PlayerTotals {
    playerVersionId: string;
    appearances: number;
    starts: number;
    seconds: number;
    points: number;
    fieldGoalsMade: number;
    fieldGoalsAttempted: number;
    freeThrowsMade: number;
    freeThrowsAttempted: number;
    offensiveRebounds: number;
    defensiveRebounds: number;
    assists: number;
    steals: number;
    blocks: number;
    turnovers: number;
    fouls: number;
    valueBases: number[];
    gameScores: number[];
    efficiencyValues: number[];
    shotsList: number[];
    wins: boolean[];
    franchiseAppearances: Map<string, number>;
    franchiseStarts: Map<string, number>;
}
interface TeamFacts {
    gamesPlayed: number;
    pointsAgainst: number;
    possessions: number;
    seconds: number;
}
function shotsUsedOf(line: {
    fieldGoalsAttempted: number;
    freeThrowsAttempted: number;
}): number {
    return line.fieldGoalsAttempted + 0.44 * line.freeThrowsAttempted;
}
function trueShootingOf(line: {
    points: number;
    fieldGoalsAttempted: number;
    freeThrowsAttempted: number;
}): number {
    const shots = shotsUsedOf(line);
    return shots <= 0 ? 0 : line.points / (2 * shots);
}
function gameScoreOf(line: {
    points: number;
    fieldGoalsMade: number;
    fieldGoalsAttempted: number;
    freeThrowsMade: number;
    freeThrowsAttempted: number;
    offensiveRebounds: number;
    defensiveRebounds: number;
    assists: number;
    steals: number;
    blocks: number;
    fouls: number;
    turnovers: number;
}): number {
    return (line.points +
        0.4 * line.fieldGoalsMade -
        0.7 * line.fieldGoalsAttempted -
        0.4 * (line.freeThrowsAttempted - line.freeThrowsMade) +
        0.7 * line.offensiveRebounds +
        0.3 * line.defensiveRebounds +
        line.steals +
        0.7 * line.assists +
        0.7 * line.blocks -
        0.4 * line.fouls -
        line.turnovers);
}
function populationStdDev(values: readonly number[], mean: number): number {
    if (values.length < 2)
        return 0;
    let sumOfSquares = 0;
    for (const value of values) {
        const deviation = value - mean;
        sumOfSquares += deviation * deviation;
    }
    return Math.sqrt(sumOfSquares / values.length);
}
function mvpValueBase(line: {
    points: number;
    fieldGoalsMade: number;
    fieldGoalsAttempted: number;
    freeThrowsMade: number;
    freeThrowsAttempted: number;
    offensiveRebounds: number;
    defensiveRebounds: number;
    assists: number;
    steals: number;
    blocks: number;
    fouls: number;
    turnovers: number;
}): number {
    return (gameScoreOf(line) +
        DEFENSE_WEIGHTS.steal * line.steals +
        DEFENSE_WEIGHTS.block * line.blocks +
        DEFENSE_WEIGHTS.defensiveRebound * line.defensiveRebounds +
        PLAYMAKING_ASSIST_WEIGHT * line.assists);
}
function mvpValuesOf(facts: AwardsFacts, row: PlayerTotals): number[] {
    const baseline = facts.leagueAverageTs;
    const values: number[] = [];
    for (let i = 0; i < row.valueBases.length; i += 1) {
        const valueBase = row.valueBases[i] ?? 0;
        const shots = row.shotsList[i] ?? 0;
        const efficiency = row.efficiencyValues[i] ?? 0;
        const won = row.wins[i] ?? false;
        values.push(valueBase + (efficiency - baseline) * shots + (won ? TEAM_BONUS.win : TEAM_BONUS.loss));
    }
    return values;
}
interface AwardsFacts {
    totals: Map<string, PlayerTotals>;
    leagueAverageTs: number;
    teamFacts: Map<string, TeamFacts>;
    leagueAverageDefRtg: number;
}
function foldAwardsFacts(input: SeasonAwardsInput): AwardsFacts {
    const totals = new Map<string, PlayerTotals>();
    const teamFacts = new Map<string, TeamFacts>();
    let leaguePoints = 0;
    let leagueShots = 0;
    const lineOf = (line: {
        playerVersionId: string;
    }): PlayerTotals => {
        let row = totals.get(line.playerVersionId);
        if (row === undefined) {
            row = {
                playerVersionId: line.playerVersionId,
                appearances: 0,
                starts: 0,
                seconds: 0,
                points: 0,
                fieldGoalsMade: 0,
                fieldGoalsAttempted: 0,
                freeThrowsMade: 0,
                freeThrowsAttempted: 0,
                offensiveRebounds: 0,
                defensiveRebounds: 0,
                assists: 0,
                steals: 0,
                blocks: 0,
                turnovers: 0,
                fouls: 0,
                valueBases: [],
                gameScores: [],
                efficiencyValues: [],
                shotsList: [],
                wins: [],
                franchiseAppearances: new Map(),
                franchiseStarts: new Map(),
            };
            totals.set(line.playerVersionId, row);
        }
        return row;
    };
    const teamOf = (franchiseId: string): TeamFacts => {
        let facts = teamFacts.get(franchiseId);
        if (facts === undefined) {
            facts = { gamesPlayed: 0, pointsAgainst: 0, possessions: 0, seconds: 0 };
            teamFacts.set(franchiseId, facts);
        }
        return facts;
    };
    for (const summary of input.summaries) {
        const homeFacts = teamOf(summary.homeFranchiseId);
        const awayFacts = teamOf(summary.awayFranchiseId);
        homeFacts.gamesPlayed += 1;
        awayFacts.gamesPlayed += 1;
        homeFacts.pointsAgainst += summary.awayScore;
        awayFacts.pointsAgainst += summary.homeScore;
        if (summary.status === 'forfeit')
            continue;
        homeFacts.possessions += summary.homeBox.possessions;
        awayFacts.possessions += summary.awayBox.possessions;
        for (const side of ['home', 'away'] as const) {
            const franchiseId = summary[`${side}FranchiseId`];
            const lines = side === 'home' ? summary.homePlayers : summary.awayPlayers;
            const won = (side === 'home' && summary.homeScore > summary.awayScore) ||
                (side === 'away' && summary.awayScore > summary.homeScore);
            for (const line of lines) {
                const row = lineOf(line);
                const seconds = line.seconds;
                const shots = shotsUsedOf(line);
                if (seconds > 0) {
                    row.appearances += 1;
                    row.franchiseAppearances.set(franchiseId, (row.franchiseAppearances.get(franchiseId) ?? 0) + 1);
                    row.gameScores.push(gameScoreOf(line));
                    row.valueBases.push(mvpValueBase(line));
                    row.efficiencyValues.push(trueShootingOf(line));
                    row.shotsList.push(shots);
                    row.wins.push(won);
                }
                if (line.started === true) {
                    row.starts += 1;
                    row.franchiseStarts.set(franchiseId, (row.franchiseStarts.get(franchiseId) ?? 0) + 1);
                }
                row.seconds += seconds;
                row.points += line.points;
                row.fieldGoalsMade += line.fieldGoalsMade;
                row.fieldGoalsAttempted += line.fieldGoalsAttempted;
                row.freeThrowsMade += line.freeThrowsMade;
                row.freeThrowsAttempted += line.freeThrowsAttempted;
                row.offensiveRebounds += line.offensiveRebounds;
                row.defensiveRebounds += line.defensiveRebounds;
                row.assists += line.assists;
                row.steals += line.steals;
                row.blocks += line.blocks;
                row.turnovers += line.turnovers;
                row.fouls += line.fouls;
                if (shots > 0) {
                    leaguePoints += line.points;
                    leagueShots += shots;
                }
            }
            teamOf(franchiseId).seconds += lines.reduce((sum, line) => sum + line.seconds, 0);
        }
    }
    let defensiveRtgSum = 0;
    let defensiveRtgCount = 0;
    for (const facts of teamFacts.values()) {
        if (facts.possessions > 0) {
            defensiveRtgSum += (facts.pointsAgainst * 100) / facts.possessions;
            defensiveRtgCount += 1;
        }
    }
    const leagueAverageDefRtg = defensiveRtgCount > 0 ? defensiveRtgSum / defensiveRtgCount : 100;
    const leagueAverageTs = leagueShots > 0 ? leaguePoints / (2 * leagueShots) : 0.5;
    return { totals, leagueAverageTs, teamFacts, leagueAverageDefRtg };
}
function primaryFranchiseOf(row: PlayerTotals): string {
    let best = '';
    let bestAppearances = -1;
    let bestStarts = -1;
    for (const [franchiseId, appearances] of row.franchiseAppearances) {
        const starts = row.franchiseStarts.get(franchiseId) ?? 0;
        if (appearances > bestAppearances ||
            (appearances === bestAppearances && starts > bestStarts) ||
            (appearances === bestAppearances &&
                starts === bestStarts &&
                (best === '' || franchiseId < best))) {
            best = franchiseId;
            bestAppearances = appearances;
            bestStarts = starts;
        }
    }
    return best;
}
function availabilityFactorOf(row: PlayerTotals): number {
    return 0.75 + 0.25 * (row.appearances / SEASON_AWARD_FULL_SEASON_GAMES);
}
function mvpCompositeOf(facts: AwardsFacts, row: PlayerTotals): number {
    const values = mvpValuesOf(facts, row);
    const mean = row.appearances > 0 ? values.reduce((sum, value) => sum + value, 0) / row.appearances : 0;
    const stdDev = populationStdDev(values, mean);
    return (mean - CONSISTENCY_PENALTY * stdDev) * availabilityFactorOf(row);
}
function averageGameScoreOf(row: PlayerTotals): number {
    if (row.gameScores.length === 0)
        return 0;
    return row.gameScores.reduce((sum, value) => sum + value, 0) / row.gameScores.length;
}
function dpoyCompositeOf(facts: AwardsFacts, row: PlayerTotals, franchiseId: string): number {
    const production = defensiveProductionOf(row);
    const team = facts.teamFacts.get(franchiseId);
    const teamSeconds = team?.seconds ?? 0;
    const teamDefRtg = team === undefined || team.possessions === 0
        ? facts.leagueAverageDefRtg
        : (team.pointsAgainst * 100) / team.possessions;
    const minutesShare = teamSeconds > 0 ? row.seconds / teamSeconds : 0;
    const advantage = (facts.leagueAverageDefRtg - teamDefRtg) / 100;
    return (production + DPOY.advantage * advantage * minutesShare) * availabilityFactorOf(row);
}
function defensiveProductionOf(row: PlayerTotals): number {
    return ((DPOY.steal * row.steals +
        DPOY.block * row.blocks +
        DPOY.defensiveRebound * row.defensiveRebounds) /
        Math.max(1, row.appearances));
}
function eligibleFor(facts: AwardsFacts, row: PlayerTotals, franchiseId: string): boolean {
    const team = facts.teamFacts.get(franchiseId);
    const games = team === undefined ? 0 : team.gamesPlayed;
    const minimum = Math.ceil(SEASON_AWARD_MIN_GAME_SHARE * games);
    return row.appearances >= minimum;
}
interface AwardCandidate {
    row: PlayerTotals;
    franchiseId: string;
    score: number;
    primary: number;
}
function compareCandidates(a: AwardCandidate, b: AwardCandidate): number {
    if (b.score !== a.score)
        return b.score - a.score;
    if (b.primary !== a.primary)
        return b.primary - a.primary;
    if (b.row.seconds !== a.row.seconds)
        return b.row.seconds - a.row.seconds;
    return a.row.playerVersionId < b.row.playerVersionId
        ? -1
        : a.row.playerVersionId > b.row.playerVersionId
            ? 1
            : 0;
}
export function deriveSeasonAwards(input: SeasonAwardsInput): SeasonAwards {
    const facts = foldAwardsFacts(input);
    const candidates: AwardCandidate[] = [];
    for (const row of facts.totals.values()) {
        const franchiseId = primaryFranchiseOf(row);
        if (franchiseId === '' || row.appearances === 0)
            continue;
        candidates.push({
            row,
            franchiseId,
            score: mvpCompositeOf(facts, row),
            primary: averageGameScoreOf(row),
        });
    }
    if (candidates.length === 0) {
        throw new Error('awards: no player has any recorded appearance');
    }
    const eligible = candidates.filter((candidate) => eligibleFor(facts, candidate.row, candidate.franchiseId));
    const gatePool = eligible.length > 0 ? eligible : candidates;
    const mvp = winnerOf(gatePool);
    const dpoyPool = gatePool.map((candidate) => ({
        ...candidate,
        score: dpoyCompositeOf(facts, candidate.row, candidate.franchiseId),
        primary: defensiveProductionOf(candidate.row),
    }));
    const dpoy = winnerOf(dpoyPool);
    const benchQualified = (candidatesOf: readonly AwardCandidate[]) => candidatesOf.filter((candidate) => candidate.row.appearances - candidate.row.starts > candidate.row.starts);
    let sixthManPool = benchQualified(gatePool);
    if (sixthManPool.length === 0)
        sixthManPool = benchQualified(candidates);
    if (sixthManPool.length === 0)
        sixthManPool = gatePool;
    const sixthMan = winnerOf(sixthManPool);
    const firstTeam = [...gatePool].sort(compareCandidates).slice(0, 5);
    const recipientOf = (candidate: AwardCandidate) => ({
        playerVersionId: candidate.row.playerVersionId,
        franchiseId: candidate.franchiseId,
    });
    const awards: SeasonAwards = {
        schemaVersion: 1,
        awardsVersion: 'awards-v1',
        runId: input.runId,
        mvp: recipientOf(mvp),
        defensivePlayerOfYear: recipientOf(dpoy),
        sixthManOfYear: recipientOf(sixthMan),
        allLeagueFirstTeam: firstTeam.map(recipientOf),
        digest: '',
    };
    return { ...awards, digest: seasonAwardsDigest(awards) };
}
function winnerOf(candidates: readonly AwardCandidate[]): AwardCandidate {
    const ordered = [...candidates].sort(compareCandidates);
    const winner = ordered[0];
    if (winner === undefined) {
        throw new Error('awards: cannot select a winner without candidates');
    }
    return winner;
}
