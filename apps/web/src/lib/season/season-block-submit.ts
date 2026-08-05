import {
  SEASON_BLOCK_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  type SeasonRotation,
  type SeasonSubmitBlockCommand,
} from '@hoop-rush/data-contracts';
import { loadSeasonHomeCourtProfile, seasonArtifactUrls } from './season-assets';
import { newSeasonId } from './season-ids';
import { pendingRotationSetDigest } from './season-lock-preview';
import type { SubmitBlockEnvelope } from './season-hub-state';
import type { SeasonRunShellData } from './season-shell-context';
import type { SeasonBlockStartInput } from './season-block-runner';

/**
 * Season Run block submission (M2.3.5 hub): builds the typed
 * `SubmitBlockEnvelope` (command + runner start input) from the live shell
 * state. This is the UI's single path into `SeasonHubState.startBlock` —
 * every can-submit condition is checked here and reported as a typed
 * failure, so the Hub renders concrete, actionable rejections instead of a
 * generic disabled button. The envelope mirrors the pre-shell league hub's
 * builder exactly (frozen command schema, engine rotation-set digest,
 * packaged artifact URLs for the worker).
 */

export type SubmitBlockFailureCode =
  | 'no-run'
  | 'no-human-team'
  | 'no-editor'
  | 'no-next-block'
  | 'season-complete'
  | 'block-busy'
  | 'rotation-invalid'
  | 'asset-unavailable';

export interface SubmitBlockFailure {
  code: SubmitBlockFailureCode;
  message: string;
}

export type BuildSubmitBlockEnvelopeResult =
  { ok: true; envelope: SubmitBlockEnvelope } | { ok: false; error: SubmitBlockFailure };

/** Phases in which a fresh block may be submitted. */
export function blockPhaseAllowsSubmit(phase: string): boolean {
  return phase === 'idle' || phase === 'complete' || phase === 'cancelled' || phase === 'failed';
}

/**
 * Validates the shell state and builds the submit command + runner start
 * input. The command is idempotent per `commandId` (a fresh id each call;
 * retry re-issues the same command from `shell.block`).
 */
export async function buildSubmitBlockEnvelope(
  shell: SeasonRunShellData,
): Promise<BuildSubmitBlockEnvelopeResult> {
  const snapshot = shell.snapshot;
  const run = shell.run;
  if (snapshot === null || run === null) {
    return fail('no-run', 'The active run is not loaded yet.');
  }
  const humanFranchiseId = shell.humanFranchiseId;
  if (humanFranchiseId === null) {
    return fail('no-human-team', 'The active run has no human-controlled franchise.');
  }
  const editor = shell.editor;
  if (editor === null) {
    return fail('no-editor', 'The rotation editor is not ready.');
  }
  const nextBlockIndex = shell.nextBlockIndex;
  if (nextBlockIndex === null) {
    return fail('no-next-block', 'The run cursor is not loaded.');
  }
  if (nextBlockIndex >= 9) {
    return fail('season-complete', 'The regular season is complete; no block remains to simulate.');
  }
  if (shell.block.phase === 'running') {
    return fail('block-busy', 'A block is already simulating.');
  }
  const rotationFailures = editor.validate();
  if (rotationFailures.length > 0) {
    return fail(
      'rotation-invalid',
      `The rotation cannot be submitted: ${rotationFailures.join('; ')}`,
    );
  }

  const pendingHumanRotation = editor.rotation;
  const blockIndex = nextBlockIndex;
  const rotations: SeasonRotation[] = run.rotations.map((rotation) =>
    rotation.franchiseId === humanFranchiseId ? pendingHumanRotation : rotation,
  );
  const rotationDigest = pendingRotationSetDigest(run.rotations, pendingHumanRotation);

  let homeCourt: Awaited<ReturnType<typeof loadSeasonHomeCourtProfile>>;
  let artifactUrls: Awaited<ReturnType<typeof seasonArtifactUrls>>;
  try {
    [homeCourt, artifactUrls] = await Promise.all([
      loadSeasonHomeCourtProfile(),
      seasonArtifactUrls(),
    ]);
  } catch (error) {
    return fail(
      'asset-unavailable',
      `The block cannot start because packaged assets are unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const commandId = newSeasonId('blk');
  const command: SeasonSubmitBlockCommand = {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    blockVersion: SEASON_BLOCK_VERSION,
    command: 'submit-season-block',
    commandId,
    runId: run.runId,
    expectedRevision: blockIndex,
    blockIndex,
    rotationDigest,
  };

  const start: SeasonBlockStartInput = {
    run,
    rotations,
    blockIndex,
    expectedRevision: blockIndex,
    rotationDigest,
    commandId,
    humanFranchiseId,
    homeCourt,
    catalogUrl: artifactUrls.catalogUrl,
    catalogHash: artifactUrls.catalogHash,
    profileUrl: artifactUrls.profileUrl,
    profileHash: artifactUrls.profileHash,
  };

  return { ok: true, envelope: { command, start } };
}

function fail(code: SubmitBlockFailureCode, message: string): BuildSubmitBlockEnvelopeResult {
  return { ok: false, error: { code, message } };
}
