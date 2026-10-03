<script lang="ts">
  let { currency, size = 26 }: { currency: 'Coins' | 'Exchange'; size?: number } = $props();
</script>

<span
  class="currency-icon"
  class:exchange={currency === 'Exchange'}
  style:--size={`${size}px`}
  aria-hidden="true">{currency === 'Coins' ? '$' : '◈'}</span
>

<style>
  .currency-icon {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #ffe9a8, #f5b81f 60%, #9a6206);
    color: #3a2703;
    box-shadow: 0 0 0.7rem rgb(255 197 61 / 55%);
    font-size: calc(var(--size) * 0.5);
    font-weight: 900;
    line-height: 1;
    vertical-align: middle;
  }

  .exchange {
    background: radial-gradient(circle at 35% 30%, #e3d0ff, #8b5cf6 60%, #4c1d95);
    color: #1e1033;
    box-shadow: 0 0 0.7rem rgb(139 92 246 / 55%);
  }
</style>
