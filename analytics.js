(function () {
  'use strict';

  var cfg = typeof window !== 'undefined' ? window.PARTNER_DASHBOARD_ANALYTICS : null;
  if (!cfg || !cfg.enabled) return;

  var endpoint = String(cfg.endpoint || cfg.goatcounter || '').trim();
  if (!endpoint) return;

  var script = document.createElement('script');
  script.async = true;
  script.dataset.goatcounter = endpoint.replace(/\/$/, '');
  script.src = cfg.scriptSrc || 'https://gc.zgo.at/count.js';
  (document.head || document.documentElement).appendChild(script);
}());
