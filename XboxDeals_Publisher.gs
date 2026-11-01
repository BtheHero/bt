// Publisher (add as a new file, e.g. "Publisher", next to your existing Code.gs in the same Apps Script project).
// Every few hours it collects the deals for each region and writes data/<REGION>.json to a GitHub repository,
// all regions of one run in a single commit, so the site is rebuilt once per run.
// The static website reads those files, so visitors never touch Apps Script or Microsoft.
//
// Script properties to add (Project Settings > Script Properties):
//   GH_OWNER  your GitHub user name       GH_REPO  the repository name
//   GH_TOKEN  a fine-grained token with Contents: read and write on that one repository
//   GH_BRANCH (optional) defaults to main
// The repository must already contain at least one file (for example a README or the site files).

var PUBLISH_MARKETS = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'NO', 'TR', 'KR']; // edit to the regions you want
var TIME_BUDGET_MS = 270000; // stop starting new regions after 4.5 minutes (Apps Script stops runs at 6)

function publishAll() {
  var start = Date.now(), props = PropertiesService.getScriptProperties(), log = [], files = [];
  var cursor = parseInt(props.getProperty('PUB_CURSOR') || '0', 10) % PUBLISH_MARKETS.length, done = 0;
  for (var n = 0; n < PUBLISH_MARKETS.length; n++) {
    if (Date.now() - start > TIME_BUDGET_MS) break;
    var m = PUBLISH_MARKETS[(cursor + n) % PUBLISH_MARKETS.length];
    try {
      var deals = collectDeals_(m);
      files.push({ path: 'data/' + m + '.json', content: JSON.stringify({ market: m, updated: Date.now(), deals: deals }) });
      log.push(m + ': collected ' + deals.length + ' deals');
    } catch (e) {
      log.push(m + ': failed - ' + ((e && e.message) || e));
    }
    done++;
  }
  var committed = true;
  if (files.length) {
    try {
      ghCommit_(files, 'Update deals (' + files.length + ' regions)');
      log.push('Published ' + files.length + ' files in one commit.');
    } catch (e) {
      committed = false;
      log.push('Commit failed - ' + ((e && e.message) || e));
    }
  }
  if (committed) props.setProperty('PUB_CURSOR', String((cursor + done) % PUBLISH_MARKETS.length)); // regions not reached go first next time
  console.log(log.join('\n'));
}

// Run once to schedule publishAll every 3 hours (replaces any earlier schedule).
function installPublisherTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'publishAll') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('publishAll').timeBased().everyHours(3).create();
}

// All discounted games for a region, page by page (uses firstPage_ / nextPage_ from Code.gs).
function collectDeals_(market) {
  var deals = [], seen = {}, page = 0, token = '', o = 0;
  try {
    while (true) {
      var r = page === 0 ? firstPage_(market) : nextPage_(market, page, token, o);
      r.deals.forEach(function (d) { if (!seen[d.id]) { seen[d.id] = 1; deals.push(d); } });
      if (r.done || !r.token) break;
      token = r.token; o = r.o; page++;
    }
  } catch (e) {
    if (!deals.length) throw e; // keep what was collected if a later page fails
  }
  if (!deals.length) throw new Error('no deals found');
  return deals;
}

// Writes several files to the repository as ONE commit (git data API: tree, commit, move the branch).
function ghCommit_(files, message) {
  var p = PropertiesService.getScriptProperties();
  var owner = p.getProperty('GH_OWNER'), repo = p.getProperty('GH_REPO'), token = p.getProperty('GH_TOKEN');
  var branch = p.getProperty('GH_BRANCH') || 'main';
  if (!owner || !repo || !token) throw new Error('Set GH_OWNER, GH_REPO and GH_TOKEN in Script Properties.');
  var api = 'https://api.github.com/repos/' + owner + '/' + repo;
  var headers = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                  'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'xbox-deals-publisher' };
  function call(method, path, payload) {
    var opts = { method: method, headers: headers, muteHttpExceptions: true };
    if (payload) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(payload); }
    var res = UrlFetchApp.fetch(api + path, opts);
    if (res.getResponseCode() > 201) {
      throw new Error('GitHub ' + method + ' ' + path + ' returned ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
    }
    return JSON.parse(res.getContentText());
  }
  var headSha = call('get', '/git/ref/heads/' + branch).object.sha;
  var baseTree = call('get', '/git/commits/' + headSha).tree.sha;
  var tree = call('post', '/git/trees', {
    base_tree: baseTree,
    tree: files.map(function (f) { return { path: f.path, mode: '100644', type: 'blob', content: f.content }; })
  });
  var commit = call('post', '/git/commits', { message: message, tree: tree.sha, parents: [headSha] });
  call('patch', '/git/refs/heads/' + branch, { sha: commit.sha });
}
