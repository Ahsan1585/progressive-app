/**
 * Helper for driving the already-connected @izaya.eis Instagram account
 * through Composio, used for ad-hoc content/marketing actions run from
 * chat (posting, checking recent media, etc.) rather than through the
 * per-tenant /api/instagram HTTP routes.
 *
 * The entity id below is the Composio "user_id" that owns the ACTIVE
 * instagram connected account (ca__SM8R68hbVrx) — found via
 * composio.client.connectedAccounts.retrieve(), since the SDK's list/get
 * transformers don't surface user_id. ig_user_id uses Instagram's 'me'
 * shortcut so we don't need the numeric IG business account id.
 */
const { getComposio } = require('../config/composio');

const INSTAGRAM_ENTITY_ID = 'pg-test-0215eb4e-a162-42f5-930f-2a7beef69cf4';
const IG_USER_ID = 'me';

/** Cache of resolved tool versions so we don't refetch per call. */
const versionCache = new Map();

async function getToolVersion(slug) {
  if (versionCache.has(slug)) return versionCache.get(slug);
  const tool = await getComposio().tools.getRawComposioToolBySlug(slug);
  versionCache.set(slug, tool.version);
  return tool.version;
}

/**
 * Executes a Composio Instagram tool against the connected @izaya.eis account.
 * @param {string} slug - e.g. 'INSTAGRAM_CREATE_POST', 'INSTAGRAM_GET_IG_USER_MEDIA'
 * @param {object} args - tool-specific arguments (see each tool's inputParameters)
 */
async function runInstagramTool(slug, args = {}) {
  const version = await getToolVersion(slug);
  const result = await getComposio().tools.execute(slug, {
    userId: INSTAGRAM_ENTITY_ID,
    version,
    arguments: { ig_user_id: IG_USER_ID, ...args },
  });
  if (result.successful === false) {
    throw new Error(result.error || `${slug} failed`);
  }
  return result.data;
}

module.exports = { runInstagramTool, INSTAGRAM_ENTITY_ID, IG_USER_ID };
