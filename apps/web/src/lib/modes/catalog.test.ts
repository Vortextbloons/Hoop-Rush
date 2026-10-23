import { describe, expect, it, vi } from 'bun:test';
import {
  modeIdSchema,
  multiplayerFormatIdSchema,
  multiplayerGameKindSchema,
} from '@hoop-rush/data-contracts';
import {
  homeModes,
  modeCatalog,
  modeNavigation,
  multiplayerFormats,
  multiplayerMode,
} from './catalog';
import type { ModeDefinition } from './types';

describe('mode catalog', () => {
  it('registers every validated mode, protocol, and format exactly once', () => {
    expect(modeCatalog.map((mode) => mode.id).sort()).toEqual([...modeIdSchema.options].sort());
    expect(
      multiplayerFormats()
        .map((format) => format.id)
        .sort(),
    ).toEqual([...multiplayerFormatIdSchema.options].sort());
    expect(
      modeCatalog.flatMap((mode) => (mode.multiplayer ? [mode.multiplayer.gameKind] : [])).sort(),
    ).toEqual([...multiplayerGameKindSchema.options].sort());
  });

  it('preserves entrypoints, discovery, navigation, and format ordering', () => {
    expect(homeModes().map((mode) => [mode.label, mode.solo?.href])).toEqual([
      ['Classic', '/classic'],
      ['Sandbox', '/sandbox'],
      ['Hoop Havoc', '/havoc'],
    ]);
    expect(modeNavigation().map((mode) => mode.id)).toEqual(homeModes().map((mode) => mode.id));
    expect(multiplayerFormats().map((format) => format.id)).toEqual([
      'season',
      'duel',
      'draft-duel',
      'havoc',
    ]);
    expect(multiplayerMode('fixed-five').routeId).toBe('/multiplayer/room/[roomId]');
    expect(multiplayerMode('draft-duel').routeId).toBe('/draft-duel/room/[roomId]');
    expect(multiplayerMode('havoc').routeId).toBe('/havoc/room/[roomId]');
  });

  it.each(multiplayerGameKindSchema.options)(
    'loads the %s adapter only when requested with validated defaults and all ports',
    async (kind) => {
      const mode = multiplayerMode(kind);
      const adapter = await mode.load();
      expect(adapter.settingsSchema.safeParse(adapter.defaults).success).toBe(true);
      expect(adapter.settingsSchema.safeParse({ variant: 'invalid' }).success).toBe(false);
      expect(adapter.Settings).toBeTypeOf('function');
      expect(adapter.loadRoom).toBeTypeOf('function');
      expect(await adapter.loadRoom()).toBeTypeOf('function');
      expect(adapter.loadLastRoomId).toBeTypeOf('function');
      expect(adapter.startSettings).toBeTypeOf('function');
      expect(adapter.loadVersions).toBeTypeOf('function');
      expect(adapter.resume).toBeTypeOf('function');
      expect(adapter.createRoomSession).toBeTypeOf('function');
      expect(adapter.inviteLink('1234')).toBe('/multiplayer?code=1234');
      expect(adapter.pickTimer(adapter.defaults, mode.formats[0]?.id ?? 'season')).toMatch(
        /picks$/,
      );
    },
    20_000,
  );

  it.each([
    { format: 'season', sourceMode: 'classic', timer: '90s picks' },
    { format: 'season', sourceMode: 'sandbox', timer: '5m picks' },
    { format: 'duel', sourceMode: 'classic', timer: '90s picks' },
    { format: 'duel', sourceMode: 'sandbox', timer: '90s picks' },
  ] as const)(
    'shows the authoritative $sourceMode $format timer',
    async ({ format, sourceMode, timer }) => {
      const adapter = await multiplayerMode('fixed-five').load();
      expect(adapter.pickTimer({ ...adapter.defaults, sourceMode }, format)).toBe(timer);
    },
  );

  it('integrates a test mode through registration without changing discovery or lobby selectors', async () => {
    const adapter = await multiplayerMode('draft-duel').load();
    const load = vi.fn(() => Promise.resolve(adapter));
    const format = multiplayerFormats()[0];
    if (!format) throw new Error('Expected a registered format');
    const testMode: ModeDefinition<'test-mode'> = {
      id: 'test-mode',
      label: 'Test mode',
      description: 'Test rules',
      discovery: { homeOrder: 10, navigationOrder: 10, cta: 'Start test' },
      solo: { href: '/classic' },
      multiplayer: {
        gameKind: 'draft-duel',
        label: 'Test match',
        routeId: '/draft-duel/room/[roomId]',
        formats: [{ ...format, id: 'draft-duel', name: 'Test format', order: 10 }],
        load,
      },
    };
    const catalog = [testMode];
    expect(homeModes(catalog)[0]?.label).toBe('Test mode');
    expect(modeNavigation(catalog)[0]?.solo?.href).toBe('/classic');
    expect(multiplayerFormats(catalog)[0]?.name).toBe('Test format');
    expect(load).not.toHaveBeenCalled();
    expect(await multiplayerMode('draft-duel', catalog).load()).toBe(adapter);
    expect(load).toHaveBeenCalledOnce();
  });
});
