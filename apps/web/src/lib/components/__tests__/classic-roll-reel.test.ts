import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { HoopRushManifest } from '@hoop-rush/data-contracts';
import { buildManifest } from '@hoop-rush/test-fixtures';
import ClassicRollReel from '$lib/components/classic/ClassicRollReel.svelte';
import { mockSvelteKitApp } from '../../../test/svelte-testing';
mockSvelteKitApp();
const OVERLAY = '.roll-overlay';
const RESULT = '.roll-result';
const FRANCHISE_STRIP = '[data-axis="franchise"] .reel-strip';
const ERA_STRIP = '[data-axis="era"] .reel-strip';
const LIVE_REGION = '[aria-live="polite"]';
const ANNOUNCE_TEXT = 'Round 3 of 5 · Los Angeles Lakers · 1990s';
const SPIN_SETTLE_MS = 2100;
const FULL_CYCLE_MS = SPIN_SETTLE_MS + 850;
const MANIFEST = buildManifest();
interface ReelProps {
    manifest: HoopRushManifest;
    franchiseId: string;
    eraId: string;
    franchiseOptions: string[];
    eraOptions: string[];
    axis?: 'both' | 'franchise' | 'era';
    spinKey?: number;
    spotlight?: 'you' | 'rival' | null;
    announceText: string;
    roundLabel?: string;
    reducedMotion?: boolean;
    spinDurationMs?: number;
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
            roundLabel: 'Round 3 of 5',
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
    it('mounts idle: no overlay, empty live region, no onSettled', () => {
        const { container, onSettled } = renderReel();
        expect(container.querySelector(OVERLAY)).toBeNull();
        expect(container.querySelector(LIVE_REGION)).toBeNull();
        expect(onSettled).not.toHaveBeenCalled();
    });
    it('opens the modal on mount when spinKey starts above zero, spins both reels, shows the result indicator, then closes', async () => {
        const { container, onSettled } = renderReel({ spinKey: 1 });
        expect(container.querySelector(OVERLAY)).not.toBeNull();
        const franchiseStrip = container.querySelector(FRANCHISE_STRIP);
        const eraStrip = container.querySelector(ERA_STRIP);
        expect(franchiseStrip?.classList.contains('reel-spinning')).toBe(true);
        expect(eraStrip?.classList.contains('reel-spinning')).toBe(true);
        expect(container.querySelector(LIVE_REGION)?.textContent).toBe('');
        await vi.advanceTimersByTimeAsync(SPIN_SETTLE_MS);
        expect(container.querySelector(FRANCHISE_STRIP)).toBeNull();
        expect(container.querySelector(RESULT)).not.toBeNull();
        expect(container.querySelector(RESULT)?.textContent).toContain('Los Angeles Lakers');
        expect(container.querySelector(RESULT)?.textContent).toContain('1990s');
        expect(container.querySelector('.roll-round')?.textContent).toBe('Round 3 of 5');
        expect(container.querySelector(LIVE_REGION)?.textContent).toBe(ANNOUNCE_TEXT);
        expect(onSettled).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(850);
        expect(container.querySelector(OVERLAY)).toBeNull();
        expect(onSettled).toHaveBeenCalledTimes(1);
    });
    it.each<{
        axis: 'franchise' | 'era';
        spinning: string;
        idle: string;
        idleText: string;
    }>([
        { axis: 'franchise', spinning: FRANCHISE_STRIP, idle: ERA_STRIP, idleText: '1990s' },
        { axis: 'era', spinning: ERA_STRIP, idle: FRANCHISE_STRIP, idleText: 'Los Angeles Lakers' },
    ])('animates only the $axis reel with axis="$axis"', async ({ axis, spinning, idle, idleText }) => {
        const { container, rerender, onSettled } = renderReel({ axis });
        await rerender({ spinKey: 1 });
        expect(container.querySelector(spinning)?.classList.contains('reel-spinning')).toBe(true);
        expect(container.querySelector(idle)?.classList.contains('reel-spinning')).toBe(false);
        expect(container.querySelector(idle)?.textContent).toContain(idleText);
        await vi.advanceTimersByTimeAsync(SPIN_SETTLE_MS);
        expect(container.querySelector(RESULT)).not.toBeNull();
        await vi.advanceTimersByTimeAsync(850);
        expect(onSettled).toHaveBeenCalledTimes(1);
    });
    it('announces the final result only at settle, exactly once', async () => {
        const { container, rerender } = renderReel();
        await rerender({ spinKey: 1 });
        const liveRegion = container.querySelector(LIVE_REGION);
        expect(liveRegion?.textContent).toBe('');
        await vi.advanceTimersByTimeAsync(SPIN_SETTLE_MS);
        expect(liveRegion?.textContent).toBe(ANNOUNCE_TEXT);
        await vi.advanceTimersByTimeAsync(5000);
        expect(liveRegion?.textContent).toBe(ANNOUNCE_TEXT);
    });
    it('fires onSettled exactly once per spin', async () => {
        const { rerender, onSettled } = renderReel();
        await rerender({ spinKey: 1 });
        await vi.advanceTimersByTimeAsync(FULL_CYCLE_MS);
        expect(onSettled).toHaveBeenCalledTimes(1);
        await rerender({ spinKey: 2 });
        await vi.advanceTimersByTimeAsync(FULL_CYCLE_MS);
        expect(onSettled).toHaveBeenCalledTimes(2);
    });
    it('reduced motion fades to the result and closes without strip motion', async () => {
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
        expect(container.querySelector(RESULT)).not.toBeNull();
        expect(container.querySelector(LIVE_REGION)?.textContent).toBe(ANNOUNCE_TEXT);
        expect(onSettled).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(300);
        expect(container.querySelector(OVERLAY)).toBeNull();
        expect(onSettled).toHaveBeenCalledTimes(1);
    });
    it('never fires onSettled after unmount', async () => {
        const { rerender, unmount, onSettled } = renderReel();
        await rerender({ spinKey: 1 });
        unmount();
        await vi.advanceTimersByTimeAsync(2000);
        expect(onSettled).not.toHaveBeenCalled();
    });
    it('settles early when spinDurationMs shortens the spin', async () => {
        const { container, onSettled } = renderReel({ spinKey: 1, spinDurationMs: 100 });
        await vi.advanceTimersByTimeAsync(300);
        expect(container.querySelector(RESULT)).not.toBeNull();
        expect(onSettled).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1500);
        expect(onSettled).toHaveBeenCalledTimes(1);
    });
    it('closes immediately when the settled overlay is clicked', async () => {
        const { container, rerender, onSettled } = renderReel();
        await rerender({ spinKey: 1 });
        await vi.advanceTimersByTimeAsync(SPIN_SETTLE_MS);
        const overlay = container.querySelector(OVERLAY);
        expect(overlay).not.toBeNull();
        expect(container.querySelector('.roll-continue')).not.toBeNull();
        expect(onSettled).not.toHaveBeenCalled();
        if (overlay) {
            await fireEvent.click(overlay);
        }
        expect(onSettled).toHaveBeenCalledTimes(1);
        await tick();
        expect(container.querySelector(OVERLAY)).toBeNull();
        await vi.advanceTimersByTimeAsync(5000);
        expect(onSettled).toHaveBeenCalledTimes(1);
    });
    it('closes when the Continue button is clicked', async () => {
        const { container, rerender, onSettled } = renderReel();
        await rerender({ spinKey: 1 });
        await vi.advanceTimersByTimeAsync(SPIN_SETTLE_MS);
        const button = container.querySelector('.roll-continue');
        expect(button).not.toBeNull();
        expect(onSettled).not.toHaveBeenCalled();
        if (button) {
            await fireEvent.click(button);
        }
        expect(onSettled).toHaveBeenCalledTimes(1);
        await tick();
        expect(container.querySelector(OVERLAY)).toBeNull();
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
        await vi.advanceTimersByTimeAsync(SPIN_SETTLE_MS);
        expect(container.querySelector(RESULT)).not.toBeNull();
        expect(container.querySelector(LIVE_REGION)?.textContent).toBe(ANNOUNCE_TEXT);
        expect(onSettled).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(850);
        expect(container.querySelector(OVERLAY)).toBeNull();
        expect(onSettled).toHaveBeenCalledTimes(1);
    });
    it.each([
        { spotlight: 'you' as const, text: 'Your roll', stageClass: 'roll-stage--you' },
        { spotlight: 'rival' as const, text: "Rival's roll", stageClass: 'roll-stage--rival' },
    ])('spotlight="$spotlight" frames the stage for that picker', async ({ spotlight, text, stageClass }) => {
        const { container, rerender } = renderReel({ spinKey: 1, spotlight });
        expect(container.querySelector('.roll-spot')?.textContent).toBe(text);
        expect(container.querySelector('.roll-stage')?.classList.contains(stageClass)).toBe(true);
        await rerender({ spinKey: 1 });
        await vi.advanceTimersByTimeAsync(FULL_CYCLE_MS);
    });
    it('renders no spotlight pill without the spotlight prop', () => {
        const { container } = renderReel({ spinKey: 1 });
        expect(container.querySelector('.roll-spot')).toBeNull();
    });
    it.each(['franchise', 'era'] as const)('marks the settled result with roll-result--%s', async (axis) => {
        const { container, rerender } = renderReel({ axis });
        await rerender({ spinKey: 1 });
        await vi.advanceTimersByTimeAsync(SPIN_SETTLE_MS);
        expect(container.querySelector(RESULT)?.classList.contains(`roll-result--${axis}`)).toBe(true);
        await vi.advanceTimersByTimeAsync(850);
    });
    it('shows the historical crossover identity for a relocated franchise era', async () => {
        const { container, rerender, onSettled } = renderReel({
            franchiseId: 'thunder',
            eraId: '2000s',
            announceText: 'Round 3 of 5 · Seattle SuperSonics → Oklahoma City Thunder · 2000s',
        });
        await rerender({ spinKey: 1 });
        const franchiseStrip = container.querySelector(FRANCHISE_STRIP);
        expect(franchiseStrip?.textContent).toContain('SEA → OKC');
        expect(franchiseStrip?.textContent).toContain('Seattle SuperSonics → Oklahoma City Thunder');
        await vi.advanceTimersByTimeAsync(SPIN_SETTLE_MS);
        const result = container.querySelector(RESULT);
        expect(result?.textContent).toContain('SEA → OKC');
        expect(result?.textContent).toContain('Seattle SuperSonics → Oklahoma City Thunder');
        expect(result?.textContent).toContain('2000s');
        expect(container.querySelector(LIVE_REGION)?.textContent).toBe('Round 3 of 5 · Seattle SuperSonics → Oklahoma City Thunder · 2000s');
        await vi.advanceTimersByTimeAsync(850);
        expect(container.querySelector(OVERLAY)).toBeNull();
        expect(onSettled).toHaveBeenCalledTimes(1);
    });
});
