import { z } from 'zod';
import { seedSchema } from './ids.ts';
import { seasonDigestHex } from './season-hash.ts';
import { SEASON_SEED_DERIVATION_VERSION } from './season-versions.ts';
export const SEASON_SEED_NAMESPACES = {
  draft: 'draft',
  aiRosters: 'ai-rosters',
  scheduleGames: 'schedule-games',
  injuries: 'injuries',
  trades: 'trades',
  objectives: 'objectives',
  challenges: 'challenges',
  upgrades: 'upgrades',
  postseasonTies: 'postseason-ties',
  playInGames: 'postseason-play-in',
  playoffGames: 'postseason-playoff-games',
  aiPostseasonRotations: 'postseason-ai-rotations',
  postseasonInjuries: 'postseason-injuries',
  postseasonDraws: 'postseason-draws',
  freeAgency: 'free-agency',
  sponsors: 'sponsors',
} as const;
export type SeasonSeedNamespace = keyof typeof SEASON_SEED_NAMESPACES;
export function seasonNamespaceSeed(
  rootSeed: string,
  namespace: string,
  ...keys: string[]
): z.infer<typeof seedSchema> {
  const separator = String.fromCharCode(0);
  return seedSchema.parse(
    seasonDigestHex(
      [
        SEASON_SEED_DERIVATION_VERSION,
        rootSeed,
        namespace,
        ...keys.map((key) => key.replaceAll(separator, '')),
      ].join(separator),
    ),
  );
}
