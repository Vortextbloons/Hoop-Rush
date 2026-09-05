import {
  resolveHomeGameRule,
  type SeasonEvolutionState,
  type SeasonFrontOfficeId,
  type SeasonGameRule,
} from '@hoop-rush/data-contracts';
import { baseInquiryAllowanceOf, purchasedInquiryCostOf, rehabPriceOf } from '@hoop-rush/engine';

export function homeRuleOf(
  run: { evolution?: SeasonEvolutionState | null },
  homeFranchiseId: string,
): SeasonGameRule {
  return resolveHomeGameRule(run.evolution ?? null, homeFranchiseId);
}

export function frontOfficeOf(run: {
  evolution?: SeasonEvolutionState | null;
}): SeasonFrontOfficeId | null {
  const selection = run.evolution?.frontOffice;
  return selection?.executiveId ?? null;
}

export function inquiryAllowanceView(run: { evolution?: SeasonEvolutionState | null }): {
  base: number;
  cap: number;
  purchaseCost: number;
  explanation: string;
} {
  const executiveId = frontOfficeOf(run);
  return {
    base: baseInquiryAllowanceOf(executiveId),
    cap: 5,
    purchaseCost: purchasedInquiryCostOf(executiveId),
    explanation:
      executiveId === 'morgan-vale'
        ? 'Base allowance 4 per window (Deal Maker ability, cap 5); purchased inquiries cost 1 Influence.'
        : executiveId === 'alex-chen'
          ? 'Base allowance 3 per window (cap 5); purchased inquiries cost 2 Influence (Recovery Director drawback).'
          : 'Base allowance 3 per window (cap 5); purchased inquiries cost 1 Influence.',
  };
}

export function rehabPriceView(run: { evolution?: SeasonEvolutionState | null }): {
  price: number;
  explanation: string;
} {
  const executiveId = frontOfficeOf(run);
  const price = rehabPriceOf(executiveId);
  return {
    price,
    explanation:
      executiveId === 'alex-chen'
        ? `Risky rehabilitation costs ${String(price)} Influence (Recovery Director discount, minimum 1).`
        : executiveId === null
          ? 'Risky rehabilitation costs 2 Influence.'
          : `Risky rehabilitation costs ${String(price)} Influence (executive drawback).`,
  };
}
