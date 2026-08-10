/* ============================================================
   OPAC Futsal — core
   Data model, v1→v2 migration, standings, finals brackets,
   fixture generation, and the Firebase transport.
   Shared by index.html and admin.html.
   ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.OPAC || {};
  var SCHEMA = 2;

  /* ---------------------------------------------------------
     small helpers
     --------------------------------------------------------- */
  function uid(prefix) {
    return (prefix || 'i') + '_' +
      Date.now().toString(36).slice(-5) +
      Math.random().toString(36).slice(2, 7);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function num(v) {
    if (v === '' || v === null || v === undefined) return null;
    var n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* RTDB turns deleted array entries into nulls — strip them everywhere. */
  function compact(a) { return (Array.isArray(a) ? a : []).filter(function (x) { return x != null; }); }

  /* ---------------------------------------------------------
     configuration defaults
     --------------------------------------------------------- */
  var DEFAULT_CONFIG = {
    format: 'roundrobin',   // roundrobin | groups | knockout | custom
    rounds: 1,              // 1 = single round robin, 2 = home & away
    groupCount: 1,
    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    pointsBye: 3,
    drawsAllowed: true,
    tiebreakers: ['pts', 'gd', 'gf', 'h2h'],
    finalsFormat: 'top4afl',
    showLadder: true,
    gamesPerWeek: 2,
    weekLabel: 'Week',
    startDate: '',
    dayName: 'Wednesday',
    slots: ['Lunch 1', 'Lunch 2'],
    venue: '',
    showForm: true,
    lockPublicScores: false
  };

  /* ---------------------------------------------------------
     tiebreakers
     --------------------------------------------------------- */
  var TIEBREAKERS = {
    pts:  { label: 'Points',                 cmp: function (a, b) { return b.pts - a.pts; } },
    gd:   { label: 'Goal difference',        cmp: function (a, b) { return b.gd - a.gd; } },
    pct:  { label: 'Percentage (GF ÷ GA)',   cmp: function (a, b) { return b.pct - a.pct; } },
    gf:   { label: 'Goals for',              cmp: function (a, b) { return b.gf - a.gf; } },
    ga:   { label: 'Goals against (fewest)', cmp: function (a, b) { return a.ga - b.ga; } },
    wins: { label: 'Most wins',              cmp: function (a, b) { return b.won - a.won; } },
    h2h:  { label: 'Head-to-head',           cmp: function (a, b, ctx) { return headToHead(a, b, ctx); } },
    name: { label: 'Team name (A–Z)',        cmp: function (a, b) { return a.name.localeCompare(b.name); } }
  };
  var TIEBREAKER_ORDER = ['pts', 'gd', 'pct', 'gf', 'ga', 'wins', 'h2h', 'name'];

  function headToHead(a, b, ctx) {
    if (!ctx || !ctx.matches) return 0;
    var ap = 0, bp = 0, agd = 0, bgd = 0;
    ctx.matches.forEach(function (m) {
      if (!isPlayed(m)) return;
      var pair = (m.home === a.id && m.away === b.id) || (m.home === b.id && m.away === a.id);
      if (!pair) return;
      var hs = num(m.homeScore), as = num(m.awayScore);
      var aHome = m.home === a.id;
      var aFor = aHome ? hs : as, aAg = aHome ? as : hs;
      agd += aFor - aAg; bgd += aAg - aFor;
      if (aFor > aAg) { ap += ctx.cfg.pointsWin; bp += ctx.cfg.pointsLoss; }
      else if (aFor < aAg) { bp += ctx.cfg.pointsWin; ap += ctx.cfg.pointsLoss; }
      else { ap += ctx.cfg.pointsDraw; bp += ctx.cfg.pointsDraw; }
    });
    if (ap !== bp) return bp - ap;
    return bgd - agd;
  }

  /* ---------------------------------------------------------
     finals brackets — declarative so new formats are data, not code
     seed:n        → nth on the ladder
     groupSeed:[g,n] → nth in group g
     winner:'id' / loser:'id' → result of an earlier bracket match
     --------------------------------------------------------- */
  var BRACKETS = {
    none: { label: 'No finals — ladder decides', qualifiers: 0, rounds: [] },

    top2: {
      label: 'Top 2 — straight Grand Final', qualifiers: 2,
      rounds: [
        { id: 'gf', title: 'Grand Final', sub: '1st v 2nd', tier: 'grand', home: { seed: 1 }, away: { seed: 2 } }
      ]
    },

    top3: {
      label: 'Top 3 — Preliminary + Grand Final', qualifiers: 3,
      rounds: [
        { id: 'pf', title: 'Preliminary Final', sub: '2nd v 3rd', tier: 'prelim', home: { seed: 2 }, away: { seed: 3 } },
        { id: 'gf', title: 'Grand Final', sub: '1st v Winner Prelim', tier: 'grand', home: { seed: 1 }, away: { winner: 'pf' } }
      ]
    },

    top4afl: {
      label: 'Top 4 — AFL style (double chance for 1st & 2nd)', qualifiers: 4,
      rounds: [
        { id: 'sf1', title: 'Semi Final 1', sub: '1st v 2nd', tier: 'semi', home: { seed: 1 }, away: { seed: 2 } },
        { id: 'sf2', title: 'Semi Final 2', sub: '3rd v 4th', tier: 'semi', home: { seed: 3 }, away: { seed: 4 } },
        { id: 'pf', title: 'Preliminary Final', sub: 'Loser SF1 v Winner SF2', tier: 'prelim', home: { loser: 'sf1' }, away: { winner: 'sf2' } },
        { id: 'gf', title: 'Grand Final', sub: 'Winner SF1 v Winner Prelim', tier: 'grand', home: { winner: 'sf1' }, away: { winner: 'pf' } }
      ]
    },

    top4ko: {
      label: 'Top 4 — straight knockout + 3rd place', qualifiers: 4,
      rounds: [
        { id: 'sf1', title: 'Semi Final 1', sub: '1st v 4th', tier: 'semi', home: { seed: 1 }, away: { seed: 4 } },
        { id: 'sf2', title: 'Semi Final 2', sub: '2nd v 3rd', tier: 'semi', home: { seed: 2 }, away: { seed: 3 } },
        { id: 'third', title: '3rd Place Play-off', sub: 'Losing semi-finalists', tier: 'third', home: { loser: 'sf1' }, away: { loser: 'sf2' } },
        { id: 'gf', title: 'Grand Final', sub: 'Winner SF1 v Winner SF2', tier: 'grand', home: { winner: 'sf1' }, away: { winner: 'sf2' } }
      ]
    },

    top8ko: {
      label: 'Top 8 — quarter finals onwards', qualifiers: 8,
      rounds: [
        { id: 'qf1', title: 'Quarter Final 1', sub: '1st v 8th', tier: 'qf', home: { seed: 1 }, away: { seed: 8 } },
        { id: 'qf2', title: 'Quarter Final 2', sub: '4th v 5th', tier: 'qf', home: { seed: 4 }, away: { seed: 5 } },
        { id: 'qf3', title: 'Quarter Final 3', sub: '2nd v 7th', tier: 'qf', home: { seed: 2 }, away: { seed: 7 } },
        { id: 'qf4', title: 'Quarter Final 4', sub: '3rd v 6th', tier: 'qf', home: { seed: 3 }, away: { seed: 6 } },
        { id: 'sf1', title: 'Semi Final 1', tier: 'semi', home: { winner: 'qf1' }, away: { winner: 'qf2' } },
        { id: 'sf2', title: 'Semi Final 2', tier: 'semi', home: { winner: 'qf3' }, away: { winner: 'qf4' } },
        { id: 'third', title: '3rd Place Play-off', tier: 'third', home: { loser: 'sf1' }, away: { loser: 'sf2' } },
        { id: 'gf', title: 'Grand Final', tier: 'grand', home: { winner: 'sf1' }, away: { winner: 'sf2' } }
      ]
    },

    cross4: {
      label: 'Top 2 from each group — crossover semis', qualifiers: 4, requiresGroups: 2,
      rounds: [
        { id: 'sf1', title: 'Semi Final 1', sub: 'A1 v B2', tier: 'semi', home: { groupSeed: [0, 1] }, away: { groupSeed: [1, 2] } },
        { id: 'sf2', title: 'Semi Final 2', sub: 'B1 v A2', tier: 'semi', home: { groupSeed: [1, 1] }, away: { groupSeed: [0, 2] } },
        { id: 'third', title: '3rd Place Play-off', tier: 'third', home: { loser: 'sf1' }, away: { loser: 'sf2' } },
        { id: 'gf', title: 'Grand Final', tier: 'grand', home: { winner: 'sf1' }, away: { winner: 'sf2' } }
      ]
    }
  };

  var GROUP_NAMES = ['A', 'B', 'C', 'D', 'E', 'F'];

  /* ---------------------------------------------------------
     state shape
     --------------------------------------------------------- */
  function blankTeam(i) {
    return { id: uid('t'), name: 'Team ' + (i + 1), emoji: '', logo: '', group: 0, colour: '' };
  }

  function blankState(teamCount) {
    var n = teamCount || 6, teams = [], i;
    for (i = 0; i < n; i++) teams.push(blankTeam(i));
    return {
      schema: SCHEMA,
      title: 'OPAC Futsal World Championship',
      subtitle: 'Wednesday Lunchtime League',
      config: clone(DEFAULT_CONFIG),
      teams: teams,
      weeks: [],
      finals: {},
      updatedAt: new Date().toISOString()
    };
  }

  function blankMatch(homeId, awayId, slot) {
    return {
      id: uid('m'), home: homeId || '', away: awayId || '',
      homeScore: '', awayScore: '',
      slot: slot || '', date: '', time: '', venue: '',
      status: '', note: '', penWinner: '', type: ''
    };
  }

  /* ---------------------------------------------------------
     migration — v1 (name-keyed) → v2 (id-keyed)
     Never destructive: this runs in memory. Nothing is written
     back until the admin saves.
     --------------------------------------------------------- */
  function migrate(raw) {
    /* An empty database should read as an empty competition, not as six
       placeholder teams on the public site. */
    if (!raw || typeof raw !== 'object') return blankState(0);
    if (raw.schema >= 2) return normalise(raw);

    var out = blankState(0);
    out.title = raw.title || out.title;
    out.subtitle = raw.subtitle || out.subtitle;

    /* v1 teams were either ['Brazil', ...] or [{name, flag, logo}, ...] */
    var byName = {};
    out.teams = compact(raw.teams).map(function (t, i) {
      var team = (typeof t === 'string')
        ? { id: uid('t'), name: t, emoji: '', logo: '', group: 0, colour: '' }
        : { id: uid('t'), name: t.name || ('Team ' + (i + 1)), emoji: t.flag || t.emoji || '', logo: t.logo || '', group: 0, colour: '' };
      byName[team.name] = team.id;
      return team;
    });

    function idFor(name) {
      if (!name) return '';
      if (byName[name]) return byName[name];
      /* A fixture referencing a team that no longer exists — keep it visible
         rather than silently dropping the match. */
      var t = { id: uid('t'), name: name, emoji: '', logo: '', group: 0, colour: '' };
      out.teams.push(t); byName[name] = t.id;
      return t.id;
    }

    out.weeks = compact(raw.weeks).map(function (w, wi) {
      return {
        id: uid('w'),
        label: w.label || ('Week ' + (wi + 1)),
        date: w.date || '',
        matches: compact(w.matches).map(function (m) {
          var mm = blankMatch(idFor(m.home), idFor(m.away), m.slot || '');
          mm.homeScore = (m.homeScore === 0 || m.homeScore) ? m.homeScore : '';
          mm.awayScore = (m.awayScore === 0 || m.awayScore) ? m.awayScore : '';
          return mm;
        })
      };
    });

    /* v1 finals slots map exactly onto the AFL-style bracket */
    var map = { semi1: 'sf1', semi2: 'sf2', prelim: 'pf', grand: 'gf' };
    out.config.finalsFormat = 'top4afl';
    out.finals = {};
    Object.keys(map).forEach(function (k) {
      var src = (raw.finals || {})[k];
      if (!src) return;
      var slot = {
        homeScore: (src.homeScore === 0 || src.homeScore) ? src.homeScore : '',
        awayScore: (src.awayScore === 0 || src.awayScore) ? src.awayScore : '',
        date: src.date || '', time: '', venue: '', status: '',
        homeOverride: '', awayOverride: '', penWinner: ''
      };
      /* v1 recorded the penalty winner by team name */
      if (src.penWinner) slot.penWinner = byName[src.penWinner] || '';
      out.finals[map[k]] = slot;
    });

    out.schema = SCHEMA;
    return normalise(out);
  }

  /* Repair anything missing/odd, whatever the source. */
  function normalise(s) {
    var st = s || {};
    st.schema = SCHEMA;
    st.title = st.title || 'OPAC Futsal';
    st.subtitle = st.subtitle || '';
    st.config = Object.assign({}, DEFAULT_CONFIG, st.config || {});
    st.config.tiebreakers = compact(st.config.tiebreakers).filter(function (k) { return TIEBREAKERS[k]; });
    if (!st.config.tiebreakers.length) st.config.tiebreakers = clone(DEFAULT_CONFIG.tiebreakers);
    st.config.slots = compact(st.config.slots);
    if (!st.config.slots.length) st.config.slots = ['Lunch 1', 'Lunch 2'];
    if (!BRACKETS[st.config.finalsFormat]) st.config.finalsFormat = 'none';

    st.teams = compact(st.teams).map(function (t, i) {
      return {
        id: t.id || uid('t'),
        name: t.name || ('Team ' + (i + 1)),
        emoji: t.emoji || '',
        logo: t.logo || '',
        group: Math.max(0, parseInt(t.group, 10) || 0),
        colour: t.colour || ''
      };
    });

    var known = {};
    st.teams.forEach(function (t) { known[t.id] = true; });

    st.weeks = compact(st.weeks).map(function (w, wi) {
      return {
        id: w.id || uid('w'),
        label: w.label || ('Week ' + (wi + 1)),
        date: w.date || '',
        matches: compact(w.matches).map(function (m) {
          return {
            id: m.id || uid('m'),
            home: known[m.home] ? m.home : (m.home || ''),
            away: known[m.away] ? m.away : (m.away || ''),
            homeScore: (m.homeScore === 0 || m.homeScore) ? m.homeScore : '',
            awayScore: (m.awayScore === 0 || m.awayScore) ? m.awayScore : '',
            slot: m.slot || '', date: m.date || '', time: m.time || '',
            venue: m.venue || '', status: m.status || '', note: m.note || '',
            penWinner: m.penWinner || '',
            type: m.type === 'bye' ? 'bye' : ''
          };
        })
      };
    });

    st.finals = st.finals && typeof st.finals === 'object' ? st.finals : {};
    Object.keys(st.finals).forEach(function (k) {
      var f = st.finals[k] || {};
      st.finals[k] = {
        homeScore: (f.homeScore === 0 || f.homeScore) ? f.homeScore : '',
        awayScore: (f.awayScore === 0 || f.awayScore) ? f.awayScore : '',
        date: f.date || '', time: f.time || '', venue: f.venue || '',
        status: f.status || '', penWinner: f.penWinner || '',
        homeOverride: f.homeOverride || '', awayOverride: f.awayOverride || ''
      };
    });
    return st;
  }

  /* ---------------------------------------------------------
     lookups & match state
     --------------------------------------------------------- */
  function teamById(state, id) {
    if (!id) return null;
    for (var i = 0; i < state.teams.length; i++) if (state.teams[i].id === id) return state.teams[i];
    return null;
  }

  function teamName(state, id, fallback) {
    var t = teamById(state, id);
    return t ? t.name : (fallback || 'TBD');
  }

  function badgeHTML(state, id, opts) {
    opts = opts || {};
    var t = teamById(state, id);
    var name = t ? t.name : (opts.fallback || 'TBD');
    var crest = '';
    if (t && t.logo) crest = '<img src="' + esc(t.logo) + '" class="crest" alt="" onerror="this.remove()">';
    else if (t && t.emoji) crest = '<span class="crest" aria-hidden="true">' + esc(t.emoji) + '</span>';
    return '<span class="tbadge">' + crest + '<span class="tname">' + esc(name) + '</span></span>';
  }

  function isPlayed(m) {
    if (!m || m.type === 'bye') return false;
    if (m.status === 'postponed') return false;
    return num(m.homeScore) !== null && num(m.awayScore) !== null;
  }

  /* 'home' | 'away' | 'draw' | null */
  function winnerSide(m) {
    if (!isPlayed(m)) return null;
    var h = num(m.homeScore), a = num(m.awayScore);
    if (h > a) return 'home';
    if (a > h) return 'away';
    return 'draw';
  }

  /* Every league match in fixture order, with its week attached. */
  function allMatches(state) {
    var out = [];
    compact(state.weeks).forEach(function (w, wi) {
      compact(w.matches).forEach(function (m, mi) {
        out.push({ match: m, week: w, wi: wi, mi: mi });
      });
    });
    return out;
  }

  /* Sort key so "next up" and results ordering respect real dates
     when they are set, and fall back to fixture order when not. */
  function matchSortKey(entry) {
    var m = entry.match, w = entry.week;
    var d = m.date || w.date || '';
    var t = m.time || '';
    return (d ? d : '9999-99-99') + 'T' + (t || '99:99') + '#' +
      String(entry.wi).padStart(4, '0') + String(entry.mi).padStart(4, '0');
  }

  /* ---------------------------------------------------------
     standings
     --------------------------------------------------------- */
  function standings(state, opts) {
    opts = opts || {};
    var cfg = state.config;
    var rows = {}, order = [];

    state.teams.forEach(function (t) {
      if (opts.group !== undefined && t.group !== opts.group) return;
      rows[t.id] = {
        id: t.id, name: t.name, group: t.group,
        played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0,
        pct: 0, form: [], byes: 0
      };
      order.push(t.id);
    });

    var entries = allMatches(state);
    var played = [];

    entries.forEach(function (e) {
      var m = e.match;
      if (m.type === 'bye') {
        if (rows[m.home]) { rows[m.home].byes++; rows[m.home].pts += cfg.pointsBye; }
        return;
      }
      if (!isPlayed(m)) return;
      var H = rows[m.home], A = rows[m.away];
      if (!H && !A) return;
      played.push(m);
      var hs = num(m.homeScore), as = num(m.awayScore);
      if (H) { H.played++; H.gf += hs; H.ga += as; }
      if (A) { A.played++; A.gf += as; A.ga += hs; }
      if (hs > as) {
        if (H) { H.won++; H.pts += cfg.pointsWin; H.form.push('W'); }
        if (A) { A.lost++; A.pts += cfg.pointsLoss; A.form.push('L'); }
      } else if (hs < as) {
        if (A) { A.won++; A.pts += cfg.pointsWin; A.form.push('W'); }
        if (H) { H.lost++; H.pts += cfg.pointsLoss; H.form.push('L'); }
      } else if (!cfg.drawsAllowed && m.penWinner && (m.penWinner === m.home || m.penWinner === m.away)) {
        /* competition has no draws — a shoot-out decided it */
        var W = rows[m.penWinner], L = rows[m.penWinner === m.home ? m.away : m.home];
        if (W) { W.won++; W.pts += cfg.pointsWin; W.form.push('W'); }
        if (L) { L.lost++; L.pts += cfg.pointsLoss; L.form.push('L'); }
      } else {
        if (H) { H.drawn++; H.pts += cfg.pointsDraw; H.form.push('D'); }
        if (A) { A.drawn++; A.pts += cfg.pointsDraw; A.form.push('D'); }
      }
    });

    var list = order.map(function (id) {
      var r = rows[id];
      r.gd = r.gf - r.ga;
      r.pct = r.ga === 0 ? (r.gf === 0 ? 0 : Infinity) : (r.gf / r.ga) * 100;
      return r;
    });

    var ctx = { matches: played, cfg: cfg };
    var chain = cfg.tiebreakers.slice();
    if (chain.indexOf('pts') !== 0) chain = ['pts'].concat(chain.filter(function (k) { return k !== 'pts'; }));
    if (chain.indexOf('name') === -1) chain.push('name');

    list.sort(function (a, b) {
      for (var i = 0; i < chain.length; i++) {
        var r = TIEBREAKERS[chain[i]].cmp(a, b, ctx);
        if (r) return r;
      }
      return 0;
    });

    list.forEach(function (r, i) { r.pos = i + 1; });
    return list;
  }

  function standingsByGroup(state) {
    var n = Math.max(1, state.config.groupCount || 1);
    if (n <= 1) return [{ name: '', index: 0, rows: standings(state) }];
    var out = [];
    for (var g = 0; g < n; g++) {
      out.push({ name: 'Group ' + (GROUP_NAMES[g] || (g + 1)), index: g, rows: standings(state, { group: g }) });
    }
    return out;
  }

  function hasAnyResult(state) {
    return allMatches(state).some(function (e) { return isPlayed(e.match); });
  }

  /* ---------------------------------------------------------
     finals resolution
     --------------------------------------------------------- */
  function bracketFor(state) { return BRACKETS[state.config.finalsFormat] || BRACKETS.none; }

  function finalResult(state, slot, resolvedHome, resolvedAway) {
    var hs = num(slot.homeScore), as = num(slot.awayScore);
    if (hs === null || as === null) return { winner: '', loser: '', decided: false };
    if (hs > as) return { winner: resolvedHome, loser: resolvedAway, decided: true };
    if (as > hs) return { winner: resolvedAway, loser: resolvedHome, decided: true };
    if (slot.penWinner) {
      return {
        winner: slot.penWinner,
        loser: slot.penWinner === resolvedHome ? resolvedAway : resolvedHome,
        decided: true, pens: true
      };
    }
    return { winner: '', loser: '', decided: false, drawn: true };
  }

  /* Returns one entry per bracket match with teams resolved from the
     ladder and from earlier results. Derived — never stored. */
  function resolveFinals(state) {
    var br = bracketFor(state);
    if (!br.rounds.length) return [];

    var groups = standingsByGroup(state);
    var overall = groups.length === 1 ? groups[0].rows : standings(state);
    var results = {};
    var out = [];

    function seedTeam(ref) {
      if (!ref) return '';
      if (ref.seed) { var r = overall[ref.seed - 1]; return r ? r.id : ''; }
      if (ref.groupSeed) {
        var g = groups[ref.groupSeed[0]];
        if (!g) return '';
        var row = g.rows[ref.groupSeed[1] - 1];
        return row ? row.id : '';
      }
      if (ref.winner) return (results[ref.winner] || {}).winner || '';
      if (ref.loser) return (results[ref.loser] || {}).loser || '';
      return '';
    }

    br.rounds.forEach(function (def) {
      var slot = state.finals[def.id] || {};
      var home = slot.homeOverride || seedTeam(def.home);
      var away = slot.awayOverride || seedTeam(def.away);
      var res = finalResult(state, slot, home, away);
      results[def.id] = res;
      out.push({
        def: def, slot: slot, id: def.id,
        home: home, away: away, result: res,
        match: {
          id: 'final_' + def.id, home: home, away: away,
          homeScore: slot.homeScore, awayScore: slot.awayScore,
          date: slot.date, time: slot.time, venue: slot.venue,
          status: slot.status, slot: '', type: ''
        }
      });
    });
    return out;
  }

  function champion(state) {
    var f = resolveFinals(state);
    if (f.length) {
      var gf = f[f.length - 1];
      /* the grand final is always the last round of every bracket */
      return gf.result.decided ? gf.result.winner : '';
    }
    if (state.config.finalsFormat === 'none') {
      var rows = standings(state);
      var complete = allMatches(state).every(function (e) { return e.match.type === 'bye' || isPlayed(e.match); });
      if (complete && rows.length && rows[0].played > 0) return rows[0].id;
    }
    return '';
  }

  function qualifierCount(state) {
    var br = bracketFor(state);
    return br.qualifiers || 0;
  }

  /* ---------------------------------------------------------
     fixture generation
     --------------------------------------------------------- */
  /* Circle method. Returns rounds of [homeId, awayId] pairs,
     inserting a bye when the team count is odd. */
  function roundRobinRounds(ids) {
    var list = ids.slice();
    var bye = null;
    if (list.length % 2 !== 0) { bye = '__BYE__'; list.push(bye); }
    var n = list.length, rounds = [], r, i;
    var fixed = list[0], rot = list.slice(1);
    for (r = 0; r < n - 1; r++) {
      var cur = [fixed].concat(rot), pairs = [];
      for (i = 0; i < n / 2; i++) {
        var h = cur[i], a = cur[n - 1 - i];
        /* alternate home/away each round so it is not always the same side */
        if (r % 2 === 1) { var tmp = h; h = a; a = tmp; }
        pairs.push([h, a]);
      }
      rounds.push(pairs);
      rot.push(rot.shift());
    }
    return rounds;
  }

  function addDays(iso, days) {
    if (!iso) return '';
    var d = new Date(iso + 'T12:00:00');
    if (isNaN(d)) return '';
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function generateFixtures(state) {
    var cfg = state.config;
    var teams = state.teams;
    if (teams.length < 2) return [];

    var perGroup = [];
    if (cfg.format === 'groups' && cfg.groupCount > 1) {
      for (var g = 0; g < cfg.groupCount; g++) {
        perGroup.push(teams.filter(function (t) { return t.group === g; }).map(function (t) { return t.id; }));
      }
    } else {
      perGroup.push(teams.map(function (t) { return t.id; }));
    }

    /* Build a flat list of pairings, round by round, interleaving groups
       so each week has a spread of games. */
    var flat = [];
    var groupRounds = perGroup.map(function (ids) { return ids.length >= 2 ? roundRobinRounds(ids) : []; });
    var maxRounds = Math.max.apply(null, groupRounds.map(function (r) { return r.length; }).concat([0]));
    var repeats = Math.max(1, Math.min(4, parseInt(cfg.rounds, 10) || 1));

    for (var rep = 0; rep < repeats; rep++) {
      for (var r = 0; r < maxRounds; r++) {
        groupRounds.forEach(function (rounds) {
          var pairs = rounds[r];
          if (!pairs) return;
          pairs.forEach(function (p) {
            var h = p[0], a = p[1];
            if (rep % 2 === 1) { var t = h; h = a; a = t; }   /* reverse fixture */
            flat.push([h, a]);
          });
        });
      }
    }

    var per = Math.max(1, parseInt(cfg.gamesPerWeek, 10) || 2);
    var weeks = [], wn = 1, idx = 0;
    while (idx < flat.length) {
      var chunk = flat.slice(idx, idx + per);
      idx += per;
      var wk = {
        id: uid('w'),
        label: (cfg.weekLabel || 'Week') + ' ' + wn,
        date: cfg.startDate ? addDays(cfg.startDate, (wn - 1) * 7) : '',
        matches: []
      };
      chunk.forEach(function (p, i) {
        if (p[0] === '__BYE__' || p[1] === '__BYE__') {
          var byeTeam = p[0] === '__BYE__' ? p[1] : p[0];
          var b = blankMatch(byeTeam, '', '');
          b.type = 'bye';
          wk.matches.push(b);
          return;
        }
        var m = blankMatch(p[0], p[1], cfg.slots[i % cfg.slots.length] || '');
        m.venue = cfg.venue || '';
        wk.matches.push(m);
      });
      weeks.push(wk);
      wn++;
    }
    return weeks;
  }

  /* ---------------------------------------------------------
     formatting
     --------------------------------------------------------- */
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fmtDate(iso, opts) {
    if (!iso) return '';
    var d = new Date(iso + 'T12:00:00');
    if (isNaN(d)) return iso;
    var s = DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    if (opts && opts.year) s += ' ' + d.getFullYear();
    return s;
  }

  function fmtTime(t) {
    if (!t) return '';
    var p = t.split(':');
    var h = parseInt(p[0], 10), m = p[1] || '00';
    if (isNaN(h)) return t;
    var ap = h >= 12 ? 'pm' : 'am';
    var hh = h % 12; if (hh === 0) hh = 12;
    return hh + (m === '00' ? '' : ':' + m) + ap;
  }

  function relTime(iso) {
    if (!iso) return '';
    var then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    var s = Math.round((Date.now() - then) / 1000);
    if (s < 45) return 'just now';
    if (s < 90) return 'a minute ago';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 7200) return 'an hour ago';
    if (s < 86400) return Math.round(s / 3600) + ' hours ago';
    return Math.round(s / 86400) + ' days ago';
  }

  /* ---------------------------------------------------------
     transport — Firebase Realtime Database over plain REST
     Live updates use RTDB's server-sent-event stream; if the
     network blocks it we drop back to polling.
     --------------------------------------------------------- */
  function dataUrl(token) {
    var base = (CFG.dbUrl || '').replace(/\/$/, '') + '/' + (CFG.path || 'futsal') + '.json';
    return token ? base + '?auth=' + encodeURIComponent(token) : base;
  }

  /* Apply an RTDB stream event to a local tree. */
  function applyAt(root, path, data) {
    var parts = String(path || '/').split('/').filter(Boolean);
    if (!parts.length) return data;
    var node = root, i;
    for (i = 0; i < parts.length - 1; i++) {
      var k = parts[i];
      if (node[k] == null || typeof node[k] !== 'object') node[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      node = node[k];
    }
    var last = parts[parts.length - 1];
    if (data === null) {
      if (Array.isArray(node)) node[last] = null; else delete node[last];
    } else {
      node[last] = data;
    }
    return root;
  }

  var Store = {
    token: null,

    read: function () {
      return fetch(dataUrl(Store.token), { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        });
    },

    write: function (state) {
      state.updatedAt = new Date().toISOString();
      return fetch(dataUrl(Store.token), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(r.status + ' ' + t); });
        return true;
      });
    },

    /* onChange(state, meta) — meta.live true while streaming */
    subscribe: function (onChange, onStatus) {
      var tree = null, es = null, pollTimer = null, closed = false, failures = 0;
      var lastEvent = 0;
      var status = function (s, d) { if (onStatus) onStatus(s, d); };

      function emit() {
        if (!tree) return;
        try { onChange(normalise(migrate(clone(tree)))); }
        catch (err) { console.error('render failed', err); }
      }

      function poll() {
        Store.read().then(function (d) {
          tree = d || {}; status('polling'); emit();
        }).catch(function () { status('offline'); });
      }

      function startPolling() {
        if (pollTimer) return;
        poll();
        pollTimer = setInterval(poll, CFG.pollInterval || 20000);
      }

      function startStream() {
        if (typeof EventSource === 'undefined') return startPolling();
        try { es = new EventSource(dataUrl(Store.token)); }
        catch (e) { return startPolling(); }

        es.addEventListener('put', function (ev) {
          var d = JSON.parse(ev.data);
          failures = 0; lastEvent = Date.now();
          if (d.path === '/') tree = d.data || {};
          else tree = applyAt(tree || {}, d.path, d.data);
          status('live'); emit();
        });

        es.addEventListener('patch', function (ev) {
          var d = JSON.parse(ev.data);
          failures = 0; lastEvent = Date.now();
          Object.keys(d.data || {}).forEach(function (k) {
            tree = applyAt(tree || {}, (d.path === '/' ? '' : d.path) + '/' + k, d.data[k]);
          });
          status('live'); emit();
        });

        es.addEventListener('keep-alive', function () { lastEvent = Date.now(); status('live'); });

        es.onerror = function () {
          if (closed) return;
          failures++;
          if (failures >= 3) {
            /* stream is not getting through — school proxies sometimes
               buffer SSE forever. Fall back to polling. */
            try { es.close(); } catch (e) {}
            es = null;
            status('offline');
            startPolling();
            return;
          }
          /* An ordinary reconnect drops an error too. Only say so if the
             data really has gone quiet, otherwise the badge flickers. */
          setTimeout(function () {
            if (closed || pollTimer) return;
            if (Date.now() - lastEvent > 6000) status('reconnecting');
          }, 6000);
        };
      }

      startStream();
      /* belt and braces: if the stream never delivers, poll anyway */
      setTimeout(function () { if (!tree && !closed) startPolling(); }, 5000);

      return function stop() {
        closed = true;
        if (es) { try { es.close(); } catch (e) {} }
        if (pollTimer) clearInterval(pollTimer);
      };
    }
  };

  /* ---------------------------------------------------------
     admin sign-in (Firebase Identity Toolkit REST — no SDK)
     --------------------------------------------------------- */
  var Auth = {
    enabled: function () { return !!CFG.apiKey; },

    signIn: function (email, password) {
      return fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + CFG.apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password, returnSecureToken: true })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error((res.body.error && res.body.error.message) || 'Sign-in failed');
          var s = {
            token: res.body.idToken,
            refresh: res.body.refreshToken,
            email: res.body.email,
            expires: Date.now() + (parseInt(res.body.expiresIn, 10) || 3600) * 1000
          };
          Auth.session = s;
          Store.token = s.token;
          try { localStorage.setItem('opac.session', JSON.stringify(s)); } catch (e) {}
          return s;
        });
    },

    restore: function () {
      try {
        var s = JSON.parse(localStorage.getItem('opac.session') || 'null');
        if (s && s.refresh) { Auth.session = s; Store.token = s.token; return s; }
      } catch (e) {}
      return null;
    },

    refresh: function () {
      if (!Auth.session || !Auth.session.refresh) return Promise.reject(new Error('no session'));
      return fetch('https://securetoken.googleapis.com/v1/token?key=' + CFG.apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(Auth.session.refresh)
      }).then(function (r) { if (!r.ok) throw new Error('refresh failed'); return r.json(); })
        .then(function (j) {
          Auth.session.token = j.id_token;
          Auth.session.refresh = j.refresh_token;
          Auth.session.expires = Date.now() + (parseInt(j.expires_in, 10) || 3600) * 1000;
          Store.token = Auth.session.token;
          try { localStorage.setItem('opac.session', JSON.stringify(Auth.session)); } catch (e) {}
          return Auth.session;
        });
    },

    valid: function () {
      return !!(Auth.session && Auth.session.token && Auth.session.expires - 60000 > Date.now());
    },

    signOut: function () {
      Auth.session = null;
      Store.token = null;
      try { localStorage.removeItem('opac.session'); } catch (e) {}
    }
  };

  /* ---------------------------------------------------------
     tiny DOM helpers used by both pages
     --------------------------------------------------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function toast(msg, kind) {
    var host = $('.toasts');
    if (!host) { host = document.createElement('div'); host.className = 'toasts'; document.body.appendChild(host); }
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.setAttribute('role', 'status');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(function () { el.remove(); }, kind === 'err' ? 6000 : 3000);
  }

  function confetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var old = $('.confetti'); if (old) old.remove();
    var c = document.createElement('div');
    c.className = 'confetti';
    c.setAttribute('aria-hidden', 'true');
    var cols = ['#00e676', '#ffd740', '#ff9100', '#ff5252', '#448aff', '#e040fb', '#69f0ae'];
    for (var i = 0; i < 110; i++) {
      var p = document.createElement('i');
      p.style.left = (Math.random() * 100) + '%';
      p.style.background = cols[Math.floor(Math.random() * cols.length)];
      var sz = Math.random() * 8 + 6;
      p.style.width = sz + 'px'; p.style.height = sz + 'px';
      p.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      p.style.animationDuration = (Math.random() * 2 + 2.2) + 's';
      p.style.animationDelay = (Math.random() * 2.5) + 's';
      c.appendChild(p);
    }
    document.body.appendChild(c);
    setTimeout(function () { c.remove(); }, 6500);
  }

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem('opac.theme'); } catch (e) {}
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    return {
      toggle: function () {
        var now = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', now);
        try { localStorage.setItem('opac.theme', now); } catch (e) {}
        return now;
      },
      current: function () { return document.documentElement.getAttribute('data-theme') || 'dark'; }
    };
  }

  /* ---------------------------------------------------------
     export
     --------------------------------------------------------- */
  function toCSV(rowsOfRows) {
    return rowsOfRows.map(function (r) {
      return r.map(function (c) {
        var s = c == null ? '' : String(c);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\n');
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  global.Futsal = {
    SCHEMA: SCHEMA,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    BRACKETS: BRACKETS,
    TIEBREAKERS: TIEBREAKERS,
    TIEBREAKER_ORDER: TIEBREAKER_ORDER,
    GROUP_NAMES: GROUP_NAMES,
    uid: uid, esc: esc, num: num, clone: clone, compact: compact,
    blankState: blankState, blankTeam: blankTeam, blankMatch: blankMatch,
    migrate: migrate, normalise: normalise,
    teamById: teamById, teamName: teamName, badgeHTML: badgeHTML,
    isPlayed: isPlayed, winnerSide: winnerSide,
    allMatches: allMatches, matchSortKey: matchSortKey,
    standings: standings, standingsByGroup: standingsByGroup, hasAnyResult: hasAnyResult,
    bracketFor: bracketFor, resolveFinals: resolveFinals, champion: champion,
    qualifierCount: qualifierCount, finalResult: finalResult,
    generateFixtures: generateFixtures, roundRobinRounds: roundRobinRounds, addDays: addDays,
    fmtDate: fmtDate, fmtTime: fmtTime, relTime: relTime,
    Store: Store, Auth: Auth,
    $: $, $$: $$, toast: toast, confetti: confetti, initTheme: initTheme,
    toCSV: toCSV, download: download
  };
})(window);
