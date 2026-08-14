import { verifySha256 } from './verify-hash.ts';

export interface LoadJsonAssetOptions<T> {
  label: string;

  expectedHash?: string;

  parse: (value: unknown) => T;
  init?: RequestInit;
}

export async function loadJsonAsset<T>(url: string, options: LoadJsonAssetOptions<T>): Promise<T> {
  const response = await fetch(url, options.init);
  if (!response.ok) {
    throw new Error(
      `${options.label} request failed: ${String(response.status)} ${response.statusText}`,
    );
  }
  const bytes = await response.arrayBuffer();
  if (options.expectedHash !== undefined) {
    await verifySha256(bytes, options.expectedHash);
  }
  return options.parse(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
}
