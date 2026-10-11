import { describe, expect, it } from 'vitest';
import type { HavocRunState } from '@hoop-rush/data-contracts';
import {
  HAVOC_GAME_COUNT,
  HAVOC_SCHEMA_VERSION,
  havocAbandonRunCommandSchema,
  havocAcceptGameCommandSchema,
  havocAcceptNormalGameCommandSchema,
  havocCommandResultSchema,
  havocCompleteComparisonCommandSchema,
  havocMvpSchema,
  havocRunStateSchema,
} from '@hoop-rush/data-contracts';
import {
  buildFixtureBracket,
  buildHavocGameSummary,
  buildHavocRunState,
  buildHavocRunStateLocked,
} from '@hoop-rush/test-fixtures';
import type { HavocLockSources } from './api.ts';
import { ApplyHavocCommand } from './run-commands.ts';
import { HavocStateDigest } from './state-digest.ts';
import {
  buildHavocCatalogFixture,
  buildHavocCreateCommandFixture,
  buildHavocEnvironmentFixture,
  buildHavocEraProfileFixture,
} from './havoc-test-support.ts';

const fixture = buildHavocCatalogFixture();
const environment = buildHavocEnvironmentFixture(fixture.adapted);
const lockSources: HavocLockSources = {
  bracket: buildFixtureBracket(),
  profile: buildHavocEraProfileFixture(),
};

const HEX_A = 'a'.repeat(32);
const HEX_B = 'b'.repeat(32);

function havocGameCommand(
  state: HavocRunState,
  cursor: number,
  outcome: 'win' | 'loss',
  overrides: Record<string, unknown> = {},
) {
  return havocAcceptGameCommandSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    commandId: `cmd-havoc-${String(cursor)}`,
    runId: state.runId,
    expectedRevision: state.revision,
    command: 'accept-havoc-game',
    cursor,
    inputDigest: HEX_A,
    resultDigest: HEX_B,
    summary: buildHavocGameSummary({
      gameNumber: cursor,
      variant: 'havoc',
      humanScore: outcome === 'win' ? 104 : 92,
      opponentScore: outcome === 'win' ? 96 : 101,
      outcome,
      inputDigest: HEX_A,
      resultDigest: HEX_B,
    }),
    ...overrides,
  });
}

function normalGameCommand(
  state: HavocRunState,
  cursor: number,
  outcome: 'win' | 'loss',
  overrides: Record<string, unknown> = {},
) {
  return havocAcceptNormalGameCommandSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    commandId: `cmd-normal-${String(cursor)}`,
    runId: state.runId,
    expectedRevision: state.revision,
    command: 'accept-havoc-normal-game',
    cursor,
    inputDigest: HEX_A,
    resultDigest: HEX_B,
    summary: buildHavocGameSummary({
      gameNumber: cursor,
      variant: 'normal',
      humanScore: outcome === 'win' ? 99 : 88,
      opponentScore: outcome === 'win' ? 95 : 102,
      outcome,
      inputDigest: HEX_A,
      resultDigest: HEX_B,
    }),
    ...overrides,
  });
}

function abandonCommand(state: HavocRunState) {
  return havocAbandonRunCommandSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    commandId: `cmd-abandon-${String(state.revision)}`,
    runId: state.runId,
    expectedRevision: state.revision,
    command: 'abandon-havoc-run',
  });
}

function completeCommand(state: HavocRunState) {
  const pick = state.locked?.picks[0];
  if (pick === undefined) throw new Error('missing locked pick');
  return havocCompleteComparisonCommandSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    commandId: `cmd-complete-${String(state.revision)}`,
    runId: state.runId,
    expectedRevision: state.revision,
    command: 'complete-havoc-comparison',
    comparisonDigest: HEX_A,
    reportDigest: HEX_B,
    mvp: havocMvpSchema.parse({
      slot: pick.slot,
      playerId: pick.card.source.playerId,
      playerVersionId: pick.card.source.playerVersionId,
      displayName: pick.card.source.displayName,
      havocIndex: 100,
      normalIndex: 80,
      gain: 20,
    }),
  });
}

function acceptHavocGames(
  start: HavocRunState,
  count: number,
  outcomeFor: (gameNumber: number) => 'win' | 'loss',
): HavocRunState {
  let state = start;
  for (let index = 0; index < count; index += 1) {
    const cursor = state.havocCursor + 1;
    const outcome = ApplyHavocCommand(
      state,
      havocGameCommand(state, cursor, outcomeFor(cursor)),
      environment,
      lockSources,
    );
    expect(outcome.result.status).toBe('accepted');
    state = outcome.state;
  }
  return state;
}

function acceptNormalGames(
  start: HavocRunState,
  count: number,
  outcomeFor: (gameNumber: number) => 'win' | 'loss',
): HavocRunState {
  let state = start;
  for (let index = 0; index < count; index += 1) {
    const cursor = state.normalCursor + 1;
    const outcome = ApplyHavocCommand(
      state,
      normalGameCommand(state, cursor, outcomeFor(cursor)),
      environment,
      lockSources,
    );
    expect(outcome.result.status).toBe('accepted');
    state = outcome.state;
  }
  return state;
}

describe('havoc run command flow', () => {
  it('accepts havoc games one cursor at a time and folds aggregates', () => {
    const base = buildHavocRunStateLocked();
    const first = ApplyHavocCommand(
      base,
      havocGameCommand(base, 1, 'win'),
      environment,
      lockSources,
    );
    expect(first.result.status).toBe('accepted');
    expect(first.state.havocCursor).toBe(1);
    expect(first.state.revision).toBe(1);
    expect(first.state.havocAggregate).toEqual({
      games: 1,
      wins: 1,
      losses: 0,
      pointsFor: 104,
      pointsAgainst: 96,
      adjustments: 0,
    });
    expect(first.state.normalCursor).toBe(0);
    const wrongCursor = ApplyHavocCommand(
      first.state,
      havocGameCommand(first.state, 4, 'win'),
      environment,
      lockSources,
    );
    expect(wrongCursor.result.status).toBe('rejected');
    expect(wrongCursor.result.rejection?.code).toBe('cursor-mismatch');
    expect(wrongCursor.state).toBe(first.state);
    const summaryMismatch = ApplyHavocCommand(
      first.state,
      havocGameCommand(first.state, 2, 'win', {
        summary: buildHavocGameSummary({ gameNumber: 3, variant: 'havoc' }),
      }),
      environment,
      lockSources,
    );
    expect(summaryMismatch.result.rejection?.code).toBe('cursor-mismatch');
    const wrongVariant = ApplyHavocCommand(
      first.state,
      havocGameCommand(first.state, 2, 'win', {
        summary: buildHavocGameSummary({ gameNumber: 2, variant: 'normal' }),
      }),
      environment,
      lockSources,
    );
    expect(wrongVariant.result.rejection?.code).toBe('phase-mismatch');
  });

  it('rejects stale revisions and other runs without mutating state', () => {
    const base = buildHavocRunStateLocked();
    const stale = ApplyHavocCommand(
      base,
      havocGameCommand(base, 1, 'win', { expectedRevision: 9 }),
      environment,
      lockSources,
    );
    expect(stale.result.rejection?.code).toBe('stale-revision');
    expect(stale.state).toBe(base);
    expect(stale.result.revisionBefore).toBe(base.revision);
    expect(stale.result.revisionAfter).toBe(base.revision);
    const otherRun = ApplyHavocCommand(
      base,
      havocGameCommand(base, 1, 'win', { runId: 'other-run' }),
      environment,
      lockSources,
    );
    expect(otherRun.result.rejection?.code).toBe('run-mismatch');
    expect(havocCommandResultSchema.safeParse(stale.result).success).toBe(true);
    expect(havocCommandResultSchema.safeParse(otherRun.result).success).toBe(true);
  });

  it('finishes 82 havoc games despite losses and reports the perfect-season truth table', () => {
    const base = buildHavocRunStateLocked();
    const withOneLoss = acceptHavocGames(base, 81, () => 'win');
    expect(withOneLoss.havocCursor).toBe(81);
    expect(withOneLoss.perfectSeason).toBe(false);
    const finalLoss = ApplyHavocCommand(
      withOneLoss,
      havocGameCommand(withOneLoss, 82, 'loss'),
      environment,
      lockSources,
    );
    expect(finalLoss.result.status).toBe('accepted');
    expect(finalLoss.state.havocCursor).toBe(HAVOC_GAME_COUNT);
    expect(finalLoss.state.perfectSeason).toBe(false);
    expect(finalLoss.state.completionState).toBe('season');
    expect(finalLoss.state.comparisonStatus).toBe('not-started');
    expect(havocRunStateSchema.safeParse(finalLoss.state).success).toBe(true);

    const perfect = acceptHavocGames(base, 82, () => 'win');
    expect(perfect.havocCursor).toBe(HAVOC_GAME_COUNT);
    expect(perfect.perfectSeason).toBe(true);
    expect(perfect.havocAggregate.losses).toBe(0);
    expect(havocRunStateSchema.safeParse(perfect).success).toBe(true);
    const extraHavoc = ApplyHavocCommand(
      perfect,
      havocGameCommand(perfect, 82, 'win'),
      environment,
      lockSources,
    );
    expect(extraHavoc.result.status).toBe('rejected');
    expect(extraHavoc.result.rejection?.code).toBe('already-complete');
  });

  it('refuses normal games before havoc game 82', () => {
    const base = buildHavocRunStateLocked();
    const rejected = ApplyHavocCommand(
      base,
      normalGameCommand(base, 1, 'win'),
      environment,
      lockSources,
    );
    expect(rejected.result.status).toBe('rejected');
    expect(rejected.result.rejection?.code).toBe('cursor-mismatch');
    expect(rejected.state).toBe(base);
  });

  it('runs the paired normal season after havoc 82 and completes the comparison', () => {
    const base = buildHavocRunStateLocked();
    const havocDone = acceptHavocGames(base, 82, () => 'win');
    const firstNormal = ApplyHavocCommand(
      havocDone,
      normalGameCommand(havocDone, 1, 'win'),
      environment,
      lockSources,
    );
    expect(firstNormal.result.status).toBe('accepted');
    expect(firstNormal.state.comparisonStatus).toBe('running');
    expect(firstNormal.state.completionState).toBe('season');
    const normal = acceptNormalGames(firstNormal.state, 81, (gameNumber) =>
      gameNumber % 3 === 0 ? 'loss' : 'win',
    );
    expect(normal.normalCursor).toBe(HAVOC_GAME_COUNT);
    expect(normal.completionState).toBe('comparison');
    expect(normal.comparisonStatus).toBe('running');
    expect(havocRunStateSchema.safeParse(normal).success).toBe(true);
    const completeBeforeComparison = ApplyHavocCommand(
      havocDone,
      completeCommand(havocDone),
      environment,
      lockSources,
    );
    expect(completeBeforeComparison.result.rejection?.code).toBe('cursor-mismatch');
    const mismatchedMvp = ApplyHavocCommand(
      normal,
      {
        ...completeCommand(normal),
        mvp: havocMvpSchema.parse({
          slot: 'C',
          playerId: 'p-unknown',
          playerVersionId: null,
          displayName: 'Unknown',
          havocIndex: 1,
          normalIndex: 2,
          gain: -1,
        }),
      },
      environment,
      lockSources,
    );
    expect(mismatchedMvp.result.status).toBe('rejected');
    expect(mismatchedMvp.result.rejection?.code).toBe('digest-mismatch');
    const complete = ApplyHavocCommand(normal, completeCommand(normal), environment, lockSources);
    expect(complete.result.status).toBe('accepted');
    expect(complete.state.comparisonStatus).toBe('complete');
    expect(complete.state.completionState).toBe('complete');
    expect(havocRunStateSchema.safeParse(complete.state).success).toBe(true);
    const after = ApplyHavocCommand(
      complete.state,
      normalGameCommand(complete.state, 82, 'win'),
      environment,
      lockSources,
    );
    expect(after.result.status).toBe('rejected');
    expect(after.result.rejection?.code).toBe('already-complete');
    const completeAgain = ApplyHavocCommand(
      complete.state,
      completeCommand(complete.state),
      environment,
      lockSources,
    );
    expect(completeAgain.result.rejection?.code).toBe('already-complete');
  });

  it('rejects normal games when the comparison is unsupported', () => {
    const unsupported = buildHavocRunStateLocked({
      havocCursor: HAVOC_GAME_COUNT,
      havocAggregate: {
        games: HAVOC_GAME_COUNT,
        wins: HAVOC_GAME_COUNT,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        adjustments: 0,
      },
      perfectSeason: true,
      comparisonStatus: 'unsupported',
      completionState: 'season',
    });
    const rejected = ApplyHavocCommand(
      unsupported,
      normalGameCommand(unsupported, 1, 'win'),
      environment,
      lockSources,
    );
    expect(rejected.result.rejection?.code).toBe('version-mismatch');
    const complete = ApplyHavocCommand(
      unsupported,
      completeCommand(unsupported),
      environment,
      lockSources,
    );
    expect(complete.result.rejection?.code).toBe('version-mismatch');
  });

  it('abandons an active run and then rejects further acceptance', () => {
    const base = buildHavocRunStateLocked();
    const started = acceptHavocGames(base, 3, () => 'win');
    const abandoned = ApplyHavocCommand(started, abandonCommand(started), environment, lockSources);
    expect(abandoned.result.status).toBe('accepted');
    expect(abandoned.state.completionState).toBe('abandoned');
    expect(abandoned.state.havocCursor).toBe(3);
    expect(abandoned.state.havocAggregate.games).toBe(3);
    expect(abandoned.state.locked).not.toBeNull();
    const accept = ApplyHavocCommand(
      abandoned.state,
      havocGameCommand(abandoned.state, 4, 'win'),
      environment,
      lockSources,
    );
    expect(accept.result.rejection?.code).toBe('already-complete');
    const again = ApplyHavocCommand(
      abandoned.state,
      abandonCommand(abandoned.state),
      environment,
      lockSources,
    );
    expect(again.result.rejection?.code).toBe('already-complete');
  });

  it('rejects create-havoc-draft through the generic dispatcher', () => {
    const base = buildHavocRunStateLocked();
    const create = buildHavocCreateCommandFixture(fixture);
    const outcome = ApplyHavocCommand(base, create, environment, lockSources);
    expect(outcome.result.status).toBe('rejected');
    expect(outcome.result.rejection?.code).toBe('phase-mismatch');
  });

  it('keeps the state digest stable and revision-sensitive', () => {
    const base = buildHavocRunStateLocked();
    const same = havocRunStateSchema.parse(JSON.parse(JSON.stringify(base)) as unknown);
    expect(HavocStateDigest(same)).toBe(HavocStateDigest(base));
    const accepted = ApplyHavocCommand(
      base,
      havocGameCommand(base, 1, 'win'),
      environment,
      lockSources,
    );
    expect(HavocStateDigest(accepted.state)).not.toBe(HavocStateDigest(base));
    expect(accepted.result.stateDigest).toBe(HavocStateDigest(accepted.state));
    expect(accepted.result.stateDigest).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('havoc draft-phase abandonment', () => {
  it('abandons a draft before the lineup is locked', () => {
    const draft = buildHavocRunState();
    const command = havocAbandonRunCommandSchema.parse({
      schemaVersion: HAVOC_SCHEMA_VERSION,
      commandId: 'cmd-draft-abandon',
      runId: draft.runId,
      expectedRevision: draft.revision,
      command: 'abandon-havoc-run',
    });
    const outcome = ApplyHavocCommand(draft, command, environment, lockSources);
    expect(outcome.result.status).toBe('accepted');
    expect(outcome.state.phase).toBe('draft');
    expect(outcome.state.completionState).toBe('abandoned');
    expect(outcome.state.draft).not.toBeNull();
    expect(outcome.state.revision).toBe(draft.revision + 1);
  });
});
