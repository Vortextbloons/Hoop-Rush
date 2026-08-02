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
