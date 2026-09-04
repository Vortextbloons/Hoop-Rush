import type { EraSimulationProfile, ShotZone, SimulationPlayer, SimulationTeam, } from '@hoop-rush/data-contracts';
import type { Rng } from './rng.ts';
import { GameRecorder, type SideIndex } from './recorder.ts';
import { meanTripSeconds, sampleTripSeconds } from './timing.ts';
import { pickAction, pickDefender, pickAssister, pickShot, pickZone, isThreePointZone, zoneSkillRating, type ActionType, type PossessionStartType, } from './usage.ts';
import { eraPossEstimatePerTrip, isSteal, turnoverProbability } from './security.ts';
import { blockProbability, makeProbability, type ShotPrep } from './shooting.ts';
import { freeThrowsForZone, freeThrowProbability, nonShootingFoulProbability, shootingFoulProbability, } from './fouls.ts';
import { resolveRebound } from './rebounding.ts';
import { prepareTeam, enginePlayerKey, type TeamPrep } from './prepare.ts';
import { ENGINE_CONSTANTS } from './constants.ts';
import { creationScore } from '../domain/archetypes.ts';
import type { SeasonHomeCourtMechanisms } from '../season/home-court.ts';
import type { SeasonEffectsHook } from '../season/effects.ts';
export interface TripResolution {
    secondsElapsed: number;
    ended: boolean;
}
export interface GameState {
    periodFouls: [
        number,
        number
    ];
    periodIndex: number;
    secondsRemaining: number;
}
export function createGameState(): GameState {
    return {
        periodFouls: [0, 0],
        periodIndex: 0,
        secondsRemaining: 0,
    };
}
export interface TripContext {
    rng: Rng;
    recorder: GameRecorder;
    state: GameState;
    profile: EraSimulationProfile;
    teams: [
        SimulationTeam,
        SimulationTeam
    ];
    teamUnits: [
        readonly string[],
        readonly string[]
    ];
    preps: [
        TeamPrep,
        TeamPrep
    ];
    meanTripSeconds: number;
    eraPossEstimatePerTrip: number;
    passingAnchorFactor: number;
    possessionStart: PossessionStartType;
    homeCourt?: SeasonHomeCourtMechanisms;
    effects?: SeasonEffectsHook;
}
export function createTripContext(rng: Rng, recorder: GameRecorder, state: GameState, profile: EraSimulationProfile, teams: [
    SimulationTeam,
    SimulationTeam
], homeCourt?: SeasonHomeCourtMechanisms, effects?: SeasonEffectsHook): TripContext {
    return {
        rng,
        recorder,
        state,
        profile,
        teams,
        teamUnits: [unitVersionIdsOf(teams[0]), unitVersionIdsOf(teams[1])],
        preps: [prepareTeam(teams[0], profile), prepareTeam(teams[1], profile)],
        meanTripSeconds: meanTripSeconds(profile),
        eraPossEstimatePerTrip: eraPossEstimatePerTrip(profile) ?? 1,
        passingAnchorFactor: 0.5 + (profile.parameters.assistAnchorRating - 50) / 100,
        possessionStart: 'neutral',
        ...(homeCourt !== undefined ? { homeCourt } : {}),
        ...(effects !== undefined ? { effects } : {}),
    };
}
export interface PossessionStep {
    ended: boolean;
    pause: boolean;
    periodEnded: boolean;
    finished: boolean;
}
function slotOf(prep: TeamPrep, player: SimulationPlayer): number {
    return prep.slotByPlayerId.get(enginePlayerKey(player)) ?? -1;
}
function slotOrZero(prep: TeamPrep, player: SimulationPlayer): number {
    const slot = slotOf(prep, player);
    return slot >= 0 ? slot : 0;
}
export class PossessionStepper {
    private phase: 'sample' | 'security' | 'foul' | 'inbound' | 'shot' | 'continuation' | 'done' = 'sample';
    private foulIndex = 0;
    private continuations = 0;
    private deadBall = false;
    private readonly ctx: TripContext;
    private readonly offenseSide: SideIndex;
    private readonly startedRemaining: number;
    private finalStep: PossessionStep | null = null;
    private handlerVersion: string | undefined;
    private shooterVersion: string | undefined;
    private defenderVersion: string | undefined;
    private readonly tripRebounds: [
        number,
        number
    ] = [0, 0];
    constructor(ctx: TripContext, offenseSide: SideIndex) {
        this.ctx = ctx;
        this.offenseSide = offenseSide;
        this.startedRemaining = ctx.state.secondsRemaining;
    }
    step(): PossessionStep {
        if (this.phase === 'done') {
            if (this.finalStep === null) {
                throw new Error('possession: stepper finished without a terminal step');
            }
            return this.finalStep;
        }
        switch (this.phase) {
            case 'sample':
                return this.stepSample();
            case 'security':
                return this.stepSecurity();
            case 'foul':
                return this.stepFoulCheck();
            case 'inbound': {
                consumeTime(this.ctx.state, ENGINE_CONSTANTS.inboundConsumption);
                this.phase = 'foul';
                return { ended: false, pause: false, periodEnded: false, finished: false };
            }
            case 'shot':
                return this.stepShot();
            case 'continuation':
                return this.stepContinuation();
        }
        throw new Error(`possession: unknown stepper phase ${String(this.phase)}`);
    }
    private stepSample(): PossessionStep {
        const { rng, state, profile } = this.ctx;
        const sampled = sampleTripSeconds(rng, profile, state.secondsRemaining, this.ctx.meanTripSeconds);
        if (sampled === null) {
            return this.finish({ ended: false, pause: true, periodEnded: true });
        }
        const consumedBase = consumeTime(state, sampled);
        this.deadBall = consumedBase >= this.startedRemaining - ENGINE_CONSTANTS.minimumStartSeconds;
        this.phase = 'security';
        return { ended: false, pause: false, periodEnded: false, finished: false };
    }
    private stepSecurity(): PossessionStep {
        const { rng, recorder, teams, preps } = this.ctx;
        const offense = this.offenseSide;
        const defense = (1 - offense) as SideIndex;
        const team = teams[offense];
        const teamPrep = preps[offense];
        const defensePrep = preps[defense];
        const handler = rng.weightedPick(team.players, teamPrep.initiatorWeights);
        const handlerSlot = slotOf(teamPrep, handler);
        this.handlerVersion = handler.playerVersionId;
        const awayTurnoverPressure = this.offenseSide === 1 ? (this.ctx.homeCourt?.awayTurnoverPressureAdjustment ?? 0) : 0;
        const effectsAdjustment = this.ctx.effects?.turnoverAdjustment({
            handlerVersion: simulationPlayerVersion(handler),
            offenseSide: offense,
        }) ?? 0;
        if (rng.chance(turnoverProbability(handler, defensePrep.pressure, this.ctx.eraPossEstimatePerTrip, this.ctx.profile, awayTurnoverPressure, effectsAdjustment / 1000000))) {
            recorder.turnover(offense, handlerSlot >= 0 ? handlerSlot : 0);
            if (isSteal(rng, defensePrep.stealAbility, this.ctx.profile)) {
                const stealer = rng.weightedPick(teams[defense].players, defensePrep.stealerWeights);
                const stealerSlot = slotOf(defensePrep, stealer);
                recorder.steal(defense, stealerSlot >= 0 ? stealerSlot : 0);
            }
            this.ctx.possessionStart = 'liveTurnover';
            recorder.possession(offense);
            return this.endedStep(false);
        }
        this.phase = 'foul';
        return { ended: false, pause: false, periodEnded: false, finished: false };
    }
    private stepFoulCheck(): PossessionStep {
        const { rng, recorder, state, teams, preps, profile } = this.ctx;
        const offense = this.offenseSide;
        const defense = (1 - offense) as SideIndex;
        if (this.foulIndex >= 4) {
            this.phase = 'shot';
            return { ended: false, pause: false, periodEnded: false, finished: false };
        }
        this.foulIndex += 1;
        if (!rng.chance(nonShootingFoulProbability(profile))) {
            this.phase = 'shot';
            return { ended: false, pause: false, periodEnded: false, finished: false };
        }
        if (rng.chance(ENGINE_CONSTANTS.offensiveFoulShare)) {
            const offenseTeam = teams[offense];
            const offensePrep = preps[offense];
            const fouler = rng.weightedPick(offenseTeam.players, offensePrep.foulerWeights);
            const foulerSlot = slotOf(offensePrep, fouler);
            recorder.foul(offense, foulerSlot >= 0 ? foulerSlot : 0);
            recorder.turnover(offense, foulerSlot >= 0 ? foulerSlot : 0);
            state.periodFouls[offense] += 1;
            recorder.possession(offense);
            this.ctx.possessionStart = 'deadBall';
            return this.endedStep(true);
        }
        const defenseTeam = teams[defense];
        const defensePrep = preps[defense];
        const fouler = rng.weightedPick(defenseTeam.players, defensePrep.foulerWeights);
        const foulerSlot = slotOf(defensePrep, fouler);
        recorder.foul(defense, foulerSlot >= 0 ? foulerSlot : 0);
        state.periodFouls[defense] += 1;
        if (teamInBonus(state.periodFouls[defense], state.periodIndex >= 4)) {
            const team = teams[offense];
            const teamPrep = preps[offense];
            const shooter = rng.weightedPick(team.players, teamPrep.freeThrowShooterWeights);
            const shooterSlot = slotOf(teamPrep, shooter);
            resolveFreeThrows(this.ctx, offense, defense, shooterSlot, 2, this.deadBall, this.tripRebounds);
            this.ctx.possessionStart = 'deadBall';
            recorder.possession(offense);
            return this.endedStep(true);
        }
        this.phase = 'inbound';
        return { ended: false, pause: true, periodEnded: false, finished: false };
    }
    private stepShot(): PossessionStep {
        const { recorder } = this.ctx;
        const offense = this.offenseSide;
        const defense = (1 - offense) as SideIndex;
        const outcome = resolveShot(this.ctx, offense, defense, this.deadBall, this.tripRebounds);
        this.shooterVersion = outcome.shooterVersion;
        this.defenderVersion = outcome.defenderVersion;
        if (!outcome.continues) {
            recorder.possession(offense);
            return this.endedStep(!outcome.liveReboundEnd);
        }
        if (this.continuations >= 4) {
            recorder.possession(offense);
            return this.endedStep(false);
        }
        this.phase = 'continuation';
        return { ended: false, pause: false, periodEnded: false, finished: false };
    }
    private stepContinuation(): PossessionStep {
        const { recorder, state } = this.ctx;
        const offense = this.offenseSide;
        this.continuations += 1;
        consumeTime(state, ENGINE_CONSTANTS.continuationConsumption);
        if (state.secondsRemaining < ENGINE_CONSTANTS.minimumStartSeconds) {
            recorder.possession(offense);
            this.recordTrip();
            return this.finish({ ended: true, pause: true, periodEnded: true });
        }
        this.phase = 'shot';
        return { ended: false, pause: false, periodEnded: false, finished: false };
    }
    private endedStep(pause: boolean): PossessionStep {
        this.recordTrip();
        return this.finish({
            ended: true,
            pause,
            periodEnded: this.ctx.state.secondsRemaining <= 0,
        });
    }
    private recordTrip(): void {
        const effects = this.ctx.effects;
        if (effects === undefined)
            return;
        if (this.handlerVersion === undefined) {
            throw new Error('possession: effects trip facts require a recorded handler');
        }
        effects.recordTrip({
            homeUnit: this.ctx.teamUnits[0],
            awayUnit: this.ctx.teamUnits[1],
            handler: this.handlerVersion,
            ...(this.shooterVersion !== undefined ? { shooter: this.shooterVersion } : {}),
            ...(this.defenderVersion !== undefined ? { defender: this.defenderVersion } : {}),
            reboundContestCounts: this.tripRebounds,
        });
    }
    private finish(step: Omit<PossessionStep, 'finished'>): PossessionStep {
        const result: PossessionStep = { ...step, finished: true };
        this.phase = 'done';
        this.finalStep = result;
        return result;
    }
}
export function resolveTrip(ctx: TripContext, offenseSide: SideIndex): TripResolution {
    const startedRemaining = ctx.state.secondsRemaining;
    const stepper = new PossessionStepper(ctx, offenseSide);
    let step: PossessionStep = { ended: false, pause: false, periodEnded: false, finished: false };
    while (!step.periodEnded && !step.finished) {
        step = stepper.step();
    }
    return {
        secondsElapsed: startedRemaining - ctx.state.secondsRemaining,
        ended: step.ended,
    };
}
function consumeTime(state: GameState, seconds: number): number {
    const consumed = Math.min(seconds, state.secondsRemaining);
    state.secondsRemaining -= consumed;
    return consumed;
}
function simulationPlayerVersion(player: SimulationPlayer): string {
    const version = player.playerVersionId;
    if (version === undefined) {
        throw new Error('possession: effects facts require a playerVersionId');
    }
    return version;
}
function unitVersionIdsOf(team: SimulationTeam): readonly string[] {
    return team.players.map((player) => player.playerVersionId ?? '');
}
export function assistProbabilityPure(profile: EraSimulationProfile, passingAnchorFactor: number, passer: SimulationPlayer, action: ActionType, zone: ShotZone, shooter: SimulationPlayer, effectsAdjustment = 0): number {
    const factor = 0.5 + (passer.ratings.passing - 50) / 100;
    const roleFactor = passer.anchors
        ? 0.75 + Math.min(1, passer.anchors.assistsPerGame / 8) * 0.25
        : 1;
    const creation = 0.6 + 0.7 * creationScore(passer);
    const actionFactor = action === 'transition'
        ? 1.25
        : action === 'cut'
            ? 1.2
            : action === 'pickAndRollRoll'
                ? 1.25
                : action === 'spotUp'
                    ? 1.15
                    : action === 'pickAndRoll'
                        ? 1.1
                        : action === 'postUp'
                            ? 0.85
                            : 0.5;
    const zoneFactor = zone === 'rim'
        ? 1.15
        : zone === 'shortMid'
            ? 1.05
            : zone === 'longMid'
                ? 0.95
                : zone === 'cornerThree'
                    ? 1.1
                    : 1;
    const finishing = 0.9 + 0.2 * (zoneSkillRating(shooter, zone) / 100);
    return Math.min(0.99, Math.max(0.05, profile.parameters.assistRate *
        0.95 *
        roleFactor *
        creation *
        actionFactor *
        zoneFactor *
        finishing *
        (factor / Math.max(1e-9, passingAnchorFactor)) +
        effectsAdjustment));
}
function creditAssist(ctx: TripContext, offenseSide: SideIndex, team: SimulationTeam, shooter: SimulationPlayer, initiator: SimulationPlayer, action: ActionType, zone: ShotZone, passed: boolean): void {
    if (!passed)
        return;
    const passer = pickAssister(team, shooter, initiator, ctx.rng);
    if (!passer)
        return;
    const slot = slotOf(ctx.preps[offenseSide], passer);
    if (slot < 0)
        return;
    ctx.recorder.assistOpportunity(offenseSide, slot);
    const effectsAdjustment = ctx.effects?.assistAdjustment({ offenseSide }) ?? 0;
    if (!ctx.rng.chance(assistProbabilityPure(ctx.profile, ctx.passingAnchorFactor, passer, action, zone, shooter, effectsAdjustment / 1000000))) {
        return;
    }
    ctx.recorder.assist(offenseSide, slot);
}
function reboundChances(ctx: TripContext, offenseSide: SideIndex, defenseSide: SideIndex, reboundCounter: [
    number,
    number
]): void {
    ctx.recorder.offensiveReboundChance(offenseSide);
    ctx.recorder.defensiveReboundChance(defenseSide);
    reboundCounter[offenseSide] += 1;
    reboundCounter[defenseSide] += 1;
}
function reboundFromMissedFreeThrow(ctx: TripContext, offenseSide: SideIndex, defenseSide: SideIndex, deadBall: boolean, reboundCounter: [
    number,
    number
]): void {
    reboundChances(ctx, offenseSide, defenseSide, reboundCounter);
    const result = resolveRebound(ctx.rng, ctx.preps[offenseSide].offensiveReboundMean, ctx.preps[defenseSide].defensiveReboundMean, 'rim', ctx.profile, deadBall);
    if (result.team) {
        ctx.recorder.teamRebound(defenseSide);
        return;
    }
    const offensive = result.offensive;
    const side = offensive ? offenseSide : defenseSide;
    const team = ctx.teams[side];
    const prep = ctx.preps[side];
    const rebounder = ctx.rng.weightedPick(team.players, prep.rebounderWeights[offensive ? 0 : 1]);
    const slot = slotOrZero(prep, rebounder);
    if (offensive) {
        ctx.recorder.offensiveRebound(offenseSide, slot);
    }
    else {
        ctx.recorder.defensiveRebound(defenseSide, slot);
    }
}
function resolveFreeThrows(ctx: TripContext, offenseSide: SideIndex, defenseSide: SideIndex, shooterSlot: number, attempts: number, deadBall: boolean, reboundCounter: [
    number,
    number
]): void {
    const { rng, recorder } = ctx;
    const shooter = ctx.teams[offenseSide].players[shooterSlot];
    if (shooter === undefined) {
        throw new Error(`possession: no player at slot ${String(shooterSlot)}`);
    }
    for (let i = 0; i < attempts; i += 1) {
        const last = i === attempts - 1;
        const p = ctx.preps[offenseSide].freeThrowP[shooterSlot] ?? freeThrowProbability(shooter, ctx.profile);
        const made = rng.chance(p);
        recorder.freeThrow(offenseSide, shooterSlot, made);
        if (last && !made) {
            reboundFromMissedFreeThrow(ctx, offenseSide, defenseSide, deadBall, reboundCounter);
        }
        else if (!made) {
            reboundChances(ctx, offenseSide, defenseSide, reboundCounter);
            recorder.teamRebound(defenseSide);
        }
    }
    recorder.freeThrowTrip(offenseSide);
}
interface ShotOutcome {
    continues: boolean;
    liveReboundEnd: boolean;
    shooterVersion?: string;
    defenderVersion?: string;
}
function resolveShot(ctx: TripContext, offenseSide: SideIndex, defenseSide: SideIndex, deadBall: boolean, reboundCounter: [
    number,
    number
]): ShotOutcome {
    const { rng, recorder, state, profile } = ctx;
    const team = ctx.teams[offenseSide];
    const teamPrep = ctx.preps[offenseSide];
    const defense = ctx.teams[defenseSide];
    const defensePrep = ctx.preps[defenseSide];
    const initiator = rng.weightedPick(team.players, teamPrep.initiatorWeights);
    const actionWeights = teamPrep.actionWeights.get(enginePlayerKey(initiator));
    if (actionWeights === undefined) {
        throw new Error(`possession: no action weights for ${initiator.playerId}`);
    }
    const action = pickAction(initiator, actionWeights, rng, ctx.possessionStart);
    const teammateShots = teamPrep.teammateShots.get(enginePlayerKey(initiator));
    if (teammateShots === undefined) {
        throw new Error(`possession: no teammate shot table for ${initiator.playerId}`);
    }
    const shot = pickShot(teammateShots, initiator, action, rng, teamPrep.passP.get(enginePlayerKey(initiator)));
    const shooter = shot.shooter;
    const zonePrep = teamPrep.zonePrep.get(enginePlayerKey(shooter));
    if (zonePrep === undefined) {
        throw new Error(`possession: no zone preparation for ${shooter.playerId}`);
    }
    const zone = pickZone(action, zonePrep, rng);
    const shooterSlot = slotOf(teamPrep, shooter);
    const defender = pickDefender(defense, zone, rng, defensePrep.defenderBase, shooterSlot);
    const three = isThreePointZone(zone);
    const defenderSlot = slotOf(defensePrep, defender);
    if (defenderSlot >= 0)
        recorder.contest(defenseSide, defenderSlot);
    const shotPrep: ShotPrep = {
        spacing: teamPrep.spacing,
        twoPointAnchor: teamPrep.twoPointAnchor.get(enginePlayerKey(shooter)) ?? null,
    };
    const effectsAdjustment = ctx.effects?.makeAdjustment({
        shooterVersion: simulationPlayerVersion(shooter),
        offenseSide,
        defenseSide,
    }) ?? 0;
    const effectsAdjustmentFraction = effectsAdjustment / 1000000;
    const foulP = shootingFoulProbability(shooter, defender, zone, profile);
    if (rng.chance(foulP)) {
        recorder.foul(defenseSide, defenderSlot >= 0 ? defenderSlot : 0);
        state.periodFouls[defenseSide] += 1;
        const homeDefenseAdjustment = defenseSide === 0 ? (ctx.homeCourt?.homeDefenseShotAdjustment ?? 0) : 0;
        const shotP = makeProbability(shooter, defender, profile, zone, action, state.secondsRemaining, shotPrep, homeDefenseAdjustment, effectsAdjustmentFraction) * ENGINE_CONSTANTS.fouledShotMakeScale;
        const made = rng.chance(shotP);
        recorder.fieldGoalAttempt(offenseSide, shooterSlot, zone, made, three, shot.passed);
        if (made) {
            creditAssist(ctx, offenseSide, team, shooter, initiator, action, zone, shot.passed);
            resolveFreeThrows(ctx, offenseSide, defenseSide, shooterSlot, 1, false, reboundCounter);
        }
        else {
            reboundChances(ctx, offenseSide, defenseSide, reboundCounter);
            recorder.teamRebound(defenseSide);
            resolveFreeThrows(ctx, offenseSide, defenseSide, shooterSlot, freeThrowsForZone(zone), deadBall, reboundCounter);
        }
        ctx.possessionStart = 'deadBall';
        return {
            continues: false,
            liveReboundEnd: false,
            shooterVersion: shooter.playerVersionId,
            defenderVersion: defender.playerVersionId,
        };
    }
    const blockP = blockProbability(defender, zone, action);
    if (rng.chance(blockP)) {
        recorder.block(defenseSide, defenderSlot >= 0 ? defenderSlot : 0);
        recorder.fieldGoalAttempt(offenseSide, shooterSlot, zone, false, three, shot.passed);
        return reboundAfterMiss(ctx, offenseSide, defenseSide, zone, deadBall, reboundCounter, shooter.playerVersionId, defender.playerVersionId);
    }
    const homeDefenseAdjustment = defenseSide === 0 ? (ctx.homeCourt?.homeDefenseShotAdjustment ?? 0) : 0;
    const shotP = makeProbability(shooter, defender, profile, zone, action, state.secondsRemaining, shotPrep, homeDefenseAdjustment, effectsAdjustmentFraction);
    const made = rng.chance(shotP);
    recorder.fieldGoalAttempt(offenseSide, shooterSlot, zone, made, three, shot.passed);
    if (made) {
        creditAssist(ctx, offenseSide, team, shooter, initiator, action, zone, shot.passed);
        ctx.possessionStart = 'madeBasket';
        return {
            continues: false,
            liveReboundEnd: false,
            shooterVersion: shooter.playerVersionId,
            defenderVersion: defender.playerVersionId,
        };
    }
    return reboundAfterMiss(ctx, offenseSide, defenseSide, zone, deadBall, reboundCounter, shooter.playerVersionId, defender.playerVersionId);
}
function reboundAfterMiss(ctx: TripContext, offenseSide: SideIndex, defenseSide: SideIndex, zone: ShotZone, deadBall: boolean, reboundCounter: [
    number,
    number
], shooterVersion?: string, defenderVersion?: string): ShotOutcome {
    const { rng, recorder } = ctx;
    reboundChances(ctx, offenseSide, defenseSide, reboundCounter);
    const result = resolveRebound(rng, ctx.preps[offenseSide].offensiveReboundMean, ctx.preps[defenseSide].defensiveReboundMean, zone, ctx.profile, deadBall);
    if (result.team) {
        recorder.teamRebound(defenseSide);
        ctx.possessionStart = 'deadBall';
        return {
            continues: false,
            liveReboundEnd: false,
            ...(shooterVersion !== undefined ? { shooterVersion } : {}),
            ...(defenderVersion !== undefined ? { defenderVersion } : {}),
        };
    }
    if (result.offensive) {
        const prep = ctx.preps[offenseSide];
        const rebounder = rng.weightedPick(ctx.teams[offenseSide].players, prep.rebounderWeights[0]);
        recorder.offensiveRebound(offenseSide, slotOrZero(prep, rebounder));
        ctx.possessionStart = 'offensiveRebound';
        return {
            continues: true,
            liveReboundEnd: false,
            ...(shooterVersion !== undefined ? { shooterVersion } : {}),
            ...(defenderVersion !== undefined ? { defenderVersion } : {}),
        };
    }
    const prep = ctx.preps[defenseSide];
    const rebounder = rng.weightedPick(ctx.teams[defenseSide].players, prep.rebounderWeights[1]);
    recorder.defensiveRebound(defenseSide, slotOrZero(prep, rebounder));
    ctx.possessionStart = 'defensiveRebound';
    return {
        continues: false,
        liveReboundEnd: true,
        ...(shooterVersion !== undefined ? { shooterVersion } : {}),
        ...(defenderVersion !== undefined ? { defenderVersion } : {}),
    };
}
function teamInBonus(foulsInPeriod: number, overtime: boolean): boolean {
    const limit = overtime
        ? ENGINE_CONSTANTS.bonusFoulsOvertime
        : ENGINE_CONSTANTS.bonusFoulsRegulation;
    return foulsInPeriod >= limit;
}
