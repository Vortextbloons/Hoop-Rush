import type { StoredSeasonRunRecord } from '../schemas/season-run-record.ts';
import type { SeasonRunEngineSeam } from './engine-seam-types.ts';
export type ReplayDivergenceKind = 'campaign-offers' | 'campaign-evaluations' | 'campaign-branch-state' | 'campaign-evolution' | 'board-state' | 'board-inquiry-allowance' | 'board-negotiation-state' | 'board-value-trends' | 'ai-response' | 'ai-counter' | 'ai-transaction' | 'rehab-outcome' | 'rehab-premium' | 'trade-grade' | 'state-digest' | 'command-log-digest';
export interface ReplayDivergence {
    kind: ReplayDivergenceKind;
    message: string;
}
function deepEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}
export function auditReplayDivergences(stored: StoredSeasonRunRecord, recomputedDigest: string | null, seam: SeasonRunEngineSeam): ReplayDivergence[] {
    const divergences: ReplayDivergence[] = [];
    if (recomputedDigest !== null && recomputedDigest !== stored.stateDigest) {
        try {
            const withoutCampaign = seam.seasonRunStateDigest({
                stateRevision: stored.stateRevision,
                stage: stored.run.stage,
                postseason: stored.run.postseason,
                awards: stored.run.awards,
                completion: stored.run.completion,
                checkpointState: stored.checkpointState,
                health: stored.health,
                influence: stored.influence,
                transactions: stored.transactions,
                trade: stored.trade,
                objectives: stored.objectives,
                campaign: undefined as unknown as never,
                rosters: stored.run.rosters,
                ownership: stored.run.ownership,
                rotations: stored.run.rotations,
                effects: stored.effects,
                freeAgency: stored.run.freeAgency,
            });
            if (withoutCampaign === stored.stateDigest) {
                divergences.push({
                    kind: 'campaign-offers',
                    message: 'campaign state divergence: stored digest matches recomputation without campaign',
                });
            }
        }
        catch {
        }
        if (divergences.length === 0) {
            divergences.push({
                kind: 'state-digest',
                message: 'stored stateDigest does not recompute over the stored mutable state',
            });
        }
    }
    if (stored.campaign !== undefined) {
        const campaign = stored.campaign;
        for (const [blockKey, offers] of Object.entries(campaign.offers ?? {})) {
            if (!Array.isArray(offers) || offers.length !== 2) {
                divergences.push({
                    kind: 'campaign-offers',
                    message: `campaign offers for block ${blockKey} must be exactly 2`,
                });
            }
            if (Array.isArray(offers) && offers.length === 2) {
                if (offers[0]?.opportunityId === offers[1]?.opportunityId) {
                    divergences.push({
                        kind: 'campaign-offers',
                        message: `campaign offers for block ${blockKey} are not distinct`,
                    });
                }
            }
        }
        for (const evaluation of campaign.evaluations ?? []) {
            const selection = campaign.selections[evaluation.blockIndex];
            if (!selection || selection.opportunityId !== evaluation.opportunityId) {
                divergences.push({
                    kind: 'campaign-evaluations',
                    message: `campaign evaluation for block ${String(evaluation.blockIndex)} has no matching selection`,
                });
            }
        }
        for (const [branchId, state] of Object.entries(campaign.branchState ?? {})) {
            if (!['open', 'completed', 'missed', 'locked'].includes(state as string)) {
                divergences.push({
                    kind: 'campaign-branch-state',
                    message: `campaign branch ${branchId} has invalid state ${String(state)}`,
                });
            }
        }
        if (campaign.evolutionSelection !== null && campaign.evolutionSelection !== undefined) {
            if (!campaign.evolutionOffers || campaign.evolutionOffers.length === 0) {
                divergences.push({
                    kind: 'campaign-evolution',
                    message: 'campaign evolution selection without offers',
                });
            }
        }
    }
    if (stored.trade !== null) {
        for (const window of stored.trade.windows) {
            if (window.boardProfiles !== undefined) {
                if (window.boardProfiles.length > 8) {
                    divergences.push({
                        kind: 'board-state',
                        message: `trade window ${String(window.windowIndex)} board exceeds 8 teams`,
                    });
                }
                if (window.inquiryAllowance !== undefined &&
                    (window.inquiryAllowance < 3 || window.inquiryAllowance > 5)) {
                    divergences.push({
                        kind: 'board-inquiry-allowance',
                        message: `trade window ${String(window.windowIndex)} inquiry allowance out of range`,
                    });
                }
                if (window.negotiations) {
                    const active = window.negotiations.filter((n) => n.status === 'active' || n.status === 'countered');
                    if (active.length > 1) {
                        divergences.push({
                            kind: 'board-negotiation-state',
                            message: `trade window ${String(window.windowIndex)} has more than one active negotiation`,
                        });
                    }
                    for (const negotiation of window.negotiations) {
                        if (negotiation.exchangeCount !== negotiation.exchanges.length) {
                            divergences.push({
                                kind: 'ai-response',
                                message: `negotiation ${negotiation.inquiryId} exchangeCount mismatch`,
                            });
                        }
                        if (negotiation.exchangeCount > 3) {
                            divergences.push({
                                kind: 'ai-counter',
                                message: `negotiation ${negotiation.inquiryId} exceeds 3 exchanges`,
                            });
                        }
                    }
                }
                if (window.valueTrends !== undefined && window.valueTrends.length > 450) {
                    divergences.push({
                        kind: 'board-value-trends',
                        message: `trade window ${String(window.windowIndex)} valueTrends exceeds 450`,
                    });
                }
            }
        }
    }
    for (const injury of stored.health.injuries) {
        if ((injury as unknown as {
            rehabModifier?: unknown;
        }).rehabModifier === undefined) {
            divergences.push({
                kind: 'rehab-outcome',
                message: `injury ${injury.injuryId} missing rehabModifier (health-v2)`,
            });
        }
    }
    for (const entry of stored.influence.ledger) {
        if (entry.source === 'trade-cash-sent' || entry.source === 'trade-cash-received') {
            if (Math.abs(entry.appliedDelta) > 2) {
                divergences.push({
                    kind: 'ai-transaction',
                    message: `influence ledger entry ${entry.entryId} trade cash exceeds 2`,
                });
            }
        }
    }
    return divergences;
}
export function replayDivergenceMessage(kind: ReplayDivergenceKind): string {
    switch (kind) {
        case 'campaign-offers':
            return 'Campaign offers do not recompute deterministically';
        case 'campaign-evaluations':
            return 'Campaign evaluations do not align with selections';
        case 'campaign-branch-state':
            return 'Campaign branch state is inconsistent';
        case 'campaign-evolution':
            return 'Campaign evolution state is inconsistent';
        case 'board-state':
            return 'Trade board state does not recompute';
        case 'board-inquiry-allowance':
            return 'Trade board inquiry allowance is invalid';
        case 'board-negotiation-state':
            return 'Trade board negotiation state is invalid';
        case 'board-value-trends':
            return 'Trade board value trends exceed bounds';
        case 'ai-response':
            return 'AI response does not recompute';
        case 'ai-counter':
            return 'AI counter exceeds exchange limit';
        case 'ai-transaction':
            return 'AI transaction accounting does not reconcile';
        case 'rehab-outcome':
            return 'Rehab outcome does not recompute';
        case 'rehab-premium':
            return 'Rehab premium basis points are incorrect';
        case 'trade-grade':
            return 'Trade grade does not recompute';
        case 'state-digest':
            return 'State digest does not recompute';
        case 'command-log-digest':
            return 'Command log digest does not recompute';
        default:
            return `replay divergence: ${kind}`;
    }
}
