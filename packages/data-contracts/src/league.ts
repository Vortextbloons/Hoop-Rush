import { z } from 'zod';
import { franchiseIdSchema, playerIdSchema, seedSchema } from './ids.ts';
import { canonicalJson, seasonDigestHex } from './season-hash.ts';
import { LEAGUE_RECORD_VERSION, LEAGUE_SCHEDULE_VERSION } from './versions.ts';

export const leagueTeamRecordSchema = z.object({
  teamId: franchiseIdSchema,
  gamesPlayed: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
});
export type LeagueTeamRecord = z.infer<typeof leagueTeamRecordSchema>;

export const leaguePlayerTotalsSchema = z.object({
  playerId: playerIdSchema,
  teamId: franchiseIdSchema,
  games: z.number().int().nonnegative(),
  totalValueBase: z.number(),
  totalValueBaseSquared: z.number(),
  totalShots: z.number(),
  totalShotsSquared: z.number(),
  totalValueShots: z.number(),
  totalPoints: z.number().int().nonnegative(),
  totalRebounds: z.number().int().nonnegative(),
  totalAssists: z.number().int().nonnegative(),
  totalSteals: z.number().int().nonnegative(),
  totalBlocks: z.number().int().nonnegative(),
  totalGameScore: z.number(),
  totalTrueShooting: z.number(),
});
export type LeaguePlayerTotals = z.infer<typeof leaguePlayerTotalsSchema>;

export const leagueRecordSchema = z.object({
  leagueVersion: z.literal(LEAGUE_RECORD_VERSION),
  scheduleVersion: z.literal(LEAGUE_SCHEDULE_VERSION),
  seed: seedSchema,
  bracketVersion: z.string().min(1).max(64),
  dataVersion: z.string().min(1).max(64),
  eraProfileVersion: z.string().min(1).max(64),
  gamesSimulated: z.number().int().nonnegative(),
  teams: z.array(leagueTeamRecordSchema).length(30),
  players: z.array(leaguePlayerTotalsSchema).length(150),
  digest: z.string().regex(/^[0-9a-f]{32}$/),
});
export type LeagueRecord = z.infer<typeof leagueRecordSchema>;

export function leagueRecordDigest(record: LeagueRecord | Omit<LeagueRecord, 'digest'>): string {
  const {
    leagueVersion,
    scheduleVersion,
    seed,
    bracketVersion,
    dataVersion,
    eraProfileVersion,
    gamesSimulated,
    teams,
    players,
  } = record as LeagueRecord;
  return seasonDigestHex(
    canonicalJson({
      leagueVersion,
      scheduleVersion,
      seed,
      bracketVersion,
      dataVersion,
      eraProfileVersion,
      gamesSimulated,
      teams,
      players,
    }),
  );
}
