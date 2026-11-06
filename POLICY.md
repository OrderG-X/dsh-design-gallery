# 收录规矩 / Policy

## 收什么 / What is accepted

- **模板**（一到 24 屏的静态设计稿）、**设计系统**、**风格卡**。
- 只收静态 HTML / CSS / SVG / 图片：**没有脚本**、没有内嵌网页、图片和样式都在包里（不联网）、只用系统字体、表单只留样子交不出数据。
- **原创**：自己做的，或用设计台做的。图片要么自己做，要么是 CC0 / 公有领域并在 `design.json` 的 `assets` 里写明来源。不收 Unsplash / Pexels 授权的图（它们的条款不是 CC0）。
- **虚构品牌、假数据**：不用真实品牌、机构、名人；不仿冒真实网站的登录、付款页；手机号、身份证、邮箱、地址用明显的假数据（如 138 0000 0000、hello@example.com）。
- 不收：二维码（换成占位方块）、色情暴力、政治宗教等敏感内容、广告、给模型下指令的文字。
- 设计系统不能照着真实品牌做（「提取品牌设计系统」做出来的不能投）。

Templates, design systems and style cards. Static HTML/CSS/SVG/images only: no scripts, no embedded pages, everything in the package (no network), system fonts only, forms are visual only. Original work; images must be your own or CC0 / public domain with the source listed in `design.json` `assets` (no Unsplash/Pexels-licensed images). Made-up brands and obviously fake data only; no imitations of real login or payment pages. No QR codes, adult or violent content, political or religious topics, ads, or text that instructs AI models. Design systems must not be extracted from real brands.

## AI 标识 / AI disclosure

每套都要在 `design.json` 写 `ai.generated`（用设计台做的，分享时自动写好）。用 AI 做的也收，只要符合上面的规矩。

Every design states `ai.generated` in `design.json` (filled in automatically by the studio). AI-made designs are welcome if they follow the rules above.

## 授权 / License

默认 CC0（谁都能随便用）；作者可以选 CC BY 4.0（别人用要署名）。基于 CC BY 设计改出来的，要保留原作的署名（`ATTRIBUTION.md` 和 `derivedFrom`）。提交即表示你有权按所选授权公开这些内容。

CC0 by default; authors may choose CC BY 4.0. Derivatives of CC BY designs must keep the original credit (`ATTRIBUTION.md` and `derivedFrom`). Submitting means you have the right to publish the content under the chosen license.

## 审核 / Review

机器先查（同一套规则也在设计台里跑），然后维护者看一眼。新账号（7 天内）先挂起。每人同时最多 3 个在等审核、24 小时内最多交 3 套，多的先排队。风格卡全绿可自动收录；模板和设计系统（包括更新）都由维护者看过再收录。

Machine checks first (the same rules run inside the studio), then a quick look by a maintainer. Accounts younger than 7 days are put on hold. Up to 3 open submissions and 3 per 24 hours per person; extra ones wait in line. Style cards that pass every check may be merged automatically; templates and design systems (including updates) are always reviewed by a maintainer.

## 下架 / Takedown

- 举报：设计台详情页「举报」，或 [report 表单](../../issues/new?template=report.yml)。
- 版权方：[takedown 表单](../../issues/new?template=takedown.yml)。收到后 **24 小时内先从目录隐藏**，核实后从仓库删除。
- 仿冒钓鱼、色情暴力两类：有 3 个注册满 30 天的不同账号分别举报同一套，机器会**先自动隐藏**，再等维护者判断（误伤会恢复）。
- 作者本人要求撤下的，随时照办（CC0 法律上不可撤回，但我们照办）。
- 删不干净的地方要说明：已经下载到别人电脑上的副本、npm 上已发出的旧批次（只能标记废弃或找 npm 支持删除）、GitHub 上 issue 附件和 PR 历史（只有 GitHub 支持能清）。所以个人信息请在提交前就去掉，设计台分享时会硬拦。

Report from the studio's detail page or the report form; rights holders use the takedown form. We **hide the design from the catalog within 24 hours**, then delete it after review. For phishing and adult content, three separate reports from accounts at least 30 days old **hide the design automatically** until a maintainer reviews it. Authors may ask for removal at any time. Copies already downloaded, old npm batches and GitHub issue attachments / PR history cannot be fully erased, so remove personal data before submitting (the studio blocks it when sharing).

## 违规 / Strikes

同一作者两次违规就停止收稿（记在 `policy/strikes.json`，按 GitHub 账号的数字 id 认，改名也算同一个人）。

Two strikes and we stop accepting submissions from that author (`policy/strikes.json`, matched by the numeric GitHub account id, so renaming does not reset it).
