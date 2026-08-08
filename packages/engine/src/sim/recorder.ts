import type {
  GameResult,
  PlayerBoxScore,
  PlayerDiagnostics,
  ShotZone,
  TeamBoxScore,
  TeamDiagnostics,
  ShotZoneSummary,
} from '@hoop-rush/data-contracts';
import { SHOT_ZONES } from '../domain/zones.ts';

/** Usage identity FGA + 0.44*FTA + TOV (spec/03 diagnostics, invariant-checked). */
export function usageOf(fga: number, fta: number, tov: number): number {
  return fga + fta * 0.44 + tov;
}

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
  /** Exact on-court seconds (Season Run; integer accumulation per stint). */
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
  /** Per-side roster records: five slots for Classic, ten for Season Run. */
  readonly players: [RecorderPlayer[], RecorderPlayer[]];
  readonly sides: [RecorderSide, RecorderSide];
  /**
   * Active-five translation (Season Run): `activeSlots[side][i]` is the
   * roster index on the floor for active slot `i`. Classic keeps the identity
   * mapping 0..4, so every event method behaves byte-identically.
   */
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
    // The active five is always five slots; Season Run re-points them per
    // substitution, Classic keeps the identity mapping.
    this.activeSlots = [identitySlots(5), identitySlots(5)];
  }

  /**
   * Active-five translation (Season Run): rewires a side's five on-court
   * slots to the given ten-roster indices. Classic never calls this, so the
   * identity mapping stays and all accounting is byte-identical.
   */
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

  /** Exact integer on-court seconds for one ten-roster record (Season Run). */
  playSeconds(side: SideIndex, rosterIndex: number, seconds: number): void {
    this.playerAtRosterIndex(side, rosterIndex).seconds += seconds;
  }

  /** Slot access with an explicit invariant: five players per side at all times. */
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

  /** One made field goal on a passed possession by this player (diagnostics). */
  assistOpportunity(side: SideIndex, slot: number): void {
    this.playerAt(side, slot).assistOpportunities += 1;
  }

  /** Every missed shot gives each player on the offensive side an OReb chance. */
  offensiveReboundChance(side: SideIndex): void {
    for (const active of this.activeSlots[side]) {
      const player = this.playerAtRosterIndex(side, active);
      player.offensiveReboundChances += 1;
    }
  }

  /** Every missed shot gives each player on the defensive side a DREb chance. */
  defensiveReboundChance(side: SideIndex): void {
    for (const active of this.activeSlots[side]) {
      const player = this.playerAtRosterIndex(side, active);
      player.defensiveReboundChances += 1;
    }
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
      diagnostics: playerDiagnostics(p),
    };
  }

  /**
   * One ten-roster record line for Season Run (identity is added by the
   * controller): counters and diagnostics for roster index `rosterIndex` on
   * one side, including exact integer `seconds` and display `minutes`.
   */
  seasonPlayerBox(
    side: SideIndex,
    rosterIndex: number,
  ): {
    seconds: number;
    minutes: number;
    points: number;
    fieldGoals: { made: number; attempted: number };
    threes: { made: number; attempted: number };
    freeThrows: { made: number; attempted: number };
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

  /**
   * Team box line for Season Run: identical accounting to `teamBox`, with
   * the diagnostics block typed as present (the Season contract requires it).
   */
  seasonTeamBox(
    side: SideIndex,
    teamId: string,
  ): Omit<TeamBoxScore, 'diagnostics'> & {
    diagnostics: TeamDiagnostics;
  } {
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
