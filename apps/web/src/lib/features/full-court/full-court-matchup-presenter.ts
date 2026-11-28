import {
  FULL_COURT_MAX_DEFENSIVE_MATCHUPS,
  type FullCourtCoachingPlan,
  type FullCourtDefensiveMatchupAssignment,
  type FullCourtTeamHealth,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { defaultFullCourtCoachingRotation, type FullCourtRegularSeason } from '@hoop-rush/engine';
import type { FullCourtUserFixture } from './full-court-season-presenter.ts';

type SeasonTeam = FullCourtRegularSeason['teams'][number];

export interface FullCourtMatchupOpponentOption {
  readonly playerId: string;
  readonly displayName: string;
  readonly positions: readonly SimulationPlayer['positions'][number][];
  readonly starter: boolean;
  readonly available: boolean;
  readonly plannedMinutes: number | null;
  readonly statusLabel: string;
}

export interface FullCourtMatchupDefenderOption {
  readonly playerId: string;
  readonly displayName: string;
  readonly positions: readonly SimulationPlayer['positions'][number][];
  readonly starter: boolean;
  readonly plannedMinutes: number | null;
  readonly resting: boolean;
  readonly injured: boolean;
  readonly eligible: boolean;
  readonly statusLabel: string;
}

export interface FullCourtMatchupAssignmentRow {
  readonly index: number;
  readonly opponentPlayerId: string;
  readonly defenderPlayerId: string;
  readonly fallbackWarning: string | null;
}

export interface FullCourtMatchupEditorView {
  readonly fixture: FullCourtUserFixture;
  readonly opponentTeamId: string;
  readonly opponentName: string;
  readonly drifted: boolean;
  readonly driftMessage: string | null;
  readonly opponents: readonly FullCourtMatchupOpponentOption[];
  readonly defenders: readonly FullCourtMatchupDefenderOption[];
  readonly rows: readonly FullCourtMatchupAssignmentRow[];
  readonly maxMatchups: number;
  readonly canAdd: boolean;
  readonly nextPair: FullCourtDefensiveMatchupAssignment | null;
}

export interface FullCourtMatchupEditorContext {
  readonly fixture: FullCourtUserFixture;
  readonly userTeam: SeasonTeam;
  readonly opponentTeam: SeasonTeam;
  readonly userHealth: FullCourtTeamHealth | null;
  readonly opponentHealth: FullCourtTeamHealth | null;
  readonly restingPlayerIds: readonly string[];
  readonly coachingPlan: FullCourtCoachingPlan;
  readonly assignments: readonly FullCourtDefensiveMatchupAssignment[];
  readonly forGameId: string | null;
  readonly forOpponentId: string | null;
}

function isPlayerInjured(
  health: FullCourtTeamHealth | null,
  playerId: SimulationPlayer['playerId'],
  dayOffset: number,
): boolean {
  const returnDay = health?.players[playerId]?.availableFromDay ?? null;
  return returnDay !== null && returnDay > dayOffset;
}

export function buildFullCourtMatchupEditorView(
  context: FullCourtMatchupEditorContext | null,
): FullCourtMatchupEditorView | null {
  if (context === null) return null;
  const {
    fixture,
    userTeam,
    opponentTeam,
    userHealth,
    opponentHealth,
    restingPlayerIds,
    coachingPlan,
    assignments,
    forGameId,
    forOpponentId,
  } = context;

  const expectedOpponentId =
    fixture.homeTeamId === userTeam.teamId ? fixture.awayTeamId : fixture.homeTeamId;
  if (opponentTeam.teamId !== expectedOpponentId) return null;

  const drifted =
    assignments.length > 0 &&
    (forGameId !== fixture.gameId || forOpponentId !== opponentTeam.teamId);
  const driftMessage = drifted
    ? `Saved matchups belonged to a previous fixture and no longer apply to ${fixture.label} vs ${opponentTeam.displayName}.`
    : null;

  const opponentAvailability = new Map(
    (opponentTeam.availability ?? []).map((entry) => [entry.playerId, entry]),
  );
  const availability = opponentTeam.roster.map((player) => {
    const entry = opponentAvailability.get(player.playerId);
    return {
      ...entry,
      playerId: player.playerId,
      available:
        entry?.available !== false &&
        !isPlayerInjured(opponentHealth, player.playerId, fixture.dayOffset),
    };
  });
  const rotation =
    availability.filter((entry) => entry.available).length >= 5
      ? defaultFullCourtCoachingRotation({ ...opponentTeam, availability }, opponentTeam.rotation)
      : null;
  const opponentStarterSet = new Set(
    rotation?.startingFive ?? opponentTeam.rotation?.startingFive ?? [],
  );
  const opponents: FullCourtMatchupOpponentOption[] = opponentTeam.roster
    .map((player, index) => {
      const starter = opponentStarterSet.has(player.playerId);
      const injured = availability[index]?.available === false;
      return {
        playerId: player.playerId,
        displayName: player.displayName,
        positions: player.positions,
        starter,
        available: !injured,
        plannedMinutes: rotation?.minuteTargets[player.playerId] ?? null,
        statusLabel: injured ? 'Out' : starter ? 'Starter' : 'Bench',
      };
    })
    .sort((left, right) => Number(right.starter) - Number(left.starter));

  const userStarterSet = new Set(coachingPlan.rotation?.startingFive ?? []);
  const restingSet = new Set(restingPlayerIds);
  const userAvailability = new Map(
    (userTeam.availability ?? []).map((entry) => [entry.playerId, entry.available]),
  );
  const defenders: FullCourtMatchupDefenderOption[] = [...userTeam.roster]
    .map((player) => {
      const starter = userStarterSet.has(player.playerId);
      const plannedMinutes = coachingPlan.rotation?.minuteTargets[player.playerId] ?? null;
      const injured =
        isPlayerInjured(userHealth, player.playerId, fixture.dayOffset) ||
        userAvailability.get(player.playerId) === false;
      const resting = !injured && restingSet.has(player.playerId);
      const eligible = !injured && !resting;
      const statusLabel = injured
        ? 'Out'
        : resting
          ? 'Resting'
          : plannedMinutes === 0
            ? '0 min'
            : starter
              ? 'Starter'
              : 'Ready';
      return {
        playerId: player.playerId,
        displayName: player.displayName,
        positions: player.positions,
        starter,
        plannedMinutes,
        resting,
        injured,
        eligible,
        statusLabel,
      };
    })
    .sort((left, right) => Number(right.starter) - Number(left.starter));

  const opponentById = new Map(opponents.map((entry) => [entry.playerId, entry]));
  const defenderById = new Map(defenders.map((entry) => [entry.playerId, entry]));
  const activeAssignments = drifted ? [] : assignments;

  const rows: FullCourtMatchupAssignmentRow[] = activeAssignments.map((assignment, index) => {
    const opp = opponentById.get(assignment.opponentPlayerId);
    const def = defenderById.get(assignment.defenderPlayerId);
    const warnings: string[] = [];
    if (opp === undefined) {
      warnings.push('Target is not on the opponent roster.');
    } else if (!opp.available) {
      warnings.push(`${opp.displayName} is out for this game — falls back to staff coverage.`);
    }
    if (def === undefined) {
      warnings.push('Defender is not on your roster.');
    } else if (def.injured) {
      warnings.push(`${def.displayName} is out for this game — falls back to staff coverage.`);
    } else if (def.resting) {
      warnings.push(`${def.displayName} is resting — falls back to staff coverage.`);
    } else if (def.plannedMinutes === 0) {
      warnings.push(
        `${def.displayName} has 0 planned minutes — active only if inserted by foul trouble or injury.`,
      );
    }
    return {
      index,
      opponentPlayerId: assignment.opponentPlayerId,
      defenderPlayerId: assignment.defenderPlayerId,
      fallbackWarning: warnings.length > 0 ? warnings.join(' ') : null,
    };
  });

  const usedOpponents = new Set(activeAssignments.map((entry) => entry.opponentPlayerId));
  const usedDefenders = new Set(activeAssignments.map((entry) => entry.defenderPlayerId));
  const nextOpponent = opponents.find(
    (player) => player.available && !usedOpponents.has(player.playerId),
  );
  const nextDefender =
    defenders.find(
      (player) =>
        player.eligible && player.plannedMinutes !== 0 && !usedDefenders.has(player.playerId),
    ) ?? defenders.find((player) => player.eligible && !usedDefenders.has(player.playerId));

  const nextPair =
    !drifted &&
    activeAssignments.length < FULL_COURT_MAX_DEFENSIVE_MATCHUPS &&
    nextOpponent !== undefined &&
    nextDefender !== undefined
      ? {
          opponentPlayerId: nextOpponent.playerId,
          defenderPlayerId: nextDefender.playerId,
        }
      : null;

  return {
    fixture,
    opponentTeamId: opponentTeam.teamId,
    opponentName: opponentTeam.displayName,
    drifted,
    driftMessage,
    opponents,
    defenders,
    rows,
    maxMatchups: FULL_COURT_MAX_DEFENSIVE_MATCHUPS,
    canAdd: nextPair !== null,
    nextPair,
  };
}
