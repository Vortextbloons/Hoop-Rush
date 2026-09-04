import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import {
  SEASON_DRAFT_CATALOG_V3,
  SEASON_DURABILITY_VERSION,
  SEASON_STAMINA_VERSION,
  SIMULATION_RATINGS,
  SIMULATION_TENDENCIES,
  PLAYER_VERSION_ID_VERSION,
  eraIdSchema,
  franchiseIdSchema,
  commandIdSchema,
  idSchema,
  playerIdSchema,
  seasonKeySchema,
  seedSchema,
  contentHashSchema,
  type Position,
  type SeasonDraftCandidate,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonFreeAgencyBand,
  type SeasonFreeAgencyIndex,
  type SeasonFreeAgencyState,
  type SeasonFreeAgencyWindowState,
  type SeasonRun,
} from '@hoop-rush/data-contracts';
import { buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import { generateSeasonSchedule, openSeasonFreeAgencyWindow } from '@hoop-rush/engine';
import { buildManifest } from '@hoop-rush/test-fixtures';
import type { SeasonRunShellData } from '$lib/season/season-shell-context';
import { initialSeasonRunShellData } from '$lib/season/season-shell-context';
import { createRotationEditor } from '$lib/season/season-rotation-editor';
import { describeCommandRejection } from '$lib/season/season-hub-state';
import { mockSvelteKitApp } from '../../../test/svelte-testing';
import FreeAgencyRouteWrapper from '../../../test/FreeAgencyRouteWrapper.svelte';
mockSvelteKitApp();
const SEED = seedSchema.parse('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
const HUMAN = franchiseIdSchema.parse('lakers');
const SLOT_POSITIONS: ReadonlyArray<readonly Position[]> = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF', 'C'],
  ['C'],
];
const BAND_CYCLE: SeasonFreeAgencyBand[] = ['featured', 'role', 'role', 'development', 'emergency'];
function catalogCandidate(
  playerVersionId: string,
  playerId: string,
  playable: readonly Position[],
): SeasonDraftCandidate {
  const primary = playable[0];
  if (primary === undefined) throw new Error('no primary position');
  return {
    playerVersionId,
    playerId: playerIdSchema.parse(playerId),
    franchiseId: franchiseIdSchema.parse('lakers'),
    eraId: eraIdSchema.parse('1990s'),
    seasonKey: seasonKeySchema.parse('1994-95'),
    displayName: playerId,
    playerExternalId: '101',
    positions: {
      primary,
      secondary: playable.slice(1),
      playable: [...playable],
      normalizationVersion: 'position-v3',
    },
    heightInches: 79,
    weightLbs: 215,
    summaryRatings: { overallRating: 90, offenseRating: 92, defenseRating: 84 },
    detailedRatings: { ...SIMULATION_RATINGS },
    tendencies: { ...SIMULATION_TENDENCIES },
    stamina: { rating: 70, historicalMpg: 30, derivationVersion: SEASON_STAMINA_VERSION },
    durability: { rating: 70, derivationVersion: SEASON_DURABILITY_VERSION },
  };
}
function fixtureCatalog(run: SeasonRun): SeasonDraftCatalog {
  const candidates: SeasonDraftCandidate[] = [];
  for (const roster of run.rosters) {
    roster.players.forEach((player, slot) => {
      const playable = SLOT_POSITIONS[slot];
      if (playable === undefined) throw new Error('no position pattern for slot');
      candidates.push(catalogCandidate(player.playerVersionId, player.playerId, playable));
    });
  }
  for (let i = 0; i < 30; i += 1) {
    const playable = SLOT_POSITIONS[i % SLOT_POSITIONS.length];
    if (playable === undefined) throw new Error('no position pattern for extra');
    candidates.push(
      catalogCandidate(
        `pv-extra-${String(i).padStart(2, '0')}`,
        `p-extra-${String(i).padStart(2, '0')}`,
        playable,
      ),
    );
  }
  return {
    schemaVersion: 1,
    catalogVersion: SEASON_DRAFT_CATALOG_V3,
    dataVersion: 'data-v1',
    ratingsVersion: 'ratings-v1',
    positionNormalizationVersion: 'position-v3',
    playerVersionIdVersion: PLAYER_VERSION_ID_VERSION,
    staminaVersion: SEASON_STAMINA_VERSION,
    durabilityVersion: SEASON_DURABILITY_VERSION,
    pools: run.rosters.map((roster) => ({
      franchiseId: roster.franchiseId,
      eraId: eraIdSchema.parse('1990s'),
      playerVersionIds: roster.players.map((player) => player.playerVersionId),
    })),
    candidates,
  };
}
function fixtureIndex(catalog: SeasonDraftCatalog): SeasonFreeAgencyIndex {
  const candidates = catalog.candidates
    .filter((candidate) => candidate.playerId.startsWith('p-extra-'))
    .map((candidate, index) => ({
      playerVersionId: candidate.playerVersionId,
      playerId: candidate.playerId,
      displayName: candidate.displayName,
      positions: candidate.positions,
      band: BAND_CYCLE[index % BAND_CYCLE.length] as SeasonFreeAgencyBand,
      minimumInfluence: 1,
      supportedRoles: ['rotation', 'depth', 'emergency'] as SeasonFreeAgencyIndexEntryRoles,
      strengths: ['recorded role coverage'],
      limitations: [],
      durabilityRating: candidate.durability.rating,
      minutesPerGame: candidate.stamina.historicalMpg,
      availability: { healthy: true, notes: '' },
      catalogRef: {
        catalogVersion: catalog.catalogVersion,
        dataVersion: catalog.dataVersion,
        candidateIndex: catalog.candidates.indexOf(candidate),
      },
      derivationEvidence: 'fixture eligibility',
      exclusionEvidence: '',
    }));
  const groupedVersions: Record<string, string[]> = {};
  for (const candidate of candidates) {
    const group = groupedVersions[candidate.playerId] ?? [];
    group.push(candidate.playerVersionId);
    groupedVersions[candidate.playerId] = group;
  }
  return {
    schemaVersion: 1,
    indexVersion: 'free-agency-index-v1',
    dataVersion: 'fixture',
    catalogRef: {
      catalogVersion: catalog.catalogVersion,
      contentHash: contentHashSchema.parse('0'.repeat(64)),
      candidateCount: catalog.candidates.length,
    },
    candidates,
    groupedVersions,
  };
}
type SeasonFreeAgencyIndexEntryRoles =
  SeasonFreeAgencyIndex['candidates'][number]['supportedRoles'];
function zeroEffectsOf(run: SeasonRun): SeasonEffectsState {
  return {
    schemaVersion: 2,
    playerStates: run.rosters.flatMap((roster) =>
      roster.players.map((player) => ({
        playerVersionId: player.playerVersionId,
        fatigueBasisPoints: 0,
        recentLoadBasisPoints: 0,
        lastCompletedRound: 0,
      })),
    ),
    inactivePlayerStates: [],
    pairStates: [],
    archivedPairs: [],
  };
}
function fixtureRun(): SeasonRun {
  const league = buildSeasonLeague({}, { humanFranchiseId: HUMAN });
  const schedule = generateSeasonSchedule({ league, seed: SEED });
  const base = buildSeasonRunFixture({ schedule, league, seed: SEED, humanFranchiseId: HUMAN });
  const catalog = fixtureCatalog(base);
  const index = fixtureIndex(catalog);
  const opened = openSeasonFreeAgencyWindow(
    { run: base, effects: zeroEffectsOf(base), catalog, index, humanFranchiseId: HUMAN },
    0,
    2,
  );
  return { ...base, freeAgency: opened.freeAgency };
}
function windowOf(freeAgency: SeasonFreeAgencyState): SeasonFreeAgencyWindowState {
  const window = freeAgency.windows[0];
  if (window === undefined) throw new Error('fixture has no open window');
  return window;
}
function playableByVersionOf(run: SeasonRun): Map<string, readonly Position[]> {
  const map = new Map<string, readonly Position[]>();
  for (const roster of run.rosters) {
    roster.players.forEach((entry, slot) => {
      const playable = SLOT_POSITIONS[slot];
      if (playable !== undefined) map.set(entry.playerVersionId, playable);
    });
  }
  return map;
}
function shellFor(run: SeasonRun, overrides: Partial<SeasonRunShellData> = {}): SeasonRunShellData {
  const shell = initialSeasonRunShellData();
  shell.ready = true;
  shell.run = run;
  shell.freeAgency = run.freeAgency;
  shell.humanFranchiseId = HUMAN;
  shell.humanTeam = run.league.teams.find((team) => team.franchiseId === HUMAN) ?? null;
  shell.influence = run.influence;
  shell.manifest = buildManifest();
  const humanRotation = run.rotations.find((rotation) => rotation.franchiseId === HUMAN);
  const humanRoster = run.rosters.find((roster) => roster.franchiseId === HUMAN);
  const playable = playableByVersionOf(run);
  if (humanRotation !== undefined && humanRoster !== undefined) {
    shell.editor = createRotationEditor(
      humanRotation,
      humanRoster.players.map((entry) => ({
        playerVersionId: entry.playerVersionId,
        displayName: entry.displayName,
        playable: playable.get(entry.playerVersionId) ?? [],
      })),
    );
  }
  shell.playablePositions = (playerVersionId) => playable.get(playerVersionId) ?? [];
  shell.franchiseName = (franchiseId) => franchiseId;
  shell.playerName = (playerVersionId) => playerVersionId;
  shell.declareFreeAgentInterest = vi.fn(() => Promise.resolve());
  shell.skipFreeAgentMarket = vi.fn(() => Promise.resolve());
  shell.resolveFreeAgentMarket = vi.fn(() => Promise.resolve());
  return { ...shell, ...overrides };
}
function declaredRun(
  run: SeasonRun,
  targets: {
    playerVersionId: string;
    roleExpectation: 'rotation' | 'depth' | 'emergency';
    influence: number;
  }[],
): SeasonRun {
  const window = windowOf(run.freeAgency);
  const declaredWindow: SeasonFreeAgencyWindowState = {
    ...window,
    declarations: {
      ...window.declarations,
      [HUMAN]: {
        franchiseId: HUMAN,
        windowIndex: window.windowIndex,
        commandId: commandIdSchema.parse('cmd-fa-declare-1'),
        targets,
      },
    },
  };
  return { ...run, freeAgency: { ...run.freeAgency, windows: [declaredWindow] } };
}
function resolvedRun(run: SeasonRun, humanSigned: boolean): SeasonRun {
  const window = windowOf(run.freeAgency);
  const first = window.candidates[0];
  if (first === undefined) throw new Error('no candidates');
  const second = window.candidates[1];
  if (second === undefined) throw new Error('need two candidates');
  const humanTarget = humanSigned ? first : second;
  const otherTarget = humanSigned ? second : first;
  const celtics = franchiseIdSchema.parse('celtics');
  const signing = {
    signingId: idSchema.parse('signing-1'),
    windowIndex: window.windowIndex,
    franchiseId: humanSigned ? HUMAN : celtics,
    playerVersionId: humanTarget.playerVersionId,
    playerId: humanTarget.playerId,
    band: humanTarget.band,
    roleExpectation: 'rotation' as const,
    influenceCost: 2,
    commandId: commandIdSchema.parse('cmd-fa-resolve-1'),
    seedPath: ['free-agency', '0', 'resolve', 'draw'],
    ledgerEntryId: idSchema.parse('ledger-1'),
    transactionId: idSchema.parse('txn-1'),
    appliedAtStateRevision: 2,
  };
  const resolvedWindow: SeasonFreeAgencyWindowState = {
    ...window,
    status: 'resolved',
    declarations: {
      ...window.declarations,
      [HUMAN]: {
        franchiseId: HUMAN,
        windowIndex: window.windowIndex,
        commandId: commandIdSchema.parse('cmd-fa-declare-1'),
        targets: [
          {
            playerVersionId: humanTarget.playerVersionId,
            roleExpectation: 'rotation' as const,
            influence: 2,
          },
        ],
      },
    },
    signings: [signing],
    traces: [
      {
        windowIndex: window.windowIndex,
        seedPath: ['free-agency', '0', 'resolve'],
        steps: [
          {
            candidatePlayerVersionId: humanTarget.playerVersionId,
            franchiseId: HUMAN,
            criterion: 'need',
            category: 'High',
            citedFacts: ['rotation lacks a playable C', 'recorded 10 games without one'],
          },
          {
            candidatePlayerVersionId: humanTarget.playerVersionId,
            franchiseId: HUMAN,
            criterion: 'influence',
            category: 'won',
            citedFacts: ['committed 2 Influence'],
          },
          {
            candidatePlayerVersionId: otherTarget.playerVersionId,
            franchiseId: celtics,
            criterion: 'opportunity',
            category: 'immediate',
            citedFacts: ['no other recorded interest'],
          },
        ],
        firstPriorityWinners: [
          { candidatePlayerVersionId: humanTarget.playerVersionId, winnerFranchiseId: HUMAN },
        ],
        secondPriorityWinners: [],
        signingFranchiseId: HUMAN,
        signedPlayerVersionId: humanTarget.playerVersionId,
        resolution: 'signed' as const,
      },
    ],
  };
  return {
    ...run,
    freeAgency: {
      ...run.freeAgency,
      windows: [resolvedWindow],
      signingCounts: { ...run.freeAgency.signingCounts, [HUMAN]: humanSigned ? 1 : 0 },
      seasonSpend: { ...run.freeAgency.seasonSpend, [HUMAN]: humanSigned ? 2 : 0 },
    },
  };
}
beforeEach(() => {
  vi.restoreAllMocks();
});
function renderRoute(run: SeasonRun, overrides: Partial<SeasonRunShellData> = {}) {
  return render(FreeAgencyRouteWrapper, { props: { shell: shellFor(run, overrides) } });
}
function candidateCards(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('[data-fa-candidate-card]'));
}
describe('free-agency market overview (M2.6.5)', () => {
  it('renders the empty state before the first market opens', () => {
    const league = buildSeasonLeague({}, { humanFranchiseId: HUMAN });
    const schedule = generateSeasonSchedule({ league, seed: SEED });
    const run = buildSeasonRunFixture({ schedule, league, seed: SEED, humanFranchiseId: HUMAN });
    const { container } = renderRoute(run);
    expect(container.querySelector('[data-fa-empty-state]')).not.toBeNull();
    expect(container.textContent).toContain('No market open yet');
    expect(candidateCards(container)).toHaveLength(0);
  });
  it('renders the open window with candidate cards, band labels, and facts', () => {
    const run = fixtureRun();
    const { container } = renderRoute(run);
    expect(container.querySelector('[data-fa-window-open]')).not.toBeNull();
    const cards = candidateCards(container);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThanOrEqual(12);
    const window = windowOf(run.freeAgency);
    expect(cards).toHaveLength(window.candidates.length);
    const text = container.textContent;
    expect(text).toContain('Featured');
    expect(text).toContain('Role');
    expect(text).toContain('Development');
    expect(text).toContain('Emergency');
    expect(text).toContain('mpg');
    expect(text).toContain('Durability');
    expect(text).toContain('Strengths');
    expect(text).toContain('Limitations');
    expect(text).toContain('recorded role coverage');
  });
  it('lists franchises with recorded interest, human first', () => {
    const run = fixtureRun();
    const window = windowOf(run.freeAgency);
    const busy = window.candidates.find((candidate) =>
      Object.values(window.declarations).some((declaration) =>
        declaration.targets.some((target) => target.playerVersionId === candidate.playerVersionId),
      ),
    );
    expect(busy).toBeDefined();
    const { container } = renderRoute(run);
    const interests = Array.from(container.querySelectorAll('[data-fa-interest]')).filter(
      (el) => el.textContent.trim().length > 0,
    );
    expect(interests.length).toBeGreaterThan(0);
  });
});
describe('free-agency declaration step (M2.6.5)', () => {
  it('shows the unresolved gating notice before a declaration', () => {
    const run = fixtureRun();
    const { container } = renderRoute(run);
    const notice = container.querySelector('[data-fa-unresolved-notice]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain('next block cannot submit');
    expect(container.querySelector('[data-fa-review-panel]')).toBeNull();
  });
  it('targets two ordered players through the priority pickers', async () => {
    const run = fixtureRun();
    const window = windowOf(run.freeAgency);
    const first = window.candidates[0];
    const second = window.candidates[1];
    if (first === undefined || second === undefined) throw new Error('need two candidates');
    const { container } = renderRoute(run);
    const cardOf = (playerVersionId: string) => {
      const card = candidateCards(container).find((el) =>
        el.querySelector(`#fa-priority-${playerVersionId}`),
      );
      if (card === undefined) throw new Error(`no card for ${playerVersionId}`);
      return card;
    };
    const priorityOf = (card: HTMLElement) =>
      card.querySelector('[data-fa-candidate-priority]') as HTMLSelectElement;
    await fireEvent.change(priorityOf(cardOf(first.playerVersionId)), { target: { value: '1' } });
    await fireEvent.change(priorityOf(cardOf(second.playerVersionId)), { target: { value: '2' } });
    const targets = container.querySelectorAll('[data-fa-draft-targets] li');
    expect(targets).toHaveLength(2);
    expect(targets[0]?.textContent).toContain('First priority');
    expect(targets[0]?.textContent).toContain(first.displayName);
    expect(targets[1]?.textContent).toContain('Second priority');
    expect(targets[1]?.textContent).toContain(second.displayName);
    const influences = container.querySelectorAll('[data-fa-influence-input]');
    expect(influences).toHaveLength(2);
    expect((influences[0] as HTMLInputElement).value).toBe(String(first.minimumInfluence));
  });

  it('submits the declaration through the shell with ordered targets', async () => {
    const run = fixtureRun();
    const window = windowOf(run.freeAgency);
    const first = window.candidates[0];
    const second = window.candidates[1];
    if (first === undefined || second === undefined) throw new Error('need two candidates');
    const shell = shellFor(run);
    const { container } = render(FreeAgencyRouteWrapper, { props: { shell } });
    const select = (playerVersionId: string) =>
      container.querySelector(`#fa-priority-${playerVersionId}`) as HTMLSelectElement;
    await fireEvent.change(select(first.playerVersionId), { target: { value: '1' } });
    await fireEvent.change(select(second.playerVersionId), { target: { value: '2' } });
    await fireEvent.click(container.querySelector('[data-fa-declare-submit]') as HTMLButtonElement);
    expect(shell.declareFreeAgentInterest).toHaveBeenCalledTimes(1);
    const calls = (shell.declareFreeAgentInterest as ReturnType<typeof vi.fn>).mock.calls;
    const call = calls[0]?.[0] as unknown as {
      windowIndex: number;
      targets: unknown[];
    };
    expect(call.windowIndex).toBe(0);
    expect(call.targets).toHaveLength(2);
    expect(call.targets[0]).toMatchObject({
      playerVersionId: first.playerVersionId,
      influence: first.minimumInfluence,
    });
    expect(call.targets[1]).toMatchObject({ playerVersionId: second.playerVersionId });
  });
  it('skips the market with one tap and no cost', async () => {
    const run = fixtureRun();
    const shell = shellFor(run);
    const { container } = render(FreeAgencyRouteWrapper, { props: { shell } });
    await fireEvent.click(container.querySelector('[data-fa-skip]') as HTMLButtonElement);
    expect(shell.skipFreeAgentMarket).toHaveBeenCalledTimes(1);
    expect(shell.skipFreeAgentMarket).toHaveBeenCalledWith({ windowIndex: 0 });
  });
});
describe('free-agency review + resolve (M2.6.5)', () => {
  it('restores the recorded declaration on reload (immutable review)', () => {
    const run = fixtureRun();
    const window = windowOf(run.freeAgency);
    const first = window.candidates[0];
    if (first === undefined) throw new Error('no candidates');
    const declared = declaredRun(run, [
      { playerVersionId: first.playerVersionId, roleExpectation: 'rotation', influence: 2 },
    ]);
    const { container } = renderRoute(declared);
    const review = container.querySelector('[data-fa-review-panel]');
    expect(review).not.toBeNull();
    expect(review?.textContent).toContain('Declaration submitted');
    expect(review?.textContent).toContain('Immutable');
    expect(review?.textContent).toContain(first.displayName);
    const select = container.querySelector('[data-fa-candidate-priority]') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(container.querySelector('[data-fa-unresolved-notice]')).toBeNull();
    expect(container.querySelector('[data-fa-resolve-notice]')).not.toBeNull();
  });
  it('shows the recorded skip after a reload', () => {
    const run = fixtureRun();
    const declared = declaredRun(run, []);
    const { container } = renderRoute(declared);
    const review = container.querySelector('[data-fa-review-panel]');
    expect(review).not.toBeNull();
    expect(container.querySelector('[data-fa-review-skip]')).not.toBeNull();
    expect(review?.textContent).toContain('recorded a skip');
  });
  it('resolves the market through the shell command', async () => {
    const run = fixtureRun();
    const window = windowOf(run.freeAgency);
    const first = window.candidates[0];
    if (first === undefined) throw new Error('no candidates');
    const declared = declaredRun(run, [
      { playerVersionId: first.playerVersionId, roleExpectation: 'rotation', influence: 2 },
    ]);
    const shell = shellFor(declared);
    const { container } = render(FreeAgencyRouteWrapper, { props: { shell } });
    const resolve = container.querySelector('[data-fa-resolve]') as HTMLButtonElement;
    expect(resolve.textContent).toContain('Resolve Free Agency Window 1');
    await fireEvent.click(resolve);
    expect(shell.resolveFreeAgentMarket).toHaveBeenCalledTimes(1);
    expect(shell.resolveFreeAgentMarket).toHaveBeenCalledWith({ windowIndex: 0 });
  });
  it('renders resolved history: signings, human result, trace disclosure', () => {
    const run = fixtureRun();
    const window = windowOf(run.freeAgency);
    const first = window.candidates[0];
    if (first === undefined) throw new Error('no candidates');
    const resolved = resolvedRun(run, true);
    const { container } = renderRoute(resolved);
    const panel = container.querySelector('[data-fa-window-resolved]');
    expect(panel).not.toBeNull();
    const signings = Array.from(container.querySelectorAll('[data-fa-signing]'));
    expect(signings).toHaveLength(1);
    expect(signings[0]?.getAttribute('data-fa-signing-human')).toBe('true');
    const humanResult = container.querySelector('[data-fa-human-result]');
    expect(humanResult?.textContent).toContain('You signed');
    expect(humanResult?.textContent).toContain('2 Influence debited');
    const disclosure = container.querySelector('[data-fa-trace-disclosure]');
    expect(disclosure).not.toBeNull();
    const traceText = disclosure?.textContent ?? '';
    expect(traceText).toContain('Need');
    expect(traceText).toContain('High');
    expect(traceText).toContain('rotation lacks a playable C');
    expect(traceText).toContain('Influence');
    expect(humanResult?.textContent).toContain('1 season signing');
  });
});
describe('free-agency typed rejection copy (M2.6.5)', () => {
  it('maps every free-agency rejection code to copy', () => {
    const codes = [
      'free-agency-unresolved',
      'free-agency-window-not-open',
      'free-agency-already-resolved',
      'free-agency-already-declared',
      'free-agency-target-ineligible',
      'free-agency-duplicate-identity',
      'free-agency-invalid-priority',
      'free-agency-unsupported-role',
      'free-agency-invalid-influence',
      'free-agency-roster-cap',
      'free-agency-season-signing-cap',
      'free-agency-season-influence-cap',
      'free-agency-insufficient-balance',
      'free-agency-pending-declaration',
      'free-agency-ownership-conflict',
    ] as const;
    for (const code of codes) {
      const rejection = { code } as Parameters<typeof describeCommandRejection>[1];
      const copy = describeCommandRejection('declare-free-agent-interest', rejection);
      expect(copy.length).toBeGreaterThan(10);
      expect(copy).not.toContain('was rejected');
    }
  });
});
describe('smaller markets (M2.6.5)', () => {
  it('renders the smaller valid candidate set', () => {
    const run = fixtureRun();
    const window = windowOf(run.freeAgency);
    const two = { ...window, candidates: window.candidates.slice(0, 2) };
    const smallRun = { ...run, freeAgency: { ...run.freeAgency, windows: [two] } };
    const { container } = renderRoute(smallRun);
    expect(candidateCards(container)).toHaveLength(2);
    expect(container.querySelector('[data-fa-unresolved-notice]')).not.toBeNull();
  });
});

describe('free-agency window lifecycle across the route (M2.6.5)', () => {
  it('declares then shows the review step in the same route state machine', () => {
    const run = fixtureRun();
    const window = windowOf(run.freeAgency);
    const first = window.candidates[0];
    if (first === undefined) throw new Error('no candidates');
    const initial = renderRoute(run);
    expect(initial.container.querySelector('[data-fa-declaration]')).not.toBeNull();
    const declared = renderRoute(
      declaredRun(run, [
        { playerVersionId: first.playerVersionId, roleExpectation: 'rotation', influence: 2 },
      ]),
    );
    expect(declared.container.querySelector('[data-fa-declaration]')).toBeNull();
    expect(declared.container.querySelector('[data-fa-review-panel]')).not.toBeNull();
    const resolved = renderRoute(resolvedRun(run, true));
    expect(resolved.container.querySelector('[data-fa-review-panel]')).toBeNull();
    expect(resolved.container.querySelector('[data-fa-window-resolved]')).not.toBeNull();
  });
});

describe('free-agency hub CTA (M2.6.5)', () => {
  it('links the open window from the hub page and hides without one', async () => {
    const { default: SeasonRunShellWrapper } =
      await import('../../../test/SeasonRunShellWrapper.svelte');
    const run = fixtureRun();
    const withWindow = render(SeasonRunShellWrapper, {
      props: {
        shell: shellFor(run, {
          snapshot: {
            run,
            summaries: [],
            retainedDetails: [],
            acceptedBlocks: [],
            effects: zeroEffectsOf(run),
          },
          health: run.health,
          objectives: run.objectives,
        }),
      },
    });
    const cta = withWindow.container.querySelector('[data-fa-hub-cta]');
    expect(cta).not.toBeNull();
    expect(cta?.textContent).toContain('Free Agency Window 1');
    const link = withWindow.container.querySelector('[data-fa-hub-cta-link]');
    expect(link?.getAttribute('href')).toBe('/season/run/free-agency');
    const league = buildSeasonLeague({}, { humanFranchiseId: HUMAN });
    const schedule = generateSeasonSchedule({ league, seed: SEED });
    const bare = buildSeasonRunFixture({ schedule, league, seed: SEED, humanFranchiseId: HUMAN });
    const withoutWindow = render(SeasonRunShellWrapper, {
      props: {
        shell: shellFor(bare, {
          snapshot: {
            run: bare,
            summaries: [],
            retainedDetails: [],
            acceptedBlocks: [],
            effects: zeroEffectsOf(bare),
          },
          health: bare.health,
          objectives: bare.objectives,
        }),
      },
    });
    expect(withoutWindow.container.querySelector('[data-fa-hub-cta]')).toBeNull();
  });
});
