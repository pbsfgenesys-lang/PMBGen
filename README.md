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

Published on GitHub Pages from `main`: [https://pbsfgenesys-lang.github.io/PMBGen/](https://pbsfgenesys-lang.github.io/PMBGen/)

No backend; data never leaves the user's browser.

**Domain map CSV:** load via Admin from your team's SharePoint share — it is **not** stored in this repository (confidential).

## Files

- `index.html` — UI shell
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
