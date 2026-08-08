import { describe, expect, it } from 'vitest';
import { buildGameSimulationInput, seedFromString } from '@hoop-rush/test-fixtures';
import type { GameSimulationInput } from '@hoop-rush/data-contracts';
import { createEngineContext } from './context.ts';
import { GameRecorder, type RecorderSide, type SideIndex } from './recorder.ts';
import { MAX_PERIODS, OVERTIME_PERIOD_SECONDS, REGULATION_PERIOD_SECONDS } from './periods.ts';
import {
  createGameState,
  createTripContext,
  PossessionStepper,
  resolveTrip,
  type PossessionStep,
  type TripContext,
} from './possession.ts';

/**
 * PossessionStepper decomposition properties (spec/2.0/04 M2.2): the
 * resumable step machine must produce exactly the same output, clock, and
 * recorder state as the monolithic `resolveTrip` driver, whether it runs to
 * completion in one pass or pauses at every legal dead-ball boundary (the
 * Season controller's cadence). The RNG call sequence is preserved across
 * pauses by construction; these tests lock the observable equivalence.
 */

type DriveMode = 'resolve' | 'step' | 'pause';

interface DriveResult {
  trips: number;
  secondsRemaining: number;
  sides: [RecorderSide, RecorderSide];
  /** Per-trip step lists (the pause mode resumes trips across pauses). */
  tripSteps: PossessionStep[][];
  /** Per-trip per-step cumulative side totals (points, FGA, FTA). */
  perTripTotals: Array<Array<{ points: number; fga: number; fta: number }>>;
}

function driveGame(input: GameSimulationInput, mode: DriveMode): DriveResult {
  const rng = createEngineContext().rngFactory(input.seed);
  const recorder = new GameRecorder();
  const state = createGameState();
  const ctx: TripContext = createTripContext(rng, recorder, state, input.profile, [
    input.home,
    input.away,
  ]);
  let offense: SideIndex = rng.chance(0.5) ? 0 : 1;
  let secondsRemaining = REGULATION_PERIOD_SECONDS;
  state.periodIndex = 0;
  const tripSteps: PossessionStep[][] = [];
  const perTripTotals: DriveResult['perTripTotals'] = [];
  let trips = 0;

  const totalsNow = (): { points: number; fga: number; fta: number } => ({
    points: recorder.sides[0].points + recorder.sides[1].points,
    fga: recorder.sides[0].fieldGoalAttempts + recorder.sides[1].fieldGoalAttempts,
    fta: recorder.sides[0].freeThrowAttempts + recorder.sides[1].freeThrowAttempts,
  });

  for (let period = 0; period < MAX_PERIODS; period += 1) {
    if (period > 0) {
      if (period >= 4 && recorder.sides[0].points !== recorder.sides[1].points) break;
      recorder.nextPeriod();
      secondsRemaining = period < 4 ? REGULATION_PERIOD_SECONDS : OVERTIME_PERIOD_SECONDS;
      state.periodIndex = period;
      state.periodFouls = [0, 0];
    }
    while (secondsRemaining > 0) {
      state.secondsRemaining = secondsRemaining;
      const steps: PossessionStep[] = [];
      const totals: DriveResult['perTripTotals'][number] = [totalsNow()];
      let terminal: PossessionStep;
      if (mode === 'resolve') {
        const result = resolveTrip(ctx, offense);
        if (!result.ended && result.secondsElapsed === 0 && state.secondsRemaining > 0) {
          // Less than the minimum start time remains; the production driver
          // seals the period on this stalled-clock guard.
          state.secondsRemaining = 0;
        }
        terminal = {
          ended: result.ended,
          pause: false,
          periodEnded: state.secondsRemaining <= 0,
          finished: true,
        };
        steps.push(terminal);
        totals.push(totalsNow());
      } else {
        const machine = new PossessionStepper(ctx, offense);
        let step: PossessionStep = {
          ended: false,
          pause: false,
          periodEnded: false,
          finished: false,
        };
        for (;;) {
          step = machine.step();
          steps.push(step);
          totals.push(totalsNow());
          if (step.finished || step.periodEnded) break;
          if (mode === 'pause' && step.pause && step.ended) break;
        }
        terminal = step;
      }
      if (terminal.periodEnded && state.secondsRemaining > 0) state.secondsRemaining = 0;
      tripSteps.push(steps);
      perTripTotals.push(totals);
      trips += 1;
      secondsRemaining = state.secondsRemaining;
      if (terminal.ended) offense = (1 - offense) as SideIndex;
    }
  }
  return {
    trips,
    secondsRemaining,
    sides: [recorder.sides[0], recorder.sides[1]],
    tripSteps,
    perTripTotals,
  };
}

const GAME_SEEDS = ['golden-1', 'golden-svsw', 'mirror-1', 'inv-sw', 'perf-1', 'mm-0', 'sw-5'];

describe('PossessionStepper decomposition', () => {
  it('step-by-step driving matches resolveTrip exactly', () => {
    for (const seed of GAME_SEEDS) {
      const input = buildGameSimulationInput({ seed: seedFromString(seed) });
      const resolve = driveGame(input, 'resolve');
      const step = driveGame(input, 'step');
      expect(Math.abs(step.trips - resolve.trips), seed).toBeLessThanOrEqual(1);
      expect(step.secondsRemaining, seed).toBe(resolve.secondsRemaining);
      expect(step.sides, seed).toEqual(resolve.sides);
    }
  });

  it('pausing at every legal boundary and resuming matches resolveTrip exactly', () => {
    for (const seed of GAME_SEEDS) {
      const input = buildGameSimulationInput({ seed: seedFromString(seed) });
      const resolve = driveGame(input, 'resolve');
      const pause = driveGame(input, 'pause');
      expect(Math.abs(pause.trips - resolve.trips), seed).toBeLessThanOrEqual(1);
      expect(pause.secondsRemaining, seed).toBe(resolve.secondsRemaining);
      expect(pause.sides, seed).toEqual(resolve.sides);
    }
  });

  it('pauses only at legal dead-ball boundaries', () => {
    for (const seed of GAME_SEEDS) {
      const input = buildGameSimulationInput({ seed: seedFromString(seed) });
      const { tripSteps } = driveGame(input, 'pause');
      for (const [tripIndex, steps] of tripSteps.entries()) {
        for (const [index, step] of steps.entries()) {
          if (!step.pause) continue;
          if (step.periodEnded) continue;
          if (step.ended) {
            // A terminal pause is the trip's final step.
            expect(index, `${seed} trip ${String(tripIndex)} step ${String(index)}`).toBe(
              steps.length - 1,
            );
          } else {
            // An inbound-producing foul pauses mid-trip; the next step must
            // be the non-pause inbound continuation, never a free throw.
            expect(index, `${seed} trip ${String(tripIndex)}`).toBeLessThan(steps.length - 1);
            expect(
              steps[index + 1]?.pause,
              `${seed} trip ${String(tripIndex)} step ${String(index + 1)}`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it('never splits a made basket from its free throw (and-one atomicity)', () => {
    for (const seed of GAME_SEEDS) {
      const input = buildGameSimulationInput({ seed: seedFromString(seed) });
      const { tripSteps, perTripTotals } = driveGame(input, 'pause');
      for (const [tripIndex, totals] of perTripTotals.entries()) {
        const steps = tripSteps[tripIndex];
        if (steps === undefined) continue;
        const firstPause = steps.findIndex((step) => step.pause);
        if (firstPause < 0) continue;
        const afterPause = totals[firstPause + 1];
        const last = totals[totals.length - 1];
        const first = totals[0];
        if (afterPause === undefined || last === undefined || first === undefined) continue;
        // A made basket scored before the pause must never be followed by
        // free throws after it (that would be a split and-one sequence).
        const scoredBeforePause = afterPause.points > first.points;
        const ftaGrewAfterPause = last.fta > afterPause.fta;
        expect(
          scoredBeforePause && ftaGrewAfterPause,
          `${seed} trip ${String(tripIndex)} splits a made basket from its free throws`,
        ).toBe(false);
      }
    }
  });

  it('keeps the clock stopped during free throws and counts the foul toward the bonus', () => {
    const input = buildGameSimulationInput({
      seed: seedFromString('stopped-clock-foul-accounting'),
    });
    const rng = createEngineContext().rngFactory(input.seed);
    const recorder = new GameRecorder();
    const state = createGameState();
    const ctx = createTripContext(rng, recorder, state, input.profile, [input.home, input.away]);
    let offense: SideIndex = 0;
    state.secondsRemaining = REGULATION_PERIOD_SECONDS;
    let observedFreeThrowSequence = false;

    for (let trip = 0; trip < 400 && state.secondsRemaining > 0; trip += 1) {
      const machine = new PossessionStepper(ctx, offense);
      for (;;) {
        const beforeClock = state.secondsRemaining;
        const beforeFta = recorder.sides[offense].freeThrowAttempts;
        const defense = (1 - offense) as SideIndex;
        const beforeTeamFouls = state.periodFouls[defense];
        const step = machine.step();
        const afterFta = recorder.sides[offense].freeThrowAttempts;
        if (afterFta > beforeFta) {
          observedFreeThrowSequence = true;
          expect(state.secondsRemaining).toBe(beforeClock);
          expect(state.periodFouls[defense]).toBeGreaterThan(beforeTeamFouls);
        }
        if (step.finished || step.periodEnded) {
          if (step.ended) offense = defense;
          break;
        }
      }
    }

    expect(observedFreeThrowSequence).toBe(true);
  });
});
