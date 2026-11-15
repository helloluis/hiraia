/* Donations page client (admin). Builds every node with textContent: donor data is never HTML. */
var HiraiaDonations = (function () {
  'use strict';
  var VIEWS = [
    { key: 'todo', label: 'To thank', test: function (d) { return d.email && !d.thanked_at; } },
    { key: 'thanked', label: 'Thanked', test: function (d) { return d.email && d.thanked_at; } },
    { key: 'anonymous', label: 'Anonymous', test: function (d) { return !d.email; } },
    { key: 'all', label: 'All', test: function () { return true; } },
  ];
  var manila = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function when(iso) { return iso ? manila.format(new Date(iso)) : '—'; }
  function shortHash(h) { return h ? h.slice(0, 10) + '…' + h.slice(-8) : ''; }
  function state(d) { return !d.email ? 'anonymous' : d.thanked_at ? 'thanked' : 'todo'; }

  function mount(root) {
    var cfg = JSON.parse(root.getAttribute('data-config'));
    var grid = root.querySelector('#don-grid'), views = root.querySelector('#don-views');
    var count = root.querySelector('#don-count'), banner = root.querySelector('#don-banner');
    var empty = root.querySelector('#don-empty'), updated = root.querySelector('#don-updated');
    var refresh = root.querySelector('#don-refresh');
    var data = [], pending = 0;
    var view = new URLSearchParams(location.search).get('view') || 'todo';
    if (!VIEWS.some(function (v) { return v.key === view; })) view = 'todo';

    function setView(key) {
      view = key;
      var u = new URL(location.href);
      if (key === 'todo') u.searchParams.delete('view'); else u.searchParams.set('view', key);
      history.replaceState(null, '', u);
      render();
    }

    function chips() {
      views.textContent = '';
      VIEWS.forEach(function (v) {
        var b = el('button', 'don-chip');
        b.type = 'button';
        b.setAttribute('aria-pressed', String(v.key === view));
        b.appendChild(document.createTextNode(v.label));
        b.appendChild(el('span', 'don-chip-count', String(data.filter(v.test).length)));
        b.addEventListener('click', function () { setView(v.key); });
        views.appendChild(b);
      });
    }

    function save(d, card, thanked, note, status) {
      status.className = 'don-saved';
      status.textContent = 'Saving…';
      return fetch(cfg.thankedEndpoint, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csrf: cfg.csrf, payment_id: d.id, thanked: thanked, note: note }),
      }).then(function (r) {
        if (r.status === 401) { location.reload(); throw new Error('signed out'); }
        return r.json().then(function (body) {
          if (!r.ok || !body.ok) throw new Error(body.error || ('HTTP ' + r.status));
          var i = data.findIndex(function (x) { return x.id === d.id; });
          if (i >= 0) data[i] = body.donation;
          chips();
          var fresh = card(body.donation);
          var old = grid.querySelector('[data-id="' + CSS.escape(d.id) + '"]');
          if (old) old.replaceWith(fresh);
          var s = fresh.querySelector('.don-saved');
          if (s) s.textContent = 'Saved';
          counts();
        });
      }).catch(function (e) {
        status.className = 'don-saved is-error';
        status.textContent = 'Not saved (' + e.message + '). Try again.';
      });
    }

    function card(d) {
      var c = el('article', 'don-card');
      c.setAttribute('data-id', d.id);
      c.setAttribute('data-state', state(d));
      var head = el('div', 'don-head');
      head.appendChild(el('div', 'don-who' + (d.email ? '' : ' is-anon'), d.email || 'Anonymous'));
      var amt = el('div', 'don-amount', d.amount);
      amt.appendChild(el('small', null, d.token));
      head.appendChild(amt);
      c.appendChild(head);

      var tags = el('div', 'don-tags');
      tags.appendChild(el('span', 'don-tag', d.network));
      tags.appendChild(el('span', 'don-tag' + (d.source === 'direct' ? ' is-direct' : ''), d.source === 'direct' ? 'Direct transfer' : 'Checkout'));
      if (d.test) tags.appendChild(el('span', 'don-tag is-test', 'TEST'));
      c.appendChild(tags);

      var meta = el('dl', 'don-meta');
      meta.appendChild(el('dt', null, 'Received'));
      meta.appendChild(el('dd', null, when(d.confirmed_at)));
      meta.appendChild(el('dt', null, 'Transaction'));
      var dd = el('dd');
      if (d.tx_url) {
        var a = el('a', null, shortHash(d.tx));
        a.href = d.tx_url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = d.tx;
        dd.appendChild(a);
      } else dd.textContent = '—';
      meta.appendChild(dd);
      c.appendChild(meta);

      if (!d.email) {
        c.appendChild(el('p', 'don-anon-note', 'No email left, so there is no one to thank.'));
        return c;
      }
      var box = el('div', 'don-thank');
      var label = el('label', 'don-toggle');
      var tick = document.createElement('input');
      tick.type = 'checkbox';
      tick.checked = Boolean(d.thanked_at);
      label.appendChild(tick);
      label.appendChild(document.createTextNode('Thanked'));
      if (d.thanked_at) label.appendChild(el('span', 'don-when', when(d.thanked_at)));
      box.appendChild(label);
      var noteRow = el('div', 'don-note');
      var note = document.createElement('input');
      note.type = 'text';
      note.maxLength = cfg.noteMax;
      note.placeholder = 'Note (optional), e.g. “emailed 15 Nov”';
      note.value = d.thank_note || '';
      note.setAttribute('aria-label', 'Thank-you note for ' + d.email);
      noteRow.appendChild(note);
      box.appendChild(noteRow);
      var actions = el('div', 'don-actions');
      var mail = el('a', null, 'Write a thank-you email');
      mail.href = 'mailto:' + encodeURIComponent(d.email).replace(/%40/g, '@') + '?subject=' + encodeURIComponent('Thank you for supporting Hiraia');
      actions.appendChild(mail);
      var status = el('span', 'don-saved', '');
      status.setAttribute('role', 'status');
      actions.appendChild(status);
      box.appendChild(actions);
      tick.addEventListener('change', function () { save(d, card, tick.checked, note.value, status); });
      var last = note.value;
      function saveNote() { if (note.value !== last) { last = note.value; save(d, card, tick.checked, note.value, status); } }
      note.addEventListener('blur', saveNote);
      note.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveNote(); } });
      c.appendChild(box);
      return c;
    }

    function counts() {
      var v = VIEWS.find(function (x) { return x.key === view; });
      var shown = data.filter(v.test).length;
      var identified = data.filter(function (d) { return d.email; }).length;
      count.textContent = shown + ' shown · ' + data.length + ' donation' + (data.length === 1 ? '' : 's') + ', ' + identified +
        ' with an email' + (pending ? ' · ' + pending + ' checkout' + (pending === 1 ? '' : 's') + ' with an email awaiting payment' : '');
    }

    function render() {
      chips();
      var v = VIEWS.find(function (x) { return x.key === view; });
      var rows = data.filter(v.test);
      grid.textContent = '';
      rows.forEach(function (d) { grid.appendChild(card(d)); });
      grid.setAttribute('aria-busy', 'false');
      empty.hidden = rows.length > 0;
      empty.textContent = data.length ? (view === 'todo' ? 'Everyone who left an email has been thanked.' : 'Nothing in this view.') :
        'No donations recorded yet.';
      counts();
    }

    function load() {
      refresh.disabled = true;
      banner.hidden = true;
      return fetch(cfg.endpoint, { credentials: 'same-origin' }).then(function (r) {
        if (r.status === 401) { location.reload(); return null; }
        return r.json().then(function (body) {
          if (!r.ok || !body.ok) throw new Error(body.error || ('HTTP ' + r.status));
          data = body.donations; pending = body.pending_sessions || 0;
          updated.textContent = 'Updated ' + when(body.fetched_at) + '.';
          render();
        });
      }).catch(function (e) {
        banner.textContent = 'Could not load donations (' + e.message + '). Try Refresh.';
        banner.hidden = false;
        count.textContent = '';
      }).finally(function () { refresh.disabled = false; });
    }

    refresh.addEventListener('click', load);
    load();
  }
  return { mount: mount };
})();
