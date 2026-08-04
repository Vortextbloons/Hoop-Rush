import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  SEASON_AI_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_ROTATION_VERSION,
  seasonDraftStateSchema,
  seasonLeagueGenerationResultSchema,
  seasonRosterTargetsSchema,
  seasonRunSchema,
  seedSchema,
  type SeasonDraftState,
  type SeasonLeagueGenerationResult,
  type SeasonRosterCalibrationRun,
  type SeasonRosterTargets,
} from '@hoop-rush/data-contracts';
import type { SeasonStrengthBand } from '@hoop-rush/data-contracts';
import {
  DUO_BAND_QUOTAS,
  SOLO_BAND_QUOTAS,
  SeasonAiGenerationError,
  completionTargetsMet,
  generateAiLeague,
  rotationTargetMinutes,
  seasonGenerationDigest,
  validateSeasonRoster,
} from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.js';
import {
  seasonRostersAuditReportSchema,
  seasonRostersCalibrateReportSchema,
  seasonRostersGenerateReportSchema,
} from '../report-schemas.js';
import { parseCount } from '../args.js';
import {
  DEFAULT_MANIFEST,
  DEFAULT_ROSTER_TARGETS,
  loadSeasonDraftCatalog,
  loadSeasonLeague,
  fixtureHumanRoster,
  readJsonFile,
  sha256Hex,
} from './season-data.js';

/**
 * `season rosters` (spec/2.0 M2.1): deterministic AI league generation,
 * league audit, and the 256+64-seed calibration cohort that freezes
 * `roster-targets-v1`.
 */

export const SEASON_ROSTERS_GENERATE_OPTIONS: Record<string, boolean> = {
  seed: true,
  draft: true,
  out: true,
  manifest: true,
  format: true,
};

export const SEASON_ROSTERS_AUDIT_OPTIONS: Record<string, boolean> = {
  input: true,
  manifest: true,
  'human-franchises': true,
  format: true,
};

export const SEASON_ROSTERS_CALIBRATE_OPTIONS: Record<string, boolean> = {
  workers: true,
  'calibration-seeds': true,
  'validation-seeds': true,
  out: true,
  manifest: true,
  format: true,
};

/** Calibration seed i: the fixed 32-hex-digit sequential cohort (M2.1). */
export function rosterCalibrationSeed(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`calibration seed index must be a nonnegative integer (got ${String(index)})`);
  }
  return index.toString(16).padStart(32, '0');
}

/** Human rosters from a finalized draft state. */
function humanRostersOf(state: SeasonDraftState): Array<{
  franchiseId: string;
  playerVersionIds: string[];
}> {
  return state.participants.map((participant) => ({
    franchiseId: participant.franchiseId,
    playerVersionIds: state.picks
      .filter((pick) => pick.participantId === participant.participantId)
      .map((pick) => pick.playerVersionId),
  }));
}

function readDraftState(path: string): SeasonDraftState {
  const parsed = seasonDraftStateSchema.safeParse(readJsonFile(path));
  if (!parsed.success) {
    throw new Error(
      `draft input fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return parsed.data;
}

export function seasonRostersGenerate(args: {
  seed: string | null;
  draft: string | null;
  out: string | null;
  manifest: string | null;
}): CliReport {
  const seed = args.seed;
  if (seed === null) {
    throw new Error('season rosters generate requires --seed <hex>');
  }
  if (!seedSchema.safeParse(seed).success) {
    return makeReport(
      'season rosters generate',
      { seed, draft: args.draft },
      { failures: [`--seed must be a hex seed (got "${seed}")`], exitCode: 2 },
    );
  }
  if (args.draft === null) {
    throw new Error('season rosters generate requires --draft <draft.json>');
  }
  let state: SeasonDraftState;
  try {
    state = readDraftState(args.draft);
  } catch (error) {
    return makeReport(
      'season rosters generate',
      { seed, draft: args.draft },
      {
        failures: [(error as Error).message],
        exitCode: 2,
      },
    );
  }
  if (state.status !== 'finalized' && state.status !== 'complete') {
    return makeReport(
      'season rosters generate',
      { seed, draft: args.draft },
      {
        failures: [
          `draft state must be finalized (or complete) to generate rosters (got ${state.status})`,
        ],
        exitCode: 2,
      },
    );
  }
  const catalog = loadSeasonDraftCatalog(args.manifest ?? DEFAULT_MANIFEST);
  const humanRosters = humanRostersOf(state);
  let result: SeasonLeagueGenerationResult;
  try {
    result = generateAiLeague({
      seed,
      catalog,
      league: state.league,
      humanFranchiseIds: humanRosters.map((roster) => roster.franchiseId),
      humanRosters,
      targets: null,
    });
  } catch (error) {
    if (error instanceof SeasonAiGenerationError) {
      return makeReport(
        'season rosters generate',
        { seed, draft: args.draft },
        {
          failures: [
            `generation exhausted: ${error.diagnostics.failedTeams.join(', ')} (${error.diagnostics.unmetConstraints.join('; ')})`,
          ],
          exitCode: 1,
        },
      );
    }
    throw error;
  }

  const payload = seasonRostersGenerateReportSchema.parse({
    schemaVersion: 1,
    command: 'season rosters generate',
    seed,
    teams: result.rosters.length,
    ownershipRows: result.ownership.length,
    digest: result.digest,
    diagnostics: result.diagnostics,
    wrote: false,
    outPath: null,
    pass: true,
  });
  const details = [
    `seed ${seed} · ${String(result.rosters.length)} rosters · ${String(result.ownership.length)} ownership rows`,
    `digest ${result.digest}`,
    `diagnostics: generated ${String(result.diagnostics.teamsGenerated)} · repaired ${String(result.diagnostics.teamsRepaired)} · backtracks ${String(result.diagnostics.backtracks)} · nodes ${String(result.diagnostics.nodesVisited)}`,
  ];
  if (args.out !== null) {
    try {
      const target = resolve(args.out);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`);
      payload.wrote = true;
      payload.outPath = target;
      details.push(`wrote ${target}`);
    } catch (error) {
      return makeReport(
        'season rosters generate',
        { seed, draft: args.draft },
        {
          details,
          failures: [`cannot write ${args.out}: ${(error as Error).message}`],
          payload: { ...payload, pass: false },
          exitCode: 1,
        },
      );
    }
  } else {
    details.push('preview only; pass --out <path> to write the result');
  }
  return makeReport(
    'season rosters generate',
    { seed, draft: args.draft },
    {
      details,
      payload,
    },
  );
}

interface AuditedLeague {
  rosters: SeasonLeagueGenerationResult['rosters'];
  ownership: SeasonLeagueGenerationResult['ownership'];
  rotations: SeasonLeagueGenerationResult['rotations'];
  aiAssignments: SeasonLeagueGenerationResult['aiAssignments'];
  evaluations: SeasonLeagueGenerationResult['evaluations'];
  digest: string;
  seed: string;
  aiVersion: string;
  rosterGenerationVersion: string;
  rotationVersion: string;
  humanFranchiseIds: string[];
}

/** Extracts auditable league facts from a run snapshot or bare result. */
function auditedLeagueOf(input: unknown, inputPath: string): AuditedLeague {
  const runParse = seasonRunSchema.safeParse(input);
  if (runParse.success) {
    const run = runParse.data;
    return {
      rosters: run.rosters,
      ownership: run.ownership,
      rotations: run.rotations,
      aiAssignments: run.aiAssignments,
      evaluations: run.evaluations,
      digest: run.generationAudit.digest,
      seed: run.rootSeed,
      aiVersion: run.versions.aiVersion,
      rosterGenerationVersion: run.versions.rosterGenerationVersion,
      rotationVersion: run.versions.rotationVersion,
      humanFranchiseIds: run.draft.participants.map((p) => p.franchiseId),
    };
  }
  const resultParse = seasonLeagueGenerationResultSchema.safeParse(input);
  if (resultParse.success) {
    // Bare results do not record which franchise was human; the audit's
    // quota/identity gates require the --human-franchises option.
    return {
      rosters: resultParse.data.rosters,
      ownership: resultParse.data.ownership,
      rotations: resultParse.data.rotations,
      aiAssignments: resultParse.data.aiAssignments,
      evaluations: resultParse.data.evaluations,
      digest: resultParse.data.digest,
      seed: resultParse.data.seed,
      aiVersion: resultParse.data.aiVersion,
      rosterGenerationVersion: resultParse.data.rosterGenerationVersion,
      rotationVersion: resultParse.data.rotationVersion,
      humanFranchiseIds: [],
    };
  }
  throw new Error(`${inputPath} is neither a season run snapshot nor a league generation result`);
}

export function seasonRostersAudit(args: {
  input: string | null;
  manifest: string | null;
  'human-franchises'?: string | null;
}): CliReport {
  const inputPath = args.input;
  if (inputPath === null) {
    throw new Error('season rosters audit requires --input <league.json>');
  }
  const failures: string[] = [];
  const details: string[] = [];
  let league: AuditedLeague;
  try {
    league = auditedLeagueOf(readJsonFile(inputPath), inputPath);
  } catch (error) {
    return makeReport(
      'season rosters audit',
      { input: inputPath },
      {
        failures: [(error as Error).message],
        exitCode: 2,
      },
    );
  }
  // Bare generation results do not record which franchise was human; pass
  // --human-franchises to enable the quota/identity gates on those inputs.
  const explicitHumans =
    args['human-franchises'] === undefined || args['human-franchises'] === null
      ? null
      : args['human-franchises']
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0);
  const humanFranchiseIds =
    league.humanFranchiseIds.length > 0 ? league.humanFranchiseIds : (explicitHumans ?? []);
  const quotaGatesEnabled = humanFranchiseIds.length > 0;
  if (!quotaGatesEnabled) {
    details.push(
      'quota/identity gates skipped: no human franchise known (pass --human-franchises)',
    );
  }
  const catalog = loadSeasonDraftCatalog(args.manifest ?? DEFAULT_MANIFEST);

  // Ownership: 300 rows, unique, consistent with rosters.
  if (league.ownership.length !== 300) {
    failures.push(`ownership must have 300 rows (got ${String(league.ownership.length)})`);
  }
  const ownedIds = new Set<string>();
  for (const row of league.ownership) {
    if (ownedIds.has(row.playerVersionId)) {
      failures.push(`duplicate ownership of ${row.playerVersionId}`);
    }
    ownedIds.add(row.playerVersionId);
  }
  const rosterOwned = new Set(
    league.rosters.flatMap((roster) => roster.players.map((player) => player.playerVersionId)),
  );
  if (rosterOwned.size !== 300) {
    failures.push(
      `rosters must own exactly 300 distinct versions (got ${String(rosterOwned.size)})`,
    );
  }
  for (const id of rosterOwned) {
    if (!ownedIds.has(id)) failures.push(`roster version ${id} is missing from ownership`);
  }
  for (const id of ownedIds) {
    if (!rosterOwned.has(id)) failures.push(`ownership row ${id} is missing from rosters`);
  }

  // Roster legality and completion targets.
  for (const roster of league.rosters) {
    const members = roster.players.map((player) => {
      const candidate = catalog.candidates.find(
        (c) => c.playerVersionId === player.playerVersionId,
      );
      if (!candidate) {
        throw new Error(`roster references an unknown version ${player.playerVersionId}`);
      }
      return { playerVersionId: player.playerVersionId, playable: candidate.positions.playable };
    });
    const legality = validateSeasonRoster(members);
    if (legality.length > 0) {
      failures.push(`${roster.franchiseId}: ${legality.join('; ')}`);
    }
    if (!completionTargetsMet(members)) {
      failures.push(`${roster.franchiseId}: completion target (4/4/3) missed`);
    }
  }

  // Rotations: 240 minutes, closing five, partition.
  for (const rotation of league.rotations) {
    if (rotationTargetMinutes(rotation) !== 240) {
      failures.push(`${rotation.franchiseId}: rotation minutes must total 240`);
    }
    if (rotation.closingFive.join() !== rotation.starters.join()) {
      failures.push(`${rotation.franchiseId}: M2.1 closing five must equal the starters`);
    }
    const all = [...rotation.starters, ...rotation.benchOrder];
    if (new Set(all).size !== 10) {
      failures.push(`${rotation.franchiseId}: rotation references duplicate players`);
    }
  }

  // Band quotas and identity counts over AI rows only.
  const humanSet = new Set(humanFranchiseIds);
  const aiRows = league.aiAssignments.filter((a) => !humanSet.has(a.franchiseId));
  const quotas = aiRows.length === 29 ? SOLO_BAND_QUOTAS : DUO_BAND_QUOTAS;
  if (quotaGatesEnabled) {
    if (aiRows.length !== 29 && aiRows.length !== 28) {
      failures.push(`expected 29 or 28 AI rows (got ${String(aiRows.length)})`);
    }
    const bandCounts: Record<string, number> = {
      contender: 0,
      playoff: 0,
      average: 0,
      weaker: 0,
    };
    const identityCounts = new Map<string, number>();
    for (const row of aiRows) {
      bandCounts[row.band] = (bandCounts[row.band] ?? 0) + 1;
      identityCounts.set(row.identity, (identityCounts.get(row.identity) ?? 0) + 1);
    }
    for (const band of ['contender', 'playoff', 'average', 'weaker'] as const) {
      if (bandCounts[band] !== quotas[band]) {
        failures.push(
          `${band} quota must be ${String(quotas[band])} (got ${String(bandCounts[band])})`,
        );
      }
    }
    const identityValues = [...identityCounts.values()].sort((a, b) => a - b);
    if (identityValues.length !== 6) {
      failures.push(`all six identities must appear (got ${String(identityValues.length)})`);
    } else if ((identityValues[5] ?? 0) - (identityValues[0] ?? 0) > 1) {
      failures.push('identity counts must differ by no more than one');
    }
  }

  // Role coverage and versions.
  for (const evaluation of league.evaluations) {
    if (evaluation.rolesCovered.length !== 8) {
      failures.push(
        `${evaluation.franchiseId}: covers ${String(evaluation.rolesCovered.length)}/8 roles`,
      );
    }
  }
  if (league.aiVersion !== SEASON_AI_VERSION) {
    failures.push(`ai version mismatch: ${league.aiVersion}`);
  }
  if (league.rosterGenerationVersion !== SEASON_ROSTER_GENERATION_VERSION) {
    failures.push(`roster generation version mismatch: ${league.rosterGenerationVersion}`);
  }
  if (league.rotationVersion !== SEASON_ROTATION_VERSION) {
    failures.push(`rotation version mismatch: ${league.rotationVersion}`);
  }

  // Canonical digest recomputation.
  let digestVerified = false;
  try {
    const recomputed = seasonGenerationDigest({
      seed: league.seed,
      aiVersion: league.aiVersion,
      rosterGenerationVersion: league.rosterGenerationVersion,
      rotationVersion: league.rotationVersion,
      rosters: league.rosters,
      ownership: league.ownership,
      rotations: league.rotations,
      aiAssignments: league.aiAssignments,
    });
    digestVerified = recomputed === league.digest;
    if (!digestVerified) {
      failures.push(`digest mismatch: stored ${league.digest}, recomputed ${recomputed}`);
    } else {
      details.push(`digest verified: ${league.digest}`);
    }
  } catch (error) {
    failures.push(`digest recomputation failed: ${(error as Error).message}`);
  }

  const payload = seasonRostersAuditReportSchema.parse({
    schemaVersion: 1,
    command: 'season rosters audit',
    input: inputPath,
    teams: league.rosters.length,
    ownershipRows: league.ownership.length,
    quotaFailures: failures.filter((f) => f.includes('quota')).length,
    identityFailures: failures.filter((f) => f.includes('identity')).length,
    legalityFailures: failures.filter((f) => f.includes(':')).length,
    roleCoverageFailures: failures.filter((f) => f.includes('/8')).length,
    rotationFailures: failures.filter((f) => f.includes('rotation')).length,
    versionFailures: failures.filter((f) => f.includes('version mismatch')).length,
    digestVerified,
    auditFailures: failures.length,
    pass: failures.length === 0,
  });
  details.push(
    `rosters ${String(league.rosters.length)} · ownership ${String(league.ownership.length)} · AI rows ${String(aiRows.length)}`,
    `audit failures: ${String(failures.length)}`,
  );
  return makeReport(
    'season rosters audit',
    { input: inputPath },
    {
      details,
      failures,
      payload,
    },
  );
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[index] ?? 0;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function distribution(values: readonly number[]): {
  median: number;
  range: [number, number];
  min: number;
  max: number;
  sample: number;
} {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: median(sorted),
    // p1-p99: the frozen band envelope. Team scores also shift with the
    // whole league (which teams pick first in a seed), so the envelope must
    // cover both team-level and league-level variance for the 95% held-out
    // gate to be meaningful.
    range: [percentile(sorted, 0.01), percentile(sorted, 0.99)],
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    sample: sorted.length,
  };
}

async function runCalibrationChunks(args: {
  seeds: string[];
  catalogPath: string;
  leaguePath: string;
  humanRosters: Array<{ franchiseId: string; playerVersionIds: string[] }>;
  workers: number;
}): Promise<SeasonRosterCalibrationRun[]> {
  const chunkSize = Math.max(1, Math.ceil(args.seeds.length / args.workers));
  const chunks: string[][] = [];
  for (let i = 0; i < args.seeds.length; i += chunkSize) {
    chunks.push(args.seeds.slice(i, i + chunkSize));
  }
  const results = await Promise.all(
    chunks.map(
      (seeds) =>
        new Promise<SeasonRosterCalibrationRun[]>((resolvePromise, rejectPromise) => {
          const worker = new Worker(new URL('./rosters-calibration-worker.ts', import.meta.url), {
            workerData: { ...args, seeds },
          });
          worker.on('message', (message: { runs: SeasonRosterCalibrationRun[] }) => {
            resolvePromise(message.runs);
            void worker.terminate();
          });
          worker.on('error', rejectPromise);
          worker.on('exit', (code) => {
            if (code !== 0) rejectPromise(new Error(`worker exited ${String(code)}`));
          });
        }),
    ),
  );
  return results.flat();
}

export async function seasonRostersCalibrate(args: {
  workers?: string;
  'calibration-seeds'?: string;
  'validation-seeds'?: string;
  out?: string;
  manifest?: string;
}): Promise<CliReport> {
  const calibrationCount = parseCount(args['calibration-seeds'], '--calibration-seeds', 256);
  const validationCount = parseCount(args['validation-seeds'], '--validation-seeds', 64);
  const workers = Math.max(1, parseCount(args.workers, '--workers', 4));
  const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
  const catalog = loadSeasonDraftCatalog(manifestPath);
  const league = loadSeasonLeague();
  const humanRoster = fixtureHumanRoster(catalog);
  const humanRosters = [{ franchiseId: 'lakers', playerVersionIds: humanRoster }];
  const catalogPath = resolve(manifestPath, '..', 'season', 'draft-catalog.json');
  const leaguePath = resolve(manifestPath, '..', 'season', 'league.json');
  const start = Date.now();

  const calibrationSeeds = Array.from({ length: calibrationCount }, (_, i) =>
    rosterCalibrationSeed(i),
  );
  const validationSeeds = Array.from({ length: validationCount }, (_, i) =>
    rosterCalibrationSeed(calibrationCount + i),
  );
  const calibrationRuns = await runCalibrationChunks({
    seeds: calibrationSeeds,
    catalogPath,
    leaguePath,
    humanRosters,
    workers,
  });
  const validationRuns = await runCalibrationChunks({
    seeds: validationSeeds,
    catalogPath,
    leaguePath,
    humanRosters,
    workers,
  });
  const durationMs = Date.now() - start;

  // Score distributions by band and identity over the calibration cohort.
  const byBand: Record<string, number[]> = {
    contender: [],
    playoff: [],
    average: [],
    weaker: [],
  };
  const byIdentity = new Map<string, number[]>();
  let failureCount = 0;
  let repairs = 0;
  let backtracks = 0;
  let roleGaps = 0;
  let identityGapLeagues = 0;
  let illegalLeagues = 0;
  const humanFranchiseIds = humanRosters.map((roster) => roster.franchiseId);
  for (const run of [...calibrationRuns, ...validationRuns]) {
    if (run.failed) {
      failureCount += 1;
      continue;
    }
    repairs += run.repairs;
    backtracks += run.backtracks;
    const identities = new Set<string>();
    const franchises = new Set<string>();
    for (const team of run.teams) {
      // Human franchise rows are placeholders; distributions describe AI rows.
      if (humanFranchiseIds.includes(team.franchiseId)) continue;
      byBand[team.band]?.push(team.strengthScore);
      byIdentity.set(team.identity, [...(byIdentity.get(team.identity) ?? []), team.strengthScore]);
      identities.add(team.identity);
      franchises.add(team.franchiseId);
      if (team.rolesCovered < 8) roleGaps += 1;
    }
    if (identities.size !== 6) identityGapLeagues += 1;
    if (franchises.size !== 29) illegalLeagues += 1;
  }

  const bands: Record<SeasonStrengthBand, ReturnType<typeof distribution>> = {
    contender: distribution(byBand.contender ?? []),
    playoff: distribution(byBand.playoff ?? []),
    average: distribution(byBand.average ?? []),
    weaker: distribution(byBand.weaker ?? []),
  };
  const identityNames = [
    'star-chaser',
    'depth-builder',
    'defense-first',
    'shooting-first',
    'continuity',
    'active-trader',
  ] as const;
  const identities: Record<string, ReturnType<typeof distribution>> = {};
  for (const identity of identityNames) {
    identities[identity] = distribution(byIdentity.get(identity) ?? []);
  }

  // Gates.
  const orderedBandMedians =
    bands.contender.median > bands.playoff.median &&
    bands.playoff.median > bands.average.median &&
    bands.average.median > bands.weaker.median;
  const quotas = calibrationRuns.every((run) => {
    if (run.failed) return false;
    const humanFranchises = new Set(humanFranchiseIds);
    const counts: Record<string, number> = { contender: 0, playoff: 0, average: 0, weaker: 0 };
    for (const team of run.teams) {
      if (humanFranchises.has(team.franchiseId)) continue;
      counts[team.band] = (counts[team.band] ?? 0) + 1;
    }
    return (
      counts.contender === SOLO_BAND_QUOTAS.contender &&
      counts.playoff === SOLO_BAND_QUOTAS.playoff &&
      counts.average === SOLO_BAND_QUOTAS.average &&
      counts.weaker === SOLO_BAND_QUOTAS.weaker
    );
  });
  const roleCoverage = roleGaps === 0;
  const identitiesGate = identityGapLeagues === 0;
  const zeroIllegal = illegalLeagues === 0 && failureCount === 0;

  // Held-out pass share: validation scores within the frozen calibration
  // ranges (p5..p95 per band).
  let heldOutWithin = 0;
  let heldOutTotal = 0;
  for (const run of validationRuns) {
    if (run.failed) continue;
    for (const team of run.teams) {
      heldOutTotal += 1;
      const [lo, hi] = bands[team.band].range;
      if (team.strengthScore >= lo && team.strengthScore <= hi) heldOutWithin += 1;
    }
  }
  const heldOutPassShare = heldOutTotal === 0 ? 0 : heldOutWithin / heldOutTotal;
  const heldOutPass = heldOutPassShare >= 0.95;

  const pass =
    failureCount === 0 &&
    orderedBandMedians &&
    quotas &&
    roleCoverage &&
    identitiesGate &&
    zeroIllegal &&
    heldOutPass;

  // Freeze the targets artifact.
  let targetsWritten = false;
  let targetsPath: string | null = null;
  const gateFailures: string[] = [];
  const targets: SeasonRosterTargets = {
    schemaVersion: 1,
    targetsVersion: SEASON_ROSTER_TARGETS_VERSION,
    calibration: {
      calibrationSeedCount: calibrationCount,
      validationSeedCount: validationCount,
      generatedAtIso: new Date().toISOString(),
      aiVersion: SEASON_AI_VERSION,
      rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
    },
    bands: {
      contender: { range: bands.contender.range, median: bands.contender.median },
      playoff: { range: bands.playoff.range, median: bands.playoff.median },
      average: { range: bands.average.range, median: bands.average.median },
      weaker: { range: bands.weaker.range, median: bands.weaker.median },
    },
    identities: identities,
    roleCoverageMinimum: 8,
    heldOutPassShare: 0.95,
    quotas: {
      soloBands: { ...SOLO_BAND_QUOTAS },
      duoBands: { ...DUO_BAND_QUOTAS },
    },
  };
  seasonRosterTargetsSchema.parse(targets);
  const outPath = args.out ?? DEFAULT_ROSTER_TARGETS;
  try {
    const target = resolve(outPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(targets, null, 2)}\n`);
    targetsWritten = true;
    targetsPath = target;
    // Update the manifest hash for the committed targets artifact.
    if (resolve(outPath) === resolve(DEFAULT_ROSTER_TARGETS)) {
      const manifestPathResolved = resolve(manifestPath);
      const manifest = JSON.parse(readFileSync(manifestPathResolved, 'utf8')) as {
        season?: Record<string, { url?: string; contentHash?: string }>;
      };
      if (manifest.season !== undefined) {
        manifest.season.rosterTargets = {
          url: 'season/roster-targets.json',
          contentHash: sha256Hex(readFileSync(target)),
        };
        writeFileSync(manifestPathResolved, `${JSON.stringify(manifest, null, 2)}\n`);
      }
    }
  } catch (error) {
    gateFailures.push(`cannot write targets: ${(error as Error).message}`);
  }

  const payload = seasonRostersCalibrateReportSchema.parse({
    schemaVersion: 1,
    command: 'season rosters calibrate',
    calibrationSeeds: calibrationCount,
    validationSeeds: validationCount,
    failures: failureCount,
    repairRate: calibrationRuns.length === 0 ? 0 : repairs / calibrationRuns.length,
    backtrackRate: calibrationRuns.length === 0 ? 0 : backtracks / calibrationRuns.length,
    durationMs,
    bands,
    identities,
    gates: {
      orderedBandMedians,
      quotas,
      roleCoverage,
      identities: identitiesGate,
      zeroIllegal,
      heldOutPassShare,
      heldOutPass,
    },
    targetsWritten,
    targetsPath,
    pass,
  });
  void league;
  const details = [
    `${String(calibrationCount)} calibration + ${String(validationCount)} validation seeds in ${String(durationMs)}ms (${String(workers)} workers)`,
    `failures ${String(failureCount)} · repair rate ${(payload.repairRate * 100).toFixed(1)}% · backtrack rate ${(payload.backtrackRate * 100).toFixed(1)}%`,
    `band medians: contender ${bands.contender.median.toFixed(1)} > playoff ${bands.playoff.median.toFixed(1)} > average ${bands.average.median.toFixed(1)} > weaker ${bands.weaker.median.toFixed(1)}`,
    `held-out pass share ${(heldOutPassShare * 100).toFixed(1)}% (≥ 95% required)`,
    `gates: orderedMedians ${String(orderedBandMedians)} · quotas ${String(quotas)} · roles ${String(roleCoverage)} · identities ${String(identitiesGate)} · legal ${String(zeroIllegal)}`,
    `targets ${targetsWritten ? `written to ${targetsPath ?? '?'}` : 'NOT written'}`,
  ];
  if (failureCount > 0) gateFailures.push(`${String(failureCount)} generation failures`);
  if (!orderedBandMedians) gateFailures.push('band medians are not strictly ordered');
  if (!quotas) gateFailures.push('band quota check failed');
  if (!roleCoverage) gateFailures.push(`role coverage gaps: ${String(roleGaps)}`);
  if (!identitiesGate) gateFailures.push('identity coverage missing in some league');
  if (!zeroIllegal) gateFailures.push('illegal or duplicate roster found');
  if (!heldOutPass) {
    gateFailures.push(`held-out pass share ${(heldOutPassShare * 100).toFixed(1)}% below 95%`);
  }
  if (!targetsWritten) gateFailures.push('targets artifact was not written');
  return makeReport(
    'season rosters calibrate',
    { workers, calibrationSeeds: calibrationCount, validationSeeds: validationCount },
    {
      details,
      failures: gateFailures,
      payload,
    },
  );
}
