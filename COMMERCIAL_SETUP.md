# 商业化部署与接口配置

## 当前已实现

- 邮箱账号注册、登录、30 天会话、密码 scrypt 哈希；
- 求职档案、分析、机会和投递记录的云端 JSON 存储与跨设备恢复；
- 账号及关联云端数据彻底删除；
- 免费、59 元、129 元、299 元四档套餐数据与服务端权益计数；
- 通用支付创建订单接口和经过共享密钥验证的支付回调激活；
- 企业公开招聘页 `JobPosting` JSON-LD、Greenhouse、Lever 公开职位采集；
- URL 公网校验、响应体限制、重定向限制、过期过滤、重复岗位指纹和招聘风险提示；
- 登录用户的公开招聘源保存与每 30 分钟后台同步；
- Web App Manifest、Service Worker、离线外壳和 Push 事件接收基础；
- TXT、文本型 PDF、DOCX 本地简历解析，以及可替换的 OCR／外部解析服务接口；
- 用户行为事件、投递阶段和两次结果复盘数据；
- BOSS 高匹配岗位投递队列、排除规则、每日上限、专属材料，以及官方授权连接器适配层；
- 本地分析模式与可配置 AI 模型服务。

## 环境配置

复制 `.env.example` 为 `.env`，只在服务端填写密钥。不要把 `.env` 提交到代码仓库。

正式公开销售时设置：

```dotenv
COMMERCIAL_MODE=1
OPENAI_API_KEY=...
PAYMENT_CHECKOUT_ENDPOINT=https://your-payment-service.example.com/checkout
PAYMENT_SERVICE_TOKEN=...
PAYMENT_WEBHOOK_SECRET=...
RESUME_PARSER_ENDPOINT=https://your-parser.example.com/extract
BOSS_OFFICIAL_API_ENDPOINT=https://official-authorized-endpoint.example.com/applications
BOSS_OFFICIAL_API_TOKEN=...
```

`COMMERCIAL_MODE=1` 后，岗位分析和简历改写要求登录，并由服务端扣减套餐额度。`ALLOW_DEMO_BILLING=1` 仅用于本地验收，公开部署必须保持为 `0`。

OpenAI 密钥应在 API Platform 中为本项目单独创建，并只写入服务端环境变量。不要粘贴到网页、聊天记录或提交到代码仓库。建议为测试与生产分别建立项目、密钥和费用上限。

## 授权边界

- OpenAI：需要账户持有人本人登录 API Platform、创建项目密钥并开通 API 计费；ChatGPT 订阅不等于 API 额度。
- 微信／支付宝：需要适合经营主体的商户号／开放平台应用、产品权限、签名密钥和支付回调；个人收款码不能作为正式支付接口。
- BOSS：没有项目可直接自助开通的通用求职者批量投递 API，必须取得平台书面合作与真实接口文档。
- 小红书／抖音：开发者入驻与 OAuth 权限不自动包含招聘内容全站搜索；只有审核通过且明确授予的权限才能接入。
- 任何验证码、身份证件、银行卡、私钥和平台密钥都应由主体本人在官方页面或安全的服务端密钥管理中处理。

## 支付适配契约

本程序向 `PAYMENT_CHECKOUT_ENDPOINT` 发送：

```json
{
  "userId": "用户ID",
  "email": "用户邮箱",
  "plan": { "id": "sprint14", "price": 59 },
  "returnUrl": "支付结束后的返回地址"
}
```

支付服务返回：

```json
{ "checkoutUrl": "https://安全收银台地址", "orderId": "订单号" }
```

支付服务确认微信支付或支付宝真实成功后，调用：

```http
POST /api/billing/webhook
X-Payment-Webhook-Secret: 与 PAYMENT_WEBHOOK_SECRET 一致
Content-Type: application/json

{ "userId": "用户ID", "planId": "sprint14", "status": "paid", "orderId": "订单号" }
```

只有服务端回调验证成功才会激活套餐，前端不能自行修改付费权益。

## 公开岗位采集

`POST /api/opportunities/collect` 支持：

- `type=official`：无需登录的企业公开招聘详情页；优先读取 `JobPosting` JSON-LD；
- `type=greenhouse`：Greenhouse Board Token；
- `type=lever`：Lever Site 名称。

登录时传入 `save=true` 会保存为后台同步源。采集器不会访问本机、内网或带账号密码的 URL，也不会绕过登录、验证码、robots／平台限制。若某个网站明确禁止自动访问，应关闭该来源并改为官方接口、RSS、企业授权或用户主动分享。

## 上线前仍需外部资源

- 域名、HTTPS、生产数据库、对象存储和备份；
- 微信支付或支付宝商户，以及实现上述契约的支付服务；
- 邮件／短信或微信登录服务；
- Web Push VAPID 发送服务或微信服务通知；
- 扫描版 PDF 或图片简历如需识别，还需 OCR 服务；文本型 PDF 与 DOCX 已可本地解析；
- BOSS、小红书、抖音等平台的书面授权或开放接口权限；
- 隐私政策、用户协议、自动化决策说明、投诉和数据删除流程。

当前 JSON 存储适合本地测试和首批小规模验证，不适合作为大规模生产数据库。正式上线建议迁移到 PostgreSQL，并将简历文件存入加密对象存储。

## BOSS 官方连接器

在未取得书面授权前，必须保持 `BOSS_OFFICIAL_API_ENDPOINT` 和 `BOSS_OFFICIAL_API_TOKEN` 为空。此时产品只生成队列、材料并跳转 BOSS 官方页面确认。

获得授权后，连接器向官方授权地址发送用户已经确认的 `application` 对象，授权地址需返回 `{ "applicationId": "..." }`。正式对接时，应以 BOSS 提供的真实字段、签名、限流和回调文档替换通用适配契约，不得猜测接口或使用网页自动化代替。
