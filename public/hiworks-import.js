(function () {
  var ENDPOINT = 'https://tzjpgqfdudbhygzmbygo.supabase.co/functions/v1/hiworks-docs-import';
  var APIKEY = 'sb_publishable_j8sTg73xGX0AVgTwW43syQ_L393CW1I';
  var SECRET = window.__VLVD_KEY || '';
  var DOC_NO_RE = /OP-[^\s]+-지결-[\w-]+/;

  // kind: true=녹색 / false=빨강 / 'info'=회색
  var timer = null;
  function toast(msg, kind) {
    var d = document.getElementById('__vlvd_toast') || document.createElement('div');
    d.id = '__vlvd_toast';
    d.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;' +
      'padding:12px 16px;border-radius:8px;font:14px/1.4 sans-serif;color:#fff;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.2);max-width:360px;background:' +
      (kind === 'info' ? '#64748b' : kind ? '#16a34a' : '#dc2626');
    d.textContent = msg;
    document.body.appendChild(d);
    clearTimeout(timer);
    timer = setTimeout(function () { d.remove(); }, 6000);
  }

  if (!SECRET) { toast('가져오기 키가 없습니다. 북마클릿을 다시 등록해주세요', false); return; }

  // 현재 화면의 표에서 지출결의서 행 수집
  var rows = [];
  var seen = {};
  var trs = document.querySelectorAll('table tr');
  for (var i = 0; i < trs.length; i++) {
    var tds = trs[i].querySelectorAll('td');
    if (tds.length < 3) continue;
    var cells = [];
    for (var j = 0; j < tds.length; j++) {
      var td = tds[j];
      var inner = td.querySelector('[title]');
      var v = (td.getAttribute('title') || (inner && inner.getAttribute('title')) ||
               td.innerText || '').replace(/\s+/g, ' ').trim();
      if (v) cells.push(v);
    }
    var joined = cells.join(' ');
    if (joined.indexOf('지결') === -1 && joined.indexOf('지출결의') === -1) continue;
    // 문서번호 기준 중복 제거 (문서번호가 없으면 셀 내용 전체로)
    var m = joined.match(DOC_NO_RE);
    var key = m ? m[0] : joined;
    if (seen[key]) continue;
    seen[key] = true;
    var a = trs[i].querySelector('a[href]');
    rows.push({ cells: cells, url: a ? a.href : null });
  }

  if (!rows.length) { toast('이 화면에서 지출결의서 목록을 찾지 못했습니다', false); return; }

  toast('가져오는 중…', 'info');
  fetch(ENDPOINT, {
    method: 'POST',
    headers: { apikey: APIKEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: SECRET, rows: rows })
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.error) { toast('실패: ' + d.error, false); return; }
      toast('가져오기 완료 ' + d.saved + '건 · 자동연결 ' + d.auto_linked + '건' +
            (d.skipped ? ' · 인식실패 ' + d.skipped + '건' : ''), true);
    })
    .catch(function (e) { toast('전송 실패: ' + e.message, false); });
})();
