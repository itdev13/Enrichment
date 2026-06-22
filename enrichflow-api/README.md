# EnrichFlow API

GoHighLevel marketplace app for **contact data enrichment**. Given a sparse GHL contact
(name + company, or just an email), EnrichFlow fills in work email, phone, job title,
LinkedIn, and firmographics using a **provider waterfall** (cheap primary → premium fallback)
and charges the customer in **credits** based on what was found.

This is the backend service. It mirrors the proven architecture of our shipped ConvoVault app
(Node/Express + MongoDB + GHL OAuth + GHL Marketplace billing).

---

## Quick start (local, no GHL account needed)

The fastest way to validate the core logic is the pure-local enrichment test. It needs **no
MongoDB, no GHL credentials, and no provider API keys** — it runs against a built-in mock provider.

```bash
cd enrichflow-api
npm install
cp .env.example .env       # defaults are fine for local testing
npm run enrich:local
```

You'll see the waterfall + tiered-credit accounting run across several sample contacts
(full match, missing-phone-filled-by-fallback, no-match, company-only).

---

## Run the API locally

A MongoDB connection is **required** to start the server (set `MONGODB_URI` in `.env`); the process
exits on boot if it can't connect. The `npm run enrich:local` mock test above needs no DB.

```bash
npm run dev                # starts on http://localhost:3010
curl http://localhost:3010/health
```

### Test enrichment over HTTP (still no GHL needed — "local mode")

```bash
# Dry run: returns enriched data + credits, no charge, no write-back
curl -s -X POST http://localhost:3010/api/enrich/preview \
  -H 'Content-Type: application/json' \
  -d '{"input":{"email":"jane.doe@acme.io","fullName":"Jane Doe","company":"Acme"}}' | jq

# Full run in local mode (no contactId -> no GHL calls; DB still required to run the server)
curl -s -X POST http://localhost:3010/api/enrich \
  -H 'Content-Type: application/json' \
  -d '{"input":{"fullName":"Sam Patel","companyDomain":"stripe.com"}}' | jq
```

Force specific providers per request (once you add real keys):

```bash
curl -s -X POST http://localhost:3010/api/enrich/preview \
  -H 'Content-Type: application/json' \
  -d '{"primary":"prospeo","fallback":"pdl","input":{"fullName":"Jane Doe","companyDomain":"acme.io"}}' | jq
```

---

## Full GHL OAuth test (requires a public tunnel + Mongo)

GHL must redirect to a public HTTPS URL, so expose your local server with a tunnel:

```bash
# in a second terminal
cloudflared tunnel --url http://localhost:3010
#   -> https://something.trycloudflare.com   (or use ngrok)
```

Then:

1. Create a marketplace app at https://marketplace.gohighlevel.com.
2. Set the **Redirect URI** to `https://<tunnel>/oauth/callback`.
3. Add scopes: `contacts.readonly contacts.write locations.readonly users.readonly oauth.readonly`.
4. Set the webhook URL to `https://<tunnel>/api/webhooks/enrichflow`.
5. Fill `.env`:
   ```env
   MONGODB_URI=mongodb://localhost:27017/enrichflow
   GHL_CLIENT_ID=...
   GHL_CLIENT_SECRET=...
   GHL_APP_ID=...
   GHL_REDIRECT_URI=https://<tunnel>/oauth/callback
   ```
6. Start the server, then visit `https://<tunnel>/oauth/authorize` (or install the app from the
   marketplace) and pick a location. Tokens are stored in Mongo.
7. Enrich a real contact + write back to GHL:
   ```bash
   curl -s -X POST https://<tunnel>/api/enrich \
     -H 'Content-Type: application/json' \
     -d '{"locationId":"<LOC>","contactId":"<CONTACT>","writeBack":true}' | jq
   ```

---

## Architecture

```
enrichflow-api/
├── src/
│   ├── server.js                 # Express app, health, route mounting
│   ├── config/database.js        # Mongo connect (REQUIRED — process exits if it can't connect)
│   ├── services/ghlService.js    # GHL OAuth + contact read/write (Version: 2021-07-28)
│   ├── enrichment/
│   │   ├── fields.js             # canonical fields + tiered-credit accounting
│   │   ├── enrichmentService.js  # provider waterfall + merge + credits
│   │   └── providers/
│   │       ├── baseProvider.js   # interface
│   │       ├── mockProvider.js   # local testing (no key, no cost)
│   │       ├── prospeoProvider.js# budget primary (needs PROSPEO_API_KEY)
│   │       └── pdlProvider.js    # premium fallback (needs PDL_API_KEY)
│   ├── routes/
│   │   ├── oauth.js              # /oauth/authorize, /oauth/callback, /oauth/status
│   │   ├── webhooks.js           # /api/webhooks/enrichflow (INSTALL/UNINSTALL)
│   │   └── enrich.js             # /api/enrich, /api/enrich/preview
│   └── models/                   # OAuthToken, Installation, EnrichmentRecord
└── scripts/test-enrich-local.js  # `npm run enrich:local`
```

### Credit model

| Data found            | Credits |
|-----------------------|---------|
| Basic (company/title/linkedin/location/industry) | 1 |
| + verified work email | +1 |
| + verified phone      | +5 |

Credits are computed from the **final merged** result, so customers only pay for what's returned.
Mapping credits → GHL wallet charges (usage meter) lands in the next step (`BILLING_ENABLED`).

---

## Status / roadmap

- [x] Project scaffold + local-first testing
- [x] GHL OAuth (location + company tokens, refresh, locationToken minting)
- [x] Install/uninstall webhooks
- [x] Provider waterfall (mock + Prospeo + PDL) with tiered credits
- [x] Enrich API (`/preview` dry-run, `/` full + write-back) and audit records
- [ ] GHL Marketplace usage billing (charge wallet per credit)
- [ ] Custom workflow action: "Enrich Contact" trigger inside GHL workflows
- [ ] Vue/React Custom Page UI (usage dashboard, bulk enrich)
- [ ] Caching/dedupe (skip re-charging recently enriched contacts)
