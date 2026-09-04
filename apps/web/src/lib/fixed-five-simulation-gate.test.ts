import { describe, expect, it } from 'vitest';
import { FixedFiveSimulationGate } from '$lib/fixed-five-simulation-gate';

describe('FixedFiveSimulationGate', () => {
  it('allows one initial simulation and one mismatch rerun, then stops', () => {
    const gate = new FixedFiveSimulationGate();

    expect(gate.tryStart('initial')).toBe(true);
    gate.finish();
    expect(gate.tryStart('mismatch-rerun')).toBe(true);
    gate.finish();
    expect(gate.tryStart('mismatch-rerun')).toBe(false);
    expect(gate.completedAttempts()).toBe(2);
  });

  it('allows retrying a failed attempt without consuming the rerun budget', () => {
    const gate = new FixedFiveSimulationGate();

    expect(gate.tryStart('initial')).toBe(true);
    gate.fail();
    expect(gate.tryStart('initial')).toBe(true);
  });
});
