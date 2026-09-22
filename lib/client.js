// dsh-vision-assistant: DeepSeek Harness 插件（前端半边）。
//
// 在输入框右侧（conversation.input.right slot）注入"识图模型"选择器：
// 列出所有支持图片输入的供应商模型（后端 /vision-config/models 提供），
// 选择结果写入后端配置（PUT /vision-config/config），
// vision_read_image 工具随后使用该模型看图。
//
// 视觉与交互复刻官方模型选择器（packages/client/ui-model-selection 的
// ModelSelect + ModelSelect.module.css）：28px 胶囊触发器（13/20/500 次要色、
// hover 填充）、向上展开的 12px 圆角菜单卡片、粘性供应商分组标题、38px 两行
// 选项（模型名 14/20/500 + 描述 12/18）、尾部对勾选中标记、方向键导航、
// 失焦/外点/Escape 关闭、加载失败重试条、选择失败 Toast。样式声明逐字取自
// 官方 CSS（仅类名加 vmo- 前缀），主题令牌（--dsw-*）随官方深浅色自动切换；
// 对勾/箭头图标与 Toast 来自平台 seed 模块 @deepseek-ai/dsh-client-ui-primitives，
// 缺失时回退内置字形，功能不受影响。
//
// Bundle 格式遵循 DSH client 模块系统：window.__ModuleLoader__.load({id, factory})，
// factory 通过 require() 获取平台共享模块（react、cordis、slots 等）。
window.__ModuleLoader__.load({
	id: "dsh-vision-assistant",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var react = require("react");

		// ---- 官方 UI 原语（平台 seed 模块，可选依赖） ----
		// 对勾/箭头图标与 Toast 与官方 ModelSelect 同源；平台缺失这些导出时
		// 回退到内置字形与无 Toast 提示，选择器仍可用。
		var IconCheckOutline16 = null;
		var IconChevronDownOutline14 = null;
		var IconWarningOutline16 = null;
		var IconTrashOutline16 = null;
		var IconPlusOutline16 = null;
		var IconEditOutline16 = null;
		var Toast = null;
		var Modal = null;
		try {
			var uiPrimitives = require("@deepseek-ai/dsh-client-ui-primitives");
			IconCheckOutline16 = uiPrimitives.IconCheckOutline16;
			IconChevronDownOutline14 = uiPrimitives.IconChevronDownOutline14;
			IconWarningOutline16 = uiPrimitives.IconWarningOutline16;
			IconTrashOutline16 = uiPrimitives.IconTrashOutline16;
			IconPlusOutline16 = uiPrimitives.IconPlusOutline16;
			IconEditOutline16 = uiPrimitives.IconEditOutline16;
			Toast = uiPrimitives.Toast;
			Modal = uiPrimitives.Modal;
		} catch (_missing) {
			/* 平台模块缺失：走内置兜底字形 */
		}

		// ---- 设置页样式：内置复刻官方 ModelsSection.module.css（前缀 vmo-of-） ----
		// 曾经的方案是运行时扫描页面样式表探测官方 CSS Module hash 前缀再复用
		// 官方类（hash_原名 形态）。DSH 0.1.2-alpha 起前端拆成 __ModuleLoader__
		// 运行时模块、设置页各 section 的 CSS 只在官方模块被加载时才注入——
		// 直接打开 Vision 设置页时官方样式表不在 document.styleSheets 里，
		// 探测必然失败并回退到旧 hash，整页官方类全部失效（按钮退化成浏览器
		// 默认样式）。因此改为把官方设置页样式逐字内置（仅类名加 vmo-of- 前缀，
		// 规则原文与官方源码一致），不再依赖官方 CSS 的注入时机与 hash 形态；
		// 主题令牌（--dsw-*）仍随官方深浅色自动切换。

		// ---- 注入样式：逐字复刻官方 ModelSelect.module.css（前缀 vmo-） ----
		// 注意：web 客户端热更新时 <head> 不会被重建，旧 <style> 标签会留存，
		// 因此这里「存在则更新内容」而非「不存在才注入」，否则改样式不生效。
		var CSS_ID = "dsh-vision-assistant/style";
		if (typeof document !== "undefined") {
			var styleTag = document.querySelector('style[data-plugin-css="' + CSS_ID + '"]');
			if (styleTag === null) {
				styleTag = document.createElement("style");
				styleTag.dataset.plugin = "dsh-vision-assistant";
				styleTag.dataset.pluginCss = CSS_ID;
				document.head.appendChild(styleTag);
			}
			styleTag.textContent = [
				/* 根：锚定向上展开的菜单 */
				".vmo-root{position:relative;min-width:0}",
				/* 触发器（Figma 313:14108 ToggleButton）：28px 胶囊、13/20/500 次要色，
				   hover 填充，与官方模型选择器同一族 chip */
				".vmo-trigger{display:flex;align-items:center;gap:4px;min-width:0;max-width:220px;height:28px;padding:0 4px 0 8px;border:none;border-radius:24px;outline:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;font-weight:500;cursor:pointer}",
				".vmo-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
				".vmo-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}",
				".vmo-trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}",
				".vmo-trigger-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
				/* 前缀标记：caption 色的 "Vision"（官方 .triggerEffort 同款次要呈现），
				   用于与旁边的官方主模型选择器区分 */
				".vmo-trigger-tag{flex:0 0 auto;color:var(--dsw-alias-label-caption)}",
				/* 识图进度：提示语占位替换 Vision 标记（模型名保留）；
				   运行中复刻官方 TurnStatus（Deep diving...）的微光扫过动效，完成/失败沿用绿/红状态色，取消态继承 caption 色 */
				".vmo-progress-running{background:linear-gradient(90deg,var(--dsw-static-deepseek-500) 0%,var(--dsw-static-deepseek-500) 40%,var(--dsw-static-deepseek-200) 50%,var(--dsw-static-deepseek-500) 60%,var(--dsw-static-deepseek-500) 100%);background-position:100% 0;background-size:250% 100%;background-clip:text;-webkit-background-clip:text;color:transparent;-webkit-text-fill-color:transparent;animation:vmo-shimmer 1.8s linear infinite}",
				".vmo-progress-done{color:var(--dsw-static-green-500)}",
				".vmo-progress-failed{color:var(--dsw-static-red-500)}",
				"@keyframes vmo-shimmer{to{background-position:0 0}}",
				"@media (prefers-reduced-motion: reduce){.vmo-progress-running{background-position:0 0;background-size:100% 100%;animation:none}}",
				/* 箭头：caption 色，展开旋转 180°；兜底字形按 14px 渲染 */
				".vmo-chevron{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;font-size:14px;color:var(--dsw-alias-label-caption);transition:transform 120ms ease}",
				".vmo-chevron-open{transform:rotate(180deg)}",
				/* 菜单卡片：表面令牌与官方 Menu 原语一致；滚动条重绑 l2 高度令牌 */
				".vmo-menu{position:absolute;right:0;bottom:calc(100% + 8px);z-index:20;display:flex;flex-direction:column;width:min(240px,calc(100vw - 32px));max-height:min(360px,calc(100vh - 96px));overflow:hidden;padding:4px;border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}",
				".vmo-status,.vmo-empty{padding:10px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}",
			/* 推理开关（放在 Vision 菜单底部，内联分段控件，无弹出层故不会与列表重叠）：
			   深浅色跟随 shell 令牌 */
			".vmo-effort{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 4px 4px;padding:8px 8px 10px;border-top:1px solid var(--dsw-alias-border-l2)}",
			".vmo-effort-label{font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);flex:none}",
			".vmo-effort-seg{display:flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-interactive-bg-hover-solid,transparent)}",
			".vmo-effort-seg-btn{min-width:54px;height:24px;padding:0 10px;border:none;border-radius:6px;outline:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:24px;cursor:pointer}",
			".vmo-effort-seg-btn:hover:not(:disabled):not(.is-on){background:var(--dsw-alias-interactive-bg-hover)}",
			".vmo-effort-seg-btn:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}",
			".vmo-effort-seg-btn.is-on{background:var(--dsw-alias-bg-layer-2,var(--dsw-specific-menu));color:var(--dsw-alias-state-business-primary);font-weight:600;box-shadow:var(--dsw-shadow-lv1)}",
			".vmo-settings-reasoning{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-primary,transparent)}",
			".vmo-settings-reasoning-copy{display:flex;flex-direction:column;gap:2px;min-width:0}",
			".vmo-settings-reasoning-title{font-size:14px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary)}",
			".vmo-settings-reasoning-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
			".vmo-settings-reason-block{display:flex;flex-direction:column;gap:4px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}",
			".vmo-settings-reason-row{display:flex;align-items:center;gap:10px}",
			".vmo-settings-reason-label{font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}",
			".vmo-settings-reason-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}",
				/* 加载失败条（官方 error 表面）+ 重试入口 */
				".vmo-error{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:4px;padding:7px 8px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}",
				".vmo-retry{flex:0 0 auto;padding:0;border:none;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer}",
				".vmo-groups{min-height:0;overflow-y:auto}",
				".vmo-group + .vmo-group{margin-top:4px}",
				/* 供应商分组标题：粘性吸顶 */
				".vmo-group-title{position:sticky;top:0;z-index:1;padding:5px 8px 3px;background:var(--dsw-specific-menu);color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-weight:500}",
				/* 选项行：38px 两行（名称+描述）；选中标记是尾部对勾而非填充 */
				".vmo-option{display:flex;align-items:center;gap:8px;width:100%;min-height:38px;padding:6px 8px;border:none;border-radius:10px;outline:none;background:transparent;color:inherit;text-align:left;cursor:pointer}",
				".vmo-option:hover:not(:disabled),.vmo-option:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}",
				".vmo-option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}",
				".vmo-option-copy{display:flex;flex:1;flex-direction:column;min-width:0}",
				".vmo-model-name{overflow:hidden;color:inherit;font-size:14px;line-height:20px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}",
				".vmo-description{overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}",
				".vmo-check{display:grid;place-items:center;flex:0 0 18px;font-size:14px;color:var(--dsw-alias-label-primary)}",
				/* 视觉隐藏的常驻读屏直播区：只镜像进度文案，避免恢复 "Vision" 时被播报 */
				".vmo-sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;clip:rect(0 0 0 0);clip-path:inset(50%);overflow:hidden;white-space:nowrap}",
				/* 设置页 Vision 分组外壳与供应商分组头：插件自绘（vmo-settings- 与 vmo-provider- 前缀），
				   列表/表单控件样式走下方内置复刻的官方设置页类（vmo-of- 前缀，见 C 常量） */
				".vmo-settings-section{max-width:720px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:12px;margin-top:24px;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l2)}",
				".vmo-settings-title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}",
				".vmo-settings-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}",
				".vmo-settings-rows{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}",
				".vmo-settings-group{display:flex;flex-direction:column;gap:8px}",
				".vmo-settings-groupTitle{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:500;line-height:18px;padding:4px 2px 0;margin:0}",
				".vmo-settings-groupHeader{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-primary,transparent);color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px;cursor:pointer;text-align:left}",
				".vmo-settings-groupHeader:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
				".vmo-settings-groupChevron{flex:none;font-size:14px;color:var(--dsw-alias-label-tertiary);transition:transform 120ms ease;transform:rotate(-90deg)}",
				".vmo-settings-groupOpen .vmo-settings-groupChevron{transform:rotate(0deg)}",
				".vmo-settings-groupCount{margin-left:auto;font-size:12px;font-weight:400;color:var(--dsw-alias-label-tertiary)}",
				".vmo-settings-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;display:flex;flex-direction:column;gap:8px;padding:12px 14px;background:var(--dsw-alias-bg-primary,transparent)}",
				".vmo-settings-head{display:flex;align-items:center;gap:10px}",
				".vmo-settings-identity{display:inline-flex;align-items:center;gap:6px;min-width:0}",
				".vmo-settings-name{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
				".vmo-settings-tag{border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);border-radius:4px;padding:1px 6px;font-size:11px;line-height:16px;flex:none}",
				".vmo-settings-dot{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block;box-sizing:border-box}",
				".vmo-settings-dot-on{background:var(--dsw-alias-state-success-primary)}",
				".vmo-settings-dot-off{background:var(--dsw-alias-state-error-primary)}",
				".vmo-settings-dot-idle{background:var(--dsw-alias-border-l3)}",
				".vmo-settings-actions{margin-left:auto;display:inline-flex;gap:4px;align-items:center}",
				".vmo-settings-btn{box-sizing:border-box;height:28px;padding:0 10px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;cursor:pointer;display:inline-flex;align-items:center;gap:4px}",
				".vmo-settings-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
				".vmo-settings-btn-danger{border:none;color:var(--dsw-alias-state-error-primary)}",
				".vmo-settings-btn-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}",
				".vmo-settings-addBlock{display:flex;flex-wrap:wrap;gap:10px;margin-top:4px}",
				".vmo-settings-addBtn{flex:1 1 0;min-width:180px;height:44px;border:1px dashed var(--dsw-alias-border-l3);border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font-size:14px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px}",
				".vmo-settings-addBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
				".vmo-settings-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;padding:8px 0}",
				".vmo-settings-error{color:var(--dsw-alias-state-error-primary);font-size:13px;padding:6px 8px;background:var(--dsw-alias-interactive-bg-hover-danger);border-radius:8px}",
			/* 供应商分组头：大字号（参考官方 rowName 14px），箭头指示展开/收起 */
			".vmo-provider-group{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:10px 12px;background:var(--dsw-alias-bg-primary)}",
			".vmo-provider-group .vmo-of-rowCard{background:var(--dsw-alias-bg-primary)}",
			".vmo-provider-group .vmo-of-modelEntry{background:var(--dsw-alias-bg-primary)}",
			".vmo-provider-head-row{display:flex;align-items:center;gap:8px;width:100%}",
			".vmo-provider-head-edit{flex:none;height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:13px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;cursor:pointer;display:inline-flex;align-items:center;gap:4px}",
			".vmo-provider-head-edit:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			".vmo-provider-head-del{color:var(--dsw-alias-state-error-primary)}",
			".vmo-provider-head-del:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}",
			".vmo-provider-head{display:flex;align-items:center;gap:8px;width:100%;padding:2px 0;border:none;background:transparent;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px;cursor:pointer;text-align:left}",
			".vmo-provider-head:hover{color:var(--dsw-alias-label-secondary)}",
			".vmo-provider-chevron{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary);transition:transform 120ms ease;transform:rotate(-90deg);display:inline-flex}",
			".vmo-provider-groupOpen .vmo-provider-chevron{transform:rotate(0deg)}",
			".vmo-provider-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".vmo-provider-custom-tag{flex:none;height:18px;padding:0 6px;margin-left:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;display:inline-flex;align-items:center}",
			".vmo-provider-count{margin-left:auto;flex:none;font-size:12px;font-weight:400;color:var(--dsw-alias-label-tertiary)}",
				/* 弹窗表单 */
				".vmo-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}",
				".vmo-modal{width:min(520px,95vw);max-height:90vh;overflow:auto;background:var(--dsw-alias-bg-primary,#1a1a1a);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:14px;box-shadow:var(--dsw-shadow-lv3);color-scheme:light dark}",
				".vmo-modal-title{font-size:15px;font-weight:600;line-height:22px;margin:0;color:var(--dsw-alias-label-primary)}",
				".vmo-field{display:flex;flex-direction:column;gap:6px}",
				".vmo-field-label{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary);line-height:18px}",
".vmo-input{height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-primary);color:var(--dsw-alias-label-primary);font-size:14px;outline:none;width:100%;box-sizing:border-box;color-scheme:light dark}",
".vmo-input option,.vmo-input optgroup{background:var(--dsw-specific-menu,var(--dsw-alias-bg-primary));color:var(--dsw-alias-label-primary)}",
".vmo-input::placeholder{color:var(--dsw-alias-label-tertiary);opacity:1}",
".vmo-input:focus{border-color:var(--dsw-alias-border-l3);box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}",
				".vmo-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px;width:100%}",
				".vmo-btn-primary{height:36px;padding:0 14px;border-radius:18px;border:none;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-size:14px;cursor:pointer}",
				".vmo-btn-primary:disabled{opacity:0.4;cursor:default}",
				".vmo-btn-secondary{height:36px;padding:0 14px;border-radius:18px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-size:14px;cursor:pointer}",
				// 模型选择弹窗：纯 vmo-picker-* 自渲染 CSS，间距值对齐官方 CSS Module 源
				// （candidateList gap:2px/max-height:320px、candidateLabel gap:8px/padding:6px 8px、
				// candidateId font-size:13px/font-family:var(--ds-font-family-code)）。
				// 零 hash 类依赖，DSH 升级换 hash 也不影响 picker 视觉。
				".vmo-picker-rows{display:flex;flex-direction:column;gap:2px;max-height:320px;margin:0;padding:0;list-style:none;overflow-y:auto}",
				".vmo-picker-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;background:transparent;border:none;cursor:pointer;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;width:100%}",
				".vmo-picker-row:hover{background:var(--dsw-alias-interactive-bg-hover)}",
				".vmo-picker-row:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:-2px}",
				".vmo-picker-row-id{flex:auto;font-family:var(--ds-font-family-code,var(--dsw-typography-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace));overflow-wrap:anywhere;font-size:13px;color:var(--dsw-alias-label-primary)}",
				".vmo-picker-row-box{flex:none;width:16px;height:16px;border:1.5px solid rgba(0,0,0,0.25);border-radius:4px;display:inline-flex;align-items:center;justify-content:center;background:transparent;color:#fff;transition:background-color 120ms ease,border-color 120ms ease}",
				"[data-ds-dark-theme] .vmo-picker-row-box{border-color:rgba(255,255,255,0.25)}",
				".vmo-picker-row.vmo-picker-row-checked .vmo-picker-row-box{background:rgb(59,130,246);border-color:rgb(59,130,246)}",
				".vmo-picker-rows .vmo-picker-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;padding:20px 0;text-align:center}",
				/* ---- 官方设置页样式内置复刻（packages/client/ui-settings-models/src/client/
				   ModelsSection.module.css，仅类名加 vmo-of- 前缀，规则原文一致）----
				   颜色全部走 --dsw-alias-* 令牌，深浅色随官方主题自动切换。
				   同步官方时对照源文件逐条 diff 即可。 */
				".vmo-of-section{display:flex;flex-direction:column;gap:12px;max-width:720px;color:var(--dsw-alias-label-primary)}",
				".vmo-of-title{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}",
				".vmo-of-intro{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary)}",
				".vmo-of-notice{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-label)}",
				".vmo-of-savedNotice{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-success-primary)}",
				".vmo-of-rows{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}",
				".vmo-of-rowCard{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:12px}",
				".vmo-of-rowHead{display:flex;align-items:center;gap:10px}",
				".vmo-of-rowIdentity{display:inline-flex;align-items:center;gap:6px;min-width:0}",
				".vmo-of-rowName{font-size:14px;line-height:22px;font-weight:500;color:var(--dsw-alias-label-primary)}",
				".vmo-of-rowTag{flex:none;padding:1px 6px;border:1px solid var(--dsw-alias-border-l3);border-radius:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}",
				".vmo-of-credentialDot{box-sizing:border-box;display:inline-block;flex:none;width:8px;height:8px;border-radius:50%}",
				".vmo-of-credentialDotConfigured{background:var(--dsw-alias-state-success-primary)}",
				".vmo-of-credentialDotMissing{background:var(--dsw-alias-state-error-primary)}",
				".vmo-of-rowActions{display:inline-flex;align-items:center;gap:4px;margin-left:auto}",
				/* 控件统一 border-box：应用无全局 border-box reset，缺了它 outlined 变体
				   会比 filled 高 2px（取消/保存、编辑/删除并排时肉眼可见） */
				".vmo-of-primaryButton,.vmo-of-secondaryButton,.vmo-of-addButton{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border:none;border-radius:18px;font:inherit;font-size:14px;line-height:22px;cursor:pointer}",
				".vmo-of-primaryButton{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}",
				".vmo-of-primaryButton:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}",
				".vmo-of-secondaryButton,.vmo-of-addButton{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}",
				".vmo-of-secondaryButton:hover:not(:disabled),.vmo-of-addButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
				".vmo-of-secondaryButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}",
				".vmo-of-dangerButton{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 14px;border:none;border-radius:18px;background:transparent;color:var(--dsw-alias-state-error-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}",
				".vmo-of-dangerButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}",
				/* 行内控件用致密胶囊（Button .sm） */
				".vmo-of-rowActions .vmo-of-secondaryButton,.vmo-of-rowActions .vmo-of-dangerButton{height:28px;padding:0 10px;border-radius:14px;font-size:12px;line-height:18px}",
				".vmo-of-primaryButton:disabled,.vmo-of-secondaryButton:disabled,.vmo-of-dangerButton:disabled,.vmo-of-addButton:disabled,.vmo-of-linkButton:disabled,.vmo-of-addModelButton:disabled{opacity:0.4;cursor:default}",
				".vmo-of-primaryButton:focus-visible,.vmo-of-secondaryButton:focus-visible,.vmo-of-dangerButton:focus-visible,.vmo-of-addButton:focus-visible,.vmo-of-linkButton:focus-visible,.vmo-of-addModelButton:focus-visible,.vmo-of-iconButton:focus-visible,.vmo-of-customizedSummary:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}",
				/* 编辑面：面板上的填充模块，与设置选择器填充一致 */
				".vmo-of-editor{border-radius:12px;background:var(--dsw-alias-bg-module-platform);padding:14px 16px;display:flex;flex-direction:column;gap:14px}",
				".vmo-of-editorHeader{display:flex;align-items:baseline;gap:8px}",
				".vmo-of-editorTitle{font-size:14px;line-height:22px;font-weight:500;color:var(--dsw-alias-label-primary)}",
				".vmo-of-editorRoute{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
				".vmo-of-field{display:flex;flex-direction:column;gap:6px}",
				".vmo-of-fieldLabel{display:inline-flex;align-items:center;gap:10px;font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary)}",
				".vmo-of-linkButton{box-sizing:border-box;display:inline-flex;align-items:center;height:28px;padding:0 10px;border:none;border-radius:14px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}",
				".vmo-of-linkButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
				".vmo-of-advancedHint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
				".vmo-of-editorActions{display:flex;justify-content:flex-end;gap:8px}",
				".vmo-of-addBlock{display:flex;flex-direction:column;gap:12px}",
				/* 两个添加入口是同级兄弟、与上方行卡片同宽；换行而不是缩到不可读 */
				".vmo-of-addActions{display:flex;flex-wrap:wrap;gap:10px}",
				".vmo-of-addButton{flex:1 1 0;min-width:180px;gap:6px;height:44px;border:1px dashed var(--dsw-alias-border-l3);border-radius:12px}",
				".vmo-of-addCard,.vmo-of-setupCard{border-radius:12px;background:var(--dsw-alias-bg-module-platform);padding:14px 16px;display:flex;flex-direction:column;gap:14px;list-style:none}",
				/* 已带模块外壳的卡片内嵌套编辑器时去掉双重填充 */
				".vmo-of-addCard .vmo-of-editor,.vmo-of-setupCard .vmo-of-editor{background:none;padding:0}",
				".vmo-of-customized{border-top:1px solid var(--dsw-alias-border-l2);padding-top:10px}",
				/* details 原生标记换成旋转箭头：内置三角各引擎不一且吃不到标签色 */
				".vmo-of-customizedSummary{display:flex;align-items:center;gap:6px;width:fit-content;padding:2px 4px;margin-left:-4px;border-radius:6px;cursor:pointer;font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary);list-style:none}",
				".vmo-of-customizedSummary::-webkit-details-marker{display:none}",
				".vmo-of-customizedSummary::before{content:'';width:5px;height:5px;border-right:1.5px solid currentcolor;border-bottom:1.5px solid currentcolor;transform:rotate(-45deg) translate(-1px,-1px);transition:transform 120ms ease}",
				".vmo-of-customized[open] > .vmo-of-customizedSummary::before{transform:rotate(45deg) translate(-1px,-1px)}",
				".vmo-of-customizedSummary:hover{color:var(--dsw-alias-label-primary)}",
				".vmo-of-customizedBody{display:flex;flex-direction:column;gap:12px;padding-top:12px}",
				/* 模型目录：表格而非卡片堆叠 */
				".vmo-of-modelCatalog{display:flex;flex-direction:column;gap:10px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2)}",
				".vmo-of-modelCatalogHeading{display:flex;flex-direction:column;gap:2px}",
				".vmo-of-modelCatalogTitle{font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary)}",
				".vmo-of-modelCatalogMeta,.vmo-of-modelEmpty{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
				".vmo-of-modelList{display:flex;flex-direction:column;gap:8px}",
				".vmo-of-modelListHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}",
				".vmo-of-modelEntry{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px}",
				".vmo-of-modelRow{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) auto auto;align-items:center;gap:6px}",
				/* 方形无文字的行操作：语义在输入框上，动作用 aria-label 自述 */
				".vmo-of-iconButton{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}",
				".vmo-of-iconButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
				".vmo-of-iconButton:disabled{cursor:default;opacity:0.4}",
				".vmo-of-iconButtonDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}",
				".vmo-of-modelAdvanced{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;padding:8px 4px 2px}",
				".vmo-of-modelField{display:flex;flex-direction:column;gap:4px}",
				".vmo-of-modelFieldLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
				".vmo-of-modelEmpty{padding:12px;border:1px dashed var(--dsw-alias-border-l3);border-radius:8px;text-align:center}",
				".vmo-of-addModelButton{box-sizing:border-box;align-self:flex-start;display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}",
				".vmo-of-addModelButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
				".vmo-of-input{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font:inherit;font-size:14px;line-height:22px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}",
				/* 枚举下拉只有少量短选项，字段宽度的下拉读起来像文本框 */
				"select.vmo-of-input{max-width:240px;cursor:pointer}",
				".vmo-of-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}",
				".vmo-of-input::placeholder{color:var(--dsw-alias-label-dimmed)}",
				".vmo-of-input:disabled{opacity:0.6;cursor:default}",
				/* .input 的 select 变体：右侧内嵌 12px 箭头替换系统箭头，右 pad 留位 */
				".vmo-of-selectInput{appearance:none;padding-right:32px;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\");background-repeat:no-repeat;background-position:right 12px center;background-size:12px 12px}",
				".vmo-of-error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}",
				".vmo-of-deleteDialog{width:min(480px,100%)}",
				".vmo-of-deleteConfirm:not(:disabled){border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}",
				".vmo-of-deleteConfirm:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}",
				".vmo-of-hiddenLabel{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}",
				"@media (prefers-reduced-motion: reduce){.vmo-of-customizedSummary::before{transition:none}}",
				".vmo-of-fetchDialog{max-width:520px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}",
				".vmo-of-candidateActions{display:flex;justify-content:flex-end;margin-bottom:6px}",
				".vmo-of-candidateList{display:flex;flex-direction:column;gap:2px;max-height:320px;margin:0;overflow-y:auto;padding:0;list-style:none}",
				".vmo-of-candidate{border-radius:6px}",
				".vmo-of-candidateLabel{display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer}",
				".vmo-of-candidateId{flex:1 1 auto;font-family:var(--ds-font-family-code);font-size:13px;overflow-wrap:anywhere}",
				/* ---- 免费视觉模型模块（vmo-free-*）：沿用设置卡片令牌，不引入新设计语言 ---- */
				".vmo-free-block{display:flex;flex-direction:column;gap:12px;margin-top:12px;padding-top:0}",
				".vmo-free-toggles{display:flex;flex-direction:column;gap:6px}",
				".vmo-free-toggle{display:flex;align-items:flex-start;gap:8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);cursor:pointer}",
				".vmo-free-toggle input{margin:2px 0 0;width:14px;height:14px;flex:none;accent-color:var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-success-primary))}",
				".vmo-free-toggle-hint{display:block;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
				".vmo-free-chain{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0;padding:8px 10px;border:1px dashed var(--dsw-alias-border-l3);border-radius:10px;background:transparent;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}",
				".vmo-free-chain-step{display:inline-flex;align-items:center;padding:1px 6px;border:1px solid var(--dsw-alias-border-l3);border-radius:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}",
				".vmo-free-chipRow{display:flex;flex-wrap:wrap;gap:6px;align-items:center}",
				".vmo-free-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:2px 6px;border:1px solid var(--dsw-alias-border-l3);border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}",
				".vmo-free-chip-id{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:320px;font-family:var(--ds-font-family-code,ui-monospace,monospace)}",
				".vmo-free-chipX{border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1;cursor:pointer;padding:0 2px}",
				".vmo-free-chip{cursor:pointer}",
				".vmo-free-chip:disabled{cursor:default;opacity:0.6}",
				".vmo-free-chip-on{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}",
				".vmo-free-chip-on .vmo-free-chip-id{color:var(--dsw-alias-state-success-primary)}",
				".vmo-free-stepBtn{flex:none;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;cursor:pointer;padding:0 2px}",
				".vmo-free-stepBtn:hover:not(:disabled){color:var(--dsw-alias-label-primary)}",
				".vmo-free-stepBtn:disabled{opacity:0.4;cursor:default}",
				".vmo-free-chain-step-copy{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px}",
				".vmo-free-chip-toggle{border:none;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:0;display:inline-flex;align-items:center;gap:4px}",
				".vmo-free-chip-toggle:disabled{cursor:default}",
				".vmo-free-chain-step[draggable=\"true\"]{cursor:grab}",
				".vmo-free-chain-step[draggable=\"true\"]:active{cursor:grabbing}",
				".vmo-free-chipX:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)}",
				".vmo-free-addRow{display:flex;gap:6px;align-items:center}",
				".vmo-free-addInput{flex:1 1 auto;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-primary,transparent);color:var(--dsw-alias-label-primary);font-size:12px;outline:none;box-sizing:border-box;color-scheme:light dark}",
				".vmo-free-keyRow{display:flex;flex-wrap:wrap;gap:6px;align-items:center}",
				".vmo-free-keyInput{flex:1 1 220px;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-primary,transparent);color:var(--dsw-alias-label-primary);font-size:12px;outline:none;box-sizing:border-box;color-scheme:light dark}",
				".vmo-free-meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin:0}",
				".vmo-free-candidates{display:flex;flex-direction:column;gap:2px;max-height:220px;overflow-y:auto;margin:0;padding:0;list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}",
				".vmo-free-candidate{display:flex;align-items:center;gap:8px;padding:4px 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);cursor:pointer}",
				".vmo-free-candidate-id{flex:1 1 auto;font-family:var(--ds-font-family-code,ui-monospace,monospace);overflow-wrap:anywhere}",
				".vmo-free-badge{flex:none;padding:0 4px;border:1px solid var(--dsw-alias-border-l3);border-radius:4px;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary)}",
				/* 免费模块折叠头：默认收起，点击展开 */
				".vmo-free-summary{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:6px 0;border:none;border-radius:0;background:transparent;color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:24px;cursor:pointer;text-align:left}",
				".vmo-free-summary:hover{color:var(--dsw-alias-label-primary)}",
				".vmo-free-summary-chevron{flex:none;display:inline-flex;align-items:center;justify-content:center;font-size:14px;color:var(--dsw-alias-label-tertiary);transition:transform 120ms ease;transform:rotate(-90deg)}",
				".vmo-free-summary-open .vmo-free-summary-chevron{transform:rotate(0deg)}",
				".vmo-free-summary-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
				".vmo-free-summary-meta{flex:none;margin-left:auto;font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
				/* 链路顺序：标签一行，步骤条另起一行（避免第一项跟在标签后面挤换行） */
				".vmo-free-chainBlock{display:flex;flex-direction:column;gap:6px}",
				".vmo-free-chainLabel{font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary)}",
				/* 「免费模型」分组框：一个框装全部渠道卡，默认折叠 */
				".vmo-free-group{display:flex;flex-direction:column;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-primary,transparent)}",
				".vmo-free-groupBody{display:flex;flex-direction:column;gap:8px}",
				".vmo-free-group .vmo-free-summary{padding:6px 8px;border:none;border-radius:8px;background:transparent}",
				/* 三个总开关各自一张边框卡片 */
				".vmo-free-toggles{display:flex;flex-direction:column;gap:8px}",
				".vmo-free-toggleCard{display:flex;align-items:flex-start;gap:8px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-primary,transparent)}",
				/* 卡片头两行式：标题行（可换行）+ 操作行（可换行），窄屏不再挤出容器 */
				".vmo-free-cardHead{display:flex;flex-direction:column;gap:6px}",
				".vmo-free-cardTitle{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}",
				".vmo-free-cardActions{display:flex;flex-wrap:wrap;align-items:center;gap:6px}",
				".vmo-free-cardActions .vmo-of-secondaryButton{flex:none;height:26px;padding:0 10px;border-radius:13px;font-size:12px;line-height:16px}",
				".vmo-free-cardTitle .vmo-of-rowName{white-space:normal;overflow:visible;text-overflow:clip;word-break:break-word;line-height:20px}"
			].join("\n");
			document.head.appendChild(styleTag);
		}

		// ---- 宿主 API 桥：把宿主当前的远端凭据服务适配成插件内既有的旧式调用形状 ----
		// DSH 0.1.6 的 connection 服务只剩 {isLoopback,generation,state,rpc,reconnect,…}，
		// 不再有 `.api`；密钥读写走 ctx.remote.credentials.{describe,set,unset}
		// （官方「设置 → 模型」页同一个远端命名空间，输入输出为 {ok, value|error}）。
		// 这里统一回旧式 {result:{ok,value:{credentials:{ref:{configured,writable,source}}}}}，
		// 让设置页各处调用点保持原语义；老宿主上 connection.api 仍在，作为后备。
		// 刻意「按调用时才解析服务」：不把 remote 写进 exports.inject，
		// 免得某个宿主没有该服务时整块前端不激活（拿不到就优雅报错）。
		var buildHostApi = function(ctx) {
			var legacyApi = function(){
				try { var c = ctx.get("connection"); return c && typeof c === "object" && c.api ? c.api : null; } catch (_e) { return null; }
			};
			var remoteCredentials = function(){
				var candidates = [];
				try { if (ctx.remote && ctx.remote.credentials) candidates.push(ctx.remote); } catch (_e) {}
				try { var r1 = ctx.get("remote"); if (r1 && r1.credentials) candidates.push(r1); } catch (_e) {}
				try { var r2 = ctx.get("remote.credentials"); if (r2) candidates.push({ credentials: r2 }); } catch (_e) {}
				for (var i = 0; i < candidates.length; i++) {
					var c = candidates[i].credentials;
					if (c && typeof c.set === "function" && typeof c.describe === "function") return c;
				}
				return null;
			};
			var noHostApi = function(){ return { result: { ok: false, error: { message: "当前宿主未提供凭据写入接口：可在「设置 → 模型」里添加密钥，或直接写 ~/.dsh/.credentials.yaml 后重启" } } }; };
			var fail = function(e){ return { result: { ok: false, error: { message: e && e.message ? e.message : String(e) } } }; };
			var remoteSettings = function(){
				try {
					var r = ctx.get("remote");
					return r && r.settings && typeof r.settings.mutate === "function" ? r.settings : null;
				} catch (_e) { return null; }
			};
			return {
				// 宿主远端设置：写 llm-pi-ai 模型 input 声明用；拿不到则相关开关不显示
				remoteSettings: remoteSettings,
				credentials: {
					describe: function(payload) {
						var rc = remoteCredentials();
						if(rc !== null){
							var refs = payload && Array.isArray(payload.refs) ? payload.refs.slice() : [];
							return Promise.resolve()
								.then(function(){ return rc.describe(refs); })
								.then(function(r){
									if(!r || r.ok !== true) return { result: { ok: false, error: (r && r.error) || { message: "凭据查询失败" } } };
									var value = r.value || {};
									var out = {};
									for(var i=0;i<refs.length;i++){
										var info = value[refs[i]];
										out[refs[i]] = info
											? { configured: info.configured === true, writable: info.writable === true, source: info.source }
											: { configured: false, writable: false };
									}
									return { result: { ok: true, value: { credentials: out } } };
								})
								.catch(fail);
						}
						var legacy = legacyApi();
						if(legacy && legacy.credentials && typeof legacy.credentials.describe === "function") return legacy.credentials.describe(payload);
						return Promise.resolve(noHostApi());
					},
					set: function(payload) {
						var rc = remoteCredentials();
						if(rc !== null){
							return Promise.resolve()
								.then(function(){ return rc.set(payload.ref, payload.value); })
								.then(function(r){ return { result: r && r.ok === true ? { ok: true } : { ok: false, error: (r && r.error) || { message: "写入被拒绝（可能被只读环境变量遮蔽）" } } }; })
								.catch(fail);
						}
						var legacy = legacyApi();
						if(legacy && legacy.credentials && typeof legacy.credentials.set === "function") return legacy.credentials.set(payload);
						return Promise.resolve(noHostApi());
					},
					unset: function(payload) {
						var rc = remoteCredentials();
						if(rc !== null){
							return Promise.resolve()
								.then(function(){ return rc.unset(payload.ref); })
								.then(function(r){ return { result: r && r.ok === true ? { ok: true } : { ok: false, error: (r && r.error) || { message: "删除被拒绝（可能被只读环境变量遮蔽）" } } }; })
								.catch(fail);
						}
						var legacy = legacyApi();
						if(legacy && legacy.credentials && typeof legacy.credentials.unset === "function") return legacy.credentials.unset(payload);
						return Promise.resolve(noHostApi());
					}
				},
				// llm/settings 的旧式回退路径只有老宿主才有；当前宿主由后端 keyRefs 提供
				// 渠道状态，拿不到就退化成「不显示圆点」，不会崩。
				get llm() { var legacy = legacyApi(); return legacy ? legacy.llm : void 0; },
				get settings() { var legacy = legacyApi(); return legacy ? legacy.settings : void 0; }
			};
		};

		var menuSeq = 0;

		// ---- 识图模型选择器组件 ----
		// props: { sessionId }（来自 slot inject）
		var VisionModelSelect = function(props) {
			var sessionId = props.sessionId;
			var useState = react.useState;
			var useEffect = react.useEffect;
			var useRef = react.useRef;
			var createElement = react.createElement;

			var groupsState = useState([]);
			var groups = groupsState[0];
			var setGroups = groupsState[1];
			var currentState = useState(null);
			var current = currentState[0];
			var setCurrent = currentState[1];
			var statusState = useState("loading");
			var status = statusState[0];
			var setStatus = statusState[1];
			var loadErrorState = useState(null);
			var loadError = loadErrorState[0];
			var setLoadError = loadErrorState[1];
			var busyState = useState(false);
			var busy = busyState[0];
			var setBusy = busyState[1];
			var openState = useState(false);
			var open = openState[0];
			var setOpen = openState[1];
			var toastState = useState(null);
			var toast = toastState[0];
			var setToast = toastState[1];
			var progressState = useState(null);
			var progress = progressState[0];
			var setProgress = progressState[1];
			var rootRef = useRef(null);
			var triggerRef = useRef(null);
			var itemRefs = useRef([]);
			var toastSeq = useRef(0);
			var loadRef = useRef(null);
			var menuIdRef = useRef(null);
			if (menuIdRef.current === null) {
				menuSeq += 1;
				menuIdRef.current = "vmo-menu-" + menuSeq;
			}

			useEffect(function() {
				var cancelled = false;
				var attempts = 0;
				var clearProgressTimer = null;
				var progressStream = null;
				setStatus("loading");
				fetch("/vision-config/config", { headers: { accept: "application/json" } })
					.then(function(resp) { return resp.json(); })
					.then(function(cfg) {
						if (!cancelled && cfg !== null && typeof cfg === "object" && typeof cfg.provider === "string" && typeof cfg.model === "string") setCurrent(cfg);
					})
					.catch(function() {});
				// 加载模型目录；后端端点可能晚于前端挂载，初次加载失败自动重试。
				// withRetry=true（挂载）：6 次退避后进入 error 态；
				// withRetry=false（每次打开菜单时静默刷新）：单次失败仅置 loadError，
				// 保留旧目录继续可用（官方 /model 弹层同款"打开即刷新"行为）。
				var messageOf = function(error) {
					return error && typeof error.message === "string" && error.message.length > 0 ? error.message : String(error);
				};
				var loadModels = function(withRetry) {
					Promise.all([
						fetch("/vision-config/models", { headers: { accept: "application/json" } }).then(function(r){ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); }),
						fetch("/vision-config/vision-models", { headers: { accept: "application/json" } }).then(function(r){ if(!r.ok) return {models:[]}; return r.json(); }).catch(function(){ return {models:[]}; })
					]).then(function(results){
						if (cancelled) return;
						var data = results[0];
						var vmData = results[1];
						if (data === null || typeof data !== "object" || !Array.isArray(data.groups)) throw new Error("bad payload");
						var groups = data.groups.slice();
						var vmList = vmData && Array.isArray(vmData.models) ? vmData.models : [];
						if (vmList.length > 0) {
							var vmByProvider = {};
							for (var i=0;i<vmList.length;i++){
								var vm = vmList[i];
								if(!vm || typeof vm.provider!=="string" || typeof vm.model!=="string") continue;
								var p = vm.provider;
								if(!vmByProvider[p]) vmByProvider[p] = [];
								vmByProvider[p].push({ id: vm.model, name: (vm.name && vm.name.length>0 ? vm.name : vm.model), description: vm.description || "" });
							}
							for (var p in vmByProvider){
								var found = null;
								for (var gi=0; gi<groups.length; gi++) if(groups[gi].provider===p){ found=groups[gi]; break; }
								if(found){
									var existingIds = {};
									for(var mi=0; mi<found.models.length; mi++) existingIds[found.models[mi].id]=true;
									for(var vi=0; vi<vmByProvider[p].length; vi++){
										var m = vmByProvider[p][vi];
										if(!existingIds[m.id]) found.models.push(m);
									}
								} else {
									groups.push({ provider: p, name: p + " (Vision插件)", models: vmByProvider[p] });
								}
							}
						}
						setGroups(groups);
						setStatus("ready");
						setLoadError(null);
					}).catch(function(error) {
							if (cancelled) return;
							if (withRetry) {
								attempts += 1;
								if (attempts < 6) {
									setStatus("loading");
									setTimeout(function() {
										if (!cancelled) loadModels(true);
									}, 1000);
								} else {
									setStatus("error");
									setLoadError(messageOf(error));
								}
							} else {
								setLoadError(messageOf(error));
							}
						});
				};
				loadRef.current = loadModels;
				loadModels(true);

				// 自动附件转换的临时进度：只存在于输入区，不写入聊天上下文。
				if (typeof sessionId === "string" && sessionId.length > 0 && typeof EventSource === "function") {
					progressStream = new EventSource("/vision-config/events?sessionId=" + encodeURIComponent(sessionId));
					progressStream.onmessage = function(event) {
						if (cancelled) return;
						try {
							var next = JSON.parse(event.data);
							if (next === null || typeof next !== "object" || typeof next.state !== "string" || typeof next.text !== "string") return;
							if (clearProgressTimer !== null) clearTimeout(clearProgressTimer);
							setProgress(next);
							if (next.state !== "running") {
								clearProgressTimer = setTimeout(function() {
									if (!cancelled) setProgress(null);
								}, 4500);
							}
						} catch (_error) {}
					};
				}
				return function() {
					cancelled = true;
					if (loadRef.current === loadModels) loadRef.current = null;
					if (clearProgressTimer !== null) clearTimeout(clearProgressTimer);
					if (progressStream !== null) progressStream.close();
				};
			}, [sessionId]);

			// 打开期间：点击外部关闭（官方 ModelSelect 同款 mousedown 判定）
			useEffect(function() {
				if (!open) return;
				var onPointerDown = function(event) {
					var node = rootRef.current;
					if (node !== null && !node.contains(event.target)) setOpen(false);
				};
				document.addEventListener("mousedown", onPointerDown);
				return function() {
					document.removeEventListener("mousedown", onPointerDown);
				};
			}, [open]);

			var close = function(restoreFocus) {
				setOpen(false);
				if (restoreFocus === true && triggerRef.current !== null && typeof triggerRef.current.focus === "function") {
					queueMicrotask(function() { triggerRef.current.focus(); });
				}
			};
			var show = function() {
				setOpen(true);
				if (loadRef.current !== null) loadRef.current(false);
			};
			var retryLoad = function() {
				setLoadError(null);
				// 无任何目录时回到加载态，避免重试期间闪现"暂无识图模型"
				if (groups.length === 0) setStatus("loading");
				if (loadRef.current !== null) loadRef.current(true);
			};
			var moveFocus = function(offset) {
				var items = [];
				for (var i = 0; i < itemRefs.current.length; i++) if (itemRefs.current[i] !== null && itemRefs.current[i] !== undefined) items.push(itemRefs.current[i]);
				if (items.length === 0) return;
				var active = -1;
				for (var j = 0; j < items.length; j++) if (items[j] === document.activeElement) { active = j; break; }
				var next = (Math.max(active, 0) + offset + items.length) % items.length;
				if (items[next] !== undefined) items[next].focus();
			};
			var onRootKeyDown = function(event) {
				if (event.key === "Escape" && open) {
					event.preventDefault();
					close(true);
					return;
				}
				if (!open) return;
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					event.preventDefault();
					moveFocus(event.key === "ArrowDown" ? 1 : -1);
				}
			};
			var onBlur = function(event) {
				if (event.relatedTarget instanceof Node && rootRef.current !== null && rootRef.current.contains(event.relatedTarget)) return;
				if (open) close(false);
			};

			// 选择失败：用官方 Toast（锚定 composer 卡片顶部居中）提示；
			// 平台缺失 Toast 原语时降级为控制台告警（不打断用户）
			var announceSelectError = function(message) {
				var text = "识图模型切换失败：" + message;
				if (Toast !== null) {
					toastSeq.current += 1;
					setToast({ seq: toastSeq.current, text: text });
				} else if (typeof console !== "undefined" && console.warn !== null) {
					console.warn("dsh-vision-assistant: " + text);
				}
			};

			var pickModel = function(provider, modelId) {
				if (busy) return;
				if (current !== null && current.provider === provider && current.model === modelId) {
					close(true);
					return;
				}
				setBusy(true);
				fetch("/vision-config/config", {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ provider: provider, model: modelId })
				})
					.then(function(resp) {
						if (!resp.ok) throw new Error("HTTP " + resp.status);
						return resp.json();
					})
					.then(function(cfg) {
						setBusy(false);
						if (cfg !== null && typeof cfg === "object" && typeof cfg.provider === "string" && typeof cfg.model === "string") {
							setCurrent(cfg);
							close(true);
						} else {
							announceSelectError("配置响应无效");
						}
					})
					.catch(function(error) {
						setBusy(false);
						announceSelectError(error && typeof error.message === "string" && error.message.length > 0 ? error.message : String(error));
					});
			};

			// 识图推理开关：true=开启（提供方默认档位）；false/缺省=关闭思考。
			// 关闭时后端按适配器实际支持的档位名转译（pi-ai 为 off），无需在此纠结各家命名。
			var reasoningOn = current !== null && typeof current === "object" && current.visionReasoning === true;
			var setEffort = function(on) {
				if (current === null || typeof current.provider !== "string" || typeof current.model !== "string") return;
				setBusy(true);
				fetch("/vision-config/config", {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ provider: current.provider, model: current.model, visionReasoning: on })
				})
					.then(function(resp) {
						if (!resp.ok) throw new Error("HTTP " + resp.status);
						return resp.json();
					})
					.then(function(cfg) {
						setBusy(false);
						if (cfg !== null && typeof cfg === "object") setCurrent(cfg);
					})
					.catch(function(error) {
						setBusy(false);
						announceSelectError(error && typeof error.message === "string" && error.message.length > 0 ? error.message : String(error));
					});
			};

			// 分节：按供应商分组列出支持图片的模型；
			// 当前配置若不在目录里（如目录加载失败），保留为可见的"当前配置"节
			var sections = [];
			var hasCurrent = false;
			if (current !== null && typeof current.provider === "string" && typeof current.model === "string") {
				for (var g = 0; g < groups.length; g++) {
					var group = groups[g];
					if (group === null || typeof group !== "object") continue;
					var models = Array.isArray(group.models) ? group.models : [];
					for (var m = 0; m < models.length; m++) {
						var model = models[m];
						if (model !== null && typeof model === "object" && model.id === current.model && group.provider === current.provider) { hasCurrent = true; break; }
					}
					if (hasCurrent) break;
				}
				if (!hasCurrent) {
					sections.push({
						provider: current.provider,
						name: "当前配置",
						models: [{ id: current.model, name: current.provider + "/" + current.model }]
					});
				}
			}
			for (var gg = 0; gg < groups.length; gg++) {
				var grp = groups[gg];
				if (grp === null || typeof grp !== "object" || typeof grp.provider !== "string") continue;
				var list = Array.isArray(grp.models) ? grp.models : [];
				if (list.length === 0) continue;
				sections.push({ provider: grp.provider, name: typeof grp.name === "string" ? grp.name : grp.provider, models: list });
			}

			// 触发器文案：当前模型的显示名；无配置时用占位文案
			var currentName = null;
			if (current !== null && typeof current.provider === "string") {
				for (var s = 0; s < sections.length; s++) {
					var sec = sections[s];
					if (sec.provider !== current.provider) continue;
					for (var mm = 0; mm < sec.models.length; mm++) {
						if (sec.models[mm].id === current.model) { currentName = typeof sec.models[mm].name === "string" ? sec.models[mm].name : current.model; break; }
					}
					if (currentName !== null) break;
				}
			}
			var triggerLabel = currentName !== null ? currentName
				: (current !== null ? current.provider + "/" + current.model
				: (status === "loading" ? "识图模型…" : "识图模型"));

			// 官方 itemRef 模式：每次渲染重建引用数组，供方向键导航
			itemRefs.current = [];
			var itemIndex = 0;
			var itemRef = function() {
				var at = itemIndex++;
				return function(node) { itemRefs.current[at] = node; };
			};

			// 图标兜底：官方原语缺失时用同尺寸字形
			var checkMark = function() {
				if (IconCheckOutline16 !== null) return createElement(IconCheckOutline16, null);
				return createElement("span", { "aria-hidden": "true" }, "✓");
			};
			var chevron = createElement(
				"span",
				{ className: "vmo-chevron" + (open ? " vmo-chevron-open" : ""), key: "chevron" },
				IconChevronDownOutline14 !== null ? createElement(IconChevronDownOutline14, null) : "▾"
			);

			// 菜单内容：错误条（含重试）→ 加载态/空态/分组列表
			var menuChildren = [];
			if (loadError !== null) {
				menuChildren.push(createElement("div", { className: "vmo-error", key: "error" },
					createElement("span", null, "模型目录加载失败：" + loadError),
					createElement("button", { type: "button", className: "vmo-retry", onClick: retryLoad }, "重试")));
			}
			if (sections.length === 0 && loadError === null && status === "loading") {
				menuChildren.push(createElement("div", { className: "vmo-status", key: "status" }, "正在加载识图模型…"));
			}
			if (sections.length === 0 && loadError === null && status !== "loading") {
				menuChildren.push(createElement("div", { className: "vmo-empty", key: "empty" }, "暂无识图模型"));
			}
			if (sections.length > 0) {
				var sectionNodes = [];
				for (var si = 0; si < sections.length; si++) {
					var section = sections[si];
					var headingId = menuIdRef.current + "-" + section.provider;
					var rowNodes = [];
					for (var ri = 0; ri < section.models.length; ri++) {
						var row = section.models[ri];
						if (row === null || typeof row !== "object" || typeof row.id !== "string") continue;
						var rowName = typeof row.name === "string" ? row.name : row.id;
						var selected = current !== null && current.provider === section.provider && current.model === row.id;
						rowNodes.push(createElement("button", {
							key: row.id,
							ref: itemRef(),
							type: "button",
							role: "menuitemradio",
							"aria-checked": selected,
							className: "vmo-option",
							title: rowName,
							disabled: busy,
							onClick: (function(provider, id) {
								return function() { pickModel(provider, id); };
							})(section.provider, row.id)
						},
							createElement("span", { className: "vmo-option-copy" },
								createElement("span", { className: "vmo-model-name" }, rowName),
								typeof row.description === "string" ? createElement("span", { className: "vmo-description" }, row.description) : null),
							createElement("span", { className: "vmo-check" }, selected ? checkMark() : null)));
					}
					if (rowNodes.length === 0) continue;
					sectionNodes.push(createElement("section", { key: section.provider, role: "group", "aria-labelledby": headingId, className: "vmo-group" },
						createElement("div", { className: "vmo-group-title", id: headingId }, section.name),
						rowNodes));
				}
				menuChildren.push(createElement("div", { className: "vmo-groups", key: "groups" }, sectionNodes));
			}

			// 底部：识图推理开关（开启=提供方默认档位；关闭=禁用思考）。
			// 内联分段控件，无弹出层，不会与上面的模型列表重叠；深浅色跟随 shell 令牌
			menuChildren.push(createElement("div", { key: "effort", className: "vmo-effort" },
				createElement("span", { className: "vmo-effort-label" }, "推理"),
				createElement("div", { className: "vmo-effort-seg", role: "radiogroup", "aria-label": "识图模型推理开关" },
					createElement("button", {
						type: "button",
						role: "radio",
						"aria-checked": reasoningOn,
						disabled: busy,
						title: "开启：识图时让模型思考（提供方默认档位）",
						className: "vmo-effort-seg-btn" + (reasoningOn ? " is-on" : ""),
						onClick: function() { setEffort(true); }
					}, "开启"),
					createElement("button", {
						type: "button",
						role: "radio",
						"aria-checked": !reasoningOn,
						disabled: busy,
						title: "关闭：识图不思考，更快更省 token",
						className: "vmo-effort-seg-btn" + (!reasoningOn ? " is-on" : ""),
						onClick: function() { setEffort(false); }
					}, "关闭"))))

			// 识图进度文案：占位替换触发器的 "Vision" 标记（模型名保留）；
			// 运行中官方 TurnStatus 同款微光扫过（deepseek-500 文字 + deepseek-200 光带），
			// 完成/失败保持绿/红状态色，取消态继承 caption 色
			var progressLabel = "";
			var progressClass = "";
			if (progress !== null) {
				if (progress.state === "running") { progressLabel = "识图中..."; progressClass = "vmo-progress-running"; }
				else if (progress.state === "done") { progressLabel = "识图完成"; progressClass = "vmo-progress-done"; }
				else if (progress.state === "cancelled") { progressLabel = "已取消"; }
				else { progressLabel = "识图失败"; progressClass = "vmo-progress-failed"; }
			}

			return createElement(
				"div",
				{
					className: "vmo-root",
					title: "识图模型：vision_read_image 看图时使用的模型",
					ref: rootRef,
					onKeyDown: onRootKeyDown,
					onBlur: onBlur
				},
				createElement("button", {
					type: "button",
					ref: triggerRef,
					className: "vmo-trigger",
					"aria-label": "识图模型",
					"aria-haspopup": "menu",
					"aria-expanded": open,
					"aria-controls": open ? menuIdRef.current : undefined,
					title: progress !== null ? progress.text : "Vision · " + triggerLabel,
					onClick: function() { if (open) close(); else show(); }
				},
					// 标记槽位：常驻 span，平时显示 "Vision"，识图期间显示进度提示语
					//（模型名保持在右侧标签区不动）
					createElement("span", {
						className: "vmo-trigger-tag" + (progressClass.length > 0 ? " " + progressClass : ""),
						title: progress !== null ? progress.text : undefined
					}, progress !== null ? progressLabel : "Vision"),
					createElement("span", { className: "vmo-trigger-label" }, triggerLabel),
					chevron),
				open ? createElement("div", {
					id: menuIdRef.current,
					className: "vmo-menu",
					role: "menu",
					"aria-label": "识图模型",
					"aria-busy": status === "loading" || busy
				}, menuChildren) : null,
				// 读屏直播区：常驻且只镜像进度文案（空串时不播报），
				// 恢复 "Vision" 不进直播区，避免多余播报
				createElement("span", { className: "vmo-sr-only", "aria-live": "polite" }, progress !== null ? progressLabel : ""),
				toast !== null && Toast !== null ? createElement(Toast, {
					key: toast.seq,
					text: toast.text,
					icon: IconWarningOutline16 !== null ? createElement(IconWarningOutline16, null) : undefined,
					anchor: rootRef.current !== null && typeof rootRef.current.closest === "function" ? (rootRef.current.closest("[data-composer-card]") || null) : null,
					onDone: function() { setToast(null); }
				}) : null
			);
		};

		// ---- 设置页样式类映射 ----
		// 指向内置复刻的官方设置页类（vmo-of-*，样式原文见顶部注入的 CSS）。
		// 不再复用官方 hash 类：官方设置页 CSS 在 0.1.2-alpha 起按模块懒注入，
		// 直接打开 Vision 页时多半尚未注入，复用会整页失样式。
		var C = {
			section: "vmo-of-section", title: "vmo-of-title", intro: "vmo-of-intro",
			notice: "vmo-of-notice", savedNotice: "vmo-of-savedNotice",
			rows: "vmo-of-rows", rowCard: "vmo-of-rowCard", rowHead: "vmo-of-rowHead",
			rowIdentity: "vmo-of-rowIdentity", rowName: "vmo-of-rowName", rowTag: "vmo-of-rowTag",
			credentialDot: "vmo-of-credentialDot", credentialDotConfigured: "vmo-of-credentialDotConfigured",
			credentialDotMissing: "vmo-of-credentialDotMissing", rowActions: "vmo-of-rowActions",
			primaryButton: "vmo-of-primaryButton", secondaryButton: "vmo-of-secondaryButton",
			dangerButton: "vmo-of-dangerButton", editor: "vmo-of-editor", editorHeader: "vmo-of-editorHeader",
			editorTitle: "vmo-of-editorTitle", editorRoute: "vmo-of-editorRoute",
			field: "vmo-of-field", fieldLabel: "vmo-of-fieldLabel", linkButton: "vmo-of-linkButton",
			advancedHint: "vmo-of-advancedHint", editorActions: "vmo-of-editorActions",
			addBlock: "vmo-of-addBlock", addActions: "vmo-of-addActions", addButton: "vmo-of-addButton",
			addCard: "vmo-of-addCard", customized: "vmo-of-customized", customizedSummary: "vmo-of-customizedSummary",
			customizedBody: "vmo-of-customizedBody", modelCatalog: "vmo-of-modelCatalog",
			modelCatalogHeading: "vmo-of-modelCatalogHeading", modelCatalogTitle: "vmo-of-modelCatalogTitle",
			modelCatalogMeta: "vmo-of-modelCatalogMeta", modelList: "vmo-of-modelList",
			modelListHead: "vmo-of-modelListHead", modelEntry: "vmo-of-modelEntry", modelRow: "vmo-of-modelRow",
			iconButton: "vmo-of-iconButton", iconButtonDanger: "vmo-of-iconButtonDanger",
			modelAdvanced: "vmo-of-modelAdvanced", modelField: "vmo-of-modelField", modelFieldLabel: "vmo-of-modelFieldLabel",
			modelEmpty: "vmo-of-modelEmpty", addModelButton: "vmo-of-addModelButton",
			input: "vmo-of-input", selectInput: "vmo-of-selectInput", error: "vmo-of-error",
			fetchDialog: "vmo-of-fetchDialog", candidateList: "vmo-of-candidateList",
			candidate: "vmo-of-candidate", candidateLabel: "vmo-of-candidateLabel", candidateId: "vmo-of-candidateId",
		};
// 获取可用模型：走插件后端代理 /vision-config/discover-models。
			// 后端在凭据服务有完整访问权限——编辑已有提供方时 keyDraft 为空，
			// 后端会从凭据服务复用已有 key（客户端 API 面不暴露凭据值）。
			// modal 为当前表单数据；onCandidates(fresh[]) 拿到可用模型列表后由调用方打开弹窗；
			// showToast 提示；api 参数保留（不再使用，仅兼容已有调用方签名）。
			var fetchModelsFromProvider = function(modal, keyDraft, onCandidates, showToast, api, onError, isBuiltinProvider) {
				var provider = modal.data.provider || "";
				var baseURL = modal.data.baseUrl || "";
				var requestFormat = modal.data.requestFormat || "";
				if(requestFormat === "openai") requestFormat = "openai-completions";
				// 内置提供方（opencode-go 等）的模型在 pi-ai 目录里，探测走目录捷径不需要地址。
				// isBuiltinProvider 由调用方（组件内）计算传入——本函数在组件外，拿不到 providers state
				if(!provider || (!baseURL && !isBuiltinProvider)){
						showToast("缺少提供方或 API 地址");
						if(typeof onError==="function") onError();
						return;
					}
					// 超时兜底：后端挂起时也能结束 loading 状态（AbortController 中止 fetch）
					var ctrl = typeof AbortController!=="undefined" ? new AbortController() : null;
					var timer = ctrl ? setTimeout(function(){ ctrl.abort(); }, 15000) : null;
					var done = function(){ if(timer){ clearTimeout(timer); timer = null; } };
					fetch("/vision-config/discover-models",{method:"POST", headers:{"content-type":"application/json", "x-vision-config-action":"discover-models"}, body: JSON.stringify({provider, baseUrl: baseURL, requestFormat, keyDraft: keyDraft || ""}), ...(ctrl ? {signal: ctrl.signal} : {})})
					.then(function(r){ return r.json().then(function(j){ return {ok:r.ok, body:j}; }); })
					.then(function(res){
						done();
						if(!res.ok){ showToast(res.body.error || "获取模型失败"); if(typeof onError==="function") onError(); return; }
						var found = res.body.models;
						if(!Array.isArray(found) || found.length===0){
							showToast("该提供方没有列出任何模型，请手动添加。");
							if(typeof onError==="function") onError();
							return;
						}
						var known = Array.isArray(modal.models) ? modal.models.map(function(m){ return m.id; }) : [];
						var fresh = [];
						for(var i=0;i<found.length;i++){
							var c = found[i];
							if(!c || typeof c.id!=="string" || known.indexOf(c.id)>=0) continue;
							var entry = { id: c.id };
							if(typeof c.name==="string" && c.name.length>0) entry.name = c.name;
							fresh.push(entry);
						}
						if(typeof onCandidates==="function") onCandidates(fresh);
					}).catch(function(e){
						done();
						if(e && (e.name==="AbortError" || e.name==="TimeoutError")){
							showToast("获取模型超时，请重试");
						} else {
							showToast(e && e.message ? e.message : String(e));
						}
						if(typeof onError==="function") onError();
					});
				};
		// 官方模型页未暴露子插槽；按《AGENTS.md》插件只能注册新的 settings.section
		// 分页，左侧导航与“模型”并列。此为官方推荐做法，完全不依赖 DOM 猜测。
		// ---- 免费视觉模型模块（设置页下半区「免费视觉模型」） ----
		// 设计来源：
		//   · dsh-vision-router（ysr666）：免 Key 的 OVHcloud 匿名免费链、内置 provider 预设
		//   · ModLens（liustack）：渠道级密钥 + 一个 ref 多把 key 轮换 + 失败降级链 + 结构化证据
		// 关键约束：密钥只写宿主凭据服务（api.credentials.set({ref, value})），
		// 渠道条目里只有 keyRef 名字、模型条目里只有 model id —— 密钥永不进入模型。
		var FreeModelsModule = function(props){
			var api = props && props.api ? props.api : null;
			var showToast = props && typeof props.showToast === "function" ? props.showToast : function(){};
			var createElement = react.createElement;
			var useState = react.useState;
			var useEffect = react.useEffect;
			var useRef = react.useRef;
			var dataState = useState(null);
			var data = dataState[0], setData = dataState[1];
			var loadingState = useState(true);
			var loading = loadingState[0], setLoading = loadingState[1];
			var errState = useState(null);
			var err = errState[0], setErr = errState[1];
			var busyState = useState(false);
			var busy = busyState[0], setBusy = busyState[1];
			var testingState = useState("");
			var testing = testingState[0], setTesting = testingState[1];
			var keyOpenState = useState("");
			var keyOpen = keyOpenState[0], setKeyOpen = keyOpenState[1];
			var keyDraftState = useState("");
			var keyDraft = keyDraftState[0], setKeyDraft = keyDraftState[1];
			var probeState = useState(null);
			var probe = probeState[0], setProbe = probeState[1];
			var draftState = useState({});
			var drafts = draftState[0], setDrafts = draftState[1];
			// 模块默认折叠：点头部展开（会话内记忆，不写后端）
			var openState = useState(false);
			var open = openState[0], setOpen = openState[1];
			// 「免费模型」分组框也默认折叠：展开后只看到分组头，点击才列出渠道卡
			var groupOpenState = useState(false);
			var groupOpen = groupOpenState[0], setGroupOpen = groupOpenState[1];
			// 拖拽排序进行中的条目（ch:<渠道>:<模型>）
			var dragEntryRef = useRef(null);

			var load = function(){
				setLoading(true); setErr(null);
				fetch("/vision-config/free-channels")
					.then(function(r){ return r.json().then(function(j){ return {ok:r.ok, status:r.status, body:j}; }); })
					.then(function(res){
						setLoading(false);
						if(!res.ok){ setErr((res.body && res.body.error) || ("HTTP "+res.status)); return; }
						setData(res.body);
					})
					.catch(function(e){ setLoading(false); setErr(e && e.message ? e.message : String(e)); });
			};
			useEffect(function(){ load(); }, []);

			// 保存渠道数组（PUT 全量）：成功用后端回包刷新本地状态，避免前端状态漂移
			var save = function(next, extra, okMsg, quiet){
				setBusy(true);
				var body = { channels: next };
				if(extra){ for(var k in extra){ body[k] = extra[k]; } }
				return fetch("/vision-config/free-channels", {method:"PUT", headers:{"content-type":"application/json", "x-vision-config-action":"free-channels"}, body: JSON.stringify(body)})
					.then(function(r){ return r.json().then(function(j){ return {ok:r.ok, status:r.status, body:j}; }); })
					.then(function(res){
						setBusy(false);
						if(!res.ok){ showToast((res.body && res.body.error) || ("HTTP "+res.status)); return; }
						setData(res.body);
						if(okMsg && quiet !== true) showToast(okMsg);
					})
					.catch(function(e){ setBusy(false); showToast(e && e.message ? e.message : String(e)); });
			};
			var findChannel = function(id){
				if(!data || !Array.isArray(data.channels)) return null;
				for(var i=0;i<data.channels.length;i++){ if(data.channels[i].id===id) return data.channels[i]; }
				return null;
			};
			var patchChannel = function(id, patch, okMsg){
				if(!data) return;
				var next = data.channels.map(function(c){
					if(c.id !== id) return c;
					var copy = {}; for(var k in c){ copy[k] = c[k]; }
					for(var p in patch){ copy[p] = patch[p]; }
					return copy;
				});
				save(next, null, okMsg);
			};
			var patchGlobal = function(extra, okMsg){
				if(!data) return;
				save(data.channels, extra, okMsg);
			};
			var pinId = function(channelId, model){ return "ch:"+channelId+":"+model; };
			// 免费链路顺序：单个模型加入/移除、上下移动（后端返回整份新载荷，直接 setData）
			var postChain = function(path, body, okMsg){
				setBusy(true);
				return fetch("/vision-config/free-chain/"+path, {method:"POST", headers:{"content-type":"application/json", "x-vision-config-action":"free-chain"}, body: JSON.stringify(body)})
					.then(function(r){ return r.json().then(function(j){ return {ok:r.ok, status:r.status, body:j}; }); })
					.then(function(res){
						setBusy(false);
						if(!res.ok){ showToast((res.body && res.body.error) || ("HTTP "+res.status)); return; }
						setData(res.body);
						if(okMsg) showToast(okMsg);
					})
					.catch(function(e){ setBusy(false); showToast(e && e.message ? e.message : String(e)); });
			};
			var toggleChainModel = function(channelId, model, on){
				postChain("toggle", {channelId:channelId, model:model, on:on===true}, on===true ? "已加入免费链路（排在末尾）" : "已移出免费链路");
			};
			var moveChainStep = function(entry, direction){
				postChain("move", {entry:entry, direction:direction}, null);
			};
			// 拖拽排序：把 fromEntry 移到 toEntry 之前，整表提交后端校验
			var reorderChain = function(fromEntry, toEntry){
				var next = (Array.isArray(data.freeChainOrder) ? data.freeChainOrder : []).slice();
				var at = next.indexOf(fromEntry);
				var target = next.indexOf(toEntry);
				if (at === -1 || target === -1 || at === target) return;
				next.splice(at, 1);
				next.splice(next.indexOf(toEntry), 0, fromEntry);
				postChain("reorder", { order: next }, null);
			};

			var saveKey = function(ref, value){
				if(!api || typeof api.credentials !== "object" || typeof api.credentials.set !== "function"){
					showToast("当前连接不支持写入凭据，请用 dsh 设置页写入或改 .credentials.yaml");
					return;
				}
				if(!value || value.trim().length===0){ showToast("请输入密钥（多把可用逗号分隔）"); return; }
				setBusy(true);
				api.credentials.set({ ref: ref, value: value.trim() })
					.then(function(r){
						setBusy(false);
						var ok = r && r.result && r.result.ok;
						if(!ok){
							showToast((r && r.result && r.result.error && r.result.error.message) || "写入被拒绝（可能被只读环境变量遮蔽）");
							return;
						}
						setKeyDraft(""); setKeyOpen("");
						showToast("密钥已写入 DSH 凭据："+ref);
						load();
					})
					.catch(function(e){ setBusy(false); showToast(e && e.message ? e.message : String(e)); });
			};
			var clearKey = function(ref){
				if(!api || typeof api.credentials !== "object" || typeof api.credentials.unset !== "function"){
					showToast("当前连接不支持删除凭据，请在 .credentials.yaml 里删除该引用");
					return;
				}
				setBusy(true);
				api.credentials.unset({ ref: ref })
					.then(function(r){
						setBusy(false);
						if(r && r.result && r.result.ok === false){
							showToast((r.result.error && r.result.error.message) || "删除被拒绝（可能被只读环境变量遮蔽）");
							return;
						}
						showToast("已删除凭据："+ref);
						load();
					})
					.catch(function(e){ setBusy(false); showToast(e && e.message ? e.message : String(e)); });
			};

			// 探测请求号：连点/换渠道时，过期回包直接丢弃，避免把 A 渠道的候选贴到 B 渠道上
			var probeToken = 0;
			var probeChannel = function(id){
				var token = ++probeToken;
				setProbe({ channelId:id, loading:true, models:[], selected:{}, error:null, token:token });
				fetch("/vision-config/free-discover", {method:"POST", headers:{"content-type":"application/json", "x-vision-config-action":"free-discover"}, body: JSON.stringify({ channelId:id })})
					.then(function(r){ return r.json().then(function(j){ return {ok:r.ok, status:r.status, body:j}; }); })
					.then(function(res){
						if(token !== probeToken) return; // 已被更新的请求取代
						if(!res.ok){
							setProbe({ channelId:id, loading:false, models:[], selected:{}, error:(res.body && res.body.error) || ("HTTP "+res.status) });
							return;
						}
						var models = Array.isArray(res.body.models) ? res.body.models : [];
						var selected = {};
						for(var i=0;i<models.length;i++){
							// 默认勾选「声明支持图片」的；未声明模态的也勾上（很多网关不报 modalities）
							if(models[i].vision !== false) selected[models[i].id] = true;
						}
						setProbe({
							channelId:id, loading:false, models:models, selected:selected, error:null,
							keyRef:(res.body && res.body.keyRef) || "", keySource:(res.body && res.body.keySource) || "",
						});
					})
					.catch(function(e){ if(token !== probeToken) return; setProbe({ channelId:id, loading:false, models:[], selected:{}, error:String(e) }); });
			};
			var applyProbe = function(id){
				if(!probe || probe.channelId !== id) return;
				var channel = findChannel(id);
				if(!channel) return;
				var list = Array.isArray(channel.models) ? channel.models.slice() : [];
				var added = 0;
				for(var k in probe.selected){
					if(probe.selected[k] === true && list.indexOf(k) < 0){ list.push(k); added++; }
				}
				setProbe(null);
				patchChannel(id, { models:list }, added>0 ? ("已加入 "+added+" 个模型") : "没有新增模型");
			};
			var runTest = function(id){
				setTesting(id);
				fetch("/vision-config/free-test", {method:"POST", headers:{"content-type":"application/json", "x-vision-config-action":"free-test"}, body: JSON.stringify({ channelId:id })})
					.then(function(r){ return r.json().then(function(j){ return {ok:r.ok, status:r.status, body:j}; }); })
					.then(function(res){
						setTesting("");
						var b = (res && res.body) || {};
						if(b.ok === true){
							var text = typeof b.text === "string" ? b.text.replace(/\s+/g," ").slice(0,60) : "OK";
							showToast("渠道可用（"+(b.ms||0)+"ms）："+text);
						} else {
							showToast("渠道不可用："+(b.message || ("HTTP "+(res && res.status))));
						}
					})
					.catch(function(e){ setTesting(""); showToast(String(e)); });
			};

			var blockCls = "vmo-free-block";
			var summaryHeader = function(metaText, extra){
				return createElement.apply(null, ["button",{type:"button", key:"head", className:"vmo-free-summary"+(open===true?" vmo-free-summary-open":""),
					"aria-expanded":open===true, onClick:function(){ setOpen(!open); }},
					createElement("span",{className:"vmo-free-summary-chevron", "aria-hidden":"true"}, IconChevronDownOutline14 !== null ? createElement(IconChevronDownOutline14,{size:12}) : "›"),
					createElement("span",{className:"vmo-free-summary-title"}, "免费视觉模型"),
					createElement("span",{className:"vmo-free-summary-meta"}, metaText)
				].concat(extra || []));
			};
			if(loading && data === null){
				return createElement("section",{className:blockCls, "aria-label":"免费视觉模型"},
					summaryHeader("加载中…"), createElement("p",{className:"vmo-free-meta"}, "内置免费渠道 + 免费链路设置（点击展开）。"));
			}
			if(data === null){
				return createElement("section",{className:blockCls, "aria-label":"免费视觉模型"},
					summaryHeader("加载失败"),
					createElement("div",{className:C.error}, "加载失败："+(err||"未知错误")+" ",
						createElement("button",{className:C.linkButton, onClick:load},"重试")));
			}

			var toggleCard = function(checked, onToggle, label, hint){
				return createElement("label",{className:"vmo-free-toggleCard"},
					createElement("input",{type:"checkbox", checked:checked===true, disabled:busy, onChange:onToggle}),
					createElement("span",null, label, createElement("span",{className:"vmo-free-toggle-hint"}, hint)));
			};
			var toggles = createElement("div",{className:"vmo-free-toggles"},
				toggleCard(data.freeChainEnabled===true,
					function(){ patchGlobal({freeChainEnabled: data.freeChainEnabled!==true}, data.freeChainEnabled!==true ? "已开启免费链路" : "已关闭免费链路"); },
					"免费链路（自动降级）",
					data.freeChainEnabled===true ? "已开启：选择「免费链路」后按下面的顺序逐个尝试" : "已关闭：仍可在选择器里选具体免费渠道模型"),
				toggleCard(data.freeKeylessFallback===true,
					function(){ patchGlobal({freeKeylessFallback: data.freeKeylessFallback!==true}, null); },
					"免 Key 渠道兜底",
					"开启后，免 Key 的 OVHcloud 匿名层固定排在链路最后兜底（无需启用它）"),
				toggleCard(data.freeEvidence===true,
					function(){ patchGlobal({freeEvidence: data.freeEvidence!==true}, data.freeEvidence!==true ? "已开启结构化证据模式" : "已恢复自然语言描述"); },
					"结构化证据模式（ModLens 思路）",
					"识图提示词改为要求 JSON 证据：summary / transcription / layout / entities / relations / uncertainty"));

			var chain = Array.isArray(data.chain) ? data.chain : [];
			// 标签独占一行，步骤条另起一行（每个步骤自带序号，自动换行也不会和标签挤在一起）
			var chain = Array.isArray(data.chain) ? data.chain : [];
			var order = Array.isArray(data.freeChainOrder) ? data.freeChainOrder : [];
			var chainEl = createElement("div",{className:"vmo-free-chainBlock"},
				createElement("div",{className:"vmo-free-chainLabel"}, "免费链路顺序："),
				chain.length === 0
					? createElement("p",{className:"vmo-free-meta", key:"empty"}, "还没有模型在链路里：在下面点击模型 id 加入，或勾选渠道的「加入链路」。")
					: createElement("div",{className:"vmo-free-chain", key:"steps"},
						chain.map(function(step, idx){
							var controls = [];
							if(step.manual === true){
								controls.push(
									createElement("button",{key:"up", type:"button", className:"vmo-free-stepBtn", disabled:busy, title:"上移", "aria-label":"上移 "+step.model, onClick:function(){ moveChainStep(step.entry, "up"); }}, "↑"),
									createElement("button",{key:"down", type:"button", className:"vmo-free-stepBtn", disabled:busy, title:"下移", "aria-label":"下移 "+step.model, onClick:function(){ moveChainStep(step.entry, "down"); }}, "↓"),
									createElement("button",{key:"x", type:"button", className:"vmo-free-stepBtn", disabled:busy, title:"移出免费链路", "aria-label":"移出 "+step.model, onClick:function(){ toggleChainModel(step.channelId, step.model, false); }}, "×"));
							} else {
								controls.push(createElement("span",{key:"fb", className:"vmo-free-badge"}, "兜底"));
							}
							return createElement("span",{key:step.entry, className:"vmo-free-chain-step",
								draggable: step.manual === true,
								title: step.manual === true ? (step.channelName+" · "+step.model+"（可拖拽排序）") : (step.channelName+" · "+step.model+"（免 Key 兜底，固定在最后）"),
								onDragStart: function(e){ dragEntryRef.current = step.entry; try { e.dataTransfer.setData("text/plain", step.entry); e.dataTransfer.effectAllowed = "move"; } catch (_e) {} },
								onDragOver: function(e){ if (dragEntryRef.current !== null && dragEntryRef.current !== step.entry) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } },
								onDrop: function(e){ e.preventDefault(); var from = dragEntryRef.current; dragEntryRef.current = null; if (from !== null && from !== step.entry) reorderChain(from, step.entry); }},
								createElement("span",{className:"vmo-free-chain-step-copy"}, (idx+1)+". "+(step.channelName||step.channelId)+" · "+step.model),
								controls.length>0 ? createElement("span",{style:{display:"inline-flex",gap:"2px",marginLeft:"4px"}}, controls) : null);
						})));

			var cards = (Array.isArray(data.channels) ? data.channels : []).map(function(ch){
				var ks = (data.keyStatus && data.keyStatus[ch.id]) || {};
				var chModels = Array.isArray(ch.models) ? ch.models : [];
				var preset = null;
				var presets = Array.isArray(data.presets) ? data.presets : [];
				for(var pi=0; pi<presets.length; pi++){ if(presets[pi] && presets[pi].id===ch.id){ preset = presets[pi]; break; } }
				var keyless = ch.keyless === true;
				var allInChain = chModels.length > 0 && chModels.every(function(m){ return order.indexOf(pinId(ch.id, m)) >= 0; });
				var configured = keyless === true || ks.configured === true;
				var dotCls = C.credentialDot + " " + (configured ? C.credentialDotConfigured : C.credentialDotMissing);
				var refName = (ks.keyRef && ks.keyRef.length>0) ? ks.keyRef : (ch.keyRef && ch.keyRef.length>0 ? ch.keyRef : "");
				var dotTitle = keyless ? "免 Key 渠道（无需密钥）"
					: (ks.configured ? ("已配置密钥"+(ks.keyCount>1?("（"+ks.keyCount+" 把，鉴权/限流/额度失败时轮换）"):"")+" · 引用 "+(refName||"—")) : ("未配置密钥 · 引用 "+(refName||"—")));
				var isOpen = keyOpen === ch.id;
				var p = (probe && probe.channelId === ch.id) ? probe : null;
				var draft = typeof drafts[ch.id] === "string" ? drafts[ch.id] : "";
				var children = [];

				children.push(createElement("div",{className:"vmo-free-cardHead", key:"head"},
					createElement("div",{className:"vmo-free-cardTitle"},
						createElement("span",{className:dotCls, role:"img", title:dotTitle, "aria-label":dotTitle}),
						createElement("span",{className:C.rowName, title:ch.name}, ch.name || ch.id),
						createElement("span",{className:C.rowTag}, ch.id),
						keyless ? createElement("span",{className:"vmo-free-badge"},"免 Key") : null,
						preset && preset.directCN ? createElement("span",{className:"vmo-free-badge"},"大陆直连") : null,
						ch.builtin === true ? createElement("span",{className:"vmo-free-badge"},"内置") : null
					),
					createElement("div",{className:"vmo-free-cardActions"},
						keyless ? null : createElement("label",{className:"vmo-free-toggle", style:{margin:0, alignItems:"center"}},
							createElement("input",{type:"checkbox", checked:allInChain, disabled:busy, title:"把该渠道的全部模型加入免费链路（追加到末尾）；取消勾选则全部移出",
								onChange:function(){ patchChannel(ch.id, {enabled: allInChain!==true}, allInChain!==true ? (ch.name+" 已全部加入免费链路") : (ch.name+" 已全部移出免费链路")); }}),
							createElement("span",null,"全部加入")),
						keyless ? null : createElement("button",{type:"button", className:C.secondaryButton, disabled:busy, title:"配置/更换该渠道的 API 密钥（写入宿主凭据服务）", onClick:function(){ setKeyOpen(isOpen?"":ch.id); setKeyDraft(""); }}, isOpen ? "收起" : "密钥"),
						createElement("button",{type:"button", className:C.secondaryButton, disabled:busy, title:"从渠道实时拉取可用模型列表", onClick:function(){ probeChannel(ch.id); }}, "探测模型"),
						createElement("button",{type:"button", className:C.secondaryButton, disabled:busy||testing===ch.id, title:"用 1×1 图片实测该渠道连通性", onClick:function(){ runTest(ch.id); }}, testing===ch.id ? "测试中…" : "测试"))));

				children.push(createElement("p",{className:"vmo-free-meta", key:"meta"},
					(preset && preset.quota ? preset.quota + "。 " : "")
					+ (preset && preset.note ? preset.note + " " : "")
					+ (keyless
						? "由「免 Key 渠道兜底」开关控制，固定排在链路最后；点击上面的模型 id 可把它提为手动项。"
						: ("密钥引用：" + (refName || "—") + (ks.keyCount>1 ? ("（当前 " + ks.keyCount + " 把，逗号分隔可轮换）") : "") + (ks.writable===true ? "" : "（只读：由环境变量提供）")))));

				if(isOpen && !keyless){
					children.push(createElement("div",{className:"vmo-free-keyRow", key:"key"},
						createElement("input",{
							className:"vmo-free-keyInput", type:"password", autoComplete:"off",
							placeholder: ks.configured===true ? "已配置（留空则不变）；多把 key 用逗号分隔" : "粘贴 API 密钥；多把 key 用逗号分隔，失败自动轮换",
							value:keyDraft, onChange:function(e){ setKeyDraft(e.target.value); },
							"aria-label":"渠道 API 密钥",
						}),
						createElement("button",{type:"button", className:C.primaryButton, disabled:busy, onClick:function(){ saveKey(refName, keyDraft); }}, "保存到凭据服务"),
						(ks.configured===true && typeof api==="object" && api && typeof api.credentials==="object" && typeof api.credentials.unset==="function")
							? createElement("button",{type:"button", className:C.secondaryButton+" "+C.dangerButton, disabled:busy, onClick:function(){ clearKey(refName); }}, "删除凭据")
							: null));
				}

				var chips = chModels.map(function(model){
					var entryId = pinId(ch.id, model);
					var selected = order.indexOf(entryId) >= 0;
					return createElement("span",{key:model, className:"vmo-free-chip"+(selected?" vmo-free-chip-on":"")},
						createElement("button",{type:"button", className:"vmo-free-chip-toggle", disabled:busy,
							title: selected ? "已在免费链路里；点击把它移出" : "点击加入免费链路（追加到链路末尾）",
							"aria-pressed":selected,
							onClick:function(){ toggleChainModel(ch.id, model, !selected); }},
							createElement("span",{className:"vmo-free-chip-id"}, model),
							selected ? createElement("span",{"aria-hidden":"true"}, "✓") : null),
						createElement("button",{type:"button", className:"vmo-free-chipX", disabled:busy,
							title:"从该渠道删除此模型", "aria-label":"删除 "+model,
							onClick:function(){
								var list = chModels.filter(function(m){ return m !== model; });
								patchChannel(ch.id, {models:list}, null);
							}}, "×"));
				});
				children.push(createElement("div",{className:"vmo-free-chipRow", key:"models"}, chips.length>0 ? chips : createElement("span",{className:"vmo-free-meta"},"还没有模型，用「探测可用模型」自动拉取，或在下面手动添加")));

				children.push(createElement("div",{className:"vmo-free-addRow", key:"add"},
					createElement("input",{className:"vmo-free-addInput", type:"text", placeholder:"手动添加模型 id（回车）", value:draft,
						onChange:function(e){ var next={}; for(var k in drafts){ next[k]=drafts[k]; } next[ch.id]=e.target.value; setDrafts(next); },
						onKeyDown:function(e){
							if(e.key !== "Enter") return;
							var value = (e.target.value||"").trim();
							if(value.length===0) return;
							if(chModels.indexOf(value)>=0) return;
							var next = {}; for(var k in drafts){ next[k]=drafts[k]; } next[ch.id]="";
							setDrafts(next);
							patchChannel(ch.id, {models: chModels.concat([value])}, null);
						},
						"aria-label":"添加模型 id"})));

				if(p){
					if(p.loading){
						children.push(createElement("p",{className:"vmo-free-meta", key:"probing"},"正在从渠道拉取模型列表…"));
					} else if(p.error){
						children.push(createElement("div",{className:C.error, key:"probeErr"},"探测失败："+p.error));
					} else {
						var rows = p.models.map(function(m){
							var checked = p.selected[m.id] === true;
							return createElement("label",{key:m.id, className:"vmo-free-candidate"},
								createElement("input",{type:"checkbox", checked:checked, onChange:function(){
									var next = {}; for(var k in p.selected){ next[k]=p.selected[k]; }
									next[m.id] = !checked;
									setProbe({channelId:p.channelId, loading:false, models:p.models, selected:next, error:null, keyRef:p.keyRef, keySource:p.keySource, token:p.token});
								}}),
								createElement("span",{className:"vmo-free-candidate-id", title:m.name}, m.id),
								m.vision===true ? createElement("span",{className:"vmo-free-badge"},"声明图片") : null,
								m.free===true ? createElement("span",{className:"vmo-free-badge"},"免费") : null);
						});
						children.push(createElement("div",{key:"probeResult", style:{display:"flex",flexDirection:"column",gap:"6px"}},
							createElement("p",{className:"vmo-free-meta"},"发现 "+p.models.length+" 个模型（keyRef "+(p.keyRef||"—")+"，来源 "+p.keySource+"）"),
							rows.length>0 ? createElement("div",{className:"vmo-free-candidates"}, rows) : createElement("p",{className:"vmo-free-meta"},"该渠道没有返回任何模型，可手动添加。"),
							createElement("div",{style:{display:"flex",gap:"6px",justifyContent:"flex-end"}},
								createElement("button",{type:"button", className:C.secondaryButton, onClick:function(){ setProbe(null); }},"取消"),
								createElement("button",{type:"button", className:C.primaryButton, disabled:busy, onClick:function(){ applyProbe(ch.id); }},"加入所选"))));
					}
				}

				return createElement("div",{key:ch.id, className:C.rowCard}, children);
			});

			// 折叠头摘要：渠道数 / 链路状态 / 免Key兜底与证据开关的开关状态
			var chainCount = Array.isArray(data.chain) ? data.chain.length : 0;
			var enabledCount = (Array.isArray(data.channels) ? data.channels : []).filter(function(c){ return c && c.enabled === true; }).length;
			var meta = (Array.isArray(data.channels) ? data.channels.length : 0) + " 个渠道"
				+ (data.freeChainEnabled === true ? " · 链路 " + chainCount + " 个备用" : " · 链路已关")
				+ " · 已启用 " + enabledCount;
			// 「免费模型」分组框：一个框装全部渠道卡，头部可点击展开/收起
			var groupHeader = createElement("button",{type:"button", key:"groupHead",
				className:"vmo-free-summary"+(groupOpen===true?" vmo-free-summary-open":""),
				"aria-expanded":groupOpen===true,
				onClick:function(){ setGroupOpen(!groupOpen); }},
				createElement("span",{className:"vmo-free-summary-chevron", "aria-hidden":"true"}, IconChevronDownOutline14 !== null ? createElement(IconChevronDownOutline14,{size:12}) : "›"),
				createElement("span",{className:"vmo-free-summary-title"}, "免费模型配置"),
				createElement("span",{className:"vmo-free-summary-meta"},
					(Array.isArray(data.channels) ? data.channels.length : 0)+" 个渠道 · 已启用 "+enabledCount));
			var groupBox = createElement("div",{className:"vmo-free-group", key:"group"},
				groupHeader,
				groupOpen === true
					? createElement("div",{className:"vmo-free-groupBody"}, cards)
					: createElement("p",{className:"vmo-free-meta", key:"groupHint"}, "点击展开渠道列表：逐个配置密钥、探测模型、测试连通性。"));
			var body = open !== true
				? [createElement("p",{className:"vmo-free-meta", key:"hint"},
					"点击展开：免费渠道（免 Key 的 OVHcloud 匿名层开箱即用）、渠道级密钥与免费链路降级设置。")]
				: [createElement("p",{className:C.intro, key:"intro"},
					"内置免费渠道：免 Key 的 OVHcloud 匿名层开箱即用，其余渠道只需在渠道级填一次密钥（写进宿主凭据服务，不在模型条目里）。免费链路会按顺序尝试、失败自动降级。"),
				toggles, chainEl, groupBox,
				createElement("p",{key:"note", className:"vmo-free-meta"},
					"说明：密钥写入 DSH 凭据服务（~/.dsh/.credentials.yaml），渠道与「设置 → 模型」共用同一份凭据；",
					"插件配置里只保存引用名与模型 id，任何模型条目都不含密钥。")];
			return createElement.apply(null, ["section",{className:blockCls, "aria-label":"免费视觉模型"},
				summaryHeader(meta)].concat(body));
		};

		var VisionSettingsSection = function(props) {
			var injected = props && props.injected ? props.injected : {};
			var api = injected.api || null;
			var protocols = Array.isArray(injected.protocols) ? injected.protocols : [];
			var useState = react.useState;
			var useEffect = react.useEffect;
			var createElement = react.createElement;
			// llm-pi-ai 模型的 input 声明索引（原始 user 段）：key = provider + "/" + modelId
			var imageInputMapState = useState({});
			var imageInputMap = imageInputMapState[0], setImageInputMap = imageInputMapState[1];
			var modelsState = useState([]);
			var models = modelsState[0];
			var setModels = modelsState[1];
			// 渠道级凭据 ref（后端计算：宿主路由 apiKeyEnv 优先 + 插件派生 ref；每个渠道只用自己的 key）
			var keyRefsState = useState({});
			var keyRefs = keyRefsState[0];
			var setKeyRefs = keyRefsState[1];
			var configState = useState(null);
			var config = configState[0];
			var setConfig = configState[1];
			var loadingState = useState(true);
			var loading = loadingState[0];
			var setLoading = loadingState[1];
			var errState = useState(null);
			var err = errState[0];
			var setErr = errState[1];
			var busyState = useState(false);
			var busy = busyState[0];
			var setBusy = busyState[1];
			var modalState = useState(null);
			var modal = modalState[0];
			var setModal = modalState[1];
			// API 密钥草稿独立状态（官方 ProviderEditor 同款：draft 与 keyDraft 各一个 useState）。
			// 存在 modal 对象里会被任何 setModal 重建路径覆盖丢失，表现为密钥莫名被清空。
			var keyDraftState = useState("");
			var keyDraft = keyDraftState[0];
			var setKeyDraft = keyDraftState[1];
			var delState = useState(null);
			var delTarget = delState[0];
			var setDelTarget = delState[1];
			var toast2State = useState(null);
			var toast2 = toast2State[0];
			var setToast2 = toast2State[1];
			var pickerState = useState(null);
			var picker = pickerState[0];
			var setPicker = pickerState[1];

			var systemModelsState = useState([]);
			var systemModels = systemModelsState[0];
			var setSystemModels = systemModelsState[1];
			var providersState = useState([]);
			var providers = providersState[0];
			var setProviders = providersState[1];
			var importingState = useState(null);
			var importing = importingState[0];
			var setImporting = importingState[1];
			var expandedState = useState({});
			var expanded = expandedState[0];
			var setExpanded = expandedState[1];
			var dismissedState = useState({});
			var dismissed = dismissedState[0];
			var setDismissed = dismissedState[1];
			var isExpanded = function(p){ return expanded[p] === true; };
			var toggleExpand = function(p){ var n={}; for(var k in expanded) n[k]=expanded[k]; n[p]=!n[p]; setExpanded(n); };
			var fetchAll = function(){
				setLoading(true);
				Promise.all([
					fetch("/vision-config/vision-models",{headers:{accept:"application/json"}}).then(function(r){ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); }).catch(function(){ return {models:[]}; }),
					fetch("/vision-config/config",{headers:{accept:"application/json"}}).then(function(r){ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); }).catch(function(){ return null; }),
					fetch("/vision-config/models",{headers:{accept:"application/json"}}).then(function(r){ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); }).catch(function(){ return {systemGroups:[]}; }),
					fetch("/vision-config/providers",{headers:{accept:"application/json"}}).then(function(r){ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); }).catch(function(){ return {providers:[]}; })
				]).then(function(res){
					var vm = res[0];
					var cfg = res[1];
					var sys = res[2];
					var prov = res[3];
					if(vm && Array.isArray(vm.models)) setModels(vm.models);
					else setModels([]);
					if(vm && vm.keyRefs && typeof vm.keyRefs==="object") setKeyRefs(vm.keyRefs);
					else setKeyRefs({});
					if(cfg) setConfig(cfg);
					// 恢复持久化的「忽略未导入系统模型」列表（× 掉的模型下次打开不再提示）
					if(cfg && Array.isArray(cfg.ignoredModels)){
						var dd = {};
						for(var _di=0; _di<cfg.ignoredModels.length; _di++) dd[cfg.ignoredModels[_di]] = true;
						setDismissed(dd);
					}
					if(prov && Array.isArray(prov.providers)) setProviders(prov.providers);
					else setProviders([]);
					var flat = [];
					if(sys && Array.isArray(sys.systemGroups)){
						for(var gi=0; gi<sys.systemGroups.length; gi++){
							var g=sys.systemGroups[gi];
							if(!g || typeof g.provider!=="string") continue;
							var ms=Array.isArray(g.models)?g.models:[];
							for(var mi=0; mi<ms.length; mi++){
								var m=ms[mi];
								if(!m || typeof m.id!=="string") continue;
								flat.push({provider:g.provider, model:m.id, name: typeof m.name==="string"?m.name:m.id});
							}
						}
					}
					setSystemModels(flat);
					setLoading(false);
					setErr(null);
				}).catch(function(e){
					setErr(e && e.message ? e.message : String(e));
					setLoading(false);
				});
			};
			useEffect(function(){ fetchAll(); }, []);
			// 读取 llm-pi-ai 原始 user 段，为「图片输入」开关建立索引（写路径与之对齐）
			useEffect(function(){
				var rs = api && typeof api.remoteSettings === "function" ? api.remoteSettings() : null;
				if (rs === null) return;
				rs.describe("llm-pi-ai").then(function(r){
					if (!r || r.ok !== true || !r.value) return;
					var user = r.value.user && r.value.user.providers ? r.value.user : null;
					if (user === null) return;
					var map = {};
					for (var pid in user.providers) {
						var models = user.providers[pid] && user.providers[pid].models;
						if (!Array.isArray(models)) continue;
						for (var i = 0; i < models.length; i++) {
							var m = models[i];
							if (m === null || typeof m !== "object" || typeof m.id !== "string") continue;
							var input = Array.isArray(m.input) ? m.input : ["text"];
							map[pid + "/" + m.id] = {
								path: ["providers", pid, "models", i, "input"],
								hasImage: input.indexOf("image") >= 0
							};
						}
					}
					setImageInputMap(map);
				}).catch(function(){ /* 读不到就不显示开关 */ });
			}, []);
			useEffect(function(){
				if(toast2===null) return;
				var t=setTimeout(function(){ setToast2(null); },3000);
				return function(){ clearTimeout(t); };
			},[toast2]);

			// 编辑已有提供方时检测凭据是否已配置（含同 baseUrl 共享 key）：
			// 已配置 → 密钥框显示「已配置——输入新值可替换」
			var keyConfiguredState = useState(false);
			var keyConfigured = keyConfiguredState[0];
			var setKeyConfigured = keyConfiguredState[1];
			useEffect(function(){
				if(!modal || (modal.mode!=="edit" && modal.mode!=="edit-custom")){ setKeyConfigured(false); return; }
				var p = modal.mode==="edit-custom" ? (modal.data.customProvider||"").trim() : (modal.data.provider||"").trim();
				if(p.length===0 || !api || typeof api.credentials!=="object" || typeof api.credentials.describe!=="function"){ setKeyConfigured(false); return; }
				var refs = [p.toUpperCase().replace(/[^A-Z0-9]+/g,"_")+"_API_KEY"];
				// 同 baseUrl 的其他渠道共享同一网关 key，一并探测
				var bu = (modal.data.baseUrl||"").trim().replace(/\/+$/,"");
				if(bu.length>0 && Array.isArray(models)){
					for(var _kc=0;_kc<models.length;_kc++){
						var _ke = models[_kc];
						if(_ke && _ke.provider!==p && typeof _ke.baseUrl==="string" && _ke.baseUrl.trim().replace(/\/+$/,"")===bu){
							refs.push(_ke.provider.toUpperCase().replace(/[^A-Z0-9]+/g,"_")+"_API_KEY");
						}
					}
				}
				api.credentials.describe({ refs: refs }).then(function(r){
					var configured = false;
					var creds = r && r.result && r.result.ok && r.result.value ? r.result.value.credentials : null;
					if(creds){
						for(var k in creds){ if(creds[k] && creds[k].configured === true){ configured = true; break; } }
					}
					setKeyConfigured(configured);
				}).catch(function(){ setKeyConfigured(false); });
			}, [modal]);

			// 渠道级密钥状态：探测每个提供方（渠道）是否已配置 API 密钥，在分组头
			// 名称旁画圆点，与官方「模型」页行内圆点同语义（已配置→绿点，未配置→红点，
			// 未知→不显示）。ref 集合 = 后端 keyRefs（宿主路由 apiKeyEnv 优先，如
			// deepseek-official→DEEPSEEK_API_KEY）∪ 客户端宿主路由 join ∪ 派生 ref。
			// 每个渠道只用自己的 key，不复用兄弟渠道（同网关）的 key。
			var keyStatusState = useState({});
			var keyStatus = keyStatusState[0];
			var setKeyStatus = keyStatusState[1];
			useEffect(function(){
				if(loading || err || !Array.isArray(models) || models.length===0){ setKeyStatus({}); return; }
				if(!api || typeof api.credentials!=="object" || typeof api.credentials.describe!=="function"){ setKeyStatus({}); return; }
				var refOf = function(p){ return p.toUpperCase().replace(/[^A-Z0-9]+/g,"_")+"_API_KEY"; };
				var providersOf = [];
				for(var _ks=0;_ks<models.length;_ks++){
					var _ke=models[_ks];
					if(!_ke || typeof _ke.provider!=="string" || _ke.provider.length===0) continue;
					if(providersOf.indexOf(_ke.provider)<0) providersOf.push(_ke.provider);
				}
				var finish = function(extraRefs){
					// extraRefs：provider → [refs]（后端 keyRefs 或客户端 join 的宿主路由 apiKeyEnv）
					var refs = [];
					var statusRefs = {};
					for(var _pi=0;_pi<providersOf.length;_pi++){
						var p = providersOf[_pi];
						var list = (extraRefs && Array.isArray(extraRefs[p])) ? extraRefs[p].slice() : [];
						if(list.indexOf(refOf(p))<0) list.push(refOf(p));
						// 每个渠道只用自己的 key：不复用同 baseUrl 兄弟渠道的 key
						statusRefs[p]=list;
						for(var _r=0;_r<list.length;_r++){ if(refs.indexOf(list[_r])<0) refs.push(list[_r]); }
					}
					if(refs.length===0){ setKeyStatus({}); return; }
					api.credentials.describe({ refs: refs }).then(function(r){
						var creds = r && r.result && r.result.ok && r.result.value ? r.result.value.credentials : null;
						if(!creds){ return; }
						var status = {};
						for(var _p2 in statusRefs){
							var ok=false;
							for(var _r2=0;_r2<statusRefs[_p2].length;_r2++){
								var _c=creds[statusRefs[_p2][_r2]];
								if(_c && _c.configured===true){ ok=true; break; }
							}
							status[_p2]= ok ? "configured" : "missing";
						}
						setKeyStatus(status);
					}).catch(function(){ /* 状态未知：保留上次已知状态，不显示圆点 */ });
				};
				if(keyRefs && typeof keyRefs==="object" && Object.keys(keyRefs).length>0){ finish(keyRefs); return; }
				// 后端未返回 keyRefs（旧 host）：客户端自行 join 宿主可配置路由的 apiKeyEnv，
				// 与官方「模型」页同源（api.llm.providers + settings.describe）。
				if(typeof api.llm!=="object" || typeof api.llm.providers!=="function"){ finish(null); return; }
				api.llm.providers({}).then(function(r){
					var provs = r && r.result && r.result.ok && r.result.value ? r.result.value.providers : null;
					if(!Array.isArray(provs)){ finish(null); return; }
					var byNs = {};
					for(var _i=0;_i<provs.length;_i++){
						var _pp=provs[_i];
						if(!_pp || typeof _pp.provider!=="string" || typeof _pp.settingsNs!=="string" || _pp.settingsNs.length===0) continue;
						if(!byNs[_pp.settingsNs]) byNs[_pp.settingsNs]=[];
						byNs[_pp.settingsNs].push(_pp);
					}
					var nsNames = Object.keys(byNs);
					if(nsNames.length===0 || typeof api.settings!=="object" || typeof api.settings.describe!=="function"){ finish(null); return; }
					api.settings.describe({}).then(function(dr){
						var views = dr && dr.result && dr.result.ok && dr.result.value ? dr.result.value.namespaces : null;
						var nsValues = {};
						if(Array.isArray(views)){ for(var _v=0;_v<views.length;_v++){ if(views[_v] && typeof views[_v].ns==="string") nsValues[views[_v].ns]=views[_v].value; } }
						var extra = {};
						for(var _n=0;_n<nsNames.length;_n++){
							var entries = byNs[nsNames[_n]];
							var root = nsValues[nsNames[_n]];
							for(var _e=0;_e<entries.length;_e++){
								var ent = entries[_e];
								var cur = root;
								var path = Array.isArray(ent.settingsPath) ? ent.settingsPath : [];
								for(var _k=0;_k<path.length;_k++){ if(cur===null || typeof cur!=="object"){ cur=undefined; break; } cur=cur[path[_k]]; }
								var env = (cur!==null && typeof cur==="object" && typeof cur.apiKeyEnv==="string" && cur.apiKeyEnv.length>0) ? cur.apiKeyEnv : null;
								if(env){ if(!extra[ent.provider]) extra[ent.provider]=[]; extra[ent.provider].push(env); }
							}
						}
						finish(extra);
					}).catch(function(){ finish(null); });
				}).catch(function(){ finish(null); });
			}, [models, loading, err, keyRefs]);

			var showToast = function(text){ setToast2(text); };

			var submitAddOrEdit = function(){
				if(!modal) return;
				var isCustom = modal.data.provider==="custom" || modal.data.providerType==="custom";
				var p = isCustom ? (modal.data.customProvider||"").trim() : (modal.data.provider||"").trim();
				if(isCustom && p.length===0){ showToast("请填写自定义提供方名称"); return; }
				// 自定义提供方名称格式：小写字母开头、仅小写字母/数字/连字符。
				// 宿主 route 键与派生凭据 ref 都依赖该格式，非法名会在凭据写入
				// （invalid payload）或运行期（NO_ADAPTER）被拒。
				if(isCustom && !/^[a-z][a-z0-9-]*$/.test(p)){ showToast("Provider ID 必须以小写字母开头，仅可含小写字母、数字、连字符（如 acme-gateway）"); return; }
				var m = (modal.data.model||"").trim();
				var n = (modal.data.name||"").trim();
				if(n.length===0) n = m;
				var d = (modal.data.description||"").trim();
				// 模型目录：显式 models 数组优先，否则用单个模型字段
				var modelList = Array.isArray(modal.models) && modal.models.length>0 ? modal.models.slice() : (m.length>0 ? [{ id: m }] : []);
				if(modelList.length===0){ showToast("请至少添加一个模型"); return; }
				if(p.length===0){ showToast("提供方为必填"); return; }
				if(isCustom){
					var bu = (modal.data.baseUrl||"").trim();
					if(bu.length===0){ showToast("请填写 API 地址"); return; }
				}
				setBusy(true);
				var isEdit = modal.mode==="edit" || modal.mode==="edit-custom";
				var extra = {};
				if(isCustom){ extra.baseUrl = (modal.data.baseUrl||"").trim(); extra.requestFormat = modal.data.requestFormat||"openai-completions"; }
				// API 密钥：复用官方 credentials 域写入（ref = PROVIDER_API_KEY）；草稿在独立状态里
				// Provider ID 已在表单/提交处校验（小写字母开头、仅含小写字母数字连字符），
				// 派生出的 ref 必然匹配宿主 /^[A-Za-z_][A-Za-z0-9_]*$/，无需前缀补丁
				var keyRef = p.toUpperCase().replace(/[^A-Z0-9]+/g,"_")+"_API_KEY";
				// 返回 null=成功，字符串=失败原因（透传宿主 RPC 的 error message，
				// 如环境变量只读遮蔽/ref 非法——否则用户只看到笼统的「保存失败」无法定位）
				var keyWrite = keyDraft.trim().length>0 && api && typeof api.credentials==="object" && typeof api.credentials.set==="function"
					? api.credentials.set({ ref: keyRef, value: keyDraft.trim() })
						.then(function(r){ return (r && r.result && r.result.ok) ? null : ((r && r.result && r.result.error && r.result.error.message) || "写入被拒绝"); })
						.catch(function(e){ return e && e.message ? e.message : String(e); })
					: Promise.resolve(null);
				keyWrite.then(function(keyErr){
					if(keyErr){ setBusy(false); showToast("API 密钥保存失败："+keyErr); return; }
					if(isEdit){
						// 编辑模式：批量更新整个提供方及其所有模型（官方 provider 级编辑语义）。
						// models 里的条目带 _entryId 用于后端区分更新/新增/删除。
					var bodyObj = { provider: p, models: modelList.map(function(mm){ return { id: mm.id, name: mm.name||"", entryId: mm._entryId||"" }; }) };
					if(isCustom){ bodyObj.baseUrl = extra.baseUrl; bodyObj.requestFormat = extra.requestFormat; }
					bodyObj.displayName = (modal.data.displayName||"").trim();
						fetch("/vision-config/vision-models",{method:"PUT", headers:{"content-type":"application/json", "x-vision-config-action":"vision-models"}, body: JSON.stringify(bodyObj)})
						.then(function(r){ return r.json().then(function(j){ return {ok:r.ok,status:r.status,body:j}; }); })
						.then(function(res){
							setBusy(false);
							if(!res.ok){ showToast(res.body.error || ("HTTP "+res.status)); return; }
							setModels(res.body.models || []);
							if(res.body && res.body.keyRefs) setKeyRefs(res.body.keyRefs);
							setPicker(null);
							setModal(null);
							setKeyDraft("");
							showToast("已更新");
						}).catch(function(e){ setBusy(false); showToast(String(e)); });
					} else {
						// 新增模式：为目录中每个模型创建独立 Vision 条目
						var toCreate = modelList.slice();
						var created = 0;
						var skipped = 0;
						var failed = 0;
						var nextCreate = function(){
						if(toCreate.length===0){
							setBusy(false);
							setPicker(null);
							setModal(null);
							setKeyDraft("");
							fetchAll();
								if(failed===0) showToast("已添加 "+created+" 个模型"+(skipped>0?"（跳过 "+skipped+" 个重复）":""));
								else showToast("添加完成：成功 "+created+" 个，失败 "+failed+" 个");
								return;
							}
							var entry = toCreate.shift();
						var modelName = typeof entry.name==="string" && entry.name.trim().length>0 ? entry.name : entry.id;
						var bodyObj = { provider:p, model: entry.id, name:modelName, description:d };
						if(isCustom){ bodyObj.baseUrl = extra.baseUrl; bodyObj.requestFormat = extra.requestFormat; }
						bodyObj.displayName = (modal.data.displayName||"").trim();
							fetch("/vision-config/vision-models",{method:"POST", headers:{"content-type":"application/json", "x-vision-config-action":"vision-models"}, body: JSON.stringify(bodyObj)})
							.then(function(r){ return r.json().then(function(j){ return {ok:r.ok, status:r.status, body:j}; }); })
							.then(function(res){
								if(res.ok){
									created++;
								} else if(res.status===409){
									skipped++;
								} else {
									failed++;
								}
								nextCreate();
							}).catch(function(e){
								failed++;
								nextCreate();
							});
						};
						nextCreate();
					}
				});
			};

			var doDelete = function(){
				if(!delTarget) return;
				setBusy(true);
				var url = delTarget.providerLevel
					? "/vision-config/vision-models?provider="+encodeURIComponent(delTarget.provider)
					: "/vision-config/vision-models?id="+encodeURIComponent(delTarget.id);
				fetch(url,{method:"DELETE", headers:{"x-vision-config-action":"vision-models"}})
				.then(function(r){ return r.json().then(function(j){ return {ok:r.ok,body:j}; }); })
				.then(function(res){
					setBusy(false);
					if(!res.ok){ showToast(res.body.error||"删除失败"); return; }
					setModels(res.body.models||[]);
					if(res.body && res.body.keyRefs) setKeyRefs(res.body.keyRefs);
					setDelTarget(null);
					showToast("已删除");
				}).catch(function(e){ setBusy(false); showToast(String(e)); });
			};

			var selectAsCurrent = function(vm){
				if(busy || !vm) return;
				setBusy(true);
				fetch("/vision-config/config",{method:"PUT", headers:{"content-type":"application/json", "x-vision-config-action":"config"}, body: JSON.stringify({provider: vm.provider, model: vm.model})})
				.then(function(r){ return r.json().then(function(j){ return {ok:r.ok, status:r.status, body:j}; }); })
				.then(function(res){
					setBusy(false);
					if(!res.ok){ showToast(res.body.error || ("设置失败 HTTP "+res.status)); return; }
					setConfig(res.body);
					showToast("已设为当前 Vision 模型："+vm.provider+"/"+vm.model);
				}).catch(function(e){ setBusy(false); showToast(String(e)); });
			};

			var isSelected = function(vm){
				return config && config.provider===vm.provider && config.model===vm.model;
			};

			// 每模型：提供方申报的推理档位（懒加载缓存）
			// 去重依据改为「持久 ref 同步锁」而不是状态实时值：
			// 状态一写入就会引发渲染 → effect 若依赖状态就会再次触发 → 死循环刷新风暴。
			var useRef = react.useRef;
			var reasonInfoState = useState({});
			var reasonInfo = reasonInfoState[0];
			var setReasonInfo = reasonInfoState[1];
			var reasonSeenState = useRef({});
			var reasonSeen = reasonSeenState.current;
			var ensureReasonInfo = function(vm){
				if(!vm) return;
				var k = vm.provider+"/"+vm.model;
				if(reasonSeen[k]) return;   // 同步持久锁：第一个请求到来前就已锁定，后续任何调用直接短路
				reasonSeen[k] = true;
				fetch("/vision-config/reasoning-levels?provider="+encodeURIComponent(vm.provider)+"&model="+encodeURIComponent(vm.model), {headers:{accept:"application/json"}})
					.then(function(r){ return r.json().catch(function(){ return null; }); })
					.then(function(j){
						// 用函数式更新合并，而不是从闭包快照复制：
						// 多个模型并发完成时，基于 React 保证的最新 prev 合并，互不覆盖
						setReasonInfo(function(prev){
							var n = {}; for(var x in prev) n[x]=prev[x];
							var eff = (j && Array.isArray(j.efforts)) ? j.efforts : [];
							// offSupported 三态：布尔=host 真值；其他(旧 host/未知)=按 efforts 兜底
							var os = (j && typeof j.offSupported === 'boolean')
								? j.offSupported
								: (eff.some(function(e){ var id=typeof e==="string"?e:((e&&e.id)||""); return id==="off"; }));
							n[k]={ efforts: eff, offSupported: os };
							return n;
						});
					}).catch(function(){
						setReasonInfo(function(prev){
							var n = {}; for(var x in prev) n[x]=prev[x]; n[k]={ efforts:[], offSupported:true }; return n;
						});
					});
			};
			// 每模型：保存推理策略
			var updateReasoning = function(vm, value){
				if(busy || !vm) return;
				setBusy(true);
				fetch("/vision-config/vision-models", {method:"PUT", headers:{"content-type":"application/json", "x-vision-config-action":"vision-models"}, body: JSON.stringify({id: vm.id, provider: vm.provider, model: vm.model, name: vm.name||"", displayName: vm.displayName||"", description: vm.description||"", baseUrl: vm.baseUrl||"", requestFormat: vm.requestFormat||"openai-completions", reasoning: value})})
					.then(function(r){ return r.json().then(function(j){ return {ok:r.ok, status:r.status, body:j}; }); })
					.then(function(res){
						setBusy(false);
						if(!res.ok){ showToast(res.body.error || ("保存失败 HTTP "+res.status)); return; }
						setModels(res.body.models || []);
						if(res.body && res.body.keyRefs) setKeyRefs(res.body.keyRefs);
						var label = value==="" ? "已设为默认（跟随提供方）" : value==="off" ? "已关闭思考（提供方支持时生效）" : "已设为强制关闭（实验，不保证成功）";
						showToast(label);
					}).catch(function(e){ setBusy(false); showToast(String(e)); });
			};

			// 每模型推理策略行：显示提供方申报的档位；有「关闭」档才提供关闭，
			// 否则提供「强制关闭」（实验，不保证成功）
			// 视觉能力人工定论：自动(检测) → 是 → 否 循环；持久化到条目 visionOverride
			var createVisionToggle = function(vm){
				var current = vm.visionOverride === "yes" ? "yes" : (vm.visionOverride === "no" ? "no" : "");
				var label = current === "yes" ? "视觉:是" : (current === "no" ? "视觉:否" : "视觉:自动");
				var style = current === "yes"
					? {borderColor:"var(--dsw-alias-state-success-primary)", color:"var(--dsw-alias-state-success-primary)"}
					: (current === "no"
						? {borderColor:"var(--dsw-alias-state-error-primary)", color:"var(--dsw-alias-state-error-primary)"}
						: null);
				var next = current === "" ? "yes" : (current === "yes" ? "no" : "");
				return createElement("button",{type:"button", className:C.secondaryButton, disabled:busy, style:style,
					title:"人工定论该模型是否支持图片输入（自动=按渠道元数据检测；网关常不报能力，检测仅供参考）",
					onClick:function(){
						setBusy(true);
						fetch("/vision-config/vision-models", {method:"PUT", headers:{"content-type":"application/json", "x-vision-config-action":"vision-models"}, body: JSON.stringify({id: vm.id, provider: vm.provider, model: vm.model, name: vm.name||"", displayName: vm.displayName||"", description: vm.description||"", baseUrl: vm.baseUrl||"", requestFormat: vm.requestFormat||"openai-completions", reasoning: vm.reasoning||"", visionOverride: next})})
							.then(function(r){ return r.json().then(function(j){ return {ok:r.ok, status:r.status, body:j}; }); })
							.then(function(res){
								setBusy(false);
								if(!res.ok){ showToast((res.body && res.body.error) || ("HTTP "+res.status)); return; }
								setModels(res.body.models || []);
								if(res.body.keyRefs) setKeyRefs(res.body.keyRefs);
								showToast("已保存视觉定论："+(next==="yes"?"支持":(next==="no"?"不支持":"自动检测")));
							}).catch(function(e){ setBusy(false); showToast(String(e)); });
					}}, label);
			};
			// 「图片输入」标记（移植自 dsh-auxiliary）：写 llm-pi-ai 模型的 input 声明
			// （user 段路径寻址 + revision 防冲突），从根上解决网关不报模态导致的检测/准入问题。
			var createImageInputToggle = function(vm){
				var info = imageInputMap[vm.provider + "/" + vm.model];
				if (!info) return null;
				return createElement("label",{className:"vmo-free-toggle", style:{margin:0, alignItems:"center"},
					title:"把该模型在 llm-pi-ai 配置里的 input 声明改为 [text, image]；仅当上游真的接受图片时勾选",
					onChange:function(e){
						e.preventDefault();
						var checked = e.target.checked;
						var rs = api && typeof api.remoteSettings === "function" ? api.remoteSettings() : null;
						if (rs === null){ showToast("当前宿主未提供设置写入接口"); return; }
						setBusy(true);
						rs.describe("llm-pi-ai").then(function(desc){
							var value = checked === true ? ["text", "image"] : ["text"];
							return rs.mutate("llm-pi-ai", [{op:"set", path:info.path, value:value}], desc ? desc.revision : undefined);
						}).then(function(r){
							setBusy(false);
							if (r && r.ok === true){ showToast("已" + (checked===true?"开启":"关闭") + "图片输入声明"); fetchAll(); }
							else { showToast((r && r.error && r.error.message) || "写入被拒绝"); }
						}).catch(function(e){ setBusy(false); showToast(e && e.message ? e.message : String(e)); });
					}},
					createElement("input",{type:"checkbox", checked:info.hasImage === true, disabled:busy, style:{margin:0, width:"14px", height:"14px", accentColor:"var(--dsw-alias-state-success-primary)"}}),
					createElement("span",{style:{fontSize:"12px", color:"var(--dsw-alias-label-secondary)"}}, "图片输入"));
			};
			var buildReasonRow = function(vm){
				var rkey = vm.provider+"/"+vm.model;
				var rinfo = reasonInfo[rkey] || null;
				// 自 host 侧读取：offSupported 已是「真申报」后的结果（pi-ai 面值里的 off
				// 只是省略参数=厂商默认，不算能关）。旧 host 没返回该字段时按 efforts 兜底。
				var offOk = rinfo
					? (typeof rinfo.offSupported === "boolean" ? rinfo.offSupported
						: (Array.isArray(rinfo.efforts) && rinfo.efforts.some(function(e){
							var id = typeof e === "string" ? e : (e && e.id) || "";
							return id === "off";
						})))
					: true;
				var cur = vm.reasoning || "";
				var opts = offOk ? [["","默认"],["off","关闭"]] : [["","默认"],["forceOff","强制关闭"]];
				var hint;
				if(!rinfo){
					hint = "读取能力…";
				} else if(rinfo.efforts && rinfo.efforts.length > 0){
					var effStr = rinfo.efforts.map(function(e){ return typeof e==="string" ? e : String((e && e.id) || ""); }).filter(Boolean).join(", ");
					hint = "提供方档位："+effStr;
				} else {
					hint = "未申报档位";
				}
				if(hint !== "读取能力…" && !offOk) hint += " · 无「关闭」档，仅能尝试";
				if(cur === "forceOff") hint += " · 不保证成功";
				return createElement("div",{className:"vmo-settings-reason-block"},
					createElement("div",{className:"vmo-settings-reason-row"},
						createElement("span",{className:"vmo-settings-reason-label"},"推理"),
						createElement("div",{className:"vmo-effort-seg", role:"radiogroup", "aria-label":"推理策略"},
							opts.map(function(o){
								var sel = cur === o[0];
								return createElement("button",{key:o[0], type:"button", role:"radio", "aria-checked":sel, disabled: busy, className:"vmo-effort-seg-btn"+(sel?" is-on":""), onClick:(function(v,val){ return function(){ updateReasoning(v, val); }; })(vm, o[0])}, o[1]);
							})
						)
					),
					createElement("div",{className:"vmo-settings-reason-hint"}, hint)
				);
			};
			// 一次性为所有未读取能力的模型调度请求。
			// effect 只依赖 [models, loading, err] —— 绝不依赖它自己写入的
			// reasonInfo，否则 setState → 渲染 → effect 重触发 → 死循环。
			// 去重交给 reasonSeen（ref 同步锁），因此这里也无需 setTimeout。
			useEffect(function(){
				if(loading || err) return;
				if(!Array.isArray(models) || models.length===0) return;
				for(var i=0;i<models.length;i++){
					var vm = models[i];
					if(!vm) continue;
					ensureReasonInfo(vm);
				}
			}, [models, loading, err]);

			var header = createElement("div",{className:"vmo-settings-head", style:{marginBottom:"0"} },
				createElement("h3",{className:"vmo-settings-title"},"视觉助手"),
				createElement("span",{style:{marginLeft:"8px",fontSize:"12px",color:"var(--dsw-alias-label-tertiary)"}}, "插件自管 · 与主模型提供方独立")
			);
			var intro = createElement("p",{className:C.intro}, "填入各提供方的 API 密钥即可使用其模型。");

			var isInPlugin = function(provider, model){
				for(var _i=0; _i<models.length; _i++) if(models[_i].provider===provider && models[_i].model===model) return true;
				return false;
			};
			var systemOnly = [];
			for(var _j=0; _j<systemModels.length; _j++){
				var _sm = systemModels[_j];
				if(dismissed[_sm.provider+"/"+_sm.model]) continue;
				if(!isInPlugin(_sm.provider, _sm.model)) systemOnly.push(_sm);
			}
			var importAll = function(){
				if(systemOnly.length===0 || busy) return;
				setBusy(true);
				var pending = systemOnly.slice();
				var okCount = 0;
				var next = function(){
					if(pending.length===0){
						setBusy(false);
						fetchAll();
						showToast("已导入 "+okCount+" 个模型");
						return;
					}
					var cur = pending.shift();
					fetch("/vision-config/vision-models",{method:"POST", headers:{"content-type":"application/json", "x-vision-config-action":"vision-models"}, body: JSON.stringify({provider: cur.provider, model: cur.model, name: cur.name})})
					.then(function(r){ return r.json().then(function(j){ return {ok:r.ok, body:j}; }); })
					.then(function(res){
						if(res.ok) okCount++;
						next();
					}).catch(function(){ next(); });
				};
				next();
			};
			var importOne = function(entry){
				if(busy || isInPlugin(entry.provider, entry.model)) return;
				setImporting(entry.provider+"/"+entry.model);
				setBusy(true);
				fetch("/vision-config/vision-models",{method:"POST", headers:{"content-type":"application/json", "x-vision-config-action":"vision-models"}, body: JSON.stringify({provider: entry.provider, model: entry.model, name: entry.name})})
				.then(function(r){ return r.json().then(function(j){ return {ok:r.ok, body:j}; }); })
				.then(function(res){
					setBusy(false); setImporting(null);
					if(!res.ok){ showToast(res.body.error||"导入失败"); return; }
					setModels(res.body.models||[]);
					showToast("已导入 "+entry.provider+"/"+entry.model);
				}).catch(function(e){ setBusy(false); setImporting(null); showToast(String(e)); });
			};
			var rowsEl;
			if(loading){
				rowsEl = createElement("div",{className:C.modelEmpty},"加载中…");
			} else if(err){
				rowsEl = createElement("div",{className:C.error}, "加载失败："+err+" ", createElement("button",{className:C.linkButton, onClick:fetchAll},"重试"));
			} else if(models.length===0){
				var emptyChildren = [createElement("div",{className:C.modelEmpty},"暂无 Vision 模型。已在系统模型中检测到 "+systemOnly.length+" 个可用模型，可一键导入。")];
				if(systemOnly.length>0){
					emptyChildren.push(createElement("button",{type:"button", className:C.addButton, style:{marginTop:"8px"}, disabled:busy, onClick: importAll}, "一键导入全部 ("+systemOnly.length+")"));
				}
				rowsEl = createElement.apply(null, ["div", null].concat(emptyChildren));
				} else {
					// 按供应商分组折叠（分组头大字号，点击展开/收起）
					var grouped = {};
					for(var i=0;i<models.length;i++){
						var _vm = models[i];
						var _p = _vm.provider || "unknown";
						if(!grouped[_p]) grouped[_p] = [];
						grouped[_p].push(_vm);
					}
					var groupKeys = Object.keys(grouped).sort();
					// 编辑整个提供方（及其所有模型）：官方模型页是 provider 级编辑，
					// 打开编辑器时把该提供方全部模型放进 modal.models（带 _entryId 供批量保存）。
			var openEditProvider = function(gProvider, gModels){
				var first = gModels[0] || {};
				// 渠道形态判定：条目带 baseUrl（自定义端点）即视为自定义渠道，
				// 编辑用自定义形态（Provider ID 输入框 + API 地址 + API 协议）；
				// 否则为官方内置渠道（提供方下拉框）。
				var isCustomEdit = gModels.some(function(mm){ return mm && typeof mm.baseUrl==="string" && mm.baseUrl.length>0; });
				// 渠道显示名称取第一个条目的 displayName（渠道级字段，与模型名 name 分离）
				var firstDisplay = "";
				for(var _pp5=0; _pp5<gModels.length; _pp5++){
					if(gModels[_pp5] && typeof gModels[_pp5].displayName==="string" && gModels[_pp5].displayName.length>0){ firstDisplay = gModels[_pp5].displayName; break; }
				}
				setModal({
						mode: isCustomEdit ? "edit-custom" : "edit",
						data: {
							id: first.id||"",
							provider: isCustomEdit ? "custom" : gProvider,
							customProvider: isCustomEdit ? gProvider : "",
							model: first.model||"",
							name: first.name||"",
							displayName: firstDisplay,
							description: first.description||"",
							// 地址由插件条目自己持有（条目里没存就显示空，由用户填写保存）
							baseUrl: first.baseUrl||"",
							requestFormat: first.requestFormat||"openai-completions",
							providerType: isCustomEdit ? "custom" : gProvider
						},
						models: gModels.map(function(mm){ return { id: mm.model, name: mm.name||"", _entryId: mm.id }; })
					});
					setKeyDraft("");
				};
					var groupSections = [];
					for(var gi=0; gi<groupKeys.length; gi++){
						var gProvider = groupKeys[gi];
						var gModels = grouped[gProvider];
						var gItems = [];
						for(var mi=0; mi<gModels.length; mi++){
							var vm = gModels[mi];
							var dotCls = isSelected(vm) ? C.credentialDot + " " + C.credentialDotConfigured : C.credentialDot + " " + C.credentialDotMissing;
							var tag = (vm.displayName && vm.displayName.length>0) ? vm.displayName : vm.provider;
							gItems.push(createElement("li",{key:vm.id, className:C.rowCard},
							createElement("div",{className:C.rowHead},
								createElement("div",{className:C.rowIdentity},
									createElement("span",{className:dotCls, title: isSelected(vm) ? "当前选中" : "未选中"}),
									createElement("span",{className:C.rowName, title: vm.name || vm.model}, vm.name && vm.name.length>0 ? vm.name : vm.model),
									createElement("span",{className:C.rowTag}, tag)
								),
								createElement("div",{className:C.rowActions},
								isSelected(vm)
									? createElement("button",{type:"button", className:C.secondaryButton, disabled:true, style:{opacity:0.6,cursor:"default"}}, IconCheckOutline16 ? createElement(IconCheckOutline16,{size:12}) : null, "当前")
									: createElement("button",{type:"button", className:C.secondaryButton, disabled:busy, style:{borderColor:"var(--dsw-alias-state-success-primary)",color:"var(--dsw-alias-state-success-primary)"}, onClick:(function(v){return function(){ selectAsCurrent(v); };})(vm)}, "设为当前"),
								createElement("button",{type:"button", className:C.secondaryButton + " " + C.dangerButton, disabled:busy, onClick:(function(v){return function(){ setDelTarget(v); };})(vm)}, IconTrashOutline16 ? createElement(IconTrashOutline16,{size:12}) : null, "删除")
							)
						),
							createElement("div",{style:{display:"flex",flexWrap:"wrap",gap:"6px",alignItems:"center"}},
								createVisionToggle(vm),
								createImageInputToggle(vm)
							),
						buildReasonRow(vm)
					));
				}
				var _open = isExpanded(gProvider);
				groupSections.push(createElement("section",{key:gProvider, className:"vmo-provider-group" + (_open ? " vmo-provider-groupOpen":""), style:{display:"flex",flexDirection:"column",gap:"8px"}},
					createElement("div",{className:"vmo-provider-head-row"},
						createElement("button",{type:"button", className:"vmo-provider-head", "aria-expanded": _open, onClick:(function(p){ return function(){ toggleExpand(p); }; })(gProvider)},
							createElement("span",{className:"vmo-provider-chevron"}, IconChevronDownOutline14 ? createElement(IconChevronDownOutline14,{size:12}) : "›"),
							createElement("span",{className:"vmo-provider-name", title: gProvider}, (function(){
								for(var _gd=0;_gd<gModels.length;_gd++){
									if(gModels[_gd] && typeof gModels[_gd].displayName==="string" && gModels[_gd].displayName.length>0) return gModels[_gd].displayName;
								}
								return gProvider;
							})()),
							// 自定义标签：官方 declared（适配器仅因配置声明认识的渠道，如 winterapi 网关）
							// 或插件自建的自定义渠道（条目带 baseUrl）都显示；opencode-go 等内置不显示。
							(providers.some(function(p){ return p && p.provider===gProvider && p.declared === true; })
								|| gModels.some(function(m){ return m && typeof m.baseUrl==="string" && m.baseUrl.length>0; }))
								? createElement("span",{className:"vmo-provider-custom-tag"}, "自定义")
								: null,
							// 渠道密钥状态圆点：与官方「模型」页同款（已配置→绿，未配置→红，未知→不显示）
							(keyStatus[gProvider]==="configured" || keyStatus[gProvider]==="missing")
								? createElement("span",{className:C.credentialDot + " " + (keyStatus[gProvider]==="configured" ? C.credentialDotConfigured : C.credentialDotMissing), role:"img", title: keyStatus[gProvider]==="configured" ? "已配置 API 密钥" : "未配置 API 密钥", "aria-label": keyStatus[gProvider]==="configured" ? "已配置 API 密钥" : "未配置 API 密钥"})
								: null,
							createElement("span",{className:"vmo-provider-count"}, gModels.length + " 个模型")
						),
						createElement("button",{type:"button", className:"vmo-provider-head-edit", title:"编辑提供方及其所有模型", disabled:busy, onClick:(function(p, gms){ return function(){ openEditProvider(p, gms); }; })(gProvider, gModels)}, IconEditOutline16 ? createElement(IconEditOutline16,{size:12}) : null, " 编辑"),
						createElement("button",{type:"button", className:"vmo-provider-head-edit vmo-provider-head-del", title:"删除提供方及其所有模型", disabled:busy, onClick:(function(p, gms){ return function(){ setDelTarget({ provider: p, model: "", providerLevel: true, modelCount: gms.length }); }; })(gProvider, gModels)}, IconTrashOutline16 ? createElement(IconTrashOutline16,{size:12}) : null, " 删除")
					),
					_open ? createElement("ul",{className:C.rows, style:{marginTop:"0"}}, gItems) : null
				));
					}
					rowsEl = createElement("div",{style:{display:"flex",flexDirection:"column",gap:"16px"}}, groupSections);
				}

			var systemHint = null;
			if(!loading && !err && systemOnly.length>0){
				systemHint = createElement("div",{style:{display:"flex",flexDirection:"column",gap:"8px",marginBottom:"8px",padding:"10px 12px",border:"1px dashed var(--dsw-alias-border-l3)",borderRadius:"12px"}},
					createElement("div",{style:{fontSize:"13px",color:"var(--dsw-alias-label-secondary)"}}, "检测到 "+systemOnly.length+" 个未导入的系统模型"),
					createElement("div",{style:{display:"flex",flexWrap:"wrap",gap:"6px"}},
						systemOnly.map(function(e){
							var key=e.provider+"/"+e.model;
							var isImp = importing===key;
							return createElement("span",{key:key, style:{display:"inline-flex",gap:"4px",alignItems:"center"}},
							createElement("button",{type:"button", className:C.linkButton, disabled:busy, onClick:(function(entry){ return function(){ importOne(entry); }; })(e)}, isImp?"导入中…": key),
							createElement("button",{type:"button", className:C.linkButton, disabled:busy, onClick:(function(k){ return function(){
								var d={}; for(var kk in dismissed) d[kk]=dismissed[kk]; d[k]=true; setDismissed(d);
								// 持久化忽略列表：下次打开设置页不再提示该模型未导入
								fetch("/vision-config/config",{method:"PUT", headers:{"content-type":"application/json", "x-vision-config-action":"config"}, body: JSON.stringify({ ignoredModels: Object.keys(d).filter(function(_x){ return d[_x]; }) })}).catch(function(){});
							}; })(key)}, "×")
						);
						})
					),
					createElement("button",{type:"button", className:C.secondaryButton, style:{alignSelf:"flex-start"}, disabled:busy, onClick: importAll}, "一键导入全部 ("+systemOnly.length+")")
				);
			}
			var editorContent = null;
			var footer = null;
			if(modal){
				var isEdit = modal.mode==="edit" || modal.mode==="edit-custom";
				var isCustomMode = modal.data.providerType==="custom";
				var modalTitle = modal.mode==="custom" ? "自定义提供方" : (isEdit ? "编辑 Vision 模型" : "添加提供方");
				var modalDesc = modal.mode==="custom" ? "新增自定义提供方（Provider ID / API 地址 / 模型）" : (isEdit ? "更新提供方/模型" : "从官方提供方目录选择后填入模型");
				var updateField = function(key, val){
					// 重建 modal 必须保留顶层字段（models）：只回传 {mode,data} 会把
					// 模型目录丢掉，导致编辑已有渠道时 hasValidModel 失效、无法保存
					var nd = {};
					for(var k in modal.data) nd[k]=modal.data[k];
					nd[key]=val;
					var nt = {};
					for(var t in modal) nt[t]=modal[t];
					nt.data = nd;
					setModal(nt);
				};
				// 模型目录（modal.models 顶层数组）专用更新：渲染读取的是顶层 modal.models，
				// 不能用 updateField（那只写 modal.data.models，列表不会刷新）。
				// 同样必须浅拷贝保留其余顶层字段，否则点「添加模型」/编辑模型行会清空已输入的密钥。
				var setModelsField = function(list){
					setModal({mode: modal.mode, data: modal.data, models: list});
				};
				var selProvider = isCustomMode ? "" : (modal.data.provider||"");
				var isBuiltinProvider = false;
				for(var _pi4=0; _pi4<providers.length; _pi4++){ if(providers[_pi4] && providers[_pi4].provider===selProvider && providers[_pi4].source==="builtin"){ isBuiltinProvider = true; break; } }
				// 官方卡片式表单（vmo-of-* 内置复刻样式）
				var editorChildren = [];
				// 卡片标题（模态标题）：添加提供方 / 编辑 Vision 模型 / 自定义提供方
				editorChildren.unshift(createElement("div",{className:C.editorHeader},
					createElement("span",{className:C.editorTitle}, modalTitle)
				));
				// API 密钥（复用官方 credentials 域）。
				// 位置按模式区分：官方内置供应商跟在提供方 select 之后（主体），
				// 自定义提供方放在 API 协议下方（见 isCustomMode 分支）。
				// placeholder 按模式区分：custom 不支持环境认证，只提示输入密钥。
				var makeKeyField = function(placeholder){
					// 已有凭据且未在输入新值 → 提示「已配置——输入新值可替换」
					var ph = (keyConfigured && keyDraft.length===0)
						? "已配置——输入新值可替换"
						: (placeholder||"输入 API 密钥，或留空使用环境认证");
					return createElement("div",{className:C.field},
						createElement("span",{className:C.fieldLabel},"API 密钥"),
						createElement("input",{className:C.input, type:"password", autoComplete:"off", value: keyDraft, placeholder: ph, "aria-label":"API 密钥", onChange:function(e){ setKeyDraft(e.target.value); }})
					);
				};
				if(!isCustomMode){
					editorChildren.push(createElement("div",{className:C.field},
						createElement("span",{className:C.fieldLabel},"提供方"),
						createElement("select",{className:C.input + " " + C.selectInput, value: selProvider, "aria-label":"提供方", onChange:function(e){ updateField("provider", e.target.value); }},
							(function(){
								var seen={}; var opts=[];
								// 只列官方内置供应商（source==="builtin"），不含 winterapi 等自定义路由
								var all = providers.slice();
								for(var _pi5=0; _pi5<all.length; _pi5++){
									var _pp5=all[_pi5];
									if(!_pp5 || typeof _pp5.provider!=="string" || _pp5.source!=="builtin") continue;
									if(seen[_pp5.provider]) continue;
									seen[_pp5.provider]=true;
									opts.push(createElement("option",{value:_pp5.provider}, _pp5.provider));
								}
								if(!seen[selProvider] && selProvider.length>0) opts.push(createElement("option",{value:selProvider}, selProvider));
								return opts;
							})()
						)
					));
				// 渠道显示名称：渠道级字段，显示在分组头（与模型名 name 分离）
				editorChildren.push(createElement("div",{className:C.field},
					createElement("span",{className:C.fieldLabel},"显示名称"),
					createElement("input",{className:C.input, type:"text", value: modal.data.displayName||"", placeholder:"渠道显示名称（留空用提供方 ID）", "aria-label":"显示名称", onChange:function(e){ updateField("displayName", e.target.value); }})
				));
				editorChildren.push(makeKeyField());
				}
				// （API 密钥字段由 makeKeyField 生成，按模式分别 push：见两个分支）
				// 自定义提供方：Provider ID / 显示名 / API 地址 / API 协议
				// 模型目录：标题行（左）+ 获取可用模型（右）+ 列表 + 添加模型。
				// 构建先于 provider 分支：自定义提供方直接展示在主体，
				// 官方内置供应商收进「自定义设置」折叠区。
				var modelRows = Array.isArray(modal.models) ? modal.models.slice() : (modal.data.model && modal.data.model.length>0 ? [{id: modal.data.model, name: modal.data.name||""}] : []);
				var catalogChildren = [
					createElement("div",{className:C.modelListHead},
						createElement("div",{className:C.modelCatalogHeading},
							createElement("span",{className:C.modelCatalogTitle},"模型目录"),
							createElement("span",{className:C.modelCatalogMeta}, modelRows.length===0 ? "正在使用适配器默认模型" : (modelRows.length+" 个模型"))
						),
						// 新增自定义提供方：未填写 API 地址或 API 密钥时不可获取模型（不依赖环境认证）；
						// 编辑已有自定义提供方时凭据已存在，不限制
						createElement("button",{type:"button", className:C.linkButton, disabled:busy||!!picker||(modal.mode==="custom" && (!modal.data.baseUrl || !keyDraft)), title:(modal.mode==="custom" && (!modal.data.baseUrl || !keyDraft)) ? "请先填写 API 地址和 API 密钥" : undefined, onClick:function(){
					if(typeof fetchModelsFromProvider!=="function"){ showToast("获取模型不可用"); return; }
					var _selProvider = modal.data.provider || "";
					var _isBuiltinP = Array.isArray(providers) && providers.some(function(p){ return p && p.provider===_selProvider && p.source==="builtin"; });
					setPicker({candidates:[], selected:new Set(), busy:true});
					fetchModelsFromProvider(modal, keyDraft, function(fresh){
								// 只勾选已在模型目录里的模型（不再默认全选）；
								// 其余候选保持未勾选，由用户主动勾选或使用下方「全选」。
								var exist = {};
								var ml = Array.isArray(modal.models) ? modal.models : [];
								for(var _li=0;_li<ml.length;_li++){ var _mm=ml[_li]; if(_mm && typeof _mm.id==="string") exist[_mm.id]=true; }
								var sel = new Set();
								for(var _fi=0;_fi<fresh.length;_fi++){ if(exist[fresh[_fi].id]) sel.add(fresh[_fi].id); }
								// 弹窗已关闭（用户点了取消/遮罩）→ 保持关闭，不复活
								setPicker(function(prev){ return prev===null ? null : {candidates:fresh, selected:sel, busy:false}; });
							}, showToast, api, function(){
								// 失败路径：复位 busy，让「获取可用模型」按钮可以重试
								setPicker(null);
							}, _isBuiltinP);
						}}, busy||!!picker ? "获取中…" : "获取可用模型")
					)
				];
				// 模型行内编辑辅助：改/删 modal.models 第 idx 行
				var updateRow = function(idx, key, val){
					var list = Array.isArray(modal.models) ? modal.models.slice() : [];
					if(idx>=0 && idx<list.length){
						var nextRow = {};
						for(var _rk in list[idx]) nextRow[_rk] = list[idx][_rk];
						nextRow[key] = val;
						list[idx] = nextRow;
					}
					setModelsField(list);
				};
				var removeRow = function(idx){
					var list = Array.isArray(modal.models) ? modal.models.slice() : [];
					list.splice(idx, 1);
					setModelsField(list);
				};
				if(modelRows.length===0){
					catalogChildren.push(createElement("div",{className:C.modelEmpty}, "尚未添加模型；点击下方「添加模型」新增一行并填写模型 ID。"));
				} else {
					catalogChildren.push(createElement("div",{className:C.modelList},
						modelRows.map(function(mrow, mi){
							return createElement("div",{key:(mrow.id||"new-")+mi, className:C.modelEntry},
								createElement("div",{className:C.modelRow},
									createElement("input",{className:C.input, type:"text", value: mrow.id||"", placeholder:"模型 ID", "aria-label":"模型 ID "+(mi+1), onChange:(function(i){ return function(e){ updateRow(i,"id",e.target.value); }; })(mi)}),
									createElement("input",{className:C.input, type:"text", value: mrow.name||"", placeholder:"显示名称（可选）", "aria-label":"显示名称 "+(mi+1), onChange:(function(i){ return function(e){ updateRow(i,"name",e.target.value); }; })(mi)}),
									createElement("button",{type:"button", className:C.iconButton+" "+C.iconButtonDanger, "aria-label":"删除模型 "+(mi+1), title:"删除", onClick:(function(i){ return function(){ removeRow(i); }; })(mi)}, IconTrashOutline16 ? createElement(IconTrashOutline16,{size:14}) : "×")
								)
							);
						})
					));
				}
				catalogChildren.push(createElement("button",{type:"button", className:C.addModelButton, disabled:busy, onClick:function(){
					var list = Array.isArray(modal.models) ? modal.models.slice() : [];
					list.push({ id:"", name:"" });
					setModelsField(list);
				}}, IconPlusOutline16 ? createElement(IconPlusOutline16,{size:14}) : null, " 添加模型"));
				// 自定义提供方：Provider ID / 显示名 / API 地址 / API 协议 + 模型目录直接展示在主体
				if(isCustomMode){
					// Provider ID 格式：小写字母开头，仅可含小写字母、数字、连字符。
					// 宿主 route 键与派生凭据 ref 都依赖该格式，非法字符会导致凭据写入
					// 被拒（invalid payload）或运行期无适配器（NO_ADAPTER）。
					var customId = modal.data.customProvider||"";
					var customIdBad = customId.length>0 && !/^[a-z][a-z0-9-]*$/.test(customId);
					editorChildren.push(createElement("div",{className:C.field},
						createElement("span",{className:C.fieldLabel},"Provider ID"),
						createElement("input",{className:C.input, type:"text", value: modal.data.customProvider||"", placeholder:"acme-gateway", "aria-label":"Provider ID", onChange:function(e){ updateField("customProvider", e.target.value); }}),
						createElement("p",{className:C.advancedHint, style: customIdBad ? {color:"var(--dsw-alias-state-error-primary)"} : undefined}, customIdBad ? "不允许：必须以小写字母开头，仅可含小写字母、数字、连字符（如 acme-gateway）" : "以小写字母开头的标识（仅小写字母、数字、连字符），在请求中唯一标识该提供方，并用于派生凭据名。")
					));
					editorChildren.push(createElement("div",{className:C.field},
						createElement("span",{className:C.fieldLabel},"显示名称"),
						createElement("input",{className:C.input, type:"text", value: modal.data.displayName||"", placeholder:"显示名称（留空用提供方 ID）", "aria-label":"显示名称", onChange:function(e){ updateField("displayName", e.target.value); }})
					));
					editorChildren.push(createElement("div",{className:C.field},
						createElement("span",{className:C.fieldLabel},"API 地址"),
						createElement("input",{className:C.input, type:"text", value: modal.data.baseUrl||"", placeholder:"https://gateway.example/v1", "aria-label":"API 地址", onChange:function(e){ updateField("baseUrl", e.target.value); }})
					));
					editorChildren.push(createElement("div",{className:C.field},
						createElement("span",{className:C.fieldLabel},"API 协议"),
						// openai 系包含 completions / responses 两种；value 直接存协议名（后端归一化存储），
						// 旧配置里的 'openai' 归一化为 openai-completions 显示。
						createElement("select",{className:C.input + " " + C.selectInput, value: (function(){ var f=modal.data.requestFormat; return f==="anthropic"?"anthropic":(f==="openai-responses"?"openai-responses":"openai-completions"); })(), "aria-label":"API 协议", onChange:function(e){ updateField("requestFormat", e.target.value); }},
							(function(){
								var opts=[];
								var protos = ["openai-completions", "openai-responses", "anthropic"];
								for(var _pi6=0; _pi6<protos.length; _pi6++){
									var _pr=protos[_pi6];
									if(typeof _pr!=="string"||_pr.length===0) continue;
									opts.push(createElement("option",{value:_pr}, _pr));
								}
								return opts;
							})()
						)
					));
					editorChildren.push(makeKeyField("输入 API 密钥"));
					editorChildren.push(createElement("div",{className:C.modelCatalog}, catalogChildren));
					} else {
						// 官方内置供应商：API 地址、模型目录、获取可用模型、模型 ID
						// 全部收进「自定义设置」折叠区（默认收起，key 强制重挂载）
						editorChildren.push(createElement("details",{key:"customized-"+modal.mode, className:C.customized},
							createElement("summary",{className:C.customizedSummary},"自定义设置"),
							createElement("div",{className:C.customizedBody},
								createElement("div",{className:C.field},
									createElement("span",{className:C.fieldLabel},"API 地址"),
									createElement("input",{className:C.input, type:"text", value: modal.data.baseUrl||"", placeholder:"留空使用提供方默认", "aria-label":"API 地址", onChange:function(e){ updateField("baseUrl", e.target.value); }})
								),
								createElement("div",{className:C.modelCatalog}, catalogChildren)
							)
						));
					}

				var content = createElement("div",{className:C.editor}, editorChildren);
				// 必要字段校验（与 submitAddOrEdit 的提交校验一致）：
				// - 至少一个「模型 ID」非空的模型行；
				// - 新增自定义提供方额外要求 Provider ID、API 地址、API 密钥非空
				//   （编辑已有自定义提供方时凭据已存在，不要求重填密钥）。
				var hasValidModel = (Array.isArray(modal.models) ? modal.models : []).some(function(_mm){ return _mm && typeof _mm.id==="string" && _mm.id.trim().length>0; });
				// 自定义模式：Provider ID 格式（小写字母开头，仅小写字母/数字/连字符）
				var customIdOk = modal.mode!=="custom" || /^[a-z][a-z0-9-]*$/.test((modal.data.customProvider||"").trim());
				var canSubmit = hasValidModel && customIdOk && (modal.mode==="custom"
					? (modal.data.customProvider||"").trim().length>0 && (modal.data.baseUrl||"").trim().length>0 && keyDraft.trim().length>0
					: true);
				var footer = createElement("div",{className:C.editorActions},
					createElement("button",{type:"button", className:C.secondaryButton, onClick:function(){ setPicker(null); setModal(null); setKeyDraft(""); }}, "取消"),
					createElement("button",{type:"button", className:C.primaryButton, disabled:busy||!canSubmit, title:!canSubmit ? (modal.mode==="custom" ? (customIdOk ? "请先填写 Provider ID、API 地址、API 密钥，并至少填写一个模型 ID" : "Provider ID 必须以小写字母开头，仅可含小写字母、数字、连字符") : "请至少填写一个模型 ID") : undefined, onClick:submitAddOrEdit}, busy ? "保存中…" : (modal.mode==="custom" ? "创建提供方" : "保存"))
				);
				editorContent = content;
			}
			var addBlock = modal
				? createElement("div",{className:C.addBlock},
					createElement("div",{className:C.addCard},
						editorContent,
						footer
					)
				)
				: createElement("div",{className:C.addActions},
					createElement("button",{type:"button", className:C.addButton, disabled:busy, onClick:function(){
						var firstProvider = "";
						for(var _pi3=0; _pi3<providers.length; _pi3++){
							if(providers[_pi3] && typeof providers[_pi3].provider==="string" && providers[_pi3].provider.length>0 && providers[_pi3].source!=="registered"){ firstProvider = providers[_pi3].provider; break; }
						}
						if(firstProvider.length===0) firstProvider = "opencode-go";
setModal({mode:"add", data:{id:"",provider:firstProvider,providerType:firstProvider,customProvider:"",model:"",name:"",description:"",baseUrl:"",requestFormat:"openai-completions"}});
							setKeyDraft("");
					}}, IconPlusOutline16 ? createElement(IconPlusOutline16,{size:14}) : null, " 添加提供方"),
					createElement("button",{type:"button", className:C.addButton, disabled:busy, onClick:function(){ setModal({mode:"custom", data:{id:"",provider:"custom",providerType:"custom",customProvider:"",model:"",name:"",description:"",baseUrl:"",requestFormat:"openai-completions"}}); setKeyDraft(""); }}, IconPlusOutline16 ? createElement(IconPlusOutline16,{size:14}) : null, " 添加自定义提供方")
				);

			var delEl = null;
			if(delTarget){
				var delContent = delTarget.providerLevel
					? createElement("div",{style:{fontSize:"14px",lineHeight:"22px",color:"var(--dsw-alias-label-secondary)"}}, "确定删除提供方 ", createElement("b",{style:{color:"var(--dsw-alias-label-primary)"}}, delTarget.provider), " 及其 ", createElement("b",{style:{color:"var(--dsw-alias-label-primary)"}}, delTarget.modelCount), " 个模型吗？此操作会从 setting.yaml 移除，无法撤销。")
					: createElement("div",{style:{fontSize:"14px",lineHeight:"22px",color:"var(--dsw-alias-label-secondary)"}}, "确定删除 ", createElement("b",{style:{color:"var(--dsw-alias-label-primary)"}}, delTarget.provider+"/"+delTarget.model), " 吗？此操作会从 setting.yaml 移除，无法撤销。");
				var delFooter = createElement("div",{className:"vmo-modal-actions"},
					createElement("button",{type:"button", className:"vmo-btn-secondary", onClick:function(){ setDelTarget(null); }}, "取消"),
					createElement("button",{type:"button", className:"vmo-btn-primary", style:{background:"var(--dsw-alias-state-error-primary)"}, disabled:busy, onClick:doDelete}, busy?"删除中…":"删除")
				);
				if(Modal){
					delEl = createElement(Modal,{open:true, onClose:function(){ setDelTarget(null); }, title:"删除 Vision 模型", closeLabel:"关闭", description:"确认删除", footer:delFooter}, delContent);
				} else {
					delEl = createElement("div",{className:"vmo-modal-overlay", onClick:function(e){ if(e.target===e.currentTarget) setDelTarget(null); }},
						createElement("div",{className:"vmo-modal"},
							createElement("h4",{className:"vmo-modal-title"},"删除 Vision 模型"),
							delContent,
							delFooter
						)
					);
				}
			}

			// 模型选择弹窗：纯 vmo-picker-* 自渲染 CSS，不依赖任何 DSH CSS Module hash 类名
				// （fetchModal 同源），视觉与官方「模型」页获取可用模型弹窗完全一致：
				// 左侧独立 checkbox、右对齐区滚动列表、底部官方按钮组。
				// 容器走 Modal 原语；不可用时回退到 vmo-modal-* 兜底，body 仍走官方类。
			var pickerEl = null;
			if(picker){
				var pickerCandidates = Array.isArray(picker.candidates) ? picker.candidates : [];
				var pickerSelected = picker.selected || new Set();
				var closePicker = function(){ setPicker(null); };
				var toggleModel = function(id){
					if(picker.busy) return;
					var next = new Set(pickerSelected);
					if(next.has(id)) next.delete(id); else next.add(id);
					setPicker({candidates:picker.candidates, selected:next, busy:false});
				};
				var addSelected = function(){
					var selectedModels = pickerCandidates.filter(function(c){ return pickerSelected.has(c.id); });
					var list = Array.isArray(modal.models) ? modal.models.slice() : [];
					var existingIds = {};
					for(var li=0; li<list.length; li++) existingIds[list[li].id] = true;
					var added = 0;
					for(var si=0; si<selectedModels.length; si++){
						if(existingIds[selectedModels[si].id]) continue;
						list.push(selectedModels[si]);
						existingIds[selectedModels[si].id] = true;
						added++;
					}
					setModelsField(list);
					setPicker(null);
					showToast("已添加 "+added+" 个模型");
				};
				// 列表 body：扁平 row + 左侧独立 checkbox + 左对齐 model id（跟官方 picker DOM 视觉一致）
				// 全部走 vmo-picker-row* 自渲染 CSS，零 hash 依赖，DSH 升级换 hash 也不影响。
				var pickerBodyChildren;
				if(picker.busy){
					pickerBodyChildren = [createElement("div",{className:"vmo-picker-rows", key:"loading"},
						createElement("div",{className:"vmo-picker-empty"}, "正在获取可用模型…")
					)];
				} else if(pickerCandidates.length===0){
					pickerBodyChildren = [createElement("div",{className:"vmo-picker-rows", key:"empty"},
						createElement("div",{className:"vmo-picker-empty"}, "没有可用的模型")
					)];
				} else {
					pickerBodyChildren = [createElement("div",{className:"vmo-picker-rows", key:"list"}, pickerCandidates.map(function(c){
						var checked = pickerSelected.has(c.id);
						var checkMark = createElement("svg",{width:11, height:11, viewBox:"0 0 12 12", fill:"none", "aria-hidden":"true", style:{display:"block"}},
							createElement("path",{d:"M2 6 L5 9 L10 3", stroke:"currentColor", strokeWidth:"2", strokeLinecap:"round", strokeLinejoin:"round"})
						);
						return createElement("button",{type:"button", key:c.id, className:"vmo-picker-row"+(checked?" vmo-picker-row-checked":""), "aria-pressed":checked, onClick:function(){ toggleModel(c.id); }},
							createElement("span",{className:"vmo-picker-row-box"}, checked ? checkMark : null),
							createElement("span",{className:"vmo-picker-row-id"}, c.id)
						);
					}))];
				}
				var pickerBody = pickerBodyChildren;
				// 全选/取消全选：全部候选已勾选 → 取消全选；否则全选。
				var allChecked = pickerCandidates.length>0 && pickerSelected.size===pickerCandidates.length;
				var toggleAll = function(){
					var next = new Set(pickerSelected);
					if(allChecked){ next.clear(); }
					else { for(var _ti=0;_ti<pickerCandidates.length;_ti++){ next.add(pickerCandidates[_ti].id); } }
					setPicker({candidates:picker.candidates, selected:next, busy:false});
				};
				// footer 按钮也走官方：editorActions + secondaryButton / primaryButton，
					// 与编辑器「添加提供方」dialog 完全一致；保持 picker 与编辑器的 footer 视觉同源。
				var pickerFooter = createElement("div",{className:"vmo-modal-actions"},
					createElement("label",{style:{display:"inline-flex",alignItems:"center",gap:"6px",fontSize:"13px",color:"var(--dsw-alias-label-secondary)",cursor:"pointer",marginRight:"auto"}},
						createElement("input",{type:"checkbox", checked:allChecked, disabled:picker.busy||pickerCandidates.length===0, onChange:toggleAll, style:{margin:0,width:"14px",height:"14px",accentColor:"var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-success-primary))"}}),
						createElement("span",null, allChecked ? "取消全选" : "全选")
					),
					createElement("button",{type:"button", className:"vmo-btn-secondary", onClick:closePicker}, "取消"),
					createElement("button",{type:"button", className:"vmo-btn-primary", disabled:picker.busy||pickerSelected.size===0, onClick:addSelected}, "添加所选")
				);
				if(Modal){
					pickerEl = createElement(Modal,{
						open:true,
						onClose:closePicker,
						title:"选择要添加的模型",
						description:"以下是模型提供方的可用模型，勾选要添加的模型。",
						closeLabel:"关闭",
						footer:pickerFooter
					}, pickerBody);
				} else {
					// 兜底：平台缺失 Modal 时退回到自渲染 overlay（与删除 dialog 同套 vmo-modal-*）
					pickerEl = createElement("div",{className:"vmo-modal-overlay", onClick:function(e){ if(e.target===e.currentTarget) closePicker(); }},
						createElement("div",{className:"vmo-modal", onClick:function(e){ e.stopPropagation(); }},
							createElement("h4",{className:"vmo-modal-title"}, "选择要添加的模型"),
							createElement("p",{style:{margin:0,fontSize:"13px",lineHeight:"20px",color:"var(--dsw-alias-label-secondary)"}}, "以下是模型提供方的可用模型，勾选要添加的模型。"),
							pickerBody,
							pickerFooter
						)
					);
				}
			}

			var toastEl = toast2 ? createElement("div",{style:{position:"fixed",left:"50%",top:"16px",transform:"translateX(-50%)",background:"var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-primary,#333))",color:"var(--dsw-alias-label-primary)",border:"1px solid var(--dsw-alias-border-l2)",padding:"8px 12px",borderRadius:"8px",fontSize:"13px",zIndex:10000,boxShadow:"var(--dsw-shadow-lv3)"}}, toast2) : null;

			// 失效/非视觉条目：提示并支持一键清理（按当前能力实测标注）
			var invalidEntries = models.filter(function(m){ return m && (m.dead === true || m.notVision === true); });
			var unknownEntries = models.filter(function(m){ return m && m.unknownCapability === true; });
			var cleanupBar = invalidEntries.length > 0
				? createElement("div",{style:{display:"flex",flexDirection:"column",gap:"6px",padding:"8px 12px",border:"1px dashed var(--dsw-alias-border-l3)",borderRadius:"12px"}},
					createElement("div",{style:{display:"flex",flexWrap:"wrap",gap:"8px",alignItems:"center"}},
						createElement("span",{style:{fontSize:"13px",color:"var(--dsw-alias-label-secondary)"}},
							"检测到 "+invalidEntries.length+" 个失效/非视觉条目（"+invalidEntries.filter(function(m){return m.dead===true;}).length+" 个失效 / "+invalidEntries.filter(function(m){return m.notVision===true;}).length+" 个非视觉）："),
						createElement("button",{type:"button", className:C.linkButton, disabled:busy, title:"按当前能力实测结果移除失效与确认非视觉的条目，可随时重新导入",
							onClick:function(){
								setBusy(true);
								fetch("/vision-config/vision-models/cleanup",{method:"POST", headers:{"content-type":"application/json", "x-vision-config-action":"vision-models"}, body:"{}"})
									.then(function(r){ return r.json().then(function(j){ return {ok:r.ok, status:r.status, body:j}; }); })
									.then(function(res){
										setBusy(false);
										if(!res.ok){ showToast((res.body && res.body.error) || ("HTTP "+res.status)); return; }
										setModels(res.body.models || []);
										if(res.body.keyRefs) setKeyRefs(res.body.keyRefs);
										showToast("已清理 "+((res.body.removed||[]).length)+" 个失效/非视觉条目");
									}).catch(function(e){ setBusy(false); showToast(String(e)); });
						}}, "清理失效条目")),
					invalidEntries.map(function(m){
						return createElement("div",{key:m.id, className:"vmo-free-meta"},
							createElement("span",{style:{color: m.dead===true ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-state-warn-label, var(--dsw-alias-label-tertiary))"}},
								"["+(m.dead===true?"失效":"非视觉")+"]"),
							" "+(m.name && m.name.length>0 ? m.name+" · " : "")+m.provider+" / "+m.model);
					}))
				: null;

			// 图片传递方式：发图即转文字（默认）/ 按需描述（describe_image）
			var setDelivery = function(value){
				setBusy(true);
				fetch("/vision-config/config",{method:"PUT", headers:{"content-type":"application/json", "x-vision-config-action":"config"}, body: JSON.stringify({imageDelivery: value})})
					.then(function(r){ return r.json().then(function(j){ return {ok:r.ok, status:r.status, body:j}; }); })
					.then(function(res){
						setBusy(false);
						if(!res.ok){ showToast((res.body && res.body.error) || ("HTTP "+res.status)); return; }
						setConfig(res.body);
						showToast(value==="onDemand" ? "已切换为按需描述" : "已切换为发图即转文字");
					})
					.catch(function(e){ setBusy(false); showToast(String(e)); });
			};
			var currentDelivery = config && config.imageDelivery === "onDemand" ? "onDemand" : "eager";
			var deliveryOption = function(value, label, hint){
				var checked = currentDelivery === value;
				return createElement("label",{className:"vmo-free-toggleCard", style:{flex:"1 1 240px"}},
					createElement("input",{type:"radio", name:"vmo-image-delivery", checked:checked, disabled:busy,
						onChange:function(){ if(!checked) setDelivery(value); }}),
					createElement("span",null, label, createElement("span",{className:"vmo-free-toggle-hint"}, hint)));
			};
			var deliveryBar = createElement("div",{style:{display:"flex",flexDirection:"column",gap:"8px",marginTop:"28px"}},
				createElement("span",{style:{fontSize:"15px",fontWeight:"600",color:"var(--dsw-alias-label-primary)"}}, "图片传递方式"),
				createElement("div",{style:{display:"flex",flexWrap:"wrap",gap:"8px"}},
					deliveryOption("eager", "发图即转文字", "发送图片时立即用识图模型转成文字（默认，历史行为）"),
					deliveryOption("onDemand", "按需描述（describe_image）", "图片以文本引用送达，主模型需要看图时调用 describe_image 工具分析；更省调用，重启后历史图片无法回看")),
				createElement("span",{className:"vmo-free-meta"},
					"两种模式下，识图模型不可用都会自动切免费链路兜底。"));

			var sectionChildren = [header, intro];
			if (systemHint !== null) sectionChildren.push(systemHint);
			sectionChildren.push(rowsEl, addBlock);

			// 图片传递方式：紧贴「免费模型配置」模块上方（免费链路/按需描述的开关都在这一片）
			if (deliveryBar !== null) sectionChildren.push(deliveryBar);

			// 下半区：免费模型配置模块（免费渠道 + 渠道级密钥 + 免费链路）
			sectionChildren.push(createElement(FreeModelsModule, {key:"free-models", api: api, showToast: showToast}));
			if (delEl !== null) sectionChildren.push(delEl);
			if (pickerEl !== null) sectionChildren.push(pickerEl);
			if (toastEl !== null) sectionChildren.push(toastEl);
			return createElement.apply(null, ["section", {className:C.section, "aria-label":"视觉助手"}].concat(sectionChildren));
		};


			// remote / remote.credentials：密钥读写走官方远端命名空间（与「设置 → 模型」页同源）。
			// 不声明的话 ctx 门面拿不到该服务（白名单代理），保存密钥会一直提示「未提供凭据写入接口」。
			exports.inject = ["slots", "connection", "remote", "remote.credentials", "remote.settings"];

			// ---- 设置左侧栏「视觉助手」条目的眼睛图标 ----
			// 宿主 navIcon(id) 对未知 section 一律渲染齿轮图标且不可声明式扩展；
			// 方案：按导航标签定位 cell → 原地改写其 svg 的几何（不替换节点、不打补丁），
			// 由 MutationObserver 在设置面板每次重渲染后重复应用（per-svg dataset 守卫防重入）。
			var installVisionNavIcon = function(){
				if (typeof document === "undefined" || typeof MutationObserver === "undefined") return function(){ return function(){}; };
				var SVG_NS = "http://www.w3.org/2000/svg";
				/** 原地改写一个 svg 的几何为眼睛形状；保留原 class/尺寸，继承宿主样式。 */
				var drawEye = function(svg){
					while (svg.firstChild !== null) svg.removeChild(svg.firstChild);
					svg.setAttribute("viewBox", "0 0 16 16");
					svg.setAttribute("fill", "none");
					svg.setAttribute("aria-hidden", "true");
					var outline = document.createElementNS(SVG_NS, "path");
					outline.setAttribute("d", "M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z");
					outline.setAttribute("stroke", "currentColor");
					outline.setAttribute("stroke-width", "1.2");
					outline.setAttribute("stroke-linejoin", "round");
					var pupil = document.createElementNS(SVG_NS, "circle");
					pupil.setAttribute("cx", "8");
					pupil.setAttribute("cy", "8");
					pupil.setAttribute("r", "2.1");
					pupil.setAttribute("stroke", "currentColor");
					pupil.setAttribute("stroke-width", "1.2");
					svg.appendChild(outline);
					svg.appendChild(pupil);
					svg.dataset.visionEye = "1";
				};
				var apply = function(root){
					try {
						var buttons = (root || document).querySelectorAll("button");
						for (var i = 0; i < buttons.length; i++) {
							// 按导航标签定位 cell：按钮内 span 文本为「视觉助手」
							var labelSpan = buttons[i].querySelector("span");
							if (labelSpan === null || labelSpan.textContent.trim() !== "视觉助手") continue;
							var svg = buttons[i].querySelector("svg");
							if (svg === null) continue;
							if (svg.dataset && svg.dataset.visionEye === "1") continue;
							drawEye(svg);
						}
					} catch (_e) { /* DOM 不可用时静默跳过 */ }
				};
				var observer = new MutationObserver(function(){ apply(document); });
				observer.observe(document.body, { childList: true, subtree: true });
				apply(document);
				return function(){ observer.disconnect(); };
			};
			exports.apply = function(ctx) {
				var hostApi = buildHostApi(ctx);
				try { installVisionNavIcon(); } catch (_e) { /* 无 DOM 环境 */ }
				ctx.inject(["slots"], function(scope) {
					scope.slots.inject("conversation.input.right", function() {
						return scope.slots.register({
							name: "conversation.input.right",
							id: "vision-config",
							order: 10,
							inject: function(sessionId) {
								return { sessionId: sessionId };
							}
						}, VisionModelSelect);
					});
					scope.slots.inject("settings.section", function() {
						// 分页 id 刻意沿用基线的 "vision"：用户「上次打开的设置分页」记录继续命中本页，
						// 侧栏显示名才是面向用户的中文「视觉助手」（label）。
						return scope.slots.register({
							name: "settings.section",
							id: "vision",
							order: 11,
							label: function(){ return "视觉助手"; },
							inject: function() {
								return { injected: { api: hostApi } };
							}
						}, VisionSettingsSection);
					});
				});
			};

			return module.exports;
		}
});
