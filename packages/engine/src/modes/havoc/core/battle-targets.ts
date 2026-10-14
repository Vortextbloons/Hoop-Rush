import type {
  HavocBattleInput,
  HavocBattleTeamInput,
  HavocParticipant,
} from '@hoop-rush/data-contracts';

/**
 * The frozen `havocBattleInputSchema` carries no capability-target field, so the
 * per-game target assignment is a pure function of the input and is derived
 * independently by the runtime. Both sides use this function.
 */
export interface HavocBattleCapabilityTargets {
  /** Body Snatcher owner instance id -> opposing starter instance id (all sides). */
  readonly bodySnatcher: ReadonlyMap<string, string>;
  /** Per-side The Bounty target: that side's highest-ranked opposing starter instance id. */
  readonly bounty: readonly [string | null, string | null];
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Starters ranked by frozen original Overall, source version id, source player id. */
export function rankedHavocStarters(team: HavocBattleTeamInput): HavocParticipant[] {
  return [...team.starters].sort((a, b) => {
    const overall = b.source.originalOverall - a.source.originalOverall;
    if (overall !== 0) return overall;
    const aVersion = a.source.playerVersionId ?? a.source.playerId;
    const bVersion = b.source.playerVersionId ?? b.source.playerId;
    const version = compareStrings(aVersion, bVersion);
    if (version !== 0) return version;
    return compareStrings(a.instanceId, b.instanceId);
  });
}

export function havocBattleCapabilityTargets(
  input: HavocBattleInput,
): HavocBattleCapabilityTargets {
  const bodySnatcher = new Map<string, string>();
  const bounty: [string | null, string | null] = [null, null];
  for (const sideIndex of [0, 1] as const) {
    const team = sideIndex === 0 ? input.home : input.away;
    const opponent = sideIndex === 0 ? input.away : input.home;
    const ranked = rankedHavocStarters(opponent);
    bounty[sideIndex] = ranked[0]?.instanceId ?? null;
    const owners = team.starters.filter((starter) =>
      starter.mutationPackage.some((entry) => entry.mutationId === 'body-snatcher'),
    );
    owners.forEach((owner, index) => {
      const target = ranked[index];
      if (target !== undefined) bodySnatcher.set(owner.instanceId, target.instanceId);
    });
  }
  return { bodySnatcher, bounty };
}
