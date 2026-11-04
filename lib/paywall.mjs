import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { publicPreview } from './report.mjs';

export const hashToken = token => createHash('sha256').update(token).digest('hex');
export const validId = id => typeof id === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id);
const cookieName = id => `glowup_${id}`;

export async function saveReport(store, report, res, env = process.env) {
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const preview = publicPreview(report);
  await store.insertReport({ id, report, preview, status: 'unpaid',
    access_token_hash: hashToken(token), expires_at: new Date(Date.now() + 7 * 86400000).toISOString() });
  res.setHeader('Set-Cookie', `${cookieName(id)}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=604800${env.NODE_ENV === 'production' || env.VERCEL ? '; Secure' : ''}`);
  return { reportId: id, preview };
}

export async function authorizeReport(store, req, id) {
  if (!validId(id)) return null;
  const cookies = String(req.headers.cookie || '').split(';').map(s => s.trim());
  const token = cookies.find(s => s.startsWith(`${cookieName(id)}=`))?.slice(cookieName(id).length + 1);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const hash = hashToken(token);
  const row = await store.findReport(id, hash);
  if (!row || !['unpaid', 'paid'].includes(row.status) ||
      !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) return null;
  return { ...row, hash };
}

export function privateHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}
