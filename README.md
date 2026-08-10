# OPAC Futsal

Live fixtures, results, ladder and finals for the school lunchtime futsal competition.

- **Public site** — `index.html` → <https://khadfield-web.github.io/opac-futsal/>
- **Admin console** — `admin.html` → <https://khadfield-web.github.io/opac-futsal/admin.html>

No build step, no framework, no npm. Static files served by GitHub Pages, with a
Firebase Realtime Database holding the live competition.

---

## ⚠️ First job: lock down the database

Right now the database accepts writes from anyone. The address is visible in the
page source of the public site, so anybody who can open the site can also erase
the whole competition with one request. Nothing here is secret and no student
data is involved, but a wiped ladder mid-season is a bad afternoon.

Fixing it takes about five minutes.

**1. Create the admin login**

Firebase console → **Authentication** → *Get started* → enable **Email/Password**
→ **Users** → *Add user*. Use a staff email and a real password. Do not share it
with students.

**2. Lock the rules**

Firebase console → **Realtime Database** → **Rules** → paste and publish:

```json
{
  "rules": {
    "futsal": {
      ".read": true,
      ".write": "auth != null"
    }
  }
}
```

Everyone can read the competition; only a signed-in account can change it.

**3. Point the site at your login**

Firebase console → ⚙ **Project settings** → *Your apps* → copy the `apiKey`, then
put it in `assets/config.js`:

```js
apiKey: 'AIzaSy…your key…',
```

That key is meant to be public — it only lets someone *attempt* a sign-in. The
rules above do the actual protecting.

Once the key is set, `admin.html` asks for the email and password before it will
open, and the red warning banner disappears.

---

## Using the admin console

| Tab | What it does |
| --- | --- |
| **Setup** | Competition type, points, tie-breakers, finals format, scheduling |
| **Teams** | Names, emoji or logo, groups, order |
| **Fixtures** | The draw. Drag games around, enter scores |
| **Ladder** | Read-only view of the calculated standings |
| **Finals** | Scores for the finals series; match-ups fill themselves in |
| **Export** | Excel, CSV, JSON backup and restore, print, reset |

Everything saves automatically about half a second after you stop typing, and
appears on the public site immediately — no refresh needed at either end.

`Ctrl+Z` (or the ↶ button) undoes the last change, up to 40 steps back.

### Setting up a competition

1. **Teams** → set how many teams and name them.
2. **Setup** → choose the format, points, tie-breakers and finals.
3. **Setup** → tick your game slots, then *Generate draw*. This builds every
   week and fixture.
4. **Fixtures** → adjust anything by hand.

*Generate draw* replaces the existing draw and clears all scores. Take a backup
from the **Export** tab first if there is anything worth keeping.

### Moving games around

Grab the **⠿** handle on any game and drag it — up or down inside a week, or
straight into a different week. The **▲▼** buttons do the same thing without a
mouse, and hop into the neighbouring week when you reach the top or bottom of
one. There is also a *Move to week* dropdown behind the **⋯** button.

### Competition types

**Format** — round robin (everyone plays everyone), groups (pools then finals),
knockout only, or custom (you build the draw by hand).

**Game slots** — every game sits in one of three fixed windows: **Recess**,
**Lunch 1**, **Lunch 2**. Tick the ones you use under *Setup → Scheduling* and
the draw puts one game in each, in that order, so three ticked slots means three
games a week. Individual games can be moved between slots afterwards from the
dropdown on each row.

**Times each pair meets** — once, or home-and-away, or more.

**Points** — win, draw, loss and bye are all editable. Turn *Games can end in a
draw* off and drawn games get a penalty shoot-out winner instead.

**Separating level teams** — tie-breakers are applied in the order you set, and
you choose which ones count: goal difference, percentage (GF ÷ GA, the AFL way),
goals for, goals against, most wins, head-to-head, or name.

**Finals** — no finals, top 2, top 3, top 4 AFL-style (the double chance for 1st
and 2nd, which is what this competition used to do), top 4 straight knockout with
a 3rd place play-off, top 8, or crossover semis when you are running two groups.

The bracket seeds itself from the ladder and advances each winner automatically.

**Penalties** — if a final finishes level, a shoot-out row appears under the
scoreline. Enter the actual penalty score (4–2, say) and the winner is worked out
from it, carried into the next round, and shown publicly as *"Portugal win 4–2 on
penalties"*. The scoreline itself still reads 2–2, as it should. Turning off
*Games can end in a draw* gives league games the same treatment.

Anything can be overridden by hand under **⋯** if real life gets in the way.

---

## Student privacy

Team names only. No student names anywhere on the public site — not in team
names, not in slot labels, not in match notes. The **Teams** tab on the public
site says as much, and there is a reminder in the admin **Setup** tab.

Everything typed into the admin console is public the moment it is saved.

---

## How it fits together

```
index.html          public site
admin.html          admin console
sw.js               offline cache for the public site
manifest.webmanifest
assets/
  config.js         ← the only file you should need to edit
  core.js           data model, migration, ladder maths, finals brackets, Firebase transport
  public.js         public site rendering
  admin.js          admin console
  sortable.js       drag-to-reorder (mouse, trackpad and touch)
  app.css           shared design system
  admin.css         admin-only styles
  logo.jpg
```

The public site streams changes from Firebase over server-sent events, so scores
land on screen in under a second. If the school network blocks the stream it
falls back to polling every 20 seconds on its own.

A service worker caches the shell so the site still opens on flaky wifi. It is
network-first, so a deploy is never stuck behind a stale cache.

### Data model

One JSON document under `futsal`:

```jsonc
{
  "schema": 2,
  "title": "…", "subtitle": "…",
  "config": { "format": "roundrobin", "pointsWin": 3, "tiebreakers": ["pts","gd"], … },
  "teams":  [ { "id": "t_…", "name": "Brazil", "emoji": "🇧🇷", "logo": "", "group": 0 } ],
  "weeks":  [ { "id": "w_…", "label": "Week 1", "date": "2026-02-11",
                "matches": [ { "id": "m_…", "home": "t_…", "away": "t_…",
                               "homeScore": 3, "awayScore": 1, "slot": "Lunch 1" } ] } ],
  "finals": { "sf1": { "homeScore": 2, "awayScore": 2, "penHome": 4, "penAway": 2 } },
  "updatedAt": "2026-02-11T01:23:45.000Z"
}
```

Teams are referenced by **id**, not by name, so renaming a team updates every
fixture, result and final at once.

The ladder and the finals match-ups are **calculated, never stored** — fix a
score and everything downstream corrects itself.

### Upgrading from the old version

The old format (teams as a list of names, finals keyed `semi1`/`semi2`/`prelim`/
`grand`, free-text slot labels like *"Wednesday Lunch 2"*) is migrated
automatically when the admin console loads it — slot labels are matched onto
Recess / Lunch 1 / Lunch 2. Nothing is
written back until you make a change, so opening the page is safe. The old finals
map onto the top-4 AFL bracket exactly.

---

## Local development

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

Any static server will do — opening the files with `file://` will not work
because the service worker and `fetch` need an http origin.
