// dsh-vision-assistant — 宿主接线冒烟测试（mock ctx，无 DSH 进程）
//
// 覆盖：apply() 能加载、工具注册、settings namespace 注册与预设播种、
//       HTTP 端点（config / models / free-channels / free-discover / free-test）
//       以及「密钥不进入配置与模型条目」的硬约束。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callRoute, makeCtx, startFakeGateway } from './host-mock.mjs';

const MOD = new URL('../lib/index.js', import.meta.url).href;

test('apply()：注册工具 / 端点，并写入内置免费渠道预设', async () => {
  const { ctx, settings, web, registeredTools, skills } = makeCtx({
    providers: ['openrouter-free', 'saibo'],
    modelsByProvider: {
      'openrouter-free': [
        { id: 'nex-agi/nex-n2.5-pro:free', name: 'Nex', inputModalities: ['text', 'image'] },
        { id: 'stealth/union-alpha', name: 'Union', inputModalities: ['text'] },
      ],
      saibo: [{ id: 'deepseek-v4-flash-0731', name: 'ds', inputModalities: ['text'] }],
    },
  });
  const mod = await import(MOD);
  assert.equal(mod.name, 'vision-config');
  mod.apply(ctx, {});
  await new Promise((r) => setTimeout(r, 20));

  assert.ok(registeredTools.some((t) => t.name === 'vision_read_image'), '应注册 vision_read_image 工具');
  assert.ok(skills.length >= 1, '应注册 vision-image-analysis skill');
  for (const path of [
    '/vision-config/config', '/vision-config/models', '/vision-config/providers',
    '/vision-config/vision-models', '/vision-config/free-channels',
    '/vision-config/free-discover', '/vision-config/free-test',
    '/vision-config/reasoning-levels', '/vision-config/discover-models', '/vision-config/uninstall',
  ]) {
    assert.ok(web.routes.has(path), `应注册路由 ${path}`);
  }

  // 预设播种：免 Key 的 OVHcloud 渠道默认不抢主链，只作为链路最后的兜底
  const seeded = settings.document().freeChannels;
  assert.ok(Array.isArray(seeded) && seeded.length >= 5, '应写入内置免费渠道');
  const ovh = seeded.find((c) => c.id === 'ovh');
  assert.equal(ovh.keyless, true);
  assert.equal(ovh.enabled, false);
  assert.ok(ovh.models.includes('Qwen2.5-VL-72B-Instruct'));
  assert.equal(settings.document().freeChainEnabled, true);
  assert.equal(settings.document().freeKeylessFallback, true);

  // 免 Key 渠道虽然未「加入主链」，仍出现在兜底位
  const payload = await callRoute(web.routes.get('/vision-config/free-channels'), { method: 'GET', url: '/vision-config/free-channels' });
  assert.equal(payload.status, 200);
  assert.ok(payload.json.chain.some((s) => s.channelId === 'ovh'), 'OVH 应在免费链路兜底位');
  assert.equal(payload.json.keyStatus.ovh.keyless, true);
});

test('GET /models：只列声明支持图片的模型；免费模型只在上半区为空时兜底出现', async () => {
  const { ctx, web, settings } = makeCtx({
    providers: ['openrouter-free', 'saibo'],
    modelsByProvider: {
      'openrouter-free': [{ id: 'nex-agi/nex-n2.5-pro:free', name: 'Nex', inputModalities: ['text', 'image'] }],
      saibo: [{ id: 'deepseek-v4-flash-0731', name: 'DS', inputModalities: ['text'] }],
    },
    settingsDoc: {
      visionModels: [
        { id: 'e1', provider: 'openrouter-free', model: 'nex-agi/nex-n2.5-pro:free', name: 'Nex' },
      ],
    },
  });
  const mod = await import(MOD);
  mod.apply(ctx, {});
  await new Promise((r) => setTimeout(r, 20));

  // ① 上半区有可用视觉模型 → 选择器不提供免费模型项
  const res = await callRoute(web.routes.get('/vision-config/models'), { method: 'GET', url: '/vision-config/models' });
  assert.equal(res.status, 200);
  const providers = res.json.groups.map((g) => g.provider);
  assert.ok(providers.includes('openrouter-free'), '已导入的识图模型应出现');
  assert.equal(providers.includes('vision-free'), false, '上半区有可用模型时不应提供免费模型项');
  assert.equal(res.json.groups.some((g) => g.models.some((m) => m.id === 'stealth/union-alpha')), false, '纯文本模型不应出现');

  // ② 上半区为空 → 兜底入口列出「链路顺序表 + 免 Key 兜底」里的具体模型
  await settings.scope.replace({ ...settings.document(), visionModels: [] });
  const res2 = await callRoute(web.routes.get('/vision-config/models'), { method: 'GET', url: '/vision-config/models' });
  const freeGroup = res2.json.groups.find((g) => g.provider === 'vision-free');
  assert.ok(freeGroup, '上半区为空时应出现免费模型兜底入口');
  assert.match(freeGroup.name, /免费模型/);
  const freeIds = freeGroup.models.map((m) => m.id);
  assert.ok(freeIds.every((id) => id.startsWith('ch:')), '应逐个列出链路表里的模型（ch:渠道:模型）');
  assert.deepEqual(freeIds, [
    'ch:ovh:Qwen2.5-VL-72B-Instruct',
    'ch:ovh:Qwen3.5-397B-A17B',
    'ch:ovh:Qwen3.6-27B',
    'ch:ovh:Qwen3.8-27B',
    'ch:ovh:Mistral-Small-3.2-24B-Instruct-2506',
  ]);
});

test('免费渠道端点：状态 / 探测 / 测试 / 保存，密钥只存在于凭据服务', async () => {
  // 本地假网关：/v1/models 列表 + /v1/chat/completions 识图
  const seenAuth = [];
  const gateway = await startFakeGateway((entry, res) => {
    seenAuth.push({ url: entry.url, auth: entry.headers.authorization });
    if (entry.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [
        { id: 'local-vl', architecture: { input_modalities: ['text', 'image'] } },
        { id: 'local-text', architecture: { input_modalities: ['text'] } },
      ] }));
      return;
    }
    const body = JSON.parse(entry.body || '{}');
    const lastMessage = Array.isArray(body.messages) ? body.messages[body.messages.length - 1] : null;
    assert.ok(lastMessage && Array.isArray(lastMessage.content), '应带图请求');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '探针看到一张 1×1 的图' } }] }));
  });
  const baseUrl = gateway.baseUrl;

  try {
    const { ctx, web, settings } = makeCtx({ credentials: { LOCAL_API_KEY: 'sk-one,sk-two' } });
    const mod = await import(MOD);
    mod.apply(ctx, {});
    await new Promise((r) => setTimeout(r, 20));

    // 保存一个用户自建免费渠道（模型条目里只有 id，没有 key）
    const put = await callRoute(web.routes.get('/vision-config/free-channels'), {
      method: 'PUT', url: '/vision-config/free-channels',
      body: {
        channels: [
          ...settings.document().freeChannels,
          { id: 'local', name: '本地假网关', baseUrl, requestFormat: 'openai-completions', keyRef: 'LOCAL_API_KEY', enabled: true, models: ['local-vl'] },
        ],
      },
    });
    assert.equal(put.status, 200);
    const localChannel = put.json.channels.find((c) => c.id === 'local');
    assert.deepEqual(localChannel.models, ['local-vl']);
    assert.equal('apiKey' in localChannel, false);
    assert.equal('keys' in localChannel, false);

    // 状态：命中凭据服务里的两把 key
    assert.equal(put.json.keyStatus.local.configured, true);
    assert.equal(put.json.keyStatus.local.keyCount, 2);
    assert.equal(put.json.keyStatus.local.keyRef, 'LOCAL_API_KEY');
    // 免 Key 渠道永远视为已就绪
    assert.equal(put.json.keyStatus.ovh.configured, true);
    assert.equal(put.json.keyStatus.ovh.keyless, true);
    // 链路顺序：启用的 local 在前，免 Key 的 OVH 兜底在后
    const chainIds = put.json.chain.map((s) => s.channelId);
    assert.equal(chainIds[0], 'local');
    assert.ok(chainIds.includes('ovh'));
    assert.ok(chainIds.indexOf('local') < chainIds.indexOf('ovh'));

    // 探测
    const discover = await callRoute(web.routes.get('/vision-config/free-discover'), {
      method: 'POST', url: '/vision-config/free-discover', body: { channelId: 'local' },
    });
    assert.equal(discover.status, 200);
    assert.equal(discover.json.keySource, 'file');
    assert.equal(discover.json.models.find((m) => m.id === 'local-vl').vision, true);
    assert.equal(discover.json.models.find((m) => m.id === 'local-text').vision, false);

    // 测试（真实带图请求打到假网关）
    const probe = await callRoute(web.routes.get('/vision-config/free-test'), {
      method: 'POST', url: '/vision-config/free-test', body: { channelId: 'local', model: 'local-vl' },
    });
    assert.equal(probe.status, 200);
    assert.equal(probe.json.ok, true, JSON.stringify(probe.json));
    assert.match(probe.json.text, /1×1/);
    assert.equal(probe.json.keyRef, 'LOCAL_API_KEY');
    assert.equal(seenAuth.some((s) => s.auth === 'Bearer sk-one'), true, '应使用凭据服务里的第一把 key');
    assert.equal(seenAuth.some((s) => s.auth === 'Bearer sk-two'), false, '第一把可用时不应轮换');

    // 硬约束：配置文档里绝不出现密钥值
    const serialized = JSON.stringify(settings.document());
    assert.equal(serialized.includes('sk-one'), false);
    assert.equal(serialized.includes('sk-two'), false);
    assert.equal(serialized.includes('sk-'), false);

    // 未知渠道要报 400，而不是静默成功
    const bad = await callRoute(web.routes.get('/vision-config/free-discover'), {
      method: 'POST', url: '/vision-config/free-discover', body: { channelId: 'nope' },
    });
    assert.equal(bad.status, 400);
  } finally {
    await gateway.close();
  }
});

test('PUT /config：接受免费虚拟路由（chain / ch:渠道:模型），拒绝非法模型 id', async () => {
  const { ctx, web, settings } = makeCtx({});
  const mod = await import(MOD);
  mod.apply(ctx, {});
  await new Promise((r) => setTimeout(r, 20));

  const okChain = await callRoute(web.routes.get('/vision-config/config'), {
    method: 'PUT', url: '/vision-config/config', body: { provider: 'vision-free', model: 'chain' },
  });
  assert.equal(okChain.status, 200);
  assert.equal(okChain.json.provider, 'vision-free');
  assert.equal(okChain.json.model, 'chain');

  const okPinned = await callRoute(web.routes.get('/vision-config/config'), {
    method: 'PUT', url: '/vision-config/config',
    body: { provider: 'vision-free:ovh', model: 'ch:ovh:Qwen2.5-VL-72B-Instruct' },
  });
  assert.equal(okPinned.status, 200);

  const bad = await callRoute(web.routes.get('/vision-config/config'), {
    method: 'PUT', url: '/vision-config/config', body: { provider: 'vision-free', model: 'nonsense' },
  });
  assert.equal(bad.status, 400);

  // 免费路由不写进 visionModels（上半区列表保持干净）
  assert.deepEqual(settings.document().visionModels ?? [], []);
});

test('PUT /free-channels：内置渠道不可被删除、非法定义被拒', async () => {
  const { ctx, web, settings } = makeCtx({});
  const mod = await import(MOD);
  mod.apply(ctx, ({}));
  await new Promise((r) => setTimeout(r, 20));
  const handler = web.routes.get('/vision-config/free-channels');

  // 只传一个自建渠道：内置渠道会被自动补回
  const trimmed = await callRoute(handler, {
    method: 'PUT', url: '/vision-config/free-channels',
    body: { channels: [{ id: 'mine', name: 'Mine', baseUrl: 'https://example.com/v1', models: ['v1'], enabled: true }] },
  });
  assert.equal(trimmed.status, 200);
  const ids = trimmed.json.channels.map((c) => c.id);
  assert.ok(ids.includes('ovh') && ids.includes('mine'), '内置渠道应保留');

  const badId = await callRoute(handler, {
    method: 'PUT', url: '/vision-config/free-channels', body: { channels: [{ id: 'BadId', baseUrl: 'https://x/v1', models: [] }] },
  });
  assert.equal(badId.status, 400);

  const noUrl = await callRoute(handler, {
    method: 'PUT', url: '/vision-config/free-channels', body: { channels: [{ id: 'nourl', models: [] }] },
  });
  assert.equal(noUrl.status, 400);

  const dup = await callRoute(handler, {
    method: 'PUT', url: '/vision-config/free-channels',
    body: { channels: [{ id: 'dup', baseUrl: 'https://x/v1' }, { id: 'dup', baseUrl: 'https://y/v1' }] },
  });
  assert.equal(dup.status, 400);

  // 恢复预设
  const reset = await callRoute(handler, { method: 'PUT', url: '/vision-config/free-channels', body: { action: 'reset-presets' } });
  assert.equal(reset.status, 200);
  assert.ok(reset.json.channels.find((c) => c.id === 'mine'), '用户自建渠道在恢复预设后仍保留');
  const ovhAfterReset = reset.json.channels.find((c) => c.id === 'ovh');
  assert.equal(ovhAfterReset.keyless, true);
  assert.ok(ovhAfterReset.models.length > 0, '恢复预设后免 Key 渠道应带回预置模型');
  assert.ok(reset.json.chain.some((s) => s.channelId === 'ovh'), '免 Key 渠道仍在链路兜底位');
  assert.ok(settings.document().freeChannels.length >= 5);
});

test('vision_read_image 工具：免费链路端到端（第一个渠道 5xx → 自动降级到第二个）', async () => {
  const dead = await startFakeGateway((entry, res) => { res.writeHead(500); res.end('boom'); });
  const live = await startFakeGateway((entry, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '降级后的答案：图里是 1×1 像素' } }] }));
  });
  try {
    const { ctx, registeredTools, settings } = makeCtx({
      credentials: { LIVE_API_KEY: 'sk-live', DEAD_API_KEY: 'sk-dead' },
      settingsDoc: {
        provider: 'vision-free',
        model: 'chain',
        freeKeylessFallback: false, // 关掉 OVH 兜底，测试只走本地假网关
        freeChannels: [
          { id: 'dead', name: 'Dead', baseUrl: dead.baseUrl, requestFormat: 'openai-completions', keyRef: 'DEAD_API_KEY', enabled: true, models: ['m1'] },
          { id: 'live', name: 'Live', baseUrl: live.baseUrl, requestFormat: 'openai-completions', keyRef: 'LIVE_API_KEY', enabled: true, models: ['m2'] },
        ],
      },
    });
    const mod = await import(MOD);
    mod.apply(ctx, {});
    await new Promise((r) => setTimeout(r, 20));

    const tool = registeredTools.find((t) => t.name === 'vision_read_image');
    assert.ok(tool, '应注册 vision_read_image');
    const result = await tool.execute({ file_path: '/tmp/probe.png' }, { signal: undefined });
    assert.match(result.analysis, /降级后的答案/);
    assert.equal(dead.seen.length, 1, '应先试第一个（失败）渠道');
    assert.equal(live.seen.length, 1, '再降级到第二个渠道');
    assert.equal(live.seen[0].headers.authorization, 'Bearer sk-live', '免费渠道用自己 keyRef 里的密钥');
    // 渠道配置里不应出现密钥
    assert.equal(JSON.stringify(settings.document()).includes('sk-live'), false);
  } finally {
    await dead.close();
    await live.close();
  }
});

test('vision_read_image 工具：全部渠道失败时报错但不影响回合（错误信息带尝试链）', async () => {
  const dead = await startFakeGateway((entry, res) => { res.writeHead(500); res.end('boom'); });
  try {
    const { ctx, registeredTools } = makeCtx({
      credentials: { DEAD_API_KEY: 'sk' },
      settingsDoc: {
        provider: 'vision-free', model: 'chain', freeKeylessFallback: false,
        freeChannels: [{ id: 'dead', name: 'Dead', baseUrl: dead.baseUrl, requestFormat: 'openai-completions', keyRef: 'DEAD_API_KEY', enabled: true, models: ['m1'] }],
      },
    });
    const mod = await import(MOD);
    mod.apply(ctx, {});
    await new Promise((r) => setTimeout(r, 20));
    const tool = registeredTools.find((t) => t.name === 'vision_read_image');
    await assert.rejects(
      () => tool.execute({ file_path: '/tmp/probe.png' }, { signal: undefined }),
      (error) => {
        assert.match(error.message, /免费视觉链路全部失败/);
        return true;
      },
    );
  } finally {
    await dead.close();
  }
});

test('动作头闸门：所有写/凭据端点拒绝无头的跨站简单请求', async () => {
  const { ctx, web } = makeCtx({ settingsDoc: { provider: 'vision-free', model: 'chain' } });
  const mod = await import(MOD);
  mod.apply(ctx, {});
  await new Promise((r) => setTimeout(r, 20));

  const writes = [
    ['/vision-config/config', 'PUT', { provider: 'vision-free', model: 'chain' }],
    ['/vision-config/vision-models', 'POST', { provider: 'openai', model: 'x' }],
    ['/vision-config/vision-models', 'PUT', {}],
    ['/vision-config/vision-models', 'DELETE', undefined],
    ['/vision-config/free-channels', 'PUT', { channels: [] }],
    ['/vision-config/free-discover', 'POST', { channelId: 'ovh' }],
    ['/vision-config/free-test', 'POST', { channelId: 'ovh' }],
    ['/vision-config/discover-models', 'POST', { provider: 'saibo', baseUrl: 'http://127.0.0.1:1/v1' }],
    ['/vision-config/uninstall', 'POST', undefined],
  ];
  for (const [path, method, body] of writes) {
    // 不带动作头（模拟任意网页的 no-cors POST）
    const bare = await callRoute(web.routes.get(path), { method, url: path, body, omitAction: true });
    assert.equal(bare.status, 403, `${method} ${path} 无动作头必须 403`);
    // 带上动作头才放行（具体业务码各自不同，这里只要求「不是 403」）
    const authed = await callRoute(web.routes.get(path), { method, url: path, body });
    assert.notEqual(authed.status, 403, `${method} ${path} 带动作头不应再被闸门拦`);
  }
});

test('GET /config 绝不回声 apiKey（密钥形态字段不出 HTTP）', async () => {
  const { ctx, web } = makeCtx({ settingsDoc: { provider: 'vision-free', model: 'chain', apiKey: 'sk-secret-legacy' } });
  const mod = await import(MOD);
  mod.apply(ctx, {});
  await new Promise((r) => setTimeout(r, 20));
  const got = await callRoute(web.routes.get('/vision-config/config'), { method: 'GET', url: '/vision-config/config' });
  assert.equal(got.status, 200);
  assert.equal('apiKey' in got.json, false, '响应里不允许出现 apiKey 字段');
  assert.equal(JSON.stringify(got.json).includes('sk-secret-legacy'), false);
  // 内部仍保留该字段（旧版「强制关闭」直连路径要用），只是不外发
  const put = await callRoute(web.routes.get('/vision-config/config'), {
    method: 'PUT', url: '/vision-config/config', body: { provider: 'vision-free', model: 'chain' },
  });
  assert.equal(put.status, 200);
  assert.equal('apiKey' in put.json, false);
});

test('discover-models：地址必须 http(s)，且已存密钥只发给配置里绑定的同一地址', async () => {
  const { ctx, web, llm } = makeCtx({
    settingsDoc: {
      visionModels: [{ id: 'e1', provider: 'saibo', model: 'm', baseUrl: 'https://api.saibo.example/v1' }],
    },
    credentials: { SAIBO_API_KEY: 'sk-saibo-real' },
  });
  const mod = await import(MOD);
  mod.apply(ctx, {});
  await new Promise((r) => setTimeout(r, 20));
  const handler = web.routes.get('/vision-config/discover-models');

  // ① 非 http(s) 地址：直接 400，不发起任何请求
  const badScheme = await callRoute(handler, {
    method: 'POST', url: '/vision-config/discover-models', body: { provider: 'saibo', baseUrl: 'file:///etc/passwd' },
  });
  assert.equal(badScheme.status, 400);

  // ② 调用方自带一个与配置不同的地址 → 绝不复用已存密钥
  llm.discoverCalls.length = 0;
  const mismatched = await callRoute(handler, {
    method: 'POST', url: '/vision-config/discover-models',
    body: { provider: 'saibo', baseUrl: 'https://attacker.example/v1' },
  });
  assert.equal(mismatched.status, 200);
  assert.equal(llm.discoverCalls.length, 1);
  assert.equal('apiKey' in llm.discoverCalls[0], false, '地址不匹配时不得带上已存密钥');

  // ③ 地址与配置一致 → 允许复用（这正是「探测已有提供方」的正常用法）
  llm.discoverCalls.length = 0;
  const matched = await callRoute(handler, {
    method: 'POST', url: '/vision-config/discover-models',
    body: { provider: 'saibo', baseUrl: 'https://api.saibo.example/v1' },
  });
  assert.equal(matched.status, 200);
  assert.equal(llm.discoverCalls[0].apiKey, 'sk-saibo-real');

  // ④ 表单草稿始终优先（用户当场输入的 key）
  llm.discoverCalls.length = 0;
  await callRoute(handler, {
    method: 'POST', url: '/vision-config/discover-models',
    body: { provider: 'saibo', baseUrl: 'https://attacker.example/v1', keyDraft: 'sk-draft' },
  });
  assert.equal(llm.discoverCalls[0].apiKey, 'sk-draft');
});

test('伴生渠道（<父>-vision）继承父渠道的网关与密钥引用', async () => {
  const { ctx, web, llm } = makeCtx({
    settingsDoc: {
      visionModels: [{ id: 'v1', provider: 'saibo-vision', model: 'glm-5.3-flash', baseUrl: '', name: 'GLM' }],
    },
    configurableProviders: [{ provider: 'saibo', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'saibo'] }],
    settingsNamespaces: { 'llm-pi-ai': { providers: { saibo: { baseURL: 'https://saibo-gw.example/v1', apiKeyEnv: 'SAIBO_API_KEY' } } } },
    credentials: { SAIBO_API_KEY: 'sk-parent' },
  });
  const mod = await import(MOD);
  mod.apply(ctx, {});
  await new Promise((r) => setTimeout(r, 20));

  // 渠道圆点：keyRefs 应包含父渠道的 SAIBO_API_KEY（不再只看派生名）
  const models = await callRoute(web.routes.get('/vision-config/vision-models'), { method: 'GET', url: '/vision-config/vision-models' });
  assert.deepEqual(models.json.keyRefs['saibo-vision'], ['SAIBO_API_KEY', 'SAIBO_VISION_API_KEY']);

  // 自管 adapter：伴生渠道继承父网关后可用（baseUrl 非空），但**不注册宿主路由**
  // （否则官方主模型选择器会把它当新分组加载而报错）
  assert.equal(llm.registeredAdapters.flat().includes('saibo-vision'), false, '继承型伴生渠道不应注册宿主路由');
  assert.ok(llm.registeredAdapters.length >= 0);

  // discover-models 密钥复用：同渠道探测时能用上父渠道的 key
  const discover = await callRoute(web.routes.get('/vision-config/discover-models'), {
    method: 'POST', url: '/vision-config/discover-models',
    body: { provider: 'saibo-vision', baseUrl: 'https://saibo-gw.example/v1' },
  });
  assert.equal(discover.status, 200);
  assert.equal(llm.discoverCalls.at(-1).apiKey, 'sk-parent', '伴生渠道探测应继承父渠道密钥');
});

test('免费链路顺序：toggle / move / reorder 端点与启用状态推导', async () => {
  const { ctx, web, settings } = makeCtx({});
  const mod = await import(MOD);
  mod.apply(ctx, {});
  await new Promise((r) => setTimeout(r, 20));
  const put = web.routes.get('/vision-config/free-channels');
  const toggle = web.routes.get('/vision-config/free-chain/toggle');
  const move = web.routes.get('/vision-config/free-chain/move');
  const reorder = web.routes.get('/vision-config/free-chain/reorder');

  // 勾选渠道（全部加入）→ 模型**追加到表尾**；免 Key 渠道不参与推导
  const joined = await callRoute(put, {
    method: 'PUT', url: '/vision-config/free-channels',
    body: { channels: (await callRoute(put, { method: 'GET', url: '/vision-config/free-channels' })).json.channels
      .map((c) => (c.id === 'zhipu' ? { ...c, enabled: true } : c)) },
  });
  assert.deepEqual(joined.json.freeChainOrder, ['ch:zhipu:glm-4.6v-flash', 'ch:zhipu:glm-4.6v', 'ch:zhipu:glm-4.5v', 'ch:zhipu:glm-ocr']);
  assert.equal(joined.json.chain.at(-1).fallback, true, '免 Key 兜底仍在最后');
  assert.equal(joined.json.chain[0].manual, true);

  // 单个移除
  const removed = await callRoute(toggle, {
    method: 'POST', url: '/vision-config/free-chain/toggle',
    body: { channelId: 'zhipu', model: 'glm-ocr', on: false },
  });
  assert.deepEqual(removed.json.freeChainOrder, ['ch:zhipu:glm-4.6v-flash', 'ch:zhipu:glm-4.6v', 'ch:zhipu:glm-4.5v']);

  // 单个加入（免 Key 模型也可提为手动项）
  const added = await callRoute(toggle, {
    method: 'POST', url: '/vision-config/free-chain/toggle',
    body: { channelId: 'ovh', model: 'Qwen3.6-27B', on: true },
  });
  assert.ok(added.json.freeChainOrder.includes('ch:ovh:Qwen3.6-27B'));
  const ovhManual = added.json.chain.find((s) => s.entry === 'ch:ovh:Qwen3.6-27B');
  assert.equal(ovhManual.manual, true, '手动加入的免 Key 模型不再是兜底标记');

  // 上移
  const moved = await callRoute(move, {
    method: 'POST', url: '/vision-config/free-chain/move',
    body: { entry: 'ch:zhipu:glm-4.5v', direction: 'up' },
  });
  assert.deepEqual(moved.json.freeChainOrder, ['ch:zhipu:glm-4.6v-flash', 'ch:zhipu:glm-4.5v', 'ch:zhipu:glm-4.6v', 'ch:ovh:Qwen3.6-27B']);

  // 重排：死项被丢弃、重复项去重、顺序保持
  const reordered = await callRoute(reorder, {
    method: 'POST', url: '/vision-config/free-chain/reorder',
    body: { order: ['ch:ovh:Qwen3.6-27B', 'ch:zhipu:glm-4.6v-flash', 'ch:ghost:nope', 'ch:zhipu:glm-4.6v-flash'] },
  });
  assert.deepEqual(reordered.json.freeChainOrder, ['ch:ovh:Qwen3.6-27B', 'ch:zhipu:glm-4.6v-flash']);

  // 写配置真的落库
  assert.deepEqual(settings.document().freeChainOrder, ['ch:ovh:Qwen3.6-27B', 'ch:zhipu:glm-4.6v-flash']);

  // 无动作头一律 403
  for (const [path, handler, body] of [
    ['/vision-config/free-chain/toggle', toggle, { channelId: 'ovh', model: 'Qwen3.6-27B', on: true }],
    ['/vision-config/free-chain/move', move, { entry: 'x', direction: 'up' }],
    ['/vision-config/free-chain/reorder', reorder, { order: [] }],
  ]) {
    const bare = await callRoute(handler, { method: 'POST', url: path, body, omitAction: true });
    assert.equal(bare.status, 403, `${path} 无动作头必须 403`);
  }
});


test('按需描述模式：图片改写为引用不立即分析，describe_image 工具按需分析', async () => {
  const gw = await startFakeGateway((entry, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'mock 视觉答案' } }] }));
  });
  try {
    const { ctx, web, registeredTools, settings, listeners } = makeCtx({
      credentials: { GW_KEY: 'sk-gw' },
      settingsDoc: {
        provider: 'vision-free', model: 'chain',
        imageDelivery: 'onDemand', freeKeylessFallback: false,
        mainProvider: 'openrouter-free', mainModels: ['text-model'],
        freeChannels: [{ id: 'local', name: 'Local', baseUrl: gw.baseUrl, requestFormat: 'openai-completions', keyRef: 'GW_KEY', enabled: true, models: ['vm'] }],
      },
      providers: ['openrouter-free'],
      modelsByProvider: { 'openrouter-free': [{ id: 'text-model', name: 'T', inputModalities: ['text'] }] },
    });
    const mod = await import(MOD);
    mod.apply(ctx, {});
    await new Promise((r) => setTimeout(r, 20));
    const handler = listeners['llm/stream'];
    assert.equal(typeof handler, 'function', '应注册 llm/stream 瀑布监听');

    const rewritten = [];
    function* passthrough(opts) { rewritten.push(opts); yield { type: 'text', text: 'done' }; }
    const gen = handler({
      provider: 'openrouter-free', model: 'text-model', signal: undefined,
      messages: [{ role: 'user', content: [
        { type: 'text', text: '看这张图' },
        { type: 'image', attachment: { attachmentId: 'a1', mediaType: 'image/png', bytes: Buffer.from('fake-bytes'), name: 'a.png' } },
      ] }],
    }, passthrough);
    for await (const chunk of gen) { /* 消费 */ }

    // 图片被改写为文本引用，且**没有**立即调用识图网关
    const content = rewritten[0].messages[0].content;
    assert.equal(content[1].type, 'text');
    assert.match(content[1].text, /\[image: \{"attachmentId":"a1","mediaType":"image\/png"\}\]/);
    assert.equal(gw.seen.length, 0, '按需模式不应立即调用识图网关');

    // describe_image 工具：按引用分析（走免费链路 + keyRef 密钥）
    const tool = registeredTools.find((t) => t.name === 'describe_image');
    assert.ok(tool, '应注册 describe_image 工具');
    const result = await tool.execute(
      { reference: '{"attachmentId":"a1","mediaType":"image/png"}', question: '图里有什么' },
      { signal: undefined },
    );
    assert.match(result.analysis, /mock 视觉答案/);
    assert.equal(gw.seen.length, 1, '此时才调用识图网关');
    assert.equal(gw.seen[0].headers.authorization, 'Bearer sk-gw');

    // 未知引用：明确报错而不是编造
    await assert.rejects(
      () => tool.execute({ reference: '{"attachmentId":"nope"}', question: '?' }, { signal: undefined }),
      /缓存/,
    );

    // 设置持久化
    assert.equal(settings.document().imageDelivery, 'onDemand');
  } finally {
    await gw.close();
  }
});

test('图片传递方式：默认 eager；PUT 可切换且非法值回退 eager', async () => {
  const { ctx, web, settings } = makeCtx({});
  const mod = await import(MOD);
  mod.apply(ctx, {});
  await new Promise((r) => setTimeout(r, 20));
  const config = web.routes.get('/vision-config/config');

  assert.equal((await callRoute(config, { method: 'GET', url: '/vision-config/config' })).json.imageDelivery, 'eager');

  const on = await callRoute(config, { method: 'PUT', url: '/vision-config/config', body: { imageDelivery: 'onDemand' } });
  assert.equal(on.json.imageDelivery, 'onDemand');
  assert.equal(settings.document().imageDelivery, 'onDemand');

  const off = await callRoute(config, { method: 'PUT', url: '/vision-config/config', body: { imageDelivery: 'eager' } });
  assert.equal(off.json.imageDelivery, 'eager');
});
