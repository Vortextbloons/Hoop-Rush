import { HAVOC_GAME_COUNT, canonicalJson, type HavocRunState } from '@hoop-rush/data-contracts';
import {
  FoldHavocAggregate,
  buildHavocGameInput,
  createHavocCommandEnvironment,
} from '@hoop-rush/engine';
import { UsageError } from '../args.ts';
import { EXIT_USAGE_OR_DATA_ERROR, makeReport, type CliReport } from '../report.ts';
import {
  HavocCliError,
  acceptHavocCliVariant,
  adaptHavocCliCatalog,
  canonicalHavocComparisonOf,
  canonicalHavocReportOf,
  havocAuditReportSchema,
  havocCliInputPairCheck,
  havocCliLockSourcesOf,
  havocCliReportDigest,
  havocSimulateReportSchema,
  loadHavocCliAssets,
  lockedInputsDigest,
  readHavocJsonFile,
  replayHavocCliRunFromReport,
  simulateHavocCliVariant,
  type HavocAuditReport,
  type HavocCliAssets,
  type HavocCliVariantRun,
  type HavocSimulateReport,
} from '../havoc-cli-support.ts';

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function zeroAggregate(): HavocSimulateReport['havoc']['aggregate'] {
  return { games: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, adjustments: 0 };
}

function reconcileAggregate(
  label: string,
  variant: HavocSimulateReport['havoc'],
  findings: string[],
): boolean {
  let folded = zeroAggregate();
  for (const game of variant.games) folded = FoldHavocAggregate(folded, game.summary);
  if (!sameJson(folded, variant.aggregate)) {
    findings.push(
      `aggregate: ${label} folded aggregate ${canonicalJson(folded)} does not match the report ${canonicalJson(variant.aggregate)}`,
    );
    return false;
  }
  if (variant.aggregate.games !== variant.games.length) {
    findings.push(
      `aggregate: ${label} aggregate games ${String(variant.aggregate.games)} does not match ${String(variant.games.length)} recorded games`,
    );
    return false;
  }
  return true;
}

function compareReSimulatedGames(
  label: string,
  recorded: HavocSimulateReport['havoc'],
  reSimulated: HavocCliVariantRun,
  findings: string[],
): boolean {
  let ok = true;
  const byNumber = new Map(reSimulated.games.map((game) => [game.gameNumber, game]));
  for (const game of recorded.games) {
    const fresh = byNumber.get(game.gameNumber);
    if (fresh === undefined) {
      findings.push(
        `game: ${label} game ${String(game.gameNumber)} could not be re-simulated (typed failure)`,
      );
      ok = false;
      continue;
    }
    if (fresh.inputDigest !== game.inputDigest) {
      findings.push(
        `digest: ${label} game ${String(game.gameNumber)} input digest ${fresh.inputDigest} != recorded ${game.inputDigest}`,
      );
      ok = false;
    }
    if (fresh.resultDigest !== game.resultDigest) {
      findings.push(
        `digest: ${label} game ${String(game.gameNumber)} result digest ${fresh.resultDigest} != recorded ${game.resultDigest}`,
      );
      ok = false;
    }
    if (fresh.tapeDigest !== game.tapeDigest) {
      findings.push(
        `digest: ${label} game ${String(game.gameNumber)} tape digest ${fresh.tapeDigest} != recorded ${game.tapeDigest}`,
      );
      ok = false;
    }
    if (!sameJson(fresh.summary, game.summary)) {
      findings.push(
        `game: ${label} game ${String(game.gameNumber)} summary disagrees with the re-simulation`,
      );
      ok = false;
    }
  }
  for (const failure of reSimulated.failures) {
    findings.push(
      `audit: ${label} game ${String(failure.gameNumber)} ${failure.code}: ${failure.message}`,
    );
    ok = false;
  }
  return ok;
}

function pairedChecks(report: HavocSimulateReport, findings: string[]): boolean {
  const havocNumbers = new Set(report.havoc.games.map((game) => game.gameNumber));
  const normalNumbers = new Set(report.normal?.games.map((game) => game.gameNumber) ?? []);
  if (report.normal === null) {
    if (report.comparison !== null) {
      findings.push('paired: comparison is present without a normal season');
      return false;
    }
    return true;
  }
  let ok = true;
  if (havocNumbers.size !== normalNumbers.size) {
    findings.push(
      `paired: havoc records ${String(havocNumbers.size)} games but normal records ${String(normalNumbers.size)}`,
    );
    ok = false;
  }
  for (const gameNumber of havocNumbers) {
    if (!normalNumbers.has(gameNumber)) {
      findings.push(`paired: normal season is missing game ${String(gameNumber)}`);
      ok = false;
    }
  }
  for (const gameNumber of normalNumbers) {
    if (!havocNumbers.has(gameNumber)) {
      findings.push(`paired: havoc season is missing game ${String(gameNumber)}`);
      ok = false;
    }
  }
  const havocByNumber = new Map(report.havoc.games.map((game) => [game.gameNumber, game]));
  const normalByNumber = new Map(report.normal.games.map((game) => [game.gameNumber, game]));
  for (const [gameNumber, havocGame] of havocByNumber) {
    const normalGame = normalByNumber.get(gameNumber);
    if (normalGame === undefined) continue;
    if (
      havocGame.opponentId !== normalGame.opponentId ||
      havocGame.humanHome !== normalGame.humanHome
    ) {
      findings.push(`paired: game ${String(gameNumber)} schedule entries differ across variants`);
      ok = false;
    }
    if (havocGame.seed !== normalGame.seed) {
      findings.push(`paired: game ${String(gameNumber)} shared seed differs across variants`);
      ok = false;
    }
  }
  return ok;
}

export function auditHavocSimulateReport(
  report: HavocSimulateReport,
  assets: HavocCliAssets,
  inputPath: string,
): HavocAuditReport {
  const findings: string[] = [];
  const checks = {
    reportSchema: true,
    assetsMatch: true,
    draftReplay: true,
    havocGames: 0,
    normalGames: 0,
    paired: true,
    aggregates: true,
    digests: true,
  };
  if (!sameJson(report.versionSet, assets.versionSet)) {
    findings.push(
      `assets: report version set ${canonicalJson(report.versionSet)} does not match the packaged version set ${canonicalJson(assets.versionSet)}`,
    );
    checks.assetsMatch = false;
  }
  if (!sameJson(report.catalog, assets.source)) {
    findings.push(
      `assets: report catalog source ${canonicalJson(report.catalog)} does not match the packaged catalog ${canonicalJson(assets.source)}`,
    );
    checks.assetsMatch = false;
  }

  let replayed: ReturnType<typeof replayHavocCliRunFromReport> | null = null;
  try {
    replayed = replayHavocCliRunFromReport(report, assets);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    findings.push(`draft: replay failed: ${message}`);
    checks.draftReplay = false;
  }
  if (replayed !== null) {
    if (!sameJson(replayed.lineup, report.lineup)) {
      findings.push('draft: replayed lineup does not match the recorded lineup');
      checks.draftReplay = false;
    }
    const lockedDigest = lockedInputsDigest(replayed.locked);
    if (lockedDigest !== report.draft.lockedDigest) {
      findings.push(
        `draft: locked inputs digest ${lockedDigest} != recorded ${report.draft.lockedDigest}`,
      );
      checks.draftReplay = false;
    }
  }

  if (report.pass !== (report.failures.length === 0)) {
    findings.push('digest: report pass flag disagrees with its recorded failures');
    checks.digests = false;
  }
  if (report.failures.length > 0) {
    findings.push(`game: the report recorded ${String(report.failures.length)} failures`);
  }

  const environment = createHavocCommandEnvironment(adaptHavocCliCatalog(assets));
  const lockSources = havocCliLockSourcesOf(assets);
  let havocRun: HavocCliVariantRun | null = null;
  let normalRun: HavocCliVariantRun | null = null;
  let acceptedState: HavocRunState | null = null;
  if (replayed !== null) {
    havocRun = simulateHavocCliVariant({
      locked: replayed.locked,
      variant: 'havoc',
      gameNumbers: report.havoc.games.map((game) => game.gameNumber),
      retainResults: true,
    });
    checks.havocGames = havocRun.games.length;
    if (!compareReSimulatedGames('havoc', report.havoc, havocRun, findings)) {
      checks.digests = false;
    }
    if (report.normal !== null) {
      normalRun = simulateHavocCliVariant({
        locked: replayed.locked,
        variant: 'normal',
        gameNumbers: report.normal.games.map((game) => game.gameNumber),
        retainResults: true,
      });
      checks.normalGames = normalRun.games.length;
      if (!compareReSimulatedGames('normal', report.normal, normalRun, findings)) {
        checks.digests = false;
      }
    }
    if (report.normal !== null) {
      for (const game of report.normal.games) {
        const havocGame = report.havoc.games.find(
          (candidate) => candidate.gameNumber === game.gameNumber,
        );
        if (havocGame === undefined) continue;
        const havocInput = buildHavocGameInput({
          locked: replayed.locked,
          gameNumber: game.gameNumber,
          variant: 'havoc',
        });
        const normalInput = buildHavocGameInput({
          locked: replayed.locked,
          gameNumber: game.gameNumber,
          variant: 'normal',
        });
        const pairFindings = havocCliInputPairCheck(havocInput, normalInput);
        for (const finding of pairFindings) findings.push(`paired: ${finding}`);
        if (pairFindings.length > 0) checks.paired = false;
      }
    }
  }
  if (!pairedChecks(report, findings)) checks.paired = false;

  const aggregatesOk =
    reconcileAggregate('havoc', report.havoc, findings) &&
    (report.normal === null || reconcileAggregate('normal', report.normal, findings));
  if (!aggregatesOk) checks.aggregates = false;

  if (replayed !== null && havocRun !== null && havocRun.failures.length === 0) {
    try {
      acceptedState = acceptHavocCliVariant({
        state: replayed.state,
        environment,
        lockSources,
        run: havocRun,
      });
    } catch (error) {
      findings.push(
        `aggregate: havoc acceptance replay failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      checks.aggregates = false;
    }
  }
  if (
    replayed !== null &&
    acceptedState !== null &&
    havocRun !== null &&
    normalRun !== null &&
    havocRun.failures.length === 0 &&
    normalRun.failures.length === 0 &&
    havocRun.results.length === HAVOC_GAME_COUNT &&
    normalRun.results.length === HAVOC_GAME_COUNT &&
    report.comparison !== null &&
    report.report !== null
  ) {
    try {
      const stateAfterNormal = acceptHavocCliVariant({
        state: acceptedState,
        environment,
        lockSources,
        run: normalRun,
      });
      const recomputedComparison = canonicalHavocComparisonOf({
        runId: report.runId,
        locked: replayed.locked,
        havoc: havocRun,
        normal: normalRun,
      });
      if (!sameJson(recomputedComparison, report.comparison)) {
        findings.push(
          'aggregate: canonical comparison disagrees with the re-simulated paired seasons',
        );
        checks.aggregates = false;
      }
      const recomputedReport = canonicalHavocReportOf({
        state: stateAfterNormal,
        havoc: havocRun,
        normal: normalRun,
        comparison: recomputedComparison,
      });
      if (!sameJson(recomputedReport, report.report)) {
        findings.push('aggregate: canonical report disagrees with the re-simulated paired seasons');
        checks.aggregates = false;
      }
    } catch (error) {
      findings.push(
        `aggregate: canonical comparison/report replay failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      checks.aggregates = false;
    }
  }
  if (report.normal !== null && (report.comparison === null || report.report === null)) {
    findings.push('aggregate: normal season recorded without the canonical comparison/report');
    checks.aggregates = false;
  }
  if (report.normal === null && (report.comparison !== null || report.report !== null)) {
    findings.push('aggregate: comparison/report recorded without a normal season');
    checks.aggregates = false;
  }

  const recomputedDigest = havocCliReportDigest(report);
  if (recomputedDigest !== report.reportDigest) {
    findings.push(`digest: report digest ${report.reportDigest} != recomputed ${recomputedDigest}`);
    checks.digests = false;
  }

  const capped = findings.slice(0, 200).map((finding) => finding.slice(0, 512));
  return havocAuditReportSchema.parse({
    schemaVersion: 1,
    command: 'havoc audit',
    input: inputPath,
    reportDigest: report.reportDigest,
    recomputedReportDigest: recomputedDigest,
    findings: capped,
    checks,
    pass: capped.length === 0,
  });
}

function unwrapReportJson(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (record['command'] === 'havoc simulate' && record['payload'] !== undefined) {
    return record['payload'];
  }
  return value;
}

export function havocAudit(args: {
  input: string | null;
  positional?: string | null;
  manifest: string | null;
}): CliReport {
  const positional = args.positional ?? null;
  if (args.input !== null && positional !== null && args.input !== positional) {
    throw new UsageError(
      `havoc audit received both --input and a positional report path; provide one`,
    );
  }
  const inputPath = args.input ?? positional;
  const input = { input: inputPath, manifest: args.manifest };
  if (inputPath === null) {
    throw new UsageError('havoc audit requires --input <report.json> or a positional path');
  }
  let parsedReport: HavocSimulateReport;
  try {
    const parsed = havocSimulateReportSchema.safeParse(
      unwrapReportJson(readHavocJsonFile(inputPath)),
    );
    if (!parsed.success) {
      return makeReport('havoc audit', input, {
        failures: [
          `report ${inputPath} fails the havoc simulate schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        ],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      });
    }
    parsedReport = parsed.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return makeReport('havoc audit', input, {
      failures: [`cannot read report ${inputPath}: ${message}`],
      exitCode: EXIT_USAGE_OR_DATA_ERROR,
    });
  }
  try {
    const assets = loadHavocCliAssets(args.manifest ?? undefined);
    const payload = auditHavocSimulateReport(parsedReport, assets, inputPath);
    const details = [
      `report ${inputPath} · seed ${parsedReport.runSeed} · draft ${parsedReport.draft.mode}`,
      `re-simulated ${String(payload.checks.havocGames)} havoc + ${String(payload.checks.normalGames)} normal games`,
      `report digest ${payload.reportDigest} · recomputed ${payload.recomputedReportDigest}`,
      `checks: assets ${String(payload.checks.assetsMatch)} · draft ${String(payload.checks.draftReplay)} · paired ${String(payload.checks.paired)} · aggregates ${String(payload.checks.aggregates)} · digests ${String(payload.checks.digests)}`,
      `findings ${String(payload.findings.length)}`,
    ];
    details.push(...payload.findings.slice(0, 20));
    return makeReport('havoc audit', input, {
      details,
      failures: payload.findings,
      payload,
    });
  } catch (error) {
    if (error instanceof UsageError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof HavocCliError ? `${error.code}: ` : '';
    return makeReport('havoc audit', input, {
      failures: [`${code}${message}`],
      exitCode: EXIT_USAGE_OR_DATA_ERROR,
    });
  }
}
