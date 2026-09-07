import {
  SEASON_SPONSOR_SLOTS,
  normalizeSponsorGearState,
  sponsorGearEntryOf,
  summaryRatingsOfRatings,
  type OffenseDefenseTendencies,
  type SeasonPlayerSponsorSlots,
  type SeasonRun,
  type SeasonSponsorBoost,
  type SeasonSponsorBoostKey,
  type SeasonSponsorSlot,
  type SimulationRatings,
} from '@hoop-rush/data-contracts';
import { applySponsorBoosts } from '@hoop-rush/engine';

export const SPONSOR_RATING_SHORT_LABELS: Record<SeasonSponsorBoostKey, string> = {
  speed: 'SPD',
  ballHandling: 'BH',
  vertical: 'VERT',
  steal: 'STL',
  midrange: 'MID',
  strength: 'STR',
  threePoint: '3PT',
  perimeterDefense: 'PD',
  interiorDefense: 'ID',
  block: 'BLK',
  offensiveRebound: 'OREB',
  defensiveRebound: 'DREB',
  freeThrow: 'FT',
};

export const SPONSOR_RATING_LONG_LABELS: Record<SeasonSponsorBoostKey, string> = {
  speed: 'Speed',
  ballHandling: 'Ball Handling',
  vertical: 'Vertical',
  steal: 'Steal',
  midrange: 'Mid-Range',
  strength: 'Strength',
  threePoint: 'Three-Point',
  perimeterDefense: 'Perimeter D',
  interiorDefense: 'Interior D',
  block: 'Block',
  offensiveRebound: 'Off. Rebound',
  defensiveRebound: 'Def. Rebound',
  freeThrow: 'Free Throw',
};

export const SPONSOR_SLOT_ICONS: Record<SeasonSponsorSlot, string> = {
  shoe: '◈',
  apparel: '⬣',
  fuel: '⚡',
};

export interface SponsorRatingGroup {
  title: string;
  keys: readonly SeasonSponsorBoostKey[];
}

export const SPONSOR_RATING_GROUPS: readonly SponsorRatingGroup[] = [
  { title: 'Offense', keys: ['midrange', 'threePoint', 'freeThrow', 'ballHandling'] },
  { title: 'Defense', keys: ['steal', 'perimeterDefense', 'interiorDefense', 'block'] },
  { title: 'Physical', keys: ['speed', 'vertical', 'strength'] },
  { title: 'Rebounding', keys: ['offensiveRebound', 'defensiveRebound'] },
];

export const SPONSOR_SLOT_LABELS: Record<SeasonSponsorSlot, string> = {
  shoe: 'SHOE',
  apparel: 'APPAREL',
  fuel: 'FUEL',
};

export type SponsorOfferState = 'available' | 'owned' | 'expired';

export interface SponsorOfferCard {
  instanceId: string;
  brandFamily: string;
  displayName: string;
  slot: SeasonSponsorSlot;
  tier: 'BUZZ' | 'PRIME' | 'ICON';
  boosts: { key: SeasonSponsorBoostKey; label: string; points: number }[];
  boostLine: string;
  price: number;
  state: SponsorOfferState;
  affordable: boolean;
}

export interface SponsorVaultEntry {
  instanceId: string;
  brandFamily: string;
  displayName: string;
  slot: SeasonSponsorSlot;
  tier: 'BUZZ' | 'PRIME' | 'ICON';
  boosts: { key: SeasonSponsorBoostKey; label: string; points: number }[];
  boostLine: string;
}

export interface SponsorBoardHistoryEntry {
  blockIndex: number;
  bought: number;
  expired: number;
}

function toBoostLines(boosts: readonly SeasonSponsorBoost[]) {
  return [...boosts]
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((boost) => ({
      key: boost.key,
      label: SPONSOR_RATING_SHORT_LABELS[boost.key],
      points: boost.points,
    }));
}

export function formatBoostLine(boosts: readonly { label: string; points: number }[]): string {
  return boosts.map((boost) => `+${String(boost.points)} ${boost.label}`).join(', ');
}

export function sponsorShopOf(
  run: SeasonRun | null,
  blockIndex: number | null,
  balance: number,
): SponsorOfferCard[] | null {
  if (run === null || blockIndex === null || blockIndex < 0 || blockIndex > 7) return null;
  const sponsors = normalizeSponsorGearState(run.sponsors);
  const board = sponsors.boards.boards.find((entry) => entry.blockIndex === blockIndex);
  if (board === undefined) return null;
  return board.offers.map((offer) => {
    const owned = board.purchasedInstanceIds.includes(offer.instanceId);
    const boosts = toBoostLines(offer.boosts);
    return {
      instanceId: offer.instanceId,
      brandFamily: offer.brandFamily,
      displayName: sponsorGearEntryOf(offer.entryId).displayName,
      slot: offer.slot,
      tier: offer.tier,
      boosts,
      boostLine: formatBoostLine(boosts),
      price: offer.price,
      state: owned ? 'owned' : 'available',
      affordable: balance >= offer.price,
    };
  });
}

export function sponsorVaultOf(run: SeasonRun | null): SponsorVaultEntry[] {
  if (run === null) return [];
  const sponsors = normalizeSponsorGearState(run.sponsors);
  const offersById = new Map(
    sponsors.boards.boards
      .flatMap((board) => board.offers)
      .map((offer) => [offer.instanceId, offer]),
  );
  return sponsors.vault.items.map((item) => {
    const entry = sponsorGearEntryOf(item.entryId);
    const offer = offersById.get(item.instanceId);
    const boosts = toBoostLines(offer?.boosts ?? []);
    return {
      instanceId: item.instanceId,
      brandFamily: entry.brandFamily,
      displayName: entry.displayName,
      slot: entry.slot,
      tier: entry.tier,
      boosts,
      boostLine: formatBoostLine(boosts),
    };
  });
}

export function sponsorSlotsOf(run: SeasonRun | null, playerVersionId: string) {
  if (run === null) return null;
  return normalizeSponsorGearState(run.sponsors).players.slots[playerVersionId] ?? null;
}

export function boostedRatingsOf(
  base: SimulationRatings,
  run: SeasonRun | null,
  playerVersionId: string,
): SimulationRatings {
  if (run === null) return { ...base };
  return applySponsorBoosts(base, sponsorSlotsOf(run, playerVersionId));
}

export function gearPointsOf(slots: ReturnType<typeof sponsorSlotsOf>): number {
  if (slots === null) return 0;
  let total = 0;
  for (const slot of SEASON_SPONSOR_SLOTS) {
    for (const boost of slots[slot]?.boosts ?? []) total += boost.points;
  }
  return total;
}

export function sponsorBoardHistoryOf(run: SeasonRun | null): SponsorBoardHistoryEntry[] {
  if (run === null) return [];
  const sponsors = normalizeSponsorGearState(run.sponsors);
  return [...sponsors.boards.boards]
    .sort((a, b) => a.blockIndex - b.blockIndex)
    .map((board) => ({
      blockIndex: board.blockIndex,
      bought: board.purchasedInstanceIds.length,
      expired: board.offers.length - board.purchasedInstanceIds.length,
    }));
}

export interface PlayerSponsorCardModel {
  playerVersionId: string;
  displayName: string;
  seasonKey: string;
  franchiseId: string;
  eraId: string;
  playable: readonly string[];
  overall: number | null;
  baseRatings: SimulationRatings;
  tendencies: OffenseDefenseTendencies | null;
  role: string;
  minutes: number | string;
  fatigueLabel: string | null;
  fatiguePercent: number | null;
  lastMinutes: number | null;
  slots: SeasonPlayerSponsorSlots | null;
  gearPoints: number;
}

export interface PlayerSponsorCardInput {
  playerVersionId: string;
  displayName: string;
  seasonKey: string;
  franchiseId: string;
  eraId: string;
  playable: readonly string[];
  overall: number | null;
  baseRatings: SimulationRatings;
  tendencies: OffenseDefenseTendencies | null;
  role: string;
  minutes: number | string;
  fatigueLabel: string | null;
  fatiguePercent: number | null;
  lastMinutes: number | null;
}

export function playerSponsorCardOf(
  run: SeasonRun | null,
  input: PlayerSponsorCardInput,
): PlayerSponsorCardModel {
  const slots = sponsorSlotsOf(run, input.playerVersionId);
  return { ...input, slots, gearPoints: gearPointsOf(slots) };
}

export interface BoostedRatingRow {
  key: SeasonSponsorBoostKey;
  label: string;
  base: number;
  boosted: number;
  source: string | null;
}

const BOOSTED_RATING_KEYS: readonly SeasonSponsorBoostKey[] = [
  'speed',
  'ballHandling',
  'vertical',
  'steal',
  'midrange',
  'threePoint',
  'perimeterDefense',
  'interiorDefense',
  'block',
  'strength',
  'offensiveRebound',
  'defensiveRebound',
  'freeThrow',
];

export function boostedRatingRows(
  base: SimulationRatings,
  slots: SeasonPlayerSponsorSlots | null,
): BoostedRatingRow[] {
  const boosted = applySponsorBoosts(base, slots);
  const byKey = new Map<string, string>();
  if (slots) {
    for (const slot of SEASON_SPONSOR_SLOTS) {
      const snapshot = slots[slot];
      if (snapshot === null) continue;
      for (const boost of snapshot.boosts) {
        const prior = byKey.get(boost.key);
        const line = `+${String(boost.points)} ${snapshot.brandFamily} ${snapshot.tier}`;
        byKey.set(boost.key, prior === undefined ? line : `${prior}, ${line}`);
      }
    }
  }
  return BOOSTED_RATING_KEYS.map((key) => ({
    key,
    label: SPONSOR_RATING_SHORT_LABELS[key],
    base: base[key],
    boosted: boosted[key],
    source: byKey.get(key) ?? null,
  }));
}

export interface GearPreviewDelta {
  key: SeasonSponsorBoostKey;
  label: string;
  longLabel: string;
  from: number;
  to: number;
  points: number;
}

export function previewGearDeltas(
  base: SimulationRatings,
  slots: SeasonPlayerSponsorSlots | null,
  candidate: {
    slot: SeasonSponsorSlot;
    boosts: readonly { key: SeasonSponsorBoostKey; points: number }[];
  },
): GearPreviewDelta[] {
  const current = applySponsorBoosts(base, slots);
  const next = applySponsorBoosts(base, slotsWithCandidate(slots, candidate));
  return candidate.boosts.map((boost) => ({
    key: boost.key,
    label: SPONSOR_RATING_SHORT_LABELS[boost.key],
    longLabel: SPONSOR_RATING_LONG_LABELS[boost.key],
    from: current[boost.key],
    to: next[boost.key],
    points: boost.points,
  }));
}

export function sponsorHistorySummary(history: readonly SponsorBoardHistoryEntry[]): string | null {
  if (history.length === 0) return null;
  const bought = history.reduce((sum, entry) => sum + entry.bought, 0);
  const expired = history.reduce((sum, entry) => sum + entry.expired, 0);
  if (bought === 0 && expired === 0) return null;
  const parts: string[] = [];
  if (bought > 0) parts.push(`${String(bought)} purchased`);
  if (expired > 0) parts.push(`${String(expired)} expired`);
  return parts.join(' · ');
}

const SPONSOR_TENDENCY_DEFAULTS: OffenseDefenseTendencies = {
  turnoverRate: 12,
  foulRate: 2,
};

function tendenciesOrDefaults(
  tendencies: OffenseDefenseTendencies | null | undefined,
): OffenseDefenseTendencies {
  return {
    turnoverRate: tendencies?.turnoverRate ?? SPONSOR_TENDENCY_DEFAULTS.turnoverRate,
    foulRate: tendencies?.foulRate ?? SPONSOR_TENDENCY_DEFAULTS.foulRate,
  };
}

function slotsWithCandidate(
  slots: SeasonPlayerSponsorSlots | null,
  candidate: {
    slot: SeasonSponsorSlot;
    boosts: readonly { key: SeasonSponsorBoostKey; points: number }[];
  },
): SeasonPlayerSponsorSlots {
  const merged: SeasonPlayerSponsorSlots = {
    shoe: slots?.shoe ?? null,
    apparel: slots?.apparel ?? null,
    fuel: slots?.fuel ?? null,
  };
  merged[candidate.slot] = {
    instanceId: 'preview',
    entryId: 'preview',
    brandFamily: 'preview',
    slot: candidate.slot,
    tier: 'BUZZ',
    boosts: candidate.boosts.map((boost) => ({ key: boost.key, points: boost.points })),
    appliedBlock: 0,
    appliedByCommandId: 'cmd-preview' as never,
  };
  return merged;
}

export function boostedOverallOf(
  baseOverall: number | null,
  baseRatings: SimulationRatings,
  tendencies: OffenseDefenseTendencies | null | undefined,
  slots: SeasonPlayerSponsorSlots | null,
): number | null {
  if (baseOverall === null) return null;
  if (gearPointsOf(slots) === 0) return baseOverall;
  const resolved = tendenciesOrDefaults(tendencies);
  const before = summaryRatingsOfRatings(baseRatings, resolved).overallRating;
  const after = summaryRatingsOfRatings(
    applySponsorBoosts(baseRatings, slots),
    resolved,
  ).overallRating;
  return Math.max(0, Math.min(100, baseOverall + (after - before)));
}

export function boostedOverallDeltaOf(
  baseOverall: number | null,
  baseRatings: SimulationRatings,
  tendencies: OffenseDefenseTendencies | null | undefined,
  slots: SeasonPlayerSponsorSlots | null,
): number | null {
  if (baseOverall === null) return null;
  const next = boostedOverallOf(baseOverall, baseRatings, tendencies, slots);
  if (next === null || next === baseOverall) return null;
  return next - baseOverall;
}

export function previewBoostedOverallOf(
  baseOverall: number | null,
  baseRatings: SimulationRatings,
  tendencies: OffenseDefenseTendencies | null | undefined,
  slots: SeasonPlayerSponsorSlots | null,
  candidate: {
    slot: SeasonSponsorSlot;
    boosts: readonly { key: SeasonSponsorBoostKey; points: number }[];
  },
): number | null {
  if (baseOverall === null) return null;
  return boostedOverallOf(
    baseOverall,
    baseRatings,
    tendencies,
    slotsWithCandidate(slots, candidate),
  );
}

export interface BoostablePlayerRatings {
  overall: number | null;
  baseRatings: SimulationRatings;
  tendencies: OffenseDefenseTendencies | null;
}

export function boostedOverallForPlayer(
  run: SeasonRun | null,
  playerVersionId: string,
  player: BoostablePlayerRatings,
): number | null {
  if (player.overall === null) return null;
  return boostedOverallOf(
    player.overall,
    player.baseRatings,
    player.tendencies,
    sponsorSlotsOf(run, playerVersionId),
  );
}

export function boostedOverallDeltaForPlayer(
  run: SeasonRun | null,
  playerVersionId: string,
  player: BoostablePlayerRatings,
): number | null {
  if (player.overall === null) return null;
  return boostedOverallDeltaOf(
    player.overall,
    player.baseRatings,
    player.tendencies,
    sponsorSlotsOf(run, playerVersionId),
  );
}
