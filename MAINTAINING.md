# 维护手册

## 日常：看投稿

- 投稿 PR 上机器人会贴一张审核卡（截图 + 检查结果 + 车道）。标签 `lane: B` 的等你看。
- 在 PR 里回一行命令：
  - `/approve` 合并（检查没过的不让合）
  - `/hold <原因码>` 挂起，机器人按原因码回复作者
  - `/reject <原因码>` 关掉
- 原因码：`copy` `brand` `phish` `personal` `qr` `quality` `nsfw` `politics` `inject` `spam` `author` `other`（文字在 `policy/reasons.json`）。
- 精选：`/feature 作者__名字`，取消 `/unfeature 作者__名字`。
- 信任：`/trust @用户名`（新账号也不挂起；风格卡全绿就自动合并），`/untrust @用户名`（风格卡也要人看）。按账号数字 id 记（机器人自己查），用户名被别人重新注册不会继承。
- 自动的：账号不满 7 天挂起（`held: author`）；同时在等 >3 个或 24 小时内 >3 套先排队（`held: limit`，按账号数字 id 算，改了名也算同一人）；每 6 小时复查一次，14 天没动静自动关。你 `/hold` 过的（`held: maintainer`）作者再推送也不会自动合并。
- 删掉整套的 PR：一律 `lane: C` 等你看；只有原作者（main 上记的数字 id）能删自己的。
- 投稿里的文件按 git 树逐个取来检查（不听 `.gitattributes`）；藏起来的、软链接、子模块都算没过。
- 二维码：机器人用 jsQR 扫每屏截图（每半屏一张，长页面中段也扫）、设计系统的样张页和每张图，扫得出内容的直接退回；只是像（三个定位块的花纹）的标 `qrLike`，没扫完的（页面太长、图太多）标 `qrSkipped`，都等你看一眼。
- 模板、设计系统（包括老作者更新自己已上架的）一律等你看，不自动合并。更新时审核卡会标改了多少：正文、属性值、样式（连着选择器）、结构、图分开比，任何一组改了三成以上标 `bigChange`，重点看。
- 24 小时投稿数没翻完（一天三千多个 PR）：打 `count: partial`，不自动合并。
- 同一个名字不能跨类型（`templates/x` 和 `systems/x` 只能有一个）：检查拒；万一进了 main，建目录时两边都不上。

## 下架（目标：24 小时内看不到）

1. 任意 issue / PR 里回 `/takedown 作者__名字 <copyright|author|policy|security>`。
2. 机器人写 `policy/denylist.json`、推到 main、立刻发新目录。用户下次打开设计库市场（缓存超过 1 小时就重取）就看不到了，插件里已经解开的那份也删掉；用户自己复制走的作品不动，只标一行「原模板已从市场下架」。
3. 核实后再开 PR 把那个目录从仓库删掉。
4. npm 上已发出的旧批次：`npm deprecate dsh-design-gallery-packs@<那一版> "taken down"`；版权方要求彻底删除时，按 npm 的 DMCA 流程找 npm 支持，再把同批其他设计重新打包（重跑 publish 即可，目录会指向新批次）。
5. 撤销下架：`/restore 作者__名字`。记录不删，标上 `restored`，新目录里带一份「撤销名单」，插件见到才放出来（插件本地记着下架名单，目录漏发不会误放）。目录已经从仓库删了的，先 revert 那个删除 PR，再 `/restore`。
6. 违规记一笔到 `policy/strikes.json`（`{"login": "...", "id": ..., "at": "...", "why": "..."}`，id 一定要写：按它认人），同一作者两次机器人就不再收（PR 和网页表单都拦）。

## 举报自动先隐藏

仿冒钓鱼、色情暴力两类举报：3 个注册满 30 天的不同账号分别举报同一套，机器人写进下架名单（`reason: reported`）、立刻发新目录、在举报里打 `auto-hidden` 标签。你看过后：确认违规就不用动（再按上面第 3、6 步删目录、记违规）；误伤回 `/restore 作者__名字`。别的类别只通知你，不自动动。只算还开着的举报，`/restore` 之前的旧举报不再算（处理完的举报记得关掉）。

## 演练记录

- 11-06：本机假市场走了一遍 `/takedown` → 新目录 → 插件刷新后看不到、解开的那份删掉 → `/restore` → 新目录带撤销名单 → 插件里又出现。脚本在设计台会话的临时目录里（`fake-gallery/drill.mjs`），上线后在真仓库用一套测试投稿再演练一次。

## 暂停投稿

把 `policy/intake.json` 改成 `{ "open": false }` 推到 main，网页表单投稿会回复「暂停中」。

## 换签名钥匙

插件里钉了两把公钥：现用的，和一把备用的（备用私钥在维护者自己手上，没放进 GitHub）。

**平常换（或现用私钥泄露了）：换成备用的那把**

1. GitHub 仓库 Settings → Environments → publish → 把 `GALLERY_SIGNING_KEY` 换成备用私钥；`policy/keys.json` 换成备用公钥，推到 main。下一次发布起就用它签，已经装了的插件都认。
2. 再生成一把新的备用：`node scripts/sign.mjs keygen ~/新备用.pem`，记下公钥。下一版设计台把旧的现用公钥换成新备用公钥。

**两把都不能用了（备用私钥也丢了）**

1. 生成新钥匙，先发一版设计台把新公钥加进钉的列表，等一周大家都更新了。
2. 再照上面第 1 步换掉 GitHub 里的私钥和 `policy/keys.json`。

## 第一次配置（只做一次）

见 `_review/设计市场-要你做的事.md`（不在这个仓库里）：在 `OrderG-X` 账号下建仓库、装机器人 App、占 npm 名并配 trusted publishing、生成签名钥匙、设分支保护。

## 上线前要改的

- `package.json` 的 `dsh-design-studio` 钉在确切版本（现在 0.11.0）；设计台发了改动规则 / 截图的新版后，这里改版本号再 `npm install` 更新 lockfile。
- 要不要留投诉邮箱还没定（要的话写进 POLICY.md 和 takedown 表单）。
