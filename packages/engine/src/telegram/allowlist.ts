export interface AllowlistConfig {
  userIds: Set<number>;
  usernames: Set<string>;
  allowAll: boolean;
}

export function loadAllowlist(): AllowlistConfig {
  const allowAll = process.env.TELEGRAM_ALLOW_ALL === '1';
  const ids = (process.env.TELEGRAM_ALLOWED_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
  const usernames = (process.env.TELEGRAM_ALLOWED_USERNAMES || '')
    .split(',')
    .map((s) => s.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean);
  return {
    allowAll,
    userIds: new Set(ids),
    usernames: new Set(usernames),
  };
}

export function isAllowlisted(
  user: { id?: number; username?: string } | undefined,
  cfg = loadAllowlist(),
): boolean {
  if (cfg.allowAll) return true;
  if (cfg.userIds.size === 0 && cfg.usernames.size === 0) return false; // default deny
  if (!user) return false;
  if (user.id !== undefined && cfg.userIds.has(user.id)) return true;
  if (user.username && cfg.usernames.has(user.username.toLowerCase())) return true;
  return false;
}
