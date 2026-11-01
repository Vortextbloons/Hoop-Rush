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
    resultDigest: 'd434a395b0f86e59ab650d97de276a85',
    tapeDigest: 'c8c416b1ea1ad925b7ba4ff3a152d261',
  },
  {
    mutations: [],
    seed: 'runtime-refactor-plain-1',
    resultDigest: '47310b689d4b7af4b03c6c42558141d8',
    tapeDigest: 'b4a47ca03ccc1d2c22c2149a7209d930',
  },
  {
    mutations: ['heat-check'],
    seed: 'runtime-refactor-heat-check-0',
    resultDigest: 'bbb6e899523182a5b818631b36598a69',
    tapeDigest: '158cd30e7ef0136a8cd65a84f347e1de',
  },
  {
    mutations: ['heat-check'],
    seed: 'runtime-refactor-heat-check-1',
    resultDigest: 'a0bf7234f0c292985a60b0369bf09f24',
    tapeDigest: '64434ce6984bc5d22666fa005973b116',
  },
  {
    mutations: ['body-snatcher'],
    seed: 'runtime-refactor-body-snatcher-0',
    resultDigest: 'd56e0a295b0fd0ada53929b39df88059',
    tapeDigest: '9bfa745b0e25041fad7f159d7658fdab',
  },
  {
    mutations: ['body-snatcher'],
    seed: 'runtime-refactor-body-snatcher-1',
    resultDigest: 'f13c2f61fcd3131d0f1bd7b3dbc5de31',
    tapeDigest: 'a2a46c3a150826eebb5bfef8fce5524a',
  },
  {
    mutations: ['fusion-dance'],
    seed: 'runtime-refactor-fusion-dance-0',
    resultDigest: '07d84c6894cf6bbc1cbf08961a5b6cd8',
    tapeDigest: 'd0b275edd0eb5cd1ea139213568639dd',
  },
  {
    mutations: ['fusion-dance'],
    seed: 'runtime-refactor-fusion-dance-1',
    resultDigest: 'b8d90ca53b6354a19d60140751ac5cf5',
    tapeDigest: 'bd1b064742f0218b1a66b2b5c5e15c77',
  },
  {
    mutations: ['the-great-equalizer'],
    seed: 'runtime-refactor-the-great-equalizer-0',
    resultDigest: 'a4d0da7aef359abef092292ca82b81ea',
    tapeDigest: '56effc59a27cfc1d0f8188a77e53b489',
  },
  {
    mutations: ['the-great-equalizer'],
    seed: 'runtime-refactor-the-great-equalizer-1',
    resultDigest: '78d391215213ef1d68df800ba1e5f811',
    tapeDigest: 'e904ce3f1391092b1f8c7dd9e5d206cf',
  },
  {
    mutations: ['time-lord'],
    seed: 'runtime-refactor-time-lord-0',
    resultDigest: '736bbdd7b4a17613431a3f2d1b6c7527',
    tapeDigest: 'bde94f4a1c9524a694f4e04c0feb5f9a',
  },
  {
    mutations: ['time-lord'],
    seed: 'runtime-refactor-time-lord-1',
    resultDigest: '68306766816eb172632d39f8dcc59676',
    tapeDigest: '0b1a572accd9229ef8e0c0441c193dfa',
  },
  {
    mutations: ['basketball-darwinism'],
    seed: 'runtime-refactor-basketball-darwinism-0',
    resultDigest: 'd95c0e6ac5cafaae688d5a005262f91a',
    tapeDigest: '17c1efecf4df7be02af50ace8a98709c',
  },
  {
    mutations: ['basketball-darwinism'],
    seed: 'runtime-refactor-basketball-darwinism-1',
    resultDigest: '767382107f84eabc8bf7e90298190860',
    tapeDigest: '210340caacfcf11ece1a5a08850dbe1a',
  },
  {
    mutations: ['oops-all-centers'],
    seed: 'runtime-refactor-oops-all-centers-0',
    resultDigest: 'b29f8b1f9585b723cdb8a59d7fe5b22f',
    tapeDigest: 'bd8334276af3eb7ba99f88e599710837',
  },
  {
    mutations: ['oops-all-centers'],
    seed: 'runtime-refactor-oops-all-centers-1',
    resultDigest: '1187b0ef8a8f7d2bed2acbb5abf7977f',
    tapeDigest: '8b8881f4a488c550f626185eece3b224',
  },
  {
    mutations: ['clone-army'],
    seed: 'runtime-refactor-clone-army-0',
    resultDigest: 'f789e529985bf38d13528d8378fafd79',
    tapeDigest: 'd6eceb4345afdf07b01ed6a5a15ebef3',
  },
  {
    mutations: ['clone-army'],
    seed: 'runtime-refactor-clone-army-1',
    resultDigest: 'db46104b9cd40df7b2d7ca4d0f1a187b',
    tapeDigest: '5cbd5871eb352545a8e42677335d80e1',
  },
  {
    mutations: ['hostile-takeover'],
    seed: 'runtime-refactor-hostile-takeover-0',
    resultDigest: '2d2e3f91d53257bd60d0bb33068b7841',
    tapeDigest: '1f79afe81cfacd2493ecd6226184ae38',
  },
  {
    mutations: ['hostile-takeover'],
    seed: 'runtime-refactor-hostile-takeover-1',
    resultDigest: '2284ecc23186264e610bb2a829c7b552',
    tapeDigest: '774e76b73be3b0733ea0f5153ea8ddc7',
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
