import { describe, expect, it } from 'vitest';
import type {
  AdaptHavocCatalog as AdaptHavocCatalogSignature,
  ApplyHavocCommand as ApplyHavocCommandSignature,
  CreateHavocRunState as CreateHavocRunStateSignature,
  FoldHavocAggregate as FoldHavocAggregateSignature,
  GenerateHavocOffer as GenerateHavocOfferSignature,
  HavocStateDigest as HavocStateDigestSignature,
} from './api.ts';
import { FoldHavocAggregate } from './aggregate.ts';
import { AdaptHavocCatalog } from './catalog.ts';
import { CreateHavocRunState } from './draft-commands.ts';
import { GenerateHavocOffer } from './offers.ts';
import { ApplyHavocCommand } from './run-commands.ts';
import { HavocStateDigest } from './state-digest.ts';

const frozenImplementations: {
  readonly adapt: AdaptHavocCatalogSignature;
  readonly offer: GenerateHavocOfferSignature;
  readonly create: CreateHavocRunStateSignature;
  readonly apply: ApplyHavocCommandSignature;
  readonly fold: FoldHavocAggregateSignature;
  readonly digest: HavocStateDigestSignature;
} = {
  adapt: AdaptHavocCatalog,
  offer: GenerateHavocOffer,
  create: CreateHavocRunState,
  apply: ApplyHavocCommand,
  fold: FoldHavocAggregate,
  digest: HavocStateDigest,
};

describe('havoc engine api conformance', () => {
  it('implements every frozen api.ts entry point with a matching signature', () => {
    for (const implementation of Object.values(frozenImplementations)) {
      expect(typeof implementation).toBe('function');
    }
  });
});
