import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEngineContext, simulateGame, toSimulationPlayer } from '@hoop-rush/engine';
import type { EraSimulationProfile, FranchiseEraPool, RatingsModelArtifact, SimulationPlayer, SimulationTeam, } from '@hoop-rush/data-contracts';
import { POSITION_SLOTS, playableSlotGroups, playerIdSchema, RATINGS_VERSION, RATING_MODEL_VERSION, ratingsModelArtifactSchema, slotGroupOf, } from '@hoop-rush/data-contracts';
import { makeReport, type CliReport } from '../report.ts';
import { loadPackagedData, PackagedData } from './data-loader.ts';
import { parseCount } from '../args.ts';
import { fixtureSeed } from './sim.ts';
import { DEFAULT_RATINGS_MODEL_ARTIFACT } from '@hoop-rush/importer';
import { mean } from '../stats.ts';
const SLOT_POSITIONS: SimulationPlayer['positions'][] = POSITION_SLOTS.map((position) => [
    position,
]);
const CONTEXTS = ['weak', 'average', 'strong', 'interior-heavy', 'perimeter-heavy'] as const;
interface PairAccumulator {
    games: number;
    wins: number;
    netRating: number;
    offensiveEfficiency: number;
    defensiveEfficiency: number;
    turnovers: number;
    rebounds: number;
    shotQuality: number;
}
function newAccumulator(): PairAccumulator {
    return {
        games: 0,
        wins: 0,
        netRating: 0,
        offensiveEfficiency: 0,
        defensiveEfficiency: 0,
        turnovers: 0,
        rebounds: 0,
        shotQuality: 0,
    };
}
function seedFor(args: {
    playerId: string;
    context: string;
    index: number;
}): import('@hoop-rush/data-contracts').Seed {
    return fixtureSeed(`${RATINGS_VERSION}|${args.playerId}|${args.context}`, args.index);
}
export function calibrationConfidence(samples: number, confidenceTarget: number): number {
    return Math.min(1, samples / confidenceTarget);
}
export function buildRatingsModelArtifact(input: {
    artifact: RatingsModelArtifact;
    playerAdjustments: NonNullable<RatingsModelArtifact['playerAdjustments']>;
    samples: number;
}): RatingsModelArtifact {
    return ratingsModelArtifactSchema.parse({
        ...input.artifact,
        modelVersion: RATING_MODEL_VERSION,
        ratingsVersion: RATINGS_VERSION,
        confidenceTargetSamplesPerContext: input.artifact.confidenceTargetSamplesPerContext,
        sampleCountPerContext: input.samples,
        playerAdjustments: input.playerAdjustments,
    });
}
function teamMetric(result: ReturnType<typeof simulateGame>, side: 'home' | 'away') {
    const team = result[side].box;
    const other = result[side === 'home' ? 'away' : 'home'].box;
    const teamPossessions = Math.max(1, team.possessions);
    const otherPossessions = Math.max(1, other.possessions);
    return {
        netRating: (team.points / teamPossessions - other.points / otherPossessions) * 100,
        offensiveEfficiency: (team.points / teamPossessions) * 100,
        defensiveEfficiency: (other.points / otherPossessions) * 100,
        turnovers: other.turnovers - team.turnovers,
        rebounds: team.rebounds.total - other.rebounds.total,
        shotQuality: (team.fieldGoals.made + 0.5 * team.threes.made) / Math.max(1, team.fieldGoals.attempted),
    };
}
function adjustBenchmark(team: SimulationTeam, context: (typeof CONTEXTS)[number]): SimulationTeam {
    if (context !== 'interior-heavy' && context !== 'perimeter-heavy')
        return team;
    return {
        ...team,
        teamId: `${team.teamId}-${context}`,
        displayName: `${team.displayName} ${context}`,
        players: team.players.map((player) => ({
            ...player,
            ratings: {
                ...player.ratings,
                ...(context === 'interior-heavy'
                    ? {
                        insideScoring: Math.min(100, player.ratings.insideScoring + 12),
                        closeShot: Math.min(100, player.ratings.closeShot + 10),
                        offensiveRebound: Math.min(100, player.ratings.offensiveRebound + 12),
                        interiorDefense: Math.min(100, player.ratings.interiorDefense + 8),
                    }
                    : {
                        threePoint: Math.min(100, player.ratings.threePoint + 12),
                        ballHandling: Math.min(100, player.ratings.ballHandling + 8),
                        perimeterDefense: Math.min(100, player.ratings.perimeterDefense + 8),
                    }),
            },
        })),
    };
}
function roleLineup(pool: FranchiseEraPool, candidateId: string): SimulationTeam | null {
    const candidate = pool.players.find((player) => player.playerId === candidateId);
    if (!candidate)
        return null;
    const candidateSlot = SLOT_POSITIONS.findIndex((slot) => {
        const requirement = slot[0];
        return (requirement !== undefined &&
            playableSlotGroups(candidate.positions.playable).includes(slotGroupOf(requirement)));
    });
    if (candidateSlot < 0)
        return null;
    const chosen: SimulationPlayer[] = [];
    const used = new Set<string>();
    for (let slotIndex = 0; slotIndex < SLOT_POSITIONS.length; slotIndex += 1) {
        const slot = SLOT_POSITIONS[slotIndex];
        if (!slot)
            return null;
        const source = slotIndex === candidateSlot
            ? candidate
            : pool.players.find((player) => {
                if (used.has(player.playerId) || player.playerId === candidateId)
                    return false;
                const requirement = slot[0];
                return (requirement !== undefined &&
                    playableSlotGroups(player.positions.playable).includes(slotGroupOf(requirement)));
            });
        if (!source)
            return null;
        used.add(source.playerId);
        chosen.push({ ...toSimulationPlayer(source), positions: slot });
    }
    return { teamId: `candidate-${candidateId}`, displayName: 'Candidate lineup', players: chosen };
}
function replacementLineup(pool: FranchiseEraPool, candidateId: string): SimulationTeam | null {
    const candidateLineup = roleLineup(pool, candidateId);
    if (!candidateLineup)
        return null;
    const candidate = pool.players.find((player) => player.playerId === candidateId);
    if (!candidate)
        return null;
    const candidateSlot = candidateLineup.players.findIndex((player) => player.playerId === candidateId);
    const requirement = SLOT_POSITIONS[candidateSlot]?.[0];
    if (!requirement)
        return null;
    const replacement = pool.players
        .filter((player) => player.playerId !== candidateId &&
        playableSlotGroups(player.positions.playable).includes(slotGroupOf(requirement)))
        .sort((a, b) => Math.abs(a.selectionScore - candidate.selectionScore) -
        Math.abs(b.selectionScore - candidate.selectionScore) ||
        a.playerId.localeCompare(b.playerId))[0];
    if (!replacement)
        return null;
    return {
        ...candidateLineup,
        teamId: `replacement-${candidateId}`,
        displayName: 'Replacement lineup',
        players: candidateLineup.players.map((player, index) => {
            const positions = SLOT_POSITIONS[index];
            if (!positions)
                throw new Error(`replacement slot ${String(index)} is invalid`);
            return index === candidateSlot ? { ...toSimulationPlayer(replacement), positions } : player;
        }),
    };
}
function pairImpact(args: {
    candidate: SimulationTeam;
    replacement: SimulationTeam;
    benchmark: SimulationTeam;
    profile: EraSimulationProfile;
    samples: number;
    playerId: string;
    context: string;
}): PairAccumulator {
    const { candidate, replacement, benchmark, profile, samples, playerId, context } = args;
    const candidateAcc = newAccumulator();
    const replacementAcc = newAccumulator();
    const engineContext = createEngineContext();
    for (let index = 0; index < samples; index += 1) {
        const seed = seedFor({ playerId, context, index });
        const homeFirst = index % 2 === 0;
        const base = {
            schemaVersion: 2 as const,
            gameNumber: 1,
            seed,
            dataVersion: profile.dataVersion,
            profile,
        };
        const candidateResult = simulateGame({ ...base, home: homeFirst ? candidate : benchmark, away: homeFirst ? benchmark : candidate }, engineContext);
        const replacementResult = simulateGame({
            ...base,
            home: homeFirst ? replacement : benchmark,
            away: homeFirst ? benchmark : replacement,
        }, engineContext);
        const candidateSide = homeFirst ? 'home' : 'away';
        const replacementSide = homeFirst ? 'home' : 'away';
        const candidateMetrics = teamMetric(candidateResult, candidateSide);
        const replacementMetrics = teamMetric(replacementResult, replacementSide);
        candidateAcc.games += 1;
        replacementAcc.games += 1;
        if (candidateResult.winner === candidateSide)
            candidateAcc.wins += 1;
        if (replacementResult.winner === replacementSide)
            replacementAcc.wins += 1;
        candidateAcc.netRating += candidateMetrics.netRating;
        replacementAcc.netRating += replacementMetrics.netRating;
        candidateAcc.offensiveEfficiency += candidateMetrics.offensiveEfficiency;
        replacementAcc.offensiveEfficiency += replacementMetrics.offensiveEfficiency;
        candidateAcc.defensiveEfficiency += candidateMetrics.defensiveEfficiency;
        replacementAcc.defensiveEfficiency += replacementMetrics.defensiveEfficiency;
        candidateAcc.turnovers += candidateMetrics.turnovers;
        replacementAcc.turnovers += replacementMetrics.turnovers;
        candidateAcc.rebounds += candidateMetrics.rebounds;
        replacementAcc.rebounds += replacementMetrics.rebounds;
        candidateAcc.shotQuality += candidateMetrics.shotQuality;
        replacementAcc.shotQuality += replacementMetrics.shotQuality;
    }
    return {
        games: candidateAcc.games,
        wins: candidateAcc.wins - replacementAcc.wins,
        netRating: candidateAcc.netRating / Math.max(1, samples) -
            replacementAcc.netRating / Math.max(1, samples),
        offensiveEfficiency: candidateAcc.offensiveEfficiency / Math.max(1, samples) -
            replacementAcc.offensiveEfficiency / Math.max(1, samples),
        defensiveEfficiency: replacementAcc.defensiveEfficiency / Math.max(1, samples) -
            candidateAcc.defensiveEfficiency / Math.max(1, samples),
        turnovers: candidateAcc.turnovers / Math.max(1, samples) -
            replacementAcc.turnovers / Math.max(1, samples),
        rebounds: candidateAcc.rebounds / Math.max(1, samples) - replacementAcc.rebounds / Math.max(1, samples),
        shotQuality: candidateAcc.shotQuality / Math.max(1, samples) -
            replacementAcc.shotQuality / Math.max(1, samples),
    };
}
export const CALIBRATE_RATINGS_OPTIONS: Record<string, boolean> = {
    samples: true,
    workers: true,
    output: true,
    manifest: true,
    format: true,
    verbose: false,
};
export function calibrateRatings(args: {
    samples?: string;
    workers?: string;
    output?: string;
    manifest?: string;
}): CliReport {
    const samples = parseCount(args.samples, '--samples', 256);
    if (samples < 1)
        return makeReport('calibrate ratings', { samples }, { failures: ['--samples must be positive'] });
    const packaged = loadPackagedData(args.manifest);
    const data = new PackagedData(packaged.manifest, packaged.dir);
    const output = args.output ?? join(packaged.dir, 'ratings-model.json');
    const existing = ratingsModelArtifactSchema.safeParse((() => {
        try {
            return JSON.parse(readFileSync(output, 'utf8')) as unknown;
        }
        catch {
            return DEFAULT_RATINGS_MODEL_ARTIFACT;
        }
    })());
    const artifact: RatingsModelArtifact = existing.success &&
        existing.data.ratingsVersion === RATINGS_VERSION &&
        existing.data.modelVersion === RATING_MODEL_VERSION
        ? existing.data
        : DEFAULT_RATINGS_MODEL_ARTIFACT;
    const pools = packaged.manifest.pools
        .map((entry) => data.pool(entry.franchiseId, entry.eraId))
        .filter((pool) => pool.players.length >= 5);
    const playerAdjustments: NonNullable<RatingsModelArtifact['playerAdjustments']> = {};
    let candidateCount = 0;
    let skipped = 0;
    for (const pool of pools) {
        const { strong, weak } = poolStrength(pool);
        const average = leagueAverage(pool);
        for (const player of pool.players) {
            const candidate = roleLineup(pool, player.playerId);
            const replacement = replacementLineup(pool, player.playerId);
            if (!candidate || !replacement) {
                skipped += 1;
                continue;
            }
            candidateCount += 1;
            const totals = CONTEXTS.map((context) => {
                const benchmark = adjustBenchmark(context === 'weak' ? weak : context === 'strong' ? strong : average, context);
                return pairImpact({
                    candidate,
                    replacement,
                    benchmark,
                    profile: data.eraProfile(pool.eraId),
                    samples,
                    playerId: player.playerId,
                    context,
                });
            });
            const meanMetric = (key: keyof PairAccumulator) => mean(totals.map((value) => value[key]));
            const winProbability = totals.reduce((sum, value) => sum + value.wins / Math.max(1, value.games), 0) /
                Math.max(1, totals.length);
            const metrics = {
                netRating: meanMetric('netRating'),
                winProbability,
                offensiveEfficiency: meanMetric('offensiveEfficiency'),
                defensiveEfficiency: meanMetric('defensiveEfficiency'),
                turnovers: meanMetric('turnovers'),
                rebounds: meanMetric('rebounds'),
                shotQuality: meanMetric('shotQuality'),
            };
            const adjustment = Math.max(-6, Math.min(6, metrics.netRating * artifact.mapping.impactPerNetRating +
                metrics.winProbability * artifact.mapping.impactPerWinProbability +
                metrics.offensiveEfficiency * artifact.mapping.impactPerEfficiency +
                metrics.defensiveEfficiency * artifact.mapping.impactPerDefensiveEfficiency +
                metrics.turnovers * artifact.mapping.impactPerTurnovers +
                metrics.rebounds * artifact.mapping.impactPerRebound +
                metrics.shotQuality * artifact.mapping.impactPerShotQuality));
            const confidence = calibrationConfidence(samples, artifact.confidenceTargetSamplesPerContext);
            playerAdjustments[player.playerId] = {
                adjustment: Math.round(adjustment * 1000) / 1000,
                confidence,
                sampleCount: samples * totals.length,
                metrics,
            };
        }
    }
    const outputArtifact = buildRatingsModelArtifact({ artifact, playerAdjustments, samples });
    writeFileSync(output, `${JSON.stringify(outputArtifact, null, 2)}\n`, 'utf8');
    return makeReport('calibrate ratings', { samples, workers: args.workers ?? '1', output }, {
        details: [
            `paired simulations: ${String(candidateCount)} candidates · ${String(skipped)} skipped · ${String(CONTEXTS.length)} contexts`,
            `artifact ${outputArtifact.modelVersion} · ${String(samples)} games/context · deterministic seeds`,
        ],
        payload: outputArtifact,
    });
}
function leagueAverage(pool: FranchiseEraPool): SimulationTeam {
    const players = [...pool.players].sort((a, b) => a.playerId.localeCompare(b.playerId));
    return {
        teamId: 'ratings-average',
        displayName: 'Ratings average',
        players: SLOT_POSITIONS.map((positions, index) => {
            const source = players[index % Math.max(1, players.length)];
            if (!source)
                throw new Error('cannot build a benchmark from an empty pool');
            return {
                ...toSimulationPlayer(source),
                positions,
                playerId: playerIdSchema.parse(`ratings-average-${String(index)}`),
            };
        }),
    };
}
function poolStrength(pool: FranchiseEraPool): {
    strong: SimulationTeam;
    weak: SimulationTeam;
} {
    const sorted = [...pool.players].sort((a, b) => b.selectionScore - a.selectionScore || a.playerId.localeCompare(b.playerId));
    const make = (source: typeof sorted): SimulationTeam => ({
        teamId: 'ratings-benchmark',
        displayName: 'Ratings benchmark',
        players: SLOT_POSITIONS.map((positions, index) => {
            const requiredPosition = positions[0];
            if (!requiredPosition)
                throw new Error(`benchmark slot ${String(index)} is invalid`);
            const player = source.find((candidate) => playableSlotGroups(candidate.positions.playable).includes(slotGroupOf(requiredPosition))) ??
                source[index] ??
                source.at(0);
            if (!player)
                throw new Error('cannot build a benchmark from an empty pool');
            return {
                ...toSimulationPlayer(player),
                positions,
                playerId: playerIdSchema.parse(`benchmark-${String(index)}`),
            };
        }),
    });
    return { strong: make(sorted), weak: make([...sorted].reverse()) };
}
