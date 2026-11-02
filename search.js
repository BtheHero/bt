(function () {
  'use strict';
  var C = window.XDC;
  var $ = function (id) { return document.getElementById(id); };
  var market = C.getMarket(), runId = 0, current = '';

  function run(q) {
    q = (q || '').trim(); current = q;
    var id = ++runId;
    $('grid').textContent = '';
    if (q.length < 2) { $('meta').textContent = 'Type at least 2 letters to search.'; return; }
    $('meta').textContent = 'Searching…';
    C.api('search', { q: q, market: market }).then(function (r) {
      if (id !== runId) return;
      if (r.error) { $('meta').textContent = 'Search failed: ' + r.error; return; }
      var games = r.games || [];
      $('meta').textContent = games.length ? games.length + ' games found for “' + q + '”' : 'No games found for “' + q + '”.';
      games.forEach(function (g) { $('grid').appendChild(C.card(g)); });
    }).catch(function (e) {
      if (id !== runId) return;
      $('meta').textContent = e.message === 'not-configured'
        ? 'Search is not set up yet. The site owner needs to add the web app address in common.js.'
        : 'Search failed: ' + e.message;
    });
  }

  C.fillRegions($('mk'));
  $('mk').addEventListener('change', function () { market = this.value; C.setMarket(market); if (current) run(current); });
  $('f').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('q').value.trim();
    try { history.replaceState(null, '', 'search.html?q=' + encodeURIComponent(q)); } catch (err) {}
    run(q);
  });
  var first = new URLSearchParams(location.search).get('q') || '';
  $('q').value = first;
  if (first) run(first);
})();
