import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEASON_MINUTE_POLICY_VERSION, SEASON_ROTATION_PRESET_TARGETS, SEASON_ROTATION_VERSION, eraIdSchema, franchiseIdSchema, playerIdSchema, playerVersionId, seasonKeySchema, seedSchema, type Position, type SeasonGameAvailability, type SeasonGamePlayerInput, type SeasonGameSimulationInput, type SeasonGameTeamInput, type SeasonRemoval, type SeasonRotation, type SeasonRotationPreset, type SimulationRatings, } from '@hoop-rush/data-contracts';
import { buildEraSimulationProfile, buildSimulationPlayer } from '@hoop-rush/test-fixtures';
import { minuteStrategyOfPreset } from '@hoop-rush/engine';
const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const PLACEHOLDER_SEED = '0'.repeat(32);
const OVERTIME_SEED = '0000000000000000000000000000003f';
const FOUL_PRESSURE_SEED = '00000000000000000000000000000001';
const POSITION_PLAN: ReadonlyArray<readonly Position[]> = [
    ['PG'],
    ['SG'],
    ['SF'],
    ['PF'],
    ['C'],
    ['PG', 'SG'],
    ['SF'],
    ['PF', 'C'],
    ['SG', 'PG'],
    ['C'],
];
function shiftRatings(ratings: SimulationRatings, shift: number): SimulationRatings {
    const shifted: Record<string, number> = {};
    for (const [key, value] of Object.entries(ratings)) {
        shifted[key] = Math.max(30, Math.min(95, value + shift));
    }
    return shifted as SimulationRatings;
}
function buildTeam(side: 'home' | 'away', options: {
    foulProne?: boolean;
    shift?: number;
} = {}): SeasonGameTeamInput {
    const franchiseId = franchiseIdSchema.parse(side === 'home' ? 'lakers' : 'celtics');
    const eraId = eraIdSchema.parse('1990s');
    const seasonKey = seasonKeySchema.parse('1995-96');
    const players: SeasonGamePlayerInput[] = POSITION_PLAN.map((positions, index) => {
        const playerId = playerIdSchema.parse(`p-sg-${side}-${String(index + 1)}`);
        const base = buildSimulationPlayer();
        const shift = options.shift ?? (index < 5 ? 8 : 0);
        const tendencies = { ...base.tendencies };
        if (options.foulProne) {
            tendencies.foulRate = 45;
        }
        else if (index < 2) {
            tendencies.foulRate = 3;
        }
        return {
            playerVersionId: playerVersionId(playerId, franchiseId, eraId, seasonKey),
            playerId,
            displayName: `${side} player ${String(index + 1)}`,
            positions: [...positions],
            heightInches: 76,
            weightLbs: 200,
            ratings: shiftRatings(base.ratings, shift),
            tendencies,
        };
    });
    return {
        teamId: `${side}-team`,
        displayName: side === 'home' ? 'Home Team' : 'Away Team',
        franchiseId,
        players,
    };
}
function buildRotation(team: SeasonGameTeamInput, preset: SeasonRotationPreset | null): SeasonRotation {
    const ids = team.players.map((player) => player.playerVersionId);
    const targets = preset
        ? SEASON_ROTATION_PRESET_TARGETS[preset]
        : SEASON_ROTATION_PRESET_TARGETS.balanced;
    return {
        franchiseId: team.franchiseId,
        starters: ids.slice(0, 5),
        benchOrder: ids.slice(5),
        targetMinutes: [
            ...ids.slice(0, 5).map((playerVersionId) => ({ playerVersionId, minutes: targets.starters })),
            ...ids.slice(5).map((playerVersionId, index) => ({
                playerVersionId,
                minutes: targets.bench[index] ?? 0,
            })),
        ],
        closingFive: ids.slice(0, 5),
        minutePolicy: {
            policyVersion: SEASON_MINUTE_POLICY_VERSION,
            strategy: minuteStrategyOfPreset(preset ?? 'balanced'),
        },
        rotationVersion: SEASON_ROTATION_VERSION,
    };
}
function buildInput(options: {
    home: SeasonGameTeamInput;
    away: SeasonGameTeamInput;
    preset: SeasonRotationPreset | null;
    seed?: import('@hoop-rush/data-contracts').Seed;
    availableIds?: Set<string>;
    removals?: SeasonRemoval[];
}): SeasonGameSimulationInput {
    const all = [...options.home.players, ...options.away.players];
    const availability: SeasonGameAvailability[] = all.map((player) => ({
        playerVersionId: player.playerVersionId,
        available: options.availableIds === undefined || options.availableIds.has(player.playerVersionId),
    }));
    return {
        schemaVersion: 1,
        seed: options.seed ?? seedSchema.parse(PLACEHOLDER_SEED),
        gameNumber: 1,
        dataVersion: 'data-v1',
        profile: buildEraSimulationProfile(),
        home: options.home,
        away: options.away,
        homeRotation: buildRotation(options.home, options.preset),
        awayRotation: buildRotation(options.away, options.preset),
        availability,
        removals: options.removals ?? [],
        returns: [],
        homeCourt: {
            schemaVersion: 1,
            profileVersion: 'season-home-court-v1',
            homeDefensiveCommunication: 0,
            awayTurnoverPressure: 0,
            targetHomeWinRate: 0.575,
        },
    };
}
interface Scenario {
    fixtureId: string;
    description: string;
    preset?: SeasonRotationPreset;
    input: SeasonGameSimulationInput;
}
function scenarios(): Scenario[] {
    const balanced = {
        home: buildTeam('home'),
        away: buildTeam('away'),
    };
    return [
        {
            fixtureId: 'season-game-balanced',
            description: 'Balanced rotation preset (starters 33, bench 21/18/15/12/9); the frozen calibration baseline.',
            preset: 'balanced',
            input: buildInput({ ...balanced, preset: 'balanced' }),
        },
        {
            fixtureId: 'season-game-tight',
            description: 'Tight rotation preset (starters 37, bench 20/14/9/7/5); starters must dominate minutes.',
            preset: 'tight',
            input: buildInput({ ...balanced, preset: 'tight' }),
        },
        {
            fixtureId: 'season-game-bench-heavy',
            description: 'Bench-heavy rotation preset (starters 29, bench 23/21/19/17/15); bench must carry minutes.',
            preset: 'bench-heavy',
            input: buildInput({ ...balanced, preset: 'bench-heavy' }),
        },
        {
            fixtureId: 'season-game-foul-pressure',
            description: 'Every player foul-prone (foulRate 45) to stress foul-outs and contingency legality.',
            input: buildInput({
                home: buildTeam('home', { foulProne: true }),
                away: buildTeam('away', { foulProne: true }),
                preset: null,
                seed: seedSchema.parse(FOUL_PRESSURE_SEED),
            }),
        },
        {
            fixtureId: 'season-game-pregame-unavailable',
            description: 'One starter per side unavailable pregame; rotations must absorb them with deviations.',
            input: buildInput({
                ...balanced,
                preset: null,
                availableIds: new Set([
                    ...balanced.home.players.slice(1).map((player) => player.playerVersionId),
                    ...balanced.away.players.slice(1).map((player) => player.playerVersionId),
                ]),
            }),
        },
        {
            fixtureId: 'season-game-injected-removal',
            description: 'Injected injury removals mid-game (home SF at 2:00 of P2, away C at 5:00 of P3) exercise the removal seam.',
            input: buildInput({
                ...balanced,
                preset: null,
                removals: [
                    {
                        side: 'home',
                        playerVersionId: balanced.home.players[2]?.playerVersionId ?? '',
                        period: 2,
                        secondsRemaining: 600,
                        reason: 'injected-injury-removal',
                    },
                    {
                        side: 'away',
                        playerVersionId: balanced.away.players[8]?.playerVersionId ?? '',
                        period: 3,
                        secondsRemaining: 300,
                        reason: 'injected-injury-removal',
                    },
                ],
            }),
        },
        {
            fixtureId: 'season-game-overtime',
            description: 'Verified overtime scenario: the embedded seed reaches two overtime periods.',
            input: buildInput({ ...balanced, preset: null, seed: seedSchema.parse(OVERTIME_SEED) }),
        },
        {
            fixtureId: 'season-game-no-legal-five',
            description: 'Home can field only three players pregame; expects the typed 2-0 forfeit.',
            input: buildInput({
                ...balanced,
                preset: null,
                availableIds: new Set([
                    ...balanced.home.players.slice(0, 3).map((player) => player.playerVersionId),
                    ...balanced.away.players.map((player) => player.playerVersionId),
                ]),
            }),
        },
        {
            fixtureId: 'season-game-no-legal-five-both',
            description: 'Both sides can field only three players pregame; expects the no-legal-five-both variant.',
            input: buildInput({
                ...balanced,
                preset: null,
                availableIds: new Set([
                    ...balanced.home.players.slice(0, 3).map((player) => player.playerVersionId),
                    ...balanced.away.players.slice(0, 3).map((player) => player.playerVersionId),
                ]),
            }),
        },
    ];
}
function main(): void {
    mkdirSync(OUT_DIR, { recursive: true });
    for (const scenario of scenarios()) {
        const fixture = {
            schemaVersion: 1,
            fixtureId: scenario.fixtureId,
            description: scenario.description,
            ...(scenario.preset === undefined ? {} : { preset: scenario.preset }),
            input: scenario.input,
        };
        const path = resolve(OUT_DIR, `${scenario.fixtureId}.json`);
        writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
        console.log(`wrote ${path}`);
    }
}
main();
