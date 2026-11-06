# 青石 Slate

给控制台、后台、数据工具用的设计系统：冷静的蓝灰，信息密而不挤，数字对得齐。
A calm blue-grey system for consoles, admin panels and data tools: dense but never cramped, with numbers that line up.

文件：`tokens.css`（设计变量）、`components.css`（组件类，全部取变量）、`components.html`（组件样张）。新设计里先 link `tokens.css`，再 link `components.css`。

## 原则

1. **信息先于装饰**。界面九成是中性色和文字，主色只给「下一步要点的东西」和「当前选中的东西」。
2. **密，但有节奏**。正文 14px、控件 32 高、表格行 40；组内 8、组间 16、区块 24–32，靠间距分组，不靠框套框。
3. **数字要能比**。所有数字用等宽数字（`.num` 或 `font-variant-numeric: tabular-nums`），表格里数字右对齐；编号、提交号、命令用等宽字体（`.mono`）。
4. **边框分层，阴影只给浮起来的**。卡片、表格用 1px 线；下拉、弹窗、轻提示才有阴影。

## 颜色

| 角色 | 变量 | 值 | 用在哪 |
| --- | --- | --- | --- |
| 页面背景 | `--color-bg` | `#F3F5F8` | 整页底色 |
| 表面 | `--color-surface` | `#FFFFFF` | 卡片、表格、弹窗、输入框 |
| 次表面 | `--color-surface-2` | `#ECEFF3` | 表头、侧栏、分段控件底、禁用 |
| 正文 | `--color-text` | `#17202B` | 对 bg 15.1:1 |
| 次要文字 | `--color-muted` | `#536073` | 说明、表头、时间；对 bg 5.9:1，不要再调浅 |
| 分割线 | `--color-line` | `#DCE1E8` | 卡片边、行线 |
| 控件边 | `--color-line-strong` | `#A9B3C0` | 输入框、勾选框、描边按钮 |
| 主色 · 钢青 | `--color-primary` | `#2D5E91` | 主按钮、选中、链接、焦点；白字 6.7:1 |
| 主色浅底 | `--color-primary-soft` | `#E5EDF6` | 选中行、当前导航、信息提示 |
| 点缀 · 锈铜 | `--color-accent` | `#B4572A` | 「新」标签、对比数据的第二条线；一屏最多两处 |
| 成功 | `--color-success` / `-soft` | `#1C7A4D` / `#E2F2E9` | 成功标签、提示条 |
| 警告 | `--color-warning` / `-soft` | `#8F6000` / `#FBF0D6` | 字用 warning，点和进度条用 `--color-warning-fill`（`#D09A1E`） |
| 错误 | `--color-danger` / `-soft` | `#BF3B30` / `#FBE8E5` | 失败、删除；实心红底上的字用 `--color-danger-ink` |
| 反色 | `--color-inverse` | `#1E2833` | 轻提示的深底 |
| 遮罩 | `--color-overlay` | 48% 深蓝灰 | 弹窗后面 |

- 状态一律「浅底 + 同色深字」（soft 底配 success / warning / danger 字），对比都在 4.5:1 以上，一整列也不刺眼。
- 大约的用量：bg 和 surface 占八成，surface-2 一成左右，主色 5–6%，点缀和红色加起来不到 5%。
- 中性色都带一点蓝，别混进纯灰（`#888`、`#ccc` 这类）。

## 字体

- 正文 `--font-sans`：系统 UI 字体，中文落到苹方 / 鸿蒙黑体 / MiSans。标题和正文同一款，靠字重和字号拉开。
- 等宽 `--font-mono`：提交号、实例名、命令、快捷键。
- 字号阶梯（px）：xs 12 · sm 13 · md 14（正文）· lg 16 · xl 18 · 2xl 22 · 3xl 28 · 4xl 36。一屏最多用四档。
- 字重：400 正文、500 按钮和标签、600 标题和数字；700 基本不用。
- 行高：标题 1.25，控件和表格 1.4，正文 1.55，长段落 1.7。
- 大标题字距收一点（-0.02em）；中文不用斜体。

## 间距、圆角、阴影

- 8px 网格：`--space-1` 4 · `-2` 8 · `-3` 12 · `-4` 16 · `-5` 24 · `-6` 32 · `-7` 48 · `-8` 64。4 和 12 只在控件内部用。
- 控件高：`--control-sm` 28（表格行内、工具栏）· `--control-md` 32（默认）· `--control-lg` 40（表单底部、空状态）。
- 圆角：sm 4（标签、勾选框）· md 6（按钮、输入框）· lg 8（卡片、表格）· xl 12（弹窗）。不做胶囊按钮。
- 阴影：`--shadow-sm` 按钮 · `--shadow-md` 下拉、悬浮卡 · `--shadow-lg` 弹窗、轻提示。焦点光圈 `--ring`（3px 主色 32%）。

## 组件

**文字** `.display` `.h1` `.h2` `.h3` `.body` `.caption` `.overline` `.num` `.mono` `.link` `.kbd`

**按钮** `.btn`（主）`.btn-secondary`（描边）`.btn-ghost`（文字）`.btn-danger`；尺寸 `.btn-sm` `.btn-lg`；`.btn-icon` 方形图标按钮；`.btn-block` 占满一行；禁用写 `disabled` 或 `aria-disabled="true"`。
- 用：一块区域一个主按钮，放在最右；文案动词开头、说清结果（「新建部署」「导出 CSV」）。
- 别：一排三个实心按钮；危险操作做成默认焦点；只放图标不写 `aria-label`。

**表单** `.field` 包住 `.label` + 控件 + `.hint`；控件 `.input` `.textarea` `.select`（`.input-sm` 小一号）；`.input-wrap` 给输入框加前置图标或快捷键；`.check` `.radio` `.switch` 用 `<label>` 包住 `<input>`。
- 用：标签在上、说明在下；出错写 `aria-invalid="true"`，下面 `.hint.is-error` 一句话说怎么改。
- 用：即时生效的设置用 `.switch`；要点保存才生效的多选用 `.check`。
- 别：只用占位字当标签；同一个表单里混用两种高度。

**标签与状态** `.tag` + `.tag-primary` `.tag-success` `.tag-warning` `.tag-danger` `.tag-accent` `.tag-outline`；角标 `.badge`（`.badge-muted`）；状态点 `.dot` + `.dot-success` 等；进度 `.progress > i`。
- 用：表格里状态多时用「状态点 + 字」，比标签省地方。
- 别：把标签做成能点的样子；能点的用 `.btn-sm`。

**卡片** `.card`，可选 `.card-header` `.card-title` `.card-meta` `.card-footer`；`.card-flush` 去内边距；`.card-raised` 悬浮。指标卡用 `.stat-row` `.stat-label` `.stat-value` `.stat-delta.up/.down`。
- 用：1px 边、不加阴影；同一排卡片等高。
- 别：卡片里再套带边框的卡片。

**表格** `.table-wrap > .table`；数字列加 `.num`（右对齐、等宽）；选中行 `tr.is-selected`；紧凑版 `.table-dense`（行高 32）；勾选列 `.col-check`。上方工具栏放搜索、筛选和批量操作，下方放条数和 `.pagination`。
- 别：给每列加竖线；数字居中。

**提示条** `.alert` + `.alert-success` `.alert-warning` `.alert-danger`（默认是信息）；里面 `svg` 图标、`.alert-title`、`.alert-text`、可选 `.alert-action`。
**轻提示** `.toast`（`.toast-danger`）：右下角深底白字，3 秒消失，可带一个「撤销」。
- 用：标题说结果，正文说下一步；出错给能点的去处。
- 别：用轻提示报要处理的错误。

**标签页与导航** `.tabs > .tab`（`aria-selected="true"` 是当前）；`.segmented` 分段切换；顶栏 `.navbar`（48 高）；侧栏 `.nav > .nav-item`（`aria-current="page"`）和 `.nav-title`；`.breadcrumb`；`.pagination`。
- 用：同一页切视图用标签页，切时间范围、筛选用分段，切页面用侧栏。

**弹窗** `.modal-scrim > .modal`，里面 `.modal-header`（`.modal-title`）`.modal-body` `.modal-footer`。宽 480。
- 用：只在必须马上决定时用；标题是一个问题，按钮写清后果（「删除环境」而不是「确定」）。
- 别：在弹窗里再开弹窗；放长表单（用新页面或抽屉）。

**头像** `.avatar`（`.avatar-sm` 24 · 默认 32 · `.avatar-lg` 40）；`.avatar-square` 用于团队、项目；颜色 `.avatar-accent` `.avatar-success` `.avatar-neutral` 轮换；`.avatar-group` 叠放。没有照片时放姓氏首字。

**空状态** `.empty > .empty-art + .empty-title + .empty-text + 按钮`。说清为什么是空的、下一步做什么，只给一个主按钮。

## 深色

给 `<html>` 或某一块加 `data-theme="dark"`，同一套变量换值，组件不用改。深色下靠更亮的表面分层，不靠阴影。

## 适合 / 不适合

- 适合：运维控制台、数据后台、内部工具、开发者产品、表格多的 SaaS。
- 不太适合：面向大众的营销页、生活方式品牌、儿童产品——会显得太冷。
