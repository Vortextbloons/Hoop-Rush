import { redirect } from '@sveltejs/kit';

/**
 * M2.3.5 compatibility redirect: the pre-shell league hub moved to the
 * League tab under the shared run shell.
 */
export const prerender = true;
export const entries = () => [{}];

export function load() {
  redirect(308, '/season/run/league/');
}
