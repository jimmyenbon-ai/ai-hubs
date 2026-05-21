// 积分服务：基于 GRSAI API 余额查询实现消费扣减
// 原理：生成前查余额 → 生成后再次查询 → 对比差额得出实际消耗
const axios = require('axios');
const cache = require('./cache');
const logger = require('./logger');
const { appConfig } = require('./appConfig');

const GRSAI_TIMEOUT_MS = Number(process.env.GRSAI_TIMEOUT_MS || 600000);

function getApiHost() { return appConfig.grsai_api_host || 'https://grsai.dakka.com.cn' }
function getApiKey() { return appConfig.grsai_api_key || '' }

const CACHE_KEY_BALANCE = 'grsai_balance';
const CACHE_TTL_BALANCE = 10000; // 10秒，避免短时间内重复查询

// 本地消费记录（内存），用于模拟扣减和展示
// 格式: { balance, lastUpdated, history: [{ time, amount, desc }] }
let localRecord = {
  balance: null,
  lastUpdated: null,
  history: [],
};

/**
 * 使用官方 getAPIKeyCredits 接口获取积分余额
 * 官方接口：POST /client/openapi/getAPIKeyCredits
 * 请求格式：{ "apiKey": "sk-xxxxxx" }
 * 响应格式：{ "code": 0, "data": { "credits": 10000 }, "msg": "success" }
 */
async function fetchBalanceFromGrsai() {
  if (!getApiKey()) {
    logger.warn('GRSAI API_KEY 未配置');
    return null;
  }
  
  const cached = cache.get(CACHE_KEY_BALANCE);
  if (cached !== null) {
    logger.info('使用缓存的积分余额', { balance: cached });
    return cached;
  }

  // 官方接口：POST /client/openapi/getAPIKeyCredits
  // 同时需要 Authorization header 和请求体中的 apiKey
  try {
    const resp = await axios.post(
      `${getApiHost()}/client/openapi/getAPIKeyCredits`,
      { apiKey: getApiKey() },
      {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getApiKey()}`,
        },
      }
    );

    logger.info('GRSAI 积分查询响应状态', { status: resp.status, data: resp.data });

    if (resp.status !== 200) {
      logger.warn('GRSAI 积分查询接口返回非200状态', { status: resp.status });
      return null;
    }

    const d = resp.data;

    // 官方响应格式：{ code: 0, data: { credits: 10000 }, msg: "success" }
    if (d && typeof d === 'object') {
      if (d.code !== 0) {
        logger.warn('GRSAI 积分查询返回错误码', { code: d.code, msg: d.msg });
        return null;
      }

      const data = d.data;
      // 官方返回 data.credits
      let balance = 0;
      if (typeof data === 'number') {
        balance = data;
      } else if (typeof data === 'object') {
        balance = data?.credits ?? data?.balance ?? data?.points ?? data?.remaining ?? 0;
      }

      if (typeof balance !== 'number' || isNaN(balance)) {
        balance = 0;
      }

      cache.set(CACHE_KEY_BALANCE, balance, CACHE_TTL_BALANCE);
      logger.info('GRSAI 积分余额查询成功（官方API）', { balance, rawData: data });
      return balance;
    }

    return null;
  } catch (err) {
    // 输出详细错误信息帮助调试
    const errorDetail = {
      message: err.message,
      code: err.code,
      status: err.response?.status,
      responseData: err.response?.data,
      url: `${getApiHost()}/client/openapi/getAPIKeyCredits`,
    };
    logger.error('GRSAI 积分查询失败', errorDetail);
    console.error('[pointsService] 积分查询详细错误:', JSON.stringify(errorDetail, null, 2));
    return null;
  }
}

/**
 * 查询当前积分余额
 * @returns {number|null} 余额数值，或 null（未配置/查询失败）
 */
async function fetchBalance() {
  const balance = await fetchBalanceFromGrsai();
  if (balance !== null) {
    localRecord.balance = balance;
    localRecord.lastUpdated = Date.now();
  }
  return balance;
}

/**
 * 扣减积分（生成前先查余额，生成后记录消耗）
 * 第一阶段（生成前）：查询余额并缓存
 * 第二阶段（生成后）：调用 confirmDeduct() 确认消耗
 *
 * @param {number} amount - 预估消耗积分（用于余额预检）
 * @param {string} desc - 消耗描述
 * @returns {{ success: boolean, balance: number, message: string, simulated: boolean }}
 */
async function deductPoints(amount, desc = '') {
  if (typeof amount !== 'number' || amount <= 0) {
    return { success: false, balance: 0, message: '扣减数量必须为正数' };
  }

  // 跳过积分检查，直接允许生成
  logger.info('跳过积分检查，直接允许生成', { estimatedAmount: amount, desc });

  return {
    success: true,
    balance: null,
    message: '已跳过积分检查',
    simulated: false,
  };
}

/**
 * 积分预检查（用于前端显示积分不足提示）
 * @param {number} amount - 预估消耗
 * @returns {{ success: boolean, balance: number|null, message: string }}
 */
async function checkPoints(amount) {
  if (!getApiKey()) {
    return { success: true, balance: null, message: '未配置 GRSAI_API_KEY' };
  }

  const balance = await fetchBalanceFromGrsai();
  if (balance === null) {
    return { success: true, balance: null, message: '无法获取积分余额' };
  }

  if (balance < amount) {
    return { success: false, balance, message: `积分不足，当前剩余 ${balance}，需要 ${amount}` };
  }

  return { success: true, balance, message: '积分充足' };
}

/**
 * 确认实际消耗（生成完成后调用，对比前后余额差得出真实消耗）
 * @param {number} beforeBalance - 生成前的余额（由 deductPoints 返回的 balance）
 * @param {number} amount - 预估消耗（用于余额不足兜底计算）
 * @param {string} desc - 消耗描述
 * @returns {{ actualCost: number, newBalance: number }}
 */
async function confirmDeduct(beforeBalance, amount, desc = '') {
  if (!getApiKey()) return { actualCost: 0, newBalance: beforeBalance };

  // 查询最新余额
  cache.delete(CACHE_KEY_BALANCE);
  const newBalance = await fetchBalanceFromGrsai();

  // 计算实际消耗（GRSAI 按量计费，用余额差值更准确）
  let actualCost = 0;
  if (newBalance !== null && beforeBalance !== null) {
    actualCost = Math.max(0, beforeBalance - newBalance);
  } else {
    // 兜底：用预估消耗
    actualCost = amount;
  }

  // 更新本地记录
  localRecord.balance = newBalance;
  localRecord.lastUpdated = Date.now();
  localRecord.history.push({
    time: Date.now(),
    amount: actualCost,
    desc,
  });

  // 只保留最近 100 条记录
  if (localRecord.history.length > 100) {
    localRecord.history = localRecord.history.slice(-100);
  }

  // 清除缓存，下次查询会拉取最新余额
  cache.delete(CACHE_KEY_BALANCE);

  logger.info('积分消耗已确认', {
    beforeBalance,
    newBalance,
    actualCost,
    desc,
  });

  return { actualCost, newBalance: newBalance ?? beforeBalance };
}

/**
 * 获取本地消费历史（最近 20 条）
 */
function getConsumptionHistory() {
  return localRecord.history.slice(-20).reverse();
}

/**
 * 获取当前余额（优先返回缓存）
 */
function getCachedBalance() {
  return localRecord.balance;
}

module.exports = {
  fetchBalance,
  deductPoints,
  checkPoints,
  confirmDeduct,
  getConsumptionHistory,
  getCachedBalance,
};
