// ============================================
// 简单串行任务队列
// 千牛操作只能一个一个来，避免同一个浏览器被并发操作
// ============================================

class TaskQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    // productId -> { quantity, time, chatId }
    this.modifiedProducts = new Map();
  }

  add(task) {
    this.queue.push(task);
    console.log(`[队列] 任务入队，当前长度: ${this.queue.length}`);
    this.process();
  }

  async process() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift();
      console.log(`[队列] 开始处理: ${task.type} 商品=${task.productId}`);
      try {
        await task.handler(task);
      } catch (err) {
        console.error('[队列] 任务失败:', err.message);
        if (task.onError) {
          try {
            await task.onError(err);
          } catch (e) {
            console.error('[队列] 错误回调失败:', e.message);
          }
        }
      }
    }

    this.processing = false;
  }

  recordModified(productId, quantity, chatId) {
    this.modifiedProducts.set(productId, { quantity, time: Date.now(), chatId });
  }

  consumeModified(productId) {
    const record = this.modifiedProducts.get(productId);
    if (record) this.modifiedProducts.delete(productId);
    return record;
  }

  getLatestModified() {
    let latest = null;
    let latestTime = 0;
    for (const [productId, record] of this.modifiedProducts.entries()) {
      if (record.time > latestTime) {
        latestTime = record.time;
        latest = { productId, ...record };
      }
    }
    return latest;
  }
}

module.exports = TaskQueue;
