import {
  type CollectionLedgerEntry,
  type CollectionPullRecord,
  type CollectionState,
} from '@hoop-rush/data-contracts';
import { collectionStateFactsOf, collectionStateDigest } from './cards.ts';

export interface CollectionAuditFailure {
  code: string;
  message: string;
}

export function auditCollectionState(
  state: CollectionState,
  pulls: readonly CollectionPullRecord[],
  ledger: readonly CollectionLedgerEntry[],
): CollectionAuditFailure[] {
  const failures: CollectionAuditFailure[] = [];
  const facts = collectionStateFactsOf(state);
  const recomputed = collectionStateDigest(facts);
  if (recomputed !== state.digest) {
    failures.push({
      code: 'digest-mismatch',
      message: `digest ${state.digest} != recomputed ${recomputed}`,
    });
  }
  const orderedPulls = [...pulls].sort((a, b) => a.pullSequence - b.pullSequence);
  for (let i = 0; i < orderedPulls.length; i += 1) {
    if (orderedPulls[i]?.pullSequence !== i) {
      failures.push({
        code: 'pull-sequence-gap',
        message: `pull at index ${String(i)} has sequence ${String(orderedPulls[i]?.pullSequence)}`,
      });
      break;
    }
  }
  if (state.nextPullSequence !== orderedPulls.length) {
    failures.push({
      code: 'pull-sequence-mismatch',
      message: `nextPullSequence ${String(state.nextPullSequence)} != pulls ${String(orderedPulls.length)}`,
    });
  }
  if (state.revision !== orderedPulls.length) {
    failures.push({
      code: 'revision-mismatch',
      message: `revision ${String(state.revision)} != pulls ${String(orderedPulls.length)}`,
    });
  }
  const folded: Record<'Coins' | 'Exchange', number> = { Coins: 0, Exchange: 0 };
  for (const entry of ledger) {
    folded[entry.currency] += entry.amount;
    if (!Number.isSafeInteger(folded[entry.currency])) {
      failures.push({ code: 'ledger-overflow', message: `overflow on ${entry.currency}` });
      break;
    }
  }
  if (folded.Coins !== state.balances.Coins || folded.Exchange !== state.balances.Exchange) {
    failures.push({
      code: 'balance-mismatch',
      message: `folded ${String(folded.Coins)}/${String(folded.Exchange)} != state ${String(state.balances.Coins)}/${String(state.balances.Exchange)}`,
    });
  }
  const firstAcquisition = new Map<string, { pull: number; slot: number }>();
  for (const pull of orderedPulls) {
    const orderedSlots = [...pull.slots].sort((a, b) => a.slotIndex - b.slotIndex);
    for (const slot of orderedSlots) {
      if (slot.kept && !firstAcquisition.has(slot.cardId)) {
        firstAcquisition.set(slot.cardId, { pull: pull.pullSequence, slot: slot.slotIndex });
      }
      if (!slot.kept && !firstAcquisition.has(slot.cardId)) {
        const earlierInPull = pull.slots.filter(
          (s) => s.cardId === slot.cardId && s.slotIndex < slot.slotIndex && s.kept,
        ).length;
        if (earlierInPull === 0) {
          failures.push({
            code: 'converted-before-owned',
            message: `pull ${String(pull.pullSequence)} slot ${String(slot.slotIndex)} converts unowned ${slot.cardId}`,
          });
        }
      }
      if (slot.kept && firstAcquisition.get(slot.cardId)?.pull !== pull.pullSequence) {
        failures.push({
          code: 'duplicate-kept',
          message: `pull ${String(pull.pullSequence)} keeps already-owned ${slot.cardId}`,
        });
      }
    }
  }
  const ownedIds = new Set(state.owned.map((entry) => entry.cardId));
  if (ownedIds.size !== state.owned.length) {
    failures.push({ code: 'duplicate-ownership', message: 'owned has duplicate cardIds' });
  }
  for (const [cardId] of firstAcquisition) {
    if (!ownedIds.has(cardId)) {
      failures.push({ code: 'missing-ownership', message: `kept ${cardId} not in owned` });
    }
  }
  for (const entry of state.owned) {
    const first = firstAcquisition.get(entry.cardId);
    if (first === undefined) {
      failures.push({ code: 'orphan-ownership', message: `owned ${entry.cardId} never kept` });
    } else if (
      first.pull !== entry.acquiredPullSequence ||
      first.slot !== entry.acquiredSlotIndex
    ) {
      failures.push({
        code: 'acquisition-mismatch',
        message: `owned ${entry.cardId} acquisition != first keep`,
      });
    }
  }
  return failures;
}
