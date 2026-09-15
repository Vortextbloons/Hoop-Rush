import type {
  ContextualReason,
  ContextualReasonCode,
  EraSimulationProfile,
  ProjectionModelArtifact,
  ProjectionSlot,
  SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { seasonDigestHex } from '@hoop-rush/data-contracts';
import { canPlay, type SlotGroup } from '../domain/positions.ts';
import { projectBaseFive } from '../projection/base.ts';
import { neutralReference } from '../projection/reference-lineups.ts';
import { evaluateLineupFit } from './contextual-value.ts';

export type DraftFitTier = 'best' | 'strong' | 'solid' | 'situational' | 'poor';
export type DraftFitNeed = 'spacing' | 'creation' | 'defense' | 'rebounding' | 'balance';

export interface DraftFitProjectionOptions {
  eraProfile: EraSimulationProfile;
  model: ProjectionModelArtifact;
  refineTopN?: number;
}

export interface DraftFitScore {
  playerId: string;
  displayName: string;
  baseOverall: number;
  heuristicFitDelta: number;
  netDelta: number | null;
  netRating: number | null;
  tier: DraftFitTier;
  primaryNeed: DraftFitNeed;
  reasonLabel: string;
  reasons: ContextualReason[];
  refined: boolean;
}

export interface DraftFitReport {
  scores: DraftFitScore[];
  top: DraftFitScore[];
  missingNeeds: DraftFitNeed[];
  refinedCount: number;
  digest: string;
}

export const DRAFT_FIT_REFINE_DEFAULT = 12;
export const DRAFT_FIT_REFINE_MAX = 20;
export const DRAFT_FIT_TOP_COUNT = 5;
const DRAFT_FIT_DIGEST_VERSION = 1;

const DRAFT_FIT_SLOTS: readonly { slot: ProjectionSlot; group: SlotGroup }[] = [
  { slot: 'G1', group: 'G' },
  { slot: 'G2', group: 'G' },
  { slot: 'F1', group: 'F' },
  { slot: 'F2', group: 'F' },
  { slot: 'C', group: 'C' },
];

const NEED_OF_REASON: Record<ContextualReasonCode, DraftFitNeed> = {
  'spacing-supply': 'spacing',
  'spacing-redundancy': 'spacing',
  'missing-creation': 'creation',
  'role-competition': 'creation',
  'perimeter-creation': 'creation',
  'defensive-coverage': 'defense',
  'rim-protection': 'defense',
  'perimeter-defense': 'defense',
  'foul-pressure': 'defense',
  'size-and-rebounding': 'rebounding',
  'rim-pressure': 'rebounding',
  'turnover-pressure': 'balance',
};

function tierOfRefined(netDelta: number): DraftFitTier {
  if (netDelta >= 3) return 'best';
  if (netDelta >= 1) return 'strong';
  if (netDelta > -1) return 'solid';
  if (netDelta > -3) return 'situational';
  return 'poor';
}

function tierOfHeuristic(fitDelta: number): DraftFitTier {
  if (fitDelta >= 2) return 'strong';
  if (fitDelta === 1) return 'solid';
  if (fitDelta === 0) return 'situational';
  return 'poor';
}

function assignDraftFive(players: readonly SimulationPlayer[]): (SimulationPlayer | null)[] | null {
  const slots: (SimulationPlayer | null)[] = [null, null, null, null, null];
  const place = (index: number): boolean => {
    if (index >= players.length) return true;
    const player = players[index];
    if (player === undefined) return true;
    for (let s = 0; s < DRAFT_FIT_SLOTS.length; s += 1) {
      const entry = DRAFT_FIT_SLOTS[s];
      if (entry === undefined || slots[s] !== null) continue;
      if (!canPlay(player.positions, entry.group)) continue;
      slots[s] = player;
      if (place(index + 1)) return true;
      slots[s] = null;
    }
    return false;
  };
  return place(0) ? slots : null;
}

function fillWithReference(
  assigned: readonly (SimulationPlayer | null)[],
  reference: readonly SimulationPlayer[],
): SimulationPlayer[] | null {
  const used = new Set<SimulationPlayer>();
  for (const player of assigned) {
    if (player !== null) used.add(player);
  }
  const five: (SimulationPlayer | null)[] = [...assigned];
  for (let s = 0; s < DRAFT_FIT_SLOTS.length; s += 1) {
    if (five[s] !== null) continue;
    const entry = DRAFT_FIT_SLOTS[s];
    if (entry === undefined) return null;
    const filler = reference.find(
      (candidate) => !used.has(candidate) && canPlay(candidate.positions, entry.group),
    );
    if (filler === undefined) return null;
    five[s] = filler;
    used.add(filler);
  }
  return five as SimulationPlayer[];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function compareRanked(
  a: { score: number; baseOverall: number; playerId: string },
  b: { score: number; baseOverall: number; playerId: string },
): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.baseOverall !== a.baseOverall) return b.baseOverall - a.baseOverall;
  return a.playerId < b.playerId ? -1 : 1;
}

export function scoreDraftPool(input: {
  candidates: readonly SimulationPlayer[];
  locked: readonly SimulationPlayer[];
  projection?: DraftFitProjectionOptions;
}): DraftFitReport {
  const lockedIds = new Set(input.locked.map((player) => player.playerId));
  const pool = input.candidates.filter((candidate) => !lockedIds.has(candidate.playerId));
  const finish = (scores: DraftFitScore[], refinedCount: number): DraftFitReport => {
    const top = scores.slice(0, DRAFT_FIT_TOP_COUNT);
    const seen = new Set<DraftFitNeed>();
    const missingNeeds: DraftFitNeed[] = [];
    for (const entry of top.slice(0, 3)) {
      if (entry.primaryNeed === 'balance' || seen.has(entry.primaryNeed)) continue;
      seen.add(entry.primaryNeed);
      missingNeeds.push(entry.primaryNeed);
    }
    const digest = seasonDigestHex(
      JSON.stringify({
        version: DRAFT_FIT_DIGEST_VERSION,
        order: scores.map((entry) => entry.playerId),
        tiers: scores.map((entry) => entry.tier),
        nets: scores.map((entry) => entry.netDelta),
      }),
    );
    return { scores, top, missingNeeds, refinedCount, digest };
  };
  if (pool.length === 0 || input.locked.length >= 5) {
    const scores = pool
      .map((candidate) => {
        const fit = evaluateLineupFit(candidate, input.locked);
        return { candidate, fit };
      })
      .sort((a, b) =>
        compareRanked(
          { score: a.fit.fitDelta, baseOverall: a.fit.baseOverall, playerId: a.candidate.playerId },
          { score: b.fit.fitDelta, baseOverall: b.fit.baseOverall, playerId: b.candidate.playerId },
        ),
      )
      .map(({ candidate, fit }) => toScore(candidate, fit, null));
    return finish(scores, 0);
  }
  if (input.locked.length === 0) {
    const scores = pool
      .map((candidate) => ({ candidate, overall: candidate.overall ?? 50 }))
      .sort((a, b) =>
        compareRanked(
          { score: a.overall, baseOverall: a.overall, playerId: a.candidate.playerId },
          { score: b.overall, baseOverall: b.overall, playerId: b.candidate.playerId },
        ),
      )
      .map(({ candidate }, index): DraftFitScore => ({
        playerId: candidate.playerId,
        displayName: candidate.displayName,
        baseOverall: Math.round(candidate.overall ?? 50),
        heuristicFitDelta: 0,
        netDelta: null,
        netRating: null,
        tier: index === 0 ? 'strong' : 'solid',
        primaryNeed: 'balance',
        reasonLabel: 'Best available talent',
        reasons: [],
        refined: false,
      }));
    return finish(scores, 0);
  }
  const screened = pool
    .map((candidate) => ({ candidate, fit: evaluateLineupFit(candidate, input.locked) }))
    .sort((a, b) =>
      compareRanked(
        { score: a.fit.fitDelta, baseOverall: a.fit.baseOverall, playerId: a.candidate.playerId },
        { score: b.fit.fitDelta, baseOverall: b.fit.baseOverall, playerId: b.candidate.playerId },
      ),
    );
  const refineTopN =
    input.projection === undefined
      ? 0
      : Math.max(
          0,
          Math.min(
            DRAFT_FIT_REFINE_MAX,
            Math.floor(input.projection.refineTopN ?? DRAFT_FIT_REFINE_DEFAULT),
          ),
        );
  const refined = new Map<string, { netDelta: number; netRating: number }>();
  if (refineTopN > 0 && input.projection !== undefined) {
    try {
      const { eraProfile, model } = input.projection;
      const reference = neutralReference(model, eraProfile.eraId);
      const baseAssigned = assignDraftFive(input.locked);
      const baseFive =
        baseAssigned === null ? null : fillWithReference(baseAssigned, reference.players);
      if (baseFive !== null && baseFive.length === 5) {
        const baseNet = projectBaseFive({
          lineup: baseFive.map((player, index) => ({
            slot: DRAFT_FIT_SLOTS[index]?.slot ?? 'G1',
            player,
          })) as [
            { slot: ProjectionSlot; player: SimulationPlayer },
            { slot: ProjectionSlot; player: SimulationPlayer },
            { slot: ProjectionSlot; player: SimulationPlayer },
            { slot: ProjectionSlot; player: SimulationPlayer },
            { slot: ProjectionSlot; player: SimulationPlayer },
          ],
          eraProfile,
          model,
        }).ratings.netRating;
        for (const entry of screened.slice(0, refineTopN)) {
          const assigned = assignDraftFive([...input.locked, entry.candidate]);
          const five = assigned === null ? null : fillWithReference(assigned, reference.players);
          if (five === null || five.length !== 5) continue;
          const netRating = projectBaseFive({
            lineup: five.map((player, index) => ({
              slot: DRAFT_FIT_SLOTS[index]?.slot ?? 'G1',
              player,
            })) as [
              { slot: ProjectionSlot; player: SimulationPlayer },
              { slot: ProjectionSlot; player: SimulationPlayer },
              { slot: ProjectionSlot; player: SimulationPlayer },
              { slot: ProjectionSlot; player: SimulationPlayer },
              { slot: ProjectionSlot; player: SimulationPlayer },
            ],
            eraProfile,
            model,
          }).ratings.netRating;
          refined.set(entry.candidate.playerId, {
            netDelta: round1(netRating - baseNet),
            netRating: round1(netRating),
          });
        }
      }
    } catch {
      refined.clear();
    }
  }
  const withRefined = screened
    .filter((entry) => refined.has(entry.candidate.playerId))
    .sort((a, b) => {
      const ra = refined.get(a.candidate.playerId);
      const rb = refined.get(b.candidate.playerId);
      return compareRanked(
        {
          score: ra?.netDelta ?? 0,
          baseOverall: a.fit.baseOverall,
          playerId: a.candidate.playerId,
        },
        {
          score: rb?.netDelta ?? 0,
          baseOverall: b.fit.baseOverall,
          playerId: b.candidate.playerId,
        },
      );
    });
  const rest = screened.filter((entry) => !refined.has(entry.candidate.playerId));
  const scores = [...withRefined, ...rest].map(({ candidate, fit }) => {
    const projection = refined.get(candidate.playerId) ?? null;
    return toScore(candidate, fit, projection);
  });
  return finish(scores, refined.size);
}

function toScore(
  candidate: SimulationPlayer,
  fit: { baseOverall: number; fitDelta: number; reasons: ContextualReason[] },
  projection: { netDelta: number; netRating: number } | null,
): DraftFitScore {
  const topReason = fit.reasons[0] ?? null;
  const primaryNeed = topReason === null ? 'balance' : NEED_OF_REASON[topReason.code];
  return {
    playerId: candidate.playerId,
    displayName: candidate.displayName,
    baseOverall: fit.baseOverall,
    heuristicFitDelta: fit.fitDelta,
    netDelta: projection?.netDelta ?? null,
    netRating: projection?.netRating ?? null,
    tier: projection === null ? tierOfHeuristic(fit.fitDelta) : tierOfRefined(projection.netDelta),
    primaryNeed,
    reasonLabel: topReason?.label ?? 'Balanced fit',
    reasons: fit.reasons,
    refined: projection !== null,
  };
}
