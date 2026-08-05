import { redirect } from '@sveltejs/kit';
import { base } from '$app/paths';

/**
 * M2.3.5 compatibility redirect: the standalone checkpoint page moved into
 * the run shell; the checkpoint detail defaults to the last accepted block.
 */
export const prerender = true;
/** Route entries generator (this route has no dynamic params). */
export const entries: () => Array<Record<string, never>> = () => [{}];

export function load() {
  redirect(308, `${base}/season/run/checkpoint/`);
}
