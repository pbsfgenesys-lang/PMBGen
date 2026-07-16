# Partner Performance Dashboard

Static, browser-only dashboard for reviewing partner pipeline volume, Genesys SC support effort, and conversion.

## Run locally

Open `index.html` in a browser (double-click or `open index.html`). No server required.

## Upload these two exports

1. **Tasks** — tabular Salesforce task/events report (e.g. `PB New Tasks and Events Report….xls`)
2. **Opportunities** — tabular indirect opportunity report with L3/L4 region columns (e.g. `report….xls`)

Filter opportunities by region in Salesforce; filter tasks by date only. The dashboard joins on normalized opportunity name.

Optional: a Seismic learning CSV can still be loaded but is not used in v2 views.

## Hosting

Published on GitHub Pages:

- **Launcher:** [https://pbsfgenesys-lang.github.io/PMBGen/](https://pbsfgenesys-lang.github.io/PMBGen/)
- **Strict Salesforce view:** [https://pbsfgenesys-lang.github.io/PMBGen/strict-sf/](https://pbsfgenesys-lang.github.io/PMBGen/strict-sf/) — legal entities on opps; learning at brand level
- **Brand rollup view:** [https://pbsfgenesys-lang.github.io/PMBGen/brand-rollup/](https://pbsfgenesys-lang.github.io/PMBGen/brand-rollup/) — global brand families

The `strict-sf` and `brand-rollup` branches deploy into subfolders via GitHub Actions. Both use the same upload workflow in Admin.

No backend; data never leaves the user's browser.

**Domain map CSV:** load via Admin from your team's SharePoint share — it is **not** stored in this repository (confidential).

## Anonymous usage stats (optional)

Page views and country breakdown only — no Salesforce data, no file names, no partner names. Implemented with [GoatCounter](https://www.goatcounter.com/) (free tier, no cookies).

1. Create a GoatCounter account and add a site named `pbsfgenesys-lang.github.io` (GitHub Pages hostname).
2. Copy your **count URL** (looks like `https://pmbgen.goatcounter.com/count`).
3. In `index.html`, set:
   ```javascript
   window.PARTNER_DASHBOARD_ANALYTICS = {
     enabled: true,
     endpoint: 'https://YOUR-CODE.goatcounter.com/count'
   };
   ```
4. Push to `strict-sf` (and `brand-rollup` / `main` if you want the launcher tracked too).

The GoatCounter dashboard shows daily page views, paths (`/PMBGen/strict-sf/`, etc.), countries, referrers, and browsers. Each full page load counts once; in-app tab clicks do not (fine for “who opened the Champions link?”).

## Files

- `index.html` — UI shell
- `analytics.js` — optional anonymous page-view counter (GoatCounter)
- `styles.css` — layout and charts
- `app.js` — views, filters, and charts
- `data-engine.js` — parse/join logic (Salesforce exports)
- `scripts/smoke-test.mjs` — headless parse/join check (requires Node)

## Smoke test (Node)

After loading exports into `~/Downloads` (or pass paths explicitly):

```bash
source ~/.nvm/nvm.sh   # if using nvm
node scripts/smoke-test.mjs
node scripts/smoke-test.mjs /path/to/tasks.xls /path/to/opps.xls
```

Checks `app.js` syntax, L3 region mapping, match rate, and an EMEA filter slice.

## Previous version

The learning-centric dashboard is preserved at git commit `740fe7e`.
