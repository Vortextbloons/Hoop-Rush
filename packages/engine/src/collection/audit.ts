import {
  type CollectionGameRecordUnion,
  type CollectionLedgerEntry,
  type CollectionPlayState,
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
  gameRecords: readonly CollectionGameRecordUnion[] = [],
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
  if (state.revision !== orderedPulls.length + gameRecords.length) {
    failures.push({
      code: 'revision-mismatch',
      message: `revision ${String(state.revision)} != pulls ${String(orderedPulls.length)} + games ${String(gameRecords.length)}`,
    });
  }
  const ledgerByTransaction = new Map(ledger.map((entry) => [entry.transactionId, entry]));
  const matchedGameTransactions = new Set<string>();
  for (const record of gameRecords) {
    const components =
      record.gameVersion === 'collection-game-v1'
        ? [{ ...record.reward, kind: 'outcome' as const }]
        : record.reward.components;
    for (const component of components) {
      const entry = ledgerByTransaction.get(component.transactionId);
      if (entry === undefined) {
        failures.push({
          code: 'missing-game-reward',
          message: `game ${record.gameId} reward ${component.transactionId} missing from the ledger`,
        });
        continue;
      }
      matchedGameTransactions.add(component.transactionId);
      if (entry.pullSequence !== null) {
        failures.push({
          code: 'game-reward-pull-sequence',
          message: `game ${record.gameId} reward must not consume a pull sequence`,
        });
      }
      if (entry.amount !== component.amount || entry.reason !== component.reason) {
        failures.push({
          code: 'game-reward-mismatch',
          message: `game ${record.gameId} ledger entry does not match the recorded reward component`,
        });
      }
    }
  }
  for (const entry of ledger) {
    if (!entry.reason.startsWith('game-')) continue;
    if (!matchedGameTransactions.has(entry.transactionId)) {
      failures.push({
        code: 'orphan-game-reward',
        message: `ledger game reward ${entry.transactionId} does not match an accepted record`,
      });
    }
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

export function auditCollectionFirstClearState(
  playState: Pick<CollectionPlayState, 'clearedDifficultyIds'>,
  gameRecords: readonly CollectionGameRecordUnion[],
  ledger: readonly CollectionLedgerEntry[],
): CollectionAuditFailure[] {
  const failures: CollectionAuditFailure[] = [];
  const granted = new Map<string, string>();
  let grantedCount = 0;
  for (const record of gameRecords) {
    if (record.gameVersion === 'collection-game-v1') continue;
    if (!record.reward.firstClearGranted) continue;
    grantedCount += 1;
    const difficultyId = record.prepared.difficulty.difficultyId;
    if (granted.has(difficultyId)) {
      failures.push({
        code: 'first-clear-duplicate',
        message: `difficulty ${difficultyId} was cleared more than once`,
      });
      continue;
    }
    if (!record.reward.playerWin || record.result.outcome !== 'completed') {
      failures.push({
        code: 'first-clear-not-a-win',
        message: `game ${record.gameId} granted a first clear without a completed win`,
      });
    }
    if (!record.prepared.firstClearEligible) {
      failures.push({
        code: 'first-clear-ineligible',
        message: `game ${record.gameId} granted a first clear without prior eligibility`,
      });
    }
    granted.set(difficultyId, record.gameId);
  }
  const ledgerFirstClears = ledger.filter((entry) => entry.reason === 'game-first-clear-reward');
  if (ledgerFirstClears.length !== grantedCount) {
    failures.push({
      code: 'first-clear-ledger-mismatch',
      message: `${String(ledgerFirstClears.length)} first-clear ledger entries for ${String(grantedCount)} granted clears`,
    });
  }
  const declared = new Set<string>(playState.clearedDifficultyIds);
  for (const [difficultyId, gameId] of granted) {
    if (!declared.has(difficultyId)) {
      failures.push({
        code: 'first-clear-missing-from-state',
        message: `game ${gameId} cleared ${difficultyId} but play state does not record it`,
      });
    }
  }
  for (const difficultyId of declared) {
    if (!granted.has(difficultyId)) {
      failures.push({
        code: 'first-clear-without-record',
        message: `play state declares ${difficultyId} cleared with no accepted v2 record`,
      });
    }
  }
  return failures;
}
