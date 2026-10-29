import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { generateSchedule, scheduleInvariants, validateBracketContent } from '@hoop-rush/engine';
import {
  opponentBracketSchema,
  type HoopRushManifest,
  type OpponentBracket,
} from '@hoop-rush/data-contracts';
import { makeReport, EXIT_USAGE_OR_DATA_ERROR, type CliReport } from '../report.ts';
import { bracketAuditReportSchema } from '../report-schemas.ts';
import { readJson, sha256Hex } from '../io.ts';
import { median } from '../stats.ts';
export function bracketAudit(inputPath: string, verbose: boolean): CliReport {
  let manifest: HoopRushManifest;
  try {
    manifest = readJson(inputPath) as HoopRushManifest;
  } catch (error) {
    return makeReport(
      'bracket audit',
      { input: inputPath },
      { failures: [(error as Error).message], exitCode: EXIT_USAGE_OR_DATA_ERROR },
    );
  }
  const entries: Array<{ label: string; entry: NonNullable<HoopRushManifest['bracket']> }> = [
    ...(manifest.bracket ? [{ label: 'bracket', entry: manifest.bracket }] : []),
  ];
  if (entries.length === 0) {
    return makeReport(
      'bracket audit',
      { input: inputPath },
      { failures: ['manifest has no bracket reference'], exitCode: EXIT_USAGE_OR_DATA_ERROR },
    );
  }
  const failures: string[] = [];
  const details: string[] = [];
  let payload: ReturnType<typeof bracketAuditReportSchema.parse> | null = null;
  for (const { label, entry } of entries) {
    const tag = entries.length > 1 ? `${label}: ` : '';
    const artifactPath = isAbsolute(entry.url) ? entry.url : resolve(dirname(inputPath), entry.url);
    let content: Buffer;
    try {
      content = readFileSync(artifactPath);
    } catch {
      failures.push(`${tag}bracket artifact missing: ${artifactPath}`);
      continue;
    }
    const actualHash = sha256Hex(content);
    if (actualHash !== entry.contentHash) {
      failures.push(`${tag}bracket content hash mismatch (${artifactPath})`);
    } else if (verbose) {
      details.push(`${tag}bracket hash verified (${artifactPath})`);
    }
    let bracket: OpponentBracket;
    try {
      bracket = opponentBracketSchema.parse(readJson(artifactPath));
    } catch (error) {
      failures.push(`${tag}bracket artifact fails the schema: ${(error as Error).message}`);
      continue;
    }
    const contentFailures = validateBracketContent(bracket);
    failures.push(...contentFailures.map((f) => `${tag}content: ${f}`));
    const scheduleFailures = scheduleInvariants(bracket.schedule);
    failures.push(...scheduleFailures.map((f) => `${tag}schedule: ${f}`));
    const difficulty = bracket.difficulty;
    const band = difficulty.teamPercentileBand;
    const medianBand = difficulty.leagueMedianPercentileBand;
    const percentiles = bracket.opponents.map((o) => o.strength.percentile);
    const bracketMedian = median(percentiles);
    const minP = Math.min(...percentiles);
    const maxP = Math.max(...percentiles);
    if (minP < band[0] || maxP > band[1]) {
      failures.push(
        `${tag}strength percentiles span ${minP.toFixed(3)}..${maxP.toFixed(3)} outside band ${band[0].toFixed(2)}..${band[1].toFixed(2)}`,
      );
    }
    if (bracketMedian < medianBand[0] || bracketMedian > medianBand[1]) {
      failures.push(
        `${tag}league median percentile ${bracketMedian.toFixed(3)} outside ${medianBand[0].toFixed(2)}..${medianBand[1].toFixed(2)}`,
      );
    }
    const opponentIds = bracket.opponents.map((o) => o.opponentId);
    let regenerated: string[] | null = null;
    try {
      const schedule = generateSchedule(opponentIds, bracket.generation.seed);
      if (JSON.stringify(schedule) !== JSON.stringify(bracket.schedule)) {
        failures.push(
          `${tag}schedule regeneration with the committed seed differs from the artifact`,
        );
      } else if (verbose) {
        details.push(`${tag}schedule regeneration byte-identical`);
      }
      regenerated = schedule.map((s) => s.opponentId);
    } catch (error) {
      failures.push(`${tag}schedule regeneration failed: ${(error as Error).message}`);
    }
    const strengthByTeam = bracket.opponents.map((o) => ({
      opponentId: o.opponentId,
      teamId: o.teamId,
      winRate: o.strength.winRate,
      percentile: o.strength.percentile,
      sampleCount: o.strength.sampleCount,
    }));
    payload = bracketAuditReportSchema.parse({
      schemaVersion: 1,
      command: 'bracket audit',
      dataVersion: manifest.dataVersion,
      bracketVersion: bracket.bracketVersion,
      scheduleVersion: bracket.scheduleVersion,
      generationSeed: bracket.generation.seed,
      generationVersion: bracket.generation.generationVersion,
      difficultyProfileVersion: difficulty.profileVersion,
      opponents: strengthByTeam,
      schedulePreview: regenerated,
      leagueMedianPercentile: bracketMedian,
      minPercentile: minP,
      maxPercentile: maxP,
      teamPercentileBand: band,
      leagueMedianPercentileBand: medianBand,
      pass: failures.length === 0,
    });
    details.push(
      `${tag}bracket ${bracket.bracketVersion} · schedule ${bracket.scheduleVersion} · generation ${bracket.generation.generationVersion} (seed ${bracket.generation.seed})`,
      `${tag}opponents: ${String(bracket.opponents.length)} · percentile span ${minP.toFixed(3)}..${maxP.toFixed(3)} · median ${bracketMedian.toFixed(3)}`,
      `${tag}difficulty ${difficulty.profileVersion} · bands team ${band[0].toFixed(2)}..${band[1].toFixed(2)} median ${medianBand[0].toFixed(2)}..${medianBand[1].toFixed(2)}`,
    );
    if (verbose) {
      for (const opponent of bracket.opponents) {
        details.push(
          `${tag}  ${opponent.opponentId}: ${String(opponent.strength.sampleCount)} games · winRate ${opponent.strength.winRate.toFixed(3)} · pct ${opponent.strength.percentile.toFixed(3)}`,
        );
      }
    }
  }
  return makeReport(
    'bracket audit',
    { input: inputPath, dataVersion: manifest.dataVersion },
    { details, failures, ...(payload === null ? {} : { payload }) },
  );
}
