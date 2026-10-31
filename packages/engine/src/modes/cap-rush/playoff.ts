import type {
  CapRushPlayoffApplied,
  CapRushPlayoffObserved,
  CapRushPlayoffPerformance,
  CapRushPlayoffPlayer,
  CapRushPlayoffStatLine,
  HavocSourcePlayer,
  HavocTeamInput,
  PlayoffPerformance,
  SimulationAnchors,
  SimulationTendencies,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_PLAYOFF_CAPS,
  CAP_RUSH_PLAYOFF_FORMULA_VERSION,
  CAP_RUSH_PLAYOFF_MAX_PLAYERS,
  CAP_RUSH_PLAYOFF_SAMPLE_MINUTES,
  capRushPlayoffPerformanceSchema,
} from '@hoop-rush/data-contracts';

/**
 * Concrete bounded mappings from a measured playoff difference to the engine inputs the
 * possession simulation already reads. Slopes are deliberately small and every channel is
 * capped, so the observed difference is directionally visible without becoming a guarantee.
 */
export const CAP_RUSH_PLAYOFF_FORMULA = {
  tsPctSlope: 0.8,
  pointsPer36Slope: 0.35,
  assistsPer36AnchorSlope: 0.35,
  assistsPer36PassRateSlope: 2,
  reboundsPer36Slope: 0.35,
  offensiveReboundShare: 0.3,
  turnoversPer36Slope: 1.6,
} as const;

/** A points-per-36 shift may never move a player's shot volume by more than half its own rate. */
export const CAP_RUSH_PLAYOFF_ATTEMPTS_SHARE = 0.5;

export const NEUTRAL_CAP_RUSH_PLAYOFF_APPLIED: CapRushPlayoffApplied = {
  fieldGoalPct: 0,
  threePointPct: 0,
  fieldGoalAttemptsPerGame: 0,
  passRate: 0,
  assistsPerGame: 0,
  offensiveReboundsPerGame: 0,
  defensiveReboundsPerGame: 0,
  turnoverRate: 0,
};

function clamp(value: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, value));
}

function shift(value: number, delta: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value + delta));
}

/** Small playoff samples shrink toward neutral; every recorded sample keeps a nonzero share. */
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
  return {
    gamesPlayed: Math.max(1, source.gamesPlayed),
    minutes: Math.max(1, source.minutes),
    tsPct: source.tsPct,
    pointsPer36: per36(source.points, source.minutes),
    assistsPer36: per36(source.assists, source.minutes),
    reboundsPer36: per36(source.rebounds, source.minutes),
    turnoversPer36: source.turnovers === null ? null : per36(source.turnovers, source.minutes),
  };
}

export function capRushPlayoffObservedOf(profile: PlayoffPerformance): CapRushPlayoffObserved {
  return {
    tsPct: profile.differences.tsPct,
    pointsPer36: profile.differences.pointsPer36,
    assistsPer36: profile.differences.assistsPer36,
    reboundsPer36: profile.differences.reboundsPer36,
    turnoversPer36: profile.differences.turnoversPer36,
  };
}

/**
 * Maps a measured difference to bounded gameplay deltas. A missing measurement contributes
 * nothing instead of being treated as a zero difference, and a positive turnover difference is a
 * cost because the engine reads a higher turnover tendency as a worse outcome.
 */
export function capRushPlayoffAppliedOf(input: {
  readonly observed: CapRushPlayoffObserved;
  readonly weight: number;
  readonly observedFieldGoalAttemptsPerGame: number | null;
  readonly authoritativeChannels: readonly string[];
}): CapRushPlayoffApplied {
  const f = CAP_RUSH_PLAYOFF_FORMULA;
  const c = CAP_RUSH_PLAYOFF_CAPS;
  const owned = new Set(input.authoritativeChannels);
  const scale = (value: number | null): number => (value === null ? 0 : value * input.weight);
  const observed = input.observed;
  const shooting = clamp(f.tsPctSlope * scale(observed.tsPct), c.fieldGoalPct);
  const rawAttempts = clamp(
    f.pointsPer36Slope * scale(observed.pointsPer36),
    c.fieldGoalAttemptsPerGame,
  );
  const attempts =
    input.observedFieldGoalAttemptsPerGame === null
      ? rawAttempts
      : clamp(
          rawAttempts,
          input.observedFieldGoalAttemptsPerGame * CAP_RUSH_PLAYOFF_ATTEMPTS_SHARE,
        );
  const rebounds = f.reboundsPer36Slope * scale(observed.reboundsPer36);
  const plays = scale(observed.assistsPer36);
  return {
    fieldGoalPct: owned.has('two-point-accuracy') ? 0 : shooting,
    threePointPct: owned.has('three-point-accuracy') ? 0 : shooting,
    fieldGoalAttemptsPerGame: owned.has('offensive-allocation') ? 0 : attempts,
    passRate: owned.has('assist-anchor')
      ? 0
      : clamp(f.assistsPer36PassRateSlope * plays, c.passRate),
    assistsPerGame: owned.has('assist-anchor')
      ? 0
      : clamp(f.assistsPer36AnchorSlope * plays, c.assistsPerGame),
    offensiveReboundsPerGame: owned.has('rebound-weights')
      ? 0
      : clamp(rebounds * f.offensiveReboundShare, c.offensiveReboundsPerGame),
    defensiveReboundsPerGame: owned.has('rebound-weights')
      ? 0
      : clamp(rebounds * (1 - f.offensiveReboundShare), c.defensiveReboundsPerGame),
    turnoverRate: owned.has('turnover-blend')
      ? 0
      : clamp(f.turnoversPer36Slope * scale(observed.turnoversPer36), c.turnoverRate),
  };
}

export function capRushPlayoffIsNeutral(applied: CapRushPlayoffApplied): boolean {
  return Object.values(applied).every((value) => value === 0);
}

/**
 * One pinned row per player-season that carries recorded playoff evidence. Identity is the exact
 * player version, so another season of the same player can never borrow this evidence.
 */
export function capRushPlayoffPlayerRowOf(input: {
  readonly participant: HavocTeamInput['starters'][number];
  readonly profile: PlayoffPerformance;
}): CapRushPlayoffPlayer | null {
  const { participant, profile } = input;
  const { playerVersionId, seasonKey } = participant.source;
  if (playerVersionId === null || seasonKey === null) return null;
  if (profile.season !== seasonKey) return null;
  if (profile.playoffs.gamesPlayed <= 0 || profile.playoffs.minutes <= 0) return null;
  const weight = capRushPlayoffSampleWeight(profile.playoffs.minutes);
  const observed = capRushPlayoffObservedOf(profile);
  return {
    playerId: participant.source.playerId,
    playerVersionId,
    seasonKey,
    weight,
    observed,
    regularSeason: capRushPlayoffStatLine(profile, 'regular'),
    playoffs: capRushPlayoffStatLine(profile, 'playoffs'),
    applied: capRushPlayoffAppliedOf({
      observed,
      weight,
      observedFieldGoalAttemptsPerGame:
        participant.source.profile.anchors?.fieldGoalAttemptsPerGame ?? null,
      authoritativeChannels: participant.effective.authoritativeChannels,
    }),
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
    for (const participant of team.starters) {
      const versionId = participant.source.playerVersionId;
      if (versionId === null || seen.has(versionId)) continue;
      const profile = input.profileOf(participant.source);
      if (profile === undefined) continue;
      const row = capRushPlayoffPlayerRowOf({ participant, profile });
      if (row === null) continue;
      seen.add(versionId);
      players.push(row);
    }
  }
  return capRushPlayoffPerformanceSchema.parse({
    formulaVersion: CAP_RUSH_PLAYOFF_FORMULA_VERSION,
    sampleMinutesAnchor: CAP_RUSH_PLAYOFF_SAMPLE_MINUTES,
    players: players.slice(0, CAP_RUSH_PLAYOFF_MAX_PLAYERS),
  });
}

function adjustedAnchors(
  anchors: SimulationAnchors,
  applied: CapRushPlayoffApplied,
): SimulationAnchors {
  const capped = applied.fieldGoalPct;
  const cappedThree = applied.threePointPct;
  return {
    ...anchors,
    fieldGoalPct: shift(anchors.fieldGoalPct, capped, 0.2, 0.85),
    ...(anchors.threePointPct === null
      ? {}
      : { threePointPct: shift(anchors.threePointPct, cappedThree, 0, 1) }),
    ...(anchors.fieldGoalAttemptsPerGame === undefined
      ? {}
      : {
          fieldGoalAttemptsPerGame: Math.max(
            0,
            anchors.fieldGoalAttemptsPerGame + applied.fieldGoalAttemptsPerGame,
          ),
        }),
    assistsPerGame: Math.max(0, anchors.assistsPerGame + applied.assistsPerGame),
    offensiveReboundsPerGame: Math.max(
      0,
      anchors.offensiveReboundsPerGame + applied.offensiveReboundsPerGame,
    ),
    defensiveReboundsPerGame: Math.max(
      0,
      anchors.defensiveReboundsPerGame + applied.defensiveReboundsPerGame,
    ),
  };
}

function adjustedTendencies(
  tendencies: SimulationTendencies,
  applied: CapRushPlayoffApplied,
): SimulationTendencies {
  return {
    ...tendencies,
    passRate: shift(tendencies.passRate, applied.passRate, 0, 100),
    turnoverRate: shift(tendencies.turnoverRate, applied.turnoverRate, 0, 100),
  };
}

/**
 * Returns a copy of a locked team with the pinned deltas applied. The input is never mutated, and
 * repeated calls produce identical output because every adjustment starts from the base profile.
 * Each tendency copy is shifted from its own base, so a mutation that already moved a tendency keeps
 * its effect instead of being reset by the playoff delta.
 */
export function capRushPlayoffTeam(input: {
  readonly team: HavocTeamInput;
  readonly performance: CapRushPlayoffPerformance | undefined;
}): HavocTeamInput {
  const rows = input.performance?.players;
  if (rows === undefined || rows.length === 0) return input.team;
  const byVersion = new Map(rows.map((row) => [row.playerVersionId, row]));
  const adjust = (participant: HavocTeamInput['starters'][number]) => {
    const versionId = participant.source.playerVersionId;
    const row = versionId === null ? undefined : byVersion.get(versionId);
    if (row === undefined) return participant;
    if (row.seasonKey !== participant.source.seasonKey) return participant;
    if (capRushPlayoffIsNeutral(row.applied)) return participant;
    const base = participant.source.profile;
    return {
      ...participant,
      source: {
        ...participant.source,
        profile: {
          ...base,
          tendencies: adjustedTendencies(base.tendencies, row.applied),
          ...(base.anchors === undefined
            ? {}
            : { anchors: adjustedAnchors(base.anchors, row.applied) }),
        },
      },
      effective: {
        ...participant.effective,
        tendencies: adjustedTendencies(participant.effective.tendencies, row.applied),
      },
    };
  };
  return {
    ...input.team,
    starters: input.team.starters.map(adjust),
    replacements: input.team.replacements.map(adjust),
    clones: input.team.clones.map(adjust),
  };
}

export function capRushPlayoffRowOfVersion(
  performance: CapRushPlayoffPerformance | undefined,
  playerVersionId: string | null,
): CapRushPlayoffPlayer | null {
  if (performance === undefined || playerVersionId === null) return null;
  return performance.players.find((row) => row.playerVersionId === playerVersionId) ?? null;
}
