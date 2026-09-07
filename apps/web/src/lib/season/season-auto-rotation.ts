import type { SeasonRotation } from '@hoop-rush/data-contracts';
import type {
  AutoRotationScope,
  RecommendSeasonRotationResult,
} from '@hoop-rush/engine/src/season/auto-rotation.ts';
import type { ProjectionRotationRecommendInput } from './season-projection-runner';

export type AutoScopeOption = 'full-auto' | 'minutes-only' | 'keep-10';

export function autoEngineArgsOf(option: AutoScopeOption): {
  scope: AutoRotationScope;
  keepActive10: boolean;
} {
  switch (option) {
    case 'full-auto':
      return { scope: 'full', keepActive10: false };
    case 'minutes-only':
      return { scope: 'minutes-only', keepActive10: true };
    case 'keep-10':
      return { scope: 'full', keepActive10: true };
  }
}

export function autoScopeLabel(option: AutoScopeOption): string {
  switch (option) {
    case 'full-auto':
      return 'Full Auto';
    case 'minutes-only':
      return 'Minutes only';
    case 'keep-10':
      return 'Keep my active 10';
  }
}

export function buildAutoRecommendInput(input: {
  roster: readonly string[];
  unavailable: readonly string[];
  current: SeasonRotation;
  load: ProjectionRotationRecommendInput['load'];
  overall: ProjectionRotationRecommendInput['overall'];
  horizon: number;
  seed: string;
  option: AutoScopeOption;
}): ProjectionRotationRecommendInput {
  const { scope, keepActive10 } = autoEngineArgsOf(input.option);
  return {
    roster: [...input.roster],
    unavailable: [...input.unavailable],
    current: input.current,
    load: input.load.map((row) => ({ ...row })),
    overall: input.overall.map((row) => ({ ...row })),
    horizon: input.horizon,
    seed: input.seed,
    scope,
    keepActive10,
  };
}

export function hasActiveSwaps(
  result: RecommendSeasonRotationResult & { status: 'recommended' },
): boolean {
  return result.changes.some((change) => change.kind === 'swap');
}

export function swapPairsOf(
  result: RecommendSeasonRotationResult & { status: 'recommended' },
): Array<{ inPlayerVersionId: string; outPlayerVersionId: string; reason: string }> {
  const pairs: Array<{ inPlayerVersionId: string; outPlayerVersionId: string; reason: string }> =
    [];
  for (const change of result.changes) {
    if (change.kind !== 'swap') continue;
    pairs.push({
      inPlayerVersionId: change.inPlayerVersionId,
      outPlayerVersionId: change.outPlayerVersionId,
      reason: change.reason,
    });
  }
  return pairs;
}

export function cloneRotation(rotation: SeasonRotation): SeasonRotation {
  return JSON.parse(JSON.stringify(rotation)) as SeasonRotation;
}

export function autoUndoKeyOf(runId: string, blockIndex: number): string {
  return `${runId}\u0000${String(blockIndex)}`;
}

export class AutoUndoState {
  private preAuto: SeasonRotation | null = null;
  private key: string | null = null;

  capture(key: string, rotation: SeasonRotation): void {
    this.preAuto = cloneRotation(rotation);
    this.key = key;
  }

  peek(key: string): SeasonRotation | null {
    if (this.key !== key || this.preAuto === null) return null;
    return cloneRotation(this.preAuto);
  }

  take(key: string): SeasonRotation | null {
    const current = this.peek(key);
    this.invalidate();
    return current;
  }

  invalidate(): void {
    this.preAuto = null;
    this.key = null;
  }

  has(key: string): boolean {
    return this.key === key && this.preAuto !== null;
  }
}
