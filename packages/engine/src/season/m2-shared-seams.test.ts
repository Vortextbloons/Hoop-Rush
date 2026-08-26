import { describe, expect, it } from 'vitest';
import { completionTargetsMet, legalFiveAfterAnyRemoval, legalFiveExists, rosterFeasible, validateSeasonRoster, type SeasonRosterMemberInput, } from './roster-rules.ts';
import { buildMinimalRotation, matchStartingFive, rotationTargetMinutes } from './rotation.ts';
import { seasonGenerationDigest } from './digest.ts';
import type { SeasonGenerationDiagnostics } from '@hoop-rush/data-contracts';
import { buildSeasonDraftCatalog, buildSeasonRotation } from '@hoop-rush/test-fixtures';
const g = (id: string, ...positions: string[]): SeasonRosterMemberInput => ({
    playerVersionId: id,
    playable: positions as SeasonRosterMemberInput['playable'],
});
describe('season roster legality (season-roster-v1)', () => {
    it('accepts a legal ten-player roster', () => {
        const roster = [
            g('pv-01', 'PG'),
            g('pv-02', 'PG', 'SG'),
            g('pv-03', 'SG'),
            g('pv-04', 'SF'),
            g('pv-05', 'SF', 'PF'),
            g('pv-06', 'PF'),
            g('pv-07', 'PF', 'C'),
            g('pv-08', 'C'),
            g('pv-09', 'PG', 'SF'),
            g('pv-10', 'C'),
        ];
        expect(validateSeasonRoster(roster)).toEqual([]);
        expect(completionTargetsMet(roster)).toBe(true);
    });
    it('rejects duplicate version ids and wrong sizes', () => {
        const roster = [g('pv-01', 'PG'), g('pv-01', 'PG')];
        const failures = validateSeasonRoster(roster);
        expect(failures.some((f) => f.includes('distinct'))).toBe(true);
        expect(failures.some((f) => f.includes('exactly 10'))).toBe(true);
    });
    it('rejects rosters missing the game minimums', () => {
        const roster = [
            g('pv-01', 'PG'),
            g('pv-02', 'SG'),
            g('pv-03', 'SF'),
            g('pv-04', 'PF'),
            g('pv-05', 'C'),
            g('pv-06', 'C'),
            g('pv-07', 'C'),
            g('pv-08', 'SF'),
            g('pv-09', 'PF'),
            g('pv-10', 'SF'),
        ];
        const failures = validateSeasonRoster(roster);
        expect(failures.some((f) => f.includes('guard-capable'))).toBe(true);
    });
    it('catches the greedy-matching counterexample for the legal five', () => {
        const members = [
            g('pv-a', 'PG', 'SF'),
            g('pv-b', 'PF', 'C'),
            g('pv-c', 'PG'),
            g('pv-d', 'SG'),
            g('pv-e', 'C'),
        ];
        expect(legalFiveExists(members)).toBe(true);
        const bad = [
            g('pv-a', 'PG', 'SF'),
            g('pv-b', 'PF', 'C'),
            g('pv-c', 'PG'),
            g('pv-d', 'PG'),
            g('pv-e', 'C'),
        ];
        expect(legalFiveExists(bad)).toBe(true);
        const noCenter = [
            g('pv-a', 'PG'),
            g('pv-b', 'SG'),
            g('pv-c', 'SF'),
            g('pv-d', 'PF'),
            g('pv-e', 'SF'),
        ];
        expect(legalFiveExists(noCenter)).toBe(false);
    });
    it('rejects rosters with no legal five after removing a key player', () => {
        const roster = [
            g('pv-01', 'PG'),
            g('pv-02', 'SG'),
            g('pv-03', 'SF'),
            g('pv-04', 'PF'),
            g('pv-05', 'C'),
            g('pv-06', 'C'),
            g('pv-07', 'C'),
            g('pv-08', 'C'),
            g('pv-09', 'SF'),
            g('pv-10', 'PF'),
        ];
        expect(legalFiveAfterAnyRemoval(roster)).toBe(false);
        expect(validateSeasonRoster(roster).some((f) => f.includes('removing'))).toBe(true);
    });
});
describe('season roster feasibility', () => {
    it('accepts feasible and rejects infeasible completions', () => {
        const owned = [g('pv-1', 'PG'), g('pv-2', 'SG')];
        const available = [
            g('pv-3', 'PG'),
            g('pv-4', 'PG', 'SG'),
            g('pv-5', 'SF'),
            g('pv-6', 'SF', 'PF'),
            g('pv-7', 'PF'),
            g('pv-8', 'C'),
            g('pv-9', 'C'),
            g('pv-10', 'PF', 'C'),
        ];
        expect(rosterFeasible(owned, available, 8)).toBe(true);
        expect(rosterFeasible(owned, available, 3)).toBe(false);
    });
    it('is exact for overlapping multi-position candidates', () => {
        const owned: SeasonRosterMemberInput[] = [];
        const available = [
            g('pv-1', 'PG', 'SF'),
            g('pv-2', 'PG', 'SF'),
            g('pv-3', 'PG', 'SF'),
            g('pv-4', 'PG', 'SF'),
            g('pv-5', 'PG', 'SF'),
            g('pv-6', 'PG', 'SF'),
            g('pv-7', 'PG', 'SF'),
            g('pv-8', 'PG', 'SF'),
            g('pv-9', 'PG', 'SF'),
            g('pv-10', 'PG', 'SF'),
        ];
        expect(rosterFeasible(owned, available, 10)).toBe(false);
    });
    it('is feasible over the compact fixture catalog', () => {
        const catalog = buildSeasonDraftCatalog();
        const available = catalog.candidates.map((candidate) => ({
            playerVersionId: candidate.playerVersionId,
            playable: candidate.positions.playable,
        }));
        expect(rosterFeasible([], available, 10)).toBe(true);
        expect(rosterFeasible([g('pv-x', 'C')], available, 9)).toBe(true);
    });
});
describe('season rotation (season-rotation-v2)', () => {
    it('builds a deterministic 240-minute rotation with starters as closing five', () => {
        const catalog = buildSeasonDraftCatalog({
            franchiseIds: ['lakers'],
            eras: ['1990s'],
            playersPerPool: 10,
        });
        const members = catalog.candidates.map((candidate) => ({
            playerVersionId: candidate.playerVersionId,
            playable: candidate.positions.playable,
        }));
        const rotation = buildMinimalRotation({ franchiseId: 'lakers', members });
        expect(rotation.starters).toHaveLength(5);
        expect(rotation.benchOrder).toHaveLength(5);
        expect(rotationTargetMinutes(rotation)).toBe(240);
        expect(rotation.closingFive).toEqual(rotation.starters);
        const starterMinutes = rotation.targetMinutes.filter((m) => rotation.starters.includes(m.playerVersionId));
        const benchMinutes = rotation.targetMinutes.filter((m) => rotation.benchOrder.includes(m.playerVersionId));
        expect(starterMinutes.every((m) => m.minutes === 32)).toBe(true);
        expect(benchMinutes.every((m) => m.minutes === 16)).toBe(true);
    });
    it('matches a legal five deterministically', () => {
        const catalog = buildSeasonDraftCatalog({
            franchiseIds: ['lakers'],
            eras: ['1990s'],
            playersPerPool: 12,
        });
        const members = catalog.candidates.map((candidate) => ({
            playerVersionId: candidate.playerVersionId,
            playable: candidate.positions.playable,
        }));
        const first = matchStartingFive(members);
        const second = matchStartingFive([...members].reverse());
        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        expect(first?.map((m) => m.playerVersionId)).toEqual(second?.map((m) => m.playerVersionId));
    });
    it('rejects rosters without a legal five', () => {
        const members = [g('pv-1', 'PG'), g('pv-2', 'SF'), g('pv-3', 'PF')];
        expect(matchStartingFive(members)).toBeNull();
        expect(() => buildMinimalRotation({
            franchiseId: 'lakers',
            members: [
                ...members,
                g('pv-4', 'PG'),
                g('pv-5', 'SF'),
                g('pv-6', 'PF'),
                g('pv-7', 'PG'),
                g('pv-8', 'SF'),
                g('pv-9', 'PF'),
                g('pv-10', 'PG'),
            ],
        })).toThrow();
    });
});
describe('season generation digest', () => {
    it('is canonical regardless of input order', () => {
        const seed = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
        const poolOf = (id: string) => {
            const playerVersionIds = Array.from({ length: 20 }, (_, i) => {
                const hex = `${String(i).padStart(2, '0')}0`.padEnd(32, '0');
                return `pv-${hex}`;
            });
            const selections = playerVersionIds.slice(0, 10);
            return {
                franchiseId: id,
                band: 'contender' as const,
                identity: 'star-chaser' as const,
                playerVersionIds,
                anchors: [],
                selections,
                allocationSeedPaths: selections.map((_version, slot) => [
                    'ai',
                    'selection',
                    id,
                    String(slot),
                ]),
                repairCount: 0,
            };
        };
        const diagnostics: SeasonGenerationDiagnostics = {
            seed,
            aiVersion: 'season-ai-v2',
            rosterGenerationVersion: 'roster-generation-v2',
            teamsGenerated: 2,
            teamsRepaired: 0,
            backtracks: 0,
            nodesVisited: 2,
            nodeBudget: 100000,
            failedTeams: [],
            unmetConstraints: [],
        };
        const roster = (id: string) => ({
            franchiseId: id,
            players: [
                {
                    playerVersionId: 'pv-1',
                    playerId: 'p-1',
                    franchiseId: id,
                    eraId: '1990s',
                    seasonKey: '1995-96',
                    displayName: 'A',
                },
                {
                    playerVersionId: 'pv-2',
                    playerId: 'p-2',
                    franchiseId: id,
                    eraId: '1990s',
                    seasonKey: '1995-96',
                    displayName: 'B',
                },
                {
                    playerVersionId: 'pv-3',
                    playerId: 'p-3',
                    franchiseId: id,
                    eraId: '1990s',
                    seasonKey: '1995-96',
                    displayName: 'C',
                },
                {
                    playerVersionId: 'pv-4',
                    playerId: 'p-4',
                    franchiseId: id,
                    eraId: '1990s',
                    seasonKey: '1995-96',
                    displayName: 'D',
                },
                {
                    playerVersionId: 'pv-5',
                    playerId: 'p-5',
                    franchiseId: id,
                    eraId: '1990s',
                    seasonKey: '1995-96',
                    displayName: 'E',
                },
                {
                    playerVersionId: 'pv-6',
                    playerId: 'p-6',
                    franchiseId: id,
                    eraId: '1990s',
                    seasonKey: '1995-96',
                    displayName: 'F',
                },
                {
                    playerVersionId: 'pv-7',
                    playerId: 'p-7',
                    franchiseId: id,
                    eraId: '1990s',
                    seasonKey: '1995-96',
                    displayName: 'G',
                },
                {
                    playerVersionId: 'pv-8',
                    playerId: 'p-8',
                    franchiseId: id,
                    eraId: '1990s',
                    seasonKey: '1995-96',
                    displayName: 'H',
                },
                {
                    playerVersionId: 'pv-9',
                    playerId: 'p-9',
                    franchiseId: id,
                    eraId: '1990s',
                    seasonKey: '1995-96',
                    displayName: 'I',
                },
                {
                    playerVersionId: 'pv-10',
                    playerId: 'p-10',
                    franchiseId: id,
                    eraId: '1990s',
                    seasonKey: '1995-96',
                    displayName: 'J',
                },
            ],
        });
        const rotation = (id: string) => buildSeasonRotation(id, Array.from({ length: 10 }, (_, i) => `pv-${String(i + 1)}`));
        const base = {
            seed,
            aiVersion: 'season-ai-v2',
            rosterGenerationVersion: 'roster-generation-v2',
            rotationVersion: 'season-rotation-v2',
            targetsVersion: 'roster-targets-v2',
            rosters: [roster('lakers'), roster('celtics')],
            ownership: [
                { playerVersionId: 'pv-2', ownerFranchiseId: 'lakers' },
                { playerVersionId: 'pv-1', ownerFranchiseId: 'lakers' },
            ],
            rotations: [rotation('celtics'), rotation('lakers')],
            aiAssignments: [
                { franchiseId: 'celtics', band: 'average' as const, identity: 'continuity' as const },
                { franchiseId: 'lakers', band: 'contender' as const, identity: 'star-chaser' as const },
            ],
            aiPools: [poolOf('celtics'), poolOf('lakers')],
            diagnostics,
        };
        const shuffled = {
            ...base,
            rosters: [roster('celtics'), roster('lakers')],
            ownership: [
                { playerVersionId: 'pv-1', ownerFranchiseId: 'lakers' },
                { playerVersionId: 'pv-2', ownerFranchiseId: 'lakers' },
            ],
            rotations: [rotation('lakers'), rotation('celtics')],
            aiAssignments: [
                { franchiseId: 'lakers', band: 'contender' as const, identity: 'star-chaser' as const },
                { franchiseId: 'celtics', band: 'average' as const, identity: 'continuity' as const },
            ],
            aiPools: [poolOf('lakers'), poolOf('celtics')],
        };
        expect(seasonGenerationDigest(base)).toBe(seasonGenerationDigest(shuffled));
        expect(seasonGenerationDigest(base)).toMatch(/^[0-9a-f]{32}$/);
    });
});
