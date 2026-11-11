# DSH 设计市场 / DSH Design Gallery

[设计工作台](https://github.com/OrderG-X/dsh-design-studio)（DeepSeek Harness 插件）的公共设计库：大家做的模板、设计系统、风格卡，在设计台的「设计库 › 市场」里逛、点一下就能拿来改成自己的。

A public library of templates, design systems and style cards for the [design studio](https://github.com/OrderG-X/dsh-design-studio) plugin of DeepSeek Harness. Browse them in the studio under *Library › Gallery* and start from any of them in one click.

## 怎么用 / Use

在 DSH 里装好设计台（插件页 → 添加插件 → `dsh-design-studio`），右侧栏打开设计台 →「更多」→「设计库」→「市场」。不用开 GitHub，也不用登录。

Install the design studio in DSH (Plugins → Add plugin → `dsh-design-studio`), open it in the right sidebar → *More* → *Library* → *Gallery*. No GitHub account or sign-in needed.

## 怎么投稿 / Contribute

最简单：在设计台里点「分享到设计市场」，它会检查，过了点「一键投稿」就交上来了（第一次要连一下 GitHub）。不想连的也可以打开投稿表单拖 zip。会 git 的也可以直接提 PR。详见 [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md) / [CONTRIBUTING.md](CONTRIBUTING.md)。

Easiest: click *Share to the gallery* in the studio. It checks your design; once it passes, click *Submit* (connect GitHub once the first time). You can also open the submission form and drop the zip in. Pull requests work too. See [CONTRIBUTING.md](CONTRIBUTING.md).

## 收什么 / What we accept

只收**静态设计稿**：没有脚本、不联网（图片和样式都在包里）、表单只留样子。原创、虚构品牌、假数据。详见 [POLICY.md](POLICY.md)。

Static designs only: no scripts, no network (images and styles live in the package), forms are visual only. Original work, made-up brands, fake data. See [POLICY.md](POLICY.md).

## 怎么发布 / How it ships

每次合并后，机器人重建目录、用 ed25519 签名，发到 npm（`dsh-design-gallery` 目录包 + `dsh-design-gallery-packs` 内容批次包），国内经 npmmirror、腾讯、华为镜像下载。设计台验签名后才用。

After each merge a bot rebuilds the catalog, signs it (ed25519) and publishes it to npm (`dsh-design-gallery` + `dsh-design-gallery-packs`), mirrored in China by npmmirror, Tencent and Huawei. The studio verifies the signature before using anything.

## 授权 / License

每套设计按它 `design.json` 里写的授权：默认 CC0，可选 CC BY 4.0。脚本按 MIT。见 [LICENSE](LICENSE)。

Each design uses the license in its `design.json` (CC0 by default, CC BY 4.0 optional). Scripts are MIT. See [LICENSE](LICENSE).
