// dsh-vision-assistant — 免费视觉模型引擎（后端纯逻辑，无 DSH 依赖，可单测）
//
// 设计来源（三者均为 MIT，见 THIRD_PARTY_NOTICES.md）：
//   · dsh-vision-opencode  (poiuyjie) —— 底座：配置/settings/工具/识图降级骨架
//   · dsh-vision-router    (ysr666)   —— 免 Key 的 OVHcloud 匿名免费视觉链、免费 provider 预设
//   · ModLens              (liustack) —— 渠道级密钥（key 不进模型条目）+ 逗号多 key 轮换 +
//                                        失败降级链 + 结构化证据
//
// 本文件只做三件事：
//   1) 内置「免费视觉渠道」预设（渠道 = baseURL + 协议 + 模型清单 + 一个密钥引用）
//   2) 解析渠道密钥（DSH 凭据服务 ref → 环境变量），支持一个 ref 里逗号分隔多把 key
//   3) 按顺序调用「渠道 × 模型」，失败自动降级（key 轮换 → 下一个渠道）
//
// 关键约束：**密钥永远不进模型条目**。模型条目只有 { channelId, model }；
// 密钥通过 keyRef 引用宿主凭据服务（~/.dsh/.credentials.yaml）或进程环境变量，
// 与「设置 → 模型」页共用同一份凭据，不产生第二份副本。

/** 免费路由在 settings 里的虚拟 provider id（不注册到宿主，由本插件拦截）。 */
export const FREE_PROVIDER_ID = 'vision-free';
/** 「免费链路（自动降级）」的模型 id。 */
export const CHAIN_MODEL_ID = 'chain';

/** 免费渠道（预设）定义：
 *  keyless=true 的渠道无需注册、无需 Key（OVHcloud 匿名层）；
 *  keyRef 为空时按渠道 id 派生 `<ID>_API_KEY`（如 dashscope → DASHSCOPE_API_KEY）。 */
export const FREE_PRESETS = Object.freeze([
  Object.freeze({
    id: 'ovh',
    name: 'OVHcloud AI Endpoints（免 Key 匿名）',
    homepage: 'https://endpoints.ai.cloud.ovh.net/',
    baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
    requestFormat: 'openai-completions',
    keyRef: '',
    keyless: true,
    // 默认不「加入主链」，只靠全局免 Key 兜底开关固定排在链路最后
    enabled: false,
    directCN: true,
    quota: '免注册免 Key；限额 2 次/分钟/IP/模型（多模型各自独立计数）',
    note: '默认免费兜底。内置 5 个模型轮流尝试，理论合计约 10 次/分钟，实际以 OVH 限流为准。',
    models: Object.freeze([
      'Qwen2.5-VL-72B-Instruct',
      'Qwen3.5-397B-A17B',
      'Qwen3.6-27B',
      'Qwen3.8-27B',
      'Mistral-Small-3.2-24B-Instruct-2506',
    ]),
  }),
  Object.freeze({
    id: 'openrouter-free',
    name: 'OpenRouter 免费视觉模型',
    homepage: 'https://openrouter.ai/models?max_price=0',
    baseUrl: 'https://openrouter.ai/api/v1',
    requestFormat: 'openai-completions',
    keyRef: 'OPENROUTER_FREE_API_KEY',
    keyless: false,
    enabled: false,
    directCN: false,
    quota: '免费档共享 20 次/分钟；未充值约 50 次/天，累计充值 ≥ $10 后最高 1000 次/天',
    note: '免费名单轮换频繁（:free 会下架），请用「探测可用模型」拉取当前真实列表后再勾选。',
    models: Object.freeze([
      'google/gemma-4-31b-it:free',
      'google/gemma-4-26b-a4b-it:free',
      'inclusionai/ling-3.0-flash-vl:free',
      'nex-agi/nex-n2.5-pro:free',
      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    ]),
  }),
  Object.freeze({
    id: 'zhipu',
    name: '智谱 GLM（bigmodel.cn）',
    homepage: 'https://open.bigmodel.cn/',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    requestFormat: 'openai-completions',
    keyRef: 'ZHIPU_API_KEY',
    keyless: false,
    enabled: false,
    directCN: true,
    quota: 'glm-4.6v-flash 永久免费；glm-4.5v / glm-4.6v 为限时免费',
    note: '大陆直连。glm-ocr 是极便宜的专用 OCR（非通用识图）。',
    models: Object.freeze(['glm-4.6v-flash', 'glm-4.6v', 'glm-4.5v', 'glm-ocr']),
  }),
  Object.freeze({
    id: 'dashscope',
    name: '阿里云百炼 DashScope（Qwen-VL）',
    homepage: 'https://bailian.console.aliyun.com/',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    requestFormat: 'openai-completions',
    keyRef: 'DASHSCOPE_API_KEY',
    keyless: false,
    enabled: false,
    directCN: true,
    quota: '新用户开通后 90 天内、每个模型系列 100 万 token（含多模态 VL 系列）',
    note: '大陆直连、兼容 OpenAI 协议；额度最大，通常作为首选付费兜底。',
    models: Object.freeze([
      'qwen3-vl-plus',
      'qwen-vl-max',
      'qwen-vl-plus',
      'qwen2.5-vl-72b-instruct',
      'qwen2.5-vl-7b-instruct',
      'qwen-vl-ocr',
    ]),
  }),
  Object.freeze({
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    homepage: 'https://cloud.siliconflow.cn/',
    baseUrl: 'https://api.siliconflow.cn/v1',
    requestFormat: 'openai-completions',
    keyRef: 'SILICONFLOW_API_KEY',
    keyless: false,
    enabled: false,
    directCN: true,
    quota: '新用户赠金（约 ¥14，量级两千万 token）；DeepSeek-OCR 等极少数 $0 模型',
    note: '大陆直连。赠金用尽后按量计费，请以控制台账单为准。',
    models: Object.freeze([
      'Qwen/Qwen3-VL-32B-Instruct',
      'Qwen/Qwen3-VL-8B-Instruct',
      'Qwen/Qwen2.5-VL-32B-Instruct',
      'Qwen/Qwen2.5-VL-7B-Instruct',
      'deepseek-ai/DeepSeek-OCR',
    ]),
  }),
  Object.freeze({
    id: 'gemini',
    name: 'Google AI Studio（Gemini 免费档）',
    homepage: 'https://aistudio.google.com/apikey',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    requestFormat: 'openai-completions',
    keyRef: 'GEMINI_API_KEY',
    keyless: false,
    enabled: false,
    directCN: false,
    quota: '免费档按模型给每日请求额度，无需信用卡（ModLens 推荐的零成本起步渠道）',
    note: 'OpenAI 兼容端点。大陆需代理；单次读图约 5-10 秒。',
    models: Object.freeze([
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash',
    ]),
  }),
]);

/** 单次识图调用的默认输出上限。 */
export const FREE_MAX_TOKENS = 4096;

/** 失败分类：只有 auth/rate/quota 才在同一渠道内轮换下一把 key（ModLens 语义）；
 *  其余失败（网络/5xx/解析）直接跳到下一个渠道，避免把不可用的 key 挨个试一遍。 */
const ROTATE_KINDS = new Set(['auth', 'rate', 'quota']);

/**
 * 可清理的超时信号。
 * 刻意不用 `AbortSignal.timeout()`：它的定时器无法显式清理，会让每次识图调用
 * 在进程里多留一个悬空定时器（单测里表现为事件循环被拖住 30s）。
 */
export function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(Object.assign(new Error(`timeout after ${ms}ms`), { name: 'TimeoutError' }));
  }, ms);
  if (typeof timer.unref === 'function') timer.unref();
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export class FreeCallError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'FreeCallError';
    this.kind = details.kind ?? 'other';
    this.status = details.status ?? 0;
    this.channelId = details.channelId ?? '';
    this.model = details.model ?? '';
    this.keyIndex = details.keyIndex ?? -1;
  }
}

/** 只接受绝对 http(s) 地址：这些地址会被宿主带着渠道密钥去请求，其他形态一律不收。 */
export function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  const raw = value.trim();
  if (raw.length === 0) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 凭据引用名的语法（宿主环境变量名同族）。不合法的引用名一律退回派生名，
 *  避免把任意字符串当成 ref 交给凭据服务。 */
const KEY_REF_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export function isKeyRefName(value) {
  return typeof value === 'string' && KEY_REF_RE.test(value.trim());
}

/** 渠道 id → 默认密钥引用名（同「设置 → 模型」页：PROVIDER_API_KEY）。 */
export function derivedKeyRef(channelId) {
  return `${String(channelId ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
}

/** 渠道的密钥引用名（显式 keyRef 优先）。 */
export function keyRefOf(channel) {
  const explicit = typeof channel?.keyRef === 'string' ? channel.keyRef.trim() : '';
  return isKeyRefName(explicit) ? explicit : derivedKeyRef(channel?.id);
}

/** 渠道可能用到的全部引用名（显式 ref，或内置目录里同名渠道的 ref），按优先级去重。 */
export function keyRefCandidates(channel) {
  const refs = [];
  const push = (ref) => {
    if (typeof ref === 'string' && ref.length > 0 && !refs.includes(ref)) refs.push(ref);
  };
  push(keyRefOf(channel));
  push(derivedKeyRef(channel?.id));
  return refs;
}

/** 一个 ref 的值里可以放多把 key：逗号 / 分号 / 换行分隔。 */
export function splitKeys(value) {
  if (typeof value !== 'string') return [];
  return value.split(/[\n,;]+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

/** 把预设渠道合并进用户配置：预设提供模型白名单，用户的启用状态/模型勾选/密钥引用优先。 */
export function seedChannels(stored) {
  const byId = new Map();
  for (const raw of Array.isArray(stored) ? stored : []) {
    if (raw === null || typeof raw !== 'object') continue;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (id.length === 0) continue;
    byId.set(id, raw);
  }
  const out = [];
  for (const preset of FREE_PRESETS) {
    const saved = byId.get(preset.id) ?? {};
    byId.delete(preset.id);
    out.push(normalizeChannel({ ...preset, ...saved, id: preset.id, builtin: true }));
  }
  // 用户自建的免费渠道（非预设）：原样保留，排在内置渠道之后
  for (const saved of byId.values()) out.push(normalizeChannel({ ...saved, builtin: false }));
  return out;
}

/** 规整一个渠道条目（永远不含密钥字段——密钥只以 keyRef 引用存在）。 */
export function normalizeChannel(raw) {
  const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
  const preset = FREE_PRESETS.find((p) => p.id === id);
  const requestFormat = raw?.requestFormat === 'anthropic' || raw?.requestFormat === 'openai-responses'
    ? raw.requestFormat
    : 'openai-completions';
  const models = [];
  for (const m of Array.isArray(raw?.models) ? raw.models : []) {
    if (typeof m !== 'string') continue;
    const value = m.trim();
    if (value.length > 0 && !models.includes(value)) models.push(value);
  }
  // baseUrl 只接受绝对 http(s)：这条地址会被宿主带着密钥去请求（探测/识图都走它）。
  const rawBaseUrl = typeof raw?.baseUrl === 'string' ? raw.baseUrl.trim().replace(/\/+$/, '') : '';
  const presetBaseUrl = typeof preset?.baseUrl === 'string' ? preset.baseUrl : '';
  const baseUrl = isHttpUrl(rawBaseUrl) ? rawBaseUrl : (isHttpUrl(presetBaseUrl) ? presetBaseUrl : '');
  const explicitRef = typeof raw?.keyRef === 'string' ? raw.keyRef.trim() : '';
  const presetRef = typeof preset?.keyRef === 'string' ? preset.keyRef : '';
  return {
    id,
    name: typeof raw?.name === 'string' && raw.name.trim().length > 0
      ? raw.name.trim()
      : (preset?.name ?? id),
    baseUrl,
    requestFormat,
    keyRef: isKeyRefName(explicitRef) ? explicitRef : (isKeyRefName(presetRef) ? presetRef : ''),
    keyless: raw?.keyless === true || preset?.keyless === true,
    enabled: raw?.enabled === true,
    builtin: raw?.builtin === true || preset !== undefined,
    note: typeof raw?.note === 'string' ? raw.note : (preset?.note ?? ''),
    models,
    maxTokens: Number.isFinite(raw?.maxTokens) && raw.maxTokens > 0 ? Math.floor(raw.maxTokens) : FREE_MAX_TOKENS,
  };
}

/** 免费链路顺序：
 *  · 主链：已启用（enabled）的付费/赠金渠道 × 各自模型，按渠道序、模型序；
 *  · 兜底：免 Key 渠道（OVHcloud 匿名层）永远排在最后 —— 它「已启用」或全局
 *    includeKeylessFallback 打开时都进入兜底位，绝不到主链前面去抢配额。
 *  （对齐 dsh-vision-router「内置 OVH 固定最后兜底」的产品语义。）
 *  pinned 时只返回指定的那一个「渠道 × 模型」。 */
export function chainOf(channels, { includeKeylessFallback = true, pinned = null } = {}) {
  const primary = [];
  const fallback = [];
  for (const channel of Array.isArray(channels) ? channels : []) {
    if (channel === null || typeof channel !== 'object') continue;
    if (pinned !== null) {
      if (channel.id !== pinned.channelId) continue;
      for (const model of Array.isArray(channel.models) ? channel.models : []) {
        if (model === pinned.model) primary.push({ channel, model });
      }
      continue;
    }
    const keyless = channel.keyless === true;
    const enabled = channel.enabled === true;
    if (keyless) {
      if (!enabled && !includeKeylessFallback) continue;
      for (const model of Array.isArray(channel.models) ? channel.models : []) fallback.push({ channel, model });
      continue;
    }
    if (!enabled) continue;
    for (const model of Array.isArray(channel.models) ? channel.models : []) primary.push({ channel, model });
  }
  return [...primary, ...fallback];
}

/** 把「免费链路」暴露成聊天框选择器里的模型条目 id（渠道 pin）。 */
export function pinnedModelId(channelId, model) {
  return `ch:${channelId}:${model}`;
}

/** 解析 pinnedModelId。 */
export function parsePinnedModel(model) {
  if (typeof model !== 'string' || !model.startsWith('ch:')) return null;
  const rest = model.slice(3);
  const at = rest.indexOf(':');
  if (at <= 0 || at >= rest.length - 1) return null;
  return { channelId: rest.slice(0, at), model: rest.slice(at + 1) };
}

/** 请求地址：协议不同端点不同。 */
export function chatEndpoint(channel) {
  if (!isHttpUrl(channel?.baseUrl)) return '';
  const base = String(channel.baseUrl).trim().replace(/\/+$/, '');
  if (channel.requestFormat === 'anthropic') {
    return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
  }
  return `${base}/chat/completions`;
}

/** 模型列表地址（免费渠道探测用）。 */
export function modelsEndpoint(channel) {
  if (!isHttpUrl(channel?.baseUrl)) return '';
  const base = String(channel.baseUrl).trim().replace(/\/+$/, '');
  return `${base}/models`;
}

/** 组合一次请求：路径 / 头 / 体。密钥只在这一步被注入，且只来自调用方解析好的 keys。 */
export function buildRequest({ channel, model, apiKey, systemPrompt, question, mediaType, base64, maxTokens }) {
  const prompt = question !== undefined && typeof question === 'string' && question.trim().length > 0
    ? `请分析这张图片：${question.trim()}`
    : '请详细分析这张图片的内容（中文）。';
  const dataUrl = `data:${mediaType};base64,${base64}`;
  const headers = { 'content-type': 'application/json' };
  if (typeof apiKey === 'string' && apiKey.length > 0) headers.authorization = `Bearer ${apiKey}`;
  const limit = Number.isFinite(channel.maxTokens) && channel.maxTokens > 0 ? channel.maxTokens : maxTokens ?? FREE_MAX_TOKENS;
  if (channel.requestFormat === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    if (typeof apiKey === 'string' && apiKey.length > 0) {
      headers['x-api-key'] = apiKey;
      delete headers.authorization;
    }
    return {
      headers,
      body: {
        model,
        max_tokens: limit,
        ...(typeof systemPrompt === 'string' && systemPrompt.length > 0 ? { system: systemPrompt } : {}),
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          ],
        }],
      },
    };
  }
  if (channel.requestFormat === 'openai-responses') {
    return {
      headers,
      body: {
        model,
        max_output_tokens: limit,
        ...(typeof systemPrompt === 'string' && systemPrompt.length > 0 ? { instructions: systemPrompt } : {}),
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: dataUrl },
          ],
        }],
      },
    };
  }
  return {
    headers,
    body: {
      model,
      max_tokens: limit,
      temperature: 0.2,
      messages: [
        ...(typeof systemPrompt === 'string' && systemPrompt.length > 0 ? [{ role: 'system', content: systemPrompt }] : []),
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    },
  };
}

/** 从各家响应里取出文本。 */
export function parseResponseText(format, data) {
  const joinBlocks = (blocks) => blocks
    .filter((b) => b !== null && typeof b === 'object')
    .map((b) => (typeof b.text === 'string' ? b.text : ''))
    .join('');
  if (format === 'anthropic') {
    if (data !== null && typeof data === 'object' && Array.isArray(data.content)) return joinBlocks(data.content);
    return '';
  }
  if (format === 'openai-responses') {
    if (data !== null && typeof data === 'object' && typeof data.output_text === 'string') return data.output_text;
    if (data !== null && typeof data === 'object' && Array.isArray(data.output)) {
      let text = '';
      for (const item of data.output) {
        if (item !== null && typeof item === 'object' && Array.isArray(item.content)) text += joinBlocks(item.content);
      }
      return text;
    }
    return '';
  }
  const message = data?.choices?.[0]?.message;
  if (message !== undefined && message !== null) {
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) return joinBlocks(message.content);
  }
  const legacy = data?.choices?.[0]?.text;
  return typeof legacy === 'string' ? legacy : '';
}

/** 按响应判定失败类型。 */
export function classifyFailure(status, bodyText = '') {
  const text = String(bodyText ?? '').toLowerCase();
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'quota';
  if (status === 429) return /quota|credit|insufficient|balance|exceeded your current quota/.test(text) ? 'quota' : 'rate';
  if (status >= 500) return 'server';
  if (status === 400 && /quota|insufficient|balance|credit/.test(text)) return 'quota';
  if (status === 0) return 'network';
  return 'other';
}

/** 解析一个渠道可用的密钥：ref 列表逐个 resolve，命中即返回（含多 key）。 */
export async function resolveChannelKeys(channel, { resolve, env } = {}) {
  const refs = keyRefCandidates(channel);
  for (const ref of refs) {
    if (typeof resolve === 'function') {
      try {
        const hit = await resolve(ref);
        const keys = splitKeys(hit?.value);
        if (keys.length > 0) return { keys, ref, source: hit?.source ?? 'credentials' };
      } catch { /* 凭据服务不可用 → 继续下一个 ref / 环境变量 */ }
    }
    const fromEnv = typeof env === 'object' && env !== null ? env[ref] : undefined;
    const keys = splitKeys(fromEnv);
    if (keys.length > 0) return { keys, ref, source: 'env' };
  }
  return { keys: [], ref: refs[0] ?? '', source: 'none' };
}

/**
 * 生效链路 = 手动排序表（freeChainOrder，逐项校验、保持用户给的顺序）
 *           + 免 Key 兜底（自动追加到最末尾，标记 fallback）。
 *
 * order 每项是 `ch:<渠道id>:<模型id>`；指向已不存在的渠道/模型的条目被静默丢弃，
 * 链路不会残留死项。返回 [{ channel, model, manual, fallback }]：
 * manual=用户显式加入的，fallback=免 Key 兜底自动补的。
 */
export function effectiveChain(channels, order = [], { includeKeylessFallback = true } = {}) {
  const list = Array.isArray(channels) ? channels : [];
  const byId = new Map(list.map((c) => [c.id, c]));
  const links = [];
  const seen = new Set();
  for (const entry of Array.isArray(order) ? order : []) {
    const pinned = typeof entry === 'string' ? parsePinnedModel(entry) : null;
    if (pinned === null) continue;
    const channel = byId.get(pinned.channelId);
    if (channel === void 0 || !Array.isArray(channel.models) || !channel.models.includes(pinned.model)) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    links.push({ channel, model: pinned.model, manual: true, fallback: false });
  }
  if (includeKeylessFallback) {
    for (const channel of list) {
      if (channel === null || typeof channel !== 'object' || channel.keyless !== true) continue;
      for (const model of Array.isArray(channel.models) ? channel.models : []) {
        const id = pinnedModelId(channel.id, model);
        if (seen.has(id)) continue;
        seen.add(id);
        links.push({ channel, model, manual: false, fallback: true });
      }
    }
  }
  return links;
}

/**
 * 单个「渠道 × 模型」调用，内部按 key 轮换。
 * 抛出 FreeCallError（含 kind/status/keyIndex），由上层决定是否降级到下一个渠道。
 */
export async function callChannelModel({
  channel,
  model,
  keys,
  systemPrompt,
  question,
  mediaType,
  base64,
  maxTokens,
  signal,
  fetchImpl = globalThis.fetch,
  timeoutMs = 60000,
}) {
  const endpoint = chatEndpoint(channel);
  if (endpoint.length === 0) {
    throw new FreeCallError(`免费渠道 ${channel?.id ?? ''} 缺少 baseUrl`, { kind: 'config', channelId: channel?.id, model });
  }
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new FreeCallError(`免费渠道 ${channel?.id ?? ''} 未配置密钥`, { kind: 'auth', channelId: channel?.id, model, keyIndex: -1 });
  }
  let last;
  for (let index = 0; index < keys.length; index++) {
    const apiKey = keys[index];
    const { headers, body } = buildRequest({ channel, model, apiKey, systemPrompt, question, mediaType, base64, maxTokens });
    const timer = timeoutSignal(timeoutMs);
    const attemptSignal = signal === undefined ? timer.signal : AbortSignal.any([signal, timer.signal]);
    // 单次尝试的结果：{ text } 成功；{ error } 失败。
    // rotate=true 表示「失败与这把 key 有关」，可以换同一渠道的下一把 key。
    let attempt;
    try {
      let resp;
      try {
        resp = await fetchImpl(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: attemptSignal,
        });
      } catch (error) {
        // 调用方主动中止 → 原样抛出，绝不轮换/降级
        if (signal?.aborted) throw error;
        attempt = {
          error: new FreeCallError(`免费渠道 ${channel.id}/${model} 网络失败: ${error?.message ?? String(error)}`, {
            kind: 'network', channelId: channel.id, model, keyIndex: index,
          }),
        };
      }
      if (attempt === void 0 && !resp.ok) {
        let detail = '';
        try { detail = (await resp.text()).slice(0, 400); } catch { /* 读不到正文 */ }
        const kind = classifyFailure(resp.status, detail);
        attempt = {
          rotate: ROTATE_KINDS.has(kind),
          error: new FreeCallError(`免费渠道 ${channel.id}/${model} 返回 HTTP ${resp.status}: ${detail || '(无正文)'}`, {
            kind, status: resp.status, channelId: channel.id, model, keyIndex: index,
          }),
        };
      }
      if (attempt === void 0) {
        let data;
        try { data = await resp.json(); } catch {
          attempt = {
            error: new FreeCallError(`免费渠道 ${channel.id}/${model} 响应不是 JSON`, {
              kind: 'parse', status: resp.status, channelId: channel.id, model, keyIndex: index,
            }),
          };
        }
        if (attempt === void 0) {
          const text = parseResponseText(channel.requestFormat, data).trim();
          attempt = text.length > 0
            ? { text }
            : {
              error: new FreeCallError(`免费渠道 ${channel.id}/${model} 未返回文本`, {
                kind: 'empty', status: resp.status, channelId: channel.id, model, keyIndex: index,
              }),
            };
        }
      }
    } finally {
      timer.clear();
    }
    if (attempt.text !== void 0) return { text: attempt.text, keyIndex: index };
    last = attempt.error;
    if (attempt.rotate === true && index < keys.length - 1) continue; // 换同一渠道的下一把 key
    break; // 其余失败与这把 key 无关：交给上层降级到下一个渠道
  }
  throw last ?? new FreeCallError(`免费渠道 ${channel?.id ?? ''} 调用失败`, { channelId: channel?.id, model });
}

/**
 * 免费链路：按顺序尝试「渠道 × 模型」，任一成功即返回；全部失败抛出最后一个错误。
 * 返回 attempts 明细（谁试过、结果如何），供 UI/日志如实呈现降级过程。
 */
export async function callFreeChain({
  channels,
  /** 预先算好的链路（effectiveChain 的输出）；给了它就不再从 channels 推导 */
  chainLinks = null,
  pinned = null,
  includeKeylessFallback = true,
  resolveKeys,
  env,
  systemPrompt,
  question,
  mediaType,
  base64,
  maxTokens,
  signal,
  fetchImpl = globalThis.fetch,
  timeoutMs = 60000,
}) {
  const links = chainLinks !== null ? chainLinks : chainOf(channels, { includeKeylessFallback, pinned });
  if (links.length === 0) {
    throw new FreeCallError('没有可用的免费视觉渠道：请在「免费视觉模型」里启用至少一个渠道（OVHcloud 匿名层免 Key，开箱可用）', { kind: 'config' });
  }
  const attempts = [];
  // 每个渠道的密钥每轮只解析一次（一个渠道多个模型时不重复打凭据服务）
  const keyCache = new Map();
  let last;
  for (const { channel, model } of links) {
    if (signal?.aborted) throw last ?? new FreeCallError('已取消', { kind: 'aborted' });
    const started = Date.now();
    let keys = [];
    let keyRef = keyRefOf(channel);
    let keySource = 'none';
    if (channel.keyless !== true) {
      if (!keyCache.has(channel.id)) {
        keyCache.set(channel.id, await resolveChannelKeys(channel, { resolve: resolveKeys, env }));
      }
      const resolved = keyCache.get(channel.id);
      keys = resolved.keys;
      keyRef = resolved.ref;
      keySource = resolved.source;
    }
    try {
      const result = await callChannelModel({
        channel, model, keys: channel.keyless === true ? [''] : keys,
        systemPrompt, question, mediaType, base64, maxTokens, signal, fetchImpl, timeoutMs,
      });
      attempts.push({
        channelId: channel.id, channelName: channel.name, model,
        keyRef: channel.keyless === true ? '' : keyRef,
        keySource, keyIndex: result.keyIndex, ok: true, ms: Date.now() - started,
      });
      return {
        text: result.text,
        channelId: channel.id,
        channelName: channel.name,
        model,
        attempts,
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      const failure = error instanceof FreeCallError
        ? error
        : new FreeCallError(error?.message ?? String(error), { channelId: channel.id, model });
      attempts.push({
        channelId: channel.id, channelName: channel.name, model,
        keyRef: channel.keyless === true ? '' : keyRef,
        keySource, keyIndex: failure.keyIndex, ok: false,
        kind: failure.kind, status: failure.status, message: failure.message,
        ms: Date.now() - started,
      });
      last = failure;
    }
  }
  const summary = attempts.map((a) => `${a.channelId}/${a.model}(${a.ok ? 'ok' : a.kind ?? 'fail'}${a.status ? ` ${a.status}` : ''})`).join(' → ');
  const error = new FreeCallError(
    `免费视觉链路全部失败：${summary || '无可用渠道'}；最后一个错误：${last?.message ?? '未知'}`,
    { kind: last?.kind ?? 'other', status: last?.status ?? 0, channelId: last?.channelId ?? '', model: last?.model ?? '' },
  );
  error.attempts = attempts;
  throw error;
}

/** 探测渠道可用模型（GET /models）。返回 [{id, vision, name}]；vision=null 表示端点未声明模态。 */
export async function discoverModels({
  channel,
  keys,
  fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = 15000,
}) {
  const endpoint = modelsEndpoint(channel);
  if (endpoint.length === 0) throw new FreeCallError(`免费渠道 ${channel?.id ?? ''} 缺少 baseUrl`, { kind: 'config' });
  const apiKey = Array.isArray(keys) && keys.length > 0 ? keys[0] : '';
  const headers = {};
  if (apiKey.length > 0) {
    headers.authorization = `Bearer ${apiKey}`;
    headers['x-api-key'] = apiKey;
  }
  const timer = timeoutSignal(timeoutMs);
  const attemptSignal = signal === undefined ? timer.signal : AbortSignal.any([signal, timer.signal]);
  let resp;
  let data;
  try {
    resp = await fetchImpl(endpoint, { method: 'GET', headers, signal: attemptSignal });
    if (!resp.ok) {
      let detail = '';
      try { detail = (await resp.text()).slice(0, 200); } catch { /* 忽略 */ }
      throw new FreeCallError(`渠道 ${channel.id} 模型列表返回 HTTP ${resp.status}: ${detail}`, {
        kind: classifyFailure(resp.status, detail), status: resp.status, channelId: channel.id,
      });
    }
    data = await resp.json();
  } finally {
    timer.clear();
  }
  const rows = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : []);
  const out = [];
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    const id = typeof row.id === 'string' ? row.id : (typeof row.name === 'string' ? row.name : '');
    if (id.length === 0) continue;
    const modalities = row?.architecture?.input_modalities ?? row?.input_modalities;
    const vision = Array.isArray(modalities) ? modalities.includes('image') : null;
    out.push({
      id,
      vision,
      name: typeof row.name === 'string' && row.name.length > 0 ? row.name : id,
      free: id.endsWith(':free') || row?.pricing?.prompt === '0' || row?.pricing?.prompt === 0,
    });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** 结构化证据模式（ModLens 思路）：不改工具契约，只把系统提示词换成要求 JSON 证据。 */
export function evidenceSystemPrompt(basePrompt) {
  return [
    basePrompt,
    '',
    '本回合请以「结构化证据」作答，输出一个 JSON 对象（不要 Markdown 代码围栏、不要额外解释），字段：',
    '{',
    '  "summary": "一句话概括图片内容",',
    '  "transcription": "图中所有可见文字的原样转录（没有则空字符串）",',
    '  "layout": [ { "region": "区域名", "reading_order": 1, "text": "该区域内容" } ],',
    '  "entities": [ { "text": "实体/名称", "type": "person|org|product|code|number|other" } ],',
    '  "relations": [ { "from": "实体A", "relation": "关系", "to": "实体B" } ],',
    '  "uncertainty": [ "无法确认或看不清的部分" ]',
    '}',
    '看不清的字段留空或写进 uncertainty，绝不编造。',
  ].join('\n');
}
