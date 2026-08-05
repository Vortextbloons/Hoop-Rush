import { redirect } from '@sveltejs/kit';

/**
 * M2.3.5 compatibility redirect: the standalone checkpoint page moved into
 * the run shell; the checkpoint detail defaults to the last accepted block.
 */
export const prerender = true;
export const entries = () => [{}];

export function load() {
  redirect(308, '/season/run/checkpoint/');
}
