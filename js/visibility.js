/* =====================================================================
 * js/visibility.js — kontrol Aktif / Matikan / Aktifkan ulang
 * ---------------------------------------------------------------------
 * Dipakai tab konten kelas (tutor & admin), daftar CBT, dan daftar kelas.
 * - Matikan    : konten disembunyikan dari siswa & orang tua (tidak dapat
 *                dibuka/dikerjakan); riwayat yang sudah ada tetap tersimpan.
 * - Aktifkan   : tampil lagi.
 * - Aktifkan ulang (khusus kelas berkebijakan "siswa baru mulai dari
 *   konten baru"): membuka konten lama untuk siswa yang bergabung belakangan.
 * Izin diperiksa ulang di DB.setContentActive / DB.reactivateContent.
 * ===================================================================*/
(function (global) {
  'use strict';
  const esc = (s) => UI.esc(s);

  function badge(rec) {
    return rec && rec.active === false ? '<span class="badge badge-gray vis-badge" title="Tidak terlihat oleh siswa">⏸ Nonaktif</span>' : '';
  }

  function controlsHtml(kind, rec, user) {
    if (!rec || !DB.canToggleContent(kind, rec, user)) return badge(rec);
    const on = rec.active !== false;
    const course = rec.courseId ? DB.getCourse(rec.courseId) : null;
    const policy = course && course.newStudentPolicy === 'fromJoin';
    return `<span class="vis-ctrl">${badge(rec)}
      <button type="button" class="btn btn-sm ${on ? 'btn-secondary' : 'btn-primary'}" data-vis-toggle="${esc(kind)}:${esc(rec.id)}" data-on="${on ? 1 : 0}"
        title="${on ? 'Sembunyikan dari siswa' : 'Tampilkan kembali untuk siswa'}">${on ? '⏸ Matikan' : '▶ Aktifkan'}</button>
      ${policy ? `<button type="button" class="btn btn-sm btn-ghost" data-vis-re="${esc(kind)}:${esc(rec.id)}"
        title="Buka juga untuk siswa yang bergabung setelah konten ini dibuat">🔄 Aktifkan ulang${rec.reactivatedAt ? ` <span class="muted small">(${UI.fmtDate(rec.reactivatedAt)})</span>` : ''}</button>` : ''}
    </span>`;
  }

  function bind(root, user, onChange) {
    if (!root) return;
    root.__visChange = onChange;
    if (root.__visBound) return;
    root.__visBound = true;
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-vis-toggle],[data-vis-re]');
      if (!t || !root.contains(t)) return;
      e.stopPropagation();
      const raw = t.dataset.visToggle || t.dataset.visRe;
      const i = raw.indexOf(':');
      const kind = raw.slice(0, i), id = raw.slice(i + 1);
      try {
        if (t.dataset.visRe) {
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

  global.Visibility = { controlsHtml, bind, badge };
})(window);
