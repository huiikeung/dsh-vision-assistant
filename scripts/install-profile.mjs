#!/usr/bin/env node
// dsh-vision-assistant — 安装到 DSH web profile（幂等，先备份，可一键回滚）
//
//   node scripts/install-profile.mjs
//
// 做的事：
//   1. 备份 profile 的 package.json / cordis.patch.yml / ~/.dsh/settings.yaml
//      （*.dsh-vision-assistant.bak；已存在则不覆盖，保证备份是「安装前」的原样）
//   2. package.json：dependencies 加 link: 依赖，dsh.profile.bundles 加本包
//   3. node_modules 里建同名软链（pnpm link: 的等价物）
//   4. cordis.patch.yml：停用 dsh-vision-opencode（两者注册同名 namespace/tool/skill，不能共存）
//   5. 提示重启 dsh
//
// 官方替代：dsh plugin --profile web add -w dsh-vision-assistant@link:<本目录>
// （pnpm 路径会顺手更新 pnpm-lock.yaml；本脚本不碰 lockfile，因为 package.json 的
//   link: 依赖足以让后续任何一次 pnpm install 重新物化这个软链。）

import { copyFileSync, existsSync, lstatSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedPackageJson, installedPatchYml, PACKAGE_NAME } from './profile-edits.mjs';

const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE_DIR = process.env.DSH_PROFILE_DIR ?? '/vol1/@appdata/deepseek.harness/dsh-data/profiles/web';
const SETTINGS_FILE = process.env.DSH_SETTINGS_FILE ?? '/vol1/@appdata/deepseek.harness/dsh-data/settings.yaml';

const notes = [];

function backup(file) {
  if (!existsSync(file)) return;
  const target = `${file}.${PACKAGE_NAME}.bak`;
  if (existsSync(target)) {
    notes.push(`备份已存在，保持不动：${target}`);
    return;
  }
  copyFileSync(file, target);
  notes.push(`已备份 ${file} → ${target}`);
}

function main() {
  const packageFile = join(PROFILE_DIR, 'package.json');
  const patchFile = join(PROFILE_DIR, 'cordis.patch.yml');
  if (!existsSync(packageFile)) {
    console.error(`  ✗ 找不到 profile：${packageFile}`);
    process.exitCode = 1;
    return;
  }

  backup(packageFile);
  backup(patchFile);
  // settings.yaml 只做安全副本、绝不自动还原：插件首次启动会往共享的
  // vision-opencode namespace 里写入 freeChannels 等字段，出问题时你想手工看一眼原始值。
  backup(SETTINGS_FILE);

  const prePackage = readFileSync(packageFile, 'utf8');
  const nextPackage = installedPackageJson(prePackage, PLUGIN_DIR);
  if (nextPackage !== prePackage) {
    writeFileSync(packageFile, nextPackage, 'utf8');
    notes.push(`package.json: dependencies.${PACKAGE_NAME} = link:${PLUGIN_DIR}；bundles += ${PACKAGE_NAME}`);
  }

  const linkPath = join(PROFILE_DIR, 'node_modules', PACKAGE_NAME);
  let needsLink = true;
  try {
    if (lstatSync(linkPath).isSymbolicLink() && resolve(linkPath) === PLUGIN_DIR) needsLink = false;
  } catch { /* 不存在 */ }
  if (needsLink) {
    try { unlinkSync(linkPath); } catch { /* 不存在 */ }
    symlinkSync(PLUGIN_DIR, linkPath, 'dir');
    notes.push(`node_modules/${PACKAGE_NAME} → ${PLUGIN_DIR}`);
  }

  if (existsSync(patchFile)) {
    const prePatch = readFileSync(patchFile, 'utf8');
    const nextPatch = installedPatchYml(prePatch);
    if (nextPatch !== prePatch) {
      writeFileSync(patchFile, nextPatch, 'utf8');
      notes.push('cordis.patch.yml: dsh-vision-opencode → disabled: true');
    } else {
      notes.push('cordis.patch.yml: 已停用 dsh-vision-opencode（未改动）');
    }
  }

  console.log('== dsh-vision-assistant 安装 ==');
  for (const note of notes) console.log(`  · ${note}`);
  console.log('\n下一步：重启 dsh，然后打开 设置 → 视觉助手。');
  console.log('回滚：node scripts/rollback-profile.mjs');
}

main();
