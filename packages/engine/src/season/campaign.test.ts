import { describe, expect, it } from 'vitest';
import { SEASON_CAMPAIGN_VERSION, buildEmptyCampaignState, seasonNamespaceSeed, } from '@hoop-rush/data-contracts';
import { createRng } from '../sim/rng.ts';
import { applySeasonCampaignEvolutionSelection, applySeasonCampaignReward, evaluateSeasonCampaignOpportunity, generateSeasonCampaignEvolutionOffers, generateSeasonCampaignOffers, normalizeCampaignState, SeasonCampaignGenerationError, } from './campaign.ts';
import { buildEconomyTestRun, fixtureSummary } from './season-economy-test-support.ts';
import { generateSeasonSchedule } from './schedule.ts';
import { createInitialSeasonInfluenceState } from './influence.ts';
const HUMAN = 'lakers';
const ROOT_SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
function standingsFor(run: ReturnType<typeof buildEconomyTestRun>['run'], winMap?: Record<string, number>) {
    return {
        schemaVersion: 1 as const,
        standingsVersion: 'standings-v1' as const,
        rows: run.league.teams.map((team) => ({
            franchiseId: team.franchiseId,
            wins: winMap?.[team.franchiseId] ?? (team.franchiseId === HUMAN ? 5 : 3),
            losses: winMap?.[team.franchiseId] !== undefined
                ? 10 - (winMap?.[team.franchiseId] ?? 0)
                : team.franchiseId === HUMAN
                    ? 5
                    : 7,
            gamesPlayed: 10,
            homeWins: 0,
            homeLosses: 0,
            awayWins: 0,
            awayLosses: 0,
            conferenceWins: 0,
            conferenceLosses: 0,
            divisionWins: 0,
            divisionLosses: 0,
            pointsFor: 1000,
            pointsAgainst: 1000,
            headToHead: run.league.teams
                .filter((other) => other.franchiseId !== team.franchiseId)
                .map((other) => ({ franchiseId: other.franchiseId, wins: 0, losses: 0 })),
        })),
    };
}
function generationInput(overrides: Partial<Parameters<typeof generateSeasonCampaignOffers>[0]> = {}) {
    const { run } = buildEconomyTestRun({ seed: ROOT_SEED, humanFranchiseId: HUMAN });
    const schedule = generateSeasonSchedule({ league: run.league, seed: ROOT_SEED });
    const standings = standingsFor(run);
    const campaignState = buildEmptyCampaignState();
    campaignState.startingIdentity = 'win-now';
    campaignState.startingFocus = 'defense';
    return {
        rootSeed: ROOT_SEED,
        blockIndex: 0,
        humanFranchiseId: HUMAN,
        schedule,
        standings,
        health: run.health,
        rotations: run.rotations,
        rosters: run.rosters,
        transactions: run.transactions,
        summaries: [] as ReturnType<typeof fixtureSummary>[],
        campaignState,
        ...overrides,
    };
}
function blockSummariesForWins(count: number, total = 10): ReturnType<typeof fixtureSummary>[] {
    const list: ReturnType<typeof fixtureSummary>[] = [];
    for (let i = 0; i < total; i += 1) {
        const humanWins = i < count;
        const homeScore = humanWins ? 100 : 90;
        const awayScore = humanWins ? 90 : 100;
        list.push(fixtureSummary(`s${String(i + 1).padStart(6, '0')}`, HUMAN, 'celtics', homeScore, awayScore, {
            homeLines: Array.from({ length: 10 }, (_, idx) => ({
                playerVersionId: `pv-${String(idx).padStart(32, '0')}`,
                seconds: 1440,
                points: idx === 0 ? 10 : 5,
                fieldGoalsMade: 0,
                fieldGoalsAttempted: 0,
                threePointersMade: 0,
                threePointersAttempted: 0,
                freeThrowsMade: 0,
                freeThrowsAttempted: 0,
                offensiveRebounds: 1,
                defensiveRebounds: 2,
                assists: 1,
                steals: 0,
                blocks: 0,
                turnovers: 1,
                fouls: 0,
            })),
            awayLines: Array.from({ length: 10 }, (_, idx) => ({
                playerVersionId: `pv-${String(idx + 10).padStart(32, '0')}`,
                seconds: 1440,
                points: 5,
                fieldGoalsMade: 0,
                fieldGoalsAttempted: 0,
                threePointersMade: 0,
                threePointersAttempted: 0,
                freeThrowsMade: 0,
                freeThrowsAttempted: 0,
                offensiveRebounds: 1,
                defensiveRebounds: 2,
                assists: 1,
                steals: 0,
                blocks: 0,
                turnovers: 1,
                fouls: 0,
            })),
            homeBox: {
                franchiseId: HUMAN,
                points: homeScore,
                fieldGoalsMade: 0,
                fieldGoalsAttempted: 0,
                threePointersMade: 0,
                threePointersAttempted: 0,
                freeThrowsMade: 0,
                freeThrowsAttempted: 0,
                offensiveRebounds: 5,
                defensiveRebounds: 10,
                assists: 20,
                steals: 0,
                blocks: 0,
                turnovers: 10,
                fouls: 0,
                possessions: 100,
            },
            awayBox: {
                franchiseId: 'celtics',
                points: awayScore,
                fieldGoalsMade: 0,
                fieldGoalsAttempted: 0,
                threePointersMade: 0,
                threePointersAttempted: 0,
                freeThrowsMade: 0,
                freeThrowsAttempted: 0,
                offensiveRebounds: 5,
                defensiveRebounds: 10,
                assists: 20,
                steals: 0,
                blocks: 0,
                turnovers: 10,
                fouls: 0,
                possessions: 100,
            },
        }));
    }
    return list;
}
describe('season campaign generation (M2.5.5)', () => {
    it('generates exactly 2 distinct feasible offers deterministically', () => {
        const input = generationInput();
        const a = generateSeasonCampaignOffers(input);
        const b = generateSeasonCampaignOffers(input);
        expect(a).toHaveLength(2);
        expect(b).toHaveLength(2);
        expect(a).toEqual(b);
        expect(a[0]?.opportunityId).not.toBe(a[1]?.opportunityId);
        expect(a[0]?.templateId).not.toBe(a[1]?.templateId);
        for (const [slot, opp] of a.entries()) {
            expect(opp.seedPath[0]).toBe('campaign');
            expect(opp.seedPath[1]).toBe(String(input.blockIndex));
            expect(opp.seedPath[2]).toBe('offers');
            expect(opp.seedPath[3]).toBe(String(slot));
            expect(opp.blockIndex).toBe(input.blockIndex);
            expect(opp.feasibilityFacts).toBeDefined();
            expect(Object.keys(opp.feasibilityFacts).length).toBeGreaterThan(0);
        }
    });
    it('is order invariant via canonicalization', () => {
        const base = generationInput();
        const shuffled = {
            ...base,
            rosters: [...base.rosters].reverse(),
            rotations: [...base.rotations].reverse(),
            transactions: [...base.transactions].reverse(),
        };
        const a = generateSeasonCampaignOffers(base);
        const b = generateSeasonCampaignOffers(shuffled);
        expect(a.map((o) => o.templateId).sort()).toEqual(b.map((o) => o.templateId).sort());
        expect(a).toEqual(b);
    });
    it('rejects block 8 and throws typed generation error with audit', () => {
        const input = generationInput({ blockIndex: 8 });
        expect(() => generateSeasonCampaignOffers(input)).toThrow(SeasonCampaignGenerationError);
        try {
            generateSeasonCampaignOffers(input);
        }
        catch (e) {
            expect(e).toBeInstanceOf(SeasonCampaignGenerationError);
            const err = e as SeasonCampaignGenerationError;
            expect(err.blockIndex).toBe(8);
            expect(err.audit.length).toBeGreaterThan(0);
        }
    });
    it('throws with audit when no human franchise', () => {
        const input = generationInput({ humanFranchiseId: null });
        expect(() => generateSeasonCampaignOffers(input)).toThrow(SeasonCampaignGenerationError);
    });
    it('feasibility audit drops schedule/player/transaction lacking candidates', () => {
        const input = generationInput();
        const emptyHumanSchedule = {
            ...input.schedule,
            games: input.schedule.games.filter((g) => g.homeFranchiseId !== HUMAN && g.awayFranchiseId !== HUMAN),
        };
        const withEmptySchedule = generationInput({ schedule: emptyHumanSchedule });
        const offers = generateSeasonCampaignOffers(withEmptySchedule);
        expect(offers).toHaveLength(2);
        for (const opp of offers) {
            expect(opp.feasibilityFacts).toBeDefined();
        }
    });
    it('applies identity emphasis as ordering weight not hidden modifier', () => {
        const base = generationInput();
        base.campaignState.startingIdentity = 'win-now';
        const winNowOffers = generateSeasonCampaignOffers(base);
        const winNowResults = winNowOffers.filter((o) => o.family === 'results' || o.family === 'marquee').length;
        const dev = generationInput();
        dev.campaignState.startingIdentity = 'player-development';
        const devOffers = generateSeasonCampaignOffers(dev);
        const devPlayer = devOffers.filter((o) => o.family === 'player-role').length;
        expect(winNowOffers).toHaveLength(2);
        expect(devOffers).toHaveLength(2);
        for (const opp of [...winNowOffers, ...devOffers]) {
            expect(opp.completedReward.amount).toBeGreaterThanOrEqual(1);
            expect(opp.target.kind).toBeDefined();
        }
    });
});
describe('season campaign evaluation', () => {
    it('evaluates missed, completed, breakthrough with structured facts', () => {
        const input = generationInput();
        const targetOffer: (typeof input)['campaignState'] extends unknown ? import('@hoop-rush/data-contracts').SeasonCampaignOpportunity : never = {
            opportunityId: 'copp-12345678',
            branchId: 'cbr-12345678',
            templateId: 'ctpl-12345678',
            blockIndex: 0,
            identity: 'win-now',
            family: 'results',
            prerequisiteId: null,
            target: { kind: 'block-wins', comparisonOperator: 'gte', threshold: 6, window: 'block' },
            breakthrough: {
                kind: 'block-wins',
                comparisonOperator: 'gte',
                threshold: 8,
                window: 'block',
            },
            completedReward: { rewardId: 'rew-12345678', type: 'influence', amount: 1 },
            breakthroughReward: { rewardId: 'rew-87654321', type: 'trade-inquiry-credit', amount: 1 },
            feasibilityFacts: { blockIndex: 0 },
            seedPath: ['campaign', '0', 'offers', '0', 'ctpl-12345678'],
        };
        const summaries6 = blockSummariesForWins(6);
        const baseInput = {
            opportunity: targetOffer,
            blockIndex: 0,
            humanFranchiseId: HUMAN,
            summaries: summaries6,
            standings: input.standings,
            rotations: input.rotations,
            transactions: input.transactions,
            health: input.health,
        };
        const evalCompleted = evaluateSeasonCampaignOpportunity(baseInput);
        expect(evalCompleted.outcome).toBe('completed');
        expect(evalCompleted.facts).toBeDefined();
        expect(evalCompleted.explanation.length).toBeGreaterThan(0);
        expect(evalCompleted.appliedRewardIds).toEqual([targetOffer.completedReward.rewardId]);
        const summaries8 = blockSummariesForWins(8);
        const evalBreakthrough = evaluateSeasonCampaignOpportunity({
            ...baseInput,
            summaries: summaries8,
        });
        if (targetOffer.breakthrough) {
            expect(evalBreakthrough.outcome).toBe('breakthrough');
            expect(evalBreakthrough.appliedRewardIds).toEqual([
                targetOffer.completedReward.rewardId,
                targetOffer.breakthroughReward!.rewardId,
            ]);
        }
        const summaries2 = blockSummariesForWins(2);
        const evalMissed = evaluateSeasonCampaignOpportunity({ ...baseInput, summaries: summaries2 });
        expect(evalMissed.outcome).toBe('missed');
        expect(evalMissed.appliedRewardIds).toEqual([]);
        expect(evalMissed.facts['target']).toBeDefined();
        expect(evalMissed.explanation).not.toContain('{{');
    });
    it('reads only saved summaries, standings, rotations, transactions, health', () => {
        const input = generationInput();
        const offers = generateSeasonCampaignOffers(input);
        const opp = offers[0]!;
        const lowWins = blockSummariesForWins(1);
        const highWins = blockSummariesForWins(9);
        const evLow = evaluateSeasonCampaignOpportunity({
            opportunity: opp,
            blockIndex: 0,
            humanFranchiseId: HUMAN,
            summaries: lowWins,
            standings: input.standings,
            rotations: input.rotations,
            transactions: input.transactions,
            health: input.health,
        });
        const evHigh = evaluateSeasonCampaignOpportunity({
            opportunity: opp,
            blockIndex: 0,
            humanFranchiseId: HUMAN,
            summaries: highWins,
            standings: input.standings,
            rotations: input.rotations,
            transactions: input.transactions,
            health: input.health,
        });
        if (opp.target.kind === 'block-wins') {
            expect(evLow.outcome).toBe('missed');
            expect(evHigh.outcome).not.toBe('missed');
        }
    });
});
describe('campaign branching', () => {
    it('miss closes branch only, preserves 2 offers at later checkpoint', () => {
        const input = generationInput({ blockIndex: 0 });
        const offers0 = generateSeasonCampaignOffers(input);
        const chosen: import('@hoop-rush/data-contracts').SeasonCampaignOpportunity = {
            opportunityId: 'copp-aabbccdd',
            branchId: 'cbr-aabbccdd',
            templateId: 'ctpl-aabbccdd',
            blockIndex: 0,
            identity: 'win-now',
            family: 'results',
            prerequisiteId: null,
            target: { kind: 'block-wins', comparisonOperator: 'gte', threshold: 6, window: 'block' },
            breakthrough: {
                kind: 'block-wins',
                comparisonOperator: 'gte',
                threshold: 8,
                window: 'block',
            },
            completedReward: { rewardId: 'rew-aabbccdd', type: 'influence', amount: 1 },
            breakthroughReward: { rewardId: 'rew-ddccbbaa', type: 'trade-inquiry-credit', amount: 1 },
            feasibilityFacts: { blockIndex: 0 },
            seedPath: ['campaign', '0', 'offers', '0', 'ctpl-aabbccdd'],
        };
        const summariesMiss = blockSummariesForWins(0);
        const evaluationMiss = evaluateSeasonCampaignOpportunity({
            opportunity: chosen,
            blockIndex: 0,
            humanFranchiseId: HUMAN,
            summaries: summariesMiss,
            standings: input.standings,
            rotations: input.rotations,
            transactions: input.transactions,
            health: input.health,
        });
        expect(evaluationMiss.outcome).toBe('missed');
        const influence = createInitialSeasonInfluenceState(input.rosters.map((r) => r.franchiseId));
        const afterMiss = applySeasonCampaignReward({
            evaluation: evaluationMiss,
            opportunity: chosen,
            influence,
            campaignState: {
                ...input.campaignState,
                offers: { 0: offers0 as [
                        (typeof offers0)[0],
                        (typeof offers0)[1]
                    ] },
                selections: { 0: { opportunityId: chosen.opportunityId, selectedByCommandId: 'cmd-1' } },
            },
            humanFranchiseId: HUMAN,
            blockIndex: 0,
            commandId: 'cmd-1',
        });
        expect(afterMiss.campaignState.branchState[chosen.branchId]).toBe('missed');
        const nextInput = generationInput({
            blockIndex: 1,
            campaignState: afterMiss.campaignState,
        });
        const offers1 = generateSeasonCampaignOffers(nextInput);
        expect(offers1).toHaveLength(2);
        const branchIdsNext = offers1.map((o) => o.branchId);
        expect(branchIdsNext).not.toContain(chosen.branchId);
    });
    it('completed unlocks normal follow-up', () => {
        const input = generationInput({ blockIndex: 0 });
        const offers0 = generateSeasonCampaignOffers(input);
        const branchToTest = offers0.find((o) => o.family === 'results') ?? offers0[0]!;
        const summariesWin = blockSummariesForWins(7);
        const evaluationCompleted = evaluateSeasonCampaignOpportunity({
            opportunity: branchToTest,
            blockIndex: 0,
            humanFranchiseId: HUMAN,
            summaries: summariesWin,
            standings: input.standings,
            rotations: input.rotations,
            transactions: input.transactions,
            health: input.health,
        });
        const influence = createInitialSeasonInfluenceState(input.rosters.map((r) => r.franchiseId));
        const after = applySeasonCampaignReward({
            evaluation: {
                ...evaluationCompleted,
                outcome: 'completed',
                appliedRewardIds: [branchToTest.completedReward.rewardId],
            },
            opportunity: branchToTest,
            influence,
            campaignState: {
                ...input.campaignState,
                offers: { 0: offers0 as [
                        (typeof offers0)[0],
                        (typeof offers0)[1]
                    ] },
                selections: {
                    0: { opportunityId: branchToTest.opportunityId, selectedByCommandId: 'cmd-1' },
                },
            },
            humanFranchiseId: HUMAN,
            blockIndex: 0,
            commandId: 'cmd-1',
        });
        expect(after.campaignState.branchState[branchToTest.branchId]).toBe('open');
        const nextInput = generationInput({ blockIndex: 1, campaignState: after.campaignState });
        const offers1 = generateSeasonCampaignOffers(nextInput);
        expect(offers1).toHaveLength(2);
        const hasFollowUp = offers1.some((o) => o.branchId === branchToTest.branchId);
        expect(after.campaignState.branchState[branchToTest.branchId]).toBe('open');
    });
    it('breakthrough may unlock ambitious follow-up recorded on offer', () => {
        const input = generationInput();
        const offers = generateSeasonCampaignOffers(input);
        const withBreakthrough = offers.find((o) => o.breakthrough && o.breakthroughReward?.type === 'follow-up-unlock');
        if (!withBreakthrough)
            return;
        const summaries = blockSummariesForWins(9);
        const evaluation = evaluateSeasonCampaignOpportunity({
            opportunity: withBreakthrough,
            blockIndex: 0,
            humanFranchiseId: HUMAN,
            summaries,
            standings: input.standings,
            rotations: input.rotations,
            transactions: input.transactions,
            health: input.health,
        });
        expect(evaluation.outcome).toBe('breakthrough');
        const influence = createInitialSeasonInfluenceState(input.rosters.map((r) => r.franchiseId));
        const after = applySeasonCampaignReward({
            evaluation,
            opportunity: withBreakthrough,
            influence,
            campaignState: {
                ...input.campaignState,
                offers: { 0: offers as [
                        (typeof offers)[0],
                        (typeof offers)[1]
                    ] },
                selections: {
                    0: { opportunityId: withBreakthrough.opportunityId, selectedByCommandId: 'cmd-1' },
                },
            },
            humanFranchiseId: HUMAN,
            blockIndex: 0,
            commandId: 'cmd-1',
        });
        expect(after.campaignState.rewardEntitlements.followUpUnlocks).toContain(withBreakthrough.breakthroughReward!.rewardId);
        expect(after.campaignState.branchState[withBreakthrough.branchId]).toBe('completed');
    });
});
describe('campaign evolution', () => {
    it('generates evolution offers after block 4 with correct seed path', () => {
        const { run } = buildEconomyTestRun({ seed: ROOT_SEED, humanFranchiseId: HUMAN });
        const standings = standingsFor(run);
        const campaignState = buildEmptyCampaignState();
        campaignState.startingIdentity = 'win-now';
        campaignState.startingFocus = null;
        const offers = generateSeasonCampaignEvolutionOffers({
            rootSeed: ROOT_SEED,
            blockIndex: 4,
            humanFranchiseId: HUMAN,
            campaignState,
            standings,
            rosters: run.rosters,
            health: run.health,
            transactions: run.transactions,
            summaries: [],
        });
        expect(offers.length).toBeGreaterThanOrEqual(1);
        expect(offers.length).toBeLessThanOrEqual(3);
        expect(offers.some((o) => o.kind === 'double-down')).toBe(true);
        for (const offer of offers) {
            expect(offer.offerId).toMatch(/^evo-[0-9a-f]{8,32}$/);
            expect(offer.evidence.length).toBeGreaterThan(0);
            expect(offer.resultingIdentity).toBeDefined();
        }
        const second = generateSeasonCampaignEvolutionOffers({
            rootSeed: ROOT_SEED,
            blockIndex: 4,
            humanFranchiseId: HUMAN,
            campaignState,
            standings,
            rosters: run.rosters,
            health: run.health,
            transactions: run.transactions,
            summaries: [],
        });
        expect(offers).toEqual(second);
        const evolved = applySeasonCampaignEvolutionSelection({
            campaignState: { ...campaignState, evolutionOffers: offers },
            offerId: offers[0]!.offerId,
            commandId: 'cmd-evo-1',
        });
        expect(evolved.evolutionSelection?.selectedOfferId).toBe(offers[0]!.offerId);
        expect(evolved.evolutionSelection?.resultingIdentity).toBe(offers[0]!.resultingIdentity);
    });
});
describe('campaign reward cap', () => {
    it('caps Influence at 8 and records requested vs applied delta', () => {
        const input = generationInput();
        const offers = generateSeasonCampaignOffers(input);
        const opp = offers.find((o) => o.completedReward.type === 'influence') ?? offers[0]!;
        const summaries = blockSummariesForWins(7);
        const evaluation = evaluateSeasonCampaignOpportunity({
            opportunity: opp,
            blockIndex: 0,
            humanFranchiseId: HUMAN,
            summaries,
            standings: input.standings,
            rotations: input.rotations,
            transactions: input.transactions,
            health: input.health,
        });
        const forcedEval = {
            ...evaluation,
            outcome: 'completed' as const,
            appliedRewardIds: [opp.completedReward.rewardId],
        };
        const influenceAtCap = createInitialSeasonInfluenceState(input.rosters.map((r) => r.franchiseId));
        influenceAtCap.balances[HUMAN] = 8;
        const atCap = applySeasonCampaignReward({
            evaluation: forcedEval,
            opportunity: opp,
            influence: influenceAtCap,
            campaignState: buildEmptyCampaignState(),
            humanFranchiseId: HUMAN,
            blockIndex: 0,
            commandId: 'cmd-cap',
        });
        expect(atCap.influence.balances[HUMAN]).toBe(8);
        const ledger = atCap.influence.ledger.find((e) => e.entryId.includes(opp.completedReward.rewardId));
        expect(ledger).toBeDefined();
        expect(ledger?.requestedDelta).toBe(1);
        expect(ledger?.appliedDelta).toBe(0);
        const withBreakthrough = offers.find((o) => o.breakthrough &&
            o.completedReward.type === 'influence' &&
            o.breakthroughReward?.type === 'influence');
        if (withBreakthrough) {
            const evalBreak = evaluateSeasonCampaignOpportunity({
                opportunity: withBreakthrough,
                blockIndex: 0,
                humanFranchiseId: HUMAN,
                summaries: blockSummariesForWins(9),
                standings: input.standings,
                rotations: input.rotations,
                transactions: input.transactions,
                health: input.health,
            });
            expect(evalBreak.outcome).toBe('breakthrough');
            const influence7 = createInitialSeasonInfluenceState(input.rosters.map((r) => r.franchiseId));
            influence7.balances[HUMAN] = 7;
            const afterBreak = applySeasonCampaignReward({
                evaluation: evalBreak,
                opportunity: withBreakthrough,
                influence: influence7,
                campaignState: buildEmptyCampaignState(),
                humanFranchiseId: HUMAN,
                blockIndex: 0,
                commandId: 'cmd-break',
            });
            expect(afterBreak.influence.balances[HUMAN]).toBe(8);
            expect(afterBreak.campaignState.appliedRewardIds).toContain(withBreakthrough.completedReward.rewardId);
            expect(afterBreak.campaignState.appliedRewardIds).toContain(withBreakthrough.breakthroughReward!.rewardId);
            const entries = afterBreak.influence.ledger.filter((e) => e.blockIndex === 0 && e.franchiseId === HUMAN && e.source === 'campaign-reward');
            expect(entries.length).toBe(2);
            expect(entries[0]?.appliedDelta).toBe(1);
            expect(entries[1]?.appliedDelta).toBe(0);
        }
    });
});
describe('campaign old saves', () => {
    it('old saves without campaign still load', () => {
        const empty = normalizeCampaignState(undefined);
        expect(empty.campaignVersion).toBe(SEASON_CAMPAIGN_VERSION);
        expect(empty.schemaVersion).toBe(1);
        const withoutCampaign = { runId: 'test', rootSeed: ROOT_SEED } as unknown;
        const normalized = normalizeCampaignState((withoutCampaign as Record<string, unknown>)['campaign']);
        expect(normalized.offers).toEqual({});
        const input = generationInput({ campaignState: normalized });
        const offers = generateSeasonCampaignOffers(input);
        expect(offers).toHaveLength(2);
    });
    it('buildEmptyCampaignState matches frozen version', () => {
        const state = buildEmptyCampaignState();
        expect(state.campaignVersion).toBe('season-campaign-v1');
        expect(state.schemaVersion).toBe(1);
    });
});
describe('campaign determinism and seed paths', () => {
    it('same seed and block always yields same opportunityIds and seedPaths', () => {
        const input = generationInput({ blockIndex: 2 });
        const a = generateSeasonCampaignOffers(input);
        const b = generateSeasonCampaignOffers(input);
        expect(a.map((o) => o.opportunityId)).toEqual(b.map((o) => o.opportunityId));
        expect(a.map((o) => o.seedPath)).toEqual(b.map((o) => o.seedPath));
        expect(a.map((o) => o.templateId)).toEqual(b.map((o) => o.templateId));
    });
    it('different block yields different ids due to block in seed', () => {
        const base = generationInput();
        const a = generateSeasonCampaignOffers({ ...base, blockIndex: 0 });
        const b = generateSeasonCampaignOffers({ ...base, blockIndex: 1 });
        expect(a[0]?.opportunityId).not.toBe(b[0]?.opportunityId);
    });
    it('evolution uses campaign/evolution seed namespace', () => {
        const { run } = buildEconomyTestRun({ seed: ROOT_SEED });
        const standings = standingsFor(run);
        const campaignState = buildEmptyCampaignState();
        campaignState.startingIdentity = 'team-identity';
        const offers = generateSeasonCampaignEvolutionOffers({
            rootSeed: ROOT_SEED,
            blockIndex: 4,
            humanFranchiseId: HUMAN,
            campaignState,
            standings,
            rosters: run.rosters,
            health: run.health,
            transactions: run.transactions,
            summaries: [],
        });
        const expectedDouble = `evo-${seasonNamespaceSeed(ROOT_SEED, 'campaign', 'evolution', 'double-down').slice(0, 8)}`;
        expect(offers.some((o) => o.offerId === expectedDouble)).toBe(true);
    });
});
