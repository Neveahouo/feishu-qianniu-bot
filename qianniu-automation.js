// ============================================
// 千牛（淘宝/天猫卖家后台）自动化
//
// 关键实现要点（这些都是踩坑后总结的）：
// 1. 登录表单在 name="alibaba-login-box" 的 iframe 里，
//    输入框是 #fm-login-id / #fm-login-password。
// 2. 淘宝有自动化检测，必须用系统 Chrome + 持久化用户目录 +
//    --disable-blink-features=AutomationControlled + 反检测脚本，
//    否则滑块验证会一直失败。密码登录遇滑块时改为扫码登录。
// 3. 限购管理页面的内容渲染在同源 iframe
//    （url 含 purchaseLimitManagement）里，主页面只有外壳。
// 4. 商品ID搜索框的 placeholder 是"多个用逗号分隔"，不是"商品ID"。
// 5. 份数输入框是普通 input[type=text]，没有 id / placeholder，
//    value 为纯数字（如 "20"）。不能用 input[type=number] 找。
// 6. 活动中的商品点"确定"后会弹"温馨提醒，限购无法生效"，
//    提示限购时段与已存在时段重叠，这是判定失败的唯一可靠信号。
// ============================================

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const STEALTH_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
  window.chrome = window.chrome || { runtime: {} };
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : originalQuery(parameters)
  );
`;

class QianniuAutomation {
  constructor() {
    this.context = null;
    this.page = null;
    this.cookiesPath = path.resolve(__dirname, config.business.cookiesPath);
    this.userDataDir = path.resolve(__dirname, config.business.userDataDir);
  }

  async init() {
    console.log('[千牛] 启动浏览器（系统 Chrome，持久化会话）...');

    if (!fs.existsSync(this.userDataDir)) {
      fs.mkdirSync(this.userDataDir, { recursive: true });
    }

    this.context = await chromium.launchPersistentContext(this.userDataDir, {
      channel: 'chrome',
      headless: config.business.headless,
      viewport: null,
      args: [
        '--start-maximized',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    await this.context.addInitScript({ content: STEALTH_SCRIPT });

    this.page = this.context.pages()[0] || (await this.context.newPage());

    // 兼容旧版本保存的 cookies 文件
    if (fs.existsSync(this.cookiesPath)) {
      try {
        const cookies = JSON.parse(fs.readFileSync(this.cookiesPath, 'utf-8'));
        if (Array.isArray(cookies) && cookies.length) {
          await this.context.addCookies(cookies);
          console.log('[千牛] 已加载 cookies');
        }
      } catch (e) {
        console.warn('[千牛] cookies 加载失败:', e.message);
      }
    }

    console.log('[千牛] 浏览器启动完成');
  }

  async saveCookies() {
    try {
      const cookies = await this.context.cookies();
      fs.writeFileSync(this.cookiesPath, JSON.stringify(cookies, null, 2));
    } catch (e) {
      console.warn('[千牛] cookies 保存失败:', e.message);
    }
  }

  // 登录 iframe（havanalogin.taobao.com）
  getLoginFrame() {
    return this.page
      .frames()
      .find(
        (f) =>
          f.name() === 'alibaba-login-box' ||
          f.url().includes('mini_login') ||
          f.url().includes('havanalogin')
      );
  }

  // 限购管理内容 iframe
  getLimitFrame() {
    return this.page
      .frames()
      .find((f) => f.url().includes('purchaseLimitManagement') || f.url().includes('trade-operation'));
  }

  async isLoggedIn() {
    try {
      await this.page.goto(config.qianniu.purchaseLimitUrl, {
        waitUntil: 'domcontentloaded',
        timeout: config.business.timeout,
      });
      await this.page.waitForTimeout(3000);

      if (this.page.url().includes('login')) {
        console.log('[千牛] 当前在登录页');
        return false;
      }

      const loginFrame = this.getLoginFrame();
      if (loginFrame) {
        const hasLoginInput = await loginFrame.$('#fm-login-id');
        if (hasLoginInput) {
          console.log('[千牛] 检测到登录表单');
          return false;
        }
      }

      return true;
    } catch (e) {
      console.warn('[千牛] 登录状态检查异常:', e.message);
      return false;
    }
  }

  async login() {
    console.log('[千牛] 需要登录，等待登录 iframe...');

    let frame = null;
    for (let i = 0; i < 20; i++) {
      frame = this.getLoginFrame();
      if (frame) break;
      await this.page.waitForTimeout(1000);
    }

    if (!frame) {
      // 兜底刷新一次
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(5000);
      for (let i = 0; i < 20; i++) {
        frame = this.getLoginFrame();
        if (frame) break;
        await this.page.waitForTimeout(1000);
      }
    }

    if (!frame) {
      throw new Error('未找到登录 iframe，请检查网络或手动刷新页面');
    }

    // 尝试自动填账号密码（若配置了）；失败则引导扫码
    if (config.qianniu.username && config.qianniu.password) {
      try {
        await frame.waitForSelector('#fm-login-id', { timeout: 10000 });
        await frame.fill('#fm-login-id', config.qianniu.username);
        await frame.fill('#fm-login-password', config.qianniu.password);
        await this.page.waitForTimeout(800);

        const btn = await frame.$('button:has-text("登录")');
        if (btn) await btn.click();
        else await frame.press('#fm-login-password', 'Enter');

        await this.page.waitForTimeout(5000);

        const slider = await frame.$('#nc_1_n1z, .nc-lang-cnt, .nc_scale');
        if (slider) {
          console.log('');
          console.log('====================================================');
          console.log('  出现滑块验证（自动化账号常见）。');
          console.log('  请点击「扫码登录更便捷」，用手机淘宝/千牛扫码登录。');
          console.log('  登录成功后程序会自动继续，最多等待 5 分钟。');
          console.log('====================================================');
          console.log('');
        }
      } catch (e) {
        console.log('[千牛] 自动填充失败，请手动扫码登录');
      }
    } else {
      console.log('');
      console.log('====================================================');
      console.log('  请在打开的浏览器中扫码登录千牛（最多等待 5 分钟）');
      console.log('====================================================');
      console.log('');
    }

    // 等待离开登录页
    for (let i = 0; i < 300; i++) {
      await this.page.waitForTimeout(1000);
      if (!this.page.url().includes('login')) {
        await this.page.waitForTimeout(3000);
        await this.saveCookies();
        console.log('[千牛] 登录成功');
        return true;
      }
    }

    throw new Error('登录超时（5 分钟），请重新启动程序');
  }

  async ensureReady() {
    if (!this.context) await this.init();

    const loggedIn = await this.isLoggedIn();
    if (!loggedIn) await this.login();

    console.log('[千牛] 导航到限购管理页，等待内容加载...');
    await this.page.goto(config.qianniu.purchaseLimitUrl, {
      waitUntil: 'domcontentloaded',
    });

    // 等到限购 iframe 内出现搜索框
    for (let i = 0; i < 30; i++) {
      await this.page.waitForTimeout(1000);
      const frame = this.getLimitFrame();
      if (frame) {
        try {
          const search = await frame.$('input[placeholder*="多个用逗号分隔"]');
          if (search) {
            console.log('[千牛] 限购管理页已就绪');
            return;
          }
        } catch (e) {}
      }
    }

    console.warn('[千牛] 未检测到限购内容 iframe，继续尝试操作（可能失败）');
  }

  async findElement(selector) {
    const frame = this.getLimitFrame();
    if (frame) {
      const el = await frame.$(selector);
      if (el) return { el, frame };
    }
    const el = await this.page.$(selector);
    if (el) return { el, frame: null };
    return null;
  }

  async findElements(selector) {
    const results = [];
    const frame = this.getLimitFrame();
    if (frame) {
      for (const el of await frame.$$(selector)) results.push({ el, frame });
    }
    for (const el of await this.page.$$(selector)) results.push({ el, frame: null });
    return results;
  }

  async searchProduct(productId) {
    console.log(`[千牛] 搜索商品: ${productId}`);
    const frame = this.getLimitFrame();
    if (!frame) throw new Error('未找到限购管理 iframe');

    const searchInput = await frame.waitForSelector(
      'input[placeholder*="多个用逗号分隔"]',
      { timeout: config.business.timeout }
    );
    await searchInput.click();
    await searchInput.fill('');
    await searchInput.fill(String(productId));
    await this.page.waitForTimeout(500);

    const searchBtn = await frame.$('button:has-text("搜索")');
    if (searchBtn) await searchBtn.click();
    else await searchInput.press('Enter');

    await this.page.waitForTimeout(3000);
    console.log('[千牛] 搜索完成');
  }

  async openLimitSetting() {
    console.log('[千牛] 打开「商品限购设置」...');
    const frame = this.getLimitFrame();
    if (!frame) throw new Error('未找到限购管理 iframe');

    await frame.waitForSelector('text=商品限购设置', {
      timeout: config.business.timeout,
    });

    const link = await frame.$('text=商品限购设置');
    if (!link) throw new Error('未找到「商品限购设置」，商品可能不存在');

    await link.click();
    await this.page.waitForTimeout(3500);
    console.log('[千牛] 限购设置面板已打开');
  }

  /**
   * 找第一个限购时间段的份数输入框
   * 特征：可见的 text 输入框，value 为纯数字，无 id、无 placeholder
   */
  async findFirstQuantityInput() {
    const frames = [];
    const limitFrame = this.getLimitFrame();
    if (limitFrame) frames.push(limitFrame);
    frames.push(this.page);

    // 第一轮：有值的数字输入框
    for (const frame of frames) {
      for (const input of await frame.$$('input')) {
        try {
          const info = await input.evaluate((el) => ({
            type: el.type,
            value: el.value,
            id: el.id,
            placeholder: el.placeholder,
            visible: el.offsetWidth > 0,
          }));

          if (
            info.visible &&
            info.type === 'text' &&
            /^\d+$/.test(info.value) &&
            info.id !== 'ids' &&
            !info.placeholder.includes('日期') &&
            !info.placeholder.includes('逗号') &&
            !info.placeholder.includes('请输入')
          ) {
            console.log(`[千牛] 找到份数输入框，当前值=${info.value}`);
            return input;
          }
        } catch (e) {}
      }
    }

    // 第二轮：值为空的无标识输入框
    for (const frame of frames) {
      for (const input of await frame.$$('input')) {
        try {
          const info = await input.evaluate((el) => ({
            type: el.type,
            value: el.value,
            id: el.id,
            placeholder: el.placeholder,
            visible: el.offsetWidth > 0,
          }));
          if (
            info.visible &&
            info.type === 'text' &&
            !info.id &&
            !info.placeholder &&
            info.value === ''
          ) {
            console.log('[千牛] 找到候选空份数输入框');
            return input;
          }
        } catch (e) {}
      }
    }

    return null;
  }

  async setFirstQuantity(quantity) {
    console.log(`[千牛] 修改第一个时段份数为 ${quantity}...`);

    let input = null;
    for (let attempt = 0; attempt < 5 && !input; attempt++) {
      await this.page.waitForTimeout(1500);
      input = await this.findFirstQuantityInput();
      if (!input) console.log(`[千牛] 第 ${attempt + 1} 次未找到输入框，重试...`);
    }

    if (!input) throw new Error('未找到份数输入框');

    await input.click();
    await input.fill('');
    await this.page.waitForTimeout(300);
    await input.fill(String(quantity));
    await this.page.waitForTimeout(500);
    console.log(`[千牛] 已填入 ${quantity}`);
  }

  /**
   * 点确定并判断结果
   * 成功：面板关闭且无错误弹窗
   * 失败：出现「温馨提醒 / 限购无法生效」弹窗（活动商品）
   */
  async confirmAndCheck() {
    console.log('[千牛] 点击确定...');

    const selectors = [
      '.ant-drawer-footer button:has-text("确定")',
      '.ant-drawer-body button:has-text("确定")',
      '.ant-modal-footer button:has-text("确定")',
      'button:has-text("确定")',
    ];

    let confirmBtn = null;
    for (const sel of selectors) {
      const found = await this.findElements(sel);
      if (found.length) {
        confirmBtn = found[found.length - 1].el;
        break;
      }
    }

    if (!confirmBtn) throw new Error('未找到确定按钮');

    await confirmBtn.click();
    await this.page.waitForTimeout(2500);

    const failureTexts = ['温馨提醒', '限购无法生效', '时段不能与已存在时段重叠'];

    for (const text of failureTexts) {
      const found = await this.findElement(`text=${text}`);
      if (found) {
        console.log('[千牛] 检测到失败弹窗：活动中无法修改限购');

        const ok = await this.findElement('.ant-modal button:has-text("确定")');
        if (ok) {
          await ok.el.click();
          await this.page.waitForTimeout(1000);
        }

        const close = await this.findElement('.ant-drawer-close, .ant-modal-close');
        if (close) {
          await close.el.click();
          await this.page.waitForTimeout(1000);
        }

        return { success: false, reason: '活动中无法修改限购' };
      }
    }

    await this.page.waitForTimeout(2000);
    console.log('[千牛] 修改成功');
    return { success: true };
  }

  async modifyPurchaseLimit(productId, quantity) {
    await this.ensureReady();
    await this.searchProduct(productId);
    await this.openLimitSetting();
    await this.setFirstQuantity(quantity);
    return this.confirmAndCheck();
  }

  async close() {
    if (this.context) {
      await this.saveCookies();
      await this.context.close();
      this.context = null;
      this.page = null;
      console.log('[千牛] 浏览器已关闭');
    }
  }
}

module.exports = QianniuAutomation;
