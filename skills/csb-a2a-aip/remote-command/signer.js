/**
 * A2A 远程命令执行 - 签名模块
 * Phase 1: HMAC-SHA256 共享密钥
 * Phase 2: 升级到公钥体系
 */

const crypto = require('crypto');

// 从环境变量获取共享密钥
const SHARED_SECRET = process.env.A2A_SHARED_SECRET;

class Signer {
  constructor(secret = SHARED_SECRET) {
    if (!secret) {
      console.warn('[A2A-CMD] Warning: A2A_SHARED_SECRET not set, using development mode');
      this.secret = 'dev-mode-insecure-key-do-not-use-in-production';
    } else {
      this.secret = secret;
    }
  }

  /**
   * 签名请求
   * @param {Object} request - 请求对象
   * @returns {string} HMAC 签名 (hex)
   */
  signRequest(request) {
    const payload = JSON.stringify({
      command: request.command,
      sender: request.sender,
      timestamp: request.timestamp,
      nonce: request.nonce
    });

    return crypto
      .createHmac('sha256', this.secret)
      .update(payload)
      .digest('hex');
  }

  /**
   * 验证请求签名
   * @param {Object} request - 请求对象
   * @param {string} signature - 签名
   * @returns {boolean} 验证结果
   */
  verifyRequest(request, signature) {
    const expected = this.signRequest(request);
    
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expected, 'hex')
      );
    } catch (e) {
      console.error('[A2A-CMD] Signature verification error:', e.message);
      return false;
    }
  }

  /**
   * 签名响应
   * @param {Object} response - 响应对象
   * @returns {string} HMAC 签名 (hex)
   */
  signResponse(response) {
    const payload = `${response.command_id}:${response.status}:${response.timestamp}`;
    
    return crypto
      .createHmac('sha256', this.secret)
      .update(payload)
      .digest('hex');
  }

  /**
   * 验证响应签名
   * @param {Object} response - 响应对象
   * @param {string} signature - 签名
   * @returns {boolean} 验证结果
   */
  verifyResponse(response, signature) {
    const expected = this.signResponse(response);
    
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expected, 'hex')
      );
    } catch (e) {
      console.error('[A2A-CMD] Response signature verification error:', e.message);
      return false;
    }
  }

  /**
   * 生成 nonce
   * @returns {string} 随机 nonce
   */
  generateNonce() {
    return crypto.randomBytes(16).toString('hex');
  }
}

module.exports = { Signer };
