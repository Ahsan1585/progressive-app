const { Storage } = require('@google-cloud/storage');
const { getCurrentTenantDb } = require('./tenantContext');

const storage = new Storage(); // picks up GOOGLE_APPLICATION_CREDENTIALS / Cloud Run's attached service account automatically

const BILLING_INVOICES_BUCKET = process.env.GCS_BILLING_INVOICES_BUCKET || 'njeis-billing-invoices';
const NJEIS_FORMS_BUCKET = process.env.GCS_NJEIS_FORMS_BUCKET || 'njeis-forms';

const bucket = (name) => storage.bucket(name);

// Both GCS buckets are shared across every company (a dedicated bucket per
// tenant, mirroring the per-tenant-database model, would multiply without
// bound as companies sign up — GCS has no per-project bucket-count limit
// concern like Cloud SQL connections, but managing thousands of buckets is
// its own operational burden). Instead every object path is transparently
// prefixed with the current tenant's database name — the same identifier
// AsyncLocalStorage already threads through every request (see
// tenantContext.js/db.js) — so this is the exact same isolation model as
// the Postgres layer, just applied to a second storage system.
//
// This was originally missed entirely: every function below took a bare
// relative path with no tenant scoping, so a wide-open prefix listing (or
// even a same-named-practitioner path collision) crossed tenant
// boundaries. Centralizing the fix here (not in each caller) is deliberate
// — the exact same lesson as db.js's Proxy: it's far safer to make the
// shared primitive tenant-aware once than to trust every call site to
// remember to scope itself.
function scopedPath(path) {
  return `${getCurrentTenantDb()}/${path}`;
}

// Strips the tenant prefix back off a full object name before handing it
// back to callers — every existing caller (getInvoiceHistory's file list,
// the BILLING_FILE_PATTERN download-url validator, etc.) expects the same
// bare relative path format it always has, not tenant_x/relative/path.
function unscopedName(fullName) {
  const prefix = `${getCurrentTenantDb()}/`;
  return fullName.startsWith(prefix) ? fullName.slice(prefix.length) : fullName;
}

async function uploadFile(bucketName, path, buffer, contentType) {
  await bucket(bucketName).file(scopedPath(path)).save(buffer, { contentType, resumable: false });
}

async function downloadFile(bucketName, path) {
  const [buf] = await bucket(bucketName).file(scopedPath(path)).download();
  return buf;
}

async function getSignedUrl(bucketName, path, expiresInSeconds) {
  const [url] = await bucket(bucketName).file(scopedPath(path)).getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresInSeconds * 1000,
  });
  return url;
}

async function removeFiles(bucketName, paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  await Promise.all(list.map((p) => bucket(bucketName).file(scopedPath(p)).delete({ ignoreNotFound: true })));
}

async function listFiles(bucketName, prefix) {
  const [files] = await bucket(bucketName).getFiles({ prefix: scopedPath(prefix) });
  return files.map((f) => unscopedName(f.name));
}

// Like listFiles, but includes each object's creation time — for call sites
// that need to sort/filter by recency (GCS list responses already include
// object metadata, so this costs no extra round-trips per file).
async function listFilesDetailed(bucketName, prefix) {
  const [files] = await bucket(bucketName).getFiles({ prefix: scopedPath(prefix) });
  return files.map((f) => ({ name: unscopedName(f.name), createdAt: f.metadata.timeCreated }));
}

async function fileExists(bucketName, path) {
  const [exists] = await bucket(bucketName).file(scopedPath(path)).exists();
  return exists;
}

module.exports = {
  BILLING_INVOICES_BUCKET,
  NJEIS_FORMS_BUCKET,
  uploadFile,
  downloadFile,
  getSignedUrl,
  removeFiles,
  listFiles,
  listFilesDetailed,
  fileExists,
};
