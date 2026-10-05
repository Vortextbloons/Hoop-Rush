import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  OVERALL_BANDS,
  peakPlayerSeasonSchema,
  type PeakPlayerSeason,
} from '@hoop-rush/data-contracts';
import { NBA_ROOT, REPO_ROOT, ratings, readJson, writeJsonRetry } from '@hoop-rush/importer';
import { makeReport, type CliReport } from '../report.ts';
import { loadOverallRows } from './data-overalls.ts';

export const DATA_OVERALLS_COMPARE_OPTIONS: Record<string, boolean> = {
  input: true,
  baseline: true,
  output: true,
  format: true,
};

const baselineSchema = z.object({
  rows: z.array(peakPlayerSeasonSchema),
  fingerprints: z
    .array(z.object({ season: z.string(), id: z.string().nullable().optional(), hash: z.string() }))
    .optional(),
});

function distribution(rows: readonly PeakPlayerSeason[]) {
  const values = rows.map((row) => row.summaryRatings.overallRating);
  return {
    count: rows.length,
    mean: values.length
      ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
      : null,
    bands: Object.fromEntries(
      OVERALL_BANDS.map((band) => [
        band.label,
        values.filter((value) => value >= band.min && value <= band.max).length,
      ]),
    ),
  };
}

function groups(rows: readonly PeakPlayerSeason[], key: (row: PeakPlayerSeason) => string) {
  const grouped = new Map<string, PeakPlayerSeason[]>();
  for (const row of rows) {
    const group = key(row);
    grouped.set(group, [...(grouped.get(group) ?? []), row]);
  }
  return Object.fromEntries(
    [...grouped]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, players]) => [group, distribution(players)]),
  );
}

function archetype(row: PeakPlayerSeason): string {
  return (
    Object.entries(row.ratingProfile?.memberships ?? {}).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0]?.[0] ?? 'unknown'
  );
}

export function dataOverallsCompare(options: {
  input: string;
  baseline?: string;
  output?: string;
}): CliReport {
  try {
    if (!options.baseline || !options.output)
      throw new Error('--baseline and --output are required');
    const baseline = baselineSchema.parse(readJson(resolve(REPO_ROOT, options.baseline)));
    const loaded = loadOverallRows(options.input);
    if ('failure' in loaded) throw new Error(loaded.failure);
    if (loaded.failures.length) throw new Error(loaded.failures.join('\n'));
    const slot = (row: PeakPlayerSeason) =>
      `${row.playerExternalId}|${row.franchiseId}|${row.eraId}`;
    const previous = new Map(baseline.rows.map((row) => [slot(row), row]));
    const changes = loaded.rows.map((row) => {
      const old = previous.get(slot(row));
      return {
        player: row.displayName,
        playerExternalId: row.playerExternalId,
        franchise: row.franchiseId,
        era: row.eraId,
        position: row.positions.primary,
        previousSeason: old?.seasonKey ?? null,
        season: row.seasonKey,
        previousOverall: old?.summaryRatings.overallRating ?? null,
        overall: row.summaryRatings.overallRating,
        delta: old ? row.summaryRatings.overallRating - old.summaryRatings.overallRating : null,
        previousRawScore: old?.ratingProfile?.rawOverallScore ?? null,
        rawScore: row.ratingProfile?.rawOverallScore ?? null,
        components: row.ratingProfile?.overallDiagnostics ?? null,
        peakChanged: old !== undefined && old.seasonKey !== row.seasonKey,
      };
    });
    let checked = 0;
    let changed = 0;
    const seasons = new Map<string, Record<string, unknown>[]>();
    const seasonIndexes = new Map<string, number>();
    for (const fingerprint of baseline.fingerprints ?? []) {
      let roster = seasons.get(fingerprint.season);
      if (!roster) {
        roster = z
          .array(z.record(z.string(), z.unknown()))
          .parse(readJson(join(NBA_ROOT, fingerprint.season, 'roster.json')));
        seasons.set(fingerprint.season, roster);
      }
      const index = seasonIndexes.get(fingerprint.season) ?? 0;
      seasonIndexes.set(fingerprint.season, index + 1);
      const player = roster[index];
      if (!player || player.externalId !== fingerprint.id)
        throw new Error('baseline roster identity/order mismatch');
      const hash = createHash('sha256')
        .update(
          JSON.stringify([
            player.ratings,
            player.tendencies,
            player.anchors,
            player.provenance,
            player.reconstructedThreePoint,
          ]),
        )
        .digest('hex');
      if (hash !== fingerprint.hash) changed += 1;
      checked += 1;
    }
    const examples = [
      'Rudy Gobert',
      'Ben Wallace',
      'Draymond Green',
      'Anthony Davis',
      'Anthony Edwards',
      'Carmelo Anthony',
    ].map((name) => ({
      player: name,
      previousPeak:
        baseline.rows
          .filter((row) => row.displayName === name)
          .sort((a, b) => b.summaryRatings.overallRating - a.summaryRatings.overallRating)[0]
          ?.summaryRatings.overallRating ?? null,
      peak:
        loaded.rows
          .filter((row) => row.displayName === name)
          .sort((a, b) => b.summaryRatings.overallRating - a.summaryRatings.overallRating)[0]
          ?.summaryRatings.overallRating ?? null,
    }));
    const artifact = ratings.loadRatingsModelArtifact();
    const report = {
      schemaVersion: 1,
      dataVersion: loaded.manifest.dataVersion,
      reference: artifact.overallScale?.reference,
      simulationInputs: { checked, changed },
      before: distribution(baseline.rows),
      after: distribution(loaded.rows),
      positions: {
        before: groups(baseline.rows, (row) => row.positions.primary),
        after: groups(loaded.rows, (row) => row.positions.primary),
      },
      archetypes: {
        before: groups(baseline.rows, archetype),
        after: groups(loaded.rows, archetype),
      },
      changedPeaks: changes.filter((row) => row.peakChanged).length,
      largestMovements: [...changes]
        .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0))
        .slice(0, 50),
      examples,
      changes,
    };
    writeJsonRetry(resolve(REPO_ROOT, options.output), report, true);
    return makeReport('data overalls-compare', options, {
      details: [
        `compared ${String(changes.length)} pool entries; ${String(report.changedPeaks)} selected peaks changed`,
        `simulation inputs: ${String(checked)} checked, ${String(changed)} changed`,
        ...examples.map(
          (row) => `${row.player}: ${String(row.previousPeak)} → ${String(row.peak)}`,
        ),
        `report: ${options.output}`,
      ],
      failures: changed ? ['Overall rebuild changed stored simulation inputs'] : [],
      exitCode: changed ? 1 : 0,
    });
  } catch (error) {
    return makeReport('data overalls-compare', options, {
      failures: [(error as Error).message],
      exitCode: 1,
    });
  }
}
