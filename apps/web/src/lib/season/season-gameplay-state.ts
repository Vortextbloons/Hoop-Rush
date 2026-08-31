import type {
  SeasonRun,
  SeasonDraftState,
  SeasonLeagueGenerationResult,
} from '@hoop-rush/data-contracts';
import type { GameplayBootstrapResult } from './season-gameplay-bootstrap';

export type MultiplayerPhase =
  'private-lock' | 'simulation' | 'hash-verification' | 'league-verification' | 'complete';

export interface MultiplayerGameplayState {
  phase: MultiplayerPhase;
  run: SeasonRun | null;
  draft: SeasonDraftState | null;
  generation: SeasonLeagueGenerationResult | null;
  bootstrap: GameplayBootstrapResult | null;
  error: string | null;
  p1Locked: boolean;
  p2Locked: boolean;
  simulationProgress: { completed: number; total: number; latestGameId: string | null } | null;
  attestation: { inputDigest: string; resultDigest: string; verified: boolean } | null;
}

export function createInitialGameplayState(): MultiplayerGameplayState {
  return {
    phase: 'league-verification',
    run: null,
    draft: null,
    generation: null,
    bootstrap: null,
    error: null,
    p1Locked: false,
    p2Locked: false,
    simulationProgress: null,
    attestation: null,
  };
}

export function deriveGameplayState(
  draft: SeasonDraftState,
  generation: SeasonLeagueGenerationResult | null,
  bootstrap: GameplayBootstrapResult | null,
): MultiplayerGameplayState {
  const base = createInitialGameplayState();
  base.draft = draft;
  base.generation = generation;
  base.bootstrap = bootstrap;
  if (draft.status === 'complete' && generation && bootstrap) {
    base.run = bootstrap.run;
    base.phase = 'private-lock';
    base.p1Locked = false;
    base.p2Locked = false;
    base.simulationProgress = null;
    base.attestation = null;
  } else if (draft.status === 'finalized') {
    base.phase = 'league-verification';
  } else {
    base.phase = 'league-verification';
  }
  return base;
}
