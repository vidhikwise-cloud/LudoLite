      // Everything below writes with textContent, never innerHTML, because
      // display names are user-supplied text and must never be able to
      // become markup on this page.
      const $ = (id) => document.getElementById(id);
      let token = '';

      const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
      const dur = (ms) => {
        if (ms == null) return '—';
        const m = Math.floor(ms / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        return m > 0 ? m + 'm ' + s + 's' : s + 's';
      };

      function cell(row, text, cls) {
        const td = document.createElement('td');
        td.textContent = text;
        if (cls) td.className = cls;
        row.appendChild(td);
        return td;
      }

      function pill(text, kind) {
        const s = document.createElement('span');
        s.className = 'pill ' + kind;
        s.textContent = text;
        return s;
      }

      async function get(path) {
        const res = await fetch('/api/admin' + path, {
          headers: { authorization: 'Bearer ' + token },
        });
        // "Incorrect" rather than naming what was wrong: the message is
        // shown before anyone is authenticated, so it should confirm as
        // little as possible about what the box wants.
        if (!res.ok) {
          throw new Error(
            res.status === 401 ? 'Incorrect.' : 'Could not load (' + res.status + ')',
          );
        }
        return res.json();
      }

      async function load() {
        const [stats, matches, players] = await Promise.all([
          get('/stats'), get('/matches?limit=30'), get('/players?limit=50'),
        ]);

        const S = $('stats');
        S.textContent = '';
        [
          ['Players', stats.players],
          ['New today', stats.newPlayersToday],
          ['Rooms', stats.rooms],
          ['Matches', stats.matches],
          ['Finished', stats.matchesFinished],
          ['Abandoned', stats.matchesAbandoned],
          ['In play now', stats.roomsInPlay],
        ].forEach(([label, value]) => {
          const d = document.createElement('div');
          d.className = 'stat';
          const b = document.createElement('b');
          b.textContent = String(value);
          const sp = document.createElement('span');
          sp.textContent = label;
          d.append(b, sp);
          S.appendChild(d);
        });

        const M = $('matches');
        M.textContent = '';
        matches.matches.forEach((m) => {
          const tr = document.createElement('tr');
          cell(tr, fmt(m.startedAt));

          const td = document.createElement('td');
          const box = document.createElement('div');
          box.className = 'seats';
          m.players.forEach((p) => {
            let kind = 'bot';
            if (!p.isBot) kind = p.won ? 'ok' : p.walkedOut ? 'bad' : 'warn';
            let label = p.name;
            if (p.isHost) label += ' ★';
            if (p.won) label += ' 🏆';
            if (p.walkedOut) label += ' (left)';
            box.appendChild(pill(label, kind));
          });
          td.appendChild(box);
          tr.appendChild(td);

          const out = document.createElement('td');
          out.appendChild(
            m.completed ? pill('Completed', 'ok') : pill('Abandoned', 'bad'),
          );
          tr.appendChild(out);

          cell(tr, String(m.moves));
          cell(tr, dur(m.durationMs));
          cell(tr, m.funding + ' · ' + m.roomStatus, 'mono');
          M.appendChild(tr);
        });

        const P = $('players');
        P.textContent = '';
        players.players.forEach((p) => {
          const tr = document.createElement('tr');
          cell(tr, p.displayName);
          cell(tr, p.device, 'mono');
          cell(tr, String(p.roomsJoined));
          cell(tr, String(p.roomsHosted));
          cell(tr, String(p.leftEarly), p.leftEarly > 0 ? '' : 'muted');
          cell(tr, fmt(p.firstSeen));
          cell(tr, fmt(p.lastSeen));
          P.appendChild(tr);
        });
      }

      async function open_() {
        token = $('tok').value.trim();
        if (!token) return;
        $('err').textContent = '';
        try {
          await load();
          $('gate').hidden = true;
          $('head').hidden = false;
          $('dash').hidden = false;
          // Refresh while the tab is open. Thirty seconds is often enough
          // to watch a match land without hammering a free-tier database.
          setInterval(() => load().catch(() => {}), 30000);
        } catch (e) {
          $('err').textContent = e.message;
        }
      }

      $('go').addEventListener('click', open_);
      $('tok').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') open_();
      });
