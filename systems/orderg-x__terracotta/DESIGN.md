# 陶土 Terracotta

给生活方式品牌用的设计系统：陶土橙、米白和一点橄榄绿，衬线标题配无衬线正文，圆角像手捏过的边，阴影带着窑火的暖。
A warm design system for lifestyle brands — ceramics, home goods, tea and scent, craft shops: terracotta, rice white and a touch of olive, serif headlines over a clean sans.

文件：`tokens.css`（设计变量）、`components.css`（组件类，全部取变量）、`components.html`（组件样张）。新设计里先 link `tokens.css`，再 link `components.css`。

## 原则

1. **米白打底，陶土点题**。大面积是 bg / surface，陶土只落在一屏最想让人点的那个按钮、价格强调和选中状态上。
2. **标题有手感，正文要好读**。标题用衬线常规体，靠字号撑场、不加粗；正文用无衬线，16px、行高 1.65。
3. **东西是主角**。商品图放在沙色底上，留白给足；卡片平时只有细边，推荐位、悬浮时才用暖阴影。
4. **语气温和**。文案像店主说话（「在路上了，后天到」），不用感叹号和促销腔。

## 颜色

| 角色 | 变量 | 值 | 用在哪 |
| --- | --- | --- | --- |
| 页面背景 · 米白 | `--color-bg` | `#F9F5EF` | 整页底色 |
| 表面 · 纸白 | `--color-surface` | `#FFFDFA` | 卡片、弹窗、输入框 |
| 次表面 · 浅沙 | `--color-surface-2` | `#F2EBE1` | 分组底、选中的导航、分段控件槽 |
| 沙 | `--color-sand` | `#E9DCCB` | 商品图底、大色块；不放小字 |
| 正文 · 深赭 | `--color-text` | `#2B201B` | 对 bg 14.4:1 |
| 次要 · 陶灰 | `--color-muted` | `#6B5A50` | 说明、规格、时间；对 bg 5.9:1 |
| 分割线 | `--color-line` | `#E8DED1` | 卡片边、行线 |
| 控件边 | `--color-line-strong` | `#CBB9A6` | 输入框、勾选框 |
| 主色 · 陶土 | `--color-primary` | `#AE4F3B` | 主按钮、选中、价格强调；白字 5.3:1 |
| 深陶 | `--color-primary-hover` | `#923F2E` | 悬停；浅底上的主色字；链接 |
| 浅陶 | `--color-primary-soft` | `#F7E6DD` | 主色标签底、选中的选项卡片 |
| 点缀 · 橄榄 | `--color-accent` / `-soft` | `#626B33` / `#ECEDDB` | 「手作」「有机」「植物染」这类自然相关的标签和小图标 |
| 成功 | `--color-success` / `-soft` | `#2A7049` / `#E3F0E7` | 已签收、已发出 |
| 提醒 | `--color-warning` / `-soft` | `#8C5A0B` / `#F8EDD5` | 库存少、待发货；点和进度条用 `--color-warning-fill` |
| 错误 · 酒红 | `--color-danger` / `-soft` | `#A2303F` / `#F7E3E5` | 报错、取消、删除 |
| 信息 | `--color-info` / `-soft` | `#3D6680` / `#E3ECF1` | 一般通知 |
| 反色 | `--color-inverse` | `#2E231D` | 轻提示、顶部横幅、页脚 |

- 主色本身偏红，所以错误一律用酒红 danger，不用陶土，才分得清「点这里」和「出问题了」。
- 状态都是「浅底 + 同色深字」，对比 4.5:1 以上。
- 橄榄只是点缀：一屏两三处，别拿它做按钮。

## 字体

- 标题 `--font-display`：拉丁字母 Iowan Old Style，中文宋体（Songti SC / Noto Serif SC），兜底 Georgia。用常规体（400），大标题字距 -0.01em。
- 正文 `--font-sans`：系统无衬线（苹方 / 鸿蒙黑体 / MiSans）。
- 价格用衬线 `.price`，「¥」缩小一号放前面，划线原价用 `<s>`。
- 字号阶梯（px）：xs 12 · sm 14 · md 16（正文）· lg 18 · xl 22 · 2xl 28 · 3xl 40 · 4xl 56。首页大标题可以再大（80 上下），一屏仍然最多四档。
- 行高：大标题 1.15，小标题 1.35，正文 1.65，长文 1.8。
- 小字标签 `.overline` 字距 0.14em、深陶色；英文会转成大写。

## 间距、圆角、阴影

- 间距 4 / 8 的倍数：`--space-1` 4 … `--space-8` 64。卡片内边距 24，区块之间 64。比工具类产品多留一档白。
- 控件高：`--control-sm` 36 · `--control-md` 44 · `--control-lg` 52。
- 圆角：sm 6（小图、勾选框）· md 10（按钮、输入框）· lg 14（卡片）· xl 20（弹窗、大面板）· full（标签、图标按钮、分页、轻提示）。
- 阴影是暖棕色：`--shadow-sm` 按钮 · `--shadow-md` 推荐卡、悬浮 · `--shadow-lg` 弹窗、轻提示。焦点光圈 `--ring`。

## 组件

**文字** `.display` `.h1` `.h2` `.h3`（衬线）`.body` `.lead` `.caption` `.overline` `.price` `.link`（细下划线）

**按钮** `.btn`（主，实心陶土）`.btn-secondary`（细描边）`.btn-ghost`（文字 + 下划线）`.btn-danger`（酒红）；尺寸 `.btn-sm` `.btn-lg`；`.btn-icon` 圆形图标按钮；`.btn-block`；禁用写 `disabled`。
- 用：一屏一个陶土按钮（商品页「加入购物袋」、结算页「去付款」），其他用描边或文字按钮。
- 别：把主按钮做成胶囊；在沙色图片上直接放描边按钮（看不清）。

**表单** `.field` 包住 `.label`（可加 `<span class="opt">选填</span>`）+ 控件 + `.hint`；`.input` `.textarea` `.select`；`.input-group` 把输入框和按钮连成一条（订阅、优惠码）；`.check` `.radio` `.switch`；`.choice` 选项卡片（配送方式、规格）；`.stepper` 数量。
- 用：最多两列；出错写 `aria-invalid="true"`，下面 `.hint.is-error` 说清怎么改。
- 别：只用占位字当标签；把十几个字段堆在一屏。

**标签与状态** `.tag`（全圆小胶囊）+ `.tag-primary` `.tag-accent` `.tag-success` `.tag-warning` `.tag-danger` `.tag-outline` `.tag-solid`（深赭实心，用于「限量」）；`.badge`；`.dot`；`.progress`；`.rating`（星级）。
- 用：橄榄标签只给和自然、手作有关的词。
- 别：一张卡上超过三个标签。

**卡片** `.card`；`.card-media` 放商品图（4:3，沙色底，贴着卡片上边）；`.card-title`（衬线）`.card-meta` `.card-footer`；`.card-raised` 推荐位；`.card-quiet` 浅沙底、无边。
- 用：同一排商品卡等高，价格放标题右边。
- 别：每张卡都加阴影。

**表格** `.table-wrap > .table`：表头小字、字距放宽、没有底色；行高 56，只有横线；金额加 `.num` 右对齐。订单、账单这类用，商品可以带 48px 小图。

**提示条** `.alert`（默认信息蓝）+ `.alert-success` `.alert-warning` `.alert-danger`，没有边框，`.alert-title` + `.alert-text` + 可选 `.alert-action`。整条通知用 `.banner`（深赭底）。
**轻提示** `.toast`：底部居中的深赭胶囊，2–3 秒消失，可带一个文字按钮。
- 用：标题说发生了什么，正文说接下来会怎样。
- 别：用轻提示报要用户处理的错误。

**标签页与导航** 顶栏 `.navbar`（64 高，衬线店名 `.brand`，链接 `.links`）；`.tabs > .tab` 细下划线；`.segmented` 全圆沙色槽；侧栏 `.nav > .nav-item`（当前项浅沙底 + 左边 3px 陶土线）；`.breadcrumb`；`.pagination`（当前页深赭圆点）。

**弹窗** `.modal-scrim > .modal`：20 圆角、32 内边距、衬线 `.modal-title`；`.modal-body`、`.modal-footer`（右对齐，主操作在最右）。
- 用：只问一件事，按钮写清后果（「移出」「留着」）。
- 别：在弹窗里放长表单。

**头像** `.avatar`（默认 40，`.avatar-sm` 28，`.avatar-lg` 56），圆形、衬线首字；`.avatar-primary` `.avatar-accent` 和默认的沙色轮换；`.avatar-group` 叠放。

**空状态** `.empty > .empty-art（线条小插画）+ .empty-title + .empty-text + 按钮`：一句温和的话、一个去处。

## 深色

`data-theme="dark"`：深赭底、亮一点的陶土和橄榄，组件不用改。商品图保持原样（像照片一样不跟着变暗）。

## 适合 / 不适合

- 适合：器物、家居、香氛、茶、咖啡豆、手作小店、民宿、生活杂志。
- 不太适合：数据密集的后台、金融工具、儿童产品。
