export type M25GateStatus = 'pass' | 'fail' | 'skippedInsufficientSample';
export interface M25Gate {
    key: string;
    observed: number;
    target: number;
    tolerance: number | null;
    min: number | null;
    max: number | null;
    status: M25GateStatus;
    pass: boolean;
    sample: number;
    minimumSample: number;
}
export function m25ToleranceGate(key: string, observed: number, target: number, tolerance: number, sample: number, minimumSample: number): M25Gate {
    const status: M25GateStatus = sample < minimumSample
        ? 'skippedInsufficientSample'
        : Math.abs(observed - target) <= tolerance
            ? 'pass'
            : 'fail';
    return {
        key,
        observed,
        target,
        tolerance,
        min: null,
        max: null,
        status,
        pass: status === 'pass',
        sample,
        minimumSample,
    };
}
export function m25RangeGate(key: string, observed: number, min: number, max: number, sample: number, minimumSample: number): M25Gate {
    const status: M25GateStatus = sample < minimumSample
        ? 'skippedInsufficientSample'
        : observed >= min && observed <= max
            ? 'pass'
            : 'fail';
    return {
        key,
        observed,
        target: (min + max) / 2,
        tolerance: null,
        min,
        max,
        status,
        pass: status === 'pass',
        sample,
        minimumSample,
    };
}
export function m25LiftGate(key: string, high: number, low: number, sample: number, minimumSample: number): M25Gate {
    const status: M25GateStatus = sample < minimumSample ? 'skippedInsufficientSample' : high > low ? 'pass' : 'fail';
    return {
        key,
        observed: high - low,
        target: 0,
        tolerance: null,
        min: null,
        max: null,
        status,
        pass: status === 'pass',
        sample,
        minimumSample,
    };
}
export function m25GapGate(key: string, gap: number, minimumGap: number, sample: number, minimumSample: number): M25Gate {
    const status: M25GateStatus = sample < minimumSample ? 'skippedInsufficientSample' : gap >= minimumGap ? 'pass' : 'fail';
    return {
        key,
        observed: gap,
        target: minimumGap,
        tolerance: null,
        min: minimumGap,
        max: null,
        status,
        pass: status === 'pass',
        sample,
        minimumSample,
    };
}
export { mean } from '../stats.ts';
export function share(count: number, total: number): number {
    return total <= 0 ? 0 : count / total;
}
export function rateBasisPoints(count: number, total: number): number {
    return total <= 0 ? 0 : (count / total) * 10000;
}
export function seasonCalibrationSeed(index: number): string {
    if (!Number.isInteger(index) || index < 0) {
        throw new Error(`calibration seed index must be a nonnegative integer (got ${String(index)})`);
    }
    return index.toString(16).padStart(32, '0');
}
export function seedIndexRange(from: number, to: number): number[] {
    const indices: number[] = [];
    for (let i = from; i <= to; i += 1)
        indices.push(i);
    return indices;
}
export function gateValue(metrics: readonly M25Gate[], key: string): boolean {
    return metrics.find((metric) => metric.key === key)?.pass ?? false;
}
export function gateSummary(metrics: readonly M25Gate[]): {
    gates: Record<string, boolean>;
    skippedGates: string[];
    pass: boolean;
} {
    const gates: Record<string, boolean> = {};
    const skippedGates: string[] = [];
    for (const metric of metrics) {
        gates[metric.key] = metric.pass;
        if (metric.status === 'skippedInsufficientSample')
            skippedGates.push(metric.key);
    }
    return { gates, skippedGates, pass: metrics.every((metric) => metric.pass) };
}
