const https = require('https');
const http = require('http');

class LLMService {
  constructor() {
    this.providers = {
      deepseek: {
        name: 'DeepSeek',
        defaultModel: 'deepseek-chat',
        chatEndpoint: '/chat/completions',
      },
      openai: {
        name: 'OpenAI',
        defaultModel: 'gpt-4o',
        chatEndpoint: '/v1/chat/completions',
      },
      ollama: {
        name: 'Ollama',
        defaultModel: 'llama3',
        chatEndpoint: '/api/chat',
      },
    };
  }

  async request(url, options, body) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const lib = isHttps ? https : http;

      const reqOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'POST',
        headers: options.headers || {},
      };

      const req = lib.request(reqOptions, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      });

      req.setTimeout(120000, () => {
        req.destroy();
        reject(new Error('LLM API 请求超时（120秒），请检查 API 地址和模型名是否正确'));
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async chat(config, messages, context = {}) {
    const provider = this.providers[config.provider];
    if (!provider) {
      throw new Error(`Unknown provider: ${config.provider}`);
    }

    const model = config.model || provider.defaultModel;
    const endpoint = provider.chatEndpoint;

    let requestBody = {
      model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      temperature: config.temperature || 0.7,
    };

    // Ollama 特殊处理
    if (config.provider === 'ollama') {
      requestBody.stream = false;
    }

    const headers = {
      'Content-Type': 'application/json',
    };

    // API Key 认证
    if (config.api_key) {
      if (config.provider === 'ollama') {
        // Ollama 不需要 Authorization
      } else {
        headers['Authorization'] = `Bearer ${config.api_key}`;
      }
    }

    const fullUrl = config.api_url.replace(/\/$/, '') + endpoint;

    try {
      const result = await this.request(fullUrl, { method: 'POST', headers }, requestBody);

      if (result.error) {
        throw new Error(result.error.message || result.error);
      }

      return {
        content: result.choices?.[0]?.message?.content || result.message?.content || '',
        usage: result.usage,
        model: result.model,
      };
    } catch (err) {
      console.error('[LLM] Request failed:', err);
      throw err;
    }
  }

  // 快捷方法：发送系统提示词 + 用户输入
  async complete(config, systemPrompt, userInput, context = {}) {
    return this.chat(config, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userInput },
    ], context);
  }

  // 多模态方法：支持图片输入（Vision）
  async completeWithImages(config, systemPrompt, imageUrls, textPrompt, context = {}) {
    const provider = this.providers[config.provider];
    if (!provider) {
      throw new Error(`Unknown provider: ${config.provider}`);
    }

    const model = config.model || provider.defaultModel;
    const endpoint = provider.chatEndpoint;

    // 构建多模态内容
    const content = [];

    // 添加图片
    for (const url of imageUrls) {
      content.push({
        type: 'image_url',
        image_url: { url },
      });
    }

    // 添加文本
    if (textPrompt) {
      content.push({ type: 'text', text: textPrompt });
    }

    const requestBody = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
      temperature: config.temperature || 0.7,
    };

    const headers = {
      'Content-Type': 'application/json',
    };

    if (config.api_key) {
      if (config.provider !== 'ollama') {
        headers['Authorization'] = `Bearer ${config.api_key}`;
      }
    }

    const fullUrl = config.api_url.replace(/\/$/, '') + endpoint;

    try {
      const result = await this.request(fullUrl, { method: 'POST', headers }, requestBody);

      if (result.error) {
        throw new Error(result.error.message || result.error);
      }

      return {
        content: result.choices?.[0]?.message?.content || '',
        usage: result.usage,
        model: result.model,
      };
    } catch (err) {
      console.error('[LLM Vision] Request failed:', err);
      throw err;
    }
  }

  // 获取默认配置
  getDefaultConfig() {
    return {
      provider: 'deepseek',
      api_url: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    };
  }

  // 列出支持的提供商
  listProviders() {
    return Object.entries(this.providers).map(([key, value]) => ({
      id: key,
      name: value.name,
      defaultModel: value.defaultModel,
    }));
  }
}

module.exports = new LLMService();
