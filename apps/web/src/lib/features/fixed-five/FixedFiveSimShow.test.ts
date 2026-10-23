import { describe, expect, it, mock } from 'bun:test';
import { render } from 'svelte/server';
import { seedSchema, type FixedFiveWorkerResultEntry } from '@hoop-rush/data-contracts';
import { createEngineContext, simulateGame } from '@hoop-rush/engine';
import { DEFAULT_ERA_SIM_PROFILE, buildLegalSimulationTeam } from '@hoop-rush/test-fixtures';

void mock.module('#lib/arena-sound.js', () => ({
  arenaGameResult: () => {},
  arenaLeaderChange: () => {},
  arenaStreak: () => {},
}));

describe('FixedFiveSimShow', () => {
  it('shows recovery controls when a scheduled season matchup tape fails', async () => {
    const { default: FixedFiveSimShow } = await import('./FixedFiveSimShow.svelte');
    const result = simulateGame(
      {
        schemaVersion: 2,
        seed: seedSchema.parse('a'.repeat(16)),
        gameNumber: 1,
        dataVersion: 'fixture',
        profile: DEFAULT_ERA_SIM_PROFILE,
        home: buildLegalSimulationTeam({ teamId: 'p1' }),
        away: buildLegalSimulationTeam({ teamId: 'p2' }),
      },
      createEngineContext(),
    );
    const entries = Array.from({ length: 39 }, (_, index) => {
      const game = { ...result, gameNumber: index + 1 };
      return [
        { tag: 'p1', game },
        { tag: 'p2', game },
      ] as FixedFiveWorkerResultEntry[];
    }).flat();
    const html = render(FixedFiveSimShow, {
      props: {
        mode: 'classic-shared-82',
        progress: { completed: 78, total: 161 },
        entries,
        selfId: 'p1',
        h2hError: 'the fixed-five worker crashed',
        onRetryH2H: () => {},
      },
    }).body;

    expect(html).toContain('78/161 games');
    expect(html).toContain('48% of games revealed');
    expect(html).toContain('the fixed-five worker crashed');
    expect(html).toContain('Retry head-to-head game');

    const pendingHtml = render(FixedFiveSimShow, {
      props: {
        mode: 'classic-shared-82',
        progress: { completed: 78, total: 161 },
        entries,
        selfId: 'p1',
        h2hPendingGame: 40,
        onContinueH2H: () => {},
        onRetryH2H: () => {},
      },
    }).body;
    expect(pendingHtml).toContain('Head-to-head game 40 is next');
    expect(pendingHtml).toContain('Continue to head-to-head game');
    expect(pendingHtml).not.toContain('Retry head-to-head game');
  });
});
