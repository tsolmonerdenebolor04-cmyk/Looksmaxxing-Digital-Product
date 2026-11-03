export const stagingOrigin = 'https://hbhreogfcisufnajijqy.supabase.co';
export const stagingProject = 'hbhreogfcisufnajijqy';

export function stagingConfig(env) {
  // Validate target and explicit opt-in BEFORE reading credentials or issuing requests.
  if (env.RUN_STAGING_INTEGRATION !== stagingProject || env.STAGING_SUPABASE_URL !== stagingOrigin) {
    throw new Error('Staging integration requires the exact approved staging target and explicit opt-in');
  }
  if (!env.STAGING_SUPABASE_SECRET_KEY || !env.STAGING_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Configure staging keys locally; never paste them into chat or source');
  }
  return { SUPABASE_URL: stagingOrigin, SUPABASE_SECRET_KEY: env.STAGING_SUPABASE_SECRET_KEY,
    publishableKey: env.STAGING_SUPABASE_PUBLISHABLE_KEY };
}
