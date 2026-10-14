(function () {
  var ENDPOINT = 'https://tzjpgqfdudbhygzmbygo.supabase.co/functions/v1/hiworks-docs-import';
  var APIKEY = 'sb_publishable_j8sTg73xGX0AVgTwW43syQ_L393CW1I';
  var SECRET = window.__VLVD_KEY || '';
  var MAX_PAGES = 20;      // 따라갈 페이지 수 상한 (무한루프 방지)
  var PAGE_DELAY = 300;    // 페이지 요청 간격(ms)
  var DOC_NO_RE = /OP-[^\s]+-지결-[\w-]+/;

  // kind: true=녹색 / false=빨강 / 'info'=회색. slot 이 다르면 별도 toast 로 위에 쌓인다.
  var timers = {};
  function toast(msg, kind, slot) {
    slot = slot || 0;
    var id = '__vlvd_toast' + (slot ? '_' + slot : '');
    var d = document.getElementById(id) || document.createElement('div');
    d.id = id;
    d.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:' + (16 + slot * 64) + 'px;' +
      'padding:12px 16px;border-radius:8px;font:14px/1.4 sans-serif;color:#fff;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.2);max-width:360px;background:' +
      (kind === 'info' ? '#64748b' : kind ? '#16a34a' : '#dc2626');
    d.textContent = msg;
    document.body.appendChild(d);
    clearTimeout(timers[id]);
    timers[id] = setTimeout(function () { d.remove(); }, 6000);
  }

  if (!SECRET) { toast('가져오기 키가 없습니다. 북마클릿을 다시 등록해주세요', false); return; }

  // 문서(현재 화면 또는 fetch 로 받은 페이지)에서 지출결의서 행 수집. baseUrl 은 상대 링크 해석 기준.
  function collectRows(doc, baseUrl) {
    var rows = [];
    var trs = doc.querySelectorAll('table tr');
    for (var i = 0; i < trs.length; i++) {
      var tds = trs[i].querySelectorAll('td');
      if (tds.length < 3) continue;
      var cells = [];
      for (var j = 0; j < tds.length; j++) {
        var td = tds[j];
        var inner = td.querySelector('[title]');
        // DOMParser 문서는 렌더링되지 않아 innerText 가 비어 있을 수 있으므로 textContent 로 보완
        var v = (td.getAttribute('title') || (inner && inner.getAttribute('title')) ||
                 td.innerText || td.textContent || '').replace(/\s+/g, ' ').trim();
        if (v) cells.push(v);
      }
      var joined = cells.join(' ');
      if (joined.indexOf('지결') === -1 && joined.indexOf('지출결의') === -1) continue;
      var a = trs[i].querySelector('a[href]');
      var href = a ? a.getAttribute('href') : null;
      var url = null;
      if (href && !/^\s*(javascript:|#)/i.test(href)) {
        try { url = new URL(href, baseUrl).href; } catch (e) { url = null; }
      } else if (a && doc === document) {
        url = a.href;
      }
      rows.push({ cells: cells, url: url });
    }
    return rows;
  }

  // 표 아래 페이징 영역의 숫자 링크 → 현재 페이지 제외 · URL 중복 제거 · 번호순 · 최대 MAX_PAGES
  function findPageUrls() {
    var here = location.href.split('#')[0];
    var activeRe = /(^|\s)(on|active|current|selected|cur|now)(\s|$)/i;
    var isActive = function (el) {
      for (var k = 0; k < 2 && el; k++, el = el.parentElement) {
        if (el.getAttribute('aria-current') || activeRe.test(el.className || '')) return true;
      }
      return false;
    };
    var links = document.querySelectorAll('a[href]');
    var curNo = null;
    var found = [];
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var text = (a.textContent || '').trim();
      if (!/^\d+$/.test(text)) continue;
      // 데이터 행 안의 숫자 링크(건수 등)는 페이징이 아님
      var tr = a.closest('tr');
      if (tr && tr.querySelectorAll('td').length >= 3) continue;
      var href = a.getAttribute('href') || '';
      if (/^\s*(javascript:|#)/i.test(href)) continue;
      var url = a.href.split('#')[0];
      if (isActive(a) || url === here) { curNo = text; continue; }
      found.push({ no: Number(text), text: text, url: url });
    }
    var seen = {};
    seen[here] = true;
    var out = [];
    found.sort(function (x, y) { return x.no - y.no; });
    for (var j = 0; j < found.length; j++) {
      var f = found[j];
      if (f.text === curNo || seen[f.url]) continue;
      seen[f.url] = true;
      out.push(f.url);
      if (out.length >= MAX_PAGES) break;
    }
    return out;
  }

  function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  var allRows = collectRows(document, location.href);
  var pageUrls = findPageUrls();
  var totalPages = pageUrls.length + 1;

  if (!allRows.length && !pageUrls.length) { toast('이 화면에서 지출결의서 목록을 찾지 못했습니다', false); return; }

  // 각 페이지를 순서대로 가져와 같은 규칙으로 수집. 실패한 페이지는 건너뛴다.
  var chain = Promise.resolve();
  if (pageUrls.length) toast('가져오는 중… 1/' + totalPages + ' 페이지', 'info');
  pageUrls.forEach(function (url, idx) {
    chain = chain
      .then(function () { return wait(PAGE_DELAY); })
      .then(function () {
        toast('가져오는 중… ' + (idx + 2) + '/' + totalPages + ' 페이지', 'info');
        return fetch(url, { credentials: 'include' });
      })
      .then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then(function (text) {
        var doc = new DOMParser().parseFromString(text, 'text/html');
        allRows = allRows.concat(collectRows(doc, url));
      })
      .catch(function (e) { console.warn('[vlvd] 페이지 가져오기 실패', url, e); });
  });

  chain.then(function () {
    // 문서번호 기준 중복 제거 (문서번호가 없으면 셀 내용 전체로)
    var seen = {};
    var rows = [];
    for (var i = 0; i < allRows.length; i++) {
      var joined = allRows[i].cells.join(' ');
      var m = joined.match(DOC_NO_RE);
      var key = m ? m[0] : joined;
      if (seen[key]) continue;
      seen[key] = true;
      rows.push(allRows[i]);
    }
    if (!rows.length) { toast('이 화면에서 지출결의서 목록을 찾지 못했습니다', false); return; }

    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { apikey: APIKEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: SECRET, rows: rows })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error) { toast('실패: ' + d.error, false); return; }
        toast('가져오기 완료 ' + d.saved + '건 · 자동연결 ' + d.auto_linked +
              '건 · 인식실패 ' + d.skipped + '건', true);
        if (!pageUrls.length) {
          toast('페이지 링크를 찾지 못했습니다. 다음 페이지로 넘겨서 다시 눌러주세요', 'info', 1);
        }
      });
  }).catch(function (e) { toast('전송 실패: ' + e.message, false); });
})();
