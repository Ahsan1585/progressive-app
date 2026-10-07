/**
 * Instagram integration via Composio.
 *
 * Composio brokers the OAuth flow with Instagram so we don't have to
 * implement it ourselves: we ask Composio for a connect link, the company's
 * user visits it and authorizes on Instagram's site, then Composio marks the
 * connected account ACTIVE and we can look up/act on it by companySlug.
 *
 * One Instagram connection per company (tenant), keyed by company slug —
 * matches every other per-tenant resource in this app.
 *
 * Docs: https://docs.composio.dev/toolkits/instagram
 */
const { getComposio } = require('../config/composio');

const INSTAGRAM_TOOLKIT = 'instagram';

// In-memory cache for the Composio-managed auth config id, so we don't
// create a duplicate auth config on every request. Auth configs are
// per-toolkit, not per-company, so a single one is shared across tenants.
let cachedAuthConfigId = null;

async function getOrCreateInstagramAuthConfig() {
  if (cachedAuthConfigId) return cachedAuthConfigId;

  const composio = getComposio();
  const existing = await composio.authConfigs.list({ toolkit: INSTAGRAM_TOOLKIT });
  if (existing.items?.length > 0) {
    cachedAuthConfigId = existing.items[0].id;
    return cachedAuthConfigId;
  }

  // No options -> Composio-managed auth config (Composio hosts the OAuth
  // app credentials; we don't need our own Instagram app registered).
  const created = await composio.authConfigs.create(INSTAGRAM_TOOLKIT);
  cachedAuthConfigId = created.id;
  return cachedAuthConfigId;
}

/**
 * POST /api/instagram/connect
 * Starts the connection flow and returns a redirect URL for the company's
 * user to visit and authorize Instagram access.
 */
const startInstagramConnect = async (req, res) => {
  try {
    const companySlug = req.practitioner.slug;
    const authConfigId = await getOrCreateInstagramAuthConfig();

    const connectionRequest = await getComposio().connectedAccounts.link(companySlug, authConfigId, {
      callbackUrl: process.env.INSTAGRAM_CONNECT_CALLBACK_URL || undefined,
    });

    res.json({
      redirectUrl: connectionRequest.redirectUrl,
      connectionRequestId: connectionRequest.id,
    });
  } catch (err) {
    console.error('[instagram] Failed to start connection:', err);
    res.status(500).json({ error: 'Failed to start Instagram connection.' });
  }
};

/**
 * GET /api/instagram/status
 * Reports whether this company has an active Instagram connection.
 */
const getInstagramStatus = async (req, res) => {
  try {
    const companySlug = req.practitioner.slug;
    const accounts = await getComposio().connectedAccounts.list({
      userIds: [companySlug],
      toolkitSlugs: [INSTAGRAM_TOOLKIT],
    });

    const active = accounts.items?.find((a) => a.status === 'ACTIVE');
    res.json({
      connected: !!active,
      connectedAccountId: active?.id || null,
    });
  } catch (err) {
    console.error('[instagram] Failed to fetch status:', err);
    res.status(500).json({ error: 'Failed to fetch Instagram connection status.' });
  }
};

/**
 * DELETE /api/instagram/connection/:id
 * Revokes/removes a connected Instagram account.
 */
const disconnectInstagram = async (req, res) => {
  try {
    const { id } = req.params;
    await getComposio().connectedAccounts.delete(id);
    res.json({ success: true });
  } catch (err) {
    console.error('[instagram] Failed to disconnect:', err);
    res.status(500).json({ error: 'Failed to disconnect Instagram.' });
  }
};

module.exports = { startInstagramConnect, getInstagramStatus, disconnectInstagram };
