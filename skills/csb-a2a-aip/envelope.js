/**
 * A2A 信封模式模块
 * 实现 A2A-017 消息格式规范
 * 包含 A2A-007 消息优先级分级
 */

const crypto = require('crypto');

// 消息类型
const MESSAGE_TYPES = {
  HANDSHAKE: 'handshake',
  TASK: 'task',
  RESULT: 'result',
  ERROR: 'error',
  HEARTBEAT: 'heartbeat'
};

// 优先级定义 (A2A-007)
const PRIORITIES = {
  LOW: 'low',         // 异步处理，可批量合并
  NORMAL: 'normal',   // 默认优先级，FIFO
  HIGH: 'high',       // 优先处理，跳过队列
  URGENT: 'urgent'    // 立即处理 + 尝试唤醒通知
};

// 优先级数值（用于比较）
const PRIORITY_VALUES = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3
};

class EnvelopeManager {
  constructor(identity) {
    this.identity = identity;
    this.privateKey = null;
    this.publicKey = null;

    // 初始化密钥对
    if (process.env.A2A_PRIVATE_KEY) {
      try {
        this.privateKey = crypto.createPrivateKey({
          key: Buffer.from(process.env.A2A_PRIVATE_KEY, 'base64'),
          format: 'der',
          type: 'pkcs8'
        });
      } catch (e) {
        console.warn('[信封] 私钥加载失败，使用自动生成密钥:', e.message);
        this._generateKeyPair();
      }
    } else {
      this._generateKeyPair();
    }
  }

  /**
   * 自动生成 Ed25519 密钥对
   */
  _generateKeyPair() {
    try {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'der' },
        privateKeyEncoding: { type: 'pkcs8', format: 'der' }
      });
      this.privateKey = crypto.createPrivateKey({ key: privateKey, format: 'der', type: 'pkcs8' });
      this.publicKey = crypto.createPublicKey({ key: publicKey, format: 'der', type: 'spki' });
    } catch (e) {
      console.warn('[信封] 密钥对生成失败，签名功能不可用:', e.message);
    }
  }

  /**
   * 创建信封
   * @param {object} options - 信封选项
   * @returns {object} 信封对象
   */
  createEnvelope(options) {
    const {
      recipient,
      type = MESSAGE_TYPES.TASK,
      priority = PRIORITIES.NORMAL,
      payload = {},
      threadId = null,
      parentId = null,
      traceId = null
    } = options;

    const envelope = {
      id: this.generateMessageId(),
      sender: this.identity.name || 'Agent',
      recipient: recipient,
      timestamp: new Date().toISOString(),
      type: type,
      priority: priority,
      thread_id: threadId,
      parent_id: parentId,
      trace_id: traceId || this.generateTraceId()
    };

    // 如果有私钥，添加 payload_hash 和签名
    if (this.privateKey) {
      envelope.payload_hash = this.hashPayload(payload);
      envelope.signature = this.signMessage(envelope);
    }

    return {
      envelope: envelope,
      payload: payload
    };
  }

  /**
   * 解析信封
   * @param {object} message - 收到的消息
   * @returns {object} 解析结果
   */
  parseEnvelope(message) {
    // 检查是否是信封格式
    if (message.envelope) {
      // 新格式：信封模式
      return {
        valid: true,
        envelope: message.envelope,
        payload: message.payload,
        thread_id: message.envelope.thread_id,
        parent_id: message.envelope.parent_id,
        priority: message.envelope.priority || PRIORITIES.NORMAL,
        type: message.envelope.type || MESSAGE_TYPES.TASK,
        trace_id: message.envelope.trace_id,
        sender: message.envelope.sender,
        recipient: message.envelope.recipient
      };
    } else if (message.message) {
      // 旧格式：兼容处理
      return {
        valid: true,
        envelope: null,
        payload: message,
        thread_id: message.thread_id || null,
        parent_id: message.parent_id || null,
        priority: message.priority || PRIORITIES.NORMAL,
        type: MESSAGE_TYPES.TASK,
        trace_id: message.trace_id || null,
        sender: message.sender,
        recipient: null
      };
    }

    return {
      valid: false,
      error: '无法识别的消息格式'
    };
  }

  /**
   * 签名时提取待签字段子集
   */
  _pickSignFields(envelope) {
    return {
      id: envelope.id,
      sender: envelope.sender,
      timestamp: envelope.timestamp,
      payload_hash: envelope.payload_hash
    };
  }

  /**
   * 验证签名
   * @param {object} envelope - 信封对象（需含 signature、payload_hash）
   * @param {string|object} signerPublicKey - 公钥（base64 DER 或 KeyObject）
   * @returns {{valid: boolean, signed: boolean, error?: string}}
   */
  verifySignature(envelope, signerPublicKey) {
    if (!envelope.signature) {
      return { valid: true, signed: false };
    }

    try {
      let key = signerPublicKey;
      if (typeof signerPublicKey === 'string') {
        key = crypto.createPublicKey({
          key: Buffer.from(signerPublicKey, 'base64'),
          format: 'der',
          type: 'spki'
        });
      } else if (!signerPublicKey) {
        return { valid: false, signed: true, error: '缺少公钥' };
      }

      const signFields = this._pickSignFields(envelope);
      const dataToVerify = this._canonicalizeForSign(signFields);
      const signature = Buffer.from(envelope.signature, 'base64');

      const verified = crypto.verify(null, dataToVerify, key, signature);
      return { valid: verified, signed: true };
    } catch (e) {
      return { valid: false, signed: true, error: e.message };
    }
  }

  /**
   * 生成消息 ID
   */
  generateMessageId() {
    return `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * 生成追踪 ID
   */
  generateTraceId() {
    return `trace_${crypto.randomBytes(16).toString('hex')}`;
  }

  /**
   * 签名消息
   * 签名数据 = canonical({id, sender, timestamp, payload_hash})
   */
  signMessage(envelope) {
    if (!this.privateKey) return null;

    try {
      const signFields = this._pickSignFields(envelope);
      const dataToSign = this._canonicalizeForSign(signFields);
      const signature = crypto.sign(null, dataToSign, this.privateKey);
      return signature.toString('base64');
    } catch (e) {
      console.error('[信封] 签名失败:', e.message);
      return null;
    }
  }

  /**
   * 将待签数据规范化为 Buffer（排序 key 防 JSON 顺序歧义）
   */
  _canonicalizeForSign(obj) {
    const sorted = Object.keys(obj).sort().reduce((acc, k) => {
      acc[k] = obj[k];
      return acc;
    }, {});
    return Buffer.from(JSON.stringify(sorted), 'utf8');
  }

  /**
   * 计算载荷哈希（完整 SHA256）
   */
  hashPayload(payload) {
    const data = JSON.stringify(payload);
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * 创建心跳消息（A2A-017 §17.4）
   */
  createHeartbeat() {
    return {
      id: this.generateMessageId(),
      ts: Date.now()
    };
  }

  /**
   * 创建错误响应
   */
  createError(code, message, originalId) {
    return {
      envelope: {
        id: this.generateMessageId(),
        sender: this.identity.name || 'Agent',
        timestamp: new Date().toISOString(),
        type: MESSAGE_TYPES.ERROR,
        priority: PRIORITIES.HIGH
      },
      payload: {
        error: {
          code: code,
          message: message,
          original_id: originalId
        }
      }
    };
  }

  /**
   * 比较优先级
   */
  comparePriority(p1, p2) {
    return (PRIORITY_VALUES[p1] || 1) - (PRIORITY_VALUES[p2] || 1);
  }

  /**
   * 判断是否需要立即处理
   */
  isUrgent(envelope) {
    return envelope?.priority === PRIORITIES.URGENT;
  }

  /**
   * 判断是否可以延迟处理
   */
  canDefer(envelope) {
    return envelope?.priority === PRIORITIES.LOW;
  }
}

module.exports = {
  EnvelopeManager,
  MESSAGE_TYPES,
  PRIORITIES,
  PRIORITY_VALUES
};
