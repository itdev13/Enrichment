const axios = require('axios');
const logger = require('../utils/logger');
const OAuthToken = require('../models/OAuthToken');

/**
 * GoHighLevel API service.
 *
 * OAuth flow (per https://marketplace.gohighlevel.com/docs/oauth/GettingStarted):
 *   1. Redirect user to the GHL chooselocation/authorize URL with client_id + scopes + redirect_uri.
 *   2. GHL redirects back to redirect_uri with ?code=...
 *   3. Exchange the code at POST /oauth/token (grant_type=authorization_code).
 *   4. Refresh with grant_type=refresh_token before expiry.
 *   5. Company (agency) tokens can mint location tokens via POST /oauth/locationToken.
 *
 * All contact API calls send header `Version: 2021-07-28`.
 */
class GHLService {
  constructor() {
    this.baseURL = process.env.GHL_API_URL || 'https://services.leadconnectorhq.com';
    this.oauthURL = process.env.GHL_OAUTH_URL || 'https://services.leadconnectorhq.com/oauth';
  }

  /** Build the install/authorize URL the user is redirected to. */
  getAuthorizationUrl(state) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.GHL_CLIENT_ID || '',
      redirect_uri: process.env.GHL_REDIRECT_URI || '',
      scope: process.env.GHL_SCOPES || 'contacts.readonly contacts.write locations.readonly'
    });
    if (state) params.append('state', state);
    return `https://marketplace.gohighlevel.com/oauth/chooselocation?${params.toString()}`;
  }

  /** Exchange an authorization code for tokens. */
  async exchangeCode(code) {
    // Note: GHL's token endpoint does NOT require redirect_uri (it's validated at the authorize
    // step). Omitting it matches the production-proven ConvoVault flow and avoids spurious
    // "redirect_uri mismatch" errors from trailing-slash / encoding differences.
    const body = new URLSearchParams({
      client_id: process.env.GHL_CLIENT_ID,
      client_secret: process.env.GHL_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code
    });

    const { data } = await axios.post(`${this.oauthURL}/token`, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      locationId: data.locationId,
      companyId: data.companyId,
      userId: data.userId || null
    };
  }

  /** Refresh an access token. */
  async refreshAccessToken(refreshToken) {
    const body = new URLSearchParams({
      client_id: process.env.GHL_CLIENT_ID,
      client_secret: process.env.GHL_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    });

    const { data } = await axios.post(`${this.oauthURL}/token`, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in
    };
  }

  /** Mint a location token from a stored company token. */
  async getLocationTokenFromCompany(companyId, locationId) {
    const companyToken = await OAuthToken.findOne({ companyId, tokenType: 'company', isActive: true });
    if (!companyToken) throw new Error('No company token found. Reconnect EnrichFlow.');

    if (companyToken.needsRefresh()) {
      const refreshed = await this.refreshAccessToken(companyToken.refreshToken);
      companyToken.accessToken = refreshed.accessToken;
      companyToken.refreshToken = refreshed.refreshToken;
      companyToken.expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
      await companyToken.save();
    }

    const { data } = await axios.post(
      `${this.oauthURL}/locationToken`,
      { companyId, locationId },
      {
        headers: {
          Authorization: `Bearer ${companyToken.accessToken}`,
          'Content-Type': 'application/json',
          Version: '2021-07-28'
        }
      }
    );

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in
    };
  }

  /**
   * Get a valid location access token, auto-refreshing or minting from the company token as needed.
   */
  async getValidToken(locationId) {
    let tokenDoc = await OAuthToken.findOne({ locationId, tokenType: 'location', isActive: true });

    // No location token yet: mint one from the company token.
    if (!tokenDoc) {
      const companyToken = await OAuthToken.findOne({ tokenType: 'company', isActive: true });
      if (!companyToken) {
        const err = new Error('Location not connected. Please install EnrichFlow on this sub-account.');
        err.status = 404;
        throw err;
      }
      const minted = await this.getLocationTokenFromCompany(companyToken.companyId, locationId);
      tokenDoc = await OAuthToken.findOneAndUpdate(
        { locationId, tokenType: 'location' },
        {
          locationId,
          companyId: companyToken.companyId,
          tokenType: 'location',
          accessToken: minted.accessToken,
          refreshToken: minted.refreshToken,
          expiresAt: new Date(Date.now() + minted.expiresIn * 1000),
          isActive: true
        },
        { upsert: true, new: true }
      );
    }

    if (tokenDoc.needsRefresh()) {
      const refreshed = await this.refreshAccessToken(tokenDoc.refreshToken);
      tokenDoc.accessToken = refreshed.accessToken;
      tokenDoc.refreshToken = refreshed.refreshToken;
      tokenDoc.expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
      await tokenDoc.save();
    }

    return tokenDoc.accessToken;
  }

  /** Authenticated GHL API request with a single 401 refresh-and-retry. */
  async apiRequest(method, endpoint, locationId, { data, params } = {}, retry = 0) {
    try {
      const accessToken = await this.getValidToken(locationId);
      const res = await axios({
        method,
        url: `${this.baseURL}${endpoint}`,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Version: '2021-07-28'
        },
        data,
        params
      });
      return res.data;
    } catch (error) {
      if (error.response?.status === 401 && retry === 0) {
        logger.warn('GHL 401 — refreshing token and retrying', { endpoint });
        const tokenDoc = await OAuthToken.findActiveToken(locationId);
        if (tokenDoc?.refreshToken) {
          const refreshed = await this.refreshAccessToken(tokenDoc.refreshToken);
          tokenDoc.accessToken = refreshed.accessToken;
          tokenDoc.refreshToken = refreshed.refreshToken;
          tokenDoc.expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
          await tokenDoc.save();
        }
        return this.apiRequest(method, endpoint, locationId, { data, params }, retry + 1);
      }
      logger.error('GHL API request failed', {
        method,
        endpoint,
        status: error.response?.status,
        message: error.response?.data?.message || error.message
      });
      throw error;
    }
  }

  /** GET /contacts/:id */
  async getContact(locationId, contactId) {
    const res = await this.apiRequest('GET', `/contacts/${contactId}`, locationId);
    return res.contact || res;
  }

  /** PUT /contacts/:id — write enriched fields back to GHL. */
  async updateContact(locationId, contactId, updates) {
    const res = await this.apiRequest('PUT', `/contacts/${contactId}`, locationId, { data: updates });
    return res.contact || res;
  }

  /** GET /contacts/ — list contacts for a location (UI bulk-enrich picker). */
  async searchContacts(locationId, { limit = 20, query, startAfterId, startAfter } = {}) {
    const params = { locationId, limit };
    if (query) params.query = query;
    if (startAfterId) params.startAfterId = startAfterId;
    if (startAfter) params.startAfter = startAfter;
    const res = await this.apiRequest('GET', '/contacts/', locationId, { params });
    return {
      contacts: res.contacts || [],
      total: res.total || res.meta?.total || (res.contacts || []).length,
      meta: res.meta || {}
    };
  }
}

module.exports = new GHLService();
