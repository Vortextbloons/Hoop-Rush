import type { HoopRushManifest } from '../manifest.ts';
import type { PlayerExternalId, TeamExternalId } from '../ids.ts';
import type { PeakPlayerSeason } from '../player-season.ts';
import { franchiseLogoSlug } from '../franchise.ts';
export function resolveHeadshotUrl(
  manifest: HoopRushManifest,
  playerExternalId: PlayerExternalId,
): string | null {
  const template = manifest.assets.headshotUrlTemplate;
  return template ? template.replace('{playerExternalId}', playerExternalId) : null;
}
export function resolveSecondaryHeadshotUrl(
  manifest: HoopRushManifest,
  player: Pick<PeakPlayerSeason, 'playerExternalId' | 'altIds'>,
): string | null {
  const template = manifest.assets.headshotUrlTemplateSecondary;
  const bbrefId = player.altIds?.bbref ?? null;
  return template && bbrefId ? template.replace('{altIds.bbref}', bbrefId) : null;
}
export function resolveHeadshotUrls(
  manifest: HoopRushManifest,
  player: Pick<PeakPlayerSeason, 'playerExternalId' | 'altIds'>,
): string[] {
  const urls: string[] = [];
  const primary = resolveHeadshotUrl(manifest, player.playerExternalId);
  const nbaAvailable = player.altIds?.nbaHeadshotAvailable ?? true;
  if (primary && nbaAvailable) urls.push(primary);
  const secondary = resolveSecondaryHeadshotUrl(manifest, player);
  if (secondary) urls.push(secondary);
  const photoUrl = player.altIds?.photoUrl ?? null;
  if (photoUrl) urls.push(photoUrl);
  return urls;
}
export function isNbaCdnHeadshotUrl(url: string): boolean {
  return url.includes('cdn.nba.com/headshots/');
}
export const NBA_HEADSHOT_PLACEHOLDER_BYTES = 12430;
export function shouldStallTimeoutHeadshot(
  url: string,
  urls: string[],
  attempt: number,
  player: Pick<PeakPlayerSeason, 'altIds'>,
): boolean {
  if (!isNbaCdnHeadshotUrl(url)) return true;
  if (player.altIds?.nbaHeadshotAvailable !== true) return true;
  return urls.slice(attempt + 1).some((candidate) => candidate.includes('basketball-reference'));
}
export function resolveLogoUrl(
  manifest: HoopRushManifest,
  teamExternalId: TeamExternalId,
): string | null {
  const template = manifest.assets.logoUrlTemplate;
  return template ? template.replace('{teamExternalId}', teamExternalId) : null;
}
export function resolveSecondaryLogoUrl(
  manifest: HoopRushManifest,
  franchiseId: string,
): string | null {
  const template = manifest.assets.logoUrlTemplateSecondary;
  if (!template) return null;
  return template.replace('{teamAbbreviation}', franchiseLogoSlug(franchiseId));
}
export function resolveLogoUrls(
  manifest: HoopRushManifest,
  franchiseId: string,
  teamExternalId: TeamExternalId,
): string[] {
  const urls: string[] = [];
  const primary = resolveLogoUrl(manifest, teamExternalId);
  if (primary) urls.push(primary);
  const secondary = resolveSecondaryLogoUrl(manifest, franchiseId);
  if (secondary) urls.push(secondary);
  return urls;
}
export function resolveLogoUrlsWithHistorical(
  manifest: HoopRushManifest,
  franchiseId: string,
  teamExternalId: TeamExternalId,
  historicalLogoCandidates: readonly string[],
): string[] {
  const urls: string[] = [];
  for (const url of historicalLogoCandidates) {
    if (!urls.includes(url)) urls.push(url);
  }
  for (const url of resolveLogoUrls(manifest, franchiseId, teamExternalId)) {
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}
