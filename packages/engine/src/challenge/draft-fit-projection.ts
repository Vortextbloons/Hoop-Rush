import type {
  ContextualReason,
  ContextualReasonCode,
  EraSimulationProfile,
  ProjectionModelArtifact,
  ProjectionReferenceFive,
  ProjectionSlot,
  SlotIndex,
  SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { seasonDigestHex } from '@hoop-rush/data-contracts';
import { canPlay, type SlotGroup } from '../domain/positions.ts';
import { planLineupReposition } from '../domain/lineup-reposition.ts';
import { projectBaseFive } from '../projection/base.ts';
import { archetypeReferences, neutralReference } from '../projection/reference-lineups.ts';
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
  worstNetDelta: number | null;
  netRating: number | null;
  tier: DraftFitTier;
  primaryNeed: DraftFitNeed;
  reasonLabel: string;
  warningLabel: string | null;
  recommendedSlot: ProjectionSlot | null;
  rearrangementCount: number;
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

export const DRAFT_FIT_REFINE_DEFAULT = 96;
export const DRAFT_FIT_REFINE_MAX = 96;
export const DRAFT_FIT_TOP_COUNT = 5;
const DRAFT_FIT_DIGEST_VERSION = 2;

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
  const used = new Set<string>();
  for (const player of assigned) {
    if (player !== null) used.add(playerKey(player));
  }
  const five: (SimulationPlayer | null)[] = [...assigned];
  function place(slotIndex: number): boolean {
    if (slotIndex >= DRAFT_FIT_SLOTS.length) return true;
    if (five[slotIndex] !== null) return place(slotIndex + 1);
    const entry = DRAFT_FIT_SLOTS[slotIndex];
    if (entry === undefined) return false;
    for (const filler of reference) {
      const key = playerKey(filler);
      if (used.has(key) || !canPlay(filler.positions, entry.group)) continue;
      five[slotIndex] = filler;
      used.add(key);
      if (place(slotIndex + 1)) return true;
      used.delete(key);
      five[slotIndex] = null;
    }
    return false;
  }
  return place(0) ? (five as SimulationPlayer[]) : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function playerKey(player: SimulationPlayer): string {
  return player.playerVersionId ?? player.playerId;
}

function compareRanked(
  a: { score: number; baseOverall: number; playerId: string },
  b: { score: number; baseOverall: number; playerId: string },
): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.baseOverall !== a.baseOverall) return b.baseOverall - a.baseOverall;
  return a.playerId < b.playerId ? -1 : 1;
}

type DraftAssignedLineup = (SimulationPlayer | null)[];

type ProjectionLineup = [
  { slot: ProjectionSlot; player: SimulationPlayer },
  { slot: ProjectionSlot; player: SimulationPlayer },
  { slot: ProjectionSlot; player: SimulationPlayer },
  { slot: ProjectionSlot; player: SimulationPlayer },
  { slot: ProjectionSlot; player: SimulationPlayer },
];

interface DraftFitRefinedProjection {
  netDelta: number;
  neutralNetDelta: number;
  worstNetDelta: number;
  netRating: number;
  recommendedSlot: ProjectionSlot;
  rearrangementCount: number;
}

function assignedFromSlots(
  players: readonly SimulationPlayer[],
  lockedSlots: readonly ProjectionSlot[] | undefined,
): DraftAssignedLineup | null {
  if (lockedSlots === undefined || lockedSlots.length !== players.length) return null;
  const assigned: DraftAssignedLineup = [null, null, null, null, null];
  const used = new Set<string>();
  for (let index = 0; index < players.length; index += 1) {
    const player = players[index];
    const slot = lockedSlots[index];
    if (player === undefined || slot === undefined) return null;
    const slotIndex = DRAFT_FIT_SLOTS.findIndex((entry) => entry.slot === slot);
    if (slotIndex < 0 || assigned[slotIndex] !== null || used.has(playerKey(player))) return null;
    if (!canPlay(player.positions, DRAFT_FIT_SLOTS[slotIndex]!.group)) return null;
    used.add(playerKey(player));
    assigned[slotIndex] = player;
  }
  return assigned;
}

function assignedFromPlan(
  plan: ReturnType<typeof planLineupReposition>,
  players: readonly SimulationPlayer[],
): DraftAssignedLineup | null {
  if (plan === null) return null;
  const byId = new Map(players.map((player) => [player.playerId, player]));
  const assigned: DraftAssignedLineup = [null, null, null, null, null];
  for (const placement of plan.placements) {
    const player = byId.get(placement.playerId);
    if (player === undefined || assigned[placement.slotIndex] !== null) return null;
    assigned[placement.slotIndex] = player;
  }
  return assigned;
}

function repositionPlanFor(
  assigned: readonly (SimulationPlayer | null)[],
  candidate: SimulationPlayer,
  targetSlot: SlotIndex,
): ReturnType<typeof planLineupReposition> {
  return planLineupReposition(
    assigned.flatMap((player, slotIndex) =>
      player === null
        ? []
        : [
            {
              playerId: player.playerId,
              positions: player.positions,
              slotIndex: slotIndex as SlotIndex,
            },
          ],
    ),
    { playerId: candidate.playerId, positions: candidate.positions },
    targetSlot,
  );
}

function projectionLineupOf(
  assigned: readonly (SimulationPlayer | null)[],
): ProjectionLineup | null {
  if (assigned.length !== DRAFT_FIT_SLOTS.length || assigned.some((player) => player === null)) {
    return null;
  }
  return DRAFT_FIT_SLOTS.map((entry, index) => ({
    slot: entry.slot,
    player: assigned[index]!,
  })) as ProjectionLineup;
}

function projectionReferences(
  model: ProjectionModelArtifact,
  eraId: string,
): ProjectionReferenceFive[] {
  return [neutralReference(model, eraId), ...archetypeReferences(model, eraId)];
}

function projectedNetRatings(
  assigned: readonly (SimulationPlayer | null)[],
  references: readonly ProjectionReferenceFive[],
  eraProfile: EraSimulationProfile,
  model: ProjectionModelArtifact,
): number[] | null {
  const lineup = projectionLineupOf(assigned);
  if (lineup === null) return null;
  return references.map(
    (reference) =>
      projectBaseFive({
        lineup,
        referenceId: reference.referenceId,
        eraProfile,
        model,
      }).ratings.netRating,
  );
}

function candidateCanBePlaced(
  assigned: readonly (SimulationPlayer | null)[],
  candidate: SimulationPlayer,
  allowDisplacement: boolean,
): boolean {
  return DRAFT_FIT_SLOTS.some((_, slotIndex) => {
    const plan = repositionPlanFor(assigned, candidate, slotIndex as SlotIndex);
    if (plan === null) return false;
    return allowDisplacement || plan.moves.every((move) => move.fromSlot === null);
  });
}

function betterRefinedProjection(
  next: DraftFitRefinedProjection,
  current: DraftFitRefinedProjection | null,
): boolean {
  if (current === null) return true;
  if (next.netDelta !== current.netDelta) return next.netDelta > current.netDelta;
  if (next.worstNetDelta !== current.worstNetDelta) {
    return next.worstNetDelta > current.worstNetDelta;
  }
  if (next.neutralNetDelta !== current.neutralNetDelta) {
    return next.neutralNetDelta > current.neutralNetDelta;
  }
  if (next.rearrangementCount !== current.rearrangementCount) {
    return next.rearrangementCount < current.rearrangementCount;
  }
  return next.recommendedSlot < current.recommendedSlot;
}

export function scoreDraftPool(input: {
  candidates: readonly SimulationPlayer[];
  locked: readonly SimulationPlayer[];
  lockedSlots?: readonly ProjectionSlot[];
  allowDisplacement?: boolean;
  projection?: DraftFitProjectionOptions;
}): DraftFitReport {
  const lockedIds = new Set(input.locked.map((player) => player.playerId));
  const pool = input.candidates.filter((candidate) => !lockedIds.has(candidate.playerId));
  const finish = (scores: DraftFitScore[], refinedCount: number): DraftFitReport => {
    const top = (refinedCount > 0 ? scores.filter((entry) => entry.refined) : scores).slice(
      0,
      DRAFT_FIT_TOP_COUNT,
    );
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
        worstNets: scores.map((entry) => entry.worstNetDelta),
        slots: scores.map((entry) => entry.recommendedSlot),
        rearrangements: scores.map((entry) => entry.rearrangementCount),
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
        worstNetDelta: null,
        netRating: null,
        tier: index === 0 ? 'strong' : 'solid',
        primaryNeed: 'balance',
        reasonLabel: 'Best available talent',
        warningLabel: null,
        recommendedSlot: null,
        rearrangementCount: 0,
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
  const currentAssigned =
    input.locked.length < 5
      ? input.lockedSlots === undefined
        ? assignDraftFive(input.locked)
        : assignedFromSlots(input.locked, input.lockedSlots)
      : null;
  if (currentAssigned === null) return finish([], 0);
  const eligibleScreened = screened.filter(({ candidate }) =>
    candidateCanBePlaced(currentAssigned, candidate, input.allowDisplacement ?? true),
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
  const refined = new Map<string, DraftFitRefinedProjection>();
  if (refineTopN > 0 && input.projection !== undefined) {
    try {
      const { eraProfile, model } = input.projection;
      const references = projectionReferences(model, eraProfile.eraId);
      const baseAssigned = currentAssigned;
      const baseFives =
        baseAssigned === null
          ? null
          : references.map((reference) => fillWithReference(baseAssigned, reference.players));
      const baseNets =
        baseFives === null || baseFives.some((five) => five === null)
          ? null
          : references.map(
              (reference, referenceIndex) =>
                projectedNetRatings(
                  baseFives[referenceIndex]!,
                  [reference],
                  eraProfile,
                  model,
                )?.[0] ?? null,
            );
      if (baseNets !== null && !baseNets.some((net) => net === null)) {
        for (const entry of eligibleScreened.slice(0, refineTopN)) {
          let best: DraftFitRefinedProjection | null = null;
          for (let targetIndex = 0; targetIndex < DRAFT_FIT_SLOTS.length; targetIndex += 1) {
            try {
              const plan = repositionPlanFor(
                baseAssigned!,
                entry.candidate,
                targetIndex as SlotIndex,
              );
              if (
                plan === null ||
                (!(input.allowDisplacement ?? true) &&
                  plan.moves.some((move) => move.fromSlot !== null))
              ) {
                continue;
              }
              const assigned = assignedFromPlan(plan, [...input.locked, entry.candidate]);
              if (assigned === null) continue;
              const fiveByReference = references.map((reference) =>
                fillWithReference(assigned, reference.players),
              );
              if (fiveByReference.some((five) => five === null)) continue;
              const allCandidateNets = references.map((reference, referenceIndex) => {
                const five = fiveByReference[referenceIndex];
                return five === undefined || five === null
                  ? null
                  : (projectedNetRatings(five, [reference], eraProfile, model)?.[0] ?? null);
              });
              if (allCandidateNets.some((net) => net === null)) continue;
              const deltas = allCandidateNets.map(
                (net, referenceIndex) => net! - (baseNets[referenceIndex] ?? 0),
              );
              const projection: DraftFitRefinedProjection = {
                netDelta: round1(mean(deltas)),
                neutralNetDelta: round1(deltas[0] ?? 0),
                worstNetDelta: round1(Math.min(...deltas)),
                netRating: round1(mean(allCandidateNets.map((net) => net!))),
                recommendedSlot: DRAFT_FIT_SLOTS[targetIndex]!.slot,
                rearrangementCount: Math.max(0, (plan?.moves.length ?? 1) - 1),
              };
              if (betterRefinedProjection(projection, best)) best = projection;
            } catch {
              continue;
            }
          }
          if (best !== null) refined.set(entry.candidate.playerId, best);
        }
      }
    } catch {
      refined.clear();
    }
  }
  const withRefined = eligibleScreened
    .filter((entry) => refined.has(entry.candidate.playerId))
    .sort((a, b) => {
      const ra = refined.get(a.candidate.playerId);
      const rb = refined.get(b.candidate.playerId);
      const netDelta = (rb?.netDelta ?? 0) - (ra?.netDelta ?? 0);
      if (netDelta !== 0) return netDelta;
      const worstDelta = (rb?.worstNetDelta ?? 0) - (ra?.worstNetDelta ?? 0);
      if (worstDelta !== 0) return worstDelta;
      const neutralDelta = (rb?.neutralNetDelta ?? 0) - (ra?.neutralNetDelta ?? 0);
      if (neutralDelta !== 0) return neutralDelta;
      return compareRanked(
        {
          score: 0,
          baseOverall: a.fit.baseOverall,
          playerId: a.candidate.playerId,
        },
        {
          score: 0,
          baseOverall: b.fit.baseOverall,
          playerId: b.candidate.playerId,
        },
      );
    });
  const rest = eligibleScreened.filter((entry) => !refined.has(entry.candidate.playerId));
  const scores = [...withRefined, ...rest].map(({ candidate, fit }) => {
    const projection = refined.get(candidate.playerId) ?? null;
    return toScore(candidate, fit, projection);
  });
  return finish(scores, refined.size);
}

function toScore(
  candidate: SimulationPlayer,
  fit: { baseOverall: number; fitDelta: number; reasons: ContextualReason[] },
  projection: DraftFitRefinedProjection | null,
): DraftFitScore {
  const topReason = fit.reasons.find((reason) => reason.direction === 'positive') ?? null;
  const warning = fit.reasons.find((reason) => reason.direction === 'negative') ?? null;
  const primaryNeed = topReason === null ? 'balance' : NEED_OF_REASON[topReason.code];
  return {
    playerId: candidate.playerId,
    displayName: candidate.displayName,
    baseOverall: fit.baseOverall,
    heuristicFitDelta: fit.fitDelta,
    netDelta: projection?.netDelta ?? null,
    worstNetDelta: projection?.worstNetDelta ?? null,
    netRating: projection?.netRating ?? null,
    tier: projection === null ? tierOfHeuristic(fit.fitDelta) : tierOfRefined(projection.netDelta),
    primaryNeed,
    reasonLabel:
      topReason?.label ?? (projection === null ? 'Balanced fit' : 'Best projected lineup lift'),
    warningLabel: warning?.label ?? null,
    recommendedSlot: projection?.recommendedSlot ?? null,
    rearrangementCount: projection?.rearrangementCount ?? 0,
    reasons: fit.reasons,
    refined: projection !== null,
  };
}
