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
  createFullCourtDraftState,
  fullCourtDraftIndexOf,
  fullCourtSalaryDollarsOf,
  type FullCourtCatalogIndex,
  type FullCourtPlayoffOpponentPreview,
  type FullCourtRegularSeason,
} from '@hoop-rush/engine';
import { buildCapRushTestCatalog, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import { render } from 'svelte/server';
import FullCourtWarRoom from './FullCourtWarRoom.svelte';
import { fullCourtTestSeasonLock } from './full-court-test-support';

const MIN_ROSTER = 6;

function completeDraft(
  index: FullCourtCatalogIndex,
  seed: FullCourtDraftState,
): FullCourtDraftState {
  const players = index.catalog.candidates.slice(0, MIN_ROSTER);
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
  nextFilmTarget: Extract<FullCourtReportTarget, { kind: 'opponent-film' }>;
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
  nextFilmTarget: Extract<FullCourtReportTarget, { kind: 'opponent-film' }> | null;
  playoffPreview?: FullCourtPlayoffOpponentPreview | null;
}): string {
  return render(FullCourtWarRoom, {
    props: {
      ...input,
      busy: false,
      onPurchaseReport: () => undefined,
    },
  }).body;
}

describe('FullCourtWarRoom', () => {
  test('shows free roster and opponent information with both purchase prices and scopes', () => {
    const { index, draft, season, nextFilmTarget } = setup();
    const body = renderWarRoom({ draft, index, season, nextFilmTarget });
    const opponent = season.teams.find((team) => team.teamId === nextFilmTarget.opponentTeamId);
    if (opponent === undefined) throw new Error('missing opponent team');

    expect(body).toContain('aria-label="Full Court War Room roster fit"');
    expect(body).toContain('aria-label="Full Court War Room opponent film"');
    expect(body).toContain('Locked roster fit');
    expect(body).toContain('Next-game opponent film');
    expect(body).toContain('Buy roster fit');
    expect(body).toContain('Buy opponent film');
    expect(body).toContain('Lifetime of this run');
    expect(body).toContain('This game only');
    expect(body).toContain('5 CR');
    expect(body).toContain('3 CR');
    expect(body).toContain('Starters:');
    expect(body).toContain('Historical rotation input, never a played result.');
    expect(body).not.toContain('aria-label="Roster strengths"');
    expect(body).toContain(opponent.displayName);
  });

  test('reveals owned roster fit strengths and opponent film evidence from the paid reports', () => {
    const { index, draft, season, nextFilmTarget } = setup();
    const purchased = buy(
      index,
      buy(index, draft, { kind: 'lineup-fit' }, 'fit'),
      nextFilmTarget,
      'film',
    );
    const body = renderWarRoom({ draft: purchased, index, season, nextFilmTarget });

    expect(body).toContain('Owned');
    expect(body).toContain('aria-label="Roster strengths"');
    expect(body).toContain('Spacing volume');
    expect(body).toContain('PG 95');
    expect(body).toContain('aria-label="Opponent rotation"');
    expect(body).toContain('Starter');
    expect(body).toContain('aria-label="Opponent shot profile"');
    expect(body).toContain('aria-label="Opponent defensive profile"');
    expect(body).toContain('Rim oriented');
    expect(body).toContain('SG 73');
    expect(body).not.toContain('Buy opponent film');
  });

  test('labels opponent players left out when historical minutes are unavailable', () => {
    const { index, draft, season, nextFilmTarget } = setup();
    const purchased = buy(index, draft, nextFilmTarget, 'film-missing-minutes');
    const opponent = season.teams.find((team) => team.teamId === nextFilmTarget.opponentTeamId);
    if (opponent === undefined) throw new Error('missing opponent team');
    const removed = opponent.roster[0];
    const modifiedSeason: FullCourtRegularSeason = {
      ...season,
      teams: season.teams.map((team) =>
        team.teamId === opponent.teamId
          ? {
              ...team,
              roster: team.roster.map((player) =>
                player.playerId === removed?.playerId ? { ...player, anchors: undefined } : player,
              ),
            }
          : team,
      ),
    };
    const body = renderWarRoom({
      draft: purchased,
      index,
      season: modifiedSeason,
      nextFilmTarget,
    });

    expect(body).toContain(`No historical minutes for ${removed?.displayName ?? ''}`);
    expect(body).toContain('left out of the film');
  });

  test('labels a missing starting lineup instead of inventing starters', () => {
    const { index, draft, season, nextFilmTarget } = setup();
    const modifiedSeason: FullCourtRegularSeason = {
      ...season,
      teams: season.teams.map((team) =>
        team.teamId === nextFilmTarget.opponentTeamId ? { ...team, rotation: undefined } : team,
      ),
    };
    const body = renderWarRoom({ draft, index, season: modifiedSeason, nextFilmTarget });

    expect(body).toContain('Starting lineup evidence unavailable.');
  });

  test('blocks both purchases when the War Chest cannot cover the prices', () => {
    const { index, draft, season, nextFilmTarget } = setup();
    const payroll = draft.picks.reduce((total, pick) => total + pick.salaryDollars, 0);
    const broke = fullCourtDraftStateSchema.parse({
      ...draft,
      money: { ...draft.money, startingWarChestDollars: payroll + 1 },
    });
    const body = renderWarRoom({ draft: broke, index, season, nextFilmTarget });

    expect(body).toContain('The War Chest cannot cover this report.');
    expect(body).toContain('aria-label="Buy roster fit for 5 CR"');
    expect(body).toContain('aria-label="Buy opponent film for 3 CR"');
    expect(body).not.toContain('Owned');
  });

  test('reveals purchased postseason opponent film and shows active playoff adaptation reason', () => {
    const { index, draft, season } = setup();
    const opponent = season.teams.find((team) => team.teamId !== season.userTeamId);
    if (opponent === undefined) throw new Error('missing playoff opponent');
    const playoffFilmTarget: Extract<FullCourtReportTarget, { kind: 'opponent-film' }> = {
      kind: 'opponent-film',
      gameId: 'fcp-1-3-3',
      opponentTeamId: opponent.teamId,
    };
    const purchased = buy(index, draft, playoffFilmTarget, 'playoff-film');
    const playoffPreview: FullCourtPlayoffOpponentPreview = {
      gameId: playoffFilmTarget.gameId,
      round: 1,
      seriesSlot: 3,
      gameOrdinal: 3,
      homeTeamId: season.userTeamId,
      awayTeamId: opponent.teamId,
      homeSeed: 1,
      awaySeed: 8,
      userSide: 'home',
      opponentTeamId: opponent.teamId,
      priorPlayedGames: 2,
      adaptation: {
        defense: 'protect-paint',
        reason: 'persistent-inside-scoring',
        sampleGames: 2,
        windowGames: 2,
        observedShareBps: 4920,
        thresholdShareBps: 4600,
      },
    };
    const body = renderWarRoom({
      draft: purchased,
      index,
      season,
      nextFilmTarget: playoffFilmTarget,
      playoffPreview,
    });

    expect(body).toContain('Game 3 · First round');
    expect(body).toContain(opponent.displayName);
    expect(body).toContain('aria-label="Opponent rotation"');
    expect(body).toContain('Series opponent adjustment');
    expect(body).toContain('Protect paint');
    expect(body).toContain('Persistent inside scoring');
    expect(body).toContain('49.2% rim share across 2 played games (threshold 46%).');
  });
});
