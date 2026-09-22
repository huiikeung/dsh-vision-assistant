// dsh-vision-assistant — 前端半边渲染测试（无浏览器：内置极简 hooks 运行时 + 真路由桥接）
//
// 覆盖：client.js 能被 __ModuleLoader__ 装载、注册 settings.section（侧栏名「视觉助手」）、
//       设置页能渲染出上半区模型列表与下半区免费模型模块、免费渠道交互（配置密钥 /
//       加入链路 / 探测）能真的打到后端路由并刷新 UI。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx, bridgeFetch } from './host-mock.mjs';

const SERVER_MOD = new URL('../lib/index.js', import.meta.url).href;
const CLIENT_FILE = new URL('../lib/client.js', import.meta.url).href;

/** 极简 hooks 运行时：够跑 useState/useEffect/useRef/createElement 的一次次重渲染。 */
function createRuntime() {
  const slots = new Map();
  let current = null;
  let dirty = false;
  const pendingEffects = [];
  let cleanups = [];
  // Rules-of-Hooks 护栏：记录每个组件每次渲染的 hook 序列，
  // 序列变化（条件调用 hook）立刻记账，避免「渲染没炸但行为错乱」被测试放过。
  const hookSignatures = new Map();
  const hookViolations = [];
  let currentSignature = null;

  function slotStore(fn) {
    if (!slots.has(fn)) slots.set(fn, { hooks: [], index: 0 });
    return slots.get(fn);
  }
  const note = (kind) => { if (currentSignature !== null) currentSignature.push(kind); };
  const react = {
    createElement(type, props, ...children) {
      return { type, props: { ...(props ?? {}), children: children.length === 0 ? undefined : children.flat() }, key: props?.key };
    },
    useState(initial) {
      note('state');
      const store = slotStore(current);
      const i = store.index++;
      if (store.hooks.length <= i) store.hooks[i] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = store.hooks[i];
      const setter = (next) => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (value !== slot.value) { slot.value = value; dirty = true; }
      };
      return [slot.value, setter];
    },
    useRef(initial) {
      note('ref');
      const store = slotStore(current);
      const i = store.index++;
      if (store.hooks.length <= i) store.hooks[i] = { current: initial };
      return store.hooks[i];
    },
    useEffect(fn, deps) {
      note('effect');
      const store = slotStore(current);
      const i = store.index++;
      const prev = store.hooks[i];
      const changed = prev === undefined || deps === undefined || prev.deps === undefined
        || deps.length !== prev.deps.length || deps.some((d, j) => d !== prev.deps[j]);
      store.hooks[i] = { deps };
      if (changed) pendingEffects.push(fn);
    },
  };

  function renderNode(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return null;
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(renderNode).filter((n) => n !== null);
    const { type, props } = node;
    if (typeof type === 'function') {
      const store = slotStore(type);
      store.index = 0;
      const prev = current; current = type;
      const prevSignature = currentSignature;
      currentSignature = [];
      let out;
      try {
        out = type(props);
      } finally {
        const signature = currentSignature.join(',');
        currentSignature = prevSignature;
        current = prev;
        const name = type.name || 'anonymous';
        if (hookSignatures.has(name) && hookSignatures.get(name) !== signature) {
          hookViolations.push(`${name}: hook 序列在重渲染间变化（${hookSignatures.get(name)} → ${signature}）`);
        }
        hookSignatures.set(name, signature);
      }
      return renderNode(out);
    }
    return { type, props: { ...props, children: renderNode(props?.children) }, key: node.key };
  }

  return {
    react,
    /** 渲染 + 跑 effect + 等异步状态落定后重渲染，直到稳定。 */
    async settle(Component, props, rounds = 15) {
      let tree = null;
      for (let i = 0; i < rounds; i++) {
        dirty = false;
        tree = renderNode(react.createElement(Component, props));
        const effects = pendingEffects.splice(0, pendingEffects.length);
        for (const fn of effects) {
          const cleanup = fn();
          if (typeof cleanup === 'function') cleanups.push(cleanup);
        }
        await new Promise((r) => setTimeout(r, 0));
        if (!dirty && pendingEffects.length === 0) break;
      }
      return tree;
    },
    dispose() {
      for (const fn of cleanups.splice(0)) { try { fn(); } catch { /* 忽略 */ } }
    },
    hookViolations,
  };
}

const textOf = (tree) => {
  if (tree === null || tree === undefined) return '';
  if (typeof tree === 'string') return tree;
  if (Array.isArray(tree)) return tree.map(textOf).join(' ');
  return textOf(tree.props?.children);
};

/** 深度优先找出所有满足条件的节点。 */
function findAll(tree, predicate, out = []) {
  if (tree === null || tree === undefined || typeof tree === 'string') return out;
  if (Array.isArray(tree)) { for (const node of tree) findAll(node, predicate, out); return out; }
  if (predicate(tree)) out.push(tree);
  findAll(tree.props?.children, predicate, out);
  return out;
}
const byText = (tree, text) => findAll(tree, (n) => typeof n.type === 'string' && textOf(n).includes(text));

/** 找到某个免费渠道卡片（className 为 rowCard 的最紧凑匹配，避免命中外层容器）。 */
const channelCard = (tree, name) => {
  const cards = findAll(tree, (n) => typeof n.type === 'string'
    && String(n.props?.className ?? '').includes('vmo-of-rowCard')
    && textOf(n).includes(name));
  return cards.sort((a, b) => textOf(a).length - textOf(b).length)[0];
};

/** 装载 client.js（模拟 window.__ModuleLoader__ 与平台模块）。 */
async function loadClient(react, extraModules = {}) {
  let captured = null;
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    __ModuleLoader__: {
      load: (entry) => { captured = entry; },
    },
  };
  const styleStub = { dataset: {}, textContent: '' };
  globalThis.document = {
    querySelector: () => null,
    createElement: () => styleStub,
    head: { appendChild: () => {} },
  };
  try {
    await import(`${CLIENT_FILE}?t=${Date.now()}`);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
  assert.ok(captured !== null, 'client.js 应向 window.__ModuleLoader__.load 注册模块');
  assert.equal(captured.id, 'dsh-vision-assistant');
  const req = (name) => {
    if (name === 'react') return react;
    if (Object.prototype.hasOwnProperty.call(extraModules, name)) return extraModules[name];
    throw new Error(`unexpected require(${name})`);
  };
  return captured.factory(req);
}

/**
 * 组装「后端 apply + 前端 apply」的完整链路。
 * @param options.clientServices - 前端拿到的宿主服务形态：
 *   'remote'（DSH 0.1.6 真实形态：connection 无 api，凭据走 ctx.remote.credentials）
 *   'legacy'（旧宿主：connection.api.credentials）
 *   'none'（两者都没有 → 必须给出可操作提示，而不是静默失败）
 */
async function bootPair({ settingsDoc = {}, credentials = {}, providers = [], modelsByProvider = {}, clientServices = 'remote' } = {}) {
  const host = makeCtx({ settingsDoc, credentials, providers, modelsByProvider });
  const server = await import(`${SERVER_MOD}?t=${Date.now()}`);
  server.apply(host.ctx, {});
  await new Promise((r) => setTimeout(r, 20));

  const runtime = createRuntime();
  const client = await loadClient(runtime.react, {
    '@deepseek-ai/dsh-client-ui-primitives': {}, // 平台原语缺席 → 走内置兜底字形
  });
  const sections = new Map();
  const inputs = new Map();
  const calls = { set: [], unset: [], describe: [] };
  const presence = (ref) => typeof credentials[ref] === 'string' && credentials[ref].length > 0;
  const legacyApi = {
    credentials: {
      describe: async (payload) => {
        calls.describe.push(payload && payload.refs);
        const out = {};
        for (const ref of (payload && payload.refs) || []) out[ref] = { configured: presence(ref), writable: true, source: 'file' };
        return { result: { ok: true, value: { credentials: out } } };
      },
      set: async (payload) => { calls.set.push([payload.ref, payload.value]); credentials[payload.ref] = payload.value; return { result: { ok: true } }; },
      unset: async (payload) => { calls.unset.push(payload.ref); delete credentials[payload.ref]; return { result: { ok: true } }; },
    },
    llm: { providers: async () => ({ result: { ok: true, value: { providers: [] } } }) },
    settings: { describe: async () => ({ result: { ok: true, value: { namespaces: [] } } }) },
  };
  // 官方远端形状：describe(refs[]) → {ok, value:{ref:{configured,writable,source}}}；set(ref,value)/unset(ref)
  const remoteCredentials = {
    describe: async (refs) => {
      calls.describe.push(refs);
      const value = {};
      for (const ref of refs) value[ref] = { configured: presence(ref), writable: true, source: 'file' };
      return { ok: true, value };
    },
    set: async (ref, value) => { calls.set.push([ref, value]); credentials[ref] = value; return { ok: true }; },
    unset: async (ref) => { calls.unset.push(ref); delete credentials[ref]; return { ok: true }; },
  };
  // fake llm-pi-ai 原始 user 段（describe/mutate 记录，供「图片输入」开关用例断言）
  calls.mutate = [];
  const settingsRemote = {
    describe: async (ns) => ({
      ok: true,
      revision: 7,
      value: {
        user: { providers: { saibo: { models: [{ id: 'deepseek-v4-flash-0731', input: ['text'] }] } } },
      },
    }),
    mutate: async (ns, ops, revision) => { calls.mutate.push({ ns, ops, revision }); return { ok: true, value: {} }; },
  };
  const legacySettingsRemote = {
    describe: async (ns) => ({ ok: true, value: { revision: 7, user: { providers: {} } } }),
    mutate: async (ns, ops, revision) => { calls.mutate.push({ ns, ops, revision }); return { ok: true, value: {} }; },
  };
  const connectionService = clientServices === 'legacy' ? { api: legacyApi } : {}; // 0.1.6 的 connection 没有 api
  const remoteService = clientServices === 'none'
    ? undefined
    : { credentials: remoteCredentials, llm: legacyApi.llm, settings: clientServices === 'legacy' ? legacySettingsRemote : settingsRemote };
  client.apply({
    get: (name) => {
      if (name === 'connection') return connectionService;
      if (name === 'remote') return remoteService;
      return undefined;
    },
    inject: (names, cb) => { if (names.includes('slots')) cb({ slots: fakeSlots(sections, inputs) }); },
  });
  return { host, runtime, sections, inputs, calls, legacyApi, credentials };
}

/**
 * 折叠摘要头通用展开：title='免费视觉模型' 是模块头；'免费模型' 是渠道分组框头。
 * 匹配时用「含 title 且不含更长标题」避免子串误命中。
 */
async function expandSummary(runtime, sections, tree, title) {
  const candidates = findAll(tree, (n) => n.type === 'button'
    && String(n.props?.className ?? '').includes('vmo-free-summary'));
  const summary = candidates.find((n) => textOf(n).includes(title));
  if (summary === undefined) throw new Error(`找不到折叠头：${title}`);
  if (summary.props['aria-expanded'] === true) return tree;
  summary.props.onClick();
  return runtime.settle(sections.get('vision').component, sections.get('vision').options.inject());
}

/** 免费模块默认折叠：点击摘要头展开后返回新树（已展开则原样返回）。 */
async function expandFree(runtime, sections, tree) {
  return expandSummary(runtime, sections, tree, '免费模型兜底链路');
}

/** 「免费模型」分组框默认折叠：点击分组头展开渠道卡（已展开则原样返回）。 */
async function expandGroup(runtime, sections, tree) {
  return expandSummary(runtime, sections, tree, '免费渠道');
}

/**
 * 找到某个免费渠道卡片上的「密钥」按钮并打开表单，返回动作闭包。
 */
function openKeyForm(tree, channelName) {
  const card = channelCard(tree, channelName);
  assert.ok(card, `应找到渠道卡片 ${channelName}`);
  const button = findAll(card, (n) => n.type === 'button' && /^密钥$/.test(textOf(n).trim()))[0];
  assert.ok(button, `${channelName} 应有密钥按钮`);
  return button;
}

function fakeSlots(sections, inputs) {
  return {
    inject: (name, factory) => factory(),
    register: (options, component) => {
      if (options.name === 'settings.section') sections.set(options.id, { options, component });
      if (options.name === 'conversation.input.right') inputs.set(options.id, { options, component });
      return () => {};
    },
  };
}

test('client.js：注册「视觉助手」设置分页与输入框识图选择器', async () => {
  const { sections, inputs } = await bootPair({});
  assert.ok(sections.has('vision'), '应注册 settings.section: vision（沿用基线 id，保证「上次打开的分页」继续命中）');
  const section = sections.get('vision');
  assert.equal(section.options.label(), '视觉助手', '左侧设置栏名称必须是中文「视觉助手」');
  assert.ok(inputs.size >= 1, '应注册 conversation.input.right 的识图模型选择器');
});

test('设置页渲染：上半区模型列表 + 下半区免费视觉模型模块', async () => {
  const { host, sections, runtime } = await bootPair({
    providers: ['openrouter-free', 'saibo'],
    modelsByProvider: {
      'openrouter-free': [
        { id: 'nex-agi/nex-n2.5-pro:free', name: 'Nex N2.5 Pro', inputModalities: ['text', 'image'] },
        { id: 'stealth/union-alpha', name: 'Union Alpha', inputModalities: ['text'] },
      ],
      saibo: [{ id: 'deepseek-v4-flash-0731', name: 'DS', inputModalities: ['text'] }],
    },
    settingsDoc: {
      visionModels: [
        { id: 'e1', provider: 'openrouter-free', model: 'nex-agi/nex-n2.5-pro:free', name: 'Nex N2.5 Pro', displayName: 'OpenRouter' },
      ],
    },
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = bridgeFetch(host.web.routes);
  try {
    let tree = await runtime.settle(sections.get('vision').component, sections.get('vision').options.inject());
    tree = await expandFree(runtime, sections, tree);
    tree = await expandGroup(runtime, sections, tree);
    let text = textOf(tree);
    // 上半区：已导入的识图模型（供应商分组默认折叠，先看到分组头）
    assert.ok(text.includes('OpenRouter'), '应渲染已配置模型的供应商分组');
    const rawVm = await globalThis.fetch('/vision-config/vision-models');
    console.error('RAW status:', rawVm.status, 'body:', JSON.stringify(await rawVm.json()).slice(0, 200));
    const groupHead = findAll(tree, (n) => n.type === 'button' && String(n.props?.className ?? '').includes('vmo-provider-head'))[0];
    assert.ok(groupHead, '应有供应商分组头（text=' + text.slice(0, 400) + '）');
    assert.equal(groupHead.props['aria-expanded'], false, '分组默认折叠');
    groupHead.props.onClick();
    tree = await runtime.settle(sections.get('vision').component, sections.get('vision').options.inject());
    text = textOf(tree);
    assert.ok(text.includes('Nex N2.5 Pro'), '展开后应渲染已配置的识图模型');
    // 下半区：免费视觉模型模块
    assert.ok(text.includes('免费模型兜底链路'), '应渲染免费链路模块标题');
    assert.ok(text.includes('免费链路（自动降级）'), '应渲染免费链路开关');
    assert.ok(text.includes('结构化证据模式'), '应渲染结构化证据开关');
    assert.ok(text.includes('OpenRouter 免费视觉模型'), '应渲染 OpenRouter 渠道');
    // 免 Key 渠道属于第三层模块，不出现在第二层渠道列表里
    assert.equal(text.includes('OVHcloud'), false, '免 Key 渠道不应出现在免费链路模块');
    const orCard = channelCard(tree, 'OpenRouter 免费视觉模型');
    const orButtons = findAll(orCard, (n) => n.type === 'button').map((n) => textOf(n));
    assert.ok(orButtons.some((t) => t.trim() === '密钥'), '需密钥的渠道应有密钥按钮');
    assert.ok(orButtons.some((t) => t.includes('探测模型')), '应有探测按钮');
    // 第三层：免 Key 最终兜底模块（独立 section，开关 + 兜底模型清单）
    tree = await expandSummary(runtime, sections, tree, '免 Key 最终兜底');
    text = textOf(tree);
    assert.ok(text.includes('启用免 Key 最终兜底'), '应渲染免 Key 兜底开关');
    assert.ok(text.includes('Qwen2.5-VL-72B-Instruct'), '免 Key 兜底模块应列出 OVH 兜底模型');
  } finally {
    globalThis.fetch = previousFetch;
    runtime.dispose();
  }
});

test('免费渠道交互：加入链路 / 配置密钥（写凭据服务）都会落库并刷新界面', async () => {
  // clientServices 默认 'remote' —— 就是本机 DSH 0.1.6 的真实形态（connection 没有 api）
  const { host, sections, runtime, calls } = await bootPair({});
  const previousFetch = globalThis.fetch;
  globalThis.fetch = bridgeFetch(host.web.routes);
  const component = sections.get('vision').component;
  const api = sections.get('vision').options.inject().injected.api;
  try {
    let tree = await runtime.settle(component, { injected: { api } });

    tree = await expandFree(runtime, sections, tree);
    tree = await expandGroup(runtime, sections, tree);

    // ① 把「智谱 GLM」渠道加入免费链路
    const zhipuCard = channelCard(tree, '智谱 GLM（bigmodel.cn）');
    assert.ok(zhipuCard, '应找到智谱渠道卡片');
    const joinToggle = findAll(zhipuCard, (n) => n.type === 'input' && n.props?.type === 'checkbox')[0];
    assert.ok(joinToggle, '渠道卡片应有「加入链路」复选框');
    joinToggle.props.onChange();
    tree = await runtime.settle(component, { injected: { api } });
    assert.equal(host.settings.document().freeChannels.find((c) => c.id === 'zhipu').enabled, true, '渠道启用状态应写入后端配置');
    const chainStep = findAll(tree, (n) => String(n.props?.className ?? '').includes('vmo-free-chain-step') && n.props?.draggable === true)[0];
    assert.ok(chainStep, '手动链路项应可拖拽排序');

    // ①b 模型 chip：本体是加入/移出链路的开关，且带独立删除按钮。
    // 用 DashScope 的一个未入链模型验证「点击 → 追加到链路顺序表尾」。
    const chipCard = channelCard(tree, '阿里云百炼 DashScope（Qwen-VL）');
    const chipToggle = findAll(chipCard, (n) => n.type === 'button' && String(n.props?.className ?? '').includes('vmo-free-chip-toggle'))[0];
    assert.ok(chipToggle, '模型 chip 应有加入/移出开关');
    assert.ok(findAll(chipCard, (n) => n.type === 'button' && String(n.props?.['aria-label'] ?? '').startsWith('删除')).length > 0, '模型 chip 应有删除按钮');
    chipToggle.props.onClick();
    tree = await runtime.settle(component, { injected: { api } });
    const orderAfterChip = host.settings.document().freeChainOrder;
    assert.ok(orderAfterChip.includes('ch:dashscope:qwen3-vl-plus'), '点击 chip 应把模型追加进链路顺序表');
    assert.equal(orderAfterChip.at(-1), 'ch:dashscope:qwen3-vl-plus', '新加入的排在末尾');
    assert.ok(chainStep, '手动链路项应可拖拽排序');

    // ② 配置密钥：打开表单 → 输入 → 保存到 DSH 凭据服务（ref = 渠道 keyRef）
    const card2 = channelCard(tree, '智谱 GLM（bigmodel.cn）');
    const keyButton = findAll(card2, (n) => n.type === 'button' && textOf(n).trim() === '密钥')[0];
    assert.ok(keyButton, '应能打开密钥表单');
    keyButton.props.onClick();
    tree = await runtime.settle(component, { injected: { api } });
    const pwd = findAll(tree, (n) => n.type === 'input' && n.props?.type === 'password')[0];
    assert.ok(pwd, '应出现密钥输入框');
    pwd.props.onChange({ target: { value: 'sk-a,sk-b' } });
    tree = await runtime.settle(component, { injected: { api } });
    const saveButton = findAll(tree, (n) => n.type === 'button' && textOf(n).includes('保存到凭据服务'))[0];
    assert.ok(saveButton, '应有保存到凭据服务的按钮');
    saveButton.props.onClick();
    tree = await runtime.settle(component, { injected: { api } });
    assert.deepEqual(calls.set, [['ZHIPU_API_KEY', 'sk-a,sk-b']], '密钥应通过宿主凭据服务写入渠道级 ref，且模型条目不参与');
    // 配置文档里不应出现密钥
    assert.equal(JSON.stringify(host.settings.document()).includes('sk-a'), false);

    // ③ 测试按钮：打到后端 /free-channels 之外的 free-test 路由（渠道不可达时应如实提示）
    const card3 = channelCard(tree, '硅基流动 SiliconFlow');
    const testButton = findAll(card3, (n) => n.type === 'button' && textOf(n) === '测试')[0];
    assert.ok(testButton, '应有测试按钮');
  } finally {
    globalThis.fetch = previousFetch;
    runtime.dispose();
  }
});

test('半区结构：免费模块固定渲染在模型列表之后（上/下两个模块）', async () => {
  const { host, sections, runtime } = await bootPair({});
  const previousFetch = globalThis.fetch;
  globalThis.fetch = bridgeFetch(host.web.routes);
  try {
    const tree = await runtime.settle(sections.get('vision').component, sections.get('vision').options.inject());
    const text = textOf(tree);
    const freeAt = text.indexOf('免费模型兜底链路');
    const keylessAt = text.indexOf('免 Key 最终兜底');
    const addAt = text.indexOf('添加');
    assert.ok(freeAt > 0, '应渲染免费链路模块');
    assert.ok(keylessAt > freeAt, '免 Key 兜底模块应排在免费链路之后');
    assert.ok(freeAt > addAt, '免费模块应排在模型列表/添加区块之后（即页面下方）');
    // 区块自身带 aria-label，便于无障碍与测试定位
    const blocks = findAll(tree, (n) => n.props?.['aria-label'] === '免费模型兜底链路');
    const keylessBlocks = findAll(tree, (n) => n.props?.['aria-label'] === '免 Key 最终兜底');
    assert.equal(blocks.length, 1, '免费链路模块应是单一 section');
    assert.equal(keylessBlocks.length, 1, '免 Key 兜底模块应是单一 section');
  } finally {
    globalThis.fetch = previousFetch;
    runtime.dispose();
  }
});

test('Rules of Hooks：重渲染之间 hook 序列不得变化（新组件 FreeModelsModule 也在内）', async () => {
  const { host, sections, runtime } = await bootPair({
    credentials: { ZHIPU_API_KEY: 'sk-x' },
    providers: ['openrouter-free'],
    modelsByProvider: { 'openrouter-free': [{ id: 'm', name: 'M', inputModalities: ['text', 'image'] }] },
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = bridgeFetch(host.web.routes);
  const api = sections.get('vision').options.inject().injected.api;
  try {
    let tree = await runtime.settle(sections.get('vision').component, { injected: { api } });
    tree = await expandFree(runtime, sections, tree);
    tree = await expandGroup(runtime, sections, tree);
    // 触发若干次真实状态更新（每个都会重渲染，hook 序列必须完全一致）
    const zhipuCard = channelCard(tree, '智谱 GLM（bigmodel.cn）');
    assert.ok(zhipuCard, `应渲染出智谱渠道卡片（当前文本片段：${textOf(tree).slice(0, 200)}）`);
    findAll(zhipuCard, (n) => n.type === 'input' && n.props?.type === 'checkbox')[0].props.onChange();
    tree = await runtime.settle(sections.get('vision').component, { injected: { api } });
    // 按钮文案统一为「密钥」（状态由圆点与 meta 行交代）
    const keyButton = findAll(channelCard(tree, '智谱 GLM（bigmodel.cn）'), (n) => n.type === 'button' && textOf(n).trim() === '密钥')[0];
    assert.ok(keyButton, '应能打开密钥表单');
    keyButton.props.onClick();
    tree = await runtime.settle(sections.get('vision').component, { injected: { api } });
    const pwd = findAll(tree, (n) => n.type === 'input' && n.props?.type === 'password')[0];
    pwd.props.onChange({ target: { value: 'sk-y' } });
    tree = await runtime.settle(sections.get('vision').component, { injected: { api } });
    const groupHead = findAll(tree, (n) => n.type === 'button' && String(n.props?.className ?? '').includes('vmo-provider-head'))[0];
    if (groupHead) groupHead.props.onClick();
    await runtime.settle(sections.get('vision').component, { injected: { api } });
    assert.deepEqual(runtime.hookViolations, [], `hook 序列必须稳定：${runtime.hookViolations.join('; ')}`);
  } finally {
    globalThis.fetch = previousFetch;
    runtime.dispose();
  }
});

test('凭据层兼容三种宿主形态：remote（0.1.6）/ legacy / 都没有', async () => {
  const previousFetch = globalThis.fetch;

  // ① remote（当前宿主真实形态）：两参 set(ref, value)
  {
    const { host, sections, runtime, calls } = await bootPair({ clientServices: 'remote' });
    globalThis.fetch = bridgeFetch(host.web.routes);
    try {
      const api = sections.get('vision').options.inject().injected.api;
      await runtime.settle(sections.get('vision').component, { injected: { api } });
      assert.equal(typeof api.credentials.set, 'function', 'remote 形态下必须能写凭据');
      const response = await api.credentials.set({ ref: 'ZHIPU_API_KEY', value: 'k1,k2' });
      assert.equal(response.result.ok, true);
      assert.deepEqual(calls.set, [['ZHIPU_API_KEY', 'k1,k2']]);
      const described = await api.credentials.describe({ refs: ['ZHIPU_API_KEY', 'NOPE_KEY'] });
      assert.equal(described.result.value.credentials.ZHIPU_API_KEY.configured, true);
      assert.equal(described.result.value.credentials.NOPE_KEY.configured, false);
    } finally {
      globalThis.fetch = previousFetch;
      runtime.dispose();
    }
  }

  // ② legacy（旧宿主）：connection.api.credentials，单对象参数
  {
    const { host, sections, runtime, calls } = await bootPair({ clientServices: 'legacy' });
    globalThis.fetch = bridgeFetch(host.web.routes);
    try {
      const api = sections.get('vision').options.inject().injected.api;
      const response = await api.credentials.set({ ref: 'ZHIPU_API_KEY', value: 'k-legacy' });
      assert.equal(response.result.ok, true);
      assert.deepEqual(calls.set, [['ZHIPU_API_KEY', 'k-legacy']]);
    } finally {
      globalThis.fetch = previousFetch;
      runtime.dispose();
    }
  }

  // ③ 都没有：给出可操作提示，绝不静默失败
  {
    const { host, sections, runtime } = await bootPair({ clientServices: 'none' });
    globalThis.fetch = bridgeFetch(host.web.routes);
    try {
      const api = sections.get('vision').options.inject().injected.api;
      const response = await api.credentials.set({ ref: 'ZHIPU_API_KEY', value: 'k' });
      assert.equal(response.result.ok, false);
      assert.match(response.result.error.message, /凭据|credentials\.yaml/);
      // 界面上「保存」应把这句话显示成 toast，而不是无声无息
      let tree = await runtime.settle(sections.get('vision').component, { injected: { api } });
      tree = await expandFree(runtime, sections, tree);
      tree = await expandGroup(runtime, sections, tree);
      const keyButton = openKeyForm(tree, '智谱 GLM（bigmodel.cn）');
      keyButton.props.onClick();
      tree = await runtime.settle(sections.get('vision').component, { injected: { api } });
      const pwd = findAll(tree, (n) => n.type === 'input' && n.props?.type === 'password')[0];
      pwd.props.onChange({ target: { value: 'k' } });
      tree = await runtime.settle(sections.get('vision').component, { injected: { api } });
      findAll(tree, (n) => n.type === 'button' && textOf(n).includes('保存到凭据服务'))[0].props.onClick();
      tree = await runtime.settle(sections.get('vision').component, { injected: { api } });
      assert.match(textOf(tree), /当前宿主未提供凭据写入接口/, '必须把失败原因显示给用户');
    } finally {
      globalThis.fetch = previousFetch;
      runtime.dispose();
    }
  }
});

test('凭据桥：宿主只允许属性访问 ctx.remote 时也能写密钥（对齐官方门面）', async () => {
  // 真实宿主对动态插件 ctx 是白名单门面：未声明inject的 ctx.get 可能拿不到服务，
  // 而官方「模型」页靠声明 inject 后的 ctx.remote 属性访问。这里模拟该门面：
  // ctx.get('remote') 永远拿不到，ctx.remote 属性可用 → 桥必须仍能写凭据。
  const previousFetch = globalThis.fetch;
  const { host, runtime, calls } = await bootPair({ clientServices: 'none' });
  globalThis.fetch = bridgeFetch(host.web.routes);
  try {
    const runtime2 = createRuntime();
    const client = await loadClient(runtime2.react, { '@deepseek-ai/dsh-client-ui-primitives': {} });
    const sections2 = new Map();
    const inputs2 = new Map();
    const remoteCredentials = {
      describe: async (refs) => ({ ok: true, value: Object.fromEntries(refs.map((r) => [r, { configured: false, writable: true }])) }),
      set: async (ref, value) => { calls.set.push([ref, value]); return { ok: true }; },
      unset: async () => ({ ok: true }),
    };
    const strictCtx = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'get') return (name) => (name === 'connection' ? {} : undefined);
        if (prop === 'remote') return { credentials: remoteCredentials };
        if (prop === 'inject') {
          return (names, cb) => { if (names.includes('slots')) cb({ slots: fakeSlots(sections2, inputs2) }); };
        }
        return undefined;
      },
    });
    client.apply(strictCtx);
    const section = sections2.get('vision');
    assert.ok(section, 'strict 门面下也应完成 settings.section 注册');
    const api = section.options.inject().injected.api;
    const response = await api.credentials.set({ ref: 'ZHIPU_API_KEY', value: 'k-property' });
    assert.equal(response.result.ok, true, JSON.stringify(response));
    assert.deepEqual(calls.set, [['ZHIPU_API_KEY', 'k-property']]);
    runtime2.dispose();
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('渠道状态圆点来自宿主凭据服务（remote.describe）', async () => {
  const previousFetch = globalThis.fetch;
  const { host, sections, runtime, calls } = await bootPair({
    credentials: { ZHIPU_API_KEY: 'sk-x', OPENROUTER_FREE_API_KEY: 'sk-y' },
    providers: ['openrouter-free'],
    modelsByProvider: { 'openrouter-free': [{ id: 'nex-agi/nex-n2.5-pro:free', name: 'Nex', inputModalities: ['text', 'image'] }] },
    // 上半区有已导入模型 → 后端返回渠道 keyRefs → 前端经桥接的 credentials.describe 判状态
    settingsDoc: { visionModels: [{ id: 'e1', provider: 'openrouter-free', model: 'nex-agi/nex-n2.5-pro:free', name: 'Nex' }] },
  });
  globalThis.fetch = bridgeFetch(host.web.routes);
  try {
    const api = sections.get('vision').options.inject().injected.api;
    let tree = await runtime.settle(sections.get('vision').component, { injected: { api } });
    assert.ok(calls.describe.length > 0, '上半区渠道状态应经宿主凭据服务查询（桥接层生效）');
    const openrouterCard = findAll(tree, (n) => typeof n.type === 'string' && String(n.props?.className ?? '').includes('vmo-provider-head')).map((n) => textOf(n));
    assert.ok(openrouterCard.some((t) => /OpenRouter|openrouter-free/.test(t)), '上半区应列出已导入渠道');
    tree = await expandFree(runtime, sections, tree);
    tree = await expandGroup(runtime, sections, tree);
    const zhipuDot = findAll(channelCard(tree, '智谱 GLM（bigmodel.cn）'), (n) => String(n.props?.className ?? '').includes('credentialDot'))[0];
    assert.match(zhipuDot.props.title, /已配置密钥/);
    const dashscopeDot = findAll(channelCard(tree, '阿里云百炼 DashScope（Qwen-VL）'), (n) => String(n.props?.className ?? '').includes('credentialDot'))[0];
    assert.match(dashscopeDot.props.title, /未配置密钥/);
    // 免 Key 渠道已移入第三层「免 Key 最终兜底」模块，第二层不再渲染其渠道卡
  } finally {
    globalThis.fetch = previousFetch;
    runtime.dispose();
  }
});

test('图片传递方式：设置页单选切换并持久化', async () => {
  const { host, sections, runtime } = await bootPair({});
  const previousFetch = globalThis.fetch;
  globalThis.fetch = bridgeFetch(host.web.routes);
  try {
    const component = sections.get('vision').component;
    let tree = await runtime.settle(component, sections.get('vision').options.inject());
    const radios = () => findAll(tree, (n) => n.type === 'input' && n.props?.name === 'vmo-image-delivery');
    assert.equal(radios().length, 2, '应有两个传递方式单选');
    assert.equal(radios()[0].props.checked, true, '默认发图即转文字');
    radios()[1].props.onChange();
    tree = await runtime.settle(component, sections.get('vision').options.inject());
    assert.equal(host.settings.document().imageDelivery, 'onDemand', '切换应持久化');
    tree = await runtime.settle(component, sections.get('vision').options.inject());
    assert.equal(findAll(tree, (n) => n.type === 'input' && n.props?.name === 'vmo-image-delivery')[1].props.checked, true, '界面选中态更新');
  } finally {
    globalThis.fetch = previousFetch;
    runtime.dispose();
  }
});

test('图片传递方式条紧贴「免费视觉模型」模块上方', async () => {
  const { host, sections, runtime } = await bootPair({});
  const previousFetch = globalThis.fetch;
  globalThis.fetch = bridgeFetch(host.web.routes);
  try {
    const tree = await runtime.settle(sections.get('vision').component, sections.get('vision').options.inject());
    const children = tree.props.children.filter((n) => n !== null);
    const addIdx = children.findIndex((n) => textOf(n).includes('添加提供方'));
    const deliveryIdx = children.findIndex((n) => textOf(n).includes('图片传递方式'));
    const freeIdx = children.findIndex((n) => n.props?.['aria-label'] === '免费模型兜底链路');
    assert.ok(addIdx >= 0 && deliveryIdx >= 0 && freeIdx >= 0);
    assert.ok(deliveryIdx > addIdx && deliveryIdx < freeIdx, '传递方式条应在模型列表之后、免费模块之前');
  } finally {
    globalThis.fetch = previousFetch;
    runtime.dispose();
  }
});

test('免费模块默认折叠：点击头部才展开（总开关与渠道卡都在展开区里）', async () => {
  const { host, sections, runtime } = await bootPair({});
  const previousFetch = globalThis.fetch;
  globalThis.fetch = bridgeFetch(host.web.routes);
  try {
    const component = sections.get('vision').component;
    let tree = await runtime.settle(component, sections.get('vision').options.inject());

    // 折叠态：只有摘要头，开关与渠道卡都不可见
    const summary = findAll(tree, (n) => n.type === 'button'
      && String(n.props?.className ?? '').includes('vmo-free-summary'))[0];
    assert.ok(summary, '应有可点击的摘要头');
    assert.equal(summary.props['aria-expanded'], false, '默认必须折叠');
    let text = textOf(tree);
    assert.ok(text.includes('免费模型兜底链路'), '折叠态也保留模块标题');
    assert.match(text, /个渠道/, '折叠态显示渠道数摘要');
    assert.equal(/加入链路/.test(text), false, '折叠态不应渲染「加入链路」');
    assert.equal(/免费链路（自动降级）/.test(text), false, '折叠态不应渲染总开关');
    assert.equal(/OVHcloud AI Endpoints/.test(text), false, '折叠态不应渲染渠道卡片');

    // 展开模块：总开关成卡片框、链路顺序标签独占一行、渠道收在「免费模型」分组框里
    tree = await expandFree(runtime, sections, tree);
    text = textOf(tree);
    for (const marker of ['免费链路（自动降级）', '结构化证据模式', '免费链路顺序']) {
      assert.ok(text.includes(marker), `展开后应包含：${marker}`);
    }
    const freeSection = findAll(tree, (n) => n.props?.['aria-label'] === '免费模型兜底链路')[0];
    const toggleCards = findAll(freeSection, (n) => String(n.props?.className ?? '').includes('vmo-free-toggleCard'));
    assert.equal(toggleCards.length, 2, '免费链路模块的两个总开关应各自框在边框卡片里（免 Key 开关在第三层模块）');
    // 分组框默认仍是折叠的：渠道卡不可见，只有分组头
    assert.equal(/全部加入/.test(text), false, '分组框折叠时不应渲染渠道卡');
    const groupHead = findAll(tree, (n) => n.type === 'button'
      && String(n.props?.className ?? '').includes('vmo-free-summary')
      && textOf(n).includes('免费渠道'))[0];
    assert.ok(groupHead, '应有「免费渠道」分组头');
    assert.equal(groupHead.props['aria-expanded'], false, '分组框默认折叠');
    assert.match(textOf(groupHead), /个渠道/);

    // 展开分组框：渠道卡出现
    tree = await expandGroup(runtime, sections, tree);
    text = textOf(tree);
    for (const marker of ['OpenRouter 免费视觉模型', '全部加入']) {
      assert.ok(text.includes(marker), `展开分组后应包含：${marker}`);
    }
    assert.equal(text.includes('OVHcloud'), false, '免 Key 渠道不应装在第二层分组框里');
    // 分组框是一个框：分组头与渠道卡同在 vmo-free-group 容器内
    const group = findAll(tree, (n) => String(n.props?.className ?? '') === 'vmo-free-group')[0];
    assert.ok(group, '应有 vmo-free-group 分组框');
    assert.ok(textOf(group).includes('OpenRouter 免费视觉模型'), '渠道卡应装在分组框里');
  } finally {
    globalThis.fetch = previousFetch;
    runtime.dispose();
  }
});

test('视觉人工定论：每行「视觉:自动/是/否」按钮循环并持久化', async () => {
  const { host, sections, runtime } = await bootPair({
    providers: ['openrouter-free'],
    modelsByProvider: { 'openrouter-free': [{ id: 'm', name: 'M', inputModalities: ['text', 'image'] }] },
    settingsDoc: { visionModels: [{ id: 'ok', provider: 'openrouter-free', model: 'm', name: 'M' }] },
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = bridgeFetch(host.web.routes);
  try {
    const component = sections.get('vision').component;
    let tree = await runtime.settle(component, sections.get('vision').options.inject());
    // 行在供应商分组里（默认折叠），先展开分组
    const groupHead = findAll(tree, (n) => n.type === 'button' && String(n.props?.className ?? '').includes('vmo-provider-head'))[0];
    groupHead.props.onClick();
    tree = await runtime.settle(component, sections.get('vision').options.inject());
    let toggle = findAll(tree, (n) => n.type === 'button' && /^视觉:/.test(textOf(n)))[0];
    assert.ok(toggle, '每行应有视觉定论按钮');
    assert.equal(textOf(toggle), '视觉:自动');

    toggle.props.onClick(); // 自动 → 是
    tree = await runtime.settle(component, sections.get('vision').options.inject());

    assert.equal(host.settings.document().visionModels[0].visionOverride, 'yes', '定论应持久化');
    toggle = findAll(tree, (n) => n.type === 'button' && /^视觉:/.test(textOf(n)))[0];
    assert.equal(textOf(toggle), '视觉:是');

    toggle.props.onClick(); // 是 → 否
    tree = await runtime.settle(component, sections.get('vision').options.inject());
    assert.equal(host.settings.document().visionModels[0].visionOverride, 'no');
    toggle = findAll(tree, (n) => n.type === 'button' && /^视觉:/.test(textOf(n)))[0];
    assert.equal(textOf(toggle), '视觉:否');

    toggle.props.onClick(); // 否 → 自动
    tree = await runtime.settle(component, sections.get('vision').options.inject());
    assert.equal(host.settings.document().visionModels[0].visionOverride, '', '回到自动检测');
  } finally {
    globalThis.fetch = previousFetch;
    runtime.dispose();
  }
});


test('「图片输入」标记（移植自 dsh-auxiliary）：勾选写入 llm-pi-ai 的 input 声明', async () => {
  const { host, sections, runtime, calls } = await bootPair({
    settingsDoc: { visionModels: [{ id: 't1', provider: 'saibo', model: 'deepseek-v4-flash-0731', name: 'DS' }] },
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = bridgeFetch(host.web.routes);
  try {
    const component = sections.get('vision').component;
    let tree = await runtime.settle(component, sections.get('vision').options.inject());
    // 行在供应商分组里（默认折叠），先展开分组
    const groupHead = findAll(tree, (n) => n.type === 'button' && String(n.props?.className ?? '').includes('vmo-provider-head'))[0];
    groupHead.props.onClick();
    tree = await runtime.settle(component, sections.get('vision').options.inject());
    // saibo 的模型在 fake llm-pi-ai user 段里 → 行上应出现「图片输入」开关
    const toggle = findAll(tree, (n) => n.type === 'label' && textOf(n).includes('图片输入')
      && findAll(n, (c) => c.type === 'input' && c.props?.type === 'checkbox').length > 0)[0];
    assert.ok(toggle, 'llm-pi-ai 模型应有「图片输入」开关（text=' + textOf(tree).slice(0, 300) + '）');
    assert.equal(findAll(toggle, (n) => n.type === 'input' && n.props?.type === 'checkbox')[0].props.checked, false, '默认未标记');
    toggle.props.onChange({ target: { checked: true }, preventDefault() {} });
    tree = await runtime.settle(component, sections.get('vision').options.inject());
    assert.deepEqual(calls.mutate.at(-1), {
      ns: 'llm-pi-ai',
      ops: [{ op: 'set', path: ['providers', 'saibo', 'models', 0, 'input'], value: ['text', 'image'] }],
      revision: 7,
    }, '应经宿主远端设置按路径写入 input 声明');
  } finally {
    globalThis.fetch = previousFetch;
    runtime.dispose();
  }
});
