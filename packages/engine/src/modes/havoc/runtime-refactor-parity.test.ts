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
    resultDigest: 'e0a6f0a583c82f0941de6fffa0b55b55',
    tapeDigest: '1c3f8ac4943b410054bbe0f61c728bd4',
  },
  {
    mutations: [],
    seed: 'runtime-refactor-plain-1',
    resultDigest: 'ea69027ffcae1edbcda97a31cfd3e3af',
    tapeDigest: '471c40bda6bfc489cb26629b854c68cd',
  },
  {
    mutations: ['heat-check'],
    seed: 'runtime-refactor-heat-check-0',
    resultDigest: '26719016f27ce00a064b6a44a06738a6',
    tapeDigest: 'ff07db3cb3695ef836f82396815bbfac',
  },
  {
    mutations: ['heat-check'],
    seed: 'runtime-refactor-heat-check-1',
    resultDigest: 'e7846b0b470f228fd7628e259bda69bb',
    tapeDigest: 'a3849ffeb6113fa2c14b5078ff2745ce',
  },
  {
    mutations: ['body-snatcher'],
    seed: 'runtime-refactor-body-snatcher-0',
    resultDigest: 'a1c3b80a34abaa16fe53b9e4dff093fa',
    tapeDigest: '750fd314305b929063fe02f66b089544',
  },
  {
    mutations: ['body-snatcher'],
    seed: 'runtime-refactor-body-snatcher-1',
    resultDigest: 'a3e252219f23b26d26ab183bff456fb1',
    tapeDigest: '5350934301f112e71fe84e59ecebf6b3',
  },
  {
    mutations: ['fusion-dance'],
    seed: 'runtime-refactor-fusion-dance-0',
    resultDigest: '408cec0836885c34908cd54ada9a42f8',
    tapeDigest: '5e23634de5211bb9de0d890f57abee3d',
  },
  {
    mutations: ['fusion-dance'],
    seed: 'runtime-refactor-fusion-dance-1',
    resultDigest: 'ae0a2de2f0efa6cebf73f488bf361932',
    tapeDigest: '46e8eb574be52fbbab4938edd496fee7',
  },
  {
    mutations: ['the-great-equalizer'],
    seed: 'runtime-refactor-the-great-equalizer-0',
    resultDigest: '49287da813bffb94ae601a266f0ee6f8',
    tapeDigest: 'e05a87663bfaa1ca734c4ec4bf3c0936',
  },
  {
    mutations: ['the-great-equalizer'],
    seed: 'runtime-refactor-the-great-equalizer-1',
    resultDigest: 'b1bbd907aefd5ce3349250d57db3f737',
    tapeDigest: '4237f3b578976069182ee59f48a35d25',
  },
  {
    mutations: ['time-lord'],
    seed: 'runtime-refactor-time-lord-0',
    resultDigest: 'af2c087c7aff2cf03810c0f664bdcacc',
    tapeDigest: '404e62915eac93c56e140347355a3dc1',
  },
  {
    mutations: ['time-lord'],
    seed: 'runtime-refactor-time-lord-1',
    resultDigest: '39294d8d0b17497173266693de05a6fd',
    tapeDigest: 'ca42188309ceabfff1a934858f044533',
  },
  {
    mutations: ['basketball-darwinism'],
    seed: 'runtime-refactor-basketball-darwinism-0',
    resultDigest: '85d930500cee2eb450dc276203e94880',
    tapeDigest: 'd000e4d340fd0aafc2dc0975c820be03',
  },
  {
    mutations: ['basketball-darwinism'],
    seed: 'runtime-refactor-basketball-darwinism-1',
    resultDigest: '25a452561508b81a67e429b0e7a0b666',
    tapeDigest: 'df2e474f6fa071eb850a867962f464df',
  },
  {
    mutations: ['oops-all-centers'],
    seed: 'runtime-refactor-oops-all-centers-0',
    resultDigest: '2d6441b6ef0e1b7283b02c8c825b90a6',
    tapeDigest: '6c1a764c4958cd08c23b0cfa81cc563c',
  },
  {
    mutations: ['oops-all-centers'],
    seed: 'runtime-refactor-oops-all-centers-1',
    resultDigest: 'f3b575896dc8e9a5ffa7891791fc8859',
    tapeDigest: 'bf3e48160777d8baf8a4f30c8ac69166',
  },
  {
    mutations: ['clone-army'],
    seed: 'runtime-refactor-clone-army-0',
    resultDigest: 'dd6282b3ef02d787045395f18cd5cb03',
    tapeDigest: '7217483c8d0b9288067339e27327060c',
  },
  {
    mutations: ['clone-army'],
    seed: 'runtime-refactor-clone-army-1',
    resultDigest: '7123a6439f59131f44549cb5206e5f33',
    tapeDigest: '72595adabbf30ae68848e8b0ecd94cca',
  },
  {
    mutations: ['hostile-takeover'],
    seed: 'runtime-refactor-hostile-takeover-0',
    resultDigest: '85aad9a566ba1131c0e001d7e0ed2a95',
    tapeDigest: '54bd29cb522097f7e2953ded41593d5b',
  },
  {
    mutations: ['hostile-takeover'],
    seed: 'runtime-refactor-hostile-takeover-1',
    resultDigest: '444767149b61f1f873716d7a2401ae64',
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
