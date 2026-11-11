# Contributing

## Easiest: share from the design studio

1. In the studio, use the share button on the design's card under *Library › My designs*, or export menu → *Share to the gallery*. Fill in a name and a one-line description, pick a license, tick the four confirmations.
2. Click *Check and submit*: the studio checks the rules here (personal data is a hard stop), then opens every screen offline to check the layout. Anything to fix is listed, and the model can fix it in one click.
3. Once it passes, click *Submit* (design studio 0.18.0 and later). The first time you connect GitHub: the studio shows a code, you enter it on github.com and approve. The studio then puts the zip in your own GitHub repository (forking this one the first time) and opens the submission issue for you; no dragging files or ticking boxes again.
   Rather not connect GitHub: click *Use the web form* → *Open the submission page* (title, license and short name are filled in), drag the zip from Downloads into the *Design pack* box, tick the boxes, submit.
4. Within minutes the bot replies: accepted submissions become a pull request with screenshots and check results for a maintainer to look at; otherwise it tells you what to change. In the studio, *My designs* links to the submission's progress, and shows *Listed* once it's in the gallery.

To update a design you submitted, submit again with the same short name.

## Pull requests

- Put your design in `templates/<your-github-login-lowercase>__<name>/` (`systems/` for design systems, `styles/` for style cards). Names are 3–40 lowercase letters, digits or `-`.
- One design per PR, only your own folder.
- `design.json` is required (see [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md) for an example). Every screen HTML sits at the top level, has a `<title>` like "Screen · Product" and `<meta name="dsh-design" content="app">` matching `kind`.
- Check locally first:

```bash
npm ci
node scripts/check.mjs templates/<your-folder>
```

What is and isn't accepted: [POLICY.md](POLICY.md).
