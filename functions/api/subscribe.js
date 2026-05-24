// Cloudflare Pages Function: POST /api/subscribe
//
// Handles newsletter signups from the ByteRaid landing page.
// Forwards the email to Resend's Contacts API if RESEND_API_KEY +
// RESEND_AUDIENCE_ID are configured. Always logs to console so
// submissions are recoverable via Cloudflare Pages logs even
// before Resend is wired up.
//
// Required env vars (set in Cloudflare Pages → Settings → Environment variables):
//   RESEND_API_KEY      — from https://resend.com/api-keys
//   RESEND_AUDIENCE_ID  — UUID of the Resend audience to add contacts to
//
// Optional:
//   ALLOWED_ORIGIN  — restrict CORS to one origin (defaults to "*")

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(body, init = {}, env = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...cors(env),
      ...(init.headers || {}),
    },
  });
}

export async function onRequestOptions({ env }) {
  return new Response(null, { status: 204, headers: cors(env) });
}

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 }, env);
  }

  const email = (payload?.email || '').toString().trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return json({ ok: false, error: 'Invalid email address.' }, { status: 400 }, env);
  }

  // Always log so submissions are recoverable via Pages logs.
  // View in: Cloudflare dashboard → Pages → byteraid-landing → Functions → Real-time logs
  // Or stream with: npx wrangler pages deployment tail
  const ts = new Date().toISOString();
  const cfCountry = request.headers.get('CF-IPCountry') || 'unknown';
  console.log(`[subscribe] ${ts} email=${email} country=${cfCountry}`);

  // If Resend is configured, forward the contact.
  if (env.RESEND_API_KEY && env.RESEND_AUDIENCE_ID) {
    try {
      const r = await fetch(
        `https://api.resend.com/audiences/${env.RESEND_AUDIENCE_ID}/contacts`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email, unsubscribed: false }),
        },
      );

      if (!r.ok) {
        const errText = await r.text();
        console.error(`[subscribe] Resend error ${r.status}: ${errText}`);
        // Don't leak vendor errors to the client — treat as soft success
        // since we have the email in logs and can recover.
        return json(
          { ok: true, stored: 'logs', note: 'queued' },
          { status: 202 },
          env,
        );
      }

      return json({ ok: true, stored: 'resend' }, { status: 200 }, env);
    } catch (err) {
      console.error(`[subscribe] Resend fetch failed: ${err}`);
      return json(
        { ok: true, stored: 'logs', note: 'queued' },
        { status: 202 },
        env,
      );
    }
  }

  // Resend not configured — email is in logs only.
  console.warn(
    '[subscribe] RESEND_API_KEY or RESEND_AUDIENCE_ID not set — email captured to logs only.',
  );
  return json({ ok: true, stored: 'logs' }, { status: 200 }, env);
}

// Anything other than POST/OPTIONS
export async function onRequest({ env }) {
  return json({ ok: false, error: 'Method not allowed.' }, { status: 405 }, env);
}
