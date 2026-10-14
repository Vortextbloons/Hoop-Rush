/**
 * Compatibility facade. The auditor itself lives in `core/battle-audit.ts`
 * (neutral home/away contracts); `solo/audit.ts` adapts the solo contracts.
 */
export * from './core/battle-audit.ts';
export * from './solo/audit.ts';
