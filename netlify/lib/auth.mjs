// ---------------------------------------------------------------------------
// Verified Netlify Identity auth for functions.
//
// The old getUserFromToken() base64-decoded the JWT payload WITHOUT verifying
// the signature — so any caller could forge a token with arbitrary email/roles
// (read the whole audit log, impersonate users, burn the Anthropic key).
//
// This helper instead asks the site's own Netlify Identity (GoTrue) service to
// resolve the token: GET /.netlify/identity/user with the Bearer token. GoTrue
// validates the signature and expiry server-side, so a 200 means the token was
// genuinely issued by THIS site's Identity. We only trust email/roles from that
// verified response — never from the raw, unverified token.
//
// This is deliberately not `context.clientContext.user`: that field is a v1
// Functions feature and is not exposed to v2 (req, context) functions.
// ---------------------------------------------------------------------------

export async function getVerifiedUser(req) {
  const authHeader = req.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;

  // Resolve the Identity endpoint from the request's own origin.
  let origin;
  try {
    origin = new URL(req.url).origin;
  } catch {
    return null;
  }

  try {
    const res = await fetch(`${origin}/.netlify/identity/user`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null; // 401 = bad signature / expired / revoked

    const u = await res.json();
    if (!u || !u.email) return null;

    return {
      email: u.email,
      roles: (u.app_metadata && u.app_metadata.roles) || [],
    };
  } catch {
    // Identity service unreachable — fail closed (treat as unauthenticated).
    return null;
  }
}
