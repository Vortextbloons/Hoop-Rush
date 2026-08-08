import {
  SEASON_ROTATION_PRESET_TARGETS,
  canPlay,
  type Position,
  type SeasonMinutePolicyStrategy,
  type SeasonRotation,
  type SeasonRotationPreset,
  type SlotGroup,
} from '@hoop-rush/data-contracts';
import { applySeasonRotationPreset, auditSeasonRotation } from '@hoop-rush/engine';

/**
 * Season Run rotation editor (spec/2.0/04, M2.2 contract, M2.3 hub).
 * All legality stays in the engine: every mutation builds a candidate
 * rotation, runs `auditSeasonRotation`, and commits only when the audit is
 * clean. The editor is a thin stateful wrapper over the frozen rotation
 * contract, so the pending rotation can never drift into a submission the
 * engine would reject.
 */

export interface RotationMember {
  playerVersionId: string;
  displayName: string;
  playable: readonly Position[];
  /** Historical source identity (presentation only; null in fixtures). */
  franchiseId?: string;
  eraId?: string;
  seasonKey?: string;
}

/** The coarse slot requirement of each lineup slot (G, G, F, F, C). */
export const SLOT_GROUPS: readonly SlotGroup[] = ['G', 'G', 'F', 'F', 'C'];

/**
 * One player's minutes change from a rebalance; `delta` is signed so the UI
 * can announce who gained and who lost.
 */
export interface MinuteAdjustment {
  playerVersionId: string;
  minutes: number;
  delta: number;
}

/** Result of a rebalancing minutes edit: failures (empty = committed) plus
 * the players whose target minutes changed. */
export interface RebalanceResult {
  failures: string[];
  adjustments: MinuteAdjustment[];
}

export const ROTATION_PRESETS: readonly SeasonRotationPreset[] = [
  'balanced',
  'tight',
  'bench-heavy',
] as const;

const STARTER_ROLE_LABELS = ['Starter PG', 'Starter SG', 'Starter SF', 'Starter PF', 'Starter C'];

export function presetLabel(preset: SeasonRotationPreset): string {
  switch (preset) {
    case 'balanced':
      return 'Balanced';
    case 'tight':
      return 'Starter-Heavy';
    case 'bench-heavy':
      return 'Bench-Heavy';
  }
}

/** Minute-policy strategy label for the optimize-with-projection plan cards. */
export function strategyLabel(strategy: SeasonMinutePolicyStrategy): string {
  switch (strategy) {
    case 'starter-heavy':
      return 'Starter-Heavy';
    case 'balanced':
      return 'Balanced';
    case 'bench-heavy':
      return 'Bench-Heavy';
  }
}

export function presetMinutes(preset: SeasonRotationPreset, roleIndex: number): number {
  const table = SEASON_ROTATION_PRESET_TARGETS[preset];
  return roleIndex < 5 ? table.starters : (table.bench[roleIndex - 5] ?? 0);
}

/** Role label for a player in a rotation (starter slot / bench index). */
export function rotationRoleOf(rotation: SeasonRotation, playerVersionId: string): string {
  const starterIndex = rotation.starters.indexOf(playerVersionId);
  if (starterIndex !== -1) {
    return STARTER_ROLE_LABELS[starterIndex] ?? `Starter ${String(starterIndex + 1)}`;
  }
  const benchIndex = rotation.benchOrder.indexOf(playerVersionId);
  if (benchIndex !== -1) return `Bench ${String(benchIndex + 1)}`;
  return 'Unrostered';
}

export class RotationEditor {
  rotation: SeasonRotation;
  private readonly members: RotationMember[];
  readonly memberPlayable: ReadonlyMap<string, readonly Position[]>;
  readonly names: ReadonlyMap<string, string>;
  private readonly rosterIds: string[];

  constructor(rotation: SeasonRotation, members: RotationMember[]) {
    if (members.length !== 10) {
      throw new Error(`rotation editor needs ten members (got ${String(members.length)})`);
    }
    this.rotation = rotation;
    this.members = members;
    this.memberPlayable = new Map(members.map((m) => [m.playerVersionId, m.playable]));
    this.names = new Map(members.map((m) => [m.playerVersionId, m.displayName]));
    this.rosterIds = members.map((m) => m.playerVersionId);
  }

  /** All ten members with their current minutes and role. */
  rows(): Array<{
    member: RotationMember;
    minutes: number;
    role: string;
    starterIndex: number;
    benchIndex: number;
    closingIndex: number;
  }> {
    return this.members.map((member) => {
      const minutes =
        this.rotation.targetMinutes.find((t) => t.playerVersionId === member.playerVersionId)
          ?.minutes ?? 0;
      return {
        member,
        minutes,
        role: rotationRoleOf(this.rotation, member.playerVersionId),
        starterIndex: this.rotation.starters.indexOf(member.playerVersionId),
        benchIndex: this.rotation.benchOrder.indexOf(member.playerVersionId),
        closingIndex: this.rotation.closingFive.indexOf(member.playerVersionId),
      };
    });
  }

  /** Members that can legally fill one starter slot, mirroring the engine
   * audit's eligibility so the pickers never offer an illegal swap. */
  eligibleForSlot(slotIndex: number): RotationMember[] {
    const group = SLOT_GROUPS[slotIndex];
    if (group === undefined) return [];
    return this.members.filter((member) => canPlay(member.playable, group));
  }

  minutesFor(playerVersionId: string): number {
    return (
      this.rotation.targetMinutes.find((t) => t.playerVersionId === playerVersionId)?.minutes ?? 0
    );
  }

  /** Audit failures of the current rotation; empty means valid. */
  validate(): string[] {
    return auditSeasonRotation(this.rotation, this.memberPlayable);
  }

  /** Sets one player's target minutes (integer 0-48). Invalid edits are kept
   * visible so the hub can surface them; submission is blocked by validation. */
  setMinutes(playerVersionId: string, minutes: number): string[] {
    const clamped = Math.max(0, Math.min(48, Math.round(minutes)));
    this.rotation = {
      ...this.rotation,
      targetMinutes: this.rotation.targetMinutes.map((entry) =>
        entry.playerVersionId === playerVersionId ? { playerVersionId, minutes: clamped } : entry,
      ),
    };
    return this.validate();
  }

  /**
   * Stepper adjustment that keeps the 240 total intact: +1 takes a minute from
   * the highest-minute other player, -1 gives one to the lowest-minute other
   * player (bench order breaks ties). Returns the audit failures.
   */
  adjustMinutes(playerVersionId: string, delta: number): string[] {
    return this.rebalanceMinutes(playerVersionId, this.minutesFor(playerVersionId) + delta)
      .failures;
  }

  /**
   * Sets one player's target minutes (clamped 0-48, integer) and rebalances
   * the rest deterministically so the total stays exactly 240: typing higher
   * takes from the highest-minute teammates, lower gives to the lowest-minute
   * (bench order breaks ties). Commits only on a clean audit; otherwise the
   * rotation is unchanged. `adjustments` lists every changed player with
   * signed deltas for the UI to highlight and announce.
   */
  rebalanceMinutes(playerVersionId: string, minutes: number): RebalanceResult {
    if (!this.rosterIds.includes(playerVersionId)) {
      return { failures: [`${playerVersionId} is not on the roster`], adjustments: [] };
    }
    const clamped = Math.max(0, Math.min(48, Math.round(minutes)));
    const current = this.minutesFor(playerVersionId);
    const delta = clamped - current;
    if (delta === 0) return { failures: [], adjustments: [] };
    const take = delta > 0;
    const others = this.rotation.targetMinutes
      .filter((entry) => entry.playerVersionId !== playerVersionId)
      .map((entry) => ({
        playerVersionId: entry.playerVersionId,
        minutes: entry.minutes,
        benchIndex: this.benchIndex(entry.playerVersionId),
      }))
      .sort((a, b) =>
        take
          ? b.minutes - a.minutes || a.benchIndex - b.benchIndex
          : a.minutes - b.minutes || a.benchIndex - b.benchIndex,
      );
    const byId = new Map(
      this.rotation.targetMinutes.map((entry) => [entry.playerVersionId, entry]),
    );
    const set = (id: string, minutesValue: number) =>
      byId.set(id, { playerVersionId: id, minutes: minutesValue });
    set(playerVersionId, clamped);
    const adjustments: MinuteAdjustment[] = [{ playerVersionId, minutes: clamped, delta }];
    let remaining = Math.abs(delta);
    for (const other of others) {
      if (remaining <= 0) break;
      const capacity = take ? other.minutes : 48 - other.minutes;
      const give = Math.min(remaining, Math.max(0, capacity));
      if (give <= 0) continue;
      const next = other.minutes + (take ? -give : give);
      set(other.playerVersionId, next);
      adjustments.push({
        playerVersionId: other.playerVersionId,
        minutes: next,
        delta: take ? -give : give,
      });
      remaining -= give;
    }
    if (remaining > 0) {
      return {
        failures: [
          take
            ? `cannot raise ${playerVersionId} to ${String(clamped)} minutes: not enough minutes available from teammates`
            : `cannot lower ${playerVersionId} to ${String(clamped)} minutes: no teammates have capacity`,
        ],
        adjustments: [],
      };
    }
    const candidate = { ...this.rotation, targetMinutes: [...byId.values()] };
    const failures = auditSeasonRotation(candidate, this.memberPlayable);
    if (failures.length > 0) return { failures, adjustments: [] };
    this.rotation = candidate;
    return { failures: [], adjustments };
  }

  /**
   * Closing-five toggle: a player already closing is replaced by the best
   * eligible non-closing player for their vacated slot; otherwise they take
   * the first closing slot their positions permit, displacing the incumbent.
   * Keeps exactly five; reverts (with failures) when no legal result exists.
   */
  toggleClosing(playerVersionId: string): string[] {
    if (!this.rosterIds.includes(playerVersionId)) {
      return [`${playerVersionId} is not on the roster`];
    }
    const closingFive = [...this.rotation.closingFive];
    const currentSlot = closingFive.indexOf(playerVersionId);
    if (currentSlot !== -1) {
      const group = SLOT_GROUPS[currentSlot];
      if (group === undefined) {
        return ['closing five slot is not a G, F, or C slot'];
      }
      const replacement = this.rotation.targetMinutes
        .filter((entry) => !closingFive.includes(entry.playerVersionId))
        .map((entry) => ({
          playerVersionId: entry.playerVersionId,
          minutes: entry.minutes,
          benchIndex: this.benchIndex(entry.playerVersionId),
        }))
        .sort(
          (a, b) =>
            b.minutes - a.minutes ||
            a.benchIndex - b.benchIndex ||
            a.playerVersionId.localeCompare(b.playerVersionId),
        )
        .find((entry) => canPlay(this.memberPlayable.get(entry.playerVersionId) ?? [], group));
      if (replacement === undefined) {
        return [
          `closing-five player ${playerVersionId} cannot be removed: no eligible non-closing player for slot ${String(currentSlot)}`,
        ];
      }
      closingFive[currentSlot] = replacement.playerVersionId;
    } else {
      const playable = this.memberPlayable.get(playerVersionId) ?? [];
      const slotIndex = SLOT_GROUPS.findIndex((group) => canPlay(playable, group));
      if (slotIndex === -1) {
        return [`closing-five player ${playerVersionId} cannot play any closing slot`];
      }
      closingFive[slotIndex] = playerVersionId;
    }
    return this.commit({ ...this.rotation, closingFive });
  }

  /** Moves a bench player one step up or down the substitution hierarchy.
   * No-op at the edges; reverts on audit failure. */
  moveBench(benchIndex: number, delta: -1 | 1): string[] {
    const target = benchIndex + delta;
    const benchOrder = [...this.rotation.benchOrder];
    const current = benchOrder[benchIndex];
    const neighbor = benchOrder[target];
    if (
      current === undefined ||
      neighbor === undefined ||
      target < 0 ||
      target >= benchOrder.length
    ) {
      return [];
    }
    benchOrder[benchIndex] = neighbor;
    benchOrder[target] = current;
    return this.commit({ ...this.rotation, benchOrder });
  }

  private benchIndex(playerVersionId: string): number {
    const index = this.rotation.benchOrder.indexOf(playerVersionId);
    return index === -1 ? this.rotation.benchOrder.length : index;
  }

  /** Rewrites only the target minutes through the engine preset table. */
  applyPreset(preset: SeasonRotationPreset): string[] {
    this.rotation = applySeasonRotationPreset(this.rotation, preset);
    return this.validate();
  }

  /**
   * Commits an externally produced candidate rotation (e.g. an applied minute
   * plan) through the same engine audit as every other mutation; throws when
   * the audit rejects it. The editor never adopts a rotation the engine would
   * reject.
   */
  applyRotation(candidate: SeasonRotation): SeasonRotation {
    const failures = auditSeasonRotation(candidate, this.memberPlayable);
    if (failures.length > 0) {
      throw new Error(`rotation plan rejected: ${failures[0] ?? 'invalid rotation'}`);
    }
    this.rotation = candidate;
    return this.rotation;
  }

  /**
   * Assigns a roster player to a starter slot: a bench player is promoted and
   * the displaced starter takes their bench index; swapping two starters
   * swaps them. Reverts (with failures) when the result is illegal.
   */
  assignStarter(slotIndex: number, playerVersionId: string): string[] {
    const current = this.rotation.starters[slotIndex];
    if (current === playerVersionId) return [];
    if (!this.rosterIds.includes(playerVersionId)) {
      return [`${playerVersionId} is not on the roster`];
    }
    const starters = [...this.rotation.starters];
    const benchOrder = [...this.rotation.benchOrder];
    const benchIndex = benchOrder.indexOf(playerVersionId);
    if (benchIndex !== -1) {
      starters[slotIndex] = playerVersionId;
      if (current !== undefined) benchOrder[benchIndex] = current;
    } else {
      const otherSlot = starters.indexOf(playerVersionId);
      if (otherSlot === -1) return ['that player is not a starter or bench member'];
      starters[slotIndex] = playerVersionId;
      if (current !== undefined) starters[otherSlot] = current;
    }
    return this.commit({ ...this.rotation, starters, benchOrder });
  }

  /**
   * Assigns a roster player to a closing-five slot: a player already closing
   * elsewhere swaps with the incumbent; otherwise the incumbent leaves the
   * closing five. Reverts when the result is illegal.
   */
  assignClosing(slotIndex: number, playerVersionId: string): string[] {
    const current = this.rotation.closingFive[slotIndex];
    if (current === playerVersionId) return [];
    if (!this.rosterIds.includes(playerVersionId)) {
      return [`${playerVersionId} is not on the roster`];
    }
    const closingFive = [...this.rotation.closingFive];
    const otherSlot = closingFive.indexOf(playerVersionId);
    if (otherSlot !== -1) {
      closingFive[slotIndex] = playerVersionId;
      if (current !== undefined) closingFive[otherSlot] = current;
    } else {
      closingFive[slotIndex] = playerVersionId;
    }
    return this.commit({ ...this.rotation, closingFive });
  }

  private commit(candidate: SeasonRotation): string[] {
    const failures = auditSeasonRotation(candidate, this.memberPlayable);
    if (failures.length > 0) return failures;
    this.rotation = candidate;
    return [];
  }
}

/** Builds a fresh editor from a rotation and roster identity + positions. */
export function createRotationEditor(
  rotation: SeasonRotation,
  roster: Array<{ playerVersionId: string; displayName: string; playable: readonly Position[] }>,
): RotationEditor {
  return new RotationEditor(rotation, roster);
}

/**
 * Splits audit failure strings into per-player failures (messages that name
 * a playerVersionId) and global failures (totals, duplicates, structure).
 * The engine's failure strings embed ids positionally; parse them
 * defensively so the UI can attach each failure to the affected control.
 */
export interface RotationFailureIndex {
  byPlayer: ReadonlyMap<string, readonly string[]>;
  global: readonly string[];
}

const FAILURE_ID_PATTERNS = [
  /\bstarter ([a-z0-9][a-z0-9._:-]*) cannot play slot/,
  /\bclosing-five player ([a-z0-9][a-z0-9._:-]*) cannot play slot/,
  /\btarget minutes for ([a-z0-9][a-z0-9._:-]*) must be an integer/,
  /\bno target minutes for rostered player ([a-z0-9][a-z0-9._:-]*)/,
  /\bno position data for starter ([a-z0-9][a-z0-9._:-]*)/,
  /\bno position data for closing-five player ([a-z0-9][a-z0-9._:-]*)/,
] as const;

/** PlayerVersionId named by a failure message, or null for global failures. */
export function failurePlayerVersionId(failure: string): string | null {
  for (const pattern of FAILURE_ID_PATTERNS) {
    const match = failure.match(pattern);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

export function indexRotationFailures(failures: readonly string[]): RotationFailureIndex {
  const byPlayer = new Map<string, string[]>();
  const global: string[] = [];
  for (const failure of failures) {
    const playerVersionId = failurePlayerVersionId(failure);
    if (playerVersionId === null) {
      global.push(failure);
    } else {
      const list = byPlayer.get(playerVersionId) ?? [];
      list.push(failure);
      byPlayer.set(playerVersionId, list);
    }
  }
  return { byPlayer, global };
}
