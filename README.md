# dsh-vision-assistant（设置侧栏：视觉助手）

给 DeepSeek Harness 的**整合版视觉插件**：一个设置页、两个模块、三份上游能力。

- **上半区「已配置视觉模型」**：与 `dsh-vision-opencode` 完全一致——只列出**声明支持图片输入**的已配置模型（不支持的不显示），带渠道密钥状态圆点、推理档位、增删改查、`vision_read_image` 工具与 `vision-image-analysis` skill、发图自动转文字。
- **下半区「免费视觉模型」**（默认折叠，点击摘要头展开）：免费渠道模块——**免 Key 的 OVHcloud 匿名层开箱即用**；其余渠道只需在**渠道级**填一次密钥，免费链路按顺序尝试、失败自动降级。

> 左侧「设置」栏里的分页名就是中文 **视觉助手**。

---

## 1. 这个插件由什么拼出来的

| 来源 | 拿来了什么 |
|---|---|
| [`poiuyjie/dsh-vision-opencode`](https://github.com/poiuyjie/dsh-vision-opencode)（**底座**，MIT） | 全部运行时骨架：settings namespace、`vision_read_image` 工具、`llm/stream` 发图自动转换、图片准入闸门兼容层、自管 adapter、渠道密钥圆点、推理关闭策略、识图超时/重试/降级占位、设置页上半区 UI |
| [`ysr666/dsh-vision-router`](https://github.com/ysr666/dsh-vision-router)（MIT） | **免 Key 免费视觉链**（OVHcloud AI Endpoints 匿名层，5 个模型轮转）、免费 provider **预设**（百炼 / 智谱 / 硅基流动 / OpenRouter / OVH）、"内置免费模型固定最后兜底" 的产品语义 |
| [`liustack/modlens`](https://github.com/liustack/modlens)（MIT） | **渠道级密钥**模型（key 不进模型条目）、**一个 ref 多把 key 轮换**（鉴权/限流/额度失败才换 key，网络/5xx 直接换渠道）、**失败降级链 + 尝试明细**、**结构化证据模式**（JSON evidence）、渠道可用性探针 |

刻意的取舍（没做的部分，明确说明）：

- **不内置任何第三方 Key**（安全 + ToS）。仓库只带 provider 预设，Key 由用户填一次，落在 DSH 凭据服务里。
- **不搬 modlens 的本地 CLI 复用**（`claude-cli` / `codex` / `pi` / `agy` 登录复用）：那条链路要拉起外部 CLI、跨进程继承登录态，与 DSH 单插件模型不兼容，属于另一个量级的工程（独立进程池、配额标注、每 harness 授权）。需要时我们再加。
- **不搬 dsh-vision-router 的 14 个像素级工具**（crop / grounding / pixel_diff / potrace / OCR / 截图…）：它们依赖 `sharp`、`potrace`、`puppeteer-core` 与宿主的 attachment 规范化合同，是独立的一套工具面。本插件保留识图（理解）能力，像素级工具面留作后续。

---

## 2. 安装

### 2.1 官方 CLI（推荐）

```bash
dsh plugin --profile web add -w dsh-vision-assistant@link:/vol1/1000/Deepseek-Harness/工作台/插件/dsh-vision-assistant
```

装完**重启 dsh**，打开 设置 → **视觉助手**。

### 2.2 手动（等价）

1. `~/.dsh/profiles/web/package.json`：`dependencies` 加
   `"dsh-vision-assistant": "link:/vol1/1000/Deepseek-Harness/工作台/插件/dsh-vision-assistant"`，
   `dsh.profile.bundles` 加 `"dsh-vision-assistant"`；
2. 在 `~/.dsh/profiles/web/node_modules/` 里建同名软链指向本目录；
3. 重启 dsh。

### 2.3 ⚠️ 必须与 `dsh-vision-opencode` 二选一

两者注册**同一个 settings namespace**（`vision-opencode`，刻意沿用以零迁移继承你的旧配置）、**同一个工具名**与**同一个 skill**，同时启用会撞名。切换方式是在 profile 的 `cordis.patch.yml` 里停用旧的：

```yaml
- id: vision-opencode
  disabled: true
```

回滚（30 秒）：跑 `node scripts/rollback-profile.mjs`，重启即可回到原状。该脚本是**安全回滚**：
安装时会备份 `package.json` / `cordis.patch.yml` / `settings.yaml`（`*.dsh-vision-assistant.bak`，只备份一次），
回滚时若发现 profile 在安装之后又被改过（装了别的插件、手改过），**不会整文件覆盖**，
只摘掉本插件加的那几行并明确告警，`settings.yaml` 只留副本、永不自动还原。

如果这次安装是用旧版脚本完成的（那时还没有 settings.yaml 快照），补的快照里已经含插件写入的
`freeChannels` 默认值——它只是给你对照用的「装后快照」。想手工清干净插件留下的配置：
删掉 `vision-opencode:` 段里的 `freeChannels` / `freeChainEnabled` / `freeKeylessFallback` /
`freeEvidence` 四个键即可（旧插件 dsh-vision-opencode 的 schema 会忽略它们，不删也不会报错），
或者卸载前调用插件自己的 `POST /vision-config/uninstall`（带动作头）让它自清理。

---

## 3. 上半区：已配置视觉模型

行为与 `dsh-vision-opencode` 一致，这里只列关键点：

- 只显示**声明了图片输入**的模型（宿主 `resolveModelInfo().inputModalities` 含 `image`）；纯文本模型不会出现在列表里，也不会出现在输入框右侧的「识图模型」下拉里。
- 支持「一键导入系统视觉模型」、按渠道分组折叠、渠道显示名、渠道密钥状态圆点（与官方「模型」页同源）。
- 每个模型一行「推理」策略：默认 / 关闭（厂商真申报 `off` 时）/ 强制关闭（尽力而为，不保证成功）。
- 自定义渠道（填了 API 地址）由插件自管 adapter，不写宿主 provider 配置。

**「图片输入」标记（移植自 dsh-auxiliary）**：上半区每行还有一个「图片输入」勾选框——
它把该模型在 `llm-pi-ai` 配置里的 `input` 声明写成 `[text, image]`（user 段路径寻址 + revision 防冲突，
经宿主远端设置接口写入，保存即生效）。这从根上解决「网关不报模态」的问题：标记后主对话模型可以直接
粘贴图片（宿主准入放行）、本插件的导入/检测也会把它识别为视觉模型。仅当上游真的接受图片时勾选——
声明不能把纯文本模型变成视觉模型。

**人工定论（视觉:自动/是/否）**：每行有一个视觉能力开关——「自动」按渠道元数据检测；
「是」/「否」为你的人工定论并持久化，定论为「否」的模型不会再出现在识图选择器里。
之所以保留人工定论，是因为网关/目录元数据不承载真实视觉能力（saibo 网关不报模态、
deepseek 官方目录未收录 vision 系列模型），自动检测只能做参考。

**零迁移**：因为沿用 `vision-opencode` namespace，你原有的 `selected model / visionModels / autoConvert` 全部照旧生效；历史会话里已沉淀的图片分析缓存（`[vision-opencode 图片分析 · …]` 标记）也继续命中，不会重复分析。

---

## 4. 下半区：免费视觉模型（本插件的重点）

### 4.1 内置免费渠道

| 渠道 | Key | 免费额度（按官方口径，随时会变） | 大陆直连 |
|---|---|---|---|
| **OVHcloud AI Endpoints（匿名层）** | **免 Key** | 2 次/分钟/IP/模型，5 个模型各自独立计数 | ✅ |
| OpenRouter 免费档 | `OPENROUTER_FREE_API_KEY` | 免费模型 20 次/分钟；约 50 次/天，累计充值 ≥ $10 后最高 1000 次/天 | ❌ 需代理 |
| 智谱 bigmodel.cn | `ZHIPU_API_KEY` | `glm-4.6v-flash` 永久免费（`glm-4.5v`/`glm-4.6v` 限时免费） | ✅ |
| 阿里云百炼 DashScope | `DASHSCOPE_API_KEY` | 新用户 90 天内每模型系列 100 万 token（含 Qwen-VL 系列） | ✅ |
| 硅基流动 SiliconFlow | `SILICONFLOW_API_KEY` | 新用户赠金（约 ¥14 量级） | ✅ |
| Google AI Studio（Gemini） | `GEMINI_API_KEY` | 免费档按模型给每日额度，无需信用卡 | ❌ 需代理 |

> 预设里的模型清单是**起始清单**，不是真理：免费名单轮换频繁（OpenRouter 的 `:free` 会下架）。用卡片上的 **「探测可用模型」** 从渠道实时拉取 `GET /models` 再勾选，是唯一可靠的做法。探测结果里标 `声明图片` 的是端点自己声明了 image 输入，标 `免费` 的是 `:free` 或价格为 0。

### 4.2 免费链路（自动降级）：一张显式的顺序表

链路就是一张**显式的、可排序的列表**（存在配置 `freeChainOrder` 里），你怎么排它就怎么试：

- **单个添加**：渠道卡里的每个模型 id 都可以点击——点一下加入链路（**追加到表尾**，后加入的排后面），再点一下移出。
- **整渠道添加**：勾选渠道的「全部加入」= 该渠道全部模型按顺序追加；取消勾选 = 全部移出。
- **排序**：链路顺序里每一项都有 `↑ / ↓` 按钮和 `×`（移出），也**支持直接拖拽**调整顺序；顺序完全由你决定。
- **删除单模型**：渠道卡里的模型 chip 带独立 `×`（从该渠道删除此模型，同时自动移出链路）；chip 本体是加入/移出链路的开关。
- **免 Key 兜底**：免 Key 渠道（OVHcloud）的模型不占这张表，由「免 Key 渠道兜底」开关控制，**自动追加在整条链路的最末尾**（标记「兜底」）；把它点进表里就变成手动项，可以参与排序。
- **免费模型不是常规可选项**：输入框的「识图模型」下拉默认只给上半区的视觉模型；
  只有上半区一个可用视觉模型都没有时，才出现「免费模型（自动兜底）」分组，
  并且**逐个列出链路顺序表里的模型**（免 Key 兜底 + 你手动加入的），而不是一个笼统入口。
- **自动兜底**：上半区选中的识图模型调用失败（重试耗尽）时，自动切免费链路再试一次；
  分析文本会如实标注「主模型 + 免费链路兜底」，日志记录降级过程。可用「免费链路（自动降级）」开关整体关闭。

### 4.2.1 图片传递方式：发图即转文字 / 按需描述

上半区模型列表下方有「图片传递方式」单选：

- **发图即转文字**（默认，历史行为）：发送图片时立即调识图模型转成文字，主模型直接读到结论；
- **按需描述（describe_image）**：聊天图片改写为文本引用 `[image: {"attachmentId":"…","mediaType":"…"}]`
  送达主模型，主模型**需要看图时才调用** `describe_image` 工具分析——不相关的图片不再浪费识图调用。
  引用是纯文本，可跨重启；但引用的原始字节缓存在内存（上限 64 张），重启后历史图片无法回看，
  工具会明确报错提示重发。两种模式下识图失败都会自动切免费链路兜底。

### 4.3 密钥怎么放（**密钥不进模型**）

这是本插件对你这句「免费模型配置的 key 不放入模型内」的实现方式，也是我认为最省事的一种：

```
渠道（baseUrl + 协议 + 模型 id 清单 + keyRef）
   ├── keyRef: "ZHIPU_API_KEY"          ← 配置里只有「引用名」，没有密钥
   └── models: ["glm-4.6v-flash", …]    ← 模型条目里连 keyRef 都没有
密钥值 → DSH 凭据服务（~/.dsh/.credentials.yaml）
```

- 你在渠道卡片上点「配置密钥」，前端写的就是**宿主凭据服务**——和「设置 → 模型」页写 key 走的是同一条路。
  插件内部有一层宿主 API 桥：当前 DSH（0.1.6）的密钥读写走 `ctx.remote.credentials.set(ref, value)` /
  `describe([ref])` / `unset(ref)`；老宿主上 `connection.api.credentials` 也仍被支持；
  两者都没有时会明确提示「请在设置 → 模型 里添加密钥，或写 ~/.dsh/.credentials.yaml」，不会静默失败。
- 好处：**一份凭据，两处复用**。例如 `OPENROUTER_FREE_API_KEY` 已经给宿主 `openrouter-free` 路由配过了，免费渠道这边会直接显示 🟢 已配置，不用再填一遍；免费模型与宿主模型也不会各存一份。
- **多把 key 轮换**：一个 ref 里可以填 `key1,key2,key3`（逗号/分号/换行分隔）。只有**鉴权（401/403）/ 限流（429）/ 额度（402 或 402 语义的 400）**才换同一渠道的下一把 key；网络错误与 5xx 不浪费剩余 key，直接降级到下一个渠道（ModLens 语义）。
- 只读遮蔽会如实报错：如果该 ref 由环境变量提供，凭据服务拒绝写入，界面会提示「写入被拒绝（可能被只读环境变量遮蔽）」。
- 密钥永不落进插件配置、永不落进模型条目——`tests/smoke.test.mjs` 与 `tests/client.test.mjs` 里有硬断言守着这条线（配置文档序列化后不允许出现任何 `sk-`）。

### 4.3.1 两条硬安全规则

1. **已存密钥只发给配置里绑定的那个地址**：`/vision-config/discover-models` 允许只带 `provider`
   （不带密钥）探测已有提供方，此时后端会从凭据服务取密钥。但只有当请求里的 `baseUrl`
   （或压根没带地址，走宿主自己的目录）与该提供方**配置里已绑定的地址**一致时才复用；
   调用方指向别的地址时一律拒绝复用（需要密钥就请显式带 `keyDraft`）。
   这条规则是为了堵住「调用方自带 baseUrl + 复用已存密钥」的组合——否则任意网页的一次
   简单跨站 POST 就能把用户密钥发到攻击者主机。渠道地址同时只接受绝对 `http(s)` URL。
2. **密钥形态的字段不出 HTTP**：`GET/PUT /vision-config/config` 的响应里不含 `apiKey`
   （旧版「强制关闭」直连用的字段，属于密钥）；密钥值本身只存在于 DSH 凭据服务。

### 4.4 结构化证据模式（ModLens 思路）

打开后，识图用的系统提示词改为要求 JSON 证据：

```json
{ "summary": "…", "transcription": "…",
  "layout": [{ "region": "…", "reading_order": 1, "text": "…" }],
  "entities": [{ "text": "…", "type": "code|person|number|…" }],
  "relations": [{ "from": "…", "relation": "…", "to": "…" }],
  "uncertainty": ["…"] }
```

只改提示词、不改工具契约，因此对主模型是纯增益；不需要时可一键关掉。

---

## 5. 配置结构（`settings.yaml` 的 `vision-opencode:` 段）

沿用旧 namespace，免费模块新增这几个字段：

```yaml
vision-opencode:
  provider: "vision-free"      # 或具体渠道模型；上半区选择器写入
  model: "chain"               # chain = 免费链路自动降级；ch:<渠道>:<模型> = 只用那一个
  visionModels: [...]          # 上半区：已配置的视觉模型（含 displayName/reasoning）
  autoConvert: true            # 发图自动转文字总开关
  freeChannels:                # 下半区：免费渠道（注意：没有密钥字段）
    - id: ovh
      name: OVHcloud AI Endpoints（免 Key 匿名）
      baseUrl: https://oai.endpoints.kepler.ai.cloud.ovh.net/v1
      requestFormat: openai-completions
      keyRef: ''
      keyless: true
      enabled: false           # 默认不进主链，只作为链路最后兜底
      builtin: true
      models: [Qwen2.5-VL-72B-Instruct, Qwen3.5-397B-A17B, …]
    - id: zhipu
      keyRef: ZHIPU_API_KEY    # 密钥在凭据服务里，这里只是引用名
      enabled: true
      models: [glm-4.6v-flash]
  imageDelivery: eager         # eager=发图即转文字；onDemand=按需描述（describe_image）
  freeChainEnabled: true       # 免费链路总开关
  freeKeylessFallback: true    # 免 Key 渠道固定兜底
  freeEvidence: false          # 结构化证据模式
```

首次启动会**自动写入**内置免费渠道预设（只在你从未配置过 `freeChannels` 时执行一次）。删掉某个渠道的模型不会让预设模型"复活"；想要原始清单用卡片区的「恢复预设」。

两点边界（有意如此）：

- **下半区不做「新建渠道」表单**：内置免费渠道已覆盖常见免费源；要接自建/自托管网关，用**上半区**的「添加模型 → 自定义提供方」（填 API 地址 + 密钥）即可，那条链路本来就走插件自管 adapter。真要往免费链路里塞非内置渠道，直接编辑 `settings.yaml` 的 `freeChannels`（接口 `/vision-config/free-channels` 的 PUT 支持整表写入，`builtin: false` 的条目会被保留）。
- **渠道密钥引用名（keyRef）在界面上是只读展示**：内置渠道都用各平台惯用的 ref 名（`ZHIPU_API_KEY` 等）。如果你的 key 存在别的名字下（例如你已有 `OPENROUTER_API_KEY` 而预设用 `OPENROUTER_FREE_API_KEY`），改 `settings.yaml` 里那个渠道的 `keyRef` 即可，不用重填密钥。

---

## 6. HTTP 端点（设置页与选择器用）

> **所有会改状态或动用凭据的端点都要求自定义请求头**
> `x-vision-config-action: <动作名>`（值见下表）。插件的 HTTP 路由不带浏览器会话鉴权，
> 而「no-cors 简单请求」任何网页都能发；自定义头会强制 CORS 预检，我们没有放行任何跨域来源，
> 于是这类请求只可能来自同源前端或本机脚本。前端已全部带上该头；用 curl 手工调时记得也带。

| 方法 | 路径 | 动作头值 | 说明 |
|---|---|---|---|
| GET / PUT | `/vision-config/config` | `config` | 读/写当前识图模型（含 `vision-free` 虚拟路由） |
| GET | `/vision-config/models` | — | 识图模型下拉数据（已导入模型 + 免费链路/免费渠道分组） |
| GET | `/vision-config/providers` | — | 提供方目录（含官方内置目录与协议清单） |
| GET/POST/PUT/DELETE | `/vision-config/vision-models` | `vision-models` | 上半区模型增删改查 |
| GET | `/vision-config/reasoning-levels` | — | 某模型的推理档位 |
| POST | `/vision-config/discover-models` | `discover-models` | 用草稿/已有密钥探测某提供方的模型 |
| GET | `/vision-config/free-channels` | — | 免费渠道 + 预设 + 密钥状态 + 链路预览 |
| PUT | `/vision-config/free-channels` | `free-channels` | 保存免费渠道（`{channels, freeChainEnabled, …}` 或 `{action:"reset-presets"}`） |
| POST | `/vision-config/free-discover` | `free-discover` | `{channelId}` → 实时拉取该渠道可用模型 |
| POST | `/vision-config/free-test` | `free-test` | `{channelId, model?}` → 用 1×1 PNG 探测渠道可用性 |
| POST | `/vision-config/uninstall` | `uninstall` | 卸载前自清理 |

---

## 7. 测试

```bash
cd /vol1/1000/Deepseek-Harness/工作台/插件/dsh-vision-assistant
node --test tests/*.test.mjs
```

41 个用例，全部离线可跑（本地假网关 + mock 宿主 ctx，不碰真实网络）：

- `tests/free-chain.test.mjs`（24）：key 不进模型条目、ref/环境变量解析、多 key 轮换（401/429/402 换 key，5xx 不换）、链路顺序与免 Key 兜底、pinned 路由、三种协议（openai-completions / openai-responses / anthropic）的请求体与响应解析、`/models` 探测、渠道地址/密钥引用名硬校验、同渠道多模型只解析一次密钥。
- `tests/smoke.test.mjs`（10）：`apply()` 接线、工具/端点注册、预设播种、`/free-channels` 校验（内置渠道不可删、非法定义 400）、密钥不落配置、`vision_read_image` 端到端（第一个渠道 5xx → 自动降级命中第二个渠道）；动作头闸门（无头跨站写请求一律 403）、`GET /config` 不回声 `apiKey`、`discover-models` 的地址校验与「已存密钥不复用到新地址」规则。
- `tests/client.test.mjs`（7）：`client.js` 装载与分页注册（侧栏名必须是「视觉助手」）、设置页同时渲染上下两个模块、免费模块排在模型列表之后、免费渠道交互（勾「加入链路」/「配置密钥」真的落库并刷新界面）、**Rules of Hooks 护栏**（多轮重渲染之间 hook 序列不得变化）、**凭据层三种宿主形态**（当前宿主 `ctx.remote.credentials` 两参签名 / 旧宿主 `connection.api` / 都没有时给出可操作提示）、渠道密钥状态圆点确实来自宿主凭据服务。

---

## 8. 排障

| 现象 | 处理 |
|---|---|
| 设置栏没有「视觉助手」 | 检查 `dsh.profile.bundles` 是否含 `dsh-vision-assistant`，以及是否**重启**了 dsh；同一时间只能启用 vision-config 或 vision-opencode 其中之一。 |
| 下半区加载失败 | 后端 `/vision-config/free-channels` 不可达：看 dsh 日志里 `vision-config:` 前缀的行。 |
| 「探测可用模型」失败 | 多数是渠道未配 Key（会提示 keyRef）或大陆直连不了（OpenRouter/Gemini 需代理）。 |
| 渠道显示 🔴 未配置 | 到「设置 → 模型」同一渠道下填 Key，或在本模块点「配置密钥」；两者写的是同一份凭据。 |
| 免 Key 兜底渠道慢/限流 | OVH 匿名层 2 次/分钟/IP/模型，属正常；把常用渠道加入主链，OVH 只在最后兜底。 |
| 旧版伴生渠道（如 `saibo-vision`）红点/不可用 | 已修：`<父>-vision` 且自身没填地址的渠道会**继承父渠道的网关与密钥**（圆点与实际调用一致）。若升级后仍异常，删掉该渠道重新从系统模型导入。 |
| 免费名单里的模型 404 | 免费名单会轮换：点「探测可用模型」重新勾选。 |
| 想彻底关掉自动转图 | `autoConvert: false`（保留工具与选择器）。 |

---

## 9. 许可与出处

本插件代码以 MIT 发布；`lib/index.js`、`lib/client.js`、`lib/core.js` 是
`dsh-vision-opencode`（MIT, poiuyjie）的派生作品，免费链路与预设来自
`dsh-vision-router`（MIT, ysr666）+ 免费名单调研，渠道级密钥/轮换/证据模式来自
`ModLens`（MIT, liustack）。详见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
