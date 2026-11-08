# 晴天 Sunny

给 5–10 岁孩子的学习 App 和课堂小工具用的设计系统：太阳黄、天空蓝、叶子绿，外面一圈墨蓝粗描边，像蜡笔描过的贴画；字是圆的，按钮够大，对和错不只靠颜色。家长、老师看的页面换成安静的「大人模式」。
A design system for children's learning apps and classroom tools (ages 5–10): sun yellow, sky blue and leaf green inside thick navy outlines, rounded type, big tap targets, and right/wrong feedback that never relies on color alone. Parent and teacher pages switch to a calmer "grown-up view".

文件：`tokens.css`（设计变量）、`components.css`（组件类，全部取变量）、`components.html`（组件样张）。新设计里先 link `tokens.css`，再 link `components.css`。默认是孩子模式；家长中心、老师后台给 `<html>`（或某一块）加 `data-view="grown"`。

## 原则

1. **一眼知道点哪里**。能点的东西都是「描了墨边的实心块」：胶囊按钮、整张选项卡、圆形读音钮、大按键。不能点的说明文字、区块底板不描墨边。孩子不识字也能靠形状和颜色找到下一步。
2. **够大、够稳**。点击区最小 48，主操作 60–76，手指之间至少留 12。一屏一个主任务：一道题、一个「检查」。不放会自己跑的东西，不用细小的关闭叉。
3. **对错有三重提示**。答对 = 叶子绿 + 勾 + 「对」字 + 实线；答错 = 珊瑚红 + 叉 + 「再想想」+ 虚线。去掉颜色（色弱、黑白打印）也分得清，读屏能念出结果。
4. **只夸，不吓**。答错不闪红屏、不扣星星；吉祥物「晴晴」只会「想一想」，不哭不皱眉。奖励夸努力和进步，不排名、不倒计时催、不催付费。
5. **大人是另一种节奏**。家长和老师要的是「这周学得怎样」：同一套类名换成 1px 浅线、小一档字号、沉稳的蓝色主按钮，数据密一点。

## 颜色

| 角色 | 变量 | 值 | 用在哪 |
| --- | --- | --- | --- |
| 太阳黄 | `--sun` / `--color-primary` | `#FFC531` | 主按钮、星星、当前关卡、选中胶囊；墨蓝字 8.9:1 |
| 天空蓝 | `--sky` / `--color-accent` | `#4AA8FF` | 选中、读音钮、进度、信息；墨蓝字 5.6:1 |
| 叶子绿 | `--leaf` / `--color-success-fill` | `#4CC870` | 答对、完成、「继续」；墨蓝字 6.6:1 |
| 珊瑚红 | `--coral` / `--color-danger-fill` | `#FF6F61` | 答错、退出、角标；墨蓝字 5.1:1 |
| 橘子橙 | `--orange` / `--color-warning-fill` | `#FF9A3C` | 再试一次、时间快到、宝箱；墨蓝字 6.6:1 |
| 墨蓝 | `--ink` / `--color-text` / `--color-outline` | `#1C2B4B` | 正文、所有粗描边、亮色块上的字；对白 14:1，对 bg 12.9:1 |
| 页面背景 · 浅天空 | `--color-bg` | `#EDF6FF` | 整页底色 |
| 表面 | `--color-surface` | `#FFFFFF` | 卡片、选项、弹窗、输入框 |
| 次表面 | `--color-surface-2` | `#F3F9FF` | 键盘托盘、图片框、不可用底 |
| 次要字 | `--color-muted` | `#4A5B7C` | 说明、时间、计数；对 bg 6.3:1、对白 6.8:1，别再调浅 |
| 分隔线 | `--color-line` | `#C9DDF0` | 卡片里的虚线、图表网格、大区块的浅边 |
| 不可用线 | `--color-line-strong` | `#9DB2CC` | 不可用的描边、空星、锁住的关卡、描红字（不放正文） |
| 浅阳光 | `--color-primary-soft` / `-text` | `#FFF2C6` / `#835400` | 提示气泡、当前项；字 5.8:1 |
| 浅天空 | `--color-accent-soft` / `-text` | `#DCEEFF` / `#0E5BA8` | 选中底、信息条、链接；字 5.8:1 |
| 对 | `--color-success-soft` / `--color-success` | `#DFF6E5` / `#166B33` | 答对的选项底、反馈条；字 5.8:1 |
| 错 | `--color-danger-soft` / `--color-danger` | `#FFE4E0` / `#A72D25` | 答错的选项底、出错提示；字 5.7:1 |
| 再试 | `--color-warning-soft` / `--color-warning` | `#FFEBD3` / `#8F4A00` | 再试一次、休息提醒；字 5.7:1 |
| 遮罩 | `--color-overlay` | 55% 墨蓝 | 弹窗后面 |

- **亮色块上一律放墨蓝字，不放白字**。白字只出现在墨蓝底上（轻提示、页脚）。这样整套只有一条规则，对比都在 5:1 以上。
- 状态都是「浅底 + 同色深字」，深字对浅底都在 4.5:1 以上。
- 科目色固定：数学天空蓝、语文珊瑚红、英语叶子绿、科学太阳黄。图标块、标签、家长报表里的点和条都按这个配。
- 用量：bg 和白卡占七成；太阳黄一屏只给一个主按钮和星星；四种亮色同时成片出现不超过三种。
- 不用渐变、不用紫色、不用纯灰（`#888` 这类）。立体感靠描边里面的高光和内阴影，不靠外面垫台阶。
- 没有深色版：孩子屏幕白天用为主；晚上请在大人模式里设「到时间自动休息」，而不是把界面调暗继续学。

## 字体

- `--font-sans` / `--font-display`：圆体。拉丁字母和数字优先 SF Pro Rounded（`ui-rounded`），标题再加 Arial Rounded MT Bold 兜底；中文落到圆体（Yuanti SC）或苹方 / 鸿蒙黑体 / MiSans。不引网络字体。
- `--font-hanzi`：楷体（Kaiti SC / STKaiti / KaiTi）。只用在识字卡、田字格、生字——和课本的字形一致，孩子照着写不会错笔画。拼音用 `<ruby>字<rt>pīn</rt></ruby>`，`rt` 自动换成圆体、天空蓝。
- 字号阶梯（px，孩子模式）：xs 14 · sm 16 · md 18（正文）· lg 22（按钮）· xl 26（选项、反馈）· 2xl 32（题目）· 3xl 40 · 4xl 56。一屏最多四档。
- 大人模式：xs 12 · sm 13 · md 15 · lg 17 · xl 20 · 2xl 24 · 3xl 30 · 4xl 40，正文换成系统黑体。
- 字重：孩子模式正文 500、说明 600、小标题 700、标题和按钮 800；大人模式 400 / 500 / 600 / 700。
- 行高：标题 1.15，选项和按钮 1.2–1.3，正文 1.55，长段 1.75。
- 数字一律等宽（`.num` 或 `font-variant-numeric: tabular-nums`）：题目、计时、星星、报表都要对得齐。
- 题目里的字给孩子读，句子短、不用书面语、不用英文缩写；不用斜体。

## 尺寸、描边、立体感

- 间距 4 / 8 的倍数：`--space-1` 4 · `-2` 8 · `-3` 12 · `-4` 16 · `-5` 24 · `-6` 32 · `-7` 48 · `-8` 64。平板页面左右 32，手机 16。
- 点击区：`--tap-min` 48。控件高 `--control-sm` 48 · `--control-md` 60（默认）· `--control-lg` 76（开始、检查、题目选项）。看到的勾选框 32，但整行 label 都能点。
- 圆角：sm 12（图标块）· md 18（输入框、按键）· lg 26（卡片、选项、反馈条）· xl 36（弹窗、底部面板）· full（按钮、标签、计数胶囊、头像）。
- 描边：`--stroke` 3px 墨蓝（按钮、卡片、选项、输入框、按键）；`--stroke-sm` 2px（标签、选项键、小图标圈）；大区块和面板用 2px `--color-line` 浅边。**东西描墨边，区域用浅线。**
- 立体感：`--shade` 在描边里面——顶上一道白色高光、底下一道 5px 内阴影；按下时 `--shade-press` 翻到上面并下沉 1px。卡片和浮层另外有柔和的天蓝投影 `--shadow-sm/md/lg`。焦点光圈 `--ring` 5px 天空蓝。
- 动效：`--ease` 轻轻回弹，`--dur` 200ms；按下 100ms；庆祝（星星落下、徽章翻面）最长 `--dur-party` 700ms。系统开了「减少动态效果」时全部为 0。

## 组件

**文字** `.display` `.h1` `.h2` `.h3`（圆体 800 / 700）`.body` `.lead` `.caption` `.overline`（天空蓝小字）`.link`（3px 下划线）`.num`（等宽数字）`.hanzi`（楷体）

**按钮** `.btn`（太阳黄，主操作）`.btn-go`（叶子绿：继续、对了、接着学）`.btn-sky`（天空蓝：听、看）`.btn-secondary`（白：提示、取消、次要）`.btn-danger`（珊瑚红：退出、删除）`.btn-ghost`（文字）；尺寸 `.btn-sm` 48 · 默认 60 · `.btn-lg` 76；`.btn-icon` 圆形；`.btn-block` 满宽。禁用写 `disabled`（灰底、浅描边、没有立体感），`.is-pressed` 画按下。
- 用：一屏一个黄色按钮，放在孩子拇指够得着的底部；答完题后的「继续」用绿色；按钮文案 2–5 个字、动词开头（「检查答案」「再听一遍」）。
- 别：一排两个黄按钮；用红色做「提交」；按钮只放图标却不写 `aria-label`；把「退出」做得比「继续」大。

**答题选项** `.options`（两列；`.options-1` 一列、`.options-4` 四列）`> .option`，里面 `.option-key`（A/B/1/2 或勾、叉图标）+ `.option-text`，结果标签 `.option-flag`。看图选 `.option-pic`（`.option-art` 放插画，4:3）。
- 状态：选中 `aria-pressed="true"`（或 `.is-selected`）→ 浅天空底 + 内圈天空蓝 + 选项键填蓝；`.is-correct` → 浅绿底 + 绿圈 + 勾 + 「对」；`.is-wrong` → 浅红底 + **虚线描边** + 叉 + 「再想想」；其余 `.is-dim` 变淡。
- 用：先选、再按「检查」；答错给「再试一次」的机会，第二次错了再公布答案并讲一句为什么。
- 别：选了就立刻判对错（孩子会乱点）；只把边框变色；在选项里放长句（超过 12 个字改成一列）。

**反馈条** `.feedback` + `.feedback-correct` / `.feedback-wrong`（虚线）/ `.feedback-retry`：左边 `.feedback-icon`，中间 `.feedback-title` + `.feedback-text`，右边一个按钮。答完从屏幕底部升起，盖住「检查」按钮的位置。

**进度** `.progress > i`（`style="--value: 45%"`，26 高，带一道高光；`.progress-sky` `-sun` `-coral`，`.progress-sm`）；`.steps > i`（一题一格：`.is-done` 绿、`.is-miss` 红带斜纹、`.is-now` 黄）；上课顶栏 `.lessonbar` = 关掉按钮 + 进度 + `.counter`；计数胶囊 `.counter`（星星、爱心、连续天数）。

**关卡地图** 横版 `.map`：关卡 `.level` 用 `style="--x: 22%; --y: 47%"` 摆位置，路是一张 `preserveAspectRatio="none"` 的 SVG（`.map-road`，描边加 `vector-effect="non-scaling-stroke"`）；竖版 `.path`：关卡用 `--dx` 左右错开。`.level` 里放 `.level-node`（圆，数字或图标）+ `.level-stars` + `.level-label`。状态 `.is-done`（绿 + 星星）`.is-current`（大一圈的黄 + 光晕 + 深色标签）`.is-locked`（虚线 + 锁）`.is-chest`（圆角方块、橘子橙，宝箱）。
- 用：现在这关旁边放晴晴；做完的路是黄色虚点，没走到的是灰点。
- 别：一屏超过 8 关；锁住的关卡点了没反应（要弹一句「先做完第 4 关」）。

**星星与徽章** `.stars > svg.star`（`<use href="#star">`；`.is-empty` 空星，小号是虚线）；结算页 `.stars-lg`（中间那颗大一号、抬高）；徽章 `.medal`（`style="--medal: var(--sky)"` 换颜色）> `.medal-art`（圆牌 + 两条飘带的 SVG + `.medal-icon`）+ `.medal-name` + `.medal-meta`；没拿到 `.is-locked`（变灰、图标换锁，写清还差什么）。
- 用：星星 0–3 颗，规则写在明处，只加不扣；徽章奖励坚持和进步（连续 7 天、读完 10 本）。
- 别：排行榜、和别的孩子比；用星星换付费内容。

**角色与气泡** `.mascot`（`<svg viewBox="0 0 64 64"><use href="#sun-happy">`；三种表情：`sun-happy` 出题、`sun-cheer` 答对和完成、`sun-think` 答错和空状态；`.mascot-sm` 64 · 默认 96 · `.mascot-lg` 140）；`.speech` 把角色和 `.bubble` 排成一行（`.speech-right` 反过来，给孩子自己的回答）；气泡 `.bubble`（墨边、尾巴指向说话的人）`.bubble-sun`（提示）`.bubble-think`（虚线，想一想）`.bubble-top`（尾巴朝上）。题目气泡里可以放 `.audio.audio-sm`。

**计时** `.timer`（`style="--left: 60"`，里面 `svg.timer-ring` 放 `circle.track` `circle.left`（`pathLength="100"`）和两圈 `circle.edge`，中间 `.timer-face`）；`.is-low` 珊瑚红并配一个「快一点」标签，`.is-paused` 灰。横条版 `.timer-bar`。
- 用：只在「口算挑战」这类游戏里计时；最后 5 秒才变色，不加滴答声。
- 别：普通练习计时；时间到了直接判错（改成「时间到，再来一次？」）。

**读音按钮** `.audio`（天空蓝圆钮，默认 72；`.audio-sm` 48 · `.audio-lg` 112）；`.is-playing` 变黄并带两圈声波；`.audio-slow` 白底小乌龟，慢速读。凡是孩子要读的题目和字卡，旁边都放一个。

**字卡** `.word-card`：`.word-pic`（图，浅底）+ `.word`（楷体，拼音用 `<ruby>`）或 `.word-en`（英文单词）+ `.word-sub`；右上角 `.audio.audio-sm`。背面 `.word-card-back`（浅阳光底：例句，生字用 `<mark>` 标黄）。田字格 `.tianzige`（珊瑚红格线，`.is-trace` 是描红）。

**小键盘** `.keypad > .key`（3 × 4，键 76 × 64；`.key-del` 浅红删除、`.key-ok` 叶子绿确定）；填数格 `.slots > .slot`（没填虚线、`.is-filled` 实线、`.is-active` 天空蓝光圈 + 光标）；算式一行 `.equation`。
- 用：口算、填空、数一数都用自己的键盘，不弹系统键盘。

**表单** `.field` 包住 `.label`（可加 `<span class="opt">`）+ 控件 + `.hint`；`.input` `.textarea` `.select`（60 高、3px 墨边、18 圆角）；`.input-wrap` 前面放图标；`.check`（勾上是叶子绿）`.radio`（选中是天空蓝 + 墨点）`.switch`（开着是叶子绿、圆钮在右）；`.chip` 选择胶囊（`aria-pressed="true"` 变黄）；`.avatar-pick` 选头像。
- 用：孩子能填的只有昵称、头像、喜好；出错写 `aria-invalid="true"`（变虚线），下面 `.hint.is-error` 一句话说怎么改。
- 别：让孩子填真实姓名、生日、学校、联系方式——这些都放到大人模式里由大人填；只用占位字当标签。

**卡片与列表** `.card`（墨边、26 圆角、柔和投影）+ `.card-header` `.card-title` `.card-meta` `.card-footer`（虚线分隔）；浅色卡 `.card-sun` `-sky` `-leaf` `-coral`；课程卡 `.card-band`（顶上一条 `.band`，`style="--band: …"` 放科目浅色和一张插画）；图标块 `.icon-tile`（`--tile` 换色）。列表 `.list > .list-item`（整行能点，图标块 + 标题 + 说明 + 星星或箭头）；锁住的 `.is-locked`（虚线、灰）。

**标签与状态** `.tag`（2px 墨边胶囊）：实心 `.tag-sun` `-sky` `-leaf` `-coral`（科目、醒目的状态）；浅底 `.tag-soft` `-success` `-warning` `-danger` `-muted`（说明）；角标 `.count`；状态点 `.dot` + `.dot-sun` 等。

**提示** `.alert`（默认浅天空）+ `.alert-success` `.alert-warning` `.alert-danger`（虚线）：`.alert-icon` + `.alert-title` + `.alert-text` + 可选按钮。轻提示 `.toast`：墨蓝胶囊，`.toast-icon`（默认绿勾，`.toast-star` 星星、`.toast-danger` 红），可带一个黄色 `.toast-action`，2–3 秒自己走。
- 用：标题说发生了什么，正文说下一步；需要大人帮忙的事就直说「请大人帮忙……」。
- 别：用轻提示报要处理的错误；吓人的字眼（「失败」「错误代码」）。

**导航** 标签页 `.tabs > .tab`（像作业本的分隔页签：当前项 `aria-selected="true"` 白底、顶上一道黄线、和下面的 `.tab-panel` 连在一起）；分段切换 `.segmented`（选中是主色胶囊）；手机主导航 `.tabbar > .tabbar-item`（3–5 项，当前项 `aria-current="page"` 图标垫黄色胶囊）；大人模式用顶栏 `.navbar` 和侧栏 `.nav > .nav-item`（`.nav-title` 分组）；`.pagination`。

**弹窗** `.modal-scrim > .modal`：36 圆角、居中、文字居中；`.modal-art` 放从顶上探出来的晴晴或星星；`.modal-title`（一个问题或一句庆祝）`.modal-body`；`.modal-footer` 按钮竖排满宽、主操作在上；`.modal-close` 右上角关闭。手机上选东西用 `.sheet` 底部面板。
- **家长门**：离开学习区、改设置、任何和钱有关的地方，先弹 `.modal` + `.gate-icon` + `.gate-question`（一道孩子还不会的题，比如 7 × 8，或「请按顺序点：五、二、八」）+ `.gate-options`（4 个答案）+ 一个「我是小朋友，回去学习」。随机出题，答错换一道。
- 别：在家长门里要大人填任何个人信息；弹窗里放第三个按钮；在弹窗里再开弹窗。

**头像** `.avatar`（默认 56，`.avatar-sm` 40，`.avatar-lg` 80；墨边圆形，`--avatar` 或 `.avatar-sun` `-leaf` `-coral` `-orange` 换底色）；`.avatar-group` 叠放。孩子用图标或昵称首字，不用照片。

**空状态** `.empty > .empty-art`（想一想的晴晴，或一排空星）+ `.empty-title` + `.empty-text` + 一个按钮。一句孩子听得懂的话加一个去处，不写「暂无数据」。

## 大人模式（家长 / 老师）

给外层加 `data-view="grown"`：描边换成 1px `#D3DDE9`、圆角 6 / 10 / 14 / 18、控件 36 / 44 / 52、正文 15px 系统黑体、字重低一档，主色换成沉稳的蓝 `#1D66C2`（白字 5.6:1），没有内阴影；蜡笔盒原色（星星、科目色、吉祥物）不变。组件类名完全一样。

额外组件：
- `.stat-card` 数据卡：`.stat-label`（小图标块 + 名字）+ `.stat-value`（大数字，单位用 `<small>`）+ `.delta.up` / `.delta.down`（箭头 + 加粗的变化 + 「比上周」）。
- `.chart-week` 一周柱状图：`style="--goal-n: 0.5"` 画目标虚线（`.goal` 写目标值），每天一个 `.bar`（`style="--h: 64%"`，里面 `<i><b>32</b></i>` + `<span>二</span>`）；`.is-met` 达标是天空蓝，没到是浅蓝，`.is-today` 是黄色带墨边。
- `.meter` 细进度条（`--value`、`--bar` 换科目色）、`.legend` 图例、`.table` 班级名单（数字列 `.num` 右对齐，`.who` 头像 + 名字，`tr.is-selected` 高亮）。
- 用：先给一句结论（「比上周多学了 25 分钟，数学进步最大」），再给数字；夸孩子的变化，不和别的孩子比。

## 写给孩子看的文案

- 短：一句不超过 15 个字；一屏只问一个问题。
- 夸具体的事：「连对 5 题！」「凑十法已经熟练」，不说空的「你真棒」。
- 错了说怎么想：「先数 5，再往后数 4 个」，不说「错误」「失败」。
- 要大人帮忙就直说：「请大人帮忙把音量调大」。

## 适合 / 不适合

- 适合：幼小衔接和小学低年级的识字、口算、英语启蒙、绘本、课堂答题器、班级小工具、家长中心和老师后台。
- 不太适合：初中以上的学习产品（会显得幼稚）、成年人的效率工具、需要深色界面的场景。
