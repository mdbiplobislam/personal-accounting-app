import { z } from 'zod';

// Validated once at startup so a missing variable fails with a clear message
// instead of a confusing network error later.
const envSchema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(20),
});

const parsed = envSchema.safeParse(import.meta.env);

export const env = parsed.success ? parsed.data : null;

export const envError = parsed.success
  ? null
  : 'Missing configuration. Copy .env.example to .env.local and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.';
