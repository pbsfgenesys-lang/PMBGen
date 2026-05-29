# Partner Performance Dashboard

Static, browser-only dashboard for reviewing partner pre-sales enablement, pipeline, and Genesys SC support effort.

## Run locally

Open `index.html` in a browser (double-click or `open index.html`). No server required.

## Upload these three exports

1. **Tasks** — `PB New Tasks and Events Report….xlsx`
2. **Opportunities** — `PB - all Opportunities_UKI….xlsx`
3. **Learning** — `widget-learning_partners_genie.csv`

Use matching date/scope pairs (e.g. Mar 24 UKI tasks + Mar 24 UKI opportunities). For UKI + France, ensure the opportunity export includes French opps, not only “Sold To Country = United Kingdom”.

## Hosting

Publish the folder as static files (GitHub Pages, SharePoint, etc.). No backend; data never leaves the user’s browser.

## Files

- `index.html` — UI shell
- `styles.css` — layout from mockup
- `app.js` — views and navigation
- `data-engine.js` — parse/join logic (Salesforce + Seismic)
