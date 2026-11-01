(function () {
  'use strict';
  var DATA_BASE = 'data/'; // folder with the region files written by the publisher (US.json, GB.json, ...)
  var MARKETS = [['US','United States'],['GB','United Kingdom'],['CA','Canada'],['AU','Australia'],['DE','Germany'],['FR','France'],
    ['ES','Spain'],['IT','Italy'],['NO','Norway'],['SE','Sweden'],['DK','Denmark'],['BR','Brazil'],['MX','Mexico'],['JP','Japan'],
    ['TR','Turkey'],['KR','South Korea']];
  var YEAR = 365 * 864e5;
  var VIEWS = {
    all: { sort: 'pct', filter: null },
    gamepass: { sort: 'pct', filter: function (d) { return d.gp; } },
    ending: { sort: 'end', filter: function (d) { return d.end; } },
    'new': { sort: 'new', filter: function (d) { return d.rd && d.rd > Date.now() - YEAR; } }
  };
  var view = VIEWS[document.body.getAttribute('data-view')] || VIEWS.all;
  var $ = function (id) { return document.getElementById(id); };
  var PER_PAGE = 24, pageNo = 1, genre = '', data = null, market = ls('xd_market') || 'US';
  var sorters = {
    pct: function (a, b) { return b.pct - a.pct || a.price - b.price; },
    price: function (a, b) { return a.price - b.price; },
    rc: function (a, b) { return (b.rc || 0) - (a.rc || 0) || b.pct - a.pct; },
    'new': function (a, b) { return (b.rd || 0) - (a.rd || 0) || b.pct - a.pct; },
    end: function (a, b) { return (a.end || 9e15) - (b.end || 9e15); },
    name: function (a, b) { return a.t.localeCompare(b.t); }
  };

  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {}
    return null;
  }
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function money(v, cur) {
    if (v === 0) return 'Free';
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(v); }
    catch (e) { return v.toFixed(2) + ' ' + cur; }
  }

  function renderGenres(base) {
    var box = $('genres'), top = $('side').scrollTop, counts = {};
    base.forEach(function (d) { (d.cats || []).forEach(function (c) { counts[c] = (counts[c] || 0) + 1; }); });
    var names = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
    if (genre && !counts[genre]) names.push(genre);
    box.textContent = '';
    [''].concat(names).forEach(function (n) {
      var b = h('button', { class: 'gbtn', type: 'button', 'aria-current': String(n === genre) },
        [document.createTextNode(n || 'All'), h('span', { text: String(n ? (counts[n] || 0) : base.length) })]);
      b.addEventListener('click', function () { genre = n; pageNo = 1; $('side').classList.remove('open'); render(); });
      box.appendChild(b);
    });
    $('side').scrollTop = top;
    $('gtoggle').textContent = 'Genres: ' + (genre || 'All');
  }

  function card(d) {
    var url = 'https://www.microsoft.com/store/productId/' + encodeURIComponent(d.id);
    var end = d.end ? 'Ends ' + new Date(d.end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    return h('article', { class: 'card' }, [
      h('a', { class: 'poster', href: url, target: '_blank', rel: 'noopener noreferrer', tabindex: '-1', 'aria-hidden': 'true' }, [
        d.img ? h('img', { src: d.img + (d.img.indexOf('?') < 0 ? '?q=90&w=360' : ''), alt: '', loading: 'lazy' }) : null,
        h('span', { class: 'tag', text: '-' + d.pct + '%' }),
        d.gp ? h('span', { class: 'gp', text: 'Game Pass' }) : null
      ]),
      h('div', { class: 'info' }, [
        h('a', { class: 'name', href: url, target: '_blank', rel: 'noopener noreferrer', text: d.t }),
        h('div', { class: 'pub', text: d.pub }),
        h('div', { class: 'price' }, [h('strong', { text: money(d.price, d.cur) }), h('s', { text: money(d.msrp, d.cur) })]),
        end ? h('div', { class: 'end', text: end }) : null
      ])
    ]);
  }

  function render() {
    var g = $('grid'), pager = $('pager');
    g.textContent = '';
    if (!data) { pager.hidden = true; $('genres').textContent = ''; return; }
    var s = $('q').value.trim().toLowerCase(), min = +$('min').value;
    var pool = view.filter ? data.deals.filter(view.filter) : data.deals;
    var base = pool.filter(function (d) {
      return d.pct >= min && (!s || (d.t + ' ' + d.pub).toLowerCase().indexOf(s) > -1);
    });
    renderGenres(base);
    var list = (genre ? base.filter(function (d) { return (d.cats || []).indexOf(genre) > -1; }) : base.slice())
      .sort(sorters[$('sort').value]);
    var pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    if (pageNo > pages) pageNo = pages;
    $('meta').textContent = list.length + ' deals, updated ' +
      new Date(data.updated).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    pager.hidden = pages < 2;
    $('pg').textContent = 'Page ' + pageNo + ' of ' + pages;
    $('prev').disabled = pageNo <= 1;
    $('next').disabled = pageNo >= pages;
    if (!list.length) { g.appendChild(h('p', { class: 'msg', text: 'No deals match. Try a lower discount, another genre or a different search.' })); return; }
    list.slice((pageNo - 1) * PER_PAGE, pageNo * PER_PAGE).forEach(function (d) { g.appendChild(card(d)); });
  }

  function load() {
    var m = market;
    $('meta').textContent = 'Loading deals…';
    fetch(DATA_BASE + m + '.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { if (m !== market) return; data = j; render(); })
      .catch(function () {
        if (m !== market) return;
        data = null; render();
        $('meta').textContent = 'There is no deal data for this region yet. Please try again later.';
      });
  }

  MARKETS.forEach(function (m) { $('mk').appendChild(h('option', { value: m[0], text: m[1] })); });
  $('mk').value = market;
  $('sort').value = view.sort;
  $('mk').addEventListener('change', function () { market = this.value; ls('xd_market', market); genre = ''; pageNo = 1; load(); });
  ['q', 'min', 'sort'].forEach(function (id) { $(id).addEventListener('input', function () { pageNo = 1; render(); }); });
  $('prev').addEventListener('click', function () { pageNo--; render(); window.scrollTo(0, 0); });
  $('next').addEventListener('click', function () { pageNo++; render(); window.scrollTo(0, 0); });
  $('gtoggle').addEventListener('click', function () { $('side').classList.toggle('open'); });
  load();
})();
