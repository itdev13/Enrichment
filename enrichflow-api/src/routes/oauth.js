const express = require('express');
const router = express.Router();
const ghlService = require('../services/ghlService');
const database = require('../config/database');
const OAuthToken = require('../models/OAuthToken');
const Installation = require('../models/Installation');
const logger = require('../utils/logger');

/** White-label success page shown after a successful install (no platform branding). */
function connectedPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>EnrichFlow connected</title>
<style>
  :root { --brand:#6d28d9; --brand2:#9333ea; --ink:#1e1b2e; --muted:#6b7280; --line:#ece9f5; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
         background:linear-gradient(135deg,#f5f3ff 0%,#ffffff 60%); color:var(--ink);
         min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { width:100%; max-width:440px; background:#fff; border:1px solid var(--line); border-radius:18px;
          box-shadow:0 18px 50px rgba(109,40,217,.12); padding:34px 30px; text-align:center; }
  .badge { width:62px; height:62px; margin:0 auto 18px; border-radius:50%;
           background:linear-gradient(135deg,var(--brand),var(--brand2)); display:flex; align-items:center;
           justify-content:center; color:#fff; font-size:30px; box-shadow:0 8px 20px rgba(109,40,217,.35); }
  h1 { margin:0 0 6px; font-size:22px; }
  .sub { margin:0 0 22px; color:var(--muted); font-size:14px; line-height:1.5; }
  .what { text-align:left; background:#faf8ff; border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin:0 0 20px; }
  .what li { margin:7px 0; font-size:13.5px; color:#3f3a52; }
  .next { display:flex; gap:10px; align-items:flex-start; text-align:left; background:#f3effe;
          border-radius:12px; padding:14px 16px; font-size:13.5px; line-height:1.5; }
  .next b { color:var(--brand); }
  .pin { font-size:18px; line-height:1.2; }
  .foot { margin-top:22px; font-size:12px; color:#a8a3b8; }
</style>
</head>
<body>
  <div class="card">
    <div class="badge">&#10003;</div>
    <h1>EnrichFlow is connected</h1>
    <p class="sub">Your CRM sub-account is now linked. EnrichFlow can read your contacts and write back the data it finds.</p>

    <ul class="what">
      <li>&#128269; Finds missing <b>emails</b>, <b>phone numbers</b> &amp; <b>firmographics</b> for your contacts</li>
      <li>&#9889; Enrich a single contact, or run <b>bulk enrichment</b> across your list</li>
      <li>&#129518; Automate it inside any workflow with the <b>Enrich Contact</b> action</li>
      <li>&#128202; Track usage, matches &amp; credits from the dashboard</li>
    </ul>

    <div class="next">
      <span class="pin">&#128205;</span>
      <span>Open the <b>Contact Enrichment</b> tab in your left menu to start enriching contacts. You can close this window now.</span>
    </div>

    <div class="foot">EnrichFlow &middot; Contact data enrichment</div>
  </div>
</body>
</html>`;
}

/** Start the OAuth flow — redirect the user to GHL's location chooser. */
router.get('/authorize', (req, res) => {
  if (!process.env.GHL_CLIENT_ID) {
    return res.status(500).json({ success: false, error: 'GHL_CLIENT_ID not configured' });
  }
  return res.redirect(ghlService.getAuthorizationUrl(req.query.state));
});

/** OAuth callback — GHL redirects here with ?code=... */
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) return res.status(400).send(`OAuth error: ${error}`);
  if (!code) return res.status(400).send('Missing authorization code');

  if (!database.isConnected()) {
    return res.status(503).send('Database not configured — cannot persist tokens. Set MONGODB_URI.');
  }

  try {
    const token = await ghlService.exchangeCode(code);
    const tokenType = token.locationId ? 'location' : 'company';

    await OAuthToken.findOneAndUpdate(
      token.locationId
        ? { locationId: token.locationId, tokenType }
        : { companyId: token.companyId, tokenType },
      {
        locationId: token.locationId,
        companyId: token.companyId,
        tokenType,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: new Date(Date.now() + token.expiresIn * 1000),
        userId: token.userId,
        isActive: true
      },
      { upsert: true, new: true }
    );

    logger.info('✅ OAuth install complete', {
      tokenType,
      locationId: token.locationId,
      companyId: token.companyId
    });

    return res.send(connectedPage());
  } catch (err) {
    logger.error('OAuth callback failed', { message: err.response?.data || err.message });
    return res.status(500).send('Failed to complete OAuth. Check server logs.');
  }
});

/** Check whether a location is connected. */
router.get('/status', async (req, res) => {
  const { locationId } = req.query;
  if (!locationId) return res.status(400).json({ success: false, error: 'locationId is required' });
  if (!database.isConnected()) return res.json({ success: true, connected: false, reason: 'no-database' });

  // A direct location-scoped token means we're connected.
  const locationToken = await OAuthToken.findOne({ locationId, tokenType: 'location', isActive: true });
  if (locationToken) {
    const loc = await ghlService.getLocation(locationId);
    return res.json({ success: true, connected: true, via: 'location-token', locationName: loc?.name || null });
  }

  // Agency installs only yield a company token up front; the location token is minted on demand
  // (getLocationTokenFromCompany). Treat the account as connected when a company token exists AND
  // this location has an active installation — i.e. we can serve it.
  const companyToken = await OAuthToken.findOne({ tokenType: 'company', isActive: true });
  const installation = await Installation.findOne({ locationId, status: 'active' });
  if (companyToken && installation) {
    const loc = await ghlService.getLocation(locationId);
    return res.json({ success: true, connected: true, via: 'company-token', locationName: loc?.name || null });
  }

  return res.json({ success: true, connected: false });
});

module.exports = router;
