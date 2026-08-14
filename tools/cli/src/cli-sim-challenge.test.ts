import { describe, expect, it } from 'vitest';
import type { PlayersIndexEntry } from '@hoop-rush/data-contracts';
import { simChallengeReportSchema } from './report-schemas.ts';
import { jsonPayload, runCli } from './cli-test-helpers.ts';
import { loadPackagedData, PackagedData } from './commands/data-loader.ts';
import { bestRow } from './commands/challenge.ts';

const G_POSITIONS = new Set(['PG', 'SG']);
const F_POSITIONS = new Set(['SF', 'PF']);
const C_POSITIONS = new Set(['C']);

function fitsSlot(entry: PlayersIndexEntry, group: 'G' | 'F' | 'C'): boolean {
  const union = entry.positionsPlayable;
  if (group === 'G') return union.some((p) => G_POSITIONS.has(p));
  if (group === 'F') return union.some((p) => F_POSITIONS.has(p));
  return union.some((p) => C_POSITIONS.has(p));
}

let memoizedIndex: { data: PackagedData; entries: PlayersIndexEntry[] } | null = null;
function indexData(): { data: PackagedData; entries: PlayersIndexEntry[] } {
  if (memoizedIndex === null) {
    const packaged = loadPackagedData();
    const data = new PackagedData(packaged.manifest, packaged.dir);
    memoizedIndex = { data, entries: data.playersIndex().players };
  }
  return memoizedIndex;
}

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

let memoizedLegalLineup: PlayersIndexEntry[] | null = null;
function legalUniqueLineup(): PlayersIndexEntry[] {
  if (memoizedLegalLineup !== null) return memoizedLegalLineup;
  const { entries } = indexData();
  const seen = new Map<string, number>();
  for (const entry of entries) {
    seen.set(entry.playerId, (seen.get(entry.playerId) ?? 0) + 1);
  }
  const unique = entries.filter((entry) => seen.get(entry.playerId) === 1);
  const pick = (group: 'G' | 'F' | 'C', exclude: Set<string>): PlayersIndexEntry => {
    const entry = unique.find(
      (candidate) => !exclude.has(candidate.playerId) && fitsSlot(candidate, group),
    );
    if (!entry) throw new Error('test helper could not assemble a legal packaged lineup');
    exclude.add(entry.playerId);
    return entry;
  };
  const exclude = new Set<string>();
  const lineup = [
    pick('G', exclude),
    pick('G', exclude),
    pick('F', exclude),
    pick('F', exclude),
    pick('C', exclude),
  ];
  memoizedLegalLineup = lineup;
  return lineup;
}

let memoizedLegalNames: PlayersIndexEntry[] | null = null;
function legalUniqueNames(): PlayersIndexEntry[] {
  if (memoizedLegalNames !== null) return memoizedLegalNames;
  const { entries } = indexData();
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = normalize(entry.displayName);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const legal = legalUniqueLineup().filter(
    (entry) =>
      counts.get(normalize(entry.displayName)) === 1 &&
      !entry.displayName.includes(',') &&
      !entry.displayName.includes('@'),
  );
  if (legal.length < 5) throw new Error('test helper could not assemble a name-unique lineup');
  memoizedLegalNames = legal;
  return legal;
}

function franchiseDisplayName(data: PackagedData, franchiseId: string): string {
  const slot = data.manifest.modernFranchiseSlots.find((f) => f.franchiseId === franchiseId);
  if (!slot) throw new Error(`test helper: no franchise slot for ${franchiseId}`);
  return slot.displayName;
}

let memoizedAmbiguousName: string | null = null;
function commonAmbiguousName(): string {
  if (memoizedAmbiguousName !== null) return memoizedAmbiguousName;
  const { entries } = indexData();
  const counts = new Map<string, string[]>();
  for (const entry of entries) {
    const key = normalize(entry.displayName);
    const rows = counts.get(key) ?? [];
    rows.push(entry.displayName);
    counts.set(key, rows);
  }
  const sorted: Array<[string, string[]]> = [...counts.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );
  const first = sorted[0];
  if (!first) throw new Error('test helper: no ambiguous name found');
  const [name, rows] = first;
  if (rows.length < 2) throw new Error('test helper: no ambiguous name found');
  const sample = rows[0];
  memoizedAmbiguousName = sample ?? name;
  return memoizedAmbiguousName;
}

let memoizedBareIds: string | null = null;
const bareIds = () => {
  if (memoizedBareIds === null) {
    memoizedBareIds = legalUniqueLineup()
      .map((p) => p.playerId)
      .join(',');
  }
  return memoizedBareIds;
};
let memoizedQualifiedIds: string | null = null;
const qualifiedIds = () => {
  if (memoizedQualifiedIds === null) {
    memoizedQualifiedIds = legalUniqueLineup()
      .map((p) => `${p.playerId}@${p.franchiseId}/${p.eraId}`)
      .join(',');
  }
  return memoizedQualifiedIds;
};
let memoizedBareNames: string | null = null;
const bareNames = () => {
  if (memoizedBareNames === null) {
    memoizedBareNames = legalUniqueNames()
      .map((p) => p.displayName)
      .join(',');
  }
  return memoizedBareNames;
};
let memoizedQualifiedNames: string | null = null;
const qualifiedNames = () => {
  if (memoizedQualifiedNames === null) {
    const { data } = indexData();
    memoizedQualifiedNames = legalUniqueNames()
      .map((p) => `${p.displayName}@${franchiseDisplayName(data, p.franchiseId)}/${p.eraId}`)
      .join(',');
  }
  return memoizedQualifiedNames;
};
let memoizedFranchiseOnlyNames: string | null = null;
const franchiseOnlyNames = () => {
  if (memoizedFranchiseOnlyNames === null) {
    const { data } = indexData();
    memoizedFranchiseOnlyNames = legalUniqueNames()
      .map((p) => `${p.displayName}@${franchiseDisplayName(data, p.franchiseId)}`)
      .join(',');
  }
  return memoizedFranchiseOnlyNames;
};

describe('cli: sim challenge', () => {
  it('resolves a franchise-qualified name by selection score, not display Overall', () => {
    const rows = [
      { seasonKey: '1990-91', overall: 90, selectionScore: 62.4 },
      { seasonKey: '1993-94', overall: 88, selectionScore: 64.8 },
    ] as PlayersIndexEntry[];

    expect(bestRow(rows).seasonKey).toBe('1993-94');
  });

  it('runs a complete 82-game challenge with a validated payload', async () => {
    const { code, stdout } = await runCli([
      'sim',
      'challenge',
      '--lineup',
      bareIds(),
      '--seed',
      '12341234123412341234123412341234',
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = simChallengeReportSchema.parse(jsonPayload(stdout));
    expect(payload.record.gamesPlayed).toBe(82);
    expect(payload.record.wins + payload.record.losses).toBe(82);
    expect(['eliminated', 'perfect']).toContain(payload.outcome);
    expect(payload.invariantFailures).toBe(0);
    expect(payload.bracketVersion).toMatch(/^bracket-m3/);
    expect(payload.playerTotals).toHaveLength(5);
    expect(payload.attempts).toBe(2);
    expect(payload.eraId).toBe('2010s');
    const packaged = loadPackagedData();
    const data = new PackagedData(packaged.manifest, packaged.dir);
    expect(payload.profileVersion).toBe(data.eraProfile('2010s').profileVersion);
    expect(payload.chosenSeed).toMatch(/^[0-9a-f]{16,64}$/);
    expect(payload.chosenSeed).not.toBe(payload.seed);
    if (payload.outcome === 'eliminated') {
      expect(payload.firstLossGameNumber).toBeGreaterThanOrEqual(1);
      expect(payload.firstLossGameNumber).toBeLessThanOrEqual(82);
    } else {
      expect(payload.firstLossGameNumber).toBeNull();
    }
  });

  it('requires a lineup and seed and rejects invalid hex with exit 2', async () => {
    const missingLineup = await runCli([
      'sim',
      'challenge',
      '--seed',
      '12341234123412341234123412341234',
    ]);
    expect(missingLineup.code).toBe(2);
    expect(missingLineup.stderr).toContain('--lineup');
    const missing = await runCli(['sim', 'challenge', '--lineup', bareIds()]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('--seed');
    const bad = await runCli(['sim', 'challenge', '--lineup', bareIds(), '--seed', 'not-hex!']);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('hex');
  });

  it('rejects unknown, ambiguous, and short player ids with exit 2', async () => {
    const unknown = await runCli([
      'sim',
      'challenge',
      '--lineup',
      'p-does-not-exist,p-1,p-2,p-3,p-4',
      '--seed',
      '12341234123412341234123412341234',
    ]);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('unknown player id');

    const ambiguous = await runCli([
      'sim',
      'challenge',
      '--lineup',
      'p-76106,p-1,p-2,p-3,p-4',
      '--seed',
      '12341234123412341234123412341234',
    ]);
    expect(ambiguous.code).toBe(2);
    expect(ambiguous.stderr).toContain('matches multiple peaks');
    expect(ambiguous.stderr).toMatch(/p-76106@[a-z0-9._:-]+\/[0-9]{4}s/);

    const short = await runCli([
      'sim',
      'challenge',
      '--lineup',
      'p-1,p-2,p-3,p-4',
      '--seed',
      '12341234123412341234123412341234',
    ]);
    expect(short.code).toBe(2);
    expect(short.stderr).toContain('exactly five players');
  });

  it('resolves qualified playerId@franchise/era refs', async () => {
    const { code, stdout } = await runCli([
      'sim',
      'challenge',
      '--lineup',
      qualifiedIds(),
      '--seed',
      'abcdabcdabcdabcdabcdabcdabcdabcd',
      '--reruns',
      '1',
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = simChallengeReportSchema.parse(jsonPayload(stdout));
    expect(payload.playerTotals).toHaveLength(5);
  });

  it('resolves player names, with and without franchise/era qualification', async () => {
    const names = await runCli([
      'sim',
      'challenge',
      '--lineup',
      bareNames(),
      '--seed',
      'ab11ab11ab11ab11ab11ab11ab11ab11',
      '--reruns',
      '1',
      '--format',
      'json',
    ]);
    expect(names.code).toBe(0);
    expect(simChallengeReportSchema.parse(jsonPayload(names.stdout)).playerTotals).toHaveLength(5);

    const qualified = await runCli([
      'sim',
      'challenge',
      '--lineup',
      qualifiedNames(),
      '--seed',
      'ab22ab22ab22ab22ab22ab22ab22ab22',
      '--reruns',
      '1',
      '--format',
      'json',
    ]);
    expect(qualified.code).toBe(0);
    expect(simChallengeReportSchema.parse(jsonPayload(qualified.stdout)).playerTotals).toHaveLength(
      5,
    );

    const franchiseOnly = await runCli([
      'sim',
      'challenge',
      '--lineup',
      franchiseOnlyNames(),
      '--seed',
      'ab33ab33ab33ab33ab33ab33ab33ab33',
      '--reruns',
      '1',
      '--format',
      'json',
    ]);
    expect(franchiseOnly.code).toBe(0);
    expect(
      simChallengeReportSchema.parse(jsonPayload(franchiseOnly.stdout)).playerTotals,
    ).toHaveLength(5);
  });

  it('rejects unknown or ambiguous player names with exit 2', async () => {
    const unknown = await runCli([
      'sim',
      'challenge',
      '--lineup',
      'No Such Player,p-1,p-2,p-3,p-4',
      '--seed',
      '12341234123412341234123412341234',
    ]);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('no player named');

    const ambiguous = await runCli([
      'sim',
      'challenge',
      '--lineup',
      `${commonAmbiguousName()},p-1,p-2,p-3,p-4`,
      '--seed',
      '12341234123412341234123412341234',
    ]);
    expect(ambiguous.code).toBe(2);
    expect(ambiguous.stderr).toContain('matches multiple peaks');
    expect(ambiguous.stderr).toContain('@');
  });

  it('rejects an unknown franchise qualifier with exit 2', async () => {
    const { code, stderr } = await runCli([
      'sim',
      'challenge',
      '--lineup',
      'Kobe Bryant@Nowhere,p-1,p-2,p-3,p-4',
      '--seed',
      '12341234123412341234123412341234',
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain('unknown franchise');
  });

  it('honors --era as the simulation environment era', async () => {
    const { code, stdout } = await runCli([
      'sim',
      'challenge',
      '--lineup',
      bareIds(),
      '--seed',
      'abcdefabcdefabcdefabcdefabcdef',
      '--era',
      '1990s',
      '--reruns',
      '1',
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = simChallengeReportSchema.parse(jsonPayload(stdout));
    expect(payload.eraId).toBe('1990s');
    const packaged = loadPackagedData();
    const data = new PackagedData(packaged.manifest, packaged.dir);
    expect(payload.profileVersion).toBe(data.eraProfile('1990s').profileVersion);
  });

  it('honors --reruns as the best-of attempt count', async () => {
    const { code, stdout } = await runCli([
      'sim',
      'challenge',
      '--lineup',
      bareIds(),
      '--seed',
      'fedcfedcfedcfedcfedcfedcfedcfedc',
      '--reruns',
      '3',
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = simChallengeReportSchema.parse(jsonPayload(stdout));
    expect(payload.attempts).toBe(3);

    const bad = await runCli([
      'sim',
      'challenge',
      '--lineup',
      bareIds(),
      '--seed',
      'fedcfedcfedcfedcfedcfedcfedcfedc',
      '--reruns',
      '0',
    ]);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('--reruns');
  });

  it('is reproducible: the same seed and lineup reproduce the same record', async () => {
    const lineup = bareIds();
    const run = async () => {
      const { code, stdout } = await runCli([
        'sim',
        'challenge',
        '--lineup',
        lineup,
        '--seed',
        'abcdefabcdefabcdefabcdefabcdef',
        '--reruns',
        '1',
        '--format',
        'json',
      ]);
      expect(code).toBe(0);
      const payload = simChallengeReportSchema.parse(jsonPayload(stdout));
      return `${String(payload.record.wins)}-${String(payload.record.losses)}-${String(payload.firstLossGameNumber ?? 0)}-${payload.chosenSeed}`;
    };
    expect(await run()).toBe(await run());
  });
});
