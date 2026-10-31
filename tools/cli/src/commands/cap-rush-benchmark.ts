import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import {
  ENGINE_VERSION,
  adaptCapRushCatalog,
  applyCapRushCommand,
  buildCapRushCatalogIndex,
  buildCapRushConferenceStandings,
  capRushConferencePostseasonStep,
  capRushLeagueFieldOfLocked,
  capRushOfferLegalCardIds,
  capRushUserLeagueGameOf,
  createCapRushDraftState,
  createEngineContext,
  simulateCapRushGame,
  simulateCapRushLeagueSlot,
  simulateCapRushPlayoffGame,
  type CapRushStandingsGame,
} from '@hoop-rush/engine';
import {
  CAP_RUSH_SCHEMA_VERSION,
  CAP_RUSH_RULES_VERSION,
  CAP_RUSH_SALARY_CURVE_VERSION,
  CAP_RUSH_SEED_DERIVATION_VERSION,
  POSITIONS,
  capRushAcceptGameCommandSchema,
  capRushAcceptLeagueGamesCommandSchema,
  capRushAcceptPlayoffGameCommandSchema,
  capRushAcceptStandingsCommandSchema,
  capRushFinalizePostseasonCommandSchema,
  capRushFinalizeSeasonCommandSchema,
  commandIdSchema,
  idSchema,
  isConferencePostseason,
  opponentBracketSchema,
  seedFromString,
  seedSchema,
  type CapRushCommand,
  type CapRushLeagueGame,
} from '@hoop-rush/data-contracts';
import { parseCount } from '../args.ts';
import {
  compareTimedBaselines,
  timingStats,
  type BaselineMetric,
  type TimedMetric,
} from '../benchmark-support.ts';
import { EXIT_USAGE_OR_DATA_ERROR, makeReport, type CliReport } from '../report.ts';
import { capRushBenchmarkReportSchema, type CapRushBenchmarkReport } from '../report-schemas.ts';
import { loadPackagedData, PackagedData, REPO_ROOT } from './data-loader.ts';

type Policy = 'balanced' | 'premium';
const POLICIES: readonly Policy[] = ['balanced', 'premium'];
const PHASE_KEYS = [
  'seasonSimulate',
  'seasonAccept',
  'leagueSimulate',
  'leagueAccept',
  'seasonFinalize',
  'standings',
  'postseasonStep',
  'postseasonSimulate',
  'postseasonAccept',
  'postseasonFinalize',
  'seasonTotal',
  'postseasonTotal',
  'total',
] as const;
type PhaseKey = (typeof PHASE_KEYS)[number];
type Phases = Record<PhaseKey, number>;
interface RunResult {
  phases: Phases;
  counts: {
    userSeasonGames: number;
    leagueGames: number;
    standingsGames: number;
    postseasonUserGames: number;
    postseasonAiGames: number;
    postseasonSteps: number;
    postseasonRounds: number;
  };
  markers: {
    championTeamId: string | null;
    userOutcome: string;
    seasonLastResultDigest: string;
    isolations: number;
    strikes: number;
  };
  payrollDollars: number;
  payrollStatus: 'under-cap' | 'first-apron' | 'second-apron';
  auditFailures: number;
}

function resolvePath(value: string): string {
  return isAbsolute(value) ? value : resolve(REPO_ROOT, value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function bootstrap() {
  const { manifest, dir } = loadPackagedData();
  const data = new PackagedData(manifest, dir);
  const catalog = data.draftCatalog();
  const profile = data.eraProfile('2010s');
  const bracketEntry = manifest.bracket;
  const catalogEntry = manifest.draftCatalog;
  const profileEntry = manifest.eraSimulationProfiles.find(
    (entry) => entry.eraId === profile.eraId,
  );
  if (!bracketEntry || !catalogEntry || !profileEntry)
    throw new Error('missing packaged artifacts');
  const bracket = opponentBracketSchema.parse(
    JSON.parse(readFileSync(resolve(dir, bracketEntry.url), 'utf8')) as unknown,
  );
  const source = {
    catalogVersion: catalog.catalogVersion,
    catalogHash: catalogEntry.contentHash,
    dataVersion: catalog.dataVersion,
    ratingsVersion: catalog.ratingsVersion,
    playerVersionIdVersion: catalog.playerVersionIdVersion,
    positionNormalizationVersion: catalog.positionNormalizationVersion,
  };
  const index = buildCapRushCatalogIndex(adaptCapRushCatalog(catalog, source));
  const versionSet = {
    schemaVersion: CAP_RUSH_SCHEMA_VERSION,
    rulesVersion: CAP_RUSH_RULES_VERSION,
    salaryCurveVersion: CAP_RUSH_SALARY_CURVE_VERSION,
    seedDerivationVersion: CAP_RUSH_SEED_DERIVATION_VERSION,
    engineVersion: ENGINE_VERSION,
    profileVersion: profile.profileVersion,
    dataVersion: catalog.dataVersion,
    catalogVersion: catalog.catalogVersion,
    catalogHash: source.catalogHash,
    bracketHash: bracketEntry.contentHash,
    profileHash: profileEntry.contentHash,
  } as const;
  return {
    manifest,
    index,
    lockSources: { bracket, profile },
    versionSet,
    source,
    bracketHash: bracketEntry.contentHash,
    profileVersion: profile.profileVersion,
    dataVersion: catalog.dataVersion,
  };
}

function draftState(
  fixtures: ReturnType<typeof bootstrap>,
  policy: Policy,
): ReturnType<typeof createCapRushDraftState> {
  const { index, lockSources, versionSet, source } = fixtures;
  const runSeed = seedSchema.parse(seedFromString(`cap-rush-benchmark-v1:${policy}`));
  let state = createCapRushDraftState(
    {
      command: 'create-cap-rush-draft',
      commandId: commandIdSchema.parse('bench-create'),
      runId: idSchema.parse('bench-run'),
      runSeed,
      variant: 'clash',
      versionSet,
      catalog: source,
    },
    index,
    lockSources,
  );
  const apply = (command: CapRushCommand): void => {
    const applied = applyCapRushCommand(state, command, { index, lockSources });
    if (applied.result.status !== 'accepted') throw new Error(JSON.stringify(applied.result));
    state = applied.state;
  };
  const base = () => ({
    commandId: commandIdSchema.parse(`bench-${String(state.revision)}`),
    runId: state.runId,
    expectedRevision: state.revision,
  });
  for (const slot of POSITIONS) {
    apply({ ...base(), command: 'choose-cap-rush-position', slot });
    const offer = state.offer;
    if (!offer) throw new Error('missing offer');
    const legalIds = new Set(capRushOfferLegalCardIds(state, index, offer.cards));
    const legal = offer.cards
      .filter((card) => legalIds.has(card.cardId))
      .sort((left, right) =>
        policy === 'premium'
          ? right.salaryDollars - left.salaryDollars ||
            right.source.originalOverall - left.source.originalOverall ||
            left.cardId.localeCompare(right.cardId)
          : Math.abs(left.source.originalOverall - 85) -
              Math.abs(right.source.originalOverall - 85) ||
            left.cardId.localeCompare(right.cardId),
      );
    const card = legal[0];
    if (!card) throw new Error('no legal card');
    apply({
      ...base(),
      command: 'sign-cap-rush-card',
      offerId: offer.offerId,
      cardId: card.cardId,
    });
  }
  if (state.spin.status === 'pending') apply({ ...base(), command: 'skip-cap-rush-spin' });
  apply({
    ...base(),
    command: 'lock-cap-rush-lineup',
    picks: state.picks.map((pick) => ({ slot: pick.slot, cardId: pick.card.cardId })),
  });
  return state;
}

function runPolicy(
  fixtures: ReturnType<typeof bootstrap>,
  policy: Policy,
  initial: ReturnType<typeof createCapRushDraftState>,
): RunResult {
  const { index, lockSources } = fixtures;
  const context = createEngineContext();
  let state = initial;
  const locked = state.locked;
  if (!locked) throw new Error('missing lock');
  if (
    locked.payrollStatus !== 'under-cap' &&
    locked.payrollStatus !== 'first-apron' &&
    locked.payrollStatus !== 'second-apron'
  ) {
    throw new Error('benchmark run is over the hard limit');
  }
  const phases = Object.fromEntries(PHASE_KEYS.map((key) => [key, 0])) as Phases;
  const timed = (key: PhaseKey, run: () => void): void => {
    const started = performance.now();
    run();
    phases[key] += performance.now() - started;
  };
  const apply = (command: CapRushCommand): void => {
    const applied = applyCapRushCommand(state, command, { index, lockSources });
    if (applied.result.status !== 'accepted') throw new Error(JSON.stringify(applied.result));
    state = applied.state;
  };
  const base = () => ({
    commandId: commandIdSchema.parse(`bench-${String(state.revision)}`),
    runId: state.runId,
    expectedRevision: state.revision,
  });

  const standingsGames: CapRushStandingsGame[] = [];
  let isolations = 0;
  let strikes = 0;
  for (let gameNumber = 1; gameNumber <= 82; gameNumber += 1) {
    let simulation: ReturnType<typeof simulateCapRushGame> | undefined;
    timed('seasonSimulate', () => {
      simulation = simulateCapRushGame({ locked, gameNumber, context });
    });
    const game = simulation;
    if (game === undefined) throw new Error('missing season simulation');
    if (!game.audit.ok) throw new Error(`season game ${String(gameNumber)} failed its audit`);
    const gameIsolations = game.facts.filter((fact) => fact.kind === 'isolation').length;
    const gameStrikes = game.facts.filter((fact) => fact.kind === 'strike').length;
    isolations += gameIsolations;
    strikes += gameStrikes;
    timed('seasonAccept', () => {
      apply(
        capRushAcceptGameCommandSchema.parse({
          ...base(),
          command: 'accept-cap-rush-game',
          cursor: game.summary.gameNumber,
          inputDigest: game.summary.inputDigest,
          resultDigest: game.summary.resultDigest,
          isolations: gameIsolations,
          strikes: gameStrikes,
          summary: game.summary,
        }),
      );
    });
    const scheduled = capRushUserLeagueGameOf(locked, gameNumber);
    standingsGames.push({
      gameId: scheduled.gameId,
      homeTeamId: scheduled.homeTeamId,
      awayTeamId: scheduled.awayTeamId,
      homePoints: game.summary.humanHome ? game.summary.humanPoints : game.summary.opponentPoints,
      awayPoints: game.summary.humanHome ? game.summary.opponentPoints : game.summary.humanPoints,
    });
    let leagueGames: CapRushLeagueGame[] = [];
    timed('leagueSimulate', () => {
      leagueGames = simulateCapRushLeagueSlot({ locked, slot: gameNumber, context });
    });
    standingsGames.push(...leagueGames);
    timed('leagueAccept', () => {
      apply(
        capRushAcceptLeagueGamesCommandSchema.parse({
          ...base(),
          command: 'accept-cap-rush-league-games',
          slot: gameNumber,
          leagueGames,
        }),
      );
    });
  }
  timed('seasonFinalize', () => {
    apply(
      capRushFinalizeSeasonCommandSchema.parse({
        ...base(),
        command: 'finalize-cap-rush-season',
      }),
    );
  });
  timed('standings', () => {
    const standings = buildCapRushConferenceStandings({
      teams: capRushLeagueFieldOfLocked(locked),
      games: standingsGames,
    });
    apply(
      capRushAcceptStandingsCommandSchema.parse({
        ...base(),
        command: 'accept-cap-rush-standings',
        standings,
      }),
    );
  });

  let postseasonUserGames = 0;
  let postseasonAiGames = 0;
  let postseasonSteps = 0;
  let postseasonRounds = 0;
  for (let guard = 0; guard < 400; guard += 1) {
    const postseason = state.postseason;
    if (postseason === undefined || postseason.phase === 'complete') break;
    if (!isConferencePostseason(postseason)) {
      throw new Error('the benchmark requires a conference postseason');
    }
    if (postseason.phase === 'awaiting-standings') {
      throw new Error('the postseason still awaits final standings');
    }
    let step: ReturnType<typeof capRushConferencePostseasonStep> | undefined;
    timed('postseasonStep', () => {
      step = capRushConferencePostseasonStep({
        postseason,
        runSeed: state.runSeed,
        userTeamId: locked.human.teamId,
      });
    });
    const current = step;
    if (current === undefined) throw new Error('missing postseason step');
    if (current.kind === 'complete') break;
    if (current.kind === 'finalize') {
      timed('postseasonFinalize', () => {
        apply(
          capRushFinalizePostseasonCommandSchema.parse({
            ...base(),
            command: 'finalize-cap-rush-postseason',
          }),
        );
      });
      continue;
    }
    if (current.kind !== 'games') throw new Error('the postseason still awaits final standings');
    if (current.games.length === 0) throw new Error('the bracket produced no games');
    postseasonSteps += 1;
    for (const plan of current.games) {
      let simulation: ReturnType<typeof simulateCapRushPlayoffGame> | undefined;
      timed('postseasonSimulate', () => {
        simulation = simulateCapRushPlayoffGame({ locked, plan, context });
      });
      const game = simulation;
      if (game === undefined) throw new Error('missing playoff simulation');
      if (!game.game.audit.ok) throw new Error('a playoff game failed its audit');
      if (game.game.summary.userSide === null) postseasonAiGames += 1;
      else postseasonUserGames += 1;
      timed('postseasonAccept', () => {
        apply(
          capRushAcceptPlayoffGameCommandSchema.parse({
            ...base(),
            command: 'accept-cap-rush-playoff-game',
            game: game.game.summary,
            audit: game.game.audit,
            result: game.game.result,
          }),
        );
      });
    }
    for (const plan of current.games) {
      postseasonRounds = Math.max(postseasonRounds, plan.round);
    }
  }

  phases.seasonTotal =
    phases.seasonSimulate +
    phases.seasonAccept +
    phases.leagueSimulate +
    phases.leagueAccept +
    phases.seasonFinalize +
    phases.standings;
  phases.postseasonTotal =
    phases.postseasonStep +
    phases.postseasonSimulate +
    phases.postseasonAccept +
    phases.postseasonFinalize;
  phases.total = phases.seasonTotal + phases.postseasonTotal;

  return {
    phases,
    counts: {
      userSeasonGames: 82,
      leagueGames: 82 * 14,
      standingsGames: standingsGames.length,
      postseasonUserGames,
      postseasonAiGames,
      postseasonSteps,
      postseasonRounds,
    },
    markers: {
      championTeamId: state.postseason?.championTeamId ?? null,
      userOutcome: state.postseason?.userOutcome.status ?? 'not-qualified',
      seasonLastResultDigest: state.season.games.at(-1)?.resultDigest ?? '',
      isolations,
      strikes,
    },
    payrollDollars: locked.payrollDollars,
    payrollStatus: locked.payrollStatus,
    auditFailures: 0,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function capRushBenchmark(args: {
  samples?: string;
  policy?: string;
  baseline?: string;
  'write-baseline'?: string;
}): CliReport {
  const samples = Math.max(1, parseCount(args.samples, '--samples', 3));
  const selected = args.policy ?? 'both';
  if (selected !== 'both' && selected !== 'balanced' && selected !== 'premium') {
    return makeReport(
      'cap-rush benchmark',
      { samples, policy: selected },
      {
        failures: ['--policy must be one of both, balanced, premium'],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      },
    );
  }
  const policies: readonly Policy[] =
    selected === 'both' ? POLICIES : selected === 'balanced' ? ['balanced'] : ['premium'];
  const fixtures = bootstrap();
  const contextFingerprint = [
    process.version,
    process.platform,
    process.arch,
    String(cpus().length),
    ENGINE_VERSION,
    fixtures.dataVersion,
    fixtures.profileVersion,
    fixtures.bracketHash,
  ].join('|');
  const policyReports: CapRushBenchmarkReport['policies'] = [];
  const details: string[] = [
    `environment: node ${process.version} · ${process.platform}/${process.arch} · ${String(cpus().length)} cpus`,
    `environment fingerprint: ${contextFingerprint}`,
    `engine ${ENGINE_VERSION} · data ${fixtures.dataVersion} · profile ${fixtures.profileVersion} · bracket ${fixtures.bracketHash}`,
    `fixture: packaged 2010s field · ${String(samples)} sample(s) per policy · Bun CLI (not a browser or phone measurement)`,
  ];
  const failures: string[] = [];
  const currentMetrics: Record<string, TimedMetric> = {};
  const metrics: BaselineMetric[] = [];

  for (const policy of policies) {
    const initial = draftState(fixtures, policy);
    const runs: RunResult[] = [];
    for (let sample = 0; sample < samples; sample += 1) {
      runs.push(runPolicy(fixtures, policy, initial));
    }
    const first = runs[0];
    if (first === undefined) throw new Error('missing benchmark run');
    for (const run of runs) {
      for (const key of ['userSeasonGames', 'leagueGames', 'standingsGames'] as const) {
        if (run.counts[key] !== first.counts[key]) {
          failures.push(`${policy} produced an inconsistent ${key} count`);
        }
      }
      if (run.counts.standingsGames !== 1230) {
        failures.push(
          `${policy} standings cover ${String(run.counts.standingsGames)} of 1230 games`,
        );
      }
    }
    const consistent =
      runs.length > 1 &&
      runs.every(
        (run) =>
          run.markers.championTeamId === first.markers.championTeamId &&
          run.markers.userOutcome === first.markers.userOutcome &&
          run.markers.seasonLastResultDigest === first.markers.seasonLastResultDigest &&
          run.markers.isolations === first.markers.isolations &&
          run.markers.strikes === first.markers.strikes,
      );
    if (runs.length > 1 && !consistent) {
      failures.push(`${policy} produced different seeded outcomes between samples`);
    }
    const phases = Object.fromEntries(
      PHASE_KEYS.map((key) => [key, timingStats(runs.map((run) => round(run.phases[key])))]),
    ) as CapRushBenchmarkReport['policies'][number]['phases'];
    policyReports.push({
      policy,
      payrollDollars: first.payrollDollars,
      payrollStatus: first.payrollStatus,
      counts: first.counts,
      phases,
      markers: { ...first.markers, consistentAcrossSamples: consistent },
      auditFailures: first.auditFailures,
    });
    for (const key of PHASE_KEYS) currentMetrics[`${policy}.${key}`] = phases[key];
    metrics.push(
      { id: `${policy}.total`, label: `${policy} total`, noiseMs: 100 },
      { id: `${policy}.seasonTotal`, label: `${policy} regular season`, noiseMs: 75 },
      { id: `${policy}.postseasonTotal`, label: `${policy} postseason`, noiseMs: 40 },
      { id: `${policy}.leagueSimulate`, label: `${policy} league simulation`, noiseMs: 75 },
      { id: `${policy}.postseasonSimulate`, label: `${policy} postseason simulation`, noiseMs: 40 },
    );
    details.push(
      `${policy}: ${first.payrollStatus} $${String(first.payrollDollars)} · ${String(first.counts.postseasonUserGames)} user + ${String(first.counts.postseasonAiGames)} AI playoff games over ${String(first.counts.postseasonSteps)} steps · ${first.markers.userOutcome}`,
      `${policy} regular season (82 user + 1,148 league games): simulate ${phases.seasonSimulate.medianMs.toFixed(1)} + ${phases.leagueSimulate.medianMs.toFixed(1)} ms, accept ${phases.seasonAccept.medianMs.toFixed(1)} + ${phases.leagueAccept.medianMs.toFixed(1)} ms, finalize/standings ${(phases.seasonFinalize.medianMs + phases.standings.medianMs).toFixed(1)} ms → ${phases.seasonTotal.medianMs.toFixed(1)} ms`,
      `${policy} postseason (${String(first.counts.postseasonUserGames + first.counts.postseasonAiGames)} games): simulate ${phases.postseasonSimulate.medianMs.toFixed(1)} ms, accept ${phases.postseasonAccept.medianMs.toFixed(1)} ms, steps/finalize ${(phases.postseasonStep.medianMs + phases.postseasonFinalize.medianMs).toFixed(1)} ms → ${phases.postseasonTotal.medianMs.toFixed(1)} ms`,
      `${policy} total ${phases.total.medianMs.toFixed(1)} ms (regular season + postseason)`,
    );
  }

  const payload = capRushBenchmarkReportSchema.parse({
    schemaVersion: 1,
    command: 'cap-rush benchmark',
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: cpus().length,
      fingerprint: contextFingerprint,
    },
    engineVersion: ENGINE_VERSION,
    dataVersion: fixtures.dataVersion,
    profileVersion: fixtures.profileVersion,
    bracketHash: fixtures.bracketHash,
    fixture: 'packaged-2010s-v1',
    samples,
    policies: policyReports,
    baselineComparison: {
      status: 'not-requested',
      fingerprintMatched: false,
      baselineFingerprint: null,
      regressions: [],
    },
  });

  if (args['write-baseline']) {
    const path = resolvePath(args['write-baseline']);
    try {
      writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      details.push(`baseline written to ${path}`);
    } catch (error) {
      failures.push(`cannot write baseline ${path}: ${errorMessage(error)}`);
    }
  }
  if (args.baseline) {
    const path = resolvePath(args.baseline);
    try {
      const baseline = capRushBenchmarkReportSchema.parse(
        JSON.parse(readFileSync(path, 'utf8')) as unknown,
      );
      const baselineMetrics: Record<string, TimedMetric> = {};
      for (const report of baseline.policies) {
        for (const key of PHASE_KEYS)
          baselineMetrics[`${report.policy}.${key}`] = report.phases[key];
      }
      const comparison = compareTimedBaselines({
        currentFingerprint: payload.environment.fingerprint,
        baselineFingerprint: baseline.environment.fingerprint,
        current: currentMetrics,
        baseline: baselineMetrics,
        metrics,
        details,
      });
      payload.baselineComparison = comparison.comparison;
      failures.push(...comparison.failures);
    } catch (error) {
      return makeReport(
        'cap-rush benchmark',
        { samples, policy: selected, baseline: path },
        {
          details,
          failures: [...failures, `cannot read benchmark baseline ${path}: ${errorMessage(error)}`],
          exitCode: EXIT_USAGE_OR_DATA_ERROR,
          payload,
        },
      );
    }
  }

  return makeReport(
    'cap-rush benchmark',
    {
      samples,
      policy: selected,
      ...(args.baseline ? { baseline: args.baseline } : {}),
      ...(args['write-baseline'] ? { writeBaseline: args['write-baseline'] } : {}),
    },
    { details, failures, payload },
  );
}
