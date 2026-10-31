/* =====================================================================
 * js/verses.js — Ayat Harian sesuai agama mentee
 * ---------------------------------------------------------------------
 * Admin mengelola ayat per agama (rujukan, isi, sumber terjemahan,
 * jadwal tanggal opsional, status tinjauan). Mentee melihat ayat hari ini
 * sesuai isian "Agama" di profilnya; ayat berganti setiap pergantian hari
 * (zona waktu LMS). Ayat bertanggal tertentu diprioritaskan pada hari itu.
 * ===================================================================*/
(function (global) {
  'use strict';
  const esc = (s) => UI.esc(s);
  const ICON = { 'Islam': '☪️', 'Kristen Protestan': '✝️', 'Katolik': '✝️', 'Hindu': '🕉️', 'Buddha': '☸️', 'Konghucu': '☯️' };
  const todayYmd = () => DB.ymdInTz(Date.now(), DB.getSettings().lmsTimezone || 'WIB');
  const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

  function verseBlock(v, big) {
    return `<blockquote class="vs-quote ${big ? 'is-big' : ''}"><p>${esc(v.text)}</p>
      <footer><strong>${esc(v.reference)}</strong>${v.source ? ` <span>• ${esc(v.source)}</span>` : ''}</footer></blockquote>`;
  }

  /** Kartu di Overview mentee. */
  function cardHtml(user) {
    if (DB.getSettings().verseEnabled === false) return '';
    const me = DB.getUser(user.id) || user;
    if (!me.religion) {
      return `<div class="card vs-card is-empty"><div class="vs-head">📖 Ayat Harian</div>
        <p class="muted small">Isi kolom <strong>Agama</strong> di Profil agar ayat harian sesuai keyakinanmu tampil di sini.</p>
        <button type="button" class="btn btn-sm btn-secondary" data-vs-go="profile">Isi di Profil</button></div>`;
    }
    const v = DB.verseOfDay(me.religion, todayYmd());
    return `<div class="card vs-card"><div class="vs-head">${ICON[me.religion] || '📖'} Ayat Harian <span>${esc(me.religion)} • ${UI.fmtYMD(todayYmd())}</span></div>
      ${v ? verseBlock(v) : `<p class="muted small">Admin belum menambahkan ayat untuk agama ${esc(me.religion)}.</p>`}
      <button type="button" class="btn btn-sm btn-ghost" data-vs-go="ayat">Lihat ayat 7 hari terakhir →</button></div>`;
  }
  function bindCard(root) {
    root.querySelectorAll('[data-vs-go]').forEach(b => b.addEventListener('click', () => Dashboard.navigate(b.dataset.vsGo)));
  }

  function renderPage(container, user) {
    const me = DB.getUser(user.id) || user;
    if (DB.getSettings().verseEnabled === false) { container.innerHTML = '<div class="empty"><div class="empty-icon">📖</div>Ayat harian sedang dinonaktifkan admin.</div>'; return; }
    if (!me.religion) {
      container.innerHTML = `<div class="card"><div class="empty"><div class="empty-icon">📖</div>Pilih agamamu terlebih dahulu.
        <form id="vsRel" class="form mt-2" style="max-width:340px;margin-inline:auto;"><select name="r" class="input" required><option value="">— pilih agama —</option>${DB.RELIGIONS.map(r => `<option>${esc(r)}</option>`).join('')}</select>
        <button class="btn btn-primary btn-sm mt-1" type="submit">Simpan</button></form></div></div>`;
      container.querySelector('#vsRel').addEventListener('submit', (e) => {
        e.preventDefault();
        if (!DB.RELIGIONS.includes(e.target.r.value)) return;
        DB.updateUser(me.id, { religion: e.target.r.value }); UI.toast('Agama disimpan.'); renderPage(container, user);
      });
      return;
    }
    const t = todayYmd();
    const today = DB.verseOfDay(me.religion, t);
    const past = [1, 2, 3, 4, 5, 6].map(n => ({ day: addDays(t, -n), v: DB.verseOfDay(me.religion, addDays(t, -n)) })).filter(x => x.v);
    container.innerHTML = `
      <section class="card vs-hero"><div class="vs-hero-ic">${ICON[me.religion] || '📖'}</div>
        <div class="vs-eyebrow">Ayat hari ini • ${esc(me.religion)} • ${UI.fmtYMD(t)}</div>
        ${today ? verseBlock(today, true) : `<p class="muted">Admin belum menambahkan ayat untuk agama ${esc(me.religion)}.</p>`}
        <p class="muted small">Ayat berganti otomatis setiap hari pukul 00.00 ${esc(DB.getSettings().lmsTimezone || 'WIB')}. Agama dapat diubah di menu Profil.</p></section>
      <div class="card"><div class="card-header">${UI.secHead('🗓️', 'Ayat 6 Hari Terakhir', 'renungan untuk mengawali belajar')}</div>
        ${past.length ? past.map(x => `<div class="vs-past"><span>${UI.fmtYMD(x.day)}</span>${verseBlock(x.v)}</div>`).join('') : '<div class="muted small">Belum ada riwayat.</div>'}</div>`;
  }

  function renderAdmin(container, admin) {
    const st = DB.getSettings();
    const verses = DB.getVerses();
    const t = todayYmd();
    const students = DB.getUsers().filter(u => u.role === 'siswa');
    container.innerHTML = `
      <div class="alert alert-info small">Pastikan teks ayat dan terjemahan berasal dari sumber resmi (mis. Terjemahan Kemenag RI, Alkitab LAI, atau kitab resmi tiap agama) dan sudah ditinjau. Ayat yang belum ditinjau ditandai <span class="badge badge-warning">Perlu ditinjau</span>.</div>
      <div class="vs-grid">${DB.RELIGIONS.map(r => { const v = DB.verseOfDay(r, t); const n = students.filter(s => s.religion === r).length;
        return `<div class="card vs-today"><div class="vs-head">${ICON[r]} ${esc(r)} <span>${n} mentee • ${verses.filter(x => x.religion === r && x.active !== false).length} ayat aktif</span></div>
          ${v ? `<p class="small">${esc(v.text.slice(0, 160))}${v.text.length > 160 ? '…' : ''}</p><div class="muted small"><strong>${esc(v.reference)}</strong></div>` : '<p class="muted small">Belum ada ayat aktif.</p>'}</div>`; }).join('')}</div>
      <div class="muted small mb-1">${students.filter(s => !s.religion).length} mentee belum mengisi agama.</div>
      <div class="card"><div class="card-header">${UI.secHead('📖', `Daftar Ayat (${verses.length})`, 'ayat tanpa tanggal dirotasi harian; ayat bertanggal tampil tepat pada tanggalnya')}
        <div class="flex-gap"><label class="check-row" style="margin:0;"><input type="checkbox" id="vsOn" ${st.verseEnabled !== false ? 'checked' : ''}/> Aktif</label>
          <button type="button" class="btn btn-primary btn-sm" id="vsAdd">+ Tambah Ayat</button></div></div><div id="vsList"></div></div>`;
    container.querySelector('#vsOn').addEventListener('change', (e) => { DB.setSetting('verseEnabled', e.target.checked); UI.toast('Pengaturan ayat harian disimpan.'); });
    container.querySelector('#vsAdd').addEventListener('click', () => openForm(container, admin));
    DataSearch.mount({
      container: container.querySelector('#vsList'), items: verses.slice().sort((a, b) => a.religion.localeCompare(b.religion) || a.createdAt - b.createdAt), stateKey: 'verses-admin',
      placeholder: 'Cari isi ayat, rujukan, atau sumber…', fields: v => [v.text, v.reference, v.source, v.religion],
      filters: [{ key: 'r', label: 'Semua agama', get: v => v.religion, options: DB.RELIGIONS.map(r => ({ value: r, label: r })) },
        { key: 'st', label: 'Semua status', get: v => [v.active !== false ? 'on' : 'off', v.reviewed ? 'rev' : 'unrev'],
          options: [{ value: 'on', label: 'Aktif' }, { value: 'off', label: 'Nonaktif' }, { value: 'rev', label: 'Sudah ditinjau' }, { value: 'unrev', label: 'Perlu ditinjau' }] }],
      pageSize: 15, empty: 'Belum ada ayat.',
      render: (rows, ctx) => `<div class="table-wrap"><table class="table"><thead><tr><th>Agama</th><th>Ayat</th><th>Jadwal</th><th>Status</th><th>Aksi</th></tr></thead>
        <tbody>${rows.map(v => `<tr><td>${ICON[v.religion] || ''} ${esc(v.religion)}</td>
          <td><strong>${ctx.highlight(v.reference)}</strong><div class="small">${ctx.highlight(v.text.slice(0, 180))}${v.text.length > 180 ? '…' : ''}</div><div class="muted small">${ctx.highlight(v.source || '')}</div></td>
          <td>${v.date ? UI.fmtYMD(v.date) : '<span class="muted small">rotasi harian</span>'}</td>
          <td>${v.active !== false ? '<span class="badge badge-success">Aktif</span>' : '<span class="badge badge-gray">Nonaktif</span>'} ${v.reviewed ? '<span class="badge badge-info">Ditinjau</span>' : '<span class="badge badge-warning">Perlu ditinjau</span>'}</td>
          <td class="actions"><button type="button" class="btn btn-sm btn-secondary" data-vs-edit="${v.id}">Edit</button><button type="button" class="btn btn-sm btn-danger" data-vs-del="${v.id}">Hapus</button></td></tr>`).join('')}</tbody></table></div>`,
      onPaint: (box) => {
        box.querySelectorAll('[data-vs-edit]').forEach(b => b.addEventListener('click', () => openForm(container, admin, DB.getVerses().find(v => v.id === b.dataset.vsEdit))));
        box.querySelectorAll('[data-vs-del]').forEach(b => b.addEventListener('click', () => {
          if (!UI.confirmDialog('Hapus ayat ini?')) return;
          try { DB.deleteVerse(b.dataset.vsDel, admin); UI.toast('Ayat dihapus.'); renderAdmin(container, admin); } catch (e) { UI.toast(e.message, 'error'); }
        }));
      }
    });
  }

  function openForm(container, admin, v) {
    UI.modal.open(v ? 'Edit Ayat' : 'Tambah Ayat', `<form id="vsForm" class="form">
      <div class="form-row"><div class="form-group"><label>Agama</label><select name="religion" class="input" required>${DB.RELIGIONS.map(r => `<option ${v && v.religion === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
        <div class="form-group"><label>Rujukan</label><input name="reference" class="input" maxlength="120" required value="${esc(v ? v.reference : '')}" placeholder="mis. QS. Al-Insyirah [94]: 5–6" /></div></div>
      <div class="form-group"><label>Isi ayat / terjemahan</label><textarea name="text" rows="4" maxlength="1200" required>${esc(v ? v.text : '')}</textarea></div>
      <div class="form-row"><div class="form-group"><label>Sumber terjemahan</label><input name="source" class="input" maxlength="120" value="${esc(v ? v.source : '')}" placeholder="mis. Terjemahan Kemenag RI" /></div>
        <div class="form-group"><label>Tampilkan pada tanggal (opsional)</label><input type="date" name="date" class="input" value="${esc(v ? v.date : '')}" /></div></div>
      <label class="check-row"><input type="checkbox" name="active" ${!v || v.active !== false ? 'checked' : ''}/> Aktif</label>
      <label class="check-row"><input type="checkbox" name="reviewed" ${v && v.reviewed ? 'checked' : ''}/> Teks sudah ditinjau dari sumber resmi</label>
      <div id="vsErr" class="alert alert-error hidden"></div>
      <div class="flex-gap" style="justify-content:flex-end;"><button type="button" class="btn btn-secondary" data-close>Batal</button><button class="btn btn-primary" type="submit">Simpan</button></div></form>`);
    const f = document.getElementById('vsForm');
    f.querySelector('[data-close]').addEventListener('click', () => UI.modal.close());
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      try {
        DB.saveVerse({ id: v ? v.id : null, religion: f.religion.value, reference: f.reference.value, text: f.text.value, source: f.source.value,
          date: f.date.value, active: f.active.checked, reviewed: f.reviewed.checked }, admin);
        UI.modal.close(); UI.toast('Ayat disimpan.'); renderAdmin(container, admin);
      } catch (ex) { const er = f.querySelector('#vsErr'); er.textContent = ex.message; er.classList.remove('hidden'); }
    });
  }

  global.Verses = { cardHtml, bindCard, renderPage, renderAdmin, ICON };
})(window);
