import type {
  HavocMutationId,
  HavocMutationPackage,
  HavocTier,
  Position,
} from '@hoop-rush/data-contracts';
import type { Rng } from '../../sim/rng.ts';

export interface HavocNicknameInput {
  readonly slot: Position;
  readonly tier: HavocTier;
  readonly mutations: HavocMutationPackage;
}

const HAVOC_MUTATION_TAGS: Record<HavocMutationId, string> = {
  'growth-spurt': 'Skyscraper',
  'alien-arms': 'Long-Armed',
  'mini-monster': 'Pocket',
  'super-soldier': 'Turbocharged',
  'sniper-gene': 'Sniper',
  'point-god': 'Maestro',
  'brick-wall': 'Brickhouse',
  'glass-eater': 'Glass-Crashing',
  'trigger-happy': 'Trigger-Happy',
  'walking-bucket': 'Buckets',
  butterfingers: 'Butterfingered',
  'freak-athlete': 'Freakish',
  'the-statue': 'Immovable',
  'reverse-evolution': 'Shrinking',
  'four-point-dunk': 'Slam',
  'golden-assist': 'Golden',
  'heat-check': 'Blazing',
  'second-chance-jackpot': 'Jackpot',
  'and-one-machine': 'And-One',
  'possession-refund': 'Sure-Handed',
  'rebound-loop': 'Looping',
  'the-bounty': 'Bounty-Hunting',
  'foul-thief': 'Slippery',
  'basketball-roulette': 'Roulette',
  'clone-army': 'Doubled',
  'time-lord': 'Timeless',
  'body-snatcher': 'Swapped',
  'reverse-basketball': 'Backwards',
  'double-or-nothing': 'All-In',
  'the-great-equalizer': 'Leveling',
};

const HAVOC_SLOT_NOUNS: Record<Position, readonly string[]> = {
  PG: ['Floor General', 'Pace Setter'],
  SG: ['Bucket', 'Shot Maker'],
  SF: ['Wing', 'Two-Way Wing'],
  PF: ['Bruiser', 'Enforcer'],
  C: ['Tower', 'Rim Titan'],
};

const HAVOC_NICKNAME_TEMPLATES: Record<HavocTier, readonly string[]> = {
  1: ['The {a} {n}', 'The {a} {b} {n}', '{a} {b} {n}'],
  2: ['{a} {n}', 'The {a} {n}', 'The {a} {b} {n}'],
  3: ['The {a} {n}', '{a} {n}', 'The {a} Havoc {n}'],
};

export function generateHavocNickname(input: HavocNicknameInput, rng: Rng): string {
  const tags = input.mutations.map((entry) => HAVOC_MUTATION_TAGS[entry.mutationId]);
  const primary = tags[0];
  if (primary === undefined) {
    throw new Error('havoc nickname generation requires at least one mutation');
  }
  const secondary = tags[1] ?? primary;
  const template = rng.pick(HAVOC_NICKNAME_TEMPLATES[input.tier]);
  const noun = rng.pick(HAVOC_SLOT_NOUNS[input.slot]);
  const nickname = template
    .replaceAll('{a}', primary)
    .replaceAll('{b}', secondary)
    .replaceAll('{n}', noun);
  if (nickname.length > 64) {
    throw new Error(`havoc nickname exceeds 64 characters: ${nickname}`);
  }
  return nickname;
}
