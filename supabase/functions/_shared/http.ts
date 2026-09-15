import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { resolveDevUid } from './dev-identity.ts';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-captcha-token, x-dev-uid',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...extraHeaders },
  });
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? 'unknown';
  return req.headers.get('x-real-ip') ?? req.headers.get('cf-connecting-ip') ?? 'unknown';
}

export async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

export async function resolveUid(req: Request, supabaseUrl: string): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (authHeader) {
    const verifyKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
    if (verifyKey) {
      const anonClient = createClient(supabaseUrl, verifyKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const {
        data: { user },
      } = await anonClient.auth.getUser();
      if (user) return user.id;
    }
  }
  return resolveDevUid(req.headers, {
    supabaseUrl,
    // x-dev-uid is honored only for local deployments that opt in explicitly.
    allowDevUid: Deno.env.get('SEASON_ALLOW_DEV_UID') === 'true',
  });
}
