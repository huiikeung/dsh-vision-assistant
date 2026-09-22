# Third-party notices

`dsh-vision-assistant` 自身以 MIT 发布（见 `LICENSE`），并包含以下 MIT 许可项目的
派生代码与设计。三者的原始版权与许可声明均予保留。

---

## 1. dsh-vision-opencode（底座：运行时骨架 + 设置页上半区）

- 项目：https://github.com/poiuyjie/dsh-vision-opencode
- 作者：poiuyjie
- 许可：MIT
- 用途：`lib/index.js`（后端半边）、`lib/client.js`（浏览器半边）、`lib/core.js`
  以 `v0.4.4` 为基线复制后改名（插件名 / settings 分页 id / HTTP 前缀 /
  客户端模块 id），随后在其上新增免费渠道模块。以下能力全部来自该项目：
  `vision_read_image` 工具、`vision-image-analysis` skill、`llm/stream` 发图
  自动转文字、图片准入闸门兼容层（`installImageAdmissionOverride`）、自管
  PiAiAdapter 渠道、渠道密钥圆点、推理档位策略、识图超时/重试/降级占位、
  设置页上半区（模型列表/编辑器/探测弹窗）。

保留的上游行为（刻意未改动）：settings namespace 仍为 `vision-opencode`、
消息 `source.plugin` 仍标 `vision-opencode`、沉淀标记
`[vision-opencode 图片分析 · …]` 原样保留 —— 这样旧配置与历史会话缓存零迁移生效。

## 2. dsh-vision-router（免费链路 + provider 预设）

- 项目：https://github.com/ysr666/dsh-vision-router
- 作者：ysr666
- 许可：MIT
- 用途：免 Key 的 **OVHcloud AI Endpoints 匿名视觉链**（`lib/core-free.js` 中
  `FREE_PRESETS[0]`，模型清单与端点取自该项目的 `lib/core-primitives.js` 与
  `presets/ovh.yaml`）、免费/低价 provider 预设（`presets/` 下的
  dashscope / zhipu / siliconflow / openrouter）、以及"内置免费模型固定排在
  用户模型之后兜底"的链路语义。免费额度与模型清单的事实性说明来自该项目的
  `docs/free-models.zh-CN.md`（2026-08 调研快照；额度随时变动，以官方为准）。

## 3. ModLens（渠道级密钥 / 轮换 / 降级链 / 结构化证据）

- 项目：https://github.com/liustack/modlens
- 包：https://www.npmjs.com/package/@liustack/modlens
- 作者：liustack
- 许可：MIT
- 用途：核心设计（非代码复制）——
  · **渠道级密钥**：key 属于渠道（provider），不属于模型条目；
  · **一个 ref 多把 key 轮换**：鉴权 / 限流 / 额度失败才换 key，其余失败直接
    provider failover；
  · **失败降级链 + `attempts` 明细**：降级过程可观测、不静默；
  · **结构化证据模式**（`summary` / `transcription` / `layout` / `entities` /
    `relations` / `uncertainty`）对应本插件的「结构化证据模式」开关。

## 4. 未采用的上游能力（避免误解）

- dsh-vision-router 的像素级工具面（crop / grounding / pixel-diff / OCR /
  SVG trace / cutout / screenshot 等 14 个工具，依赖 `sharp` / `potrace` /
  `puppeteer-core` 与宿主 attachment 规范化合同）；
- ModLens 的本地 CLI 复用（`claude-cli` / `codex` / `pi` / `agy` / `grok` 登录
  复用、`gemini-api` / `anthropic` 独立 provider、`modlens` CLI 与其
  `~/.modlens/config.json` 配置面）。

两者都是独立工具面/进程面，本插件不做，故其代码与配置格式均未被复制。

---

## LICENSE（上游 dsh-vision-opencode，随派生代码保留）

```
MIT License

Copyright (c) 2025 poiuyjie

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
