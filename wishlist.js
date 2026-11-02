(function () {
  'use strict';
  var C = window.XDC;
  var $ = function (id) { return document.getElementById(id); };
  var market = C.getMarket(), deals = {}, extra = {}, runId = 0, loaded = false;

  function render() {
    var g = $('grid'), saved = C.wish.list();
    g.textContent = '';
    if (!saved.length) {
      $('meta').textContent = 'Your wishlist is empty. Tap the heart on any game to save it here.';
      return;
    }
    var items = saved.map(function (w) {
      return deals[w.id] || extra[w.id] || { id: w.id, t: w.t, img: w.img, pub: w.pub, price: null, pct: 0 };
    }).sort(function (a, b) { return (b.pct || 0) - (a.pct || 0) || a.t.localeCompare(b.t); });
    var onSale = items.filter(function (d) { return d.pct > 0; }).length;
    $('meta').textContent = items.length + (items.length === 1 ? ' game' : ' games') + ' saved, ' + onSale + ' on sale now' +
      (loaded ? '' : ', checking prices…');
    items.forEach(function (d) { g.appendChild(C.card(d)); });
  }

  function load() {
    var id = ++runId, m = market;
    deals = {}; extra = {}; loaded = false;
    render();
    var saved = C.wish.list();
    if (!saved.length) return;
    fetch(C.DATA_BASE + m + '.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { j.deals.forEach(function (d) { deals[d.id] = d; }); }, function () {})
      .then(function () {
        if (id !== runId) return;
        var missing = C.wish.list().map(function (w) { return w.id; }).filter(function (x) { return !deals[x]; });
        if (!missing.length || !C.API_URL) return;
        var chunks = [];
        for (var i = 0; i < missing.length; i += 40) chunks.push(missing.slice(i, i + 40));
        return Promise.all(chunks.map(function (ids) {
          return C.api('prices', { ids: ids.join(','), market: m }).then(function (r) {
            for (var k in (r.games || {})) extra[k] = r.games[k];
          }, function () {});
        }));
      })
      .then(function () { if (id !== runId) return; loaded = true; render(); });
  }

  C.fillRegions($('mk'));
  $('mk').addEventListener('change', function () { market = this.value; C.setMarket(market); load(); });
  document.addEventListener('xd:wish', render); // a heart was tapped: refresh the list
  load();
})();
