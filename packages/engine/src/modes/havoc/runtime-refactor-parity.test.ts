import { describe, expect, it } from 'bun:test';
import { POSITIONS, type HavocMutationId } from '@hoop-rush/data-contracts';
import { buildScenarioTeam, runScenario } from './runtime-test-support.ts';
const cases: Array<{
  mutations: HavocMutationId[];
  seed: string;
  resultDigest: string;
  tapeDigest: string;
}> = [
  {
    mutations: [],
    seed: 'runtime-refactor-plain-0',
    resultDigest: '9140052cccf80d08c1469b1235e8a55c',
    tapeDigest: '1c3f8ac4943b410054bbe0f61c728bd4',
  },
  {
    mutations: [],
    seed: 'runtime-refactor-plain-1',
    resultDigest: '742f89121d7f3ec63fddd9b8245e62c2',
    tapeDigest: '471c40bda6bfc489cb26629b854c68cd',
  },
  {
    mutations: ['heat-check'],
    seed: 'runtime-refactor-heat-check-0',
    resultDigest: '24cb7d8b9963a567bcc9cb2d3a14095b',
    tapeDigest: 'ff07db3cb3695ef836f82396815bbfac',
  },
  {
    mutations: ['heat-check'],
    seed: 'runtime-refactor-heat-check-1',
    resultDigest: '909030766a41dc22ffe04dfc7e0b8726',
    tapeDigest: 'a3849ffeb6113fa2c14b5078ff2745ce',
  },
  {
    mutations: ['body-snatcher'],
    seed: 'runtime-refactor-body-snatcher-0',
    resultDigest: '62391abdb2e35c113b8281a3edc415ed',
    tapeDigest: '750fd314305b929063fe02f66b089544',
  },
  {
    mutations: ['body-snatcher'],
    seed: 'runtime-refactor-body-snatcher-1',
    resultDigest: '8945be5c69654980cb58a1721c6fe52c',
    tapeDigest: '5350934301f112e71fe84e59ecebf6b3',
  },
  {
    mutations: ['fusion-dance'],
    seed: 'runtime-refactor-fusion-dance-0',
    resultDigest: '6bb5fa8140c8f1855d6587d770913bb1',
    tapeDigest: '5e23634de5211bb9de0d890f57abee3d',
  },
  {
    mutations: ['fusion-dance'],
    seed: 'runtime-refactor-fusion-dance-1',
    resultDigest: 'ba262e47ac0f93cbd2067ac123281d57',
    tapeDigest: '46e8eb574be52fbbab4938edd496fee7',
  },
  {
    mutations: ['the-great-equalizer'],
    seed: 'runtime-refactor-the-great-equalizer-0',
    resultDigest: '14b580bf185bd05374d3c9f165b6028f',
    tapeDigest: 'e05a87663bfaa1ca734c4ec4bf3c0936',
  },
  {
    mutations: ['the-great-equalizer'],
    seed: 'runtime-refactor-the-great-equalizer-1',
    resultDigest: '94a38f0c811c1c90e9a047bef76025fc',
    tapeDigest: '4237f3b578976069182ee59f48a35d25',
  },
  {
    mutations: ['time-lord'],
    seed: 'runtime-refactor-time-lord-0',
    resultDigest: '1e4c05539ae660bf117d40e172c1c023',
    tapeDigest: '404e62915eac93c56e140347355a3dc1',
  },
  {
    mutations: ['time-lord'],
    seed: 'runtime-refactor-time-lord-1',
    resultDigest: 'd5b9c18e999119aae9c4e0c03af205fe',
    tapeDigest: 'ca42188309ceabfff1a934858f044533',
  },
  {
    mutations: ['basketball-darwinism'],
    seed: 'runtime-refactor-basketball-darwinism-0',
    resultDigest: 'e6a88047ea22c8a3cd7a547d87ca3e37',
    tapeDigest: 'd000e4d340fd0aafc2dc0975c820be03',
  },
  {
    mutations: ['basketball-darwinism'],
    seed: 'runtime-refactor-basketball-darwinism-1',
    resultDigest: 'be76b385ed09925121216013d9645615',
    tapeDigest: 'df2e474f6fa071eb850a867962f464df',
  },
  {
    mutations: ['oops-all-centers'],
    seed: 'runtime-refactor-oops-all-centers-0',
    resultDigest: 'c6535753bdd587f712ca7d2d411d5683',
    tapeDigest: '6c1a764c4958cd08c23b0cfa81cc563c',
  },
  {
    mutations: ['oops-all-centers'],
    seed: 'runtime-refactor-oops-all-centers-1',
    resultDigest: 'dfdee978fdc57dccb89c8d1a5edd4188',
    tapeDigest: 'bf3e48160777d8baf8a4f30c8ac69166',
  },
  {
    mutations: ['clone-army'],
    seed: 'runtime-refactor-clone-army-0',
    resultDigest: '25eac60a2ea8c9c6c9d96d9c865e7f1a',
    tapeDigest: '7217483c8d0b9288067339e27327060c',
  },
  {
    mutations: ['clone-army'],
    seed: 'runtime-refactor-clone-army-1',
    resultDigest: '717c63b0aadd58f4fb31deb6502998e0',
    tapeDigest: '72595adabbf30ae68848e8b0ecd94cca',
  },
  {
    mutations: ['hostile-takeover'],
    seed: 'runtime-refactor-hostile-takeover-0',
    resultDigest: '57689cbe8b246f3207493d24045b942e',
    tapeDigest: '54bd29cb522097f7e2953ded41593d5b',
  },
  {
    mutations: ['hostile-takeover'],
    seed: 'runtime-refactor-hostile-takeover-1',
    resultDigest: 'dd18b693eaa9205f5340d4859eaccfe3',
    tapeDigest: '1b6209687bd0b36468de5dd6316f0f58',
  },
];
describe('Havoc runtime compatibility', () => {
  for (const scenario of cases)
    it(scenario.seed, () => {
      const home = buildScenarioTeam(
        'human',
        POSITIONS.map((slot, index) => ({
          slot,
          mutations: index === 0 ? scenario.mutations : [],
        })),
      );
      const away = buildScenarioTeam(
        'opponent',
        POSITIONS.map((slot) => ({ slot, mutations: [] })),
      );
      const run = runScenario(home, away, scenario.seed);
      expect(run.resultDigest).toBe(scenario.resultDigest);
      expect(run.tapeDigest).toBe(scenario.tapeDigest);
    });
});
