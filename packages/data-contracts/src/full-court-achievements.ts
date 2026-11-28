import { z } from 'zod';

/**
 * Full Court season achievements are evaluated from completed run facts. The
 * ids are persisted in run history and are also awarded to the selected player
 * profile, so they must remain readable after a mode or criterion changes.
 */
export const FULL_COURT_ACHIEVEMENT_IDS = [
  'bench-mob',
  'the-chess-match',
  'strength-in-numbers',
  'the-sixth-sense',
  'the-skeleton-crew',
  'everybody-eats',
  'the-48-minute-problem',
  'the-second-unit',
  'no-vip-section',
  'the-peoples-champion',
  'the-expendables',
  'not-in-the-starting-five',
  'seven-seconds-or-less',
  'welcome-to-the-grindhouse',
  'the-triangle-offense',
  'pass-the-rock',
  'no-fly-zone',
  'death-lineup',
  'twin-towers',
  'out-of-the-laboratory',
  'pick-your-poison',
  'the-mastermind',
  'next-man-up',
  'the-hospital-ring',
  'load-managed-to-perfection',
  'running-on-fumes',
  'the-willis-reed-moment',
  'the-show-goes-on',
  'six-fouls-zero-problems',
  'the-iron-curtain',
  '98-0-the-untouchables',
  'the-1995-rockets',
  'never-say-die',
  'road-warriors',
  'nobody-believed',
  'the-grand-slam',
  'not-today-history',
  'the-resurrection',
  'lights-out',
  'the-last-dance',
  'the-salary-cap-is-a-suggestion',
  'champagne-on-a-budget',
  'the-diamond-in-the-rough',
  'the-30-million-bench',
] as const;

export type FullCourtAchievementId = (typeof FULL_COURT_ACHIEVEMENT_IDS)[number];

export const fullCourtAchievementIdSchema = z.enum(FULL_COURT_ACHIEVEMENT_IDS);

export type FullCourtAchievementCategory =
  'roster' | 'coaching' | 'injuries' | 'championship' | 'front-office';

export type FullCourtAchievementRarity = 'rare' | 'epic' | 'legendary' | 'mythic';

export interface FullCourtAchievementDefinition {
  readonly name: string;
  readonly description: string;
  readonly category: FullCourtAchievementCategory;
  readonly rarity: FullCourtAchievementRarity;
}

export const FULL_COURT_ACHIEVEMENT_CATALOG: Readonly<
  Record<FullCourtAchievementId, FullCourtAchievementDefinition>
> = {
  'bench-mob': {
    name: 'Bench Mob',
    description: 'Score 50 or more bench points in a single game.',
    category: 'roster',
    rarity: 'rare',
  },
  'the-chess-match': {
    name: 'The Chess Match',
    description: 'Win a playoff series after trailing 3-1.',
    category: 'championship',
    rarity: 'epic',
  },
  'strength-in-numbers': {
    name: 'Strength in Numbers',
    description: 'Win a championship with at least 10 players averaging 10+ minutes.',
    category: 'roster',
    rarity: 'epic',
  },
  'the-sixth-sense': {
    name: 'The Sixth Sense',
    description: 'Have a player win Sixth Man of the Year and Finals MVP in the same season.',
    category: 'roster',
    rarity: 'legendary',
  },
  'the-skeleton-crew': {
    name: 'The Skeleton Crew',
    description: 'Win a championship with only six drafted players.',
    category: 'roster',
    rarity: 'legendary',
  },
  'everybody-eats': {
    name: 'Everybody Eats',
    description: 'Have eight players average double-digit points across a regular season.',
    category: 'roster',
    rarity: 'epic',
  },
  'the-48-minute-problem': {
    name: 'The 48-Minute Problem',
    description: 'Win 60+ games without any player averaging more than 30 minutes.',
    category: 'roster',
    rarity: 'legendary',
  },
  'the-second-unit': {
    name: 'The Second Unit',
    description: 'Average 45+ bench points per game across an entire regular season.',
    category: 'roster',
    rarity: 'rare',
  },
  'no-vip-section': {
    name: 'No VIP Section',
    description:
      'Win a championship with every drafted player averaging at least 12 minutes in the playoffs.',
    category: 'roster',
    rarity: 'epic',
  },
  'the-peoples-champion': {
    name: "The People's Champion",
    description: 'Win a championship with a roster consisting entirely of players below 85 OVR.',
    category: 'roster',
    rarity: 'legendary',
  },
  'the-expendables': {
    name: 'The Expendables',
    description:
      'Win 55+ games with at least five players below 75 OVR who each average 10+ minutes.',
    category: 'roster',
    rarity: 'epic',
  },
  'not-in-the-starting-five': {
    name: 'Not in the Starting Five',
    description:
      'Have a primarily bench player finish as your team leading scorer in the regular season.',
    category: 'roster',
    rarity: 'rare',
  },
  'seven-seconds-or-less': {
    name: 'Seven Seconds or Less',
    description: 'Lead the league in pace and offensive rating in the same season.',
    category: 'coaching',
    rarity: 'epic',
  },
  'welcome-to-the-grindhouse': {
    name: 'Welcome to the Grindhouse',
    description:
      "Finish with the league's best defensive rating and bottom-five pace, then win a title.",
    category: 'coaching',
    rarity: 'legendary',
  },
  'the-triangle-offense': {
    name: 'The Triangle Offense',
    description: 'Have three players average 20+ points while winning 60+ games.',
    category: 'coaching',
    rarity: 'epic',
  },
  'pass-the-rock': {
    name: 'Pass the Rock',
    description: 'Average 30+ team assists and win 60+ games.',
    category: 'coaching',
    rarity: 'rare',
  },
  'no-fly-zone': {
    name: 'No Fly Zone',
    description: 'Lead the league in blocks and defensive rating.',
    category: 'coaching',
    rarity: 'epic',
  },
  'death-lineup': {
    name: 'Death Lineup',
    description: 'Win a playoff game using a centerless lineup for at least 12 minutes.',
    category: 'coaching',
    rarity: 'rare',
  },
  'twin-towers': {
    name: 'Twin Towers',
    description: 'Win a championship with two players averaging 10+ rebounds and 2+ blocks each.',
    category: 'coaching',
    rarity: 'epic',
  },
  'out-of-the-laboratory': {
    name: 'Out of the Laboratory',
    description:
      'Win 20 games using a custom unit that outscores opponents by 10+ points per 100 possessions over 200+ minutes.',
    category: 'coaching',
    rarity: 'epic',
  },
  'pick-your-poison': {
    name: 'Pick Your Poison',
    description:
      'Have at least six different players lead your team in scoring across a single postseason.',
    category: 'coaching',
    rarity: 'rare',
  },
  'the-mastermind': {
    name: 'The Mastermind',
    description:
      'Win a championship in Mastermind Coach using custom rotations, units, defensive matchups, and tactical rules.',
    category: 'coaching',
    rarity: 'epic',
  },
  'next-man-up': {
    name: 'Next Man Up',
    description: 'Win five consecutive games while your highest-rated player is injured.',
    category: 'injuries',
    rarity: 'rare',
  },
  'the-hospital-ring': {
    name: 'The Hospital Ring',
    description:
      'Win a championship after at least three rotation players each miss 15+ regular-season games due to injury.',
    category: 'injuries',
    rarity: 'legendary',
  },
  'load-managed-to-perfection': {
    name: 'Load Managed to Perfection',
    description: 'Win 65+ games while having no player miss a game due to injury.',
    category: 'injuries',
    rarity: 'epic',
  },
  'running-on-fumes': {
    name: 'Running on Fumes',
    description: 'Win a double-overtime game with only five available players remaining.',
    category: 'injuries',
    rarity: 'legendary',
  },
  'the-willis-reed-moment': {
    name: 'The Willis Reed Moment',
    description: 'Have a player return from injury during the Finals and score 25+ in a win.',
    category: 'injuries',
    rarity: 'epic',
  },
  'the-show-goes-on': {
    name: 'The Show Goes On',
    description:
      'Win an entire playoff series without your regular-season leading scorer, who is unavailable due to injury.',
    category: 'injuries',
    rarity: 'epic',
  },
  'six-fouls-zero-problems': {
    name: 'Six Fouls, Zero Problems',
    description: 'Win a game after two of your starters foul out.',
    category: 'injuries',
    rarity: 'rare',
  },
  'the-iron-curtain': {
    name: 'The Iron Curtain',
    description:
      'Have all five opening-night starters appear in all 82 regular-season games while winning 60+.',
    category: 'injuries',
    rarity: 'epic',
  },
  '98-0-the-untouchables': {
    name: '98-0: The Untouchables',
    description: 'Go undefeated in both the regular season and playoffs.',
    category: 'championship',
    rarity: 'mythic',
  },
  'the-1995-rockets': {
    name: 'The 1995 Rockets',
    description:
      'Win a championship as the sixth seed or lower without home-court advantage in any series.',
    category: 'championship',
    rarity: 'legendary',
  },
  'never-say-die': {
    name: 'Never Say Die',
    description: 'Survive six or more elimination games in a single championship run.',
    category: 'championship',
    rarity: 'legendary',
  },
  'road-warriors': {
    name: 'Road Warriors',
    description:
      'Win every away game during a championship postseason, with at least six away games played.',
    category: 'championship',
    rarity: 'legendary',
  },
  'nobody-believed': {
    name: 'Nobody Believed',
    description: 'Start the season 5-15 or worse and eventually win the championship.',
    category: 'championship',
    rarity: 'legendary',
  },
  'the-grand-slam': {
    name: 'The Grand Slam',
    description:
      'Win MVP, DPOY, Sixth Man of the Year, Finals MVP, and the championship in one season.',
    category: 'championship',
    rarity: 'mythic',
  },
  'not-today-history': {
    name: 'Not Today, History',
    description: 'Eliminate a 70+ win team in the playoffs.',
    category: 'championship',
    rarity: 'legendary',
  },
  'the-resurrection': {
    name: 'The Resurrection',
    description: 'Overcome a 25+ point deficit to win a playoff game.',
    category: 'championship',
    rarity: 'epic',
  },
  'lights-out': {
    name: 'Lights Out',
    description: 'Win a Finals game by 40+ points.',
    category: 'championship',
    rarity: 'epic',
  },
  'the-last-dance': {
    name: 'The Last Dance',
    description: 'Win a championship with at least eight drafted player versions from the 1990s.',
    category: 'championship',
    rarity: 'epic',
  },
  'the-salary-cap-is-a-suggestion': {
    name: 'The Salary Cap Is a Suggestion',
    description: 'Win a championship with payroll above the $198M first apron.',
    category: 'front-office',
    rarity: 'rare',
  },
  'champagne-on-a-budget': {
    name: 'Champagne on a Budget',
    description: 'Win a championship with 10+ players while remaining below the $165M salary cap.',
    category: 'front-office',
    rarity: 'epic',
  },
  'the-diamond-in-the-rough': {
    name: 'The Diamond in the Rough',
    description: 'Have your cheapest drafted player score 30+ points in a playoff game.',
    category: 'front-office',
    rarity: 'rare',
  },
  'the-30-million-bench': {
    name: 'The $30 Million Bench',
    description:
      'Win a championship with a bench costing $30M or less and averaging 30+ points per game.',
    category: 'front-office',
    rarity: 'epic',
  },
};

export const fullCourtAchievementUnlockSchema = z.object({
  id: fullCourtAchievementIdSchema,
  evidence: z.string().min(1).max(250),
});
export type FullCourtAchievementUnlock = z.infer<typeof fullCourtAchievementUnlockSchema>;
