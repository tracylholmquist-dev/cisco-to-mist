'use strict';
/**
 * mist-proxy — Netlify serverless function
 *
 * Forwards browser requests to the Juniper Mist API server-side,
 * bypassing the browser's CORS restrictions entirely.
 *
 * POST body (JSON):
 *   targetUrl  — full Mist API URL  (e.g. https://api.mist.com/api/v1/self)
 *   method     — HTTP verb          (GET | POST | PUT)
 *   token      — Mist API token
 *   payload    — request body obj   (optional, for POST/PUT)
 *
 * Security controls:
 *   - CORS origin is restricted to the site's own domain (set SITE_ORIGIN env var)
 *   - targetUrl must resolve to a known Mist API hostname (allowlist)
 *   - Only GET, POST, and PUT methods are forwarded
 *   - Token format is validated before forwarding
 */

const https = require('https');

// ── Allowed Mist API hostnames ──────────────────────────────────
// Requests to any other hostname are rejected with 403.
const ALLOWED_MIST_HOSTS = new Set([
  'api.mist.com',       // Global 01
  'api.gc1.mist.com',   // Global 02
  'api.ac2.mist.com',   // Global 03
  'api.gc2.mist.com',   // Global 04
  'api.gc4.mist.com',   // Global 05
  'api.eu.mist.com',    // EMEA 01
  'api.gc3.mist.com',   // EMEA 02
  'api.ac6.mist.com',   // EMEA 03
  'api.gc6.mist.com',   // EMEA 04
  'api.ac5.mist.com',   // APAC 01
  'api.gc5.mist.com',   // APAC 02
  'api.gc7.mist.com',   // APAC 03
]);

// ── Allowed HTTP methods ────────────────────────────────────────
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT']);

// ── CORS origin ─────────────────────────────────────────────────
// Set the SITE_ORIGIN environment variable in Netlify to your site's
// URL (e.g. https://your-site.netlify.app) to restrict which origin
// may call this function. Falls back to '*' only if the variable is
// not configured, to avoid breaking first-time deployments.
const ALLOWED_ORIGIN = process.env.SITE_ORIGIN || '*';

function corsHeaders(requestOrigin) {
  // If a specific origin is configured, echo it back only when it matches.
  // This prevents other sites from using the proxy even if they try.
  const origin =
    ALLOWED_ORIGIN === '*'
      ? '*'
      : requestOrigin === ALLOWED_ORIGIN
        ? requestOrigin
        : 'null';  // 'null' causes the browser to block the response
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

exports.handler = async (event) => {
  const requestOrigin = (event.headers && event.headers.origin) || '';
  const CORS = corsHeaders(requestOrigin);

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  }

  // ── Parse request body ────────────────────────────────────────
  let parsed;
  try {
    parsed = JSON.parse(event.body || '{}');
  } catch (_) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const { targetUrl, method = 'GET', token, payload } = parsed;

  // ── Validate targetUrl ────────────────────────────────────────
  if (!targetUrl) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'targetUrl is required' }),
    };
  }

  let url;
  try {
    url = new URL(targetUrl);
  } catch (_) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid targetUrl' }),
    };
  }

  // Enforce HTTPS and restrict to known Mist API hostnames
  if (url.protocol !== 'https:') {
    return {
      statusCode: 403,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Only HTTPS targets are permitted' }),
    };
  }

  if (!ALLOWED_MIST_HOSTS.has(url.hostname)) {
    return {
      statusCode: 403,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Target host '${url.hostname}' is not permitted` }),
    };
  }

  // ── Validate HTTP method ──────────────────────────────────────
  const upperMethod = method.toUpperCase();
  if (!ALLOWED_METHODS.has(upperMethod)) {
    return {
      statusCode: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Method '${method}' is not permitted` }),
    };
  }

  // ── Validate token format ─────────────────────────────────────
  // Mist API tokens are alphanumeric strings. Reject anything that
  // looks like an injection attempt before it ever leaves the proxy.
  if (token && !/^[A-Za-z0-9_\-]{8,256}$/.test(token)) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid token format' }),
    };
  }

  // ── Build and forward the request ────────────────────────────
  const bodyStr = payload != null ? JSON.stringify(payload) : null;

  const reqHeaders = {
    'Authorization': token ? `Token ${token}` : '',
    'Content-Type':  'application/json',
    'Accept':        'application/json',
  };
  if (bodyStr) {
    reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr).toString();
  }

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port:     443,
        path:     url.pathname + url.search,
        method:   upperMethod,
        headers:  reqHeaders,
      },
      (res) => {
        const chunks = [];
        res.on('data',  (c) => chunks.push(c));
        res.on('end',   ()  => {
          resolve({
            statusCode: res.statusCode,
            headers: { ...CORS, 'Content-Type': 'application/json' },
            body: Buffer.concat(chunks).toString(),
          });
        });
        res.on('error', (err) => {
          resolve({
            statusCode: 502,
            headers: { ...CORS, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: err.message }),
          });
        });
      }
    );

    req.on('error', (err) => {
      resolve({
        statusCode: 502,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err.message }),
      });
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
};
