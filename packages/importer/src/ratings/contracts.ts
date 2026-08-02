/**
 * Contract derivation (port of compute_ratings.py derive_contract).
 */
import { safeInt } from '../json.js';
import type { Rng } from '../rng.js';

export const SALARY_TIERS: ReadonlyArray<readonly [number, number]> = [
  [95, 65_000_000],
  [90, 55_000_000],
  [85, 45_000_000],
  [80, 35_000_000],
  [75, 26_000_000],
  [70, 18_000_000],
  [65, 12_000_000],
  [60, 7_000_000],
  [55, 3_000_000],
  [50, 1_500_000],
];

export interface Contract {
  salaryByYear: number[];
  yearsRemaining: number;
  option: 'player' | 'none';
  optionYear: number | null;
  noTradeClause: boolean;
  signingBonusByYear: number[];
  likelyBonusesByYear: number[];
  unlikelyBonusesByYear: number[];
  guaranteed: boolean;
  guaranteedByYear: boolean[];
  tradeKickers: unknown[];
  poisonPill: boolean;
  birdRights: boolean;
  earlyBird: boolean;
  baseYearCompensation: boolean;
  deferredMoney: unknown[];
}

/** Estimate contract from overall rating and age. Matches the TS Contract interface. */
export function deriveContract(overall: number, age: number, rng: Rng): Contract {
  void rng;
  let baseSalary = 1_500_000;
  for (const [minOvr, salary] of SALARY_TIERS) {
    if (overall >= minOvr) {
      baseSalary = salary;
      break;
    }
  }

  const yearsInLeague = Math.max(0, safeInt(age) - 19);
  let years: number;
  if (yearsInLeague <= 3) years = 1;
  else if (yearsInLeague <= 6) years = 2;
  else years = 4;

  const salaryByYear: number[] = [];
  for (let i = 0; i < years; i += 1) {
    salaryByYear.push(Math.trunc(baseSalary * 1.08 ** i));
  }

  const signingBonus = Math.trunc(baseSalary * 0.05);
  const signingBonusByYear: number[] = Array.from({ length: years }, () =>
    Math.trunc(signingBonus / years),
  );
  if (years > 1) {
    signingBonusByYear[years - 1] = signingBonus - sum(signingBonusByYear.slice(0, -1));
  } else {
    signingBonusByYear[0] = signingBonus;
  }

  // Option type
  let option: 'player' | 'none';
  let optionYear: number | null;
  if (years >= 4) {
    option = 'player';
    optionYear = years - 1;
  } else {
    option = 'none';
    optionYear = null;
  }

  // Guaranteed: all years except last for 4+ year deals
  const guaranteed = years <= 3;
  const guaranteedByYear = new Array<boolean>(years).fill(true);
  if (years > 3) {
    guaranteedByYear[years - 1] = false;
  }

  return {
    salaryByYear,
    yearsRemaining: years,
    option,
    optionYear,
    noTradeClause: false,
    signingBonusByYear,
    likelyBonusesByYear: Array.from({ length: years }, () => 0),
    unlikelyBonusesByYear: Array.from({ length: years }, () => 0),
    guaranteed,
    guaranteedByYear,
    tradeKickers: [],
    poisonPill: false,
    birdRights: yearsInLeague >= 7,
    earlyBird: yearsInLeague >= 4,
    baseYearCompensation: false,
    deferredMoney: [],
  };
}

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}
