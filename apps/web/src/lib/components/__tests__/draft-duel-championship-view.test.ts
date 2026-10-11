import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import {
  DRAFT_DUEL_TAPE_VERSION,
  SHOT_ZONES,
  contentHashSchema,
  draftDuelCardSchema,
  idSchema,
  playerIdSchema,
  seedSchema,
  type DraftDuelCard,
  type DraftDuelGameOutput,
  type DraftDuelParticipantId,
  type DraftDuelSeriesMvp,
  type DraftDuelSeriesSnapshot,
  type DraftDuelStandout,
  type PlayerBoxScore,
  type TeamResult,
} from '@hoop-rush/data-contracts';
import ChampionshipView from '$lib/draft-duel/ChampionshipView.svelte';

const P1_PLAYERS = ['dd-a', 'dd-b', 'dd-c', 'dd-d', 'dd-e'] as const;
const P2_PLAYERS = ['dd-v', 'dd-w', 'dd-x', 'dd-y', 'dd-z'] as const;
const P1_NAMES = ['Alpha Ace', 'Beta Beast', 'Gamma Guard', 'Delta Wing', 'Echo Big'];
const P2_NAMES = ['Vet Vic', 'Wing Wes', 'Xtra X', 'Young Yan', 'Zeta Zed'];
const P1_REBOUNDS = [4, 12, 3, 6, 5];
const P1_ASSISTS = [3, 2, 9, 4, 2];
const P2_REBOUNDS = [5, 11, 4, 6, 5];
const P2_ASSISTS = [3, 2, 8, 3, 2];

interface GameSpec {
  gameNumber: number;
  homeParticipantId: DraftDuelParticipantId;
  p1Points: readonly number[];
  p2Points: readonly number[];
  overtimePeriods?: number;
}

const GAME_SPECS: GameSpec[] = [
  {
    gameNumber: 1,
    homeParticipantId: 'p1',
    p1Points: [30, 22, 20, 19, 19],
    p2Points: [28, 20, 18, 18, 17],
  },
  {
    gameNumber: 2,
    homeParticipantId: 'p1',
    p1Points: [26, 20, 20, 19, 19],
    p2Points: [30, 18, 18, 16, 16],
  },
  {
    gameNumber: 3,
    homeParticipantId: 'p2',
    p1Points: [20, 19, 19, 19, 18],
    p2Points: [35, 20, 18, 17, 17],
  },
  {
    gameNumber: 4,
    homeParticipantId: 'p2',
    p1Points: [34, 22, 22, 20, 20],
    p2Points: [28, 22, 20, 17, 17],
  },
  {
    gameNumber: 5,
    homeParticipantId: 'p1',
    p1Points: [24, 20, 20, 19, 19],
    p2Points: [30, 20, 18, 16, 15],
    overtimePeriods: 1,
  },
];

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function playerBox(playerId: string, points: number, rebounds: number, assists: number) {
  return {
    playerId: playerIdSchema.parse(playerId),
    minutes: 34,
    points,
    fieldGoals: { made: 10, attempted: 20 },
    threes: { made: 2, attempted: 6 },
    freeThrows: { made: 4, attempted: 5 },
    rebounds: { total: rebounds, offensive: 2, defensive: Math.max(0, rebounds - 2) },
    assists,
    steals: 1,
    blocks: 0,
    turnovers: 2,
    fouls: 2,
  } satisfies PlayerBoxScore;
}

function teamResult(participantId: DraftDuelParticipantId, points: readonly number[]): TeamResult {
  const isP1 = participantId === 'p1';
  const players = (isP1 ? P1_PLAYERS : P2_PLAYERS).map((playerId, slot) =>
    playerBox(
      playerId,
      points[slot] ?? 0,
      (isP1 ? P1_REBOUNDS : P2_REBOUNDS)[slot] ?? 0,
      (isP1 ? P1_ASSISTS : P2_ASSISTS)[slot] ?? 0,
    ),
  );
  const teamId = `draft-duel-${participantId}`;
  return {
    teamId,
    displayName: `Draft Duel ${participantId.toUpperCase()}`,
    box: {
      teamId,
      points: sum(points),
      fieldGoals: isP1 ? { made: 40, attempted: 80 } : { made: 36, attempted: 90 },
      threes: isP1 ? { made: 12, attempted: 30 } : { made: 9, attempted: 30 },
      freeThrows: { made: 15, attempted: 18 },
      rebounds: { total: isP1 ? 44 : 40, offensive: 9, defensive: 31, team: 4 },
      assists: isP1 ? 20 : 18,
      steals: 8,
      blocks: 4,
      turnovers: isP1 ? 12 : 15,
      fouls: 20,
      possessions: 98,
    },
    players,
    shotZones: SHOT_ZONES.map((zone) => ({ zone, attempts: 10, makes: 4 })),
  };
}

function buildOutput(spec: GameSpec): DraftDuelGameOutput {
  const homeIsP1 = spec.homeParticipantId === 'p1';
  const homePoints = homeIsP1 ? spec.p1Points : spec.p2Points;
  const awayPoints = homeIsP1 ? spec.p2Points : spec.p1Points;
  const awayParticipantId: DraftDuelParticipantId = homeIsP1 ? 'p2' : 'p1';
  const seed = seedSchema.parse(spec.gameNumber.toString(16).padStart(16, '0'));
  return {
    schemaVersion: DRAFT_DUEL_TAPE_VERSION,
    roomId: idSchema.parse('dd-championship-room'),
    gameNumber: spec.gameNumber,
    homeParticipantId: spec.homeParticipantId,
    awayParticipantId,
    seed,
    result: {
      schemaVersion: 1,
      gameNumber: spec.gameNumber,
      seed,
      engineVersion: 'engine-test',
      dataVersion: 'data-test',
      profileVersion: 'profile-test',
      home: teamResult(spec.homeParticipantId, homePoints),
      away: teamResult(awayParticipantId, awayPoints),
      periodScores: { home: [25, 25, 25, 25], away: [22, 22, 22, 22] },
      winner: sum(homePoints) >= sum(awayPoints) ? 'home' : 'away',
      overtimePeriods: spec.overtimePeriods ?? 0,
      facts: [],
    },
    tape: [],
    inputDigest: contentHashSchema.parse('b'.repeat(64)),
    resultDigest: contentHashSchema.parse('c'.repeat(64)),
    tapeDigest: contentHashSchema.parse('d'.repeat(64)),
  };
}

function card(index: number, playerId: string, displayName: string): DraftDuelCard {
  return draftDuelCardSchema.parse({
    cardId: `card-${index.toString(16).padStart(32, '0')}`,
    playerId,
    playerVersionId: `pv-${(index + 1).toString(16).padStart(32, '0')}`,
    displayName,
    seasonKey: '1990-91',
    franchiseId: 'lakers',
    eraId: '1990s',
    positions: ['PG'],
    overall: 82,
    bandIndex: 4,
  });
}

const CARDS: Record<string, DraftDuelCard> = {};
for (const [index, playerId] of P1_PLAYERS.entries()) {
  CARDS[playerId] = card(index, playerId, P1_NAMES[index] ?? playerId);
}
for (const [index, playerId] of P2_PLAYERS.entries()) {
  CARDS[playerId] = card(16 + index, playerId, P2_NAMES[index] ?? playerId);
}

function makeSeries(): DraftDuelSeriesSnapshot {
  return {
    homeWinner: 'p1',
    games: GAME_SPECS.map((spec) => ({
      gameNumber: spec.gameNumber,
      homeParticipantId: spec.homeParticipantId,
      awayParticipantId: spec.homeParticipantId === 'p1' ? 'p2' : 'p1',
      winner: sum(spec.p1Points) >= sum(spec.p2Points) ? 'p1' : 'p2',
    })),
    p1Wins: 4,
    p2Wins: 1,
    currentGameNumber: null,
    champion: 'p1',
  };
}

function makeMvp(): DraftDuelSeriesMvp {
  return {
    participantId: 'p1',
    playerId: playerIdSchema.parse('dd-a'),
    playerVersionId: 'pv-00000000000000000000000000000001',
    displayName: 'Alpha Ace',
    games: 5,
    points: 134,
    rebounds: 20,
    assists: 15,
    gameScoreSum: 150.5,
  };
}

function makeStandouts(): DraftDuelStandout[] {
  return [
    {
      participantId: 'p1',
      playerId: playerIdSchema.parse('dd-a'),
      displayName: 'Alpha Ace',
      gameNumber: 1,
      points: 30,
      rebounds: 4,
      assists: 3,
    },
    {
      participantId: 'p2',
      playerId: playerIdSchema.parse('dd-v'),
      displayName: 'Vet Vic',
      gameNumber: 3,
      points: 35,
      rebounds: 5,
      assists: 3,
    },
  ];
}

type ChampionshipProps = ComponentProps<typeof ChampionshipView>;

function baseProps(overrides: Partial<ChampionshipProps> = {}): ChampionshipProps {
  return {
    series: makeSeries(),
    mvp: makeMvp(),
    standouts: makeStandouts(),
    localParticipantId: 'p1',
    games: GAME_SPECS.map(buildOutput),
    cards: CARDS,
    manifest: null,
    rematchRequested: false,
    rematchConfirmed: false,
    onrematch: vi.fn(),
    onconfirmrematch: vi.fn(),
    ...overrides,
  };
}

describe('ChampionshipView', () => {
  it('confirms an opponent request and blocks duplicate clicks while busy', async () => {
    const onconfirmrematch = vi.fn();
    const props = { ...baseProps(), rematchRequested: true, onconfirmrematch };
    const { getByRole, rerender } = render(ChampionshipView, { props });
    await fireEvent.click(getByRole('button', { name: 'Confirm rematch' }));
    expect(onconfirmrematch).toHaveBeenCalledTimes(1);
    await rerender({ ...props, rematchBusy: true });
    expect(
      (getByRole('button', { name: 'Preparing rematch…' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it('shows a waiting state after requesting a rematch', () => {
    const { getByText, queryByRole } = render(ChampionshipView, {
      props: { ...baseProps(), localRematchRequested: true },
    });
    expect(getByText('Waiting for your opponent to accept the rematch.')).toBeTruthy();
    expect(queryByRole('button', { name: 'Request rematch' })).toBeNull();
  });
  it('renders the champion hero with the series score', () => {
    const { getByText, getByLabelText } = render(ChampionshipView, { props: baseProps() });
    expect(getByText('You are the champion')).toBeTruthy();
    expect(getByLabelText('Series score you 4 to 1')).toBeTruthy();
    expect(getByText('You win the best-of-seven · first to four.')).toBeTruthy();
  });

  it('builds the series comparison from the recorded box scores', () => {
    const { getByRole } = render(ChampionshipView, { props: baseProps() });
    const region = getByRole('region', { name: 'Series comparison' });
    const rows = region.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(6);
    expect(rows[0]?.textContent).toContain('105.8');
    expect(rows[0]?.textContent).toContain('101.8');
    expect(rows[1]?.textContent).toContain('50.0%');
    expect(rows[1]?.textContent).toContain('40.0%');
    expect(rows[2]?.textContent).toContain('40.0%');
    expect(rows[2]?.textContent).toContain('30.0%');
    expect(rows[3]?.textContent).toContain('44.0');
    expect(rows[3]?.textContent).toContain('40.0');
    expect(rows[4]?.textContent).toContain('20.0');
    expect(rows[4]?.textContent).toContain('18.0');
    expect(rows[5]?.textContent).toContain('12.0');
    expect(rows[5]?.textContent).toContain('15.0');
  });

  it('ranks series leaders for both fives', () => {
    const { getByRole } = render(ChampionshipView, { props: baseProps() });
    const region = getByRole('region', { name: 'Series leaders' });
    const rows = region.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('Alpha Ace');
    expect(rows[0]?.textContent).toContain('26.8');
    expect(rows[0]?.textContent).toContain('Vet Vic');
    expect(rows[0]?.textContent).toContain('30.2');
    expect(rows[1]?.textContent).toContain('Beta Beast');
    expect(rows[1]?.textContent).toContain('12.0');
    expect(rows[1]?.textContent).toContain('Wing Wes');
    expect(rows[1]?.textContent).toContain('11.0');
    expect(rows[2]?.textContent).toContain('Gamma Guard');
    expect(rows[2]?.textContent).toContain('9.0');
    expect(rows[2]?.textContent).toContain('Xtra X');
    expect(rows[2]?.textContent).toContain('8.0');
  });

  it('shows the MVP with per-game averages and totals', () => {
    const { getByRole } = render(ChampionshipView, { props: baseProps() });
    const region = getByRole('region', { name: 'Series MVP' });
    expect(region.textContent).toContain('Alpha Ace');
    expect(region.textContent).toContain('Your roster');
    expect(region.textContent).toContain('26.8');
    expect(region.textContent).toContain('134 pts');
  });

  it('upgrades game recaps with margins, overtime, and the top performer', () => {
    const { getByRole } = render(ChampionshipView, { props: baseProps() });
    const cards = getByRole('region', { name: 'Game recaps' }).querySelectorAll('.recap-game');
    expect(cards).toHaveLength(5);
    expect(cards[0]?.textContent).toContain('Won by 9');
    expect(cards[0]?.textContent).toContain('Series 1–0');
    expect(cards[0]?.textContent).toContain('Alpha Ace');
    expect(cards[2]?.textContent).toContain('Lost by 12');
    expect(cards[2]?.textContent).toContain('Series 2–1');
    expect(cards[2]?.textContent).toContain('Vet Vic');
    expect(cards[4]?.textContent).toContain('OT');
    expect(cards[4]?.textContent).toContain('Series 4–1');
  });

  it('toggles player stats between sides and per-game or totals', async () => {
    const { getByRole, getByText } = render(ChampionshipView, { props: baseProps() });
    const region = getByRole('region', { name: 'Series player stats' });
    const initialRows = region.querySelectorAll('tbody tr');
    expect(initialRows).toHaveLength(5);
    expect(initialRows[0]?.textContent).toContain('Alpha Ace');
    expect(initialRows[0]?.textContent).toContain('26.8');
    await fireEvent.click(getByText('Totals'));
    const totalRows = region.querySelectorAll('tbody tr');
    expect(totalRows[0]?.textContent).toContain('134');
    await fireEvent.click(getByText('Opponent'));
    const opponentRows = region.querySelectorAll('tbody tr');
    expect(opponentRows[0]?.textContent).toContain('Vet Vic');
    expect(opponentRows[0]?.textContent).toContain('151');
  });

  it('explains missing stats without inventing numbers when the series is decided', () => {
    const { getByRole, getAllByText } = render(ChampionshipView, {
      props: baseProps({ games: [], mvp: null, standouts: [] }),
    });
    expect(getByRole('region', { name: 'Series MVP' }).textContent).toContain(
      'The series MVP is not available on this device.',
    );
    expect(getByRole('region', { name: 'Game recaps' }).textContent).toContain(
      'The series box scores are not available on this device.',
    );
    expect(getAllByText('Box scores are not available on this device.')).toHaveLength(3);
  });

  it('keeps the pre-champion copy while the series is still running', () => {
    const series = makeSeries();
    series.games = [];
    series.champion = null;
    series.currentGameNumber = 1;
    const { getByRole } = render(ChampionshipView, {
      props: baseProps({ series, games: [], mvp: null, standouts: [] }),
    });
    expect(getByRole('region', { name: 'Series MVP' }).textContent).toContain(
      'Series MVP will be recorded once the games are complete.',
    );
    expect(getByRole('region', { name: 'Game recaps' }).textContent).toContain(
      'No completed games to recap yet.',
    );
  });
});
