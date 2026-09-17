import {
  SEASON_BLOCK_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  commandIdSchema,
  franchiseIdSchema,
  type SeasonChallengeDeal,
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
export type SubmitBlockFailureCode =
  | 'no-run'
  | 'no-human-team'
  | 'no-editor'
  | 'no-next-block'
  | 'season-complete'
  | 'block-busy'
  | 'rotation-invalid'
  | 'asset-unavailable'
  | 'evolution-not-selected'
  | 'free-agency-unresolved';
export type SeasonBlockerKind = 'rotation' | 'innovation' | 'free-agency';
export interface SeasonBlockBlocker {
  kind: SeasonBlockerKind;
  label: string;
  destination: string;
}
export interface SeasonBlockReadiness {
  blockers: SeasonBlockBlocker[];
  canPlay: boolean;
}
export function seasonBlockReadinessOf(input: {
  rotationFailures: readonly string[];
  innovationRequired: boolean;
  faUnresolved: boolean;
  faWindowIndex?: number | null;
}): SeasonBlockReadiness {
  const blockers: SeasonBlockBlocker[] = [];
  if (input.rotationFailures.length > 0) {
    blockers.push({
      kind: 'rotation',
      label:
        input.rotationFailures.length === 1
          ? 'Fix your lineup to play'
          : `Fix your lineup (${String(input.rotationFailures.length)} issues) to play`,
      destination: '/season/run/team',
    });
  }
  if (input.innovationRequired) {
    blockers.push({
      kind: 'innovation',
      label: 'Pick your home-court rule to play',
      destination: '#court-innovation',
    });
  }
  if (input.faUnresolved) {
    const windowLabel =
      input.faWindowIndex !== null && input.faWindowIndex !== undefined
        ? ` (Window ${String(input.faWindowIndex + 1)})`
        : '';
    blockers.push({
      kind: 'free-agency',
      label: `Finish free agency${windowLabel} to play`,
      destination: '/season/run/free-agency',
    });
  }
  return { blockers, canPlay: blockers.length === 0 };
}
export function isInnovationRequired(
  run: {
    evolution?:
      | {
          discovery: unknown;
          selections: Record<string, unknown>;
        }
      | null
      | undefined;
  } | null,
  humanFranchiseId: string | null,
  nextBlockIndex: number | null,
): boolean {
  if (run === null || humanFranchiseId === null || nextBlockIndex === null) return false;
  if (nextBlockIndex < 3) return false;
  const evolution = run.evolution ?? null;
  if (evolution === null || evolution.discovery === null || evolution.discovery === undefined)
    return false;
  return evolution.selections[humanFranchiseId] === undefined;
}
export interface HumanizedBlockSubmitFailure {
  code: SubmitBlockFailureCode;
  message: string;
  destination: string | null;
}
export function humanizeBlockSubmitFailure(
  code: SubmitBlockFailureCode,
  detail: { faWindowIndex?: number | null; firstFailure?: string | null } = {},
): HumanizedBlockSubmitFailure {
  switch (code) {
    case 'rotation-invalid':
      return {
        code,
        message:
          detail.firstFailure !== null && detail.firstFailure !== undefined
            ? `Your lineup needs a fix: ${detail.firstFailure}`
            : 'Your lineup needs a fix before you can play.',
        destination: '/season/run/team',
      };
    case 'evolution-not-selected':
      return {
        code,
        message: 'Pick one home-court rule to unlock Play.',
        destination: '#court-innovation',
      };
    case 'free-agency-unresolved':
      return {
        code,
        message:
          detail.faWindowIndex !== null && detail.faWindowIndex !== undefined
            ? `Finish free agency (Window ${String(detail.faWindowIndex + 1)}) to unlock Play.`
            : 'Finish free agency to unlock Play.',
        destination: '/season/run/free-agency',
      };
    case 'block-busy':
      return {
        code,
        message: 'A block is already playing. Wait for it to finish.',
        destination: null,
      };
    case 'season-complete':
      return { code, message: 'The regular season is complete.', destination: null };
    case 'no-run':
    case 'no-next-block':
      return {
        code,
        message: 'Your season is still loading. Try again in a moment.',
        destination: null,
      };
    case 'no-human-team':
      return {
        code,
        message: 'This run has no team for you. Start a new season.',
        destination: '/season',
      };
    case 'no-editor':
      return {
        code,
        message: 'Your lineup is still loading. Try again in a moment.',
        destination: '/season/run/team',
      };
    case 'asset-unavailable':
      return {
        code,
        message: 'Season files are unavailable. Check your connection and retry.',
        destination: null,
      };
  }
}
export interface SubmitBlockFailure {
  code: SubmitBlockFailureCode;
  message: string;
}
export type BuildSubmitBlockEnvelopeResult =
  | {
      ok: true;
      envelope: SubmitBlockEnvelope;
    }
  | {
      ok: false;
      error: SubmitBlockFailure;
    };
export function blockPhaseAllowsSubmit(phase: string): boolean {
  return phase === 'idle' || phase === 'complete' || phase === 'cancelled' || phase === 'failed';
}
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
  const innovationRequired = isInnovationRequired(run, humanFranchiseId, nextBlockIndex);
  const unresolvedWindowIndex = freeAgencyUnresolvedWindowIndex(run.freeAgency);
  const readiness = seasonBlockReadinessOf({
    rotationFailures,
    innovationRequired,
    faUnresolved: unresolvedWindowIndex !== null,
    faWindowIndex: unresolvedWindowIndex,
  });
  if (readiness.blockers.length > 0) {
    const first = readiness.blockers[0];
    if (first !== undefined) {
      if (first.kind === 'rotation') {
        return fail(
          'rotation-invalid',
          `The rotation cannot be submitted: ${rotationFailures.join('; ')}`,
        );
      }
      if (first.kind === 'innovation') {
        return fail(
          'evolution-not-selected',
          'Choose a Court Innovation first — the home rule locks before block 4.',
        );
      }
      return fail(
        'free-agency-unresolved',
        `The free-agency market window ${String((unresolvedWindowIndex ?? 0) + 1)} is still open — resolve it on the free-agency screen (/season/run/free-agency) before the next block can submit.`,
      );
    }
  }
  const challenges = (
    run as unknown as {
      challenges?: import('@hoop-rush/data-contracts').SeasonChallengeState;
    }
  ).challenges;
  const challengeDeal: SeasonChallengeDeal | null =
    nextBlockIndex >= 8 ? null : (challenges?.deals[nextBlockIndex] ?? null);
  const challengeIds = challengeDeal !== null ? [...challengeDeal.challengeIds] : undefined;
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
  const commandId = commandIdSchema.parse(newSeasonId('blk'));
  const command: SeasonSubmitBlockCommand = {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    blockVersion: SEASON_BLOCK_VERSION,
    command: 'submit-season-block',
    commandId,
    runId: run.runId,
    expectedRevision: blockIndex,
    blockIndex,
    rotationDigest,
    objectiveId: null,
    ...(challengeIds !== undefined ? { challengeIds } : {}),
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
    humanFranchiseId: franchiseIdSchema.parse(humanFranchiseId),
    objectiveId: null,
    challengeDeal,
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
