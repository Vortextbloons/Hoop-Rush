import { describe, expect, it } from 'bun:test';
import {
  CAP_RUSH_CONFERENCE_GAMES,
  CAP_RUSH_CONFERENCE_SIZE,
  CAP_RUSH_DIVISION_TEAMS,
  CAP_RUSH_FRANCHISE_ALIGNMENT,
  CAP_RUSH_TAKEOVER_TEAMS,
  capRushAlignmentOf,
} from '@hoop-rush/data-contracts';
import {
  buildCapRushLeagueSchedule,
  capRushAssignFranchise,
  capRushUserScheduleOf,
  validateCapRushLeagueSchedule,
  type CapRushLeagueField,
} from './league-schedule.ts';

const NAMES: Record<string, string> = {
  celtics: 'Boston Celtics',
  nets: 'Brooklyn Nets',
  knicks: 'New York Knicks',
  sixers: 'Philadelphia 76ers',
  raptors: 'Toronto Raptors',
  bulls: 'Chicago Bulls',
  cavaliers: 'Cleveland Cavaliers',
  pistons: 'Detroit Pistons',
  pacers: 'Indiana Pacers',
  bucks: 'Milwaukee Bucks',
  hawks: 'Atlanta Hawks',
  hornets: 'Charlotte Hornets',
  heat: 'Miami Heat',
  magic: 'Orlando Magic',
  wizards: 'Washington Wizards',
  nuggets: 'Denver Nuggets',
  timberwolves: 'Minnesota Timberwolves',
  thunder: 'Oklahoma City Thunder',
  blazers: 'Portland Trail Blazers',
  jazz: 'Utah Jazz',
  warriors: 'Golden State Warriors',
  clippers: 'LA Clippers',
  lakers: 'Los Angeles Lakers',
  suns: 'Phoenix Suns',
  kings: 'Sacramento Kings',
  mavericks: 'Dallas Mavericks',
  rockets: 'Houston Rockets',
  grizzlies: 'Memphis Grizzlies',
  pelicans: 'New Orleans Pelicans',
  spurs: 'San Antonio Spurs',
};

const FIELD: CapRushLeagueField[] = CAP_RUSH_FRANCHISE_ALIGNMENT.map((entry) => ({
  teamId: entry.franchiseId,
  displayName: NAMES[entry.franchiseId] ?? entry.franchiseId,
}));

function pairKey(left: string, right: string): string {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

describe('cap rush conference schedule', () => {
  it('builds a complete 82-game, 1,230-game field for a fixed seed', () => {
    const seed = '1111111111111111';
    const schedule = buildCapRushLeagueSchedule({ runSeed: seed as never, field: FIELD });
    expect(schedule.games).toHaveLength(CAP_RUSH_CONFERENCE_GAMES);
    expect(validateCapRushLeagueSchedule(schedule.games, FIELD)).toEqual([]);

    const pairs = new Map<string, number>();
    const home = new Map<string, number>();
    const away = new Map<string, number>();
    const slots = new Map<number, Set<string>>();
    for (const game of schedule.games) {
      pairs.set(
        pairKey(game.homeTeamId, game.awayTeamId),
        (pairs.get(pairKey(game.homeTeamId, game.awayTeamId)) ?? 0) + 1,
      );
      home.set(game.homeTeamId, (home.get(game.homeTeamId) ?? 0) + 1);
      away.set(game.awayTeamId, (away.get(game.awayTeamId) ?? 0) + 1);
      const slot = slots.get(game.slot) ?? new Set<string>();
      slot.add(game.homeTeamId);
      slot.add(game.awayTeamId);
      slots.set(game.slot, slot);
    }
    expect(home.size).toBe(CAP_RUSH_TAKEOVER_TEAMS);
    for (const team of FIELD) {
      expect(home.get(team.teamId)).toBe(41);
      expect(away.get(team.teamId)).toBe(41);
    }
    for (let slot = 1; slot <= 82; slot += 1) {
      expect(slots.get(slot)?.size).toBe(CAP_RUSH_TAKEOVER_TEAMS);
    }
    const distribution = new Map<number, number>();
    for (const count of pairs.values()) {
      distribution.set(count, (distribution.get(count) ?? 0) + 1);
    }
    expect(distribution.get(2)).toBe(15 * 15);
    expect(distribution.get(3)).toBe(60);
    expect(distribution.get(4)).toBe(150);

    for (const team of FIELD) {
      const alignment = capRushAlignmentOf(team.teamId);
      let divisionGames = 0;
      let conferenceGames = 0;
      let oppositeGames = 0;
      for (const [key, count] of pairs) {
        const [left, right] = key.split('|');
        if (left === undefined || right === undefined) continue;
        if (left !== team.teamId && right !== team.teamId) continue;
        const other = left === team.teamId ? right : left;
        const otherAlignment = capRushAlignmentOf(other);
        if (otherAlignment.division === alignment.division) divisionGames += count;
        else if (otherAlignment.conference === alignment.conference) conferenceGames += count;
        else oppositeGames += count;
      }
      expect(divisionGames).toBe(16);
      expect(conferenceGames).toBe(36);
      expect(oppositeGames).toBe(30);
    }
  });

  it('assigns one franchise per run and one user game per slot', () => {
    for (const seed of ['1111111111111111', '2222222222222222', '3333333333333333']) {
      const assignment = capRushAssignFranchise({ runSeed: seed as never, field: FIELD });
      expect(assignment.conference).toBe(capRushAlignmentOf(assignment.franchiseId).conference);
      expect(assignment.division).toBe(capRushAlignmentOf(assignment.franchiseId).division);
      const schedule = buildCapRushLeagueSchedule({ runSeed: seed as never, field: FIELD });
      const user = capRushUserScheduleOf({
        games: schedule.games,
        userTeamId: assignment.franchiseId,
      });
      expect(user).toHaveLength(82);
      user.forEach((game, index) => {
        expect(game.gameNumber).toBe(index + 1);
        expect(game.opponentId).not.toBe(assignment.franchiseId);
      });
    }
  });

  it('simulates fourteen background games in every user slot', () => {
    const seed = '4444444444444444';
    const schedule = buildCapRushLeagueSchedule({ runSeed: seed as never, field: FIELD });
    const assignment = capRushAssignFranchise({ runSeed: seed as never, field: FIELD });
    const bySlot = new Map<number, number>();
    for (const game of schedule.games) {
      if (
        game.homeTeamId === assignment.franchiseId ||
        game.awayTeamId === assignment.franchiseId
      ) {
        continue;
      }
      bySlot.set(game.slot, (bySlot.get(game.slot) ?? 0) + 1);
    }
    expect(bySlot.size).toBe(82);
    for (let slot = 1; slot <= 82; slot += 1) expect(bySlot.get(slot)).toBe(14);
    expect(CAP_RUSH_CONFERENCE_SIZE).toBe(15);
    expect(Object.keys(CAP_RUSH_DIVISION_TEAMS)).toHaveLength(6);
  });
});
