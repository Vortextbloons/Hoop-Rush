import { describe, expect, it, vi } from 'bun:test';
import { cachedAssets, type CachedAssets } from './cached-assets';

async function settled<T>(promise: Promise<T>): Promise<{ value: T } | { error: unknown }> {
  try {
    return { value: await promise };
  } catch (error) {
    return { error };
  }
}

describe('cached assets', () => {
  it('shares one in-flight load between concurrent callers', async () => {
    let resolve!: (value: string) => void;
    const build = vi.fn(
      () =>
        new Promise<string>((yes) => {
          resolve = yes;
        }),
    );
    const assets: CachedAssets<string> = cachedAssets<string>(build);
    const first = assets.load();
    const second = assets.load();
    expect(build).toHaveBeenCalledTimes(1);
    resolve('catalog');
    expect(await settled(first)).toEqual({ value: 'catalog' });
    expect(await settled(second)).toEqual({ value: 'catalog' });
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('forgets a rejection so the next load retries instead of replaying it', async () => {
    const build = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('catalog');
    const assets: CachedAssets<string> = cachedAssets<string>(build);
    const failed = await settled(assets.load());
    expect(failed).toHaveProperty('error');
    expect(await settled(assets.load())).toEqual({ value: 'catalog' });
    expect(build).toHaveBeenCalledTimes(2);
    // The successful load stays cached.
    expect(await settled(assets.load())).toEqual({ value: 'catalog' });
    expect(build).toHaveBeenCalledTimes(2);
  });
});
