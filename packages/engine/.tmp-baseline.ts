import { CAP_RUSH_FRANCHISE_ALIGNMENT } from '@hoop-rush/data-contracts';
import {
  buildCapRushLeagueSchedule,
  capRushAssignFranchise,
  validateCapRushLeagueSchedule,
} from './src/modes/cap-rush/league-schedule.ts';
import { buildCapRushConferenceStandings } from './src/modes/cap-rush/conference-standings.ts';
import { capRushConferenceOpeningSeries } from './src/modes/cap-rush/conference-postseason.ts';
import { capRushNextPlayoffGamePlan } from './src/modes/cap-rush/playoff-shared.ts';

const field = CAP_RUSH_FRANCHISE_ALIGNMENT.map((entry) => ({
  teamId: entry.franchiseId,
  displayName: entry.franchiseId,
}));
for (const seed of ['1111111111111111', '2222222222222222', '4444444444444444']) {
  const assignment = capRushAssignFranchise({ runSeed: seed, field });
  const schedule = buildCapRushLeagueSchedule({ runSeed: seed, field });
  console.log(
    seed,
    assignment.franchiseId,
    schedule.games.length,
    Bun.hash(JSON.stringify(schedule.games)).toString(16),
    validateCapRushLeagueSchedule(schedule.games, field).length,
  );
}

const schedule = buildCapRushLeagueSchedule({ runSeed: '9999999999999999', field });
const standings = buildCapRushConferenceStandings({
  teams: field.map((team) => ({ ...team, isUserTeam: team.teamId === 'celtics' })),
  games: schedule.games.map((game) => ({
    gameId: game.gameId,
    homeTeamId: game.homeTeamId,
    awayTeamId: game.awayTeamId,
    homePoints: 100,
    awayPoints: 90,
  })),
});
console.log('standings', Bun.hash(JSON.stringify(standings)).toString(16));
const opening = capRushConferenceOpeningSeries(standings);
console.log('opening', Bun.hash(JSON.stringify(opening)).toString(16));
const plan = capRushNextPlayoffGamePlan({
  series: opening[0]!,
  runSeed: '9999999999999999',
  userTeamId: 'celtics',
});
console.log('plan', Bun.hash(JSON.stringify(plan)).toString(16), plan);
