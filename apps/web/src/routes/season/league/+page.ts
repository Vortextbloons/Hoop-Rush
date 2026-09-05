import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
export const prerender = true;
export const entries: () => Array<Record<string, never>> = () => [{}];
export function load() {
  redirect(308, resolve('/season/run/league/'));
}
