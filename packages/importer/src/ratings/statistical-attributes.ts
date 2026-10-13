import type {
  Confidence,
  ProvenanceKind,
  SimulationRatings,
  ReconstructedThreePointProfile,
} from '@hoop-rush/data-contracts';
import { clamp } from '../json.ts';
import {
  observed,
  possessionExposure,
  ratePer100,
  shootingRate,
  stabilizedRate,
  effectiveTrueShooting,
  usageFor,
} from './season-evidence.ts';
import type { DerivationInput } from './v2.ts';

export interface AttributeEstimate {
  value: number;
  kind: ProvenanceKind;
  fields: string[];
  confidence: Confidence;
  notesCode: string;
}

export function estimateAttributes(
  input: DerivationInput,
  reconstructed?: ReconstructedThreePointProfile,
): Record<keyof SimulationRatings, AttributeEstimate> {
  const { stats } = input;
  const pace = input.era.pace;
  const exposure = possessionExposure(stats, pace);
  const sample = exposure >= 1500 ? 'high' : exposure >= 400 ? 'medium' : 'low';
  const group =
    input.position === 'PG' || input.position === 'SG' ? 'G' : input.position === 'C' ? 'C' : 'F';
  const estimate = (
    value: number,
    fields: string[],
    kind: ProvenanceKind = 'derived',
    evidenceSample = exposure,
  ): AttributeEstimate => ({
    value: clamp(value, 0, 100),
    kind,
    fields,
    confidence:
      kind === 'estimated' || kind === 'reconstructed'
        ? 'low'
        : evidenceSample >= 1500
          ? 'high'
          : evidenceSample >= 400
            ? 'medium'
            : 'low',
    notesCode: kind === 'estimated' ? 'statistical-prior-v1' : 'attribute-evidence-v1',
  });
  const rate = (key: string, prior: number, priorExposure = 150) =>
    stabilizedRate(stats, key, prior, pace, priorExposure);
  const available = (key: string) => observed(stats, key) !== null;
  const usage = usageFor(stats, pace);
  const assists = rate('assists', 4.5);
  const secondary = rate('secondaryAssists', 0);
  const potential = rate('potentialAssists', assists);
  const creation = assists + secondary * 0.4 + Math.max(0, potential - assists) * 0.15;
  const turnovers = rate('turnovers', 3);
  const expectedTurnovers = 1.5 + usage * 0.045 + creation * 0.12;
  const security = clamp((expectedTurnovers - turnovers) * 5, -12, 12);
  const ts = effectiveTrueShooting(stats, input.era.league3PARate);
  const scoring = rate('points', 22, 200);
  const ft = shootingRate(stats, 'ftm', 'fta', input.ratePriors?.freeThrowPctPrior ?? 0.76, 35);
  const ftRating = ft === null ? 68 : ft * 100;
  const zone = (
    made: string,
    attempted: string,
    prior: number,
    slope: number,
    fallback: number,
  ) => {
    const accuracy = shootingRate(stats, made, attempted, prior, 60);
    const volume = ratePer100(stats, attempted, pace);
    return accuracy === null
      ? estimate(fallback, ['fgm', 'fga', 'ftm', 'fta', 'points', 'minutes'], 'estimated')
      : estimate(
          65 + (accuracy - prior) * slope + Math.min(8, (volume ?? 0) * 0.5),
          [made, attempted, 'minutes'],
          'derived',
          (observed(stats, attempted) ?? 0) * 4,
        );
  };
  const fg2 =
    shootingRate(
      {
        ...stats,
        twoMade: available('fgm')
          ? (observed(stats, 'fgm') ?? 0) - (observed(stats, 'tpm') ?? 0)
          : null,
        twoAttempted: available('fga')
          ? (observed(stats, 'fga') ?? 0) - (observed(stats, 'tpa') ?? 0)
          : null,
      },
      'twoMade',
      'twoAttempted',
      0.51,
      60,
    ) ?? 0.51;
  const insideFallback = 62 + Math.max(0, scoring - 22) * 1.4 + ((ts ?? 0.565) - 0.565) * 100;
  const three = shootingRate(
    stats,
    'tpm',
    'tpa',
    input.ratePriors?.threePointPctPrior ?? 0.35,
    100,
  );
  const threeEraCorrection = clamp(
    (0.355 - Math.min(0.355, 0.31 + input.era.league3PARate * 0.15)) * 0.25,
    0,
    0.01,
  );
  const threeEstimate =
    three === null
      ? estimate(
          reconstructed === undefined
            ? 30 + (ft ?? 0.7) * 25
            : 65 + (reconstructed.accuracyConservative - 0.355) * 300,
          reconstructed?.evidence.sourceFields ?? ['ftm', 'fta'],
          reconstructed === undefined ? 'estimated' : 'reconstructed',
        )
      : estimate(
          62 + (three + threeEraCorrection - 0.355) * 300 + Math.min(4, rate('tpa', 0) * 0.4),
          ['tpm', 'tpa', 'minutes'],
          'derived',
          (observed(stats, 'tpa') ?? 0) * 4,
        );
  const rebound = (key: string, chances: string, prior: number, slope: number) => {
    const chance = observed(stats, chances);
    const collected = observed(stats, key);
    const chanceAdjustment =
      chance !== null && collected !== null && chance > 0
        ? clamp((collected / chance - (key === 'offensiveRebounds' ? 0.45 : 0.65)) * 15, -5, 5)
        : 0;
    const fallback =
      (ratePer100(stats, 'rebounds', pace) ?? 9) * (key === 'offensiveRebounds' ? 0.25 : 0.75);
    return estimate(
      (key === 'offensiveRebounds' ? 48 : 60) +
        ((collected === null ? fallback : rate(key, prior)) - prior) * slope +
        chanceAdjustment,
      collected === null
        ? ['rebounds', 'minutes']
        : [key, 'minutes', ...(chance !== null ? [chances] : [])],
      collected === null ? 'estimated' : 'derived',
    );
  };
  const steals = rate('steals', group === 'G' ? 1.6 : 1.1);
  const blocks = rate('blocks', group === 'C' ? 2 : 0.7);
  const fouls = rate('fouls', 3.8);
  const rimPct = observed(stats, 'defFgPct');
  const rimAttempts = observed(stats, 'defRimFga');
  const rimBaseline = observed(stats, 'leagueRimFgPct') ?? 0.62;
  const rimMargin =
    rimPct !== null && rimAttempts !== null && rimAttempts > 0
      ? ((rimBaseline - rimPct) * rimAttempts) / (rimAttempts + 100)
      : null;
  const interiorBase = group === 'C' ? 65 : group === 'F' ? 58 : 45;
  const blockReference = group === 'C' ? 2 : group === 'F' ? 1 : 0.5;
  const blockContainment = interiorBase + clamp((blocks - blockReference) * 12, -10, 35);
  const interior =
    rimMargin === null
      ? blockContainment
      : 0.6 * blockContainment + 0.4 * (interiorBase + clamp(rimMargin * 140, -15, 15));
  const deflections = ratePer100(stats, 'deflections', pace);
  const contests = ratePer100(stats, 'contestedShots3pt', pace);
  const hasPerimeter = deflections !== null || contests !== null;
  const perimeter = hasPerimeter
    ? 60 +
      clamp(((deflections ?? 2.5) - 2.5) * 5, -10, 14) +
      clamp(((contests ?? 3) - 3) * 2, -6, 8)
    : 59 + clamp((steals - 1.5) * 8, -10, 16);
  const boxouts = ratePer100(stats, 'boxOuts', pace);
  const defensiveDiscipline =
    72 +
    clamp((3.8 - fouls) * 3, -12, 8) +
    (boxouts === null ? 0 : clamp((boxouts - 1.5) * 2, -3, 6));
  const drives = ratePer100(stats, 'drives', pace);
  const speed = observed(stats, 'avgSpeed');
  const height = input.heightInches ?? 78;
  const mass =
    input.weightLbs != null && input.weightLbs > 0 ? input.weightLbs * (78 / height) ** 2 : null;
  const jump = observed(stats, 'maxVerticalInches');
  const result: Record<keyof SimulationRatings, AttributeEstimate> = {
    insideScoring: zone('insideFgm', 'insideFga', 0.6, 200, insideFallback),
    closeShot: zone('closeFgm', 'closeFga', 0.44, 220, 60 + (fg2 - 0.51) * 90),
    midrange: zone('midFgm', 'midFga', 0.42, 260, 35 + (ft ?? 0.72) * 38),
    threePoint: threeEstimate,
    freeThrow: estimate(
      ftRating,
      ft === null ? ['prior'] : ['ftm', 'fta'],
      ft === null ? 'estimated' : 'derived',
      (observed(stats, 'fta') ?? 0) * 6,
    ),
    passing: estimate(
      60 + (Math.min(creation, 10) - 4.5) * 3.8 + Math.sqrt(Math.max(0, creation - 10)) * 3,
      [
        'assists',
        'minutes',
        ...(available('potentialAssists') ? ['potentialAssists'] : []),
        ...(available('secondaryAssists') ? ['secondaryAssists'] : []),
      ],
      available('assists') ? 'derived' : 'estimated',
    ),
    ballHandling: estimate(
      60 +
        clamp((usage - 18) * 1.1, -10, 18) +
        security +
        (drives === null ? 0 : clamp((drives - 5) * 0.5, -3, 6)),
      ['fga', 'fta', 'turnovers', 'minutes', ...(drives === null ? [] : ['drives'])],
      available('turnovers') ? 'derived' : 'estimated',
    ),
    offensiveIq: estimate(
      65 +
        security +
        clamp(((ts ?? 0.565) - 0.565) * 55, -8, 8) +
        clamp((creation / Math.max(12, usage) - 0.2) * 25, -5, 5),
      ['assists', 'turnovers', 'fga', 'fta', 'tsPct', 'minutes'],
      available('turnovers') ? 'derived' : 'estimated',
    ),
    offensiveRebound: rebound('offensiveRebounds', 'offRebChances', 2.3, 6),
    defensiveRebound: rebound('defensiveRebounds', 'defRebChances', 6.5, 5),
    interiorDefense: estimate(
      interior,
      rimMargin === null
        ? ['blocks', 'minutes', 'position']
        : ['defFgPct', 'defRimFga', 'blocks', 'minutes', 'position'],
      rimMargin === null ? 'estimated' : 'derived',
      (rimAttempts ?? 0) * 5,
    ),
    perimeterDefense: estimate(
      perimeter,
      hasPerimeter ? ['deflections', 'contestedShots3pt', 'minutes'] : ['steals', 'minutes'],
      'estimated',
    ),
    steal: estimate(
      60 + (steals - 1.5) * 17,
      ['steals', 'minutes'],
      available('steals') ? 'derived' : 'estimated',
    ),
    block: estimate(
      60 + (blocks - 1) * 13,
      ['blocks', 'minutes'],
      available('blocks') ? 'derived' : 'estimated',
    ),
    defensiveIq: estimate(
      defensiveDiscipline,
      ['fouls', 'minutes', ...(boxouts === null ? [] : ['boxOuts'])],
      'estimated',
    ),
    speed: estimate(
      62 +
        (speed === null ? 0 : (speed - 4.25) * 12) +
        (drives === null ? 0 : clamp((drives - 5) * 0.35, -2, 6)),
      speed === null
        ? ['position', ...(drives === null ? [] : ['drives', 'minutes'])]
        : ['avgSpeed', ...(drives === null ? [] : ['drives', 'minutes'])],
      'estimated',
    ),
    strength: estimate(
      mass === null ? 62 : 65 + (mass - 220) * 0.4,
      ['heightInches', 'weightLbs'],
      'estimated',
    ),
    vertical: estimate(
      jump === null ? 62 : 70 + (jump - 28) * 2,
      jump === null ? ['prior'] : ['maxVerticalInches'],
      jump === null ? 'estimated' : 'derived',
      jump === null ? 0 : 1500,
    ),
  };
  for (const estimate of Object.values(result))
    if (estimate.kind === 'derived' && sample === 'low') estimate.confidence = 'low';
  if (reconstructed !== undefined && result.threePoint.kind === 'reconstructed') {
    result.threePoint.confidence = reconstructed.confidence;
    result.threePoint.notesCode = 'three-point-reconstruction-v1';
  }
  return result;
}
