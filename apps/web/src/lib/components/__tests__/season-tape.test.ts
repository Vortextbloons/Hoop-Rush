import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import type { SeasonAcceptedBlock, SeasonGameSummary } from '@hoop-rush/data-contracts';
import SeasonTape from '$lib/components/season/SeasonTape.svelte';
import { mockSvelteKitApp } from '../../../test/svelte-testing';

mockSvelteKitApp();

const HUMAN = 'lakers';

function acceptedBlock(blockIndex: number): SeasonAcceptedBlock {
  return {
    runId: 'run-1',
    blockIndex,
    completedRounds: (blockIndex + 1) * 10,
    revision: blockIndex,
    commandId: `blk-${String(blockIndex)}`,
    rotationDigest: 'a'.repeat(32),
    checkpointDigest: 'b'.repeat(32),
    summaryCount: 1,
    stateRevision: blockIndex + 1,
    stateDigest: 'c'.repeat(32),
  };
}

function summary(
  gameId: string,
  round: number,
  humanScore: number,
  opponentScore: number,
): SeasonGameSummary {
  return {
    gameId,
    round,
    homeFranchiseId: HUMAN,
    awayFranchiseId: 'celtics',
    status: 'final',
    homeScore: humanScore,
    awayScore: opponentScore,
    forfeitLoserFranchiseId: null,
  } as unknown as SeasonGameSummary;
}

function renderTape(overrides: {
  acceptedBlocks?: SeasonAcceptedBlock[];
  nextBlockIndex?: number | null;
  summaries?: SeasonGameSummary[];
  humanFranchiseId?: string | null;
}) {
  return render(SeasonTape, {
    props: {
      acceptedBlocks: overrides.acceptedBlocks ?? [],
      nextBlockIndex: overrides.nextBlockIndex ?? 0,
      summaries: overrides.summaries ?? [],
      humanFranchiseId: overrides.humanFranchiseId ?? HUMAN,
    },
  });
}

function segments(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('[data-season-tape-segment]'));
}

describe('SeasonTape', () => {
  it('renders nine segments for a fresh run; the first is the current decision', () => {
    const { container } = renderTape({ nextBlockIndex: 0 });
    const segs = segments(container);
    expect(segs).toHaveLength(9);
    expect(segs[0]?.getAttribute('aria-current')).toBe('step');
    for (let index = 1; index < 9; index += 1) {
      expect(segs[index]?.getAttribute('aria-current')).toBeNull();

      expect(segs[index]?.tagName).toBe('SPAN');
    }
    expect(segs[0]?.getAttribute('aria-label')).toContain('next decision');
  });

  it('marks completed segments as links with W-L from the block round range', () => {
    const { container } = renderTape({
      acceptedBlocks: [acceptedBlock(0)],
      nextBlockIndex: 1,

      summaries: [
        summary('g1', 1, 110, 90),
        summary('g2', 4, 98, 105),
        summary('g3', 9, 120, 100),

        summary('g4', 11, 99, 98),
      ],
    });
    const segs = segments(container);
    const first = segs[0];
    expect(first?.tagName).toBe('A');
    expect(first?.getAttribute('href')).toContain('/season/run/checkpoint/');
    expect(first?.getAttribute('href')).toContain('block=0');
    expect(first?.getAttribute('aria-label')).toContain('complete');
    expect(first?.textContent ?? '').toContain('2–1');
    expect(segs[1]?.getAttribute('aria-current')).toBe('step');
    expect(segs[1]?.tagName).toBe('SPAN');
  });

  it('computes W-L per block independently of other blocks', () => {
    const { container } = renderTape({
      acceptedBlocks: [acceptedBlock(0), acceptedBlock(2)],
      nextBlockIndex: 3,
      summaries: [
        summary('g1', 1, 110, 90),
        summary('g2', 4, 98, 105),
        summary('g3', 21, 120, 100),
        summary('g4', 22, 130, 110),
        summary('g5', 30, 88, 92),
      ],
    });
    const segs = segments(container);
    expect(segs[0]?.textContent ?? '').toContain('1–1');
    expect(segs[2]?.textContent ?? '').toContain('2–1');
    expect(segs[3]?.getAttribute('aria-current')).toBe('step');
    for (let index = 4; index < 9; index += 1) {
      expect(segs[index]?.tagName).toBe('SPAN');
    }
  });

  it('links every completed segment to its own checkpoint detail', () => {
    const { container } = renderTape({
      acceptedBlocks: [acceptedBlock(0), acceptedBlock(1), acceptedBlock(8)],
      nextBlockIndex: null,
    });
    const segs = segments(container);
    for (const blockIndex of [0, 1, 8]) {
      const seg = segs[blockIndex];
      expect(seg?.tagName).toBe('A');
      expect(seg?.getAttribute('href')).toContain(`block=${String(blockIndex)}`);
    }

    expect(segs.some((seg) => seg.getAttribute('aria-current') !== null)).toBe(false);
  });

  it('labels upcoming segments and keeps them muted (no current marker)', () => {
    const { container } = renderTape({ nextBlockIndex: 2 });
    const segs = segments(container);
    expect(segs[2]?.getAttribute('aria-current')).toBe('step');
    for (let index = 3; index < 9; index += 1) {
      expect(segs[index]?.getAttribute('aria-label') ?? '').toContain('upcoming');
    }
  });
});
