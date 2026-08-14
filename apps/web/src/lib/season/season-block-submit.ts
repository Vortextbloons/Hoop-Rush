import {
  SEASON_BLOCK_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  type SeasonObjectiveId,
  type SeasonRotation,
  type SeasonSubmitBlockCommand,
} from '@hoop-rush/data-contracts';
import { freeAgencyUnresolvedWindowIndex } from '@hoop-rush/engine';
import { loadSeasonHomeCourtProfile, seasonArtifactUrls } from './season-assets';
import { newSeasonId } from './season-ids';
import { pendingRotationSetDigest } from './season-lock-preview';
import type { SubmitBlockEnvelope } from './season-hub-state';
import type { SeasonRunShellData } from './season-shell-context';
import type { SeasonBlockStartInput } from './season-block-runner';

/**
 * Season Run block submission (M2.3.5 hub, M2.5): builds the typed
 * `SubmitBlockEnvelope` (command + runner start input) from the live shell
 * state. This is the UI's single path into `SeasonHubState.startBlock` —
 * every can-submit condition is checked here and reported as a typed
 * failure, so the Hub renders concrete, actionable rejections instead of a
 * generic disabled button. The envelope mirrors the pre-shell league hub's
 * builder exactly (frozen command schema, engine rotation-set digest,
 * packaged artifact URLs for the worker).
 *
 * M2.5: the submit command gains the locked `objectiveId` (null for the
 * final two-game block 8; a selection is REQUIRED for blocks 0-7 — the
 * engine rejects with `invalid-objective` otherwise) and the expected run
 * state facts (`expectedStateRevision`/`expectedStateDigest` asserted by
 * every command). The runner start input carries the locked objective; the
 * runner derives the pre-block health and state facts from the snapshot.
 */

export type SubmitBlockFailureCode =
  | 'no-run'
  | 'no-human-team'
  | 'no-editor'
  | 'no-next-block'
  | 'season-complete'
  | 'block-busy'
  | 'rotation-invalid'
  | 'asset-unavailable'
  | 'objective-not-selected'
  | 'free-agency-unresolved';

export interface SubmitBlockFailure {
  code: SubmitBlockFailureCode;
  message: string;
}

export type BuildSubmitBlockEnvelopeResult =
  { ok: true; envelope: SubmitBlockEnvelope } | { ok: false; error: SubmitBlockFailure };

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

  // M2.5: the objective is locked into the submit command. Blocks 0-7
  // require a recorded selection (the engine rejects otherwise); the final
  // two-game block 8 must carry null.
  const objectiveId: SeasonObjectiveId | null =
    nextBlockIndex >= 8 ? null : selectedObjectiveIdOf(run, nextBlockIndex);
  if (objectiveId === null && nextBlockIndex < 8) {
    return fail(
      'objective-not-selected',
      'Pick a block objective first — the selected objective locks into this block.',
    );
  }

  // M2.6.5: an open free-agency market blocks the next rotation lock (the
  // engine's authoritative gate; the worker wire carries no pre-block
  // free-agency state, so the shell gates before submission). The window
  // must be explicitly resolved on the free-agency screen.
  const unresolvedWindowIndex = freeAgencyUnresolvedWindowIndex(run.freeAgency);
  if (unresolvedWindowIndex !== null) {
    return fail(
      'free-agency-unresolved',
      `The free-agency market window ${String(
        unresolvedWindowIndex + 1,
      )} is still open — resolve it on the free-agency screen (/season/run/free-agency) before the next block can submit.`,
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
    objectiveId,
    expectedStateRevision: run.stateRevision,
    expectedStateDigest: run.stateDigest,
  };

  const start: SeasonBlockStartInput = {
    run,
    effects: snapshot.effects,
    rotations,
    blockIndex,
    expectedRevision: blockIndex,
    rotationDigest,
    commandId,
    humanFranchiseId,
    objectiveId,
    homeCourt,
    catalogUrl: artifactUrls.catalogUrl,
    catalogHash: artifactUrls.catalogHash,
    profileUrl: artifactUrls.profileUrl,
    profileHash: artifactUrls.profileHash,
  };

  return { ok: true, envelope: { command, start } };
}

function selectedObjectiveIdOf(
  run: NonNullable<SeasonRunShellData['run']>,
  blockIndex: number,
): SeasonObjectiveId | null {
  return run.objectives.selections[blockIndex]?.objectiveId ?? null;
}

function fail(code: SubmitBlockFailureCode, message: string): BuildSubmitBlockEnvelopeResult {
  return { ok: false, error: { code, message } };
}
