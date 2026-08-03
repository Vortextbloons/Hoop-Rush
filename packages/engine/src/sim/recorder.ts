import type {
  GameResult,
  PlayerBoxScore,
  ShotZone,
  TeamBoxScore,
  ShotZoneSummary,
} from '@hoop-rush/data-contracts';
import { SHOT_ZONES } from '../domain/zones.js';

/**
 * Authoritative box-score recorder (spec/03). Every possession event flows
 * through this single stream: period scores, team totals, shot-zone facts,
 * and explanations are all derived from what the recorder accumulated.
 *
 * Accounting is keyed by team side plus player slot, never by player ID alone,
 * so mirror matchups (the same playerId on both teams) stay correct.
 *
 * The recorder also tracks the event opportunities behind every credited
 * stat (shot-zone splits, assist opportunities, rebound chances, contested
 * shots) so role behavior can be diagnosed and calibrated, not just asserted.
 */

export type SideIndex = 0 | 1;

export function createZoneCounters(): Record<ShotZone, number> {
  return { rim: 0, shortMid: 0, longMid: 0, cornerThree: 0, aboveBreakThree: 0 };
}

export interface RecorderPlayer {
  minutes: number;
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
  /** Field-goal attempts and makes by zone (diagnostics; free throws excluded). */
  zoneAttempts: Record<ShotZone, number>;
  zoneMakes: Record<ShotZone, number>;
  /** Made field goals on a passed possession where this player created the pass. */
  assistOpportunities: number;
  /** Missed shots while this player's team was on offense (OReb chance). */
  offensiveReboundChances: number;
  /** Missed shots while this player's team was on defense (DREb chance). */
  defensiveReboundChances: number;
  /** Field-goal attempts where this player was the primary defender. */
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
  /** Made field goals on passed possessions (diagnostics). */
  assistedFieldGoals: number;
  /** Made field goals on unassisted possessions (diagnostics). */
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
    zoneAttempts: { rim: 0, shortMid: 0, longMid: 0, cornerThree: 0, aboveBreakThree: 0 },
    zoneMakes: { rim: 0, shortMid: 0, longMid: 0, cornerThree: 0, aboveBreakThree: 0 },
    assistedFieldGoals: 0,
    unassistedFieldGoals: 0,
  };
}

export class GameRecorder {
  readonly players: [RecorderPlayer[], RecorderPlayer[]];
  readonly sides: [RecorderSide, RecorderSide];

  constructor(public readonly sideNames: [string, string]) {
    const makePlayers = (): RecorderPlayer[] =>
      Array.from({ length: 5 }, () => ({
        minutes: 0,
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
    this.players = [makePlayers(), makePlayers()];
    this.sides = [createRecorderSide(), createRecorderSide()];
  }

  /** Slot access with an explicit invariant: five players per side at all times. */
  private playerAt(side: SideIndex, slot: number): RecorderPlayer {
    const player = this.players[side][slot];
    if (player === undefined) {
      throw new Error(`recorder: no player at side ${String(side)} slot ${String(slot)}`);
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

  /** One made field goal on a passed possession by this player (diagnostics). */
  assistOpportunity(side: SideIndex, slot: number): void {
    this.playerAt(side, slot).assistOpportunities += 1;
  }

  /** Every missed shot gives each player on the offensive side an OReb chance. */
  offensiveReboundChance(side: SideIndex): void {
    for (const player of this.players[side]) player.offensiveReboundChances += 1;
  }

  /** Every missed shot gives each player on the defensive side a DREb chance. */
  defensiveReboundChance(side: SideIndex): void {
    for (const player of this.players[side]) player.defensiveReboundChances += 1;
  }

  /** One field-goal attempt defended by this player (diagnostics). */
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

  /** Advances to the next period; the last period's points are sealed. */
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
      playerId: `slot-${String(slot)}`,
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
      diagnostics: {
        usage: p.fieldGoalAttempts + p.freeThrowAttempts * 0.44 + p.turnovers,
        shotZones: zoneSummaryArray(p.zoneAttempts, p.zoneMakes),
        assistOpportunities: p.assistOpportunities,
        offensiveReboundChances: p.offensiveReboundChances,
        defensiveReboundChances: p.defensiveReboundChances,
        contestedShots: p.contestedShots,
      },
    };
  }

  teamBox(side: SideIndex, teamId: string): TeamBoxScore {
    const t = this.sides[side];
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
      diagnostics: {
        assistedFieldGoals: t.assistedFieldGoals,
        unassistedFieldGoals: t.unassistedFieldGoals,
        reboundOpportunities:
          t.fieldGoalAttempts - t.fieldGoalMakes + (t.freeThrowAttempts - t.freeThrowMakes),
        contestedShots: this.players[side].reduce((sum, p) => sum + p.contestedShots, 0),
      },
    };
  }

  zoneSummary(side: SideIndex): GameResult['home']['shotZones'] {
    const t = this.sides[side];
    return zoneSummaryArray(t.zoneAttempts, t.zoneMakes);
  }
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
