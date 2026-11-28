<script lang="ts">
  let {
    label,
    progress,
    tone = 'primary',
    class: className = '',
  }: {
    label: string;
    progress: { readonly completed: number; readonly total: number } | null;
    tone?: 'primary' | 'accent';
    class?: string;
  } = $props();

  const total = $derived(progress?.total ?? 0);
  const completed = $derived(Math.min(total, Math.max(0, progress?.completed ?? 0)));
</script>

<div
  class={['h-2 w-full overflow-hidden rounded-full bg-surface-3', className]}
  role="progressbar"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={total > 0 ? total : undefined}
  aria-valuenow={total > 0 ? completed : undefined}
>
  <span
    class={[
      'block h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none',
      tone === 'accent' ? 'bg-accent' : 'bg-primary',
      total <= 0 && 'sweep motion-reduce:animate-none',
    ]}
    style:width={total > 0 ? `${(completed / total) * 100}%` : '33.333%'}
  ></span>
</div>

<style>
  .sweep {
    animation: sweep 1.15s ease-in-out infinite;
  }
  @keyframes sweep {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(300%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sweep {
      animation: none;
    }
  }
</style>
