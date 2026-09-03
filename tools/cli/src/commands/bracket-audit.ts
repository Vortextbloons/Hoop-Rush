import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { generateSchedule, scheduleInvariants, validateBracketContent } from '@hoop-rush/engine';
import {
  opponentBracketSchema,
  opponentTeamSchema,
  type HoopRushManifest,
  type OpponentBracket,
} from '@hoop-rush/data-contracts';
import { makeReport, EXIT_USAGE_OR_DATA_ERROR, type CliReport } from '../report.ts';
import { bracketAuditReportSchema } from '../report-schemas.ts';
import { readJson, sha256Hex } from '../io.ts';
import { median } from '../stats.ts';
export const BRACKET_AUDIT_OPTIONS: Record<string, boolean> = {
  input: true,
  format: true,
  verbose: false,
};
function openingOpponentUnchanged(bracket: OpponentBracket, previewPath: string): string[] {
  const failures: string[] = [];
  const preview = readJson(previewPath);
  const parsed = opponentTeamSchema.safeParse(preview);
  if (!parsed.success) {
    failures.push(`opening opponent preview fails the opponent schema (${previewPath})`);
    return failures;
  }
  const entry = bracket.opponents.find((o) => o.opponentId === 'lakers-1990s-opening');
  if (!entry) {
    failures.push('opening opponent missing from the bracket');
    return failures;
  }
  if (JSON.stringify(entry.lineup) !== JSON.stringify(parsed.data.lineup)) {
    failures.push('opening opponent lineup changed from the preview artifact');
  }
  if (JSON.stringify(entry.players) !== JSON.stringify(parsed.data.players)) {
    failures.push('opening opponent players changed from the preview artifact');
  }
  if (entry.teamId !== parsed.data.teamId || entry.displayName !== parsed.data.displayName) {
    failures.push('opening opponent identity changed from the preview artifact');
  }
  return failures;
}
export function bracketAudit(
  inputPath: string,
  verbose: boolean,
  previewPath = resolve(dirname(inputPath), 'opponents/lakers-1990s-opening.json'),
): CliReport {
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
  const entry = manifest.bracket;
  if (!entry) {
    return makeReport(
      'bracket audit',
      { input: inputPath },
      { failures: ['manifest has no bracket reference'], exitCode: EXIT_USAGE_OR_DATA_ERROR },
    );
  }
  const artifactPath = isAbsolute(entry.url) ? entry.url : resolve(dirname(inputPath), entry.url);
  let content: Buffer;
  try {
    content = readFileSync(artifactPath);
  } catch {
    return makeReport(
      'bracket audit',
      { input: inputPath },
      {
        failures: [`bracket artifact missing: ${artifactPath}`],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      },
    );
  }
  const failures: string[] = [];
  const details: string[] = [];
  const actualHash = sha256Hex(content);
  if (actualHash !== entry.contentHash) {
    failures.push(`bracket content hash mismatch (${artifactPath})`);
  } else if (verbose) {
    details.push(`bracket hash verified (${artifactPath})`);
  }
  let bracket: OpponentBracket;
  try {
    bracket = opponentBracketSchema.parse(readJson(artifactPath));
  } catch (error) {
    return makeReport(
      'bracket audit',
      { input: inputPath },
      {
        failures: [`bracket artifact fails the schema: ${(error as Error).message}`],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      },
    );
  }
  const contentFailures = validateBracketContent(bracket);
  failures.push(...contentFailures.map((f) => `content: ${f}`));
  const scheduleFailures = scheduleInvariants(bracket.schedule);
  failures.push(...scheduleFailures.map((f) => `schedule: ${f}`));
  const difficulty = bracket.difficulty;
  const band = difficulty.teamPercentileBand;
  const medianBand = difficulty.leagueMedianPercentileBand;
  const percentiles = bracket.opponents.map((o) => o.strength.percentile);
  const bracketMedian = median(percentiles);
  const openingEntry = bracket.opponents.find((o) => o.opponentId === 'lakers-1990s-opening');
  const generatedPercentiles = bracket.opponents
    .filter((o) => o.opponentId !== 'lakers-1990s-opening')
    .map((o) => o.strength.percentile);
  const minP = Math.min(...generatedPercentiles);
  const maxP = Math.max(...generatedPercentiles);
  const openingPercentile = openingEntry?.strength.percentile ?? 0;
  if (minP < band[0] || maxP > band[1]) {
    failures.push(
      `generated strength percentiles span ${minP.toFixed(3)}..${maxP.toFixed(3)} outside band ${band[0].toFixed(2)}..${band[1].toFixed(2)}`,
    );
  }
  if (bracketMedian < medianBand[0] || bracketMedian > medianBand[1]) {
    failures.push(
      `league median percentile ${bracketMedian.toFixed(3)} outside ${medianBand[0].toFixed(2)}..${medianBand[1].toFixed(2)}`,
    );
  }
  if (openingPercentile < band[0] || openingPercentile > band[1]) {
    details.push(
      `opening opponent percentile ${openingPercentile.toFixed(3)} outside the band (authored fixed entry, informational)`,
    );
  }
  let openingFailures: string[];
  try {
    openingFailures = openingOpponentUnchanged(bracket, previewPath);
  } catch (error) {
    return makeReport(
      'bracket audit',
      { input: inputPath },
      { failures: [(error as Error).message], exitCode: EXIT_USAGE_OR_DATA_ERROR },
    );
  }
  failures.push(...openingFailures);
  if (bracket.schedule[0]?.opponentId !== 'lakers-1990s-opening') {
    failures.push('schedule game one must be the lakers-1990s-opening opponent');
  }
  const opponentIds = bracket.opponents.map((o) => o.opponentId);
  let regenerated: string[] | null = null;
  try {
    const schedule = generateSchedule(opponentIds, 'lakers-1990s-opening', bracket.generation.seed);
    if (JSON.stringify(schedule) !== JSON.stringify(bracket.schedule)) {
      failures.push('schedule regeneration with the committed seed differs from the artifact');
    } else if (verbose) {
      details.push('schedule regeneration byte-identical');
    }
    regenerated = schedule.map((s) => s.opponentId);
  } catch (error) {
    failures.push(`schedule regeneration failed: ${(error as Error).message}`);
  }
  const strengthByTeam = bracket.opponents.map((o) => ({
    opponentId: o.opponentId,
    teamId: o.teamId,
    winRate: o.strength.winRate,
    percentile: o.strength.percentile,
    sampleCount: o.strength.sampleCount,
  }));
  const payload = bracketAuditReportSchema.parse({
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
    openingOpponentUnchanged: openingFailures.length === 0,
    pass: failures.length === 0,
  });
  details.push(
    `bracket ${bracket.bracketVersion} · schedule ${bracket.scheduleVersion} · generation ${bracket.generation.generationVersion} (seed ${bracket.generation.seed})`,
    `opponents: ${String(bracket.opponents.length)} · percentile span ${minP.toFixed(3)}..${maxP.toFixed(3)} · median ${bracketMedian.toFixed(3)}`,
    `difficulty ${difficulty.profileVersion} · bands team ${band[0].toFixed(2)}..${band[1].toFixed(2)} median ${medianBand[0].toFixed(2)}..${medianBand[1].toFixed(2)}`,
  );
  if (verbose) {
    for (const opponent of bracket.opponents) {
      details.push(
        `  ${opponent.opponentId}: ${String(opponent.strength.sampleCount)} games · winRate ${opponent.strength.winRate.toFixed(3)} · pct ${opponent.strength.percentile.toFixed(3)}`,
      );
    }
  }
  return makeReport(
    'bracket audit',
    { input: inputPath, dataVersion: manifest.dataVersion },
    { details, failures, payload },
  );
}
