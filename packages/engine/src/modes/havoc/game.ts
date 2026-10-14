/**
 * Compatibility facade. The simulator itself lives in `core/battle-game.ts`
 * (neutral home/away contracts); `solo/simulate.ts` adapts the solo contracts.
 */
export * from './core/battle-game.ts';
export * from './solo/simulate.ts';
