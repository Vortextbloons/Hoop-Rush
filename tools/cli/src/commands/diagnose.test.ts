import { describe, expect, it, vi } from 'vitest';
import { simDiagnoseReportSchema } from '../report-schemas.ts';
import { simDiagnose } from './diagnose.ts';

vi.mock('./sim.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./sim.ts')>();
  return {
    ...original,
    loadFixture: (id: string) => {
      const fixture = original.loadFixture(id);
      fixture.away.players.forEach((p) => {
        p.playerId = `${p.playerId}-away` as typeof p.playerId;
      });
      return fixture;
    },
  };
});

describe('usage diagnosis', () => {
  it('reports each teams usage against its own denominator', () => {
    const report = simDiagnoseReportSchema.parse(
      simDiagnose({ fixture: 'equal', samples: '16' }).payload,
    );
    for (const away of [false, true]) {
      const players = report.players.filter((p) => p.playerId.endsWith('-away') === away);
      expect(players.reduce((sum, p) => sum + p.usageShare, 0)).toBeCloseTo(1, 2);
    }
  });
});
