const { Storage } = require('@google-cloud/storage');

const storage = new Storage(); // picks up GOOGLE_APPLICATION_CREDENTIALS / Cloud Run's attached service account automatically

const BILLING_INVOICES_BUCKET = process.env.GCS_BILLING_INVOICES_BUCKET || 'njeis-billing-invoices';
const NJEIS_FORMS_BUCKET = process.env.GCS_NJEIS_FORMS_BUCKET || 'njeis-forms';

const bucket = (name) => storage.bucket(name);

async function uploadFile(bucketName, path, buffer, contentType) {
  await bucket(bucketName).file(path).save(buffer, { contentType, resumable: false });
}

async function downloadFile(bucketName, path) {
  const [buf] = await bucket(bucketName).file(path).download();
  return buf;
}

async function getSignedUrl(bucketName, path, expiresInSeconds) {
  const [url] = await bucket(bucketName).file(path).getSignedUrl({
    action: 'read',
    expires: Date.now() + expiresInSeconds * 1000,
  });
  return url;
}

async function removeFiles(bucketName, paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  await Promise.all(list.map((p) => bucket(bucketName).file(p).delete({ ignoreNotFound: true })));
}

async function listFiles(bucketName, prefix) {
  const [files] = await bucket(bucketName).getFiles({ prefix });
  return files.map((f) => f.name);
}

// Like listFiles, but includes each object's creation time — for call sites
// that need to sort/filter by recency (GCS list responses already include
// object metadata, so this costs no extra round-trips per file).
async function listFilesDetailed(bucketName, prefix) {
  const [files] = await bucket(bucketName).getFiles({ prefix });
  return files.map((f) => ({ name: f.name, createdAt: f.metadata.timeCreated }));
}

async function fileExists(bucketName, path) {
  const [exists] = await bucket(bucketName).file(path).exists();
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
