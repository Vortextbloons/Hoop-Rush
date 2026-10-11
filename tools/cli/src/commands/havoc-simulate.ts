import { HAVOC_MUTATION_DEFINITIONS } from '@hoop-rush/engine';
import { seedSchema, type HavocMutationDefinition, type Seed } from '@hoop-rush/data-contracts';
import { UsageError } from '../args.ts';
import { EXIT_USAGE_OR_DATA_ERROR, makeReport, type CliReport } from '../report.ts';
import {
  HavocCliError,
  adaptHavocCliCatalog,
  havocCliDraftPlanOf,
  havocCliGameNumbers,
  havocCliLineupOf,
  havocCliLockSourcesOf,
  havocCliPicksSchema,
  havocCliReportDigest,
  havocCliComparisonOf,
  havocSimulateReportSchema,
  loadHavocCliAssets,
  lockedInputsDigest,
  readHavocJsonFile,
  replayHavocCliDraft,
  simulateHavocCliVariant,
  type HavocCliAssets,
  type HavocCliDraftPlan,
  type HavocCliFailure,
  type HavocSimulateReport,
} from '../havoc-cli-support.ts';
import { createHavocCommandEnvironment, HavocStateDigest } from '@hoop-rush/engine';

export const HAVOC_SIMULATE_OPTIONS: Record<string, boolean> = {
  seed: true,
  picks: true,
  comparison: false,
  manifest: true,
  format: true,
};

export interface HavocCliSimulationOptions {
  readonly seed: Seed;
  readonly plan: HavocCliDraftPlan;
  readonly comparison: boolean;
  /** Defaults to all 82 games; the calibration machinery and tests use smaller counts. */
  readonly games?: number;
  readonly assets?: HavocCliAssets;
}

export interface HavocCliSimulationResult {
  readonly report: HavocSimulateReport;
  readonly durationMs: number;
}

function mutationNamesOf(mutations: readonly { mutationId: string }[]): string {
  return mutations
    .map((entry) => {
      const definition: HavocMutationDefinition | undefined = HAVOC_MUTATION_DEFINITIONS.find(
        (candidate) => candidate.mutationId === entry.mutationId,
      );
      return definition?.name ?? entry.mutationId;
    })
    .join(' + ');
}

export function runHavocCliSimulation(
  options: HavocCliSimulationOptions,
): HavocCliSimulationResult {
  const started = performance.now();
  const assets = options.assets ?? loadHavocCliAssets();
  const catalog = adaptHavocCliCatalog(assets);
  const environment = createHavocCommandEnvironment(catalog);
  const lockSources = havocCliLockSourcesOf(assets);
  const runId = `havoc-cli-${options.seed.slice(0, 16)}`;
  const replay = replayHavocCliDraft({
    runId,
    runSeed: options.seed,
    versionSet: assets.versionSet,
    catalog,
    environment,
    lockSources,
    plan: options.plan,
  });
  const gameNumbers = havocCliGameNumbers(options.games ?? undefined);
  const havoc = simulateHavocCliVariant({ locked: replay.locked, variant: 'havoc', gameNumbers });
  const normal = options.comparison
    ? simulateHavocCliVariant({ locked: replay.locked, variant: 'normal', gameNumbers })
    : null;
  const failures: HavocCliFailure[] = [...havoc.failures, ...(normal?.failures ?? [])];
  const lineup = havocCliLineupOf(replay.locked.picks);
  const report = havocSimulateReportSchema.parse({
    schemaVersion: 1,
    command: 'havoc simulate',
    reportDigest: '0'.repeat(32),
    runId,
    runSeed: options.seed,
    catalog: assets.source,
    versionSet: assets.versionSet,
    lineup,
    draft: {
      mode: options.plan.pins === null ? 'auto' : 'pinned',
      pins: options.plan.pins === null ? null : [...options.plan.pins],
      rerollRound: replay.rerollRoundUsed,
      rerollUsed: replay.rerollRoundUsed !== null,
      commandCount: replay.commands.length,
      lockedDigest: lockedInputsDigest(replay.locked),
      stateDigest: HavocStateDigest(replay.state),
    },
    havoc: { variant: 'havoc', games: [...havoc.games], aggregate: havoc.aggregate },
    normal:
      normal === null
        ? null
        : { variant: 'normal', games: [...normal.games], aggregate: normal.aggregate },
    comparison: normal === null ? null : havocCliComparisonOf(havoc, normal),
    failures,
    audits: {
      games: havoc.games.length + (normal?.games.length ?? 0),
      findings: havoc.auditFindings + (normal?.auditFindings ?? 0),
    },
    pass: failures.length === 0,
  });
  const reportWithDigest = havocSimulateReportSchema.parse({
    ...report,
    reportDigest: havocCliReportDigest(report),
  });
  return { report: reportWithDigest, durationMs: performance.now() - started };
}

function renderGameLines(
  label: string,
  variant: HavocSimulateReport['havoc'],
  details: string[],
): void {
  details.push(`${label}: ${String(variant.games.length)} games`);
  for (const game of variant.games) {
    details.push(
      `  g${String(game.gameNumber)} ${game.humanHome ? 'vs' : '@'} ${game.opponentId}: ${String(game.summary.humanScore)}-${String(game.summary.opponentScore)} ${game.summary.outcome} (${game.resultDigest.slice(0, 12)})`,
    );
  }
}

export function havocSimulate(args: {
  seed: string | null;
  picks: string | null;
  comparison: boolean;
  manifest: string | null;
}): CliReport {
  const input = {
    seed: args.seed,
    picks: args.picks,
    comparison: args.comparison,
    manifest: args.manifest,
  };
  try {
    const rawSeed = args.seed;
    if (rawSeed === null) throw new UsageError('havoc simulate requires --seed <hex>');
    const parsedSeed = seedSchema.safeParse(rawSeed);
    if (!parsedSeed.success) throw new UsageError(`--seed must be hex (got "${rawSeed}")`);
    let plan: HavocCliDraftPlan = { pins: null, rerollRound: null };
    if (args.picks !== null) {
      const parsed = havocCliPicksSchema.safeParse(readHavocJsonFile(args.picks));
      if (!parsed.success) {
        throw new UsageError(
          `picks ${args.picks} fails validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        );
      }
      plan = havocCliDraftPlanOf(parsed.data);
    }
    const assets = args.manifest === null ? undefined : loadHavocCliAssets(args.manifest);
    const { report, durationMs } = runHavocCliSimulation({
      seed: parsedSeed.data,
      plan,
      comparison: args.comparison,
      ...(assets === undefined ? {} : { assets }),
    });
    const failures = report.failures.map(
      (failure) =>
        `${failure.variant} game ${String(failure.gameNumber)}: ${failure.code}: ${failure.message}`,
    );
    const details = [
      `seed ${report.runSeed} · run ${report.runId} · draft ${report.draft.mode}${report.draft.rerollUsed ? ` · reroll round ${String(report.draft.rerollRound)}` : ''}`,
      `lineup: ${report.lineup
        .map(
          (entry) =>
            `${entry.slot} ${entry.displayName} "${entry.nickname}" [tier ${String(entry.tier)}: ${mutationNamesOf(entry.mutations)}]`,
        )
        .join(' · ')}`,
      `locked ${report.draft.lockedDigest} · state ${report.draft.stateDigest}`,
      `havoc ${String(report.havoc.aggregate.wins)}-${String(report.havoc.aggregate.losses)} · PF ${String(report.havoc.aggregate.pointsFor)} · PA ${String(report.havoc.aggregate.pointsAgainst)} · adjustments ${String(report.havoc.aggregate.adjustments)}`,
    ];
    if (report.normal !== null) {
      details.push(
        `normal ${String(report.normal.aggregate.wins)}-${String(report.normal.aggregate.losses)} · PF ${String(report.normal.aggregate.pointsFor)} · PA ${String(report.normal.aggregate.pointsAgainst)} · adjustments ${String(report.normal.aggregate.adjustments)}`,
      );
    }
    if (report.comparison !== null) {
      details.push(
        `comparison: wins gained ${String(report.comparison.winsGained)} · differential delta ${String(report.comparison.differentialDelta)}`,
      );
    }
    details.push(
      `audited ${String(report.audits.games)} games · audit findings ${String(report.audits.findings)} · report digest ${report.reportDigest} · ${durationMs.toFixed(0)}ms`,
    );
    renderGameLines('havoc games', report.havoc, details);
    if (report.normal !== null) renderGameLines('normal games', report.normal, details);
    details.push(...failures.slice(0, 20));
    return makeReport('havoc simulate', input, { details, failures, payload: report });
  } catch (error) {
    if (error instanceof UsageError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof HavocCliError ? `${error.code}: ` : '';
    return makeReport('havoc simulate', input, {
      failures: [`${code}${message}`],
      exitCode: EXIT_USAGE_OR_DATA_ERROR,
    });
  }
}
