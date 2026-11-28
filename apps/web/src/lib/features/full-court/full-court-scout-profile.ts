import {
  franchiseAbbreviation,
  type CapRushSourcePlayer,
  type FullCourtDraftState,
  type HoopRushManifest,
} from '@hoop-rush/data-contracts';
import { fullCourtScoutPlayer, type FullCourtCatalogIndex } from '@hoop-rush/engine';
import { teamLabelFor } from '#lib/branding.js';
import { capRushProfileInput } from '#lib/features/cap-rush/cap-rush-player-profile.js';
import { buildPlayerProfile, defaultSlotForPositions } from '#lib/players/player-profile.js';
import { fullCourtProfileReferences } from './full-court-draft-presentation.ts';

export function fullCourtScoutingOwned(draft: Pick<FullCourtDraftState, 'reports'>): boolean {
  return (draft.reports ?? []).some((report) => report.kind === 'player-scouting');
}

export function fullCourtScoutProfile(
  index: FullCourtCatalogIndex,
  player: CapRushSourcePlayer,
  manifest: HoopRushManifest | null,
) {
  const slot = defaultSlotForPositions(player.positions);
  const reference = fullCourtProfileReferences(index).forSlot(slot) ?? null;
  const label =
    manifest === null
      ? franchiseAbbreviation(player.franchiseId)
      : teamLabelFor(manifest, player.franchiseId, player.eraId);
  return {
    profile: buildPlayerProfile(capRushProfileInput(player, label, slot), reference),
    report: fullCourtScoutPlayer(player),
  };
}
