/* ============================================================
   OPAC Futsal — admin console
   ============================================================ */
(function () {
  'use strict';

  var F = window.Futsal;
  var $ = F.$, $$ = F.$$, esc = F.esc;

  var state = null;
  var undoStack = [];
  var saveTimer = null;
  var expectedStamp = '';
  var remoteAhead = false;
  var activeTab = 'setup';
  var expanded = {};            /* match id -> details open */
  var sortable = null;

  var theme = F.initTheme();

  /* =========================================================
     state plumbing
     ========================================================= */
  function commit(mutate, opts) {
    opts = opts || {};
    undoStack.push(F.clone(state));
    if (undoStack.length > 40) undoStack.shift();
    mutate();
    $('#undoBtn').disabled = false;
    scheduleSave();
    if (opts.rerender) renderPanel(activeTab);
    else if (opts.derived !== false) refreshDerived();
  }

  function undo() {
    if (!undoStack.length) return;
    state = undoStack.pop();
    $('#undoBtn').disabled = !undoStack.length;
    scheduleSave();
    renderAll();
    F.toast('Undone');
  }

  function scheduleSave() {
    setSync('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  }

  function save() {
    clearTimeout(saveTimer);
    F.Store.write(state).then(function () {
      expectedStamp = state.updatedAt;
      remoteAhead = false;
      setSync('saved');
    }).catch(function (err) {
      setSync('error');
      var msg = String(err.message || err);
      if (/401|403|permission/i.test(msg)) {
        F.toast('Save refused — you may need to sign in again.', 'err');
      } else {
        F.toast('Could not save: ' + msg, 'err');
      }
    });
  }

  function setSync(kind) {
    var el = $('#syncStatus');
    var label = el.querySelector('.label'), dot = el.querySelector('.dot');
    el.className = 'chip'; dot.className = 'dot';
    if (kind === 'saving') { label.textContent = 'Saving'; dot.classList.add('pulse'); }
    else if (kind === 'saved') { el.classList.add('ok'); label.textContent = 'Saved'; }
    else if (kind === 'error') { el.classList.add('err'); label.textContent = 'Not saved'; }
    else if (kind === 'remote') { el.classList.add('warn'); label.textContent = 'Changed elsewhere'; }
    else { label.textContent = 'Ready'; }
  }

  /* =========================================================
     lookups
     ========================================================= */
  function findMatch(id) {
    for (var wi = 0; wi < state.weeks.length; wi++) {
      var ms = state.weeks[wi].matches;
      for (var mi = 0; mi < ms.length; mi++) {
        if (ms[mi].id === id) return { week: state.weeks[wi], wi: wi, mi: mi, match: ms[mi] };
      }
    }
    return null;
  }

  function teamOptions(selectedId, includeBlank) {
    var out = includeBlank ? '<option value="">— none —</option>' : '';
    return out + state.teams.map(function (t) {
      return '<option value="' + esc(t.id) + '"' + (t.id === selectedId ? ' selected' : '') + '>' +
        esc((t.emoji ? t.emoji + ' ' : '') + t.name) + '</option>';
    }).join('');
  }

  /* =========================================================
     SETUP panel
     ========================================================= */
  function renderSetup() {
    var c = state.config;

    var formats = [
      ['roundrobin', 'Round robin', 'Everyone plays everyone'],
      ['groups', 'Groups', 'Split into pools, then finals'],
      ['knockout', 'Knockout only', 'Straight to the bracket'],
      ['custom', 'Custom', 'You build the draw by hand']
    ];

    var usingGroups = c.format === 'groups' && (c.groupCount || 1) > 1;
    var brackets = Object.keys(F.BRACKETS).filter(function (k) {
      var b = F.BRACKETS[k];
      if (b.requiresGroups && (c.groupCount || 1) !== b.requiresGroups) return false;
      if (b.qualifiers > state.teams.length) return false;
      return true;
    }).sort(function (a, b) {
      /* when groups are on, the group-aware bracket belongs at the top */
      if (!usingGroups) return 0;
      return (F.BRACKETS[b].requiresGroups ? 1 : 0) - (F.BRACKETS[a].requiresGroups ? 1 : 0);
    });
    var sizes = F.groupSizes(state);
    var balanced = F.groupsBalanced(state);

    var br = F.BRACKETS[c.finalsFormat] || F.BRACKETS.none;

    var totalGames = countPlannedGames();

    $('#panel-setup').innerHTML =
      '<div class="stat-row">' +
        stat(state.teams.length, 'Teams') +
        stat(state.weeks.length, 'Weeks') +
        stat(state.config.slots.length, 'Games / week') +
        stat(totalGames.played + ' / ' + totalGames.total, 'Games played') +
        stat(br.qualifiers || '—', 'Finals spots') +
      '</div>' +

      '<div class="settings-grid">' +

      /* ---- format ---- */
      '<div class="settings-card">' +
        '<h3>Competition type</h3>' +
        '<p class="cap">How the draw is built. Changing this does not touch existing fixtures until you generate a new draw.</p>' +
        '<div class="field"><label>Format</label><div class="seg" data-seg="format">' +
          formats.map(function (f) {
            return '<button type="button" data-value="' + f[0] + '" aria-pressed="' + (c.format === f[0] ? 'true' : 'false') + '" title="' + esc(f[2]) + '">' + esc(f[1]) + '</button>';
          }).join('') +
        '</div></div>' +

        '<div class="row-2">' +
          '<div class="field"><label for="cfgRounds">Times each pair meets</label>' +
            '<select id="cfgRounds" data-cfg="rounds">' +
              [1, 2, 3, 4].map(function (n) {
                return '<option value="' + n + '"' + (+c.rounds === n ? ' selected' : '') + '>' +
                  (n === 1 ? 'Once' : n === 2 ? 'Twice (home & away)' : n + ' times') + '</option>';
              }).join('') +
            '</select></div>' +
          '<div class="field"><label for="cfgGroups">Groups</label>' +
            '<select id="cfgGroups" data-cfg="groupCount"' + (c.format === 'groups' ? '' : ' disabled') + '>' +
              [1, 2, 3, 4].map(function (n) {
                return '<option value="' + n + '"' + (+c.groupCount === n ? ' selected' : '') + '>' + (n === 1 ? 'No groups' : n + ' groups') + '</option>';
              }).join('') +
            '</select></div>' +
        '</div>' +

        (usingGroups
          ? '<div class="field" style="margin-top:var(--s3)"><span class="lbl">Group sizes</span>' +
              '<div class="slot-toggles">' +
                sizes.map(function (n, i) {
                  return '<span class="slot-toggle" style="cursor:default' + (n < 2 ? ';color:var(--red);border-color:var(--red)' : '') + '">' +
                    esc(F.groupLabel(i)) + ' — ' + n + ' team' + (n === 1 ? '' : 's') + '</span>';
                }).join('') +
              '</div>' +
              (balanced
                ? '<p class="hint">Each group plays its own round robin.</p>'
                : '<p class="hint" style="color:var(--orange)">These groups are uneven. ' +
                  '<button class="btn btn-secondary btn-sm" type="button" id="evenGroupsBtn" style="margin-top:6px">Split teams evenly</button></p>') +
            '</div>'
          : '') +

        '<div class="field" style="margin-top:var(--s4)">' +
          '<button class="btn btn-primary" type="button" id="genDrawBtn">⚡ Generate draw</button>' +
          '<p class="hint">Builds every fixture from the settings above. This replaces the current draw — scores are cleared.</p>' +
        '</div>' +
      '</div>' +

      /* ---- points ---- */
      '<div class="settings-card">' +
        '<h3>Points &amp; ladder</h3>' +
        '<p class="cap">The ladder recalculates instantly when you change these.</p>' +
        '<div class="row-4">' +
          numField('Win', 'pointsWin', c.pointsWin) +
          numField('Draw', 'pointsDraw', c.pointsDraw) +
          numField('Loss', 'pointsLoss', c.pointsLoss) +
          numField('Bye', 'pointsBye', c.pointsBye) +
        '</div>' +
        toggle('cfgDraws', 'drawsAllowed', c.drawsAllowed, 'Games can end in a draw',
          'Turn off and drawn games get a penalty shoot-out winner instead.') +
        toggle('cfgLadder', 'showLadder', c.showLadder, 'Show the ladder publicly') +
        toggle('cfgForm', 'showForm', c.showForm, 'Show a form guide (last 5)') +
      '</div>' +

      /* ---- tiebreakers ---- */
      '<div class="settings-card">' +
        '<h3>Separating level teams</h3>' +
        '<p class="cap">Applied in order, top first. Points always comes first.</p>' +
        '<div class="tb-list" id="tbList">' + renderTiebreakers() + '</div>' +
      '</div>' +

      /* ---- finals ---- */
      '<div class="settings-card">' +
        '<h3>Finals</h3>' +
        '<p class="cap">The bracket fills itself in from the ladder and from each result as it lands.</p>' +
        '<div class="field"><label for="cfgFinals">Finals format</label>' +
          '<select id="cfgFinals" data-cfg="finalsFormat">' +
            brackets.map(function (k) {
              return '<option value="' + k + '"' + (c.finalsFormat === k ? ' selected' : '') + '>' + esc(F.BRACKETS[k].label) + '</option>';
            }).join('') +
          '</select>' +
          '<p class="hint">' + (br.rounds.length
            ? esc(br.rounds.map(function (r) { return r.title; }).join(' → '))
            : 'The team on top of the ladder wins the competition.') + '</p>' +
        '</div>' +
        (state.teams.length < 4 ? '<p class="hint" style="color:var(--orange)">Add more teams to unlock the larger brackets.</p>' : '') +
        (usingGroups && br.rounds.length && !br.requiresGroups
          ? '<p class="hint" style="color:var(--orange)">This bracket seeds from one combined ladder, ignoring the groups. ' +
            'Pick <em>“Top 2 from each group”</em> if you want the groups to decide who qualifies.</p>'
          : '') +
      '</div>' +

      /* ---- scheduling ---- */
      '<div class="settings-card">' +
        '<h3>Scheduling</h3>' +
        '<p class="cap">Used when generating a draw. Individual games can still be edited afterwards.</p>' +
        '<div class="field"><label for="cfgStart">First week starts</label>' +
          '<input type="date" id="cfgStart" data-cfg="startDate" value="' + esc(c.startDate) + '"></div>' +
        '<div class="field" style="margin-top:var(--s3)"><span class="lbl">Game slots</span>' +
          '<div class="slot-toggles">' +
            F.SLOTS.map(function (sl) {
              var on = c.slots.indexOf(sl) >= 0;
              return '<label class="slot-toggle" data-slot-name="' + esc(sl) + '">' +
                '<input type="checkbox" data-slot="' + esc(sl) + '"' + (on ? ' checked' : '') + '>' +
                '<span>' + esc(sl) + '</span></label>';
            }).join('') +
          '</div>' +
          '<p class="hint">One game per ticked slot, so <strong>' + c.slots.length +
            ' game' + (c.slots.length === 1 ? '' : 's') + ' a week</strong>.</p>' +
        '</div>' +
        '<div class="row-2">' +
          '<div class="field"><label for="cfgWeekLabel">Week label</label>' +
            '<input type="text" id="cfgWeekLabel" data-cfg="weekLabel" value="' + esc(c.weekLabel) + '" placeholder="Week"></div>' +
          '<div class="field"><label for="cfgVenue">Venue / court</label>' +
            '<input type="text" id="cfgVenue" data-cfg="venue" value="' + esc(c.venue) + '" placeholder="Gym"></div>' +
        '</div>' +
      '</div>' +

      /* ---- privacy ---- */
      '<div class="settings-card">' +
        '<h3>Publishing</h3>' +
        '<p class="cap">Everything you enter here is visible on the public site the moment you type it.</p>' +
        '<p class="note accent" style="margin:0">Use team names only. Do not put student names in team names, notes or slot labels — this site is public.</p>' +
      '</div>' +

      '</div>';
  }

  function stat(v, k) {
    return '<div class="stat"><div class="v">' + esc(v) + '</div><div class="k">' + esc(k) + '</div></div>';
  }

  function numField(label, key, val) {
    return '<div class="field"><label for="cfg_' + key + '">' + esc(label) + '</label>' +
      '<input type="number" id="cfg_' + key + '" data-cfg="' + key + '" value="' + esc(val) + '" step="1"></div>';
  }

  function toggle(id, key, val, label, hint) {
    return '<div style="margin-top:var(--s3)"><label class="switch">' +
      '<input type="checkbox" id="' + id + '" data-cfg-bool="' + key + '"' + (val ? ' checked' : '') + '>' +
      '<span class="track"></span><span class="txt">' + esc(label) + '</span></label>' +
      (hint ? '<p class="hint" style="margin-left:50px">' + esc(hint) + '</p>' : '') + '</div>';
  }

  function renderTiebreakers() {
    var chosen = state.config.tiebreakers;
    var rest = F.TIEBREAKER_ORDER.filter(function (k) { return chosen.indexOf(k) === -1; });
    var all = chosen.concat(rest);

    return all.map(function (k, i) {
      var on = chosen.indexOf(k) >= 0;
      var rank = on ? (chosen.indexOf(k) + 1) : '';
      var locked = k === 'pts';
      return '<div class="tb-item' + (on ? '' : ' off') + '" data-tb="' + k + '">' +
        '<span class="rank">' + rank + '</span>' +
        '<label class="switch" style="gap:6px">' +
          '<input type="checkbox" data-tb-on="' + k + '"' + (on ? ' checked' : '') + (locked ? ' disabled' : '') + '>' +
          '<span class="track" style="width:32px;height:18px"></span>' +
        '</label>' +
        '<span class="tb-name">' + esc(F.TIEBREAKERS[k].label) + '</span>' +
        '<button class="mini" type="button" data-tb-up="' + k + '" aria-label="Move up"' + (!on || i === 0 ? ' disabled' : '') + '>▲</button>' +
        '<button class="mini" type="button" data-tb-down="' + k + '" aria-label="Move down"' + (!on || rank >= chosen.length ? ' disabled' : '') + '>▼</button>' +
        '</div>';
    }).join('');
  }

  function countPlannedGames() {
    var total = 0, played = 0;
    F.allMatches(state).forEach(function (e) {
      if (e.match.type === 'bye') return;
      total++;
      if (F.isPlayed(e.match)) played++;
    });
    return { total: total, played: played };
  }

  /* =========================================================
     TEAMS panel
     ========================================================= */
  function teamCard(t, i) {
    var groups = state.config.groupCount > 1;
    var prev = t.logo
      ? '<img class="prev" src="' + esc(t.logo) + '" alt="" onerror="this.style.visibility=\'hidden\'">'
      : '<span class="prev">' + esc(t.emoji || '·') + '</span>';
    return '<div class="team-edit" data-tid="' + esc(t.id) + '">' +
      '<div class="team-edit-top">' +
        '<div class="num">' + (i + 1) + '</div>' + prev +
        '<input type="text" data-team="name" value="' + esc(t.name) + '" aria-label="Team name" placeholder="Team name">' +
      '</div>' +
      '<div class="team-edit-sub"><span class="lbl">Emoji</span>' +
        '<input type="text" data-team="emoji" value="' + esc(t.emoji) + '" maxlength="8" placeholder="🇧🇷" aria-label="Team emoji"></div>' +
      '<div class="team-edit-sub"><span class="lbl">Logo URL</span>' +
        '<input type="text" data-team="logo" value="' + esc(t.logo) + '" placeholder="https://…" aria-label="Team logo URL"></div>' +
      (groups ? '<div class="team-edit-sub"><span class="lbl">Group</span><select data-team="group" aria-label="Group">' +
        Array.from({ length: state.config.groupCount }, function (_, g) {
          return '<option value="' + g + '"' + (t.group === g ? ' selected' : '') + '>' + esc(F.groupLabel(g)) + '</option>';
        }).join('') + '</select></div>' : '') +
      '<div class="team-edit-actions">' +
        '<button class="btn btn-ghost btn-sm" type="button" data-team-move="up"' + (i === 0 ? ' disabled' : '') + ' aria-label="Move up">▲</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-team-move="down"' + (i === state.teams.length - 1 ? ' disabled' : '') + ' aria-label="Move down">▼</button>' +
        '<button class="btn btn-danger btn-sm" type="button" data-team-del="1">Remove</button>' +
      '</div>' +
    '</div>';
  }

  function renderTeams() {
    var n = state.config.groupCount || 1;
    var grouped = n > 1;
    var sizes = F.groupSizes(state);

    var body;
    if (!grouped) {
      body = '<div class="grid wide">' +
        state.teams.map(function (t, i) { return teamCard(t, i); }).join('') + '</div>';
    } else {
      /* one block per group, so who is in which pool is obvious at a glance */
      body = '';
      for (var g = 0; g < n; g++) {
        var members = state.teams
          .map(function (t, i) { return { t: t, i: i }; })
          .filter(function (x) { return (x.t.group || 0) === g; });
        body +=
          '<div class="section-head">' +
            '<h2>' + esc(F.groupLabel(g)) + '</h2>' +
            '<div class="rule"></div>' +
            '<span class="aside">' + sizes[g] + ' team' + (sizes[g] === 1 ? '' : 's') + '</span>' +
          '</div>' +
          (members.length
            ? '<div class="grid wide">' + members.map(function (x) { return teamCard(x.t, x.i); }).join('') + '</div>'
            : '<div class="empty" style="padding:var(--s5)"><strong>No teams in this group yet</strong>' +
              '<p style="margin-top:6px;font-size:0.9rem">Use the Group dropdown on a team, or split them evenly.</p></div>');
      }
    }

    $('#panel-teams').innerHTML =
      '<div class="toolbar">' +
        '<label class="lbl" for="teamCount">Number of teams</label>' +
        '<div style="width:90px"><input type="number" id="teamCount" min="2" max="24" value="' + state.teams.length + '"></div>' +
        '<button class="btn btn-secondary btn-sm" type="button" id="addTeamBtn">+ Add team</button>' +
        (grouped ? '<button class="btn btn-secondary btn-sm" type="button" id="evenGroupsBtn2">⇄ Split evenly</button>' : '') +
        '<div class="grow"></div>' +
        '<button class="btn btn-secondary btn-sm" type="button" id="genDrawBtn2">⚡ Generate draw</button>' +
      '</div>' +
      (grouped && !F.groupsBalanced(state)
        ? '<p class="note danger">These groups are uneven (' +
          sizes.map(function (x, i) { return esc(F.groupLabel(i)) + ': ' + x; }).join(', ') +
          '). Hit <strong>Split evenly</strong>, or set each team\'s group by hand below.</p>'
        : '<p class="note">Rename a team at any time — every fixture, result and final follows the change automatically.</p>') +
      body;
  }

  /* =========================================================
     FIXTURES panel
     ========================================================= */
  function slotSelect(value) {
    return '<select class="slot-sel" data-field="slot" aria-label="Game slot">' +
      '<option value="">No slot</option>' +
      F.SLOTS.map(function (sl) {
        return '<option value="' + esc(sl) + '"' + (value === sl ? ' selected' : '') + '>' + esc(sl) + '</option>';
      }).join('') + '</select>';
  }

  /* Shoot-out entry. `attr` is the data-attribute the change handler
     listens on ('field' for league games, 'ffield' for finals). */
  function penBlock(m, homeId, awayId, attr) {
    var winner = F.penWinnerOf(m, homeId, awayId);
    var score = F.penSummary(m);
    var ph = F.num(m.penHome), pa = F.num(m.penAway);
    var msg;
    if (winner && score) msg = F.teamName(state, winner) + ' win ' + score + ' on penalties';
    else if (winner) msg = F.teamName(state, winner) + ' won the shoot-out';
    else if (ph !== null && pa !== null) msg = 'A shoot-out cannot finish level — change one score';
    else msg = 'Enter the shoot-out score';
    return '<div class="pen-row">' +
      '<span class="lbl">⚽ Penalties</span>' +
      '<div class="fix-score">' +
        '<input type="number" min="0" inputmode="numeric" data-' + attr + '="penHome" value="' + esc(m.penHome) + '" placeholder="–" aria-label="Home penalties" class="' + (winner && winner === homeId ? 'win' : '') + '">' +
        '<span class="dash">–</span>' +
        '<input type="number" min="0" inputmode="numeric" data-' + attr + '="penAway" value="' + esc(m.penAway) + '" placeholder="–" aria-label="Away penalties" class="' + (winner && winner === awayId ? 'win' : '') + '">' +
      '</div>' +
      '<span class="pen-msg' + (winner ? ' ok' : '') + '">' + esc(msg) + '</span>' +
      '</div>';
  }

  function fixtureRow(m, wi) {
    var isBye = m.type === 'bye';
    var win = F.winnerSide(m);
    var done = F.isPlayed(m);
    var open = !!expanded[m.id];

    if (isBye) {
      return '<div class="fix-row" data-mid="' + esc(m.id) + '" data-bye="1">' +
        '<button class="drag-handle" type="button" aria-label="Reorder">⠿</button>' +
        '<div class="fix-main" style="grid-template-columns:1fr auto">' +
          '<select class="home" data-field="home" aria-label="Team on a bye">' + teamOptions(m.home) + '</select>' +
          '<span class="lbl">Bye</span>' +
        '</div>' +
        '<span></span>' +
        '<div class="fix-tools">' +
          '<button type="button" data-act="up" aria-label="Move up">▲</button>' +
          '<button type="button" data-act="down" aria-label="Move down">▼</button>' +
          '<button type="button" data-act="del" class="del" aria-label="Remove">✕</button>' +
        '</div></div>';
    }

    var level = done && win === 'draw';
    var showPens = level && !state.config.drawsAllowed;

    var details = open ? (
      '<div class="fix-details">' +
        field('Time', '<input type="time" data-field="time" value="' + esc(m.time) + '">') +
        field('Date (overrides the week)', '<input type="date" data-field="date" value="' + esc(m.date) + '">') +
        field('Venue / court', '<input type="text" data-field="venue" value="' + esc(m.venue) + '" placeholder="Gym">') +
        field('Status', '<select data-field="status">' +
          [['', 'Scheduled'], ['live', 'Live now'], ['postponed', 'Postponed'], ['forfeit', 'Forfeit']].map(function (o) {
            return '<option value="' + o[0] + '"' + (m.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
          }).join('') + '</select>') +
        field('Move to week', '<select data-field="moveWeek">' +
          state.weeks.map(function (w, i) {
            return '<option value="' + i + '"' + (i === wi ? ' selected' : '') + '>' + esc(w.label) + '</option>';
          }).join('') + '</select>') +
        '<div class="field wide"><label>Note (shown publicly)</label>' +
          '<input type="text" data-field="note" value="' + esc(m.note) + '" placeholder="e.g. rescheduled from Week 3"></div>' +
      '</div>'
    ) : '';

    var pens = showPens ? penBlock(m, m.home, m.away, 'field') : '';

    return '<div class="fix-row" data-mid="' + esc(m.id) + '" data-done="' + (done ? 1 : 0) + '">' +
      '<button class="drag-handle" type="button" aria-label="Drag to reorder" title="Drag to reorder">⠿</button>' +
      '<div class="fix-main">' +
        '<select class="home" data-field="home" aria-label="Home team">' + teamOptions(m.home) + '</select>' +
        '<div class="fix-score">' +
          '<input type="number" min="0" inputmode="numeric" data-field="homeScore" value="' + esc(m.homeScore) + '" placeholder="–" aria-label="Home score" class="' + (win === 'home' ? 'win' : '') + '">' +
          '<span class="dash">–</span>' +
          '<input type="number" min="0" inputmode="numeric" data-field="awayScore" value="' + esc(m.awayScore) + '" placeholder="–" aria-label="Away score" class="' + (win === 'away' ? 'win' : '') + '">' +
        '</div>' +
        '<select class="away" data-field="away" aria-label="Away team">' + teamOptions(m.away) + '</select>' +
      '</div>' +
      slotSelect(m.slot) +
      '<div class="fix-tools">' +
        '<button type="button" data-act="up" aria-label="Move up">▲</button>' +
        '<button type="button" data-act="down" aria-label="Move down">▼</button>' +
        '<button type="button" data-act="expand" aria-expanded="' + (open ? 'true' : 'false') + '" aria-label="More options">⋯</button>' +
        '<button type="button" data-act="del" class="del" aria-label="Remove game">✕</button>' +
      '</div>' +
      pens + details +
      '</div>';
  }

  function field(label, control) {
    return '<label class="field"><span class="lbl">' + esc(label) + '</span>' + control + '</label>';
  }

  function renderFixtures() {
    var host = $('#panel-fixtures');

    if (!state.weeks.length) {
      host.innerHTML =
        '<div class="toolbar"><button class="btn btn-primary" type="button" id="addWeekBtn">+ Add week</button>' +
        '<button class="btn btn-secondary" type="button" id="genDrawBtn3">⚡ Generate draw</button></div>' +
        '<div class="empty"><span class="big">📅</span><strong>No fixtures yet</strong>' +
        '<p style="margin-top:6px;font-size:0.9rem">Set the competition up under <em>Setup</em>, then generate the draw.</p></div>';
      return;
    }

    host.innerHTML =
      '<div class="toolbar">' +
        '<button class="btn btn-secondary btn-sm" type="button" id="addWeekBtn">+ Add week</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" id="expandAllBtn">Show all details</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" id="collapseAllBtn">Hide details</button>' +
        '<div class="grow"></div>' +
        '<button class="btn btn-danger btn-sm" type="button" id="clearScoresBtn">Clear all scores</button>' +
      '</div>' +
      '<p class="note">Drag <span class="kbd">⠿</span> to reorder a game inside a week — or straight into another week. ' +
      'The <span class="kbd">▲▼</span> buttons do the same thing from the keyboard.</p>' +
      '<div id="weeksHost">' + state.weeks.map(function (w, wi) {
        return '<div class="week-card" data-wi="' + wi + '">' +
          '<div class="week-head">' +
            '<input class="week-title-input" data-week="label" value="' + esc(w.label) + '" aria-label="Week name">' +
            '<input class="date-input" type="date" data-week="date" value="' + esc(w.date) + '" aria-label="Week date">' +
            '<div class="tools">' +
              '<button class="btn btn-ghost btn-sm" type="button" data-week-act="add">+ Game</button>' +
              '<button class="btn btn-ghost btn-sm" type="button" data-week-act="bye">+ Bye</button>' +
              '<button class="btn btn-ghost btn-sm" type="button" data-week-act="up"' + (wi === 0 ? ' disabled' : '') + ' aria-label="Move week up">▲</button>' +
              '<button class="btn btn-ghost btn-sm" type="button" data-week-act="down"' + (wi === state.weeks.length - 1 ? ' disabled' : '') + ' aria-label="Move week down">▼</button>' +
              '<button class="btn btn-danger btn-sm" type="button" data-week-act="del">Delete week</button>' +
            '</div>' +
          '</div>' +
          '<div class="match-list" data-wi="' + wi + '">' +
            w.matches.map(function (m) { return fixtureRow(m, wi); }).join('') +
          '</div>' +
        '</div>';
      }).join('') + '</div>';

    initSortable();
  }

  function initSortable() {
    if (sortable) sortable.destroy();
    var host = $('#weeksHost');
    if (!host) return;
    sortable = window.makeSortable({
      root: host,
      list: '.match-list',
      item: '.fix-row',
      handle: '.drag-handle',
      onDrop: function (d) {
        var from = +d.fromList.dataset.wi;
        var to = +d.toList.dataset.wi;
        commit(function () {
          var m = state.weeks[from].matches.splice(d.fromIndex, 1)[0];
          state.weeks[to].matches.splice(d.toIndex, 0, m);
        }, { rerender: true });
        F.toast(from === to ? 'Game moved' : 'Game moved to ' + state.weeks[to].label);
      }
    });
  }

  /* =========================================================
     LADDER panel
     ========================================================= */
  function renderLadderPanel() {
    var groups = F.standingsByGroup(state);
    var q = F.qualifierCount(state);
    var cfg = state.config;

    var html = groups.map(function (g) {
      if (!g.rows.length) return '';
      var body = g.rows.map(function (r, i) {
        var cls = [];
        if (q && i < (groups.length > 1 ? Math.ceil(q / groups.length) : q)) cls.push('qualified');
        cls.push('pos-' + (i + 1));
        var form = cfg.showForm
          ? '<td><span class="form-guide">' + (r.form.slice(-5).map(function (x) { return '<i class="' + x + '">' + x + '</i>'; }).join('') || '–') + '</span></td>'
          : '';
        return '<tr class="' + cls.join(' ') + '"><td class="pos">' + (i + 1) + '</td>' +
          '<td class="team left">' + F.badgeHTML(state, r.id) + '</td>' +
          '<td>' + r.played + '</td><td>' + r.won + '</td><td>' + r.drawn + '</td><td>' + r.lost + '</td>' +
          '<td>' + r.gf + '</td><td>' + r.ga + '</td><td>' + (r.gd > 0 ? '+' : '') + r.gd + '</td>' +
          form + '<td class="pts">' + r.pts + '</td></tr>';
      }).join('');

      return (g.name ? '<div class="section-head"><h2>' + esc(g.name) + '</h2><div class="rule"></div></div>' : '') +
        '<div class="table-wrap"><table class="ladder"><thead><tr>' +
        '<th class="left">#</th><th class="left">Team</th><th>P</th><th>W</th><th>D</th><th>L</th>' +
        '<th>GF</th><th>GA</th><th>GD</th>' + (cfg.showForm ? '<th>Form</th>' : '') + '<th>Pts</th>' +
        '</tr></thead><tbody>' + body + '</tbody></table></div>';
    }).join('');

    $('#panel-ladder').innerHTML = (html || '<div class="empty"><span class="big">📊</span><strong>No teams yet</strong></div>') +
      '<div class="legend">' +
        (q ? '<span><i class="sw"></i> Top ' + q + ' make the finals</span>' : '') +
        '<span>' + cfg.pointsWin + ' / ' + cfg.pointsDraw + ' / ' + cfg.pointsLoss + ' points</span>' +
        '<span>Separated by: ' + esc(cfg.tiebreakers.map(function (k) { return F.TIEBREAKERS[k].label; }).join(' → ')) + '</span>' +
      '</div>' +
      '<p class="note" style="margin-top:var(--s4)">The ladder is calculated, not stored — fix a score and it updates everywhere at once.</p>';
  }

  /* =========================================================
     FINALS panel
     ========================================================= */
  function renderFinalsPanel() {
    var host = $('#panel-finals');
    var br = F.bracketFor(state);

    if (!br.rounds.length) {
      host.innerHTML = '<div class="empty"><span class="big">🏆</span><strong>No finals series</strong>' +
        '<p style="margin-top:6px;font-size:0.9rem">Pick a finals format under <em>Setup</em> if you want one.</p></div>';
      return;
    }

    var finals = F.resolveFinals(state);

    host.innerHTML =
      '<p class="note">Match-ups fill in automatically from the ladder and from earlier finals. ' +
      'Use <em>Set manually</em> only if you need to override one.</p>' +
      finals.map(function (f) {
        var m = f.slot;
        var hs = F.num(m.homeScore), as = F.num(m.awayScore);
        var level = hs !== null && as !== null && hs === as;
        var winSide = hs === null || as === null ? null : hs > as ? 'home' : as > hs ? 'away' : 'draw';

        return '<div class="final-edit" data-fid="' + esc(f.id) + '" data-tier="' + esc(f.def.tier) + '">' +
          '<h3>' + esc(f.def.title) + '</h3>' +
          '<p class="cap">' + esc(f.def.sub || '') + '</p>' +
          '<div class="fix-main">' +
            '<div class="slot-team">' + F.badgeHTML(state, f.home) + '</div>' +
            '<div class="fix-score">' +
              '<input type="number" min="0" data-ffield="homeScore" value="' + esc(m.homeScore) + '" placeholder="–" aria-label="Home score" class="' + (winSide === 'home' ? 'win' : '') + '">' +
              '<span class="dash">–</span>' +
              '<input type="number" min="0" data-ffield="awayScore" value="' + esc(m.awayScore) + '" placeholder="–" aria-label="Away score" class="' + (winSide === 'away' ? 'win' : '') + '">' +
            '</div>' +
            '<div class="slot-team away">' + F.badgeHTML(state, f.away) + '</div>' +
          '</div>' +

          (level ? penBlock(m, f.home, f.away, 'ffield') : '') +

          '<div class="fix-details" style="border-top-color:var(--border)">' +
            field('Date', '<input type="date" data-ffield="date" value="' + esc(m.date) + '">') +
            field('Time', '<input type="time" data-ffield="time" value="' + esc(m.time) + '">') +
            field('Venue', '<input type="text" data-ffield="venue" value="' + esc(m.venue) + '" placeholder="Gym">') +
            field('Set home manually', '<select data-ffield="homeOverride">' + teamOptions(m.homeOverride, true) + '</select>') +
            field('Set away manually', '<select data-ffield="awayOverride">' + teamOptions(m.awayOverride, true) + '</select>') +
          '</div>' +
        '</div>';
      }).join('') +
      (function () {
        var champ = F.champion(state);
        return champ ? '<div class="champion"><span class="crown">🏆</span><h2>' + F.badgeHTML(state, champ) + '</h2><p class="sub">Champions</p></div>' : '';
      })();
  }

  /* =========================================================
     EXPORT panel
     ========================================================= */
  function renderExport() {
    $('#panel-export').innerHTML =
      '<div class="settings-grid">' +
        '<div class="settings-card">' +
          '<h3>Download</h3>' +
          '<p class="cap">Take the competition away as a spreadsheet, or print it for the noticeboard.</p>' +
          '<div class="toolbar" style="margin:0">' +
            '<button class="btn btn-primary btn-sm" type="button" id="xlsxBtn">⬇ Excel workbook</button>' +
            '<button class="btn btn-secondary btn-sm" type="button" id="csvBtn">⬇ CSV</button>' +
            '<button class="btn btn-secondary btn-sm" type="button" id="printBtn">🖨 Print</button>' +
          '</div>' +
        '</div>' +
        '<div class="settings-card">' +
          '<h3>Backup &amp; restore</h3>' +
          '<p class="cap">A JSON backup captures everything — teams, draw, scores and settings. Worth taking before you regenerate a draw.</p>' +
          '<div class="toolbar" style="margin:0">' +
            '<button class="btn btn-secondary btn-sm" type="button" id="backupBtn">⬇ Download backup</button>' +
            '<label class="btn btn-secondary btn-sm" for="restoreFile" style="cursor:pointer">⬆ Restore from file</label>' +
            '<input type="file" id="restoreFile" accept="application/json,.json" hidden>' +
          '</div>' +
        '</div>' +
        '<div class="settings-card danger-zone">' +
          '<h3 style="color:var(--red)">Danger zone</h3>' +
          '<p class="cap">These wipe live data for everyone looking at the public site.</p>' +
          '<div class="toolbar" style="margin:0">' +
            '<button class="btn btn-danger btn-sm" type="button" id="clearFixturesBtn">Delete all fixtures</button>' +
            '<button class="btn btn-danger btn-sm" type="button" id="resetBtn">Reset everything</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* =========================================================
     export helpers
     ========================================================= */
  function tableRows() {
    var out = [['#', 'Emoji', 'Team', 'P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts']];
    F.standings(state).forEach(function (r, i) {
      var t = F.teamById(state, r.id) || {};
      out.push([i + 1, t.emoji || '', r.name, r.played, r.won, r.drawn, r.lost, r.gf, r.ga, r.gd, r.pts]);
    });
    return out;
  }

  function fixtureRows() {
    var out = [['Week', 'Date', 'Slot', 'Venue', 'Home', 'Home score', 'Away score', 'Away', 'Penalties', 'Status', 'Note']];
    F.allMatches(state).forEach(function (e) {
      var m = e.match;
      out.push([
        e.week.label, m.date || e.week.date || '', m.slot || '', m.venue || '',
        m.type === 'bye' ? F.teamName(state, m.home) + ' (bye)' : F.teamName(state, m.home),
        m.homeScore === '' ? '' : m.homeScore,
        m.awayScore === '' ? '' : m.awayScore,
        m.type === 'bye' ? '' : F.teamName(state, m.away),
        F.penSummary(m),
        m.status || (F.isPlayed(m) ? 'final' : 'scheduled'),
        m.note || ''
      ]);
    });
    return out;
  }

  function finalsRows() {
    var out = [['Match', 'Date', 'Home', 'Home score', 'Away score', 'Away', 'Penalties', 'Winner']];
    F.resolveFinals(state).forEach(function (f) {
      out.push([
        f.def.title, f.slot.date || '',
        F.teamName(state, f.home), f.slot.homeScore === '' ? '' : f.slot.homeScore,
        f.slot.awayScore === '' ? '' : f.slot.awayScore, F.teamName(state, f.away),
        F.penSummary(f.slot),
        f.result.decided ? F.teamName(state, f.result.winner) : ''
      ]);
    });
    return out;
  }

  function safeName() {
    return (state.title || 'Futsal').replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '_') || 'Futsal';
  }

  /* SheetJS is fetched only when someone actually asks for a workbook, so a
     school network that blocks the CDN cannot break the rest of the page. */
  var xlsxPromise = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxPromise) return xlsxPromise;
    xlsxPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = function () { window.XLSX ? resolve(window.XLSX) : reject(new Error('loaded but empty')); };
      s.onerror = function () { xlsxPromise = null; reject(new Error('blocked')); };
      document.head.appendChild(s);
    });
    return xlsxPromise;
  }

  function exportXLSX() {
    F.toast('Building the workbook…');
    loadXLSX().then(buildXLSX).catch(function () {
      F.toast('The spreadsheet library could not be downloaded on this network — use CSV instead.', 'err');
    });
  }

  function buildXLSX() {
    var wb = XLSX.utils.book_new();
    var s1 = XLSX.utils.aoa_to_sheet(tableRows());
    s1['!cols'] = [{ wch: 4 }, { wch: 6 }, { wch: 22 }].concat(Array(8).fill({ wch: 6 }));
    XLSX.utils.book_append_sheet(wb, s1, 'Ladder');

    var s2 = XLSX.utils.aoa_to_sheet(fixtureRows());
    s2['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 11 }, { wch: 11 }, { wch: 20 }, { wch: 11 }, { wch: 11 }, { wch: 26 }];
    XLSX.utils.book_append_sheet(wb, s2, 'Fixtures & results');

    if (F.bracketFor(state).rounds.length) {
      var s3 = XLSX.utils.aoa_to_sheet(finalsRows());
      s3['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 20 }, { wch: 11 }, { wch: 11 }, { wch: 20 }, { wch: 11 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, s3, 'Finals');
    }
    XLSX.writeFile(wb, safeName() + '.xlsx');
  }

  function exportCSV() {
    var rows = [[state.title], [state.subtitle], [], ['LADDER']]
      .concat(tableRows(), [[], ['FIXTURES & RESULTS']], fixtureRows());
    if (F.bracketFor(state).rounds.length) rows = rows.concat([[], ['FINALS']], finalsRows());
    F.download(safeName() + '.csv', F.toCSV(rows), 'text/csv;charset=utf-8');
  }

  /* =========================================================
     event wiring
     ========================================================= */
  function wire() {
    /* --- header --- */
    $('#compTitle').addEventListener('change', function () {
      commit(function () { state.title = this.value.trim() || 'OPAC Futsal'; }.bind(this));
    });
    $('#compSub').addEventListener('change', function () {
      commit(function () { state.subtitle = this.value.trim(); }.bind(this));
    });
    $('#undoBtn').addEventListener('click', undo);
    $('#themeBtn').addEventListener('click', function () { theme.toggle(); });
    $('#signOutBtn').addEventListener('click', function () {
      F.Auth.signOut();
      location.reload();
    });

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        var t = e.target.tagName;
        if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
        e.preventDefault(); undo();
      }
    });

    /* --- tabs --- */
    var btns = $$('.tab-btn');
    btns.forEach(function (b) {
      b.addEventListener('click', function () { showTab(b.dataset.tab); });
      b.addEventListener('keydown', function (e) {
        var i = btns.indexOf(b), next = null;
        if (e.key === 'ArrowRight') next = btns[(i + 1) % btns.length];
        if (e.key === 'ArrowLeft') next = btns[(i - 1 + btns.length) % btns.length];
        if (next) { e.preventDefault(); next.focus(); showTab(next.dataset.tab); }
      });
    });

    wireSetup();
    wireTeams();
    wireFixtures();
    wireFinals();
    wireExport();
  }

  /* ---------- setup ---------- */
  function wireSetup() {
    var panel = $('#panel-setup');

    panel.addEventListener('click', function (e) {
      var seg = e.target.closest('[data-seg] button');
      if (seg) {
        var key = seg.closest('[data-seg]').dataset.seg;
        commit(function () {
          state.config[key] = seg.dataset.value;
          if (key === 'format') {
            if (state.config.format === 'groups') {
              /* "Groups" with one group is meaningless — start at two and
                 actually split the teams, otherwise nothing appears to happen. */
              if ((state.config.groupCount || 1) < 2) state.config.groupCount = 2;
              F.assignGroups(state);
              var br = F.BRACKETS[state.config.finalsFormat];
              if (br && br.rounds.length && !br.requiresGroups) {
                var fit = Object.keys(F.BRACKETS).filter(function (k) {
                  return F.BRACKETS[k].requiresGroups === state.config.groupCount;
                })[0];
                if (fit) { state.config.finalsFormat = fit; pruneFinals(); }
              }
            } else {
              state.config.groupCount = 1;
              F.assignGroups(state);
            }
          }
        }, { rerender: true });
        return;
      }

      if (e.target.id === 'genDrawBtn') { generateDraw(); return; }

      if (e.target.id === 'evenGroupsBtn' || e.target.id === 'evenGroupsBtn2') {
        commit(function () { F.assignGroups(state); }, { rerender: true });
        F.toast('Teams split evenly across the groups');
        return;
      }

      var up = e.target.closest('[data-tb-up]');
      var down = e.target.closest('[data-tb-down]');
      if (up || down) {
        var k = (up || down).dataset[up ? 'tbUp' : 'tbDown'];
        commit(function () {
          var list = state.config.tiebreakers, i = list.indexOf(k);
          var j = up ? i - 1 : i + 1;
          if (i < 0 || j < 0 || j >= list.length) return;
          list.splice(j, 0, list.splice(i, 1)[0]);
        }, { rerender: true });
      }
    });

    panel.addEventListener('change', function (e) {
      var t = e.target;

      if (t.dataset.cfgBool) {
        commit(function () { state.config[t.dataset.cfgBool] = t.checked; }, { rerender: true });
        return;
      }

      if (t.dataset.slot) {
        commit(function () {
          var want = {};
          state.config.slots.forEach(function (x) { want[x] = true; });
          want[t.dataset.slot] = t.checked;
          var next = F.SLOTS.filter(function (x) { return want[x]; });
          if (!next.length) next = [t.dataset.slot];   /* never leave zero slots */
          state.config.slots = next;
        }, { rerender: true });
        return;
      }

      if (t.dataset.tbOn) {
        var k = t.dataset.tbOn;
        commit(function () {
          var list = state.config.tiebreakers, i = list.indexOf(k);
          if (t.checked && i < 0) list.push(k);
          if (!t.checked && i >= 0) list.splice(i, 1);
          if (!list.length) list.push('pts');
        }, { rerender: true });
        return;
      }

      var key = t.dataset.cfg;
      if (!key) return;
      commit(function () {
        if (['rounds', 'groupCount', 'pointsWin', 'pointsDraw', 'pointsLoss', 'pointsBye'].indexOf(key) >= 0) {
          state.config[key] = parseInt(t.value, 10) || 0;
        } else {
          state.config[key] = t.value;
        }
        if (key === 'groupCount') {
          F.assignGroups(state);
          var brk = F.BRACKETS[state.config.finalsFormat];
          if (brk && brk.requiresGroups && brk.requiresGroups !== state.config.groupCount) {
            state.config.finalsFormat = 'none';
            pruneFinals();
          }
        }
        if (key === 'finalsFormat') pruneFinals();
      }, { rerender: true });
    });
  }

  function pruneFinals() {
    var ids = {};
    F.bracketFor(state).rounds.forEach(function (r) { ids[r.id] = true; });
    Object.keys(state.finals).forEach(function (k) { if (!ids[k]) delete state.finals[k]; });
  }

  function generateDraw() {
    var hasScores = F.allMatches(state).some(function (e) { return F.isPlayed(e.match); });
    var msg = hasScores
      ? 'This replaces the whole draw and clears every score already entered. Download a backup first if you are not sure.\n\nGenerate a new draw?'
      : 'Generate the full draw from your settings?';
    if (!confirm(msg)) return;

    commit(function () {
      state.weeks = F.generateFixtures(state);
      state.finals = {};
    }, { rerender: true });

    showTab('fixtures');
    F.toast(state.weeks.length + ' weeks generated');
  }

  /* ---------- teams ---------- */
  function wireTeams() {
    var panel = $('#panel-teams');

    panel.addEventListener('click', function (e) {
      if (e.target.id === 'addTeamBtn') {
        commit(function () { state.teams.push(F.blankTeam(state.teams.length)); }, { rerender: true });
        return;
      }
      if (e.target.id === 'genDrawBtn2') { generateDraw(); return; }
      if (e.target.id === 'evenGroupsBtn2') {
        commit(function () { F.assignGroups(state); }, { rerender: true });
        F.toast('Teams split evenly across the groups');
        return;
      }

      var card = e.target.closest('[data-tid]');
      if (!card) return;
      var id = card.dataset.tid;
      var idx = state.teams.findIndex(function (t) { return t.id === id; });

      if (e.target.dataset.teamDel) {
        var t = state.teams[idx];
        var used = F.allMatches(state).some(function (en) { return en.match.home === id || en.match.away === id; });
        if (!confirm('Remove ' + t.name + '?' + (used ? '\n\nThey appear in the draw — those fixtures will be left with an empty slot.' : ''))) return;
        commit(function () { state.teams.splice(idx, 1); }, { rerender: true });
        return;
      }

      var mv = e.target.dataset.teamMove;
      if (mv) {
        var j = mv === 'up' ? idx - 1 : idx + 1;
        if (j < 0 || j >= state.teams.length) return;
        commit(function () { state.teams.splice(j, 0, state.teams.splice(idx, 1)[0]); }, { rerender: true });
      }
    });

    panel.addEventListener('change', function (e) {
      var t = e.target;

      if (t.id === 'teamCount') {
        var n = Math.max(2, Math.min(24, parseInt(t.value, 10) || 2));
        commit(function () {
          while (state.teams.length < n) state.teams.push(F.blankTeam(state.teams.length));
          if (state.teams.length > n) {
            if (!confirm('Remove the last ' + (state.teams.length - n) + ' team(s)?')) { n = state.teams.length; }
            state.teams.length = n;
          }
        }, { rerender: true });
        return;
      }

      var card = t.closest('[data-tid]');
      if (!card || !t.dataset.team) return;
      var id = card.dataset.tid;
      var team = state.teams.find(function (x) { return x.id === id; });
      if (!team) return;

      var f = t.dataset.team;
      commit(function () {
        if (f === 'group') team.group = parseInt(t.value, 10) || 0;
        else if (f === 'name') team.name = t.value.trim() || team.name;
        else team[f] = t.value.trim();
      }, { rerender: f !== 'name' ? true : false });

    });
  }

  /* ---------- fixtures ---------- */
  function wireFixtures() {
    var panel = $('#panel-fixtures');

    panel.addEventListener('click', function (e) {
      if (e.target.id === 'addWeekBtn') { addWeek(); return; }
      if (e.target.id === 'genDrawBtn3') { generateDraw(); return; }
      if (e.target.id === 'expandAllBtn') {
        F.allMatches(state).forEach(function (en) { expanded[en.match.id] = true; });
        renderPanel('fixtures'); return;
      }
      if (e.target.id === 'collapseAllBtn') { expanded = {}; renderPanel('fixtures'); return; }
      if (e.target.id === 'clearScoresBtn') {
        if (!confirm('Clear every score in the competition? The draw itself stays.')) return;
        commit(function () {
          F.allMatches(state).forEach(function (en) {
            en.match.homeScore = ''; en.match.awayScore = '';
            en.match.penWinner = ''; en.match.penHome = ''; en.match.penAway = '';
          });
          Object.keys(state.finals).forEach(function (k) {
            state.finals[k].homeScore = ''; state.finals[k].awayScore = '';
            state.finals[k].penWinner = ''; state.finals[k].penHome = ''; state.finals[k].penAway = '';
          });
        }, { rerender: true });
        F.toast('Scores cleared');
        return;
      }

      /* week-level */
      var wact = e.target.dataset.weekAct;
      if (wact) {
        var wi = +e.target.closest('[data-wi]').dataset.wi;
        if (wact === 'add') {
          commit(function () {
            var w = state.weeks[wi];
            var slot = state.config.slots[w.matches.length % state.config.slots.length] || '';
            w.matches.push(F.blankMatch(state.teams[0] ? state.teams[0].id : '', state.teams[1] ? state.teams[1].id : '', slot));
          }, { rerender: true });
        } else if (wact === 'bye') {
          commit(function () {
            var m = F.blankMatch(state.teams[0] ? state.teams[0].id : '', '', '');
            m.type = 'bye';
            state.weeks[wi].matches.push(m);
          }, { rerender: true });
        } else if (wact === 'del') {
          if (!confirm('Delete "' + state.weeks[wi].label + '" and its ' + state.weeks[wi].matches.length + ' game(s)?')) return;
          commit(function () { state.weeks.splice(wi, 1); }, { rerender: true });
        } else if (wact === 'up' || wact === 'down') {
          var j = wact === 'up' ? wi - 1 : wi + 1;
          if (j < 0 || j >= state.weeks.length) return;
          commit(function () { state.weeks.splice(j, 0, state.weeks.splice(wi, 1)[0]); }, { rerender: true });
        }
        return;
      }

      /* match-level */
      var row = e.target.closest('[data-mid]');
      if (!row) return;
      var loc = findMatch(row.dataset.mid);
      if (!loc) return;

      var act = e.target.dataset.act;
      if (act === 'expand') {
        expanded[loc.match.id] = !expanded[loc.match.id];
        renderPanel('fixtures');
        return;
      }
      if (act === 'del') {
        commit(function () { loc.week.matches.splice(loc.mi, 1); }, { rerender: true });
        return;
      }
      if (act === 'up' || act === 'down') {
        var k = act === 'up' ? loc.mi - 1 : loc.mi + 1;
        if (k < 0 || k >= loc.week.matches.length) {
          /* at the edge — hop into the neighbouring week */
          var wIdx = state.weeks.indexOf(loc.week);
          var target = act === 'up' ? wIdx - 1 : wIdx + 1;
          if (target < 0 || target >= state.weeks.length) return;
          commit(function () {
            var m = loc.week.matches.splice(loc.mi, 1)[0];
            if (act === 'up') state.weeks[target].matches.push(m);
            else state.weeks[target].matches.unshift(m);
          }, { rerender: true });
          F.toast('Moved to ' + state.weeks[target].label);
          return;
        }
        commit(function () {
          loc.week.matches.splice(k, 0, loc.week.matches.splice(loc.mi, 1)[0]);
        }, { rerender: true });
      }
    });

    /* live win highlighting without committing on every keystroke */
    panel.addEventListener('input', function (e) {
      var f = e.target.dataset.field;
      if (f !== 'homeScore' && f !== 'awayScore') return;
      var row = e.target.closest('.fix-row');
      var inputs = row.querySelectorAll('[data-field$="Score"]');
      var h = F.num(inputs[0].value), a = F.num(inputs[1].value);
      inputs[0].classList.toggle('win', h !== null && a !== null && h > a);
      inputs[1].classList.toggle('win', h !== null && a !== null && a > h);
    });

    panel.addEventListener('change', function (e) {
      var t = e.target;

      var wfield = t.dataset.week;
      if (wfield) {
        var wi = +t.closest('[data-wi]').dataset.wi;
        commit(function () { state.weeks[wi][wfield] = t.value; });
        return;
      }

      var f = t.dataset.field;
      if (!f) return;
      var row = t.closest('[data-mid]');
      var loc = findMatch(row.dataset.mid);
      if (!loc) return;

      if (f === 'moveWeek') {
        var to = parseInt(t.value, 10);
        if (to === state.weeks.indexOf(loc.week)) return;
        commit(function () {
          var m = loc.week.matches.splice(loc.mi, 1)[0];
          state.weeks[to].matches.push(m);
        }, { rerender: true });
        F.toast('Moved to ' + state.weeks[to].label);
        return;
      }

      var numeric = ['homeScore', 'awayScore', 'penHome', 'penAway'];
      var structural = numeric.indexOf(f) >= 0 || f === 'home' || f === 'away';
      commit(function () {
        if (numeric.indexOf(f) >= 0) {
          loc.match[f] = t.value === '' ? '' : Math.max(0, parseInt(t.value, 10) || 0);
          /* a shoot-out only exists while the game is level */
          if ((f === 'homeScore' || f === 'awayScore') &&
              F.num(loc.match.homeScore) !== F.num(loc.match.awayScore)) {
            loc.match.penHome = ''; loc.match.penAway = ''; loc.match.penWinner = '';
          }
        } else if (f === 'slot') {
          loc.match.slot = F.normaliseSlot(t.value);
        } else {
          loc.match[f] = t.value;
        }
      }, { rerender: structural });
    });
  }

  function addWeek() {
    commit(function () {
      var n = state.weeks.length;
      var last = state.weeks[n - 1];
      state.weeks.push({
        id: F.uid('w'),
        label: (state.config.weekLabel || 'Week') + ' ' + (n + 1),
        date: last && last.date ? F.addDays(last.date, 7) : (state.config.startDate || ''),
        matches: []
      });
    }, { rerender: true });
  }

  /* ---------- finals ---------- */
  function wireFinals() {
    var panel = $('#panel-finals');

    function slotFor(id) {
      if (!state.finals[id]) {
        state.finals[id] = {
          homeScore: '', awayScore: '', date: '', time: '', venue: '',
          status: '', penWinner: '', penHome: '', penAway: '',
          homeOverride: '', awayOverride: ''
        };
      }
      return state.finals[id];
    }

    panel.addEventListener('change', function (e) {
      var f = e.target.dataset.ffield;
      if (!f) return;
      var id = e.target.closest('[data-fid]').dataset.fid;
      var v = e.target.value;
      var numeric = ['homeScore', 'awayScore', 'penHome', 'penAway'];
      commit(function () {
        var slot = slotFor(id);
        if (numeric.indexOf(f) >= 0) {
          slot[f] = v === '' ? '' : Math.max(0, parseInt(v, 10) || 0);
          if ((f === 'homeScore' || f === 'awayScore') &&
              F.num(slot.homeScore) !== F.num(slot.awayScore)) {
            slot.penHome = ''; slot.penAway = ''; slot.penWinner = '';
          }
        } else {
          slot[f] = v;
        }
      }, { rerender: true });
    });
  }

  /* ---------- export ---------- */
  function wireExport() {
    var panel = $('#panel-export');

    panel.addEventListener('click', function (e) {
      var id = e.target.id;
      if (id === 'xlsxBtn') exportXLSX();
      else if (id === 'csvBtn') exportCSV();
      else if (id === 'printBtn') window.print();
      else if (id === 'backupBtn') {
        F.download(safeName() + '_backup_' + new Date().toISOString().slice(0, 10) + '.json',
          JSON.stringify(state, null, 2), 'application/json');
      } else if (id === 'clearFixturesBtn') {
        if (!confirm('Delete every week and game? Teams and settings stay.')) return;
        commit(function () { state.weeks = []; state.finals = {}; }, { rerender: true });
        F.toast('Fixtures deleted');
      } else if (id === 'resetBtn') {
        if (!confirm('Reset EVERYTHING — teams, draw, scores and settings — back to a blank competition?')) return;
        if (!confirm('Last check: this cannot be undone once the page is closed. Continue?')) return;
        commit(function () {
          var t = state.title, s = state.subtitle;
          state = F.blankState(6);
          state.title = t; state.subtitle = s;
        }, { rerender: true });
        renderAll();
        F.toast('Reset');
      }
    });

    panel.addEventListener('change', function (e) {
      if (e.target.id !== 'restoreFile') return;
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = JSON.parse(reader.result);
          var restored = F.normalise(F.migrate(parsed));
          if (!restored.teams.length) throw new Error('no teams in that file');
          if (!confirm('Replace the live competition with "' + (restored.title || 'backup') + '" (' +
            restored.teams.length + ' teams, ' + restored.weeks.length + ' weeks)?')) return;
          commit(function () { state = restored; }, { rerender: true });
          renderAll();
          F.toast('Backup restored');
        } catch (err) {
          F.toast('That file could not be read: ' + err.message, 'err');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  }

  /* =========================================================
     render orchestration
     ========================================================= */
  function showTab(name) {
    activeTab = name;
    $$('.tab-btn').forEach(function (b) {
      var on = b.dataset.tab === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    $$('.tab-panel').forEach(function (p) { p.hidden = p.id !== 'panel-' + name; });
    renderPanel(name);
    try { window.history.replaceState(null, '', '#' + name); } catch (e) {}
  }

  /* Panels are redrawn wholesale, so remember where the caret was
     and put it back — otherwise entering scores kicks you out of the
     field on every keystroke-ending change. */
  function captureFocus() {
    var el = document.activeElement;
    if (!el || el === document.body) return null;
    var panel = el.closest('.tab-panel');
    if (!panel) return null;

    var d = {};
    try { if (el.selectionStart != null) { d.s = el.selectionStart; d.e = el.selectionEnd; } } catch (err) {}

    if (el.id) { d.sel = '#' + el.id; return d; }

    var scope = '';
    var row = el.closest('[data-mid]');
    if (row) scope = '[data-mid="' + row.dataset.mid + '"] ';
    else {
      var team = el.closest('[data-tid]');
      if (team) scope = '[data-tid="' + team.dataset.tid + '"] ';
      else {
        var fin = el.closest('[data-fid]');
        if (fin) scope = '[data-fid="' + fin.dataset.fid + '"] ';
        else {
          var wk = el.closest('.week-card');
          if (wk) scope = '.week-card[data-wi="' + wk.dataset.wi + '"] ';
        }
      }
    }

    var attrs = ['field', 'act', 'team', 'teamMove', 'ffield', 'fpen', 'week', 'weekAct', 'cfg', 'cfgBool', 'tbOn', 'tbUp', 'tbDown'];
    var dashed = { cfgBool: 'cfg-bool', teamMove: 'team-move', weekAct: 'week-act', tbOn: 'tb-on', tbUp: 'tb-up', tbDown: 'tb-down' };
    for (var i = 0; i < attrs.length; i++) {
      var k = attrs[i];
      if (el.dataset[k] !== undefined) {
        d.sel = scope + '[data-' + (dashed[k] || k) + '="' + el.dataset[k] + '"]';
        return d;
      }
    }
    return null;
  }

  function restoreFocus(d) {
    if (!d || !d.sel) return;
    var el;
    try { el = document.querySelector(d.sel); } catch (err) { return; }
    if (!el) return;
    el.focus();
    if (d.s != null) { try { el.setSelectionRange(d.s, d.e); } catch (err) {} }
  }

  function renderPanel(name) {
    var focus = captureFocus();
    if (name === 'setup') renderSetup();
    else if (name === 'teams') renderTeams();
    else if (name === 'fixtures') renderFixtures();
    else if (name === 'ladder') renderLadderPanel();
    else if (name === 'finals') renderFinalsPanel();
    else if (name === 'export') renderExport();
    restoreFocus(focus);
  }

  /* Panels that only display calculated values. */
  function refreshDerived() {
    if (activeTab === 'ladder') renderLadderPanel();
    if (activeTab === 'setup') renderSetup();
  }

  function renderAll() {
    $('#compTitle').value = state.title || '';
    $('#compSub').value = state.subtitle || '';
    renderPanel(activeTab);
  }

  /* =========================================================
     security banner
     ========================================================= */
  function renderSecurityBanner() {
    var host = $('#securityBanner');
    if (F.Auth.enabled()) { host.innerHTML = ''; return; }
    host.innerHTML =
      '<div class="note danger no-print">' +
        '<strong>This database is open to anyone.</strong> No sign-in is configured, so any person who ' +
        'views the public site can also read the database address and overwrite the whole competition. ' +
        'See <em>“Locking down the database”</em> in the README — it takes about five minutes.' +
      '</div>';
  }

  /* =========================================================
     boot
     ========================================================= */
  function startApp() {
    $('#gate').hidden = true;
    $('#signOutBtn').hidden = !F.Auth.enabled();
    renderSecurityBanner();

    F.Store.read().then(function (raw) {
      state = F.normalise(F.migrate(raw));
      expectedStamp = state.updatedAt || '';
      if (!raw || !raw.teams) {
        state = F.blankState(6);
        save();
        F.toast('New competition created');
      } else if (!raw.schema || raw.schema < F.SCHEMA) {
        F.toast('Existing competition loaded and upgraded — nothing is written back until you make a change.');
      }
      wire();
      var hash = (location.hash || '').replace('#', '');
      showTab(['setup', 'teams', 'fixtures', 'ladder', 'finals', 'export'].indexOf(hash) >= 0 ? hash : 'setup');
      renderAll();
      setSync('saved');
      watchRemote();
    }).catch(function (err) {
      document.querySelector('main').innerHTML =
        '<div class="note danger" style="margin-top:40px"><strong>Could not reach the database.</strong><br>' +
        esc(String(err.message || err)) + '<br><br>Check the <span class="kbd">dbUrl</span> in <span class="kbd">assets/config.js</span>.</div>';
    });
  }

  /* Watch for edits made from another device. We never clobber
     what is on screen — we offer to reload instead. */
  function watchRemote() {
    setInterval(function () {
      F.Store.read().then(function (raw) {
        if (!raw || !raw.updatedAt) return;
        if (raw.updatedAt === expectedStamp || remoteAhead) return;
        if (raw.updatedAt !== state.updatedAt) {
          remoteAhead = true;
          setSync('remote');
          F.toast('Someone else changed the competition on another device. Reload to see it.', 'err');
        }
      }).catch(function () {});
    }, 25000);
  }

  function boot() {
    /* keep the admin token fresh so long sessions do not fail to save */
    if (F.Auth.enabled()) {
      setInterval(function () {
        if (F.Auth.session && !F.Auth.valid()) F.Auth.refresh().catch(function () {});
      }, 60000);
    }

    if (!F.Auth.enabled()) { startApp(); return; }

    var s = F.Auth.restore();
    if (s) {
      F.Auth.refresh().then(startApp).catch(showGate);
    } else {
      showGate();
    }
  }

  function showGate() {
    var gate = $('#gate');
    gate.hidden = false;
    $('#gateEmail').focus();
    $('#gateForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = $('#gateBtn');
      btn.disabled = true; btn.textContent = 'Signing in…';
      $('#gateErr').textContent = '';
      F.Auth.signIn($('#gateEmail').value.trim(), $('#gatePass').value)
        .then(startApp)
        .catch(function (err) {
          $('#gateErr').textContent = friendlyAuthError(String(err.message || err));
          btn.disabled = false; btn.textContent = 'Sign in';
        });
    });
  }

  function friendlyAuthError(code) {
    if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/.test(code)) return 'That email and password do not match.';
    if (/TOO_MANY_ATTEMPTS/.test(code)) return 'Too many attempts — wait a minute and try again.';
    if (/API key not valid|API_KEY/i.test(code)) return 'The Firebase API key in config.js is not valid.';
    return code;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
