import type {
  SeasonDraftCatalog,
  SeasonEffectsState,
  SeasonFreeAgencyBand,
  SeasonFreeAgencyCandidate,
  SeasonFreeAgencyCanonical,
  SeasonFreeAgencyDeclaration,
  SeasonFreeAgencyIndex,
  SeasonFreeAgencyIndexEntry,
  SeasonFreeAgencyResolutionTrace,
  SeasonFreeAgencyRoleExpectation,
  SeasonFreeAgencySigning,
  SeasonFreeAgencyState,
  SeasonFreeAgencyTarget,
  SeasonFreeAgencyTraceStep,
  SeasonFreeAgencyWindowState,
  SeasonInfluenceState,
  SeasonOwnership,
  SeasonRosterEntry,
  SeasonRosterRole,
  SeasonRun,
  SeasonTransactionEntry,
} from '@hoop-rush/data-contracts';
import {
  SEASON_ROSTER_MAX_SIZE,
  SEASON_SEED_NAMESPACES,
  seasonNamespaceSeed,
} from '@hoop-rush/data-contracts';
import type { SeasonRosterTargets } from '@hoop-rush/data-contracts';
import {
  ROSTER_ROLES,
  ROLE_COVERAGE_THRESHOLD,
  identityScore,
  roleScoresOf,
  type SeasonScoreMember,
} from './ai-scoring.ts';
import {
  legalFiveAfterAnyRemoval,
  legalFiveExists,
  type SeasonRosterMemberInput,
} from './roster-rules.ts';
import { seasonPlayerAvailable } from './injuries.ts';
import { seasonTransactionEntry, deriveSeasonInfluenceEntryId, deriveSeasonTransactionId } from './transactions.ts';
import { SEASON_INFLUENCE_FLOOR } from './influence.ts';

export const SEASON_FREE_AGENCY_BAND_SIGNING_CAPS: Record<string, number> = {
  contender: 1,
  playoff: 2,
  average: 3,
  weaker: 3,
};

const FALLBACK_BAND_POOL_SCORE_CAPS: Record<string, number> = {
  contender: 100,
  playoff: 92,
  average: 84,
  weaker: 74,
};

const FALLBACK_MAX_ROSTER_STRENGTH_OUTLIERS = 2;

export const SEASON_FREE_AGENCY_WINDOW_COMPOSITION: Record<SeasonFreeAgencyBand, number> = {
  featured: 1,
  role: 5,
  development: 3,
  emergency: 3,
};

export const SEASON_FREE_AGENCY_WINDOW_MAX_CANDIDATES = 12;

export const SEASON_FREE_AGENCY_WINDOW_BLOCK_INDEXES: readonly number[] = [2, 4, 6];

export function freeAgencySeed(rootSeed: string, ...keys: string[]): string {
  return seasonNamespaceSeed(rootSeed, SEASON_SEED_NAMESPACES.freeAgency, ...keys);
}

export interface SeasonFreeAgencyScoreMember extends SeasonScoreMember {
  playerVersionId: string;
}

export interface SeasonFreeAgencyContext {
  run: SeasonRun;
  effects: SeasonEffectsState;

  catalog: SeasonDraftCatalog;

  index: SeasonFreeAgencyIndex;

  targets?: SeasonRosterTargets;

  humanFranchiseId: string | null;
}

export interface SeasonFreeAgencyWindowOpenResult {
  freeAgency: SeasonFreeAgencyState;
  window: SeasonFreeAgencyWindowState;
}

export function seasonFreeAgencyUniverseOf(
  run: SeasonRun,
  index: SeasonFreeAgencyIndex,
): Map<string, SeasonFreeAgencyIndexEntry[]> {
  const ownedVersions = new Set(run.ownership.map((row) => row.playerVersionId));
  const representedIdentities = new Set(
    run.rosters.flatMap((roster) => roster.players.map((p) => p.playerId)),
  );
  const signedVersions = new Set(
    run.freeAgency.windows.flatMap((window) =>
      window.signings.map((signing) => signing.playerVersionId),
    ),
  );
  const universe = new Map<string, SeasonFreeAgencyIndexEntry[]>();
  for (const entry of index.candidates) {
    if (representedIdentities.has(entry.playerId)) continue;
    if (ownedVersions.has(entry.playerVersionId)) continue;
    if (signedVersions.has(entry.playerVersionId)) continue;
    const group = universe.get(entry.playerId);
    if (group === undefined) {
      universe.set(entry.playerId, [entry]);
    } else {
      group.push(entry);
    }
  }
  for (const group of universe.values()) {
    group.sort((a, b) => (a.playerVersionId < b.playerVersionId ? -1 : 1));
  }
  return universe;
}

export function canonicalFreeAgencyIdentity(
  rootSeed: string,
  windowIndex: number,
  playerId: string,
  entries: readonly SeasonFreeAgencyIndexEntry[],
): SeasonFreeAgencyIndexEntry {
  if (entries.length === 0) {
    throw new Error(`free agency: no eligible versions for identity ${playerId}`);
  }
  if (entries.length === 1) return entries[0] as SeasonFreeAgencyIndexEntry;
  const bandOrder: Record<SeasonFreeAgencyBand, number> = {
    featured: 0,
    role: 1,
    development: 2,
    emergency: 3,
  };
  const completenessOf = (entry: SeasonFreeAgencyIndexEntry): number => {
    let complete = 0;
    if (entry.positions.playable.length > 0) complete += 1;
    if (entry.strengths.length > 0) complete += 1;
    if (entry.availability.healthy) complete += 1;
    if (entry.minutesPerGame > 0) complete += 1;
    return complete;
  };
  const seed = freeAgencySeed(rootSeed, String(windowIndex), 'canonical', playerId);
  const scored = entries.map((entry) => ({
    entry,
    completeness: completenessOf(entry),
    bandRank: bandOrder[entry.band],
    roleBreadth: entry.supportedRoles.length,
    healthy: entry.availability.healthy ? 1 : 0,
    seedValue: freeAgencySeed(seed, entry.playerVersionId),
  }));
  scored.sort((a, b) => {
    if (a.completeness !== b.completeness) return b.completeness - a.completeness;
    if (a.bandRank !== b.bandRank) return a.bandRank - b.bandRank;
    if (a.roleBreadth !== b.roleBreadth) return b.roleBreadth - a.roleBreadth;
    if (a.healthy !== b.healthy) return b.healthy - a.healthy;
    if (a.seedValue !== b.seedValue) return a.seedValue < b.seedValue ? -1 : 1;
    return a.entry.playerVersionId < b.entry.playerVersionId ? -1 : 1;
  });
  const best = scored[0];
  if (best === undefined) throw new Error(`free agency: no canonical version for ${playerId}`);
  return best.entry;
}

export function composeSeasonFreeAgencyWindow(
  context: SeasonFreeAgencyContext,
  windowIndex: number,
): SeasonFreeAgencyCandidate[] {
  const { run, index } = context;
  const universe = seasonFreeAgencyUniverseOf(run, index);
  const canonicalById = new Map<string, SeasonFreeAgencyCanonical>();
  for (const canonical of Object.values(run.freeAgency.canonicalCandidates)) {
    canonicalById.set(canonical.playerId, canonical);
  }
  const candidates: SeasonFreeAgencyCandidate[] = [];
  for (const band of ['featured', 'role', 'development', 'emergency'] as const) {
    const target = SEASON_FREE_AGENCY_WINDOW_COMPOSITION[band];
    const groups: Array<{ playerId: string; entry: SeasonFreeAgencyIndexEntry }> = [];
    for (const [playerId, entries] of universe) {
      const canonical = canonicalById.get(playerId);
      let entry: SeasonFreeAgencyIndexEntry | undefined;
      if (canonical !== undefined) {
        entry = entries.find(
          (candidate) => candidate.playerVersionId === canonical.playerVersionId,
        );
      }
      if (entry === undefined) {
        entry = canonicalFreeAgencyIdentity(run.rootSeed, windowIndex, playerId, entries);
      }
      if (entry.band === band) {
        groups.push({ playerId, entry });
      }
    }
    const seedOf = (groupId: { playerId: string }): string =>
      freeAgencySeed(run.rootSeed, String(windowIndex), 'composition', band, groupId.playerId);
    groups.sort((a, b) => {
      const seedA = seedOf(a);
      const seedB = seedOf(b);
      if (seedA !== seedB) return seedA < seedB ? -1 : 1;
      return a.entry.playerVersionId < b.entry.playerVersionId ? -1 : 1;
    });
    for (const group of groups.slice(0, target)) {
      candidates.push(entryToCandidate(group.entry));
    }
  }
  if (candidates.length > SEASON_FREE_AGENCY_WINDOW_MAX_CANDIDATES) {
    throw new Error(
      `free agency: window exceeds ${String(SEASON_FREE_AGENCY_WINDOW_MAX_CANDIDATES)} candidates`,
    );
  }
  return candidates;
}

function entryToCandidate(entry: SeasonFreeAgencyIndexEntry): SeasonFreeAgencyCandidate {
  return {
    playerVersionId: entry.playerVersionId,
    playerId: entry.playerId,
    displayName: entry.displayName,
    positions: entry.positions,
    band: entry.band,
    minimumInfluence: entry.minimumInfluence,
    supportedRoles: entry.supportedRoles,
    strengths: entry.strengths,
    limitations: entry.limitations,
    durabilityRating: entry.durabilityRating,
    minutesPerGame: entry.minutesPerGame,
    availability: entry.availability,
    catalogRef: entry.catalogRef,
    derivationEvidence: entry.derivationEvidence,
    exclusionEvidence: entry.exclusionEvidence,
  };
}

export function openSeasonFreeAgencyWindow(
  context: SeasonFreeAgencyContext,
  windowIndex: number,
  blockIndex: number,
): SeasonFreeAgencyWindowOpenResult {
  if (!SEASON_FREE_AGENCY_WINDOW_BLOCK_INDEXES.includes(blockIndex)) {
    throw new Error(`free agency: window cannot open after block ${String(blockIndex)}`);
  }
  const { run } = context;
  if (run.freeAgency.windows.some((window) => window.windowIndex === windowIndex)) {
    throw new Error(`free agency: window ${String(windowIndex)} already opened`);
  }
  const candidates = composeSeasonFreeAgencyWindow(context, windowIndex);

  const canonicalCandidates: Record<string, SeasonFreeAgencyCanonical> = {
    ...run.freeAgency.canonicalCandidates,
  };
  for (const candidate of candidates) {
    if (canonicalCandidates[candidate.playerId] !== undefined) continue;
    canonicalCandidates[candidate.playerId] = {
      playerId: candidate.playerId,
      playerVersionId: candidate.playerVersionId,
      band: candidate.band,
      admittedWindowIndex: windowIndex,
      seedPath: [String(windowIndex), 'canonical', candidate.playerId],
    };
  }

  const declarations: Record<string, SeasonFreeAgencyDeclaration> = {};
  for (const team of run.league.teams) {
    if (team.franchiseId === context.humanFranchiseId) continue;
    declarations[team.franchiseId] = aiDeclarationOf(
      context,
      windowIndex,
      team.franchiseId,
      candidates,
    );
  }

  const window: SeasonFreeAgencyWindowState = {
    windowIndex,
    blockIndex,
    status: 'open',
    candidates,
    declarations,
    traces: [],
    signings: [],
  };
  return {
    freeAgency: {
      ...run.freeAgency,
      windows: [...run.freeAgency.windows, window],
      canonicalCandidates,
    },
    window,
  };
}

export function freeAgencyUnresolvedWindowIndex(freeAgency: SeasonFreeAgencyState): number | null {
  for (const window of freeAgency.windows) {
    if (window.status === 'open') return window.windowIndex;
  }
  return null;
}

function aiDeclarationOf(
  context: SeasonFreeAgencyContext,
  windowIndex: number,
  franchiseId: string,
  candidates: SeasonFreeAgencyCandidate[],
): SeasonFreeAgencyDeclaration {
  const { run } = context;
  const assignment = run.aiAssignments.find((entry) => entry.franchiseId === franchiseId);
  const band = assignment?.band ?? 'average';
  const identity = assignment?.identity ?? 'continuity';
  const bandCap = SEASON_FREE_AGENCY_BAND_SIGNING_CAPS[band] ?? 3;
  const signingCount = run.freeAgency.signingCounts[franchiseId] ?? 0;
  const seasonSpend = run.freeAgency.seasonSpend[franchiseId] ?? 0;
  const roster = run.rosters.find((entry) => entry.franchiseId === franchiseId);
  const rosterSize = roster?.players.length ?? 10;
  if (signingCount >= bandCap || rosterSize >= SEASON_ROSTER_MAX_SIZE || seasonSpend >= 6) {
    return {
      franchiseId,
      windowIndex,
      commandId: syntheticCommandId(run.rootSeed, windowIndex, franchiseId),
      targets: [],
    };
  }

  const allowed = candidates.filter((candidate) => {
    if (roster?.players.some((player) => player.playerId === candidate.playerId)) return false;
    const membership = memberOfCandidate(context, candidate);
    if (membership === null) return false;
    const legal = rosterLegalWithCandidate(context, roster, membership);
    if (!legal) return false;
    if (seasonSpend + candidate.minimumInfluence > 6) return false;
    return aiWithinStrengthCeiling(context, franchiseId, band, membership);
  });
  if (allowed.length === 0) {
    return {
      franchiseId,
      windowIndex,
      commandId: syntheticCommandId(run.rootSeed, windowIndex, franchiseId),
      targets: [],
    };
  }

  const ranked = allowed
    .map((candidate) => ({
      candidate,
      need: needTierOf(context, franchiseId, candidate),
      fit: identityFitOf(context, franchiseId, identity, candidate),
      opportunity: opportunityOf(context, franchiseId, identity, candidate),
    }))
    .sort((a, b) => {
      const needRank = (tier: string) => (tier === 'high' ? 0 : tier === 'medium' ? 1 : 2);
      if (needRank(a.need) !== needRank(b.need)) return needRank(a.need) - needRank(b.need);
      const fitRank = (fit: string) => (fit === 'fits' ? 0 : fit === 'neutral' ? 1 : 2);
      if (fitRank(a.fit) !== fitRank(b.fit)) return fitRank(a.fit) - fitRank(b.fit);
      const oppRank = (opp: string) => (opp === 'immediate' ? 0 : opp === 'available' ? 1 : 2);
      if (oppRank(a.opportunity) !== oppRank(b.opportunity))
        return oppRank(a.opportunity) - oppRank(b.opportunity);
      if (a.candidate.minimumInfluence !== b.candidate.minimumInfluence) {
        return a.candidate.minimumInfluence - b.candidate.minimumInfluence;
      }
      return a.candidate.playerVersionId < b.candidate.playerVersionId ? -1 : 1;
    });

  const targets: SeasonFreeAgencyTarget[] = [];
  let committed = seasonSpend;
  for (const rankedEntry of ranked.slice(0, 2)) {
    if (committed >= 6) break;
    const influence = Math.min(
      Math.max(rankedEntry.candidate.minimumInfluence, 1),
      3,
      6 - committed,
    );
    if (influence < rankedEntry.candidate.minimumInfluence) break;
    const expectation = supportedExpectationFor(
      context,
      franchiseId,
      identity,
      rankedEntry.candidate,
      rankedEntry.opportunity,
    );
    targets.push({
      playerVersionId: rankedEntry.candidate.playerVersionId,
      roleExpectation: expectation,
      influence,
    });
    committed += influence;
  }
  return {
    franchiseId,
    windowIndex,
    commandId: syntheticCommandId(run.rootSeed, windowIndex, franchiseId),
    targets,
  };
}

function syntheticCommandId(rootSeed: string, windowIndex: number, franchiseId: string): string {
  return `fa-ai-${freeAgencySeed(rootSeed, String(windowIndex), 'ai', franchiseId).slice(0, 32)}`;
}

function supportedExpectationFor(
  context: SeasonFreeAgencyContext,
  franchiseId: string,
  identity: string,
  candidate: SeasonFreeAgencyCandidate,
  opportunity: string,
): SeasonFreeAgencyRoleExpectation {
  const rotationEligible =
    candidate.supportedRoles.includes('rotation') && opportunity !== 'crowded';
  if (rotationEligible) return 'rotation';
  const emergencyEligible =
    candidate.supportedRoles.includes('emergency') &&
    emergencyRepairsRotation(context, franchiseId, candidate);
  if (emergencyEligible) return 'emergency';
  if (candidate.supportedRoles.includes('depth')) return 'depth';
  return 'depth';
}

function rosterLegalWithCandidate(
  context: SeasonFreeAgencyContext,
  roster: SeasonRosterLike | undefined,
  membership: SeasonRosterMemberInput,
): boolean {
  const members = rosterMembers(context, roster);
  members.push(membership);
  if (members.length > SEASON_ROSTER_MAX_SIZE) return false;
  return legalFiveExists(members) && legalFiveAfterAnyRemoval(members);
}

interface SeasonRosterLike {
  players: SeasonRosterEntry[];
}

function rosterMembers(
  context: SeasonFreeAgencyContext,
  roster: SeasonRosterLike | undefined,
): SeasonRosterMemberInput[] {
  const members: SeasonRosterMemberInput[] = [];
  const catalogIndex = catalogCandidateIndex(context);
  for (const player of roster?.players ?? []) {
    const candidate = catalogIndex.get(player.playerVersionId);
    if (candidate !== undefined) {
      members.push({
        playerVersionId: player.playerVersionId,
        playable: candidate.positions.playable,
      });
    }
  }
  return members;
}

function catalogCandidateIndex(
  context: SeasonFreeAgencyContext,
): Map<string, { positions: SeasonDraftCatalog['candidates'][number]['positions'] }> {
  const map = new Map<
    string,
    { positions: SeasonDraftCatalog['candidates'][number]['positions'] }
  >();
  for (const candidate of context.catalog.candidates) {
    map.set(candidate.playerVersionId, { positions: candidate.positions });
  }
  return map;
}

function memberOfCandidate(
  context: SeasonFreeAgencyContext,
  candidate: SeasonFreeAgencyCandidate,
): SeasonRosterMemberInput | null {
  const catalogCandidate = context.catalog.candidates[candidate.catalogRef.candidateIndex];
  if (
    catalogCandidate === undefined ||
    catalogCandidate.playerVersionId !== candidate.playerVersionId
  ) {
    return null;
  }
  return {
    playerVersionId: candidate.playerVersionId,
    playable: catalogCandidate.positions.playable,
  };
}

function aiWithinStrengthCeiling(
  context: SeasonFreeAgencyContext,
  franchiseId: string,
  band: string,
  membership: SeasonRosterMemberInput,
): boolean {
  const caps = context.targets?.policy.bandPoolScoreCaps ?? FALLBACK_BAND_POOL_SCORE_CAPS;
  const cap = caps[band as keyof typeof caps];
  const maxOutliers =
    context.targets?.policy.maxRosterStrengthOutliers ?? FALLBACK_MAX_ROSTER_STRENGTH_OUTLIERS;
  const assignment = context.run.aiAssignments.find((entry) => entry.franchiseId === franchiseId);
  const identity = assignment?.identity ?? 'continuity';
  const roster = context.run.rosters.find((entry) => entry.franchiseId === franchiseId);
  const members = scoreMembersOf(context, roster);
  const currentStrength = maxRoleCoverageIdentityScore(members, identity);
  if (currentStrength > cap) return false;
  const rosterOutliers = members.filter(
    (member) => identityScore(roleScoresOf(member), identity) > cap,
  ).length;
  const candidateOutlier =
    identityScore(roleScoresOf(membershipToMember(membership, context)), identity) > cap;
  if (currentStrength <= cap && !candidateOutlier) return true;
  const signingCount = context.run.freeAgency.signingCounts[franchiseId] ?? 0;
  if (signingCount > 0) return false;
  return rosterOutliers + (candidateOutlier ? 1 : 0) <= maxOutliers;
}

function scoreMembersOf(
  context: SeasonFreeAgencyContext,
  roster: SeasonRosterLike | undefined,
): SeasonFreeAgencyScoreMember[] {
  const members: SeasonFreeAgencyScoreMember[] = [];
  for (const player of roster?.players ?? []) {
    const candidate = context.catalog.candidates.find(
      (entry) => entry.playerVersionId === player.playerVersionId,
    );
    if (candidate !== undefined) {
      members.push({
        playerVersionId: candidate.playerVersionId,
        detailedRatings: candidate.detailedRatings,
        tendencies: candidate.tendencies,
        overall: candidate.summaryRatings.overallRating,
      });
    }
  }
  return members;
}

function maxRoleCoverageIdentityScore(
  members: readonly SeasonFreeAgencyScoreMember[],
  identity: Parameters<typeof identityScore>[1],
): number {
  const coverage: Record<SeasonRosterRole, number> = {
    'primary-creation': 0,
    'secondary-creation': 0,
    'perimeter-shooting': 0,
    'rim-finishing-interior-scoring': 0,
    'perimeter-defense': 0,
    'interior-defense': 0,
    'offensive-rebounding': 0,
    'defensive-rebounding': 0,
  };
  for (const member of members) {
    const scores = roleScoresOf(member);
    for (const role of ROSTER_ROLES) {
      coverage[role] = Math.max(coverage[role], scores[role]);
    }
  }
  return identityScore(coverage, identity);
}

function membershipToMember(
  membership: SeasonRosterMemberInput,
  context: SeasonFreeAgencyContext,
): SeasonFreeAgencyScoreMember {
  const candidate = context.catalog.candidates.find(
    (entry) => entry.playerVersionId === membership.playerVersionId,
  );
  if (candidate === undefined) {
    throw new Error(`free agency: no catalog candidate for ${membership.playerVersionId}`);
  }
  return {
    playerVersionId: candidate.playerVersionId,
    detailedRatings: candidate.detailedRatings,
    tendencies: candidate.tendencies,
    overall: candidate.summaryRatings.overallRating,
  };
}

function needTierOf(
  context: SeasonFreeAgencyContext,
  franchiseId: string,
  candidate: SeasonFreeAgencyCandidate,
): 'high' | 'medium' | 'low' {
  const roster = context.run.rosters.find((entry) => entry.franchiseId === franchiseId);
  const currentRoles = rosterRoleCoverage(context, roster);
  const candidateScores = candidateRoleScores(context, candidate);
  let newlyCovered = 0;
  for (const role of ROSTER_ROLES) {
    const score = candidateScores[role];
    if (score >= ROLE_COVERAGE_THRESHOLD && !(currentRoles[role] >= ROLE_COVERAGE_THRESHOLD)) {
      newlyCovered += 1;
    }
  }
  if (newlyCovered >= 2) return 'high';
  if (newlyCovered === 1) return 'medium';
  return 'low';
}

function rosterRoleCoverage(
  context: SeasonFreeAgencyContext,
  roster: SeasonRosterLike | undefined,
): Record<SeasonRosterRole, number> {
  const coverage: Record<SeasonRosterRole, number> = {
    'primary-creation': 0,
    'secondary-creation': 0,
    'perimeter-shooting': 0,
    'rim-finishing-interior-scoring': 0,
    'perimeter-defense': 0,
    'interior-defense': 0,
    'offensive-rebounding': 0,
    'defensive-rebounding': 0,
  };
  for (const member of scoreMembersOf(context, roster)) {
    const scores = roleScoresOf(member);
    for (const role of ROSTER_ROLES) {
      coverage[role] = Math.max(coverage[role], scores[role]);
    }
  }
  return coverage;
}

function candidateRoleScores(
  context: SeasonFreeAgencyContext,
  candidate: SeasonFreeAgencyCandidate,
): Record<SeasonRosterRole, number> {
  const catalogCandidate = context.catalog.candidates[candidate.catalogRef.candidateIndex];
  if (
    catalogCandidate === undefined ||
    catalogCandidate.playerVersionId !== candidate.playerVersionId
  ) {
    throw new Error(`free agency: missing catalog candidate ${candidate.playerVersionId}`);
  }
  return roleScoresOf({
    detailedRatings: catalogCandidate.detailedRatings,
    tendencies: catalogCandidate.tendencies,
    overall: catalogCandidate.summaryRatings.overallRating,
  });
}

function identityFitOf(
  context: SeasonFreeAgencyContext,
  franchiseId: string,
  identity: string,
  candidate: SeasonFreeAgencyCandidate,
): 'fits' | 'neutral' | 'misfit' {
  if (franchiseId === context.humanFranchiseId) return 'neutral';
  const priorityRoles = priorityRolesOf(context, identity);
  const scores = candidateRoleScores(context, candidate);
  let matched = 0;
  for (const role of priorityRoles) {
    if (scores[role] >= ROLE_COVERAGE_THRESHOLD) matched += 1;
  }
  if (matched >= 2) return 'fits';
  if (matched === 1) return 'neutral';
  return 'misfit';
}

function priorityRolesOf(
  context: SeasonFreeAgencyContext,
  identity: string,
): readonly SeasonRosterRole[] {
  const policy = (
    context.targets?.policy as unknown as
      { identityPriorityRoles?: Record<string, SeasonRosterRole[]> } | undefined
  )?.identityPriorityRoles;
  const roles = policy?.[identity as 'star-chaser'];
  if (roles !== undefined && roles.length > 0) return roles;
  const fallback: Record<string, readonly SeasonRosterRole[]> = {
    'star-chaser': ['primary-creation', 'secondary-creation', 'rim-finishing-interior-scoring'],
    'shooting-first': ['perimeter-shooting'],
    'defense-first': ['perimeter-defense', 'interior-defense'],
    'depth-builder': ROSTER_ROLES,
    continuity: ROSTER_ROLES,
    'active-trader': ROSTER_ROLES,
  };
  return fallback[identity] ?? ROSTER_ROLES;
}

function opportunityOf(
  context: SeasonFreeAgencyContext,
  franchiseId: string,
  identity: string,
  candidate: SeasonFreeAgencyCandidate,
): 'immediate' | 'available' | 'crowded' {
  const roster = context.run.rosters.find((entry) => entry.franchiseId === franchiseId);
  const members = scoreMembersOf(context, roster);
  const candidateMember = membershipToMember(
    { playerVersionId: candidate.playerVersionId, playable: candidate.positions.playable },
    context,
  );
  members.push(candidateMember);
  members.sort((a, b) => {
    const identityKey = identity as Parameters<typeof identityScore>[1];
    const scoreA = identityScore(roleScoresOf(a), identityKey);
    const scoreB = identityScore(roleScoresOf(b), identityKey);
    if (scoreA !== scoreB) return scoreB - scoreA;
    return a.playerVersionId < b.playerVersionId ? -1 : 1;
  });
  const rank = members.findIndex((member) => member.playerVersionId === candidate.playerVersionId);
  if (rank === -1) return 'crowded';
  if (rank < 8) return 'immediate';
  if (rank < 10) return 'available';
  return 'crowded';
}

function emergencyRepairsRotation(
  context: SeasonFreeAgencyContext,
  franchiseId: string,
  candidate: SeasonFreeAgencyCandidate,
): boolean {
  const rotation = context.run.rotations.find((entry) => entry.franchiseId === franchiseId);
  if (rotation === undefined) return false;
  const rotationIds = [...rotation.starters, ...rotation.benchOrder];
  const anyUnavailable = rotationIds.some((id) => !seasonPlayerAvailable(context.run.health, id));
  if (!anyUnavailable) return false;
  return candidate.availability.healthy;
}

export function applyFreeAgencyDeclaration(
  run: SeasonRun,
  windowIndex: number,
  franchiseId: string,
  commandId: string,
  targets: SeasonFreeAgencyTarget[],
): SeasonFreeAgencyState {
  const window = run.freeAgency.windows.find((entry) => entry.windowIndex === windowIndex);
  if (window === undefined) {
    throw new FreeAgencyValidationRejection({
      code: 'free-agency-window-not-open',
      franchiseId,
      windowIndex,
    });
  }
  if (window.status === 'resolved') {
    throw new FreeAgencyValidationRejection({
      code: 'free-agency-already-resolved',
      windowIndex,
    });
  }
  if (window.declarations[franchiseId] !== undefined) {
    throw new FreeAgencyValidationRejection({
      code: 'free-agency-already-declared',
      franchiseId,
      windowIndex,
    });
  }
  const roster = run.rosters.find((entry) => entry.franchiseId === franchiseId);
  if (targets.length > 0) {
    const seen = new Set<string>();
    for (const target of targets) {
      if (seen.has(target.playerVersionId)) {
        throw new FreeAgencyValidationRejection({
          code: 'free-agency-invalid-priority',
          playerVersionId: target.playerVersionId,
        });
      }
      seen.add(target.playerVersionId);
      const candidate = window.candidates.find(
        (entry) => entry.playerVersionId === target.playerVersionId,
      );
      if (candidate === undefined) {
        throw new FreeAgencyValidationRejection({
          code: 'free-agency-target-ineligible',
          windowIndex,
          playerVersionId: target.playerVersionId,
        });
      }
      if (roster?.players.some((player) => player.playerId === candidate.playerId)) {
        throw new FreeAgencyValidationRejection({
          code: 'free-agency-duplicate-identity',
          playerId: candidate.playerId,
          playerVersionId: candidate.playerVersionId,
        });
      }
      if (!candidate.supportedRoles.includes(target.roleExpectation)) {
        throw new FreeAgencyValidationRejection({
          code: 'free-agency-unsupported-role',
          playerVersionId: target.playerVersionId,
          roleExpectation: target.roleExpectation,
          supportedRoles: candidate.supportedRoles,
        });
      }
      if (target.influence < candidate.minimumInfluence || target.influence > 3) {
        throw new FreeAgencyValidationRejection({
          code: 'free-agency-invalid-influence',
          playerVersionId: target.playerVersionId,
          influence: target.influence,
          minimum: candidate.minimumInfluence,
        });
      }
    }
    if (roster !== undefined && roster.players.length >= SEASON_ROSTER_MAX_SIZE) {
      throw new FreeAgencyValidationRejection({
        code: 'free-agency-roster-cap',
        franchiseId,
        rosterSize: roster.players.length,
      });
    }
    const signingCount = run.freeAgency.signingCounts[franchiseId] ?? 0;
    if (signingCount >= 3) {
      throw new FreeAgencyValidationRejection({
        code: 'free-agency-season-signing-cap',
        franchiseId,
        signingCount,
      });
    }
    const seasonSpend = run.freeAgency.seasonSpend[franchiseId] ?? 0;
    const commitment = targets.reduce((sum, target) => sum + target.influence, 0);
    if (seasonSpend + commitment > 6) {
      throw new FreeAgencyValidationRejection({
        code: 'free-agency-season-influence-cap',
        franchiseId,
        seasonSpend,
      });
    }
    const balance = run.influence.balances[franchiseId] ?? 0;
    const maximum = Math.max(...targets.map((target) => target.influence));
    if (balance < maximum || balance < SEASON_INFLUENCE_FLOOR + maximum) {
      throw new FreeAgencyValidationRejection({
        code: 'free-agency-insufficient-balance',
        franchiseId,
        balance,
        required: maximum,
      });
    }
  }
  const declaration: SeasonFreeAgencyDeclaration = {
    franchiseId,
    windowIndex,
    commandId,
    targets,
  };
  return {
    ...run.freeAgency,
    windows: run.freeAgency.windows.map((entry) =>
      entry.windowIndex === windowIndex
        ? { ...entry, declarations: { ...entry.declarations, [franchiseId]: declaration } }
        : entry,
    ),
  };
}

export function applyFreeAgencySkip(
  run: SeasonRun,
  windowIndex: number,
  franchiseId: string,
  commandId: string,
): SeasonFreeAgencyState {
  return applyFreeAgencyDeclaration(run, windowIndex, franchiseId, commandId, []);
}

export class FreeAgencyValidationRejection extends Error {
  readonly rejection: SeasonFreeAgencyRejectionLike;
  constructor(rejection: SeasonFreeAgencyRejectionLike) {
    super(`free agency validation failed: ${rejection.code}`);
    this.name = 'FreeAgencyValidationRejection';
    this.rejection = rejection;
  }
}

type SeasonFreeAgencyRejectionLike = { code: string } & Record<string, unknown>;

export interface SeasonFreeAgencyResolutionResult {
  freeAgency: SeasonFreeAgencyState;
  signings: SeasonFreeAgencySigning[];
  traces: SeasonFreeAgencyResolutionTrace[];
  effects: SeasonEffectsState;
  influence: SeasonInfluenceState;
  transactions: SeasonTransactionEntry[];

  rosters: SeasonRun['rosters'];

  ownership: SeasonOwnership[];
}

export function resolveSeasonFreeAgencyWindow(
  context: SeasonFreeAgencyContext,
  windowIndex: number,
  commandId: string,
): SeasonFreeAgencyResolutionResult {
  const { run } = context;
  const windowIndexEntry = run.freeAgency.windows.find(
    (entry) => entry.windowIndex === windowIndex,
  );
  if (windowIndexEntry === undefined) {
    throw new FreeAgencyValidationRejection({
      code: 'free-agency-window-not-open',
      franchiseId: null,
      windowIndex,
    });
  }
  if (windowIndexEntry.status === 'resolved') {
    throw new FreeAgencyValidationRejection({ code: 'free-agency-already-resolved', windowIndex });
  }
  const controlledFranchises = run.league.teams
    .map((team) => team.franchiseId)
    .filter((franchiseId) => franchiseId === context.humanFranchiseId);
  for (const franchiseId of controlledFranchises) {
    if (windowIndexEntry.declarations[franchiseId] === undefined) {
      throw new FreeAgencyValidationRejection({
        code: 'free-agency-pending-declaration',
        franchiseId,
        windowIndex,
      });
    }
  }

  const candidates = windowIndexEntry.candidates;
  const declarations = windowIndexEntry.declarations;
  const signedVersions = new Set<string>();
  const signedFranchises = new Set<string>();
  const signings: SeasonFreeAgencySigning[] = [];
  const steps: SeasonFreeAgencyTraceStep[] = [];
  const firstWinners: Array<{ candidatePlayerVersionId: string; winnerFranchiseId: string }> = [];
  const secondWinners: Array<{ candidatePlayerVersionId: string; winnerFranchiseId: string }> = [];

  const firstTargetOf = (franchiseId: string): SeasonFreeAgencyTarget | undefined =>
    declarations[franchiseId]?.targets[0];
  const secondTargetOf = (franchiseId: string): SeasonFreeAgencyTarget | undefined =>
    declarations[franchiseId]?.targets[1];

  for (const candidate of [...candidates].sort((a, b) =>
    a.playerVersionId < b.playerVersionId ? -1 : 1,
  )) {
    const claims = Object.keys(declarations)
      .filter((franchiseId) => {
        const target = firstTargetOf(franchiseId);
        return target?.playerVersionId === candidate.playerVersionId;
      })
      .sort();
    if (claims.length === 0) continue;
    const winner = pickWinner(context, windowIndex, candidate, claims, steps);
    if (winner !== null) {
      const declaration = declarations[winner];
      const target = firstTargetOf(winner);
      if (declaration !== undefined && target !== undefined) {
        const signing = applySigning(
          context,
          windowIndexEntry.blockIndex,
          windowIndex,
          commandId,
          winner,
          target,
          candidate,
        );
        signings.push(signing);
        signedVersions.add(candidate.playerVersionId);
        signedFranchises.add(winner);
        firstWinners.push({
          candidatePlayerVersionId: candidate.playerVersionId,
          winnerFranchiseId: winner,
        });
      }
    }
  }

  const remaining = Object.keys(declarations)
    .filter((franchiseId) => !signedFranchises.has(franchiseId))
    .sort();
  for (const candidate of [...candidates].sort((a, b) =>
    a.playerVersionId < b.playerVersionId ? -1 : 1,
  )) {
    if (signedVersions.has(candidate.playerVersionId)) continue;
    const claims = remaining.filter((franchiseId) => {
      const target = secondTargetOf(franchiseId);
      return target?.playerVersionId === candidate.playerVersionId;
    });
    if (claims.length === 0) continue;
    const winner = pickWinner(context, windowIndex, candidate, claims, steps);
    if (winner !== null) {
      const declaration = declarations[winner];
      const target = secondTargetOf(winner);
      if (declaration !== undefined && target !== undefined) {
        const signing = applySigning(
          context,
          windowIndexEntry.blockIndex,
          windowIndex,
          commandId,
          winner,
          target,
          candidate,
        );
        signings.push(signing);
        signedVersions.add(candidate.playerVersionId);
        signedFranchises.add(winner);
        secondWinners.push({
          candidatePlayerVersionId: candidate.playerVersionId,
          winnerFranchiseId: winner,
        });
      }
    }
  }

  const trace: SeasonFreeAgencyResolutionTrace = {
    windowIndex,
    seedPath: [String(windowIndex), 'resolve'],
    steps,
    firstPriorityWinners: firstWinners,
    secondPriorityWinners: secondWinners,
    signingFranchiseId: signings.length > 0 ? (signings[0]?.franchiseId ?? null) : null,
    signedPlayerVersionId: signings.length > 0 ? (signings[0]?.playerVersionId ?? null) : null,
    resolution: signings.length > 0 ? 'signed' : 'no-signing',
  };

  let effects = context.effects;
  let influence = context.run.influence;
  let transactions = [...context.run.transactions];
  let freeAgency = {
    ...context.run.freeAgency,
    signingCounts: { ...context.run.freeAgency.signingCounts },
    seasonSpend: { ...context.run.freeAgency.seasonSpend },
  };
  let rosters = context.run.rosters.map((roster) => ({ ...roster, players: [...roster.players] }));
  const ownership = [...context.run.ownership];
  const resolvedSignings: SeasonFreeAgencySigning[] = [];
  for (const signing of signings) {
    const outcome = applySigningFacts(
      context,
      effects,
      influence,
      transactions,
      freeAgency,
      signing,
    );
    resolvedSignings.push(outcome.signing);
    effects = outcome.effects;
    influence = outcome.influence;
    transactions = outcome.transactions;
    freeAgency = outcome.freeAgency;
    rosters = rosters.map((roster) =>
      roster.franchiseId === signing.franchiseId
        ? { ...roster, players: [...roster.players, rosterEntryOf(context, signing)] }
        : roster,
    );
    ownership.push({
      playerVersionId: signing.playerVersionId,
      ownerFranchiseId: signing.franchiseId,
    });
  }
  ownership.sort((a, b) => (a.playerVersionId < b.playerVersionId ? -1 : 1));
  freeAgency = {
    ...freeAgency,
    windows: freeAgency.windows.map((entry) =>
      entry.windowIndex === windowIndex
        ? { ...entry, status: 'resolved' as const, traces: [trace], signings: [...resolvedSignings] }
        : entry,
    ),
  };
  return {
    freeAgency,
    signings: resolvedSignings,
    traces: [trace],
    effects,
    influence,
    transactions,
    rosters,
    ownership,
  };
}

function pickWinner(
  context: SeasonFreeAgencyContext,
  windowIndex: number,
  candidate: SeasonFreeAgencyCandidate,
  claims: string[],
  steps: SeasonFreeAgencyTraceStep[],
): string | null {
  let winner: string | null = null;
  for (const franchiseId of claims) {
    if (winner === null) {
      const legal = claimLegal(context, franchiseId, candidate, steps);
      if (legal) winner = franchiseId;
      continue;
    }
    const comparison = compareClaims(context, windowIndex, candidate, winner, franchiseId, steps);
    if (comparison > 0) winner = franchiseId;
  }
  if (winner === null) return null;

  if (!claimLegal(context, winner, candidate, [])) return null;
  return winner;
}

function claimLegal(
  context: SeasonFreeAgencyContext,
  franchiseId: string,
  candidate: SeasonFreeAgencyCandidate,
  steps: SeasonFreeAgencyTraceStep[],
): boolean {
  const roster = context.run.rosters.find((entry) => entry.franchiseId === franchiseId);
  const reasons: string[] = [];
  if (roster !== undefined && roster.players.length >= SEASON_ROSTER_MAX_SIZE) {
    reasons.push(`roster at capacity (${String(roster.players.length)})`);
  }
  if (roster?.players.some((player) => player.playerId === candidate.playerId)) {
    reasons.push('identity already represented');
  }
  if (context.run.ownership.some((row) => row.playerVersionId === candidate.playerVersionId)) {
    reasons.push('version already owned');
  }
  if (reasons.length === 0) {
    const membership = memberOfCandidate(context, candidate);
    if (membership !== null && !rosterLegalWithCandidate(context, roster, membership)) {
      reasons.push('no legal rotation subset after signing');
    }
  }
  steps.push({
    candidatePlayerVersionId: candidate.playerVersionId,
    franchiseId,
    criterion: 'legality',
    category: reasons.length === 0 ? 'legal' : 'illegal',
    citedFacts:
      reasons.length > 0 ? reasons.slice(0, 8) : ['roster capacity and identity checks passed'],
  });
  return reasons.length === 0;
}

function compareClaims(
  context: SeasonFreeAgencyContext,
  windowIndex: number,
  candidate: SeasonFreeAgencyCandidate,
  a: string,
  b: string,
  steps: SeasonFreeAgencyTraceStep[],
): number {
  const aLegal = claimLegal(context, a, candidate, steps);
  const bLegal = claimLegal(context, b, candidate, steps);
  if (aLegal !== bLegal) {
    steps.push({
      candidatePlayerVersionId: candidate.playerVersionId,
      franchiseId: b,
      criterion: 'legality',
      category: bLegal ? 'legal' : 'illegal',
      citedFacts: [bLegal ? 'claim is legal' : 'claim is illegal'],
    });
    return bLegal ? 1 : -1;
  }

  const aRole = roleCredibilityOf(context, a, candidate);
  const bRole = roleCredibilityOf(context, b, candidate);
  const roleRank = (credibility: string) =>
    credibility === 'rotation'
      ? 0
      : credibility === 'emergency'
        ? 1
        : credibility === 'depth'
          ? 2
          : 3;
  steps.push({
    candidatePlayerVersionId: candidate.playerVersionId,
    franchiseId: b,
    criterion: 'role-credibility',
    category: bRole,
    citedFacts: [`credibility ${bRole} (opponent ${aRole})`],
  });
  if (roleRank(bRole) !== roleRank(aRole)) return roleRank(bRole) < roleRank(aRole) ? 1 : -1;

  const aNeed = needTierOf(context, a, candidate);
  const bNeed = needTierOf(context, b, candidate);
  const needRank = (tier: string) => (tier === 'high' ? 0 : tier === 'medium' ? 1 : 2);
  steps.push({
    candidatePlayerVersionId: candidate.playerVersionId,
    franchiseId: b,
    criterion: 'need',
    category: bNeed,
    citedFacts: [`need tier ${bNeed} (opponent ${aNeed})`],
  });
  if (needRank(bNeed) !== needRank(aNeed)) return needRank(bNeed) < needRank(aNeed) ? 1 : -1;

  const aIdentity = assignmentIdentityOf(context, a);
  const bIdentity = assignmentIdentityOf(context, b);
  const aFit = identityFitOf(context, a, aIdentity, candidate);
  const bFit = identityFitOf(context, b, bIdentity, candidate);
  const fitRank = (fit: string) => (fit === 'fits' ? 0 : fit === 'neutral' ? 1 : 2);
  steps.push({
    candidatePlayerVersionId: candidate.playerVersionId,
    franchiseId: b,
    criterion: 'identity-fit',
    category: bFit,
    citedFacts: [`identity fit ${bFit} (opponent ${aFit})`],
  });
  if (fitRank(bFit) !== fitRank(aFit)) return fitRank(bFit) < fitRank(aFit) ? 1 : -1;

  const aOpportunity = opportunityOf(context, a, aIdentity, candidate);
  const bOpportunity = opportunityOf(context, b, bIdentity, candidate);
  const oppRank = (opportunity: string) =>
    opportunity === 'immediate' ? 0 : opportunity === 'available' ? 1 : 2;
  steps.push({
    candidatePlayerVersionId: candidate.playerVersionId,
    franchiseId: b,
    criterion: 'opportunity',
    category: bOpportunity,
    citedFacts: [`opportunity ${bOpportunity} (opponent ${aOpportunity})`],
  });
  if (oppRank(bOpportunity) !== oppRank(aOpportunity)) {
    return oppRank(bOpportunity) < oppRank(aOpportunity) ? 1 : -1;
  }

  const aCommit = committedInfluenceOf(context, a, candidate);
  const bCommit = committedInfluenceOf(context, b, candidate);
  steps.push({
    candidatePlayerVersionId: candidate.playerVersionId,
    franchiseId: b,
    criterion: 'influence',
    category: String(bCommit),
    citedFacts: [`committed ${String(bCommit)} (opponent ${String(aCommit)})`],
  });
  if (bCommit !== aCommit) return bCommit > aCommit ? 1 : -1;

  const aDraw = freeAgencySeed(
    context.run.rootSeed,
    String(windowIndex),
    'draw',
    candidate.playerVersionId,
    a,
  );
  const bDraw = freeAgencySeed(
    context.run.rootSeed,
    String(windowIndex),
    'draw',
    candidate.playerVersionId,
    b,
  );
  steps.push({
    candidatePlayerVersionId: candidate.playerVersionId,
    franchiseId: b,
    criterion: 'draw',
    category: bDraw < aDraw ? 'won' : 'lost',
    citedFacts: [`draw ${bDraw.slice(0, 8)} vs ${aDraw.slice(0, 8)}`],
  });
  if (bDraw !== aDraw) return bDraw < aDraw ? 1 : -1;
  return a < b ? -1 : 1;
}

function roleCredibilityOf(
  context: SeasonFreeAgencyContext,
  franchiseId: string,
  candidate: SeasonFreeAgencyCandidate,
): string {
  const currentWindow = context.run.freeAgency.windows.find((window) => window.status === 'open');
  const declaration =
    currentWindow === undefined
      ? undefined
      : Object.values(currentWindow.declarations).find(
          (entry) => entry.franchiseId === franchiseId,
        );
  const expectation = declaration?.targets[0]?.roleExpectation ?? 'depth';
  if (expectation === 'rotation') {
    const roster = context.run.rosters.find((entry) => entry.franchiseId === franchiseId);
    const membership = memberOfCandidate(context, candidate);
    if (membership !== null && rosterLegalWithCandidate(context, roster, membership))
      return 'rotation';
    return 'depth';
  }
  if (expectation === 'emergency') {
    if (emergencyRepairsRotation(context, franchiseId, candidate)) return 'emergency';
    return 'depth';
  }
  return 'depth';
}

function assignmentIdentityOf(context: SeasonFreeAgencyContext, franchiseId: string): string {
  return (
    context.run.aiAssignments.find((entry) => entry.franchiseId === franchiseId)?.identity ??
    'continuity'
  );
}

function committedInfluenceOf(
  context: SeasonFreeAgencyContext,
  franchiseId: string,
  candidate: SeasonFreeAgencyCandidate,
): number {
  const currentWindow = context.run.freeAgency.windows.find((window) => window.status === 'open');
  const declaration =
    currentWindow === undefined
      ? undefined
      : Object.values(currentWindow.declarations).find(
          (entry) => entry.franchiseId === franchiseId,
        );
  return (
    declaration?.targets.find((target) => target.playerVersionId === candidate.playerVersionId)
      ?.influence ?? 0
  );
}

interface SeasonSigningFacts {
  effects: SeasonEffectsState;
  influence: SeasonInfluenceState;
  transactions: SeasonTransactionEntry[];
  freeAgency: SeasonFreeAgencyState;
  signing: SeasonFreeAgencySigning;
}

function applySigning(
  context: SeasonFreeAgencyContext,
  blockIndex: number,
  windowIndex: number,
  commandId: string,
  franchiseId: string,
  target: SeasonFreeAgencyTarget,
  candidate: SeasonFreeAgencyCandidate,
): SeasonFreeAgencySigning {
  const seed = freeAgencySeed(
    context.run.rootSeed,
    String(windowIndex),
    'signing',
    franchiseId,
    candidate.playerVersionId,
  );
  return {
    signingId: `fa-sg-${seed.slice(0, 32)}`,
    windowIndex,
    franchiseId,
    playerVersionId: candidate.playerVersionId,
    playerId: candidate.playerId,
    band: candidate.band,
    roleExpectation: target.roleExpectation,
    influenceCost: target.influence,
    commandId,
    seedPath: [String(windowIndex), 'resolve'],
    ledgerEntryId: deriveSeasonInfluenceEntryId(`fa-led-${seed.slice(0, 32)}`),
    transactionId: deriveSeasonTransactionId(`txn-fa-${seed.slice(0, 32)}`),
    appliedAtStateRevision: context.run.stateRevision + 1,
  };
}

function applySigningFacts(
  context: SeasonFreeAgencyContext,
  effects: SeasonEffectsState,
  influence: SeasonInfluenceState,
  transactions: SeasonTransactionEntry[],
  freeAgency: SeasonFreeAgencyState,
  signing: SeasonFreeAgencySigning,
): SeasonSigningFacts {
  const { run } = context;
  const roster = run.rosters.find((entry) => entry.franchiseId === signing.franchiseId);
  if (roster === undefined) {
    throw new FreeAgencyValidationRejection({
      code: 'free-agency-ownership-conflict',
      franchiseId: signing.franchiseId,
      playerVersionId: signing.playerVersionId,
      reason: 'unknown roster',
    });
  }
  if (roster.players.length >= SEASON_ROSTER_MAX_SIZE) {
    throw new FreeAgencyValidationRejection({
      code: 'free-agency-roster-cap',
      franchiseId: signing.franchiseId,
      rosterSize: roster.players.length,
    });
  }
  const catalogCandidate = context.catalog.candidates[signingCatalogIndexOf(context, signing)];
  if (catalogCandidate === undefined) {
    throw new FreeAgencyValidationRejection({
      code: 'free-agency-ownership-conflict',
      franchiseId: signing.franchiseId,
      playerVersionId: signing.playerVersionId,
      reason: 'missing catalog candidate',
    });
  }
  const balance = influence.balances[signing.franchiseId] ?? 0;
  if (balance < signing.influenceCost) {
    throw new FreeAgencyValidationRejection({
      code: 'free-agency-insufficient-balance',
      franchiseId: signing.franchiseId,
      balance,
      required: signing.influenceCost,
    });
  }
  const balanceAfter = balance - signing.influenceCost;
  const ledgerEntryId = deriveSeasonInfluenceEntryId(signing.ledgerEntryId);
  const ledgerEntry = {
    entryId: ledgerEntryId,
    franchiseId: signing.franchiseId,
    source: 'free-agent-signing' as const,
    blockIndex: windowBlockIndexOf(signing.windowIndex),
    commandId: signing.commandId,
    requestedDelta: -signing.influenceCost,
    appliedDelta: -signing.influenceCost,
    balanceAfter,
    explanation: `Free-agent signing of ${catalogCandidate.displayName}`,
  };
  const transaction: SeasonTransactionEntry = seasonTransactionEntry({
    transactionId: signing.transactionId,
    commandId: signing.commandId,
    franchiseId: signing.franchiseId,
    type: 'free-agent-signing',
    blockIndex: windowBlockIndexOf(signing.windowIndex),
    appliedAtStateRevision: signing.appliedAtStateRevision,
    payload: {
      playerVersionId: signing.playerVersionId,
      playerId: signing.playerId,
      windowIndex: signing.windowIndex,
      band: signing.band,
      roleExpectation: signing.roleExpectation,
      influenceCost: signing.influenceCost,
      ledgerEntryId,
      signingId: signing.signingId,
    },
    explanation: `Signed ${catalogCandidate.displayName} for ${String(signing.influenceCost)} Influence`,
  });
  const syncedSigning: SeasonFreeAgencySigning = {
    ...signing,
    transactionId: transaction.transactionId,
    ledgerEntryId,
  };
  return {
    effects: {
      ...effects,
      inactivePlayerStates: [
        ...effects.inactivePlayerStates,
        {
          playerVersionId: signing.playerVersionId,
          fatigueBasisPoints: 0,
          recentLoadBasisPoints: 0,
          lastCompletedRound: 0,
        },
      ],
    },
    influence: {
      ...influence,
      balances: { ...influence.balances, [signing.franchiseId]: balanceAfter },
      ledger: [...influence.ledger, ledgerEntry],
    },
    transactions: [...transactions, transaction],
    freeAgency: {
      ...freeAgency,
      signingCounts: {
        ...freeAgency.signingCounts,
        [signing.franchiseId]: (freeAgency.signingCounts[signing.franchiseId] ?? 0) + 1,
      },
      seasonSpend: {
        ...freeAgency.seasonSpend,
        [signing.franchiseId]:
          (freeAgency.seasonSpend[signing.franchiseId] ?? 0) + signing.influenceCost,
      },
    },
    signing: syncedSigning,
  };
}

function rosterEntryOf(
  context: SeasonFreeAgencyContext,
  signing: SeasonFreeAgencySigning,
): SeasonRosterEntry {
  const catalogCandidate = context.catalog.candidates[signingCatalogIndexOf(context, signing)];
  if (catalogCandidate === undefined) {
    throw new Error(`free agency: missing catalog candidate for ${signing.playerVersionId}`);
  }
  return {
    playerVersionId: catalogCandidate.playerVersionId,
    playerId: catalogCandidate.playerId,
    franchiseId: signing.franchiseId,
    eraId: catalogCandidate.eraId,
    seasonKey: catalogCandidate.seasonKey,
    displayName: catalogCandidate.displayName,
  };
}

function signingCatalogIndexOf(
  context: SeasonFreeAgencyContext,
  signing: SeasonFreeAgencySigning,
): number {
  for (const window of context.run.freeAgency.windows) {
    const candidate = window.candidates.find(
      (entry) => entry.playerVersionId === signing.playerVersionId,
    );
    if (candidate !== undefined) return candidate.catalogRef.candidateIndex;
  }
  return -1;
}

function windowBlockIndexOf(windowIndex: number): number {
  return SEASON_FREE_AGENCY_WINDOW_BLOCK_INDEXES[windowIndex] ?? 2;
}
