import type { HavocMutationDefinition, HavocMutationId } from '@hoop-rush/data-contracts';
import { havocMutationDefinitionSchema } from '@hoop-rush/data-contracts';

function defineHavocMutation(definition: HavocMutationDefinition): HavocMutationDefinition {
  return havocMutationDefinitionSchema.parse(definition);
}

export const HAVOC_MUTATION_DEFINITIONS: readonly HavocMutationDefinition[] = [
  defineHavocMutation({
    mutationId: 'growth-spurt',
    tier: 1,
    name: 'Growth Spurt',
    description:
      'Adds a sampled 6-12 inches of height when the card is generated, improving size for finishing, contests, and rebounding.',
    downside: '',
    operations: [{ op: 'height-add', minInches: 6, maxInches: 12 }],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'alien-arms',
    tier: 1,
    name: 'Alien Arms',
    description:
      'Adds 18 inches of effective wingspan, improving contests, blocks, and rebound reach.',
    downside: '',
    operations: [{ op: 'reach-add', inches: 18 }],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'mini-monster',
    tier: 1,
    name: 'Mini Monster',
    description: 'Sets height to 60 inches but raises speed and ball handling to 99.',
    downside: 'Height is set to 60 inches, giving up size at the rim.',
    operations: [
      { op: 'height-set', inches: 60 },
      { op: 'raise-rating', field: 'speed', value: 99 },
      { op: 'raise-rating', field: 'ballHandling', value: 99 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'super-soldier',
    tier: 1,
    name: 'Super Soldier',
    description: 'Raises speed, strength, and vertical to 90.',
    downside: '',
    operations: [
      { op: 'raise-rating', field: 'speed', value: 90 },
      { op: 'raise-rating', field: 'strength', value: 90 },
      { op: 'raise-rating', field: 'vertical', value: 90 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'sniper-gene',
    tier: 1,
    name: 'Sniper Gene',
    description: 'Raises three-point rating to 97 and three-point shot rate to 80.',
    downside: '',
    operations: [
      { op: 'raise-rating', field: 'threePoint', value: 97 },
      { op: 'raise-tendency', field: 'threePointRate', value: 80 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'point-god',
    tier: 1,
    name: 'Point God',
    description: 'Raises passing and ball handling to 99 and pass rate to 85.',
    downside: '',
    operations: [
      { op: 'raise-rating', field: 'passing', value: 99 },
      { op: 'raise-rating', field: 'ballHandling', value: 99 },
      { op: 'raise-tendency', field: 'passRate', value: 85 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'brick-wall',
    tier: 1,
    name: 'Brick Wall',
    description: 'Raises interior defense, strength, and block to 99 and block attempt rate to 20.',
    downside: '',
    operations: [
      { op: 'raise-rating', field: 'interiorDefense', value: 99 },
      { op: 'raise-rating', field: 'strength', value: 99 },
      { op: 'raise-rating', field: 'block', value: 99 },
      { op: 'raise-tendency', field: 'blockAttemptRate', value: 20 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'glass-eater',
    tier: 1,
    name: 'Glass Eater',
    description:
      'Raises offensive and defensive rebounding to 99 and offensive glass crash rate to 80.',
    downside: '',
    operations: [
      { op: 'raise-rating', field: 'offensiveRebound', value: 99 },
      { op: 'raise-rating', field: 'defensiveRebound', value: 99 },
      { op: 'raise-tendency', field: 'crashOffensiveGlassRate', value: 80 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'trigger-happy',
    tier: 1,
    name: 'Trigger Happy',
    description:
      'Raises inside scoring, close shot, midrange, three-point, and free-throw ratings to 99, shot rate to 99, and usage rate to 45.',
    downside: 'Caps pass rate at 2; this player is looking for their own shot.',
    operations: [
      { op: 'raise-rating', field: 'insideScoring', value: 99 },
      { op: 'raise-rating', field: 'closeShot', value: 99 },
      { op: 'raise-rating', field: 'midrange', value: 99 },
      { op: 'raise-rating', field: 'threePoint', value: 99 },
      { op: 'raise-rating', field: 'freeThrow', value: 99 },
      { op: 'raise-tendency', field: 'shotRate', value: 99 },
      { op: 'raise-tendency', field: 'usageRate', value: 45 },
      { op: 'cap-tendency', field: 'passRate', value: 2 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'walking-bucket',
    tier: 1,
    name: 'Walking Bucket',
    description:
      'Adds 25 inside scoring, 20 close shot, and 30 midrange, and raises isolation rate to 85, short-mid frequency to 50, and long-mid frequency to 80.',
    downside: '',
    operations: [
      { op: 'add-rating', field: 'insideScoring', value: 25 },
      { op: 'add-rating', field: 'closeShot', value: 20 },
      { op: 'add-rating', field: 'midrange', value: 30 },
      { op: 'raise-tendency', field: 'isolationRate', value: 85 },
      { op: 'raise-tendency', field: 'shortMidFrequency', value: 50 },
      { op: 'raise-tendency', field: 'longMidFrequency', value: 80 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'butterfingers',
    tier: 1,
    name: 'Butterfingers',
    description: 'Raises inside scoring and close shot to 99 and turnover rate to 25.',
    downside: 'Caps ball handling at 20.',
    operations: [
      { op: 'raise-rating', field: 'insideScoring', value: 99 },
      { op: 'raise-rating', field: 'closeShot', value: 99 },
      { op: 'cap-rating', field: 'ballHandling', value: 20 },
      { op: 'raise-tendency', field: 'turnoverRate', value: 25 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'freak-athlete',
    tier: 1,
    name: 'Freak Athlete',
    description: 'Raises vertical, inside scoring, and close shot to 99.',
    downside: 'Caps three-point at 30 and midrange at 40.',
    operations: [
      { op: 'raise-rating', field: 'vertical', value: 99 },
      { op: 'raise-rating', field: 'insideScoring', value: 99 },
      { op: 'raise-rating', field: 'closeShot', value: 99 },
      { op: 'cap-rating', field: 'threePoint', value: 30 },
      { op: 'cap-rating', field: 'midrange', value: 40 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'the-statue',
    tier: 1,
    name: 'The Statue',
    description: 'Raises strength, inside scoring, and close shot to 99 and post-up rate to 90.',
    downside: 'Caps speed at 15.',
    operations: [
      { op: 'raise-rating', field: 'strength', value: 99 },
      { op: 'raise-rating', field: 'insideScoring', value: 99 },
      { op: 'raise-rating', field: 'closeShot', value: 99 },
      { op: 'raise-tendency', field: 'postUpRate', value: 90 },
      { op: 'cap-rating', field: 'speed', value: 15 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'reverse-evolution',
    tier: 1,
    name: 'Reverse Evolution',
    description:
      'Subtracts 10 inches of height but raises perimeter defense and steal to 99 and steal attempt rate to 20.',
    downside: 'Loses 10 inches of height.',
    operations: [
      { op: 'height-subtract', inches: 10 },
      { op: 'raise-rating', field: 'perimeterDefense', value: 99 },
      { op: 'raise-rating', field: 'steal', value: 99 },
      { op: 'raise-tendency', field: 'stealAttemptRate', value: 20 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'four-point-dunk',
    tier: 2,
    name: 'Four-Point Dunk',
    description: 'A made dunk scores one extra point, added after any multipliers.',
    downside: 'Caps three-point at 30 and raises turnover rate to 20.',
    operations: [
      { op: 'cap-rating', field: 'threePoint', value: 30 },
      { op: 'raise-tendency', field: 'turnoverRate', value: 20 },
    ],
    eventRules: ['four-point-dunk'],
  }),
  defineHavocMutation({
    mutationId: 'golden-assist',
    tier: 2,
    name: 'Golden Assist',
    description: 'Every third credited assist adds one extra point for the passer.',
    downside: 'Caps shot rate at 30 and raises turnover rate to 20.',
    operations: [
      { op: 'cap-tendency', field: 'shotRate', value: 30 },
      { op: 'raise-tendency', field: 'turnoverRate', value: 20 },
    ],
    eventRules: ['golden-assist'],
  }),
  defineHavocMutation({
    mutationId: 'heat-check',
    tier: 2,
    name: 'Heat Check',
    description:
      'Three consecutive made field goals arm a double-value next made field goal; the rewarded make consumes it.',
    downside:
      'Any miss resets the streak, and an unused armed effect expires after three possessions.',
    operations: [],
    eventRules: ['heat-check'],
  }),
  defineHavocMutation({
    mutationId: 'second-chance-jackpot',
    tier: 2,
    name: 'Second Chance Jackpot',
    description: "A made putback of the player's own offensive rebound scores double.",
    downside: 'Caps defensive rebounding at 30.',
    operations: [{ op: 'cap-rating', field: 'defensiveRebound', value: 30 }],
    eventRules: ['second-chance-jackpot'],
  }),
  defineHavocMutation({
    mutationId: 'and-one-machine',
    tier: 2,
    name: 'And-One Machine',
    description:
      'A made field goal plus a shooting foul earns two free-throw attempts instead of one.',
    downside: 'Caps free throw at 70 and raises foul rate to 50.',
    operations: [
      { op: 'cap-rating', field: 'freeThrow', value: 70 },
      { op: 'raise-tendency', field: 'foulRate', value: 50 },
    ],
    eventRules: ['and-one-machine'],
  }),
  defineHavocMutation({
    mutationId: 'possession-refund',
    tier: 2,
    name: 'Possession Refund',
    description:
      'Cancels the first turnover in each regulation half, keeping the ball with the remaining clock.',
    downside: 'Only the first turnover in each half is refunded.',
    operations: [],
    eventRules: ['possession-refund'],
  }),
  defineHavocMutation({
    mutationId: 'rebound-loop',
    tier: 2,
    name: 'Rebound Loop',
    description:
      'Every fourth offensive rebound earns the team a queued extra possession after the current one.',
    downside: 'The earned possession runs on a rushed 12-second shot clock.',
    operations: [],
    eventRules: ['rebound-loop'],
  }),
  defineHavocMutation({
    mutationId: 'the-bounty',
    tier: 2,
    name: 'The Bounty',
    description:
      "Blocking the opponent's top-ranked starter arms a triple-value next made field goal.",
    downside:
      'Only blocks on that ranked starter arm the effect, and it expires after three possessions.',
    operations: [],
    eventRules: ['the-bounty'],
  }),
  defineHavocMutation({
    mutationId: 'foul-thief',
    tier: 2,
    name: 'Foul Thief',
    description: 'Every two shooting fouls drawn removes one charged personal foul, down to zero.',
    downside: 'Charged fouls cannot drop below zero.',
    operations: [],
    eventRules: ['foul-thief'],
  }),
  defineHavocMutation({
    mutationId: 'basketball-roulette',
    tier: 2,
    name: 'Basketball Roulette',
    description:
      'Every fifth field-goal attempt rolls a 1-4 point value instead of the shot nominal value.',
    downside: 'The rolled value can be lower than a normal make.',
    operations: [],
    eventRules: ['basketball-roulette'],
  }),
  defineHavocMutation({
    mutationId: 'clone-army',
    tier: 3,
    name: 'Clone Army',
    description:
      "Adds a sixth on-court clone with the owner's profile, source identity, and position.",
    downside: 'The clone has its own fouls, leaves when its owner leaves, and never respawns.',
    operations: [],
    eventRules: ['clone-army'],
  }),
  defineHavocMutation({
    mutationId: 'time-lord',
    tier: 3,
    name: 'Time Lord',
    description:
      "Sets the owner's team fresh shot clock to 30 seconds and the opponent's to 12 seconds.",
    downside:
      "Ends when the owner fouls out; rebound resets stay bounded by each side's active limit.",
    operations: [],
    eventRules: ['time-lord'],
    teamExclusive: true,
  }),
  defineHavocMutation({
    mutationId: 'body-snatcher',
    tier: 3,
    name: 'Body Snatcher',
    description:
      'Swaps the body with the top-ranked opposing starter, playing with their ratings and tendencies while active.',
    downside: 'Targets are fixed at tipoff and do not migrate if the target fouls out.',
    operations: [],
    eventRules: ['body-snatcher'],
  }),
  defineHavocMutation({
    mutationId: 'reverse-basketball',
    tier: 3,
    name: 'Reverse Basketball',
    description:
      'Adds one point to each made two-pointer and subtracts two from each made three-pointer on the owner team.',
    downside: 'Three-pointers are worth two less.',
    operations: [],
    eventRules: ['reverse-basketball'],
    teamExclusive: true,
  }),
  defineHavocMutation({
    mutationId: 'double-or-nothing',
    tier: 3,
    name: 'Double or Nothing',
    description: "Doubles the owner's team made field goals.",
    downside:
      "Every missed field goal or free throw subtracts one point; scores can go negative. Every foul committed by the owner's team gives the opponent one extra free-throw attempt.",
    operations: [],
    eventRules: ['double-or-nothing'],
  }),
  defineHavocMutation({
    mutationId: 'the-great-equalizer',
    tier: 3,
    name: 'The Great Equalizer',
    description: "Caps every active opposing participant's detailed ratings at 85.",
    downside:
      'Does not cap dimensions, tendencies, or original Overall; ends when the owner leaves.',
    operations: [],
    eventRules: ['the-great-equalizer'],
    teamExclusive: true,
  }),
];

const HAVOC_MUTATION_DEFINITION_BY_ID: ReadonlyMap<string, HavocMutationDefinition> = new Map(
  HAVOC_MUTATION_DEFINITIONS.map((definition) => [definition.mutationId, definition]),
);

export function havocMutationDefinitionOf(mutationId: HavocMutationId): HavocMutationDefinition {
  const definition = HAVOC_MUTATION_DEFINITION_BY_ID.get(mutationId);
  if (definition === undefined) {
    throw new Error(`unknown havoc mutation definition ${mutationId}`);
  }
  return definition;
}

export function teamExclusiveMutationIdsOf(
  definitions: readonly HavocMutationDefinition[],
): ReadonlySet<HavocMutationId> {
  return new Set(
    definitions
      .filter((definition) => definition.teamExclusive === true)
      .map((definition) => definition.mutationId),
  );
}

export function havocMutationIsTeamExclusive(mutationId: HavocMutationId): boolean {
  return havocMutationDefinitionOf(mutationId).teamExclusive === true;
}
