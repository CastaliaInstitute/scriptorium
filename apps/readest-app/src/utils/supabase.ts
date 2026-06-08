import { createClient } from '@supabase/supabase-js';
import { getRuntimeConfig } from '@/services/runtimeConfig';

const supabaseUrl =
  getRuntimeConfig()?.supabaseUrl ||
  process.env['SUPABASE_URL'] ||
  process.env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseAnonKey =
  getRuntimeConfig()?.supabaseAnonKey ||
  process.env['SUPABASE_ANON_KEY'] ||
  process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

export const createSupabaseClient = (accessToken?: string) => {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase is not configured for this Scriptorium build.');
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: accessToken
        ? {
            Authorization: `Bearer ${accessToken}`,
          }
        : {},
    },
  });
};

export const createSupabaseAdminClient = () => {
  if (!supabaseUrl) {
    throw new Error('Supabase is not configured for this Scriptorium build.');
  }
  const supabaseAdminKey = process.env['SUPABASE_ADMIN_KEY'] || '';
  return createClient(supabaseUrl, supabaseAdminKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
};
