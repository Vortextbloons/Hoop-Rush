import type {
  CapRushPlayoffApplied,
  CapRushPlayoffPlayer,
  CapRushPlayoffPerformance,
  CapRushPlayoffStatLine,
  HavocSourcePlayer,
  HavocTeamInput,
  PlayoffPerformance,
  SimulationAnchors,
  SimulationTendencies,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_PLAYOFF_FORMULA_VERSION,
  CAP_RUSH_PLAYOFF_MAX_PLAYERS,
  CAP_RUSH_PLAYOFF_SAMPLE_MINUTES,
  capRushPlayoffPerformanceSchema,
} from '@hoop-rush/data-contracts';

export const CAP_RUSH_PLAYOFF_FORMULA = {
  tsPctToShooting: 0.5,
  shootingCap: 0.03,
  pointsPer36ToAttempts: 0.2,
  attemptsCap: 2,
  assistsPer36ToAssists: 0.25,
  assistsCap: 1.5,
  assistsPer36ToPassRate: 1.5,
  passRateCap: 6,
  reboundsPer36ToRebounds: 0.2,
  reboundsCap: 1.5,
  offensiveReboundShare: 0.3,
  turnoversPer36ToTurnoverRate: 1,
  turnoverRateCap: 4,
} as const;

function clamp(value: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, value));
}

function shift(value: number, delta: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value + delta));
}

export function capRushPlayoffSampleWeight(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return minutes / (minutes + CAP_RUSH_PLAYOFF_SAMPLE_MINUTES);
}

function per36(total: number, minutes: number): number | null {
  if (!(minutes > 0)) return null;
  return (total * 36) / minutes;
}

export function capRushPlayoffStatLine(
  profile: PlayoffPerformance,
  side: 'regular' | 'playoffs',
): CapRushPlayoffStatLine {
  const source = side === 'regular' ? profile.regularSeason : profile.playoffs;
  const turnovers = source.turnovers;
  return {
    gamesPlayed: Math.max(1, source.gamesPlayed),
    minutes: Math.max(1, source.minutes),
    tsPct: source.tsPct,
    pointsPer36: per36(source.points, source.minutes),
    assistsPer36: per36(source.assists, source.minutes),
    reboundsPer36: per36(source.rebounds, source.minutes),
    turnoversPer36: turnovers === null ? null : per36(turnovers, source.minutes),
  };
}

export interface CapRushPlayoffAdjustment {
  readonly applied: CapRushPlayoffApplied;
  readonly anchors: SimulationAnchors | undefined;
  readonly tendencies: SimulationTendencies;
}

const NEUTRAL_APPLIED: CapRushPlayoffApplied = {
  fieldGoalPct: 0,
  threePointPct: 0,
  fieldGoalAttemptsPerGame: 0,
  passRate: 0,
  assistsPerGame: 0,
  offensiveReboundsPerGame: 0,
  defensiveReboundsPerGame: 0,
  turnoverRate: 0,
};

export function capRushPlayoffAdjustment(input: {
  readonly anchors: SimulationAnchors | undefined;
  readonly tendencies: SimulationTendencies;
  readonly authoritativeChannels: readonly string[];
  readonly profile: PlayoffPerformance;
}): CapRushPlayoffAdjustment {
  const c = CAP_RUSH_PLAYOFF_FORMULA;
  const weight = capRushPlayoffSampleWeight(input.profile.playoffs.minutes);
  const scale = (value: number | null): number => (value === null ? 0 : value * weight);
  const differences = input.profile.differences;
  const shooting = clamp(c.tsPctToShooting * scale(differences.tsPct), c.shootingCap);
  const points = scale(differences.pointsPer36);
  const assists = scale(differences.assistsPer36);
  const rebounds = clamp(
    c.reboundsPer36ToRebounds * scale(differences.reboundsPer36),
    c.reboundsCap,
  );
  const turnovers = scale(differences.turnoversPer36);
  const owned = new Set(input.authoritativeChannels);

  const applied: CapRushPlayoffApplied = { ...NEUTRAL_APPLIED };
  const anchors = input.anchors === undefined ? undefined : { ...input.anchors };
  const tendencies: SimulationTendencies = { ...input.tendencies };

  if (anchors !== undefined) {
    if (!owned.has('two-point-accuracy')) {
      applied.fieldGoalPct = shooting;
      anchors.fieldGoalPct = shift(anchors.fieldGoalPct, shooting, 0.2, 0.85);
    }
    if (!owned.has('three-point-accuracy') && anchors.threePointPct != null) {
      applied.threePointPct = shooting;
      anchors.threePointPct = shift(anchors.threePointPct, shooting, 0, 1);
    }
  }
  if (!owned.has('offensive-allocation')) {
    const observedAttempts = anchors?.fieldGoalAttemptsPerGame ?? null;
    const attempts = clamp(c.pointsPer36ToAttempts * points, c.attemptsCap);
    applied.fieldGoalAttemptsPerGame =
      observedAttempts === null ? attempts : clamp(attempts, observedAttempts * 0.5);
    if (anchors !== undefined && anchors.fieldGoalAttemptsPerGame !== undefined) {
      anchors.fieldGoalAttemptsPerGame = Math.max(
        0,
        anchors.fieldGoalAttemptsPerGame + applied.fieldGoalAttemptsPerGame,
      );
    }
  }
  if (!owned.has('assist-anchor')) {
    applied.assistsPerGame = clamp(c.assistsPer36ToAssists * assists, c.assistsCap);
    applied.passRate = clamp(c.assistsPer36ToPassRate * assists, c.passRateCap);
    tendencies.passRate = shift(tendencies.passRate, applied.passRate, 0, 100);
    if (anchors !== undefined) {
      anchors.assistsPerGame = Math.max(0, anchors.assistsPerGame + applied.assistsPerGame);
    }
  }
  if (!owned.has('rebound-weights') && anchors !== undefined) {
    applied.offensiveReboundsPerGame = rebounds * c.offensiveReboundShare;
    applied.defensiveReboundsPerGame = rebounds * (1 - c.offensiveReboundShare);
    anchors.offensiveReboundsPerGame = Math.max(
      0,
      anchors.offensiveReboundsPerGame + applied.offensiveReboundsPerGame,
    );
    anchors.defensiveReboundsPerGame = Math.max(
      0,
      anchors.defensiveReboundsPerGame + applied.defensiveReboundsPerGame,
    );
  }
  if (!owned.has('turnover-blend')) {
    applied.turnoverRate = clamp(c.turnoversPer36ToTurnoverRate * turnovers, c.turnoverRateCap);
    tendencies.turnoverRate = shift(tendencies.turnoverRate, applied.turnoverRate, 0, 100);
  }
  return { applied, anchors, tendencies };
}

export function capRushPlayoffPlayerRow(input: {
  readonly participant: HavocTeamInput['starters'][number];
  readonly profile: PlayoffPerformance;
}): CapRushPlayoffPlayer | null {
  const { participant, profile } = input;
  const playerVersionId = participant.source.playerVersionId;
  const seasonKey = participant.source.seasonKey;
  if (playerVersionId === null || seasonKey === null) return null;
  if (profile.season !== seasonKey) return null;
  const adjustment = capRushPlayoffAdjustment({
    anchors: participant.source.profile.anchors,
    tendencies: participant.source.profile.tendencies,
    authoritativeChannels: participant.effective.authoritativeChannels,
    profile,
  });
  return {
    instanceId: participant.instanceId,
    playerId: participant.source.playerId,
    playerVersionId,
    seasonKey,
    weight: capRushPlayoffSampleWeight(profile.playoffs.minutes),
    regularSeason: capRushPlayoffStatLine(profile, 'regular'),
    playoffs: capRushPlayoffStatLine(profile, 'playoffs'),
    applied: adjustment.applied,
  };
}

export function capRushPlayoffPerformanceOf(input: {
  readonly human: HavocTeamInput;
  readonly opponents: readonly { readonly team: HavocTeamInput }[];
  readonly profileOf: (source: HavocSourcePlayer) => PlayoffPerformance | undefined;
}): CapRushPlayoffPerformance {
  const players: CapRushPlayoffPlayer[] = [];
  const seen = new Set<string>();
  for (const team of [input.human, ...input.opponents.map((entry) => entry.team)]) {
    for (const participant of [...team.starters, ...team.replacements]) {
      if (seen.has(participant.instanceId)) continue;
      const profile = input.profileOf(participant.source);
      if (profile === undefined) continue;
      if (profile.playoffs.gamesPlayed <= 0 || profile.playoffs.minutes <= 0) continue;
      const row = capRushPlayoffPlayerRow({ participant, profile });
      if (row === null) continue;
      seen.add(participant.instanceId);
      players.push(row);
    }
  }
  return capRushPlayoffPerformanceSchema.parse({
    formulaVersion: CAP_RUSH_PLAYOFF_FORMULA_VERSION,
    sampleMinutesAnchor: CAP_RUSH_PLAYOFF_SAMPLE_MINUTES,
    players: players.slice(0, CAP_RUSH_PLAYOFF_MAX_PLAYERS),
  });
}

export function capRushPlayoffTeam(input: {
  readonly team: HavocTeamInput;
  readonly performance: CapRushPlayoffPerformance | undefined;
}): HavocTeamInput {
  const rows = input.performance?.players;
  if (rows === undefined || rows.length === 0) return input.team;
  const byInstance = new Map(rows.map((row) => [row.instanceId, row]));
  const adjust = (participant: HavocTeamInput['starters'][number]) => {
    const row = byInstance.get(participant.instanceId);
    if (row === undefined) return participant;
    const applied = row.applied;
    const base = participant.source.profile;
    const anchors =
      base.anchors === undefined
        ? undefined
        : {
            ...base.anchors,
            fieldGoalPct: shift(base.anchors.fieldGoalPct, applied.fieldGoalPct, 0.2, 0.85),
            ...(base.anchors.threePointPct == null
              ? {}
              : {
                  threePointPct: shift(base.anchors.threePointPct, applied.threePointPct, 0, 1),
                }),
            ...(base.anchors.fieldGoalAttemptsPerGame === undefined
              ? {}
              : {
                  fieldGoalAttemptsPerGame: Math.max(
                    0,
                    base.anchors.fieldGoalAttemptsPerGame + applied.fieldGoalAttemptsPerGame,
                  ),
                }),
            assistsPerGame: Math.max(0, base.anchors.assistsPerGame + applied.assistsPerGame),
            offensiveReboundsPerGame: Math.max(
              0,
              base.anchors.offensiveReboundsPerGame + applied.offensiveReboundsPerGame,
            ),
            defensiveReboundsPerGame: Math.max(
              0,
              base.anchors.defensiveReboundsPerGame + applied.defensiveReboundsPerGame,
            ),
          };
    const tendencies: SimulationTendencies = {
      ...base.tendencies,
      passRate: shift(base.tendencies.passRate, applied.passRate, 0, 100),
      turnoverRate: shift(base.tendencies.turnoverRate, applied.turnoverRate, 0, 100),
    };
    return {
      ...participant,
      source: {
        ...participant.source,
        profile: {
          ...base,
          tendencies,
          ...(anchors === undefined ? {} : { anchors }),
        },
      },
      effective: { ...participant.effective, tendencies },
    };
  };
  return {
    ...input.team,
    starters: input.team.starters.map(adjust),
    replacements: input.team.replacements.map(adjust),
    clones: input.team.clones.map(adjust),
  };
}
