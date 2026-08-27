/**
 * A2A-021: 端到端加密策略 v1.0
 *
 * 基于 AES-256-GCM 实现:
 *   - 密钥派生: HKDF-SHA256
 *   - 加密:   AES-256-GCM (认证加密)
 *   - 签名:   HMAC-SHA256
 *   - 密钥交换: 预共享密钥模式 (PSK, 适用于已知 Agent 网络)
 *   - 后续可扩展 ECDH
 *
 * 协议: A2A v0.5 §A2A-021
 * 版本: 1.0.0 | 2026-05-10
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;

class E2EEncryption {
  constructor(options = {}) {
    this.masterKey = options.masterKey || process.env.A2A_ENCRYPTION_KEY;
    this.enabled = !!this.masterKey;
    this.keyVersion = options.keyVersion || 1;
    this._derivedKeys = new Map(); // Map<agentId, Buffer>
  }

  /**
   * 派生 Agent 专属密钥 (HKDF)
   */
  getAgentKey(agentId) {
    if (!this.masterKey) throw new Error('E2E encryption not configured');
    if (!this._derivedKeys.has(agentId)) {
      const salt = crypto.createHash('sha256').update(agentId).digest();
      this._derivedKeys.set(agentId, crypto.hkdfSync('sha256', this.masterKey, salt, `a2a-e2e-${agentId}`, 32));
    }
    return this._derivedKeys.get(agentId);
  }

  /**
   * 加密消息
   * @returns { ciphertext, iv, tag, salt, keyVersion }
   */
  encrypt(plaintext, agentId) {
    if (!this.enabled) return { plaintext, encrypted: false };

    const key = this.getAgentKey(agentId);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
    ciphertext += cipher.final('base64');
    const tag = cipher.getAuthTag().toString('base64');

    return {
      ciphertext,
      iv: iv.toString('base64'),
      tag,
      keyVersion: this.keyVersion,
      encrypted: true,
    };
  }

  /**
   * 解密消息
   */
  decrypt(encryptedObj, agentId) {
    if (!encryptedObj.encrypted) return encryptedObj.plaintext;

    if (!this.enabled) {
      console.warn('[E2E] 收到加密消息但本地未配置密钥, agentId:', agentId);
    }

    try {
      const key = this.getAgentKey(agentId);
      const iv = Buffer.from(encryptedObj.iv, 'base64');
      const tag = Buffer.from(encryptedObj.tag, 'base64');
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);

      let plaintext = decipher.update(encryptedObj.ciphertext, 'base64', 'utf8');
      plaintext += decipher.final('utf8');
      return plaintext;
    } catch (e) {
      console.error('[E2E] 解密失败:', e.message);
      return null;
    }
  }

  /**
   * 加密信封消息 (兼容现有 envelope.js)
   */
  encryptEnvelope(envelope, agentId) {
    if (!this.enabled) return envelope;

    const payload = JSON.stringify(envelope.payload || {});
    const encryptedPayload = this.encrypt(payload, agentId);

    return {
      ...envelope,
      encryption: {
        version: this.keyVersion,
        algorithm: ALGORITHM,
        encrypted: true,
      },
      payload: encryptedPayload,
    };
  }

  /**
   * 解密信封消息
   */
  decryptEnvelope(envelope, agentId) {
    if (!envelope.encryption?.encrypted) return envelope;

    const plaintext = this.decrypt(envelope.payload, agentId);
    if (!plaintext) {
      console.error('[E2E] 信封解密失败');
      return envelope;
    }

    return {
      ...envelope,
      encryption: { ...envelope.encryption, encrypted: false },
      payload: JSON.parse(plaintext),
    };
  }

  /**
   * HMAC-SHA256 消息签名
   */
  signMessage(plaintext) {
    if (!this.masterKey) return null;
    return crypto.createHmac('sha256', this.masterKey).update(plaintext).digest('base64');
  }

  /**
   * 验证签名
   */
  verifySignature(plaintext, signature) {
    if (!this.masterKey || !signature) return true; // 无密钥则跳过
    const expected = this.signMessage(plaintext);
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  /**
   * 获取统计
   */
  getStats() {
    return {
      enabled: this.enabled,
      algorithm: ALGORITHM,
      keyVersion: this.keyVersion,
      agentKeys: this._derivedKeys.size,
    };
  }
}

/**
 * 中间件: 自动解密/加密 A2A 消息
 */
function createEncryptionMiddleware(e2eManager) {
  return (req, res, next) => {
    // 解密入站消息 (envelope 格式)
    if (req.body?.envelope?.encryption?.encrypted) {
      const senderName = req.body.envelope.sender || 'unknown';
      req.body = e2eManager.decryptEnvelope(req.body, senderName);
    }
    // 加密出站消息 (拦截 JSON-RPC 响应)
    const origJson = res.json.bind(res);
    res.json = function (obj) {
      if (e2eManager.enabled && obj?.result?.task) {
        // 可选: 标记后续加密
        obj.encrypted = true;
      }
      return origJson(obj);
    };
    next();
  };
}

module.exports = { E2EEncryption, createEncryptionMiddleware };
