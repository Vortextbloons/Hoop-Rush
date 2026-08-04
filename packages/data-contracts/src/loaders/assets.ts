import type { HoopRushManifest } from '../manifest.js';
import type { PlayerExternalId, TeamExternalId } from '../ids.js';
import type { PeakPlayerSeason } from '../player-season.js';
import { franchiseLogoSlug } from '../franchise.js';

/**
 * Asset URL resolution from the manifest's versioned templates (spec/02).
 * Returns null when the template is absent; the UI falls back to initials.
 * Gameplay never depends on an image request succeeding.
 */
export function resolveHeadshotUrl(
  manifest: HoopRushManifest,
  playerExternalId: PlayerExternalId,
): string | null {
  const template = manifest.assets.headshotUrlTemplate;
  return template ? template.replace('{playerExternalId}', playerExternalId) : null;
}

/**
 * Secondary headshot URL resolved from the manifest's fallback template and
 * the player's optional Basketball-Reference ID. Returns null when either is
 * unavailable, so callers fall through to the deterministic initials.
 */
export function resolveSecondaryHeadshotUrl(
  manifest: HoopRushManifest,
  player: Pick<PeakPlayerSeason, 'playerExternalId' | 'altIds'>,
): string | null {
  const template = manifest.assets.headshotUrlTemplateSecondary;
  const bbrefId = player.altIds?.bbref ?? null;
  return template && bbrefId ? template.replace('{altIds.bbref}', bbrefId) : null;
}

/** Ordered headshot candidates: primary NBA CDN, then secondary, then direct photo, then none. */
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

/** True when the URL targets the NBA CDN headshot template (not a fallback host). */
export function isNbaCdnHeadshotUrl(url: string): boolean {
  return url.includes('cdn.nba.com/headshots/');
}

/** NBA CDN returns this exact byte length for the generic silhouette placeholder. */
export const NBA_HEADSHOT_PLACEHOLDER_BYTES = 12430;

/**
 * Whether a stalled NBA CDN request should advance to the next fallback.
 * When build-time annotation confirms a real NBA headshot exists, do not
 * time out into the wiki photo tier — only advance on an actual load error
 * or when a bbref secondary is still available to try.
 */
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

/**
 * Secondary logo URL resolved from the manifest's fallback template and the
 * franchise's standard three-letter abbreviation. Returns null when either is
 * unavailable, so callers fall through to no logo.
 */
export function resolveSecondaryLogoUrl(
  manifest: HoopRushManifest,
  franchiseId: string,
): string | null {
  const template = manifest.assets.logoUrlTemplateSecondary;
  if (!template) return null;
  // Secondary logo hosts (e.g. ESPN) use lowercase slugs that can differ
  // from the standard abbreviation (Pelicans -> no, Jazz -> utah).
  return template.replace('{teamAbbreviation}', franchiseLogoSlug(franchiseId));
}

/** Ordered logo candidates: primary NBA CDN, then secondary, then none. */
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

/**
 * Ordered logo candidates with a verified historical mark first: the era's
 * historical candidates, then the modern template chain, deduplicated. When
 * the historical list is empty (unavailable franchise-era) the result equals
 * `resolveLogoUrls`, so gameplay never depends on historical artwork.
 */
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
