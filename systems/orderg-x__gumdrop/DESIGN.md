# 软糖 Gumdrop

给年轻消费类 App 用的设计系统：葡萄紫配柠檬黄，再撒一把糖果色；圆角大、字圆，按钮底下垫一条厚实的「台阶」，按下去会沉一下。
A playful design system for young consumer apps (habits, social, snacks, small games): grape and lemon with a handful of candy colors, big radii, rounded type, and chunky buttons that sit on a solid bottom ledge.

文件：`tokens.css`（设计变量）、`components.css`（组件类，全部取变量）、`components.html`（组件样张）。新设计里先 link `tokens.css`，再 link `components.css`。

## 原则

1. **按得下去**。能点的东西都有一条实心底边（`--ledge` 4px），按下时底边收起、整块下沉。一眼就知道哪里能点。
2. **一紫一黄，糖果点缀**。葡萄紫只给一屏最重要的那个按钮和选中状态；柠檬黄留给奖励、连胜、星星；草莓、薄荷、汽水、橘子四色用在图标底、头像、贴纸、分类上。
3. **圆，但不软塌**。圆角从 10 起步（卡片 24、弹窗 32），字是圆体但标题用 800 字重，边线 2px，整体是「Q 弹」而不是「模糊」。
4. **说人话，替人高兴**。文案短、口语、带点小庆祝（「喝水 8 杯，完成！」），不用「暂无数据」「操作成功」这类系统腔。

## 颜色

| 角色 | 变量 | 值 | 用在哪 |
| --- | --- | --- | --- |
| 页面背景 · 薰衣草白 | `--color-bg` | `#F6F2FF` | 整页底色 |
| 表面 | `--color-surface` | `#FFFFFF` | 卡片、弹窗、输入框 |
| 次表面 | `--color-surface-2` | `#EFE9FF` | 分段控件槽、表头、图标底 |
| 正文 · 深墨 | `--color-text` | `#23173D` | 对 bg 15.1:1 |
| 次要字 | `--color-muted` | `#605679` | 说明、时间、计数；对 bg 6.1:1 |
| 线 / 台阶 | `--color-line` | `#E3DBF7` | 卡片边和卡片下面的台阶 |
| 控件边 | `--color-line-strong` | `#CBBFEF` | 输入框、次按钮、勾选框的 2px 边 |
| 主色 · 葡萄紫 | `--color-primary` | `#7A3FF0` | 主按钮、选中、进度；白字 5.5:1 |
| 深葡萄 | `--color-primary-deep` | `#5424C2` | 主按钮的台阶 |
| 主色字 | `--color-primary-text` | `#5424C2` | 浅底、白底上的主色字（对浅紫 7.3:1） |
| 浅紫 | `--color-primary-soft` | `#EFE7FF` | 主色标签、选中项底 |
| 点缀 · 柠檬黄 | `--color-accent` | `#FFC21A` | 连胜、星星、奖励卡；上面放 `--color-accent-ink` `#3B2800`（8.7:1） |
| 浅柠檬 | `--color-accent-soft` / `-text` | `#FFF3CC` / `#7A5200` | 「+20 星星」这类标签 |
| 糖果色 | `--candy-pink` `--candy-mint` `--candy-sky` `--candy-orange` | `#FF6FA8` `#2CCB97` `#4CB0FF` `#FF8A3D` | 图标底、头像、贴纸、糖果卡；上面一律放 `--candy-ink`（6.4–8:1） |
| 成功 | `--color-success` / `-soft` | `#08794F` / `#DDF7EC` | 字用深绿；亮色块用薄荷 |
| 提醒 | `--color-warning` / `-soft` | `#9A5200` / `#FFF0D6` | 连胜快断了；点和进度条用 `--color-warning-fill` |
| 出错 | `--color-danger` / `-soft` | `#C21F4A` / `#FFE6EC` | 报错、删除、退出；白字 5.9:1 |
| 反色 | `--color-inverse` | `#23173D` | 轻提示 |

- 白字只放在葡萄紫和出错红上；柠檬黄和四颗糖果色上都放深墨字（`--candy-ink`，深色模式也不变）。
- 状态都是「浅底 + 同色深字」，对比 4.5:1 以上。
- 一屏里糖果色不超过三种同时成片出现；大面积仍然是 bg 和白卡。
- 不用渐变。颜色都是平涂的，立体感靠台阶。

## 字体

- `--font-sans` / `--font-display`：圆体。拉丁字母和数字优先 SF Pro Rounded（`ui-rounded`），标题再加 Arial Rounded MT Bold 兜底；中文落到圆体（Yuanti SC）或苹方 / 鸿蒙黑体 / MiSans。不引网络字体。
- 字重：400 正文 · 500 说明 · 700 按钮、标签、小标题 · 800 大标题和大数字。
- 字号阶梯（px）：xs 12 · sm 14 · md 16（正文）· lg 18 · xl 22 · 2xl 28 · 3xl 36 · 4xl 48。首页大标题可以到 96，一屏仍然最多四档。
- 行高：大标题 1.15，小标题 1.35，正文 1.6，长文 1.75。
- 大数字（连续天数、星星）用 `.stat`：800 字重、等宽数字、单位缩小跟在后面。

## 间距、圆角、台阶

- 间距 4 / 8 的倍数：`--space-1` 4 … `--space-8` 64。卡片内边距 24，手机页面左右 16。
- 控件高：`--control-sm` 40 · `--control-md` 48 · `--control-lg` 56。手机上能点的东西不小于 40。
- 圆角：sm 10（小按钮、勾选框）· md 16（按钮、输入框、提示条）· lg 24（卡片、表格）· xl 32（弹窗、底部面板、大面板）· full（标签、胶囊、头像、图标按钮）。
- 台阶：`--ledge` 4px（小按钮 3、大按钮 5）。卡片的台阶是 `--shadow-sm`（3px 浅线色），面板 `--shadow-md`（6px）；只有浮层（弹窗、悬浮卡）才用带柔光的 `--shadow-lg`。焦点光圈 `--ring` 4px 浅紫。
- 动效：`--ease` 带一点回弹，`--dur` 180ms；按下按钮的下沉是 90ms，干脆一点。系统开了「减少动态效果」时为 0。

## 组件

**文字** `.display` `.h1` `.h2`（800）`.h3`（700）`.body` `.lead` `.caption` `.overline`（主色、字距放宽）`.link`（加粗、2px 下划线）

**按钮** `.btn`（葡萄紫 + 深紫台阶）`.btn-secondary`（白底、2px 边、浅紫台阶）`.btn-accent`（柠檬黄，奖励类操作）`.btn-danger` `.btn-ghost`（没有台阶，悬停才出浅紫底）；尺寸 `.btn-sm` `.btn-lg`；`.btn-icon` 圆形；`.btn-block` 满宽。禁用写 `disabled`；`.is-pressed` 可以画出按下的样子。
- 用：一屏一个葡萄紫按钮；手机底部的主操作用 `.btn-lg.btn-block`；「收下星星」这类开心的操作用柠檬黄。
- 别：一排放两个实心主按钮；在糖果色卡片上放葡萄紫按钮（改用 `.btn-secondary`）；去掉台阶又加阴影。

**表单** `.field` 包住 `.label`（可加 `<span class="opt">选填</span>`）+ 控件 + `.hint`；`.input` `.textarea` `.select`（2px 边、16 圆角）；`.input-wrap` 前面放图标；`.check` `.radio`（24px 框，勾上带小台阶）；`.switch`（52 × 32）；`.chip` 选择胶囊（`<button aria-pressed>`，兴趣、筛选、多选）。
- 用：一屏一件事，手机上一列排；出错写 `aria-invalid="true"`，下面 `.hint.is-error` 一句话说怎么改。
- 别：只用占位字当标签；把选择胶囊当成按钮用（它只表示选没选）。

**标签与状态** `.tag`（浅底胶囊）+ `.tag-primary` `.tag-accent` `.tag-success` `.tag-warning` `.tag-danger` `.tag-outline`；`.sticker` 贴纸（实心糖果色 + 墨边 + 歪 4°，`.sticker-pink` `-mint` `-sky` `-orange`，`.sticker-tilt-right` 往右歪）；`.badge`（红底数字）`.badge-primary` `.badge-muted`；`.dot`；`.progress`（14 高、带一道高光）`.progress-accent` `.progress-mint` `.progress-sm`。
- 用：贴纸一屏最多两张，留给「新」「连续 7 天」「×3」这种想让人一眼看到的话。
- 别：用贴纸写长句；一张卡上超过两个标签。

**卡片** `.card`（白底、2px 浅边、3px 台阶）；`.card-header` `.card-title` `.card-meta` `.card-footer`（虚线分隔）；`.card-raised` 浮起来的推荐位；`.card-flat` 不要台阶；糖果卡 `.card-lemon` `.card-pink` `.card-mint` `.card-sky` `.card-grape` 整张上色，里面的字自动变深墨（葡萄卡是白字）。
- 用：糖果卡一屏最多一张，留给最想庆祝的那个数字（连胜、本周最佳）。
- 别：每张卡都上色；在糖果卡里放浅色标签。

**表格** `.table-wrap > .table`：表头是浅紫的槽、800 小字；行高 60，行之间 2px 浅线；数字加 `.num` 右对齐、等宽。排行榜可以配 `.rank` `.rank-1` `-2` `-3` 名次圆和 `.who` 头像 + 名字。自己那行用 `tr.is-selected`。

**提示条** `.alert`（默认浅紫）+ `.alert-success` `.alert-warning` `.alert-danger`：2px 淡边、16 圆角，左边一颗圆形糖果图标；`.alert-title` + `.alert-text` + 可选 `.alert-action`。
**轻提示** `.toast`：深墨胶囊，左边一颗薄荷（出错是草莓）圆图标，可带一个柠檬黄文字按钮（撤销、看看），2–3 秒消失。
- 用：标题说发生了什么，正文说接下来会怎样；完成一件事时用轻提示替人高兴一下。
- 别：用轻提示报要用户处理的错误。

**标签页与导航** `.tabs > .tab`（选中项下面一条 5px 圆头粗线）；`.segmented`（浅紫槽，选中项是白色胶囊带台阶）；顶栏 `.navbar`（64 高，`.brand` 或居中的 `.nav-title`）；手机主导航 `.tabbar > .tabbar-item`（3–5 项，当前项图标垫一颗浅紫胶囊）；设置列表 / 侧栏 `.nav > .nav-item`（图标放在小方块里，当前项整行浅紫、图标方块变实心紫）；`.breadcrumb`；`.pagination`（当前页是带台阶的紫圆）；`.dots` 引导页圆点（只看不点）。

**弹窗** `.modal-scrim > .modal`：32 圆角、居中、文字居中；`.modal-art` 可以放一张从顶上探出来的小插画；`.modal-header` `.modal-title` `.modal-body`；`.modal-footer` 按钮竖排满宽、主操作在上。手机上要选东西时用 `.sheet` 底部面板（顶上有一根小把手）。
- 用：庆祝和确认用弹窗；选时间、选选项用底部面板。
- 别：在弹窗里放长表单；一个弹窗里放三个以上按钮。

**头像** `.avatar`（默认 44，`.avatar-sm` 32，`.avatar-lg` 64，`.avatar-xl` 96）：圆形、粗白边、糖果色底、深墨首字；`.avatar-pink` `-mint` `-lemon` `-orange` `-grape` 和默认的汽水蓝轮换；`.avatar-ring` 有新动态；`.avatar-status` 在线点；`.avatar-group` 叠放。

**空状态** `.empty > .empty-art（糖果小插画）+ .empty-title + .empty-text + 按钮`：一句轻松的话、一个去处。

## 深色

`data-theme="dark"`：深葡萄底 `#17102B`、亮一点的紫 `#A98BFF`（上面放深色字）；柠檬黄和四颗糖果色不变，上面仍是深墨字。组件不用改。

## 适合 / 不适合

- 适合：习惯打卡、小队挑战、轻社交、零食饮品、学生向工具、小游戏的外围界面、引导页、个人页。
- 不太适合：数据密集的后台、金融和医疗这类需要稳重感的产品、高端品牌。
