import { getStore } from '@netlify/blobs';
import { getVerifiedUser } from '../lib/auth.mjs';

export default async function handler(req) {
  const user = await getVerifiedUser(req);

  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 });
  }

  const storeName = `psg-history-${user.email.replace(/[^a-z0-9]/gi, '-')}`;
  const store     = getStore(storeName);

  const url = new URL(req.url);
  const key = url.searchParams.get('key');

  // Fetch a specific item (for re-download / re-preview)
  if (key) {
    try {
      const item = await store.get(key, { type: 'json' });
      if (!item) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }
      return new Response(JSON.stringify(item), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch {
      return new Response(JSON.stringify({ error: 'Could not retrieve item' }), { status: 500 });
    }
  }

  // List all items for this user (without HTML to keep response small)
  try {
    const { blobs } = await store.list();
    const items = await Promise.all(
      blobs
        .sort(function(a, b) { return b.key > a.key ? 1 : -1; }) // newest first
        .slice(0, 50) // cap at 50
        .map(async function(blob) {
          try {
            const item = await store.get(blob.key, { type: 'json' });
            // Strip HTML from list response
            const { html, ...meta } = item;
            return { ...meta, key: blob.key };
          } catch {
            return { key: blob.key, status: 'error', name: blob.key };
          }
        })
    );

    return new Response(JSON.stringify({ items }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Could not load history', detail: err.message }), { status: 500 });
  }
}

// Served at the default /.netlify/functions/get-history — matches the frontend fetch.
