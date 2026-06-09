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

## Files

- `index.html` — UI shell
- `styles.css` — layout and charts
- `app.js` — views, filters, and charts
- `data-engine.js` — parse/join logic (Salesforce exports)

## Previous version

The learning-centric dashboard is preserved at git commit `740fe7e`.
