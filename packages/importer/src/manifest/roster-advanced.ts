import { join } from 'node:path';
import { z } from 'zod';
import type { PeakPlayerSeason, PlayerSeasonStats } from '@hoop-rush/data-contracts';
import { NBA_ROOT } from '../config.ts';
import { fileExists, readJson } from '../json.ts';

const advancedSchema = z.object({
  schemaVersion: z.literal(1),
  seasonKey: z.string().regex(/^\d{4}-\d{2}$/),
  sourceUrl: z.url(),
  players: z.array(
    z.object({
      bbrefId: z.string().regex(/^[a-z]+\d{2}$/),
      displayName: z.string().optional(),
      gamesPlayed: z.number().int().positive(),
      minutes: z.number().positive(),
      per: z.number().min(-100).max(100).nullable(),
      boxPlusMinus: z.number().min(-100).max(100).nullable(),
      usageRate: z.number().min(0).max(100).nullable(),
    }),
  ),
});
const shootingRowSchema = z.object({
  playerExternalId: z.string(),
  gamesPlayed: z.number().int().positive(),
  minutes: z.number().positive(),
  tpm: z.number().nonnegative().nullable(),
  tpa: z.number().nonnegative().nullable(),
});

export function recoverRosterShooting(
  player: Pick<PeakPlayerSeason, 'stats' | 'playerExternalId' | 'seasonKey'>,
  raw: unknown,
): PlayerSeasonStats {
  const parsed = shootingRowSchema.safeParse(raw);
  if (!parsed.success) return player.stats;
  const row = parsed.data;
  if (
    Number.parseInt(player.seasonKey, 10) < 1979 ||
    row.playerExternalId !== player.playerExternalId ||
    row.gamesPlayed !== player.stats.gamesPlayed ||
    Math.abs(row.minutes - player.stats.minutes) > 1 ||
    row.tpm !== 0 ||
    row.tpa !== 0
  )
    return player.stats;
  return {
    ...player.stats,
    threesMade: player.stats.threesMade ?? 0,
    threesAttempted: player.stats.threesAttempted ?? 0,
  };
}

export function recoverRosterAdvanced(
  player: Pick<PeakPlayerSeason, 'stats' | 'altIds' | 'seasonKey' | 'lastName'>,
  raw: unknown,
): PlayerSeasonStats {
  const source = advancedSchema.parse(raw);
  if (source.seasonKey !== player.seasonKey) throw new Error('advanced-stat season mismatch');
  const matches = source.players.filter((row) => row.bbrefId === player.altIds?.bbref);
  if (matches.length > 1) throw new Error('duplicate advanced-stat identity');
  const workloadMatches = (row: (typeof source.players)[number]) =>
    row.gamesPlayed === player.stats.gamesPlayed &&
    Math.abs(row.minutes - player.stats.minutes) <= 1;
  const normalize = (name: string) =>
    name
      .normalize('NFKD')
      .replace(/[ðÐ]/g, 'd')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
  const lastName = normalize(player.lastName.trim().split(/\s+/).at(-1) ?? '');
  const fallback = source.players.filter(
    (candidate) =>
      workloadMatches(candidate) &&
      candidate.displayName &&
      normalize(candidate.displayName.trim().split(/\s+/).at(-1) ?? '') === lastName,
  );
  const identified = matches[0];
  const row =
    identified && workloadMatches(identified)
      ? identified
      : fallback.length === 1
        ? fallback[0]
        : undefined;
  if (
    !row ||
    row.gamesPlayed !== player.stats.gamesPlayed ||
    Math.abs(row.minutes - player.stats.minutes) > 1
  ) {
    return player.stats;
  }
  return {
    ...player.stats,
    per: player.stats.per ?? row.per,
    boxPlusMinus: player.stats.boxPlusMinus ?? row.boxPlusMinus,
    usageRate: player.stats.usageRate ?? row.usageRate,
  };
}

export function rosterAdvancedLoader() {
  const sources = new Map<string, unknown>();
  const shootingSources = new Map<string, Map<string, unknown>>();
  return (player: PeakPlayerSeason) => {
    if (!sources.has(player.seasonKey)) {
      const path = join(NBA_ROOT, player.seasonKey, 'roster-advanced.json');
      sources.set(player.seasonKey, fileExists(path) ? readJson(path) : null);
    }
    const raw = sources.get(player.seasonKey);
    if (!shootingSources.has(player.seasonKey)) {
      const path = join(NBA_ROOT, player.seasonKey, 'season-stats.json');
      const rows = fileExists(path)
        ? z.array(z.looseObject({ playerExternalId: z.string() })).parse(readJson(path))
        : [];
      shootingSources.set(
        player.seasonKey,
        new Map(rows.map((row) => [row.playerExternalId, row])),
      );
    }
    const statsWithAdvanced = raw === null ? player.stats : recoverRosterAdvanced(player, raw);
    const stats = recoverRosterShooting(
      { ...player, stats: statsWithAdvanced },
      shootingSources.get(player.seasonKey)?.get(player.playerExternalId),
    );
    const statSources: Partial<Record<'per' | 'boxPlusMinus' | 'usageRate', string>> = {};
    if (raw !== null) {
      const source = advancedSchema.parse(raw);
      for (const key of ['per', 'boxPlusMinus', 'usageRate'] as const) {
        if (player.stats[key] === null && stats[key] !== null) statSources[key] = source.sourceUrl;
      }
    }
    return { stats, statSources };
  };
}
