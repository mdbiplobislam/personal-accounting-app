import { createClient } from '@supabase/supabase-js';
import { env } from './env';

// Browser client. It uses the publishable/anon key, and every table is protected by RLS.
// Never add a service-role key to a VITE_ variable: Vite exposes those to the browser.
export const supabase = env
  ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
