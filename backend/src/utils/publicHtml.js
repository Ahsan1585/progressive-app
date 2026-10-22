// Tiny server-rendered shell for the public, tokenised pages (secure records
// gateway, parent consent management). Plain forms, no scripts, never cached.
const { escapeHtml } = require('./emailClient');

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
  'X-Robots-Tag': 'noindex, nofollow',
};

function renderPage(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${escapeHtml(title)}</title>
<style>
  body { margin:0; background:#F7FAF9; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#132A3E; }
  main { max-width:560px; margin:40px auto; padding:32px 24px; background:#fff; border-radius:16px; border-top:5px solid #0E6E67; box-sizing:border-box; }
  h1 { font-size:23px; margin:0 0 14px; }
  p { color:#5C6B73; line-height:1.6; font-size:14.5px; }
  dl { margin:0 0 14px; font-size:14px; }
  dt { color:#5C6B73; font-size:12px; margin-top:10px; }
  dd { margin:2px 0 0; color:#132A3E; }
  .notice { border:1px solid #E2EAE8; border-radius:8px; padding:12px 14px; color:#132A3E; font-size:13px; line-height:1.55; }
  .err { border:1px solid #F0B4B4; background:#FDF2F2; color:#9B1C1C; border-radius:8px; padding:10px 14px; font-size:13.5px; }
  button, .btn { display:block; width:100%; margin:12px 0; padding:14px 20px; background:#0E6E67; color:#fff; border:0; border-radius:10px; font-size:15px; font-weight:600; cursor:pointer; }
  button.secondary { background:#fff; color:#0E6E67; border:1px solid #0E6E67; }
  button.danger { background:#B42318; }
  input[type=date], input[name=code] { width:100%; box-sizing:border-box; padding:14px; font-size:18px; border:1px solid #C9D6D3; border-radius:10px; }
  input[name=code] { font-size:24px; letter-spacing:8px; text-align:center; }
  label { font-size:13px; color:#5C6B73; display:block; margin:12px 0 6px; }
  @media (max-width:600px) { main { margin:16px; } }
</style>
</head>
<body><main>${bodyHtml}</main></body>
</html>`;
}

function sendPage(res, status, title, bodyHtml) {
  res.set(NO_STORE_HEADERS);
  res.set('Content-Type', 'text/html; charset=utf-8');
  return res.status(status).send(renderPage(title, bodyHtml));
}

function rejectPage(res, status, message) {
  return sendPage(res, status, 'Link unavailable', `<h1>Link unavailable</h1><p>${escapeHtml(message)}</p>`);
}

module.exports = { NO_STORE_HEADERS, renderPage, sendPage, rejectPage };
