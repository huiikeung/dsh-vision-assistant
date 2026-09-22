// dsh-vision-assistant — 测试用宿主 mock（settings / webServer / tools / credentials / llm）
// 供 smoke.test.mjs（后端接线）与 client.test.mjs（前端渲染）共用。
import { createServer } from 'node:http';

/** 极简 settings 服务 + scope：内存文档 + get/replace/watch。 */
export function makeSettings(initial = {}) {
  let doc = { ...initial };
  const watchers = new Set();
  const scope = {
    get: () => doc,
    replace: async (section) => {
      const prev = doc; doc = { ...section };
      for (const fn of watchers) await fn(doc, prev);
    },
    watch: (fn) => { watchers.add(fn); return () => watchers.delete(fn); },
  };
  return {
    document: () => doc,
    scope,
    service: {
      register: () => scope,
      get: (ns) => settingsNamespaces[ns] ?? {},
      describe: async () => ({ namespaces: [] }),
    },
  };
}

/** 收集路由的假 webServer。 */
export function makeWebServer() {
  const routes = new Map();
  return {
    routes,
    service: {
      register: (route) => {
        routes.set(route.path, route.handler);
        return () => routes.delete(route.path);
      },
    },
  };
}

/** 组装一个足够跑通 apply() 的 cordis ctx。 */
export function makeCtx({ settingsDoc = {}, credentials = {}, providers = [], modelsByProvider = {}, fileBytes = null, configurableProviders = [], settingsNamespaces = {}, listModelsByProvider = null } = {}) {
  const web = makeWebServer();
  const listeners = {};
  const registeredTools = [];
  const settings = makeSettings(settingsDoc);
  const skills = [];
  // 1×1 PNG：识图工具路径需要真实可解析的图片字节
  const bytes = fileBytes ?? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  const fakeAttachments = {
    imageLimits: {
      mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      maxImageBytes: 20 * 1024 * 1024,
      maxMessageImageBytes: 20 * 1024 * 1024,
    },
    saveImage: async ({ data, mediaType, name }) => ({
      attachmentId: 'mock-attachment-1', mediaType, bytes: data, name,
      width: 1, height: 1,
    }),
  };
  const fakeFs = {
    resolve: async (path) => ({ displayPath: String(path) }),
    stat: async () => ({ type: 'file' }),
    readBytes: async () => bytes,
  };
  const llm = {
    resolveModelInfo: async (provider, model) => ({
      inputModalities: (modelsByProvider[provider] ?? []).find((m) => m.id === model)?.inputModalities ?? ['text'],
    }),
    listProviders: () => providers.map((id) => ({ id, name: id })),
    listModels: async (id) => (listModelsByProvider !== null && listModelsByProvider[id] !== undefined ? listModelsByProvider[id] : (modelsByProvider[id] ?? [])),
    listConfigurableProviders: () => configurableProviders,
    registerAdapter: (list) => { llm.registeredAdapters.push(list); return { dispose() {} }; },
    registeredAdapters: [],
    stream: async function* () {},
    discoverCalls: [],
    discoverModels: async (_adapter, request) => { llm.discoverCalls.push(request); return []; },
  };
  const credentialsService = {
    resolve: async (ref) => (typeof credentials[ref] === 'string' ? { value: credentials[ref], source: 'file' } : undefined),
    describe: async (ref) => ({
      configured: typeof credentials[ref] === 'string' && credentials[ref].length > 0,
      writable: true,
      source: 'file',
    }),
    set: async (ref, value) => { credentials[typeof ref === 'string' ? ref : ref?.ref] = value; },
    unset: async (ref) => { delete credentials[typeof ref === 'string' ? ref : ref?.ref]; },
  };
  // makeSettings 在模块层看不到 settingsNamespaces，这里按用例覆写 ns 寻址
  settings.service.get = (ns) => settingsNamespaces[ns] ?? {};
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    // 宿主里 ctx.llm 是服务访问器（不是 ctx.get('llm')）；两条路径都要可用
    llm,
    fs: fakeFs,
    get: (name) => ({
      attachments: fakeAttachments,
      llm,
      credentials: credentialsService,
      fs: fakeFs,
      sessions: undefined,
      systemPrompt: undefined,
    })[name],
    inject: (names, cb) => {
      // cordis 的 ctx.inject 在依赖服务就绪后「异步」回调，apply() 主体早就返回了。
      // mock 必须照此延迟，否则会命中插件里后置声明的 let（TDZ），得出假故障。
      queueMicrotask(() => {
        if (names.includes('settings')) cb({ settings: settings.service, effect: (fn) => fn() });
        if (names.includes('webServer')) cb({ webServer: web.service, effect: (fn) => fn() });
        if (names.includes('skills')) cb({ skills: { register: (def) => { skills.push(def); return () => {}; } }, effect: (fn) => fn() });
      });
    },
    effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {}; },
    on: (event, handler) => { listeners[event] = handler; },
    tools: {
      register: (tool) => { registeredTools.push(tool); },
      guard: () => {},
    },
  };
  return { ctx, settings, web, registeredTools, skills, llm, credentialsService, credentials, listeners };
}

/** 各写端点要求的动作头值（与 lib/index.js 的 requireAction 一一对应）。 */
export const ACTION_BY_PATH = {
  '/vision-config/config': 'config',
  '/vision-config/vision-models': 'vision-models',
  '/vision-config/free-channels': 'free-channels',
  '/vision-config/free-discover': 'free-discover',
  '/vision-config/free-chain/toggle': 'free-chain',
  '/vision-config/free-chain/move': 'free-chain',
  '/vision-config/free-chain/reorder': 'free-chain',
  '/vision-config/vision-models/cleanup': 'vision-models',
  '/vision-config/free-test': 'free-test',
  '/vision-config/discover-models': 'discover-models',
  '/vision-config/uninstall': 'uninstall',
};

/**
 * 调用捕获到的路由处理器。
 * @param options.omitAction - 故意不带动作头（用来验证闸门确实拦得住）
 * @param options.headers - 调用方自带请求头（bridgeFetch 走这条，验证前端真的带了动作头）
 */
export async function callRoute(handler, { method = 'GET', url = '/', body, headers, omitAction = false } = {}) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const path = String(url).split('?')[0];
  const sent = { ...(headers ?? {}) };
  const lowered = Object.fromEntries(Object.entries(sent).map(([k, v]) => [k.toLowerCase(), v]));
  if (!omitAction && method !== 'GET' && ACTION_BY_PATH[path] !== undefined
    && lowered['x-vision-config-action'] === undefined) {
    lowered['x-vision-config-action'] = ACTION_BY_PATH[path];
  }
  const req = {
    method,
    url,
    headers: lowered,
    async *[Symbol.asyncIterator]() { if (raw.length > 0) yield Buffer.from(raw); },
  };
  let status = 200;
  let payload = null;
  const res = {
    writeHead: (code) => { status = code; },
    end: (chunk) => { payload = chunk === undefined ? null : String(chunk); },
  };
  await handler(req, res);
  return { status, json: payload === null ? null : JSON.parse(payload) };
}

/** 把假 webServer 的路由表桥接成前端用的 fetch（相对 URL → 路由处理器）。 */
export function bridgeFetch(routes) {
  return async (url, options = {}) => {
    const path = String(url).split('?')[0];
    const handler = routes.get(path);
    if (handler === undefined) {
      return { ok: false, status: 404, json: async () => ({ error: `no route ${path}` }), text: async () => '' };
    }
    const body = options.body === undefined || options.body === null || options.body === ''
      ? undefined
      : (typeof options.body === 'string' ? JSON.parse(options.body) : options.body);
    // 刻意把前端自己带的头原样传过去：前端漏了动作头就会 403，测试立刻暴露
    const { status, json } = await callRoute(handler, { method: options.method ?? 'GET', url, body, headers: options.headers });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
      text: async () => (json === null ? '' : JSON.stringify(json)),
    };
  };
}

/** 起一个本地假网关（免费渠道探测/识图测试用）。 */
export async function startFakeGateway(handler) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const entry = { url: req.url, method: req.method, headers: req.headers, body: raw };
      seen.push(entry);
      handler(entry, res);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    seen,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
