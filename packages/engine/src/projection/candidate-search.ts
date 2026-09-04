import type { EraSimulationProfile, Position, ProjectionModelArtifact, SeasonDraftCatalog, SeasonRotation, SimulationPlayer, } from '@hoop-rush/data-contracts';
import { SEASON_MINUTE_POLICY_VERSION, SEASON_ROTATION_VERSION, franchiseIdSchema, playerIdSchema, seasonDigestHex, } from '@hoop-rush/data-contracts';
import { enumerateLegalFives, type PlannerMember } from '../season/rotation-planner.ts';
import { buildMinutePlanCandidates, minutePlanHorizonGames, type MinutePlanPlayerInput, } from '../season/minute-plan.ts';
import { completionTargetsMet, legalFiveAfterAnyRemoval, legalFiveExists, rosterFeasible, validateSeasonRoster, type SeasonRosterMemberInput, } from '../season/roster-rules.ts';
import { ProjectionCache } from './cache.ts';
import { projectedQualityWeights } from './minute-plan-quality.ts';
import { projectSeasonRoster } from './season.ts';
import { rankCandidates, type RankedCandidate, type RankingGates, type RejectedCandidate, } from './ranking.ts';
export type SearchLens = 'offense' | 'defense' | 'spacing' | 'creation' | 'rebounding' | 'depth' | 'balance' | 'matchup-robustness';
export const SEARCH_LENSES: readonly SearchLens[] = [
    'offense',
    'defense',
    'spacing',
    'creation',
    'rebounding',
    'depth',
    'balance',
    'matchup-robustness',
];
export interface RosterRotationSearchInput {
    catalog: SeasonDraftCatalog;
    locked: readonly string[];
    available: readonly string[];
    seed: string;
    eraProfile: EraSimulationProfile;
    model: ProjectionModelArtifact;
    lens?: SearchLens;
    gates?: Partial<RankingGates>;
    caps?: {
        completeCandidates?: number;
        rotationsPerRoster?: number;
    };
    load?: ReadonlyMap<string, {
        staminaRating: number;
        durability: number;
    }>;
}
export interface SearchAudit {
    seed: string;
    seedNamespace: string;
    lens: SearchLens;
    nodeCount: number;
    nodeBudget: number;
    cacheHits: number;
    cacheMisses: number;
    partialBeams: number;
    completeRosters: number;
    rotationsEvaluated: number;
    rejected: RejectedCandidate[];
    paretoSurvivors: number;
    selectedCandidateId: string | null;
}
export interface RosterRotationSearchResult {
    ranked: SearchedCandidate[];
    audit: SearchAudit;
    feasibilityFailure: {
        code: string;
        message: string;
    } | null;
}
export type HumanRosterBuildInput = RosterRotationSearchInput;
export interface HumanRosterBuildResult {
    ok: boolean;
    roster: readonly string[] | null;
    rotation: SeasonRotation | null;
    projection: RankedCandidate['projection'] | null;
    ranked: RankedCandidate[];
    audit: SearchAudit;
    feasibilityFailure: {
        code: string;
        message: string;
    } | null;
}
export interface SearchedCandidate extends RankedCandidate {
    rotation: SeasonRotation;
}
interface SearchableCandidate {
    candidateId: string;
    projection: RankedCandidate['projection'];
    rotation: SeasonRotation;
    gates: RankingGates;
}
interface CatalogMember {
    playerVersionId: string;
    playable: readonly Position[];
    player: SimulationPlayer;
    staminaRating: number;
    durability: number;
}
function orderRank(seed: string, namespace: string, versionId: string): number {
    const digest = seasonDigestHex(`${namespace}\u0000${seed}\u0000${versionId}`);
    return (digest.charCodeAt(0) * 16777216 +
        digest.charCodeAt(2) * 65536 +
        digest.charCodeAt(4) * 256 +
        digest.charCodeAt(6));
}
function lensScoreOf(member: CatalogMember, lens: SearchLens): number {
    const r = member.player.ratings;
    const t = member.player.tendencies;
    switch (lens) {
        case 'offense':
            return r.threePoint + r.insideScoring + r.midrange + r.ballHandling + r.passing;
        case 'defense':
            return r.perimeterDefense + r.interiorDefense + r.steal + r.block + r.defensiveIq;
        case 'spacing':
            return r.threePoint * (0.4 + 0.6 * (t.threePointRate / 100));
        case 'creation':
            return r.ballHandling + r.passing + r.offensiveIq;
        case 'rebounding':
            return r.offensiveRebound + r.defensiveRebound + r.vertical;
        case 'depth':
            return r.insideScoring + r.threePoint + r.perimeterDefense + r.interiorDefense;
        case 'balance':
            return Math.abs((r.insideScoring + r.threePoint) / 2 - (r.perimeterDefense + r.interiorDefense) / 2);
        case 'matchup-robustness':
            return r.perimeterDefense + r.interiorDefense + r.steal + r.ballHandling;
    }
}
function catalogMembers(catalog: SeasonDraftCatalog): Map<string, CatalogMember> {
    const members = new Map<string, CatalogMember>();
    for (const candidate of catalog.candidates) {
        const player: SimulationPlayer = {
            playerId: candidate.playerId,
            playerVersionId: candidate.playerVersionId,
            displayName: candidate.displayName,
            positions: candidate.positions.playable,
            heightInches: candidate.heightInches,
            weightLbs: candidate.weightLbs,
            ratings: candidate.detailedRatings,
            tendencies: candidate.tendencies,
            ...(candidate.anchors !== undefined ? { anchors: candidate.anchors } : {}),
            ...(candidate.reconstructedThreePoint !== undefined
                ? { reconstructedThreePoint: candidate.reconstructedThreePoint }
                : {}),
        };
        members.set(candidate.playerVersionId, {
            playerVersionId: candidate.playerVersionId,
            playable: candidate.positions.playable,
            player,
            staminaRating: candidate.stamina.rating,
            durability: candidate.durability.rating,
        });
    }
    return members;
}
function rosterInputMembers(versionIds: readonly string[], members: ReadonlyMap<string, CatalogMember>): SeasonRosterMemberInput[] {
    const out: SeasonRosterMemberInput[] = [];
    for (const id of versionIds) {
        const member = members.get(id);
        if (member !== undefined)
            out.push({ playerVersionId: id, playable: member.playable });
    }
    return out;
}
function benchOrdersOf(input: {
    roster: readonly string[];
    starters: readonly string[];
    members: ReadonlyMap<string, CatalogMember>;
    lens: SearchLens;
    cap: number;
}): string[][] {
    const { roster, starters, members, lens, cap } = input;
    const bench = roster.filter((id) => !starters.includes(id));
    const byLens = (selector: (member: CatalogMember) => number) => [...bench].sort((a, b) => selector(members.get(b) ?? benchMember(b)) - selector(members.get(a) ?? benchMember(b)));
    const orders: string[][] = [];
    const push = (order: string[]) => {
        if (orders.length >= cap)
            return;
        if (!orders.some((existing) => existing.join(',') === order.join(',')))
            orders.push(order);
    };
    push(bench);
    push(byLens((member) => lensScoreOf(member, lens)));
    push(byLens((member) => member.player.ratings.ballHandling +
        member.player.ratings.passing +
        member.player.ratings.offensiveIq));
    push(byLens((member) => member.player.ratings.perimeterDefense +
        member.player.ratings.interiorDefense +
        member.player.ratings.block));
    return orders.slice(0, cap);
}
function benchMember(versionId: string): CatalogMember {
    return {
        playerVersionId: versionId,
        playable: [],
        staminaRating: 70,
        durability: 70,
        player: {
            playerId: playerIdSchema.parse(versionId),
            displayName: versionId,
            positions: [],
            heightInches: null,
            weightLbs: null,
            ratings: {
                insideScoring: 50,
                closeShot: 50,
                midrange: 50,
                threePoint: 50,
                freeThrow: 50,
                ballHandling: 50,
                passing: 50,
                offensiveIq: 50,
                offensiveRebound: 50,
                defensiveRebound: 50,
                perimeterDefense: 50,
                interiorDefense: 50,
                steal: 50,
                block: 50,
                defensiveIq: 50,
                speed: 50,
                strength: 50,
                vertical: 50,
            },
            tendencies: {
                usageRate: 20,
                passRate: 30,
                shotRate: 25,
                driveRate: 18,
                postUpRate: 5,
                rimFrequency: 30,
                shortMidFrequency: 20,
                longMidFrequency: 14,
                cornerThreeFrequency: 8,
                aboveBreakThreeFrequency: 12,
                threePointRate: 20,
                freeThrowRate: 22,
                turnoverRate: 12,
                isolationRate: 10,
                pickAndRollBallHandlerRate: 25,
                pickAndRollRollManRate: 10,
                spotUpRate: 20,
                transitionRate: 15,
                cutRate: 10,
                foulRate: 2,
                stealAttemptRate: 8,
                blockAttemptRate: 10,
                crashOffensiveGlassRate: 12,
            },
        },
    };
}
function rotationsFor(input: {
    roster: readonly string[];
    members: ReadonlyMap<string, CatalogMember>;
    lens: SearchLens;
    startingFivesCap: number;
    closingFivesCap: number;
    benchHierarchiesCap: number;
    minuteTemplatesCap: number;
    rotationsCap: number;
    eraProfile: EraSimulationProfile;
    model: ProjectionModelArtifact;
    cache: ProjectionCache;
    load?: ReadonlyMap<string, {
        staminaRating: number;
        durability: number;
    }>;
}): SeasonRotation[] {
    const { roster, members, lens, rotationsCap } = input;
    const plannerMembers: PlannerMember[] = [...roster]
        .map((id) => ({ playerVersionId: id, playable: members.get(id)?.playable ?? [] }))
        .sort((a, b) => (a.playerVersionId < b.playerVersionId ? -1 : 1));
    const all = new Set(roster);
    const allFives = enumerateLegalFives(plannerMembers, all);
    const starters = allFives.slice(0, input.startingFivesCap);
    if (starters.length === 0)
        return [];
    const closers = allFives.slice(0, input.closingFivesCap);
    const benchOrders = benchOrdersOf({
        roster,
        starters: starters[0] ?? [],
        members,
        lens,
        cap: input.benchHierarchiesCap,
    });
    if (benchOrders.length === 0)
        return [];
    const planCount = Math.min(3, input.minuteTemplatesCap);
    const playerOf = (id: string) => members.get(id)?.player ?? benchMember(id).player;
    const rotations: SeasonRotation[] = [];
    const seen = new Set<string>();
    const structureBound = input.startingFivesCap * input.closingFivesCap * input.benchHierarchiesCap;
    for (const starter of starters) {
        for (const closer of closers) {
            for (const benchOrder of benchOrders) {
                if (rotations.length >= structureBound)
                    break;
                if (new Set([...starter, ...benchOrder]).size !== roster.length)
                    continue;
                const orderedRoster = [...starter, ...benchOrder];
                const structureRotation: SeasonRotation = {
                    franchiseId: franchiseIdSchema.parse('roster'),
                    starters: starter,
                    benchOrder,
                    targetMinutes: orderedRoster.map((playerVersionId) => ({
                        playerVersionId,
                        minutes: 24,
                    })),
                    closingFive: closer,
                    minutePolicy: { policyVersion: SEASON_MINUTE_POLICY_VERSION, strategy: 'balanced' },
                    rotationVersion: SEASON_ROTATION_VERSION,
                };
                const players = orderedRoster.map((id) => playerOf(id));
                const qualityByVersion = projectedQualityWeights({
                    players,
                    byVersion: new Map(orderedRoster.map((id) => [id, playerOf(id)])),
                    rotation: structureRotation,
                    eraProfile: input.eraProfile,
                    model: input.model,
                    cache: input.cache,
                });
                const minutePlanPlayers = new Map<string, MinutePlanPlayerInput>();
                for (const id of orderedRoster) {
                    const member = members.get(id) ?? benchMember(id);
                    const load = input.load?.get(id);
                    minutePlanPlayers.set(id, {
                        playerVersionId: id,
                        quality: qualityByVersion.get(id) ?? 0.5,
                        staminaRating: load?.staminaRating ?? member.staminaRating,
                        durability: load?.durability ?? member.durability,
                        fatigueBasisPoints: 0,
                        recentLoadBasisPoints: 0,
                    });
                }
                const plans = buildMinutePlanCandidates({
                    structure: { starters: starter, benchOrder, closingFive: closer },
                    players: minutePlanPlayers,
                    horizon: minutePlanHorizonGames(82),
                }).plans.slice(0, planCount);
                for (const plan of plans) {
                    const rotation = plan.rotation;
                    const key = JSON.stringify([starter, closer, benchOrder, rotation.targetMinutes]);
                    if (seen.has(key))
                        continue;
                    seen.add(key);
                    rotations.push(rotation);
                    if (rotations.length >= rotationsCap)
                        break;
                }
                if (rotations.length >= rotationsCap)
                    break;
            }
            if (rotations.length >= rotationsCap)
                break;
        }
        if (rotations.length >= rotationsCap)
            break;
    }
    return rotations;
}
export function searchRosterRotationCandidates(input: RosterRotationSearchInput): RosterRotationSearchResult {
    const seedNamespace = input.model.search.seedNamespace;
    const lens = input.lens ?? 'balance';
    const members = catalogMembers(input.catalog);
    const cache = new ProjectionCache();
    const locked = [...input.locked];
    const available = input.available.filter((id) => !locked.includes(id));
    const ownedInput = rosterInputMembers(locked, members);
    const availableInput = rosterInputMembers(available, members);
    const remaining = 10 - locked.length;
    const failure = (code: string, message: string): RosterRotationSearchResult => ({
        ranked: [],
        audit: emptyAudit(input.seed, seedNamespace, lens),
        feasibilityFailure: { code, message },
    });
    if (remaining < 0) {
        return failure('TOO_MANY_LOCKED', `more than ten locked picks (${String(locked.length)})`);
    }
    if (!rosterFeasible(ownedInput, availableInput, remaining)) {
        return failure('NO_FEASIBLE_COMPLETION', 'no legal completion exists with the locked picks and the available catalog under the 4/4/3 targets');
    }
    const budget = input.model.search.nodeBudgets.partial;
    let nodeCount = 0;
    const partialBeamsCap = input.model.search.partialBeamsPerLens;
    const rankOf = new Map<string, number>();
    for (const id of available) {
        rankOf.set(id, orderRank(input.seed, seedNamespace, id));
    }
    const orderedAvailable = [...available].sort((a, b) => (rankOf.get(a) ?? 0) - (rankOf.get(b) ?? 0) || (a < b ? -1 : 1));
    let beams: string[][] = [locked];
    const complete = new Map<string, string[]>();
    for (let size = locked.length; size < 10; size += 1) {
        const next = new Map<string, string[]>();
        for (const beam of beams) {
            nodeCount += 1;
            if (nodeCount > budget)
                break;
            for (const id of orderedAvailable) {
                if (beam.includes(id))
                    continue;
                const state = [...beam, id].sort();
                const key = state.join(',');
                if (next.has(key) || complete.has(key))
                    continue;
                const stateMembers = rosterInputMembers(state, members);
                if (size + 1 < 10 &&
                    !rosterFeasible(stateMembers, availableInput, 10 - stateMembers.length)) {
                    continue;
                }
                if (stateMembers.length >= 5 && !legalFiveExists(stateMembers))
                    continue;
                if (stateMembers.length === 10) {
                    if (!completionTargetsMet(stateMembers))
                        continue;
                    if (!legalFiveAfterAnyRemoval(stateMembers))
                        continue;
                    complete.set(key, state);
                    continue;
                }
                next.set(key, state);
            }
        }
        if (nodeCount > budget)
            break;
        const scored = [...next.values()]
            .map((state) => ({
            state,
            score: state.reduce((sum, id) => sum + lensScoreOf(members.get(id) ?? benchMember(id), lens), 0),
        }))
            .sort((a, b) => b.score - a.score || (a.state.join(',') < b.state.join(',') ? -1 : 1));
        beams = scored.slice(0, partialBeamsCap).map((entry) => entry.state);
    }
    const completeRosters = [...complete.values()]
        .sort((a, b) => (a.join(',') < b.join(',') ? -1 : 1))
        .slice(0, input.caps?.completeCandidates ?? input.model.search.completeCandidates);
    const searched: SearchableCandidate[] = [];
    let rotationsEvaluated = 0;
    const rotationBudget = input.model.search.nodeBudgets.rotation;
    const rotationsPerRoster = input.caps?.rotationsPerRoster ?? 48;
    const defaultGates: RankingGates = {
        legal: true,
        legalStartersAndClosers: true,
        coverageOk: true,
        bandOk: true,
        anchorsOk: true,
        ownershipOk: true,
        rolesOk: true,
        feasibilityOk: true,
    };
    const gates: RankingGates = { ...defaultGates, ...input.gates };
    for (const roster of completeRosters) {
        if (rotationsEvaluated >= rotationBudget)
            break;
        const rosterMembers = rosterInputMembers(roster, members);
        const legal = validateSeasonRoster(rosterMembers).length === 0;
        const coverage = completionTargetsMet(rosterMembers);
        const rotations = rotationsFor({
            roster,
            members,
            lens,
            startingFivesCap: input.model.search.startingFives,
            closingFivesCap: input.model.search.closingFives,
            benchHierarchiesCap: input.model.search.benchHierarchies,
            minuteTemplatesCap: input.model.search.minuteTemplates,
            rotationsCap: rotationsPerRoster,
            eraProfile: input.eraProfile,
            model: input.model,
            cache,
            load: input.load,
        });
        const minutePlanLoad = roster.map((id) => {
            const member = members.get(id) ?? benchMember(id);
            const load = input.load?.get(id);
            return {
                playerVersionId: id,
                staminaRating: load?.staminaRating ?? member.staminaRating,
                durability: load?.durability ?? member.durability,
                fatigueBasisPoints: 0,
                recentLoadBasisPoints: 0,
            };
        });
        for (const rotation of rotations) {
            if (rotationsEvaluated >= rotationBudget)
                break;
            rotationsEvaluated += 1;
            let projection;
            try {
                projection = projectSeasonRoster({
                    roster: roster.map((id) => ({
                        player: members.get(id)?.player ?? benchMember(id).player,
                    })),
                    rotation,
                    eraProfile: input.eraProfile,
                    model: input.model,
                    minutePlan: {
                        players: minutePlanLoad,
                        horizonGames: minutePlanHorizonGames(82),
                    },
                }, { cache });
            }
            catch {
                continue;
            }
            const candidateId = `${roster.join('-')}#${rotation.starters.join('-')}`;
            const gatesForCandidate: RankingGates = {
                ...gates,
                legal,
                legalStartersAndClosers: true,
                coverageOk: coverage,
                ownershipOk: roster.every((id) => locked.includes(id) || available.includes(id)),
            };
            searched.push({
                candidateId,
                projection,
                rotation,
                gates: gatesForCandidate,
            });
        }
    }
    const result = rankCandidates({
        candidates: searched.map((candidate) => ({
            candidateId: candidate.candidateId,
            projection: candidate.projection,
            gates: candidate.gates,
        })),
        model: input.model,
    });
    const byId = new Map(searched.map((candidate) => [candidate.candidateId, candidate]));
    const ranked: SearchedCandidate[] = result.ranked
        .map((candidate) => {
        const full = byId.get(candidate.candidateId);
        return full === undefined ? undefined : { ...candidate, rotation: full.rotation };
    })
        .filter((candidate): candidate is SearchedCandidate => candidate !== undefined);
    const audit: SearchAudit = {
        seed: input.seed,
        seedNamespace,
        lens,
        nodeCount,
        nodeBudget: budget,
        cacheHits: cache.stats().hits,
        cacheMisses: cache.stats().misses,
        partialBeams: beams.length,
        completeRosters: completeRosters.length,
        rotationsEvaluated,
        rejected: result.rejected,
        paretoSurvivors: result.paretoSurvivors,
        selectedCandidateId: ranked[0]?.candidateId ?? null,
    };
    return { ranked, audit, feasibilityFailure: null };
}
function emptyAudit(seed: string, seedNamespace: string, lens: SearchLens): SearchAudit {
    return {
        seed,
        seedNamespace,
        lens,
        nodeCount: 0,
        nodeBudget: 0,
        cacheHits: 0,
        cacheMisses: 0,
        partialBeams: 0,
        completeRosters: 0,
        rotationsEvaluated: 0,
        rejected: [],
        paretoSurvivors: 0,
        selectedCandidateId: null,
    };
}
export function buildHumanSeasonRoster(input: HumanRosterBuildInput): HumanRosterBuildResult {
    const result = searchRosterRotationCandidates(input);
    if (result.feasibilityFailure !== null) {
        return {
            ok: false,
            roster: null,
            rotation: null,
            projection: null,
            ranked: [],
            audit: result.audit,
            feasibilityFailure: result.feasibilityFailure,
        };
    }
    const top = result.ranked[0];
    return {
        ok: top !== undefined,
        roster: top === undefined ? null : [...top.projection.minutes.map((row) => row.playerVersionId)],
        rotation: top?.rotation ?? null,
        projection: top?.projection ?? null,
        ranked: result.ranked,
        audit: result.audit,
        feasibilityFailure: null,
    };
}
