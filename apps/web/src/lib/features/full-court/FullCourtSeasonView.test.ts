import { describe, expect, test } from 'bun:test';
import {
  createFullCourtSeasonCheckpoint,
  fullCourtPlayoffView,
  type FullCourtSeasonLock,
} from '@hoop-rush/engine';
import { render } from 'svelte/server';
import type { FullCourtPlayoffView } from './full-court-season-presenter';
import { fullCourtTestPlayoffLock, fullCourtTestSeasonLock } from './full-court-test-support';
import FullCourtSeasonView from './FullCourtSeasonView.svelte';

const lock = fullCourtTestSeasonLock();
const userTeamId = lock.season.userTeamId;
const opened = createFullCourtSeasonCheckpoint(lock);
const completed = { ...opened, completedThroughSlot: 82 };

function renderView(input: {
  section?: 'home' | 'league' | 'playoffs';
  lock?: FullCourtSeasonLock;
  checkpoint?: typeof opened;
  playoff?: FullCourtPlayoffView | null;
  pendingForfeit?: boolean;
}): string {
  return render(FullCourtSeasonView, {
    props: {
      lock: input.lock ?? lock,
      checkpoint: input.checkpoint ?? opened,
      scores: [],
      playoff: input.playoff ?? null,
      pendingForfeit: input.pendingForfeit ?? false,
      busy: false,
      onAdvance: () => {},
      onStartPlayoffs: () => {},
      ...(input.section === undefined ? {} : { section: input.section }),
    },
  }).body;
}

function bracketView(): FullCourtPlayoffView {
  const playoffs = fullCourtTestPlayoffLock(lock);
  return fullCourtPlayoffView(playoffs.lock, playoffs.checkpoint);
}

describe('FullCourtSeasonView sections', () => {
  test('keeps the existing props working without a section', () => {
    const body = renderView({});
    expect(body).toContain('aria-label="Full Court season progress"');
    expect(body).toContain('Sim next game');
    expect(body).not.toContain('aria-label="Full Court regular season"');
  });

  test('home leads with the next matchup and the season record', () => {
    const body = renderView({ section: 'home' });
    expect(body).toContain('Game 1 of 82');
    expect(body).toContain('Next game');
    expect(body).toContain('Latest Full Court result');
    expect(body).not.toContain('aria-label="Full Court standings"');
  });

  test('home shows the playoff primary action during the bracket', () => {
    const body = renderView({
      section: 'home',
      checkpoint: completed,
      playoff: bracketView(),
    });
    expect(body).toContain('Postseason');
    expect(body).toContain('Sim next game');
    expect(body).toContain('Full Court postseason status');
  });

  test('home replaces sim actions with the terminal recap after a champion', () => {
    const body = renderView({
      section: 'home',
      checkpoint: completed,
      playoff: { ...bracketView(), championTeamId: userTeamId, nextGame: null },
    });
    expect(body).toContain('aria-label="Full Court final recap"');
    expect(body).toContain('Full Court champions');
    expect(body).not.toContain('Sim next game');
    expect(body).not.toContain('Start playoffs');
  });

  test('league holds the schedule and both conference tables', () => {
    const body = renderView({ section: 'league' });
    expect(body).toContain('aria-label="Full Court regular season"');
    expect(body).toContain('aria-label="Full Court standings"');
    expect(body).toContain('West Full Court standings');
    expect(body).toContain('East Full Court standings');
    expect(body).not.toContain('Game 1 of 82');
    expect(body).not.toContain('aria-label="Full Court final recap"');
  });

  test('playoffs lists the series and bracket, not the schedule', () => {
    const body = renderView({
      section: 'playoffs',
      checkpoint: completed,
      playoff: bracketView(),
    });
    expect(body).toContain('aria-label="Full Court playoff bracket"');
    expect(body).toContain('Four rounds to the title');
    expect(body).toContain('aria-label="Your playoff series"');
    expect(body).not.toContain('aria-label="Full Court regular season"');
  });

  test('playoffs before the bracket explains the 82-game gate', () => {
    const body = renderView({ section: 'playoffs' });
    expect(body).toContain('The bracket opens after 82 games');
    expect(body).not.toContain('Start playoffs');
  });

  test('playoffs offers seeding once the regular season is complete', () => {
    const body = renderView({ section: 'playoffs', checkpoint: completed });
    expect(body).toContain('The bracket is ready to seed');
    expect(body).toContain('Start playoffs');
  });
});

test('forfeit confirmation replaces the sim actions with the alert', () => {
  const body = renderView({ section: 'home', pendingForfeit: true });
  expect(body).toContain('Confirm the forfeit');
  expect(body).toContain('Confirm forfeit');
  expect(body).not.toContain('Sim remaining games');
  expect(body).not.toContain('Sim next game');
});
