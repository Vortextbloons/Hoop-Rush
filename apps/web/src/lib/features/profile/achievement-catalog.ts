import type { AchievementUnlock } from '@hoop-rush/data-contracts';
import {
  ArrowDown,
  Award,
  Banknote,
  CalendarCheck,
  CircleDot,
  ClipboardList,
  Crosshair,
  Crown,
  Dice5,
  Dna,
  Droplets,
  Eye,
  Flame,
  Gauge,
  Gem,
  Ghost,
  Goal,
  HardHat,
  Heart,
  HeartHandshake,
  HeartPulse,
  Landmark,
  Layers,
  Medal,
  Network,
  Orbit,
  RefreshCcw,
  Repeat,
  Repeat2,
  Rocket,
  ScrollText,
  Shield,
  Sparkles,
  Star,
  Swords,
  Target,
  Timer,
  TrendingUp,
  Trophy,
  WandSparkles,
  Wind,
  Workflow,
  Zap,
} from '@lucide/svelte';
import type { Component } from 'svelte';

export type AchievementCategory = 'classic' | 'player' | 'cap-rush' | 'havoc' | 'multiplayer';

export type AchievementRarity = 'legendary' | 'mythic';

export type AchievementCatalogEntry = {
  name: string;
  description: string;
  category: AchievementCategory;
  icon: Component<{ class?: string }>;
  rarity?: AchievementRarity;
};

export const achievementCatalog = {
  'better-than-73-9': {
    name: 'Better Than 73-9',
    description: 'Finish an 82-game season undefeated.',
    category: 'classic',
    icon: Trophy,
  },
  'one-game-short': {
    name: 'One Game Short',
    description: 'Win 81 of 82 games in a season.',
    category: 'classic',
    icon: Target,
  },
  'the-popovich-way': {
    name: 'The Popovich Way',
    description: 'Win 70 games without using a reroll.',
    category: 'classic',
    icon: ClipboardList,
  },
  'ball-dont-lie': {
    name: "Ball Don't Lie",
    description: 'Win 75 games with Ball Knowledge enabled.',
    category: 'classic',
    icon: CircleDot,
  },
  'goin-to-work': {
    name: "Goin' to Work",
    description: 'Win 65 games without drafting a 90+ OVR player.',
    category: 'classic',
    icon: HardHat,
  },
  '30-for-30': {
    name: '30 for 30',
    description: 'Beat all 30 franchises by 15 or more.',
    category: 'classic',
    icon: Network,
  },
  'we-believe': {
    name: 'We Believe',
    description: 'Win 70 games with a starting lineup averaging under 85 OVR.',
    category: 'classic',
    icon: HeartHandshake,
  },
  'brodie-mode': {
    name: 'Brodie Mode',
    description: 'Average a triple-double across all 82 games.',
    category: 'player',
    icon: Gauge,
    rarity: 'legendary',
  },
  'welcome-to-the-50-40-90-club': {
    name: 'Welcome to the 50/40/90 Club',
    description:
      'Shoot at least 50% FG, 40% 3PT, and 90% FT in 82 games on 600 FG, 205 3PT, and 140 FT attempts.',
    category: 'player',
    icon: Crosshair,
  },
  'the-harden-system': {
    name: 'The Harden System',
    description: "Win 70 games while one player scores 35% of the team's points.",
    category: 'player',
    icon: Workflow,
  },
  'the-beautiful-game': {
    name: 'The Beautiful Game',
    description: 'Win 65 games with all five starters averaging 15+ PPG.',
    category: 'player',
    icon: Sparkles,
  },
  'magic-vision': {
    name: 'Magic Vision',
    description: 'Average 10 assists per game with a 5:1 assist-to-turnover ratio.',
    category: 'player',
    icon: Eye,
  },
  leeverything: {
    name: 'LeEverything',
    description: 'Lead your team in points, rebounds, assists, steals, and blocks.',
    category: 'player',
    icon: Crown,
  },
  'the-dream-team': {
    name: 'The Dream Team',
    description: 'Win 70 games in Sandbox with players from five different decades.',
    category: 'player',
    icon: Star,
  },
  'laker-legacy': {
    name: 'Laker Legacy',
    description: 'Win 70 games with five players from one franchise spanning three decades.',
    category: 'player',
    icon: Landmark,
  },
  'old-school-legends': {
    name: 'Old School Legends',
    description: 'Win 70 games with three players whose seasons predate 1980.',
    category: 'player',
    icon: ScrollText,
  },
  '73-9-hold-my-ring': {
    name: '73-9? Hold My Ring',
    description: 'Win 74+ games and go 16-0 in the playoffs.',
    category: 'cap-rush',
    icon: Gem,
  },
  moneyball: {
    name: 'Moneyball',
    description: 'Win a title with a starting five costing $80M or less.',
    category: 'cap-rush',
    icon: Banknote,
  },
  'the-dirk-run': {
    name: 'The Dirk Run',
    description: 'Win a title without purchasing a roulette spin.',
    category: 'cap-rush',
    icon: TrendingUp,
  },
  'going-all-in': {
    name: 'Going All-In',
    description: 'Win a title after purchasing at least two roulette spins.',
    category: 'cap-rush',
    icon: Dice5,
  },
  'the-heatles': {
    name: 'The Heatles',
    description: 'Win a title with a payroll of $115M or more.',
    category: 'cap-rush',
    icon: Flame,
  },
  'we-believe-2-0': {
    name: 'We Believe 2.0',
    description: 'Win a title as the 7 or 8 seed.',
    category: 'cap-rush',
    icon: Rocket,
  },
  'the-cardiac-kings': {
    name: 'The Cardiac Kings',
    description: 'Win a title with all four playoff series going to Game 7.',
    category: 'cap-rush',
    icon: HeartPulse,
  },
  linsanity: {
    name: 'Linsanity',
    description: 'Win a title with your leading scorer earning $12M or less.',
    category: 'cap-rush',
    icon: Zap,
  },
  'detroit-basketball': {
    name: 'Detroit Basketball',
    description: 'Win a title without a 90+ OVR player.',
    category: 'cap-rush',
    icon: Shield,
  },
  'the-shot': {
    name: 'The Shot',
    description: 'Win Game 7 of the Finals by one point.',
    category: 'cap-rush',
    icon: Goal,
  },
  'the-curry-effect': {
    name: 'The Curry Effect',
    description: 'Win 25 matched games in Havoc that your Normal run loses.',
    category: 'havoc',
    icon: WandSparkles,
  },
  'the-dynasty-effect': {
    name: 'The Dynasty Effect',
    description: 'Finish with 40 more wins than your Normal run.',
    category: 'havoc',
    icon: Layers,
  },
  'all-star-game-numbers': {
    name: 'All-Star Game Numbers',
    description: 'Score 200 team points in a game.',
    category: 'havoc',
    icon: Award,
  },
  'wilt-chamberlain-mode': {
    name: 'Wilt Chamberlain Mode',
    description: 'Score 100 points with one player in a game.',
    category: 'havoc',
    icon: Medal,
    rarity: 'mythic',
  },
  'better-without-the-boost': {
    name: 'Better Without the Boost',
    description: 'Win more games in Normal than in Havoc.',
    category: 'havoc',
    icon: ArrowDown,
  },
  'the-monstars': {
    name: 'The Monstars',
    description: 'Go 82-0 in Havoc.',
    category: 'havoc',
    icon: Ghost,
  },
  'space-jam': {
    name: 'Space Jam',
    description: 'Score 40 points in a stolen body with Body Snatcher.',
    category: 'havoc',
    icon: Orbit,
  },
  'manu-off-the-bench': {
    name: 'Manu Off the Bench',
    description: 'Have a Clone Army clone outscore three original starters.',
    category: 'havoc',
    icon: Repeat,
  },
  'havoc-built-different': {
    name: 'Built Different',
    description: 'Win 75+ games with all three mutation tiers active.',
    category: 'havoc',
    icon: Dna,
  },
  'cleveland-this-is-for-you': {
    name: 'Cleveland, This Is for You!',
    description: 'Win a series after trailing 1-3.',
    category: 'multiplayer',
    icon: Heart,
  },
  'the-reverse-sweep': {
    name: 'The Reverse Sweep',
    description: 'Win a series after trailing 0-3.',
    category: 'multiplayer',
    icon: RefreshCcw,
  },
  'bring-out-the-brooms': {
    name: 'Bring Out the Brooms',
    description: 'Sweep a series 4-0.',
    category: 'multiplayer',
    icon: Wind,
  },
  'dame-time': {
    name: 'Dame Time',
    description: 'Win a Game 7 by one point.',
    category: 'multiplayer',
    icon: Timer,
  },
  'upset-of-the-year': {
    name: 'Upset of the Year',
    description: 'Win a series against a lineup averaging 6+ OVR higher.',
    category: 'multiplayer',
    icon: TrendingUp,
  },
  'the-revenge-tour': {
    name: 'The Revenge Tour',
    description: 'Lose to an opponent, accept the rematch, and win.',
    category: 'multiplayer',
    icon: Swords,
  },
  'the-splash-brothers': {
    name: 'The Splash Brothers',
    description: 'Go 82-0 in a shared multiplayer season.',
    category: 'multiplayer',
    icon: Droplets,
  },
  'moneyball-champions': {
    name: 'Moneyball Champions',
    description: 'Win a Cap Rush title with a payroll at least $20M cheaper than your human rival.',
    category: 'multiplayer',
    icon: Trophy,
  },
  'season-sweep': {
    name: 'Season Sweep',
    description: 'Beat your human rival in both regular-season Cap Rush games.',
    category: 'multiplayer',
    icon: CalendarCheck,
  },
  'the-finals-rematch': {
    name: 'The Finals Rematch',
    description: 'Beat a human rival in the Cap Rush Finals.',
    category: 'multiplayer',
    icon: Repeat2,
  },
} satisfies Record<AchievementUnlock['id'], AchievementCatalogEntry>;

export type AchievementCatalogId = keyof typeof achievementCatalog;
