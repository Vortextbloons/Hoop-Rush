import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import PackageBuilder from '$lib/components/season/PackageBuilder.svelte';
import NegotiationTranscript from '$lib/components/season/NegotiationTranscript.svelte';
import TradeBoardWorkspace from '$lib/components/season/TradeBoardWorkspace.svelte';
import { mockSvelteKitApp } from '../../../test/svelte-testing';

mockSvelteKitApp();

const pv = (ch: string): string => `pv-${ch.repeat(32)}`;
const inq = (ch: string): string => `inq-${ch.repeat(32)}`;

function lite(
  id: string,
  name: string,
  available = true,
): {
  playerVersionId: string;
  displayName: string;
  playable: string[];
  available: boolean;
  rotationMinutes: number;
  projectedMinutes: number;
} {
  return {
    playerVersionId: id,
    displayName: name,
    playable: ['PG'],
    available,
    rotationMinutes: 24,
    projectedMinutes: 20,
  };
}

function checkboxAt(container: HTMLElement, index: number): HTMLInputElement {
  const list = container.querySelectorAll('input[type="checkbox"]');
  const el = list[index];
  if (!(el instanceof HTMLInputElement)) throw new Error(`missing checkbox ${String(index)}`);
  return el;
}

function textOf(container: HTMLElement): string {
  return container.textContent;
}

describe('PackageBuilder M3.11.1', () => {
  function renderBuilder(overrides: Record<string, unknown> = {}): {
    onSubmit: ReturnType<typeof vi.fn>;
    container: HTMLElement;
  } {
    const onSubmit = vi.fn();
    const result = render(PackageBuilder, {
      props: {
        yourPlayers: [
          lite(pv('a'), 'You One'),
          lite(pv('b'), 'You Two'),
          lite(pv('c'), 'You Three'),
        ],
        theirPlayers: [
          lite(pv('d'), 'Them One'),
          lite(pv('e'), 'Them Two'),
          lite(pv('f'), 'Them Three'),
        ],
        yourRosterSize: 12,
        theirRosterSize: 12,
        yourBalance: 3,
        theirBalance: 3,
        humanFranchiseId: 'lakers',
        targetFranchiseId: 'celtics',
        targetFranchiseName: 'Celtics',
        yourProtectedIds: [],
        theirProtectedIds: [],
        onSubmit,
        ...overrides,
      },
    });
    return { onSubmit, container: result.container };
  }

  it('enforces 2-asset limits (blocks 3rd pick)', async () => {
    const { container } = renderBuilder();
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes.length).toBe(6);
    await fireEvent.click(checkboxAt(container, 0));
    await fireEvent.click(checkboxAt(container, 1));
    expect(checkboxAt(container, 2).disabled).toBe(true);
    expect(textOf(container)).toContain('Max 2 per side');
  });

  it('shows Off limits for protected and disables', () => {
    const { container } = renderBuilder({ theirProtectedIds: [pv('d')] });
    expect(textOf(container)).toContain('Off limits');
    expect(checkboxAt(container, 3).disabled).toBe(true);
  });

  it('shows availability-risk reason', () => {
    const { container } = renderBuilder({
      theirPlayers: [
        lite(pv('d'), 'Hurt Guy', false),
        lite(pv('e'), 'Them Two'),
        lite(pv('f'), 'Them Three'),
      ],
    });
    expect(textOf(container)).toContain('harder to move');
  });

  it('disables Send with concrete reason until 1+1', () => {
    const { container } = renderBuilder();
    const submit = container.querySelector('[data-testid="package-submit"]');
    if (!(submit instanceof HTMLButtonElement)) throw new Error('missing submit');
    expect(submit.disabled).toBe(true);
    expect(textOf(container)).toContain('Pick at least 1 from each side');
  });

  it('shows Influence chips only after 1+1 picked', async () => {
    const { container } = renderBuilder();
    expect(textOf(container)).not.toContain('You +1');
    await fireEvent.click(checkboxAt(container, 0));
    await fireEvent.click(checkboxAt(container, 3));
    expect(textOf(container)).toContain('You +1');
    expect(textOf(container)).toContain('Them +2');
    expect(textOf(container)).toContain('Sends Offer 1 of 3');
  });

  it('shows one humanized error, hiding ids', () => {
    const { container } = renderBuilder({
      commandError: 'trade-protected-player: pv-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa protected',
    });
    expect(textOf(container)).toContain('Off limits');
    expect(textOf(container)).not.toContain('pv-aaaa');
  });

  it('uses checkboxes, 44px targets, live roster sizes', () => {
    const { container } = renderBuilder();
    const boxes = container.querySelectorAll('input[type="checkbox"]');
    expect(boxes.length).toBeGreaterThan(0);
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    const submit = container.querySelector('[data-testid="package-submit"]');
    if (!(submit instanceof HTMLElement)) throw new Error('missing submit');
    expect(submit.className).toContain('min-h-11');
    expect(textOf(container)).toContain('12 → 12');
    expect(textOf(container)).toContain('10–15');
  });
});

describe('NegotiationTranscript M3.11.1', () => {
  function negotiationOf(overrides: Record<string, unknown> = {}): never {
    return {
      inquiryId: inq('a'),
      windowIndex: 0,
      fromFranchiseId: 'lakers',
      toFranchiseId: 'celtics',
      status: 'active',
      exchangeCount: 1,
      exchanges: [
        {
          exchangeIndex: 1,
          kind: 'human-proposal',
          proposalId: null,
          proposalFingerprint: null,
          responseCause: null,
          atStateRevision: 1,
        },
      ],
      rejectedPlayerVersionIds: [],
      expressedInterests: [],
      latestRequestedChange: 'Add shooting',
      finalReason: null,
      activeProposalId: null,
      ...overrides,
    } as never;
  }

  it('shows They asked + Offer X of 3 + trio, hides technical ids', () => {
    const rendered = render(NegotiationTranscript, {
      props: { negotiation: negotiationOf(), inquiryAllowance: 3 },
    });
    const body = textOf(rendered.container);
    expect(body).toContain('They asked');
    expect(body).toContain('Offer 2 of 3');
    expect(rendered.getByTestId('negotiation-accept')).toBeDefined();
    expect(rendered.getByTestId('negotiation-revise')).toBeDefined();
    expect(rendered.getByTestId('negotiation-walkaway')).toBeDefined();
    expect(body).not.toContain('inq-aaaa');
    expect(body).not.toContain('prop-');
    expect(body).not.toContain('fingerprint');
    expect(body).not.toContain('revision');
  });

  it('Revise calls callback and Walk confirms', async () => {
    const onRevision = vi.fn();
    const onWalkAway = vi.fn();
    const rendered = render(NegotiationTranscript, {
      props: { negotiation: negotiationOf(), onRevision, onWalkAway },
    });
    await fireEvent.click(rendered.getByTestId('negotiation-revise'));
    expect(onRevision).toHaveBeenCalledWith(inq('a'));
    const walk = rendered.getByTestId('negotiation-walkaway');
    await fireEvent.click(walk);
    expect(onWalkAway).not.toHaveBeenCalled();
    expect(walk.textContent).toContain('Confirm');
    await fireEvent.click(walk);
    expect(onWalkAway).toHaveBeenCalledWith(inq('a'));
  });

  it('duplicate maps to Already sent', () => {
    const rendered = render(NegotiationTranscript, {
      props: {
        negotiation: negotiationOf(),
        commandError: 'trade-duplicate-proposal fingerprint a|b',
      },
    });
    expect(textOf(rendered.container)).toContain('Already sent this exact deal');
  });
});

describe('TradeBoardWorkspace M3.11.1', () => {
  function profileOf(franchiseId: string, overrides: Record<string, unknown> = {}): never {
    return {
      franchiseId,
      needs: ['shooting'],
      priority: 'talent',
      listedPlayerIds: [pv('d')],
      discussablePlayerIds: [pv('e'), pv('f')],
      protectedPlayerIds: [pv('9')],
      hardConstraints: ['Protected players unavailable'],
      rationale: `${franchiseId} seeks shooting.`,
      ...overrides,
    } as never;
  }
  function runOf(): never {
    const mkPlayers = (
      keys: string[],
      names: string[],
      franchiseId: string,
    ): Array<Record<string, string>> => {
      return keys.map((key, index) => ({
        playerVersionId: pv(key),
        playerId: `p-${key}`,
        franchiseId,
        eraId: '1990s',
        seasonKey: '1990-91',
        displayName: names[index] ?? `Player ${key}`,
      }));
    };
    return {
      rosters: [
        {
          franchiseId: 'lakers',
          players: mkPlayers(['a', 'b', 'c'], ['You One', 'You Two', 'You Three'], 'lakers'),
        },
        {
          franchiseId: 'celtics',
          players: mkPlayers(['d', 'e', 'f'], ['Them One', 'Them Two', 'Them Three'], 'celtics'),
        },
      ],
      rotations: [
        {
          franchiseId: 'lakers',
          targetMinutes: [
            { playerVersionId: pv('a'), minutes: 30 },
            { playerVersionId: pv('b'), minutes: 20 },
          ],
        },
        {
          franchiseId: 'celtics',
          targetMinutes: [
            { playerVersionId: pv('d'), minutes: 28 },
            { playerVersionId: pv('e'), minutes: 18 },
          ],
        },
      ],
      influence: { balances: { lakers: 3, celtics: 2 }, windows: {}, ledger: [] },
      transactions: [],
      trade: { windows: [] },
      health: { injuries: [] },
    } as never;
  }
  function renderWorkspace(overrides: Record<string, unknown> = {}): {
    onSubmitProposal: ReturnType<typeof vi.fn>;
    container: HTMLElement;
    getByTestId: (id: string) => HTMLElement;
  } {
    const onSubmitProposal = vi.fn();
    const windowState = {
      windowIndex: 0,
      blockIndex: 2,
      status: 'open',
      offers: [],
      boardProfiles: [],
      inquiryAllowance: 3,
      negotiations: [],
      valueTrends: [],
      activeInquiryId: null,
    } as never;
    const rendered = render(TradeBoardWorkspace, {
      props: {
        run: runOf(),
        catalog: null,
        manifest: null,
        windowState,
        boardProfiles: [profileOf('celtics'), profileOf('warriors')],
        negotiations: [],
        valueTrends: [],
        humanFranchiseId: 'lakers',
        humanBalance: 3,
        onOpenInquiry: vi.fn(),
        onSubmitProposal,
        onRespond: vi.fn(),
        onWalkAway: vi.fn(),
        onPurchaseInquiry: vi.fn(),
        commandError: null,
        busy: false,
        playerName: (id: string) => id.slice(0, 8),
        playableOf: () => ['PG'],
        availableOf: () => true,
        ...overrides,
      },
    });
    return {
      onSubmitProposal,
      container: rendered.container,
      getByTestId: (id: string): HTMLElement => rendered.getByTestId(id),
    };
  }

  it('selects partner and shows detail + matchup strip', async () => {
    const { container, getByTestId } = renderWorkspace();
    await fireEvent.click(getByTestId('board-team-celtics'));
    const body = textOf(container);
    expect(body).toContain('YOU');
    expect(body).toContain('Off limits');
    expect(body).toContain('Build package');
  });

  it('has Team Deal Track wizard tabs', () => {
    const { container } = renderWorkspace();
    const tabs = container.querySelectorAll('[role="tab"]');
    const labels = [...tabs].map((t) => t.textContent.trim());
    expect(labels).toEqual(['Team', 'Deal', 'Track']);
  });

  it('guards second team while negotiating', async () => {
    const activeId = inq('b');
    const negotiations = [
      {
        inquiryId: activeId,
        windowIndex: 0,
        fromFranchiseId: 'lakers',
        toFranchiseId: 'celtics',
        status: 'active',
        exchangeCount: 1,
        exchanges: [],
        rejectedPlayerVersionIds: [],
        expressedInterests: [],
        latestRequestedChange: null,
        finalReason: null,
        activeProposalId: null,
      },
    ] as never;
    const windowState = {
      windowIndex: 0,
      blockIndex: 2,
      status: 'open',
      offers: [],
      inquiryAllowance: 3,
      negotiations,
      activeInquiryId: activeId,
    } as never;
    const { container, getByTestId } = renderWorkspace({ negotiations, windowState });
    await fireEvent.click(getByTestId('board-team-warriors'));
    expect(textOf(container)).toContain('Finish or walk away');
  });

  it('shows slim header with window pips diamond', () => {
    const { container } = renderWorkspace();
    const body = textOf(container);
    expect(body).toContain('Window 1 of 3');
    expect(body).toContain('closes after Block 3');
    expect(body).toContain('closes when next block locks');
    expect(body).toContain('◆ 3');
  });

  it('uses disclosures for history', () => {
    const { container } = renderWorkspace();
    const summaries = [...container.querySelectorAll('details summary')].map((s) =>
      s.textContent.trim(),
    );
    expect(summaries.some((s) => s.includes('Past windows'))).toBe(true);
    expect(summaries.some((s) => s.includes('Trends'))).toBe(true);
    expect(summaries.some((s) => s.includes('Ledger'))).toBe(true);
  });

  it('preserves in-session draft when switching back', async () => {
    const { container, getByTestId } = renderWorkspace();
    await fireEvent.click(getByTestId('board-team-celtics'));
    await fireEvent.click(checkboxAt(container, 0));
    await fireEvent.click(getByTestId('board-team-warriors'));
    await fireEvent.click(getByTestId('board-team-celtics'));
    expect(checkboxAt(container, 0).checked).toBe(true);
  });
});
