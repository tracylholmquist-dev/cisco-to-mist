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
 */

const https = require('https');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  // Parse request body
  let parsed;
  try {
    parsed = JSON.parse(event.body || '{}');
  } catch (_) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const { targetUrl, method = 'GET', token, payload } = parsed;

  if (!targetUrl) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'targetUrl is required' }),
    };
  }

  let url;
  try {
    url = new URL(targetUrl);
  } catch (_) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid targetUrl' }),
    };
  }

  // Serialize body if present
  const bodyStr = payload != null ? JSON.stringify(payload) : null;

  const reqHeaders = {
    'Authorization':  token ? `Token ${token}` : '',
    'Content-Type':   'application/json',
    'Accept':         'application/json',
  };
  if (bodyStr) {
    reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr).toString();
  }

  // Forward to Mist API
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port:     443,
        path:     url.pathname + url.search,
        method:   method.toUpperCase(),
        headers:  reqHeaders,
      },
      (res) => {
        const chunks = [];
        res.on('data',  (c) => chunks.push(c));
        res.on('end',   ()  => {
          resolve({
            statusCode: res.statusCode,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            body: Buffer.concat(chunks).toString(),
          });
        });
        res.on('error', (err) => {
          resolve({
            statusCode: 502,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: err.message }),
          });
        });
      }
    );

    req.on('error', (err) => {
      resolve({
        statusCode: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err.message }),
      });
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
};
