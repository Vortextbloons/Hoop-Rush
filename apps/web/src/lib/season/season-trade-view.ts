import type {
  SeasonDraftCatalog,
  SeasonRun,
  SeasonTradeOffer,
  SeasonTradeState,
  SeasonTradeWindowState,
} from '@hoop-rush/data-contracts';

/**
 * M2.5 trade presentation (season-trade-v1). Pure derivation of display
 * facts for generated trade offers: player names from the run rosters,
 * value-band labels, role-fit and roster-need notes from the recorded
 * facts, the projected rotation change, and the chemistry disruption
 * counts. The open-window derivation and offer resolution labels render
 * recorded status facts only; the engine owns offer generation.
 */

export interface TradePlayerViewModel {
  playerVersionId: string;
  displayName: string;
  playable: readonly string[];
  available: boolean;
  activeInjuryIds: string[];
}

export interface TradeOfferViewModel {
  offer: SeasonTradeOffer;
  fromFranchiseId: string;
  fromFranchiseName: string;
  outgoingPlayers: TradePlayerViewModel[];
  incomingPlayers: TradePlayerViewModel[];
  valueBandLabel: string;
  roleFitNotes: string;
  rosterNeedNotes: string;
  rotationProjection: string;
  chemistryDisruption: { removedPairs: number; newPairs: number };
  statusLabel: string;
}

/** Windows open after accepted checkpoints for blocks 2, 4, 5. */
export const TRADE_WINDOW_BLOCK_INDEX: readonly number[] = [2, 4, 5];

/** The block index whose accepted checkpoint opens `windowIndex`. */
export function windowBlockIndexOf(windowIndex: number): number | null {
  return TRADE_WINDOW_BLOCK_INDEX[windowIndex] ?? null;
}

export function tradeOfferViewModel(
  offer: SeasonTradeOffer,
  run: SeasonRun,
  catalog: SeasonDraftCatalog | null,
  franchiseName: (franchiseId: string) => string,
): TradeOfferViewModel {
  const rosterEntry = (playerVersionId: string) => {
    for (const roster of run.rosters) {
      const entry = roster.players.find((player) => player.playerVersionId === playerVersionId);
      if (entry !== undefined) return entry;
    }
    return null;
  };
  const playableOf = (playerVersionId: string): readonly string[] => {
    if (catalog === null) return [];
    return (
      catalog.candidates.find((c) => c.playerVersionId === playerVersionId)?.positions.playable ??
      []
    );
  };
  const viewPlayer = (
    playerVersionId: string,
    health: SeasonTradeOffer['outgoingHealth'][number],
  ): TradePlayerViewModel => {
    const entry = rosterEntry(playerVersionId);
    return {
      playerVersionId,
      displayName: entry?.displayName ?? playerVersionId,
      playable: playableOf(playerVersionId),
      available: health.available,
      activeInjuryIds: health.activeInjuryIds,
    };
  };
  const qualified = offer.valueBand.qualified;
  const ratio = offer.valueBand.ratioBasisPoints / 10;
  const valueBandLabel = `${String(offer.outgoingPlayerVersionIds.length)}-for-${String(
    offer.outgoingPlayerVersionIds.length,
  )} · incoming value ${String(Math.round(ratio))}% of outgoing · band ${
    offer.valueBand.band
  }${qualified ? '' : ' · outside band'}`;
  const statusLabel =
    offer.status === 'open'
      ? 'Open'
      : offer.status === 'accepted'
        ? 'Accepted'
        : offer.status === 'declined'
          ? 'Declined'
          : 'Expired';
  const healthEntryOf = (
    list: SeasonTradeOffer['outgoingHealth'],
    index: number,
  ): SeasonTradeOffer['outgoingHealth'][number] =>
    list[index] ?? { available: true, activeInjuryIds: [] };
  return {
    offer,
    fromFranchiseId: offer.fromFranchiseId,
    fromFranchiseName: franchiseName(offer.fromFranchiseId),
    outgoingPlayers: offer.outgoingPlayerVersionIds.map((id, index) =>
      viewPlayer(id, healthEntryOf(offer.outgoingHealth, index)),
    ),
    incomingPlayers: offer.incomingPlayerVersionIds.map((id, index) =>
      viewPlayer(id, healthEntryOf(offer.incomingHealth, index)),
    ),
    valueBandLabel,
    roleFitNotes: offer.roleFit.notes,
    rosterNeedNotes: offer.rosterNeedFacts.notes,
    rotationProjection: offer.projectedRotationChanges,
    chemistryDisruption: {
      removedPairs: offer.projectedChemistryDisruption.removedPairs,
      newPairs: offer.projectedChemistryDisruption.newPairs,
    },
    statusLabel,
  };
}

/** The first open trade window (the one the human can act on), or null. */
export function openWindowOf(trade: SeasonTradeState | null): SeasonTradeWindowState | null {
  return trade?.windows.find((window) => window.status === 'open') ?? null;
}

export interface TradeResolution {
  status: SeasonTradeOffer['status'];
  label: string;
  /** The block whose submission closed an expired offer (null otherwise). */
  resolvedByBlockIndex: number | null;
}

/** How an offer was resolved (recorded status facts only). */
export function tradeResolvedAt(offer: SeasonTradeOffer): TradeResolution {
  if (offer.status === 'open') {
    return {
      status: 'open',
      label: 'Open — closes when the next block locks',
      resolvedByBlockIndex: null,
    };
  }
  if (offer.status === 'accepted') {
    return { status: 'accepted', label: 'Accepted', resolvedByBlockIndex: null };
  }
  if (offer.status === 'declined') {
    return { status: 'declined', label: 'Declined', resolvedByBlockIndex: null };
  }
  const closeBlock = windowBlockIndexOf(offer.windowIndex);
  return {
    status: 'expired',
    label: closeBlock === null ? 'Expired' : `Expired when block ${String(closeBlock + 1)} locked`,
    resolvedByBlockIndex: closeBlock,
  };
}
