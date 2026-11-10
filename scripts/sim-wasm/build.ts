import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

const source = new URL('../../packages/engine/src/sim/wasm/game.rs', import.meta.url);
const target = new URL('../../packages/engine/src/sim/wasm/game-wasm.gen.ts', import.meta.url);
const flags = [
  '--edition=2024',
  '--crate-type',
  'cdylib',
  '--target',
  'wasm32-unknown-unknown',
  '-C',
  'opt-level=3',
  '-C',
  'lto=fat',
  '-C',
  'panic=abort',
  '-C',
  'codegen-units=1',
  '-C',
  'strip=symbols',
];
const sourceHash = createHash('sha256')
  .update(readFileSync(source, 'utf8').replace(/\r\n/g, '\n'))
  .digest('hex');
if (process.argv.includes('--check')) {
  if (
    !readFileSync(target, 'utf8').includes(`export const GAME_WASM_SOURCE_HASH = '${sourceHash}';`)
  ) {
    throw new Error(
      'Rust game source changed. Run bun scripts/sim-wasm/build.ts and commit the generated module.',
    );
  }
  console.log('Rust game module matches its source.');
} else {
  const temporary = mkdtempSync(join(tmpdir(), 'hoop-rush-game-wasm-'));
  try {
    const binary = join(temporary, 'game.wasm');
    execFileSync('rustc', [fileURLToPath(source), ...flags, '-o', binary], { stdio: 'inherit' });
    const bytes = readFileSync(binary);
    writeFileSync(
      target,
      await format(
        `export const GAME_WASM_SOURCE_HASH = '${sourceHash}';\nexport const GAME_WASM_BYTES = new Uint8Array([${bytes.join(',')}]);\n`,
        { ...(await resolveConfig(fileURLToPath(target))), parser: 'typescript' },
      ),
    );
    console.log(`Built Rust game module: ${bytes.length} bytes.`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
