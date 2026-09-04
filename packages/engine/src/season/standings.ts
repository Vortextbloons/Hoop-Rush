import { SEASON_STANDINGS_VERSION, franchiseIdSchema, type SeasonGame, type SeasonLeague, type SeasonStandings, type SeasonStandingsRow, } from '@hoop-rush/data-contracts';
interface PlayedGame {
    game: SeasonGame;
    winner: string;
    loser: string;
    pointsFor: Map<string, number>;
    pointsAgainst: Map<string, number>;
}
function isForfeit(game: SeasonGame): boolean {
    return game.status === 'forfeit';
}
function playedGameOf(game: SeasonGame): PlayedGame {
    if (isForfeit(game)) {
        const loser = game.forfeitLoserFranchiseId;
        if (loser === null) {
            throw new Error(`forfeit game ${game.gameId} does not name the losing team`);
        }
        const winner = loser === game.homeFranchiseId ? game.awayFranchiseId : game.homeFranchiseId;
        return {
            game,
            winner,
            loser,
            pointsFor: new Map([
                [winner, 2],
                [loser, 0],
            ]),
            pointsAgainst: new Map([
                [winner, 0],
                [loser, 2],
            ]),
        };
    }
    const homeScore = game.homeScore;
    const awayScore = game.awayScore;
    if (homeScore === null || awayScore === null) {
        throw new Error(`final game ${game.gameId} carries no scores`);
    }
    if (homeScore === awayScore) {
        throw new Error(`final game ${game.gameId} is tied`);
    }
    const homeWon = homeScore > awayScore;
    return {
        game,
        winner: homeWon ? game.homeFranchiseId : game.awayFranchiseId,
        loser: homeWon ? game.awayFranchiseId : game.homeFranchiseId,
        pointsFor: new Map([
            [game.homeFranchiseId, homeScore],
            [game.awayFranchiseId, awayScore],
        ]),
        pointsAgainst: new Map([
            [game.homeFranchiseId, awayScore],
            [game.awayFranchiseId, homeScore],
        ]),
    };
}
export function reduceSeasonStandings(league: SeasonLeague, games: readonly SeasonGame[]): SeasonStandings {
    const teams = new Map(league.teams.map((team) => [team.franchiseId, team]));
    const franchiseIds = league.teams.map((team) => team.franchiseId);
    function emptyRow(franchiseId: string): SeasonStandingsRow {
        return {
            franchiseId: franchiseIdSchema.parse(franchiseId),
            wins: 0,
            losses: 0,
            gamesPlayed: 0,
            homeWins: 0,
            homeLosses: 0,
            awayWins: 0,
            awayLosses: 0,
            conferenceWins: 0,
            conferenceLosses: 0,
            divisionWins: 0,
            divisionLosses: 0,
            pointsFor: 0,
            pointsAgainst: 0,
            headToHead: franchiseIds
                .filter((other) => other !== franchiseId)
                .map((other) => ({ franchiseId: other, wins: 0, losses: 0 })),
        };
    }
    const rows = new Map<string, SeasonStandingsRow>();
    for (const franchiseId of franchiseIds) {
        rows.set(franchiseId, emptyRow(franchiseId));
    }
    for (const game of games) {
        if (game.status === 'scheduled')
            continue;
        const home = teams.get(game.homeFranchiseId);
        const away = teams.get(game.awayFranchiseId);
        if (home === undefined || away === undefined) {
            throw new Error(`game ${game.gameId} references a franchise outside the league`);
        }
        const played = playedGameOf(game);
        const winnerRow = rows.get(played.winner);
        const loserRow = rows.get(played.loser);
        if (winnerRow === undefined || loserRow === undefined) {
            throw new Error(`game ${game.gameId} references a franchise outside the league`);
        }
        winnerRow.wins += 1;
        loserRow.losses += 1;
        winnerRow.gamesPlayed += 1;
        loserRow.gamesPlayed += 1;
        const homeRow = game.homeFranchiseId === played.winner ? winnerRow : loserRow;
        const awayRow = game.awayFranchiseId === played.winner ? winnerRow : loserRow;
        if (game.homeFranchiseId === played.winner)
            homeRow.homeWins += 1;
        else
            homeRow.homeLosses += 1;
        if (game.awayFranchiseId === played.winner)
            awayRow.awayWins += 1;
        else
            awayRow.awayLosses += 1;
        if (home.conference === away.conference) {
            const confWinner = game.homeFranchiseId === played.winner ? homeRow : awayRow;
            const confLoser = game.homeFranchiseId === played.winner ? awayRow : homeRow;
            confWinner.conferenceWins += 1;
            confLoser.conferenceLosses += 1;
            if (home.division === away.division) {
                confWinner.divisionWins += 1;
                confLoser.divisionLosses += 1;
            }
        }
        const forPoints = played.pointsFor;
        const againstPoints = played.pointsAgainst;
        for (const row of [winnerRow, loserRow]) {
            row.pointsFor += forPoints.get(row.franchiseId) ?? 0;
            row.pointsAgainst += againstPoints.get(row.franchiseId) ?? 0;
        }
        const winnerHeadToHead = winnerRow.headToHead.find((entry) => entry.franchiseId === played.loser);
        const loserHeadToHead = loserRow.headToHead.find((entry) => entry.franchiseId === played.winner);
        if (winnerHeadToHead === undefined || loserHeadToHead === undefined) {
            throw new Error(`game ${game.gameId} has no head-to-head slot for its participants`);
        }
        winnerHeadToHead.wins += 1;
        loserHeadToHead.losses += 1;
    }
    const reduced = league.teams.map((team) => {
        const row = rows.get(team.franchiseId);
        if (row === undefined)
            throw new Error(`missing standings row for ${team.franchiseId}`);
        return row;
    });
    return {
        schemaVersion: 1,
        standingsVersion: SEASON_STANDINGS_VERSION,
        rows: reduced,
    };
}
export function auditSeasonStandings(league: SeasonLeague, games: readonly SeasonGame[], standings: SeasonStandings): string[] {
    const failures: string[] = [];
    const teamIds = new Set(league.teams.map((team) => team.franchiseId));
    const rowIds = new Set(standings.rows.map((row) => row.franchiseId));
    if (rowIds.size !== league.teams.length) {
        failures.push('standings must contain one row per franchise');
        return failures;
    }
    for (const row of standings.rows) {
        if (!teamIds.has(row.franchiseId)) {
            failures.push(`standings row ${row.franchiseId} is not a league franchise`);
            return failures;
        }
    }
    if (rowIds.size !== standings.rows.length) {
        failures.push('standings rows must be unique');
    }
    const expected = reduceSeasonStandings(league, games);
    const expectedByTeam = new Map(expected.rows.map((row) => [row.franchiseId, row]));
    for (const row of standings.rows) {
        const want = expectedByTeam.get(row.franchiseId);
        if (want === undefined) {
            failures.push(`no expected row for ${row.franchiseId}`);
            continue;
        }
        if (row.wins !== want.wins)
            failures.push(`${row.franchiseId} wins: expected ${String(want.wins)} got ${String(row.wins)}`);
        if (row.losses !== want.losses)
            failures.push(`${row.franchiseId} losses: expected ${String(want.losses)} got ${String(row.losses)}`);
        if (row.gamesPlayed !== want.gamesPlayed) {
            failures.push(`${row.franchiseId} gamesPlayed: expected ${String(want.gamesPlayed)} got ${String(row.gamesPlayed)}`);
        }
        if (row.homeWins !== want.homeWins)
            failures.push(`${row.franchiseId} homeWins: expected ${String(want.homeWins)} got ${String(row.homeWins)}`);
        if (row.homeLosses !== want.homeLosses)
            failures.push(`${row.franchiseId} homeLosses: expected ${String(want.homeLosses)} got ${String(row.homeLosses)}`);
        if (row.awayWins !== want.awayWins)
            failures.push(`${row.franchiseId} awayWins: expected ${String(want.awayWins)} got ${String(row.awayWins)}`);
        if (row.awayLosses !== want.awayLosses)
            failures.push(`${row.franchiseId} awayLosses: expected ${String(want.awayLosses)} got ${String(row.awayLosses)}`);
        if (row.conferenceWins !== want.conferenceWins)
            failures.push(`${row.franchiseId} conferenceWins: expected ${String(want.conferenceWins)} got ${String(row.conferenceWins)}`);
        if (row.conferenceLosses !== want.conferenceLosses)
            failures.push(`${row.franchiseId} conferenceLosses: expected ${String(want.conferenceLosses)} got ${String(row.conferenceLosses)}`);
        if (row.divisionWins !== want.divisionWins)
            failures.push(`${row.franchiseId} divisionWins: expected ${String(want.divisionWins)} got ${String(row.divisionWins)}`);
        if (row.divisionLosses !== want.divisionLosses)
            failures.push(`${row.franchiseId} divisionLosses: expected ${String(want.divisionLosses)} got ${String(row.divisionLosses)}`);
        if (row.pointsFor !== want.pointsFor)
            failures.push(`${row.franchiseId} pointsFor: expected ${String(want.pointsFor)} got ${String(row.pointsFor)}`);
        if (row.pointsAgainst !== want.pointsAgainst) {
            failures.push(`${row.franchiseId} pointsAgainst: expected ${String(want.pointsAgainst)} got ${String(row.pointsAgainst)}`);
        }
        for (const wantH2h of want.headToHead) {
            const gotH2h = row.headToHead.find((entry) => entry.franchiseId === wantH2h.franchiseId);
            if (gotH2h === undefined) {
                failures.push(`${row.franchiseId} head-to-head misses ${wantH2h.franchiseId}`);
                continue;
            }
            if (gotH2h.wins !== wantH2h.wins) {
                failures.push(`${row.franchiseId} head-to-head vs ${wantH2h.franchiseId} wins: expected ${String(wantH2h.wins)} got ${String(gotH2h.wins)}`);
            }
            if (gotH2h.losses !== wantH2h.losses) {
                failures.push(`${row.franchiseId} head-to-head vs ${wantH2h.franchiseId} losses: expected ${String(wantH2h.losses)} got ${String(gotH2h.losses)}`);
            }
        }
        if (row.gamesPlayed !== row.wins + row.losses) {
            failures.push(`${row.franchiseId} gamesPlayed must equal wins plus losses`);
        }
        if (row.wins !== row.homeWins + row.awayWins ||
            row.losses !== row.homeLosses + row.awayLosses) {
            failures.push(`${row.franchiseId} home/away splits must reconcile with wins and losses`);
        }
        if (row.divisionWins > row.conferenceWins || row.divisionLosses > row.conferenceLosses) {
            failures.push(`${row.franchiseId} division record must not exceed conference record`);
        }
    }
    const gamesPlayed = new Map<string, number>();
    for (const row of standings.rows)
        gamesPlayed.set(row.franchiseId, 0);
    for (const game of games) {
        if (game.status === 'scheduled')
            continue;
        gamesPlayed.set(game.homeFranchiseId, (gamesPlayed.get(game.homeFranchiseId) ?? 0) + 1);
        gamesPlayed.set(game.awayFranchiseId, (gamesPlayed.get(game.awayFranchiseId) ?? 0) + 1);
    }
    for (const [franchiseId, count] of gamesPlayed) {
        const row = standings.rows.find((entry) => entry.franchiseId === franchiseId);
        if (row !== undefined && row.gamesPlayed !== count) {
            failures.push(`${franchiseId} gamesPlayed must match finalized game records`);
        }
    }
    const totalWins = standings.rows.reduce((sum, row) => sum + row.wins, 0);
    const totalLosses = standings.rows.reduce((sum, row) => sum + row.losses, 0);
    if (totalWins !== totalLosses) {
        failures.push(`league wins (${String(totalWins)}) must equal league losses (${String(totalLosses)})`);
    }
    return failures;
}
