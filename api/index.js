// api/index.js
// ---------------------------------------------------------------------------
// Vercel serverless entry point.
//
// Vercel runs the Express app as a serverless function (one per request),
// NOT as a long-running `node src/server.js` process. This wrapper:
//   1. reuses the cached Mongo connection (see src/config/db.js) so we don't
//      open a new pool on every invocation, and
//   2. hands the raw (req, res) to the Express app for routing.
//
// `src/server.js` is still the entry for traditional always-on hosting
// (Render/Railway/VPS) — that path also gets the background jobs + a real
// listen(). On Vercel, schedule jobs via Vercel Cron (see vercel.json).
// ---------------------------------------------------------------------------
const app = require('../src/app');
const connectDB = require('../src/config/db');

let connecting = null;

module.exports = async (req, res) => {
  try {
    if (!connecting) connecting = connectDB();
    await connecting;
  } catch (err) {
    connecting = null; // let the next invocation retry a failed connect
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ success: false, message: 'Database unavailable' }));
  }
  return app(req, res);
};
