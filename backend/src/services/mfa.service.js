const { authenticator } = require('otplib');
const qrcode = require('qrcode');
const { db } = require('../config');
const { User } = require('../models');

/**
 * MFA Service (TOTP)
 */
class MfaService {
  /**
   * Generate a new TOTP secret for a user and return the QR code URL.
   * Does not enable MFA yet; the user must verify the code first.
   * 
   * @param {Object} user - The user instance
   * @returns {Promise<{ secret: string, qrCodeDataUrl: string }>}
   */
  async generateSecret(user) {
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, 'Callibrator', secret);
    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);
    
    // Store temporarily in user record (or a separate table/cache)
    user.mfaSecretTemp = secret;
    await user.save();
    
    return { secret, qrCodeDataUrl };
  }

  /**
   * Verify the provided token against the temporary secret and enable MFA.
   * 
   * @param {Object} user - The user instance
   * @param {string} token - The 6-digit TOTP token
   * @returns {Promise<boolean>}
   */
  async verifyAndEnable(user, token) {
    if (!user.mfaSecretTemp) {
      throw new Error('No MFA enrollment in progress.');
    }

    const isValid = authenticator.check(token, user.mfaSecretTemp);
    if (!isValid) {
      return false;
    }

    user.mfaSecret = user.mfaSecretTemp;
    user.mfaEnabled = true;
    user.mfaSecretTemp = null;
    await user.save();
    
    return true;
  }

  /**
   * Verify a login token against the active secret.
   * 
   * @param {Object} user - The user instance
   * @param {string} token - The 6-digit TOTP token
   * @returns {boolean}
   */
  verifyLogin(user, token) {
    if (!user.mfaEnabled || !user.mfaSecret) {
      throw new Error('MFA is not enabled for this user.');
    }
    return authenticator.check(token, user.mfaSecret);
  }

  /**
   * Disable MFA for a user.
   * 
   * @param {Object} user - The user instance
   */
  async disable(user) {
    user.mfaEnabled = false;
    user.mfaSecret = null;
    user.mfaSecretTemp = null;
    await user.save();
  }
}

module.exports = new MfaService();
