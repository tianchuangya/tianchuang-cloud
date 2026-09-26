# 天创云端主题系统与全组件 CSS 地图

最后更新：2026-09-26。本文档是主题系统的唯一权威说明：包含架构、令牌参考表、**每个软件内组件的 CSS 说明**，以及主题编写与导入指南。

## 1. 架构

主题由两层组成：

1. **样式基底（style）**：决定组件的结构性外观，目前内置两种：
   - `glass` —— 云玻璃（默认）：深色毛玻璃、透明窗口、背景图 + GPU 动态效果。
   - `neumorphism` —— 新拟物派（Soft UI）：浅色纯色背景 `#e0e5ec`、双光源浮雕阴影、无渐变、无纯黑纯白。
   基底通过 `<html data-theme="...">` 属性激活，对应 App.css 末尾的 `[data-theme='neumorphism']` 结构覆盖块。
2. **令牌表（tokens）**：一组 CSS 自定义属性（见第 3 节），由 `src/themes.ts` 在运行时注入到 `documentElement` 的内联样式，覆盖 `src/index.css` 中 `:root` 的玻璃默认值。**导入的主题只包含令牌数据，不执行任何 CSS/JS。**

令牌注入 + 基底属性的组合意味着：导入一个 `style: "neumorphism"` 的主题可以整体换色换阴影，而结构（悬停缩小阴影、按下内凹、光源方向）由基底保证，不会被主题破坏。

相关代码：

| 文件 | 职责 |
| --- | --- |
| `src/themes.ts` | 主题 JSON 校验、内置主题、应用与持久化（localStorage） |
| `src/index.css` | `:root` 令牌默认值（玻璃基底）+ 基础元素样式 |
| `src/App.css` | 全部组件样式 + 新拟物结构覆盖块 |
| `src/main.tsx` | 启动时调用 `applySavedTheme()`，避免首帧闪烁 |
| `src/components/SettingsDialog.tsx` | 设置 → 外观与动态 → 主题（选择 / 导入 / 导出 / 删除） |
| `electron/main.ts` | `dialog:open-theme`、`theme:save` 两个 IPC（文件选择与保存） |

## 2. 主题 JSON 格式

```json
{
  "name": "暖沙新拟物",
  "style": "neumorphism",
  "tokens": {
    "bg-page": "#e8e2d9",
    "shadow-dark": "#c4bcae",
    "shadow-light": "#fffdf8",
    "cyan": "#8a7bd8"
  }
}
```

校验规则（`parseThemeDocument`）：

- `name`：1-24 个字符。
- `style`：只能是 `"glass"` 或 `"neumorphism"`。
- `tokens`：键必须是第 3 节列出的令牌名；值必须是 160 字符以内、仅含颜色/长度/阴影合法字符的字符串。`url()`、`@`、引号、花括号、分号等注入载体一律拒绝。
- 未通过校验的主题不会应用，错误逐条显示在设置界面。

## 3. 令牌参考表

「玻璃默认值」即不切换主题时的外观；「新拟物值」为内置新拟物主题的取值。

| 令牌 | 用途 | 玻璃默认值 | 新拟物值 | 主要消费组件 |
| --- | --- | --- | --- | --- |
| `--bg-page` | 页面基础背景 | `#0b1014` | `#e0e5ec` | `.app-shell` |
| `--surface` | 常规面板/控件表面 | `rgba(9,14,18,.43)` | `#e0e5ec` | `.glass-material`、`.sidebar`、按钮、卡片、弹窗 |
| `--glass` | 浮层玻璃表面 | `rgba(10,16,20,.58)` | `#e0e5ec` | `.glass-modal` |
| `--window-mask` | 窗口遮罩 | `rgba(7,12,16,.48)` | `rgba(224,229,236,.75)` | 窗口级遮罩层 |
| `--shadow`（=`--shadow-window`） | 窗口级阴影 | `0 24px 70px ...` | `12px 12px 24px #b8bcc2, -12px -12px 24px #ffffff` | `.modal`、`.glass-modal` |
| `--ink` | 主文字 | `#edf6f8` | `#333333` | 全局文字 |
| `--muted` | 次要文字 | `#9cabb2` | `#6b7280` | 说明文字、标签 |
| `--quiet` | 弱化文字 | `#6f7e86` | `#8f99a3` | 占位、页脚 |
| `--line` | 分隔线/描边 | `rgba(225,241,244,.1)` | `transparent` | 列表分隔、卡片描边 |
| `--cyan` | 主强调色 | `#80dce8` | `#6d5dfc` | 主按钮文字、激活态、图标强调 |
| `--blue` / `--blue-strong` | 链接/加强强调 | `#80dce8` / `#9ee8f1` | `#6d5dfc` / `#7d6dff` | 链接、进度 |
| `--green` | 成功状态 | `#52d49a` | `#3f9f85` | 状态点、成功提示 |
| `--amber` | 警示状态 | `#e4a44e` | `#c98a3d` | 需要确认状态 |
| `--red` | 危险状态 | `#ff716a` | `#d96459` | 删除按钮、错误、倒计时环 |
| `--shadow-dark` | 暗阴影色（+X/+Y） | `rgba(0,0,0,.45)` | `#b8bcc2` | 一切双光源阴影的右下分量 |
| `--shadow-light` | 亮阴影色（-X/-Y） | `rgba(255,255,255,.1)` | `#ffffff` | 一切双光源阴影的左上分量 |
| `--shadow-raised` | 凸起阴影 | `0 18px 40px rgba(0,0,0,.14)` | `8px 8px 16px #b8bcc2, -8px -8px 16px #ffffff` | 卡片、面板、按钮默认态 |
| `--shadow-raised-hover` | 悬停阴影（必须更小） | `0 24px 48px rgba(0,0,0,.22)` | `4px 4px 8px #b8bcc2, -4px -4px 8px #ffffff` | 卡片/按钮悬停 |
| `--shadow-pressed` | 按下内凹 | `inset 0 2px 8px rgba(0,0,0,.4)` | `inset 4px 4px 8px #b8bcc2, inset -4px -4px 8px #ffffff` | 按钮 active、激活的导航 |
| `--shadow-inset` | 输入槽默认内凹 | `inset 0 2px 10px rgba(0,0,0,.3)` | `inset 6px 6px 12px #b8bcc2, inset -6px -6px 12px #ffffff` | 输入框、开关轨道、嵌入面板 |
| `--shadow-inset-focus` | 输入槽聚焦（更浅） | `inset 0 1px 6px rgba(0,0,0,.35)` | `inset 2px 2px 4px #b8bcc2, inset -2px -2px 4px #ffffff` | 输入框 focus |
| `--radius` | 通用圆角 | `14px` | `16px` | 卡片、面板 |
| `--radius-small` | 小圆角 | `10px` | `12px` | 按钮、小控件 |
| `--transition-surface` | 表面过渡 | `box-shadow .2s ease, ...` | `box-shadow 300ms ease-in-out, ...` | 一切交互表面 |

## 4. 全组件 CSS 地图

按界面区域列出全部组件。**选择器**位于 `src/App.css`（另有标注者除外）。

### 4.1 应用外壳与背景

| 组件 | 选择器 | 消费令牌 | 新拟物处理 |
| --- | --- | --- | --- |
| 应用外壳 | `.app-shell`（含 `--window-radius`） | `--bg-page`、`--ink` | 背景改为纯色浅底，内描边改为白色高光 |
| 交互背景层 | `.interactive-backdrop`（`::before/::after`、`.static-backdrop`、`.ripple-distortion`） | 无（背景图专用） | `display: none`（纯色基底隐藏背景图与动态效果） |
| 背景效果层 | `.background-effect-rays/particles/gpu` | 无 | 随背景层一并隐藏 |
| 窗口圆角 | `.app-shell` 的 `--window-radius`、`.window-maximized` | — | 保留（圆角 14px，最大化时归零） |
| 启动失败页 | `.startup-error`（index.css） | `--ink`、`--muted` | 暂未适配新拟物（仅在桥接失败时出现） |

### 4.2 标题栏与侧栏

| 组件 | 选择器 | 消费令牌 | 新拟物处理 |
| --- | --- | --- | --- |
| 标题栏 | `.titlebar`、`.brand-mark`、`.titlebar-subtitle` | `--ink`、`--quiet` | 文字改深色 |
| 侧栏容器 | `.sidebar` | `--surface` | 实心表面、去模糊 |
| 资料库首页按钮 | `.library-home-button` | `--surface`、`--shadow-raised/pressed`、`--cyan` | 凸起/激活内凹 |
| 资料库导航项 | `.workspace-nav`（`.nav-icon`、`.nav-copy`） | `--surface`、`--shadow-raised/-hover/pressed` | 卡片化凸起，激活内凹 |
| 侧栏动作 | `.sidebar-action`（`.add-library-action`、`.count`） | `--muted`、`--cyan`、`--shadow-inset` | 悬停凸起，计数徽章内凹 |
| 批量勾选框 | `.bulk-check`（`.on`） | `--shadow-inset/pressed`、`--cyan` | 凹槽 + 凸起圆点 |

### 4.3 资料库首页（四种视图）

| 组件 | 选择器 | 消费令牌 | 新拟物处理 |
| --- | --- | --- | --- |
| 首页头部 | `.library-overview`、`.library-overview-header`、`.overview-eyebrow` | `--cyan`、`--muted` | 文字换色 |
| 视图切换器 | `.view-switch` | `--surface`、`--shadow-inset/raised`、`--cyan` | 凹槽容器，激活项内凹 |
| 玻璃图标卡片 | `.library-glass-grid`、`.library-glass-card`、`.library-card-cover/glass/copy/meta` | `--surface`、`--shadow-raised/-hover`、`--ink`、`--muted` | 卡片凸起、悬停仅阴影缩小（无位移），文字去投影 |
| 动态网格视图 | `.library-motion-grid`（GridMotion.css） | — | 暂未适配新拟物（保持深色，见已知边界） |
| 手风琴/深度轮播 | `.accordion-workspaces`、`.accordion-workspace-track > button`、`.depth-workspaces`、`.depth-stage > button`、`.depth-copy`、`.depth-dots`、`.showcase-toolbar`、`.showcase-hint` | `--surface`、`--shadow-raised`、`--cyan` | 卡片凸起、去投影，指示点用 `--shadow-dark` |
| 占位图标 | `.showcase-fallback`、`.showcase-empty` | `--surface`、`--quiet` | 内凹占位 |

### 4.4 资料库详情

| 组件 | 选择器 | 消费令牌 | 新拟物处理 |
| --- | --- | --- | --- |
| 详情头部 | `.workspace-header`、`.workspace-back-button`、`.status-line`、`.path-text`、`.header-actions` | `--ink`、`--muted` | 深色文字、去文字投影 |
| 状态徽章 | `.status-pill`（`.attention`、`.error`） | `--green/amber/red`、`--shadow-inset` | 内凹胶囊 |
| 摘要条 | `.summary-strip > div` | `--surface`、`--shadow-raised`、`--cyan` | 凸起块 |
| 同步目标行 | `.target-row`（`:hover`、`::before`）、`.target-title`、`.target-main p` | `--surface`、`--shadow-raised/-hover`、`--ink`、`--muted` | 悬停仅阴影缩小，无位移 |
| 提供器图标 | `.provider-icon`（`.git/.webdav/.local`） | `--cyan`、`--shadow-inset` | 内凹图标座 |
| 目标健康度 | `.target-health`、`.target-health.bad` | `--green`、`--red` | 状态点换色 |
| 目标右键菜单 | `.more-wrap`、`.context-menu` | `--surface`、`--shadow-raised/inset` | 凸起菜单，悬停内凹 |
| 空状态 | `.inline-empty` | `--surface`、`--shadow-inset` | 内凹槽 |

### 4.5 自动同步设置与活动

| 组件 | 选择器 | 消费令牌 | 新拟物处理 |
| --- | --- | --- | --- |
| 开关行 | `.setting-row`（`input`、`i`、`i::after`） | `--surface`、`--shadow-inset`、`--cyan` | 轨道内凹，滑块凸起，开启滑块用强调色 |
| 滑杆行 | `.setting-range-row`、`input[type='range']`、`output` | `--cyan`（accent-color） | 强调色滑杆 |
| 活动列表 | `.activity-block`、`.activity-row`、`.activity-icon` | `--ink`、`--muted`、`--green/amber/red` | 文字换色 |

### 4.6 通用控件

| 组件 | 选择器 | 消费令牌 | 新拟物处理 |
| --- | --- | --- | --- |
| 主/次/普通按钮 | `.primary-button`、`.secondary-button`、`.plain-button`（`.large`） | `--surface`、`--cyan`、`--shadow-raised/-hover/pressed` | 凸起→悬停缩小→按下内凹，无位移 |
| 同步/危险按钮 | `.sync-button`、`.danger-button` | 同上 + `--red` | 同上 |
| 图标按钮 | `.icon-button` | 同上 | 同上 |
| 表单字段 | `.form-grid`、`.field`（`input`/`select`）、`.input-action` | `--surface`、`--shadow-inset/-focus`、`--ink`、`--muted` | 内凹输入槽，聚焦变浅 |
| 仓库来源/可见性 | `.repository-mode button`、`.visibility-options button` | `--surface`、`--shadow-raised/pressed`、`--cyan` | 凸起，激活内凹 |
| 提示与错误 | `.form-note`、`.form-error`、`.form-success`、`.performance-note`、`.recovery-note` | `--surface`、`--shadow-inset`、`--muted/red/green` | 内凹提示条 |

### 4.7 弹窗与反馈

| 组件 | 选择器 | 消费令牌 | 新拟物处理 |
| --- | --- | --- | --- |
| 弹窗底 | `.modal-backdrop` | —（半透明遮罩） | 浅灰遮罩 + 轻模糊 |
| 弹窗容器 | `.modal`、`.glass-modal` | `--surface`、`--shadow-raised` | 实心凸起面板，去模糊 |
| 设置弹窗结构 | `.cursor-settings-modal`、`.settings-top-nav`、`.settings-cross-layout`、`.settings-side-nav`、`.cursor-settings-content`、`.setting-group-heading` | `--ink`、`--muted`、`--cyan`、`--shadow-inset/pressed` | 分类导航文字换色，激活内凹 |
| 选项卡组 | `.cursor-choice-grid`、`.effect-preview`（各效果类）、`.cursor-color-grid` | `--surface`、`--shadow-raised/pressed` | 凸起选项，激活内凹 |
| 审查弹窗 | `.review-modal`、`.review-symbol`、`.plan-steps`、`.issue-list` | `--surface`、`--shadow-inset`、`--cyan/red/amber` | 内凹步骤与清单 |
| 危险确认 | `.fuse-confirm`、`.confirm-ring`、`.confirm-choice` | `--red`、`--shadow-inset` | 倒计时环用状态红 |
| 移除/恢复弹窗 | `.remove-workspace-modal`、`.cloud-restore-modal`、`.cloud-workspace-list` | 同弹窗容器 | 同上 |
| 进度浮层 | `.progress-float`、`.progress-*` | `--surface`、`--cyan` | 凸起面板 |
| 通知条 | `.toast`（`.error`） | `--surface`、`--shadow-raised`、`--green/red` | 凸起通知 |
| 封面裁剪 | `.cover-crop-modal`、`.cover-crop-viewport`、`.cover-zoom-control` | 同弹窗容器 + `--shadow-inset` | 画布区保持功能原样 |

### 4.8 云账户与账户页

| 组件 | 选择器 | 消费令牌 | 新拟物处理 |
| --- | --- | --- | --- |
| GitHub 账户卡 | `.cloud-account-card`、`.account-symbol` | `--surface`、`--shadow-inset`、`--green` | 内凹卡 |
| 配置仓库卡 | `.cloud-config-card`、`.cloud-config-icon`、`.cloud-config-actions` | 同上 | 内凹卡 |
| 关于页 | `.settings-about-panel`、`.settings-project-loop`、`.loop-avatar` | `--ink`、`--muted` | 文字换色（LogoLoop 保持原样） |

### 4.9 主题系统自身

| 组件 | 选择器 | 消费令牌 |
| --- | --- | --- |
| 主题卡片 | `.theme-grid`、`.theme-card`（`.active`、`.theme-swatch`） | `--surface`、`--shadow-raised/-hover/pressed`、`--ink`、`--muted` |
| 导入/导出 | `.theme-actions`、`.theme-import-error` | 复用按钮与错误样式 |

### 4.10 独立样式文件

| 文件 | 组件 | 主题说明 |
| --- | --- | --- |
| `src/components/StartupExperience.css` | 启动画面（`.startup-experience` 及子元素） | 暂不随主题切换：启动画面保持深色云玻璃外观（仅出现 2-3 秒）。已知边界，见第 7 节。 |
| `src/components/GridMotion.css` | 动态网格视图 | 暂未适配新拟物，切换主题后该视图仍为深色；玻璃/其余视图均已适配。 |
| `src/components/LogoLoop.css` | 关于页循环带 | 使用继承文字色，主题切换后自动跟随。 |
| `src/components/RippleDistortion.css` | 水波背景画布 | 仅在玻璃基底显示（新拟物隐藏背景层）。 |

## 5. 新拟物派合规映射

风格提示词中的禁止项在结构块中的落实方式：

| 规则 | 落实 |
| --- | --- |
| 禁止纯黑/纯白背景 | `--bg-page: #e0e5ec`，`.interactive-backdrop` 整层隐藏 |
| 禁止高对比配色 | 文字 `#333333`/`#6b7280`，状态色改为适配浅底的深色调 |
| 禁止粗边框 | 结构块中一律 `border-color: transparent` |
| 禁止渐变背景 | 背景层隐藏；未新增任何 gradient |
| 禁止直角 | `--radius: 16px`、`--radius-small: 12px` |
| 禁止 translate 位移 | 按钮与卡片 active/hover 的 `transform: none`（仅阴影变化） |
| hover 阴影缩小 | `--shadow-raised`（16px）→ `--shadow-raised-hover`（8px） |
| active 外凸转内凹 | `--shadow-pressed`（inset），禁止 translate |
| 输入框 focus 内凹变浅 | `--shadow-inset`（6px）→ `--shadow-inset-focus`（2px） |
| 光源方向固定 | 全部双光源阴影：暗 `+X/+Y`（`--shadow-dark`），亮 `-X/-Y`（`--shadow-light`） |
| 过渡 duration-300 ease-in-out | `--transition-surface` |

## 6. 使用说明

- **切换**：设置 → 外观与动态 → 主题 → 点击卡片立即生效并记忆（localStorage `tianchuang.theme.v1`）。
- **导入**：同页面「导入主题文件」选择 `.json`（格式见第 2 节）；导入成功即应用并加入自定义主题列表（最多以文件为单位管理，可删除）。
- **导出**：「导出当前主题」把当前生效的主题（含自定义令牌）写成 JSON。
- **编程接口**（`src/themes.ts`）：`applyTheme`、`parseThemeDocument`、`getSavedThemeSelection`、`saveThemeSelection`、`listCustomThemes`、`saveCustomTheme`、`removeCustomTheme`、`applySavedTheme`。

## 7. 已知边界

1. 启动画面与动态网格视图（GridMotion）暂未适配新拟物，切换主题后仍为深色（见 4.10）。
2. 新拟物基底会隐藏背景图与动态效果（风格要求纯色同系背景）；切回云玻璃自动恢复。
3. 自定义光标颜色（设置 → 指针配色）与主题独立，浅色主题下建议自行调深颜色。
4. `--line: transparent` 会去掉部分分隔线，这是新拟物"无缝表面"的预期效果；玻璃主题不受影响。
5. 导入的主题只含令牌，不改结构；需要新结构基底（例如"拟物深色版"）需在 App.css 增加对应 `[data-theme]` 块并在 `THEME_TOKEN_NAMES` 校验后发布。
