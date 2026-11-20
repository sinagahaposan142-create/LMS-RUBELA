/* =========================================================================
 * AdmissionCal — Tools → Kalender Seleksi (SNBP, SNBT, Mandiri, lainnya).
 *
 *  - Semua peran: daftar (berlangsung / akan datang / selesai) dan tampilan
 *    bulan, filter jalur, pencarian, hitung mundur, unduh .ics, tautan resmi,
 *    "Ingatkan saya" (notifikasi H-3 sebelum mulai dan H-1 sebelum ditutup).
 *  - Admin: tambah, sunting, duplikat, hapus jadwal.
 * Tidak ada tanggal bawaan: semua jadwal diisi admin dari pengumuman resmi.
 * Jadwal juga tampil sebagai penanda di menu Kalender (Shared.renderCalendar).
 * =======================================================================*/
(function (global) {
  'use strict';

  const esc = (s) => UI.esc(s);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const MONTHS_LONG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const svg = (d, size) => `<svg viewBox="0 0 24 24" width="${size || 16}" height="${size || 16}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    cal: svg('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>', 20),
    bell: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),
    ext: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>'),
    dl: svg('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>')
  };
  const ui = { track: '', q: '', view: 'list', mine: false, y: null, m: null };

  const parts = (ymd) => ({ y: Number(ymd.slice(0, 4)), m: Number(ymd.slice(5, 7)) - 1, d: Number(ymd.slice(8, 10)) });
  function fmtRange(a, b) {
    const s = parts(a), e = parts(b);
    if (a === b) return `${s.d} ${MONTHS[s.m]} ${s.y}`;
    if (s.y === e.y && s.m === e.m) return `${s.d}–${e.d} ${MONTHS[s.m]} ${s.y}`;
    if (s.y === e.y) return `${s.d} ${MONTHS[s.m]} – ${e.d} ${MONTHS[e.m]} ${s.y}`;
    return `${s.d} ${MONTHS[s.m]} ${s.y} – ${e.d} ${MONTHS[e.m]} ${e.y}`;
  }
  const hMinus = (n) => (n === 0 ? 'hari ini' : n === 1 ? 'besok' : `H-${n}`);
  function countdown(ev) {
    const st = PTN.eventState(ev);
    if (st === 'upcoming') { const n = PTN.daysUntil(ev.startDate); return { st, text: 'Mulai ' + hMinus(n), n }; }
    if (st === 'ongoing') { const n = PTN.daysUntil(ev.endDate); return { st, text: n === 0 ? 'Berlangsung · ditutup hari ini' : `Berlangsung · ditutup ${hMinus(n)}`, n }; }
    const n = -PTN.daysUntil(ev.endDate);
    return { st, text: n <= 1 ? 'Selesai kemarin' : `Selesai ${n} hari lalu`, n };
  }
  const trackLabel = (t) => (PTN.TRACKS[t] ? PTN.TRACKS[t].label : t);

  /* ============================ halaman ============================ */
  function render(container, user) {
    const isAdmin = user.role === 'admin';
    let plan = PTN.plan(user.id);
    const all = PTN.events();
    const today = UI.todayYMD();
    if (ui.y == null) { const t = parts(today); ui.y = t.y; ui.m = t.m; }
    const counts = {};
    all.forEach(e => { counts[e.track] = (counts[e.track] || 0) + 1; });

    container.innerHTML = `
      <div class="card tl-head">
        ${UI.secHead(ICON.cal, 'Kalender Seleksi', 'Jadwal SNBP, SNBT, dan seleksi mandiri. Diisi admin dari pengumuman resmi; selalu cek ulang di situs penyelenggara.')}
        ${isAdmin ? `<button type="button" class="btn btn-primary btn-sm" id="acAdd">${ICON.plus} Tambah jadwal</button>` : ''}
      </div>
      <div class="ac-toolbar">
        <div class="nw-chips" role="group" aria-label="Jalur seleksi">
          ${[['', 'Semua', all.length]].concat(Object.keys(PTN.TRACKS).map(k => [k, PTN.TRACKS[k].label, counts[k] || 0])).map(([k, l, n]) =>
            `<button type="button" class="nw-chip ${ui.track === k ? 'is-on' : ''}" aria-pressed="${ui.track === k}" data-track="${k}">${l} <span>${n}</span></button>`).join('')}
        </div>
        <div class="ac-tools">
          <label class="nw-search"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <span class="sr-only">Cari jadwal</span><input type="search" id="acQ" placeholder="Cari jadwal atau kampus…" value="${esc(ui.q)}" autocomplete="off" /></label>
          <div class="ac-seg" role="group" aria-label="Tampilan">
            <button type="button" data-view="list" aria-pressed="${ui.view === 'list'}">Daftar</button>
            <button type="button" data-view="month" aria-pressed="${ui.view === 'month'}">Bulan</button>
          </div>
        </div>
        ${plan.reminders.length ? `<label class="ac-mine"><input type="checkbox" id="acMine" ${ui.mine ? 'checked' : ''} /> Hanya yang saya ingatkan (${plan.reminders.length})</label>` : ''}
      </div>
      <div id="acBody"></div>`;

    const body = container.querySelector('#acBody');
    const filtered = () => {
      const terms = PTN.norm(ui.q).split(' ').filter(Boolean);
      return all.filter(e => (!ui.track || e.track === ui.track) && (!ui.mine || plan.reminders.includes(e.id)) &&
        (!terms.length || terms.every(t => PTN.norm([e.title, e.campusName, e.notes, trackLabel(e.track)].join(' ')).includes(t))));
    };
    const paint = () => (ui.view === 'month' ? paintMonth() : paintList());

    function itemHtml(e) {
      const cd = countdown(e);
      const s = parts(e.startDate);
      const on = plan.reminders.includes(e.id);
      return `<li class="ac-item is-${cd.st}${e.important ? ' is-important' : ''}">
        <div class="ac-date" aria-hidden="true"><strong>${s.d}</strong><span>${MONTHS[s.m]}</span></div>
        <div class="ac-main">
          <div class="ac-tags"><span class="ac-track ac-t-${esc(e.track)}">${esc(trackLabel(e.track))}</span>
            ${e.important ? '<span class="ac-imp">Penting</span>' : ''}
            <span class="ac-cd is-${cd.st}">${esc(cd.text)}</span></div>
          <strong class="ac-title">${esc(e.title)}</strong>
          <span class="ac-meta">${esc(fmtRange(e.startDate, e.endDate))}${e.campusName ? ' · ' + esc(e.campusName) : ''}</span>
          ${e.notes ? `<p class="ac-notes">${esc(e.notes)}</p>` : ''}
        </div>
        <div class="ac-actions">
          ${e.link ? `<a class="btn btn-sm btn-secondary" href="${esc(e.link)}" target="_blank" rel="noopener noreferrer">${ICON.ext} Info resmi</a>` : ''}
          ${cd.st !== 'past' ? `<button type="button" class="btn btn-sm ${on ? 'btn-primary' : 'btn-secondary'}" data-remind="${esc(e.id)}" aria-pressed="${on}">${ICON.bell} ${on ? 'Diingatkan' : 'Ingatkan saya'}</button>` : ''}
          <button type="button" class="btn btn-sm btn-ghost" data-ics="${esc(e.id)}" title="Unduh ke kalender ponsel/Google Calendar">${ICON.dl} .ics</button>
          ${isAdmin ? `<button type="button" class="btn btn-sm btn-ghost" data-edit="${esc(e.id)}">Sunting</button>
            <button type="button" class="btn btn-sm btn-ghost" data-dup="${esc(e.id)}">Duplikat</button>
            <button type="button" class="btn btn-sm btn-ghost nwa-del" data-del="${esc(e.id)}">Hapus</button>` : ''}
        </div></li>`;
    }
    function paintList() {
      const rows = filtered();
      if (!rows.length) {
        body.innerHTML = `<div class="card"><div class="tl-empty"><strong>${all.length ? 'Tidak ada jadwal yang cocok' : 'Belum ada jadwal seleksi'}</strong>
          <span>${all.length ? 'Ubah filter atau kata kunci.' : (isAdmin ? 'Tambahkan jadwal dari pengumuman resmi SNPMB atau situs kampus.' : 'Admin akan menambahkan jadwal resmi di sini.')}</span></div></div>`;
        bind();
        return;
      }
      const by = { ongoing: [], upcoming: [], past: [] };
      rows.forEach(e => by[PTN.eventState(e, today)].push(e));
      by.past.sort((a, b) => b.endDate.localeCompare(a.endDate));
      by.ongoing.sort((a, b) => a.endDate.localeCompare(b.endDate));
      const group = (key, title) => (by[key].length ? `<section class="card ac-group"><h3>${title} <span class="tl-count">${by[key].length}</span></h3>
        <ul class="ac-list">${by[key].map(itemHtml).join('')}</ul></section>` : '');
      body.innerHTML = group('ongoing', 'Sedang berlangsung') + group('upcoming', 'Akan datang') +
        (by.past.length ? `<details class="card ac-group ac-past"><summary><h3>Sudah selesai <span class="tl-count">${by.past.length}</span></h3></summary>
          <ul class="ac-list">${by.past.map(itemHtml).join('')}</ul></details>` : '');
      bind();
    }
    function paintMonth() {
      const rows = filtered();
      const first = new Date(Date.UTC(ui.y, ui.m, 1));
      const daysIn = new Date(Date.UTC(ui.y, ui.m + 1, 0)).getUTCDate();
      const p = (n) => String(n).padStart(2, '0');
      const ymd = (d) => `${ui.y}-${p(ui.m + 1)}-${p(d)}`;
      let cells = '';
      for (let i = 0; i < first.getUTCDay(); i++) cells += '<div class="ac-cell is-empty" aria-hidden="true"></div>';
      for (let d = 1; d <= daysIn; d++) {
        const ds = ymd(d);
        const evs = rows.filter(e => e.startDate <= ds && e.endDate >= ds);
        cells += `<div class="ac-cell${ds === today ? ' is-today' : ''}"><span class="ac-day">${d}</span>
          ${evs.slice(0, 3).map(e => `<button type="button" class="ac-bar ac-t-${esc(e.track)}${e.startDate === ds ? ' is-start' : ''}${e.endDate === ds ? ' is-end' : ''}" data-open="${esc(e.id)}"
            title="${esc(trackLabel(e.track) + ': ' + e.title + ' (' + fmtRange(e.startDate, e.endDate) + ')')}">${e.startDate === ds || d === 1 ? esc(trackLabel(e.track) + ' · ' + e.title) : '&nbsp;'}</button>`).join('')}
          ${evs.length > 3 ? `<span class="ac-more">+${evs.length - 3}</span>` : ''}</div>`;
      }
      const inMonth = rows.filter(e => e.startDate <= ymd(daysIn) && e.endDate >= ymd(1));
      body.innerHTML = `<section class="card ac-month">
        <div class="ac-month-head"><button type="button" class="btn btn-sm btn-secondary" data-mv="-1" aria-label="Bulan sebelumnya">‹</button>
          <h3>${MONTHS_LONG[ui.m]} ${ui.y}</h3><button type="button" class="btn btn-sm btn-secondary" data-mv="1" aria-label="Bulan berikutnya">›</button>
          <button type="button" class="btn btn-sm btn-ghost" data-mv="0">Bulan ini</button></div>
        <div class="ac-grid">${DAYS.map(d => `<div class="ac-dow">${d}</div>`).join('')}${cells}</div>
      </section>
      <section class="card ac-group"><h3>Jadwal bulan ini <span class="tl-count">${inMonth.length}</span></h3>
        ${inMonth.length ? `<ul class="ac-list">${inMonth.map(itemHtml).join('')}</ul>` : '<p class="tl-note">Tidak ada jadwal pada bulan ini.</p>'}</section>`;
      body.querySelectorAll('[data-mv]').forEach(b => b.addEventListener('click', () => {
        const v = Number(b.dataset.mv);
        if (v === 0) { const t = parts(today); ui.y = t.y; ui.m = t.m; }
        else { ui.m += v; if (ui.m < 0) { ui.m = 11; ui.y--; } if (ui.m > 11) { ui.m = 0; ui.y++; } }
        paintMonth();
      }));
      body.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openDetail(b.dataset.open)));
      bind();
    }
    function openDetail(id) {
      const e = PTN.event(id);
      if (!e) return;
      UI.modal.open(trackLabel(e.track) + ' · ' + e.title, `<ul class="ac-list is-modal">${itemHtml(e)}</ul>`, { autofocus: false });
      bind(document.getElementById('modalBody'), true);
    }
    function bind(scope, inModal) {
      const root = scope || body;
      root.querySelectorAll('[data-remind]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.remind;
        const on = plan.reminders.includes(id);
        plan = PTN.savePlan(user.id, { reminders: on ? plan.reminders.filter(x => x !== id) : plan.reminders.concat(id) });
        UI.toast(on ? 'Pengingat dimatikan.' : 'Kamu akan diingatkan H-3 sebelum dimulai dan H-1 sebelum ditutup.', on ? 'info' : 'success');
        tick(user);
        if (inModal) UI.modal.close();
        render(container, user);
      }));
      root.querySelectorAll('[data-ics]').forEach(b => b.addEventListener('click', () => {
        const e = PTN.event(b.dataset.ics);
        if (!e) return;
        const url = URL.createObjectURL(new Blob([PTN.icsFor(e)], { type: 'text/calendar;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url; a.download = (e.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'jadwal-seleksi') + '.ics';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }));
      if (!isAdmin) return;
      root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openForm(container, user, PTN.event(b.dataset.edit))));
      root.querySelectorAll('[data-dup]').forEach(b => b.addEventListener('click', () => {
        const e = PTN.event(b.dataset.dup);
        if (e) openForm(container, user, Object.assign({}, e, { id: null, title: e.title + ' (salinan)' }));
      }));
      root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
        const e = PTN.event(b.dataset.del);
        if (!e || !UI.confirmDialog(`Hapus jadwal "${e.title}"? Pengingat pengguna untuk jadwal ini ikut dihapus.`)) return;
        PTN.deleteEvent(e.id, user);
        if (inModal) UI.modal.close();
        UI.toast('Jadwal dihapus.', 'success');
        render(container, user);
      }));
    }

    container.querySelectorAll('[data-track]').forEach(b => b.addEventListener('click', () => { ui.track = b.dataset.track; render(container, user); }));
    container.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { ui.view = b.dataset.view; render(container, user); }));
    const mine = container.querySelector('#acMine');
    if (mine) mine.addEventListener('change', () => { ui.mine = mine.checked; paint(); });
    let t = null;
    container.querySelector('#acQ').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { ui.q = e.target.value.trim(); paint(); }, 220); });
    const add = container.querySelector('#acAdd');
    if (add) add.addEventListener('click', () => openForm(container, user, null));
    paint();
  }

  /* ============================ form admin ============================ */
  function openForm(container, user, ev) {
    const e = ev || {};
    const cs = PTN.campuses();
    UI.modal.open(e.id ? 'Sunting jadwal seleksi' : 'Tambah jadwal seleksi', `
      <form class="form" id="acForm" novalidate>
        <p class="tl-note">Isi dari pengumuman resmi (mis. snpmb.id atau situs kampus). Aplikasi tidak mengisi tanggal apa pun secara otomatis.</p>
        <div class="form-row">
          <div class="form-group"><label for="acTrack">Jalur</label>
            <select id="acTrack" name="track">${Object.keys(PTN.TRACKS).map(k => `<option value="${k}" ${(e.track || 'SNBT') === k ? 'selected' : ''}>${esc(PTN.TRACKS[k].label)} — ${esc(PTN.TRACKS[k].desc)}</option>`).join('')}</select></div>
          <div class="form-group"><label for="acCampus">Kampus <span class="muted">(opsional)</span></label>
            <select id="acCampus" name="campusId"><option value="">Tidak spesifik / nasional</option>
              ${cs.map(c => `<option value="${esc(c.id)}" ${e.campusId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
              <option value="__other" ${!e.campusId && e.campusName ? 'selected' : ''}>Kampus lain (ketik nama)</option></select></div>
        </div>
        <div class="form-group" id="acCampusOther" ${!e.campusId && e.campusName ? '' : 'hidden'}><label for="acCampusName">Nama kampus</label>
          <input id="acCampusName" name="campusName" maxlength="120" value="${esc(!e.campusId ? e.campusName || '' : '')}" /></div>
        <div class="form-group"><label for="acTitle">Judul</label>
          <input id="acTitle" name="title" maxlength="160" required value="${esc(e.title || '')}" placeholder="mis. Pendaftaran UTBK-SNBT" /></div>
        <div class="form-row">
          <div class="form-group"><label for="acStart">Tanggal mulai</label><input type="date" id="acStart" name="startDate" required value="${esc(e.startDate || '')}" /></div>
          <div class="form-group"><label for="acEnd">Tanggal selesai</label><input type="date" id="acEnd" name="endDate" value="${esc(e.endDate || '')}" />
            <div class="muted small">Kosongkan bila hanya satu hari.</div></div>
        </div>
        <div class="form-group"><label for="acLink">Tautan resmi</label><input type="url" id="acLink" name="link" maxlength="300" value="${esc(e.link || '')}" placeholder="https://" /></div>
        <div class="form-group"><label for="acNotes">Catatan</label><textarea id="acNotes" name="notes" rows="3" maxlength="600" placeholder="Syarat, biaya, jam, atau lokasi">${esc(e.notes || '')}</textarea></div>
        <label class="ac-check"><input type="checkbox" name="important" ${e.important ? 'checked' : ''} /> Tandai penting</label>
        <div class="flex-gap"><button type="button" class="btn btn-secondary" data-cancel>Batal</button><button type="submit" class="btn btn-primary">Simpan jadwal</button></div>
      </form>`);
    const f = document.getElementById('acForm');
    const campusSel = f.querySelector('#acCampus');
    campusSel.addEventListener('change', () => { f.querySelector('#acCampusOther').hidden = campusSel.value !== '__other'; });
    f.querySelector('#acStart').addEventListener('change', (x) => { const end = f.querySelector('#acEnd'); if (end.value && end.value < x.target.value) end.value = x.target.value; end.min = x.target.value; });
    f.querySelector('[data-cancel]').addEventListener('click', () => UI.modal.close());
    f.addEventListener('submit', (x) => {
      x.preventDefault();
      const d = new FormData(f);
      try {
        PTN.saveEvent({
          id: e.id || null, track: d.get('track'), campusId: d.get('campusId') && d.get('campusId') !== '__other' ? d.get('campusId') : null,
          campusName: d.get('campusId') === '__other' ? d.get('campusName') : '', title: d.get('title'), startDate: d.get('startDate'),
          endDate: d.get('endDate') || d.get('startDate'), link: d.get('link'), notes: d.get('notes'), important: !!d.get('important')
        }, user);
      } catch (err) { UI.toast(err.message, 'error'); return; }
      UI.modal.close();
      UI.toast('Jadwal disimpan.', 'success');
      render(container, user);
    });
  }

  /* ============================ pengingat ============================ */
  /** Kirim notifikasi pengingat yang jatuh tempo (dipanggil saat dashboard dibuka & berkala). */
  function tick(user) {
    if (!user || !global.PTN) return 0;
    const plan = PTN.plan(user.id);
    if (!plan.reminders.length) return 0;
    const notified = Object.assign({}, plan.notified);
    let sent = 0;
    plan.reminders.forEach(id => {
      const e = PTN.event(id);
      if (!e) return;
      const done = new Set(notified[id] || []);
      const st = PTN.eventState(e);
      const toStart = PTN.daysUntil(e.startDate), toEnd = PTN.daysUntil(e.endDate);
      if (!done.has('start') && toStart >= 0 && toStart <= 3) {
        DB.addNotification({ userId: user.id, icon: '🗓', title: `${trackLabel(e.track)}: ${e.title}`, body: `Dimulai ${hMinus(toStart)} (${fmtRange(e.startDate, e.startDate)}).`, link: 'kalender-seleksi' });
        done.add('start'); sent++;
      }
      if (!done.has('end') && st === 'ongoing' && e.endDate !== e.startDate && toEnd >= 0 && toEnd <= 1) {
        DB.addNotification({ userId: user.id, icon: '⏰', title: `Batas akhir ${trackLabel(e.track)}: ${e.title}`, body: `Ditutup ${hMinus(toEnd)} (${fmtRange(e.endDate, e.endDate)}).`, link: 'kalender-seleksi' });
        done.add('end'); sent++;
      }
      // Jadwal yang sudah lewat tanpa pernah diingatkan tidak lagi dikirimi notifikasi.
      if (st === 'past') { done.add('start'); done.add('end'); }
      notified[id] = [...done];
    });
    if (sent || JSON.stringify(notified) !== JSON.stringify(plan.notified)) PTN.savePlan(user.id, { notified });
    return sent;
  }

  /** Penanda jadwal seleksi untuk satu tanggal di menu Kalender (mulai & selesai saja). */
  function calendarChips(ymd) {
    if (!global.PTN) return '';
    return PTN.events().filter(e => e.startDate === ymd || e.endDate === ymd).slice(0, 2).map(e => {
      const kind = e.startDate === ymd ? (e.endDate === ymd ? '' : 'mulai') : 'ditutup';
      return `<div class="cal-event cal-adm ac-t-${esc(e.track)}" data-adm-chip title="${esc(trackLabel(e.track) + ': ' + e.title + ' (' + fmtRange(e.startDate, e.endDate) + ')')}">${esc(trackLabel(e.track))}${kind ? ' ' + kind : ''}: ${esc(e.title.length > 14 ? e.title.slice(0, 14) + '…' : e.title)}</div>`;
    }).join('');
  }

  global.AdmissionCal = { render, tick, calendarChips, fmtRange };
})(window);
