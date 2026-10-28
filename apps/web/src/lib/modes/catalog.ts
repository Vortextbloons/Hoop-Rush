import { Flame, Sparkles, Swords, Trophy } from '@lucide/svelte';
import type { MultiplayerGameKind } from '@hoop-rush/data-contracts';
import type { ModeDefinition } from './types';

export const modeCatalog: readonly ModeDefinition[] = [
  {
    id: 'classic',
    label: 'Classic',
    description: '5 rounds. Each assigns a franchise + decade. One reroll each, then build.',
    discovery: { homeOrder: 1, navigationOrder: 1, cta: 'Start classic' },
    solo: { href: '/classic', warmPlayersIndex: true },
    multiplayer: {
      gameKind: 'fixed-five',
      label: 'Season / Duel',
      routeId: '/multiplayer/room/[roomId]',
      formats: [
        {
          id: 'season',
          order: 1,
          name: 'Season',
          category: '82 games',
          icon: Swords,
          image: (settings) =>
            settings.sourceMode === 'sandbox'
              ? '/images/multiplayer/sandbox-season.jpg'
              : '/images/multiplayer/shared-season.jpg',
          format: '82 games',
          description:
            'Build your five and face the same 82-game schedule. Compare your records and settle the head-to-head matchups.',
        },
        {
          id: 'duel',
          order: 2,
          name: 'Duel',
          category: 'Best of 7',
          icon: Trophy,
          image: '/images/multiplayer/duel.jpg',
          format: 'Best of 7',
          description:
            'Two five-player lineups. One best-of-seven series. First to four wins takes the match.',
        },
      ],
      load: () =>
        import('../features/fixed-five/mode-adapter').then((module) => module.fixedFiveModeAdapter),
    },
  },
  {
    id: 'sandbox',
    label: 'Sandbox',
    description: 'Pick any 5 peak seasons, then play all 30 teams.',
    discovery: { homeOrder: 2, navigationOrder: 2, cta: 'Start sandbox' },
    solo: { href: '/sandbox', warmPlayersIndex: true },
  },
  {
    id: 'havoc',
    label: 'Hoop Havoc',
    description:
      'Draft five mutated freaks, run an automatic 82-game season, then replay it without powers to see what changed.',
    discovery: { homeOrder: 3, navigationOrder: 3, cta: 'Start Havoc' },
    solo: { href: '/havoc' },
    multiplayer: {
      gameKind: 'havoc',
      label: 'Hoop Havoc',
      routeId: '/havoc/room/[roomId]',
      formats: [
        {
          id: 'havoc',
          order: 4,
          name: 'Hoop Havoc',
          category: '5 rounds · Bo7',
          icon: Flame,
          image: '/images/multiplayer/hoop-havoc.png',
          format: 'Best of 7',
          description:
            'Draft five mutated freaks, one per position, then let a best-of-seven broadcast decide whose powers survive.',
        },
      ],
      load: () =>
        import('../features/havoc-multiplayer/mode-adapter').then(
          (module) => module.havocModeAdapter,
        ),
    },
  },
  {
    id: 'cap-rush',
    label: 'Cap Rush',
    description:
      'Draft five historical seasons at exact positions, manage the apron, and build the lineup you would take into an 82-game run.',
    discovery: { homeOrder: 4, navigationOrder: 4, cta: 'Start Cap Rush' },
    solo: { href: '/cap-rush' },
  },
  {
    id: 'draft-duel',
    label: 'Draft Duel',
    description:
      'Five rounds, eight cards, one pick each round. Both tables reveal together, then a best-of-seven broadcast settles it.',
    discovery: {},
    multiplayer: {
      gameKind: 'draft-duel',
      label: 'Draft Duel',
      routeId: '/draft-duel/room/[roomId]',
      formats: [
        {
          id: 'draft-duel',
          order: 3,
          name: 'Draft Duel',
          category: '5 rounds · Bo7',
          icon: Sparkles,
          image: '/images/multiplayer/draft-duel.png',
          format: 'Best of 7',
          description:
            'Five rounds, eight cards, one pick each round. Both tables reveal together, then a best-of-seven broadcast settles it.',
        },
      ],
      load: () =>
        import('../features/draft-duel/mode-adapter').then((module) => module.draftDuelModeAdapter),
    },
  },
] satisfies readonly ModeDefinition[];

export function homeModes(catalog: readonly ModeDefinition<string>[] = modeCatalog) {
  return catalog
    .filter((mode) => mode.solo && mode.discovery.homeOrder !== undefined)
    .sort((a, b) => (a.discovery.homeOrder ?? Infinity) - (b.discovery.homeOrder ?? Infinity));
}
export function modeNavigation(catalog: readonly ModeDefinition<string>[] = modeCatalog) {
  return catalog
    .filter((mode) => mode.solo && mode.discovery.navigationOrder !== undefined)
    .sort(
      (a, b) =>
        (a.discovery.navigationOrder ?? Infinity) - (b.discovery.navigationOrder ?? Infinity),
    );
}
export function multiplayerFormats(catalog: readonly ModeDefinition<string>[] = modeCatalog) {
  return catalog
    .flatMap((mode) => mode.multiplayer?.formats.map((format) => ({ ...format, mode })) ?? [])
    .sort((a, b) => a.order - b.order);
}
export function multiplayerMode(
  kind: MultiplayerGameKind,
  catalog: readonly ModeDefinition<string>[] = modeCatalog,
) {
  const mode = catalog.find((entry) => entry.multiplayer?.gameKind === kind);
  if (!mode?.multiplayer) throw new Error(`Unregistered multiplayer mode: ${kind}`);
  return mode.multiplayer;
}
