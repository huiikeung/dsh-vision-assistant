// dsh-vision-assistant — 免费链路单测（node --test，无第三方依赖）
//
// 覆盖：key 不进模型条目、ref 解析（凭据/环境变量）、逗号多 key 轮换、
//       失败分类与降级顺序、pinned 模型、免 Key 渠道、/models 探测、请求体形状。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  CHAIN_MODEL_ID,
  FREE_PRESETS,
  FREE_PROVIDER_ID,
  callChannelModel,
  callFreeChain,
  chainOf,
  chatEndpoint,
  derivedKeyRef,
  discoverModels,
  keyRefCandidates,
  keyRefOf,
  modelsEndpoint,
  normalizeChannel,
  parsePinnedModel,
  parseResponseText,
  pinnedModelId,
  resolveChannelKeys,
  seedChannels,
  splitKeys,
} from '../lib/core-free.js';

const OVH = FREE_PRESETS.find((p) => p.id === 'ovh');

function channel(overrides = {}) {
  return normalizeChannel({
    id: 'test', name: 'Test', baseUrl: 'http://127.0.0.1:1/v1',
    requestFormat: 'openai-completions', models: ['m1'], enabled: true, ...overrides,
  });
}

/** 起一个临时网关：routes = [{ match, status, body, headers }]，记录收到的请求。 */
async function withGateway(handler) {
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
  const port = server.address().port;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    seen,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('模型条目只引用渠道，绝不携带密钥字段', () => {
  const c = normalizeChannel({
    id: 'acme', name: 'Acme', baseUrl: 'https://x/v1', requestFormat: 'openai-completions',
    models: ['vm-1'], enabled: true, apiKey: 'sk-should-not-persist', keys: ['sk1', 'sk2'],
  });
  assert.equal(c.id, 'acme');
  assert.deepEqual(c.models, ['vm-1']);
  assert.equal('apiKey' in c, false);
  assert.equal('keys' in c, false);
  assert.equal(keyRefOf(c), 'ACME_API_KEY');
  assert.equal(derivedKeyRef('acme'), 'ACME_API_KEY');
  assert.equal(derivedKeyRef('openrouter-free'), 'OPENROUTER_FREE_API_KEY');
});

test('keyRefCandidates 去重且优先显式 ref', () => {
  const c = normalizeChannel({ id: 'zhipu', keyRef: 'ZHIPU_KEY_ALT', models: ['glm-4.6v-flash'] });
  assert.deepEqual(keyRefCandidates(c), ['ZHIPU_KEY_ALT', 'ZHIPU_API_KEY']);
  const d = normalizeChannel({ id: 'ovh' });
  assert.deepEqual(keyRefCandidates(d), ['OVH_API_KEY']);
});

test('一个 ref 里的逗号/换行多 key 会被拆开', () => {
  assert.deepEqual(splitKeys('a,b , c'), ['a', 'b', 'c']);
  assert.deepEqual(splitKeys('a\nb;c'), ['a', 'b', 'c']);
  assert.deepEqual(splitKeys(''), []);
  assert.deepEqual(splitKeys(undefined), []);
});

test('resolveChannelKeys：凭据服务优先，其次环境变量，都没有则返回空', async () => {
  const c = normalizeChannel({ id: 'acme', models: ['m'] });
  const fromCreds = await resolveChannelKeys(c, { resolve: async (ref) => (ref === 'ACME_API_KEY' ? { value: 'k1,k2', source: 'file' } : undefined) });
  assert.deepEqual(fromCreds, { keys: ['k1', 'k2'], ref: 'ACME_API_KEY', source: 'file' });

  const fromEnv = await resolveChannelKeys(c, { resolve: async () => undefined, env: { ACME_API_KEY: 'e1' } });
  assert.deepEqual(fromEnv, { keys: ['e1'], ref: 'ACME_API_KEY', source: 'env' });

  const none = await resolveChannelKeys(c, { resolve: async () => { throw new Error('credentials down'); }, env: {} });
  assert.deepEqual(none.keys, []);
  assert.equal(none.source, 'none');
});

test('seedChannels：内置预设保留，用户覆盖生效，自建渠道保留，密钥字段被丢弃', () => {
  const seeded = seedChannels([
    { id: 'zhipu', enabled: true, models: ['glm-4.6v-flash'], apiKey: 'sk-leak' },
    { id: 'my-gateway', name: 'My', baseUrl: 'https://mine/v1', models: ['v1'], enabled: true, keyRef: 'MINE_API_KEY' },
  ]);
  const ids = seeded.map((c) => c.id);
  for (const p of FREE_PRESETS) assert.ok(ids.includes(p.id), `${p.id} 应在内置清单里`);
  const zhipu = seeded.find((c) => c.id === 'zhipu');
  assert.equal(zhipu.enabled, true);
  assert.equal(zhipu.builtin, true);
  assert.deepEqual(zhipu.models, ['glm-4.6v-flash']);
  assert.equal('apiKey' in zhipu, false);
  const mine = seeded.find((c) => c.id === 'my-gateway');
  assert.equal(mine.builtin, false);
  assert.equal(mine.keyRef, 'MINE_API_KEY');
});

test('chainOf：只取启用渠道，按渠道/模型顺序展开，免 Key 兜底可控', () => {
  const a = channel({ id: 'a', models: ['a1', 'a2'], enabled: true });
  const b = channel({ id: 'b', models: ['b1'], enabled: false });
  const k = channel({ id: 'ovh', models: ['ovh1'], enabled: false, keyless: true });
  const chain = chainOf([a, b, k], { includeKeylessFallback: true });
  assert.deepEqual(chain.map((l) => `${l.channel.id}/${l.model}`), ['a/a1', 'a/a2', 'ovh/ovh1']);
  assert.deepEqual(chainOf([a, k], { includeKeylessFallback: false }).map((l) => `${l.channel.id}/${l.model}`), ['a/a1', 'a/a2']);
  const pinned = chainOf([a, b], { pinned: { channelId: 'b', model: 'b1' } });
  assert.deepEqual(pinned.map((l) => `${l.channel.id}/${l.model}`), ['b/b1']);
});

test('pinned 模型 id 往返解析', () => {
  const id = pinnedModelId('openrouter-free', 'google/gemma-4-31b-it:free');
  assert.equal(id, 'ch:openrouter-free:google/gemma-4-31b-it:free');
  assert.deepEqual(parsePinnedModel(id), { channelId: 'openrouter-free', model: 'google/gemma-4-31b-it:free' });
  assert.equal(parsePinnedModel('chain'), null);
  assert.equal(FREE_PROVIDER_ID, 'vision-free');
  assert.equal(CHAIN_MODEL_ID, 'chain');
});

test('端点拼接：openai / anthropic 与 /models', () => {
  assert.equal(chatEndpoint(channel({ baseUrl: 'https://x/v1/' })), 'https://x/v1/chat/completions');
  assert.equal(chatEndpoint(channel({ baseUrl: 'https://x', requestFormat: 'anthropic' })), 'https://x/v1/messages');
  assert.equal(chatEndpoint(channel({ baseUrl: 'https://x/v1', requestFormat: 'anthropic' })), 'https://x/v1/messages');
  assert.equal(modelsEndpoint(channel({ baseUrl: 'https://x/v1/' })), 'https://x/v1/models');
});

test('三种协议的响应解析', () => {
  assert.equal(parseResponseText('openai-completions', { choices: [{ message: { content: 'hello' } }] }), 'hello');
  assert.equal(parseResponseText('openai-completions', { choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }] }), 'ab');
  assert.equal(parseResponseText('openai-responses', { output_text: 'resp' }), 'resp');
  assert.equal(parseResponseText('openai-responses', { output: [{ content: [{ type: 'output_text', text: 'x' }] }] }), 'x');
  assert.equal(parseResponseText('anthropic', { content: [{ type: 'text', text: 'p' }, { type: 'tool_use' }] }), 'p');
  assert.equal(parseResponseText('openai-completions', {}), '');
});

test('openai 兼容渠道：请求体带图、密钥走 Authorization，文本回传', async () => {
  const gw = await withGateway((entry, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '图里有猫' } }] }));
  });
  try {
    const c = normalizeChannel({ id: 'gw', baseUrl: gw.baseUrl, models: ['vm'], enabled: true });
    const out = await callChannelModel({
      channel: c, model: 'vm', keys: ['sk-1'], systemPrompt: 'SYS', question: '这是什么？',
      mediaType: 'image/png', base64: 'QUJD',
    });
    assert.equal(out.text, '图里有猫');
    assert.equal(out.keyIndex, 0);
    const sent = gw.seen[0];
    assert.equal(sent.headers.authorization, 'Bearer sk-1');
    const body = JSON.parse(sent.body);
    assert.equal(body.model, 'vm');
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.messages[1].content[1].image_url.url, 'data:image/png;base64,QUJD');
  } finally { await gw.close(); }
});

test('anthropic 协议：x-api-key + image.source.base64，无 Authorization', async () => {
  const gw = await withGateway((entry, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text: 'OCR 结果' }] }));
  });
  try {
    const c = normalizeChannel({ id: 'gw', baseUrl: gw.baseUrl, requestFormat: 'anthropic', models: ['vm'] });
    const out = await callChannelModel({ channel: c, model: 'vm', keys: ['ak'], systemPrompt: 'S', mediaType: 'image/jpeg', base64: 'QUJD' });
    assert.equal(out.text, 'OCR 结果');
    const sent = gw.seen[0];
    assert.equal(sent.headers['x-api-key'], 'ak');
    assert.equal(sent.headers.authorization, undefined);
    assert.equal(sent.headers['anthropic-version'], '2023-06-01');
    const body = JSON.parse(sent.body);
    assert.equal(body.messages[0].content[1].source.data, 'QUJD');
    assert.equal(body.system, 'S');
  } finally { await gw.close(); }
});

test('openai-responses 协议：input_image + instructions', async () => {
  const gw = await withGateway((entry, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ output_text: 'done' }));
  });
  try {
    const c = normalizeChannel({ id: 'gw', baseUrl: gw.baseUrl, requestFormat: 'openai-responses', models: ['vm'] });
    const out = await callChannelModel({ channel: c, model: 'vm', keys: ['k'], systemPrompt: 'S', mediaType: 'image/png', base64: 'QUJD' });
    assert.equal(out.text, 'done');
    const body = JSON.parse(gw.seen[0].body);
    assert.equal(body.instructions, 'S');
    assert.equal(body.input[0].content[1].type, 'input_image');
  } finally { await gw.close(); }
});

test('401 时在同一渠道内轮换下一把 key', async () => {
  let attempts = 0;
  const gw = await withGateway((entry, res) => {
    attempts += 1;
    if (entry.headers.authorization === 'Bearer bad') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok-2nd-key' } }] }));
  });
  try {
    const c = normalizeChannel({ id: 'gw', baseUrl: gw.baseUrl, models: ['vm'] });
    const out = await callChannelModel({ channel: c, model: 'vm', keys: ['bad', 'good'], mediaType: 'image/png', base64: 'QQ==' });
    assert.equal(out.text, 'ok-2nd-key');
    assert.equal(out.keyIndex, 1);
    assert.equal(attempts, 2);
  } finally { await gw.close(); }
});

test('429 限流也会换 key；402 额度错误同样轮换', async () => {
  for (const status of [429, 402]) {
    let attempts = 0;
    const gw = await withGateway((entry, res) => {
      attempts += 1;
      if (attempts === 1) { res.writeHead(status, { 'content-type': 'application/json' }); res.end('{"error":"rate"}'); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    });
    try {
      const c = normalizeChannel({ id: 'gw', baseUrl: gw.baseUrl, models: ['vm'] });
      const out = await callChannelModel({ channel: c, model: 'vm', keys: ['k1', 'k2'], mediaType: 'image/png', base64: 'QQ==' });
      assert.equal(out.text, 'ok');
      assert.equal(attempts, 2);
    } finally { await gw.close(); }
  }
});

test('5xx 不浪费剩余 key（直接交给上层降级）', async () => {
  let attempts = 0;
  const gw = await withGateway((entry, res) => {
    attempts += 1;
    res.writeHead(503);
    res.end('overloaded');
  });
  try {
    const c = normalizeChannel({ id: 'gw', baseUrl: gw.baseUrl, models: ['vm'] });
    await assert.rejects(
      () => callChannelModel({ channel: c, model: 'vm', keys: ['k1', 'k2'], mediaType: 'image/png', base64: 'QQ==' }),
      (error) => error.kind === 'server' && error.status === 503,
    );
    assert.equal(attempts, 1);
  } finally { await gw.close(); }
});

test('无密钥的自建渠道报 auth，免 Key 渠道用空 key 也能调', async () => {
  const c = normalizeChannel({ id: 'gw', baseUrl: 'http://127.0.0.1:1/v1', models: ['vm'] });
  await assert.rejects(
    () => callChannelModel({ channel: c, model: 'vm', keys: [], mediaType: 'image/png', base64: 'QQ==' }),
    (error) => error.kind === 'auth',
  );
  assert.equal(chatEndpoint(c).endsWith('/chat/completions'), true);
});

test('免费链路：第一个渠道 5xx → 第二个渠道成功，并记录 attempts', async () => {
  const failing = await withGateway((entry, res) => { res.writeHead(500); res.end('boom'); });
  const good = await withGateway((entry, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '第二渠道答案' } }] }));
  });
  try {
    const channels = [
      normalizeChannel({ id: 'dead', name: 'Dead', baseUrl: failing.baseUrl, models: ['d1'], enabled: true }),
      normalizeChannel({ id: 'good', name: 'Good', baseUrl: good.baseUrl, models: ['g1'], enabled: true }),
    ];
    const resolveKeys = async (ref) => ({ value: ref === 'DEAD_API_KEY' ? 'k' : 'k', source: 'file' });
    const out = await callFreeChain({
      channels, resolveKeys, systemPrompt: 'S', mediaType: 'image/png', base64: 'QQ==',
    });
    assert.equal(out.text, '第二渠道答案');
    assert.equal(out.channelId, 'good');
    assert.equal(out.attempts.length, 2);
    assert.deepEqual(out.attempts.map((a) => a.ok), [false, true]);
    assert.equal(out.attempts[0].kind, 'server');
  } finally { await failing.close(); await good.close(); }
});

test('免费链路：免 Key 渠道无需解析密钥即可兜底', async () => {
  const gw = await withGateway((entry, res) => {
    assert.equal(entry.headers.authorization, undefined);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'OVH 兜底' } }] }));
  });
  try {
    const channels = [normalizeChannel({ id: 'ovh', name: OVH.name, baseUrl: gw.baseUrl, models: ['m'], enabled: false, keyless: true })];
    const out = await callFreeChain({
      channels, resolveKeys: async () => undefined, systemPrompt: 'S', mediaType: 'image/png', base64: 'QQ==',
    });
    assert.equal(out.text, 'OVH 兜底');
    assert.equal(out.attempts[0].keyRef, '');
    assert.equal(out.attempts[0].keySource, 'none');
  } finally { await gw.close(); }
});

test('免费链路：全部失败时抛出汇总错误并附 attempts', async () => {
  const gw = await withGateway((entry, res) => { res.writeHead(429); res.end('slow down'); });
  try {
    const channels = [normalizeChannel({ id: 'a', baseUrl: gw.baseUrl, models: ['m1', 'm2'], enabled: true })];
    await assert.rejects(
      () => callFreeChain({
        channels, resolveKeys: async () => ({ value: 'k1,k2', source: 'file' }),
        systemPrompt: 'S', mediaType: 'image/png', base64: 'QQ==',
      }),
      (error) => {
        assert.equal(error.kind, 'rate');
        assert.equal(error.attempts.length, 2);
        assert.match(error.message, /免费视觉链路全部失败/);
        return true;
      },
    );
  } finally { await gw.close(); }
});

test('免费链路：pinned 只走指定渠道模型；空渠道给出可操作提示', async () => {
  const gw = await withGateway((entry, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'pinned' } }] }));
  });
  try {
    const channels = [
      normalizeChannel({ id: 'a', baseUrl: 'http://127.0.0.1:1/v1', models: ['a1'], enabled: false }),
      normalizeChannel({ id: 'b', baseUrl: gw.baseUrl, models: ['b1', 'b2'], enabled: false }),
    ];
    const out = await callFreeChain({
      channels, pinned: { channelId: 'b', model: 'b2' }, resolveKeys: async () => ({ value: 'k', source: 'file' }),
      systemPrompt: 'S', mediaType: 'image/png', base64: 'QQ==',
    });
    assert.equal(out.text, 'pinned');
    assert.equal(out.model, 'b2');
    assert.equal(gw.seen.length, 1);
  } finally { await gw.close(); }
  await assert.rejects(
    () => callFreeChain({ channels: [], resolveKeys: async () => undefined, mediaType: 'image/png', base64: 'QQ==' }),
    (error) => error.kind === 'config',
  );
});

test('discoverModels：识别声明了 image 的模型并标记 free', async () => {
  const gw = await withGateway((entry, res) => {
    assert.equal(entry.url, '/v1/models');
    assert.equal(entry.headers.authorization, 'Bearer sk');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      data: [
        { id: 'text-only', architecture: { input_modalities: ['text'] } },
        { id: 'vision-free:free', architecture: { input_modalities: ['text', 'image'] }, pricing: { prompt: '0' } },
        { id: 'unknown-modality' },
      ],
    }));
  });
  try {
    const c = normalizeChannel({ id: 'gw', baseUrl: gw.baseUrl, models: [] });
    const list = await discoverModels({ channel: c, keys: ['sk'] });
    assert.deepEqual(list.map((m) => m.id), ['text-only', 'unknown-modality', 'vision-free:free']);
    assert.equal(list.find((m) => m.id === 'vision-free:free').vision, true);
    assert.equal(list.find((m) => m.id === 'text-only').vision, false);
    assert.equal(list.find((m) => m.id === 'unknown-modality').vision, null);
    assert.equal(list.find((m) => m.id === 'vision-free:free').free, true);
  } finally { await gw.close(); }
});

test('真实预设自带正确的渠道基本盘（免 Key 兜底 + 大陆直连 + 默认不抢主链）', () => {
  const ovh = FREE_PRESETS.find((p) => p.id === 'ovh');
  assert.equal(ovh.keyless, true);
  // 免 Key 渠道默认不「加入主链」：它永远排在链路最后（见 chainOf 语义）
  assert.equal(ovh.enabled, false);
  assert.equal(ovh.requestFormat, 'openai-completions');
  assert.match(ovh.baseUrl, /^https:\/\//);
  assert.ok(ovh.models.includes('Qwen2.5-VL-72B-Instruct'));
  const ovhChannel = seedChannels([]).find((c) => c.id === 'ovh');
  // 即使未启用，只要全局兜底开着，它就在链路里且位列最后（其模型逐个兜底）
  const chain = chainOf([normalizeChannel({ id: 'dashscope', models: ['qwen-vl-plus'], enabled: true }), ovhChannel]);
  assert.equal(chain[0].channel.id, 'dashscope');
  assert.equal(chain.slice(1).every((l) => l.channel.id === 'ovh'), true);
  assert.deepEqual(chain.slice(1).map((l) => l.model), [...ovhChannel.models]);
  const or = FREE_PRESETS.find((p) => p.id === 'openrouter-free');
  assert.equal(or.keyRef, 'OPENROUTER_FREE_API_KEY');
  assert.ok(or.models.every((m) => m.endsWith(':free')));
  for (const p of FREE_PRESETS) {
    const c = normalizeChannel({ id: p.id });
    assert.equal(c.baseUrl, p.baseUrl, `${p.id} baseUrl 应保留`);
    assert.equal(c.keyless, p.keyless === true);
  }
});

test('渠道地址与密钥引用名都有硬校验（非 http(s) 地址/非法 ref 一律退化）', () => {
  // baseUrl 只接受绝对 http(s)：它会被带着密钥去请求
  for (const bad of ['file:///etc/passwd', 'ftp://x/y', 'not a url', '', '  ', 'javascript:alert(1)']) {
    const c = normalizeChannel({ id: 'acme', name: 'Acme', baseUrl: bad, models: ['m'], enabled: true });
    assert.equal(c.baseUrl, '', `baseUrl=${JSON.stringify(bad)} 应被拒`);
    assert.equal(chatEndpoint(c), '', '地址非法时不产生端点');
    assert.equal(modelsEndpoint(c), '', '地址非法时不产生模型端点');
  }
  const ok = normalizeChannel({ id: 'acme', baseUrl: 'https://good.example/v1/', models: ['m'] });
  assert.equal(ok.baseUrl, 'https://good.example/v1'); // 去尾斜杠
  assert.equal(chatEndpoint(ok), 'https://good.example/v1/chat/completions');
  // 内置预设（https）不受影响
  assert.equal(normalizeChannel({ id: 'zhipu' }).baseUrl, 'https://open.bigmodel.cn/api/paas/v4');

  // keyRef 语法：非法引用名退回派生名，避免把任意字符串当 ref 交给凭据服务
  const weird = normalizeChannel({ id: 'acme', keyRef: '../../etc/passwd', models: ['m'] });
  assert.equal(weird.keyRef, '');
  assert.equal(keyRefOf(weird), 'ACME_API_KEY');
  const weird2 = normalizeChannel({ id: 'acme', keyRef: 'ok_REF_2', models: ['m'] });
  assert.equal(keyRefOf(weird2), 'ok_REF_2');
  const weird3 = normalizeChannel({ id: 'acme', keyRef: 'has space', models: ['m'] });
  assert.equal(keyRefOf(weird3), 'ACME_API_KEY');
});

test('免费链路：同一渠道多个模型只解析一次密钥', async () => {
  let resolves = 0;
  const gw = await withGateway((entry, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  });
  try {
    const channels = [normalizeChannel({ id: 'multi', baseUrl: gw.baseUrl, keyRef: 'MULTI_API_KEY', models: ['m1', 'm2', 'm3'], enabled: true })];
    const out = await callFreeChain({
      channels,
      resolveKeys: async () => { resolves += 1; return { value: 'k', source: 'file' }; },
      systemPrompt: 'S', mediaType: 'image/png', base64: 'QQ==',
    });
    assert.equal(out.text, 'ok');
    assert.equal(resolves, 1, '一个渠道的三个模型只应解析一次密钥');
  } finally { await gw.close(); }
});
