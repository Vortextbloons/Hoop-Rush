import { describe, expect, it } from 'vitest';
import { POSITIONS } from '@hoop-rush/data-contracts';
import { HavocDraftController } from './havoc-draft-state.svelte.ts';
import { FakeHavocService } from './havoc-fake-service.ts';

async function createController(
  service: FakeHavocService,
): Promise<{ controller: HavocDraftController }> {
  const controller = new HavocDraftController(service);
  await controller.load();
  return { controller };
}

describe('HavocDraftController', () => {
  it('loads an empty setup when no run exists', async () => {
    const service = new FakeHavocService();
    const { controller } = await createController(service);
    expect(controller.run).toBeNull();
    expect(controller.draft).toBeNull();
    expect(controller.loading).toBe(false);
  });

  it('creates a draft with three comparable cards for the first position', async () => {
    const service = new FakeHavocService();
    const { controller } = await createController(service);
    await controller.createDraft();
    expect(controller.draft).not.toBeNull();
    expect(controller.draft?.round).toBe(1);
    expect(controller.draft?.slot).toBe('PG');
    expect(controller.draft?.cards).toHaveLength(3);
    expect(new Set(controller.draft?.cards.map((card) => card.cardId)).size).toBe(3);
    expect(controller.draft?.rerollUsed).toBe(false);
  });

  it('drafts all five positions in order and locks the lineup', async () => {
    const service = new FakeHavocService();
    const { controller } = await createController(service);
    await controller.createDraft();
    for (const expectedSlot of POSITIONS) {
      const draft = controller.draft;
      expect(draft?.slot).toBe(expectedSlot);
      const card = draft?.cards[0];
      if (card === undefined) throw new Error('offer card missing');
      const accepted = await controller.pick(card.cardId);
      expect(accepted).toBe(true);
    }
    expect(controller.draft?.status).toBe('complete');
    expect(controller.draft?.picks).toHaveLength(5);
    expect(controller.draft?.picks.map((pick) => pick.slot)).toEqual([...POSITIONS]);
    const locked = await controller.lockLineup();
    expect(locked).toBe(true);
    expect(controller.run?.phase).toBe('run');
    expect(controller.run?.lineup).toHaveLength(5);
    expect(controller.draft).toBeNull();
  });

  it('allows exactly one whole-offer reroll', async () => {
    const service = new FakeHavocService();
    const { controller } = await createController(service);
    await controller.createDraft();
    const before = controller.draft?.offerId;
    expect(await controller.reroll()).toBe(true);
    expect(controller.draft?.rerollUsed).toBe(true);
    expect(controller.draft?.offerIndex).toBe(1);
    expect(controller.draft?.offerId).not.toBe(before);
    expect(await controller.reroll()).toBe(false);
    expect(service.calls.rerollOffer).toBe(1);
    expect(controller.draft?.offerIndex).toBe(1);
  });

  it('reloads the same offer from the service after a reroll', async () => {
    const service = new FakeHavocService();
    const { controller } = await createController(service);
    await controller.createDraft();
    await controller.reroll();
    const offerId = controller.draft?.offerId;
    const cardIds = controller.draft?.cards.map((card) => card.cardId);
    await controller.load();
    expect(controller.draft?.offerId).toBe(offerId);
    expect(controller.draft?.cards.map((card) => card.cardId)).toEqual(cardIds);
    expect(controller.draft?.rerollUsed).toBe(true);
  });

  it('surfaces a rejected pick without changing the draft', async () => {
    const service = new FakeHavocService();
    const { controller } = await createController(service);
    await controller.createDraft();
    const accepted = await controller.pick('hvc-00000000000000000000000000000000');
    expect(accepted).toBe(false);
    expect(controller.error).toContain('not in the current offer');
    expect(controller.draft?.picks).toHaveLength(0);
  });
});
