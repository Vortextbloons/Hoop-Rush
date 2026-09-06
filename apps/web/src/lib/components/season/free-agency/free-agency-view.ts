import type {
  SeasonFreeAgencyBand,
  SeasonFreeAgencyCandidate,
  SeasonFreeAgencyDeclaration,
  SeasonFreeAgencyRoleExpectation,
  SeasonFreeAgencySigning,
  SeasonFreeAgencyState,
  SeasonFreeAgencyTraceStep,
  SeasonFreeAgencyWindowState,
} from '@hoop-rush/data-contracts';
import { franchiseIdSchema } from '@hoop-rush/data-contracts';
export const FREE_AGENCY_BAND_LABEL: Record<SeasonFreeAgencyBand, string> = {
  featured: 'Featured',
  role: 'Role',
  development: 'Development',
  emergency: 'Emergency',
};
export const FREE_AGENCY_BAND_BLURB: Record<SeasonFreeAgencyBand, string> = {
  featured: 'Market headliner · 2-3 Influence',
  role: 'Rotation-ready contributor · 1-2 Influence',
  development: 'Developmental depth · 1 Influence',
  emergency: 'Short-term insurance · 1 Influence',
};
export const ROLE_EXPECTATION_LABEL: Record<SeasonFreeAgencyRoleExpectation, string> = {
  rotation: 'Rotation',
  depth: 'Depth',
  emergency: 'Emergency',
};
export const CRITERION_LABEL: Record<SeasonFreeAgencyTraceStep['criterion'], string> = {
  legality: 'Legality',
  'role-credibility': 'Role credibility',
  need: 'Need',
  'identity-fit': 'Identity fit',
  opportunity: 'Opportunity',
  influence: 'Influence',
  draw: 'Draw',
};
export const FREE_AGENCY_SIGNING_CAP = 3;
export const FREE_AGENCY_SPEND_CAP = 6;
export const FREE_AGENCY_MAX_COMMITMENT = 3;
export type NeedTier = 'High' | 'Medium' | 'Low';
export type Opportunity = 'Immediate' | 'Competitive' | 'Crowded';
export interface CandidateFitFacts {
  needTier: NeedTier;
  opportunity: Opportunity;
  interestedCount: number;
}
export function openFreeAgencyWindowOf(
  freeAgency: SeasonFreeAgencyState | null,
): SeasonFreeAgencyWindowState | null {
  if (freeAgency === null) return null;
  return freeAgency.windows.find((window) => window.status === 'open') ?? null;
}
export function humanDeclarationOf(
  window: SeasonFreeAgencyWindowState,
  franchiseId: string | null,
): SeasonFreeAgencyDeclaration | null {
  if (franchiseId === null) return null;
  const parsedFranchiseId = franchiseIdSchema.parse(franchiseId);
  return window.declarations[parsedFranchiseId] ?? null;
}
export function humanSkipped(
  window: SeasonFreeAgencyWindowState,
  franchiseId: string | null,
): boolean {
  const declaration = humanDeclarationOf(window, franchiseId);
  return declaration !== null && declaration.targets.length === 0;
}
export interface InterestedTeam {
  franchiseId: string;
  priority: 1 | 2;
  human: boolean;
}
export function interestedTeamsOf(
  window: SeasonFreeAgencyWindowState,
  candidatePlayerVersionId: string,
  humanFranchiseId: string | null,
): InterestedTeam[] {
  const teams: InterestedTeam[] = [];
  for (const declaration of Object.values(window.declarations)) {
    const priority = declaration.targets.findIndex(
      (target) => target.playerVersionId === candidatePlayerVersionId,
    );
    if (priority === -1) continue;
    teams.push({
      franchiseId: declaration.franchiseId,
      priority: priority === 0 ? 1 : 2,
      human: declaration.franchiseId === humanFranchiseId,
    });
  }
  return teams.sort((a, b) => {
    if (a.human !== b.human) return a.human ? -1 : 1;
    return a.franchiseId < b.franchiseId ? -1 : 1;
  });
}
export function humanSigningOf(
  window: SeasonFreeAgencyWindowState,
  franchiseId: string | null,
): SeasonFreeAgencySigning | null {
  if (franchiseId === null) return null;
  return window.signings.find((signing) => signing.franchiseId === franchiseId) ?? null;
}
export function candidateFitFacts(
  candidate: SeasonFreeAgencyCandidate,
  activeRotationIds: readonly string[],
  playableOf: (playerVersionId: string) => readonly string[],
  otherInterestedCount: number,
): CandidateFitFacts {
  const primary = candidate.positions.primary;
  let covering = 0;
  for (const playerVersionId of activeRotationIds) {
    if (playableOf(playerVersionId).includes(primary)) covering += 1;
  }
  const needTier: NeedTier = covering <= 1 ? 'High' : covering === 2 ? 'Medium' : 'Low';
  const opportunity: Opportunity =
    otherInterestedCount === 0
      ? 'Immediate'
      : otherInterestedCount <= 3
        ? 'Competitive'
        : 'Crowded';
  return { needTier, opportunity, interestedCount: otherInterestedCount };
}
const BAND_RANK: Record<SeasonFreeAgencyBand, number> = {
  featured: 0,
  role: 1,
  development: 2,
  emergency: 3,
};
const NEED_RANK: Record<NeedTier, number> = { High: 0, Medium: 1, Low: 2 };
export function bestFitOrder(
  candidates: readonly SeasonFreeAgencyCandidate[],
  fitOf: (candidate: SeasonFreeAgencyCandidate) => CandidateFitFacts,
  limit = 5,
): string[] {
  const ordered = [...candidates].sort((a, b) => {
    const fa = fitOf(a);
    const fb = fitOf(b);
    const need = NEED_RANK[fa.needTier] - NEED_RANK[fb.needTier];
    if (need !== 0) return need;
    const band = BAND_RANK[a.band] - BAND_RANK[b.band];
    if (band !== 0) return band;
    const competition = fa.interestedCount - fb.interestedCount;
    if (competition !== 0) return competition;
    return a.displayName.localeCompare(b.displayName);
  });
  return ordered.slice(0, limit).map((candidate) => candidate.playerVersionId);
}
export function influenceOptionsOf(candidate: SeasonFreeAgencyCandidate): number[] {
  const options: number[] = [];
  for (let value = candidate.minimumInfluence; value <= FREE_AGENCY_MAX_COMMITMENT; value += 1) {
    options.push(value);
  }
  return options;
}
export interface DeclarationDraftTarget {
  playerVersionId: string;
  roleExpectation: SeasonFreeAgencyRoleExpectation;
  influence: number;
}
export interface DeclarationValidationInput {
  candidates: readonly SeasonFreeAgencyCandidate[];
  targets: readonly DeclarationDraftTarget[];
  balance: number;
  seasonSpend: number;
}
export function nextFreePriority(
  entries: Iterable<{
    priority: 1 | 2;
  }>,
): 1 | 2 | null {
  const used = new Set<1 | 2>();
  for (const entry of entries) used.add(entry.priority);
  if (!used.has(1)) return 1;
  if (!used.has(2)) return 2;
  return null;
}
export function validateDeclaration(input: DeclarationValidationInput): string[] {
  const failures: string[] = [];
  if (input.targets.length === 0) {
    return failures;
  }
  const byVersion = new Map(
    input.candidates.map((candidate) => [candidate.playerVersionId, candidate]),
  );
  const seen = new Set<string>();
  let committed = 0;
  for (const target of input.targets) {
    if (seen.has(target.playerVersionId)) {
      failures.push('Both targets must be different players.');
      break;
    }
    seen.add(target.playerVersionId);
    const candidate = byVersion.get(target.playerVersionId);
    if (candidate === undefined) {
      failures.push('A declared target is not a candidate of this market.');
      continue;
    }
    if (!candidate.supportedRoles.includes(target.roleExpectation)) {
      failures.push(
        `${candidate.displayName} does not support the ${ROLE_EXPECTATION_LABEL[target.roleExpectation]} role.`,
      );
    }
    if (
      target.influence < candidate.minimumInfluence ||
      target.influence > FREE_AGENCY_MAX_COMMITMENT
    ) {
      failures.push(
        `${candidate.displayName} needs ${String(candidate.minimumInfluence)}-${String(FREE_AGENCY_MAX_COMMITMENT)} Influence.`,
      );
    }
    committed += target.influence;
  }
  if (committed > input.balance) {
    failures.push(
      `The committed Influence (${String(committed)}) exceeds your balance (${String(input.balance)}).`,
    );
  }
  const remainingBudget = FREE_AGENCY_SPEND_CAP - input.seasonSpend;
  if (committed > remainingBudget) {
    failures.push(
      `The committed Influence (${String(committed)}) exceeds the remaining season free-agency budget (${String(remainingBudget)} of ${String(FREE_AGENCY_SPEND_CAP)}).`,
    );
  }
  return failures;
}
