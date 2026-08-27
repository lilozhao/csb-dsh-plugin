/**
 * 任务验证器 - Phase 3
 * 用于验证委托任务的结果是否符合预期
 */

class TaskVerifier {
  constructor() {
    // 验证规则注册表
    this.verifiers = new Map();
    
    // 注册默认验证器
    this.registerVerifier('forum.post', this.verifyForumPost.bind(this));
    this.registerVerifier('forum.read', this.verifyForumRead.bind(this));
    this.registerVerifier('data.bitable', this.verifyDataEntry.bind(this));
  }

  /**
   * 注册验证器
   */
  registerVerifier(capability, verifierFn) {
    this.verifiers.set(capability, verifierFn);
  }

  /**
   * 验证任务结果
   * @param {string} capability - 能力类型
   * @param {object} expectedResult - 预期结果（发起时的参数）
   * @param {object} actualResult - 实际返回结果
   * @returns {object} 验证结果
   */
  async verify(capability, expectedResult, actualResult) {
    const verifier = this.verifiers.get(capability);
    
    if (!verifier) {
      // 没有注册验证器，返回默认验证结果
      return {
        verified: true,
        confidence: 'low',
        message: '该能力暂无验证器，默认通过',
        details: null
      };
    }
    
    try {
      return await verifier(expectedResult, actualResult);
    } catch (err) {
      return {
        verified: false,
        confidence: 'high',
        message: `验证失败: ${err.message}`,
        details: { error: err.message }
      };
    }
  }

  /**
   * 论坛发帖验证器
   */
  async verifyForumPost(expectedResult, actualResult) {
    const { title, content } = expectedResult;
    const { postId, url } = actualResult;
    
    if (!postId) {
      return {
        verified: false,
        confidence: 'high',
        message: '发帖失败：未返回帖子ID',
        details: actualResult
      };
    }
    
    // 验证帖子是否真的存在
    const httpsReq = require('https');
    
    return new Promise((resolve) => {
      const req = httpsReq.get(`https://csbc.lilozkzy.top/api/posts`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const posts = JSON.parse(data);
            const post = posts.threads?.find(p => p.id === postId);
            
            if (!post) {
              resolve({
                verified: false,
                confidence: 'high',
                message: `帖子不存在: ${postId}`,
                details: { postId, url }
              });
              return;
            }
            
            // 验证标题是否匹配
            const titleMatch = post.title === title || post.title.includes(title.substring(0, 20));
            
            // 验证内容是否匹配（检查前50个字符）
            const contentMatch = post.content && post.content.includes(content.substring(0, 50));
            
            if (titleMatch && contentMatch) {
              resolve({
                verified: true,
                confidence: 'high',
                message: `发帖成功，内容已验证`,
                details: {
                  postId,
                  url,
                  title: post.title,
                  author: post.author
                }
              });
            } else {
              resolve({
                verified: false,
                confidence: 'medium',
                message: `帖子已创建但内容不匹配`,
                details: {
                  postId,
                  url,
                  expected: { title, contentPreview: content.substring(0, 50) },
                  actual: { title: post.title, contentPreview: post.content?.substring(0, 50) }
                }
              });
            }
          } catch (err) {
            resolve({
              verified: false,
              confidence: 'low',
              message: `验证失败: ${err.message}`,
              details: { error: err.message }
            });
          }
        });
      });
      
      req.on('error', (err) => {
        resolve({
          verified: false,
          confidence: 'low',
          message: `网络错误: ${err.message}`,
          details: { error: err.message }
        });
      });
      
      req.setTimeout(5000, () => {
        req.destroy();
        resolve({
          verified: false,
          confidence: 'low',
          message: '验证超时',
          details: null
        });
      });
    });
  }

  /**
   * 论坛查询验证器
   */
  async verifyForumRead(expectedResult, actualResult) {
    // 简单验证：检查是否返回了帖子列表
    if (actualResult.posts && Array.isArray(actualResult.posts)) {
      return {
        verified: true,
        confidence: 'high',
        message: `查询成功，返回 ${actualResult.posts.length} 条帖子`,
        details: actualResult
      };
    }
    
    return {
      verified: false,
      confidence: 'medium',
      message: '查询结果格式异常',
      details: actualResult
    };
  }

  /**
   * 数据录入验证器
   */
  async verifyDataEntry(expectedResult, actualResult) {
    // 简单验证：检查是否返回了记录ID
    if (actualResult.recordId) {
      return {
        verified: true,
        confidence: 'high',
        message: `数据录入成功，记录ID: ${actualResult.recordId}`,
        details: actualResult
      };
    }
    
    return {
      verified: false,
      confidence: 'medium',
      message: '数据录入结果不确定',
      details: actualResult
    };
  }

  /**
   * 获取所有已注册的验证器
   */
  getSupportedVerifiers() {
    return Array.from(this.verifiers.keys());
  }
}

module.exports = { TaskVerifier };
