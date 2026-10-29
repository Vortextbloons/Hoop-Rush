import type {
  HavocBattleInput,
  HavocBattleTeamInput,
  HavocParticipant,
} from '@hoop-rush/data-contracts';
import { compareStrings } from '../../../domain/math.ts';

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
  /** Hostile Takeover owner instance id -> opposing ranked starter swapped with. */
  readonly hostileTakeover: ReadonlyMap<string, { from: string; to: string }>;
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

function lowestRankedStarter(team: HavocBattleTeamInput): HavocParticipant | undefined {
  return [...team.starters].sort((a, b) => {
    const overall = a.source.originalOverall - b.source.originalOverall;
    if (overall !== 0) return overall;
    const aVersion = a.source.playerVersionId ?? a.source.playerId;
    const bVersion = b.source.playerVersionId ?? b.source.playerId;
    const version = compareStrings(aVersion, bVersion);
    if (version !== 0) return version;
    return compareStrings(a.instanceId, b.instanceId);
  })[0];
}

export function havocBattleCapabilityTargets(
  input: HavocBattleInput,
): HavocBattleCapabilityTargets {
  const bodySnatcher = new Map<string, string>();
  const hostileTakeover = new Map<string, { from: string; to: string }>();
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
    const takeoverOwner = team.starters.find((starter) =>
      starter.mutationPackage.some((entry) => entry.mutationId === 'hostile-takeover'),
    );
    const lowest = lowestRankedStarter(team);
    const highest = ranked[0];
    if (takeoverOwner !== undefined && lowest !== undefined && highest !== undefined) {
      hostileTakeover.set(takeoverOwner.instanceId, {
        from: lowest.instanceId,
        to: highest.instanceId,
      });
    }
  }
  return { bodySnatcher, bounty, hostileTakeover };
}
