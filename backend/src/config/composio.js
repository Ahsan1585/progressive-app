/**
 * Composio SDK client singleton.
 *
 * Composio lets us connect the app to third-party services (Instagram, etc.)
 * without hand-rolling each provider's OAuth flow. See src/utils/instagramConnect.js
 * for how the Instagram auth config + connection link are obtained.
 *
 * Docs: https://docs.composio.dev
 */
const { Composio } = require('@composio/core');

// Lazy singleton — the SDK's constructor throws synchronously when no API
// key is configured, which would otherwise crash the entire backend at
// boot just because this one optional integration isn't set up in a given
// environment. Deferring construction to first actual use means a missing
// COMPOSIO_API_KEY only breaks Composio-backed features (e.g. Instagram),
// not the whole server.
let composioInstance = null;

function getComposio() {
  if (!composioInstance) {
    if (!process.env.COMPOSIO_API_KEY) {
      throw new Error('COMPOSIO_API_KEY is not set — Composio-backed integrations (e.g. Instagram) are unavailable.');
    }
    composioInstance = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  }
  return composioInstance;
}

module.exports = { getComposio };
