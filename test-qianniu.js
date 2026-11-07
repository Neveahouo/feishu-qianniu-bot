// ============================================
// 千牛自动化单独测试（不启动飞书）
// 用法：node test-qianniu.js <商品ID> <份数>
// 例：  node test-qianniu.js 642838749428 3
// ============================================

const QianniuAutomation = require('./qianniu-automation');

async function main() {
  const args = process.argv.slice(2);
  const productId = args[0];
  const quantity = parseInt(args[1], 10);

  if (!productId || !Number.isFinite(quantity)) {
    console.error('用法: node test-qianniu.js <商品ID> <份数>');
    process.exit(1);
  }

  console.log(`[测试] 商品ID=${productId} 目标份数=${quantity}`);

  const qianniu = new QianniuAutomation();
  try {
    const result = await qianniu.modifyPurchaseLimit(productId, quantity);
    console.log('========================================');
    console.log('结果:', JSON.stringify(result));
    console.log('========================================');
  } catch (err) {
    console.error('[测试] 失败:', err.message);
  } finally {
    console.log('[测试] 10 秒后关闭浏览器...');
    setTimeout(async () => {
      await qianniu.close();
      process.exit(0);
    }, 10000);
  }
}

main();
