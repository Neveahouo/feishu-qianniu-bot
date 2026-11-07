// ============================================
// 主程序：飞书长连接 + 千牛自动化 + 串行队列
// ============================================

const FeishuBot = require('./feishu-bot');
const QianniuAutomation = require('./qianniu-automation');
const TaskQueue = require('./task-queue');
const config = require('./config');

const qianniu = new QianniuAutomation();
const queue = new TaskQueue();

let feishu = null;

async function handleUnlock(task) {
  const { productId, quantity, chatId } = task;
  console.log(`[主程序] 解限购: 商品=${productId} 份数=${quantity}`);

  const result = await qianniu.modifyPurchaseLimit(productId, quantity);

  if (result.success) {
    queue.recordModified(productId, quantity, chatId);
    await feishu.sendMessage(chatId, `✅ 商品 ${productId} 限购已改为 ${quantity} 份`);
  } else {
    await feishu.sendMessage(chatId, `❌ 活动中暂无法解除，这边找下其他可用链接`);
  }
}

async function handleRestore(task) {
  let { productId, chatId } = task;
  console.log(`[主程序] 恢复限购: 商品=${productId}`);

  if (!productId) {
    const latest = queue.getLatestModified();
    if (!latest) {
      await feishu.sendMessage(chatId, '⚠️ 没有找到待恢复的商品，请在"已拍完"后带上商品ID');
      return;
    }
    productId = latest.productId;
    console.log(`[主程序] 未指定商品ID，使用最近修改的: ${productId}`);
  }

  const result = await qianniu.modifyPurchaseLimit(productId, config.business.defaultLimit);

  if (result.success) {
    queue.consumeModified(productId);
    await feishu.sendMessage(
      chatId,
      `✅ 商品 ${productId} 限购已恢复为 ${config.business.defaultLimit} 份`
    );
  } else {
    await feishu.sendMessage(chatId, `❌ 商品 ${productId} 恢复失败（活动中），请手动处理`);
  }
}

async function onMessage(parsed) {
  const { type, productId, quantity, chatId } = parsed;

  if (type === 'unlock') {
    await feishu.sendMessage(
      chatId,
      `🔔 收到解限购请求：商品 ${productId}，目标 ${quantity} 份，处理中...`
    );
    queue.add({
      type: 'unlock',
      productId,
      quantity,
      chatId,
      handler: handleUnlock,
      onError: (err) => feishu.sendMessage(chatId, `⚠️ 解限购异常：${err.message}`),
    });
  } else if (type === 'restore') {
    await feishu.sendMessage(
      chatId,
      `🔔 收到恢复请求：商品 ${productId || '最近修改的商品'}，改回 ${config.business.defaultLimit} 份...`
    );
    queue.add({
      type: 'restore',
      productId,
      chatId,
      handler: handleRestore,
      onError: (err) => feishu.sendMessage(chatId, `⚠️ 恢复异常：${err.message}`),
    });
  }
}

async function main() {
  console.log('========================================');
  console.log('  飞书限购自动修改机器人');
  console.log('========================================');

  if (!config.feishu.appId || !config.feishu.appSecret) {
    console.error('缺少 FEISHU_APP_ID / FEISHU_APP_SECRET，请复制 .env.example 为 .env 并填写');
    process.exit(1);
  }

  try {
    await qianniu.ensureReady();
    console.log('[主程序] 千牛已就绪');
  } catch (err) {
    console.warn('[主程序] 千牛初始化失败，将在首次任务时重试:', err.message);
  }

  feishu = new FeishuBot(onMessage);
  feishu.start();

  console.log('');
  console.log('========================================');
  console.log('  机器人已启动');
  console.log('  群内指令格式：');
  console.log('    解限购 <商品ID> <份数>   例：解限购 642838749428 3');
  console.log('    已拍完 <商品ID>          例：已拍完 642838749428');
  console.log('  按 Ctrl+C 停止');
  console.log('========================================');
  console.log('');
}

process.on('SIGINT', async () => {
  console.log('\n[主程序] 正在退出...');
  await qianniu.close();
  process.exit(0);
});

main().catch((err) => {
  console.error('[主程序] 启动失败:', err);
  process.exit(1);
});
