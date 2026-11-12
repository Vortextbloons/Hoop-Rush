import { deepStrictEqual } from 'node:assert';
import {
  HAVOC_MUTATION_IDS,
  POSITIONS,
  seedSchema,
} from '../../packages/data-contracts/src/index.ts';
import { buildHavocGameInput, seedFromString } from '../../packages/test-fixtures/src/index.ts';
import { buildScenarioTeam } from '../../packages/engine/src/modes/havoc/runtime-test-support.ts';
import { soloToBattleInput } from '../../packages/engine/src/modes/havoc/core/battle-adapters.ts';
import { simulateAuditedHavocBattleGame as legacy } from './legacy-runtime/modes/havoc/core/battle-game.ts';
import { simulateAuditedHavocBattleGame as current } from '../../packages/engine/src/modes/havoc/core/battle-game.ts';
import { createEngineContext } from '../../packages/engine/src/sim/kernel.ts';

const context = createEngineContext();
const mutations = HAVOC_MUTATION_IDS.slice(HAVOC_MUTATION_IDS.indexOf('paper-giant'));
let games = 0;
for (const mutation of mutations) {
  for (let index = 0; index < 5; index += 1) {
    const home = buildScenarioTeam(
      'human',
      POSITIONS.map((slot, position) => ({ slot, mutations: position === 0 ? [mutation] : [] })),
    );
    const away = buildScenarioTeam(
      'opponent',
      POSITIONS.map((slot) => ({ slot, mutations: [] })),
    );
    const seed = seedSchema.parse(seedFromString(`rust-battle-${mutation}-${String(index)}`));
    const input = soloToBattleInput(buildHavocGameInput({ home, away, seed }));
    deepStrictEqual(current(input, context), legacy(input, context), `${mutation}, seed ${seed}`);
    games += 1;
  }
}
console.log(JSON.stringify({ parity: true, mutations: mutations.length, games }));
