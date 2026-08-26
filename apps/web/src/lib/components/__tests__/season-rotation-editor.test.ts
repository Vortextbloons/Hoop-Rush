import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { SEASON_MINUTE_POLICY_VERSION, type SeasonMinutePolicyStrategy, type SeasonRotation, } from '@hoop-rush/data-contracts';
import type { MinutePlanOptimizationResult, OptimizedMinutePlan } from '@hoop-rush/engine';
import RotationEditor from '$lib/components/season/RotationEditor.svelte';
import { createRotationEditor, type RotationMember } from '$lib/season/season-rotation-editor';
import { CANDIDATES, legalRotation, rotationMembers, } from '$lib/season/season-rotation-test-support';
import { mockSvelteKitApp } from '../../../test/svelte-testing';
mockSvelteKitApp();
function members(): RotationMember[] {
    return rotationMembers();
}
function renderEditor(overrides: {
    minutes?: Array<[
        string,
        number
    ]>;
} = {}) {
    const rotation = legalRotation();
    if (overrides.minutes) {
        for (const [playerVersionId, minutes] of overrides.minutes) {
            rotation.targetMinutes = rotation.targetMinutes.map((entry) => entry.playerVersionId === playerVersionId ? { ...entry, minutes } : entry);
        }
    }
    const editor = createRotationEditor(rotation, members());
    const onchange = vi.fn();
    const result = render(RotationEditor, {
        props: { editor, disabled: false, onchange },
    });
    return { editor, onchange, ...result };
}
function rotationList(container: HTMLElement) {
    const section = container.querySelector('section[aria-labelledby="starters-heading"]');
    if (section === null)
        throw new Error('starters section missing');
    return within(section as HTMLElement);
}
function minutesList(container: HTMLElement) {
    const section = container.querySelector('section[aria-labelledby="minutes-heading"]');
    if (section === null)
        throw new Error('minutes section missing');
    return within(section as HTMLElement);
}
function fixturePlanResult(): MinutePlanOptimizationResult {
    const base = legalRotation();
    const plan = (strategy: SeasonMinutePolicyStrategy, overrides: Partial<OptimizedMinutePlan> = {}): OptimizedMinutePlan => ({
        strategy,
        rotation: {
            ...base,
            minutePolicy: { policyVersion: SEASON_MINUTE_POLICY_VERSION, strategy },
        },
        quality: 0.6,
        maxStarterStrainBasisPoints: 1200,
        strainBand: 'ready',
        relief: 0.25,
        fatigueBands: { fresh: 2, ready: 6, tired: 2, heavy: 0 },
        riskScore: 0.7,
        heavyStrain: false,
        projectedNetRating: 3.2,
        unitQuality: { starting: 2.5, closing: 2.2, bench: 1.1 },
        ...overrides,
    });
    return {
        plans: [
            plan('starter-heavy', { projectedNetRating: 3.42, riskScore: 0.72, relief: 0.25 }),
            plan('balanced', { projectedNetRating: 3.31, riskScore: 0.68, relief: 0.3 }),
            plan('bench-heavy', {
                projectedNetRating: 3.05,
                riskScore: 0.6,
                strainBand: 'tired',
                heavyStrain: true,
                relief: 0.4,
            }),
        ],
        recommended: 'starter-heavy',
    };
}
describe('RotationEditor component', () => {
    it('renders one unified list: all ten players, both sections, no mobile tabs', () => {
        const { container, queryByRole } = renderEditor();
        expect(container.querySelector('p strong')?.textContent).toBe('240');
        expect(queryByRole('button', { name: 'Bench' })).toBeNull();
        expect(queryByRole('button', { name: 'Closing' })).toBeNull();
        const starterList = rotationList(container);
        expect(starterList.getAllByRole('combobox', { name: /Starter slot/ })).toHaveLength(5);
        const benchSection = container.querySelector('section[aria-labelledby="bench-heading"]');
        if (benchSection === null)
            throw new Error('bench section missing');
        expect(within(benchSection as HTMLElement).getAllByRole('button', { name: /bench order/i })).toHaveLength(10);
        expect(minutesList(container).getAllByRole('group', { name: /Minutes for/ })).toHaveLength(10);
    });
    it('shows the player OVR rating on the top minutes panel rows', () => {
        const { editor } = renderEditor();
        const first = editor.rotation.starters[0];
        if (first === undefined) {
            throw new Error('fixture rotation has no first starter');
        }
        const overallByVersion = new Map<string, number>([
            ...editor.rotation.starters.map((id) => [id, 88] as const),
            ...editor.rotation.benchOrder.map((id) => [id, 79] as const),
        ]);
        const { container } = render(RotationEditor, {
            props: {
                editor,
                disabled: false,
                onchange: vi.fn(),
                overallByVersion,
            },
        });
        const minutes = minutesList(container);
        expect(minutes.getAllByText('OVR 88').length).toBe(5);
        expect(minutes.getAllByText(/^OVR \d+$/).length).toBe(10);
    });
    it('starter slot pickers only offer players eligible for the slot', () => {
        const { editor, container } = renderEditor();
        const optionIds = (slotIndex: number) => [
            ...new Set(editor.eligibleForSlot(slotIndex).map((member) => member.playerVersionId)),
        ];
        const centerOnly = rotationMembers().find((member) => member.playable.join() === 'C');
        if (centerOnly === undefined) {
            throw new Error('fixture roster has no center-only player');
        }
        const starterList = rotationList(container);
        const guardPicker = starterList.getByRole('combobox', { name: 'Starter slot 1' });
        const guardNames = [...guardPicker.querySelectorAll('option')].map((o) => o.textContent);
        expect(guardNames).not.toContain(centerOnly.displayName);
        const centerPicker = starterList.getByRole('combobox', { name: 'Starter slot 5' });
        const centerNames = [...centerPicker.querySelectorAll('option')].map((o) => o.textContent);
        const expected = optionIds(4).map((id) => editor.names.get(id) ?? '');
        expect(centerNames.sort()).toEqual(expected.sort());
        for (let slotIndex = 0; slotIndex < 5; slotIndex += 1) {
            const current = editor.rotation.starters[slotIndex];
            if (current === undefined)
                continue;
            const picker = starterList.getByRole('combobox', {
                name: `Starter slot ${String(slotIndex + 1)}`,
            });
            const names = [...picker.querySelectorAll('option')].map((o) => o.textContent);
            expect(names).toContain(editor.names.get(current) ?? '');
        }
    });
    it('applies a preset through the engine and reports the new rotation', async () => {
        const { onchange, getByRole } = renderEditor();
        await fireEvent.click(getByRole('button', { name: 'Balanced' }));
        expect(onchange).toHaveBeenCalledTimes(1);
        const [rotation, failures] = onchange.mock.calls[0] as [
            SeasonRotation,
            string[]
        ];
        expect(failures).toEqual([]);
        expect(rotation.targetMinutes.find((t) => t.playerVersionId === rotation.starters[0])?.minutes).toBe(33);
        expect(rotation.targetMinutes.find((t) => t.playerVersionId === rotation.benchOrder[0])?.minutes).toBe(21);
    });
    it('increments and decrements one player target minute, keeping the 240 total', async () => {
        const { editor, onchange, container } = renderEditor();
        const first = editor.rotation.starters[0];
        const label = first === undefined ? undefined : editor.names.get(first);
        if (first === undefined || label === undefined) {
            throw new Error('fixture rotation has no first starter');
        }
        const list = minutesList(container);
        await fireEvent.click(list.getByRole('button', { name: `Increase minutes for ${label}` }));
        let [rotation] = onchange.mock.calls.at(-1) as [
            SeasonRotation,
            string[]
        ];
        expect(rotation.targetMinutes.find((t) => t.playerVersionId === first)?.minutes).toBe(33);
        await fireEvent.click(list.getByRole('button', { name: `Decrease minutes for ${label}` }));
        [rotation] = onchange.mock.calls.at(-1) as [
            SeasonRotation,
            string[]
        ];
        expect(rotation.targetMinutes.find((t) => t.playerVersionId === first)?.minutes).toBe(32);
        const total = rotation.targetMinutes.reduce((sum, entry) => sum + entry.minutes, 0);
        expect(total).toBe(240);
        expect(container.querySelector('p strong')?.textContent).toBe('240');
    });
    it('announces and highlights the compensated player on a stepper change', async () => {
        const { editor, container } = renderEditor();
        const first = editor.rotation.starters[0];
        const label = first === undefined ? undefined : editor.names.get(first);
        if (first === undefined || label === undefined) {
            throw new Error('fixture rotation has no first starter');
        }
        const list = minutesList(container);
        await fireEvent.click(list.getByRole('button', { name: `Increase minutes for ${label}` }));
        const status = container.querySelector('[role="status"]');
        expect(status?.textContent ?? '').toMatch(/took 1 from/);
        const second = editor.rotation.starters[1];
        if (second === undefined) {
            throw new Error('fixture rotation has no second starter');
        }
        const secondLabel = editor.names.get(second);
        if (secondLabel === undefined) {
            throw new Error('fixture rotation has no name for the second starter');
        }
        const row = list.getByRole('group', { name: `Minutes for ${secondLabel}` }).closest('li');
        expect(row?.classList.contains('ring-2')).toBe(true);
    });
    it('tap-to-type commits a direct minutes value through rebalancing', async () => {
        const { editor, onchange, container } = renderEditor();
        const first = editor.rotation.starters[0];
        const label = first === undefined ? undefined : editor.names.get(first);
        if (first === undefined || label === undefined) {
            throw new Error('fixture rotation has no first starter');
        }
        const list = minutesList(container);
        await fireEvent.click(list.getByRole('button', { name: `Edit target minutes for ${label}` }));
        const input = list.getByRole('textbox', { name: `Target minutes for ${label}` });
        await fireEvent.input(input, { target: { value: '40' } });
        await fireEvent.keyDown(input, { key: 'Enter' });
        const [rotation] = onchange.mock.calls.at(-1) as [
            SeasonRotation,
            string[]
        ];
        expect(rotation.targetMinutes.find((t) => t.playerVersionId === first)?.minutes).toBe(40);
        expect(rotation.targetMinutes.reduce((sum, entry) => sum + entry.minutes, 0)).toBe(240);
        expect(container.querySelector('input[inputmode="numeric"]')).toBeNull();
    });
    it('cancels an inline edit on Escape without changing minutes', async () => {
        const { editor, onchange, container } = renderEditor();
        const first = editor.rotation.starters[0];
        const label = first === undefined ? undefined : editor.names.get(first);
        if (first === undefined || label === undefined) {
            throw new Error('fixture rotation has no first starter');
        }
        const before = onchange.mock.calls.length;
        const list = minutesList(container);
        await fireEvent.click(list.getByRole('button', { name: `Edit target minutes for ${label}` }));
        const input = list.getByRole('textbox', { name: `Target minutes for ${label}` });
        await fireEvent.input(input, { target: { value: '99' } });
        await fireEvent.keyDown(input, { key: 'Escape' });
        expect(onchange.mock.calls.length).toBe(before);
        expect(editor.minutesFor(first)).toBe(32);
    });
    it('closing-five toggles swap players while keeping five selected', async () => {
        const { editor, onchange, container } = renderEditor();
        const bench = editor.rotation.benchOrder[0];
        if (bench === undefined) {
            throw new Error('fixture rotation has no bench player');
        }
        const benchLabel = editor.names.get(bench);
        if (benchLabel === undefined) {
            throw new Error('fixture rotation has no name for the bench player');
        }
        const benchSection = container.querySelector('section[aria-labelledby="bench-heading"]');
        if (benchSection === null)
            throw new Error('bench section missing');
        const benchList = within(benchSection as HTMLElement);
        const toggle = benchList.getByRole('button', { name: `Add ${benchLabel} to closing five` });
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        await fireEvent.click(toggle);
        expect(onchange).toHaveBeenCalledTimes(1);
        expect(editor.rotation.closingFive).toHaveLength(5);
        expect(editor.rotation.closingFive.includes(bench)).toBe(true);
        const pressed = benchList.getByRole('button', {
            name: `Remove ${benchLabel} from closing five`,
        });
        expect(pressed.getAttribute('aria-pressed')).toBe('true');
        await fireEvent.click(pressed);
        expect(editor.rotation.closingFive).toHaveLength(5);
        expect(editor.rotation.closingFive.includes(bench)).toBe(false);
        expect(editor.validate()).toEqual([]);
    });
    it('bench move buttons reorder the substitution hierarchy', async () => {
        const { editor, onchange, container } = renderEditor();
        const first = editor.rotation.benchOrder[0];
        const second = editor.rotation.benchOrder[1];
        if (first === undefined || second === undefined) {
            throw new Error('fixture rotation has no bench order');
        }
        const firstLabel = editor.names.get(first);
        const secondLabel = editor.names.get(second);
        if (firstLabel === undefined || secondLabel === undefined) {
            throw new Error('fixture rotation has no bench names');
        }
        const benchSection = container.querySelector('section[aria-labelledby="bench-heading"]');
        if (benchSection === null)
            throw new Error('bench section missing');
        const benchList = within(benchSection as HTMLElement);
        await fireEvent.click(benchList.getByRole('button', { name: `Move ${secondLabel} up in bench order` }));
        expect(onchange).toHaveBeenCalledTimes(1);
        expect(editor.rotation.benchOrder[0]).toBe(second);
        expect(editor.rotation.benchOrder[1]).toBe(first);
        const upForFirst = benchList.getByRole('button', {
            name: `Move ${secondLabel} up in bench order`,
        });
        expect((upForFirst as HTMLButtonElement).disabled).toBe(true);
        const upForLast = benchList.getByRole('button', {
            name: `Move ${firstLabel} up in bench order`,
        });
        expect((upForLast as HTMLButtonElement).disabled).toBe(false);
    });
    it('an illegal starter swap is rejected by the engine and surfaced', async () => {
        const { editor, onchange, container } = renderEditor();
        const centerOnly = CANDIDATES.find((candidate) => candidate.positions.playable.length === 1 && candidate.positions.playable[0] === 'C');
        if (centerOnly === undefined) {
            throw new Error('fixture catalog has no center-only candidate');
        }
        const select = container.querySelector('select[aria-label="Starter slot 1"]') as HTMLSelectElement;
        await fireEvent.change(select, { target: { value: centerOnly.playerVersionId } });
        expect(editor.rotation.starters[0]).not.toBe(centerOnly.playerVersionId);
        expect(onchange).not.toHaveBeenCalled();
        const alert = container.querySelector('[role="alert"]');
        expect(alert?.textContent ?? '').toMatch(/rejected/);
    });
    it('surfaces per-player audit failures beside the affected row', () => {
        const editor = createRotationEditor(legalRotation(), members());
        const bench = editor.rotation.benchOrder.find((id) => {
            const candidate = CANDIDATES.find((c) => c.playerVersionId === id);
            if (candidate === undefined) {
                throw new Error(`fixture catalog misses candidate ${id}`);
            }
            return (!candidate.positions.playable.includes('PG') && !candidate.positions.playable.includes('SG'));
        });
        if (bench === undefined) {
            throw new Error('fixture rotation has no non-guard bench player');
        }
        const guard = editor.rotation.starters[0];
        if (guard === undefined) {
            throw new Error('fixture rotation has no first starter');
        }
        const brokenRotation: SeasonRotation = {
            ...editor.rotation,
            starters: [bench, ...editor.rotation.starters.slice(1)],
            benchOrder: [...editor.rotation.benchOrder.filter((id) => id !== bench), guard],
        };
        const broken = createRotationEditor(brokenRotation, members());
        expect(broken.validate().length).toBeGreaterThan(0);
        const { container } = render(RotationEditor, {
            props: { editor: broken, disabled: false, onchange: vi.fn() },
        });
        const list = minutesList(container);
        const row = list.getByText(/cannot play slot/).closest('li');
        expect(row).not.toBeNull();
        expect(row?.textContent ?? '').toMatch(/cannot play slot/);
        const select = container.querySelector('select[aria-label="Starter slot 1"]');
        expect(select?.getAttribute('aria-invalid')).toBe('true');
    });
    it('surfaces the invalid-rotation alert when the audit fails', () => {
        const editor = createRotationEditor(legalRotation(), members());
        const first = editor.rotation.starters[0];
        if (first === undefined) {
            throw new Error('fixture rotation has no first starter');
        }
        editor.setMinutes(first, 48);
        const { getByText } = render(RotationEditor, {
            props: { editor, disabled: false, onchange: vi.fn() },
        });
        expect(getByText('This rotation cannot be submitted:')).not.toBeNull();
    });
    it('disables every control while a block is running', () => {
        const { getByRole, getAllByRole } = render(RotationEditor, {
            props: {
                editor: createRotationEditor(legalRotation(), members()),
                disabled: true,
                onchange: vi.fn(),
            },
        });
        const preset = getByRole('button', { name: 'Balanced' }) as HTMLButtonElement;
        expect(preset.disabled).toBe(true);
        for (const button of getAllByRole('button', { name: /Increase minutes/ })) {
            expect((button as HTMLButtonElement).disabled).toBe(true);
        }
        for (const select of getAllByRole('combobox')) {
            expect((select as HTMLSelectElement).disabled).toBe(true);
        }
        for (const button of getAllByRole('button', { name: /closing five/i })) {
            expect((button as HTMLButtonElement).disabled).toBe(true);
        }
    });
    it('strategy buttons apply their projection plan automatically', async () => {
        const result = fixturePlanResult();
        const released: Array<(value: MinutePlanOptimizationResult) => void> = [];
        const run = vi.fn(() => new Promise<MinutePlanOptimizationResult>((resolve) => {
            released.push(resolve);
        }));
        const onchange = vi.fn();
        const editor = createRotationEditor(legalRotation(), members());
        const { getByRole } = render(RotationEditor, {
            props: {
                editor,
                disabled: false,
                onchange,
                optimize: { run, busy: false, error: null },
            },
        });
        await fireEvent.click(getByRole('button', { name: 'Balanced' }));
        expect(run).toHaveBeenCalledTimes(1);
        const busyButton = getByRole('button', { name: 'Optimizing…' }) as HTMLButtonElement;
        expect(busyButton.disabled).toBe(true);
        released[0]?.(result);
        await waitFor(() => {
            expect(onchange).toHaveBeenCalledTimes(1);
        });
        const [rotation] = onchange.mock.calls[0] as [
            SeasonRotation,
            string[]
        ];
        expect(rotation.minutePolicy.strategy).toBe('balanced');
        expect(editor.rotation.minutePolicy.strategy).toBe('balanced');
        expect(editor.validate()).toEqual([]);
    });
    it('applies the starter-heavy plan when Starter-Heavy is clicked', async () => {
        const result = fixturePlanResult();
        const run = vi.fn(() => Promise.resolve(result));
        const onchange = vi.fn();
        const editor = createRotationEditor(legalRotation(), members());
        const { getByRole } = render(RotationEditor, {
            props: {
                editor,
                disabled: false,
                onchange,
                optimize: { run, busy: false, error: null },
            },
        });
        await fireEvent.click(getByRole('button', { name: 'Starter-Heavy' }));
        await waitFor(() => {
            expect(onchange).toHaveBeenCalledTimes(1);
        });
        const [rotation] = onchange.mock.calls[0] as [
            SeasonRotation,
            string[]
        ];
        expect(rotation.minutePolicy.strategy).toBe('starter-heavy');
    });
    it('falls back to the fixed preset when the optimization fails', async () => {
        const run = vi.fn(() => Promise.reject(new Error('boom')));
        const onchange = vi.fn();
        const editor = createRotationEditor(legalRotation(), members());
        const { getByRole } = render(RotationEditor, {
            props: {
                editor,
                disabled: false,
                onchange,
                optimize: { run, busy: false, error: null },
            },
        });
        await fireEvent.click(getByRole('button', { name: 'Balanced' }));
        await waitFor(() => {
            expect(onchange).toHaveBeenCalledTimes(1);
        });
        const [rotation] = onchange.mock.calls[0] as [
            SeasonRotation,
            string[]
        ];
        const minutes = new Map(rotation.targetMinutes.map((row) => [row.playerVersionId, row.minutes]));
        const starters = rotation.starters.map((id) => minutes.get(id));
        expect(starters).toEqual([33, 33, 33, 33, 33]);
        expect(editor.validate()).toEqual([]);
        expect(editor.rotation.minutePolicy.strategy).toBe('balanced');
    });
    it('falls back to the fixed preset when the plan for the strategy is missing', async () => {
        const result = fixturePlanResult();
        const run = vi.fn(() => Promise.resolve(result));
        const onchange = vi.fn();
        const editor = createRotationEditor(legalRotation(), members());
        const { getByRole } = render(RotationEditor, {
            props: {
                editor,
                disabled: false,
                onchange,
                optimize: { run, busy: false, error: null },
            },
        });
        run.mockImplementation(() => Promise.resolve({
            ...result,
            plans: result.plans.filter((plan) => plan.strategy !== 'bench-heavy'),
        }));
        await fireEvent.click(getByRole('button', { name: 'Bench-Heavy' }));
        await waitFor(() => {
            expect(onchange).toHaveBeenCalledTimes(1);
        });
        const [rotation] = onchange.mock.calls[0] as [
            SeasonRotation,
            string[]
        ];
        const minutes = new Map(rotation.targetMinutes.map((row) => [row.playerVersionId, row.minutes]));
        const starters = rotation.starters.map((id) => minutes.get(id));
        expect(starters).toEqual([29, 29, 29, 29, 29]);
        expect(editor.rotation.minutePolicy.strategy).toBe('bench-heavy');
    });
    it('shows the projection error and applies the preset fallback when the hook reports it', async () => {
        const run = vi.fn(() => Promise.reject(new Error('boom')));
        const editor = createRotationEditor(legalRotation(), members());
        const props = {
            editor,
            disabled: false,
            onchange: vi.fn(),
            optimize: { run, busy: false, error: null },
        };
        const { getByRole, rerender } = render(RotationEditor, { props });
        await fireEvent.click(getByRole('button', { name: 'Balanced' }));
        await waitFor(() => {
            expect(getByRole('button', { name: 'Balanced' })).not.toBeNull();
        });
        await rerender({ ...props, optimize: { run, busy: false, error: 'boom' } });
        const alert = getByRole('alert');
        expect(alert.textContent).toMatch(/Projection unavailable — applied the preset minutes: boom/);
        expect(editor.validate()).toEqual([]);
    });
    it('disables the strategy buttons while the whole editor is disabled', () => {
        const { getByRole } = render(RotationEditor, {
            props: {
                editor: createRotationEditor(legalRotation(), members()),
                disabled: true,
                onchange: vi.fn(),
                optimize: { run: vi.fn(), busy: false, error: null },
            },
        });
        for (const name of ['Starter-Heavy', 'Balanced', 'Bench-Heavy']) {
            expect((getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
        }
    });
});
