import { describe, expect, it } from 'bun:test';
import {
  POSITIONS,
  type HavocBattleTape,
  type HavocGameResult,
  capRushCardSchema,
  capRushLockedInputsSchema,
  capRushPlayoffGamePlanSchema,
} from '@hoop-rush/data-contracts';
import {
  buildCapRushLockedInputs,
  createEngineContext,
  simulateCapRushGame,
  simulateCapRushPlayoffGame,
  soloToBattleTape,
} from '@hoop-rush/engine';
import { seedFromString } from '@hoop-rush/test-fixtures';
import { buildScenarioTeam } from '../../../../../../packages/engine/src/modes/havoc/runtime-test-support.ts';
import { capRushTestSetup } from '../../../../../../packages/engine/src/modes/cap-rush/cap-rush-test-support.ts';
import { gamecastBattleVisibleState } from '#lib/gamecast/gamecast-battle-playback.js';
import { gamecastBattleLiveBoxes } from '#lib/gamecast/gamecast-battle-view.js';
import { capRushPlaybackItems } from './cap-rush-playback.js';

function lockedRun() {
  const setup = capRushTestSetup();
  return buildCapRushLockedInputs({
    runId: setup.state.runId,
    runSeed: setup.state.runSeed,
    variant: 'roulette',
    versionSet: setup.versionSet,
    catalog: setup.source,
    spin: null,
    picks: POSITIONS.map((slot, index) => ({
      pickOrdinal: index,
      slot,
      card: capRushCardSchema.parse({
        cardId: `crc-${String(index).repeat(32)}`,
        offerId: `cro-${'0'.repeat(32)}`,
        cardIndex: index,
        slot,
        bucket: 'budget',
        source: setup.index.bySlot.get(slot)?.[0],
        salaryDollars: 30_000_000,
      }),
    })),
    ...setup.lockSources,
  });
}

function expectReconciled(result: HavocGameResult, tape: HavocBattleTape) {
  const items = capRushPlaybackItems(tape);
  const visible = gamecastBattleVisibleState(items, items.length);
  expect(visible.period).toBe(4 + result.overtimePeriods);
  expect(visible.clockSeconds).toBe(0);
  for (const box of gamecastBattleLiveBoxes(result, visible)) {
    expect(box.score).toBe(result[box.side].points);
    for (const line of box.lines) {
      const final = result[box.side].participants.find(
        (entry) => entry.instanceId === line.instanceId,
      );
      if (final === undefined) throw new Error('unknown participant instance');
      expect(line).toMatchObject({
        points: final.points,
        adjustments: final.adjustments,
        rebounds: final.rebounds.total,
        assists: final.assists,
        steals: final.steals,
        blocks: final.blocks,
        turnovers: final.turnovers,
        fieldGoalsMade: final.fieldGoals.made,
        fieldGoalsAttempted: final.fieldGoals.attempted,
        freeThrowsMade: final.freeThrows.made,
        freeThrowsAttempted: final.freeThrows.attempted,
      });
    }
  }
}

function scenarioRun(seed: string, mutations: boolean) {
  const base = lockedRun();
  const opponent = base.opponents[0];
  if (opponent === undefined) throw new Error('missing opponent');
  const home = buildScenarioTeam(
    'human',
    POSITIONS.map((slot, index) => ({
      slot,
      mutations: mutations
        ? index === 0
          ? ['clone-army', 'basketball-roulette', 'golden-assist']
          : index === 1
            ? ['reverse-basketball', 'basketball-roulette', 'golden-assist']
            : ['basketball-roulette', 'golden-assist']
        : [],
      ratings: mutations ? { threePoint: 99 } : {},
      tendencies: mutations
        ? { threePointRate: 99, aboveBreakThreeFrequency: 100, rimFrequency: 1 }
        : {},
    })),
  );
  const away = buildScenarioTeam(
    'opponent',
    POSITIONS.map((slot) => ({ slot, mutations: [] })),
  );
  const target = home.starters.find((starter) => starter.slot === base.target.slot);
  if (target === undefined) throw new Error('missing scenario apron target');
  const locked = capRushLockedInputsSchema.parse({
    ...base,
    target: { ...base.target, instanceId: target.instanceId },
    human: { ...home, teamId: base.human.teamId, displayName: base.human.displayName },
    opponents: base.opponents.map((entry) =>
      entry === opponent ? { ...entry, team: { ...away, teamId: opponent.team.teamId } } : entry,
    ),
  });
  return simulateCapRushPlayoffGame({
    locked,
    context: createEngineContext(),
    plan: capRushPlayoffGamePlanSchema.parse({
      seriesId: 'crs-1-0',
      round: 1,
      seriesSlot: 0,
      gameOrdinal: 1,
      homeTeamId: locked.human.teamId,
      awayTeamId: opponent.team.teamId,
      homeSeed: 1,
      awaySeed: 8,
      userSide: 'home',
      isFinals: false,
      seed,
    }),
  });
}

describe('Cap Rush recorded broadcast', () => {
  for (const phase of ['regular', 'playoff'] as const) {
    for (const humanSide of ['home', 'away'] as const) {
      it(`reconciles the ${phase} tape with the user ${humanSide} and never reveals final events early`, () => {
        const locked = lockedRun();
        const opponent = locked.opponents[0];
        if (opponent === undefined) throw new Error('missing opponent');
        const gameIndex = locked.schedule.findIndex(
          (game) => game.humanHome === (humanSide === 'home'),
        );
        if (gameIndex < 0) throw new Error('missing schedule side');
        const simulation =
          phase === 'regular'
            ? simulateCapRushGame({
                locked,
                gameNumber: gameIndex + 1,
                context: createEngineContext(),
              })
            : simulateCapRushPlayoffGame({
                locked,
                context: createEngineContext(),
                plan: capRushPlayoffGamePlanSchema.parse({
                  seriesId: 'crs-1-0',
                  round: 1,
                  seriesSlot: 0,
                  gameOrdinal: 1,
                  homeTeamId: humanSide === 'home' ? locked.human.teamId : opponent.team.teamId,
                  awayTeamId: humanSide === 'away' ? locked.human.teamId : opponent.team.teamId,
                  homeSeed: 1,
                  awaySeed: 8,
                  userSide: humanSide,
                  isFinals: false,
                  seed: 'abcdef1234567890',
                }),
              });
        const result = 'result' in simulation ? simulation.result : simulation.game.result;
        if (result === null) throw new Error('missing user result');
        const tape =
          'result' in simulation
            ? soloToBattleTape(simulation.tape, result.humanSide)
            : simulation.tape;
        const items = capRushPlaybackItems(tape);
        const last = items.at(-1);
        expect(last?.event?.kind).toBe('game-end');
        expect(gamecastBattleVisibleState(items, 0).homeScore).toBe(0);
        const partial = gamecastBattleVisibleState(items, Math.floor(items.length / 2));
        expect(partial.events.some((event) => event.kind === 'game-end')).toBe(false);
        const visible = gamecastBattleVisibleState(items, items.length);
        const boxes = gamecastBattleLiveBoxes(result, visible);
        for (const box of boxes) {
          const team = result[box.side];
          expect(box.score).toBe(team.points);
          for (const line of box.lines) {
            const final = team.participants.find(
              (participant) => participant.instanceId === line.instanceId,
            );
            if (final === undefined) throw new Error('unknown recorded participant');
            expect(line.points).toBe(final.points);
            expect(line.adjustments).toBe(final.adjustments);
            expect(line.rebounds).toBe(final.rebounds.total);
            expect(line.assists).toBe(final.assists);
            expect(line.fieldGoalsMade).toBe(final.fieldGoals.made);
          }
        }
      });
    }
  }
  it('preserves overtime clock, tied regulation boundary and final participant accounting', () => {
    let overtime: ReturnType<typeof scenarioRun> | undefined;
    for (let attempt = 0; attempt < 128; attempt += 1) {
      const run = scenarioRun(
        seedFromString(`cap-rush-simcast-overtime-${String(attempt)}`),
        false,
      );
      if (run.game.summary.overtimePeriods > 0) {
        overtime = run;
        break;
      }
    }
    if (overtime === undefined || overtime.game.result === null)
      throw new Error('no overtime within 128 declared fixture seeds');
    expect(overtime.game.audit.ok).toBe(true);
    const items = capRushPlaybackItems(overtime.tape);
    const regulationEnd = items.findIndex(
      (item) => item.event?.kind === 'period-end' && item.period === 4,
    );
    const regulation = gamecastBattleVisibleState(items, regulationEnd + 1);
    expect(regulation.period).toBe(4);
    expect(regulation.clockSeconds).toBe(0);
    expect(regulation.homeScore).toBe(regulation.awayScore);
    const overtimeStart = items.findIndex(
      (item) => item.event?.kind === 'period-start' && item.period === 5,
    );
    expect(gamecastBattleVisibleState(items, overtimeStart + 1).clockSeconds).toBe(
      items[overtimeStart]?.clockSeconds ?? -1,
    );
    const overtimePossession = items.find(
      (item) => item.event?.kind === 'possession-start' && item.period === 5,
    );
    if (overtimePossession === undefined) throw new Error('missing overtime possession');
    expect(overtimePossession.clockSeconds).toBeLessThanOrEqual(300);
    expect(overtimePossession.clockSeconds).toBeGreaterThan(0);
    expect(regulation.events.some((event) => event.kind === 'game-end')).toBe(false);
    expectReconciled(overtime.game.result, overtime.tape);
  });

  it('keeps clones distinct and applies signed mutation scoring only at its recorded cursor', () => {
    let mutated: ReturnType<typeof scenarioRun> | undefined;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const run = scenarioRun(
        seedFromString(`cap-rush-simcast-clone-signed-${String(attempt)}`),
        true,
      );
      if (
        run.tape.scoring.some((entry) => entry.points < 0) &&
        run.tape.events.some((event) => event.kind === 'clone') &&
        run.tape.scoring.some((entry) => entry.kind === 'adjustment')
      ) {
        mutated = run;
        break;
      }
    }
    if (mutated === undefined || mutated.game.result === null)
      throw new Error('no clone/negative/adjustment tape within 32 declared fixture seeds');
    expect(mutated.game.audit.ok).toBe(true);
    const result = mutated.game.result;
    const clone = result.home.participants.find((line) => line.kind === 'clone');
    if (clone === undefined) throw new Error('missing clone result');
    expect(clone.instanceId).not.toBe(clone.ownerInstanceId);
    expect(result.home.participants.some((line) => line.instanceId === clone.ownerInstanceId)).toBe(
      true,
    );
    const items = capRushPlaybackItems(mutated.tape);
    const negativeIndex = items.findIndex(
      (item) => item.scoring !== null && item.scoring.points < 0,
    );
    const entry = items[negativeIndex]?.scoring;
    if (entry === undefined || entry === null) throw new Error('missing signed scoring');
    const before = gamecastBattleVisibleState(items, negativeIndex);
    const after = gamecastBattleVisibleState(items, negativeIndex + 1);
    const score = entry.side === 'home' ? 'homeScore' : 'awayScore';
    expect(after[score] - before[score]).toBe(entry.points);
    expect(after[score]).toBeLessThan(before[score]);
    const actorBefore = gamecastBattleLiveBoxes(result, before)
      .find((box) => box.side === entry.side)
      ?.lines.find((line) => line.instanceId === entry.actorInstanceId);
    const actorAfter = gamecastBattleLiveBoxes(result, after)
      .find((box) => box.side === entry.side)
      ?.lines.find((line) => line.instanceId === entry.actorInstanceId);
    if (actorBefore === undefined || actorAfter === undefined)
      throw new Error('missing actor instance');
    expect(actorAfter.points - actorBefore.points).toBe(entry.points);
    expect(actorAfter.adjustments - actorBefore.adjustments).toBe(
      entry.points - entry.nominalPoints,
    );
    expectReconciled(result, mutated.tape);
  });
});
ape);
  });
});
