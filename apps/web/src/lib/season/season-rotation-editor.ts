import {
  SEASON_ROTATION_PRESET_TARGETS,
  type Position,
  type SeasonRotation,
  type SeasonRotationPreset,
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
}

export const ROTATION_PRESETS: readonly SeasonRotationPreset[] = [
  'balanced',
  'tight',
  'bench-heavy',
] as const;

const STARTER_ROLE_LABELS = ['Starter G', 'Starter G', 'Starter F', 'Starter F', 'Starter C'];

export function presetLabel(preset: SeasonRotationPreset): string {
  switch (preset) {
    case 'balanced':
      return 'Balanced';
    case 'tight':
      return 'Tight';
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
   * Stepper adjustment that keeps the 240 total intact: +1 takes a minute
   * from the highest-minute other player, -1 gives a minute to the
   * lowest-minute other player (bench order breaks ties). Returns the audit
   * failures of the resulting rotation; empty means valid.
   */
  adjustMinutes(playerVersionId: string, delta: number): string[] {
    const current = this.minutesFor(playerVersionId);
    const clamped = Math.max(0, Math.min(48, current + delta));
    const actualDelta = clamped - current;
    if (actualDelta === 0) return this.validate();
    const others = this.rotation.targetMinutes.filter(
      (entry) => entry.playerVersionId !== playerVersionId,
    );
    const compensator =
      actualDelta > 0
        ? [...others].sort(
            (a, b) =>
              b.minutes - a.minutes ||
              this.benchIndex(a.playerVersionId) - this.benchIndex(b.playerVersionId),
          )[0]
        : [...others].sort(
            (a, b) =>
              a.minutes - b.minutes ||
              this.benchIndex(a.playerVersionId) - this.benchIndex(b.playerVersionId),
          )[0];
    if (!compensator || compensator.minutes <= 0 || compensator.minutes >= 48) {
      return this.validate();
    }
    const byId = new Map(
      this.rotation.targetMinutes.map((entry) => [entry.playerVersionId, entry]),
    );
    const set = (id: string, minutes: number) => byId.set(id, { playerVersionId: id, minutes });
    set(playerVersionId, clamped);
    set(compensator.playerVersionId, compensator.minutes - actualDelta);
    this.rotation = {
      ...this.rotation,
      targetMinutes: [...byId.values()],
    };
    return this.validate();
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
   * Assigns a roster player to a starter slot. A bench player is promoted and
   * the displaced starter takes that bench index; swapping two starters swaps
   * them. Reverts (with failures) when the resulting rotation is illegal.
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
   * Assigns a roster player to a closing-five slot. A player already closing
   * at another slot swaps with the incumbent; otherwise the incumbent leaves
   * the closing five. Reverts when the resulting rotation is illegal.
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
