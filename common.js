(function () {
  'use strict';
  var XDC = window.XDC = {
    // Paste the address of your Cloudflare worker (https://<name>.<account>.workers.dev) here to turn on search
    // across every Xbox game and live prices on the wishlist page. Without a worker you can paste the Apps Script
    // web app address (ends with /exec) instead. Leave empty to run without them.
    API_URL: 'xbox-proxy.ilyasbelloutix.workers.dev',
    DATA_BASE: 'data/', // folder with the region files written by the publisher (US.json, GB.json, ...)
    MARKETS: [['US','United States'],['GB','United Kingdom'],['CA','Canada'],['AU','Australia'],['DE','Germany'],['FR','France'],
      ['ES','Spain'],['IT','Italy'],['NO','Norway'],['SE','Sweden'],['DK','Denmark'],['BR','Brazil'],['MX','Mexico'],['JP','Japan'],
      ['TR','Turkey'],['KR','South Korea']]
  };

  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {}
    return null;
  }
  XDC.ls = ls;
  XDC.h = function (tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  };
  XDC.money = function (v, cur) {
    if (v === 0) return 'Free';
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(v); }
    catch (e) { return v.toFixed(2) + ' ' + cur; }
  };
  XDC.getMarket = function () {
    var m = ls('xd_market') || 'US';
    return XDC.MARKETS.some(function (x) { return x[0] === m; }) ? m : 'US';
  };
  XDC.setMarket = function (m) { ls('xd_market', m); };
  XDC.fillRegions = function (sel) {
    XDC.MARKETS.forEach(function (m) { sel.appendChild(XDC.h('option', { value: m[0], text: m[1] })); });
    sel.value = XDC.getMarket();
  };

  // Wishlist: kept in this browser only (localStorage), as a list of { id, t, img, pub, added }.
  function readWish() {
    try { var a = JSON.parse(ls('xd_wish')); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  XDC.wish = {
    list: readWish,
    has: function (id) { return readWish().some(function (w) { return w.id === id; }); },
    toggle: function (d) { // returns true when the game is now saved
      var a = readWish(), i = a.map(function (w) { return w.id; }).indexOf(d.id);
      if (i >= 0) a.splice(i, 1);
      else a.push({ id: d.id, t: d.t, img: d.img || '', pub: d.pub || '', added: Date.now() });
      ls('xd_wish', JSON.stringify(a));
      return i < 0;
    }
  };

  // Calls the Apps Script web app: XDC.api('search', { q: 'halo', market: 'US' }).then(...)
  XDC.api = function (action, params) {
    if (!XDC.API_URL) return Promise.reject(new Error('not-configured'));
    var q = 'action=' + encodeURIComponent(action);
    for (var k in params) q += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    var url = XDC.API_URL + (XDC.API_URL.indexOf('?') < 0 ? '?' : '&') + q;
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  };

  // One game card. d = { id, t, pub, img, cur, price, msrp, pct, end, gp } (price may be null when unknown).
  XDC.card = function (d) {
    var h = XDC.h, url = 'https://www.microsoft.com/store/productId/' + encodeURIComponent(d.id);
    var end = d.end && d.pct ? 'Ends ' + new Date(d.end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    var heart = h('button', { class: 'heart', type: 'button' });
    function paint() {
      var on = XDC.wish.has(d.id);
      heart.textContent = on ? '\u2665' : '\u2661';
      heart.setAttribute('aria-pressed', String(on));
      heart.setAttribute('aria-label', on ? 'Remove from wishlist' : 'Add to wishlist');
    }
    paint();
    heart.addEventListener('click', function () {
      XDC.wish.toggle(d); paint();
      document.dispatchEvent(new CustomEvent('xd:wish', { detail: d.id }));
    });
    var price = d.price == null
      ? h('div', { class: 'end', text: 'Price unavailable' })
      : h('div', { class: 'price' }, [h('strong', { text: XDC.money(d.price, d.cur) }),
          d.msrp > d.price ? h('s', { text: XDC.money(d.msrp, d.cur) }) : null]);
    return h('article', { class: 'card' }, [
      h('a', { class: 'poster', href: url, target: '_blank', rel: 'noopener noreferrer', tabindex: '-1', 'aria-hidden': 'true' }, [
        d.img ? h('img', { src: d.img + (d.img.indexOf('?') < 0 ? '?q=90&w=360' : ''), alt: '', loading: 'lazy' }) : null,
        d.pct ? h('span', { class: 'tag', text: '-' + d.pct + '%' }) : null,
        d.gp ? h('span', { class: 'gp', text: 'Game Pass' }) : null
      ]),
      heart,
      h('div', { class: 'info' }, [
        h('a', { class: 'name', href: url, target: '_blank', rel: 'noopener noreferrer', text: d.t }),
        h('div', { class: 'pub', text: d.pub }),
        price,
        end ? h('div', { class: 'end', text: end }) : null
      ])
    ]);
  };
})();
