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
  snapshot?: {
    phase?: string;
    locks?: { p1Locked: boolean; p2Locked: boolean; revealed?: boolean };
    attestationSummary?: {
      verified: boolean | null;
      inputDigest?: string | null;
      resultDigest?: string | null;
    } | null;
  } | null,
): MultiplayerGameplayState {
  const base = createInitialGameplayState();
  base.draft = draft;
  base.generation = generation;
  base.bootstrap = bootstrap;
  if (draft.status === 'complete' && generation && bootstrap) {
    base.run = bootstrap.run;
    // derive lock state from live snapshot when available
    if (snapshot?.locks) {
      base.p1Locked = snapshot.locks.p1Locked;
      base.p2Locked = snapshot.locks.p2Locked;
      if (snapshot.locks.p1Locked && snapshot.locks.p2Locked) {
        base.phase = 'simulation';
      } else {
        base.phase = 'private-lock';
      }
    } else {
      base.phase = 'private-lock';
      base.p1Locked = false;
      base.p2Locked = false;
    }
    // map attestation summary to verified state
    if (snapshot?.attestationSummary?.verified === true) {
      base.attestation = {
        inputDigest: snapshot.attestationSummary.inputDigest ?? '',
        resultDigest: snapshot.attestationSummary.resultDigest ?? '',
        verified: true,
      };
      base.phase = 'hash-verification';
    } else if (snapshot?.attestationSummary?.verified === false) {
      base.attestation = {
        inputDigest: snapshot.attestationSummary.inputDigest ?? '',
        resultDigest: snapshot.attestationSummary.resultDigest ?? '',
        verified: false,
      };
    } else {
      base.attestation = null;
    }
    // phase from rooms is authoritative for simulation/hash-verification transitions
    if (snapshot?.phase === 'simulation') base.phase = 'simulation';
    if (snapshot?.phase === 'hash-verification' || snapshot?.phase === 'checkpoint-setup')
      base.phase = 'hash-verification';
    if (snapshot?.phase === 'integrity-failed') base.phase = 'hash-verification';
    base.simulationProgress = null;
  } else if (draft.status === 'finalized') {
    base.phase = 'league-verification';
  } else {
    base.phase = 'league-verification';
  }
  return base;
}
