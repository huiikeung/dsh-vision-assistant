#!/usr/bin/env node
// dsh-vision-assistant — 从 DSH web profile 回滚安装
//
//   node scripts/rollback-profile.mjs
//
// 安全策略（避免「回滚把安装之后的新改动一起抹掉」）：
//   · 有 *.dsh-vision-assistant.bak，且当前文件**仍然等于安装后的状态** → 整文件还原备份；
//   · 有备份，但当前文件在安装之后又被改过（别的插件、手工编辑） → 只反向摘掉本脚本写的东西，
//     并明确告诉你「没有整文件覆盖、备份保留给你手动比对」；
//   · 没有备份 → 反向摘除。
//
// settings.yaml 不自动还原（只由安装脚本留了一份 .bak 供人工查看）：
// 插件在共享的 vision-opencode namespace 里写的 freeChannels 等字段对旧插件无害
// （旧 schema 会接受并保留未知字段）。要清干净，可在卸载前调用插件自己的
// POST /vision-config/uninstall（需请求头 x-vision-config-action: uninstall）。

import { copyFileSync, existsSync, lstatSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isInstalledPackageJson,
  isInstalledPatchYml,
  PACKAGE_NAME,
  stripPackageJson,
  stripPatchYml,
} from './profile-edits.mjs';

const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE_DIR = process.env.DSH_PROFILE_DIR ?? '/vol1/@appdata/deepseek.harness/dsh-data/profiles/web';

const notes = [];
const warnings = [];

function bakOf(file) {
  return `${file}.${PACKAGE_NAME}.bak`;
}

/**
 * 还原一个文件。
 * @returns {'restored'|'stripped'|'skipped'}
 */
function restore(file, isInstalled, strip) {
  const bak = bakOf(file);
  if (!existsSync(file)) return 'skipped';
  const current = readFileSync(file, 'utf8');
  if (!existsSync(bak)) {
    const next = strip(current);
    if (next === null) return 'skipped';
    writeFileSync(file, next, 'utf8');
    notes.push(`已反向摘除 ${file} 中的安装改动（无备份可整文件还原）`);
    return 'stripped';
  }
  const pre = readFileSync(bak, 'utf8');
  if (isInstalled(current, pre)) {
    copyFileSync(bak, file);
    unlinkSync(bak);
    notes.push(`已整文件还原 ${file}（备份已消费）`);
    return 'restored';
  }
  const next = strip(current);
  if (next !== null) writeFileSync(file, next, 'utf8');
  warnings.push(`${file} 在安装之后被改过（不等于安装后状态）：只摘除了本插件的改动，未整文件覆盖；备份保留在 ${bak} 供人工比对`);
  return 'stripped';
}

const packageFile = join(PROFILE_DIR, 'package.json');
const patchFile = join(PROFILE_DIR, 'cordis.patch.yml');

const packageResult = restore(
  packageFile,
  (current, pre) => isInstalledPackageJson(current, pre, PLUGIN_DIR),
  (current) => stripPackageJson(current),
);
const patchResult = restore(
  patchFile,
  (current, pre) => isInstalledPatchYml(current, pre),
  (current) => stripPatchYml(current),
);

const linkPath = join(PROFILE_DIR, 'node_modules', PACKAGE_NAME);
try {
  const stat = lstatSync(linkPath);
  if (stat.isSymbolicLink() || stat.isFile()) {
    unlinkSync(linkPath);
    notes.push(`已删除 ${linkPath}`);
  } else if (stat.isDirectory()) {
    rmSync(linkPath, { recursive: true, force: true });
    notes.push(`已删除目录 ${linkPath}`);
  }
} catch { /* 本来就不在 */ }

console.log('== dsh-vision-assistant 回滚 ==');
if (notes.length === 0 && warnings.length === 0) console.log('  · 没有需要撤销的改动');
for (const note of notes) console.log(`  · ${note}`);
for (const warning of warnings) console.log(`  ⚠ ${warning}`);
if (packageResult === 'skipped' && patchResult === 'skipped') {
  console.log('  · package.json / cordis.patch.yml 无需改动');
}
console.log('\n下一步：重启 dsh（旧插件 dsh-vision-opencode 会重新启用）。');
console.log('它启动时会读同一份 vision-opencode 配置；插件写过的 freeChannels 等字段对它无害。');
