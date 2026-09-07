import {
  LINEUP_STRUCTURE,
  SEASON_ROSTER_MAX_SIZE,
  SEASON_ROTATION_PRESET_TARGETS,
  SEASON_ROTATION_SIZE,
  canPlay,
  type Position,
  type SeasonMinutePolicyStrategy,
  type SeasonRotation,
  type SeasonRotationPreset,
  type SlotGroup,
} from '@hoop-rush/data-contracts';
import { applySeasonRotationPreset, buildMinutePlanCandidates } from '@hoop-rush/engine';
import { minuteStrategyOfPreset } from '@hoop-rush/engine';
import { validateSeasonRotation } from '@hoop-rush/engine';
export interface RotationMember {
  playerVersionId: string;
  displayName: string;
  playable: readonly Position[];
  franchiseId?: string;
  eraId?: string;
  seasonKey?: string;
}
export const SLOT_GROUPS: readonly SlotGroup[] = LINEUP_STRUCTURE;
export const CLOSING_SLOT_LABELS = ['G1', 'G2', 'F1', 'F2', 'C'] as const;
export interface MinuteAdjustment {
  playerVersionId: string;
  minutes: number;
  delta: number;
}
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
export interface PresetPlayerLoad {
  staminaRating: number;
  durability: number;
  fatigueBasisPoints: number;
  recentLoadBasisPoints: number;
}
export interface DynamicPresetContext {
  overallByVersion?: ReadonlyMap<string, number> | null;
  loadByVersion?: ReadonlyMap<string, PresetPlayerLoad> | null;
  horizonGames?: number | null;
}
function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
export function dynamicPresetRotationFor(
  rotation: SeasonRotation,
  preset: SeasonRotationPreset,
  context: DynamicPresetContext = {},
): SeasonRotation | null {
  const strategy = minuteStrategyOfPreset(preset);
  const active = [...rotation.starters, ...rotation.benchOrder];
  if (active.length !== SEASON_ROTATION_SIZE) return null;
  const horizon =
    context.horizonGames !== null &&
    context.horizonGames !== undefined &&
    Number.isFinite(context.horizonGames) &&
    context.horizonGames > 0
      ? Math.floor(context.horizonGames)
      : 10;
  const players = new Map(
    active.map((playerVersionId) => {
      const overall = context.overallByVersion?.get(playerVersionId);
      const load = context.loadByVersion?.get(playerVersionId);
      return [
        playerVersionId,
        {
          playerVersionId,
          quality: overall === undefined ? 0.5 : clamp01(overall / 100),
          staminaRating: load?.staminaRating ?? 70,
          durability: load?.durability ?? 70,
          fatigueBasisPoints: load?.fatigueBasisPoints ?? 0,
          recentLoadBasisPoints: load?.recentLoadBasisPoints ?? 0,
        },
      ] as const;
    }),
  );
  try {
    const built = buildMinutePlanCandidates({
      structure: {
        starters: [...rotation.starters],
        benchOrder: [...rotation.benchOrder],
        closingFive: [...rotation.closingFive],
      },
      players,
      horizon,
    });
    const plan = built.plans.find((candidate) => candidate.strategy === strategy);
    if (plan === undefined) return null;
    return { ...plan.rotation, franchiseId: rotation.franchiseId };
  } catch {
    return null;
  }
}
export function rotationRoleOf(rotation: SeasonRotation, playerVersionId: string): string {
  const starterIndex = rotation.starters.indexOf(playerVersionId);
  if (starterIndex !== -1) {
    return STARTER_ROLE_LABELS[starterIndex] ?? `Starter ${String(starterIndex + 1)}`;
  }
  const benchIndex = rotation.benchOrder.indexOf(playerVersionId);
  if (benchIndex !== -1) return `Bench ${String(benchIndex + 1)}`;
  return 'Inactive';
}
export class RotationEditor {
  rotation: SeasonRotation;
  private readonly members: RotationMember[];
  memberPlayable: ReadonlyMap<string, readonly Position[]>;
  readonly names: ReadonlyMap<string, string>;
  private readonly rosterIds: string[];
  private activeIds: Set<string>;
  constructor(rotation: SeasonRotation, members: RotationMember[]) {
    if (members.length < SEASON_ROTATION_SIZE || members.length > SEASON_ROSTER_MAX_SIZE) {
      throw new Error(
        `rotation editor needs ${String(SEASON_ROTATION_SIZE)} to ${String(SEASON_ROSTER_MAX_SIZE)} roster members (got ${String(members.length)})`,
      );
    }
    const partition = [...rotation.starters, ...rotation.benchOrder];
    if (partition.length !== SEASON_ROTATION_SIZE) {
      throw new Error(
        `rotation must reference exactly ${String(SEASON_ROTATION_SIZE)} players (got ${String(partition.length)})`,
      );
    }
    this.rotation = rotation;
    this.members = members;
    this.activeIds = new Set(partition);
    this.memberPlayable = new Map(
      members
        .filter((member) => this.activeIds.has(member.playerVersionId))
        .map((member) => [member.playerVersionId, member.playable]),
    );
    this.names = new Map(members.map((m) => [m.playerVersionId, m.displayName]));
    this.rosterIds = members.map((m) => m.playerVersionId);
  }
  activeMemberIds(): string[] {
    return [...this.rotation.starters, ...this.rotation.benchOrder];
  }
  isActive(playerVersionId: string): boolean {
    return this.activeIds.has(playerVersionId);
  }
  inactiveMembers(): RotationMember[] {
    return this.members.filter((member) => !this.activeIds.has(member.playerVersionId));
  }
  promoteToRotation(inactivePlayerVersionId: string, replacedPlayerVersionId: string): string[] {
    if (inactivePlayerVersionId === replacedPlayerVersionId) return [];
    if (!this.rosterIds.includes(inactivePlayerVersionId)) {
      return [`${inactivePlayerVersionId} is not on the roster`];
    }
    if (!this.rosterIds.includes(replacedPlayerVersionId)) {
      return [`${replacedPlayerVersionId} is not on the roster`];
    }
    if (this.activeIds.has(inactivePlayerVersionId)) {
      return [`${inactivePlayerVersionId} is already in the rotation`];
    }
    if (!this.activeIds.has(replacedPlayerVersionId)) {
      return [`${replacedPlayerVersionId} is not in the rotation`];
    }
    const promoted = this.members.find(
      (member) => member.playerVersionId === inactivePlayerVersionId,
    );
    if (promoted === undefined) {
      return [`${inactivePlayerVersionId} is not on the roster`];
    }
    const candidate: SeasonRotation = {
      ...this.rotation,
      starters: this.rotation.starters.map((id) =>
        id === replacedPlayerVersionId ? inactivePlayerVersionId : id,
      ),
      benchOrder: this.rotation.benchOrder.map((id) =>
        id === replacedPlayerVersionId ? inactivePlayerVersionId : id,
      ),
      targetMinutes: this.rotation.targetMinutes.map((entry) =>
        entry.playerVersionId === replacedPlayerVersionId
          ? { playerVersionId: inactivePlayerVersionId, minutes: entry.minutes }
          : entry,
      ),
      closingFive: this.rotation.closingFive.map((id) =>
        id === replacedPlayerVersionId ? inactivePlayerVersionId : id,
      ),
    };
    const playable = new Map(this.memberPlayable);
    playable.delete(replacedPlayerVersionId);
    playable.set(inactivePlayerVersionId, promoted.playable);
    const failures = validateSeasonRotation(candidate, playable);
    if (failures.length > 0) return failures;
    this.rotation = candidate;
    this.memberPlayable = playable;
    this.activeIds = new Set([...candidate.starters, ...candidate.benchOrder]);
    return [];
  }
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
  eligibleForSlot(slotIndex: number): RotationMember[] {
    const group = SLOT_GROUPS[slotIndex];
    if (group === undefined) return [];
    return this.members.filter(
      (member) => this.activeIds.has(member.playerVersionId) && canPlay(member.playable, group),
    );
  }
  minutesFor(playerVersionId: string): number {
    return (
      this.rotation.targetMinutes.find((t) => t.playerVersionId === playerVersionId)?.minutes ?? 0
    );
  }
  validate(): string[] {
    return validateSeasonRotation(this.rotation, this.memberPlayable);
  }
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
  adjustMinutes(playerVersionId: string, delta: number): string[] {
    return this.setMinutes(playerVersionId, this.minutesFor(playerVersionId) + delta);
  }
  balanceMinutesTotal(): RebalanceResult {
    const total = this.rotation.targetMinutes.reduce((sum, entry) => sum + entry.minutes, 0);
    const gap = 240 - total;
    if (gap === 0) return { failures: [], adjustments: [] };
    const byId = new Map(
      this.rotation.targetMinutes.map((entry) => [entry.playerVersionId, { ...entry }]),
    );
    const adjustments: MinuteAdjustment[] = [];
    const ordered = this.rotation.targetMinutes.map((entry) => ({
      playerVersionId: entry.playerVersionId,
      minutes: entry.minutes,
      benchIndex: this.benchIndex(entry.playerVersionId),
    }));
    if (gap > 0) {
      const recipients = [...ordered]
        .filter((player) => player.minutes > 0)
        .sort((a, b) => a.minutes - b.minutes || a.benchIndex - b.benchIndex);
      let remaining = gap;
      for (const player of recipients) {
        if (remaining <= 0) break;
        const capacity = 48 - player.minutes;
        const give = Math.min(remaining, capacity);
        if (give <= 0) continue;
        const next = player.minutes + give;
        byId.set(player.playerVersionId, { playerVersionId: player.playerVersionId, minutes: next });
        adjustments.push({ playerVersionId: player.playerVersionId, minutes: next, delta: give });
        remaining -= give;
      }
      if (remaining > 0) {
        return {
          failures: [
            `cannot balance to 240: ${String(remaining)} minutes could not be assigned within 48-minute caps`,
          ],
          adjustments: [],
        };
      }
    } else {
      const surplus = -gap;
      const donors = [...ordered].sort(
        (a, b) => b.minutes - a.minutes || a.benchIndex - b.benchIndex,
      );
      let remaining = surplus;
      for (const player of donors) {
        if (remaining <= 0) break;
        const capacity = player.minutes;
        const take = Math.min(remaining, capacity);
        if (take <= 0) continue;
        const next = player.minutes - take;
        byId.set(player.playerVersionId, { playerVersionId: player.playerVersionId, minutes: next });
        adjustments.push({ playerVersionId: player.playerVersionId, minutes: next, delta: -take });
        remaining -= take;
      }
      if (remaining > 0) {
        return {
          failures: [
            `cannot balance to 240: ${String(remaining)} minutes could not be removed`,
          ],
          adjustments: [],
        };
      }
    }
    const candidate = { ...this.rotation, targetMinutes: [...byId.values()] };
    const failures = validateSeasonRotation(candidate, this.memberPlayable);
    if (failures.length > 0) return { failures, adjustments: [] };
    this.rotation = candidate;
    return { failures: [], adjustments };
  }
  rebalanceMinutes(playerVersionId: string, minutes: number): RebalanceResult {
    if (!this.activeIds.has(playerVersionId)) {
      return {
        failures: [`${playerVersionId} is not an active rotation member`],
        adjustments: [],
      };
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
    const failures = validateSeasonRotation(candidate, this.memberPlayable);
    if (failures.length > 0) return { failures, adjustments: [] };
    this.rotation = candidate;
    return { failures: [], adjustments };
  }
  toggleClosing(playerVersionId: string): string[] {
    if (!this.activeIds.has(playerVersionId)) {
      return [`${playerVersionId} is not an active rotation member`];
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
  applyPreset(preset: SeasonRotationPreset, context: DynamicPresetContext = {}): string[] {
    const hasContext =
      (context.overallByVersion !== null &&
        context.overallByVersion !== undefined &&
        context.overallByVersion.size > 0) ||
      (context.loadByVersion !== null &&
        context.loadByVersion !== undefined &&
        context.loadByVersion.size > 0);
    if (hasContext) {
      const dynamic = dynamicPresetRotationFor(this.rotation, preset, context);
      if (dynamic !== null) {
        const failures = validateSeasonRotation(dynamic, this.memberPlayable);
        if (failures.length === 0) {
          this.rotation = dynamic;
          return [];
        }
      }
    }
    this.rotation = applySeasonRotationPreset(this.rotation, preset);
    return this.validate();
  }
  applyFlatPreset(preset: SeasonRotationPreset): string[] {
    this.rotation = applySeasonRotationPreset(this.rotation, preset);
    return this.validate();
  }
  applyRotation(candidate: SeasonRotation): SeasonRotation {
    const failures = validateSeasonRotation(candidate, this.memberPlayable);
    if (failures.length > 0) {
      throw new Error(`rotation plan rejected: ${failures[0] ?? 'invalid rotation'}`);
    }
    this.rotation = candidate;
    return this.rotation;
  }
  applyAutoRotation(candidate: SeasonRotation): SeasonRotation {
    const nextActive = new Set([...candidate.starters, ...candidate.benchOrder]);
    const playable = new Map<string, readonly Position[]>();
    for (const member of this.members) {
      if (nextActive.has(member.playerVersionId)) {
        playable.set(member.playerVersionId, member.playable);
      }
    }
    const failures = validateSeasonRotation(candidate, playable);
    if (failures.length > 0) {
      throw new Error(`rotation plan rejected: ${failures[0] ?? 'invalid rotation'}`);
    }
    this.rotation = candidate;
    this.memberPlayable = playable;
    this.activeIds = nextActive;
    return this.rotation;
  }
  assignStarter(slotIndex: number, playerVersionId: string): string[] {
    const current = this.rotation.starters[slotIndex];
    if (current === playerVersionId) return [];
    if (!this.activeIds.has(playerVersionId)) {
      return [`${playerVersionId} is not an active rotation member`];
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
  assignClosing(slotIndex: number, playerVersionId: string): string[] {
    const current = this.rotation.closingFive[slotIndex];
    if (current === playerVersionId) return [];
    if (!this.activeIds.has(playerVersionId)) {
      return [`${playerVersionId} is not an active rotation member`];
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
    const failures = validateSeasonRotation(candidate, this.memberPlayable);
    if (failures.length > 0) return failures;
    this.rotation = candidate;
    return [];
  }
}
export function createRotationEditor(
  rotation: SeasonRotation,
  roster: Array<{
    playerVersionId: string;
    displayName: string;
    playable: readonly Position[];
  }>,
): RotationEditor {
  return new RotationEditor(rotation, roster);
}
export function rotationEditorNeedsPositionRefresh(
  editor: RotationEditor,
  rosterPlayerVersionIds: readonly string[],
  playableOf: (playerVersionId: string) => readonly Position[],
): boolean {
  for (const playerVersionId of rosterPlayerVersionIds) {
    const loaded = playableOf(playerVersionId);
    if (loaded.length === 0) continue;
    const cached = editor.memberPlayable.get(playerVersionId) ?? [];
    if (cached.length === 0) return true;
  }
  return false;
}
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
export function displayRotationFailure(
  failure: string,
  names: ReadonlyMap<string, string>,
): string {
  let humanized = failure;
  const entries = [...names.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [playerVersionId, displayName] of entries) {
    if (playerVersionId.length === 0) continue;
    if (humanized.includes(playerVersionId)) {
      humanized = humanized.split(playerVersionId).join(displayName);
    }
  }
  humanized = humanized.replace(/\bslot (\d+)\b/g, (_match, rawIndex: string) => {
    const slotIndex = Number.parseInt(rawIndex, 10);
    const label = CLOSING_SLOT_LABELS[slotIndex];
    return label ?? `slot ${rawIndex}`;
  });
  return humanized;
}
export function displayRotationFailures(
  failures: readonly string[],
  names: ReadonlyMap<string, string>,
): string[] {
  return failures.map((failure) => displayRotationFailure(failure, names));
}
