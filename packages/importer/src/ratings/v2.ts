import {
  DERIVATION_METHOD_VERSION,
  SOURCE_VERSION,
  THREE_POINT_RECONSTRUCTION_VERSION,
  type Confidence,
  type ProvenanceKind,
  type ProvenanceMap,
  type ReconstructedThreePointProfile,
  type SimulationAnchors,
  type SimulationRatings,
  type SimulationTendencies,
  type SummaryRatings,
  type RatingProfile,
  type RatingsModelArtifact,
  type ThreePointReconstructionArtifact,
} from '@hoop-rush/data-contracts';
import { clamp, clampRating, clampUnitInterval, safeFloat } from '../json.ts';
import { FIELD_AVAILABILITY } from '../config.ts';
import { deriveRatingProfile } from './v3.ts';
import { DEFAULT_RATINGS_MODEL_ARTIFACT } from './artifact.ts';
import { predictReconstructedProfile, ratingFromAccuracy } from '../reconstruction/predict.ts';
import { seasonIndexFor, type ReconstructionRow } from '../reconstruction/rows.ts';
import type { StatsRow } from './stats.ts';
export interface SeasonContext {
  leaguePpg: number;
  league3PARate: number;
  pace: number;
}
export interface DerivationInput {
  season: string;
  playerId?: string;
  position: string;
  heightInches: number | null;
  weightLbs?: number | null;
  age?: number | null;
  stats: StatsRow;
  era: SeasonContext;
  artifact?: RatingsModelArtifact;
  ratePriors?: {
    threePointPctPrior?: number;
    freeThrowPctPrior?: number;
  };
  threePointReconstruction?: ThreePointReconstructionArtifact;
  teamWinPct?: number | null;
}
export interface DerivedRecord {
  ratings: SimulationRatings;
  tendencies: SimulationTendencies;
  anchors: SimulationAnchors;
  summaryRatings: SummaryRatings;
  ratingProfile: RatingProfile;
  provenance: ProvenanceMap;
  unclamped: Record<string, number>;
  methods: Record<string, ProvenanceKind>;
  reconstructedThreePoint?: ReconstructedThreePointProfile;
}
export interface PriorTable {
  stealsPer36: number;
  blocksPer36: number;
  turnoversPer36: number;
  offensiveReboundsPer36: number;
  defensiveReboundsPer36: number;
  threePointRatePrior: number;
}
const POSITION_PRIORS: Readonly<Record<string, Readonly<PriorTable>>> = {
  G: {
    stealsPer36: 1.5,
    blocksPer36: 0.4,
    turnoversPer36: 2.6,
    offensiveReboundsPer36: 1.1,
    defensiveReboundsPer36: 4.2,
    threePointRatePrior: 0.18,
  },
  F: {
    stealsPer36: 1.2,
    blocksPer36: 0.9,
    turnoversPer36: 2.4,
    offensiveReboundsPer36: 1.8,
    defensiveReboundsPer36: 6.0,
    threePointRatePrior: 0.12,
  },
  C: {
    stealsPer36: 0.8,
    blocksPer36: 1.9,
    turnoversPer36: 2.3,
    offensiveReboundsPer36: 2.9,
    defensiveReboundsPer36: 7.5,
    threePointRatePrior: 0.04,
  },
};
const LEAGUE_RATE_DEFAULTS: Readonly<
  Record<
    'G' | 'F' | 'C',
    Readonly<{
      threePointPctPrior: number;
      freeThrowPctPrior: number;
    }>
  >
> = {
  G: { threePointPctPrior: 0.36, freeThrowPctPrior: 0.8 },
  F: { threePointPctPrior: 0.35, freeThrowPctPrior: 0.77 },
  C: { threePointPctPrior: 0.31, freeThrowPctPrior: 0.71 },
};
export function positionGroup(detailPos: string): 'G' | 'F' | 'C' {
  return detailPos === 'PG' || detailPos === 'SG'
    ? 'G'
    : detailPos === 'PF' || detailPos === 'SF'
      ? 'F'
      : 'C';
}
export function fieldPublished(field: string, season: string): boolean {
  const boundary = FIELD_AVAILABILITY[field];
  if (boundary === undefined) return true;
  return season >= boundary;
}
function confidenceRank(confidence: Confidence): number {
  return confidence === 'high' ? 2 : confidence === 'medium' ? 1 : 0;
}
function minConfidence(values: readonly Confidence[]): Confidence {
  let rank = 2;
  for (const value of values) rank = Math.min(rank, confidenceRank(value));
  return rank === 2 ? 'high' : rank === 1 ? 'medium' : 'low';
}
function confidenceFor(kind: ProvenanceKind): Confidence {
  switch (kind) {
    case 'observed':
      return 'high';
    case 'derived':
      return 'medium';
    case 'reconstructed':
      return 'low';
    default:
      return 'low';
  }
}
function confidenceForSample(
  kind: ProvenanceKind,
  games: number,
  minutes: number,
  evidenceQuality: 'full' | 'partial' | 'prior' = 'full',
): Confidence {
  if (evidenceQuality === 'prior') return 'low';
  if (games < 10 || minutes < 200) return 'low';
  const confidence = confidenceFor(kind);
  if (evidenceQuality === 'partial') {
    return confidence === 'high' ? 'medium' : confidence;
  }
  if (confidence === 'high' && (games < 30 || minutes < 750)) return 'medium';
  return confidence;
}
interface SeasonTotals {
  gamesPlayed: number;
  minutes: number;
  points: number | null;
  rebounds: number | null;
  offensiveRebounds: number | null;
  defensiveRebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  fouls: number | null;
  fieldGoalsMade: number | null;
  fieldGoalsAttempted: number | null;
  threesMade: number | null;
  threesAttempted: number | null;
  freeThrowsMade: number | null;
  freeThrowsAttempted: number | null;
  per: number | null;
  boxPlusMinus: number | null;
  usageRate: number | null;
  tsPct: number | null;
  efgPct: number | null;
  offRebChances: number | null;
  defRebChances: number | null;
  contestedShots: number | null;
  contestedShots2pt: number | null;
  contestedShots3pt: number | null;
  deflections: number | null;
  screenAssists: number | null;
  boxOuts: number | null;
  defFgPct: number | null;
  passes: number | null;
  secondaryAssists: number | null;
  potentialAssists: number | null;
  avgSpeed: number | null;
  distanceMiles: number | null;
  drives: number | null;
  closeFgm: number | null;
  closeFga: number | null;
  insideFgm: number | null;
  insideFga: number | null;
  midFgm: number | null;
  midFga: number | null;
  contested3Pct: number | null;
  wingspanInches: number | null;
  maxVerticalInches: number | null;
}
function seasonTotals(stats: StatsRow): SeasonTotals {
  const maybe = (key: string): number | null => {
    const value = stats[key];
    if (value === null || value === undefined) return null;
    const n = safeFloat(value);
    if (!Number.isFinite(n)) return null;
    return n;
  };
  return {
    gamesPlayed: Math.max(0, Math.trunc(maybe('gamesPlayed') ?? 0)),
    minutes: Math.max(0, maybe('minutes') ?? 0),
    points: maybe('points'),
    rebounds: maybe('rebounds'),
    offensiveRebounds: maybe('offensiveRebounds'),
    defensiveRebounds: maybe('defensiveRebounds'),
    assists: maybe('assists'),
    steals: maybe('steals'),
    blocks: maybe('blocks'),
    turnovers: maybe('turnovers'),
    fouls: maybe('fouls'),
    fieldGoalsMade: maybe('fgm'),
    fieldGoalsAttempted: maybe('fga'),
    threesMade: maybe('tpm'),
    threesAttempted: maybe('tpa'),
    freeThrowsMade: maybe('ftm'),
    freeThrowsAttempted: maybe('fta'),
    per: maybe('per'),
    boxPlusMinus: maybe('boxPlusMinus'),
    usageRate: maybe('usageRate'),
    tsPct: maybe('tsPct'),
    efgPct: maybe('efgPct'),
    offRebChances: maybe('offRebChances'),
    defRebChances: maybe('defRebChances'),
    contestedShots: maybe('contestedShots'),
    contestedShots2pt: maybe('contestedShots2pt'),
    contestedShots3pt: maybe('contestedShots3pt'),
    deflections: maybe('deflections'),
    screenAssists: maybe('screenAssists'),
    boxOuts: maybe('boxOuts'),
    defFgPct: maybe('defFgPct'),
    passes: maybe('passes'),
    secondaryAssists: maybe('secondaryAssists'),
    potentialAssists: maybe('potentialAssists'),
    avgSpeed: maybe('avgSpeed'),
    distanceMiles: maybe('distanceMiles'),
    drives: maybe('drives'),
    closeFgm: maybe('closeFgm') ?? maybe('closeM'),
    closeFga: maybe('closeFga') ?? maybe('closeA'),
    insideFgm: maybe('insideFgm') ?? maybe('insideM'),
    insideFga: maybe('insideFga') ?? maybe('insideA'),
    midFgm: maybe('midFgm') ?? maybe('midM'),
    midFga: maybe('midFga') ?? maybe('midA'),
    contested3Pct: maybe('contested3Pct'),
    wingspanInches: maybe('wingspanInches') ?? maybe('wingspan'),
    maxVerticalInches: maybe('maxVerticalInches') ?? maybe('maxVertical'),
  };
}
interface Resolved {
  value: number;
  kind: ProvenanceKind;
  fields: string[];
}
function resolveCounting(
  observed: number | null,
  published: boolean,
  priorPer36: number,
  minutes: number,
  games: number,
  fields: string[],
  relatedPer36?: number | null,
  share?: number,
  relatedField?: string,
): Resolved {
  if (published && observed !== null && games > 0) {
    return { value: observed / games, kind: 'observed', fields };
  }
  const usedRelated = relatedPer36 !== null && relatedPer36 !== undefined && share !== undefined;
  const estimatePer36 = usedRelated ? relatedPer36 * share : priorPer36;
  const evidenceWeight = minutes / Math.max(1, minutes + 1500);
  const valuePer36 = estimatePer36 * evidenceWeight + priorPer36 * (1 - evidenceWeight);
  const mpg = minutes / Math.max(1, games);
  return {
    value: (valuePer36 * mpg) / 36,
    kind: 'estimated',
    fields: [...fields, usedRelated && relatedField !== undefined ? relatedField : 'prior'],
  };
}
function perGame(total: number | null, games: number): number | null {
  if (total === null || games <= 0) return null;
  return total / games;
}
function per36(total: number | null, minutes: number): number | null {
  if (total === null || minutes <= 0) return null;
  return (total * 36) / minutes;
}
export function derivePlayerRecord(input: DerivationInput): DerivedRecord {
  const totals = seasonTotals(input.stats);
  const { gamesPlayed: gp, minutes } = totals;
  const position = positionGroup(input.position);
  const priors = POSITION_PRIORS[position] ??
    POSITION_PRIORS['F'] ??
    POSITION_PRIORS['G'] ?? {
      stealsPer36: 1,
      blocksPer36: 0.8,
      turnoversPer36: 2.4,
      offensiveReboundsPer36: 1.5,
      defensiveReboundsPer36: 5,
      threePointRatePrior: 0.12,
    };
  const unclamped: Record<string, number> = {};
  const methods: Record<string, ProvenanceKind> = {};
  const provenance: ProvenanceMap = {};
  const RATING_SOURCE_FIELD: Readonly<Record<string, string>> = {
    steal: 'steals',
    block: 'blocks',
    offensiveRebound: 'offensiveRebounds',
    defensiveRebound: 'defensiveRebounds',
    threePoint: 'threesAttempted',
    freeThrow: 'freeThrowsAttempted',
  };
  const record = (
    key: string,
    value: number,
    kind: ProvenanceKind,
    fields: string[],
    options: {
      confidence?: Confidence;
      notesCode?: string;
      sourceStatus?: 'available' | 'unavailable' | 'not-applicable';
    } = {},
  ): void => {
    unclamped[key] = value;
    methods[key] = kind;
    const sourceField = RATING_SOURCE_FIELD[key] ?? key;
    const fallbackStatus = fieldPublished(sourceField, input.season) ? undefined : 'not-applicable';
    provenance[key] = {
      kind,
      confidence: options.confidence ?? confidenceForSample(kind, gp, minutes),
      methodVersion: DERIVATION_METHOD_VERSION,
      sourceVersion: SOURCE_VERSION,
      sourceFields: fields,
      sampleGames: gp,
      sampleMinutes: Math.round(minutes),
      sourceStatus: options.sourceStatus ?? fallbackStatus,
      ...(options.notesCode !== undefined ? { notesCode: options.notesCode } : {}),
    };
  };
  const ppg = perGame(totals.points, gp);
  const rpg = perGame(totals.rebounds, gp);
  const apg = perGame(totals.assists, gp);
  const mpg = gp > 0 ? minutes / gp : 0;
  const ptsPer36 = per36(totals.points, minutes);
  const rebPer36 = per36(totals.rebounds, minutes);
  const astPer36 = per36(totals.assists, minutes);
  const stlPer36Observed = per36(totals.steals, minutes);
  const blkPer36Observed = per36(totals.blocks, minutes);
  const tovPer36Observed = per36(totals.turnovers, minutes);
  const spg = resolveCounting(
    totals.steals,
    fieldPublished('steals', input.season),
    priors.stealsPer36,
    minutes,
    gp,
    ['steals'],
  );
  const bpg = resolveCounting(
    totals.blocks,
    fieldPublished('blocks', input.season),
    priors.blocksPer36,
    minutes,
    gp,
    ['blocks'],
  );
  const reboundShare =
    priors.offensiveReboundsPer36 / (priors.offensiveReboundsPer36 + priors.defensiveReboundsPer36);
  const rebsPer36 = rpg !== null && mpg > 0 ? (rpg * 36) / mpg : null;
  const oreb = resolveCounting(
    totals.offensiveRebounds,
    fieldPublished('offensiveRebounds', input.season),
    priors.offensiveReboundsPer36,
    minutes,
    gp,
    ['offensiveRebounds'],
    rebsPer36,
    reboundShare,
    'rebounds',
  );
  const dreb = resolveCounting(
    totals.defensiveRebounds,
    fieldPublished('defensiveRebounds', input.season),
    priors.defensiveReboundsPer36,
    minutes,
    gp,
    ['defensiveRebounds'],
    rebsPer36,
    1 - reboundShare,
    'rebounds',
  );
  const orebPer36Signal = mpg > 0 ? (oreb.value * 36) / mpg : oreb.value;
  const drebPer36Signal = mpg > 0 ? (dreb.value * 36) / mpg : dreb.value;
  const offChanceRate =
    totals.offensiveRebounds !== null && totals.offRebChances !== null && totals.offRebChances > 0
      ? clampUnitInterval(totals.offensiveRebounds / totals.offRebChances)
      : null;
  const defChanceRate =
    totals.defensiveRebounds !== null && totals.defRebChances !== null && totals.defRebChances > 0
      ? clampUnitInterval(totals.defensiveRebounds / totals.defRebChances)
      : null;
  const fga = totals.fieldGoalsAttempted;
  const fgm = totals.fieldGoalsMade;
  const fta = totals.freeThrowsAttempted;
  const ftm = totals.freeThrowsMade;
  const tpa = totals.threesAttempted;
  const tpm = totals.threesMade;
  const fgPct = fgm !== null && fga !== null && fga > 0 ? clampUnitInterval(fgm / fga) : null;
  const ftPct = ftm !== null && fta !== null && fta > 0 ? clampUnitInterval(ftm / fta) : null;
  const threePct =
    tpm !== null && tpa !== null && tpa > 0 ? clampUnitInterval(Math.min(tpm, tpa) / tpa) : null;
  const reconstructionArtifact = input.threePointReconstruction;
  const reconstructionEligible = !fieldPublished('threesAttempted', input.season) || tpa === null;
  let reconstructedThreePoint: ReconstructedThreePointProfile | undefined;
  if (reconstructionEligible && reconstructionArtifact !== undefined) {
    const reconstructionRow: ReconstructionRow = {
      playerExternalId: input.playerId ?? 'unknown',
      season: input.season,
      seasonIndex: seasonIndexFor(input.season),
      positionGroup: position,
      heightInches: input.heightInches,
      weightLbs: input.weightLbs ?? null,
      age: input.age ?? null,
      minutes: totals.minutes,
      fgm,
      fga,
      tpm,
      tpa,
      ftm,
      fta,
      assists: totals.assists,
      statsSource: 'derivation',
    };
    reconstructedThreePoint = predictReconstructedProfile(
      reconstructionArtifact,
      reconstructionRow,
    ).profile;
  }
  const tsPct = clampUnitInterval(totals.tsPct);
  const efgPct = clampUnitInterval(totals.efgPct);
  const usage = totals.usageRate;
  const eraThreeAnchor = Math.min(
    0.36,
    Math.max(0.3, 0.3 + (input.era.league3PARate / 0.15) * 0.06),
  );
  const ratePriors = {
    threePointPctPrior:
      input.ratePriors?.threePointPctPrior ??
      Math.min(eraThreeAnchor, LEAGUE_RATE_DEFAULTS[position].threePointPctPrior),
    freeThrowPctPrior:
      input.ratePriors?.freeThrowPctPrior ?? LEAGUE_RATE_DEFAULTS[position].freeThrowPctPrior,
  };
  const shrunkRate = (
    made: number | null,
    attempted: number | null,
    priorRate: number,
  ): number | null => {
    if (made === null || attempted === null || attempted <= 0) return null;
    const clampedMade = Math.min(made, attempted);
    return (clampedMade + priorRate * 80) / (attempted + 80);
  };
  const threePctShrunk = shrunkRate(tpm, tpa, ratePriors.threePointPctPrior);
  const ftPctShrunk = shrunkRate(ftm, fta, ratePriors.freeThrowPctPrior);
  const weight = clamp(0.6 * Math.min(1, minutes / 1500) + 0.4 * Math.min(1, gp / 45), 0, 1);
  const blend = (raw: number, mean: number): number => raw * weight + mean * (1 - weight);
  const tsComponent = tsPct !== null ? (tsPct - 0.5) * 60 : 0;
  const ftComponent = ftPctShrunk !== null ? (ftPctShrunk - 0.7) * 15 : 0;
  const threeEvidenceShare = tpa !== null && tpa > 0 ? tpa / (tpa + 80) : 0;
  const threeSecondaryWeight = 1 - clamp(threeEvidenceShare, 0, 1);
  const threeDifficultyAdj =
    totals.contested3Pct !== null && tpa !== null && tpa >= 100
      ? clamp((0.5 - totals.contested3Pct) * 6, -3, 3)
      : 0;
  const threeDifficultyFields =
    totals.contested3Pct !== null && tpa !== null && tpa >= 100 ? ['contested3Pct'] : [];
  // Era shooting norm: large samples must converge near the observed rate no
  // matter the prior, so the anchor is fixed per season (from league-wide
  // three-point volume: modern spacing ~0.36, early-80s ~0.31) while the
  // pooled group rate keeps its proper role inside the shrink step below.
  // Judging a 1991 31% shooter against a modern 0.36 anchor would punish
  // pre-spacing eras for their environment instead of their ability.
  const threeAnchor = eraThreeAnchor;
  let threeRaw: number;
  let threeKind: ProvenanceKind;
  let threeFields: string[];
  if (tpa !== null && tpa > 0 && threePctShrunk !== null) {
    threeRaw =
      62 +
      (threePctShrunk - threeAnchor) * 330 +
      (tsComponent + ftComponent) * threeSecondaryWeight * 0.5 +
      threeDifficultyAdj;
    threeKind = 'derived';
    threeFields = ['tpm', 'tpa', 'prior', 'shrink-80-attempts', ...threeDifficultyFields];
  } else if (reconstructedThreePoint !== undefined) {
    threeRaw = ratingFromAccuracy(
      reconstructionArtifact as ThreePointReconstructionArtifact,
      reconstructedThreePoint.accuracyConservative,
    );
    threeKind = 'reconstructed';
    threeFields = reconstructedThreePoint.evidence.sourceFields;
  } else if (ftPctShrunk !== null) {
    threeRaw = 52 + ftComponent * 1.2 - (position === 'C' ? 8 : 0);
    threeKind = 'estimated';
    threeFields = ['ftm', 'fta', 'prior', 'shrink-80-attempts'];
  } else {
    threeRaw = 45;
    threeKind = 'estimated';
    threeFields = ['prior'];
  }
  // Minutes say how much a player played; attempts say how much of a shooter he
  // is. A 2000-minute season with 7 three attempts carries almost no shooting
  // evidence, so the blend leans on volume here too — otherwise flukes like a
  // 7-for-7 season rate as rotation shooters.
  const threeAttemptWeight =
    threeKind === 'derived' && tpa !== null ? Math.min(weight, clamp(tpa / 150, 0.15, 1)) : weight;
  record(
    'threePoint',
    threeRaw * threeAttemptWeight + 54 * (1 - threeAttemptWeight),
    threeKind,
    threeFields,
  );
  if (threeKind === 'reconstructed' && reconstructedThreePoint !== undefined) {
    const entry = provenance['threePoint'];
    if (entry !== undefined) {
      entry.confidence = reconstructedThreePoint.confidence;
      entry.notesCode = THREE_POINT_RECONSTRUCTION_VERSION;
    }
  }
  const freeThrowRaw = ftPctShrunk !== null ? 50 + (ftPctShrunk - 0.5) * 120 : 62;
  record(
    'freeThrow',
    blend(freeThrowRaw, 69),
    ftPctShrunk !== null ? 'derived' : 'estimated',
    ftPctShrunk !== null ? ['ftm', 'fta', 'prior', 'shrink-80-attempts'] : ['prior'],
  );
  const zoneShrunk = (
    made: number | null,
    attempted: number | null,
    priorRate: number,
  ): number | null => {
    if (made === null || attempted === null || attempted <= 0) return null;
    return (Math.min(made, attempted) + priorRate * 80) / (attempted + 80);
  };
  const shotLocationPublished = fieldPublished('shotLocation', input.season);
  const zoneFallbackNote = shotLocationPublished
    ? 'no-shot-location'
    : 'shot-location-not-applicable';
  const closeShrunk = zoneShrunk(totals.closeFgm, totals.closeFga, 0.6);
  const insideShrunk = zoneShrunk(totals.insideFgm, totals.insideFga, 0.55);
  const midShrunk = zoneShrunk(totals.midFgm, totals.midFga, 0.42);
  const ptsPer36Norm =
    ptsPer36 !== null ? ptsPer36 * (114.7 / Math.max(1, input.era.leaguePpg)) : null;
  if (insideShrunk !== null) {
    record('insideScoring', blend(58 + (insideShrunk - 0.55) * 170, 54), 'derived', [
      'insideFgm',
      'insideFga',
      'prior',
      'shrink-80-attempts',
    ]);
  } else {
    const insideRaw =
      62 +
      ((ptsPer36Norm ?? 14) - 14) * 0.8 +
      ((tsPct ?? 0.48) - 0.5) * 25 +
      (position === 'C' || position === 'F' ? 3 : -2);
    record(
      'insideScoring',
      blend(insideRaw, 54),
      ppg !== null ? 'derived' : 'estimated',
      ['points', 'minutes', 'tsPct'],
      { notesCode: zoneFallbackNote },
    );
  }
  if (closeShrunk !== null) {
    record('closeShot', blend(58 + (closeShrunk - 0.6) * 170, 59), 'derived', [
      'closeFgm',
      'closeFga',
      'prior',
      'shrink-80-attempts',
    ]);
  } else {
    record(
      'closeShot',
      blend(58 + ((fgPct ?? 0.47) - 0.47) * 60 + Math.max(0, (ptsPer36 ?? 15) - 15) * 0.8, 59),
      ppg !== null ? 'derived' : 'estimated',
      ['fgm', 'fga', 'points', 'minutes'],
      { notesCode: zoneFallbackNote },
    );
  }
  const threeRateForMix =
    tpa !== null && fga !== null && fga > 0 ? tpa / fga : priors.threePointRatePrior;
  const ftaPerFgaForMix = fta !== null && fga !== null && fga > 0 ? fta / fga : 0;
  const rimReliantBig =
    (position === 'C' || position === 'F') && threeRateForMix < 0.08 && ftaPerFgaForMix > 0.3;
  const midPct = midShrunk ?? efgPct ?? fgPct;
  if (midShrunk !== null) {
    record('midrange', blend(58 + (midShrunk - 0.42) * 200, 54), 'derived', [
      'midFgm',
      'midFga',
      'prior',
      'shrink-80-attempts',
    ]);
  } else if (rimReliantBig) {
    // A rim-only big's efg is dunk efficiency, not jumper skill — reading it
    // as midrange ability mints fake 75+ ratings (see Gobert/Whiteside). Free
    // throws are the only observed touch signal, so midrange becomes a
    // free-throw touch prior, honestly estimated.
    const touchRate = ftPctShrunk ?? ftPct ?? 0.65;
    record('midrange', blend(40 + touchRate * 30, 54), 'estimated', ['ftm', 'fta', 'prior'], {
      notesCode: zoneFallbackNote,
    });
  } else {
    record(
      'midrange',
      blend(60 + ((midPct ?? 0.47) - 0.48) * 100, 54),
      midPct !== null ? 'derived' : 'estimated',
      ['fgm', 'fga', 'tpm', 'tpa'],
      { notesCode: zoneFallbackNote },
    );
  }
  const secAstPer36 = per36(totals.secondaryAssists, minutes);
  const potentialAstPer36 = per36(totals.potentialAssists, minutes);
  const unconvertedCreation =
    potentialAstPer36 !== null && astPer36 !== null ? Math.max(0, potentialAstPer36 - astPer36) : 0;
  const creationRate =
    astPer36 !== null
      ? astPer36 + (secAstPer36 !== null ? secAstPer36 * 0.5 : 0) + unconvertedCreation * 0.1
      : null;
  const creationFields = [
    'assists',
    ...(secAstPer36 !== null ? (['secondaryAssists'] as string[]) : []),
    ...(unconvertedCreation > 0 ? (['potentialAssists'] as string[]) : []),
    'minutes',
  ];
  const tovPer36 = tovPer36Observed;
  const expectedTovPer36 =
    creationRate !== null || usage !== null
      ? 1.1 + Math.max(0, (usage ?? 18) - 15) * 0.075 + Math.max(0, (creationRate ?? 2) - 2) * 0.22
      : null;
  const ballSecurity =
    tovPer36 !== null && expectedTovPer36 !== null
      ? clamp((expectedTovPer36 - tovPer36) * 3.5, -8, 8)
      : 0;
  const passRaw = 60 + ((creationRate ?? 3) - 3) * 4.2;
  record(
    'passing',
    blend(passRaw, 54),
    creationRate !== null ? 'derived' : 'estimated',
    creationRate !== null ? creationFields : ['prior'],
  );
  const creationRaw =
    64 + ((creationRate ?? 3) - 3) * 3.0 + ((usage ?? 18) - 18) * 0.45 + ballSecurity * 0.5;
  record(
    'ballHandling',
    blend(creationRaw, 54),
    creationRate !== null || usage !== null ? 'derived' : 'estimated',
    ['assists', 'usageRate', 'turnovers', 'minutes'],
  );
  const stlPer36 = stlPer36Observed ?? (mpg > 0 ? (spg.value * 36) / mpg : spg.value);
  const blkPer36 = blkPer36Observed ?? (mpg > 0 ? (bpg.value * 36) / mpg : bpg.value);
  const rebPer36Signal = rebPer36 ?? (rpg !== null && mpg > 0 ? (rpg * 36) / mpg : null);
  const stocksPublished =
    fieldPublished('steals', input.season) && fieldPublished('blocks', input.season);
  const priorOnlyDefense = !stocksPublished;
  const defenseNotesCode = priorOnlyDefense ? 'positional-prior-pre1974' : undefined;
  const contestPublished = fieldPublished('contestTracking', input.season);
  const contestedPer36 = per36(totals.contestedShots, minutes);
  const deflectionsPer36 = per36(totals.deflections, minutes);
  const hasContestEvidence =
    contestPublished && (contestedPer36 !== null || deflectionsPer36 !== null);
  const reboundEvidence = rpg !== null && (oreb.kind !== 'observed' || dreb.kind !== 'observed');
  const chanceNotesCode = 'no-rebound-chances';
  const offensiveReboundBase = 50 + (orebPer36Signal - 1.5) * 8;
  const offensiveReboundRaw =
    offChanceRate !== null
      ? offensiveReboundBase + clamp((offChanceRate - 0.5) * 20, -6, 6)
      : offensiveReboundBase;
  const defensiveReboundBase = 55 + (drebPer36Signal - 4) * 5;
  const defensiveReboundRaw =
    defChanceRate !== null
      ? defensiveReboundBase + clamp((defChanceRate - 0.65) * 20, -6, 6)
      : defensiveReboundBase;
  const reboundConfidence = (kind: ProvenanceKind): Confidence =>
    kind === 'observed'
      ? confidenceForSample('derived', gp, minutes)
      : confidenceForSample(kind, gp, minutes, 'prior');
  record(
    'offensiveRebound',
    blend(offensiveReboundRaw, 45),
    oreb.kind === 'observed' ? 'derived' : oreb.kind,
    reboundEvidence && !oreb.fields.includes('rebounds')
      ? ['rebounds', ...oreb.fields, ...(offChanceRate !== null ? ['offRebChances'] : [])]
      : [...oreb.fields, ...(offChanceRate !== null ? ['offRebChances'] : [])],
    {
      confidence: reboundConfidence(oreb.kind),
      ...(offChanceRate === null ? { notesCode: chanceNotesCode } : {}),
    },
  );
  record(
    'defensiveRebound',
    blend(defensiveReboundRaw, 59),
    dreb.kind === 'observed' ? 'derived' : dreb.kind,
    reboundEvidence && !dreb.fields.includes('rebounds')
      ? ['rebounds', ...dreb.fields, ...(defChanceRate !== null ? ['defRebChances'] : [])]
      : [...dreb.fields, ...(defChanceRate !== null ? ['defRebChances'] : [])],
    {
      confidence: reboundConfidence(dreb.kind),
      ...(defChanceRate === null ? { notesCode: chanceNotesCode } : {}),
    },
  );
  const stealEventRaw = 60 + stlPer36 * 10;
  const blockEventRaw = 60 + blkPer36 * 12;
  const stealKind: ProvenanceKind = spg.kind === 'observed' ? 'derived' : spg.kind;
  const blockKind: ProvenanceKind = bpg.kind === 'observed' ? 'derived' : bpg.kind;
  record('steal', blend(stealEventRaw, 54), stealKind, spg.fields, {
    confidence: stealKind === 'derived' ? confidenceForSample('derived', gp, minutes) : 'low',
    ...(defenseNotesCode !== undefined && stealKind !== 'derived'
      ? { notesCode: defenseNotesCode }
      : {}),
  });
  record('block', blend(blockEventRaw, 49), blockKind, bpg.fields, {
    confidence: blockKind === 'derived' ? confidenceForSample('derived', gp, minutes) : 'low',
    ...(defenseNotesCode !== undefined && blockKind !== 'derived'
      ? { notesCode: 'positional-prior-pre1974' }
      : {}),
  });
  const containmentFields = hasContestEvidence
    ? [
        ...(contestedPer36 !== null ? ['contestedShots'] : []),
        ...(deflectionsPer36 !== null ? ['deflections'] : []),
        'minutes',
        'position',
      ]
    : ['steals', 'minutes', 'position'];
  const perimeterRaw = hasContestEvidence
    ? 60 +
      (deflectionsPer36 ?? 1) * 5 +
      ((contestedPer36 ?? 3) - 3) * 2 +
      (position === 'G' ? 2 : position === 'C' ? -5 : 0)
    : 60 + (stlPer36 - 1.2) * 7 + (position === 'G' ? 2 : position === 'C' ? -6 : 0);
  const perimeterKind: ProvenanceKind = hasContestEvidence ? 'derived' : 'estimated';
  record('perimeterDefense', blend(perimeterRaw, 54), perimeterKind, containmentFields, {
    confidence: hasContestEvidence ? confidenceForSample('derived', gp, minutes, 'partial') : 'low',
    ...(hasContestEvidence
      ? {}
      : defenseNotesCode !== undefined
        ? { notesCode: defenseNotesCode }
        : { notesCode: 'no-contest-tracking' }),
  });
  const hasRimEvidence = contestPublished && totals.defFgPct !== null && totals.blocks !== null;
  // Event rate is not containment: a gambling shot-blocker piles blocks while
  // giving up position, so the fallback slope stays flatter than the event
  // rating and leans on rebounding evidence instead.
  const interior =
    hasRimEvidence && totals.defFgPct !== null
      ? 54 +
        (0.52 - totals.defFgPct) * 100 +
        blkPer36 * 5 +
        (position === 'C' ? 5 : position === 'F' ? 1 : -5)
      : 54 +
        blkPer36 * 4.5 +
        Math.max(0, (rebPer36Signal ?? 8) - 8) * 1.0 +
        (position === 'C' ? 5 : position === 'F' ? 1 : -6);
  const interiorKind: ProvenanceKind = hasRimEvidence ? 'derived' : 'estimated';
  const interiorConfidence = minConfidence([
    hasRimEvidence ? confidenceForSample('derived', gp, minutes, 'partial') : 'low',
    blockKind === 'derived' ? confidenceForSample('derived', gp, minutes) : 'low',
  ]);
  record(
    'interiorDefense',
    blend(interior, position === 'C' || position === 'F' ? 59 : 49),
    interiorKind,
    hasRimEvidence
      ? ['defFgPct', 'blocks', 'minutes', 'position']
      : ['blocks', 'rebounds', 'minutes', 'position'],
    {
      confidence: interiorConfidence,
      ...(hasRimEvidence
        ? {}
        : defenseNotesCode !== undefined
          ? { notesCode: defenseNotesCode }
          : { notesCode: 'no-contest-tracking' }),
    },
  );
  const reboundDefenseSignal = rebPer36Signal !== null ? Math.max(0, rebPer36Signal - 9) * 0.7 : 0;
  const foulDisciplineSignal =
    totals.fouls !== null && minutes > 0
      ? -Math.max(0, (totals.fouls / minutes) * 48 - 4) * 1.5
      : 0;
  const screenAstPer36 = per36(totals.screenAssists, minutes);
  const screenSignal = screenAstPer36 !== null ? Math.min(3, screenAstPer36 * 8) : 0;
  const stockSignal = stlPer36 * 4 + blkPer36 * 3;
  const stockObserved = spg.kind === 'observed' || bpg.kind === 'observed';
  const defensiveIqConfidence = minConfidence([
    stockObserved ? confidenceForSample('derived', gp, minutes) : 'low',
    blockKind === 'derived' ? confidenceForSample('derived', gp, minutes) : 'low',
  ]);
  record(
    'defensiveIq',
    blend(60 + stockSignal + screenSignal + reboundDefenseSignal + foulDisciplineSignal, 59),
    stockObserved ? 'derived' : 'estimated',
    stockObserved
      ? [
          'steals',
          'blocks',
          'rebounds',
          'fouls',
          'minutes',
          ...(screenAstPer36 !== null ? ['screenAssists'] : []),
        ]
      : ['rebounds', 'minutes', 'prior'],
    {
      confidence: defensiveIqConfidence,
      ...(!stockObserved && defenseNotesCode !== undefined ? { notesCode: defenseNotesCode } : {}),
    },
  );
  const speedTrackingPublished = fieldPublished('speedTracking', input.season);
  const hasSpeedEvidence = speedTrackingPublished && totals.avgSpeed !== null;
  const heightSpeedPenalty =
    input.heightInches === null ? 0 : Math.max(0, input.heightInches - 78) * 0.7;
  const drivesPer36 = per36(totals.drives, minutes);
  const speedRaw = hasSpeedEvidence
    ? 58 + ((totals.avgSpeed ?? 4.3) - 4.3) * 35 - heightSpeedPenalty * 0.5
    : 58 - heightSpeedPenalty + (drivesPer36 !== null ? Math.min(4, drivesPer36 * 0.5) : 0);
  record(
    'speed',
    blend(speedRaw, 59),
    hasSpeedEvidence ? 'derived' : 'estimated',
    hasSpeedEvidence
      ? ['avgSpeed', 'heightInches', 'minutes']
      : ['heightInches', ...(drivesPer36 !== null ? (['drives', 'minutes'] as string[]) : [])],
    {
      confidence: hasSpeedEvidence ? confidenceForSample('derived', gp, minutes, 'partial') : 'low',
      ...(!hasSpeedEvidence ? { notesCode: 'no-speed-tracking' } : {}),
    },
  );
  const heightSignal = input.heightInches === null ? 0 : Math.max(0, input.heightInches - 72) * 1.7;
  const weightSignal =
    input.weightLbs !== null && input.weightLbs !== undefined && Number.isFinite(input.weightLbs)
      ? clamp((input.weightLbs - 220) * 0.08, -6, 6)
      : 0;
  record(
    'strength',
    blend(
      53 + heightSignal + (position === 'C' ? 4 : 0) + weightSignal,
      position === 'C' || position === 'F' ? 64 : 54,
    ),
    input.heightInches !== null ? 'derived' : 'estimated',
    ['position', 'heightInches', ...(weightSignal !== 0 ? (['weightLbs'] as string[]) : [])],
  );
  const verticalMeasurementBonus =
    totals.maxVerticalInches !== null ? clamp((totals.maxVerticalInches - 28) * 1.2, -6, 8) : 0;
  const verticalRaw =
    51 + blkPer36 * 4 + Math.max(0, orebPer36Signal - 1.5) * 1.8 + verticalMeasurementBonus;
  const verticalConfidence = minConfidence([
    blockKind === 'derived' ? confidenceForSample('derived', gp, minutes) : 'low',
    oreb.kind === 'observed' ? confidenceForSample('derived', gp, minutes) : 'low',
  ]);
  record(
    'vertical',
    blend(verticalRaw, 56),
    bpg.kind === 'observed' || oreb.kind === 'observed' ? 'derived' : 'estimated',
    [
      'blocks',
      'offensiveRebounds',
      'minutes',
      ...(totals.maxVerticalInches !== null ? (['maxVerticalInches'] as string[]) : []),
    ],
    {
      confidence: verticalConfidence,
      ...(!hasSpeedEvidence && bpg.kind !== 'observed' && defenseNotesCode !== undefined
        ? { notesCode: defenseNotesCode }
        : {}),
    },
  );
  const astUsageRatio =
    creationRate !== null && usage !== null && usage > 0
      ? creationRate / Math.max(10, usage)
      : null;
  const shotSelectionSignal = tsPct !== null ? (tsPct - 0.52) * 30 : 0;
  const decisionQualityRaw =
    75 + ((astUsageRatio ?? 0.14) - 0.14) * 55 + ballSecurity * 0.8 + shotSelectionSignal * 0.4;
  record(
    'offensiveIq',
    blend(decisionQualityRaw, 59),
    creationRate !== null && usage !== null ? 'derived' : 'estimated',
    ['assists', 'usageRate', 'turnovers', 'tsPct', 'minutes'],
  );
  const ratings = {} as SimulationRatings;
  for (const key of Object.keys(provenance)) {
    const raw = unclamped[key];
    if (raw !== undefined) ratings[key as keyof SimulationRatings] = clampRating(raw);
  }
  const tendencies = {} as SimulationTendencies;
  const t = (
    key: string,
    raw: number,
    kind: ProvenanceKind,
    fields: string[],
    options: { confidence?: Confidence; notesCode?: string } = {},
  ): void => {
    const value = clamp(raw, 0, 100);
    unclamped[`tendency:${key}`] = raw;
    methods[key] = kind;
    provenance[key] = {
      kind,
      confidence: options.confidence ?? confidenceForSample(kind, gp, minutes),
      methodVersion: DERIVATION_METHOD_VERSION,
      sourceVersion: SOURCE_VERSION,
      sourceFields: fields,
      sampleGames: gp,
      sampleMinutes: Math.round(minutes),
      sourceStatus: fieldPublished(key, input.season) ? undefined : 'not-applicable',
      ...(options.notesCode !== undefined ? { notesCode: options.notesCode } : {}),
    };
    tendencies[key as keyof SimulationTendencies] = Math.round(value * 100) / 100;
  };
  const fgaPerGame = fga !== null ? fga / Math.max(1, gp) : null;
  const usageVal = usage ?? 18;
  t('usageRate', usageVal, usage !== null ? 'observed' : 'estimated', ['usageRate']);
  const passEvidence = apg !== null ? (apg / Math.max(1, apg + (ppg ?? 10) * 0.5 + 1)) * 40 : 18;
  t('passRate', passEvidence, apg !== null ? 'derived' : 'estimated', ['assists', 'points']);
  t(
    'shotRate',
    fgaPerGame !== null ? (fgaPerGame / 48) * 100 : 18,
    fgaPerGame !== null ? 'derived' : 'estimated',
    ['fga'],
  );
  const threeRate =
    reconstructedThreePoint !== undefined
      ? reconstructedThreePoint.attemptRateConservative
      : tpa !== null && fga !== null && fga > 0
        ? tpa / fga
        : priors.threePointRatePrior;
  const freeThrowPressure = fta !== null && fga !== null && fga > 0 ? fta / fga : usageVal / 100;
  const assistRole = clamp((apg ?? 2) / 8, 0, 1);
  const interiorRole = clamp((oreb.value / 4 + Math.max(0, (rpg ?? 4) - 4) / 12) / 2, 0, 1);
  const guardRole = position === 'G' ? 1 : position === 'F' ? 0.45 : 0.1;
  const driveRate = clamp(
    6 + guardRole * 10 + freeThrowPressure * 22 + (usageVal - 18) * 0.25,
    3,
    35,
  );
  const postUpRate = clamp(
    3 + interiorRole * 18 + (1 - threeRate) * (position === 'C' ? 7 : 2),
    2,
    32,
  );
  const rimFrequency = clamp(
    12 + freeThrowPressure * 25 + interiorRole * 16 + guardRole * 2,
    8,
    48,
  );
  const nonThreeShare = clamp(100 - threeRate * 100 - rimFrequency, 5, 80);
  const longMidShare = clamp(nonThreeShare * (0.34 + guardRole * 0.12), 4, 30);
  const shortMidShare = clamp(nonThreeShare - longMidShare, 5, 35);
  const cornerShare = clamp(threeRate * 100 * (0.28 + (1 - assistRole) * 0.18), 0, 35);
  const aboveBreakShare = clamp(threeRate * 100 - cornerShare, 0, 55);
  t('driveRate', driveRate, fta !== null ? 'derived' : 'estimated', [
    'fta',
    'fga',
    'usageRate',
    'position',
  ]);
  t('postUpRate', postUpRate, oreb.kind === 'observed' ? 'derived' : 'estimated', [
    'offensiveRebounds',
    'rebounds',
    'tpa',
    'fga',
    'position',
  ]);
  t('rimFrequency', rimFrequency, fta !== null ? 'derived' : 'estimated', [
    'fta',
    'fga',
    'offensiveRebounds',
    'position',
  ]);
  t('shortMidFrequency', shortMidShare, fga !== null ? 'derived' : 'estimated', [
    'fga',
    'tpa',
    'fta',
    'position',
  ]);
  t('longMidFrequency', longMidShare, fga !== null ? 'derived' : 'estimated', [
    'fga',
    'tpa',
    'fta',
    'position',
  ]);
  t('cornerThreeFrequency', cornerShare, tpa !== null ? 'derived' : 'estimated', [
    'tpa',
    'fga',
    'assists',
  ]);
  t('aboveBreakThreeFrequency', aboveBreakShare, tpa !== null ? 'derived' : 'estimated', [
    'tpa',
    'fga',
    'assists',
  ]);
  if (reconstructedThreePoint !== undefined) {
    t('threePointRate', reconstructedThreePoint.attemptRateConservative * 100, 'reconstructed', [
      ...reconstructedThreePoint.evidence.sourceFields,
      'model',
    ]);
    const entry = provenance['threePointRate'];
    if (entry !== undefined) {
      entry.confidence = reconstructedThreePoint.confidence;
      entry.notesCode = THREE_POINT_RECONSTRUCTION_VERSION;
    }
  } else if (!fieldPublished('threesAttempted', input.season)) {
    t('threePointRate', 0, 'estimated', ['prior']);
  } else if (tpa !== null && fga !== null && fga > 0) {
    t('threePointRate', (tpa / fga) * 100, 'derived', ['tpa', 'fga']);
  } else {
    t(
      'threePointRate',
      priors.threePointRatePrior * 100 * Math.min(1, input.era.league3PARate / 0.39),
      'estimated',
      ['prior'],
    );
  }
  if (fta !== null && fga !== null && fga > 0) {
    t('freeThrowRate', (fta / fga) * 100, 'derived', ['fta', 'fga']);
  } else if (fta !== null && fgaPerGame !== null && fgaPerGame > 0) {
    t('freeThrowRate', Math.min(50, (fta / Math.max(1, gp) / fgaPerGame) * 100), 'derived', [
      'fta',
      'fga',
    ]);
  } else {
    t('freeThrowRate', clamp(usageVal * 1.2, 10, 50), 'estimated', ['usageRate', 'prior']);
  }
  const possessionDenom = (fga ?? 0) + 0.44 * (fta ?? 0) + (totals.turnovers ?? 0);
  if (totals.turnovers !== null && possessionDenom > 0) {
    t('turnoverRate', (totals.turnovers / possessionDenom) * 100, 'derived', [
      'turnovers',
      'fga',
      'fta',
    ]);
  } else {
    t('turnoverRate', (usageVal / 20) * 12 + 4, 'estimated', ['usageRate', 'prior']);
  }
  t(
    'isolationRate',
    clamp((usageVal - 10) * (0.22 + guardRole * 0.12), 1, 18),
    usage !== null ? 'derived' : 'estimated',
    ['usageRate', 'position'],
  );
  t(
    'pickAndRollBallHandlerRate',
    clamp(8 + guardRole * 13 + assistRole * 17 + Math.max(0, usageVal - 20) * 0.45, 5, 45),
    apg !== null ? 'derived' : 'estimated',
    ['assists', 'usageRate', 'position'],
  );
  t(
    'pickAndRollRollManRate',
    clamp(5 + interiorRole * 22 + (position === 'C' ? 5 : 0), 3, 35),
    oreb.kind === 'observed' ? 'derived' : 'estimated',
    ['offensiveRebounds', 'rebounds', 'position'],
  );
  t(
    'spotUpRate',
    clamp(9 + threeRate * 34 + (1 - clamp(usageVal / 32, 0, 1)) * 10, 7, 32),
    tpa !== null ? 'derived' : 'estimated',
    ['tpa', 'fga', 'usageRate'],
  );
  t(
    'transitionRate',
    clamp(7 + (ratings.speed - 50) * 0.3 + spg.value * 1.2, 5, 28),
    spg.kind === 'observed' ? 'derived' : 'estimated',
    ['speed', 'steals'],
  );
  t(
    'cutRate',
    clamp(5 + (1 - clamp(usageVal / 32, 0, 1)) * 8 + interiorRole * 6, 4, 22),
    usage !== null ? 'derived' : 'estimated',
    ['usageRate', 'offensiveRebounds', 'rebounds'],
  );
  t(
    'foulRate',
    2 + ((totals.fouls ?? 0) / Math.max(1, minutes)) * 48,
    (totals.fouls ?? 0) > 0 ? 'derived' : 'estimated',
    ['fouls'],
  );
  t('stealAttemptRate', 5 + ratings.steal * 0.08, 'derived', ['steal']);
  t('blockAttemptRate', 5 + ratings.block * 0.08, 'derived', ['block']);
  t('crashOffensiveGlassRate', 10 + ratings.offensiveRebound * 0.12, 'derived', [
    'offensiveRebound',
  ]);
  const games = Math.max(1, gp);
  const threePointAttemptRate = tpa !== null && fga !== null && fga > 0 ? tpa / fga : null;
  const freeThrowAttemptRate = fta !== null && fga !== null && fga > 0 ? fta / fga : 0;
  unclamped['anchor:freeThrowAttemptRate'] = freeThrowAttemptRate;
  const anchors: SimulationAnchors = {
    gamesPlayed: gp,
    minutesPerGame: Math.min(60, mpg),
    pointsPerGame: ppg ?? 0,
    reboundsPerGame: rpg ?? 0,
    offensiveReboundsPerGame: oreb.value,
    defensiveReboundsPerGame: dreb.value,
    assistsPerGame: apg ?? 0,
    stealsPerGame: spg.value,
    blocksPerGame: bpg.value,
    turnoversPerGame:
      totals.turnovers !== null ? totals.turnovers / games : (priors.turnoversPer36 * mpg) / 36,
    fieldGoalPct: fgPct ?? 0.45,
    threePointPct: threePct,
    freeThrowPct: ftPct ?? 0.75,
    threePointAttemptRate: clampUnitInterval(threePointAttemptRate) ?? null,
    freeThrowAttemptRate: clampUnitInterval(Math.min(1, freeThrowAttemptRate)) ?? 0,
    threePointPctShrunk: threePctShrunk,
    freeThrowPctShrunk: ftPctShrunk,
    threePointPctPrior: ratePriors.threePointPctPrior,
    freeThrowPctPrior: ratePriors.freeThrowPctPrior,
    rateShrinkAttempts: 80,
  };
  const v3 = deriveRatingProfile({
    ratings,
    tendencies,
    stats: input.stats,
    position: input.position,
    heightInches: input.heightInches,
    playerId:
      input.playerId ??
      (typeof input.stats.playerExternalId === 'string' ? input.stats.playerExternalId : undefined),
    artifact: input.artifact ?? DEFAULT_RATINGS_MODEL_ARTIFACT,
    teamWinPct: input.teamWinPct,
  });
  const summaryRatings: SummaryRatings = v3.summaryRatings;
  return {
    ratings,
    tendencies,
    anchors,
    summaryRatings,
    ratingProfile: v3.profile,
    provenance,
    unclamped,
    methods,
    ...(reconstructedThreePoint !== undefined ? { reconstructedThreePoint } : {}),
  };
}
