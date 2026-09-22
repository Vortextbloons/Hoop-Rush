import { z } from 'zod';
import { COLLECTION_RARITY_ORDER } from './collection-versions.ts';

export const collectionCardIdSchema = z.string().regex(/^card-[0-9a-f]{32}$/);
export type CollectionCardId = z.infer<typeof collectionCardIdSchema>;

export const collectionRaritySchema = z.enum(COLLECTION_RARITY_ORDER);
export type CollectionRarity = z.infer<typeof collectionRaritySchema>;

export const collectionFamilySchema = z.enum(['Base', 'Sharpshooter', 'Lockdown', 'Floor General']);
export type CollectionFamily = z.infer<typeof collectionFamilySchema>;

export const collectionCurrencySchema = z.enum(['Coins', 'Exchange']);
export type CollectionCurrency = z.infer<typeof collectionCurrencySchema>;

export const collectionPackIdSchema = z.enum([
  'tip-off',
  'fast-break',
  'full-court',
  'main-event',
  'spotlight',
]);
export type CollectionPackId = z.infer<typeof collectionPackIdSchema>;

export const collectionSetIdSchema = z.enum([
  'sharpshooter-set',
  'lockdown-set',
  'floor-general-set',
]);
export type CollectionSetId = z.infer<typeof collectionSetIdSchema>;
