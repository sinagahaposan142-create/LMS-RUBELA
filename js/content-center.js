/* =====================================================================
 * js/content-center.js — Pusat Konten (admin & tutor)
 * ---------------------------------------------------------------------
 * Satu tempat untuk mengelola konten kelas lintas angkatan:
 *  1. Rilis bertahap per angkatan — konten angkatan lama (arsip) dirilis
 *     satu per satu / beberapa sekaligus, langsung atau terjadwal, dan bisa
 *     ditarik kembali.
 *  2. Transfer — salin (ke satu atau beberapa kelas) atau pindahkan konten
 *     ke kelas subtest lain; admin juga dapat menyalin ke Course Mandiri.
 *  3. Pembuat — admin mengganti pembuat/penanggung jawab (Admin atau tutor
 *     baru), termasuk konten yang pembuatnya sudah dihapus.
 * Semua aturan izin diperiksa ulang di lapisan data (js/data.js).
 * ===================================================================*/
(function (global) {
  'use strict';
  const esc = (s) => UI.esc(s);
  const KINDS = ['material', 'module', 'recording', 'assignment', 'cbt'];
  const STATE_LABEL = {
    open: ['badge-gray', 'Semua terlihat'], new: ['badge-success', '🆕 Baru (langsung terlihat)'],
    released: ['badge-info', '🔓 Dirilis'], scheduled: ['badge-warning', '🗓️ Terjadwal'], archive: ['badge-gray', '🔒 Arsip (tersembunyi)']
  };
  const PAGE = 25;
  const nid = (p) => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let st = { batchId: null, kind: '', courseId: '', status: '', owner: '', q: '', page: 1 };
  const selected = new Set();

  /** Atur filter awal (dipakai tombol "Kelola Rilis" di halaman Tahun Akademik). */
  function preset(p) { st = Object.assign({}, st, p || {}, { page: 1 }); selected.clear(); }

  function storeKey(kind) { return DB.CONTENT_STORE[kind]; }
  function allOf(kind) { try { return JSON.parse(localStorage.getItem(storeKey(kind)) || '[]'); } catch (e) { return []; } }
  function getRec(kind, id) { return allOf(kind).find(x => x.id === id) || null; }
  function coursesFor(user) { return user.role === 'admin' ? DB.getCourses() : DB.getCoursesByTeacher(user.id); }

  /** Konten yang boleh dikelola pengguna ini. */
  function itemsFor(user) {
    const mine = new Set(coursesFor(user).map(c => c.id));
    const out = [];
    KINDS.forEach(kind => allOf(kind).forEach(rec => {
      const cids = DB.contentCourseIds(kind, rec);
      if (user.role !== 'admin' && rec.createdBy !== user.id && !cids.some(id => mine.has(id))) return;
      out.push({ kind, rec, cids, key: kind + ':' + rec.id });
    }));
    return out.sort((a, b) => (Number(b.rec.createdAt) || 0) - (Number(a.rec.createdAt) || 0));
  }
  function ownerKey(rec) {
    if (!rec.createdBy) return '__none__';
    if (DB.isOrphanContent(rec)) return '__orphan__';
    return rec.createdBy;
  }

  function render(container, user) {
    const batches = DB.activeBatches().filter(DB.isStagedBatch);
    if (!batches.some(b => b.id === st.batchId)) st.batchId = batches.length ? batches[0].id : null;
    const batch = st.batchId ? DB.getBatch(st.batchId) : null;
    const all = itemsFor(user);
    const courses = coursesFor(user);
    const owners = [...new Set(all.map(x => ownerKey(x.rec)))];
    const now = Date.now();
    const stateOf = (x) => DB.contentBatchState(x.rec, batch, now);

    let list = all;
    if (st.kind) list = list.filter(x => x.kind === st.kind);
    if (st.courseId) list = list.filter(x => x.cids.includes(st.courseId));
    if (st.owner) list = list.filter(x => ownerKey(x.rec) === st.owner);
    if (st.status && batch) list = list.filter(x => stateOf(x) === st.status);
    const needle = st.q.trim().toLowerCase();
    if (needle) list = list.filter(x => [x.rec.title, x.rec.description, DB.contentOwnerName(x.rec), x.cids.map(id => DB.courseTitle(DB.getCourse(id))).join(' ')]
      .join(' ').toLowerCase().includes(needle));
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    st.page = Math.min(Math.max(1, st.page), pages);
    const rows = list.slice((st.page - 1) * PAGE, st.page * PAGE);
    [...selected].forEach(k => { if (!all.some(x => x.key === k)) selected.delete(k); });
    const counts = batch ? ['archive', 'scheduled', 'released', 'new'].reduce((m, k) => { m[k] = all.filter(x => stateOf(x) === k).length; return m; }, {}) : null;

    container.innerHTML = `
      <section class="welcome-hero cc-hero"><span class="blob b1"></span><span class="blob b2"></span>
        <div class="wh-inner"><div class="wh-eyebrow">📦 Pusat Konten</div><h2>Rilis, Transfer & Pembuat Konten</h2>
          <p class="wh-sub">Konten tetap tersimpan selamanya. Untuk angkatan baru, pilih materi/modul/rekaman/tugas/ujian mana yang dibuka lebih dulu — satu atau beberapa sekaligus — lalu salin ke kelas lain bila perlu.</p>
          ${counts ? `<div class="wh-chips"><span class="wh-chip">🔒 ${counts.archive} arsip</span><span class="wh-chip">🗓️ ${counts.scheduled} terjadwal</span><span class="wh-chip">🔓 ${counts.released} dirilis</span><span class="wh-chip">🆕 ${counts.new} baru</span></div>` : ''}</div></section>

      ${batch ? '' : `<div class="alert alert-info">Belum ada angkatan dengan <strong>rilis bertahap</strong> yang sedang berjalan, jadi semua konten terlihat oleh mentee seperti biasa.
        ${user.role === 'admin' ? 'Buat atau ubah angkatan di <a href="#" id="ccGoBatch">Tahun Akademik</a> lalu pilih "Rilis bertahap".' : 'Hubungi admin bila angkatan baru perlu rilis bertahap.'}
        Transfer konten & ganti pembuat tetap dapat digunakan.</div>`}

      <div class="card">
        <div class="cc-filters">
          ${batches.length ? `<div class="form-group"><label for="ccBatch">Angkatan tujuan rilis</label>
            <select id="ccBatch" class="input">${batches.map(b => `<option value="${esc(b.id)}" ${b.id === st.batchId ? 'selected' : ''}>${esc(b.name)} — arsip &lt; ${esc(UI.fmtYMD(b.archiveBefore || b.startDate))}</option>`).join('')}</select></div>` : ''}
          <div class="form-group"><label for="ccKind">Jenis</label><select id="ccKind" class="input"><option value="">Semua jenis</option>
            ${KINDS.map(k => `<option value="${k}" ${st.kind === k ? 'selected' : ''}>${DB.CONTENT_KINDS[k].icon} ${DB.CONTENT_KINDS[k].label}</option>`).join('')}</select></div>
          <div class="form-group"><label for="ccCourse">Kelas</label><select id="ccCourse" class="input"><option value="">Semua kelas</option>
            ${courses.map(c => `<option value="${esc(c.id)}" ${st.courseId === c.id ? 'selected' : ''}>${esc(DB.courseTitle(c))}</option>`).join('')}</select></div>
          ${batch ? `<div class="form-group"><label for="ccStatus">Status rilis</label><select id="ccStatus" class="input"><option value="">Semua status</option>
            ${['archive', 'scheduled', 'released', 'new'].map(k => `<option value="${k}" ${st.status === k ? 'selected' : ''}>${STATE_LABEL[k][1]}</option>`).join('')}</select></div>` : ''}
          <div class="form-group"><label for="ccOwner">Pembuat</label><select id="ccOwner" class="input"><option value="">Semua pembuat</option>
            ${owners.map(o => `<option value="${esc(o)}" ${st.owner === o ? 'selected' : ''}>${esc(o === '__none__' ? '(belum tercatat)' : o === '__orphan__' ? '⚠️ Akun pembuat dihapus' : DB.contentOwnerName({ createdBy: o }))}</option>`).join('')}</select></div>
          <div class="form-group cc-search"><label for="ccQ">Cari</label><input id="ccQ" type="search" class="input" value="${esc(st.q)}" placeholder="judul, kelas, pembuat…" autocomplete="off" /></div>
        </div>

        <div class="cc-bulk" id="ccBulk">
          <label class="check-row"><input type="checkbox" id="ccAllPage" ${rows.length && rows.every(x => selected.has(x.key)) ? 'checked' : ''} /> Pilih semua di halaman ini</label>
          <button type="button" class="btn btn-sm btn-ghost" id="ccAllList">Pilih semua hasil (${list.length})</button>
          <span class="cc-count"><strong id="ccSel">${selected.size}</strong> dipilih</span>
          <span class="cc-actions">
            ${batch ? `<button type="button" class="btn btn-sm btn-primary" data-cc="release">🚀 Rilis sekarang</button>
              <button type="button" class="btn btn-sm btn-secondary" data-cc="schedule">🗓️ Jadwalkan…</button>
              <button type="button" class="btn btn-sm btn-ghost" data-cc="unrelease">↩ Tarik rilis</button>` : ''}
            <button type="button" class="btn btn-sm btn-secondary" data-cc="transfer">📤 Salin / Pindahkan…</button>
            ${user.role === 'admin' ? '<button type="button" class="btn btn-sm btn-secondary" data-cc="owner">👤 Ganti pembuat…</button>' : ''}
            <button type="button" class="btn btn-sm btn-ghost" data-cc="clear">Bersihkan</button>
          </span>
        </div>

        ${rows.length ? `<div class="table-wrap"><table class="table cc-table">
          <thead><tr><th></th><th>Konten</th><th>Kelas</th><th>Pembuat</th><th>Dibuat</th>${batch ? `<th>Rilis • ${esc(batch.name)}</th>` : ''}<th>Status</th></tr></thead>
          <tbody>${rows.map(x => {
            const s = stateOf(x);
            const rel = batch && (x.rec.releases || {})[batch.id];
            const can = DB.canReleaseContent(user, x.kind, x.rec);
            return `<tr class="${selected.has(x.key) ? 'is-sel' : ''}">
              <td><input type="checkbox" data-pick="${esc(x.key)}" ${selected.has(x.key) ? 'checked' : ''} aria-label="Pilih ${esc(x.rec.title || '')}" /></td>
              <td><span class="cc-kind">${DB.CONTENT_KINDS[x.kind].icon} ${DB.CONTENT_KINDS[x.kind].label}</span><strong class="cc-title">${esc(x.rec.title || '(tanpa judul)')}</strong>
                ${x.rec.copiedFrom ? '<div class="muted small">📋 salinan</div>' : ''}</td>
              <td class="small">${x.cids.map(id => esc(DB.courseTitle(DB.getCourse(id)))).join('<br>') || '<span class="muted">umum</span>'}</td>
              <td class="small">${DB.isOrphanContent(x.rec) ? '<span class="badge badge-warning">⚠️ akun dihapus</span>' : esc(DB.contentOwnerName(x.rec, DB.getCourse(x.rec.courseId)) || '—')}</td>
              <td class="small">${esc(UI.fmtDate(Number(x.rec.createdAt) || Number(x.rec.recordedAt) || 0))}</td>
              ${batch ? `<td><span class="badge ${STATE_LABEL[s][0]}">${STATE_LABEL[s][1]}</span>
                ${s === 'scheduled' ? `<div class="muted small">buka ${esc(UI.fmtDateTime(rel.at))}</div>` : ''}
                ${s === 'released' ? `<div class="muted small">${esc(UI.fmtDateTime(rel.at))}</div>` : ''}
                ${can && (s === 'archive' || s === 'scheduled') ? `<button type="button" class="btn btn-sm btn-primary" data-one-rel="${esc(x.key)}">🚀 Rilis</button>` : ''}
                ${can && (s === 'released' || s === 'scheduled') ? `<button type="button" class="btn btn-sm btn-ghost" data-one-undo="${esc(x.key)}" title="Tarik rilis">↩</button>` : ''}</td>` : ''}
              <td>${x.rec.active === false ? '<span class="badge badge-gray">⏸ Nonaktif</span>' : '<span class="badge badge-success">Aktif</span>'}</td>
            </tr>`;
          }).join('')}</tbody></table></div>
          <div class="cc-pager">
            <button type="button" class="btn btn-sm btn-secondary" id="ccPrev" ${st.page > 1 ? '' : 'disabled'}>‹ Sebelumnya</button>
            <span class="muted small">Halaman ${st.page} / ${pages} • ${list.length} konten</span>
            <button type="button" class="btn btn-sm btn-secondary" id="ccNext" ${st.page < pages ? '' : 'disabled'}>Berikutnya ›</button>
          </div>`
          : `<div class="empty"><div class="empty-icon">📭</div>${all.length ? 'Tidak ada konten yang cocok dengan filter.' : 'Belum ada konten di kelas Anda.'}</div>`}
      </div>`;

    const rerender = () => render(container, user);
    const go = container.querySelector('#ccGoBatch');
    if (go) go.addEventListener('click', (e) => { e.preventDefault(); Dashboard.navigate('batch'); });
    const bindSel = (id, keyName) => { const el = container.querySelector(id); if (el) el.addEventListener('change', () => { st[keyName] = el.value; st.page = 1; rerender(); }); };
    bindSel('#ccBatch', 'batchId'); bindSel('#ccKind', 'kind'); bindSel('#ccCourse', 'courseId'); bindSel('#ccStatus', 'status'); bindSel('#ccOwner', 'owner');
    const q = container.querySelector('#ccQ');
    let qt = null;
    q.addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { st.q = q.value; st.page = 1; rerender(); const n = container.querySelector('#ccQ'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); });
    const prev = container.querySelector('#ccPrev'); if (prev) prev.addEventListener('click', () => { st.page--; rerender(); });
    const next = container.querySelector('#ccNext'); if (next) next.addEventListener('click', () => { st.page++; rerender(); });
    const selCount = () => { const el = container.querySelector('#ccSel'); if (el) el.textContent = selected.size; };
    container.querySelectorAll('[data-pick]').forEach(cb => cb.addEventListener('change', () => {
      if (cb.checked) selected.add(cb.dataset.pick); else selected.delete(cb.dataset.pick);
      cb.closest('tr').classList.toggle('is-sel', cb.checked);
      selCount();
    }));
    container.querySelector('#ccAllPage').addEventListener('change', (e) => {
      rows.forEach(x => { if (e.target.checked) selected.add(x.key); else selected.delete(x.key); });
      rerender();
    });
    container.querySelector('#ccAllList').addEventListener('click', () => { list.forEach(x => selected.add(x.key)); rerender(); });
    const items = () => [...selected].map(k => { const i = k.indexOf(':'); return { kind: k.slice(0, i), id: k.slice(i + 1) }; });
    const needPick = () => { if (!selected.size) { UI.toast('Pilih minimal satu konten terlebih dahulu.', 'info'); return true; } return false; };
    container.querySelectorAll('[data-one-rel]').forEach(b => b.addEventListener('click', () => doRelease(user, [splitKey(b.dataset.oneRel)], batch, Date.now(), rerender)));
    container.querySelectorAll('[data-one-undo]').forEach(b => b.addEventListener('click', () => {
      if (!UI.confirmDialog(`Tarik rilis? Konten kembali tersembunyi bagi ${batch.name}.`)) return;
      DB.unreleaseContent([splitKey(b.dataset.oneUndo)], batch.id, user);
      UI.toast('Rilis ditarik.', 'info'); rerender();
    }));
    container.querySelectorAll('[data-cc]').forEach(b => b.addEventListener('click', () => {
      const act = b.dataset.cc;
      if (act === 'clear') { selected.clear(); rerender(); return; }
      if (needPick()) return;
      if (act === 'release') {
        if (!UI.confirmDialog(`Rilis ${selected.size} konten untuk ${batch.name} sekarang? Mentee angkatan ini akan diberi notifikasi.`)) return;
        doRelease(user, items(), batch, Date.now(), () => { selected.clear(); rerender(); });
      } else if (act === 'schedule') openSchedule(user, items(), batch, () => { selected.clear(); rerender(); });
      else if (act === 'unrelease') {
        if (!UI.confirmDialog(`Tarik rilis ${selected.size} konten dari ${batch.name}? Konten arsip kembali tersembunyi (konten baru tidak terpengaruh).`)) return;
        const n = DB.unreleaseContent(items(), batch.id, user);
        UI.toast(`${n} rilis ditarik.`, 'info'); selected.clear(); rerender();
      } else if (act === 'transfer') openTransfer(user, items(), () => { selected.clear(); rerender(); });
      else if (act === 'owner') openOwner(user, items(), () => { selected.clear(); rerender(); });
    }));
    if (global.Responsive) Responsive.apply(container);
  }
  function splitKey(k) { const i = k.indexOf(':'); return { kind: k.slice(0, i), id: k.slice(i + 1) }; }

  function doRelease(user, items, batch, at, done) {
    try {
      const r = DB.releaseContent(items, batch.id, at, user);
      UI.toast(r.scheduled
        ? `${r.scheduled} konten dijadwalkan untuk ${batch.name}.`
        : `${r.released} konten dirilis untuk ${batch.name}.${r.skipped.length ? ` ${r.skipped.length} dilewati.` : ''}`, r.skipped.length ? 'info' : 'success');
      done();
    } catch (e) { UI.toast(e.message, 'error'); }
  }

  function openSchedule(user, items, batch, done) {
    const def = new Date(Date.now() + 86400000); def.setHours(7, 0, 0, 0);
    UI.modal.open('Jadwalkan Rilis', `<form id="ccSchedForm" class="form">
      <p class="muted small" style="margin-top:0;">${items.length} konten akan otomatis terbuka bagi mentee <strong>${esc(batch.name)}</strong> pada waktu berikut.</p>
      <div class="form-group"><label for="ccWhen">Buka pada</label><input type="datetime-local" id="ccWhen" required value="${esc(UI.utcToTzInput(def.getTime()))}" /></div>
      <div class="flex-gap" style="justify-content:flex-end;"><button type="button" class="btn btn-secondary" id="ccSchedCancel">Batal</button><button type="submit" class="btn btn-primary">🗓️ Jadwalkan</button></div></form>`);
    document.getElementById('ccSchedCancel').addEventListener('click', () => UI.modal.close());
    document.getElementById('ccSchedForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const ts = UI.tzInputToUtc(document.getElementById('ccWhen').value);
      if (!ts || !isFinite(ts)) { UI.toast('Tanggal tidak valid.', 'error'); return; }
      if (ts <= Date.now()) { UI.toast('Pilih waktu di masa depan, atau gunakan "Rilis sekarang".', 'error'); return; }
      UI.modal.close();
      doRelease(user, items, batch, ts, done);
    });
  }

  function openOwner(user, items, done) {
    const cands = DB.ownerCandidates();
    UI.modal.open('Ganti Pembuat Konten', `<form id="ccOwnForm" class="form">
      <p class="muted small" style="margin-top:0;">${items.length} konten akan dicatat atas nama pembuat baru. Pembuat menentukan siapa yang dapat mengubah konten dan masuk ke rekapan keaktifan tutor.</p>
      <div class="form-group"><label for="ccOwnSel">Pembuat baru</label>
        <select id="ccOwnSel">${cands.map(c => `<option value="${esc(c.id)}">${esc(c.name)}${c.id === DB.ADMIN_OWNER ? ' (manajemen)' : ''}</option>`).join('')}</select></div>
      <label class="check-row"><input type="checkbox" id="ccOwnQ" /> Ganti juga pembuat soal bank yang dipakai tugas/ujian terpilih</label>
      <div class="flex-gap" style="justify-content:flex-end;"><button type="button" class="btn btn-secondary" id="ccOwnCancel">Batal</button><button type="submit" class="btn btn-primary">Simpan Pembuat</button></div></form>`);
    document.getElementById('ccOwnCancel').addEventListener('click', () => UI.modal.close());
    document.getElementById('ccOwnForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const owner = document.getElementById('ccOwnSel').value;
      let list = items.slice();
      if (document.getElementById('ccOwnQ').checked) {
        const qids = new Set();
        items.forEach(it => {
          const rec = getRec(it.kind, it.id);
          if (!rec) return;
          if (it.kind === 'assignment') (rec.questionIds || []).forEach(id => qids.add(id));
          if (it.kind === 'cbt') DB.cbtQuestionIds(rec).forEach(id => qids.add(id));
        });
        list = list.concat([...qids].map(id => ({ kind: 'question', id })));
      }
      try {
        const n = DB.reassignContentOwner(list, owner, user);
        UI.modal.close();
        UI.toast(`${n} data kini tercatat atas nama ${DB.contentOwnerName({ createdBy: owner })}.`);
        done();
      } catch (err) { UI.toast(err.message, 'error'); }
    });
  }

  /* ---------------- Transfer ---------------- */
  function openTransfer(user, items, done) {
    const recs = items.map(it => ({ it, rec: getRec(it.kind, it.id) })).filter(x => x.rec);
    const courses = coursesFor(user).filter(c => c.active !== false || user.role === 'admin');
    const groups = global.Jadwal && Jadwal.groupByMainClass ? Jadwal.groupByMainClass(courses) : [{ name: 'Kelas', courses }];
    const hubs = user.role === 'admin' ? DB.getHubCourses() : [];
    const hasAsg = recs.some(x => x.it.kind === 'assignment');
    const hasCbt = recs.some(x => x.it.kind === 'cbt');
    UI.modal.open(`Salin / Pindahkan ${recs.length} Konten`, `<form id="ccTrForm" class="form cc-transfer">
      <div class="form-group"><label>Cara</label>
        <label class="sec-opt"><input type="radio" name="mode" value="copy" checked /><div><div class="so-nm">📋 Salin</div>
          <div class="so-ds">Konten asli tetap di tempatnya. Salinan baru langsung terlihat di tujuan (pengumpulan/hasil ujian tidak ikut).</div></div></label>
        <label class="sec-opt"><input type="radio" name="mode" value="move" /><div><div class="so-nm">➡️ Pindahkan</div>
          <div class="so-ds">Konten berpindah ke satu kelas tujuan. Tugas yang sudah dikumpulkan & ujian yang sudah dikerjakan tidak dapat dipindah — gunakan Salin.</div></div></label>
      </div>
      <div class="form-group"><label>Tujuan</label>
        <div class="flex-gap"><label class="check-row"><input type="radio" name="dest" value="class" checked /> Kelas subtest</label>
          ${hubs.length ? '<label class="check-row"><input type="radio" name="dest" value="hub" /> Course Mandiri</label>' : ''}</div></div>
      <div id="ccDestClass" class="cc-dest">
        <div class="muted small mb-1">Pilih satu atau beberapa kelas (untuk Pindahkan: satu kelas).</div>
        <div class="cc-targets">${groups.map(g => `<div class="cc-tgroup"><div class="cc-tg-name">🏫 ${esc(g.name === '—' ? 'Tanpa kelas utama' : g.name)}</div>
          ${g.courses.map(c => `<label class="check-row"><input type="checkbox" name="target" value="${esc(c.id)}" /> ${esc(DB.courseTitle(c))}${c.active === false ? ' <span class="badge badge-gray">nonaktif</span>' : ''}</label>`).join('')}</div>`).join('')}</div>
        ${user.role === 'admin' ? `<div class="form-group mt-1"><label for="ccOwnerMode">Pembuat salinan</label><select id="ccOwnerMode">
          <option value="keep">Pertahankan pembuat bila mengajar di kelas tujuan, selain itu tutor kelas tujuan</option>
          <option value="target">Tutor pertama kelas tujuan</option>
          ${DB.ownerCandidates().map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div>`
          : '<div class="muted small mt-1">Salinan dicatat atas nama Anda.</div>'}
        ${hasAsg ? `<div class="form-group"><label for="ccDue">Tenggat tugas salinan (opsional)</label><input type="datetime-local" id="ccDue" />
          <div class="muted small">Kosongkan: memakai tenggat asli bila masih berlaku, atau 7 hari dari sekarang.</div></div>` : ''}
        ${hasCbt ? `<div class="form-group"><label for="ccStart">Mulai ujian salinan (opsional)</label><input type="datetime-local" id="ccStart" />
          <div class="muted small">Durasi jendela ujian dipertahankan. Kosongkan: jadwal asli, atau besok bila sudah lewat.</div></div>` : ''}
        <label class="check-row"><input type="checkbox" id="ccInactive" /> Salin dalam keadaan nonaktif (aktifkan nanti)</label>
      </div>
      ${hubs.length ? `<div id="ccDestHub" class="cc-dest hidden">
        <div class="form-row"><div class="form-group"><label for="ccHub">Course Mandiri</label><select id="ccHub">${hubs.map(h => `<option value="${esc(h.id)}">${esc(h.title)}</option>`).join('')}</select></div>
          <div class="form-group"><label for="ccHubSec">Bab tujuan</label><select id="ccHubSec"></select></div></div>
        <div class="form-group hidden" id="ccHubNewWrap"><label for="ccHubNew">Nama bab baru</label><input id="ccHubNew" maxlength="120" placeholder="mis. Materi dari Kelas 1A" /></div>
        <div class="muted small">Materi → pelajaran Artikel, modul → satu pelajaran per bagian, rekaman → Video/Tautan (https), tugas soal & ujian → Kuis (maks. 60 soal; soal disalin). Konten disalin, aslinya tetap.</div>
      </div>` : ''}
      <ul class="small cc-pick-sum">${recs.slice(0, 8).map(x => `<li>${DB.CONTENT_KINDS[x.it.kind].icon} ${esc(x.rec.title || '(tanpa judul)')}</li>`).join('')}${recs.length > 8 ? `<li class="muted">…dan ${recs.length - 8} lainnya</li>` : ''}</ul>
      <div class="flex-gap" style="justify-content:flex-end;"><button type="button" class="btn btn-secondary" id="ccTrCancel">Batal</button><button type="submit" class="btn btn-primary">📤 Proses</button></div></form>`,
      { fullscreenToggle: true, fullKey: 'cc-transfer' });
    const f = document.getElementById('ccTrForm');
    document.getElementById('ccTrCancel').addEventListener('click', () => UI.modal.close());
    const hubSel = document.getElementById('ccHub');
    const secSel = document.getElementById('ccHubSec');
    const paintSecs = () => {
      if (!hubSel) return;
      const h = DB.getHubCourse(hubSel.value);
      secSel.innerHTML = ((h && h.sections) || []).map(s => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('') + '<option value="__new__">＋ Bab baru…</option>';
      document.getElementById('ccHubNewWrap').classList.toggle('hidden', secSel.value !== '__new__');
    };
    if (hubSel) { hubSel.addEventListener('change', paintSecs); secSel.addEventListener('change', () => document.getElementById('ccHubNewWrap').classList.toggle('hidden', secSel.value !== '__new__')); paintSecs(); }
    f.querySelectorAll('[name="dest"]').forEach(r => r.addEventListener('change', () => {
      const hub = f.querySelector('[name="dest"]:checked').value === 'hub';
      document.getElementById('ccDestClass').classList.toggle('hidden', hub);
      const dh = document.getElementById('ccDestHub'); if (dh) dh.classList.toggle('hidden', !hub);
      f.querySelectorAll('[name="mode"]').forEach(m => { m.disabled = hub && m.value === 'move'; if (hub && m.value === 'copy') m.checked = true; });
    }));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const mode = f.querySelector('[name="mode"]:checked').value;
      const dest = f.querySelector('[name="dest"]:checked').value;
      let report;
      try {
        if (dest === 'hub') {
          const secId = secSel.value;
          const newTitle = (document.getElementById('ccHubNew').value || '').trim();
          if (secId === '__new__' && !newTitle) { UI.toast('Isi nama bab baru.', 'error'); return; }
          report = copyToHub(recs, hubSel.value, secId, newTitle, user);
        } else {
          const targets = [...f.querySelectorAll('[name="target"]:checked')].map(x => x.value);
          if (!targets.length) { UI.toast('Pilih kelas tujuan.', 'error'); return; }
          if (mode === 'move' && targets.length !== 1) { UI.toast('Pindahkan hanya ke satu kelas tujuan.', 'error'); return; }
          const due = document.getElementById('ccDue') && document.getElementById('ccDue').value ? UI.tzInputToUtc(document.getElementById('ccDue').value) : 0;
          const start = document.getElementById('ccStart') && document.getElementById('ccStart').value ? UI.tzInputToUtc(document.getElementById('ccStart').value) : 0;
          if (due && due <= Date.now()) { UI.toast('Tenggat tugas harus di masa depan.', 'error'); return; }
          if (mode === 'move' && !UI.confirmDialog(`Pindahkan ${recs.length} konten? Mentee kelas asal tidak akan melihatnya lagi.`)) return;
          report = DB.transferContent({
            items: recs.map(x => x.it), mode, targetCourseIds: targets,
            owner: document.getElementById('ccOwnerMode') ? document.getElementById('ccOwnerMode').value : 'keep',
            dueAt: due, startAt: start, inactive: document.getElementById('ccInactive').checked
          }, user);
        }
      } catch (err) { UI.toast(err.message, 'error'); return; }
      UI.modal.open('Hasil Transfer', `<div class="alert ${report.skipped.length ? 'alert-warning' : 'alert-success'}">
          ${report.copied ? `📋 <strong>${report.copied}</strong> salinan dibuat. ` : ''}${report.moved ? `➡️ <strong>${report.moved}</strong> dipindahkan. ` : ''}${report.lessons ? `📚 <strong>${report.lessons}</strong> pelajaran ditambahkan ke Course Mandiri. ` : ''}
          ${report.shifted ? `<div class="small mt-1">🗓️ ${report.shifted} tugas/ujian yang jadwalnya sudah lewat digeser ke tanggal baru — periksa kembali di kelas tujuan.</div>` : ''}</div>
        ${report.skipped.length ? `<div class="small"><strong>Dilewati (${report.skipped.length}):</strong><ul>${report.skipped.map(x => `<li>${esc(x.title || '')} — ${esc(x.reason)}</li>`).join('')}</ul></div>` : ''}
        <div class="flex-gap" style="justify-content:flex-end;"><button type="button" class="btn btn-primary" id="ccTrOk">Selesai</button></div>`);
      document.getElementById('ccTrOk').addEventListener('click', () => UI.modal.close());
      done();
    });
  }

  /* Salin soal bank menjadi soal kuis Course Mandiri (snapshot, tidak menunjuk bank). */
  const Q_FIELDS = ['text', 'options', 'correctIndex', 'correctIndices', 'answers', 'numeric', 'numericTolerance', 'shortAnswerPolicy',
    'statements', 'columns', 'pairs', 'orderItems', 'keywords', 'explanation', 'subject', 'difficulty'];
  function quizQuestionsFrom(ids) {
    return (ids || []).map(id => DB.getQuestion(id)).filter(Boolean).map(src => {
      const out = { id: nid('hq'), sourceId: src.id, questionType: DB.hubQType(src) };
      Q_FIELDS.forEach(k => { if (src[k] !== undefined && src[k] !== null) out[k] = JSON.parse(JSON.stringify(src[k])); });
      if (out.questionType === 'Benar/Salah' && !(out.options || []).length) out.options = ['Benar', 'Salah'];
      return out;
    }).filter(q => !DB.hubQuestionProblem(q));
  }
  const isVideoUrl = (u) => /(youtube\.com\/watch|youtu\.be\/|vimeo\.com\/)/i.test(u || '');
  function linkBlock(url, label) {
    if (!/^https?:\/\//i.test(url || '')) return '';
    return `<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(label || url)}</a></p>`;
  }

  /** Ubah konten kelas menjadi pelajaran Course Mandiri (khusus admin). */
  function copyToHub(recs, hubId, secId, newTitle, user) {
    if (user.role !== 'admin') throw new Error('Hanya admin yang dapat menyalin ke Course Mandiri.');
    const hub = JSON.parse(JSON.stringify(DB.getHubCourse(hubId) || null));
    if (!hub) throw new Error('Course Mandiri tidak ditemukan.');
    hub.sections = hub.sections || [];
    let sec = hub.sections.find(s => s.id === secId);
    if (!sec) { sec = { id: nid('sec'), title: newTitle || 'Bab baru', lessons: [] }; hub.sections.push(sec); }
    sec.lessons = sec.lessons || [];
    const now = Date.now();
    const report = { copied: 0, moved: 0, lessons: 0, skipped: [], shifted: 0 };
    const base = (title, extra) => Object.assign({ id: nid('les'), title: String(title || 'Pelajaran').slice(0, 140), durationMin: 5, dripDays: 0, active: true,
      createdAt: now, content: '', url: '', questions: [], passScore: 70, copiedFrom: extra.copiedFrom }, extra);
    recs.forEach(({ it, rec }) => {
      const from = { copiedFrom: { kind: it.kind, id: rec.id, courseId: rec.courseId || null, at: now } };
      const add = (l) => { sec.lessons.push(l); report.lessons++; };
      if (it.kind === 'material') {
        add(base(rec.title, Object.assign({ type: 'article', content: (rec.content || '') + linkBlock(rec.link, 'Buka tautan materi') }, from)));
      } else if (it.kind === 'module') {
        const parts = (rec.sections || []).filter(s => s && (s.title || s.content));
        if (!parts.length) add(base(rec.title, Object.assign({ type: 'article', content: (rec.description ? `<p>${esc(rec.description)}</p>` : '') + linkBlock(rec.link, 'Buka modul') }, from)));
        else parts.forEach((p, i) => add(base(`${rec.title} — ${p.title || 'Bagian ' + (i + 1)}`, Object.assign({ type: 'article', content: (i === 0 && rec.description ? `<p>${esc(rec.description)}</p>` : '') + (p.content || '') }, from))));
      } else if (it.kind === 'recording') {
        const url = String(rec.url || '').trim();
        const mins = Math.max(0, Math.round((Number(rec.duration) || 0) / 60));
        if (/^https:\/\//i.test(url)) add(base(rec.title, Object.assign({ type: isVideoUrl(url) ? 'video' : 'link', url, durationMin: mins || 5, content: rec.notes ? `<p>${esc(rec.notes)}</p>` : '' }, from)));
        else add(base(rec.title, Object.assign({ type: 'article', content: (rec.notes ? `<p>${esc(rec.notes)}</p>` : '') + linkBlock(url, 'Buka rekaman') }, from)));
      } else if (it.kind === 'assignment') {
        const qs = rec.mode === 'soal' ? quizQuestionsFrom(rec.questionIds) : [];
        if (qs.some(q => q.questionType !== 'Esai') && qs.length <= 60) add(base(rec.title, Object.assign({ type: 'quiz', content: rec.description || '', questions: qs }, from)));
        else if (rec.mode === 'soal' && qs.length > 60) report.skipped.push({ title: rec.title, reason: 'lebih dari 60 soal' });
        else add(base(rec.title, Object.assign({ type: 'article', content: rec.description || '' }, from)));
      } else if (it.kind === 'cbt') {
        const qs = quizQuestionsFrom(DB.cbtQuestionIds(rec));
        if (qs.length > 60) report.skipped.push({ title: rec.title, reason: 'lebih dari 60 soal (batas kuis course)' });
        else if (!qs.some(q => q.questionType !== 'Esai')) report.skipped.push({ title: rec.title, reason: 'tidak ada soal yang dapat dinilai otomatis' });
        else add(base(rec.title, Object.assign({ type: 'quiz', content: rec.description ? `<p>${esc(rec.description)}</p>` : '', questions: qs }, from)));
      }
    });
    if (!report.lessons) return report;
    DB.saveHubCourse(hub, user);
    return report;
  }

  global.ContentCenter = { render, preset };
})(window);
