/**
 * Versioned field-method registry and deterministic ratings/tendencies/
 * anchors derivation (spec/11, spec/12).
 *
 * Derivation ladder per required field (first valid method wins):
 *   1. observed      - validated source observation
 *   2. derived       - exact deterministic formula from observed inputs
 *   3. reconstructed - sample-size-adjusted reconstruction from the same
 *                      player-season context
 *   4. interpolated  - adjacent-season interpolation (career context)
 *   5. shrunk        - shrinkage toward a position-era-role prior
 *
 * Rules:
 *   - No random jitter: every value is a pure function of versioned inputs.
 *   - Missing inputs never become zero unless zero is a real rule or
 *     observation (pre-1979 three-point play is not-applicable, not zero).
 *   - Unclamped diagnostic values are retained alongside final values.
 *   - Ability (ratings), evidenced behavior (tendencies), and season
 *     production (anchors) stay distinct.
 */
import {
  DERIVATION_METHOD_VERSION,
  SOURCE_VERSION,
  type Confidence,
  type ProvenanceKind,
  type ProvenanceMap,
  type SimulationAnchors,
  type SimulationRatings,
  type SimulationTendencies,
  type SummaryRatings,
} from '@hoop-rush/data-contracts';
import { clamp, clampRating, clampUnitInterval, safeFloat } from '../json.js';
import { FIELD_AVAILABILITY } from '../config.js';
import { computeSummaryRatings, computeRealOverall } from './summary.js';
import type { StatsRow } from './stats.js';

/** League context used for era-relative translation (spec/12 environment). */
export interface SeasonContext {
  leaguePpg: number;
  league3PARate: number;
  pace: number;
}

export interface DerivationInput {
  season: string;
  /** Mapped detailed position (PG/SG/SF/PF/C). */
  position: string;
  heightInches: number | null;
  stats: StatsRow;
  era: SeasonContext;
}

export interface DerivedRecord {
  ratings: SimulationRatings;
  tendencies: SimulationTendencies;
  anchors: SimulationAnchors;
  summaryRatings: SummaryRatings;
  /** Field-level provenance keyed by packaged field name. */
  provenance: ProvenanceMap;
  /** Unclamped diagnostic values per final field (spec/12 clamp rule). */
  unclamped: Record<string, number>;
  /** Methods chosen per final field. */
  methods: Record<string, ProvenanceKind>;
}

/** Versioned position-era-role priors (shrinkage targets; never tuned per player). */
export interface PriorTable {
  stealsPer36: number;
  blocksPer36: number;
  turnoversPer36: number;
  offensiveReboundsPer36: number;
  defensiveReboundsPer36: number;
  threePointRatePrior: number;
}

export const POSITION_PRIORS: Readonly<Record<string, Readonly<PriorTable>>> = {
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

export const PRIOR_VERSION = 'priors-v1';

/** Whether the source publishes the field for this season (spec/12 table). */
export function fieldPublished(field: string, season: string): boolean {
  const boundary = FIELD_AVAILABILITY[field];
  if (boundary === undefined) return true;
  return season >= boundary;
}

function confidenceFor(kind: ProvenanceKind): Confidence {
  switch (kind) {
    case 'observed':
      return 'high';
    case 'derived':
      return 'medium';
    default:
      return 'low';
  }
}

/** Null-preserving season totals. */
export interface SeasonTotals {
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
}

export function seasonTotals(stats: StatsRow): SeasonTotals {
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
  };
}

interface Resolved {
  value: number;
  kind: ProvenanceKind;
  fields: string[];
}

/**
 * Resolves one counting stat with the ladder: observed when the source
 * publishes the field and the row carries a value; reconstructed from
 * per-minute context; shrunk toward the position-era-role prior.
 */
function resolveCounting(
  observed: number | null,
  published: boolean,
  priorPer36: number,
  minutes: number,
  games: number,
  fields: string[],
): Resolved {
  if (published && observed !== null && games > 0) {
    return { value: observed / games, kind: 'observed', fields };
  }
  const perGame = minutes / Math.max(1, games);
  const reconstructed = (priorPer36 * perGame) / 36;
  const priorMinutes = 1500;
  const weight = minutes / Math.max(1, minutes + priorMinutes);
  return {
    value: reconstructed * weight + priorPer36 * (1 - weight),
    kind: 'estimated',
    fields: [...fields, 'prior'],
  };
}

function perGame(total: number | null, games: number): number | null {
  if (total === null || games <= 0) return null;
  return total / games;
}

/**
 * Derives the complete strict record for one player-season. Every packaged
 * field gets a deterministic method, provenance, and unclamped diagnostic.
 */
export function derivePlayerRecord(input: DerivationInput): DerivedRecord {
  const totals = seasonTotals(input.stats);
  const { gamesPlayed: gp, minutes } = totals;
  const detailPos = input.position;
  const position =
    detailPos === 'PG' || detailPos === 'SG'
      ? 'G'
      : detailPos === 'PF' || detailPos === 'SF'
        ? 'F'
        : 'C';
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

  /** Rating key -> source field family used for availability (spec/12). */
  const RATING_SOURCE_FIELD: Readonly<Record<string, string>> = {
    steal: 'steals',
    block: 'blocks',
    offensiveRebound: 'offensiveRebounds',
    defensiveRebound: 'defensiveRebounds',
    threePoint: 'threesAttempted',
    freeThrow: 'freeThrowsAttempted',
  };

  const record = (key: string, value: number, kind: ProvenanceKind, fields: string[]): void => {
    unclamped[key] = value;
    methods[key] = kind;
    const sourceField = RATING_SOURCE_FIELD[key] ?? key;
    provenance[key] = {
      kind,
      confidence: confidenceFor(kind),
      methodVersion: DERIVATION_METHOD_VERSION,
      sourceVersion: SOURCE_VERSION,
      sourceFields: fields,
      sourceStatus: fieldPublished(sourceField, input.season) ? undefined : 'not-applicable',
    };
  };

  const ppg = perGame(totals.points, gp);
  const rpg = perGame(totals.rebounds, gp);
  const apg = perGame(totals.assists, gp);
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
  const oreb = resolveCounting(
    totals.offensiveRebounds,
    fieldPublished('offensiveRebounds', input.season),
    priors.offensiveReboundsPer36,
    minutes,
    gp,
    ['offensiveRebounds'],
  );
  const dreb = resolveCounting(
    totals.defensiveRebounds,
    fieldPublished('defensiveRebounds', input.season),
    priors.defensiveReboundsPer36,
    minutes,
    gp,
    ['defensiveRebounds'],
  );
  const mpg = gp > 0 ? minutes / gp : 0;

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
  const tsPct = clampUnitInterval(totals.tsPct);
  const efgPct = clampUnitInterval(totals.efgPct);
  const per = totals.per;
  const bpm = totals.boxPlusMinus;
  const usage = totals.usageRate;

  const ppgNorm = ppg !== null ? ppg * (114.7 / Math.max(1, input.era.leaguePpg)) : null;

  const weight = clamp(0.6 * Math.min(1, minutes / 1500) + 0.4 * Math.min(1, gp / 45), 0, 1);
  const blend = (raw: number, mean: number): number => raw * weight + mean * (1 - weight);

  const tsComponent = tsPct !== null ? (tsPct - 0.5) * 60 : 0;
  const ftComponent = ftPct !== null ? (ftPct - 0.7) * 15 : 0;

  // Three-point skill: observed three-point shooting when available; else a
  // conservative spacing estimate from free-throw evidence (estimated).
  let threeRaw: number;
  let threeKind: ProvenanceKind;
  let threeFields: string[];
  if (tpa !== null && tpa > 0 && threePct !== null) {
    threeRaw = 58 + tsComponent + (threePct - 0.3) * 140 + ftComponent;
    threeKind = 'derived';
    threeFields = ['tpm', 'tpa', 'tsPct', 'ftm', 'fta'];
  } else if (ftPct !== null) {
    threeRaw = 52 + ftComponent * 1.2 - (position === 'C' ? 8 : 0);
    threeKind = 'estimated';
    threeFields = ['ftm', 'fta'];
  } else {
    threeRaw = 45;
    threeKind = 'estimated';
    threeFields = ['prior'];
  }
  record('threePoint', blend(threeRaw, 54), threeKind, threeFields);

  const freeThrowRaw = ftPct !== null ? 50 + (ftPct - 0.5) * 120 : 62;
  record('freeThrow', blend(freeThrowRaw, 69), ftPct !== null ? 'derived' : 'estimated', [
    'ftm',
    'fta',
  ]);

  const insideRaw =
    60 +
    ((ppgNorm ?? 10) - 14) * 2.2 +
    (tsPct ?? 0.48) * 35 +
    (position === 'C' || position === 'F' ? 4 : -2);
  record('insideScoring', blend(insideRaw, 54), ppg !== null ? 'derived' : 'estimated', [
    'points',
    'tsPct',
  ]);

  record(
    'closeShot',
    blend(60 + ((ppg ?? 10) - 10) * 1.5, 59),
    ppg !== null ? 'derived' : 'estimated',
    ['points'],
  );
  const midPct = efgPct ?? fgPct;
  record(
    'midrange',
    blend(60 + ((midPct ?? 0.47) - 0.48) * 100, 54),
    midPct !== null ? 'derived' : 'estimated',
    ['fgm', 'fga', 'tpm', 'tpa'],
  );

  const passRaw = 60 + ((apg ?? 3) - 3) * 5 + (per ?? 12) * 0.6;
  record('passing', blend(passRaw, 54), apg !== null ? 'derived' : 'estimated', ['assists', 'per']);
  // Usage alone systematically underrates pass-first creators. Assist volume
  // is a direct creation/handle signal, especially for historical guards whose
  // usage models are reconstructed less reliably than their box score.
  const creationRaw = 60 + ((usage ?? 16) - 16) * 0.6 + ((apg ?? 3) - 3) * 3.0 + (per ?? 12) * 0.15;
  record(
    'ballHandling',
    blend(creationRaw, 54),
    apg !== null || usage !== null ? 'derived' : 'estimated',
    ['assists', 'usageRate', 'per'],
  );

  const rebRaw = 60 + ((rpg ?? 4) - 4) * 5;
  // Before rebound splits were published, total rebounds are still strong
  // evidence. The old path discarded them and shrank elite rebounders toward
  // a generic prior, badly understating Russell-era centers.
  const reboundEvidence = rpg !== null && (oreb.kind !== 'observed' || dreb.kind !== 'observed');
  record(
    'offensiveRebound',
    blend(rebRaw * 0.7, 45),
    oreb.kind === 'observed' ? 'derived' : oreb.kind,
    reboundEvidence ? ['rebounds', ...oreb.fields] : oreb.fields,
  );
  record(
    'defensiveRebound',
    blend(rebRaw * 1.1, 59),
    dreb.kind === 'observed' ? 'derived' : dreb.kind,
    reboundEvidence ? ['rebounds', ...dreb.fields] : dreb.fields,
  );

  const stock = spg.value * 7 + bpg.value * 7;
  const defRaw = 60 + stock + (bpm ?? 0) * 1.8;
  const defensiveKind: ProvenanceKind =
    spg.kind === 'observed' && bpg.kind === 'observed' ? 'derived' : 'estimated';
  record('perimeterDefense', blend(defRaw, 54), defensiveKind, [
    'steals',
    'blocks',
    'boxPlusMinus',
  ]);
  const interior = position === 'C' || position === 'F' ? defRaw + 5 : defRaw - 3;
  record(
    'interiorDefense',
    blend(interior, position === 'C' || position === 'F' ? 59 : 49),
    defensiveKind,
    ['steals', 'blocks', 'boxPlusMinus'],
  );
  record(
    'steal',
    blend(60 + spg.value * 10, 54),
    spg.kind === 'observed' ? 'derived' : spg.kind,
    spg.fields,
  );
  record(
    'block',
    blend(60 + bpg.value * 12, 49),
    bpg.kind === 'observed' ? 'derived' : bpg.kind,
    bpg.fields,
  );
  const reboundDefenseSignal = rpg !== null ? Math.max(0, rpg - 8) * 0.8 : 0;
  record(
    'defensiveIq',
    blend(60 + (bpm ?? 0) * 2.0 + reboundDefenseSignal, 59),
    bpm !== null ? 'derived' : 'estimated',
    bpm !== null ? ['boxPlusMinus', 'rebounds'] : ['rebounds', 'prior'],
  );

  const ath = 60 + ((usage ?? 18) - 18) * 0.5 + mpg * 0.5 + (per ?? 12) * 0.7;
  record(
    'speed',
    blend(ath + (position === 'G' ? 5 : 0), 59),
    usage !== null ? 'derived' : 'estimated',
    ['usageRate', 'minutes'],
  );
  record(
    'strength',
    blend(
      position === 'C' || position === 'F' ? ath + 5 : ath,
      position === 'C' || position === 'F' ? 64 : 54,
    ),
    usage !== null ? 'derived' : 'estimated',
    ['usageRate', 'minutes'],
  );
  record('vertical', blend(60 + (position === 'C' ? 5 : 0), 54), 'estimated', ['prior']);

  record(
    'offensiveIq',
    blend(60 + (per ?? 12) * 1.0 + (bpm ?? 0) * 2.0, 59),
    per !== null && bpm !== null ? 'derived' : 'estimated',
    ['per', 'boxPlusMinus'],
  );

  const ratings = {} as SimulationRatings;
  for (const key of Object.keys(provenance)) {
    const raw = unclamped[key];
    if (raw !== undefined) ratings[key as keyof SimulationRatings] = clampRating(raw);
  }

  // --- Tendencies (evidenced behavior) -----------------------------------
  const tendencies = {} as SimulationTendencies;
  const t = (key: string, raw: number, kind: ProvenanceKind, fields: string[]): void => {
    const value = clamp(raw, 0, 100);
    unclamped[`tendency:${key}`] = raw;
    methods[key] = kind;
    provenance[key] = {
      kind,
      confidence: confidenceFor(kind),
      methodVersion: DERIVATION_METHOD_VERSION,
      sourceVersion: SOURCE_VERSION,
      sourceFields: fields,
      sourceStatus: fieldPublished(key, input.season) ? undefined : 'not-applicable',
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
  t('driveRate', 10 + (position === 'G' ? 8 : 0), 'estimated', ['prior']);
  t('postUpRate', 5 + (position === 'C' || position === 'F' ? 8 : 0), 'estimated', ['prior']);
  t('rimFrequency', (ratings.insideScoring / 100) * 40, 'derived', ['insideScoring']);
  t('shortMidFrequency', 15, 'estimated', ['prior']);
  t('longMidFrequency', 10, 'estimated', ['prior']);
  t('cornerThreeFrequency', (ratings.threePoint / 100) * 12, 'derived', ['threePoint']);
  t('aboveBreakThreeFrequency', (ratings.threePoint / 100) * 20, 'derived', ['threePoint']);

  // Three-point volume tendency: pre-1979 the shot did not exist (league
  // rule, not-applicable). From 1979-80 the rate is observed; absent
  // evidence shrinks toward the position-era prior scaled by league rate.
  if (!fieldPublished('threesAttempted', input.season)) {
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

  t('isolationRate', usageVal * 0.3, usage !== null ? 'derived' : 'estimated', ['usageRate']);
  t('pickAndRollBallHandlerRate', 20 + (position === 'G' ? 15 : 0), 'estimated', ['prior']);
  t('pickAndRollRollManRate', 10 + (position === 'C' ? 15 : 0), 'estimated', ['prior']);
  t('spotUpRate', 20, 'estimated', ['prior']);
  t('transitionRate', 15, 'estimated', ['prior']);
  t('cutRate', 10, 'estimated', ['prior']);
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

  // --- Anchors (season production) ----------------------------------------
  const games = Math.max(1, gp);
  const threePointAttemptRate = tpa !== null && fga !== null && fga > 0 ? tpa / fga : 0;
  const freeThrowAttemptRate = fta !== null && fga !== null && fga > 0 ? fta / fga : 0;
  // Anchor shares are consumed as 0..1 probabilities; a player with more
  // free throws than field-goal attempts saturates at 1.0 (unclamped value
  // retained in diagnostics).
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
    threePointAttemptRate: clampUnitInterval(threePointAttemptRate) ?? 0,
    freeThrowAttemptRate: clampUnitInterval(Math.min(1, freeThrowAttemptRate)) ?? 0,
  };

  const skillSummary = computeSummaryRatings(ratings, tendencies);
  const summaryRatings: SummaryRatings = {
    offenseRating: skillSummary.offenseRating,
    defenseRating: skillSummary.defenseRating,
    overallRating: computeRealOverall(ratings, position, input.stats, input.heightInches),
  };

  return {
    ratings,
    tendencies,
    anchors,
    summaryRatings,
    provenance,
    unclamped,
    methods,
  };
}
