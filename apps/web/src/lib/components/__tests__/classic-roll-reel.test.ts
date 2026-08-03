// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import type { HoopRushManifest } from '@hoop-rush/data-contracts';
import { buildManifest } from '@hoop-rush/test-fixtures';
import ClassicRollReel from '$lib/components/classic/ClassicRollReel.svelte';
import { mockSvelteKitApp } from '../../../test/svelte-testing';

mockSvelteKitApp();

const FRANCHISE_REEL = '[data-axis="franchise"]';
const ERA_REEL = '[data-axis="era"]';
const FRANCHISE_STRIP = '[data-axis="franchise"] .reel-strip';
const ERA_STRIP = '[data-axis="era"] .reel-strip';
const LIVE_REGION = '[aria-live="polite"]';

const ANNOUNCE_TEXT = 'Round 3 of 5 · Los Angeles Lakers · 1990s';

const MANIFEST = buildManifest();

interface ReelProps {
  manifest: HoopRushManifest;
  franchiseId: string;
  eraId: string;
  franchiseOptions: string[];
  eraOptions: string[];
  axis?: 'both' | 'franchise' | 'era';
  spinKey?: number;
  announceText: string;
  reducedMotion?: boolean;
  onSettled: () => void;
}

function renderReel(overrides: Partial<ReelProps> = {}) {
  const onSettled = vi.fn();
  const result = render(ClassicRollReel, {
    props: {
      manifest: MANIFEST,
      franchiseId: 'lakers',
      eraId: '1990s',
      franchiseOptions: ['lakers', 'celtics', 'warriors'],
      eraOptions: ['1990s', '1980s', '2000s'],
      announceText: ANNOUNCE_TEXT,
      onSettled,
      ...overrides,
    },
  });
  return { ...result, onSettled };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ClassicRollReel', () => {
  it('mounts settled: final values visible, no spin, empty live region, no onSettled', () => {
    const { container, onSettled } = renderReel();

    const franchiseStrip = container.querySelector(FRANCHISE_STRIP);
    const eraStrip = container.querySelector(ERA_STRIP);

    expect(franchiseStrip).not.toBeNull();
    expect(eraStrip).not.toBeNull();
    expect(franchiseStrip?.classList.contains('reel-spinning')).toBe(false);
    expect(eraStrip?.classList.contains('reel-spinning')).toBe(false);
    expect(franchiseStrip?.textContent).toContain('Los Angeles Lakers');
    expect(eraStrip?.textContent).toContain('1990s');
    expect(container.querySelector(FRANCHISE_REEL)?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector(ERA_REEL)?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector(LIVE_REGION)?.textContent).toBe('');
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('spins both reels on a spinKey change and settles once with the announcement', async () => {
    const { container, rerender, onSettled } = renderReel();

    await rerender({ spinKey: 1 });

    const franchiseStrip = container.querySelector(FRANCHISE_STRIP);
    const eraStrip = container.querySelector(ERA_STRIP);
    expect(franchiseStrip?.classList.contains('reel-spinning')).toBe(true);
    expect(eraStrip?.classList.contains('reel-spinning')).toBe(true);
    expect(container.querySelector(LIVE_REGION)?.textContent).toBe('');

    await vi.advanceTimersByTimeAsync(950);

    expect(franchiseStrip?.classList.contains('reel-spinning')).toBe(false);
    expect(eraStrip?.classList.contains('reel-spinning')).toBe(false);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(container.querySelector(LIVE_REGION)?.textContent).toBe(ANNOUNCE_TEXT);
  });

  it('animates only the franchise reel with axis="franchise"', async () => {
    const { container, rerender, onSettled } = renderReel({ axis: 'franchise' });

    await rerender({ spinKey: 1 });

    const franchiseStrip = container.querySelector(FRANCHISE_STRIP);
    const eraStrip = container.querySelector(ERA_STRIP);
    expect(franchiseStrip?.classList.contains('reel-spinning')).toBe(true);
    expect(eraStrip?.classList.contains('reel-spinning')).toBe(false);
    expect(eraStrip?.textContent).toContain('1990s');

    await vi.advanceTimersByTimeAsync(950);

    expect(franchiseStrip?.classList.contains('reel-spinning')).toBe(false);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('animates only the era reel with axis="era"', async () => {
    const { container, rerender, onSettled } = renderReel({ axis: 'era' });

    await rerender({ spinKey: 1 });

    const franchiseStrip = container.querySelector(FRANCHISE_STRIP);
    const eraStrip = container.querySelector(ERA_STRIP);
    expect(franchiseStrip?.classList.contains('reel-spinning')).toBe(false);
    expect(eraStrip?.classList.contains('reel-spinning')).toBe(true);
    expect(franchiseStrip?.textContent).toContain('Los Angeles Lakers');

    await vi.advanceTimersByTimeAsync(950);

    expect(eraStrip?.classList.contains('reel-spinning')).toBe(false);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('announces the final result only at settle, exactly once', async () => {
    const { container, rerender } = renderReel();

    await rerender({ spinKey: 1 });

    const liveRegion = container.querySelector(LIVE_REGION);
    expect(liveRegion?.textContent).toBe('');

    await vi.advanceTimersByTimeAsync(950);

    expect(liveRegion?.textContent).toBe(ANNOUNCE_TEXT);

    await vi.advanceTimersByTimeAsync(5000);

    expect(liveRegion?.textContent).toBe(ANNOUNCE_TEXT);
  });

  it('fires onSettled exactly once per spin', async () => {
    const { rerender, onSettled } = renderReel();

    await rerender({ spinKey: 1 });
    await vi.advanceTimersByTimeAsync(950);
    expect(onSettled).toHaveBeenCalledTimes(1);

    await rerender({ spinKey: 2 });
    await vi.advanceTimersByTimeAsync(950);
    expect(onSettled).toHaveBeenCalledTimes(2);
  });

  it('reduced motion fades to the final value without strip motion', async () => {
    const { container, rerender, onSettled } = renderReel({ reducedMotion: true });

    await rerender({ spinKey: 1 });

    const franchiseStrip = container.querySelector(FRANCHISE_STRIP);
    const eraStrip = container.querySelector(ERA_STRIP);
    expect(franchiseStrip?.classList.contains('reel-spinning')).toBe(false);
    expect(franchiseStrip?.classList.contains('reel-fade')).toBe(true);
    expect(eraStrip?.classList.contains('reel-spinning')).toBe(false);
    expect(eraStrip?.classList.contains('reel-fade')).toBe(true);
    expect(franchiseStrip?.getAttribute('style')).toBeNull();
    expect(eraStrip?.getAttribute('style')).toBeNull();

    await vi.advanceTimersByTimeAsync(300);

    expect(franchiseStrip?.classList.contains('reel-spinning')).toBe(false);
    expect(franchiseStrip?.classList.contains('reel-fade')).toBe(false);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(container.querySelector(LIVE_REGION)?.textContent).toBe(ANNOUNCE_TEXT);
  });

  it('never fires onSettled after unmount', async () => {
    const { rerender, unmount, onSettled } = renderReel();

    await rerender({ spinKey: 1 });
    unmount();

    await vi.advanceTimersByTimeAsync(2000);

    expect(onSettled).not.toHaveBeenCalled();
  });

  it('settles with the final value when franchise options are empty', async () => {
    const { container, rerender, onSettled } = renderReel({ franchiseOptions: [] });

    await rerender({ spinKey: 1 });

    const franchiseStrip = container.querySelector(FRANCHISE_STRIP);
    const eraStrip = container.querySelector(ERA_STRIP);
    expect(franchiseStrip?.classList.contains('reel-spinning')).toBe(false);
    expect(franchiseStrip?.classList.contains('reel-fade')).toBe(true);
    expect(franchiseStrip?.textContent).toContain('Los Angeles Lakers');
    expect(eraStrip?.classList.contains('reel-spinning')).toBe(true);

    await vi.advanceTimersByTimeAsync(950);

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(container.querySelector(LIVE_REGION)?.textContent).toBe(ANNOUNCE_TEXT);
  });
});
