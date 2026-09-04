import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  eraSimulationProfileSchema,
  fixedFiveCommandSchema,
  franchiseEraPoolSchema,
  hoopRushManifestSchema,
  opponentBracketSchema,
  playersIndexSchema,
  seasonDigestHex,
  seedSchema,
  type ClassicDraftCatalog,
  type EraSimulationProfile,
  type FixedFiveCommand,
  type FixedFiveCommandPayload,
  type FixedFiveCompetitionResult,
  type FixedFiveLineupEntry,
  type HoopRushManifest,
  type OpponentBracket,
  type PeakPlayerSeason,
  type PlayersIndex,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import {
  createEngineContext,
  fixedFiveDraftSeed,
  createParticipantClassicDraft,
  applyClassicBuilderCommand,
  simulateShared82,
  toSimulationPlayer,
  canonicalFixedFiveDigestPayload,
  type EngineContext,
} from '@hoop-rush/engine';
import { buildClassicCatalog } from '$lib/classic-draft';
import {
  lineupEntryFor,
  refsForParticipant,
  replayFixedFiveLog,
} from '$lib/fixed-five-room-state';
import { playerVersionId } from '@hoop-rush/data-contracts';
import type { FixedFiveCandidate } from '@hoop-rush/data-contracts';

const LIVE = process.env.FIXED_FIVE_FORENSICS === '1';
const ROOM_ID = 'd71f646b-a586-49f7-b8ea-47bd76b95cb3';
const ROOT = seedSchema.parse('7349085879ebcc5342440e8653c70624');
const EXPECTED_P2 = '04264d74e06a71a051bfe9d621c256c41def0f53e46aecbf8717d221aee125a3';
const EXPECTED_P1 = '8f7eb4a2f13b14167ed0bca0d1888252380c1ebd8eba6fa171d2a4a7e595226d';

interface LoggedCommand {
  ordinal: number;
  command_id: string;
  actor: 'p1' | 'p2';
  payload: FixedFiveCommandPayload;
}

const LOGGED: LoggedCommand[] = [
  {
    ordinal: 0,
    command_id: 'fed3f2e9-20ad-41d1-8520-19eb6bbf4e86',
    actor: 'p2',
    payload: { kind: 'start' },
  },
  {
    ordinal: 1,
    command_id: '138180be-317b-4609-ab30-e7ce8c81f525',
    actor: 'p2',
    payload: { kind: 'classic-pick', playerId: 'p-203897', slotIndex: 0 },
  },
  {
    ordinal: 2,
    command_id: '45797598-15b0-4c6c-87b5-c381ce408885',
    actor: 'p2',
    payload: { kind: 'classic-pick', playerId: 'p-896', slotIndex: 1 },
  },
  {
    ordinal: 3,
    command_id: '448ad59c-be0d-402c-9556-193905ec7233',
    actor: 'p2',
    payload: { kind: 'classic-pick', playerId: 'p-203076', slotIndex: 3 },
  },
  {
    ordinal: 4,
    command_id: '78c2c406-1f06-450b-83e6-f7978190db7b',
    actor: 'p2',
    payload: { kind: 'classic-pick', playerId: 'p-2544', slotIndex: 2 },
  },
  {
    ordinal: 5,
    command_id: 'c15a1573-59b7-4c72-a28b-125aa6a419d5',
    actor: 'p1',
    payload: { kind: 'classic-pick', playerId: 'p-893', slotIndex: 0 },
  },
  {
    ordinal: 6,
    command_id: '7ef03e4a-7f27-4233-8764-bf6eeb543c59',
    actor: 'p1',
    payload: { kind: 'classic-pick', playerId: 'p-101114', slotIndex: 1 },
  },
  {
    ordinal: 7,
    command_id: 'b94f3927-a76a-410d-9fc0-758749726ad0',
    actor: 'p1',
    payload: { kind: 'classic-pick', playerId: 'p-185', slotIndex: 4 },
  },
  {
    ordinal: 8,
    command_id: '026f71fc-e59b-4524-9f3d-3675b53c705b',
    actor: 'p1',
    payload: { kind: 'classic-pick', playerId: 'p-202722', slotIndex: 2 },
  },
  {
    ordinal: 9,
    command_id: '071094cf-924c-4285-b0bc-ead06d0d3652',
    actor: 'p1',
    payload: { kind: 'classic-pick', playerId: 'p-202710', slotIndex: 3 },
  },
  {
    ordinal: 10,
    command_id: '5548648a-8e6d-4551-a5d8-5d8681a60bed',
    actor: 'p2',
    payload: { kind: 'classic-pick', playerId: 'p-76144', slotIndex: 4 },
  },
  {
    ordinal: 11,
    command_id: '671129cd-685e-4b08-a1cb-46cd88e7b238',
    actor: 'p2',
    payload: { kind: 'propose-result', resultDigest: EXPECTED_P2 },
  },
  {
    ordinal: 12,
    command_id: '6658b445-7d9c-4e65-878a-bd1604a36ac4',
    actor: 'p1',
    payload: { kind: 'propose-result', resultDigest: EXPECTED_P1 },
  },
  {
    ordinal: 13,
    command_id: 'ebc04575-7a7a-4062-9b5c-77943409fbce',
    actor: 'p1',
    payload: { kind: 'confirm-result', verified: false, resultDigest: EXPECTED_P2 },
  },
];

function webRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function readJson(relative: string): unknown {
  return JSON.parse(readFileSync(join(webRoot(), 'static', 'data', relative), 'utf8')) as unknown;
}

function oldDigest(material: Record<string, unknown>): string {
  return seasonDigestHex(canonicalJson(material));
}

describe.skipIf(!LIVE)('fixed-five forensics: third-client recomputation of room d71f', () => {
  it('replays the log, simulates, and checks both proposed digests', async () => {
    const manifest = hoopRushManifestSchema.parse(readJson('manifest.json')) as HoopRushManifest;
    const index = playersIndexSchema.parse(readJson('players-index.json')) as PlayersIndex;
    const bracket = opponentBracketSchema.parse(
      readJson('opponents/bracket.json'),
    ) as OpponentBracket;
    const profileEntry = manifest.eraSimulationProfiles.find((p) => p.eraId === '2010s');
    if (!profileEntry) throw new Error('no 2010s profile entry');
    const profile = eraSimulationProfileSchema.parse(
      readJson(profileEntry.url.replace(/^data\//, '')),
    ) as EraSimulationProfile;
    const catalog: ClassicDraftCatalog = buildClassicCatalog(manifest, index);
    const context: EngineContext = createEngineContext();

    const commands: FixedFiveCommand[] = LOGGED.map((entry) =>
      fixedFiveCommandSchema.parse({
        schemaVersion: 1,
        roomId: ROOM_ID,
        commandId: entry.command_id,
        ordinal: entry.ordinal,
        actorParticipantId: entry.actor,
        payload: entry.payload,
      }),
    );

    const replay = (
      participant: 'p1' | 'p2',
    ): {
      picks: Array<{ playerId: string; franchiseId: string; eraId: string; slotIndex: number }>;
    } => {
      let state = createParticipantClassicDraft(
        `ff:${participant}`,
        'ratings',
        fixedFiveDraftSeed(ROOT, participant),
        'data-v1',
        catalog,
        context,
      );
      for (const command of commands) {
        if (command.actorParticipantId !== participant) continue;
        const payload = command.payload;
        if (payload.kind !== 'classic-pick' && payload.kind !== 'timeout-autopick') continue;
        state = applyClassicBuilderCommand(
          state,
          catalog,
          { kind: 'classic-pick', playerId: payload.playerId, slotIndex: payload.slotIndex },
          context,
        );
      }
      if (state.status !== 'complete') throw new Error(`${participant} draft did not complete`);
      return { picks: [...state.picks] };
    };

    const p1 = replay('p1');
    const p2 = replay('p2');
    expect(p1.picks).toHaveLength(5);
    expect(p2.picks).toHaveLength(5);
    // eslint-disable-next-line no-console
    console.log(
      `p1 picks: ${p1.picks.map((p) => `${p.playerId}@${p.franchiseId}/${p.eraId}/s${String(p.slotIndex)}`).join(' ')}`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `p2 picks: ${p2.picks.map((p) => `${p.playerId}@${p.franchiseId}/${p.eraId}/s${String(p.slotIndex)}`).join(' ')}`,
    );

    // Cross-check with the exact client replay path.
    const pool: FixedFiveCandidate[] = index.players.map((entry) => ({
      playerId: entry.playerId,
      playerVersionId: playerVersionId(
        entry.playerId,
        entry.franchiseId,
        entry.eraId,
        entry.seasonKey,
      ),
      positions: [...entry.positionsPlayable],
      selectionScore: entry.selectionScore,
      franchiseId: entry.franchiseId,
      eraId: entry.eraId,
    }));
    const assets = {
      manifest,
      profile,
      bracket,
      index,
      catalog,
      pool,
      poolById: new Map(pool.map((c) => [c.playerId, c])),
      context,
    };
    const clientReplay = replayFixedFiveLog(
      'classic-shared-82',
      ROOM_ID,
      ROOT,
      'data-v1',
      'ratings',
      assets,
      commands,
    );
    if (clientReplay.mode !== 'classic-shared-82') throw new Error('wrong replay mode');
    const refs1 = refsForParticipant(clientReplay, assets, 'p1');
    const refs2 = refsForParticipant(clientReplay, assets, 'p2');
    expect(refs1.map((r) => `${r.playerId}@s${String(r.slotIndex)}`).join(' ')).toBe(
      p1.picks.map((p) => `${p.playerId}@s${String(p.slotIndex)}`).join(' '),
    );
    expect(refs2.map((r) => `${r.playerId}@s${String(r.slotIndex)}`).join(' ')).toBe(
      p2.picks.map((p) => `${p.playerId}@s${String(p.slotIndex)}`).join(' '),
    );

    const poolCache = new Map<string, PeakPlayerSeason[]>();
    function peakFor(franchiseId: string, eraId: string, playerId: string): PeakPlayerSeason {
      const key = `${franchiseId}/${eraId}`;
      let players = poolCache.get(key);
      if (!players) {
        const poolEntry = manifest.pools.find(
          (p) => p.franchiseId === franchiseId && p.eraId === eraId,
        );
        if (!poolEntry) throw new Error(`no pool entry for ${key}`);
        const pool = franchiseEraPoolSchema.parse(readJson(poolEntry.url.replace(/^data\//, '')));
        players = pool.players;
        poolCache.set(key, players);
      }
      const player = players.find((p) => p.playerId === playerId);
      if (!player) throw new Error(`player ${playerId} missing from ${key}`);
      return player;
    }

    function teamOf(
      teamId: string,
      picks: Array<{ playerId: string; franchiseId: string; eraId: string; slotIndex: number }>,
    ) {
      const ordered = [...picks].sort((a, b) => a.slotIndex - b.slotIndex);
      const players: SimulationPlayer[] = ordered.map((pick) =>
        toSimulationPlayer(peakFor(pick.franchiseId, pick.eraId, pick.playerId)),
      );
      return { teamId, displayName: teamId === 'p1' ? 'Player 1' : 'Player 2', players };
    }

    const p1Team = teamOf('p1', p1.picks);
    const p2Team = teamOf('p2', p2.picks);
    const out = simulateShared82(
      {
        p1Team,
        p2Team,
        bracket,
        profile,
        rootSeed: ROOT,
        dataVersion: 'data-v1',
      },
      context,
    );
    expect(out.p1Games).toHaveLength(82);
    expect(out.result.h2hGameNumbers.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(
      `summary: weakest=${out.result.weakestReplacedOpponentId} h2h=${out.result.h2hGameNumbers.join(',')} ` +
        `p1=${String(out.result.participants[0]?.wins)}-${String(out.result.participants[0]?.losses)}:${String(out.result.participants[0]?.differential)} ` +
        `p2=${String(out.result.participants[1]?.wins)}-${String(out.result.participants[1]?.losses)}:${String(out.result.participants[1]?.differential)} ` +
        `rank=${out.result.ranking.join('>')}`,
    );

    const lineups = {
      p1: lineupEntryFor(refs1, p1Team.players),
      p2: lineupEntryFor(refs2, p2Team.players),
    };
    const versions = {
      dataVersion: 'data-v1',
      ratingVersion: 'ratings-v3.8',
      positionNormalizationVersion: 'position-v3',
      engineVersion: 'm3-engine-v13',
      bracketVersion: 'bracket-m3-v3',
      scheduleVersion: 'schedule-v1',
      seedDerivationVersion: 'seed-v1',
      classicRollVersion: 'classic-roll-v1',
      profileVersion: '2010s-fixed-v1',
      multiplayerVersion: 'fixed-five-multiplayer-v1',
      autopickVersion: 'fixed-five-autopick-v1',
    };
    const digestOver = (ordinals: number[]): string =>
      oldDigest(
        canonicalFixedFiveDigestPayload({
          rootSeed: ROOT,
          versions,
          lineups,
          acceptedCommands: commands.filter((c) => ordinals.includes(c.ordinal)),
          result: out.result,
          aggregates: null,
        }),
      );
    const d10 = digestOver([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const d11 = digestOver([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // eslint-disable-next-line no-console
    console.log(`recomputed over [0..10]: ${d10}`);
    // eslint-disable-next-line no-console
    console.log(`recomputed over [0..11]: ${d11}`);
    // eslint-disable-next-line no-console
    console.log(`room p2 proposed:       ${EXPECTED_P2}`);
    // eslint-disable-next-line no-console
    console.log(`room p1 proposed:       ${EXPECTED_P1}`);
    expect(d10).toBe(EXPECTED_P2);
    expect(d11).toBe(EXPECTED_P1);
  }, 300_000);
});
