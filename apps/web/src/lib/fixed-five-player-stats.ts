import type {
  FixedFiveRoomMode,
  FixedFiveWorkerResultEntry,
  PlayerBoxScore,
} from '@hoop-rush/data-contracts';

export interface FixedFivePlayerStatLine {
  playerId: string;
  games: number;
  minutes: number;
  points: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  threesMade: number;
  threesAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  rebounds: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
}

export interface FixedFivePlayerStats {
  p1: FixedFivePlayerStatLine[];
  p2: FixedFivePlayerStatLine[];
}

function blankLine(playerId: string): FixedFivePlayerStatLine {
  return {
    playerId,
    games: 0,
    minutes: 0,
    points: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threesMade: 0,
    threesAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    rebounds: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
  };
}

function addBox(line: FixedFivePlayerStatLine, box: PlayerBoxScore): void {
  line.games += 1;
  line.minutes += box.minutes;
  line.points += box.points;
  line.fieldGoalsMade += box.fieldGoals.made;
  line.fieldGoalsAttempted += box.fieldGoals.attempted;
  line.threesMade += box.threes.made;
  line.threesAttempted += box.threes.attempted;
  line.freeThrowsMade += box.freeThrows.made;
  line.freeThrowsAttempted += box.freeThrows.attempted;
  line.rebounds += box.rebounds.total;
  line.offensiveRebounds += box.rebounds.offensive;
  line.defensiveRebounds += box.rebounds.defensive;
  line.assists += box.assists;
  line.steals += box.steals;
  line.blocks += box.blocks;
  line.turnovers += box.turnovers;
  line.fouls += box.fouls;
}

function accumulate(target: Map<string, FixedFivePlayerStatLine>, boxes: PlayerBoxScore[]): void {
  for (const box of boxes) {
    let line = target.get(box.playerId);
    if (!line) {
      line = blankLine(box.playerId);
      target.set(box.playerId, line);
    }
    addBox(line, box);
  }
}

export function aggregateFixedFivePlayerStats(
  mode: FixedFiveRoomMode,
  entries: FixedFiveWorkerResultEntry[],
  p1TeamId = 'p1',
  p2TeamId = 'p2',
): FixedFivePlayerStats {
  const p1 = new Map<string, FixedFivePlayerStatLine>();
  const p2 = new Map<string, FixedFivePlayerStatLine>();
  for (const entry of entries) {
    const game = entry.game;
    if (mode === 'duel') {
      if (entry.tag !== 'duel') continue;
      if (game.home.teamId === p1TeamId) {
        accumulate(p1, game.home.players);
        accumulate(p2, game.away.players);
      } else if (game.home.teamId === p2TeamId) {
        accumulate(p2, game.home.players);
        accumulate(p1, game.away.players);
      }
      continue;
    }
    if (entry.tag === 'p1') {
      accumulate(p1, game.home.players);
    } else if (entry.tag === 'p2') {
      accumulate(p2, game.home.players);
    } else if (entry.tag === 'h2h') {
      accumulate(p1, game.home.players);
      accumulate(p2, game.away.players);
    }
  }
  return { p1: [...p1.values()], p2: [...p2.values()] };
}
