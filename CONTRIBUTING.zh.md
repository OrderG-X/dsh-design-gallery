# 投稿说明

## 最简单：在设计台里分享

1. 设计台「设计库 › 我的作品」里那套卡片上的分享按钮，或导出菜单 →「分享到设计市场」。填名字、一句话介绍，选授权，勾四个确认。
2. 点「检查并投稿」：设计台先按这里的规则查（个人信息直接拦），再断网打开每屏体检；有问题会列出来，可以一键让模型改好。
3. 过了点「一键投稿」（设计台 0.18.0 起）。第一次要连一下 GitHub：设计台给一个码，到 github.com 输进去点同意。之后设计台替你把 zip 放进你自己的 GitHub 仓库（第一次会 fork 一份本仓库）、开好投稿 issue，不用再去网页拖文件、勾确认。
   不想连 GitHub：点「用网页表单交」→「打开投稿页」（标题、授权、短名已经填好），把「下载」里的 zip 拖进「设计包」框，勾确认，提交。
4. 几分钟内机器人会回复：收下了就转成 PR、贴截图和体检结果，等维护者看一眼；没收下会说哪里要改。设计台「我的作品」里能点「看投稿进度」，上架后那套显示「已上架」。

更新自己交过的那套：用同样的「短名」再交一次。

## 会 git 的：直接提 PR

- 目录放在 `templates/<你的 GitHub 用户名小写>__<名字>/`（设计系统放 `systems/`，风格卡放 `styles/`）。名字 3–40 个小写字母、数字、`-`。
- 一个 PR 只交一套，只改自己的目录。
- 必须有 `design.json`（格式见下），每屏 HTML 都放在最外层，`<title>` 写成「屏名 · 产品名」，带 `<meta name="dsh-design" content="app">`（类型和 `design.json` 的 `kind` 一样）。
- 本地先自查：

```bash
npm ci
node scripts/check.mjs templates/<你的目录>
```

## design.json

```json
{
  "format": 1,
  "type": "template",
  "title": { "zh": "抹茶时光", "en": "Matcha Time" },
  "description": { "zh": "街角茶饮店的两屏手机应用" },
  "kind": "app",
  "screens": [
    { "file": "home.html", "title": { "zh": "首页" } },
    { "file": "menu.html", "title": { "zh": "菜单" } }
  ],
  "style": "fresh",
  "categories": ["food"],
  "tags": ["menu"],
  "lang": "zh",
  "license": "CC0-1.0",
  "author": { "login": "你的 GitHub 用户名", "id": 你的数字 id },
  "ai": { "generated": true, "tool": "dsh-design-studio@0.11.0" }
}
```

- `kind`：web / app / miniprogram / tablet / desktop / poster / slides / email
- `categories` 最多 2 个、`tags` 最多 8 个，从 `vocab/` 里选
- `license`：`CC0-1.0`（默认）或 `CC-BY-4.0`
- 数字 id：`https://api.github.com/users/<用户名>` 里的 `id`

收什么、不收什么见 [POLICY.md](POLICY.md)。
