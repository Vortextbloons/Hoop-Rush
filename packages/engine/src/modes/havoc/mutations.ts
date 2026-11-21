import type { HavocMutationDefinition, HavocMutationId } from '@hoop-rush/data-contracts';
import {
  HAVOC_TENDENCY_FIELDS,
  REQUIRED_RATING_KEYS,
  havocMutationDefinitionSchema,
} from '@hoop-rush/data-contracts';

function defineHavocMutation(definition: HavocMutationDefinition): HavocMutationDefinition {
  return havocMutationDefinitionSchema.parse(definition);
}

const MR_EVERYTHING_RATING_OPERATIONS = REQUIRED_RATING_KEYS.map((field) => ({
  op: 'add-rating' as const,
  field,
  value: 8,
}));

const MR_EVERYTHING_TENDENCY_OPERATIONS = HAVOC_TENDENCY_FIELDS.map((field) => ({
  op: 'add-tendency' as const,
  field,
  value: 8,
}));

export const HAVOC_MUTATION_DEFINITIONS: readonly HavocMutationDefinition[] = [
  defineHavocMutation({
    mutationId: 'growth-spurt',
    tier: 1,
    name: 'Growth Spurt',
    description:
      'Adds a sampled 6-12 inches of height when the card is generated, plus 10 to offensive and defensive rebounding.',
    downside: '',
    operations: [
      { op: 'height-add', minInches: 6, maxInches: 12 },
      { op: 'add-rating', field: 'offensiveRebound', value: 10 },
      { op: 'add-rating', field: 'defensiveRebound', value: 10 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'alien-arms',
    tier: 1,
    name: 'Alien Arms',
    description:
      'Adds 18 inches of effective wingspan, improving contests, blocks, and rebound reach, plus 10 block and 10 defensive rebounding.',
    downside: '',
    operations: [
      { op: 'reach-add', inches: 18 },
      { op: 'add-rating', field: 'block', value: 10 },
      { op: 'add-rating', field: 'defensiveRebound', value: 10 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'mini-monster',
    tier: 1,
    name: 'Mini Monster',
    description: 'Subtracts 8 inches of height and adds 20 to speed and 10 to ball handling.',
    downside: 'Loses 8 inches of height, giving up size at the rim.',
    operations: [
      { op: 'height-subtract', inches: 8 },
      { op: 'add-rating', field: 'speed', value: 20 },
      { op: 'add-rating', field: 'ballHandling', value: 10 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'super-soldier',
    tier: 1,
    name: 'Super Soldier',
    description: 'Adds 15 to speed, strength, and vertical.',
    downside: '',
    operations: [
      { op: 'add-rating', field: 'speed', value: 15 },
      { op: 'add-rating', field: 'strength', value: 15 },
      { op: 'add-rating', field: 'vertical', value: 15 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'sniper-gene',
    tier: 1,
    name: 'Sniper Gene',
    description: 'Adds 18 to three-point rating and 35 to three-point shot rate.',
    downside: '',
    operations: [
      { op: 'add-rating', field: 'threePoint', value: 18 },
      { op: 'add-tendency', field: 'threePointRate', value: 35 },
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
    description: 'Adds 20 to interior defense, strength, and block, and 10 to block attempt rate.',
    downside: '',
    operations: [
      { op: 'add-rating', field: 'interiorDefense', value: 20 },
      { op: 'add-rating', field: 'strength', value: 20 },
      { op: 'add-rating', field: 'block', value: 20 },
      { op: 'add-tendency', field: 'blockAttemptRate', value: 10 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'glass-eater',
    tier: 1,
    name: 'Glass Eater',
    description:
      'Adds 25 to offensive and defensive rebounding, and 40 to offensive glass crash rate.',
    downside: '',
    operations: [
      { op: 'add-rating', field: 'offensiveRebound', value: 25 },
      { op: 'add-rating', field: 'defensiveRebound', value: 25 },
      { op: 'add-tendency', field: 'crashOffensiveGlassRate', value: 40 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'trigger-happy',
    tier: 1,
    name: 'Trigger Happy',
    description:
      'Adds 15 to inside scoring, close shot, midrange, three-point, and free throw, 40 to shot rate, and 20 to usage rate.',
    downside: 'Caps pass rate at 10; this player is looking for their own shot.',
    operations: [
      { op: 'add-rating', field: 'insideScoring', value: 15 },
      { op: 'add-rating', field: 'closeShot', value: 15 },
      { op: 'add-rating', field: 'midrange', value: 15 },
      { op: 'add-rating', field: 'threePoint', value: 15 },
      { op: 'add-rating', field: 'freeThrow', value: 15 },
      { op: 'add-tendency', field: 'shotRate', value: 40 },
      { op: 'add-tendency', field: 'usageRate', value: 20 },
      { op: 'cap-tendency', field: 'passRate', value: 10 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'walking-bucket',
    tier: 1,
    name: 'Walking Bucket',
    description:
      'Adds 20 inside scoring, 15 close shot, and 20 midrange, and raises isolation rate to 85, short-mid frequency to 50, and long-mid frequency to 80.',
    downside: '',
    operations: [
      { op: 'add-rating', field: 'insideScoring', value: 20 },
      { op: 'add-rating', field: 'closeShot', value: 15 },
      { op: 'add-rating', field: 'midrange', value: 20 },
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
    description: 'Adds 35 to inside scoring and close shot and raises turnover rate to 25.',
    downside: 'Caps ball handling at 50.',
    operations: [
      { op: 'add-rating', field: 'insideScoring', value: 35 },
      { op: 'add-rating', field: 'closeShot', value: 35 },
      { op: 'cap-rating', field: 'ballHandling', value: 50 },
      { op: 'raise-tendency', field: 'turnoverRate', value: 25 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'freak-athlete',
    tier: 1,
    name: 'Freak Athlete',
    description:
      'Adds 35 to vertical, inside scoring, and close shot at the cost of three-point and midrange.',
    downside: 'Subtracts 35 from three-point and 35 from midrange.',
    operations: [
      { op: 'add-rating', field: 'vertical', value: 35 },
      { op: 'add-rating', field: 'insideScoring', value: 35 },
      { op: 'add-rating', field: 'closeShot', value: 35 },
      { op: 'add-rating', field: 'threePoint', value: -35 },
      { op: 'add-rating', field: 'midrange', value: -35 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'the-statue',
    tier: 1,
    name: 'The Statue',
    description:
      'Adds 30 to strength, inside scoring, and close shot, and adds 30 to post-up rate.',
    downside: 'Subtracts 30 from speed.',
    operations: [
      { op: 'add-rating', field: 'strength', value: 30 },
      { op: 'add-rating', field: 'insideScoring', value: 30 },
      { op: 'add-rating', field: 'closeShot', value: 30 },
      { op: 'add-tendency', field: 'postUpRate', value: 30 },
      { op: 'add-rating', field: 'speed', value: -30 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'reverse-evolution',
    tier: 1,
    name: 'Reverse Evolution',
    description:
      'Subtracts 10 inches of height, adds 30 to perimeter defense and steal, and 15 to steal attempt rate.',
    downside: 'Loses 10 inches of height.',
    operations: [
      { op: 'height-subtract', inches: 10 },
      { op: 'add-rating', field: 'perimeterDefense', value: 30 },
      { op: 'add-rating', field: 'steal', value: 30 },
      { op: 'add-tendency', field: 'stealAttemptRate', value: 15 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'opposite-day',
    tier: 1,
    name: 'Opposite Day',
    description:
      'Subtracts 15 from the five highest ratings and adds 20 to the five lowest, so strengths fade and weaknesses close up.',
    downside: 'The five strongest ratings drop by 15.',
    operations: [{ op: 'shift-extreme-ratings', count: 5, bestDelta: -15, worstDelta: 20 }],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'tiny-titan',
    tier: 1,
    name: 'Tiny Titan',
    description:
      'Subtracts 12 inches of height, adds 15 to strength, block, vertical, and both rebounding ratings.',
    downside: 'Subtracts 30 from speed.',
    operations: [
      { op: 'height-subtract', inches: 12 },
      { op: 'add-rating', field: 'strength', value: 15 },
      { op: 'add-rating', field: 'block', value: 15 },
      { op: 'add-rating', field: 'vertical', value: 15 },
      { op: 'add-rating', field: 'offensiveRebound', value: 15 },
      { op: 'add-rating', field: 'defensiveRebound', value: 15 },
      { op: 'add-rating', field: 'speed', value: -30 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'mr-everything',
    tier: 1,
    name: 'Mr. Everything',
    description: 'Adds 8 to every rating and 8 to every tendency.',
    downside: '',
    operations: [...MR_EVERYTHING_RATING_OPERATIONS, ...MR_EVERYTHING_TENDENCY_OPERATIONS],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'foul-merchant',
    tier: 1,
    name: 'Foul Merchant',
    description:
      'Adds 30 to free throw, ball handling, and offensive IQ, and adds 45 to drive rate and free-throw rate.',
    downside: 'Subtracts 30 from three-point.',
    operations: [
      { op: 'add-rating', field: 'freeThrow', value: 30 },
      { op: 'add-rating', field: 'ballHandling', value: 30 },
      { op: 'add-rating', field: 'offensiveIq', value: 30 },
      { op: 'add-tendency', field: 'driveRate', value: 45 },
      { op: 'add-tendency', field: 'freeThrowRate', value: 45 },
      { op: 'add-rating', field: 'threePoint', value: -30 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'the-specialist',
    tier: 1,
    name: 'The Specialist',
    description:
      'Sets every rating in the sampled category to 99 and adds 30 to the tendencies tied to that category.',
    downside: 'All ratings outside the sampled category drop by 20.',
    operations: [
      { op: 'set-category-ratings', value: 99 },
      { op: 'add-outside-category-ratings', value: -20 },
      { op: 'add-category-tendencies', value: 30 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'glass-cannon',
    tier: 1,
    name: 'Glass Cannon',
    description: 'Adds 25 to all five scoring ratings, 30 to shot rate, and 30 to usage rate.',
    downside: 'Caps every defensive rating at 20.',
    operations: [
      { op: 'add-rating', field: 'insideScoring', value: 25 },
      { op: 'add-rating', field: 'closeShot', value: 25 },
      { op: 'add-rating', field: 'midrange', value: 25 },
      { op: 'add-rating', field: 'threePoint', value: 25 },
      { op: 'add-rating', field: 'freeThrow', value: 25 },
      { op: 'add-tendency', field: 'shotRate', value: 30 },
      { op: 'add-tendency', field: 'usageRate', value: 30 },
      { op: 'cap-rating', field: 'perimeterDefense', value: 20 },
      { op: 'cap-rating', field: 'interiorDefense', value: 20 },
      { op: 'cap-rating', field: 'steal', value: 20 },
      { op: 'cap-rating', field: 'block', value: 20 },
      { op: 'cap-rating', field: 'defensiveIq', value: 20 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'the-pacifist',
    tier: 1,
    name: 'The Pacifist',
    description:
      'Raises passing, offensive IQ, and defensive IQ to 99, both rebounds to 90, and pass rate to 99.',
    downside: 'Caps shot rate at 0 and every scoring rating at 15.',
    operations: [
      { op: 'raise-rating', field: 'passing', value: 99 },
      { op: 'raise-rating', field: 'offensiveIq', value: 99 },
      { op: 'raise-rating', field: 'defensiveIq', value: 99 },
      { op: 'raise-rating', field: 'offensiveRebound', value: 90 },
      { op: 'raise-rating', field: 'defensiveRebound', value: 90 },
      { op: 'raise-tendency', field: 'passRate', value: 99 },
      { op: 'cap-tendency', field: 'shotRate', value: 0 },
      { op: 'cap-rating', field: 'insideScoring', value: 15 },
      { op: 'cap-rating', field: 'closeShot', value: 15 },
      { op: 'cap-rating', field: 'midrange', value: 15 },
      { op: 'cap-rating', field: 'threePoint', value: 15 },
      { op: 'cap-rating', field: 'freeThrow', value: 15 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'paper-giant',
    tier: 1,
    name: 'Paper Giant',
    description:
      'Adds 12 inches of height, 15 to three-point, 15 to three-point rate, and 25 to ball handling.',
    downside: 'Subtracts 35 from strength and 30 from both rebounding ratings.',
    operations: [
      { op: 'height-add', minInches: 12, maxInches: 12 },
      { op: 'add-rating', field: 'threePoint', value: 15 },
      { op: 'add-tendency', field: 'threePointRate', value: 15 },
      { op: 'add-rating', field: 'ballHandling', value: 25 },
      { op: 'add-rating', field: 'strength', value: -35 },
      { op: 'add-rating', field: 'offensiveRebound', value: -30 },
      { op: 'add-rating', field: 'defensiveRebound', value: -30 },
    ],
    eventRules: [],
  }),
  defineHavocMutation({
    mutationId: 'four-point-dunk',
    tier: 2,
    name: 'Four-Point Dunk',
    description: 'A made dunk scores one extra point, added after any multipliers.',
    downside: 'Subtracts 30 from three-point and adds 10 to turnover rate.',
    operations: [
      { op: 'add-rating', field: 'threePoint', value: -30 },
      { op: 'add-tendency', field: 'turnoverRate', value: 10 },
    ],
    eventRules: ['four-point-dunk'],
  }),
  defineHavocMutation({
    mutationId: 'golden-assist',
    tier: 2,
    name: 'Golden Assist',
    description: 'Every third credited assist adds one extra point for the passer.',
    downside: 'Subtracts 30 from shot rate and adds 10 to turnover rate.',
    operations: [
      { op: 'add-tendency', field: 'shotRate', value: -30 },
      { op: 'add-tendency', field: 'turnoverRate', value: 10 },
    ],
    eventRules: ['golden-assist'],
  }),
  defineHavocMutation({
    mutationId: 'heat-check',
    tier: 2,
    name: 'Heat Check',
    description:
      'Two consecutive made field goals arm a double-value next made field goal; the rewarded make consumes it.',
    downside:
      'Any miss resets the streak, and an unused armed effect expires after five possessions.',
    operations: [],
    eventRules: ['heat-check'],
  }),
  defineHavocMutation({
    mutationId: 'second-chance-jackpot',
    tier: 2,
    name: 'Second Chance Jackpot',
    description: "A made putback of the player's own offensive rebound scores double.",
    downside: 'Subtracts 25 from defensive rebounding.',
    operations: [{ op: 'add-rating', field: 'defensiveRebound', value: -25 }],
    eventRules: ['second-chance-jackpot'],
  }),
  defineHavocMutation({
    mutationId: 'and-one-machine',
    tier: 2,
    name: 'And-One Machine',
    description:
      'A made field goal plus a shooting foul earns two free-throw attempts instead of one.',
    downside: 'Subtracts 10 from midrange and 10 from three-point, and raises foul rate to 50.',
    operations: [
      { op: 'add-rating', field: 'midrange', value: -10 },
      { op: 'add-rating', field: 'threePoint', value: -10 },
      { op: 'raise-tendency', field: 'foulRate', value: 50 },
    ],
    eventRules: ['and-one-machine'],
  }),
  defineHavocMutation({
    mutationId: 'possession-refund',
    tier: 2,
    name: 'Possession Refund',
    description:
      'Cancels the first turnover in each quarter, keeping the ball with the remaining clock.',
    downside: 'Only the first turnover in each quarter is refunded.',
    operations: [],
    eventRules: ['possession-refund'],
  }),
  defineHavocMutation({
    mutationId: 'rebound-loop',
    tier: 2,
    name: 'Rebound Loop',
    description:
      'Every third offensive rebound earns the team a queued extra possession after the current one.',
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
      'Only blocks on that ranked starter arm the effect, and it expires after five possessions.',
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
      'Every fourth field-goal attempt rolls a 1-4 point value instead of the shot nominal value.',
    downside: 'The rolled value can be lower than a normal make.',
    operations: [],
    eventRules: ['basketball-roulette'],
  }),
  defineHavocMutation({
    mutationId: 'buzzer-bandit',
    tier: 2,
    name: 'Buzzer Bandit',
    description:
      "Makes with five seconds or less left on the shot clock score double; the owner's misses with five seconds or less subtract one point.",
    downside: "The owner's own quick misses subtract one point each.",
    operations: [],
    eventRules: ['buzzer-bandit'],
  }),
  defineHavocMutation({
    mutationId: 'charity-casino',
    tier: 2,
    name: 'Charity Casino',
    description:
      "The owner's made free throws score three; their missed free throws award the opposing team two points.",
    downside: 'Missed free throws gift the opposing team two points each.',
    operations: [],
    eventRules: ['charity-casino'],
  }),
  defineHavocMutation({
    mutationId: 'cold-blooded',
    tier: 2,
    name: 'Cold Blooded',
    description:
      "Each consecutive missed field goal raises the bonus on the owner's next made field goal by one point, up to five.",
    downside: 'Every two consecutive misses also award the opponent one point.',
    operations: [],
    eventRules: ['cold-blooded'],
  }),
  defineHavocMutation({
    mutationId: 'triple-threat',
    tier: 2,
    name: 'Triple Threat',
    description:
      'Making a rim shot, a midrange shot, and a three in the same quarter earns six bonus points.',
    downside: 'Any missed field goal resets the quarter progress.',
    operations: [],
    eventRules: ['triple-threat'],
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
      "Every missed field goal or free throw awards the opponent one point. Every foul committed by the owner's team gives the opponent one extra free-throw attempt.",
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
  defineHavocMutation({
    mutationId: 'fusion-dance',
    tier: 3,
    name: 'Fusion Dance',
    description:
      'At tipoff, fuses the owner with their highest-rated teammate: the owner plays with the better of each fused rating and 99 usage while the donor plays at 40 across the board.',
    downside:
      'The pairing is fixed at tipoff; the donor stays at 40 while the owner is active, and only one owner per team may fuse.',
    operations: [],
    eventRules: ['fusion-dance'],
    teamExclusive: true,
  }),
  defineHavocMutation({
    mutationId: 'basketball-darwinism',
    tier: 3,
    name: 'Basketball Darwinism',
    description:
      "After each made field goal, the shooter's five scoring ratings drop: by three for the owner's team, by five for the opponent.",
    downside:
      'Every made field goal degrades scoring, own-team makes by three and opponent makes by five; the decay resets each game.',
    operations: [],
    eventRules: ['basketball-darwinism'],
  }),
  defineHavocMutation({
    mutationId: 'oops-all-centers',
    tier: 3,
    name: 'Oops, All Centers!',
    description:
      'At tipoff, every teammate becomes 7\'3" with strength, interior defense, and both rebound ratings at 95.',
    downside: 'Speed and ball handling are capped at 35 and three-point at 40 for the whole team.',
    operations: [],
    eventRules: ['oops-all-centers'],
    teamExclusive: true,
  }),
  defineHavocMutation({
    mutationId: 'hostile-takeover',
    tier: 3,
    name: 'Hostile Takeover',
    description:
      "At tipoff, the owner's lowest-ranked starter exchanges every detailed rating and tendency with the opponent's highest-ranked starter.",
    downside: 'Bodies, identities, and positions stay unchanged.',
    operations: [],
    eventRules: ['hostile-takeover'],
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
