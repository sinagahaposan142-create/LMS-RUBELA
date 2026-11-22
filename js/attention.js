/* =====================================================================
 * js/attention.js — Ruang Perhatian (yang perlu ditindaklanjuti)
 * ---------------------------------------------------------------------
 * Tab di halaman Notifikasi admin & tutor. Daftar dihitung langsung dari
 * data yang ada (bukan disimpan terpisah), jadi otomatis hilang begitu
 * pekerjaannya selesai dan selalu sama di semua perangkat:
 *  - tugas yang belum dinilai, tugas lewat tenggat yang belum dikumpulkan
 *  - esai CBT (Poin Manual) yang belum diberi nilai, ujian selesai yang
 *    tidak dikerjakan sebagian peserta, ujian terjadwal tanpa soal
 *  - jadwal kelas yang belum divalidasi / topiknya belum diisi
 *  - presensi pertemuan yang sudah lewat tetapi belum diisi
 *  - admin: verifikasi pembayaran course, pembayaran & honor tertunda,
 *    moderasi ucapan ulang tahun, kelas tanpa tutor
 * Tutor hanya melihat pekerjaannya sendiri (kelas yang diampu, konten
 * buatannya, sesi yang ditugaskan kepadanya). Admin melihat semuanya
 * beserta nama penanggung jawab.
 * Item dikelompokkan menurut umur: ≤ 7 hari, ≤ 1 bulan, ≤ 3 bulan, lebih lama.
 * ===================================================================*/
(function (global) {
  'use strict';

  const DAY = 86400000;
  const esc = (s) => UI.esc(s);
  const svg = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const KIND = {
    grade: { label: 'Penilaian tugas', color: '#4f46e5', icon: svg('<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>') },
    missing: { label: 'Tugas belum dikumpulkan', color: '#d97706', icon: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 13v3M12 19h.01"/>') },
    essay: { label: 'Esai ujian', color: '#7c3aed', icon: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>') },
    exam: { label: 'Ujian', color: '#0891b2', icon: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>') },
    plan: { label: 'Jadwal kelas', color: '#0d9488', icon: svg('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 15l2 2 4-4"/>') },
    attendance: { label: 'Presensi', color: '#e11d48', icon: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M17 11l2 2 4-4"/>') },
    finance: { label: 'Keuangan', color: '#16a34a', icon: svg('<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20M6 15h4"/>') },
    moderation: { label: 'Moderasi', color: '#db2777', icon: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>') },
    setup: { label: 'Kelas', color: '#64748b', icon: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M12 7v6M9 10h6"/>') }
  };
  const BUCKETS = [
    { key: 'week', label: '7 hari terakhir', max: 7 * DAY },
    { key: 'month', label: '8–30 hari lalu', max: 30 * DAY },
    { key: 'quarter', label: '1–3 bulan lalu', max: 91 * DAY },
    { key: 'older', label: 'Lebih dari 3 bulan', max: Infinity }
  ];
  const ICON_CHECK = svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>');
  const ICON_ARROW = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

  /** 'YYYY-MM-DD' + 'HH:MM' menurut zona waktu LMS (WIB/WITA/WIT) → ms. */
  const ymdToTs = (ymd, hhmm) => {
    const hm = /^\d{2}:\d{2}$/.test(hhmm || '') ? hhmm : '00:00';
    const t = UI.tzInputToUtc ? UI.tzInputToUtc(String(ymd) + 'T' + hm) : new Date(String(ymd) + 'T' + hm + ':00').getTime();
    return Number.isFinite(t) ? t : 0;
  };
  const userName = (id) => { const u = id && DB.getUser(id); return u ? u.name : ''; };
  const courseName = (c) => (c ? DB.courseTitle(c) : 'Kelas terhapus');

  /* ------------------------------------------------------------------
   * Sumber item
   * ----------------------------------------------------------------*/
  function scopeOf(user) {
    const admin = user.role === 'admin';
    const courses = admin ? DB.getCourses() : DB.getCoursesByTeacher(user.id);
    return { admin, courses, courseIds: new Set(courses.map(c => c.id)) };
  }

  function assignmentItems(user, sc, now, out) {
    DB.getAssignments().forEach(a => {
      if (!sc.courseIds.has(a.courseId)) return;
      const course = DB.getCourse(a.courseId);
      if (!sc.admin && !DB.canManageContent(user, a, course)) return;
      const subs = DB.getSubmissionsByAssignment(a.id);
      const owner = DB.contentOwnerName ? DB.contentOwnerName(a, course) : userName(a.createdBy);
      const ungraded = subs.filter(s => s.grade == null && s.submittedAt);
      if (ungraded.length) {
        const oldest = Math.min(...ungraded.map(s => Number(s.submittedAt) || now));
        out.push({ id: 'grade:' + a.id, kind: 'grade', since: oldest, count: ungraded.length,
          title: `${ungraded.length} jawaban "${a.title}" belum dinilai`, detail: courseName(course), owner,
          link: sc.admin ? 'courses' : 'grading', action: 'Nilai sekarang' });
      }
      const due = Number(a.dueDate) || 0;
      if (due && due < now && a.active !== false) {
        const enrolled = DB.getEnrollmentsByCourse(a.courseId).map(e => e.studentId);
        const done = new Set(subs.map(s => s.studentId));
        // Hanya mentee aktif yang memang dapat melihat tugas ini (rilis bertahap/nonaktif tidak dihitung).
        const missing = enrolled.filter(id => !done.has(id) && ((DB.getUser(id) || {}).status || 'Aktif') === 'Aktif' && !!DB.getUser(id)
          && (!DB.contentVisibleToStudent || DB.contentVisibleToStudent(a, course, id)));
        if (missing.length) {
          const names = missing.slice(0, 3).map(userName).filter(Boolean);
          out.push({ id: 'missing:' + a.id, kind: 'missing', since: due, count: missing.length,
            title: `${missing.length} mentee belum mengumpulkan "${a.title}"`,
            detail: `${courseName(course)} • tenggat ${UI.fmtDateTime(due)}${names.length ? ' • ' + names.join(', ') + (missing.length > names.length ? ` dan ${missing.length - names.length} lainnya` : '') : ''}`,
            owner, link: 'courses', action: 'Lihat kelas' });
        }
      }
    });
  }

  function cbtInScope(c, sc) {
    if (sc.admin) return true;
    const ids = (c.courseIds && c.courseIds.length) ? c.courseIds : (c.courseId ? [c.courseId] : []);
    return ids.some(id => sc.courseIds.has(id));
  }
  function examItems(user, sc, now, out) {
    const students = DB.getUsers().filter(u => u.role === 'siswa' && (u.status || 'Aktif') === 'Aktif');
    DB.getCbts().forEach(c => {
      if (!cbtInScope(c, sc)) return;
      const link = sc.admin ? 'admin-cbt' : 'cbt';
      const owner = userName(c.createdBy);
      const qn = DB.cbtQuestionIds(c).length;
      const attempts = DB.getCbtAttemptsByCbt(c.id);
      // Esai Poin Manual yang belum diberi nilai.
      if (global.Scoring && Scoring.usesPoints(c) && qn) {
        const pend = attempts.filter(a => a.submittedAt && Scoring.computePoints(c, a.answers, a.essayPoints).pending > 0);
        if (pend.length) {
          out.push({ id: 'essay:' + c.id, kind: 'essay', since: Math.min(...pend.map(a => Number(a.submittedAt) || now)), count: pend.length,
            title: `${pend.length} lembar jawaban "${c.title}" menunggu nilai esai`, detail: 'Buka Hasil ujian lalu tombol Nilai Esai.', owner, link, action: 'Nilai esai' });
        }
      }
      if (c.active === false) return;
      // Ujian terjadwal atau berjalan tanpa soal.
      if (!qn && Number(c.endAt) > now) {
        out.push({ id: 'noq:' + c.id, kind: 'exam', since: Number(c.createdAt) || now, count: 1,
          title: `Ujian "${c.title}" belum memiliki soal`, detail: `Dibuka ${UI.fmtDateTime(c.startAt)}`, owner, link, action: 'Lengkapi ujian' });
      }
      // Ujian sudah ditutup tetapi sebagian peserta tidak mengerjakan (bukan remedial).
      if (qn && !c.remedialOf && Number(c.endAt) && Number(c.endAt) < now) {
        const tried = new Set(attempts.filter(a => a.submittedAt).map(a => a.studentId));
        const absent = students.filter(s => DB.cbtTargetsStudent(c, s) && !tried.has(s.id));
        if (absent.length) {
          out.push({ id: 'absent:' + c.id, kind: 'exam', since: Number(c.endAt), count: absent.length,
            title: `${absent.length} peserta tidak mengerjakan "${c.title}"`,
            detail: `Ditutup ${UI.fmtDateTime(c.endAt)}. Pertimbangkan remedial atau hubungi mentee.`, owner, link, action: 'Lihat hasil' });
        }
      }
    });
  }

  function planItems(user, sc, now, out) {
    const st = DB.getSettings();
    const confirmLead = Number(st.planConfirmLead) || 5;
    const fillLead = Number(st.planFillLead) || 3;
    const todayYmd = UI.todayYMD();
    const attLink = sc.admin ? 'attendance' : 'absensi';
    DB.getClassPlans().forEach(p => {
      if (p.status === 'cancelled' || !DB.canManagePlan(user, p)) return;
      if (!sc.admin && !sc.courseIds.has(p.courseId)) return;
      const course = DB.getCourse(p.courseId);
      if (!course) return;
      const ahead = DB.planDaysAhead(p.date);
      const when = `${UI.fmtYMD ? UI.fmtYMD(p.date) : p.date}${p.time ? ' • ' + p.time : ''}`;
      const owner = userName(p.teacherId);
      const startTs = ymdToTs(p.date, p.time);
      if (p.status === 'draft' && ahead <= confirmLead) {
        out.push({ id: 'plan:' + p.id, kind: 'plan', since: Math.min(now, startTs - confirmLead * DAY), count: 1,
          title: ahead < 0 ? `Sesi ${courseName(course)} sudah lewat tetapi belum divalidasi` : `Validasi sesi ${courseName(course)} (H-${ahead})`,
          detail: when + (p.topic ? ' • ' + RichText.plain(p.topic, 60) : ''), owner, link: 'jadwal-kelas', action: 'Validasi' });
      }
      if (!String(p.topic || '').trim() && ahead <= fillLead && ahead >= 0) {
        out.push({ id: 'topic:' + p.id, kind: 'plan', since: Math.min(now, startTs - fillLead * DAY), count: 1,
          title: `Topik/materi sesi ${courseName(course)} belum diisi`, detail: when, owner, link: 'jadwal-kelas', action: 'Isi topik' });
      }
      // Presensi: sesi yang sudah berakhir tanpa satu pun catatan presensi.
      const win = DB.planWindow ? DB.planWindow(p) : null;
      const endTs = win ? ymdToTs(p.date) + win.end * 60000 : ymdToTs(p.date) + DAY;
      if ((p.date < todayYmd || endTs < now) && !DB.isCancelledSession(p.courseId, p.date) && !DB.getAttendanceByCourseDate(p.courseId, p.date).length) {
        out.push({ id: 'att:' + p.id, kind: 'attendance', since: endTs, count: 1,
          title: `Presensi ${courseName(course)} belum diisi`, detail: when, owner, link: attLink, action: 'Isi presensi' });
      }
    });
  }

  function adminItems(now, out) {
    DB.getHubPayments().filter(p => p.status === 'pending').forEach(p => {
      const c = DB.getHubCourse ? DB.getHubCourse(p.courseId) : null;
      out.push({ id: 'hpay:' + p.id, kind: 'finance', since: Number(p.createdAt) || now, count: 1,
        title: `Verifikasi bukti bayar ${userName(p.studentId) || 'mentee'}`, detail: `${c ? c.title : 'Course'} • ${DB.formatRupiah(p.amount)}`,
        owner: '', link: 'hub-pay', action: 'Verifikasi' });
    });
    DB.getPayments().filter(p => p.status === 'pending').forEach(p => {
      out.push({ id: 'pay:' + p.id, kind: 'finance', since: Number(p.createdAt) || now, count: 1,
        title: `Pembayaran ${userName(p.studentId) || 'mentee'} belum lunas`, detail: `${DB.paymentKindMeta(DB.paymentKind(p)).label} • ${DB.formatRupiah(p.amount)}${p.note ? ' • ' + p.note : ''}`,
        owner: '', link: 'keuangan', action: 'Buka keuangan' });
    });
    DB.getSalaries().filter(s => s.status !== 'dibayar').forEach(s => {
      out.push({ id: 'sal:' + s.id, kind: 'finance', since: Number(s.createdAt) || now, count: 1,
        title: `Honor ${userName(s.teacherId) || 'tutor'} periode ${s.period || '-'} belum dibayar`, detail: DB.formatRupiah(s.amount),
        owner: '', link: 'keuangan', action: 'Buka keuangan' });
    });
    DB.getBirthdayWishes().forEach(w => {
      const reports = w.reports || [];
      const lastReport = reports.length ? Math.max(...reports.map(r => Number(r.at) || 0)) : 0;
      const needs = w.status === 'pending' || (reports.length && !(Number(w.moderatedAt) >= lastReport));
      if (!needs) return;
      out.push({ id: 'wish:' + w.id, kind: 'moderation', since: w.status === 'pending' ? Number(w.createdAt) || now : (reports[0] && reports[0].at) || now, count: 1,
        title: w.status === 'pending' ? `Ucapan ulang tahun dari ${userName(w.authorId) || 'pengguna'} menunggu persetujuan` : `Ucapan ulang tahun dilaporkan ${reports.length}×`,
        detail: `Untuk ${userName(w.recipientId) || 'mentee'}: "${String(w.text || '').slice(0, 80)}"`, owner: '', link: 'birthday', action: 'Moderasi' });
    });
    DB.getCourses().filter(c => c.active !== false && !DB.courseTeacherIds(c).length).forEach(c => {
      out.push({ id: 'notutor:' + c.id, kind: 'setup', since: Number(c.createdAt) || now, count: 1,
        title: `Kelas ${courseName(c)} belum memiliki tutor`, detail: `${DB.getEnrollmentsByCourse(c.id).length} mentee terdaftar`, owner: '', link: 'courses', action: 'Atur tutor' });
    });
  }

  /** Semua item yang perlu ditindaklanjuti pengguna ini, terbaru di atas. */
  function collect(user) {
    if (!user || (user.role !== 'admin' && user.role !== 'guru')) return [];
    const now = Date.now();
    const sc = scopeOf(user);
    const out = [];
    const safe = (fn) => { try { fn(); } catch (e) { console.warn('[perhatian]', e); } };
    safe(() => assignmentItems(user, sc, now, out));
    safe(() => examItems(user, sc, now, out));
    safe(() => planItems(user, sc, now, out));
    if (sc.admin) safe(() => adminItems(now, out));
    out.forEach(it => {
      it.since = Math.min(now, Number(it.since) || now);
      const age = now - it.since;
      it.bucket = BUCKETS.find(b => age <= b.max).key;
    });
    return out.sort((a, b) => b.since - a.since);
  }
  const count = (user) => collect(user).length;

  /* ------------------------------------------------------------------
   * Tampilan
   * ----------------------------------------------------------------*/
  const view = { bucket: 'all', kind: 'all', q: '' };
  function ageText(ts) {
    const d = Math.floor((Date.now() - ts) / DAY);
    if (d <= 0) return 'hari ini';
    if (d < 31) return d + ' hari';
    const m = Math.floor(d / 30);
    return m < 12 ? m + ' bulan' : Math.floor(d / 365) + ' tahun';
  }

  function render(container, user, opts) {
    const o = opts || {};
    const items = collect(user);
    const kinds = Object.keys(KIND).filter(k => items.some(it => it.kind === k));
    if (view.kind !== 'all' && !kinds.includes(view.kind)) view.kind = 'all';
    const byBucket = (k) => items.filter(it => it.bucket === k).length;
    const q = DataSearch && DataSearch.norm ? DataSearch.norm(view.q) : view.q.toLowerCase();
    const visible = items.filter(it => (view.bucket === 'all' || it.bucket === view.bucket) && (view.kind === 'all' || it.kind === view.kind)
      && (!q || (DataSearch && DataSearch.norm ? DataSearch.norm([it.title, it.detail, it.owner, KIND[it.kind].label].join(' ')) : [it.title, it.detail, it.owner].join(' ').toLowerCase()).includes(q)));
    const admin = user.role === 'admin';

    container.innerHTML = `<div class="att-room">
      <div class="att-head">
        <div>
          <h3>Perlu Ditindaklanjuti</h3>
          <p>${items.length ? `${items.length} hal belum selesai${admin ? ' di seluruh LMS' : ' dari kelas, tugas, dan sesi Anda'}. Daftar ini diperbarui otomatis dan hilang sendiri setelah pekerjaannya selesai.`
            : 'Semua pekerjaan sudah beres.'}</p>
        </div>
        <label class="att-search"><span class="sr-only">Cari</span>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" id="attQ" placeholder="Cari judul, kelas, atau nama…" value="${esc(view.q)}" autocomplete="off" /></label>
      </div>
      <div class="att-buckets" role="tablist" aria-label="Umur">
        <button type="button" role="tab" aria-selected="${view.bucket === 'all'}" class="att-bucket ${view.bucket === 'all' ? 'is-on' : ''}" data-att-bucket="all"><strong>${items.length}</strong><span>Semua</span></button>
        ${BUCKETS.map(b => `<button type="button" role="tab" aria-selected="${view.bucket === b.key}" class="att-bucket b-${b.key} ${view.bucket === b.key ? 'is-on' : ''}" data-att-bucket="${b.key}"><strong>${byBucket(b.key)}</strong><span>${esc(b.label)}</span></button>`).join('')}
      </div>
      ${kinds.length > 1 ? `<div class="att-kinds" aria-label="Jenis">
        <button type="button" class="att-kind ${view.kind === 'all' ? 'is-on' : ''}" data-att-kind="all">Semua jenis</button>
        ${kinds.map(k => `<button type="button" class="att-kind ${view.kind === k ? 'is-on' : ''}" data-att-kind="${k}" style="--k:${KIND[k].color}">${esc(KIND[k].label)} <span>${items.filter(it => it.kind === k).length}</span></button>`).join('')}
      </div>` : ''}
      <div class="att-list">${visible.length ? BUCKETS.filter(b => view.bucket === 'all' || view.bucket === b.key).map(b => {
        const rows = visible.filter(it => it.bucket === b.key);
        if (!rows.length) return '';
        return `<section class="att-group" aria-label="${esc(b.label)}"><h4>${esc(b.label)} <span>${rows.length}</span></h4>
          ${rows.map(it => `<article class="att-item k-${it.kind}" style="--k:${KIND[it.kind].color}">
            <span class="att-ic">${KIND[it.kind].icon}</span>
            <div class="att-body">
              <strong>${esc(it.title)}</strong>
              <span class="att-detail">${esc(it.detail || '')}</span>
              <span class="att-meta"><span class="att-tag">${esc(KIND[it.kind].label)}</span>
                <time datetime="${new Date(it.since).toISOString()}" title="${esc(UI.fmtDateTime(it.since))}">sejak ${esc(UI.fmtDateTime(it.since))} • ${esc(ageText(it.since))}</time>
                ${admin && it.owner ? `<span>Penanggung jawab: ${esc(it.owner)}</span>` : ''}</span>
            </div>
            ${it.link && global.Dashboard && Dashboard.hasSection(it.link) ? `<button type="button" class="btn btn-sm btn-secondary att-go" data-att-go="${esc(it.link)}">${esc(it.action || 'Buka')} ${ICON_ARROW}</button>` : ''}
          </article>`).join('')}</section>`;
      }).join('') : `<div class="att-empty">${ICON_CHECK}<strong>${items.length ? 'Tidak ada yang cocok dengan filter.' : 'Tidak ada yang perlu ditindaklanjuti.'}</strong>
        <span>${items.length ? 'Ubah filter umur atau jenis.' : 'Tugas, jadwal, presensi, dan penilaian sudah lengkap.'}</span></div>`}</div>
    </div>`;
    const repaint = () => render(container, user, o);
    container.querySelectorAll('[data-att-bucket]').forEach(b => b.addEventListener('click', () => { view.bucket = b.dataset.attBucket; repaint(); }));
    container.querySelectorAll('[data-att-kind]').forEach(b => b.addEventListener('click', () => { view.kind = b.dataset.attKind; repaint(); }));
    const qi = container.querySelector('#attQ');
    let t = null;
    qi.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        view.q = qi.value;
        const pos = qi.selectionStart;
        repaint();
        const n = container.querySelector('#attQ');
        if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* noop */ } }
      }, 180);
    });
    container.querySelectorAll('[data-att-go]').forEach(b => b.addEventListener('click', () => Dashboard.navigate(b.dataset.attGo)));
    if (o.onCount) o.onCount(items.length);
  }

  global.Attention = { collect, count, render, KIND, BUCKETS };
})(window);
