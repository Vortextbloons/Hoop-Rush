import { mock } from 'bun:test';
import { deepStrictEqual } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as originalHash from '../../packages/data-contracts/src/season-hash.ts';
import type { JsonData } from '../../packages/data-contracts/src/season-hash.ts';

const referenceCanonical = originalHash.canonicalJson;
const nativeCanonical = originalHash.canonicalJsonData;
const nativeDigest = originalHash.canonicalJsonDataDigest;
const referenceDigest = originalHash.seasonDigestHex;
let accelerated = false;
mock.module(
  fileURLToPath(new URL('../../packages/data-contracts/src/season-hash.ts', import.meta.url)),
  () => ({
    ...originalHash,
    canonicalJsonData: (value: JsonData) =>
      accelerated ? nativeCanonical(value) : referenceCanonical(value),
    canonicalJsonDataDigest: (prefix: string, value: JsonData) =>
      accelerated
        ? nativeDigest(prefix, value)
        : referenceDigest(prefix + referenceCanonical(value)),
  }),
);

const { buildHavocGameInput, buildGameSimulationInput, seedFromString } =
  await import('../../packages/test-fixtures/src/index.ts');
const { seedSchema, havocBattleInputSchema } =
  await import('../../packages/data-contracts/src/index.ts');
const { createEngineContext } = await import('../../packages/engine/src/sim/kernel.ts');
const { simulateRecordedGame } = await import('../../packages/engine/src/sim/tape.ts');
const draftDigests = await import('../../packages/engine/src/modes/draft-duel/digests.ts');
const fixedDigests = await import('../../packages/engine/src/modes/fixed-five/digest.ts');
const { simulateAuditedHavocGame } =
  await import('../../packages/engine/src/modes/havoc/solo/simulate.ts');
const { soloToBattleInput } =
  await import('../../packages/engine/src/modes/havoc/core/battle-adapters.ts');
const { simulateAuditedHavocBattleGame } =
  await import('../../packages/engine/src/modes/havoc/core/battle-game.ts');
const { buildScenarioTeam } =
  await import('../../packages/engine/src/modes/havoc/runtime-test-support.ts');
const { CapRushApronRuntime } =
  await import('../../packages/engine/src/modes/cap-rush/apron-runtime.ts');
const battleDigests = await import('../../packages/engine/src/modes/havoc/core/battle-digests.ts');
const context = createEngineContext();
const solo = buildHavocGameInput();
const normal = soloToBattleInput(solo);
const mutationHome = buildScenarioTeam('human', [
  { slot: 'PG', mutations: ['point-god', 'time-lord'] },
  { slot: 'SG', mutations: ['sniper-gene'] },
  { slot: 'SF', mutations: ['clone-army'] },
  { slot: 'PF', mutations: ['glass-eater'] },
  { slot: 'C', mutations: [] },
]);
const mutationAway = buildScenarioTeam('opponent', [
  { slot: 'PG', mutations: ['sniper-gene'] },
  { slot: 'SG', mutations: ['point-god'] },
  { slot: 'SF', mutations: [] },
  { slot: 'PF', mutations: ['glass-eater'] },
  { slot: 'C', mutations: ['clone-army'] },
]);
const mutations = havocBattleInputSchema.parse({
  ...normal,
  home: { ...mutationHome, side: 'home' },
  away: { ...mutationAway, side: 'away' },
});
const standard = buildGameSimulationInput();

const battle = (index: number, mutated: boolean, side?: 0 | 1) => {
  const input = {
    ...(mutated ? mutations : normal),
    seed: seedSchema.parse(seedFromString(`mode-bench-${String(index)}`)),
  };
  let apron;
  if (side !== undefined) {
    const target = (side === 0 ? input.home : input.away).starters[4];
    if (target === undefined) throw new Error('missing target');
    apron = new CapRushApronRuntime({
      side,
      rules: { payrollStatus: side === 0 ? 'first-apron' : 'second-apron' },
      targetInstanceId: target.instanceId,
      targetSlot: 'C',
    });
    apron.bindTarget({
      playerId: target.source.playerId,
      ...(target.source.playerVersionId === null
        ? {}
        : { playerVersionId: target.source.playerVersionId }),
      displayName: target.source.displayName,
      positions: target.source.positions,
      heightInches: target.effective.physical.heightInches,
      weightLbs: target.effective.physical.weightLbs,
      ratings: target.effective.ratings,
      tendencies: target.effective.tendencies,
    });
  }
  const output = simulateAuditedHavocBattleGame(
    input,
    context,
    apron === undefined ? {} : { apron },
  );
  deepStrictEqual(output.audit.ok, true);
  return {
    result: output.result,
    tape: output.tape,
    audit: output.audit,
    resultDigest: battleDigests.havocBattleGameResultDigest(output.result),
    tapeDigest: battleDigests.havocBattleGameTapeDigest(output.tape),
    facts: apron?.recordedFacts() ?? [],
  };
};
const cases = [
  {
    name: 'Draft Duel recorded game + verification',
    run: (index: number) => {
      const output = simulateRecordedGame(
        { ...standard, seed: seedSchema.parse(seedFromString(`duel-${String(index)}`)) },
        context,
      );
      return {
        ...output,
        resultDigest: draftDigests.draftDuelGameResultDigest(output.result),
        tapeDigest: draftDigests.draftDuelGameTapeDigest(output.tape),
      };
    },
  },
  {
    name: 'Fixed-five multiplayer recorded game + verification',
    run: (index: number) => {
      const output = simulateRecordedGame(
        { ...standard, seed: seedSchema.parse(seedFromString(`fixed-${String(index)}`)) },
        context,
      );
      return {
        ...output,
        resultDigest: fixedDigests.fixedFiveDuelGameResultDigest(output.result),
        tapeDigest: fixedDigests.fixedFiveDuelGameTapeDigest(output.tape),
      };
    },
  },
  {
    name: 'Havoc solo game + audit',
    run: (index: number) => {
      const output = simulateAuditedHavocGame(
        { ...solo, seed: seedSchema.parse(seedFromString(`solo-${String(index)}`)) },
        context,
      );
      return { result: output.result, tape: output.tape, audit: output.audit };
    },
  },
  {
    name: 'Havoc multiplayer mutations + verification',
    run: (index: number) => battle(index, true),
  },
  {
    name: 'Cap Rush first-apron battle + verification',
    run: (index: number) => battle(index, false, 0),
  },
  {
    name: 'Cap Rush multiplayer second-apron battle + verification',
    run: (index: number) => battle(index, false, 1),
  },
];
const rows = [];
for (const scenario of cases) {
  for (let i = 0; i < 40; i++) {
    accelerated = false;
    const reference = scenario.run(i);
    accelerated = true;
    deepStrictEqual(scenario.run(i), reference, `${scenario.name}: ${String(i)}`);
  }
  const times = [[], []] as [number[], number[]];
  for (let round = 0; round < 9; round++) {
    for (let offset = 0; offset < 2; offset++) {
      const backend = (round + offset) % 2;
      accelerated = backend === 1;
      const start = performance.now();
      for (let i = 0; i < 40; i++) scenario.run(i);
      times[backend]?.push(performance.now() - start);
    }
  }
  const before = times[0].toSorted((a, b) => a - b)[4] ?? 0;
  const after = times[1].toSorted((a, b) => a - b)[4] ?? 0;
  const row = {
    mode: scenario.name,
    games: 40,
    parityGames: 40,
    beforeMs: before,
    afterMs: after,
    speedup: before / after,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}
writeFileSync(
  new URL('../../sim-wasm-modes-results.json', import.meta.url),
  JSON.stringify(
    {
      runtime: process.version,
      bun: Bun.version,
      rounds: 9,
      rows,
      note: 'These measurements include simulation, recording, audit and verification digests where indicated. Havoc/Cap Rush mutation rules still run in TypeScript; their canonical serialization and digest work runs in Rust/Wasm.',
    },
    null,
    2,
  ) + '\n',
);
