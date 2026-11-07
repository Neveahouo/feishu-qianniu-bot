// ============================================
// 飞书机器人：长连接接收群消息、解析指令、回群消息
// 使用长连接模式，无需公网 IP / 内网穿透
// ============================================

const lark = require('@larksuiteoapi/node-sdk');
const config = require('./config');

class FeishuBot {
  constructor(onMessage) {
    this.client = new lark.Client({
      appId: config.feishu.appId,
      appSecret: config.feishu.appSecret,
    });
    this.wsClient = null;
    this.onMessage = onMessage;
  }

  start() {
    console.log('[飞书] 启动长连接监听...');

    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        try {
          await this.handleMessage(data);
        } catch (err) {
          console.error('[飞书] 消息处理异常:', err.message);
        }
      },
    });

    this.wsClient = new lark.WSClient({
      appId: config.feishu.appId,
      appSecret: config.feishu.appSecret,
    });

    // 注意：eventDispatcher 必须传给 start()，不能传给构造函数
    this.wsClient.start({ eventDispatcher });
    console.log('[飞书] 长连接已启动，等待群消息...');
  }

  async handleMessage(data) {
    const message = data.message;
    const sender = data.sender;

    if (!message) return;
    // 只处理群聊；忽略机器人自己发的消息
    if (message.chat_type !== 'group') return;
    if (sender && sender.sender_type === 'app') return;

    const chatId = message.chat_id;
    let text = '';

    try {
      const content = JSON.parse(message.content || '{}');
      if (message.message_type === 'text') {
        text = content.text || '';
      } else if (message.message_type === 'post') {
        text = this.extractPostText(content);
      }
    } catch (e) {
      console.warn('[飞书] 消息内容解析失败:', e.message);
      return;
    }

    if (!text.trim()) return;

    console.log(`[飞书] 收到群消息: "${text.substring(0, 120)}"`);

    const parsed = this.parseMessage(text);
    if (parsed) {
      parsed.chatId = chatId;
      parsed.messageId = message.message_id;
      console.log(
        `[飞书] 指令命中: type=${parsed.type}, productId=${parsed.productId}, quantity=${parsed.quantity}`
      );
      if (this.onMessage) await this.onMessage(parsed);
    }
  }

  extractPostText(content) {
    let text = '';
    if (content.title) text += content.title + ' ';
    const lines = content.content || [];
    for (const line of lines) {
      for (const elem of line || []) {
        if (elem.tag === 'text' || elem.tag === 'a') {
          text += (elem.text || '') + ' ';
          if (elem.href) text += elem.href + ' ';
        }
      }
    }
    return text;
  }

  /**
   * 解析群消息为指令
   * 支持：
   *   解限购 642838749428 3
   *   限购 642838749428 改5份
   *   https://detail.tmall.com/item.htm?id=642838749428 反馈3份拍不了
   *   已拍完 642838749428
   *   已拍完   （不带ID，自动取最近修改的商品）
   */
  parseMessage(text) {
    const isRestore = config.keywords.restore.some((kw) => text.includes(kw));
    const isUnlock = config.keywords.unlock.some((kw) => text.includes(kw));

    if (!isRestore && !isUnlock) return null;

    // 商品ID：优先取 URL 中的 id= 参数，其次取 10~13 位纯数字
    let productId = null;
    const urlMatch = text.match(/id=(\d+)/i);
    if (urlMatch) {
      productId = urlMatch[1];
    } else {
      const numMatch = text.match(/\b(\d{10,13})\b/);
      if (numMatch) productId = numMatch[1];
    }

    if (isRestore) {
      return { type: 'restore', productId: productId || null };
    }

    if (!productId) {
      console.log('[飞书] 未提取到商品ID');
      return null;
    }

    // 份数：优先匹配 "X份"
    let quantity = null;
    const qtyMatch = text.match(/(\d+)\s*份/);
    if (qtyMatch) {
      quantity = parseInt(qtyMatch[1], 10);
    } else {
      const afterId = text.substring(text.indexOf(productId) + productId.length);
      const numMatch = afterId.match(/\b(\d+)\b/);
      if (numMatch) quantity = parseInt(numMatch[1], 10);
    }

    if (!quantity || quantity <= 0) {
      console.log('[飞书] 未提取到有效份数');
      return null;
    }

    return { type: 'unlock', productId, quantity };
  }

  async sendMessage(chatId, text) {
    try {
      await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });
      console.log(`[飞书] 已回复群 ${chatId}: ${text}`);
    } catch (err) {
      console.error('[飞书] 发送消息失败:', err.message);
    }
  }
}

module.exports = FeishuBot;
