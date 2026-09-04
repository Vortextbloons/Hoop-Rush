import type { BaseFiveProjection, BaseFiveProjectionInput, ProjectionCreation, ProjectionDefense, ProjectionLedger, ProjectionPlayerContribution, ProjectionSide, ProjectionSlot, ProjectionSpacing, ProjectionReferenceFive, SimulationPlayer, SimulationTeam, } from '@hoop-rush/data-contracts';
import { PROJECTION_SCHEMA_VERSION, seasonDigestHex } from '@hoop-rush/data-contracts';
import { canPlay } from '../domain/positions.ts';
import { prepareTeam, type TeamPrep } from '../sim/prepare.ts';
import { projectExpectedLedger, type LedgerSide } from './expected-ledger.ts';
import { resolveReference } from './reference-lineups.ts';
import { identifyWeaknesses } from './weaknesses.ts';
import { normalizeValue } from './normalize.ts';
const SLOT_GROUP: Record<ProjectionSlot, 'G' | 'F' | 'C'> = {
    G1: 'G',
    G2: 'G',
    F1: 'F',
    F2: 'F',
    C: 'C',
};
const SLOT_ORDER: readonly ProjectionSlot[] = ['G1', 'G2', 'F1', 'F2', 'C'];
const referenceTeamCache = new WeakMap<readonly SimulationPlayer[], SimulationTeam>();
function referenceTeamOf(reference: ProjectionReferenceFive): SimulationTeam {
    let team = referenceTeamCache.get(reference.players);
    if (team === undefined) {
        team = {
            teamId: 'projection-reference',
            displayName: `Reference ${reference.referenceId}`,
            players: [...reference.players],
        };
        referenceTeamCache.set(reference.players, team);
    }
    return team;
}
const DEFAULT_SCALES: Record<string, {
    baseline: number;
    perPoint: number;
}> = {
    creation: { baseline: 0.5, perPoint: 0.01 },
    spacing: { baseline: 0.5, perPoint: 0.01 },
    defense: { baseline: 55, perPoint: 1 },
};
function normalize(raw: number, key: string, scale?: {
    baseline: number;
    perPoint: number;
    min: number;
    max: number;
}): number {
    const fallback = DEFAULT_SCALES[key] ?? DEFAULT_SCALES.defense ?? { baseline: 55, perPoint: 1 };
    const baseline = scale?.baseline ?? fallback.baseline;
    const perPoint = scale?.perPoint ?? fallback.perPoint;
    const min = scale?.min ?? 0;
    const max = scale?.max ?? 100;
    return normalizeValue(raw, baseline, perPoint, min, max);
}
function mean(values: readonly number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}
function ratingMean(players: readonly SimulationPlayer[], key: keyof SimulationPlayer['ratings']): number {
    return mean(players.map((player) => player.ratings[key]));
}
function tendencyMean(players: readonly SimulationPlayer[], key: keyof SimulationPlayer['tendencies']): number {
    return mean(players.map((player) => player.tendencies[key]));
}
function creationAbility(player: SimulationPlayer): number {
    return ((player.ratings.ballHandling * 0.4 +
        player.ratings.passing * 0.35 +
        player.ratings.offensiveIq * 0.25) /
        100);
}
function coverageOf(players: readonly SimulationPlayer[], prep: TeamPrep): ProjectionDefense {
    const perimeterCoverage = ratingMean(players, 'perimeterDefense');
    const interiorCoverage = ratingMean(players, 'interiorDefense');
    const rimProtection = ratingMean(players, 'block') * 0.6 + ratingMean(players, 'interiorDefense') * 0.4;
    const stealOpportunity = ratingMean(players, 'steal') * 0.7 + tendencyMean(players, 'stealAttemptRate') * 0.3;
    const blockOpportunity = ratingMean(players, 'block') * 0.7 + tendencyMean(players, 'blockAttemptRate') * 0.3;
    const foulExposure = tendencyMean(players, 'foulRate');
    const heightScore = mean(players.map((player) => player.heightInches === null ? 0 : (Math.max(0, player.heightInches - 72) / 24) * 100));
    const defensiveRebounding = ratingMean(players, 'defensiveRebound') * 0.6 +
        ratingMean(players, 'vertical') * 0.25 +
        heightScore * 0.15;
    const pressure = prep.pressure;
    const score = Math.min(100, Math.max(0, perimeterCoverage * 0.15 +
        interiorCoverage * 0.15 +
        rimProtection * 0.15 +
        stealOpportunity * 0.1 +
        blockOpportunity * 0.1 +
        (100 - foulExposure) * 0.1 +
        defensiveRebounding * 0.2 +
        pressure * 100 * 0.05));
    return {
        score,
        pressure,
        perimeterCoverage,
        interiorCoverage,
        rimProtection,
        stealOpportunity,
        blockOpportunity,
        foulExposure,
        defensiveRebounding,
        expectedOpponentShotQuality: 0,
    };
}
function creationOf(input: {
    facts: LedgerSide;
    players: readonly SimulationPlayer[];
    scale?: {
        baseline: number;
        perPoint: number;
        min: number;
        max: number;
    };
}): ProjectionCreation {
    const { facts, players, scale } = input;
    const initiatorShares = facts.players.map((row) => row.initiatorShare);
    let creationMass = 0;
    for (let index = 0; index < players.length; index += 1) {
        const player = players[index];
        if (player === undefined)
            continue;
        creationMass += (initiatorShares[index] ?? 0) * creationAbility(player);
    }
    const actionShares = Object.values(facts.actions);
    let entropy = 0;
    const total = actionShares.reduce((sum, value) => sum + value, 0);
    for (const share of actionShares) {
        const p = share / Math.max(1e-9, total);
        if (p > 0)
            entropy -= p * Math.log(p);
    }
    const diversity = entropy / Math.log(Math.max(2, actionShares.length));
    const raw = creationMass * 0.75 + diversity * 0.15 + Math.min(1, facts.passOpportunity / 60) * 0.1;
    const sortedShares = [...initiatorShares].sort((a, b) => b - a);
    return {
        score: normalize(raw, 'creation', scale),
        initiatorShare: Object.fromEntries(SLOT_ORDER.map((slot, index) => [slot, initiatorShares[index] ?? 0])) as ProjectionCreation['initiatorShare'],
        primaryShare: sortedShares[0] ?? 0,
        topTwoShare: (sortedShares[0] ?? 0) + (sortedShares[1] ?? 0),
        actionDiversity: Math.min(100, Math.max(0, diversity * 100)),
        assistOpportunity: facts.ledger.assists,
        passOpportunity: facts.passOpportunity,
    };
}
function validateAndBuildTeam(input: BaseFiveProjectionInput): SimulationTeam {
    const slots = input.lineup.map((entry) => entry.slot);
    for (const slot of SLOT_ORDER) {
        if (!slots.includes(slot)) {
            throw new Error(`projection: missing slot ${slot}`);
        }
    }
    const seen = new Set<string>();
    for (const entry of input.lineup) {
        const identity = entry.player.playerVersionId ?? entry.player.playerId;
        if (seen.has(identity)) {
            throw new Error(`projection: duplicate player version ${identity}`);
        }
        seen.add(identity);
        if (!canPlay(entry.player.positions, SLOT_GROUP[entry.slot])) {
            throw new Error(`projection: ${entry.player.playerId} (${entry.player.positions.join('/')}) cannot fill ${SLOT_GROUP[entry.slot]} slot ${entry.slot}`);
        }
    }
    const ordered = SLOT_ORDER.map((slot) => {
        const entry = input.lineup.find((candidate) => candidate.slot === slot);
        if (entry === undefined)
            throw new Error(`projection: missing slot ${slot}`);
        return entry.player;
    });
    return {
        teamId: 'projection-lineup',
        displayName: 'Projection Lineup',
        players: ordered,
    };
}
function inputMaterial(input: BaseFiveProjectionInput, referenceId: string): string {
    const entries = input.lineup
        .map((entry) => ({
        slot: entry.slot,
        playerId: entry.player.playerId,
        playerVersionId: entry.player.playerVersionId ?? null,
        positions: [...entry.player.positions].sort(),
        ratings: entry.player.ratings,
        tendencies: entry.player.tendencies,
        anchors: entry.player.anchors ?? null,
        reconstructedThreePoint: entry.player.reconstructedThreePoint ?? null,
    }))
        .sort((a, b) => (a.slot < b.slot ? -1 : 1));
    return JSON.stringify({
        modelVersion: input.model.modelVersion,
        referenceId,
        eraId: input.eraProfile.eraId,
        eraProfileVersion: input.eraProfile.profileVersion,
        dataVersion: input.eraProfile.dataVersion,
        entries,
    });
}
function sideOf(input: {
    facts: LedgerSide;
    players: readonly SimulationPlayer[];
    slots: readonly ProjectionSlot[];
    coverage: ProjectionDefense;
    expectedOpponentShotQuality: number;
    spacingRaw: number;
    spacingScale?: {
        baseline: number;
        perPoint: number;
        min: number;
        max: number;
    };
    creationScale?: {
        baseline: number;
        perPoint: number;
        min: number;
        max: number;
    };
}): ProjectionSide {
    const { facts, players, slots, coverage, expectedOpponentShotQuality, spacingRaw, spacingScale, creationScale, } = input;
    const spacing: ProjectionSpacing = {
        score: normalize(spacingRaw, 'spacing', spacingScale),
        raw: spacingRaw,
        shotQualityLift: facts.shotQualityLift,
        expectedContest: facts.expectedContest,
    };
    const creation = creationOf({ facts, players, scale: creationScale });
    const defense: ProjectionDefense = { ...coverage, expectedOpponentShotQuality };
    const contributions: ProjectionPlayerContribution[] = facts.players.map((row) => ({
        slot: slots[row.slotIndex] ?? 'G1',
        playerId: row.player.playerId,
        playerVersionId: row.player.playerVersionId ?? null,
        displayName: row.player.displayName,
        usageShare: row.usageShare,
        initiatorShare: row.initiatorShare,
        creationShare: creationAbility(row.player) * 100,
        spacingContribution: ((row.player.ratings.threePoint / 100) *
            (0.4 + 0.6 * (row.player.tendencies.threePointRate / 100))) /
            Math.max(1, players.length),
        expectedShots: row.expectedShots,
        expectedMakes: row.expectedMakes,
        expectedPoints: row.expectedPoints,
        expectedAssists: row.expectedAssists,
        expectedTurnovers: row.expectedTurnovers,
        expectedRebounds: row.expectedRebounds,
        expectedFouls: row.expectedFouls,
        defensiveContribution: row.defensiveContribution,
    }));
    return {
        ledger: facts.ledger,
        spacing,
        creation,
        defense,
        turnoverCauses: facts.turnoverCauses,
        actions: facts.actions,
        zones: facts.zones,
        shooters: Object.fromEntries(SLOT_ORDER.map((slot, index) => [slot, facts.shooters[index] ?? 0])) as ProjectionSide['shooters'],
        players: contributions,
    };
}
export function projectBaseFive(input: BaseFiveProjectionInput): BaseFiveProjection {
    const team = validateAndBuildTeam(input);
    const reference = resolveReference(input.model, input.eraProfile.eraId, input.referenceId);
    const referenceTeam = referenceTeamOf(reference);
    const prep = prepareTeam(team, input.eraProfile);
    const referencePrep = prepareTeam(referenceTeam, input.eraProfile);
    const expected = projectExpectedLedger({
        team,
        prep,
        opponent: referenceTeam,
        opponentPrep: referencePrep,
        profile: input.eraProfile,
    });
    const coverage = coverageOf(team.players, prep);
    const offense = sideOf({
        facts: expected.offense,
        players: team.players,
        slots: SLOT_ORDER,
        coverage,
        expectedOpponentShotQuality: expected.defense.aggregateMakePct,
        spacingRaw: prep.spacing,
    });
    const defense = sideOf({
        facts: expected.defense,
        players: reference.players,
        slots: SLOT_ORDER,
        coverage,
        expectedOpponentShotQuality: expected.offense.aggregateMakePct,
        spacingRaw: referencePrep.spacing,
    });
    const offensiveRating = expected.offense.ledger.points;
    const defensiveRatingAllowed = expected.defense.ledger.points;
    const netRating = offensiveRating - defensiveRatingAllowed;
    const weaknessValues: Record<string, number> = {
        creation: offense.creation.score,
        spacing: offense.spacing.score,
        defense: coverage.score,
        netRating,
        turnoverRate: expected.offense.ledger.turnoverRate * 100,
        offensiveRebounding: expected.offense.ledger.offensiveReboundRate * 100,
        defensiveRebounding: expected.offense.ledger.defensiveReboundRate * 100,
        freeThrowPressure: Math.min(100, (expected.offense.ledger.freeThrowRate / 0.5) * 100),
        rimProtection: coverage.rimProtection,
        perimeterCoverage: coverage.perimeterCoverage,
        interiorCoverage: coverage.interiorCoverage,
        foulExposure: coverage.foulExposure,
    };
    const weaknesses = identifyWeaknesses(input.model, weaknessValues);
    const material = inputMaterial(input, reference.referenceId);
    const inputDigest = seasonDigestHex(material);
    const digest = seasonDigestHex(inputDigest +
        JSON.stringify({
            offensiveRating,
            defensiveRatingAllowed,
            netRating,
            offenseLedger: offense.ledger,
            defenseLedger: defense.ledger,
            components: { spacing: offense.spacing, creation: offense.creation, defense: coverage },
            weaknesses,
        }));
    return {
        schemaVersion: 1,
        modelVersion: input.model.modelVersion,
        referenceId: reference.referenceId,
        referenceHash: reference.referenceHash,
        eraId: input.eraProfile.eraId,
        eraProfileVersion: input.eraProfile.profileVersion,
        dataVersion: input.eraProfile.dataVersion,
        normalizationVersion: PROJECTION_SCHEMA_VERSION,
        inputDigest,
        digest,
        lineup: team.players.map((player, index) => ({
            slot: SLOT_ORDER[index] ?? 'G1',
            playerId: player.playerId,
            playerVersionId: player.playerVersionId ?? null,
            displayName: player.displayName,
            positions: [...player.positions],
        })),
        offense,
        defense,
        ratings: {
            offensiveRating,
            defensiveRatingAllowed,
            netRating,
            expectedPossessions: 100,
        },
        weaknesses,
    };
}
export type { LedgerSide, ProjectionLedger };
