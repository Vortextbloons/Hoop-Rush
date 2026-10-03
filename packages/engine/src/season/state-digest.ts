import {
  canonicalJson,
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
  type SeasonRun,
  type SeasonRunCompletion,
  type SeasonRunStage,
  type SeasonSponsorGearState,
  type SeasonTradeState,
  type SeasonTransactionEntry,
  type SeasonRunAuthority,
  normalizeEvolutionState,
} from '@hoop-rush/data-contracts';
import { authorityCanonical } from './checkpoint.ts';
import { comparePairKeys, sortedBy, sortedEntries, sortedNumericEntries } from './canonical.ts';
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
  objectives?: SeasonObjectiveState | null;
  challenges?: import('@hoop-rush/data-contracts').SeasonChallengeState | null;
  campaign?: SeasonCampaignState | null;
  evolution?: import('@hoop-rush/data-contracts').SeasonEvolutionState | null;
  sponsors?: SeasonSponsorGearState | null;
  rosters: readonly SeasonRoster[];
  ownership: readonly SeasonOwnership[];
  rotations: readonly SeasonRotation[];
  effects: SeasonEffectsState;
  authority?: SeasonRunAuthority;
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
        sortedEntries(facts.influence.windows).map(([franchiseId, windows]) => [
          franchiseId,
          [...windows].sort((a, b) => a.windowIndex - b.windowIndex),
        ]),
      ),
      rehabs: Object.fromEntries(sortedEntries(facts.influence.rehabs)),
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
              boardProfiles: window.boardProfiles
                ? sortedBy(window.boardProfiles, (p) => p.franchiseId)
                : undefined,
              negotiations: window.negotiations
                ? sortedBy(window.negotiations, (n) => n.inquiryId)
                : undefined,
              valueTrends: window.valueTrends
                ? sortedBy(window.valueTrends, (t) => t.playerVersionId)
                : undefined,
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
    objectives:
      facts.objectives === undefined || facts.objectives === null ? undefined : facts.objectives,
    ...(facts.challenges !== undefined && facts.challenges !== null
      ? {
          challenges: {
            schemaVersion: facts.challenges.schemaVersion,
            challengeVersion: facts.challenges.challengeVersion,
            catalog: facts.challenges.catalog,
            deals: Object.fromEntries(sortedNumericEntries(facts.challenges.deals)),
            evaluations: [...facts.challenges.evaluations].sort(
              (a, b) => a.blockIndex - b.blockIndex,
            ),
          },
        }
      : {}),
    evolution: normalizeEvolutionState(facts.evolution),
    ...(facts.sponsors !== undefined && facts.sponsors !== null
      ? {
          sponsors: {
            vault: {
              schemaVersion: facts.sponsors.vault.schemaVersion,
              gearVersion: facts.sponsors.vault.gearVersion,
              items: sortedBy(facts.sponsors.vault.items, (item) => item.instanceId),
            },
            boards: {
              schemaVersion: facts.sponsors.boards.schemaVersion,
              gearVersion: facts.sponsors.boards.gearVersion,
              boards: [...facts.sponsors.boards.boards]
                .sort((a, b) => a.blockIndex - b.blockIndex)
                .map((board) => ({
                  blockIndex: board.blockIndex,
                  offers: sortedBy(board.offers, (offer) => offer.instanceId),
                  purchasedInstanceIds: [...board.purchasedInstanceIds].sort(),
                })),
            },
            players: {
              schemaVersion: facts.sponsors.players.schemaVersion,
              gearVersion: facts.sponsors.players.gearVersion,
              slots: Object.fromEntries(sortedEntries(facts.sponsors.players.slots)),
            },
          },
        }
      : {}),
    ...(facts.campaign !== undefined && facts.campaign !== null
      ? {
          campaign: {
            schemaVersion: facts.campaign.schemaVersion,
            campaignVersion: facts.campaign.campaignVersion,
            startingIdentity: facts.campaign.startingIdentity,
            startingFocus: facts.campaign.startingFocus,
            offers: Object.fromEntries(
              sortedNumericEntries(facts.campaign.offers).map(([blockIndex, offers]) => [
                blockIndex,
                sortedBy(offers, (o) => o.opportunityId),
              ]),
            ),
            selections: Object.fromEntries(sortedNumericEntries(facts.campaign.selections)),
            evaluations: sortedBy(
              facts.campaign.evaluations,
              (e) => `${String(e.blockIndex)}:${e.opportunityId}`,
            ),
            branchState: Object.fromEntries(sortedEntries(facts.campaign.branchState)),
            evolutionOffers: facts.campaign.evolutionOffers
              ? sortedBy(facts.campaign.evolutionOffers, (o) => o.offerId)
              : null,
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
      pairStates: [...facts.effects.pairStates].sort(comparePairKeys),
    }),
    authority: authorityCanonical(
      facts.authority ?? {
        kind: 'local-solo',
        soloFranchiseId: null,
        authorityVersion: 'season-authority-v1',
      },
    ),
  });
  return seasonDigestHex(canonical);
}
export function seasonRunStateDigestFactsOf(
  next: SeasonRun,
  effects: SeasonEffectsState,
): SeasonRunStateDigestFacts {
  return {
    stateRevision: next.stateRevision,
    stage: next.stage,
    postseason: next.postseason,
    awards: next.awards,
    completion: next.completion,
    checkpointState: next.checkpointState,
    health: next.health,
    influence: next.influence,
    transactions: next.transactions,
    trade: next.trade,
    freeAgency: next.freeAgency,
    objectives: next.objectives,
    challenges: (next as unknown as { challenges?: SeasonRunStateDigestFacts['challenges'] })
      .challenges,
    campaign: (next as unknown as { campaign?: SeasonRunStateDigestFacts['campaign'] }).campaign,
    evolution: (next as unknown as { evolution?: SeasonRunStateDigestFacts['evolution'] })
      .evolution,
    sponsors: next.sponsors ?? null,
    rosters: next.rosters,
    ownership: next.ownership,
    rotations: next.rotations,
    effects,
    authority: next.authority,
  };
}
