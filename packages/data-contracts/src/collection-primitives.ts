import { z } from 'zod';
import { COLLECTION_RARITY_ORDER } from './collection-versions.ts';

export const collectionCardIdSchema = z.string().regex(/^card-[0-9a-f]{32}$/);
export type CollectionCardId = z.infer<typeof collectionCardIdSchema>;

export const collectionRaritySchema = z.enum(COLLECTION_RARITY_ORDER);
export type CollectionRarity = z.infer<typeof collectionRaritySchema>;

export const collectionFamilySchema = z
  .string()
  .min(1)
  .max(48)
  .refine((value) => value.trim() === value);
export type CollectionFamily = z.infer<typeof collectionFamilySchema>;

export const collectionCardAvailabilitySchema = z.enum(['active']);
export type CollectionCardAvailability = z.infer<typeof collectionCardAvailabilitySchema>;
