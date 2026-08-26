import { SEASON_BLOCK_VERSION, SEASON_RUN_SCHEMA_VERSION, type SeasonObjectiveId, type SeasonRotation, type SeasonSubmitBlockCommand, } from '@hoop-rush/data-contracts';
import { freeAgencyUnresolvedWindowIndex } from '@hoop-rush/engine';
import { loadSeasonHomeCourtProfile, seasonArtifactUrls } from './season-assets';
import { newSeasonId } from './season-ids';
import { pendingRotationSetDigest } from './season-lock-preview';
import type { SubmitBlockEnvelope } from './season-hub-state';
import type { SeasonRunShellData } from './season-shell-context';
import type { SeasonBlockStartInput } from './season-block-runner';
export type SubmitBlockFailureCode = 'no-run' | 'no-human-team' | 'no-editor' | 'no-next-block' | 'season-complete' | 'block-busy' | 'rotation-invalid' | 'asset-unavailable' | 'objective-not-selected' | 'campaign-not-selected' | 'free-agency-unresolved';
export interface SubmitBlockFailure {
    code: SubmitBlockFailureCode;
    message: string;
}
export type BuildSubmitBlockEnvelopeResult = {
    ok: true;
    envelope: SubmitBlockEnvelope;
} | {
    ok: false;
    error: SubmitBlockFailure;
};
export function blockPhaseAllowsSubmit(phase: string): boolean {
    return phase === 'idle' || phase === 'complete' || phase === 'cancelled' || phase === 'failed';
}
export async function buildSubmitBlockEnvelope(shell: SeasonRunShellData): Promise<BuildSubmitBlockEnvelopeResult> {
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
        return fail('rotation-invalid', `The rotation cannot be submitted: ${rotationFailures.join('; ')}`);
    }
    const objectiveId: SeasonObjectiveId | null = nextBlockIndex >= 8 ? null : selectedObjectiveIdOf(run, nextBlockIndex);
    const campaignState = (run as unknown as {
        campaign?: import('@hoop-rush/data-contracts').SeasonCampaignState;
    }).campaign as import('@hoop-rush/data-contracts').SeasonCampaignState | undefined;
    const campaignOpportunityId: string | null = nextBlockIndex >= 8 ? null : (campaignState?.selections[nextBlockIndex]?.opportunityId ?? null);
    const hasCampaign = campaignState !== undefined;
    if (hasCampaign) {
        if (campaignState.startingIdentity === null) {
            return fail('campaign-not-selected', 'Select a GM identity first — the campaign identity locks before the first block.');
        }
        if (nextBlockIndex === 5 &&
            campaignState.evolutionOffers !== null &&
            campaignState.evolutionSelection === null) {
            return fail('campaign-not-selected', 'Complete the midseason evolution choice first — it locks before block 6.');
        }
        if (campaignOpportunityId === null && nextBlockIndex < 8) {
            return fail('campaign-not-selected', 'Pick a campaign opportunity first — the selected opportunity locks into this block.');
        }
    }
    else if (objectiveId === null && nextBlockIndex < 8) {
        return fail('objective-not-selected', 'Pick a block objective first — the selected objective locks into this block.');
    }
    const unresolvedWindowIndex = freeAgencyUnresolvedWindowIndex(run.freeAgency);
    if (unresolvedWindowIndex !== null) {
        return fail('free-agency-unresolved', `The free-agency market window ${String(unresolvedWindowIndex + 1)} is still open — resolve it on the free-agency screen (/season/run/free-agency) before the next block can submit.`);
    }
    const pendingHumanRotation = editor.rotation;
    const blockIndex = nextBlockIndex;
    const rotations: SeasonRotation[] = run.rotations.map((rotation) => rotation.franchiseId === humanFranchiseId ? pendingHumanRotation : rotation);
    const rotationDigest = pendingRotationSetDigest(run.rotations, pendingHumanRotation);
    let homeCourt: Awaited<ReturnType<typeof loadSeasonHomeCourtProfile>>;
    let artifactUrls: Awaited<ReturnType<typeof seasonArtifactUrls>>;
    try {
        [homeCourt, artifactUrls] = await Promise.all([
            loadSeasonHomeCourtProfile(),
            seasonArtifactUrls(),
        ]);
    }
    catch (error) {
        return fail('asset-unavailable', `The block cannot start because packaged assets are unavailable: ${error instanceof Error ? error.message : String(error)}`);
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
        campaignOpportunityId: campaignOpportunityId as unknown as never,
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
        campaignOpportunityId: campaignOpportunityId as unknown as never,
        homeCourt,
        catalogUrl: artifactUrls.catalogUrl,
        catalogHash: artifactUrls.catalogHash,
        profileUrl: artifactUrls.profileUrl,
        profileHash: artifactUrls.profileHash,
    };
    return { ok: true, envelope: { command, start } };
}
function selectedObjectiveIdOf(run: NonNullable<SeasonRunShellData['run']>, blockIndex: number): SeasonObjectiveId | null {
    return run.objectives.selections[blockIndex]?.objectiveId ?? null;
}
function fail(code: SubmitBlockFailureCode, message: string): BuildSubmitBlockEnvelopeResult {
    return { ok: false, error: { code, message } };
}
