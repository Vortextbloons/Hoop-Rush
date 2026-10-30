import { describe, expect, it, mock } from 'bun:test';
import { render } from 'svelte/server';
import {
  HAVOC_SCHEMA_VERSION,
  havocBattleResultSchema,
  havocBattleTapeSchema,
  havocDigestSchema,
  havocMultiplayerSeriesSnapshotSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { createEngineContext, simulateRecordedGame } from '@hoop-rush/engine';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildHavocGameResult,
  buildLegalSimulationTeam,
} from '@hoop-rush/test-fixtures';
import type { HavocMultiplayerGameOutput } from '@hoop-rush/persistence';
import type { GamecastRecordedGame, GamecastSeries } from './gamecast-types';
import { gamecastVisibleState } from './gamecast-playback';
import GamecastBroadcast from './GamecastBroadcast.svelte';
import GamecastRecap from './GamecastRecap.svelte';
import HavocMultiplayerGameResults from '../features/havoc-multiplayer/HavocMultiplayerGameResults.svelte';

void mock.module('@lucide/svelte', () => ({
  Clock: () => {},
  ShieldAlert: () => {},
  ShieldCheck: () => {},
}));

void mock.module('#lib/components/PlayerArt.svelte', () => ({ default: () => {} }));

function buildGamecastOutput(gameNumber = 2): GamecastRecordedGame {
  const seed = seedSchema.parse('a'.repeat(16));
  const recorded = simulateRecordedGame(
    {
      schemaVersion: 2,
      seed,
      gameNumber,
      dataVersion: 'fixture',
      profile: DEFAULT_ERA_SIM_PROFILE,
      home: buildLegalSimulationTeam({ teamId: 'p1' }),
      away: buildLegalSimulationTeam({ teamId: 'p2' }),
    },
    createEngineContext(),
  );
  return {
    gameNumber,
    homeParticipantId: 'p1',
    awayParticipantId: 'p2',
    result: recorded.result,
    tape: recorded.tape,
  };
}

function gamecastSeries(currentGameNumber: number | null): GamecastSeries {
  return {
    games: [],
    p1Wins: 0,
    p2Wins: 0,
    currentGameNumber,
    champion: null,
  };
}

const noop = () => {};

describe('shared gamecast multiplayer presentation', () => {
  it('marks the top scorer in each team box, preserving ties', () => {
    const output = buildGamecastOutput();
    output.result.home.players.forEach((player, index) => {
      player.points = [20, 20, 4, 3, 2][index] ?? 0;
    });
    output.result.away.players.forEach((player, index) => {
      player.points = [12, 4, 3, 2, 1][index] ?? 0;
    });

    const visible = gamecastVisibleState(output, 0);
    visible.homePlayerLines.forEach((line, index) => {
      line[0] = [20, 20, 0, 0, 0][index] ?? 0;
    });
    visible.awayPlayerLines.forEach((line, index) => {
      line[0] = [12, 4, 0, 0, 0][index] ?? 0;
    });

    const broadcast = render(GamecastBroadcast, {
      props: {
        output,
        visible,
        progress: 0.5,
        localParticipantId: 'p1',
        feed: [],
      },
    }).body;
    expect(broadcast.match(/Top scorer/g) ?? []).toHaveLength(3);

    const recap = render(GamecastRecap, {
      props: {
        output,
        series: gamecastSeries(2),
        localParticipantId: 'p1',
        verification: 'pending',
        readyCountdownMs: null,
        localReady: false,
        onready: noop,
        awaitingContinue: false,
        oncontinue: noop,
      },
    }).body;
    expect(recap.match(/Top scorer/g) ?? []).toHaveLength(3);
  });

  it('leaves top scorer unmarked when a team has no points', () => {
    const output = buildGamecastOutput();
    for (const team of [output.result.home, output.result.away]) {
      for (const player of team.players) player.points = 0;
    }
    const visible = gamecastVisibleState(output, 0);

    const broadcast = render(GamecastBroadcast, {
      props: {
        output,
        visible,
        progress: 0.5,
        localParticipantId: 'p1',
        feed: [],
      },
    }).body;
    expect(broadcast).not.toContain('Top scorer');

    const recap = render(GamecastRecap, {
      props: {
        output,
        series: gamecastSeries(2),
        localParticipantId: 'p1',
        verification: 'pending',
        readyCountdownMs: null,
        localReady: false,
        onready: noop,
        awaitingContinue: false,
        oncontinue: noop,
      },
    }).body;
    expect(recap).not.toContain('Top scorer');
  });

  it('waits for the finished game to be accepted before announcing a next game', () => {
    const output = buildGamecastOutput(2);
    const html = render(GamecastRecap, {
      props: {
        output,
        series: gamecastSeries(2),
        localParticipantId: 'p1',
        verification: 'pending',
        readyCountdownMs: null,
        localReady: false,
        onready: noop,
        awaitingContinue: false,
        oncontinue: noop,
      },
    }).body;

    expect(html).toContain('Waiting for opponent');
    expect(html).not.toContain('Game 2 is next.');
    expect(html).not.toContain('Ready for Game 2');
  });

  it('keeps the review stage distinct from the next-game ready check', () => {
    const output = buildGamecastOutput(2);
    const html = render(GamecastRecap, {
      props: {
        output,
        series: gamecastSeries(2),
        localParticipantId: 'p1',
        verification: 'verified',
        readyCountdownMs: null,
        localReady: false,
        onready: noop,
        awaitingContinue: true,
        oncontinue: noop,
      },
    }).body;

    expect(html).toContain('Game 2 is under review.');
    expect(html).toContain('>Continue<');
    expect(html).not.toContain('Game 2 is next.');
    expect(html).not.toContain('Ready for Game 2');
  });

  it('offers readiness only once the series authorizes the next game', () => {
    const output = buildGamecastOutput(2);
    const html = render(GamecastRecap, {
      props: {
        output,
        series: gamecastSeries(3),
        localParticipantId: 'p1',
        verification: 'verified',
        readyCountdownMs: null,
        localReady: false,
        onready: noop,
        awaitingContinue: false,
        oncontinue: noop,
      },
    }).body;

    expect(html).toContain('Game 3 is next.');
    expect(html).toContain('Ready for Game 3');
  });
});

function havocSeries(
  firstStatus: 'proposed' | 'verified',
  firstWinner: 'p1' | 'p2',
): ReturnType<typeof havocMultiplayerSeriesSnapshotSchema.parse> {
  const digest = havocDigestSchema.parse('a'.repeat(32));
  const homes = ['p1', 'p1', 'p2', 'p2', 'p1', 'p2', 'p1'] as const;
  return havocMultiplayerSeriesSnapshotSchema.parse({
    wins:
      firstStatus === 'verified'
        ? { p1: firstWinner === 'p1' ? 1 : 0, p2: firstWinner === 'p2' ? 1 : 0 }
        : { p1: 0, p2: 0 },
    games: homes.map((homeParticipantId, index) => {
      const gameNumber = index + 1;
      const decided = gameNumber === 1;
      return {
        gameNumber,
        homeParticipantId,
        awayParticipantId: homeParticipantId === 'p1' ? 'p2' : 'p1',
        status: decided ? firstStatus : 'scheduled',
        winner: decided ? firstWinner : null,
        inputDigest: decided ? digest : null,
        resultDigest: decided ? digest : null,
        tapeDigest: decided ? digest : null,
      };
    }),
    champion: null,
  });
}

function buildHavocOutput(): HavocMultiplayerGameOutput {
  const result = havocBattleResultSchema.parse(buildHavocGameResult());
  return {
    roomId: 'room-ui',
    gameNumber: 1,
    winner: 'p1',
    result,
    tape: havocBattleTapeSchema.parse({
      schemaVersion: HAVOC_SCHEMA_VERSION,
      gameNumber: 1,
      variant: result.variant,
      seed: result.seed,
      events: [],
      scoring: [],
    }),
    inputDigest: 'a'.repeat(32),
    resultDigest: 'b'.repeat(32),
    tapeDigest: 'c'.repeat(32),
  };
}

describe('Havoc multiplayer results presentation', () => {
  it('does not offer a ready check for the game still awaiting acceptance', () => {
    const html = render(HavocMultiplayerGameResults, {
      props: {
        output: buildHavocOutput(),
        series: havocSeries('proposed', 'p1'),
        localParticipantId: 'p1',
        verification: 'pending',
        readyCountdownMs: null,
        localReady: false,
        awaitingContinue: false,
        onready: noop,
        oncontinue: noop,
      },
    }).body;

    expect(html).toContain('Waiting for opponent');
    expect(html).not.toContain('Game 1 is next.');
    expect(html).not.toContain('Ready for Game 1');
  });

  it('offers a ready check for the next authoritative game', () => {
    const html = render(HavocMultiplayerGameResults, {
      props: {
        output: buildHavocOutput(),
        series: havocSeries('verified', 'p1'),
        localParticipantId: 'p1',
        verification: 'verified',
        readyCountdownMs: null,
        localReady: false,
        awaitingContinue: false,
        onready: noop,
        oncontinue: noop,
      },
    }).body;

    expect(html).toContain('Game 2 is next.');
    expect(html).toContain('Ready for Game 2');
  });
});
