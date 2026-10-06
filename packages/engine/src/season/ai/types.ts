import type {
  EraSimulationProfile,
  ProjectionModelArtifact,
  SeasonAiAnchor,
  SeasonAiAssignment,
  SeasonAiIdentity,
  SeasonDraftCatalog,
  SeasonLeague,
  SeasonRosterRole,
  SeasonRosterTargets,
  SeasonStrengthBand,
  Seed,
} from '@hoop-rush/data-contracts';
import type { PercentileTier, RoleThresholds } from '../ai-scoring.ts';

export type SeasonAiGenerationPhase = 'anchors' | 'pool-fill' | 'selection';

export interface PoolTeam {
  franchiseId: string;
  band: SeasonStrengthBand;
  identity: SeasonAiIdentity;
  pool: string[];
  groupCounts: {
    guards: number;
    forwards: number;
    centers: number;
  };
  coverageMask: number;
  tierCounts: Record<PercentileTier, number>;
  outliers: number;
  anchors: SeasonAiAnchor[];
  seedPaths: string[];
  memberPaths: Map<string, string[]>;
  repairCount: number;
  selections: string[] | null;
}

export type SeasonAiGenerationProgressPhase =
  SeasonAiGenerationPhase | 'scouting' | 'rotations' | 'done';

export interface SeasonAiGenerationProgress {
  phase: SeasonAiGenerationProgressPhase;
  completed: number;
  total: number;
  teamsCompleted?: string[];
}

export interface GenerationState {
  seed: Seed;
  catalog: SeasonDraftCatalog;
  byId: Map<string, SeasonDraftCatalog['candidates'][number]>;
  maskByVersion: Map<string, number>;
  roleScores: Map<string, Record<SeasonRosterRole, number>>;
  coverageMaskByVersion: Map<string, number>;
  roleTiers: Map<string, Record<SeasonRosterRole, PercentileTier>>;
  poolTiers: Map<string, PercentileTier>;
  identityScores: Map<string, Record<SeasonAiIdentity, number>>;
  identityPriorityTotals: Map<string, Record<SeasonAiIdentity, number>>;
  thresholds: Record<SeasonRosterRole, RoleThresholds>;
  humanOwned: Set<string>;
  claimedIdentities: Set<string>;
  versionsByIdentity: Map<string, readonly string[]>;
  unassigned: Set<string>;
  unassignedMaskCountsArr: number[];
  unassignedRoleCoverCounts: number[];
  remainingSlots: number;
  teams: Map<string, PoolTeam>;
  teamOrder: string[];
  targets: SeasonRosterTargets;
  canonicalCandidates: readonly SeasonDraftCatalog['candidates'][number][];
  assignments: Map<string, SeasonAiAssignment>;
  nodes: number;
  nodesByPhase: Record<SeasonAiGenerationPhase, number>;
  phase: SeasonAiGenerationPhase;
  selectionFloor: number;
  backtracks: number;
  bans: Set<string>;
  onProgress?: (progress: SeasonAiGenerationProgress) => void;
  projection?: {
    eraProfile: EraSimulationProfile;
    model: ProjectionModelArtifact;
  };
}

export interface SeasonAiGenerationInput {
  seed: Seed;
  catalog: SeasonDraftCatalog;
  league: SeasonLeague;
  humanFranchiseIds: readonly string[];
  humanRosters: ReadonlyArray<{
    franchiseId: string;
    playerVersionIds: string[];
  }>;
  targets: SeasonRosterTargets;
  projection?: {
    eraProfile: EraSimulationProfile;
    model: ProjectionModelArtifact;
  };
  onProgress?: (progress: SeasonAiGenerationProgress) => void;
}

export interface AnchorOption {
  versionId: string;
  qualifyingRole: SeasonRosterRole;
  roleScore: number;
  threshold: number;
}

export interface PoolSnapshot {
  pools: Array<{
    franchiseId: string;
    pool: string[];
    tierCounts: Record<PercentileTier, number>;
    outliers: number;
    anchors: SeasonAiAnchor[];
    seedPaths: string[];
    memberPaths: Array<[string, string[]]>;
    repairCount: number;
  }>;
  unassigned: string[];
  unassignedMaskCountsArr: number[];
  remainingSlots: number;
  claimedIdentities: string[];
}
