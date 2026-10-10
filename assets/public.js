/* ============================================================
   OPAC Futsal — public site
   Read-only view: fixtures, results, ladder, finals, teams.
   ============================================================ */
(function () {
  'use strict';

  var F = window.Futsal;
  var $ = F.$, $$ = F.$$, esc = F.esc;

  var state = null;
  var filterTeam = '';
  var activeTab = 'fixtures';
  var lastChampion = '';
  var firstPaint = true;

  var theme = F.initTheme();
  var revealIndex = 0;

  /* Cards fade in on the first paint only — replaying it on every live
     score update would be distracting. */
  function revealAttr() {
    if (!firstPaint) return '';
    return ' data-reveal style="--i:' + (revealIndex++) + '"';
  }

  /* ---------------------------------------------------------
     shared match card
     --------------------------------------------------------- */
  function statusBadge(m, played) {
    if (m.status === 'live') return '<span class="badge-live">● Live</span>';
    if (m.status === 'postponed') return '<span class="badge-pp">Postponed</span>';
    if (m.status === 'forfeit') return '<span class="badge-pp">Forfeit</span>';
    if (played) return '<span class="badge-final">Full time</span>';
    return '';
  }

  function slotChip(slot) {
    if (!slot) return '';
    var key = slot.toLowerCase().replace(/[^a-z0-9]/g, '');
    return '<span class="slot-chip" data-slot="' + key + '">' + esc(slot) + '</span>';
  }

  function metaLine(st, m, week) {
    var bits = [];
    var d = m.date || (week && week.date) || '';
    if (d) bits.push('<span>' + esc(F.fmtDate(d)) + '</span>');
    if (m.time) bits.push('<span>' + esc(F.fmtTime(m.time)) + '</span>');
    if (m.venue) bits.push('<span>' + esc(m.venue) + '</span>');
    return slotChip(m.slot) + bits.join('<span class="sep-dot">&middot;</span>');
  }

  /* the scoreline / kick-off block in the middle of a card */
  function scoreHTML(m, played, homeWin, awayWin) {
    if (played) {
      return '<span class="n' + (homeWin ? ' win' : '') + '">' + esc(m.homeScore) + '</span>' +
             '<span class="sep">&ndash;</span>' +
             '<span class="n' + (awayWin ? ' win' : '') + '">' + esc(m.awayScore) + '</span>';
    }
    if (m.time) return '<span class="kick">' + esc(F.fmtTime(m.time)) + '</span>';
    return '<span class="vs">vs</span>';
  }

  function bodyHTML(st, m, played, homeWin, awayWin) {
    /* The score boxes follow the scoreline itself — a 2–2 draw settled on
       penalties should still read 2–2, with the shoot-out shown below.
       Only the team names carry the overall winner. */
    var w = F.winnerSide(m);
    return '<div class="match-body">' +
      '<div class="side home' + (played ? (homeWin ? ' win' : awayWin ? ' lose' : '') : '') + '">' + F.badgeHTML(st, m.home) + '</div>' +
      '<div class="score">' + scoreHTML(m, played, w === 'home', w === 'away') + '</div>' +
      '<div class="side away' + (played ? (awayWin ? ' win' : homeWin ? ' lose' : '') : '') + '">' + F.badgeHTML(st, m.away) + '</div>' +
      '</div>';
  }

  /* "Portugal win 4–2 on penalties" and friends */
  function footText(st, m, opts) {
    var pens = opts.penWinner || F.penWinnerOf(m, m.home, m.away);
    var score = F.penSummary(m) || opts.penScore || '';
    if (pens) {
      return score
        ? '⚽ ' + F.teamName(st, pens) + ' win ' + score + ' on penalties'
        : '⚽ ' + F.teamName(st, pens) + ' won the shoot-out';
    }
    if (opts.needsPens) return 'Level after full time — shoot-out to come';
    return m.note || '';
  }

  function cardState(m, played) {
    if (m.status === 'live') return 'live';
    if (m.status === 'postponed') return 'postponed';
    return played ? 'final' : 'scheduled';
  }

  function matchCard(st, m, opts) {
    opts = opts || {};

    if (m.type === 'bye') {
      return '<div class="match bye"' + revealAttr() + '>' +
        '<div class="match-body" style="grid-template-columns:1fr auto">' +
        '<div class="side">' + F.badgeHTML(st, m.home) + '</div>' +
        '<div class="score"><span class="vs">Bye</span></div>' +
        '</div></div>';
    }

    var played = F.isPlayed(m);
    var pens = opts.penWinner || F.penWinnerOf(m, m.home, m.away);
    var win = F.winnerSide(m);
    var homeWin = win === 'home' || (pens && pens === m.home);
    var awayWin = win === 'away' || (pens && pens === m.away);

    var meta = metaLine(st, m, opts.week);
    var badge = statusBadge(m, played);
    var metaRow = (meta || badge || opts.title)
      ? '<div class="match-meta">' +
        (opts.title ? '<strong class="meta-title">' + esc(opts.title) + '</strong>' : '') +
        meta + '<span class="spacer"></span>' + badge + '</div>'
      : '';

    var foot = footText(st, m, opts);

    return '<div class="match" data-state="' + cardState(m, played) + '"' +
      (opts.tier ? ' data-tier="' + esc(opts.tier) + '"' : '') + revealAttr() + '>' +
      metaRow + bodyHTML(st, m, played, homeWin, awayWin) +
      (foot ? '<div class="match-foot">' + esc(foot) + '</div>' : '') +
      '</div>';
  }

  /* A finals tie: title strip and scoreline as one object, rather than
     a banner sitting on top of a separate card. */
  function tieCard(st, f) {
    var m = f.match;
    var played = F.isPlayed(m);
    var pens = f.result.pens ? f.result.winner : F.penWinnerOf(m, f.home, f.away);
    var win = F.winnerSide(m);
    var homeWin = win === 'home' || (pens && pens === f.home);
    var awayWin = win === 'away' || (pens && pens === f.away);

    var hs = F.num(m.homeScore), as = F.num(m.awayScore);
    var needsPens = hs !== null && as !== null && hs === as && !pens;

    var when = [];
    if (m.date) when.push(esc(F.fmtDate(m.date)));
    if (m.time) when.push(esc(F.fmtTime(m.time)));
    if (m.venue) when.push(esc(m.venue));

    var foot = footText(st, m, { penWinner: pens, penScore: f.result.penScore, needsPens: needsPens });

    return '<article class="tie" data-tier="' + esc(f.def.tier) + '" data-state="' + cardState(m, played) + '"' + revealAttr() + '>' +
      '<header class="tie-head">' +
        '<h3>' + esc(f.def.title) + '</h3>' +
        (f.def.sub ? '<p>' + esc(f.def.sub) + '</p>' : '') +
        (when.length ? '<span class="tie-when">' + when.join(' &middot; ') + '</span>' : '') +
      '</header>' +
      bodyHTML(st, m, played, homeWin, awayWin) +
      (foot ? '<div class="match-foot">' + esc(foot) + '</div>' : '') +
      '</article>';
  }

  function matchesFilter(m) {
    if (!filterTeam) return true;
    return m.home === filterTeam || m.away === filterTeam;
  }

  /* ---------------------------------------------------------
     next up
     --------------------------------------------------------- */
  function dayLabel(iso) {
    if (!iso) return '';
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return '';
    var days = Math.round((d - today) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days === -1) return 'Yesterday';
    if (days > 1 && days <= 7) return 'In ' + days + ' days';
    return '';
  }

  function renderNextUp() {
    var host = $('#nextUp');
    var entries = F.allMatches(state)
      .filter(function (e) { return e.match.type !== 'bye' && !F.isPlayed(e.match) && e.match.status !== 'postponed'; })
      .sort(function (a, b) { return F.matchSortKey(a) < F.matchSortKey(b) ? -1 : 1; });

    var live = F.allMatches(state).filter(function (e) { return e.match.status === 'live'; });
    var pick = live.length ? live[0] : entries[0];

    if (!pick) { host.innerHTML = ''; return; }

    var when = dayLabel(pick.match.date || pick.week.date);
    host.innerHTML =
      '<div class="section-head">' +
        '<h2>' + (live.length ? 'Playing now' : 'Next up') + '</h2>' +
        '<div class="rule"></div>' +
        '<span class="aside">' + esc(when || pick.week.label || '') + '</span>' +
      '</div>' +
      matchCard(state, pick.match, { week: pick.week, title: pick.week.label });
  }

  /* ---------------------------------------------------------
     fixtures — upcoming only
     --------------------------------------------------------- */
  function renderFixtures() {
    var host = $('#panel-fixtures');
    var blocks = [];
    var total = 0;

    F.compact(state.weeks).forEach(function (w) {
      var ms = F.compact(w.matches).filter(function (m) {
        return !F.isPlayed(m) && matchesFilter(m);
      });
      if (!ms.length) return;
      total += ms.filter(function (m) { return m.type !== 'bye'; }).length;
      blocks.push(
        '<div class="section-head">' +
          '<h2>' + esc(w.label) + '</h2>' +
          '<div class="rule"></div>' +
          (w.date ? '<span class="aside">' + esc(F.fmtDate(w.date)) + '</span>' : '') +
        '</div>' +
        ms.map(function (m) { return matchCard(state, m, { week: w }); }).join('')
      );
    });

    setCount('fixtures', total);

    host.innerHTML = blocks.length
      ? blocks.join('')
      : emptyState('📅', filterTeam ? 'No upcoming games for this team.' : 'No games scheduled yet.',
          filterTeam ? 'Every fixture for them has been played.' : 'Fixtures will appear here once the draw is published.');
  }

  /* ---------------------------------------------------------
     results — completed only, most recent first
     --------------------------------------------------------- */
  function renderResults() {
    var host = $('#panel-results');
    var blocks = [];
    var total = 0;

    F.compact(state.weeks).slice().reverse().forEach(function (w) {
      var ms = F.compact(w.matches).filter(function (m) {
        return F.isPlayed(m) && matchesFilter(m);
      });
      if (!ms.length) return;
      total += ms.length;
      blocks.push(
        '<div class="section-head">' +
          '<h2>' + esc(w.label) + '</h2>' +
          '<div class="rule"></div>' +
          (w.date ? '<span class="aside">' + esc(F.fmtDate(w.date)) + '</span>' : '') +
        '</div>' +
        ms.map(function (m) { return matchCard(state, m, { week: w }); }).join('')
      );
    });

    /* finished finals belong in results too */
    var finals = F.resolveFinals(state).filter(function (f) {
      return F.isPlayed(f.match) && (!filterTeam || f.home === filterTeam || f.away === filterTeam);
    });
    if (finals.length) {
      total += finals.length;
      blocks.unshift(
        '<div class="section-head"><h2>Finals</h2><div class="rule"></div></div>' +
        finals.slice().reverse().map(function (f) {
          return matchCard(state, f.match, { title: f.def.title, tier: f.def.tier, penWinner: f.result.pens ? f.result.winner : '' });
        }).join('')
      );
    }

    setCount('results', total);

    host.innerHTML = blocks.length
      ? blocks.join('')
      : emptyState('⚽', filterTeam ? 'No results for this team yet.' : 'No results yet.',
          'Scores appear here the moment they are entered.');
  }

  /* ---------------------------------------------------------
     ladder
     --------------------------------------------------------- */
  function ladderTable(rows, qualifiers, showForm) {
    if (!rows.length) return emptyState('📊', 'No teams yet.', '');
    var head = '<tr><th class="left">#</th><th class="left">Team</th>' +
      '<th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th>' +
      (showForm ? '<th>Form</th>' : '') +
      '<th>Pts</th></tr>';

    var body = rows.map(function (r, i) {
      var cls = [];
      if (qualifiers && i < qualifiers) cls.push('qualified');
      if (qualifiers && i === qualifiers - 1) cls.push('cut');
      cls.push('pos-' + (i + 1));
      if (filterTeam && r.id === filterTeam) cls.push('highlight');

      var form = '';
      if (showForm) {
        var last = r.form.slice(-5);
        form = '<td><span class="form-guide">' +
          (last.length ? last.map(function (x) { return '<i class="' + x + '" title="' + x + '">' + x + '</i>'; }).join('') : '<span style="color:var(--text-muted)">–</span>') +
          '</span></td>';
      }

      var medal = i < 3 ? ' medal m' + (i + 1) : '';
      return '<tr class="' + cls.join(' ') + '">' +
        '<td class="pos"><span class="pos-badge' + medal + '">' + (i + 1) + '</span></td>' +
        '<td class="team left">' + F.badgeHTML(state, r.id) + '</td>' +
        '<td>' + r.played + '</td><td>' + r.won + '</td><td>' + r.drawn + '</td><td>' + r.lost + '</td>' +
        '<td>' + r.gf + '</td><td>' + r.ga + '</td>' +
        '<td>' + (r.gd > 0 ? '+' : '') + r.gd + '</td>' +
        form +
        '<td class="pts">' + r.pts + '</td>' +
        '</tr>';
    }).join('');

    return '<div class="table-wrap"><table class="ladder"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
  }

  function renderLadder() {
    var host = $('#panel-ladder');
    if (!state.config.showLadder) {
      host.innerHTML = emptyState('📊', 'The ladder is turned off for this competition.', '');
      return;
    }

    var cfg = state.config;
    var q = F.qualifierCount(state);
    var br = F.bracketFor(state);
    var groups = F.standingsByGroup(state).filter(function (g) { return g.rows.length; });

    /* Only mark a qualifying line inside each group when the finals actually
       take the top n from each group. Otherwise it is one combined ladder. */
    var perGroup = groups.length > 1 && br.requiresGroups ? Math.round(q / groups.length) : 0;

    var html = groups.map(function (g) {
      return (g.name ? '<div class="section-head"><h2>' + esc(g.name) + '</h2><div class="rule"></div>' +
               '<span class="aside">' + g.rows.length + ' teams</span></div>' : '') +
        ladderTable(g.rows, groups.length > 1 ? perGroup : q, cfg.showForm);
    }).join('');

    var legendBits = [];
    if (q && groups.length > 1 && perGroup) {
      legendBits.push('<span><i class="sw"></i> Top ' + perGroup + ' from each group qualify for finals</span>');
    } else if (q) {
      legendBits.push('<span><i class="sw"></i> Top ' + q + ' qualify for finals</span>');
    }
    legendBits.push('<span>' + cfg.pointsWin + ' pts win &middot; ' + cfg.pointsDraw + ' draw &middot; ' + cfg.pointsLoss + ' loss</span>');
    var tb = cfg.tiebreakers.map(function (k) { return F.TIEBREAKERS[k].label; }).join(' → ');
    legendBits.push('<span>Separated by: ' + esc(tb) + '</span>');

    host.innerHTML = html + '<div class="legend">' + legendBits.join('') + '</div>';
  }

  /* ---------------------------------------------------------
     finals
     --------------------------------------------------------- */
  function renderFinals() {
    var host = $('#panel-finals');
    var br = F.bracketFor(state);

    if (!br.rounds.length) {
      host.innerHTML = emptyState('🏆', 'No finals series.',
        'This competition is decided by the ladder — the team on top at the end wins.');
      return;
    }

    if (!F.hasAnyResult(state)) {
      host.innerHTML = emptyState('🏆', 'Finals to come.',
        br.label + '. The bracket fills in as the ladder takes shape.');
      return;
    }

    var finals = F.resolveFinals(state);
    var html = '<div class="tie-list">' + finals.map(function (f) { return tieCard(state, f); }).join('') + '</div>';

    var champ = F.champion(state);
    if (champ) {
      html += '<div class="champion"><span class="crown">🏆</span>' +
        '<h2>' + F.badgeHTML(state, champ) + '</h2>' +
        '<p class="champion-sub">Champions</p></div>';
      if (champ !== lastChampion) F.confetti();
      lastChampion = champ;
    } else {
      lastChampion = '';
    }

    host.innerHTML = html;
  }

  /* ---------------------------------------------------------
     teams
     --------------------------------------------------------- */
  function renderTeams() {
    var host = $('#panel-teams');
    if (!state.teams.length) {
      host.innerHTML = emptyState('👕', 'No teams yet.', '');
      return;
    }
    var rows = {};
    F.standings(state).forEach(function (r) { rows[r.id] = r; });

    host.innerHTML = '<div class="grid teams">' + state.teams.map(function (t, i) {
      var r = rows[t.id];
      var meta = r && r.played
        ? r.played + ' played &middot; ' + r.won + 'W ' + r.drawn + 'D ' + r.lost + 'L &middot; ' + r.pts + ' pts'
        : 'Yet to play';
      var grp = state.config.groupCount > 1 ? ' &middot; Group ' + (F.GROUP_NAMES[t.group] || (t.group + 1)) : '';
      return '<div class="card pad-sm team-tile">' +
        '<div class="num">' + (i + 1) + '</div>' +
        '<div style="min-width:0">' + F.badgeHTML(state, t.id) +
        '<div class="meta">' + meta + grp + '</div></div>' +
        '</div>';
    }).join('') + '</div>' +
    '<p class="note accent" style="margin-top:var(--s4)">Teams only — no student names are published on this site.</p>';
  }

  /* ---------------------------------------------------------
     chrome
     --------------------------------------------------------- */
  function emptyState(icon, title, body) {
    return '<div class="empty"><span class="big" aria-hidden="true">' + icon + '</span>' +
      '<strong>' + esc(title) + '</strong>' +
      (body ? '<p style="margin-top:6px;font-size:0.9rem">' + esc(body) + '</p>' : '') + '</div>';
  }

  function setCount(tab, n) {
    var el = $('#cnt-' + tab);
    if (!el) return;
    if (n > 0) { el.textContent = n; el.hidden = false; } else { el.hidden = true; }
  }

  function showTab(name) {
    activeTab = name;
    $$('.tab-btn').forEach(function (b) {
      var on = b.dataset.tab === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    $$('.tab-panel').forEach(function (p) { p.hidden = p.id !== 'panel-' + name; });
    $('#filterBar').hidden = !(name === 'fixtures' || name === 'results' || name === 'ladder');
    try { history.replaceState(null, '', '#' + name); } catch (e) {}
  }

  function wireTabs() {
    var btns = $$('.tab-btn');
    btns.forEach(function (b) {
      b.addEventListener('click', function () { showTab(b.dataset.tab); });
      b.addEventListener('keydown', function (e) {
        var i = btns.indexOf(b), next = null;
        if (e.key === 'ArrowRight') next = btns[(i + 1) % btns.length];
        if (e.key === 'ArrowLeft') next = btns[(i - 1 + btns.length) % btns.length];
        if (e.key === 'Home') next = btns[0];
        if (e.key === 'End') next = btns[btns.length - 1];
        if (next) { e.preventDefault(); next.focus(); showTab(next.dataset.tab); }
      });
    });
  }

  function renderFilter() {
    var sel = $('#teamFilter');
    var cur = sel.value;
    sel.innerHTML = '<option value="">All teams</option>' + state.teams.map(function (t) {
      return '<option value="' + esc(t.id) + '">' + esc((t.emoji ? t.emoji + ' ' : '') + t.name) + '</option>';
    }).join('');
    sel.value = state.teams.some(function (t) { return t.id === cur; }) ? cur : '';
    filterTeam = sel.value;
  }

  function setStatus(kind) {
    var el = $('#connStatus');
    var label = el.querySelector('.label');
    var dot = el.querySelector('.dot');
    el.className = 'chip';
    dot.className = 'dot';
    if (kind === 'live') { el.classList.add('ok'); dot.classList.add('pulse'); label.textContent = 'Live'; }
    else if (kind === 'polling') { el.classList.add('ok'); label.textContent = 'Updating'; }
    else if (kind === 'reconnecting') { el.classList.add('warn'); label.textContent = 'Reconnecting'; }
    else if (kind === 'offline') { el.classList.add('err'); label.textContent = 'Offline'; }
  }

  function render() {
    revealIndex = 0;
    document.title = (state.title || 'OPAC Futsal') + ' — Fixtures & Results';
    $('#compTitle').textContent = state.title || 'OPAC Futsal';
    $('#compSub').textContent = state.subtitle || '';

    var meta = [];
    var br = F.bracketFor(state);
    meta.push('<span class="chip">' + state.teams.length + ' teams</span>');
    if (state.config.rounds > 1) meta.push('<span class="chip">' + state.config.rounds + ' rounds</span>');
    if (br.rounds.length) meta.push('<span class="chip">' + esc(br.label.split(' — ')[0]) + ' finals</span>');
    $('#heroMeta').innerHTML = meta.join('');

    renderFilter();
    renderNextUp();
    renderFixtures();
    renderResults();
    renderLadder();
    renderFinals();
    renderTeams();

    $('#updatedAt').textContent = state.updatedAt ? 'Last updated ' + F.relTime(state.updatedAt) : '';
    firstPaint = false;
  }

  /* ---------------------------------------------------------
     boot
     --------------------------------------------------------- */
  function boot() {
    wireTabs();

    $('#themeBtn').addEventListener('click', function () { theme.toggle(); });
    $('#printBtn').addEventListener('click', function () { window.print(); });
    $('#teamFilter').addEventListener('change', function () {
      filterTeam = this.value;
      renderFixtures(); renderResults(); renderLadder();
    });

    var hash = (location.hash || '').replace('#', '');
    showTab(['fixtures', 'results', 'ladder', 'finals', 'teams'].indexOf(hash) >= 0 ? hash : 'fixtures');

    F.Store.subscribe(function (s) {
      state = s;
      render();
    }, setStatus);

    /* keep "last updated" honest without a full re-render */
    setInterval(function () {
      if (state && state.updatedAt) $('#updatedAt').textContent = 'Last updated ' + F.relTime(state.updatedAt);
    }, 30000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
