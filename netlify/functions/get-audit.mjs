import { getStore } from '@netlify/blobs';
import { getVerifiedUser } from '../lib/auth.mjs';

export default async function handler(req) {
  const user = await getVerifiedUser(req);

  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 });
  }

  if (!user.roles.includes('admin')) {
    return new Response(JSON.stringify({ error: 'Forbidden -- admin role required' }), { status: 403 });
  }

  const store = getStore('psg-audit');

  try {
    const { blobs } = await store.list();

    const items = await Promise.all(
      blobs
        .sort(function(a, b) { return b.key > a.key ? 1 : -1; }) // newest first
        .slice(0, 500) // cap at 500 entries
        .map(async function(blob) {
          try {
            return await store.get(blob.key, { type: 'json' });
          } catch {
            return { key: blob.key, status: 'error', timestamp: blob.key.split('-').slice(0,3).join('-') };
          }
        })
    );

    return new Response(JSON.stringify({ items, total: blobs.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Could not load audit log', detail: err.message }), { status: 500 });
  }
}

// Served at the default /.netlify/functions/get-audit — matches the frontend fetch.
