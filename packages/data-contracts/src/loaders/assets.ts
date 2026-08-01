import type { HoopRushManifest } from '../manifest.js';
import type { PlayerExternalId, TeamExternalId } from '../ids.js';

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

export function resolveLogoUrl(
  manifest: HoopRushManifest,
  teamExternalId: TeamExternalId,
): string | null {
  const template = manifest.assets.logoUrlTemplate;
  return template ? template.replace('{teamExternalId}', teamExternalId) : null;
}
