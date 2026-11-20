/* =========================================================================
 * Remedial — ujian ulang untuk peserta yang belum mencapai KKM.
 *
 * Model data:
 *  - Pengaturan global (lms_settings): remedialEnabled (bool, bawaan aktif),
 *    remedialDefaults { kkm, kkmIrt, policy }.
 *  - Ujian induk (lms_cbts): remedialConfig { kkm, policy } — KKM memakai
 *    skala ujian itu (persen 0–100 untuk Poin/Legacy, 200–800 untuk IRT).
 *  - Setiap putaran remedial adalah ujian tersendiri (lms_cbts) dengan
 *    remedialOf = id induk, remedialRound = 1, 2, …, targetStudentIds = peserta,
 *    startAt/endAt = jadwal remedial, soal & penilaian disalin dari induk.
 *    Dengan begitu aturan "satu percobaan per ujian" dan semua rekap lama
 *    tetap benar. Skor IRT remedial dikalibrasi bersama peserta ujian induk
 *    (js/scoring.js) agar skalanya sebanding.
 *  - Server menolak percobaan remedial dari siswa yang tidak terdaftar,
 *    di luar jadwal, atau saat sistem remedial dimatikan (api/_lib/rules.js).
 *
 * Nilai akhir per siswa (kebijakan):
 *  - cap     : nilai remedial dibatasi setinggi KKM (lazim di sekolah), ambil tertinggi
 *  - max     : ambil nilai tertinggi dari ujian awal dan semua remedial
 *  - replace : nilai remedial terakhir menggantikan nilai awal
 * =======================================================================*/
(function (global) {
  'use strict';

  const esc = (s) => UI.esc(s);
  const POLICIES = {
    cap: { label: 'Nilai remedial maksimal KKM', desc: 'Nilai remedial dibatasi setinggi KKM; nilai akhir adalah yang tertinggi.' },
    max: { label: 'Ambil nilai tertinggi', desc: 'Nilai akhir adalah nilai tertinggi dari ujian awal dan semua remedial.' },
    replace: { label: 'Nilai remedial menggantikan', desc: 'Nilai remedial terakhir menjadi nilai akhir, walaupun lebih rendah.' }
  };
  const GRACE_MS = 10 * 60 * 1000;     // samakan dengan toleransi server

  /* ---------------------------- pengaturan ---------------------------- */
  function enabled() { return DB.getSettings().remedialEnabled !== false; }
  function defaults() {
    const d = DB.getSettings().remedialDefaults || {};
    return {
      kkm: clampNum(d.kkm, 0, 100, 75),
      kkmIrt: clampNum(d.kkmIrt, 200, 800, 500),
      policy: POLICIES[d.policy] ? d.policy : 'cap'
    };
  }
  function clampNum(v, lo, hi, fb) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fb;
  }

  /* ---------------------------- skala nilai ---------------------------- */
  const isRemedial = (cbt) => !!(cbt && cbt.remedialOf);
  const parentOf = (cbt) => (isRemedial(cbt) ? DB.getCbt(cbt.remedialOf) : null);
  /** 'irt' (200–800) untuk ujian bersistem IRT, selain itu 'percent' (0–100). */
  function basisOf(cbt) {
    return global.Scoring && Scoring.modeOf(cbt) === 'irt' ? 'irt' : 'percent';
  }
  const scaleText = (basis) => (basis === 'irt' ? 'skala 200–800' : 'skala 0–100');
  function fmt(v, basis) {
    if (v == null) return '–';
    return basis === 'irt' ? String(Math.round(v)) : (Math.round(v * 10) / 10).toLocaleString('id-ID');
  }
  /** Nilai satu percobaan pada skala basis (null = belum ada/menunggu esai). */
  function valueOf(attempt, basis) {
    if (!attempt || !attempt.submittedAt) return null;
    const a = global.Scoring ? Scoring.ensureFresh(attempt) : attempt;
    if (basis === 'irt') return a.scoring && a.scoring.scaled200_800 != null ? a.scoring.scaled200_800 : null;
    if (a.scoring && a.scoring.mode !== 'irt' && a.scoring.points) return a.scoring.points.pending ? null : a.scoring.points.percent;
    return a.score == null ? null : Number(a.score);
  }
  function configOf(parent) {
    const d = defaults();
    const c = (parent && parent.remedialConfig) || {};
    const basis = basisOf(parent);
    return {
      basis,
      kkm: basis === 'irt' ? clampNum(c.kkm, 200, 800, d.kkmIrt) : clampNum(c.kkm, 0, 100, d.kkm),
      policy: POLICIES[c.policy] ? c.policy : d.policy,
      saved: !!parent && !!parent.remedialConfig
    };
  }

  /* ---------------------------- putaran ---------------------------- */
  function roundsOf(parent) {
    if (!parent) return [];
    return DB.getCbts().filter(c => c.remedialOf === parent.id).sort((a, b) => (a.remedialRound || 0) - (b.remedialRound || 0));
  }
  function roundState(r, now) {
    const t = now || Date.now();
    if (t < r.startAt) return 'upcoming';
    if (t > r.endAt) return 'closed';
    return 'open';
  }
  function targetedStudents(cbt) {
    return DB.getUsers().filter(u => u.role === 'siswa' && (u.status || 'Aktif') === 'Aktif' && DB.cbtTargetsStudent(cbt, u));
  }

  /**
   * Ringkasan nilai satu siswa untuk ujian induk.
   * @returns {{original, rounds:[{round, cbt, state, value, done, scheduled}], final, passed, status}}
   */
  function summaryFor(parent, studentId, cfgIn) {
    const cfg = cfgIn || configOf(parent);
    const orig = DB.getCbtAttemptByStudent(parent.id, studentId);
    const original = valueOf(orig, cfg.basis);
    const rounds = roundsOf(parent).filter(r => (r.targetStudentIds || []).includes(studentId)).map(r => {
      const at = DB.getCbtAttemptByStudent(r.id, studentId);
      return { round: r.remedialRound || 1, cbt: r, state: roundState(r), value: valueOf(at, cfg.basis), done: !!(at && at.submittedAt) };
    });
    const remVals = rounds.filter(r => r.done && r.value != null);
    let final = original;
    if (remVals.length) {
      if (cfg.policy === 'replace') final = remVals[remVals.length - 1].value;
      else {
        const vals = remVals.map(r => (cfg.policy === 'cap' ? Math.min(r.value, cfg.kkm) : r.value));
        final = Math.max(original == null ? -Infinity : original, ...vals);
      }
    }
    if (final === -Infinity) final = null;
    const pending = rounds.find(r => !r.done && r.state !== 'closed');
    const passed = final != null && final >= cfg.kkm;
    let status;
    if (passed) status = remVals.length ? 'tuntas-remedial' : 'tuntas';
    else if (pending) status = 'terjadwal';
    else if (!orig || !orig.submittedAt) status = remVals.length ? 'belum-tuntas' : 'tidak-ikut';
    else status = 'belum-tuntas';
    return { original, rounds, final, passed, status, pending: pending || null, cfg };
  }
  const STATUS = {
    tuntas: ['Tuntas', 'badge-success'],
    'tuntas-remedial': ['Tuntas (remedial)', 'badge-success'],
    terjadwal: ['Terjadwal remedial', 'badge-info'],
    'belum-tuntas': ['Belum tuntas', 'badge-warning'],
    'tidak-ikut': ['Tidak mengikuti', 'badge-gray']
  };
  const statusBadge = (st) => { const s = STATUS[st] || STATUS['belum-tuntas']; return `<span class="badge ${s[1]}">${s[0]}</span>`; };

  /* ---------------------------- tulis ---------------------------- */
  function canManage(user, parent) {
    if (!user || !parent) return false;
    if (user.role === 'admin') return true;
    return user.role === 'guru' && DB.canManageContent(user, parent, DB.getCourse(parent.courseId));
  }

  function saveConfig(parent, cfg, user) {
    if (!canManage(user, parent)) throw new Error('Anda tidak berhak mengatur remedial ujian ini.');
    const basis = basisOf(parent);
    const kkm = Number(cfg.kkm);
    if (!Number.isFinite(kkm)) throw new Error('KKM wajib diisi angka.');
    if (basis === 'irt' ? (kkm < 200 || kkm > 800) : (kkm < 0 || kkm > 100)) throw new Error(`KKM harus di ${scaleText(basis)}.`);
    if (!POLICIES[cfg.policy]) throw new Error('Kebijakan nilai akhir tidak valid.');
    return DB.updateCbt(parent.id, { remedialConfig: { kkm, policy: cfg.policy, updatedAt: Date.now(), updatedBy: user.id } });
  }

  function validWindow(startAt, endAt) {
    if (!(Number.isFinite(startAt) && Number.isFinite(endAt))) throw new Error('Isi tanggal mulai dan selesai remedial.');
    if (endAt <= startAt) throw new Error('Waktu selesai remedial harus setelah waktu mulai.');
    if (endAt < Date.now()) throw new Error('Waktu selesai remedial sudah lewat.');
  }

  function createRound(parent, o, user) {
    if (!enabled()) throw new Error('Sistem remedial sedang dimatikan admin.');
    if (!canManage(user, parent)) throw new Error('Anda tidak berhak membuat remedial ujian ini.');
    const ids = [...new Set(o.studentIds || [])];
    if (!ids.length) throw new Error('Pilih minimal satu peserta remedial.');
    validWindow(o.startAt, o.endAt);
    const round = roundsOf(parent).reduce((m, r) => Math.max(m, r.remedialRound || 0), 0) + 1;
    const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
    const sections = DB.cbtSections(parent);
    const rec = {
      title: `Remedial ${round} — ${parent.title}`,
      description: parent.description || '',
      targetClasses: [],
      courseIds: (parent.courseIds || []).slice(),
      courseId: parent.courseId || null,
      subtestMode: parent.subtestMode || 'custom',
      selectedSubtest: parent.selectedSubtest || null,
      sections: clone(sections),
      questionIds: sections.flatMap(s => s.questionIds),
      durationMinutes: sections.reduce((n, s) => n + (Number(s.durationMinutes) || 0), 0) || parent.durationMinutes,
      security: clone(parent.security || {}),
      scoringMode: parent.scoringMode || 'irt',
      pointsBasis: parent.pointsBasis, packageTotal: parent.packageTotal, wrongPoints: parent.wrongPoints,
      points: clone(parent.points || {}),
      startAt: o.startAt, endAt: o.endAt,
      remedialOf: parent.id, remedialRound: round, targetStudentIds: ids,
      active: true
    };
    const created = DB.addCbt(DB.stampCreator(rec, user, parent.createdBy || null));
    if (o.notify !== false) notify(created, parent, ids);
    DB.logActivity('cbt.remedial', `Membuat remedial ${round} untuk "${parent.title}" (${ids.length} peserta)`, created.id);
    return created;
  }

  function updateRound(round, o, user) {
    const parent = parentOf(round);
    if (!parent || !canManage(user, parent)) throw new Error('Anda tidak berhak mengubah remedial ini.');
    const ids = [...new Set(o.studentIds || [])];
    if (!ids.length) throw new Error('Pilih minimal satu peserta remedial.');
    validWindow(o.startAt, o.endAt);
    const took = new Set(DB.getCbtAttemptsByCbt(round.id).map(a => a.studentId));
    // Peserta yang sudah mulai mengerjakan tidak boleh dikeluarkan (hasilnya tetap tercatat).
    took.forEach(id => { if (!ids.includes(id)) ids.push(id); });
    const added = ids.filter(id => !(round.targetStudentIds || []).includes(id));
    const changedTime = round.startAt !== o.startAt || round.endAt !== o.endAt;
    const saved = DB.updateCbt(round.id, DB.stampEditor({ targetStudentIds: ids, startAt: o.startAt, endAt: o.endAt }, user));
    if (o.notify !== false) notify(saved, parent, changedTime ? ids.filter(id => !took.has(id)) : added, changedTime && !added.length);
    return saved;
  }

  function deleteRound(round, user) {
    const parent = parentOf(round);
    if (!parent || !canManage(user, parent)) throw new Error('Anda tidak berhak menghapus remedial ini.');
    DB.deleteCbt(round.id);
  }

  function notify(round, parent, ids, rescheduled) {
    if (!ids || !ids.length) return;
    const when = `${UI.fmtDateTime(round.startAt)} – ${UI.fmtDateTime(round.endAt)}`;
    const payload = {
      type: 'cbt', icon: '🔁', link: 'cbt',
      title: rescheduled ? `Jadwal remedial diubah` : `Remedial ${round.remedialRound}: ${parent.title}`,
      body: rescheduled ? `${parent.title}: ${when}` : `Jadwal: ${when}. Kerjakan lewat menu CBT/Ujian.`
    };
    ids.forEach(id => DB.notifyStudentAndParents(id, payload, { link: 'anak-nilai', title: `Anak Anda dijadwalkan remedial: ${parent.title}` }));
  }

  /* ---------------------------- tampilan admin ---------------------------- */
  /** Kartu pengaturan global di halaman CBT (admin). */
  function settingsCardHtml(user) {
    if (!user || user.role !== 'admin') return '';
    const on = enabled();
    const d = defaults();
    return `<div class="card rm-settings">
      <div class="rm-set-head">
        <div>${UI.secHead('🔁', 'Sistem Remedial', on ? 'Aktif — remedial dapat dibuat dari halaman Hasil tiap ujian' : 'Nonaktif — tombol remedial disembunyikan dan ujian remedial tidak dapat dikerjakan')}</div>
        <label class="rm-switch"><input type="checkbox" id="rmEnabled" ${on ? 'checked' : ''} role="switch" aria-checked="${on}" />
          <span class="rm-switch-ui" aria-hidden="true"></span><span class="rm-switch-txt">${on ? 'Aktif' : 'Nonaktif'}</span></label>
      </div>
      <details class="rm-defaults">
        <summary>Nilai bawaan untuk ujian baru</summary>
        <form id="rmDefForm" class="rm-def-grid">
          <div class="form-group"><label for="rmDefKkm">KKM ujian Poin (0–100)</label><input type="number" id="rmDefKkm" min="0" max="100" step="0.5" value="${d.kkm}" /></div>
          <div class="form-group"><label for="rmDefIrt">KKM ujian IRT (200–800)</label><input type="number" id="rmDefIrt" min="200" max="800" step="1" value="${d.kkmIrt}" /></div>
          <div class="form-group"><label for="rmDefPolicy">Nilai akhir setelah remedial</label>
            <select id="rmDefPolicy">${Object.entries(POLICIES).map(([k, p]) => `<option value="${k}" ${d.policy === k ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></div>
          <div class="rm-def-act"><button type="submit" class="btn btn-sm btn-primary">Simpan bawaan</button></div>
        </form>
      </details>
    </div>`;
  }
  function bindSettings(root, user, onChange) {
    const t = root.querySelector('#rmEnabled');
    if (!t) return;
    t.addEventListener('change', () => {
      const on = t.checked;
      if (!on && !UI.confirmDialog('Matikan sistem remedial? Ujian remedial yang belum dikerjakan tidak akan dapat dibuka siswa sampai sistem diaktifkan kembali. Hasil yang sudah ada tetap tersimpan.')) {
        t.checked = true;
        return;
      }
      DB.setSetting('remedialEnabled', on);
      UI.toast(on ? 'Sistem remedial diaktifkan.' : 'Sistem remedial dimatikan.', 'success');
      if (typeof onChange === 'function') onChange();
    });
    const f = root.querySelector('#rmDefForm');
    if (f) f.addEventListener('submit', (e) => {
      e.preventDefault();
      DB.setSetting('remedialDefaults', {
        kkm: clampNum(f.querySelector('#rmDefKkm').value, 0, 100, 75),
        kkmIrt: clampNum(f.querySelector('#rmDefIrt').value, 200, 800, 500),
        policy: f.querySelector('#rmDefPolicy').value
      });
      UI.toast('Nilai bawaan remedial disimpan.', 'success');
    });
  }

  /** Label di daftar CBT (admin/tutor). */
  function listLabelHtml(cbt) {
    if (isRemedial(cbt)) {
      const p = parentOf(cbt);
      return `<div class="small rm-tag">Remedial ke-${cbt.remedialRound || 1}${p ? ` dari <em>${esc(p.title)}</em>` : ' (ujian induk dihapus)'}</div>`;
    }
    const n = roundsOf(cbt).length;
    return n ? `<div class="small rm-tag">${n} putaran remedial</div>` : '';
  }

  /** Kartu remedial di halaman Hasil ujian induk. */
  function resultsCardHtml(parent, user) {
    if (isRemedial(parent)) {
      const p = parentOf(parent);
      return `<div class="alert alert-info rm-note">Ini <strong>remedial ke-${parent.remedialRound || 1}</strong>${p ? ` untuk ujian <strong>${esc(p.title)}</strong>` : ''}.
        Skor IRT dikalibrasi bersama peserta ujian awal. ${p ? `<button type="button" class="btn btn-sm btn-secondary" data-rm-parent="${esc(p.id)}">Buka hasil ujian awal</button>` : ''}</div>`;
    }
    const rounds = roundsOf(parent);
    if (!enabled()) {
      return rounds.length || user.role === 'admin'
        ? `<div class="alert alert-info small">Sistem remedial sedang <strong>dimatikan</strong>${user.role === 'admin' ? ' — aktifkan di halaman CBT / Ujian.' : ' oleh admin.'}</div>` : '';
    }
    const cfg = configOf(parent);
    const students = participantsOf(parent);
    const sums = students.map(s => summaryFor(parent, s.id, cfg));
    const tuntas = sums.filter(x => x.passed).length;
    const below = sums.filter(x => !x.passed && x.status !== 'tidak-ikut').length;
    const absent = sums.filter(x => x.status === 'tidak-ikut').length;
    const can = canManage(user, parent);
    return `<div class="card rm-card">
      <div class="card-header">${UI.secHead('🔁', 'Remedial', `KKM ${fmt(cfg.kkm, cfg.basis)} (${scaleText(cfg.basis)}) • ${POLICIES[cfg.policy].label}${cfg.saved ? '' : ' • nilai bawaan'}`)}
        ${can ? `<button type="button" class="btn btn-sm btn-primary" data-rm-open="${esc(parent.id)}">${rounds.length ? 'Kelola remedial' : 'Atur remedial'}</button>` : ''}</div>
      <div class="rm-stats">
        <div><strong>${tuntas}</strong><span>tuntas</span></div>
        <div><strong>${below}</strong><span>di bawah KKM</span></div>
        <div><strong>${absent}</strong><span>tidak mengikuti</span></div>
        <div><strong>${rounds.length}</strong><span>putaran remedial</span></div>
      </div>
      ${rounds.length ? `<ul class="rm-rounds">${rounds.map(r => roundRowHtml(r)).join('')}</ul>` : ''}
    </div>`;
  }
  function roundInnerHtml(r) {
    const st = roundState(r);
    const done = DB.getCbtAttemptsByCbt(r.id).filter(a => a.submittedAt).length;
    const lab = { upcoming: ['Akan datang', 'badge-info'], open: ['Berlangsung', 'badge-success'], closed: ['Selesai', 'badge-gray'] }[st];
    return `<strong>Remedial ${r.remedialRound || 1}</strong>
      <span class="badge ${lab[1]}">${lab[0]}</span>
      <span class="muted small">${UI.fmtDateTime(r.startAt)} – ${UI.fmtDateTime(r.endAt)}</span>
      <span class="small">${done}/${(r.targetStudentIds || []).length} selesai</span>`;
  }
  const roundRowHtml = (r) => `<li class="rm-round">${roundInnerHtml(r)}</li>`;

  /** Kolom "Nilai akhir" untuk tabel peserta di halaman Hasil. */
  function hasData(parent) { return !isRemedial(parent) && enabled() && (roundsOf(parent).length > 0 || !!parent.remedialConfig); }
  function finalCellHtml(parent, studentId) {
    const s = summaryFor(parent, studentId);
    const rem = s.rounds.filter(r => r.done).map(r => `R${r.round}: ${fmt(r.value, s.cfg.basis)}`).join(' • ');
    return `<strong>${fmt(s.final, s.cfg.basis)}</strong>${rem ? `<div class="muted small">${rem}</div>` : ''}<div>${statusBadge(s.status)}</div>`;
  }

  /** Semua siswa yang relevan: target ujian induk + yang punya percobaan. */
  function participantsOf(parent) {
    const map = new Map(targetedStudents(parent).map(s => [s.id, s]));
    DB.getCbtAttemptsByCbt(parent.id).forEach(a => { const u = DB.getUser(a.studentId); if (u) map.set(u.id, u); });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'id'));
  }

  /* ---------------------------- panel pengelola ---------------------------- */
  function openPanel(parentId, user, onDone) {
    const parent = DB.getCbt(parentId);
    if (!parent || isRemedial(parent)) { UI.toast('Ujian tidak ditemukan.', 'error'); return; }
    if (!canManage(user, parent)) { UI.toast('Anda tidak berhak mengatur remedial ujian ini.', 'error'); return; }
    if (!enabled()) { UI.toast('Sistem remedial sedang dimatikan admin.', 'error'); return; }
    let editRound = null;                 // id putaran yang disunting, null = putaran baru
    let selected = null;                  // Set id siswa terpilih
    const crit = { below: true, absent: false };
    const now = Date.now();
    let startAt = now + 3600000 - (now % 3600000);    // jam bulat berikutnya
    let endAt = startAt + 2 * 86400000;

    UI.modal.open(`Remedial — ${parent.title}`, '<div id="rmPanel" class="rm-panel"></div>', { fullscreenToggle: true, fullKey: 'remedial', autofocus: false });
    const host = document.getElementById('rmPanel');
    const modalEl = document.getElementById('genericModal');
    const obs = new MutationObserver(() => {
      if (modalEl.classList.contains('hidden') || !document.getElementById('rmPanel')) {
        obs.disconnect();
        if (typeof onDone === 'function') onDone();
      }
    });
    obs.observe(modalEl, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });

    function autoSelect(cfg) {
      const out = new Set();
      participantsOf(parent).forEach(s => {
        const sum = summaryFor(parent, s.id, cfg);
        if (sum.pending) return;                  // sudah terjadwal di putaran lain
        if (crit.below && !sum.passed && sum.status !== 'tidak-ikut') out.add(s.id);
        if (crit.absent && sum.status === 'tidak-ikut') out.add(s.id);
      });
      return out;
    }

    function paint() {
      const cfg = configOf(DB.getCbt(parent.id));
      const rounds = roundsOf(parent);
      const round = editRound ? DB.getCbt(editRound) : null;
      if (!selected) selected = round ? new Set(round.targetStudentIds || []) : autoSelect(cfg);
      if (round && !host.dataset.init) { startAt = round.startAt; endAt = round.endAt; host.dataset.init = '1'; }
      const took = round ? new Set(DB.getCbtAttemptsByCbt(round.id).map(a => a.studentId)) : new Set();
      const people = participantsOf(parent).map(s => ({ s, sum: summaryFor(parent, s.id, cfg) }));
      const nextRound = rounds.reduce((m, r) => Math.max(m, r.remedialRound || 0), 0) + 1;

      host.innerHTML = `
        <section class="rm-sec">
          <h4 class="rm-h">1. Ketuntasan</h4>
          <form class="rm-cfg" id="rmCfg">
            <div class="form-group"><label for="rmKkm">KKM (${scaleText(cfg.basis)})</label>
              <input type="number" id="rmKkm" min="${cfg.basis === 'irt' ? 200 : 0}" max="${cfg.basis === 'irt' ? 800 : 100}" step="${cfg.basis === 'irt' ? 1 : 0.5}" value="${cfg.kkm}" />
              <div class="muted small">${cfg.basis === 'irt' ? 'Ujian ini memakai skor IRT 200–800.' : 'Persentase dari poin maksimal ujian.'}</div></div>
            <fieldset class="rm-policy"><legend>Nilai akhir setelah remedial</legend>
              ${Object.entries(POLICIES).map(([k, p]) => `<label class="rm-radio"><input type="radio" name="rmPolicy" value="${k}" ${cfg.policy === k ? 'checked' : ''} />
                <span><strong>${esc(p.label)}</strong><small>${esc(p.desc)}</small></span></label>`).join('')}
            </fieldset>
            <div class="rm-cfg-act"><button type="submit" class="btn btn-sm btn-secondary">Simpan ketuntasan</button></div>
          </form>
        </section>

        ${rounds.length ? `<section class="rm-sec"><h4 class="rm-h">Putaran remedial</h4>
          <ul class="rm-rounds">${rounds.map(r => `<li class="rm-round ${r.id === editRound ? 'is-on' : ''}">${roundInnerHtml(r)}
            <span class="rm-round-act"><button type="button" class="btn btn-sm btn-secondary" data-rm-edit="${esc(r.id)}">Ubah</button>
            <button type="button" class="btn btn-sm btn-danger" data-rm-del="${esc(r.id)}">Hapus</button></span></li>`).join('')}</ul>
          ${round ? '<button type="button" class="btn btn-sm btn-secondary" data-rm-newround>＋ Putaran baru</button>' : ''}</section>` : ''}

        <section class="rm-sec">
          <h4 class="rm-h">2. Peserta ${round ? `remedial ${round.remedialRound}` : `remedial ${nextRound}`}</h4>
          ${round ? '' : `<div class="rm-crit">
            <label class="check-row"><input type="checkbox" data-crit="below" ${crit.below ? 'checked' : ''} /> Nilai di bawah KKM</label>
            <label class="check-row"><input type="checkbox" data-crit="absent" ${crit.absent ? 'checked' : ''} /> Tidak mengikuti ujian awal</label>
            <button type="button" class="btn btn-sm btn-secondary" data-rm-auto>Pilih ulang otomatis</button>
          </div>`}
          <div class="rm-tools">
            <label class="sr-only" for="rmQ">Cari peserta</label>
            <input type="search" id="rmQ" placeholder="Cari nama, username, atau kelas…" autocomplete="off" />
            <span class="muted small" id="rmCount">${selected.size} dipilih dari ${people.length}</span>
          </div>
          <div class="rm-list" role="group" aria-label="Daftar peserta">
            ${people.length ? people.map(({ s, sum }) => {
              const locked = took.has(s.id);
              return `<label class="rm-person ${selected.has(s.id) ? 'is-on' : ''}" data-hay="${esc(DataSearch.norm([s.name, s.username, s.kelas].join(' ')))}">
                <input type="checkbox" value="${esc(s.id)}" ${selected.has(s.id) ? 'checked' : ''} ${locked ? 'disabled title="Sudah mengerjakan remedial ini"' : ''} />
                <span class="rm-p-name">${esc(s.name)}<small>${esc(s.kelas || s.username || '')}</small></span>
                <span class="rm-p-score"><small>Awal</small>${fmt(sum.original, cfg.basis)}</span>
                <span class="rm-p-score"><small>Akhir</small>${fmt(sum.final, cfg.basis)}</span>
                <span class="rm-p-st">${statusBadge(sum.status)}</span>
              </label>`;
            }).join('') : ''}
            <div class="empty" id="rmNone" ${people.length ? 'hidden' : ''}>${people.length ? 'Tidak ada peserta yang cocok.' : 'Ujian ini belum memiliki peserta.'}</div>
          </div>
        </section>

        <section class="rm-sec">
          <h4 class="rm-h">3. Jadwal & soal</h4>
          <div class="form-row">
            <div class="form-group"><label for="rmStart">Mulai</label><input type="datetime-local" id="rmStart" value="${esc(UI.utcToTzInput(startAt))}" /></div>
            <div class="form-group"><label for="rmEnd">Selesai</label><input type="datetime-local" id="rmEnd" value="${esc(UI.utcToTzInput(endAt))}" /></div>
          </div>
          <p class="muted small rm-qnote">Soal, durasi, keamanan, dan sistem penilaian disalin dari ujian awal. Untuk mengganti soal, buka <strong>Edit</strong> pada ujian remedial di daftar CBT setelah disimpan.</p>
          <label class="check-row"><input type="checkbox" id="rmNotify" checked /> Kirim notifikasi ke peserta dan orang tuanya</label>
          <div class="rm-err" id="rmErr" role="alert" hidden></div>
          <div class="rm-foot">
            <button type="button" class="btn btn-secondary" data-rm-close>Tutup</button>
            <button type="button" class="btn btn-primary" data-rm-save>${round ? `Simpan remedial ${round.remedialRound}` : `Buat remedial ${nextRound}`}</button>
          </div>
        </section>`;
      bind(cfg, round);
    }

    function showErr(m) { const e = host.querySelector('#rmErr'); e.hidden = !m; e.textContent = m || ''; }
    function bind(cfg, round) {
      host.querySelector('#rmCfg').addEventListener('submit', (e) => {
        e.preventDefault();
        try {
          saveConfig(DB.getCbt(parent.id), { kkm: host.querySelector('#rmKkm').value, policy: (host.querySelector('[name=rmPolicy]:checked') || {}).value }, user);
          UI.toast('Ketuntasan disimpan.', 'success');
          if (!round) selected = autoSelect(configOf(DB.getCbt(parent.id)));
          paint();
        } catch (err) { UI.toast(err.message, 'error'); }
      });
      host.querySelectorAll('[data-crit]').forEach(cb => cb.addEventListener('change', () => { crit[cb.dataset.crit] = cb.checked; selected = autoSelect(cfg); paint(); }));
      const auto = host.querySelector('[data-rm-auto]');
      if (auto) auto.addEventListener('click', () => { selected = autoSelect(cfg); paint(); });
      const q = host.querySelector('#rmQ');
      q.addEventListener('input', () => {
        const v = q.value.trim();
        let n = 0;
        host.querySelectorAll('.rm-person').forEach(el => {
          const hit = !v || DataSearch.matches(el.dataset.hay, v);
          el.hidden = !hit;
          if (hit) n++;
        });
        const none = host.querySelector('#rmNone');
        if (host.querySelectorAll('.rm-person').length) none.hidden = n > 0;
      });
      host.querySelectorAll('.rm-person input').forEach(cb => cb.addEventListener('change', () => {
        if (cb.checked) selected.add(cb.value); else selected.delete(cb.value);
        cb.closest('.rm-person').classList.toggle('is-on', cb.checked);
        host.querySelector('#rmCount').textContent = `${selected.size} dipilih dari ${participantsOf(parent).length}`;
      }));
      const readTimes = () => {
        startAt = UI.tzInputToUtc(host.querySelector('#rmStart').value);
        endAt = UI.tzInputToUtc(host.querySelector('#rmEnd').value);
      };
      host.querySelector('#rmStart').addEventListener('change', readTimes);
      host.querySelector('#rmEnd').addEventListener('change', readTimes);
      host.querySelectorAll('[data-rm-edit]').forEach(b => b.addEventListener('click', () => {
        editRound = b.dataset.rmEdit; selected = null; delete host.dataset.init; paint();
      }));
      const nr = host.querySelector('[data-rm-newround]');
      if (nr) nr.addEventListener('click', () => { editRound = null; selected = null; delete host.dataset.init; paint(); });
      host.querySelectorAll('[data-rm-del]').forEach(b => b.addEventListener('click', () => {
        const r = DB.getCbt(b.dataset.rmDel);
        const n = DB.getCbtAttemptsByCbt(r.id).length;
        if (!UI.confirmDialog(`Hapus remedial ${r.remedialRound}?${n ? ` ${n} hasil pengerjaan ikut terhapus dan nilai akhir dihitung ulang.` : ''}`)) return;
        try { deleteRound(r, user); if (editRound === r.id) editRound = null; selected = null; UI.toast('Remedial dihapus.', 'success'); paint(); }
        catch (err) { UI.toast(err.message, 'error'); }
      }));
      host.querySelector('[data-rm-close]').addEventListener('click', () => UI.modal.close());
      host.querySelector('[data-rm-save]').addEventListener('click', () => {
        readTimes();
        showErr('');
        try {
          const opts = { studentIds: [...selected], startAt, endAt, notify: host.querySelector('#rmNotify').checked };
          const saved = round ? updateRound(round, opts, user) : createRound(DB.getCbt(parent.id), opts, user);
          UI.toast(round ? 'Remedial diperbarui.' : `Remedial ${saved.remedialRound} dibuat untuk ${saved.targetStudentIds.length} peserta.`, 'success');
          editRound = saved.id; selected = null; delete host.dataset.init;
          paint();
        } catch (err) { showErr(err.message); }
      });
    }
    paint();
  }

  /* ---------------------------- tampilan siswa ---------------------------- */
  /** Catatan di halaman hasil (ujian induk atau remedial). */
  function studentNoteHtml(cbt, attempt) {
    if (!cbt || !attempt) return '';
    const parent = isRemedial(cbt) ? parentOf(cbt) : cbt;
    if (!parent) return '';
    if (!isRemedial(cbt) && !roundsOf(parent).some(r => (r.targetStudentIds || []).includes(attempt.studentId)) && !parent.remedialConfig) return '';
    const s = summaryFor(parent, attempt.studentId);
    return `<div class="rm-final ${s.passed ? 'is-pass' : ''}">
      <div><span class="muted small">${isRemedial(cbt) ? `Remedial ke-${cbt.remedialRound} untuk ${esc(parent.title)}` : 'Nilai akhir ujian ini'}</span>
        <strong>${fmt(s.final, s.cfg.basis)}</strong><span class="muted small">KKM ${fmt(s.cfg.kkm, s.cfg.basis)} • ${esc(POLICIES[s.cfg.policy].label)}</span></div>
      ${statusBadge(s.status)}
      ${s.pending ? `<div class="small">Remedial ${s.pending.round}: ${UI.fmtDateTime(s.pending.cbt.startAt)} – ${UI.fmtDateTime(s.pending.cbt.endAt)}</div>` : ''}
    </div>`;
  }
  /** Keterangan pada baris daftar ujian siswa. */
  function rowHintHtml(cbt, studentId) {
    if (isRemedial(cbt)) {
      const p = parentOf(cbt);
      return `<span class="badge badge-warning">Remedial ke-${cbt.remedialRound || 1}</span>${p ? ` <span class="muted small">ujian awal: ${esc(p.title)}</span>` : ''}`;
    }
    if (!enabled()) return '';
    const r = roundsOf(cbt).find(x => (x.targetStudentIds || []).includes(studentId) && roundState(x) !== 'closed' && !(DB.getCbtAttemptByStudent(x.id, studentId) || {}).submittedAt);
    return r ? `<span class="badge badge-info">Remedial ${r.remedialRound}: ${UI.fmtDateTime(r.startAt)}</span>` : '';
  }

  global.Remedial = {
    POLICIES, GRACE_MS, enabled, defaults, isRemedial, parentOf, basisOf, valueOf, configOf, roundsOf, roundState,
    summaryFor, canManage, saveConfig, createRound, updateRound, deleteRound,
    settingsCardHtml, bindSettings, listLabelHtml, resultsCardHtml, hasData, finalCellHtml, openPanel,
    studentNoteHtml, rowHintHtml, statusBadge, fmt
  };
})(window);
