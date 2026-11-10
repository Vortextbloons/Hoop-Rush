import { CANONICAL_WASM_BYTES } from './wasm/canonical-wasm.gen.ts';

interface CanonicalWasm {
  memory: WebAssembly.Memory;
  reserve_input(length: number): number;
  output_ptr(): number;
  canonicalize(length: number): number;
  canonical_digest(length: number, prefixLength: number): number;
  digest_ptr(): number;
}

let runtime: CanonicalWasm | undefined;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function canonicalJsonText(text: string): string {
  runtime ??= new WebAssembly.Instance(new WebAssembly.Module(CANONICAL_WASM_BYTES))
    .exports as unknown as CanonicalWasm;
  const pointer = runtime.reserve_input(text.length * 3);
  const input = new Uint8Array(runtime.memory.buffer, pointer, text.length * 3);
  const { written } = encoder.encodeInto(text, input);
  const length = runtime.canonicalize(written);
  if (length < 0) throw new Error('canonical JSON exceeds the Wasm parser limits');
  return decoder.decode(new Uint8Array(runtime.memory.buffer, runtime.output_ptr(), length));
}

export function canonicalDigestText(prefix: string, text: string): string {
  runtime ??= new WebAssembly.Instance(new WebAssembly.Module(CANONICAL_WASM_BYTES))
    .exports as unknown as CanonicalWasm;
  const prefixBytes = prefix.length * 2;
  const capacity = prefixBytes + text.length * 3;
  const pointer = runtime.reserve_input(capacity);
  const input = new Uint8Array(runtime.memory.buffer, pointer, capacity);
  const prefixView = new DataView(runtime.memory.buffer, pointer, prefixBytes);
  for (let i = 0; i < prefix.length; i++) prefixView.setUint16(i * 2, prefix.charCodeAt(i), true);
  const textBytes = encoder.encodeInto(text, input.subarray(prefixBytes)).written;
  if (runtime.canonical_digest(prefixBytes + textBytes, prefixBytes) < 0) {
    throw new Error('canonical JSON exceeds the Wasm parser limits');
  }
  const hashes = new Uint32Array(runtime.memory.buffer, runtime.digest_ptr(), 4);
  return Array.from(hashes, (hash) => hash.toString(16).padStart(8, '0')).join('');
}
