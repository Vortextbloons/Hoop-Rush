import { PROJECTION_SLOTS } from '@hoop-rush/data-contracts';
import type {
  EraSimulationProfile,
  HoopRushManifest,
  PeakPlayerSeason,
  ProjectionSlot,
  ProjectionModelArtifact,
} from '@hoop-rush/data-contracts';
import {
  scoreDraftPool,
  toSimulationPlayer,
  type DraftFitNeed,
  type DraftFitReport,
  type DraftFitTier,
} from '@hoop-rush/engine';
export type { DraftFitNeed, DraftFitReport, DraftFitScore, DraftFitTier } from '@hoop-rush/engine';
import { getEraSimulationProfile, getPool } from '$lib/data';
import { loadSeasonProjectionModel } from '$lib/season/season-assets';

export interface DraftFitContext {
  eraProfile: EraSimulationProfile;
  model: ProjectionModelArtifact;
}

export const DRAFT_FIT_SLOT_ORDER = PROJECTION_SLOTS;

export async function loadDraftFitContext(
  manifest: HoopRushManifest,
  eraId: string,
): Promise<DraftFitContext | null> {
  try {
    const profileEntry = manifest.eraSimulationProfiles.find((entry) => entry.eraId === eraId);
    if (!profileEntry) return null;
    const [eraProfile, model] = await Promise.all([
      getEraSimulationProfile(profileEntry),
      loadSeasonProjectionModel(),
    ]);
    return { eraProfile, model };
  } catch {
    return null;
  }
}

export async function resolveDraftPoolDetails(
  manifest: HoopRushManifest,
  franchiseId: string,
  eraId: string,
): Promise<PeakPlayerSeason[]> {
  const entry = manifest.pools.find(
    (pool) => pool.franchiseId === franchiseId && pool.eraId === eraId,
  );
  if (!entry) return [];
  try {
    return (await getPool(entry)).players;
  } catch {
    return [];
  }
}

const REPORT_CACHE = new Map<string, DraftFitReport>();
const REPORT_CACHE_MAX = 8;

function detailKey(player: PeakPlayerSeason): string {
  return `${player.franchiseId}/${player.eraId}/${player.seasonKey}/${player.playerId}`;
}

function reportKey(input: {
  poolIds: readonly string[];
  lockedIds: readonly string[];
  lockedSlots?: readonly ProjectionSlot[];
  allowDisplacement?: boolean;
  refineTopN?: number;
  context: DraftFitContext;
}): string {
  return [
    input.context.model.modelVersion,
    input.context.eraProfile.profileVersion,
    input.lockedIds.join(','),
    input.lockedSlots?.join(',') ?? '',
    String(input.allowDisplacement ?? true),
    [...input.poolIds].sort().join(','),
    input.refineTopN === undefined ? '' : String(input.refineTopN),
  ].join('|');
}

export function scoreDraftPoolMemo(input: {
  pool: readonly PeakPlayerSeason[];
  locked: readonly PeakPlayerSeason[];
  lockedSlots?: readonly ProjectionSlot[];
  allowDisplacement?: boolean;
  context: DraftFitContext;
  refineTopN?: number;
}): DraftFitReport {
  const key = reportKey({
    poolIds: input.pool.map(detailKey).sort(),
    lockedIds: input.locked.map(detailKey),
    lockedSlots: input.lockedSlots,
    allowDisplacement: input.allowDisplacement,
    refineTopN: input.refineTopN,
    context: input.context,
  });
  const cached = REPORT_CACHE.get(key);
  if (cached) return cached;
  const report = scoreDraftPool({
    candidates: input.pool.map(toSimulationPlayer),
    locked: input.locked.map(toSimulationPlayer),
    lockedSlots: input.lockedSlots,
    allowDisplacement: input.allowDisplacement,
    projection: {
      eraProfile: input.context.eraProfile,
      model: input.context.model,
      ...(input.refineTopN === undefined ? {} : { refineTopN: input.refineTopN }),
    },
  });
  REPORT_CACHE.set(key, report);
  while (REPORT_CACHE.size > REPORT_CACHE_MAX) {
    const oldest = REPORT_CACHE.keys().next().value;
    if (oldest === undefined) break;
    REPORT_CACHE.delete(oldest);
  }
  return report;
}

export function heuristicDraftPoolReport(input: {
  pool: readonly PeakPlayerSeason[];
  locked: readonly PeakPlayerSeason[];
  lockedSlots?: readonly ProjectionSlot[];
  allowDisplacement?: boolean;
}): DraftFitReport {
  return scoreDraftPool({
    candidates: input.pool.map(toSimulationPlayer),
    locked: input.locked.map(toSimulationPlayer),
    lockedSlots: input.lockedSlots,
    allowDisplacement: input.allowDisplacement,
  });
}

export interface FitTierMeta {
  label: string;
  badge: string;
  dot: string;
}

export const FIT_TIER_META: Record<DraftFitTier, FitTierMeta> = {
  best: {
    label: 'Best fit',
    badge: 'border-emerald-500/45 bg-emerald-500/15 text-emerald-300',
    dot: 'bg-emerald-400',
  },
  strong: {
    label: 'Strong fit',
    badge: 'border-sky-500/45 bg-sky-500/15 text-sky-300',
    dot: 'bg-sky-400',
  },
  solid: {
    label: 'Solid',
    badge: 'border-border bg-surface-3 text-muted-foreground',
    dot: 'bg-zinc-400',
  },
  situational: {
    label: 'Situational',
    badge: 'border-amber-500/45 bg-amber-500/15 text-amber-300',
    dot: 'bg-amber-400',
  },
  poor: {
    label: 'Poor fit',
    badge: 'border-red-500/40 bg-red-500/10 text-red-300',
    dot: 'bg-red-400',
  },
};

export interface FitNeedMeta {
  label: string;
  dot: string;
}

export const FIT_NEED_META: Record<DraftFitNeed, FitNeedMeta> = {
  spacing: { label: 'Spacing', dot: 'bg-orange-400' },
  creation: { label: 'Creation', dot: 'bg-sky-400' },
  defense: { label: 'Defense', dot: 'bg-emerald-400' },
  rebounding: { label: 'Rebounding', dot: 'bg-violet-400' },
  balance: { label: 'Balanced', dot: 'bg-zinc-400' },
};

export function formatNetDelta(netDelta: number | null): string {
  if (netDelta === null) return 'Heuristic';
  const rounded = Math.round(netDelta * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${String(rounded)} NET`;
}

export const DRAFT_POOL_PAGE_SIZE = 48;

export function poolRowKey(player: {
  franchiseId: string;
  eraId: string;
  playerId: string;
}): string {
  return `${player.franchiseId}/${player.eraId}/${player.playerId}`;
}

export function nextPageWindow<T extends { franchiseId: string; eraId: string; playerId: string }>(
  ordered: readonly T[],
  visible: readonly T[],
  size: number = DRAFT_POOL_PAGE_SIZE,
): T[] {
  if (visible.length === 0) return [];
  const last = visible[visible.length - 1];
  if (!last) return [];
  const lastKey = poolRowKey(last);
  const at = ordered.findIndex((row) => poolRowKey(row) === lastKey);
  if (at < 0) return [];
  return ordered.slice(at + 1, at + 1 + size);
}
