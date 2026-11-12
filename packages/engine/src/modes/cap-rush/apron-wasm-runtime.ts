import type { CapRushApronRules } from '@hoop-rush/data-contracts';
import type { SideIndex } from '../../sim/recorder.ts';
import { battleKernel, type BattleKernel } from '../havoc/core/battle-wasm.ts';

export const APRON_FACT_STRIKE = 1;
export const APRON_FACT_PASS_INTERCEPTION = 2;

export type ApronPayrollCode = 1 | 2;

export function apronPayrollCode(rules: CapRushApronRules): ApronPayrollCode {
  return rules.payrollStatus === 'second-apron' ? 2 : 1;
}

export function createApronState(
  side: SideIndex,
  rules: CapRushApronRules,
): {
  readonly kernel: BattleKernel;
  readonly handle: number;
} {
  const kernel = battleKernel();
  const handle = kernel.apron_create(side, apronPayrollCode(rules));
  if (handle === 0) throw new Error('cap rush apron: failed to initialize Rust kernel');
  return { kernel, handle };
}

const states = new FinalizationRegistry<{ kernel: BattleKernel; handle: number }>((state) => {
  state.kernel.apron_destroy(state.handle);
});
export function trackApronState(
  owner: object,
  state: { kernel: BattleKernel; handle: number },
): void {
  states.register(owner, state, owner);
}
export function untrackApronState(owner: object): void {
  states.unregister(owner);
}
