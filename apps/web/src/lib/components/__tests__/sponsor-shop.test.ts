import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import type { SeasonRun } from '@hoop-rush/data-contracts';
import {
  commandIdSchema,
  eraIdSchema,
  franchiseIdSchema,
  playerIdSchema,
  seasonKeySchema,
} from '@hoop-rush/data-contracts';
import { createInitialSponsorGearState } from '@hoop-rush/engine';
import { buildManifest } from '@hoop-rush/test-fixtures';
import SponsorShopPanel from '$lib/components/season/SponsorShopPanel.svelte';
import SponsorShopModal from '$lib/components/season/SponsorShopModal.svelte';
import SponsorOfferCard from '$lib/components/season/SponsorOfferCard.svelte';
import SponsorMark from '$lib/components/season/SponsorMark.svelte';
import PlayerSponsorCard from '$lib/components/season/PlayerSponsorCard.svelte';
import SeasonRosterList from '$lib/components/season/SeasonRosterList.svelte';
import {
  playerSponsorCardOf,
  sponsorShopOf,
  type SponsorVaultEntry,
} from '$lib/season/sponsor-gear-view';
import { mockSvelteKitApp } from '../../../test/svelte-testing';

mockSvelteKitApp();

const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a0';

function testRun(): SeasonRun {
  return { sponsors: createInitialSponsorGearState(SEED) } as SeasonRun;
}

function vaultEntry(slot: 'shoe' | 'apparel' | 'fuel', brandFamily = 'nike'): SponsorVaultEntry {
  return {
    instanceId: `vault-${slot}`,
    brandFamily,
    displayName: brandFamily,
    slot,
    tier: 'BUZZ',
    boosts: [{ key: 'speed', points: 3, label: 'SPD' }],
    boostLine: '+3 SPD',
  };
}

describe('SponsorShopPanel', () => {
  it('renders five offers with buy buttons', () => {
    const offers = sponsorShopOf(testRun(), 0, 8);
    if (offers === null) throw new Error('expected offers');
    const onBuy = vi.fn();
    const { getByTestId, getAllByTestId } = render(SponsorShopPanel, {
      props: {
        offers,
        balance: 8,
        cap: 8,
        ownedCount: 0,
        logos: new Map(),
        onBuy,
      },
    });
    expect(getByTestId('sponsor-shop-panel')).toBeTruthy();
    expect(getAllByTestId(/^sponsor-offer-/)).toHaveLength(5);
    expect(getByTestId('sponsor-shop-count').textContent).toContain('0/5 owned');
  });

  it('fires buy with the offer instance id', async () => {
    const offers = sponsorShopOf(testRun(), 0, 8);
    if (offers === null || offers[0] === undefined) throw new Error('expected offers');
    const onBuy = vi.fn();
    const { getByTestId } = render(SponsorShopPanel, {
      props: { offers, balance: 8, cap: 8, ownedCount: 0, logos: new Map(), onBuy },
    });
    await fireEvent.click(getByTestId(`buy-sponsor-${offers[0].instanceId}`));
    expect(onBuy).toHaveBeenCalledWith({ instanceId: offers[0].instanceId });
  });

  it('disables unaffordable offers with the balance shown', () => {
    const offers = sponsorShopOf(testRun(), 0, 0);
    if (offers === null) throw new Error('expected offers');
    const pricey = offers.find((offer) => !offer.affordable);
    if (pricey === undefined) throw new Error('expected an unaffordable offer');
    const { getByTestId } = render(SponsorShopPanel, {
      props: { offers, balance: 0, cap: 8, ownedCount: 0, logos: new Map(), onBuy: vi.fn() },
    });
    const button = getByTestId(`buy-sponsor-${pricey.instanceId}`);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.textContent).toContain('have 0/8');
  });

  it('shows owned state without a buy affordance', () => {
    const offers = sponsorShopOf(testRun(), 0, 8);
    if (offers === null) throw new Error('expected offers');
    const owned = offers.map((offer, index) =>
      index === 0 ? { ...offer, state: 'owned' as const } : offer,
    );
    const { getByTestId } = render(SponsorShopPanel, {
      props: { offers: owned, balance: 8, cap: 8, ownedCount: 1, logos: new Map(), onBuy: vi.fn() },
    });
    const first = owned[0];
    if (first === undefined) throw new Error('expected offers');
    const button = getByTestId(`buy-sponsor-${first.instanceId}`);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.textContent).toContain('Owned');
  });
});

describe('SponsorMark tile contrast', () => {
  it('uses a light tile for dark artwork and a dark tile for light artwork', () => {
    const darkArt = render(SponsorMark, {
      props: { family: 'nike', displayName: 'Nike', logoUrl: '/nike.svg' },
    });
    const darkArtImg = darkArt.container.querySelector('img');
    expect(darkArtImg?.className).toContain('bg-[#e9edf3]');
    darkArt.unmount();

    const lightArt = render(SponsorMark, {
      props: { family: 'skratch', displayName: 'Skratch', logoUrl: '/skratch.svg' },
    });
    const lightArtImg = lightArt.container.querySelector('img');
    expect(lightArtImg?.className).toContain('bg-[#141a24]');
    lightArt.unmount();
  });
});

describe('SponsorOfferCard brand links', () => {
  it('links out to the official brand site without replacing local art', () => {
    const offers = sponsorShopOf(testRun(), 0, 8);
    if (offers === null || offers[0] === undefined) throw new Error('expected offers');
    const { getByTestId } = render(SponsorOfferCard, {
      props: {
        offer: offers[0],
        balance: 8,
        cap: 8,
        logos: new Map(),
        onBuy: vi.fn(),
      },
    });
    const link = getByTestId(`sponsor-brand-link-${offers[0].instanceId}`);
    expect(link.getAttribute('href')).toMatch(/^https:\/\//);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});

describe('SponsorShopModal', () => {
  it('renders the board, balance, and empty vault summary when open', () => {
    const offers = sponsorShopOf(testRun(), 0, 8);
    if (offers === null) throw new Error('expected offers');
    const { getByTestId, getAllByTestId } = render(SponsorShopModal, {
      props: {
        open: true,
        offers,
        balance: 8,
        cap: 8,
        ownedCount: 0,
        history: [{ blockIndex: 0, bought: 0, expired: 5 }],
        vault: [],
        logos: new Map(),
        blockLabel: 'Block 1 of 9',
        onBuy: vi.fn(),
        onOpenChange: vi.fn(),
      },
    });
    expect(getByTestId('sponsor-shop-modal')).toBeTruthy();
    expect(getByTestId('sponsor-shop-modal-title').textContent).toContain('Sponsor shop');
    expect(getByTestId('sponsor-shop-balance').textContent).toContain('8/8');
    expect(getAllByTestId(/^sponsor-offer-/)).toHaveLength(5);
    expect(getByTestId('sponsor-vault-counts').textContent).toContain('0');
  });

  it('filters offers by slot and fires buy with the instance id', async () => {
    const offers = sponsorShopOf(testRun(), 0, 8);
    if (offers === null || offers[0] === undefined) throw new Error('expected offers');
    const onBuy = vi.fn();
    const { getByTestId, getAllByTestId } = render(SponsorShopModal, {
      props: {
        open: true,
        offers,
        balance: 8,
        cap: 8,
        ownedCount: 0,
        history: [],
        vault: [],
        logos: new Map(),
        onBuy,
        onOpenChange: vi.fn(),
      },
    });
    await fireEvent.click(getByTestId('filter-sponsor-shoe'));
    const visible = getAllByTestId(/^sponsor-offer-/);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThanOrEqual(5);
    await fireEvent.click(getByTestId('filter-sponsor-all'));
    expect(getAllByTestId(/^sponsor-offer-/)).toHaveLength(5);
    await fireEvent.click(getByTestId(`buy-sponsor-${offers[0].instanceId}`));
    expect(onBuy).toHaveBeenCalledWith({ instanceId: offers[0].instanceId });
  });

  it('summarizes stashed vault gear by slot', () => {
    const offers = sponsorShopOf(testRun(), 0, 8);
    if (offers === null) throw new Error('expected offers');
    const { getByTestId } = render(SponsorShopModal, {
      props: {
        open: true,
        offers,
        balance: 8,
        cap: 8,
        ownedCount: 0,
        history: [],
        vault: [vaultEntry('shoe'), vaultEntry('fuel', 'gatorade')],
        logos: new Map(),
        onBuy: vi.fn(),
        onOpenChange: vi.fn(),
      },
    });
    expect(getByTestId('sponsor-vault-counts').textContent).toContain('SHOE 1');
    expect(getByTestId('sponsor-vault-counts').textContent).toContain('FUEL 1');
    expect(getByTestId('sponsor-vault-vault-shoe')).toBeTruthy();
    expect(getByTestId('sponsor-vault-vault-fuel')).toBeTruthy();
  });
});

describe('PlayerSponsorCard', () => {
  const manifest = buildManifest();
  function card() {
    return playerSponsorCardOf(testRun(), {
      playerVersionId: 'pv-test-1',
      displayName: 'Test Player',
      seasonKey: '1995-96',
      franchiseId: 'lakers',
      eraId: '1990s',
      playable: ['PG'],
      overall: 82,
      baseRatings: {
        insideScoring: 70,
        closeShot: 70,
        midrange: 70,
        threePoint: 70,
        freeThrow: 70,
        ballHandling: 70,
        passing: 70,
        offensiveIq: 70,
        offensiveRebound: 70,
        defensiveRebound: 70,
        perimeterDefense: 70,
        interiorDefense: 70,
        steal: 70,
        block: 70,
        defensiveIq: 70,
        speed: 70,
        strength: 70,
        vertical: 70,
      },
      role: 'Starter',
      minutes: 34,
      fatigueLabel: null,
      fatiguePercent: null,
      lastMinutes: null,
    });
  }

  it('shows boosted ratings with source lines and slot sections', () => {
    const { getByTestId, getByText } = render(PlayerSponsorCard, {
      props: {
        card: card(),
        face: null,
        manifest,
        vault: [vaultEntry('shoe')],
        logos: new Map(),
        onApply: vi.fn(),
        onClose: vi.fn(),
      },
    });
    expect(getByTestId('sponsor-ratings-grid').children.length).toBe(13);
    expect(getByTestId('sponsor-slot-shoe')).toBeTruthy();
    expect(getByTestId('sponsor-slot-apparel')).toBeTruthy();
    expect(getByTestId('sponsor-slot-fuel')).toBeTruthy();
    expect(getByText('Showing boosted')).toBeTruthy();
  });

  it('requires an explicit irreversible confirm before applying', async () => {
    const onApply = vi.fn();
    const { getByTestId, queryByTestId } = render(PlayerSponsorCard, {
      props: {
        card: card(),
        face: null,
        manifest,
        vault: [vaultEntry('shoe')],
        logos: new Map(),
        onApply,
        onClose: vi.fn(),
      },
    });
    expect(queryByTestId('confirm-apply-vault-shoe')).toBeNull();
    await fireEvent.click(getByTestId('apply-sponsor-vault-shoe'));
    expect(onApply).not.toHaveBeenCalled();
    await fireEvent.click(getByTestId('confirm-apply-vault-shoe'));
    expect(onApply).toHaveBeenCalledWith({
      instanceId: 'vault-shoe',
      playerVersionId: 'pv-test-1',
      slot: 'shoe',
    });
  });

  it('disables brand duplicates with a reason', () => {
    const playerVersionId = `pv-${'1'.repeat(32)}`;
    const sponsors = createInitialSponsorGearState(SEED);
    sponsors.players.slots[playerVersionId] = {
      shoe: {
        instanceId: 'sponsor-0-0',
        entryId: 'nike-icon',
        brandFamily: 'nike',
        slot: 'shoe',
        tier: 'ICON',
        boosts: [{ key: 'speed', points: 4 }],
        appliedBlock: 0,
        appliedByCommandId: commandIdSchema.parse('cmd-1'),
      },
      apparel: null,
      fuel: null,
    };
    const run = { sponsors } as SeasonRun;
    const dupeCard = playerSponsorCardOf(run, {
      playerVersionId,
      displayName: 'Test Player',
      seasonKey: '1995-96',
      franchiseId: 'lakers',
      eraId: '1990s',
      playable: ['PG'],
      overall: 82,
      baseRatings: card().baseRatings,
      role: 'Starter',
      minutes: 34,
      fatigueLabel: null,
      fatiguePercent: null,
      lastMinutes: null,
    });
    const { getByTestId, getByText } = render(PlayerSponsorCard, {
      props: {
        card: dupeCard,
        face: null,
        manifest,
        vault: [vaultEntry('apparel', 'nike')],
        logos: new Map(),
        onApply: vi.fn(),
        onClose: vi.fn(),
      },
    });
    const dupe = getByTestId('apply-sponsor-vault-apparel');
    expect((dupe as HTMLButtonElement).disabled).toBe(true);
    expect(getByText('Already worn by this player (nike)')).toBeTruthy();
  });
});

describe('SeasonRosterList sponsors', () => {
  const manifest = buildManifest();
  function shellStub() {
    return {
      facesByVersion: new Map(),
      catalog: { candidates: [] },
      playablePositions: () => [],
    };
  }
  const roster = {
    franchiseId: franchiseIdSchema.parse('lakers'),
    players: [
      {
        playerVersionId: 'pv-test-1',
        playerId: playerIdSchema.parse('p-test-1'),
        displayName: 'Test Player',
        franchiseId: franchiseIdSchema.parse('lakers'),
        eraId: eraIdSchema.parse('1990s'),
        seasonKey: seasonKeySchema.parse('1995-96'),
      },
    ],
  };

  it('renders rows as buttons when a select handler is provided', async () => {
    const onSelectPlayer = vi.fn();
    const { getByTestId } = render(SeasonRosterList, {
      props: {
        roster,
        manifest,
        shell: shellStub() as never,
        roleOf: () => ({ role: 'Starter', minutes: 30 }),
        effects: null,
        summaries: [],
        embedded: true,
        sponsorsRun: testRun(),
        onSelectPlayer,
      },
    });
    const button = getByTestId('roster-player-pv-test-1');
    expect(button.getAttribute('aria-label')).toContain('Test Player');
    await fireEvent.click(button);
    expect(onSelectPlayer).toHaveBeenCalledWith('pv-test-1');
  });
});
