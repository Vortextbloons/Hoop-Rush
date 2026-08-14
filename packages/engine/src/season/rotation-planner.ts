import type { Position, SeasonRotation } from '@hoop-rush/data-contracts';
import { canPlay } from '../domain/positions.ts';

export interface PlannerMember {
  playerVersionId: string;
  playable: readonly Position[];
}

export interface PlannerRotationContext {
  rotation: SeasonRotation;

  members: ReadonlyMap<string, readonly Position[]>;

  targets: ReadonlyMap<string, number>;
}

export interface PlannerUnitRequest {
  side: 'home' | 'away';

  currentUnit: readonly string[];

  unavailable: ReadonlySet<string>;

  actualSeconds: ReadonlyMap<string, number>;

  period: number;

  secondsRemaining: number;

  closingWindow: boolean;

  scoreMargin: number;
}

export function enumerateLegalFives(
  members: readonly PlannerMember[],
  available: ReadonlySet<string>,
): string[][] {
  const results: string[][] = [];
  const used = new Set<string>();
  const unit: string[] = [];
  const solve = (slot: number): void => {
    if (slot >= STARTING_SLOTS.length) {
      results.push([...unit]);
      return;
    }
    const requirement = STARTING_SLOTS[slot];
    if (requirement === undefined) return;
    for (const member of members) {
      if (used.has(member.playerVersionId)) continue;
      if (!available.has(member.playerVersionId)) continue;
      if (!canPlay(member.playable, requirement)) continue;
      used.add(member.playerVersionId);
      unit.push(member.playerVersionId);
      solve(slot + 1);
      unit.pop();
      used.delete(member.playerVersionId);
    }
  };
  solve(0);
  return results;
}

const plannerStateCache = new WeakMap<
  PlannerRotationContext,
  { members: PlannerMember[]; benchIndex: ReadonlyMap<string, number> }
>();

function plannerState(context: PlannerRotationContext): {
  members: PlannerMember[];
  benchIndex: ReadonlyMap<string, number>;
} {
  let state = plannerStateCache.get(context);
  if (state === undefined) {
    state = {
      members: orderedPlannerMembers(context),
      benchIndex: new Map(
        context.rotation.benchOrder.map((playerVersionId, index) => [playerVersionId, index]),
      ),
    };
    plannerStateCache.set(context, state);
  }
  return state;
}

export function chooseInitialUnit(
  context: PlannerRotationContext,
  unavailable: ReadonlySet<string>,
): string[] | null {
  const members = plannerState(context).members;
  const playableById = new Map(members.map((member) => [member.playerVersionId, member.playable]));

  const starters = context.rotation.starters;
  let startersLegal = starters.length === STARTING_SLOTS.length;
  if (startersLegal) {
    for (let slot = 0; slot < STARTING_SLOTS.length; slot += 1) {
      const starterId = starters[slot];
      const requirement = STARTING_SLOTS[slot];
      const playable = starterId === undefined ? undefined : playableById.get(starterId);
      if (
        starterId === undefined ||
        requirement === undefined ||
        playable === undefined ||
        unavailable.has(starterId) ||
        !canPlay(playable, requirement)
      ) {
        startersLegal = false;
        break;
      }
    }
  }
  if (startersLegal) return [...starters];

  const available = new Set(
    members.map((member) => member.playerVersionId).filter((id) => !unavailable.has(id)),
  );
  const contingencies = enumerateLegalFives(members, available);
  const first = contingencies[0];
  if (first === undefined) return null;
  return [...first];
}

export function planUnit(
  context: PlannerRotationContext,
  request: PlannerUnitRequest,
  options: { candidates?: readonly (readonly string[])[] } = {},
): string[] | null {
  const { members, benchIndex } = plannerState(context);
  const available = new Set(
    members.map((member) => member.playerVersionId).filter((id) => !request.unavailable.has(id)),
  );
  const candidates = options.candidates ?? enumerateLegalFives(members, available);
  const first = candidates[0];
  if (first === undefined) return null;

  const preferClosing = request.closingWindow || request.period > 4;

  if (preferClosing) {
    if (closingFiveIsLegal(context, request.unavailable)) return [...context.rotation.closingFive];
    let best = first;
    for (let i = 1; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      if (candidate === undefined) continue;
      if (closingPreferenceCompare(candidate, best, context, request, benchIndex) < 0) {
        best = candidate;
      }
    }
    return [...best];
  }

  const secondsRemaining = request.secondsRemaining;
  const rawDelta = secondsRemaining % 60 === 0 ? 60 : secondsRemaining % 60;
  const delta = Math.min(rawDelta, secondsRemaining);

  const { base, adjustment } = scoreParts(delta, context, request);
  const currentUnitSet = new Set(request.currentUnit);

  let best = first;
  let bestScore = scoreOf(best, base, adjustment);
  for (let i = 1; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (candidate === undefined) continue;
    const candidateScore = scoreOf(candidate, base, adjustment);
    const scoreCompare = candidateScore - bestScore;
    const retentionCompare =
      overlapWith(candidate, currentUnitSet) - overlapWith(best, currentUnitSet);
    if (
      scoreCompare < 0 ||
      (scoreCompare === 0 && retentionCompare > 0) ||
      (scoreCompare === 0 && retentionCompare === 0 && unitCompare(candidate, best, benchIndex) < 0)
    ) {
      best = candidate;
      bestScore = candidateScore;
    }
  }
  return [...best];
}

export function plannerCandidates(
  context: PlannerRotationContext,
  unavailable: ReadonlySet<string>,
): readonly (readonly string[])[] {
  const members = plannerState(context).members;
  const available = new Set(
    members.map((member) => member.playerVersionId).filter((id) => !unavailable.has(id)),
  );
  return enumerateLegalFives(members, available);
}

const STARTING_SLOTS = ['G', 'G', 'F', 'F', 'C'] as const;

function orderedPlannerMembers(context: PlannerRotationContext): PlannerMember[] {
  const starters = [...context.rotation.starters].sort();
  const order = [...starters, ...context.rotation.benchOrder];
  const seen = new Set<string>();
  const members: PlannerMember[] = [];
  for (const playerVersionId of order) {
    if (seen.has(playerVersionId)) continue;
    seen.add(playerVersionId);
    const playable = context.members.get(playerVersionId) ?? [];
    members.push({ playerVersionId, playable });
  }
  return members;
}

function scoreParts(
  delta: number,
  context: PlannerRotationContext,
  request: PlannerUnitRequest,
): { base: number; adjustment: Map<string, number> } {
  let base = 0;
  const adjustment = new Map<string, number>();
  const add = (playerVersionId: string): void => {
    const targetSeconds = context.targets.get(playerVersionId) ?? 0;
    const actualSeconds = request.actualSeconds.get(playerVersionId) ?? 0;
    base += Math.abs(actualSeconds - targetSeconds);
    adjustment.set(
      playerVersionId,
      Math.abs(actualSeconds + delta - targetSeconds) - Math.abs(actualSeconds - targetSeconds),
    );
  };
  for (const playerVersionId of context.rotation.starters) {
    add(playerVersionId);
  }
  for (const playerVersionId of context.rotation.benchOrder) {
    add(playerVersionId);
  }
  return { base, adjustment };
}

function scoreOf(
  unit: readonly string[],
  base: number,
  adjustment: ReadonlyMap<string, number>,
): number {
  let total = base;
  for (const playerVersionId of unit) {
    total += adjustment.get(playerVersionId) ?? 0;
  }
  return total;
}

function overlapWith(unit: readonly string[], currentUnit: ReadonlySet<string>): number {
  let overlap = 0;
  for (const playerVersionId of unit) {
    if (currentUnit.has(playerVersionId)) overlap += 1;
  }
  return overlap;
}

function currentOverlap(unit: readonly string[], currentUnit: readonly string[]): number {
  const current = new Set(currentUnit);
  let overlap = 0;
  for (const playerVersionId of unit) {
    if (current.has(playerVersionId)) overlap += 1;
  }
  return overlap;
}

function unitCompare(
  a: readonly string[],
  b: readonly string[],
  benchIndex: ReadonlyMap<string, number>,
): number {
  const tupleA = benchTuple(a, benchIndex);
  const tupleB = benchTuple(b, benchIndex);
  for (let i = 0; i < tupleA.length && i < tupleB.length; i += 1) {
    const indexA = tupleA[i];
    const indexB = tupleB[i];
    if (indexA === undefined || indexB === undefined) continue;
    if (indexA !== indexB) return indexA < indexB ? -1 : 1;
  }
  for (let i = 0; i < a.length && i < b.length; i += 1) {
    const idA = a[i];
    const idB = b[i];
    if (idA === undefined || idB === undefined) continue;
    if (idA !== idB) return idA < idB ? -1 : 1;
  }
  return 0;
}

function benchTuple(unit: readonly string[], benchIndex: ReadonlyMap<string, number>): number[] {
  return unit.map((playerVersionId) => benchIndex.get(playerVersionId) ?? -1).sort((a, b) => a - b);
}

function closingFiveIsLegal(
  context: PlannerRotationContext,
  unavailable: ReadonlySet<string>,
): boolean {
  const closing = context.rotation.closingFive;
  if (closing.length !== STARTING_SLOTS.length || new Set(closing).size !== closing.length) {
    return false;
  }
  for (let slot = 0; slot < STARTING_SLOTS.length; slot += 1) {
    const playerVersionId = closing[slot];
    const requirement = STARTING_SLOTS[slot];
    const playable =
      playerVersionId === undefined ? undefined : context.members.get(playerVersionId);
    if (
      playerVersionId === undefined ||
      requirement === undefined ||
      playable === undefined ||
      unavailable.has(playerVersionId) ||
      !canPlay(playable, requirement)
    ) {
      return false;
    }
  }
  return true;
}

function closingPreferenceCompare(
  a: readonly string[],
  b: readonly string[],
  context: PlannerRotationContext,
  request: PlannerUnitRequest,
  benchIndex: ReadonlyMap<string, number>,
): number {
  const closingOverlapCompare =
    currentOverlap(a, context.rotation.closingFive) -
    currentOverlap(b, context.rotation.closingFive);
  if (closingOverlapCompare !== 0) return -closingOverlapCompare;
  const continuityCompare =
    currentOverlap(a, request.currentUnit) - currentOverlap(b, request.currentUnit);
  if (continuityCompare !== 0) return -continuityCompare;
  return unitCompare(a, b, benchIndex);
}
