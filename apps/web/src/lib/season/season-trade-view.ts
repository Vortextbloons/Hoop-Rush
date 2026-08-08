import type {
  SeasonDraftCatalog,
  SeasonRun,
  SeasonTradeOffer,
  SeasonTradeState,
  SeasonTradeWindowState,
} from '@hoop-rush/data-contracts';
import { formatPositions } from '$lib/player-positions';

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
  /** Current rotation minutes per game (outgoing players only). */
  rotationMinutes: number | null;
  /** Projected minutes after the trade (incoming players only). */
  projectedMinutes: number | null;
}

export type TradeInsightTone = 'neutral' | 'positive' | 'negative' | 'caution';

export interface TradeOfferInsight {
  title: string;
  body: string;
  tone: TradeInsightTone;
}

export interface TradeOfferViewModel {
  offer: SeasonTradeOffer;
  fromFranchiseId: string;
  fromFranchiseName: string;
  outgoingPlayers: TradePlayerViewModel[];
  incomingPlayers: TradePlayerViewModel[];
  tradeSizeLabel: string;
  valueInsight: TradeOfferInsight;
  roleFitInsight: TradeOfferInsight;
  rosterNeedInsight: TradeOfferInsight;
  rotationInsight: TradeOfferInsight;
  chemistryInsight: TradeOfferInsight;
  chemistryDisruption: { removedPairs: number; newPairs: number };
  statusLabel: string;
}

/** Windows open after accepted checkpoints for blocks 2, 4, 5. */
export const TRADE_WINDOW_BLOCK_INDEX: readonly number[] = [2, 4, 5];

/** The block index whose accepted checkpoint opens `windowIndex`. */
export function windowBlockIndexOf(windowIndex: number): number | null {
  return TRADE_WINDOW_BLOCK_INDEX[windowIndex] ?? null;
}

function slotGroupLabel(group: string): string {
  if (group === 'G') return 'guard';
  if (group === 'F') return 'forward';
  if (group === 'C') return 'center';
  if (group.includes('/')) {
    return group.split('/').map((part) => slotGroupLabel(part)).join('/');
  }
  const detailed: Record<string, string> = {
    PG: 'point guard',
    SG: 'shooting guard',
    SF: 'small forward',
    PF: 'power forward',
  };
  return detailed[group] ?? group.toLowerCase();
}

function roleGroupsLabel(roles: readonly string[]): string {
  const unique = [...new Set(roles.flatMap((role) => role.split('/')))];
  if (unique.length === 0) return 'player';
  if (unique.length === 1) return slotGroupLabel(unique[0] ?? 'player');
  return unique.map((group) => slotGroupLabel(group)).join(' and ');
}

function playerPositionLabel(player: TradePlayerViewModel, roleGroup: string): string {
  if (player.playable.length > 0) return formatPositions(player.playable);
  return roleGroupsLabel([roleGroup]);
}

function valueInsightOf(offer: SeasonTradeOffer): TradeOfferInsight {
  const size = offer.outgoingPlayerVersionIds.length;
  const ratio = offer.valueBand.ratioBasisPoints / 10;
  const rounded = Math.round(ratio);
  const tradeSizeLabel = size === 1 ? '1-for-1' : '2-for-2';

  if (!offer.valueBand.qualified) {
    return {
      title: 'Value',
      body: `${tradeSizeLabel} swap with an unusual value balance (${String(rounded)}% return).`,
      tone: 'caution',
    };
  }
  if (rounded >= 105) {
    return {
      title: 'Value',
      body: `${tradeSizeLabel} swap that slightly favors you (${String(rounded)}% return).`,
      tone: 'positive',
    };
  }
  if (rounded <= 95) {
    return {
      title: 'Value',
      body: `${tradeSizeLabel} swap that slightly favors them (${String(rounded)}% return).`,
      tone: 'negative',
    };
  }
  return {
    title: 'Value',
    body: `${tradeSizeLabel} swap with even value (${String(rounded)}% return).`,
    tone: 'neutral',
  };
}

function roleFitInsightOf(
  offer: SeasonTradeOffer,
  outgoingPlayers: TradePlayerViewModel[],
  incomingPlayers: TradePlayerViewModel[],
): TradeOfferInsight {
  const outgoingDesc = outgoingPlayers
    .map((player, index) => {
      const role = offer.roleFit.outgoingRoles[index] ?? '';
      return `${player.displayName} (${playerPositionLabel(player, role)})`;
    })
    .join(' and ');
  const incomingDesc = incomingPlayers
    .map((player, index) => {
      const role = offer.roleFit.incomingRoles[index] ?? '';
      return `${player.displayName} (${playerPositionLabel(player, role)})`;
    })
    .join(' and ');
  return {
    title: 'Positions',
    body: `Send ${outgoingDesc} · Receive ${incomingDesc}.`,
    tone: 'neutral',
  };
}

function rosterNeedInsightOf(
  offer: SeasonTradeOffer,
  incomingPlayers: TradePlayerViewModel[],
): TradeOfferInsight {
  const group = roleGroupsLabel(offer.roleFit.incomingRoles);
  const depth = offer.rosterNeedFacts.incomingDepth;
  const playerWord = depth === 1 ? 'player' : 'players';
  const groupLabel = incomingPlayers.length === 1 ? group : `${group}s`;
  return {
    title: 'Roster depth',
    body: `After the trade you'll have ${String(depth)} ${groupLabel} ${playerWord} who can cover that role.`,
    tone: depth <= 2 ? 'caution' : 'neutral',
  };
}

function rotationInsightOf(
  outgoingPlayers: TradePlayerViewModel[],
  incomingPlayers: TradePlayerViewModel[],
): TradeOfferInsight {
  const leaving = outgoingPlayers
    .filter((player) => player.rotationMinutes !== null)
    .map((player) => `${player.displayName} (${String(player.rotationMinutes)} min)`);
  const joining = incomingPlayers
    .filter((player) => player.projectedMinutes !== null)
    .map((player) => `${player.displayName} (${String(player.projectedMinutes)} min)`);

  if (leaving.length === 0 && joining.length === 0) {
    return {
      title: 'Minutes',
      body: 'Your rotation is rebuilt around the new players.',
      tone: 'neutral',
    };
  }
  const parts: string[] = [];
  if (leaving.length > 0) {
    parts.push(`${leaving.join(' and ')} leave your rotation`);
  }
  if (joining.length > 0) {
    parts.push(`${joining.join(' and ')} join your rotation`);
  }
  return {
    title: 'Minutes',
    body: `${parts.join(' · ')}. Starters and bench are adjusted automatically.`,
    tone: 'neutral',
  };
}

function chemistryInsightOf(disruption: { removedPairs: number; newPairs: number }): TradeOfferInsight {
  const { removedPairs, newPairs } = disruption;
  const pairWord = (count: number): string => (count === 1 ? 'pairing' : 'pairings');
  if (removedPairs === 0 && newPairs === 0) {
    return {
      title: 'Chemistry',
      body: 'No teammate chemistry changes.',
      tone: 'neutral',
    };
  }
  return {
    title: 'Chemistry',
    body: `Resets ${String(removedPairs)} existing teammate ${pairWord(removedPairs)} and starts ${String(newPairs)} new ${pairWord(newPairs)} at neutral.`,
    tone: 'caution',
  };
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
  const rotation = run.rotations?.find((entry) => entry.franchiseId === offer.toFranchiseId);
  const minutesById = new Map(
    (rotation?.targetMinutes ?? []).map((entry) => [entry.playerVersionId, entry.minutes]),
  );
  const outgoingMinutes = offer.outgoingPlayerVersionIds.map(
    (id) => minutesById.get(id) ?? null,
  );
  const projectedIncomingMinutes = outgoingMinutes.map((minutes) => minutes ?? 16);

  const viewPlayer = (
    playerVersionId: string,
    health: SeasonTradeOffer['outgoingHealth'][number],
    options: { rotationMinutes?: number | null; projectedMinutes?: number | null },
  ): TradePlayerViewModel => {
    const entry = rosterEntry(playerVersionId);
    return {
      playerVersionId,
      displayName: entry?.displayName ?? playerVersionId,
      playable: playableOf(playerVersionId),
      available: health.available,
      activeInjuryIds: health.activeInjuryIds,
      rotationMinutes: options.rotationMinutes ?? null,
      projectedMinutes: options.projectedMinutes ?? null,
    };
  };
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

  const outgoingPlayers = offer.outgoingPlayerVersionIds.map((id, index) =>
    viewPlayer(id, healthEntryOf(offer.outgoingHealth, index), {
      rotationMinutes: outgoingMinutes[index] ?? null,
    }),
  );
  const incomingPlayers = offer.incomingPlayerVersionIds.map((id, index) =>
    viewPlayer(id, healthEntryOf(offer.incomingHealth, index), {
      projectedMinutes: projectedIncomingMinutes[index] ?? null,
    }),
  );
  const chemistryDisruption = {
    removedPairs: offer.projectedChemistryDisruption.removedPairs,
    newPairs: offer.projectedChemistryDisruption.newPairs,
  };
  const size = offer.outgoingPlayerVersionIds.length;

  return {
    offer,
    fromFranchiseId: offer.fromFranchiseId,
    fromFranchiseName: franchiseName(offer.fromFranchiseId),
    outgoingPlayers,
    incomingPlayers,
    tradeSizeLabel: size === 1 ? '1-for-1' : '2-for-2',
    valueInsight: valueInsightOf(offer),
    roleFitInsight: roleFitInsightOf(offer, outgoingPlayers, incomingPlayers),
    rosterNeedInsight: rosterNeedInsightOf(offer, incomingPlayers),
    rotationInsight: rotationInsightOf(outgoingPlayers, incomingPlayers),
    chemistryInsight: chemistryInsightOf(chemistryDisruption),
    chemistryDisruption,
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
