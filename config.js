// ============================================
// 配置：全部从环境变量读取，密钥不写进代码
// 使用前先复制 .env.example 为 .env 并填写
// ============================================

require('dotenv').config();

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  feishu: {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
  },

  qianniu: {
    username: process.env.QIANNIU_USERNAME || '',
    password: process.env.QIANNIU_PASSWORD || '',
    purchaseLimitUrl:
      process.env.PURCHASE_LIMIT_URL ||
      'https://myseller.taobao.com/home.htm/trade-operation/purchaseLimitManagement',
  },

  business: {
    defaultLimit: int(process.env.DEFAULT_LIMIT, 20),
    timeout: int(process.env.OP_TIMEOUT, 30000),
    headless: bool(process.env.HEADLESS, false),
    cookiesPath: process.env.COOKIES_PATH || './qianniu_cookies.json',
    userDataDir: process.env.USER_DATA_DIR || './chrome-user-data',
  },

  keywords: {
    unlock: ['限购', '解限购'],
    restore: ['已拍完', '恢复限购'],
  },
};
