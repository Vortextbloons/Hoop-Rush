import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

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
const kernels = [
  {
    name: 'GAME',
    source: '../../packages/engine/src/sim/wasm/game.rs',
    target: '../../packages/engine/src/sim/wasm/game-wasm.gen.ts',
  },
  {
    name: 'POSSESSION',
    source: '../../packages/engine/src/sim/wasm/possession.rs',
    target: '../../packages/engine/src/sim/wasm/possession-wasm.gen.ts',
  },
  {
    name: 'CANONICAL',
    source: '../../packages/data-contracts/src/wasm/canonical.rs',
    target: '../../packages/data-contracts/src/wasm/canonical-wasm.gen.ts',
  },
];
for (const kernel of kernels) {
  const source = new URL(kernel.source, import.meta.url);
  const target = new URL(kernel.target, import.meta.url);
  const sourceHash = createHash('sha256')
    .update(readFileSync(source, 'utf8').replace(/\r\n/g, '\n'))
    .digest('hex');
  if (process.argv.includes('--check')) {
    if (
      !new RegExp(`export const ${kernel.name}_WASM_SOURCE_HASH =\\s*'${sourceHash}';`).test(
        readFileSync(target, 'utf8'),
      )
    ) {
      throw new Error(
        'Rust game source changed. Run bun scripts/sim-wasm/build.ts and commit the generated module.',
      );
    }
    console.log(`Rust ${kernel.name} module matches its source.`);
  } else {
    const temporary = mkdtempSync(join(tmpdir(), 'hoop-rush-game-wasm-'));
    try {
      const binary = join(temporary, 'game.wasm');
      execFileSync('rustc', [fileURLToPath(source), ...flags, '-o', binary], { stdio: 'inherit' });
      const bytes = readFileSync(binary);
      writeFileSync(
        target,
        await format(
          `export const ${kernel.name}_WASM_SOURCE_HASH = '${sourceHash}';\nexport const ${kernel.name}_WASM_BYTES = new Uint8Array([${bytes.join(',')}]);\n`,
          { ...(await resolveConfig(fileURLToPath(target))), parser: 'typescript' },
        ),
      );
      console.log(`Built Rust ${kernel.name} module: ${bytes.length} bytes.`);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
}
