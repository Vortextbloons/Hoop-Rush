import type {
  HavocAuditFinding,
  HavocGameAudit,
  HavocGameInput,
  HavocGameResult,
  HavocGameTape,
} from '@hoop-rush/data-contracts';
import { havocGameResultSchema } from '@hoop-rush/data-contracts';
import { havocGameInputDigest } from '../digests.ts';
import {
  soloToBattleInput,
  soloToBattleResult,
  soloToBattleTape,
} from '../core/battle-adapters.ts';
import { auditHavocBattleGame } from '../core/battle-audit.ts';
import { havocBattleGameInputDigest } from '../core/battle-digests.ts';

/**
 * Solo facade over the neutral battle audit. It pins the solo-only identity
 * checks (human side and solo input digest) first, then delegates every
 * side-relative check to the battle audit with home/away labels.
 */
export function auditHavocGame(
  input: HavocGameInput,
  result: HavocGameResult,
  tape?: HavocGameTape,
): HavocGameAudit {
  const findings: HavocAuditFinding[] = [];
  const fail = (code: string, message: string): void => {
    if (findings.length < 200) findings.push({ code, message: message.slice(0, 512) });
  };

  const parsed = havocGameResultSchema.safeParse(result);
  if (!parsed.success) {
    fail(
      'result-schema',
      `result does not satisfy havocGameResultSchema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
    return { ok: false, findings };
  }
  if (result.humanSide !== input.humanSide) {
    fail('input-identity', 'result human side differs from input');
  }
  if (result.inputDigest !== havocGameInputDigest(input)) {
    fail('input-digest', 'result input digest does not match the supplied input');
  }

  const battleInput = soloToBattleInput(input);
  const battleResult = soloToBattleResult(
    result,
    input.humanSide,
    havocBattleGameInputDigest(battleInput),
  );
  const battleTape = tape === undefined ? undefined : soloToBattleTape(tape, input.humanSide);
  findings.push(...auditHavocBattleGame(battleInput, battleResult, battleTape).findings);
  return { ok: findings.length === 0, findings };
}
