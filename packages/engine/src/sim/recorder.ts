import type {
  GameResult,
  PlayerBoxScore,
  PlayerDiagnostics,
  ShotZone,
  TeamBoxScore,
  TeamDiagnostics,
  ShotZoneSummary,
} from '@hoop-rush/data-contracts';
import { playerIdSchema } from '@hoop-rush/data-contracts';
import { SHOT_ZONES } from '../domain/zones.ts';
export function usageOf(fga: number, fta: number, tov: number): number {
  return fga + fta * 0.44 + tov;
}
export type SideIndex = 0 | 1;
export function createZoneCounters(): Record<ShotZone, number> {
  return { rim: 0, shortMid: 0, longMid: 0, cornerThree: 0, aboveBreakThree: 0 };
}
export interface RecorderPlayer {
  minutes: number;
  seconds: number;
  points: number;
  fieldGoalMakes: number;
  fieldGoalAttempts: number;
  threeMakes: number;
  threeAttempts: number;
  freeThrowMakes: number;
  freeThrowAttempts: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  zoneAttempts: Record<ShotZone, number>;
  zoneMakes: Record<ShotZone, number>;
  assistOpportunities: number;
  offensiveReboundChances: number;
  defensiveReboundChances: number;
  contestedShots: number;
}
export interface RecorderSide {
  points: number;
  fieldGoalMakes: number;
  fieldGoalAttempts: number;
  threeMakes: number;
  threeAttempts: number;
  freeThrowMakes: number;
  freeThrowAttempts: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  teamRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  possessions: number;
  freeThrowTrips: number;
  periodPoints: number[];
  zoneAttempts: Record<ShotZone, number>;
  zoneMakes: Record<ShotZone, number>;
  assistedFieldGoals: number;
  unassistedFieldGoals: number;
}
export function createRecorderSide(): RecorderSide {
  return {
    points: 0,
    fieldGoalMakes: 0,
    fieldGoalAttempts: 0,
    threeMakes: 0,
    threeAttempts: 0,
    freeThrowMakes: 0,
    freeThrowAttempts: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    teamRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    possessions: 0,
    freeThrowTrips: 0,
    periodPoints: [0],
    zoneAttempts: createZoneCounters(),
    zoneMakes: createZoneCounters(),
    assistedFieldGoals: 0,
    unassistedFieldGoals: 0,
  };
}
export class GameRecorder {
  readonly players: [RecorderPlayer[], RecorderPlayer[]];
  readonly sides: [RecorderSide, RecorderSide];
  private readonly activeSlots: [number[], number[]];
  constructor(rosterSize: number | [number, number] = 5) {
    const sizes: [number, number] =
      typeof rosterSize === 'number' ? [rosterSize, rosterSize] : rosterSize;
    const makePlayers = (count: number): RecorderPlayer[] =>
      Array.from({ length: count }, () => ({
        minutes: 0,
        seconds: 0,
        points: 0,
        fieldGoalMakes: 0,
        fieldGoalAttempts: 0,
        threeMakes: 0,
        threeAttempts: 0,
        freeThrowMakes: 0,
        freeThrowAttempts: 0,
        offensiveRebounds: 0,
        defensiveRebounds: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
        zoneAttempts: createZoneCounters(),
        zoneMakes: createZoneCounters(),
        assistOpportunities: 0,
        offensiveReboundChances: 0,
        defensiveReboundChances: 0,
        contestedShots: 0,
      }));
    const identitySlots = (size: number): number[] => Array.from({ length: size }, (_, i) => i);
    this.players = [makePlayers(sizes[0]), makePlayers(sizes[1])];
    this.sides = [createRecorderSide(), createRecorderSide()];
    this.activeSlots = [identitySlots(5), identitySlots(5)];
  }
  setActiveFive(side: SideIndex, rosterIndices: readonly number[]): void {
    if (rosterIndices.length !== 5) {
      throw new Error(`recorder: active five must have exactly five slots`);
    }
    const seen = new Set<number>();
    for (const index of rosterIndices) {
      if (index < 0 || index >= this.players[side].length) {
        throw new Error(`recorder: roster index ${String(index)} out of range`);
      }
      if (seen.has(index)) {
        throw new Error(`recorder: duplicate roster index ${String(index)} in active five`);
      }
      seen.add(index);
    }
    this.activeSlots[side] = [...rosterIndices];
  }
  playSeconds(side: SideIndex, rosterIndex: number, seconds: number): void {
    this.playerAtRosterIndex(side, rosterIndex).seconds += seconds;
  }
  private playerAt(side: SideIndex, slot: number): RecorderPlayer {
    const active = this.activeSlots[side][slot];
    if (active === undefined) {
      throw new Error(`recorder: no active player at side ${String(side)} slot ${String(slot)}`);
    }
    return this.playerAtRosterIndex(side, active);
  }
  private playerAtRosterIndex(side: SideIndex, rosterIndex: number): RecorderPlayer {
    const player = this.players[side][rosterIndex];
    if (player === undefined) {
      throw new Error(
        `recorder: no roster player at side ${String(side)} index ${String(rosterIndex)}`,
      );
    }
    return player;
  }
  fieldGoalAttempt(
    side: SideIndex,
    slot: number,
    zone: ShotZone,
    made: boolean,
    three: boolean,
    assisted: boolean,
  ): void {
    const player = this.playerAt(side, slot);
    const team = this.sides[side];
    player.fieldGoalAttempts += 1;
    team.fieldGoalAttempts += 1;
    player.zoneAttempts[zone] += 1;
    team.zoneAttempts[zone] += 1;
    if (made) {
      player.fieldGoalMakes += 1;
      team.fieldGoalMakes += 1;
      player.zoneMakes[zone] += 1;
      team.zoneMakes[zone] += 1;
      if (assisted) team.assistedFieldGoals += 1;
      else team.unassistedFieldGoals += 1;
      const points = three ? 3 : 2;
      player.points += points;
      team.points += points;
      const lastPeriod = team.periodPoints.length - 1;
      team.periodPoints[lastPeriod] = (team.periodPoints[lastPeriod] ?? 0) + points;
    }
    if (three) {
      player.threeAttempts += 1;
      team.threeAttempts += 1;
      if (made) {
        player.threeMakes += 1;
        team.threeMakes += 1;
      }
    }
  }
  freeThrow(side: SideIndex, slot: number, made: boolean): void {
    const player = this.playerAt(side, slot);
    const team = this.sides[side];
    player.freeThrowAttempts += 1;
    team.freeThrowAttempts += 1;
    if (made) {
      player.freeThrowMakes += 1;
      team.freeThrowMakes += 1;
      player.points += 1;
      team.points += 1;
      const lastPeriod = team.periodPoints.length - 1;
      team.periodPoints[lastPeriod] = (team.periodPoints[lastPeriod] ?? 0) + 1;
    }
  }
  offensiveRebound(side: SideIndex, slot: number): void {
    const player = this.playerAt(side, slot);
    const team = this.sides[side];
    player.offensiveRebounds += 1;
    team.offensiveRebounds += 1;
  }
  defensiveRebound(side: SideIndex, slot: number): void {
    const player = this.playerAt(side, slot);
    const team = this.sides[side];
    player.defensiveRebounds += 1;
    team.defensiveRebounds += 1;
  }
  teamRebound(side: SideIndex): void {
    this.sides[side].teamRebounds += 1;
  }
  assistOpportunity(side: SideIndex, slot: number): void {
    this.playerAt(side, slot).assistOpportunities += 1;
  }
  offensiveReboundChance(side: SideIndex): void {
    for (const active of this.activeSlots[side]) {
      const player = this.playerAtRosterIndex(side, active);
      player.offensiveReboundChances += 1;
    }
  }
  defensiveReboundChance(side: SideIndex): void {
    for (const active of this.activeSlots[side]) {
      const player = this.playerAtRosterIndex(side, active);
      player.defensiveReboundChances += 1;
    }
  }
  contest(side: SideIndex, slot: number): void {
    this.playerAt(side, slot).contestedShots += 1;
  }
  assist(side: SideIndex, slot: number): void {
    this.playerAt(side, slot).assists += 1;
    this.sides[side].assists += 1;
  }
  steal(side: SideIndex, slot: number): void {
    this.playerAt(side, slot).steals += 1;
    this.sides[side].steals += 1;
  }
  block(side: SideIndex, slot: number): void {
    this.playerAt(side, slot).blocks += 1;
    this.sides[side].blocks += 1;
  }
  turnover(side: SideIndex, slot: number): void {
    this.playerAt(side, slot).turnovers += 1;
    this.sides[side].turnovers += 1;
  }
  foul(side: SideIndex, slot: number): void {
    this.playerAt(side, slot).fouls += 1;
    this.sides[side].fouls += 1;
  }
  possession(side: SideIndex): void {
    this.sides[side].possessions += 1;
  }
  freeThrowTrip(side: SideIndex): void {
    this.sides[side].freeThrowTrips += 1;
  }
  nextPeriod(): void {
    this.sides[0].periodPoints.push(0);
    this.sides[1].periodPoints.push(0);
  }
  assignMinutes(minutesPerPlayer: number): void {
    for (const side of this.players) {
      for (const player of side) player.minutes = minutesPerPlayer;
    }
  }
  playerBox(side: SideIndex, slot: number): PlayerBoxScore {
    const p = this.playerAt(side, slot);
    return {
      playerId: playerIdSchema.parse(`slot-${String(slot)}`),
      minutes: p.minutes,
      points: p.points,
      fieldGoals: { made: p.fieldGoalMakes, attempted: p.fieldGoalAttempts },
      threes: { made: p.threeMakes, attempted: p.threeAttempts },
      freeThrows: { made: p.freeThrowMakes, attempted: p.freeThrowAttempts },
      rebounds: {
        total: p.offensiveRebounds + p.defensiveRebounds,
        offensive: p.offensiveRebounds,
        defensive: p.defensiveRebounds,
      },
      assists: p.assists,
      steals: p.steals,
      blocks: p.blocks,
      turnovers: p.turnovers,
      fouls: p.fouls,
      diagnostics: playerDiagnostics(p),
    };
  }
  seasonPlayerBox(
    side: SideIndex,
    rosterIndex: number,
  ): {
    seconds: number;
    minutes: number;
    points: number;
    fieldGoals: {
      made: number;
      attempted: number;
    };
    threes: {
      made: number;
      attempted: number;
    };
    freeThrows: {
      made: number;
      attempted: number;
    };
    rebounds: {
      total: number;
      offensive: number;
      defensive: number;
    };
    assists: number;
    steals: number;
    blocks: number;
    turnovers: number;
    fouls: number;
    diagnostics: PlayerDiagnostics;
  } {
    const p = this.playerAtRosterIndex(side, rosterIndex);
    return {
      seconds: p.seconds,
      minutes: p.seconds / 60,
      points: p.points,
      fieldGoals: { made: p.fieldGoalMakes, attempted: p.fieldGoalAttempts },
      threes: { made: p.threeMakes, attempted: p.threeAttempts },
      freeThrows: { made: p.freeThrowMakes, attempted: p.freeThrowAttempts },
      rebounds: {
        total: p.offensiveRebounds + p.defensiveRebounds,
        offensive: p.offensiveRebounds,
        defensive: p.defensiveRebounds,
      },
      assists: p.assists,
      steals: p.steals,
      blocks: p.blocks,
      turnovers: p.turnovers,
      fouls: p.fouls,
      diagnostics: playerDiagnostics(p),
    };
  }
  seasonTeamBox(
    side: SideIndex,
    teamId: string,
  ): Omit<TeamBoxScore, 'diagnostics'> & {
    diagnostics: TeamDiagnostics;
  } {
    return {
      ...buildTeamBoxBase(this.sides[side], teamId),
      diagnostics: teamDiagnostics(this.sides[side], this.players[side]),
    };
  }
  teamBox(side: SideIndex, teamId: string): TeamBoxScore {
    return {
      ...buildTeamBoxBase(this.sides[side], teamId),
      diagnostics: teamDiagnostics(this.sides[side], this.players[side]),
    };
  }
  zoneSummary(side: SideIndex): GameResult['home']['shotZones'] {
    const t = this.sides[side];
    return zoneSummaryArray(t.zoneAttempts, t.zoneMakes);
  }
}
function buildTeamBoxBase(t: RecorderSide, teamId: string): Omit<TeamBoxScore, 'diagnostics'> {
  return {
    teamId,
    points: t.points,
    fieldGoals: { made: t.fieldGoalMakes, attempted: t.fieldGoalAttempts },
    threes: { made: t.threeMakes, attempted: t.threeAttempts },
    freeThrows: { made: t.freeThrowMakes, attempted: t.freeThrowAttempts },
    rebounds: {
      total: t.offensiveRebounds + t.defensiveRebounds + t.teamRebounds,
      offensive: t.offensiveRebounds,
      defensive: t.defensiveRebounds,
      team: t.teamRebounds,
    },
    assists: t.assists,
    steals: t.steals,
    blocks: t.blocks,
    turnovers: t.turnovers,
    fouls: t.fouls,
    possessions: t.possessions,
  };
}
function teamDiagnostics(t: RecorderSide, players: readonly RecorderPlayer[]): TeamDiagnostics {
  return {
    assistedFieldGoals: t.assistedFieldGoals,
    unassistedFieldGoals: t.unassistedFieldGoals,
    reboundOpportunities:
      t.fieldGoalAttempts - t.fieldGoalMakes + (t.freeThrowAttempts - t.freeThrowMakes),
    contestedShots: players.reduce((sum, player) => sum + player.contestedShots, 0),
  };
}
function zoneSummaryArray(
  attempts: Record<ShotZone, number>,
  makes: Record<ShotZone, number>,
): ShotZoneSummary[] {
  return SHOT_ZONES.map((zone) => ({
    zone,
    attempts: attempts[zone],
    makes: makes[zone],
  }));
}
function playerDiagnostics(p: RecorderPlayer): PlayerDiagnostics {
  return {
    usage: usageOf(p.fieldGoalAttempts, p.freeThrowAttempts, p.turnovers),
    shotZones: zoneSummaryArray(p.zoneAttempts, p.zoneMakes),
    assistOpportunities: p.assistOpportunities,
    offensiveReboundChances: p.offensiveReboundChances,
    defensiveReboundChances: p.defensiveReboundChances,
    contestedShots: p.contestedShots,
  };
}
