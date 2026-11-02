// Xbox Deals backend (Google Apps Script)
// The page asks for one page of deals at a time (25 games, sorted by biggest discount first),
// so the first results appear quickly and the rest load in the background.
// Main path: the xbox.com "browse" service. Fallback (first page only): xbox.com pages + Microsoft's product catalog.

var MARKETS = { US: 'en-US', GB: 'en-GB', CA: 'en-CA', AU: 'en-AU', DE: 'de-DE', FR: 'fr-FR', ES: 'es-ES',
                IT: 'it-IT', NO: 'nb-NO', SE: 'sv-SE', DK: 'da-DK', BR: 'pt-BR', MX: 'es-MX', JP: 'ja-JP',
                TR: 'tr-TR', KR: 'ko-KR' };
var MAX_PAGES = 20;    // 25 games per page; raise for a longer list
var BATCH = 20;        // products per catalog request (fallback path)
var MAX_IDS = 150;     // candidate games (fallback path)
var CACHE_SECS = 3600; // each page is kept for an hour (unless forced)
var BROWSE_URL = 'https://emerald.xboxservices.com/xboxcomfd/browse?locale=';
var ORDER_IDS = ['DiscountPercentage Desc', 'DISCOUNTPERCENTAGE DESC'];
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
var PAGE_PATHS = ['/games/browse?orderby=Discount+Desc', '/games/all-games?orderby=Discount+Desc', '/games/browse/DynamicChannel.GameDeals'];

function doGet(e) {
  var q = (e && e.parameter) || {};
  if (q.action) { // JSON answers for the static website: ?action=search&q=halo  or  ?action=prices&ids=ID1,ID2
    try {
      if (q.action === 'search') return json_(storeSearch_(q.q, q.market));
      if (q.action === 'prices') return json_(storePrices_(String(q.ids || '').split(','), q.market));
      return json_({ error: 'unknown action' });
    } catch (err) {
      return json_({ error: String((err && err.message) || err) });
    }
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Xbox Deals')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Called by the page. page 0 is the first page; later pages need the token returned by the previous page.
// Returns { deals, token, o, done, updated } or { error }.
function getDealsPage(market, page, token, o, force) {
  market = MARKETS[market] ? market : 'US';
  page = Math.max(0, parseInt(page, 10) || 0);
  o = ORDER_IDS[o] ? +o : 0;
  var key = 'p7_' + market + '_' + page;
  if (!force) {
    var hit = cacheGet_(key);
    if (hit) return hit;
  }
  try {
    var out = page === 0 ? firstPage_(market) : nextPage_(market, page, String(token || ''), o);
    out.market = market; out.page = page; out.updated = Date.now();
    try { cachePut_(key, out); } catch (e) {}
    return out;
  } catch (e) {
    var msg = String((e && e.message) || e);
    console.error(msg);
    return { market: market, page: page, deals: [], done: true, error: msg, updated: Date.now() };
  }
}

function firstPage_(market) {
  var lang = MARKETS[market], notes = [];
  for (var o = 0; o < ORDER_IDS.length; o++) {
    var r = browsePage_(lang, o, '');
    if (r.error) { notes.push('"' + ORDER_IDS[o] + '": ' + r.error); continue; }
    if (r.deals.length) return { deals: r.deals, token: r.token, o: o, done: r.done || MAX_PAGES < 2 };
    notes.push('"' + ORDER_IDS[o] + '": no discounted games');
  }
  var fb = harvestDeals_(market, lang);
  if (fb.length) return { deals: fb, token: '', o: 0, done: true };
  throw new Error('No deals found. Browse service: ' + notes.join('; ') +
                  '. Run probeBrowse() in the Apps Script editor and check the Execution log.');
}

function nextPage_(market, page, token, o) {
  if (!token) return { deals: [], token: '', o: o, done: true };
  var r = browsePage_(MARKETS[market], o, token);
  if (r.error) throw new Error('Page ' + (page + 1) + ' failed: ' + r.error);
  return { deals: r.deals, token: r.token, o: o, done: r.done || page + 1 >= MAX_PAGES };
}

// ---------- cache (values are split because one cache entry holds at most ~100 KB) ----------
function cachePut_(key, obj) {
  var s = JSON.stringify(obj), size = 30000, n = Math.ceil(s.length / size), data = {};
  for (var i = 0; i < n; i++) data[key + '_' + i] = s.substr(i * size, size);
  data[key + '_n'] = String(n);
  CacheService.getScriptCache().putAll(data, CACHE_SECS);
}
function cacheGet_(key) {
  var cache = CacheService.getScriptCache(), n = parseInt(cache.get(key + '_n') || '0', 10);
  if (!n) return null;
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(key + '_' + i);
  var got = cache.getAll(keys), s = '';
  for (var j = 0; j < n; j++) { if (got[keys[j]] == null) return null; s += got[keys[j]]; }
  try { return JSON.parse(s); } catch (e) { return null; }
}

// ---------- main path: xbox.com browse service ----------
function cv_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 22) + '.0'; }

function browseBody_(orderId, token) {
  var filters = Utilities.base64Encode(JSON.stringify({ orderby: { id: 'orderby', choices: [{ id: orderId }] } }));
  var body = { Filters: filters, ReturnFilters: false,
               ChannelKeyToBeUsedInResponse: 'BROWSE_CHANNELID=_FILTERS=ORDERBY=' + orderId.toUpperCase() };
  if (token) body.EncodedCT = token;
  return body;
}

// Never throws: returns the HTTP code (0 if the request itself failed) and body.
function postBrowse_(lang, body) {
  var headers = { 'Accept': 'application/json', 'User-Agent': UA, 'MS-CV': cv_(), 'x-ms-api-version': '1.1' };
  var extra = { 'Origin': 'https://www.xbox.com', 'Referer': 'https://www.xbox.com/' };
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var h = {};
      for (var k in headers) h[k] = headers[k];
      if (attempt === 0) for (var e in extra) h[e] = extra[e];
      var res = UrlFetchApp.fetch(BROWSE_URL + lang, {
        method: 'post', contentType: 'application/json', payload: JSON.stringify(body),
        muteHttpExceptions: true, headers: h
      });
      return { code: res.getResponseCode(), body: res.getContentText() };
    } catch (err) {
      if (attempt === 1) return { code: 0, body: String((err && err.message) || err) };
    }
  }
}

function browsePage_(lang, orderIdx, token) {
  var r = postBrowse_(lang, browseBody_(ORDER_IDS[orderIdx], token));
  if (r.code !== 200) return { error: 'HTTP ' + r.code };
  var json;
  try { json = JSON.parse(r.body); } catch (e) { return { error: 'unreadable response' }; }
  var items = json.productSummaries || [], deals = [], seen = {};
  items.forEach(function (p) {
    var d = summaryToDeal_(p);
    if (d && !seen[d.id]) { seen[d.id] = 1; deals.push(d); }
  });
  var ch = json.channels && json.channels[Object.keys(json.channels)[0]];
  var next = (ch && ch.encodedCT) || '';
  // Results are sorted by discount, so stop once a page has no sales or there is no next page.
  return { deals: deals, token: next, done: !items.length || !deals.length || !next || !hasMore_(next) };
}

function hasMore_(token) {
  try {
    return JSON.parse(Utilities.newBlob(Utilities.base64Decode(token)).getDataAsString()).HasMore !== false;
  } catch (e) { return true; }
}

function parseUtc_(s) {
  var m = /(\d+)\/(\d+)\/(\d{4}) (\d+):(\d+):(\d+)/.exec(s || '');
  if (!m) return 0;
  var a = +m[1], b = +m[2];
  var month = a > 12 ? b : a, day = a > 12 ? a : b; // US format is month/day; swap if the first number can't be a month
  return Date.UTC(+m[3], month - 1, day, +m[4], +m[5], +m[6]);
}

// ISO date such as 2022-09-08T08:00:00.0000000Z -> milliseconds (0 if missing)
function isoMs_(s) {
  var m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d):(\d\d))?/.exec(s || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : 0;
}

function summaryToDeal_(p) {
  var list = (p.specificPrices && p.specificPrices.purchaseable) || [], pr = null;
  list.forEach(function (x) {
    if (x.msrp > x.listPrice && (!pr || x.discountPercentage > pr.discountPercentage)) pr = x;
  });
  if (!pr || !p.title) return null;
  var pct = Math.round(pr.discountPercentage || (1 - pr.listPrice / pr.msrp) * 100);
  if (pct < 1) return null;
  var endMs = parseUtc_(pr.endDateUtc);
  if (!endMs || endMs > Date.now() + 400 * 86400000) endMs = 0;
  var im = p.images || {};
  return { id: p.productId, t: p.title, pub: p.publisherName || '',
           img: (im.poster && im.poster.url) || (im.boxArt && im.boxArt.url) || '',
           cur: pr.currency, price: pr.listPrice, msrp: pr.msrp, pct: pct, end: endMs,
           gp: onGamePass_(p) ? 1 : 0, cats: (p.categories || []).slice(0, 4),
           rc: p.ratingCount || 0, rd: isoMs_(p.releaseDate) };
}

// True if any pass that includes the game is active right now (entered the catalog, not yet left it).
function onGamePass_(p) {
  var ids = p.includedWithPassesProductIds || [], meta = p.passMetadataByPassProductId || {}, now = Date.now();
  return ids.some(function (id) {
    var m = meta[id] || {};
    var entry = m.entryDateUTC ? Date.parse(m.entryDateUTC) : 0;
    var exit = m.exitDateUTC ? Date.parse(m.exitDateUTC) : 0;
    return (!entry || entry <= now) && (!exit || exit > now);
  });
}

// ---------- fallback: harvest IDs from xbox.com pages, price them in the catalog ----------
function tryFetch_(url) {
  try {
    var res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true, followRedirects: true,
      headers: { 'Accept': 'text/html,application/json', 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': UA }
    });
    return { code: res.getResponseCode(), body: res.getContentText() };
  } catch (e) {
    return { code: 0, body: String((e && e.message) || e) };
  }
}

function harvestIds_(html) {
  var found = String(html).match(/\b[9Bb][A-Za-z0-9]{11}\b/g) || [], seen = {}, out = [];
  found.forEach(function (raw) {
    var id = raw.toUpperCase();
    if (/\d/.test(id) && /[A-Z]/.test(id) && !seen[id]) { seen[id] = 1; out.push(id); }
  });
  return out;
}

function toDeal_(p) {
  var lp = (p.LocalizedProperties || [])[0] || {}, best = null;
  (p.DisplaySkuAvailabilities || []).forEach(function (s) {
    (s.Availabilities || []).forEach(function (a) {
      var pr = a.OrderManagementData && a.OrderManagementData.Price;
      if (!pr || !(pr.MSRP > pr.ListPrice)) return;
      var buyable = (a.Actions || []).indexOf('Purchase') > -1;
      if (!best || (buyable && !best.buyable)) best = { a: a, pr: pr, buyable: buyable };
    });
  });
  if (!best || !lp.ProductTitle) return null;
  var img = '', imgs = lp.Images || [], order = ['Poster', 'BoxArt', 'Tile', 'Logo'];
  for (var k = 0; k < order.length && !img; k++) {
    for (var j = 0; j < imgs.length; j++) {
      if (imgs[j].ImagePurpose === order[k] && imgs[j].Uri) { img = imgs[j].Uri; break; }
    }
  }
  if (img.indexOf('//') === 0) img = 'https:' + img;
  var endMs = best.a.Conditions && best.a.Conditions.EndDate ? Date.parse(best.a.Conditions.EndDate) : 0;
  if (!endMs || endMs > Date.now() + 400 * 86400000) endMs = 0;
  var pct = Math.round((1 - best.pr.ListPrice / best.pr.MSRP) * 100);
  if (pct < 1) return null;
  return { id: p.ProductId, t: lp.ProductTitle, pub: lp.PublisherName || '', img: img,
           cur: best.pr.CurrencyCode, price: best.pr.ListPrice, msrp: best.pr.MSRP, pct: pct, end: endMs, gp: 0,
           cats: (p.Properties && p.Properties.Category) ? [p.Properties.Category] : [], rc: 0,
           rd: isoMs_(p.MarketProperties && p.MarketProperties[0] && p.MarketProperties[0].OriginalReleaseDate) };
}

function harvestDeals_(market, lang) {
  var ids = [], seen = {};
  PAGE_PATHS.forEach(function (p) {
    var r = tryFetch_('https://www.xbox.com/' + lang + p);
    if (r.code === 200) harvestIds_(r.body).forEach(function (id) { if (!seen[id]) { seen[id] = 1; ids.push(id); } });
  });
  ids = ids.slice(0, MAX_IDS);
  var deals = [];
  for (var i = 0; i < ids.length; i += BATCH) {
    var cr = tryFetch_('https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=' + ids.slice(i, i + BATCH).join(',') +
                       '&market=' + market + '&languages=' + lang);
    if (cr.code !== 200) continue;
    try { (JSON.parse(cr.body).Products || []).forEach(function (p) { var d = toDeal_(p); if (d) deals.push(d); }); } catch (e) {}
  }
  return deals;
}

// ---------- diagnostics: run from the editor and read the Execution log ----------
function probeBrowse() {
  ORDER_IDS.forEach(function (id) {
    var r = postBrowse_(MARKETS.US, browseBody_(id, ''));
    var n = 0, d = 0;
    try { var j = JSON.parse(r.body); n = (j.productSummaries || []).length; (j.productSummaries || []).forEach(function (p) { if (summaryToDeal_(p)) d++; }); } catch (e) {}
    console.log('orderby "' + id + '" -> HTTP ' + r.code + ', ' + n + ' products, ' + d + ' on sale\n' + String(r.body).slice(0, 400) + '\n');
  });
}

// ---------- store-wide search and price lookups (used by the static website) ----------
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function md5_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text).map(function (b) {
    return ('0' + (b & 255).toString(16)).slice(-2);
  }).join('');
}

function suggestUrls_(market, lang, query) {
  var base = 'https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/autosuggest?market=' + market +
             '&languages=' + lang + ',neutral&query=' + encodeURIComponent(query);
  return [base + '&productFamilyNames=Games&topProducts=12',
          base + '&productFamilyNames=Games&topProducts=12&platformDependencyName=Windows.Xbox',
          base + '&productFamilyNames=Games,Apps&topProducts=12'];
}

// Product IDs from the suggestion response: the BigCatalogId fields, or any ID-shaped text as a backup.
function suggestIds_(body) {
  var ids = [], seen = {};
  function add(raw) {
    var id = String(raw).toUpperCase();
    if (/^[A-Z0-9]{12}$/.test(id) && /\d/.test(id) && /[A-Z]/.test(id) && !seen[id]) { seen[id] = 1; ids.push(id); }
  }
  try {
    (JSON.parse(body).ResultSets || []).forEach(function (rs) {
      (rs.Suggests || []).forEach(function (sg) {
        (sg.Metas || []).forEach(function (m) { if (m.Key === 'BigCatalogId') add(m.Value); });
      });
    });
  } catch (e) {}
  if (!ids.length) (String(body).match(/\b[9BC][A-Za-z0-9]{11}\b/g) || []).forEach(add);
  return ids;
}

function storeSearch_(query, market) {
  market = MARKETS[market] ? market : 'US';
  query = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (query.length < 2) return { games: [] };
  var key = 's1_' + market + '_' + md5_(query.toLowerCase());
  var hit = cacheGet_(key);
  if (hit) return hit;
  var lang = MARKETS[market], ids = [], codes = [], urls = suggestUrls_(market, lang, query);
  for (var u = 0; u < urls.length && !ids.length; u++) {
    var r = tryFetch_(urls[u]);
    codes.push(r.code || 'failed');
    if (r.code === 200) ids = suggestIds_(r.body);
  }
  if (!ids.length && codes.every(function (c) { return c !== 200; })) {
    return { error: 'The Xbox store search did not answer (' + codes.join(', ') + ').' };
  }
  var out = { games: fetchGames_(ids.slice(0, 12), market, lang, true) };
  try { cachePut_(key, out); } catch (e) {}
  return out;
}

function storePrices_(ids, market) {
  market = MARKETS[market] ? market : 'US';
  ids = (ids || []).map(function (x) { return String(x).trim().toUpperCase(); })
    .filter(function (x) { return /^[A-Z0-9]{12}$/.test(x); }).slice(0, 60);
  if (!ids.length) return { games: {} };
  var key = 'w1_' + market + '_' + md5_(ids.join(','));
  var hit = cacheGet_(key);
  if (hit) return hit;
  var out = { games: {} };
  fetchGames_(ids, market, MARKETS[market], false).forEach(function (g) { out.games[g.id] = g; });
  try { cachePut_(key, out); } catch (e) {}
  return out;
}

// Looks up products in the catalog (any game, discounted or not), keeping the order of ids.
function fetchGames_(ids, market, lang, onlyGames) {
  var map = {};
  for (var i = 0; i < ids.length; i += BATCH) {
    var cr = tryFetch_('https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=' + ids.slice(i, i + BATCH).join(',') +
                       '&market=' + market + '&languages=' + lang);
    if (cr.code !== 200) continue;
    try {
      (JSON.parse(cr.body).Products || []).forEach(function (p) {
        if (onlyGames && p.ProductType && p.ProductType !== 'Game') return;
        var g = catalogGame_(p);
        if (g) map[g.id] = g;
      });
    } catch (e) {}
  }
  return ids.map(function (id) { return map[id]; }).filter(Boolean);
}

function catalogGame_(p) {
  var lp = (p.LocalizedProperties || [])[0] || {};
  if (!lp.ProductTitle || !p.ProductId) return null;
  var best = null;
  (p.DisplaySkuAvailabilities || []).forEach(function (s) {
    (s.Availabilities || []).forEach(function (a) {
      var pr = a.OrderManagementData && a.OrderManagementData.Price;
      if (!pr || typeof pr.ListPrice !== 'number') return;
      var buyable = (a.Actions || []).indexOf('Purchase') > -1;
      if (!best || (buyable && !best.buyable) || (buyable === best.buyable && pr.ListPrice < best.pr.ListPrice)) {
        best = { a: a, pr: pr, buyable: buyable };
      }
    });
  });
  var img = '', imgs = lp.Images || [], order = ['Poster', 'BoxArt', 'Tile', 'Logo'];
  for (var k = 0; k < order.length && !img; k++) {
    for (var j = 0; j < imgs.length; j++) {
      if (imgs[j].ImagePurpose === order[k] && imgs[j].Uri) { img = imgs[j].Uri; break; }
    }
  }
  if (img.indexOf('//') === 0) img = 'https:' + img;
  var list = best ? best.pr.ListPrice : null, msrp = best ? (best.pr.MSRP || list) : null;
  var pct = best && msrp > list ? Math.round((1 - list / msrp) * 100) : 0;
  var endMs = pct && best.a.Conditions && best.a.Conditions.EndDate ? Date.parse(best.a.Conditions.EndDate) : 0;
  if (!endMs || endMs > Date.now() + 400 * 86400000) endMs = 0;
  var mp = (p.MarketProperties || [])[0] || {};
  return { id: p.ProductId, t: lp.ProductTitle, pub: lp.PublisherName || '', img: img,
           cur: best ? best.pr.CurrencyCode : '', price: list, msrp: msrp, pct: pct, end: endMs, gp: 0,
           cats: (p.Properties && p.Properties.Category) ? [p.Properties.Category] : [], rc: 0,
           rd: isoMs_(mp.OriginalReleaseDate) };
}

// Run from the editor if search returns nothing, then read the Execution log.
function searchDiag() {
  suggestUrls_('US', MARKETS.US, 'halo').forEach(function (u) {
    var r = tryFetch_(u);
    console.log('HTTP ' + r.code + ', ' + suggestIds_(r.body).length + ' IDs\n' + u + '\n' + String(r.body).slice(0, 300) + '\n');
  });
}
