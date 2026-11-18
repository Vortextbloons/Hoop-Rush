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
    resultDigest: 'ea44c2c931ca18353ccecf43328f76b9',
    tapeDigest: 'f52125f9e7d5a2adcb83c113f79d7029',
  },
  {
    mutations: [],
    seed: 'runtime-refactor-plain-1',
    resultDigest: '55516cfd30260a598ae63e53718e0d2d',
    tapeDigest: '1c852854b8fe7d6054e6a4369cb6a8c4',
  },
  {
    mutations: ['heat-check'],
    seed: 'runtime-refactor-heat-check-0',
    resultDigest: 'bad2028f0c80181b1c2ed60d0dcd29df',
    tapeDigest: '9b7504b560257821567e5013a4f7cba5',
  },
  {
    mutations: ['heat-check'],
    seed: 'runtime-refactor-heat-check-1',
    resultDigest: 'ac73c9b39979db8705f3f4051f819ca3',
    tapeDigest: 'de30024f6f94dceb0ef6d9c5352ffa7f',
  },
  {
    mutations: ['body-snatcher'],
    seed: 'runtime-refactor-body-snatcher-0',
    resultDigest: '39b140daf179da4e25c40888d2a37d4a',
    tapeDigest: 'a7b8f4e7c293d2a37cdb75794d515097',
  },
  {
    mutations: ['body-snatcher'],
    seed: 'runtime-refactor-body-snatcher-1',
    resultDigest: '51a750387a79368c0de21d9e2708d448',
    tapeDigest: '5c28c08d50c63ca114aef303dcab11fd',
  },
  {
    mutations: ['fusion-dance'],
    seed: 'runtime-refactor-fusion-dance-0',
    resultDigest: '61ac7624cc62f3c0dfe5df968c57a4d4',
    tapeDigest: 'b1f5cd4d59c38de1de124a732bbd905d',
  },
  {
    mutations: ['fusion-dance'],
    seed: 'runtime-refactor-fusion-dance-1',
    resultDigest: 'de2ddfa7a99cb99baacd5c050e48e637',
    tapeDigest: '81a26903c945820f074419dd4d1a35d3',
  },
  {
    mutations: ['the-great-equalizer'],
    seed: 'runtime-refactor-the-great-equalizer-0',
    resultDigest: 'a4c61d765121503a93d969e04827e4a6',
    tapeDigest: '3d07f4eea6e5c90a23ed14905e7a9cfe',
  },
  {
    mutations: ['the-great-equalizer'],
    seed: 'runtime-refactor-the-great-equalizer-1',
    resultDigest: 'ed9a12b0569adc3ca5e7c0c61a8e5ee0',
    tapeDigest: '1ad6ba92d4ec374e2c93a26c94c11c42',
  },
  {
    mutations: ['time-lord'],
    seed: 'runtime-refactor-time-lord-0',
    resultDigest: '43972361a798dd5d0ad982975e707471',
    tapeDigest: 'e7622e1eff2e4faa6de42f7068cb320e',
  },
  {
    mutations: ['time-lord'],
    seed: 'runtime-refactor-time-lord-1',
    resultDigest: '50257d045ec71da0024740921dee31f4',
    tapeDigest: '66a5dff0bad0a6bc459ee5523767cea0',
  },
  {
    mutations: ['basketball-darwinism'],
    seed: 'runtime-refactor-basketball-darwinism-0',
    resultDigest: '33cd5bea6b99470e597e18dc8634ce1a',
    tapeDigest: '6e714fabcd0f08afa1ff79892f66fa1b',
  },
  {
    mutations: ['basketball-darwinism'],
    seed: 'runtime-refactor-basketball-darwinism-1',
    resultDigest: '656ff7141c5409a811a1b1ea13e8b3e4',
    tapeDigest: '58b132aeee30596ad581d5d48f5d041e',
  },
  {
    mutations: ['oops-all-centers'],
    seed: 'runtime-refactor-oops-all-centers-0',
    resultDigest: '483bf39d60dfee39abaaa8331269db2d',
    tapeDigest: 'fa633e9fa3c041d37de2093187ce676f',
  },
  {
    mutations: ['oops-all-centers'],
    seed: 'runtime-refactor-oops-all-centers-1',
    resultDigest: '60569d6e5682ee4ab2ee685869fb367e',
    tapeDigest: 'f064ef6b73b4fccf7a5f540122a5e89b',
  },
  {
    mutations: ['clone-army'],
    seed: 'runtime-refactor-clone-army-0',
    resultDigest: '90b9050758be59ebdffdfb0d09c2b857',
    tapeDigest: '369462e824df3cacd3aa4dee9346b838',
  },
  {
    mutations: ['clone-army'],
    seed: 'runtime-refactor-clone-army-1',
    resultDigest: '456a2d2e2fbb7d627f7c64343f22691e',
    tapeDigest: '83356856c867619a5e23b0cc15c37d46',
  },
  {
    mutations: ['hostile-takeover'],
    seed: 'runtime-refactor-hostile-takeover-0',
    resultDigest: 'ee38739c6cc4bcc0df018bd60178d34c',
    tapeDigest: '192d41e8cb5407c403be27220a359638',
  },
  {
    mutations: ['hostile-takeover'],
    seed: 'runtime-refactor-hostile-takeover-1',
    resultDigest: '10b8fd1b4cf18bf7c0c5a52d3b8ae3ab',
    tapeDigest: 'e5c6f50fef221003fbc775356eadd5bf',
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
