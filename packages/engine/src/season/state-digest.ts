import {
  seasonDigestHex,
  type SeasonAwards,
  type SeasonCampaignState,
  type SeasonCheckpointState,
  type SeasonEffectsState,
  type SeasonFreeAgencyState,
  type SeasonHealthState,
  type SeasonInfluenceState,
  type SeasonObjectiveState,
  type SeasonOwnership,
  type SeasonPostseasonState,
  type SeasonRoster,
  type SeasonRotation,
  type SeasonRunCompletion,
  type SeasonRunStage,
  type SeasonTradeState,
  type SeasonTransactionEntry,
} from '@hoop-rush/data-contracts';
import { canonicalJson } from './checkpoint.ts';

export interface SeasonRunStateDigestFacts {
  stateRevision: number;

  stage: SeasonRunStage;

  postseason: SeasonPostseasonState;

  awards: SeasonAwards | null;

  completion: SeasonRunCompletion | null;
  checkpointState: SeasonCheckpointState | null;
  health: SeasonHealthState;
  influence: SeasonInfluenceState;
  transactions: readonly SeasonTransactionEntry[];
  trade: SeasonTradeState | null;

  freeAgency: SeasonFreeAgencyState;
  objectives: SeasonObjectiveState;
  campaign?: SeasonCampaignState | null;
  rosters: readonly SeasonRoster[];
  ownership: readonly SeasonOwnership[];
  rotations: readonly SeasonRotation[];
  effects: SeasonEffectsState;
}

function sortedBy<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
}

function postseasonCanonical(postseason: SeasonPostseasonState): unknown {
  return {
    schemaVersion: postseason.schemaVersion,
    postseasonVersion: postseason.postseasonVersion,
    tiebreakVersion: postseason.tiebreakVersion,
    seed: postseason.seed,
    finalsHomeCourtDrawSeed: postseason.finalsHomeCourtDrawSeed,
    tiebreakResolutions: sortedBy(
      postseason.tiebreakResolutions,
      (resolution) => resolution.resolutionId,
    ),
    playIn: postseason.playIn,
    bracket: postseason.bracket,
    championFranchiseId: postseason.championFranchiseId,
  };
}

export function seasonRunStateDigest(facts: SeasonRunStateDigestFacts): string {
  const canonical = canonicalJson({
    stateRevision: facts.stateRevision,
    stage: facts.stage,
    postseason: postseasonCanonical(facts.postseason),
    awards: facts.awards,
    completion: facts.completion,
    checkpointState: facts.checkpointState,
    health: {
      schemaVersion: facts.health.schemaVersion,
      healthVersion: facts.health.healthVersion,
      injuries: sortedBy(facts.health.injuries, (injury) => injury.injuryId),
    },
    influence: {
      schemaVersion: facts.influence.schemaVersion,
      influenceVersion: facts.influence.influenceVersion,
      balances: facts.influence.balances,
      ledger: sortedBy(facts.influence.ledger, (entry) => entry.entryId),
      windows: Object.fromEntries(
        Object.entries(facts.influence.windows)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([franchiseId, windows]) => [
            franchiseId,
            [...windows].sort((a, b) => a.windowIndex - b.windowIndex),
          ]),
      ),
      rehabs: Object.fromEntries(
        Object.entries(facts.influence.rehabs).sort(([a], [b]) => (a < b ? -1 : 1)),
      ),
    },
    transactions: sortedBy(facts.transactions, (entry) => entry.transactionId),
    trade: facts.trade
      ? {
          ...facts.trade,
          windows: [...facts.trade.windows]
            .sort((a, b) => a.windowIndex - b.windowIndex)
            .map((window) => ({
              ...window,
              offers: sortedBy(window.offers, (offer) => offer.offerId),
              boardProfiles: window.boardProfiles ? sortedBy(window.boardProfiles, (p) => p.franchiseId) : undefined,
              negotiations: window.negotiations ? sortedBy(window.negotiations, (n) => n.inquiryId) : undefined,
              valueTrends: window.valueTrends ? sortedBy(window.valueTrends, (t) => t.playerVersionId) : undefined,
            })),
        }
      : null,
    freeAgency: {
      schemaVersion: facts.freeAgency.schemaVersion,
      freeAgencyVersion: facts.freeAgency.freeAgencyVersion,
      windows: facts.freeAgency.windows.map((window) => ({
        windowIndex: window.windowIndex,
        blockIndex: window.blockIndex,
        status: window.status,
        candidates: sortedBy(window.candidates, (candidate) => candidate.playerVersionId),
        declarations: window.declarations,
        traces: window.traces,
        signings: sortedBy(window.signings, (signing) => signing.signingId),
      })),
      canonicalCandidates: facts.freeAgency.canonicalCandidates,
      signingCounts: facts.freeAgency.signingCounts,
      seasonSpend: facts.freeAgency.seasonSpend,
    },
    objectives: facts.objectives,
    ...(facts.campaign !== undefined && facts.campaign !== null
      ? {
          campaign: {
            schemaVersion: facts.campaign.schemaVersion,
            campaignVersion: facts.campaign.campaignVersion,
            startingIdentity: facts.campaign.startingIdentity,
            startingFocus: facts.campaign.startingFocus,
            offers: Object.fromEntries(
              Object.entries(facts.campaign.offers)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([blockIndex, offers]) => [
                  blockIndex,
                  sortedBy(offers as import('@hoop-rush/data-contracts').SeasonCampaignOpportunity[], (o) => o.opportunityId),
                ]),
            ),
            selections: Object.fromEntries(
              Object.entries(facts.campaign.selections).sort(([a], [b]) => Number(a) - Number(b)),
            ),
            evaluations: sortedBy(facts.campaign.evaluations, (e) => `${String(e.blockIndex)}:${e.opportunityId}`),
            branchState: Object.fromEntries(Object.entries(facts.campaign.branchState).sort(([a], [b]) => (a < b ? -1 : 1))),
            evolutionOffers: facts.campaign.evolutionOffers ? sortedBy(facts.campaign.evolutionOffers, (o) => o.offerId) : null,
            evolutionSelection: facts.campaign.evolutionSelection,
            rewardEntitlements: facts.campaign.rewardEntitlements,
            appliedRewardIds: [...facts.campaign.appliedRewardIds].sort(),
          },
        }
      : {}),
    rosters: sortedBy(facts.rosters, (roster) => roster.franchiseId),
    ownership: sortedBy(facts.ownership, (row) => row.playerVersionId),
    rotations: sortedBy(facts.rotations, (rotation) => rotation.franchiseId),
    effects: canonicalJson({
      schemaVersion: facts.effects.schemaVersion,
      playerStates: sortedBy(facts.effects.playerStates, (player) => player.playerVersionId),
      pairStates: [...facts.effects.pairStates].sort((a, b) =>
        a.a < b.a ? -1 : a.a > b.a ? 1 : a.b < b.b ? -1 : a.b > b.b ? 1 : 0,
      ),
    }),
  });
  return seasonDigestHex(canonical);
}
