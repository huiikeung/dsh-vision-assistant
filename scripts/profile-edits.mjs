// dsh-vision-assistant — profile 改动的单一实现（install-profile.mjs / rollback-profile.mjs 共用）
//
// 为什么单独放一个文件：回滚要判断「当前文件是否仍处于安装后的状态」，
// 就必须能重算出「安装后应当长什么样」。把变换逻辑写两份迟早会漂移。

/** 安装脚本写入 cordis.patch.yml 的注释（回滚时连它一起去掉）。 */
export const INSTALL_COMMENT = '# dsh-vision-assistant 安装脚本写入：vision-opencode 与本插件注册同名 skills/工具/namespace，停用其一\n';

/** 旧同族插件在 bundle 列表里的**包名**（注意：不是 cordis row id）。 */
export const LEGACY_PACKAGE = 'dsh-vision-opencode';
/** 旧同族插件在 cordis.patch.yml 里的 **row id**。 */
export const LEGACY_ID = 'vision-opencode';
/** 本插件名 / 默认 source 目录占位（调用方传入真实路径）。 */
export const PACKAGE_NAME = 'dsh-vision-assistant';

/** bundle 列表里把本插件插到同族插件之前（找不到就追加）。纯函数。 */
export function withBundle(bundles, name = PACKAGE_NAME) {
  const next = Array.isArray(bundles) ? [...bundles] : [];
  if (next.includes(name)) return next;
  const at = next.indexOf(LEGACY_PACKAGE);
  if (at >= 0) next.splice(at, 0, name);
  else next.push(name);
  return next;
}

/** 「安装后的 package.json 文本」。 */
export function installedPackageJson(preInstallText, pluginDir, name = PACKAGE_NAME) {
  const pkg = JSON.parse(preInstallText);
  pkg.dependencies ??= {};
  pkg.dependencies[name] = `link:${pluginDir}`;
  pkg.dsh ??= {};
  pkg.dsh.profile ??= {};
  pkg.dsh.profile.bundles = withBundle(pkg.dsh.profile.bundles, name);
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

/** 当前内容是否仍是「安装后」状态（否则说明安装之后还有别的改动，回滚不能整文件覆盖）。 */
export function isInstalledPackageJson(currentText, preInstallText, pluginDir, name = PACKAGE_NAME) {
  try {
    return currentText === installedPackageJson(preInstallText, pluginDir, name);
  } catch {
    return false;
  }
}

/** 「安装后的 cordis.patch.yml 文本」。 */
export function installedPatchYml(preInstallText, legacyId = LEGACY_ID) {
  const raw = preInstallText ?? '';
  if (new RegExp(`^-\\s*id:\\s*${legacyId}\\s*$`, 'm').test(raw)) return raw;
  const block = `${INSTALL_COMMENT}- id: ${legacyId}\n  disabled: true\n`;
  return raw.endsWith('\n') || raw.length === 0 ? `${raw}${block}` : `${raw}\n${block}`;
}

export function isInstalledPatchYml(currentText, preInstallText, legacyId = LEGACY_ID) {
  return currentText === installedPatchYml(preInstallText, legacyId);
}

/** 反向撤销 package.json：只摘掉本脚本加的东西。返回 null 表示无需改动。 */
export function stripPackageJson(currentText, name = PACKAGE_NAME) {
  const pkg = JSON.parse(currentText);
  let changed = false;
  if (pkg.dependencies && name in pkg.dependencies) {
    delete pkg.dependencies[name];
    changed = true;
  }
  const bundles = pkg.dsh?.profile?.bundles;
  if (Array.isArray(bundles) && bundles.includes(name)) {
    pkg.dsh.profile.bundles = bundles.filter((entry) => entry !== name);
    changed = true;
  }
  return changed ? `${JSON.stringify(pkg, null, 2)}\n` : null;
}

/** 反向撤销 cordis.patch.yml：只摘掉本脚本写的注释行 + `- id: <legacy>` / `disabled: true`。 */
export function stripPatchYml(currentText, legacyId = LEGACY_ID) {
  const lines = String(currentText ?? '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^#\s*dsh-vision-assistant 安装脚本写入/.test(lines[i])) continue;
    if (new RegExp(`^-\\s*id:\\s*${legacyId}\\s*$`).test(lines[i])
      && /^\s*disabled:\s*true\s*$/.test(lines[i + 1] ?? '')) {
      i += 1; // 连同下一行 disabled 一起跳过
      continue;
    }
    out.push(lines[i]);
  }
  const next = out.join('\n');
  return next === currentText ? null : next;
}
