import { redirect } from '@sveltejs/kit';

/**
 * M2.3.5 compatibility redirect: the pre-shell league hub moved to the
 * League tab under the shared run shell.
 */
export const prerender = true;
/** Route entries generator (this route has no dynamic params). */
export const entries: () => Array<Record<string, never>> = () => [{}];

export function load() {
  redirect(308, '/season/run/league/');
}
