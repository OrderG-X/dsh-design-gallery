# 墨刻 Inkwell

给新闻站、杂志、博客和长文阅读 App 用的设计系统：暖白的纸、近黑的墨、一点朱砂；宋体标题、黑体界面，正文行高 1.9，细线分栏。安静、好读、像一本排得很用心的刊物。
A calm, literary system for news sites, magazines, blogs and long-form reading apps: ink on warm paper with a single vermilion accent, Song serif headings over a clean sans UI, generous CJK line height and thin rules.

文件：`tokens.css`（设计变量，含米黄、夜读两套主题）、`components.css`（组件类，全部取变量）、`components.html`（组件样张）。新设计里先 link `tokens.css`，再 link `components.css`；`<body class="paper">` 给页面铺上纸色和默认字体。

## 原则

1. **字是主角**。界面九成是纸和墨，没有彩色按钮、没有渐变、没有卡片阴影。层次靠字号、字重、细线和留白，不靠框和色块。
2. **宋体管读，黑体管用，楷体管「说话」**。标题、正文、摘句用宋体；按钮、导航、署名、时间、评论用黑体；导语、题记、划线摘录用楷体。三种字各司其职，不混用。
3. **一点朱红**。朱砂只落在栏目名、首字下沉、阅读进度、文末符号和一个订阅按钮上，一屏不超过三处。主按钮是墨，不是朱砂。
4. **为长时间阅读排版**。正文 17px、行高 1.9、一行不超过 36 字、两端对齐；段间空一行，不缩进（要缩进用 `.prose-indent`）。宁可空，也别挤。
5. **线分栏，不用框套框**。细线（1px）分行，粗线（3px 墨）开栏目，双线收报头和页脚。几乎是方角：按钮 2px，面板 4px。

## 颜色

| 角色 | 变量 | 值 | 用在哪 |
| --- | --- | --- | --- |
| 纸 · 页面背景 | `--color-bg` | `#F5F1E8` | 整页底色；暖白，不用纯白 |
| 表面 | `--color-surface` | `#FBF8F2` | 输入框、弹窗、样张里的面板 |
| 次表面 | `--color-surface-2` | `#ECE6D9` | 按语、代码、分段控件槽、订阅框 |
| 墨 · 正文 | `--color-text` | `#1B1915` | 对 bg 15.6:1；标题、正文都用它 |
| 淡墨 · 次要 | `--color-muted` | `#67604F` | 署名、时间、图注；对 bg 5.5:1，对 surface-2 5.0:1，别再调浅 |
| 细线 | `--color-line` | `#DCD4C3` | 行间分隔、卡片边 |
| 控件边 | `--color-line-strong` | `#8F856F` | 输入框、勾选框；对 surface 3.4:1 |
| 粗线 | `--color-rule` | `#1B1915` | 栏目头、报头、表格顶线 |
| 主色 · 墨 | `--color-primary` | `#1B1915` | 主按钮、选中的分段、开关；纸字 16.6:1 |
| 墨浅底 | `--color-primary-soft` | `#E9E3D5` | 次按钮悬停、当前项底；墨字 13.7:1 |
| 点缀 · 朱砂 | `--color-accent` | `#B3341C` | 栏目名、首字、进度、订阅按钮；在纸上 5.4:1，纸字 5.8:1 |
| 朱浅底 | `--color-accent-soft` | `#F4E2DA` | 表格里标出的行、头像底；朱字 4.9:1 |
| 划线黄 | `--color-highlight` | `#F2E3A6` | 读者划线；墨字 13.6:1 |
| 松绿 · 成功 | `--color-success` / `-soft` | `#2E6B4A` / `#E3EDE3` | 已订阅、已发布；5.3:1 |
| 赭石 · 提醒 | `--color-warning` / `-soft` | `#8A5B10` / `#F4E9CF` | 草稿、待处理；4.9:1。点和进度条用 `--color-warning-fill` |
| 胭脂 · 错误 | `--color-danger` / `-soft` | `#A0263F` / `#F5E1E3` | 出错、删除、退订；5.9:1，实心底上纸字 7.0:1 |
| 靛青 · 通知 | `--color-info` / `-soft` | `#2F4F7A` / `#E2E8F0` | 一般通知、「接着读」；6.8:1 |
| 反色 | `--color-inverse` | `#1B1915` | 轻提示、划词工具条 |
| 遮罩 | `--color-overlay` | 52% 墨 | 弹窗、底部面板后面 |

- **墨分五色** `--ink-1`…`--ink-5`（清、淡、重、浓、焦：`#E4DDCF` `#C5BBA8` `#8E8573` `#4A443A` `#1B1915`）给插图、占位图、图表和缩略图用。换主题时它们会跟着反过来，所以插图用这几个变量画，夜读下自己就对了。
- 状态一律「浅底 + 同色深字」，对比都在 4.5:1 以上。错误用胭脂，不用朱砂，而且一定配图标和一句说明——读者要分得清「点这里」和「出问题了」。
- 大约的用量：纸 70%，墨 22%，细线和次表面 6%，朱砂 2% 左右。
- 链接是墨字 + 朱砂下划线（`--color-link-line`），悬停整个变朱；不要整段红字。

## 字体

- 宋体 `--font-serif`：标题和正文。拉丁字母先走 Charter / Georgia，中文落到宋体-简 / 思源宋体 / 华文宋体 / 宋体。
- 黑体 `--font-sans`：按钮、导航、表单、署名、时间、图注、评论。系统 UI 字体，中文落到苹方 / 鸿蒙黑体 / MiSans / 微软雅黑。
- 楷体 `--font-kai`：导语 `.dek`、题记 `.epigraph`、普通引文、划线摘录。一屏一两段，不排正文。
- 等宽 `--font-mono`：代码、快捷键。
- 正文字体是 `--font-reading`（默认宋体）；读者选「黑体」时给内容区加 `.prose-sans`。
- 字号阶梯（px，约 1.25 倍一档）：xs 12 · sm 13 · md 15（界面）· lg 17（正文）· xl 20（导语、h3）· 2xl 24 · 3xl 30 · 4xl 38（文章标题）· 5xl 48 · 6xl 64（封面）。
- 读者调字号只改 `--text-reading`：`.prose-sm` 15 · 默认 17 · `.prose-lg` 19 · `.prose-xl` 21。
- 字重：宋体只用 400（正文）、700（小标题、列表标题）、900（`.display` `.headline`，宋体 Black；没有 Black 的系统落回粗体）。黑体用 400 / 500 / 600。
- 行高：大标题 1.25–1.3，界面 1.4，说明和评论 1.65–1.75，正文 1.9（`.prose-loose` 2.1，`.prose-tight` 1.7）。
- 版心 `--measure` 36em（约 35 字）；标题区、图和表可放宽到 `--measure-wide` 46em。
- 中文细节：不用斜体，强调用着重号（`em` 或 `.em-dot`）或加粗；引号用「」，书名用《》；中文和数字、西文之间加空格；数字用 `.num` 对齐；正文两端对齐，标题和图注左对齐。

## 间距、线、圆角、阴影

- 间距 4px 起步：`--space-1` 4 · `-2` 8 · `-3` 12 · `-4` 16 · `-5` 24 · `-6` 32 · `-7` 48 · `-8` 64 · `-9` 96。组内 8–12，组间 24，栏目之间 64–96。
- 线：`--rule-thin` 1px 细线（行间）· `--rule-mid` 2px（表头、目录头）· `--rule-thick` 3px（开一个栏目）。现成的 `<hr class="rule">` `.rule-thick` `.rule-double`（粗 3 + 细 1，报头和页脚）。
- 控件高：`--control-sm` 32 · `--control-md` 40 · `--control-lg` 48。
- 圆角：0（卡片、按语、缩略图）· `--radius-sm` 2（按钮、输入框、标签）· `-md` 3（分段、轻提示）· `-lg` 4（面板、弹窗）· `-full`（只给头像、开关、角标）。
- 阴影平时不用。`--shadow-md` 给菜单、阅读设置面板；`--shadow-lg` 给弹窗、轻提示。焦点一律 2px 朱砂描边、外移 2px（`--color-focus`）。
- 动效安静：`--dur` 180ms、`--ease`，不弹不跳；系统开了「减少动态效果」时为 0。

## 组件

**底子与印章** `.paper`（纸色 + 默认字体）`.rule` `.rule-thick` `.rule-double`；印章 `.seal`（`.seal-sm` `.seal-lg`），朱砂方块加一道内框，字竖排——放刊名、「编辑推荐」「慢信」这类；文末符号 `.endmark`。
- 用：一页一枚印章就够；印章里一到四个字。
- 别：把印章当按钮或标签满屏撒。

**文字** `.display` `.headline` `.h1` `.h2` `.h3`（宋体）`.h4`（黑体）`.kicker`（栏目名，朱砂黑体，`.kicker-ink` 墨色版，中间用 `<span class="sep">` 竖线隔开）`.dek`（楷体导语）`.lead` `.overline` `.meta`（黑体小字，用 `.sep` 加圆点）`.caption` `.body` `.num` `.mono` `.link` `.kbd`。

**文章头** `.article-header` 依次放 `.kicker` → `.headline` → `.dek` → `.article-header-foot`（细线下面一行：`.byline` 头像和署名、`.dateline` 日期和阅读时长、收藏 / 分享 / 听全文按钮）。专题封面用 `.article-header.is-center`，可加 `.seal` 和 `.epigraph`。
- 用：标题最多两行，说事实；导语最多三行，说为什么值得读。署名写清角色（文 / 摄影 / 插画 / 编辑）。
- 别：标题里用感叹号、「震惊」；把标签和日期塞进标题和导语之间。

**正文** 给内容区套 `.prose`，里面直接写 `p` `h2` `h3` `ul` `ol` `blockquote` `figure` `pre` `hr` `mark` `em` `a`，不用逐个加类。另有：
- `.dropcap` 首字下沉（朱砂、宋体粗，两行高），一篇只用一次，放第一段。
- `blockquote.pullquote` 摘句：大一号宋体粗，上面一截朱砂短线；`.is-center` 居中版；`cite` 写出处。一篇最多两处。
- `blockquote.epigraph` 题记：楷体，退两字。普通 `blockquote` 是楷体加左边一道墨线。
- `sup.footnote-ref` 脚注号 + 文末 `section.footnotes > ol`。
- `figure.figure` + `.figure-caption`（左边 `<b>图 1</b>` 和说明，右边 `.credit` 作者）。
- `aside.aside` + `.aside-title`：编者按、延伸阅读、背景知识。
- `pre` / `.code-block` 代码块（左边一道粗墨线），`code` / `.code` 行内代码；`.c` 注释、`.k` 关键字。
- `hr` 换场是三个小菱形；`mark` / `.highlight` 是半高的划线黄。
- `.table` 数据表：顶上 2px 墨线、表头下 1px 墨线、行间细线，数字列 `.num` 右对齐，`caption` 写表名，下方 `.table-note` 写来源；要标出的行 `tr.is-marked`。

**阅读** `.reading-progress`（页面顶上一条 3px 线，`style="--progress:42%"`）、`.progress-ring`（小圆环，`style="--p:42"`）、`.progress-chip`（「已读 42% · 还剩 7 分钟」）；`.toc` 目录（当前项 `aria-current="true"` 左边朱砂竖线，读过的 `.is-read`）；`.chapter-list` 连载章节（`li.is-current` `li.is-locked`，`.ch-no` `.ch-title` `.ch-sub` `.ch-side`）；`.select-bar` 划词工具条；`.reader-panel` 阅读设置（`.reader-row` `.font-steps` `.theme-swatches > .theme-swatch[data-theme]`，色块直接带 `data-theme`，颜色自己就对）。
- 用：进度、当前章节一律朱砂；阅读设置至少给字号、行距、主题三样。
- 别：在正文上方叠浮动广告条或「打开 App」横幅挡字。

**列表** `.story`（`.story-body` 里放 `.kicker` `.story-title` `.story-dek` `.meta`，右边 `.story-thumb` 4:3 缩略图）；头条 `.story-lead`（图在上、16:9、标题 30px、楷体导语）；只有标题的 `.story-compact`；排行 `.rank-list`（大号宋体数字，第一名朱砂）；栏目头 `.section-head`（3px 墨线 + 宋体栏目名 + 右边「更多 →」）；普通列表 `.list`；卡片 `.card`（方角细边，无阴影）、`.card-rule`（只有顶线）。
- 用：列表靠细线分隔，不套卡片；缩略图方角，用 `--ink-*` 画占位。
- 别：每条都配大图；导语超过两行（`.story-dek` 自动截两行）。

**标签与状态** `.tag`（细边方块）+ `.tag-accent` `.tag-solid` `.tag-soft` `.tag-success` `.tag-warning` `.tag-danger` `.tag-info`，`.tag-sm`；话题 `.topic`（前面自动加朱砂 #）；角标 `.badge`（`.badge-muted`）；状态点 `.dot` + `.dot-accent` 等。
- 别：把标签做成能点的样子；能点的用 `.topic` 或 `.btn-sm`。

**作者与评论** `.author-card`（`.avatar` 跨三行、`.author-head` 名字和关注按钮、`.author-name` `.author-role` `.author-bio` `.author-stats`），盒子版 `.is-box`；头像 `.avatar`（`-sm` 24 · 默认 36 · `-lg` 56 · `-xl` 72；`.avatar-ink` `.avatar-accent`），没有照片放姓氏，用宋体。评论 `.comment`（`.comment-main` 里 `.comment-head` `.comment-name` `.comment-time`、`.comment-quote` 划线引用、`.comment-body`、`.comment-actions > .comment-action`，点过的 `.is-active` / `aria-pressed="true"` 变朱砂）；回复包在 `.comment-replies` 里。
- 用：评论用黑体、比正文小一号，和文章本身分开；作者回复加 `.tag-solid` 「作者」。
- 别：评论区用宋体大字，抢了正文。

**订阅** `.newsletter`（次表面底、顶上粗墨线：`.newsletter-title` `.newsletter-text` `.newsletter-form` `.newsletter-note`）；文末一行版 `.newsletter.is-inline`；输入框和按钮连成一条用 `.input-group`。
- 用：标题说清多久一封、写什么；下面一行写订阅人数和「随时可退订」。顶部订阅框用 `.btn-accent`，文末那个用墨色 `.btn`。
- 别：弹窗逼订阅；没输邮箱就把按钮做成禁用的灰块。

**按钮** `.btn`（墨底纸字）`.btn-secondary`（一道墨线）`.btn-ghost`（文字）`.btn-accent`（朱砂，一屏一个）`.btn-danger`（胭脂；`.btn-danger.btn-secondary` 描边版）`.btn-link`（带下划线的文字链）；尺寸 `.btn-sm` 32 · 默认 40 · `.btn-lg` 48；`.btn-icon` 方形图标按钮（必须写 `aria-label`）；`.btn-block`。禁用写 `disabled` 或 `aria-disabled="true"`。
- 用：一块区域一个实心按钮；文案动词开头、说清结果（「开始阅读」「加入书架」「退订」）。
- 别：胶囊形按钮、按钮阴影、一排三个实心按钮。

**表单** `.field` 包住 `.label`（`.opt` 写「选填」）+ 控件 + `.hint`（`.is-error` / `.is-ok`）；控件 `.input` `.textarea` `.select`（`.input-sm` `.input-lg`）；只有底线的 `.input-line`（文章页搜索、订阅）；`.input-wrap` 加前置图标；`.input-group` 输入框 + 按钮；`.check` `.radio` `.switch` 用 `<label>` 包住 `<input>`。
- 用：标签在上、说明在下；出错写 `aria-invalid="true"`，下面一句胭脂字说怎么改。即时生效的设置用 `.switch`。
- 别：只用占位字当标签；一个表单里混用两种高度。

**导航** 报头 `.masthead`（`.masthead-top` 日期行、`.masthead-title` 刊名、`.masthead-nav` 栏目，当前栏目 `aria-current="page"` 朱砂下划线）；`.tabs > .tab`（`aria-selected="true"`）；`.segmented`（选中是墨底）；`.breadcrumb`；`.pagination`；上一篇 / 下一篇 `.pager`（`.pager-label` `.pager-title`）；App 用 `.topbar`（`.topbar-title`）和 `.tabbar`。
- 用：同一页切视图用标签页；切时间范围、列表 / 卡片用分段。

**提示与浮层** 提示条 `.notice`（默认墨色）+ `.notice-info` `.notice-success` `.notice-warning` `.notice-danger`，里面 `svg`、`.notice-title`、`.notice-text`、可选 `.notice-action`；轻提示 `.toast`（`.toast-danger`），墨底纸字、底部居中、3 秒消失，可带一个 `.btn-ghost`；弹窗 `.dialog-scrim > .dialog`（`.dialog-header` `.dialog-title` `.dialog-body` `.dialog-footer`），宽 480，顶上一道粗墨线。
- 用：弹窗标题是一个问题，按钮写后果（「退订」而不是「确定」）；危险按钮放右边但不设成默认焦点。
- 别：用轻提示报要处理的错误；弹窗里放长表单。

**空状态** `.empty > .empty-art（线描 svg）+ .empty-title + .empty-text + 一个按钮`。说清为什么空、下一步去哪，不写「暂无数据」。

## 主题

- 纸（默认）：暖白纸、墨字 15.6:1。也可写 `data-theme="light"`，用来在深色里嵌一块浅色。
- 米黄 `data-theme="sepia"`：纸色更暖，墨字 12.5:1，适合长时间阅读、护眼模式。
- 夜读 `data-theme="dark"`：暖黑底 `#141310`、米色字 `#E4DDCF`（13.8:1），不用纯黑纯白；朱砂调亮成 `#E57A5F`（6.4:1）；划线黄变成暗金底。
- 给 `<html>` 或任何一块加 `data-theme`，同一套变量换值，组件不用改；带 `data-theme` 的元素会自己铺上底色和字色。网页要跟随系统时，把 `[data-theme="dark"]` 换成 `@media (prefers-color-scheme: dark) { :root { … } }`。
- 插图和占位图用 `--ink-1`…`--ink-5` 和 `--color-highlight` 画，三套主题下都不用重画。

## 适合 / 不适合

- 适合：新闻和资讯站、杂志和周刊、个人博客和技术博客、长文和连载阅读 App、电子书、简报邮件的网页版、出版社和书店的内容页。
- 不太适合：数据密集的后台（用不着宋体和大行高）、儿童产品、强促销的电商页——会显得太安静。

## In English

Inkwell is built for reading. Ink `#1B1915` on warm paper `#F5F1E8` (15.6:1), with vermilion `#B3341C` as the only accent (kickers, drop caps, reading progress, one subscribe button — never errors; errors use rouge `#A0263F` with an icon). Primary buttons are ink, not colour. Song serif for headlines and body (900 for headlines), system sans for UI, Kai for deks and epigraphs. Body text is 17px with 1.9 line height and a 36em measure, justified. Thin rules separate, thick 3px rules open sections, corners are nearly square and cards have no shadows. Wrap article content in `.prose` and write plain HTML inside. Themes: default paper, `data-theme="sepia"`, `data-theme="dark"` (night reading).
