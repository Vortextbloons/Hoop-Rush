import { getContext, onDestroy, untrack } from 'svelte';
import type {
  CollectionCatalog,
  CollectionProgressionRules,
  CollectionState,
  HoopRushManifest,
} from '@hoop-rush/data-contracts';
import {
  ULTIMATE_RUN_SHELL_CONTEXT,
  type UltimateRunShell,
} from '$lib/collection/ultimate-shell.svelte';
import { loadCollectionProgression } from '$lib/collection/collection-assets.ts';

export type UltimatePagePhase = 'loading' | 'error' | 'ready';

export interface UltimatePageLoadContext {
  markReady: () => void;
  fail: (message: string) => void;
}

export interface UltimatePageShellApi {
  readonly shell: UltimateRunShell;
  readonly collectionState: CollectionState | null;
  readonly catalog: CollectionCatalog | null;
  readonly manifest: HoopRushManifest | null;
  readonly phase: UltimatePagePhase;
  readonly error: string | null;
  isMounted(): boolean;
  retry(): void;
  startProgressionLoad(
    apply: (progression: CollectionProgressionRules | null, error: string | null) => void,
  ): void;
}

export function createUltimatePageShell(options: {
  failureMessage: string;
  requireCatalog?: boolean;
  onRetry?: () => void;
  load: (ctx: UltimatePageLoadContext) => Promise<false | undefined>;
}): UltimatePageShellApi {
  const shell = getContext<UltimateRunShell>(ULTIMATE_RUN_SHELL_CONTEXT);
  const requireCatalog = options.requireCatalog === true;

  let mounted = true;
  onDestroy(() => {
    mounted = false;
  });

  let pageStatus = $state<UltimatePagePhase>('loading');
  let pageError = $state<string | null>(null);
  const phase = $derived<UltimatePagePhase>(
    shell.phase === 'error' ||
      (requireCatalog && shell.phase === 'ready' && shell.catalog === null) ||
      pageError !== null
      ? 'error'
      : shell.phase === 'ready' && pageStatus === 'ready'
        ? 'ready'
        : 'loading',
  );
  const error = $derived.by(() => {
    if (shell.error !== null) return shell.error;
    if (requireCatalog && shell.catalogError !== null) return shell.catalogError;
    return pageError;
  });

  async function run(): Promise<void> {
    pageStatus = 'loading';
    pageError = null;
    try {
      const outcome = await options.load({
        markReady: () => {
          if (mounted) pageStatus = 'ready';
        },
        fail: (message) => {
          if (mounted) {
            pageError = message;
            pageStatus = 'error';
          }
        },
      });
      const failedDuringLoad = (): boolean => pageError !== null;
      if (!mounted || outcome === false || failedDuringLoad()) return;
      pageStatus = 'ready';
    } catch (loadError) {
      if (!mounted) return;
      pageError = loadError instanceof Error ? loadError.message : options.failureMessage;
      pageStatus = 'error';
    }
  }

  function retry(): void {
    options.onRetry?.();
    pageStatus = 'loading';
    pageError = null;
    if (shell.phase === 'error' || (requireCatalog && shell.catalogError !== null))
      void shell.refresh();
    else void run();
  }

  $effect(() => {
    if (shell.phase !== 'ready') return;
    void untrack(run);
  });

  function startProgressionLoad(
    apply: (progression: CollectionProgressionRules | null, error: string | null) => void,
  ): void {
    void loadCollectionProgression()
      .then((loaded) => {
        if (mounted) apply(loaded, null);
      })
      .catch((failure: unknown) => {
        if (!mounted) return;
        apply(
          null,
          failure instanceof Error
            ? failure.message
            : 'The collection progression rules are unavailable.',
        );
      });
  }

  return {
    shell,
    get collectionState() {
      return shell.state;
    },
    get catalog() {
      return shell.catalog;
    },
    get manifest() {
      return shell.manifest;
    },
    get phase() {
      return phase;
    },
    get error() {
      return error;
    },
    isMounted: () => mounted,
    retry,
    startProgressionLoad,
  };
}
