import type { EraSimulationProfile, GameResult, Seed, SimulationTeam, } from '@hoop-rush/data-contracts';
import { seedSchema } from '@hoop-rush/data-contracts';
import type { EngineContext } from '../sim/context.ts';
import { simulateGame } from '../sim/game.ts';
import { seedFromString } from './seeds.ts';
import { BENCHMARK_WEIGHTS } from './benchmarks.ts';
export interface LineupBalance {
    creation: number;
    shooting: number;
    interiorPresence: number;
    rebounding: number;
    defense: number;
    ok: boolean;
}
export const BALANCE_FLOOR = 52;
function mean(values: readonly number[]): number {
    if (values.length === 0)
        return 0;
    let total = 0;
    for (const v of values)
        total += v;
    return total / values.length;
}
export function evaluateLineupBalance(team: SimulationTeam): LineupBalance {
    const creationValues: number[] = [];
    const shootingValues: number[] = [];
    const interiorValues: number[] = [];
    const reboundingValues: number[] = [];
    const defenseValues: number[] = [];
    for (const player of team.players) {
        const r = player.ratings;
        const t = player.tendencies;
        creationValues.push((r.passing + r.ballHandling + r.offensiveIq + Math.min(100, t.usageRate + 60)) / 4);
        shootingValues.push((r.threePoint + r.midrange + r.freeThrow + Math.min(100, t.threePointRate + 55)) / 4);
        interiorValues.push((r.insideScoring +
            r.closeShot +
            r.block +
            r.interiorDefense +
            Math.min(100, t.postUpRate + 55)) /
            5);
        reboundingValues.push((r.offensiveRebound + r.defensiveRebound) / 2);
        defenseValues.push((r.perimeterDefense + r.interiorDefense + r.steal + r.block + r.defensiveIq) / 5);
    }
    const balance: LineupBalance = {
        creation: mean(creationValues),
        shooting: mean(shootingValues),
        interiorPresence: mean(interiorValues),
        rebounding: mean(reboundingValues),
        defense: mean(defenseValues),
        ok: true,
    };
    balance.ok =
        balance.creation >= BALANCE_FLOOR &&
            balance.shooting >= BALANCE_FLOOR &&
            balance.interiorPresence >= BALANCE_FLOOR &&
            balance.rebounding >= BALANCE_FLOOR &&
            balance.defense >= BALANCE_FLOOR;
    return balance;
}
export interface StrengthOptions {
    samplesPerBenchmark: number;
    seedBase: string;
}
export interface StrengthMeasurement {
    winRate: number;
    gamesPlayed: number;
    byBenchmark: Record<string, {
        games: number;
        wins: number;
    }>;
}
export function evaluateLineupStrength(team: SimulationTeam, context: EngineContext, profile: EraSimulationProfile, options: StrengthOptions): StrengthMeasurement {
    const { samplesPerBenchmark, seedBase } = options;
    const byBenchmark: StrengthMeasurement['byBenchmark'] = {};
    let weightedWins = 0;
    let totalGames = 0;
    for (const { team: benchmark, weight } of BENCHMARK_WEIGHTS) {
        let wins = 0;
        for (let i = 0; i < samplesPerBenchmark; i += 1) {
            const homeFirst = i % 2 === 0;
            const seed = strengthSeed(seedBase, benchmark.teamId, i);
            const input = {
                schemaVersion: 2 as const,
                seed,
                gameNumber: 1,
                dataVersion: profile.dataVersion,
                profile,
                home: homeFirst ? team : benchmark,
                away: homeFirst ? benchmark : team,
            };
            const result: GameResult = simulateGame(input, context);
            if (result.winner === (homeFirst ? 'home' : 'away'))
                wins += 1;
            totalGames += 1;
        }
        byBenchmark[benchmark.teamId] = { games: samplesPerBenchmark, wins };
        weightedWins += (wins / samplesPerBenchmark) * weight;
    }
    return { winRate: weightedWins, gamesPlayed: totalGames, byBenchmark };
}
export function strengthSeed(seedBase: string, benchmarkId: string, index: number): Seed {
    return seedSchema.parse(seedFromString(`${seedBase}|${benchmarkId}|${String(index)}`));
}
