import { describe, expect, test } from 'bun:test';
import {
  commandIdSchema,
  fullCourtCreateDraftCommandSchema,
  fullCourtDraftStateSchema,
  idSchema,
  seedSchema,
  type FullCourtDraftState,
  type FullCourtReportTarget,
} from '@hoop-rush/data-contracts';
import {
  applyFullCourtCommand,
  createEngineContext,
  createFullCourtDraftState,
  fullCourtDraftIndexOf,
  fullCourtSalaryDollarsOf,
  fullCourtTrainingCampSeed,
  simulateFullCourtTrainingCamp,
  type FullCourtCatalogIndex,
  type FullCourtPlayoffOpponentPreview,
  type FullCourtRegularSeason,
} from '@hoop-rush/engine';
import { buildCapRushTestCatalog, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import { render } from 'svelte/server';
import FullCourtWarRoom from './FullCourtWarRoom.svelte';
import type { FullCourtMatchupEditorContext } from './full-court-matchup-presenter.ts';
import { fullCourtTestSeasonLock } from './full-court-test-support';

const MIN_ROSTER = 6;

function completeDraft(
  index: FullCourtCatalogIndex,
  seed: FullCourtDraftState,
): FullCourtDraftState {
  const players = [...index.catalog.candidates]
    .sort((left, right) => fullCourtSalaryDollarsOf(left) - fullCourtSalaryDollarsOf(right))
    .slice(0, MIN_ROSTER);
  const picks = players.map((player, pickOrdinal) => ({
    pickOrdinal,
    player,
    salaryDollars: fullCourtSalaryDollarsOf(player),
  }));
  return fullCourtDraftStateSchema.parse({
    ...seed,
    stage: 'complete',
    picks,
    spending: picks.map((pick, ordinal) => ({
      entryId: `fcs-${String(ordinal).padStart(32, '0')}`,
      kind: 'salary',
      dollars: pick.salaryDollars,
      commandId: commandIdSchema.parse(`cmd-war-locked-${String(ordinal)}`),
      playerVersionId: pick.player.playerVersionId,
    })),
  });
}

function setup(): {
  index: FullCourtCatalogIndex;
  draft: FullCourtDraftState;
  season: FullCourtRegularSeason;
  nextFilmTarget: { kind: 'opponent-film'; gameId: string; opponentTeamId: string };
} {
  const catalog = buildCapRushTestCatalog();
  const source = capRushTestCatalogSource(catalog);
  const index = fullCourtDraftIndexOf(catalog, source);
  const seed = createFullCourtDraftState(
    fullCourtCreateDraftCommandSchema.parse({
      command: 'create-full-court-draft',
      commandId: commandIdSchema.parse('cmd-war-room'),
      runId: idSchema.parse('run-war-room'),
      runSeed: seedSchema.parse('abc123def4567890'),
      variant: 'standard',
      catalog: source,
    }),
    index,
    { pool: 'open' },
  );
  const season = fullCourtTestSeasonLock().season;
  const fixture = season.games.find(
    (game) =>
      game.slot === 1 &&
      (game.homeTeamId === season.userTeamId || game.awayTeamId === season.userTeamId),
  );
  if (fixture === undefined) throw new Error('missing first Full Court fixture');
  const opponentTeamId =
    fixture.homeTeamId === season.userTeamId ? fixture.awayTeamId : fixture.homeTeamId;
  return {
    index,
    draft: completeDraft(index, seed),
    season,
    nextFilmTarget: {
      kind: 'opponent-film',
      gameId: fixture.gameId,
      opponentTeamId,
    },
  };
}

function buy(
  index: FullCourtCatalogIndex,
  state: FullCourtDraftState,
  target: FullCourtReportTarget,
  label: string,
): FullCourtDraftState {
  return applyFullCourtCommand(
    state,
    {
      command: 'purchase-full-court-report',
      commandId: commandIdSchema.parse(`cmd-war-${label}`),
      runId: state.runId,
      expectedRevision: state.revision,
      target,
    },
    { index },
  ).state;
}

function renderWarRoom(input: {
  draft: FullCourtDraftState;
  index: FullCourtCatalogIndex;
  season: FullCourtRegularSeason;
  nextFilmTarget: { kind: 'opponent-film'; gameId: string; opponentTeamId: string } | null;
  playoffPreview?: FullCourtPlayoffOpponentPreview | null;
  preseasonOpen?: boolean;
  practiceOpen?: boolean;
  practice?: ReturnType<typeof simulateFullCourtTrainingCamp> | null;
  matchupContext?: FullCourtMatchupEditorContext | null;
}): string {
  return render(FullCourtWarRoom, {
    props: {
      ...input,
      busy: false,
      onPurchaseReport: () => undefined,
      onRunPractice: () => undefined,
    },
  }).body;
}

describe('FullCourtWarRoom', () => {
  test('shows roster fit and league opponent film with cash prices', () => {
    const { index, draft, season, nextFilmTarget } = setup();
    const body = renderWarRoom({ draft, index, season, nextFilmTarget });

    expect(body).toContain('aria-label="Full Court War Room roster fit"');
    expect(body).toContain('aria-label="Full Court War Room opponent film"');
    expect(body).toContain('Locked roster fit');
    expect(body).toContain('League opponent film');
    expect(body).toContain('Buy roster fit');
    expect(body).toContain('Buy opponent film');
    expect(body).toContain('$5M');
    expect(body).toContain('$3M');
    expect(body).not.toContain('aria-label="Roster strengths"');
  });

  test('reveals owned roster fit strengths and league opponent weaknesses from the paid reports', () => {
    const { index, draft, season, nextFilmTarget } = setup();
    const purchased = buy(
      index,
      buy(index, draft, { kind: 'lineup-fit' }, 'fit'),
      { kind: 'opponent-film' },
      'film',
    );
    const body = renderWarRoom({ draft: purchased, index, season, nextFilmTarget });

    expect(body).toContain('Owned');
    expect(body).toContain('aria-label="Roster strengths"');
    expect(body).toContain('OVR');
    expect(body).not.toContain('Buy opponent film');
  });

  test('closes preseason purchases once the regular season has started', () => {
    const { index, draft, season, nextFilmTarget } = setup();
    const body = renderWarRoom({
      draft,
      index,
      season,
      nextFilmTarget,
      preseasonOpen: false,
    });

    expect(body).toContain('Roster fit closed before game 1.');
    expect(body).toContain('League opponent film closed before game 1.');
    expect(body).not.toContain('Buy roster fit');
    expect(body).not.toContain('Buy opponent film');
  });

  test('blocks both purchases when the budget cannot cover the prices', () => {
    const { index, draft, season, nextFilmTarget } = setup();
    const payroll = draft.picks.reduce((total, pick) => total + pick.salaryDollars, 0);
    const broke = fullCourtDraftStateSchema.parse({
      ...draft,
      money: { ...draft.money, startingWarChestDollars: payroll + 1 },
    });
    const body = renderWarRoom({ draft: broke, index, season, nextFilmTarget });

    expect(body).toContain('Budget cannot cover this report.');
    expect(body).toContain('aria-label="Buy roster fit for $5M"');
    expect(body).toContain('aria-label="Buy opponent film for $3M"');
    expect(body).not.toContain('Owned');
  });

  test('offers training camp at $5M when open and withholds it when closed', () => {
    const { index, draft, season, nextFilmTarget } = setup();
    const open = renderWarRoom({
      draft,
      index,
      season,
      nextFilmTarget,
      practiceOpen: true,
    });
    expect(open).toContain('aria-label="Full Court War Room training camp"');
    expect(open).toContain('Book training camp');
    expect(open).toContain('$5M');
    expect(open).not.toContain('Training camp closed before game 1.');

    const closed = renderWarRoom({
      draft,
      index,
      season,
      nextFilmTarget,
      practiceOpen: false,
    });
    expect(closed).toContain('Training camp closed before game 1.');
    expect(closed).not.toContain('Book training camp');
  });

  test('shows the practice rotation, bench usage, and fatigue after camp is opened', () => {
    const { index, draft, season, nextFilmTarget } = setup();
    const purchased = buy(index, draft, { kind: 'training-camp' }, 'camp');
    const practice = simulateFullCourtTrainingCamp(
      season,
      {
        seed: fullCourtTrainingCampSeed(season.runSeed, 'fcs-training-camp-report'),
        opponentTeamId: nextFilmTarget.opponentTeamId,
      },
      createEngineContext(),
    );
    const body = renderWarRoom({
      draft: purchased,
      index,
      season,
      nextFilmTarget,
      practiceOpen: true,
      practice,
    });

    expect(body).toContain('Booked');
    expect(body).toContain('aria-label="Practice summary"');
    expect(body).toContain('Scrimmage · not official');
    expect(body).toContain('Run scrimmage again');
    expect(body).toContain('Pull random');
    expect(body).toContain('Bench:');
    expect(body).toContain('Fatigue:');
    expect(body).toContain(practice.rotation[0]?.displayName ?? '');
    expect(body).not.toContain('Book training camp');
  });

  test('shows per-fixture defensive matchups in the War Room only when a next fixture exists', () => {
    const { index, draft, season, nextFilmTarget } = setup();
    const userTeam = season.teams.find((team) => team.teamId === season.userTeamId);
    const opponentTeam = season.teams.find((team) => team.teamId === nextFilmTarget.opponentTeamId);
    if (userTeam === undefined || opponentTeam === undefined) {
      throw new Error('missing teams for War Room matchup test');
    }
    const matchupContext: FullCourtMatchupEditorContext = {
      fixture: {
        gameId: nextFilmTarget.gameId,
        phase: 'regular',
        label: 'Game 1 of 82',
        dayOffset: 1,
        homeTeamId: userTeam.teamId,
        awayTeamId: opponentTeam.teamId,
        userSide: 'home',
      },
      userTeam,
      opponentTeam,
      userHealth: null,
      opponentHealth: null,
      restingPlayerIds: [],
      coachingPlan: {
        schemaVersion: 1,
        tactics: { pace: 'balanced', offense: 'balanced', defense: 'balanced' },
      },
      assignments: [],
      forGameId: null,
      forOpponentId: null,
    };

    expect(
      renderWarRoom({ draft, index, season, nextFilmTarget: null, matchupContext: null }),
    ).not.toContain('aria-label="Full Court defensive matchups"');
    const withMatchups = renderWarRoom({
      draft,
      index,
      season,
      nextFilmTarget,
      matchupContext,
    });
    expect(withMatchups).toContain('aria-label="Full Court defensive matchups"');
    expect(withMatchups).toContain('Defensive matchups');
  });
});
