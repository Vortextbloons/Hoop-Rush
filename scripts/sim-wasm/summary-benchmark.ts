import { buildHavocGameInput } from '../../packages/test-fixtures/src/index.ts';
import {
  simulateAuditedHavocGame,
  simulateAuditedHavocSummaryGame,
} from '../../packages/engine/src/modes/havoc/solo/simulate.ts';
import { createEngineContext } from '../../packages/engine/src/sim/kernel.ts';
import { seedSchema, seasonDigestHex } from '../../packages/data-contracts/src/index.ts';
import { writeFileSync } from 'node:fs';
const input = buildHavocGameInput();
const context = createEngineContext();
const inputs = Array.from({ length: 40 }, (_, i) => ({
  ...input,
  seed: seedSchema.parse(seasonDigestHex(`validation-bench-${i}`)),
}));
const outputs = inputs.map((input) => simulateAuditedHavocGame(input, context));
const cases = [simulateAuditedHavocSummaryGame, simulateAuditedHavocGame];
const timings = cases.map((run) => {
  for (let i = 0; i < 50; i++) run(inputs[i % 40]!, context);
  const times = Array.from({ length: 9 }, () => {
    const start = performance.now();
    for (let i = 0; i < 150; i++) run(inputs[i % 40]!, context);
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return times[4];
});
const report = { timings, digest: seasonDigestHex(JSON.stringify(outputs)) };
writeFileSync(
  process.argv[2] ?? 'sim-summary-results.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(report);
