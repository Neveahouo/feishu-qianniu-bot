# purchase-limit-bot

A Feishu (Lark) bot that automatically adjusts **purchase-limit rules** (用户限购) in the Taobao / Tmall seller back office (千牛工作台), triggered by messages in a Feishu group.

Built for e-commerce customer-service teams: a customer wants to buy more than the current per-buyer limit, the agent asks in a group chat, and the bot edits the limit in the seller back office for them.

> 中文说明见 [README.zh-CN.md](./README.zh-CN.md)

## What it does

```
Feishu group message
   "解限购 642838749428 3"
        │
        ▼
  parse product ID + quantity
        │
        ▼
  Playwright drives the Qianniu web console
     search product ID → open limit settings → edit first period → confirm
        │
        ▼
  reply in the group
     ✅ success
     ❌ product is in an active campaign, limit cannot be changed
```

- **Unlock**: change the first purchase-limit period to a requested quantity.
- **Restore**: after the agent reports `已拍完`, set it back to the default (20).
- **Campaign detection**: if Taobao refuses the change (shows a "限购无法生效" dialog, meaning the period overlaps an active campaign), the bot replies that the limit cannot be lifted.
- **Serial queue**: all browser operations run one at a time, so concurrent requests never fight over the same browser session.

## Requirements

- Node.js >= 18
- Google Chrome installed (the bot uses the real Chrome binary, not bundled Chromium)
- A Feishu self-built app with **bot** capability, added to the target group
- A Taobao/Tmall seller account with access to the purchase-limit page

## Setup

### 1. Install dependencies

```bash
npm install
npx playwright install chromium   # optional fallback browser
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Meaning |
| --- | --- |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | Feishu app credentials |
| `QIANNIU_USERNAME` / `QIANNIU_PASSWORD` | Optional. Used for auto-filling the login form |
| `DEFAULT_LIMIT` | Quantity to restore to (default `20`) |
| `HEADLESS` | `false` recommended — you need the window for QR login |

### 3. Configure the Feishu app

In the [Feishu developer console](https://open.feishu.cn):

1. **Add capability** → Bot.
2. **Permissions**: `im:message`, `im:message:send_as_bot`.
3. **Events & callbacks** → subscription mode must be **"Receive events through a persistent connection"** (长连接).
4. **Subscribe to event**: `im.message.receive_v1`.
5. Publish a version / release the app, then add the bot to the group.

### 4. Run

```bash
node index.js
# or double-click start.bat on Windows
```

The first run opens Chrome and asks you to log in to Qianniu. Password login usually triggers a slider captcha that automation cannot pass — click **"扫码登录更便捷"** and scan with the mobile Taobao/Qianniu app. The session is persisted in `chrome-user-data/`, so subsequent runs skip login until it expires.

### 5. Test the browser layer alone

```bash
node test-qianniu.js 642838749428 3
```

## Message formats

| Intent | Message |
| --- | --- |
| Unlock | `解限购 <productId> <qty>` |
| Unlock (alt) | `限购 <productId> 改<qty>份` |
| Unlock (legacy) | any message containing a product URL (`...id=<productId>`) + `<qty>份` + the word 限购 |
| Restore | `已拍完 <productId>` |
| Restore (no ID) | `已拍完` — uses the most recently modified product |

## How it works — implementation notes

These are non-obvious and worth knowing before you modify the code:

1. **Everything is in an iframe.** The limit-management UI renders in a same-origin iframe whose URL contains `purchaseLimitManagement`; the outer page only has the shell. Element lookups must go through `page.frames()`.
2. **The login form is in a different iframe**, named `alibaba-login-box`. Inputs are `#fm-login-id` and `#fm-login-password`.
3. **The product-ID search box** has placeholder `多个用逗号分隔` — not "商品ID".
4. **The quantity input has no identifying attributes.** It is a plain `input[type="text"]` with an empty `id` and `placeholder`, distinguished only by its numeric `value` (e.g. `20`). It is *not* `input[type=number]`.
5. **Only the first period is edited.** The settings panel lists up to six periods; the bot changes the first one (the currently active period).
6. **Failure detection is text-based**: after clicking confirm, a dialog containing `温馨提醒` / `限购无法生效` means the product is in an active campaign and the rule cannot take effect.
7. **Anti-detection is required.** Use the system Chrome with a persistent profile and `--disable-blink-features=AutomationControlled`, plus the injected stealth script. Without it the captcha fails even when solved manually.

## Limitations

- Taobao's UI changes break selectors; the code is defensive but not immune.
- The login session expires periodically and requires a QR scan.
- The machine must stay awake with the process running — it is a local script, not a hosted service.
- No support for multiple seller accounts in parallel (one browser profile per account).

## Project layout

```
config.js              env-driven config
feishu-bot.js          long-connection listener, message parsing, replies
qianniu-automation.js  Playwright automation for the seller back office
task-queue.js          serial queue + modified-product bookkeeping
index.js               entry point
test-qianniu.js        standalone browser test
```

## Legal / responsible use

This project automates **your own** seller account. Use it only on accounts you own and in line with Taobao/Tmall's terms of service and your company's policies. Credentials and session cookies are never committed — `.env`, `qianniu_cookies.json` and `chrome-user-data/` are git-ignored. Keep it that way.

## License

MIT
