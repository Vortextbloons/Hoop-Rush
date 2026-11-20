/**
 * Payroll penalty exposure for one player profile.
 *
 * The panel only renders apron content for a tier that would actually land, so
 * `none` is a real state rather than an empty section: no tab, no strip, and no
 * badge appear when there is nothing to pay.
 */
export type PlayerApronStatus =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'projected';
      readonly tier: 'first' | 'second';
      readonly payrollDollars: number;
    }
  | {
      readonly kind: 'applied';
      readonly tier: 'first' | 'second';
      readonly payrollDollars: number;
    };

export interface PlayerApronReduction {
  readonly label: string;
  readonly original: number;
  readonly effective: number;
}

export interface PlayerApronView {
  readonly status: PlayerApronStatus;
  /** Empty unless the status is projected or applied. */
  readonly reductions: readonly PlayerApronReduction[];
  /** Rule names that fire with the tier, e.g. "Locker Room Meltdown". */
  readonly rules: readonly string[];
  /** Long-form description of the interception/proc penalties, if any. */
  readonly ruleDetail: string | null;
}

export function apronTierLabel(tier: 'first' | 'second'): string {
  return tier === 'first' ? 'First apron' : 'Second apron';
}

export function apronTierShortLabel(tier: 'first' | 'second'): string {
  return tier === 'first' ? '1st apron' : '2nd apron';
}

/** The two largest reductions, for the one-line strip on a draft card. */
export function apronHeadlineReductions(
  reductions: readonly PlayerApronReduction[],
  limit = 2,
): readonly PlayerApronReduction[] {
  return [...reductions]
    .sort((left, right) => {
      const leftDrop = left.original - left.effective;
      const rightDrop = right.original - right.effective;
      return rightDrop - leftDrop;
    })
    .slice(0, limit);
}
