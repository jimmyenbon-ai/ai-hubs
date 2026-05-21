// 简单的内存缓存实现（生产环境建议使用Redis）
// 用于缓存积分查询结果和历史记录

class MemoryCache {
  constructor(defaultTTL = 60000) {
    // defaultTTL: 默认过期时间（毫秒），默认60秒
    this.cache = new Map();
    this.defaultTTL = defaultTTL;
  }

  // 设置缓存
  set(key, value, ttl = null) {
    const expiry = Date.now() + (ttl || this.defaultTTL);
    this.cache.set(key, {
      value,
      expiry,
    });
  }

  // 获取缓存
  get(key) {
    const item = this.cache.get(key);
    if (!item) {
      return null;
    }

    // 检查是否过期
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }

    return item.value;
  }

  // 删除缓存
  delete(key) {
    return this.cache.delete(key);
  }

  // 清空所有缓存
  clear() {
    this.cache.clear();
  }

  // 获取所有缓存键
  keys() {
    return Array.from(this.cache.keys());
  }

  // 清理过期缓存
  cleanup() {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiry) {
        this.cache.delete(key);
      }
    }
  }
}

// 创建全局缓存实例
const cache = new MemoryCache(60000); // 默认60秒过期

// 每5分钟清理一次过期缓存
setInterval(() => {
  cache.cleanup();
}, 5 * 60 * 1000);

module.exports = cache;
