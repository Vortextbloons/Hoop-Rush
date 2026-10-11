import { readFileSync, writeFileSync } from 'node:fs';

const engineTestPath = new URL('../../packages/engine/src/sim/game.test.ts', import.meta.url);
let gameTest = readFileSync(engineTestPath, 'utf8');

const equalJson = JSON.stringify(
  JSON.parse(readFileSync(new URL('./scratch-golden-equal.json', import.meta.url), 'utf8')),
);
const svswJson = JSON.stringify(
  JSON.parse(readFileSync(new URL('./scratch-golden-svsw.json', import.meta.url), 'utf8')),
);
if (equalJson.includes("'") || svswJson.includes("'")) {
  throw new Error('golden JSON contains a single quote; cannot embed in single-quoted literal');
}

gameTest = gameTest
  .replace(
    'GOLDEN_EQUAL_FIXTURE_V14_HASH = 3209450065',
    'GOLDEN_EQUAL_FIXTURE_V15_HASH = 1556887179',
  )
  .replace('GOLDEN_STRONG_WEAK_V14_HASH = 827787984', 'GOLDEN_STRONG_WEAK_V15_HASH = 1704936435')
  .replaceAll('GOLDEN_EQUAL_FIXTURE_V14_HASH', 'GOLDEN_EQUAL_FIXTURE_V15_HASH')
  .replaceAll('GOLDEN_STRONG_WEAK_V14_HASH', 'GOLDEN_STRONG_WEAK_V15_HASH')
  .replace(
    /const GOLDEN_EQUAL_FIXTURE =\n  '[^']*';/s,
    `const GOLDEN_EQUAL_FIXTURE =\n  '${equalJson}';`,
  )
  .replace(
    /const GOLDEN_STRONG_WEAK =\n  '[^']*';/s,
    `const GOLDEN_STRONG_WEAK =\n  '${svswJson}';`,
  );

if (
  gameTest.includes('V14_HASH') ||
  !gameTest.includes('GOLDEN_EQUAL_FIXTURE_V15_HASH = 1556887179') ||
  !gameTest.includes('GOLDEN_STRONG_WEAK_V15_HASH = 1704936435')
) {
  throw new Error('game.test.ts hash replacement incomplete');
}

writeFileSync(engineTestPath, gameTest);

const seasonTestPath = new URL(
  '../../packages/engine/src/season/engine-low-fixes.test.ts',
  import.meta.url,
);
let seasonTest = readFileSync(seasonTestPath, 'utf8');
seasonTest = seasonTest
  .replace(
    "['ot-probe-21', 'ot-probe-34', 'ot-probe-67', 'ot-probe-130']",
    "['ot-probe-18', 'ot-probe-38', 'ot-probe-49', 'ot-probe-79']",
  )
  .replace("withStamina(buildInput('fx-probe-0'))", "withStamina(buildInput('fx-probe-1'))");
if (seasonTest.includes('ot-probe-21') || seasonTest.includes("buildInput('fx-probe-0')")) {
  throw new Error('engine-low-fixes.test.ts seed replacement incomplete');
}
writeFileSync(seasonTestPath, seasonTest);

console.log('test files re-pinned: V15 hashes, golden JSON, probe seeds');
