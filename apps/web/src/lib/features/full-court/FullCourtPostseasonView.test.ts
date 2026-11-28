import { describe, expect, test } from 'bun:test';
import { createFullCourtSeasonCheckpoint, fullCourtPlayoffView } from '@hoop-rush/engine';
import { render } from 'svelte/server';
import FullCourtPostseasonView from './FullCourtPostseasonView.svelte';
import { fullCourtTestPlayoffLock, fullCourtTestSeasonLock } from './full-court-test-support';

const lock = fullCourtTestSeasonLock();
const regular = createFullCourtSeasonCheckpoint(lock);
const completed = { ...regular, completedThroughSlot: 82 };
const playoffs = fullCourtTestPlayoffLock(lock);
const playoff = fullCourtPlayoffView(playoffs.lock, playoffs.checkpoint);

function renderPostseason(input: { playoff?: typeof playoff | null; checkpoint?: typeof regular }) {
  return render(FullCourtPostseasonView, {
    props: {
      lock,
      checkpoint: input.checkpoint ?? completed,
      playoff: input.playoff === undefined ? playoff : input.playoff,
      standings: playoffs.lock.standings,
      pendingForfeit: false,
      busy: false,
      onAdvance: () => {},
      onStartPlayoffs: () => {},
    },
  }).body;
}

describe('FullCourtPostseasonView', () => {
  test('seeds the bracket from the postseason screen itself', () => {
    const body = renderPostseason({ playoff: null });
    expect(body).toContain('aria-label="Full Court postseason"');
    expect(body).toContain('The bracket is ready to seed');
    expect(body).toContain('Start playoffs');
    expect(body).not.toContain('aria-label="Full Court playoff bracket"');
  });

  test('shows the Cap Rush bracket with the user series', () => {
    const body = renderPostseason({});
    expect(body).toContain('aria-label="Your playoff series"');
    expect(body).toContain('Sim next game');
    expect(body).toContain('Sim series');
    expect(body).toContain('aria-label="Full Court playoff bracket"');
    expect(body).toContain('Western Conference');
    expect(body).toContain('Eastern Conference');
    expect(body).toContain('NBA Finals');
    expect(body).toContain('Champion');
  });

  test('crowns the champion and stops offering sims', () => {
    const crowned = { ...playoff, championTeamId: lock.season.userTeamId, nextGame: null };
    const body = renderPostseason({ playoff: crowned });
    expect(body).toContain('Champions.');
    expect(body).toContain('Bracket complete');
    expect(body).not.toContain('Sim next game');
  });

  test('tells a non-qualifier the bracket runs without them', () => {
    const out = {
      ...playoff,
      userOutcome: { status: 'not-qualified' as const, round: null },
      series: playoff.series.filter(
        (entry) =>
          entry.highTeamId !== lock.season.userTeamId && entry.lowTeamId !== lock.season.userTeamId,
      ),
    };
    const body = renderPostseason({ playoff: out });
    expect(body).toContain('The field closed without you');
    expect(body).toContain('Not in the bracket');
    expect(body).toContain('Sim rest of bracket');
    expect(body).not.toContain('Sim series');
  });
});
