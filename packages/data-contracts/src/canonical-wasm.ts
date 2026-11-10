import { CANONICAL_WASM_BYTES } from './wasm/canonical-wasm.gen.ts';

interface CanonicalWasm {
  memory: WebAssembly.Memory;
  reserve_input(length: number): number;
  output_ptr(): number;
  canonicalize(length: number): number;
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

export function isNativeJson(value: unknown, seen = new Set<object>()): boolean {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return true;
  if (typeof value !== 'object' || seen.has(value)) return false;
  const array = Array.isArray(value);
  const prototype: unknown = Object.getPrototypeOf(value);
  if ((!array && prototype !== Object.prototype && prototype !== null) || 'toJSON' in value)
    return false;
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (array && Object.keys(value).length !== value.length) return false;
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable) continue;
    if (!('value' in descriptor)) return false;
    const entry: unknown = descriptor.value;
    if (!array && entry === undefined) continue;
    if (!isNativeJson(entry, seen)) return false;
    if (array && !/^(0|[1-9][0-9]*)$/.test(key)) return false;
  }
  seen.delete(value);
  return true;
}
