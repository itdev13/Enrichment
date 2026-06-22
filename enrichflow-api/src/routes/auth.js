const express = require('express');
const router = express.Router();
const CryptoJS = require('crypto-js');
const logger = require('../utils/logger');

/**
 * Decrypt the GHL SSO user/location context.
 *
 * The Custom Page (iframe) asks the GHL parent window for the encrypted session via
 * postMessage('REQUEST_USER_DATA'), then POSTs the returned ciphertext here. We decrypt it
 * with the app's Shared Secret (Advanced Settings -> Auth) so the UI gets the active
 * locationId/companyId/userId without any manual input.
 *
 * Reference: https://marketplace.gohighlevel.com/docs/other/user-context-marketplace-apps
 */
router.post('/decrypt-user-data', (req, res) => {
  const { encryptedData } = req.body || {};

  if (!encryptedData) {
    return res.status(400).json({ success: false, error: 'encryptedData is required' });
  }

  const sharedSecret = process.env.GHL_APP_SHARED_SECRET;
  if (!sharedSecret) {
    logger.error('GHL_APP_SHARED_SECRET is not configured — cannot decrypt SSO context');
    return res.status(500).json({ success: false, error: 'Shared Secret not configured' });
  }

  try {
    const decrypted = CryptoJS.AES.decrypt(encryptedData, sharedSecret).toString(CryptoJS.enc.Utf8);
    if (!decrypted) throw new Error('Decryption produced empty output');

    const userData = JSON.parse(decrypted);

    if (process.env.NODE_ENV !== 'production') {
      logger.info('SSO context decrypted', {
        companyId: userData.companyId,
        activeLocation: userData.activeLocation,
        type: userData.type
      });
    }

    // GHL uses `activeLocation` for the location context; expose `locationId` as a convenience alias.
    return res.json({
      success: true,
      userId: userData.userId,
      companyId: userData.companyId,
      activeLocation: userData.activeLocation || null,
      locationId: userData.activeLocation || null,
      email: userData.email,
      userName: userData.userName,
      role: userData.role,
      type: userData.type
    });
  } catch (err) {
    logger.error('Failed to decrypt SSO user data', { message: err.message });
    return res.status(400).json({ success: false, error: 'Failed to decrypt user data' });
  }
});

module.exports = router;
