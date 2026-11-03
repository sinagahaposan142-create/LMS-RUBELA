/* =====================================================================
 * js/visibility.js — kontrol Aktif / Matikan / Aktifkan ulang + rilis angkatan
 * ---------------------------------------------------------------------
 * Dipakai tab konten kelas (tutor & admin), daftar CBT, dan daftar kelas.
 * - Matikan    : konten disembunyikan dari siswa & orang tua (tidak dapat
 *                dibuka/dikerjakan); riwayat yang sudah ada tetap tersimpan.
 * - Aktifkan   : tampil lagi.
 * - Aktifkan ulang (khusus kelas berkebijakan "siswa baru mulai dari
 *   konten baru"): membuka konten lama untuk siswa yang bergabung belakangan.
 * - Rilis angkatan: pada angkatan berstatus "rilis bertahap", konten arsip
 *   angkatan lama tersembunyi sampai dirilis (🚀 Rilis / ↩ tarik kembali).
 * Izin diperiksa ulang di lapisan data (DB.setContentActive,
 * DB.reactivateContent, DB.releaseContent, DB.unreleaseContent).
 * ===================================================================*/
(function (global) {
  'use strict';
  const esc = (s) => UI.esc(s);

  function badge(rec) {
    return rec && rec.active === false ? '<span class="badge badge-gray vis-badge" title="Tidak terlihat oleh siswa">⏸ Nonaktif</span>' : '';
  }

  /** Lencana status rilis untuk tiap angkatan bertahap yang masih berjalan. */
  function releaseHtml(kind, rec, user) {
    if (!rec || kind === 'course' || !user || (user.role !== 'admin' && user.role !== 'guru')) return '';
    const batches = DB.activeBatches().filter(DB.isStagedBatch);
    if (!batches.length) return '';
    const can = DB.canReleaseContent(user, kind, rec);
    const ref = `${esc(kind)}:${esc(rec.id)}`;
    return batches.map(b => {
      const s = DB.contentBatchState(rec, b);
      if (s === 'new' || s === 'open') return '';
      const rel = (rec.releases || {})[b.id] || {};
      if (s === 'released') {
        return `<span class="badge badge-info rel-badge" title="Dirilis ${esc(UI.fmtDateTime(rel.at))}">🔓 ${esc(b.name)}</span>${can
          ? `<button type="button" class="btn btn-sm btn-ghost" data-rel-undo="${ref}" data-batch="${esc(b.id)}" title="Sembunyikan lagi dari ${esc(b.name)}">↩</button>` : ''}`;
      }
      if (s === 'scheduled') {
        return `<span class="badge badge-warning rel-badge" title="Terbuka otomatis pada waktunya">🗓️ ${esc(b.name)} • ${esc(UI.fmtDateTime(rel.at))}</span>${can
          ? `<button type="button" class="btn btn-sm btn-ghost" data-rel-now="${ref}" data-batch="${esc(b.id)}">Buka sekarang</button>` : ''}`;
      }
      return `<span class="badge badge-gray rel-badge" title="Dibuat sebelum ${esc(UI.fmtYMD(b.archiveBefore || b.startDate))} — tersembunyi bagi mentee ${esc(b.name)}">🔒 Arsip • ${esc(b.name)}</span>${can
        ? `<button type="button" class="btn btn-sm btn-primary" data-rel-now="${ref}" data-batch="${esc(b.id)}" title="Tampilkan untuk mentee ${esc(b.name)}">🚀 Rilis</button>` : ''}`;
    }).join('');
  }

  function controlsHtml(kind, rec, user) {
    const rel = releaseHtml(kind, rec, user);
    if (!rec || !DB.canToggleContent(kind, rec, user)) return badge(rec) + (rel ? `<span class="vis-ctrl">${rel}</span>` : '');
    const on = rec.active !== false;
    const course = rec.courseId ? DB.getCourse(rec.courseId) : null;
    const policy = course && course.newStudentPolicy === 'fromJoin';
    return `<span class="vis-ctrl">${badge(rec)}
      <button type="button" class="btn btn-sm ${on ? 'btn-secondary' : 'btn-primary'}" data-vis-toggle="${esc(kind)}:${esc(rec.id)}" data-on="${on ? 1 : 0}"
        title="${on ? 'Sembunyikan dari siswa' : 'Tampilkan kembali untuk siswa'}">${on ? '⏸ Matikan' : '▶ Aktifkan'}</button>
      ${policy ? `<button type="button" class="btn btn-sm btn-ghost" data-vis-re="${esc(kind)}:${esc(rec.id)}"
        title="Buka juga untuk siswa yang bergabung setelah konten ini dibuat">🔄 Aktifkan ulang${rec.reactivatedAt ? ` <span class="muted small">(${UI.fmtDate(rec.reactivatedAt)})</span>` : ''}</button>` : ''}
      ${rel}
    </span>`;
  }

  function bind(root, user, onChange) {
    if (!root) return;
    root.__visChange = onChange;
    if (root.__visBound) return;
    root.__visBound = true;
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-vis-toggle],[data-vis-re],[data-rel-now],[data-rel-undo]');
      if (!t || !root.contains(t)) return;
      e.stopPropagation();
      const raw = t.dataset.visToggle || t.dataset.visRe || t.dataset.relNow || t.dataset.relUndo;
      const i = raw.indexOf(':');
      const kind = raw.slice(0, i), id = raw.slice(i + 1);
      try {
        if (t.dataset.relNow || t.dataset.relUndo) {
          const b = DB.getBatch(t.dataset.batch);
          if (!b) throw new Error('Angkatan tidak ditemukan.');
          if (t.dataset.relUndo) {
            if (!UI.confirmDialog(`Tarik rilis? Konten kembali menjadi arsip dan tersembunyi bagi mentee ${b.name}.`)) return;
            DB.unreleaseContent([{ kind, id }], b.id, user);
            UI.toast(`Rilis ditarik — kembali menjadi arsip bagi ${b.name}.`, 'info');
          } else {
            const r = DB.releaseContent([{ kind, id }], b.id, Date.now(), user);
            if (r.skipped.length) throw new Error(r.skipped[0].reason || 'Konten tidak dapat dirilis.');
            UI.toast(`Konten dirilis untuk ${b.name}. Mentee angkatan ini diberi notifikasi.`);
          }
        } else if (t.dataset.visRe) {
          if (!UI.confirmDialog('Aktifkan ulang konten ini? Siswa yang bergabung setelah konten dibuat juga akan dapat melihat & mengerjakannya.')) return;
          DB.reactivateContent(kind, id, user);
          UI.toast('Konten diaktifkan ulang untuk siswa baru.');
        } else {
          const on = t.dataset.on === '1';
          if (on && !UI.confirmDialog('Matikan konten ini? Siswa dan orang tua tidak akan melihatnya sampai diaktifkan kembali.')) return;
          DB.setContentActive(kind, id, !on, user);
          UI.toast(on ? 'Konten dinonaktifkan.' : 'Konten diaktifkan.');
        }
        if (typeof root.__visChange === 'function') root.__visChange();
      } catch (err) { UI.toast(err.message, 'error'); }
    });
  }

  global.Visibility = { controlsHtml, bind, badge, releaseHtml };
})(window);
