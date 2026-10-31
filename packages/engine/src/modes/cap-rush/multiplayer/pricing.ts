import {
  CAP_RUSH_MULTIPLAYER_DISCOUNT_AT_LEAST_90,
  CAP_RUSH_MULTIPLAYER_DISCOUNT_BELOW_90,
} from '@hoop-rush/data-contracts';
import { capRushSalaryDollars } from '../salary.ts';

/**
 * Multiplayer minimum bid: the solo era-adjusted salary discounted after the fact.
 * The 90-overall cliff is intentional product behavior.
 */
export function capRushMultiplayerMinimumBidDollars(
  originalOverall: number,
  seasonKey: string,
): number {
  const solo = capRushSalaryDollars(originalOverall, seasonKey);
  const percent =
    originalOverall >= 90
      ? CAP_RUSH_MULTIPLAYER_DISCOUNT_AT_LEAST_90
      : CAP_RUSH_MULTIPLAYER_DISCOUNT_BELOW_90;
  return Math.floor((solo * percent + 50) / 100);
}
