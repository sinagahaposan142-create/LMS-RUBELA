/* ===== LMS Rubela - Jadwal Kelas & War Jadwal =====
 * Satu modul untuk seluruh peran:
 *
 *  - renderJadwalPage(container, user)   Admin & Tutor: agenda + War Jadwal
 *  - renderWarSheet(container, user)     Tabel sheet rencana kelas 1 bulan
 *  - renderAgenda(container, user, mode) Hari Ini / Akan Datang + tombol Zoom
 *  - renderPlanTable(container, user)    Tampilan baca-saja untuk siswa & ortu
 *
 * Alur "War Jadwal Kelas":
 *   H-3  tutor mulai mengisi rencana kelas satu bulan ke depan, mengikuti
 *        hari mengajar yang sudah ditetapkan pada kelasnya.
 *   H-5  tutor memvalidasi (mencentang) bahwa kelas benar-benar FIX.
 *   H-2  bila mendadak tidak bisa, tutor mengubah jadwal/topik atau
 *        membatalkan; statusnya menjadi "Diubah" / "Dibatalkan".
 *   Setelah FIX, rencana otomatis muncul di agenda "Hari Ini"/"Akan Datang"
 *   beserta tombol menuju tautan Zoom / Google Meet.
 */
(function (global) {

  const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  function esc(s) { return UI.esc(s); }
  function emptyState(msg, icon) {
    return `<div class="empty"><div class="empty-icon">${icon || '🗓️'}</div>${esc(msg)}</div>`;
  }

  /* Kelas yang boleh dikelola oleh pengguna ini */
  function coursesFor(user) {
    return user.role === 'admin' ? DB.getCourses() : DB.getCoursesByTeacher(user.id);
  }

  /** Label baris sheet: "Kelas 11-A • PK bersama Bu Maria" */
  function courseRowLabel(course) {
    const st = DB.subtestByName(course.subtest);
    const mains = (course.mainClasses || []).join(', ');
    const tutors = DB.courseTeachers(course).map(t => t.name).join(' & ');
    const sub = st ? st.short : (course.subtest || course.category || 'Kelas');
    return {
      main: [mains, sub].filter(Boolean).join(' • '),
      sub: tutors ? 'bersama ' + tutors : 'belum ada tutor',
      icon: st ? st.icon : '📘'
    };
  }

  /** Nama pendek untuk sel sheet: "Bu Maria Simbolon" -> "Bu Maria". */
  function shortName(name) {
    const parts = String(name || '').trim().split(/\s+/);
    if (parts.length <= 2) return parts.join(' ');
    return parts.slice(0, 2).join(' ');
  }

  /**
   * Hanya admin dan tutor yang ditugaskan pada rencana itu yang boleh
   * memvalidasi atau mengubahnya. Diperiksa juga di handler (bukan hanya saat
   * render) supaya tidak bisa ditembus dari konsol.
   */
  function guardPlan(user, planId) {
    const pl = DB.getClassPlan(planId);
    if (!pl) { UI.toast('Rencana kelas tidak ditemukan.', 'error'); return false; }
    if (DB.canManagePlan(user, pl)) return true;
    const owner = DB.getUser(pl.teacherId);
    UI.toast(`Hanya ${owner ? owner.name : 'tutor yang ditugaskan'} atau admin yang dapat memvalidasi kelas ini.`, 'error');
    return false;
  }

  function statusBadge(status) {
    const meta = (DB.PLAN_STATUS && DB.PLAN_STATUS[status]) || { label: status, badge: 'badge-gray' };
    return `<span class="badge ${meta.badge}">${esc(meta.label)}</span>`;
  }

  /** Tautan rapat efektif: milik rencana, jatuh ke tautan kelas. */
  function meetingLinkOf(plan, course) {
    return (plan && plan.meetingLink) || (course && course.meetingLink) || '';
  }

  /** Pilihan tutor untuk sebuah kelas; dibangun ulang tiap kelas berubah. */
  function teacherOptionsHtml(course, selectedId) {
    const tutors = DB.courseTeachers(course);
    if (!tutors.length) return '<option value="">(kelas ini belum punya tutor)</option>';
    const pick = selectedId && tutors.some(t => t.id === selectedId) ? selectedId : tutors[0].id;
    return tutors.map(t =>
      `<option value="${esc(t.id)}" ${t.id === pick ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  }

  function teacherHint(course) {
    const n = DB.courseTeachers(course).length;
    if (n === 0) return 'Tetapkan tutor kelas ini lewat menu Semua Kelas terlebih dahulu.';
    if (n === 1) return 'Kelas ini diampu satu tutor.';
    return `Kelas ini diampu ${n} tutor — pilih siapa yang mengajar pertemuan ini.`;
  }

  /* =====================================================================
   * SINKRONISASI KE HALAMAN KELAS & KALENDER
   * ===================================================================*/

  /**
   * Rencana kelas yang relevan untuk seorang pengguna pada rentang tanggal.
   * Admin melihat semua, tutor melihat kelas yang diampunya, siswa melihat
   * kelas yang diikutinya, dan orang tua melihat gabungan kelas anak-anaknya.
   */
  function plansForUser(user, from, to) {
    if (!user) return [];
    const inRange = (p) => (!from || p.date >= from) && (!to || p.date <= to);
    if (user.role === 'admin') return DB.getClassPlans().filter(inRange);
    if (user.role === 'guru') {
      const ids = new Set(DB.getCoursesByTeacher(user.id).map(c => c.id));
      return DB.getClassPlans().filter(p => ids.has(p.courseId) && inRange(p));
    }
    if (user.role === 'siswa') return DB.getClassPlansForStudent(user.id).filter(inRange);
    if (user.role === 'orangtua') {
      const seen = new Set();
      const out = [];
      (DB.getChildren(user.id) || []).forEach(child => {
        DB.getClassPlansForStudent(child.id).forEach(p => {
          if (!inRange(p) || seen.has(p.id)) return;
          seen.add(p.id);
          out.push(Object.assign({}, p, { __childName: child.name }));
        });
      });
      return out;
    }
    return [];
  }

  /**
   * Kartu "Jadwal & Kesiapan Materi" untuk halaman detail kelas.
   * Menjawab pertanyaan praktis: hari ini ada kelas atau tidak, siapa
   * tutornya, apa materinya, dan apakah materi/modul/rekaman/tugas untuk
   * pertemuan itu sudah tersedia.
   */
  function courseScheduleCardHtml(course, user, opts) {
    const o = opts || {};
    const today = UI.todayYMD();
    const plans = DB.getClassPlansByCourse(course.id).slice().sort((a, b) => a.date.localeCompare(b.date));
    const todayPlan = plans.find(p => p.date === today) || null;
    const upcoming = plans.filter(p => p.date > today).slice(0, 3);

    const matCount = DB.getMaterialsByCourse(course.id).length;
    const modCount = DB.getModulesByCourse(course.id).length;
    const recCount = DB.getRecordingsByCourse(course.id).length;
    const asgCount = DB.getAssignmentsByCourse(course.id).length;
    const cbtCount = DB.getCbtsByCourse(course.id).length;

    const rowFor = (pl, isToday) => {
      const tutor = DB.getUser(pl.teacherId);
      const st = (DB.PLAN_STATUS && DB.PLAN_STATUS[pl.status]) || { label: pl.status, badge: 'badge-gray' };
      const link = meetingLinkOf(pl, course);
      const ahead = DB.planDaysAhead(pl.date);
      return `<div class="cs-row ${isToday ? 'is-today' : ''}">
        <div class="cs-date">
          <span class="cs-d">${UI.fmtYMD(pl.date).replace(/ \d{4}$/, '')}</span>
          <span class="cs-h">${isToday ? 'hari ini' : (ahead > 0 ? 'H-' + ahead : '')}</span>
        </div>
        <div class="cs-body">
          <div class="cs-topic">${pl.topic ? esc(pl.topic) : '<span class="muted">Materi belum diisi tutor</span>'}</div>
          <div class="cs-meta">
            ${tutor ? `👨‍🏫 ${esc(tutor.name)}` : ''}
            ${pl.time ? ` • ⏰ ${esc(pl.time)}${pl.endTime ? '–' + esc(pl.endTime) : ''}` : ''}
            <span class="badge ${st.badge}">${esc(st.label)}</span>
          </div>
        </div>
        ${isToday && link && pl.status === 'fixed'
          ? `<a class="btn btn-sm btn-primary" href="${esc(link)}" target="_blank" rel="noopener">🎥 Masuk Kelas</a>`
          : ''}
      </div>`;
    };

    return `
      <div class="card course-sched">
        <div class="card-header">
          ${UI.secHead('🗓️', 'Jadwal Kelas & Kesiapan Materi', 'tersinkron langsung dengan War Jadwal Kelas')}
          ${o.linkToJadwal ? `<button class="btn btn-sm btn-secondary" id="csGoJadwal">Buka Jadwal Kelas →</button>` : ''}
        </div>

        <div class="cs-list">
          ${todayPlan
            ? rowFor(todayPlan, true)
            : `<div class="cs-row is-empty">
                 <div class="cs-date"><span class="cs-d">Hari ini</span></div>
                 <div class="cs-body"><div class="cs-topic muted">Tidak ada kelas terjadwal hari ini.</div>
                   <div class="cs-meta">Jadwal rutin: ${esc(DB.courseScheduleLabel(course))}</div></div>
               </div>`}
          ${upcoming.map(p => rowFor(p, false)).join('')}
        </div>

        <div class="cs-ready">
          <span class="cs-chip ${matCount ? 'ok' : ''}">📄 ${matCount} materi</span>
          <span class="cs-chip ${modCount ? 'ok' : ''}">📘 ${modCount} modul</span>
          <span class="cs-chip ${recCount ? 'ok' : ''}">🎥 ${recCount} rekaman</span>
          <span class="cs-chip ${asgCount ? 'ok' : ''}">📝 ${asgCount} tugas</span>
          <span class="cs-chip ${cbtCount ? 'ok' : ''}">🖥️ ${cbtCount} CBT</span>
        </div>
      </div>`;
  }

  /* =====================================================================
   * FORM RENCANA KELAS
   * ===================================================================*/
  function openPlanForm(opts, onDone) {
    const o = opts || {};
    const editing = o.planId ? DB.getClassPlan(o.planId) : null;
    const courses = coursesFor(o.user);
    const courseId = editing ? editing.courseId : (o.courseId || (courses[0] && courses[0].id));
    const course = DB.getCourse(courseId);
    if (!course) { UI.toast('Kelas tidak ditemukan.', 'error'); return; }
    if (editing && !DB.canManagePlan(o.user, editing)) {
      const t = DB.getUser(editing.teacherId);
      UI.toast(`Sesi ini hanya dapat diubah oleh ${t ? t.name : 'tutor yang ditugaskan'} atau admin.`, 'info');
      return;
    }

    const sched = course.schedule || {};
    const date = editing ? editing.date : (o.date || UI.todayYMD());
    const ahead = DB.planDaysAhead(date);
    const settings = DB.getSettings();

    const body = `
      <form id="planForm" class="form">
        <div class="alert alert-info" id="pfBanner" style="margin-bottom:14px;">
          ${courseRowLabel(course).icon} <strong>${esc(courseRowLabel(course).main)}</strong>
          ${esc(courseRowLabel(course).sub)}
          <div class="muted small mt-1">Jadwal rutin: ${esc(DB.courseScheduleLabel(course))}</div>
        </div>

        ${o.user.role === 'admin' && !editing ? `
        <div class="form-group"><label>Kelas</label>
          <select name="courseId" id="pfCourse">
            ${courses.map(c => `<option value="${c.id}" ${c.id === courseId ? 'selected' : ''}>${esc(DB.courseTitle(c))}</option>`).join('')}
          </select>
        </div>` : ''}

        <div class="form-row">
          <div class="form-group"><label>Tanggal Pelaksanaan</label>
            <input name="date" type="date" required value="${esc(date)}" /></div>
          <div class="form-group"><label for="pfTeacher">Tutor Pengajar</label>
            <select name="teacherId" id="pfTeacher">${teacherOptionsHtml(course, editing ? editing.teacherId : null)}</select>
            <p class="muted small" id="pfTeacherHint" style="margin:6px 0 0;">${teacherHint(course)}</p>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group"><label>Jam Mulai</label>
            <input name="time" type="time" value="${esc(editing ? editing.time : (sched.time || '16:00'))}" /></div>
          <div class="form-group"><label>Jam Selesai</label>
            <input name="endTime" type="time" value="${esc(editing ? editing.endTime : (sched.endTime || '17:30'))}" /></div>
        </div>
        <div id="pfClash" class="pf-clash" aria-live="polite"></div>

        <div class="form-group"><label>Materi / Topik Pertemuan</label>
          <input name="topic" required value="${esc(editing ? editing.topic : '')}"
                 placeholder="mis. Barisan & Deret Aritmetika" /></div>

        <div class="form-group"><label>Tautan Zoom / Google Meet</label>
          <input name="meetingLink" type="url" value="${esc(editing ? (editing.meetingLink || '') : (course.meetingLink || ''))}"
                 placeholder="https://meet.google.com/xxx-xxxx-xxx" />
          <p class="muted small" style="margin:6px 0 0;">Dipakai pada tombol "Masuk Kelas" di agenda siswa dan orang tua.</p>
        </div>

        <div class="form-group"><label>Status Rencana</label>
          <select name="status" id="pfStatus">
            <option value="draft" ${!editing || editing.status === 'draft' ? 'selected' : ''}>Rencana (belum divalidasi)</option>
            <option value="fixed" ${editing && editing.status === 'fixed' ? 'selected' : ''}>Fix (sudah divalidasi)</option>
            <option value="changed" ${editing && editing.status === 'changed' ? 'selected' : ''}>Diubah (jadwal bergeser)</option>
            <option value="cancelled" ${editing && editing.status === 'cancelled' ? 'selected' : ''}>Dibatalkan</option>
          </select>
          <p class="muted small" style="margin:6px 0 0;">
            Validasi (Fix) dianjurkan mulai H-${settings.planConfirmLead || 5}.
            ${ahead >= 0 ? `Tanggal ini H-${ahead} dari hari ini.` : `Tanggal ini sudah lewat ${Math.abs(ahead)} hari.`}
          </p>
        </div>

        <div class="form-group"><label>Catatan (opsional)</label>
          <textarea name="note" rows="2" placeholder="mis. tutor pengganti, ruang berubah, dsb.">${esc(editing ? (editing.note || '') : '')}</textarea></div>

        <div class="flex-gap" style="justify-content:space-between;">
          ${editing ? '<button type="button" class="btn btn-danger" id="pfDelete">Hapus Rencana</button>' : '<span></span>'}
          <div class="flex-gap">
            <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
            <button type="submit" class="btn btn-primary">Simpan</button>
          </div>
        </div>
      </form>`;

    UI.modal.open(editing ? 'Edit Rencana Kelas' : 'Tambah Rencana Kelas', body);
    document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());

    /* Saat admin mengganti kelas, daftar tutor, jam, dan tautan HARUS ikut
     * berubah. Sebelumnya daftar tutor dihitung sekali dari kelas pertama dan
     * tidak ada listener di sini, sehingga kelas dengan dua tutor tetap
     * menampilkan satu nama dan rencana tersimpan atas nama tutor yang salah. */
    const courseSel = document.getElementById('pfCourse');
    if (courseSel) courseSel.addEventListener('change', () => {
      const c = DB.getCourse(courseSel.value);
      if (!c) return;
      const sel = document.getElementById('pfTeacher');
      if (sel) sel.innerHTML = teacherOptionsHtml(c, null);
      const hint = document.getElementById('pfTeacherHint');
      if (hint) hint.textContent = teacherHint(c);

      const banner = document.getElementById('pfBanner');
      if (banner) {
        const lbl = courseRowLabel(c);
        banner.innerHTML = `${lbl.icon} <strong>${esc(lbl.main)}</strong> ${esc(lbl.sub)}
          <div class="muted small mt-1">Jadwal rutin: ${esc(DB.courseScheduleLabel(c))}</div>`;
      }
      // Jam & tautan mengikuti jadwal rutin kelas yang baru dipilih
      const sc = c.schedule || {};
      const timeEl = document.querySelector('#planForm [name="time"]');
      const endEl = document.querySelector('#planForm [name="endTime"]');
      const linkEl = document.querySelector('#planForm [name="meetingLink"]');
      if (timeEl) timeEl.value = sc.time || '16:00';
      if (endEl) endEl.value = sc.endTime || '17:30';
      if (linkEl && !linkEl.value.trim()) linkEl.value = c.meetingLink || '';
    });

    /* ---- Cek bentrok langsung saat tanggal/jam/tutor/kelas diubah ---- */
    const form = document.getElementById('planForm');
    const clashBox = document.getElementById('pfClash');
    const readDraft = () => {
      const fd = new FormData(form);
      const cid = fd.get('courseId') || courseId;
      return {
        id: editing ? editing.id : undefined,
        courseId: cid,
        teacherId: fd.get('teacherId') || (DB.courseTeacherIds(DB.getCourse(cid))[0] || null),
        date: fd.get('date'), time: fd.get('time') || '', endTime: fd.get('endTime') || '', status: fd.get('status')
      };
    };
    const slotChanged = (d) => !editing || editing.status === 'cancelled'
      || ['courseId', 'teacherId', 'date', 'time', 'endTime'].some(k => String(editing[k] || '') !== String(d[k] || ''));
    function checkClash() {
      const d = readDraft();
      const err = DB.validatePlanTimes(d);
      if (err) { clashBox.innerHTML = `<div class="alert alert-warning small">⚠️ ${esc(err)}</div>`; return { err, list: [] }; }
      const list = DB.planConflicts(d);
      if (!list.length) {
        clashBox.innerHTML = d.status === 'cancelled' ? '' : '<div class="pf-ok small">✓ Tidak bentrok dengan kelas utama, kelas subtest, maupun tutor yang sama.</div>';
        return { list };
      }
      const free = suggestFreeSlot(d);
      clashBox.innerHTML = `<div class="alert alert-error small"><strong>⚠️ Jadwal bentrok pada ${esc(UI.fmtYMD(d.date))}:</strong>
        <ul class="pf-clash-list">${list.map(c => `<li>${esc(DB.describePlanConflict(c))}</li>`).join('')}</ul>
        ${slotChanged(d) ? 'Ubah tanggal/jam/tutor agar tidak bertabrakan.' : 'Bentrok ini sudah ada sebelumnya — sebaiknya jadwal digeser.'}
        ${free ? `<div class="mt-1"><button type="button" class="btn btn-sm btn-secondary" id="pfUseFree">🕒 Pakai jam kosong terdekat: ${esc(fmtTime(free.time))}–${esc(fmtTime(free.endTime))}</button></div>` : ''}</div>`;
      const use = document.getElementById('pfUseFree');
      if (use) use.addEventListener('click', () => {
        form.querySelector('[name="time"]').value = free.time;
        form.querySelector('[name="endTime"]').value = free.endTime;
        checkClash();
      });
      return { list };
    }
    ['date', 'time', 'endTime', 'teacherId', 'courseId', 'status'].forEach(n => {
      const el = form.querySelector(`[name="${n}"]`);
      if (el) { el.addEventListener('change', checkClash); el.addEventListener('input', checkClash); }
    });
    checkClash();

    const del = document.getElementById('pfDelete');
    if (del) del.addEventListener('click', () => {
      if (!UI.confirmDialog('Hapus rencana kelas ini?')) return;
      DB.deleteClassPlan(editing.id);
      UI.toast('Rencana kelas dihapus.');
      UI.modal.close();
      if (typeof onDone === 'function') onDone();
    });

    document.getElementById('planForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const cid = fd.get('courseId') || courseId;
      const payload = {
        courseId: cid,
        teacherId: fd.get('teacherId') || (DB.courseTeacherIds(DB.getCourse(cid))[0] || null),
        date: fd.get('date'),
        time: fd.get('time') || '',
        endTime: fd.get('endTime') || '',
        topic: (fd.get('topic') || '').trim(),
        meetingLink: (fd.get('meetingLink') || '').trim(),
        status: fd.get('status'),
        note: (fd.get('note') || '').trim()
      };
      if (payload.status === 'fixed') payload.confirmedAt = Date.now();
      const timeErr = DB.validatePlanTimes(payload);
      if (timeErr) { UI.toast(timeErr, 'error'); return; }
      const clash = DB.planConflicts(Object.assign({ id: editing ? editing.id : undefined }, payload));
      if (clash.length && slotChanged(payload)) {
        checkClash();
        UI.toast(`Jadwal bentrok dengan ${clash.length} sesi lain. Geser jam/tanggal atau ganti tutor.`, 'error');
        return;
      }

      if (editing) {
        DB.updateClassPlan(editing.id, payload);
        UI.toast('Rencana kelas diperbarui.');
        notifyPlanChange(Object.assign({}, editing, payload), 'update');
      } else {
        payload.createdBy = o.user.id;
        const created = DB.addClassPlan(payload);
        UI.toast('Rencana kelas ditambahkan.');
        if (payload.status === 'fixed') notifyPlanChange(created, 'fixed');
      }
      UI.modal.close();
      if (typeof onDone === 'function') onDone();
    });
  }

  /** Beritahu siswa & orang tua bila rencana difinalkan / berubah. */
  function notifyPlanChange(plan, kind) {
    const course = DB.getCourse(plan.courseId);
    if (!course) return;
    const students = DB.getEnrollmentsByCourse(course.id).map(e => e.studentId);
    const title = kind === 'fixed' ? 'Jadwal kelas dikonfirmasi'
      : (plan.status === 'cancelled' ? 'Kelas dibatalkan' : 'Jadwal kelas diperbarui');
    const body = `${DB.courseTitle(course)} — ${UI.fmtYMD(plan.date)} ${plan.time || ''}${plan.topic ? ' • ' + plan.topic : ''}`;
    DB.notifyUsers(students, { type: 'jadwal', icon: '🗓️', title, body, link: 'jadwal-siswa' });
    students.forEach(sid => {
      DB.getParentsOfStudent(sid).forEach(p => DB.addNotification({
        userId: p.id, type: 'jadwal', icon: '🗓️', title, body, link: 'anak-jadwal'
      }));
    });
  }

  /** "19:20" → "19.20" (format jam Indonesia). */
  function fmtTime(t) { return String(t || '').replace(':', '.'); }
  function planTimeLabel(pl) { return pl.time ? fmtTime(pl.time) + (pl.endTime ? '–' + fmtTime(pl.endTime) : '') : '--.--'; }
  /** Jam kosong terdekat (langkah 10 menit) dengan durasi sama, hari yang sama. */
  function suggestFreeSlot(d, extra) {
    const w = DB.planWindow(d);
    if (!w) return null;
    const dur = w.end - w.start;
    for (let start = w.start + 10; start + dur <= 23 * 60 + 59; start += 10) {
      const cand = Object.assign({}, d, { time: DB.minutesToTime(start), endTime: DB.minutesToTime(start + dur) });
      if (!DB.planConflicts(cand, { extra }).length) return cand;
    }
    return null;
  }
  const STATUS_FLAG = { fixed: '✔', cancelled: '✕', changed: '↻', draft: '•' };
  /** Kelompokkan kelas subtest per kelas utama (kelas yang memuat beberapa kelas utama tampil di tiap kelompok). */
  function groupByMainClass(courses) {
    const order = DB.getMainClasses();
    const map = new Map();
    courses.forEach(c => {
      const mains = (c.mainClasses || []).length ? c.mainClasses : ['—'];
      mains.forEach(m => { if (!map.has(m)) map.set(m, []); map.get(m).push(c); });
    });
    const rank = (m) => { const i = order.indexOf(m); return m === '—' ? 1e6 : (i < 0 ? 1e5 : i); };
    return [...map.entries()]
      .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
      .map(([name, list]) => ({ name, courses: list.slice().sort((a, b) => DB.subtestOrder(a.subtest) - DB.subtestOrder(b.subtest)) }));
  }
  function subShort(course) {
    const st = course ? DB.subtestByName(course.subtest) : null;
    return st ? st.short : (course ? (course.subtest || '-') : '-');
  }

  /* =====================================================================
   * WAR JADWAL KELAS — tabel sheet satu bulan
   * ===================================================================*/
  function renderWarSheet(container, user, state) {
    const st = state || {};
    const now = UI.nowInTz();
    let year = st.year != null ? st.year : now.getFullYear();
    let month = st.month != null ? st.month : now.getMonth();

    paint();

    function paint() {
      const courses = coursesFor(user);
      const visibleIds = new Set(courses.map(c => c.id));
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const settings = DB.getSettings();
      const todayYmd = UI.todayYMD();
      const p = n => String(n).padStart(2, '0');
      const cellDate = (d) => `${year}-${p(month + 1)}-${p(d)}`;

      // Semua rencana pada bulan ini; satu sel boleh berisi beberapa sesi
      const from = cellDate(1), to = cellDate(daysInMonth);
      const plans = DB.getClassPlansInRange(from, to);
      const byCell = new Map();
      plans.forEach(pl => {
        const k = pl.courseId + '|' + pl.date;
        if (!byCell.has(k)) byCell.set(k, []);
        byCell.get(k).push(pl);
      });
      const clashes = DB.planClashesInRange(from, to, user.role === 'admin' ? null : [...visibleIds]);
      const clashIds = new Set();
      clashes.forEach(x => { clashIds.add(x.a.id); clashIds.add(x.b.id); });
      const groups = groupByMainClass(courses);
      const myPlans = user.role === 'guru' ? plans.filter(pl => pl.teacherId === user.id) : [];

      const totalPlans = plans.filter(x => user.role === 'admin' || visibleIds.has(x.courseId)).length;
      const scoped = plans.filter(x => user.role === 'admin' || visibleIds.has(x.courseId));
      const fixedCount = scoped.filter(x => x.status === 'fixed').length;
      const draftCount = scoped.filter(x => x.status === 'draft').length;
      /* Hanya rencana yang BOLEH divalidasi pengguna ini: admin melihat semua,
       * tutor hanya rencana yang ditugaskan kepadanya. */
      const needConfirm = plans.filter(x => {
        const ahead = DB.planDaysAhead(x.date);
        if (!(x.status === 'draft' && ahead >= 0 && ahead <= (settings.planConfirmLead || 5))) return false;
        return DB.canManagePlan(user, x);
      });

      const chip = (pl, label) => {
        const c = DB.getCourse(pl.courseId);
        const t = DB.getUser(pl.teacherId);
        const tip = [label || (c ? DB.courseTitle(c) : ''), planTimeLabel(pl), pl.topic || '(tanpa topik)',
          (DB.PLAN_STATUS[pl.status] || {}).label || pl.status, t ? 'diajar ' + t.name : '',
          clashIds.has(pl.id) ? '⚠️ BENTROK' : ''].filter(Boolean).join(' • ');
        return `<button type="button" class="wc-chip st-${esc(pl.status)} ${clashIds.has(pl.id) ? 'is-clash' : ''}" data-plan="${pl.id}" title="${esc(tip)}">
          ${label ? `<span class="wc-sub">${esc(label)}</span>` : ''}
          <span class="wc-time">${esc(planTimeLabel(pl))}</span>
          ${!label && pl.topic ? `<span class="wc-topic">${esc(RichText.plain(pl.topic, 22))}</span>` : ''}
          ${t ? `<span class="wc-tutor">${esc(shortName(t.name))}</span>` : ''}
          <span class="wc-flag">${clashIds.has(pl.id) ? '⚠' : (STATUS_FLAG[pl.status] || '•')}</span>
        </button>`;
      };
      const sortByTime = (list) => list.slice().sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
      const dayHead = () => Array.from({ length: daysInMonth }, (_, i) => {
        const d = i + 1;
        const ymd = cellDate(d);
        const dow = new Date(year, month, d).getDay();
        return `<th class="wj-day ${ymd === todayYmd ? 'is-today' : ''} ${dow === 0 ? 'is-weekend' : ''}" data-day="${ymd}" title="Lihat semua sesi tanggal ini">
          <span class="wd-num">${d}</span><span class="wd-dow">${DB.DAY_NAMES[dow].slice(0, 3)}</span></th>`;
      }).join('');
      const summaryCells = (pickPlans, labelOf, kind, key) => Array.from({ length: daysInMonth }, (_, i) => {
        const ymd = cellDate(i + 1);
        const list = sortByTime(pickPlans(ymd));
        const clash = list.some(x => clashIds.has(x.id));
        return `<td class="wj-cell wj-sum ${clash ? 'has-clash' : ''} ${ymd === todayYmd ? 'is-today' : ''}" data-sum="${kind}" data-key="${esc(key)}" data-date="${ymd}">
          ${list.map(x => chip(x, labelOf(x))).join('')}</td>`;
      }).join('');

      const groupRows = groups.map(g => {
        const ids = new Set(g.courses.map(c => c.id));
        const sum = `<tr class="wj-grouprow">
          <th class="wj-rowhead wj-ghead"><div class="wr-main">🏫 ${esc(g.name === '—' ? 'Tanpa kelas utama' : g.name)}</div>
            <div class="wr-sub">Gabungan ${g.courses.length} kelas subtest</div><div class="wr-sched">semua sesi kelas utama per hari</div></th>
          ${summaryCells(ymd => plans.filter(x => x.date === ymd && ids.has(x.courseId)), x => subShort(DB.getCourse(x.courseId)), 'group', g.name)}
        </tr>`;
        const rows = g.courses.map(c => {
          const lbl = courseRowLabel(c);
          const schedDays = new Set((c.schedule && c.schedule.days) || []);
          return `<tr>
            <th class="wj-rowhead">
              <div class="wr-main">${lbl.icon} ${esc(subShort(c))} <span class="wr-tag">${esc((c.mainClasses || []).join(', ') || '-')}</span></div>
              <div class="wr-sub">${esc(lbl.sub)}</div>
              <div class="wr-sched">${esc(DB.courseScheduleLabel(c))}</div>
            </th>
            ${Array.from({ length: daysInMonth }, (_, i) => {
              const ymd = cellDate(i + 1);
              const dow = new Date(year, month, i + 1).getDay();
              const isSched = schedDays.has(DB.DAY_NAMES[dow]);
              const list = sortByTime(byCell.get(c.id + '|' + ymd) || []);
              const past = ymd < todayYmd;
              const cls = ['wj-cell', isSched ? 'is-sched' : '', list.length ? 'has-plan' : '',
                list.some(x => clashIds.has(x.id)) ? 'has-clash' : '', ymd === todayYmd ? 'is-today' : '', past ? 'is-past' : ''].filter(Boolean).join(' ');
              return `<td class="${cls}" data-course="${c.id}" data-date="${ymd}" title="${esc(isSched && !list.length ? 'Hari mengajar — klik untuk mengisi rencana' : '')}">
                ${list.map(x => chip(x)).join('')}
                ${past ? '' : `<span class="wc-add" data-add="1" title="Tambah sesi">＋</span>`}
              </td>`;
            }).join('')}
          </tr>`;
        }).join('');
        return sum + rows;
      }).join('');

      container.innerHTML = `
        <div class="stats-grid">
          <div class="stat-card accent-primary"><div class="label">Total Rencana</div><div class="value">${totalPlans}</div><div class="sub">${MONTHS[month]} ${year}</div></div>
          <div class="stat-card accent-success"><div class="label">Sudah Fix</div><div class="value">${fixedCount}</div><div class="sub">tervalidasi tutor</div></div>
          <div class="stat-card accent-warning"><div class="label">Masih Rencana</div><div class="value">${draftCount}</div><div class="sub">belum divalidasi</div></div>
          <div class="stat-card accent-danger"><div class="label">Jadwal Bentrok</div><div class="value">${clashes.length}</div><div class="sub">${needConfirm.length} perlu validasi</div></div>
        </div>

        ${clashes.length ? `
        <div class="card wj-clash-card">
          <div class="card-header">${UI.secHead('⚠️', `Jadwal Bentrok (${clashes.length})`, 'Sesi berjam sama pada kelas utama yang sama, kelas subtest yang sama, atau tutor yang sama')}</div>
          <div class="wj-confirm-list">
            ${clashes.map(x => `<div class="wj-confirm-row is-clash">
              <div><strong>${UI.fmtYMD(x.a.date)}</strong>
                <div class="small">${esc(DB.courseTitle(DB.getCourse(x.a.courseId)))} ${esc(planTimeLabel(x.a))}</div>
                <div class="small">↔ ${esc(DB.describePlanConflict(x.conflict))}</div></div>
              <div class="flex-gap">
                ${DB.canManagePlan(user, x.a) ? `<button class="btn btn-sm btn-secondary" data-edit-plan="${x.a.id}">Ubah sesi 1</button>` : ''}
                ${DB.canManagePlan(user, x.b) ? `<button class="btn btn-sm btn-secondary" data-edit-plan="${x.b.id}">Ubah sesi 2</button>` : ''}
              </div></div>`).join('')}
          </div>
        </div>` : ''}

        ${needConfirm.length ? `
        <div class="card">
          <div class="card-header">${UI.secHead('⏰', 'Menunggu Validasi Anda', `Kelas dalam ${settings.planConfirmLead || 5} hari ke depan yang belum dicentang Fix`)}</div>
          <div class="wj-confirm-list">
            ${needConfirm.map(pl => {
              const c = DB.getCourse(pl.courseId);
              const lbl = c ? courseRowLabel(c) : { main: '-', sub: '', icon: '📘' };
              const ahead = DB.planDaysAhead(pl.date);
              return `<div class="wj-confirm-row">
                <div>
                  <strong>${lbl.icon} ${esc(lbl.main)}</strong>
                  <div class="muted small">${UI.fmtYMD(pl.date)} • ${esc(planTimeLabel(pl))} • ${esc(pl.topic || 'tanpa topik')} • H-${ahead}</div>
                </div>
                <div class="flex-gap">
                  <button class="btn btn-sm btn-secondary" data-edit-plan="${pl.id}">Ubah</button>
                  <button class="btn btn-sm btn-success" data-confirm-plan="${pl.id}">✔ Validasi Fix</button>
                </div>
                <div class="muted small">Tutor: ${esc((DB.getUser(pl.teacherId) || {}).name || '-')}</div>
              </div>`;
            }).join('')}
          </div>
        </div>` : ''}

        <div class="card">
          <div class="card-header">
            ${UI.secHead('🗂️', 'War Jadwal Kelas', 'Per kelas utama: baris 🏫 menampilkan semua sesi hari itu; klik sesi untuk mengubah, ＋ untuk menambah sesi')}
            <div class="flex-gap">
              <button class="btn btn-sm btn-secondary" id="wjPrev">‹ Bulan Lalu</button>
              <strong style="align-self:center;min-width:140px;text-align:center;">${MONTHS[month]} ${year}</strong>
              <button class="btn btn-sm btn-secondary" id="wjNext">Bulan Depan ›</button>
            </div>
          </div>

          <div class="wj-toolbar">
            <button class="btn btn-sm btn-primary" id="wjGenerate">⚡ Isi Otomatis dari Jadwal Kelas</button>
            <button class="btn btn-sm btn-secondary" id="wjAdd">+ Tambah Rencana Manual</button>
            <button class="btn btn-sm btn-ghost" id="wjToday">📍 Hari ini</button>
            <span class="wj-legend">
              <span><i class="lg-sched"></i>Hari mengajar</span>
              <span><i class="lg-draft"></i>Rencana</span>
              <span><i class="lg-fixed"></i>Fix</span>
              <span><i class="lg-changed"></i>Diubah</span>
              <span><i class="lg-cancel"></i>Dibatalkan</span>
              <span><i class="lg-clash"></i>Bentrok</span>
            </span>
          </div>

          ${courses.length === 0
            ? emptyState(user.role === 'admin' ? 'Belum ada kelas. Buat kelas terlebih dahulu.' : 'Anda belum memiliki kelas.')
            : `<div class="wj-wrap" id="wjWrap">
                <table class="wj-sheet">
                  <thead><tr><th class="wj-corner">Kelas / Tanggal</th>${dayHead()}</tr></thead>
                  <tbody>
                    ${user.role === 'guru' ? `<tr class="wj-grouprow wj-mine">
                      <th class="wj-rowhead wj-ghead"><div class="wr-main">🧑‍🏫 Jadwal Saya</div>
                        <div class="wr-sub">${myPlans.length} sesi bulan ini</div><div class="wr-sched">semua kelas yang Anda ajar</div></th>
                      ${summaryCells(ymd => myPlans.filter(x => x.date === ymd), x => { const c = DB.getCourse(x.courseId); return c ? `${(c.mainClasses || [])[0] || ''} ${subShort(c)}`.trim() : '-'; }, 'mine', user.id)}
                    </tr>` : ''}
                    ${groupRows}
                  </tbody>
                </table>
              </div>
              <p class="muted small mt-1">
                Satu hari boleh berisi beberapa sesi (mis. PU 19.20–19.50 dan PPU 20.40–21.00) selama jamnya tidak bertabrakan
                di kelas utama yang sama, kelas subtest yang sama, atau tutor yang sama. Klik tanggal di judul kolom untuk melihat semua sesi hari itu.
                Pengisian rencana dianjurkan mulai H-${settings.planFillLead || 3}.
              </p>`}
        </div>
      `;

      /* ---- Navigasi bulan ---- */
      document.getElementById('wjPrev').addEventListener('click', () => { month--; if (month < 0) { month = 11; year--; } paint(); });
      document.getElementById('wjNext').addEventListener('click', () => { month++; if (month > 11) { month = 0; year++; } paint(); });
      const wrap = document.getElementById('wjWrap');
      const scrollToDay = (ymd) => {
        const th = wrap && wrap.querySelector(`[data-day="${ymd}"]`);
        const corner = wrap && wrap.querySelector('.wj-corner');
        if (th && corner) wrap.scrollLeft = Math.max(0, th.offsetLeft - corner.offsetWidth - 8);
      };
      document.getElementById('wjToday').addEventListener('click', () => {
        if (year !== now.getFullYear() || month !== now.getMonth()) { year = now.getFullYear(); month = now.getMonth(); paint(); }
        scrollToDay(todayYmd);
      });
      if (todayYmd >= from && todayYmd <= to) setTimeout(() => scrollToDay(todayYmd), 0);

      /* ---- Tambah manual ---- */
      document.getElementById('wjAdd').addEventListener('click', () => openPlanForm({ user, date: todayYmd }, paint));

      /* ---- Isi otomatis sebulan dari jadwal kelas (melewati yang bentrok) ---- */
      document.getElementById('wjGenerate').addEventListener('click', () => {
        let created = 0, skipped = 0;
        const clashed = [];
        const pending = [];
        courses.forEach(c => {
          const sc = c.schedule || {};
          const days = new Set(sc.days || []);
          if (!days.size || !sc.time) return;
          const tutorId = DB.courseTeacherIds(c)[0] || null;
          for (let d = 1; d <= daysInMonth; d++) {
            const ymd = cellDate(d);
            if (ymd < todayYmd) continue;                       // lewati tanggal lampau
            const dow = new Date(year, month, d).getDay();
            if (!days.has(DB.DAY_NAMES[dow])) continue;
            if ((byCell.get(c.id + '|' + ymd) || []).length) { skipped++; continue; }
            const cand = { courseId: c.id, teacherId: tutorId, date: ymd, time: sc.time || '', endTime: sc.endTime || '', status: 'draft' };
            const cf = DB.planConflicts(cand, { extra: pending });
            if (cf.length) { clashed.push(`${UI.fmtYMD(ymd)} ${DB.courseTitle(c)} ↔ ${DB.describePlanConflict(cf[0])}`); continue; }
            pending.push(cand);
          }
        });
        pending.forEach(cand => {
          DB.addClassPlan(Object.assign({}, cand, { topic: '', meetingLink: (DB.getCourse(cand.courseId) || {}).meetingLink || '', createdBy: user.id }));
          created++;
        });
        UI.toast(created
          ? `${created} rencana dibuat${skipped ? `, ${skipped} tanggal sudah ada` : ''}${clashed.length ? `, ${clashed.length} dilewati karena bentrok` : ''}. Lengkapi topiknya lalu validasi.`
          : (clashed.length ? `${clashed.length} tanggal dilewati karena bentrok. Atur jamnya manual.` : 'Tidak ada tanggal baru untuk diisi pada bulan ini.'),
          created ? 'success' : 'info');
        paint();
        if (clashed.length) {
          UI.modal.open('Tanggal yang dilewati karena bentrok', `<div class="alert alert-warning small">Jadwal rutin kelas-kelas berikut bertabrakan pada tanggal tersebut, sehingga tidak dibuat otomatis. Tambahkan sesinya secara manual dengan jam yang berbeda.</div>
            <ul class="pf-clash-list">${clashed.slice(0, 80).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
            ${clashed.length > 80 ? `<div class="muted small">…dan ${clashed.length - 80} lainnya.</div>` : ''}`);
        }
      });

      /* ---- Sesi & sel ---- */
      container.querySelectorAll('.wc-chip').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const pl = DB.getClassPlan(b.dataset.plan);
        if (!pl) return;
        if (!DB.canManagePlan(user, pl)) { openDayDetail(pl.date); return; }
        openPlanForm({ user, planId: pl.id }, paint);
      }));
      container.querySelectorAll('.wj-cell[data-course]').forEach(td => td.addEventListener('click', () => {
        const ymd = td.dataset.date;
        if (ymd < todayYmd) {
          if (!td.querySelector('.wc-chip')) UI.toast('Tidak dapat menambah rencana untuk tanggal yang sudah lewat.', 'info');
          return;
        }
        openPlanForm({ user, courseId: td.dataset.course, date: ymd }, paint);
      }));
      container.querySelectorAll('.wj-cell[data-sum], [data-day]').forEach(el => el.addEventListener('click', () => openDayDetail(el.dataset.date || el.dataset.day)));

      /* ---- Validasi cepat ---- */
      container.querySelectorAll('[data-confirm-plan]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!guardPlan(user, b.dataset.confirmPlan)) return;
        const pl = DB.confirmClassPlan(b.dataset.confirmPlan);
        UI.toast('Kelas divalidasi FIX. Siswa & orang tua diberi notifikasi.');
        if (pl) notifyPlanChange(pl, 'fixed');
        paint();
      }));
      container.querySelectorAll('[data-edit-plan]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!guardPlan(user, b.dataset.editPlan)) return;
        openPlanForm({ user, planId: b.dataset.editPlan }, paint);
      }));

      /** Semua sesi satu tanggal, dikelompokkan per kelas utama. */
      function openDayDetail(ymd) {
        const dayPlans = DB.getClassPlansByDate(ymd).filter(x => user.role === 'admin' || visibleIds.has(x.courseId) || x.teacherId === user.id);
        const dayClash = new Set();
        DB.planClashesInRange(ymd, ymd).forEach(x => { dayClash.add(x.a.id); dayClash.add(x.b.id); });
        const html = groups.map(g => {
          const ids = new Set(g.courses.map(c => c.id));
          const list = sortByTime(dayPlans.filter(x => ids.has(x.courseId)));
          return `<div class="wj-day-group"><h4>🏫 ${esc(g.name === '—' ? 'Tanpa kelas utama' : g.name)}</h4>
            ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Jam</th><th>Kelas subtest</th><th>Tutor</th><th>Materi</th><th>Status</th><th></th></tr></thead><tbody>
              ${list.map(x => { const c = DB.getCourse(x.courseId); const t = DB.getUser(x.teacherId);
                return `<tr class="${dayClash.has(x.id) ? 'row-clash' : ''} ${x.status === 'cancelled' ? 'row-cancelled' : ''}">
                  <td><strong>${esc(planTimeLabel(x))}</strong>${dayClash.has(x.id) ? ' <span class="badge badge-danger">bentrok</span>' : ''}</td>
                  <td>${esc(subShort(c))}<div class="muted small">${esc(c ? DB.courseTitle(c) : '-')}</div></td>
                  <td>${esc(t ? t.name : '-')}</td><td>${esc(x.topic || '—')}</td><td>${statusBadge(x.status)}</td>
                  <td>${DB.canManagePlan(user, x) ? `<button type="button" class="btn btn-sm btn-secondary" data-dd-edit="${x.id}">Ubah</button>` : ''}</td></tr>`; }).join('')}
            </tbody></table></div>` : '<div class="muted small">Belum ada sesi.</div>'}
            ${ymd >= todayYmd ? `<div class="flex-gap mt-1" style="flex-wrap:wrap;">${g.courses.map(c => `<button type="button" class="btn btn-sm btn-ghost" data-dd-add="${c.id}">＋ ${esc(subShort(c))}</button>`).join('')}</div>` : ''}
          </div>`;
        }).join('');
        UI.modal.open(`Semua Sesi — ${UI.fmtYMD(ymd)}`, `<div class="ai-modal wj-day-detail">${html || emptyState('Tidak ada kelas.')}</div>`);
        document.querySelectorAll('#modalBody [data-dd-edit]').forEach(b => b.addEventListener('click', () => openPlanForm({ user, planId: b.dataset.ddEdit }, paint)));
        document.querySelectorAll('#modalBody [data-dd-add]').forEach(b => b.addEventListener('click', () => openPlanForm({ user, courseId: b.dataset.ddAdd, date: ymd }, paint)));
      }

      if (global.Effects) Effects.enhance(container);
      if (global.Responsive) Responsive.apply(container);
    }
  }

  /* =====================================================================
   * AGENDA — Hari Ini / Akan Datang / Selesai (tersinkron dengan rencana)
   * ===================================================================*/
  function planCardHtml(pl, opts) {
    const o = opts || {};
    const course = DB.getCourse(pl.courseId);
    const tutor = DB.getUser(pl.teacherId);
    const lbl = course ? courseRowLabel(course) : { main: 'Kelas dihapus', sub: '', icon: '📘' };
    const mayManage = o.user ? DB.canManagePlan(o.user, pl) : !!o.canEdit;
    const link = meetingLinkOf(pl, course);
    const ahead = DB.planDaysAhead(pl.date);
    const isFixed = pl.status === 'fixed';
    const cancelled = pl.status === 'cancelled';

    return `<div class="plan-card ${cancelled ? 'is-cancelled' : ''} ${isFixed ? 'is-fixed' : ''}">
      <div class="pc-main">
        <div class="pc-title">${lbl.icon} ${esc(lbl.main)}</div>
        <div class="pc-sub">${tutor
          ? `<strong>Diajar ${esc(tutor.name)}</strong>`
          : esc(lbl.sub)}</div>
        <div class="pc-meta">
          🗓️ ${UI.fmtYMD(pl.date)}
          ${pl.time ? ` • ⏰ ${esc(pl.time)}${pl.endTime ? '–' + esc(pl.endTime) : ''}` : ''}
          ${ahead > 0 ? ` • H-${ahead}` : (ahead === 0 ? ' • hari ini' : '')}
        </div>
        ${pl.topic ? `<div class="pc-topic">📚 ${esc(pl.topic)}</div>` : '<div class="pc-topic muted">Topik belum diisi tutor</div>'}
        ${pl.note ? `<div class="pc-note">📝 ${esc(pl.note)}</div>` : ''}
      </div>
      <div class="pc-side">
        ${statusBadge(pl.status)}
        ${cancelled ? '<div class="muted small mt-1">Kelas ini dibatalkan</div>' : (
          isFixed && link
            ? `<a class="btn btn-sm btn-success mt-1" href="${esc(link)}" target="_blank" rel="noopener noreferrer">🎥 Masuk Kelas</a>`
            : (isFixed ? '<div class="muted small mt-1">Tautan belum diisi</div>'
                       : '<div class="muted small mt-1">Menunggu validasi tutor</div>')
        )}
        ${o.canEdit && !cancelled ? (mayManage ? `
          <div class="flex-gap mt-1">
            ${pl.status !== 'fixed' ? `<button class="btn btn-sm btn-success" data-confirm-plan="${pl.id}">✔ Fix</button>` : ''}
            <button class="btn btn-sm btn-secondary" data-edit-plan="${pl.id}">Ubah</button>
          </div>`
          : `<div class="mt-1"><span class="lock-note">🔒 Hanya ${esc((tutor && tutor.name) || 'tutor yang ditugaskan')} atau admin yang dapat memvalidasi</span></div>`) : ''}
      </div>
    </div>`;
  }

  function renderAgenda(container, user, mode, onChange) {
    const todayYmd = UI.todayYMD();
    const canEdit = user.role === 'admin' || user.role === 'guru';

    // Sumber data: rencana kelas milik pengguna (admin = semua)
    let plans;
    if (user.role === 'admin') plans = DB.getClassPlans();
    else if (user.role === 'guru') {
      const myIds = new Set(DB.getCoursesByTeacher(user.id).map(c => c.id));
      plans = DB.getClassPlans().filter(p => myIds.has(p.courseId));
    } else plans = DB.getClassPlansForStudent(user.id);

    let list;
    if (mode === 'today') list = plans.filter(p => p.date === todayYmd);
    else if (mode === 'upcoming') list = plans.filter(p => p.date > todayYmd);
    else list = plans.filter(p => p.date < todayYmd);

    list = list.slice().sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    if (mode === 'past') list = list.reverse();

    const titleMap = {
      today: ['📅', 'Kelas Hari Ini', 'Kelas yang sudah divalidasi FIX menampilkan tombol masuk kelas'],
      upcoming: ['⏭️', 'Kelas Akan Datang', 'Rencana kelas yang akan berlangsung'],
      past: ['✅', 'Kelas Selesai', 'Riwayat pelaksanaan kelas']
    };
    const [ic, title, sub] = titleMap[mode] || titleMap.today;

    container.innerHTML = `
      <div class="card">
        <div class="card-header">${UI.secHead(ic, `${title} (${list.length})`, sub)}</div>
        <div id="agendaSearch"></div>
      </div>`;

    const bind = (box) => {
      box.querySelectorAll('[data-confirm-plan]').forEach(b => b.addEventListener('click', () => {
        if (!guardPlan(user, b.dataset.confirmPlan)) return;
        const pl = DB.confirmClassPlan(b.dataset.confirmPlan);
        UI.toast('Kelas divalidasi FIX.');
        if (pl) notifyPlanChange(pl, 'fixed');
        if (typeof onChange === 'function') onChange();
      }));
      box.querySelectorAll('[data-edit-plan]').forEach(b => b.addEventListener('click', () => {
        if (!guardPlan(user, b.dataset.editPlan)) return;
        openPlanForm({ user, planId: b.dataset.editPlan }, onChange);
      }));
    };
    mountPlanSearch(container.querySelector('#agendaSearch'), list, {
      stateKey: `agenda-${user.role}-${mode}`,
      empty: mode === 'today' ? 'Tidak ada kelas hari ini.' : (mode === 'upcoming' ? 'Belum ada rencana kelas ke depan.' : 'Belum ada riwayat kelas.'),
      dates: mode !== 'today',
      newestFirst: mode === 'past',
      render: (rows) => `<div class="plan-list">${rows.map(pl => planCardHtml(pl, { canEdit, user })).join('')}</div>`,
      onPaint: bind
    });

    if (global.Effects) Effects.enhance(container);
  }

  /** Pencarian bersama untuk daftar rencana kelas (judul, tutor, topik, catatan, tanggal). */
  function mountPlanSearch(box, plans, o) {
    const courseIds = [...new Set(plans.map(p => p.courseId))];
    const tutorIds = [...new Set(plans.map(p => p.teacherId).filter(Boolean))];
    const byDate = (a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''));
    DataSearch.mount({
      container: box,
      items: plans,
      stateKey: o.stateKey,
      placeholder: 'Cari kelas, subtest, tutor, topik, catatan, atau tanggal…',
      fields: pl => { const c = DB.getCourse(pl.courseId); const t = DB.getUser(pl.teacherId);
        return [c ? DB.courseTitle(c) : '', c ? c.subtest : '', c ? (c.mainClasses || []) : [], t ? t.name : '', pl.topic, pl.note,
          pl.date, UI.fmtYMD(pl.date), pl.time, (DB.PLAN_STATUS[pl.status] || {}).label || pl.status]; },
      filters: [
        { key: 'course', label: 'Semua kelas', get: pl => pl.courseId,
          options: courseIds.map(id => DB.getCourse(id)).filter(Boolean).map(c => ({ value: c.id, label: DB.courseTitle(c) })) },
        { key: 'status', label: 'Semua status', get: pl => pl.status,
          options: Object.keys(DB.PLAN_STATUS).map(k => ({ value: k, label: DB.PLAN_STATUS[k].label || k })) }
      ].concat(tutorIds.length > 1 ? [{ key: 'tutor', label: 'Semua tutor', get: pl => pl.teacherId || '',
        options: tutorIds.map(id => DB.getUser(id)).filter(Boolean).map(u => ({ value: u.id, label: u.name })) }] : []),
      dateRange: o.dates ? (pl => pl.date) : null,
      sorts: o.newestFirst
        ? [{ key: 'new', label: 'Terbaru', cmp: (a, b) => byDate(b, a) }, { key: 'old', label: 'Terlama', cmp: byDate }]
        : [{ key: 'old', label: 'Terdekat', cmp: byDate }, { key: 'new', label: 'Terjauh', cmp: (a, b) => byDate(b, a) }],
      pageSize: o.pageSize || 12,
      empty: o.empty,
      render: o.render,
      onPaint: o.onPaint
    });
  }

  /* =====================================================================
   * HALAMAN JADWAL (Admin & Tutor)
   * ===================================================================*/
  function renderJadwalPage(container, user) {
    const todayYmd = UI.todayYMD();
    let plans;
    if (user.role === 'admin') plans = DB.getClassPlans();
    else {
      const myIds = new Set(DB.getCoursesByTeacher(user.id).map(c => c.id));
      plans = DB.getClassPlans().filter(p => myIds.has(p.courseId));
    }
    const todayCount = plans.filter(p => p.date === todayYmd).length;
    const upCount = plans.filter(p => p.date > todayYmd).length;
    const pastCount = plans.filter(p => p.date < todayYmd).length;

    let tab = 'war';
    container.innerHTML = `
      <div class="subtabs">
        <button class="subtab-btn" data-jtab="today">📅 Hari Ini (${todayCount})</button>
        <button class="subtab-btn" data-jtab="upcoming">⏭️ Akan Datang (${upCount})</button>
        <button class="subtab-btn active" data-jtab="war">🗂️ War Jadwal Kelas</button>
        <button class="subtab-btn" data-jtab="past">✅ Selesai (${pastCount})</button>
      </div>
      <div id="jadwalBox"></div>`;

    const box = document.getElementById('jadwalBox');
    const reload = () => renderJadwalPage(container, user);

    const paintTab = () => {
      if (tab === 'war') return renderWarSheet(box, user);
      return renderAgenda(box, user, tab, reload);
    };

    container.querySelectorAll('[data-jtab]').forEach(b => b.addEventListener('click', () => {
      container.querySelectorAll('[data-jtab]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      tab = b.dataset.jtab;
      paintTab();
    }));
    paintTab();
  }

  /* =====================================================================
   * TAMPILAN SISWA & ORANG TUA (baca-saja)
   * ===================================================================*/
  function renderPlanTable(container, user, opts) {
    const o = opts || {};
    const studentId = o.studentId || user.id;
    const student = DB.getUser(studentId);
    const todayYmd = UI.todayYMD();
    const all = DB.getClassPlansForStudent(studentId);
    const today = all.filter(p => p.date === todayYmd);
    const upcoming = all.filter(p => p.date > todayYmd);
    const past = all.filter(p => p.date < todayYmd).reverse();

    const rowsHtml = (list) => list.map(pl => {
      const course = DB.getCourse(pl.courseId);
      const lbl = course ? courseRowLabel(course) : { main: '-', sub: '', icon: '📘' };
      const link = meetingLinkOf(pl, course);
      const canJoin = pl.status === 'fixed' && link;
      return `<tr class="${pl.status === 'cancelled' ? 'row-cancelled' : ''}">
        <td>${UI.fmtYMD(pl.date)}<div class="muted small">${esc(pl.time || '-')}${pl.endTime ? '–' + esc(pl.endTime) : ''}</div></td>
        <td><strong>${lbl.icon} ${esc(lbl.main)}</strong><div class="muted small">${esc(lbl.sub)}</div></td>
        <td>${pl.topic ? esc(pl.topic) : '<span class="muted">Belum diisi</span>'}</td>
        <td>${statusBadge(pl.status)}</td>
        <td>${canJoin
          ? `<a class="btn btn-sm btn-success" href="${esc(link)}" target="_blank" rel="noopener noreferrer">🎥 Masuk</a>`
          : (pl.status === 'cancelled' ? '<span class="muted small">Dibatalkan</span>'
                                       : '<span class="muted small">Menunggu</span>')}</td>
      </tr>`;
    }).join('');

    const tableFor = (list, emptyMsg) => list.length === 0
      ? emptyState(emptyMsg)
      : `<div class="table-wrap"><table class="table">
          <thead><tr><th>Tanggal</th><th>Kelas</th><th>Materi</th><th>Status</th><th>Tautan</th></tr></thead>
          <tbody>${rowsHtml(list)}</tbody>
        </table></div>`;

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-success"><div class="label">Kelas Hari Ini</div><div class="value">${today.length}</div><div class="sub">${today.filter(p => p.status === 'fixed').length} sudah fix</div></div>
        <div class="stat-card accent-primary"><div class="label">Akan Datang</div><div class="value">${upcoming.length}</div><div class="sub">rencana kelas</div></div>
        <div class="stat-card accent-warning"><div class="label">Menunggu Validasi</div><div class="value">${all.filter(p => p.status === 'draft' && p.date >= todayYmd).length}</div><div class="sub">belum dipastikan tutor</div></div>
        <div class="stat-card accent-danger"><div class="label">Dibatalkan</div><div class="value">${all.filter(p => p.status === 'cancelled').length}</div></div>
      </div>

      ${o.showChildName && student ? `<div class="alert alert-info">Menampilkan jadwal kelas <strong>${esc(student.name)}</strong> (${esc(student.kelas || '-')}).</div>` : ''}

      <div class="card">
        <div class="card-header">${UI.secHead('📅', `Kelas Hari Ini (${today.length})`, 'Klik "Masuk" untuk membuka Zoom / Google Meet')}</div>
        ${today.length === 0 ? emptyState('Tidak ada kelas hari ini.')
          : `<div class="plan-list">${today.map(pl => planCardHtml(pl, { canEdit: false })).join('')}</div>`}
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('🗂️', 'Rencana Kelas (Akan Datang)', 'Tabel rencana kelas yang disusun tutor')}</div>
        <div id="planUpcoming"></div>
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('✅', 'Riwayat Kelas', `${past.length} pertemuan`)}</div>
        <div id="planPast"></div>
      </div>`;
    mountPlanSearch(container.querySelector('#planUpcoming'), upcoming, {
      stateKey: `plan-up-${studentId}`, dates: true, empty: 'Belum ada rencana kelas ke depan.', render: (rows) => tableFor(rows, '')
    });
    mountPlanSearch(container.querySelector('#planPast'), past, {
      stateKey: `plan-past-${studentId}`, dates: true, newestFirst: true, empty: 'Belum ada riwayat kelas.', render: (rows) => tableFor(rows, '')
    });

    if (global.Effects) Effects.enhance(container);
    if (global.Responsive) Responsive.apply(container);
  }

  /* =====================================================================
   * JADWAL MURID & ORANG TUA — 2 halaman:
   *   1. Jadwal Kelasku   : kelas yang diikuti (dengan tautan masuk kelas)
   *   2. Kelas Utama Lain : jadwal kelas utama lain (baca-saja, tanpa tautan)
   * ===================================================================*/
  const scheduleTab = {};
  function renderStudentSchedule(container, user, opts) {
    const o = opts || {};
    const studentId = o.studentId || user.id;
    const student = DB.getUser(studentId) || user;
    const key = user.id + '|' + studentId;
    const tab = scheduleTab[key] || 'mine';
    const myIds = new Set(DB.getEnrollmentsByStudent(studentId).map(e => e.courseId));
    const activeCourses = DB.getCourses().filter(c => c.active !== false);
    // Kelas utama milik murid: kelas di profil + kelas utama dari kelas subtest yang diikuti.
    const myMains = new Set([student.kelas].concat(activeCourses.filter(c => myIds.has(c.id)).flatMap(c => c.mainClasses || [])).filter(Boolean));
    // Semua kelas utama: daftar resmi + yang hanya tercatat di kelas subtest.
    const allMains = [...new Set(DB.getMainClasses().concat(activeCourses.flatMap(c => c.mainClasses || [])))];
    const otherMains = allMains.filter(m => !myMains.has(m)
      && activeCourses.some(c => (c.mainClasses || []).includes(m) && !myIds.has(c.id)));
    container.innerHTML = `
      <div class="subtabs" role="tablist">
        <button type="button" class="subtab-btn ${tab === 'mine' ? 'active' : ''}" data-stab="mine" role="tab">📚 Jadwal ${o.studentId && o.studentId !== user.id ? 'Kelas Anak' : 'Kelasku'}</button>
        <button type="button" class="subtab-btn ${tab === 'others' ? 'active' : ''}" data-stab="others" role="tab">🏫 Kelas Utama Lain (${otherMains.length})</button>
      </div>
      <div id="stSchedBox"></div>`;
    container.querySelectorAll('[data-stab]').forEach(b => b.addEventListener('click', () => {
      scheduleTab[key] = b.dataset.stab;
      renderStudentSchedule(container, user, o);
    }));
    const box = container.querySelector('#stSchedBox');
    if (tab === 'others') renderOtherMainClasses(box, student, otherMains, myIds, Object.assign({}, o, { myMains: [...myMains] }));
    else renderPlanTable(box, user, o);
  }

  function renderOtherMainClasses(box, student, mains, myIds, o) {
    const todayYmd = UI.todayYMD();
    const mainSet = new Set(mains);
    const courses = DB.getCourses().filter(c => c.active !== false && !myIds.has(c.id) && (c.mainClasses || []).some(m => mainSet.has(m)));
    const cids = new Set(courses.map(c => c.id));
    const plans = DB.getClassPlans().filter(p => cids.has(p.courseId) && p.date >= todayYmd)
      .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    const today = plans.filter(p => p.date === todayYmd);
    box.innerHTML = `
      <div class="alert alert-info small">Jadwal kelas utama lain hanya untuk dilihat (tanpa tautan masuk kelas).
        ${(o.myMains || []).length ? `Kelas utama ${o.showChildName ? esc(student.name) : 'kamu'}: <strong>${esc(o.myMains.join(', '))}</strong>.` : ''}</div>
      ${!mains.length ? emptyState('Belum ada kelas utama lain yang memiliki jadwal.') : `
      <div class="stats-grid">
        <div class="stat-card accent-primary"><div class="label">Kelas Utama Lain</div><div class="value">${mains.length}</div><div class="sub">${courses.length} kelas subtest</div></div>
        <div class="stat-card accent-success"><div class="label">Sesi Hari Ini</div><div class="value">${today.filter(p => p.status !== 'cancelled').length}</div></div>
        <div class="stat-card accent-warning"><div class="label">Akan Datang</div><div class="value">${plans.length}</div><div class="sub">rencana kelas</div></div>
      </div>
      <div class="card">
        <div class="card-header">${UI.secHead('🏫', 'Jadwal Kelas Utama Lain', 'pilih kelas utama untuk menyaring')}</div>
        <div id="otherPlans"></div>
      </div>`}`;
    if (!mains.length) return;
    const mainOf = (pl) => { const c = DB.getCourse(pl.courseId); return ((c && c.mainClasses) || []).filter(m => mainSet.has(m)); };
    DataSearch.mount({
      container: box.querySelector('#otherPlans'),
      items: plans,
      stateKey: 'plan-other-' + student.id,
      placeholder: 'Cari kelas utama, subtest, tutor, atau materi…',
      fields: pl => { const c = DB.getCourse(pl.courseId); const t = DB.getUser(pl.teacherId);
        return [mainOf(pl), c ? c.subtest : '', c ? DB.courseTitle(c) : '', t ? t.name : '', pl.topic, UI.fmtYMD(pl.date), pl.time]; },
      filters: [
        { key: 'main', label: 'Semua kelas utama', get: pl => mainOf(pl), options: mains.map(m => ({ value: m, label: m })) },
        { key: 'sub', label: 'Semua subtest', get: pl => (DB.getCourse(pl.courseId) || {}).subtest || '',
          options: [...new Set(courses.map(c => c.subtest).filter(Boolean))].map(x => ({ value: x, label: (DB.subtestByName(x) || {}).short || x })) }
      ],
      dateRange: pl => pl.date,
      sorts: [{ key: 'old', label: 'Terdekat', cmp: (a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')) }],
      pageSize: 15,
      empty: 'Belum ada jadwal ke depan untuk kelas utama ini.',
      render: (rows) => `<div class="table-wrap"><table class="table">
        <thead><tr><th>Tanggal</th><th>Kelas utama</th><th>Subtest</th><th>Tutor</th><th>Materi</th><th>Status</th></tr></thead>
        <tbody>${rows.map(pl => { const c = DB.getCourse(pl.courseId); const t = DB.getUser(pl.teacherId);
          return `<tr class="${pl.status === 'cancelled' ? 'row-cancelled' : ''}">
            <td>${UI.fmtYMD(pl.date)}<div class="muted small">${esc(planTimeLabel(pl))}</div></td>
            <td><strong>${esc(mainOf(pl).join(', '))}</strong></td>
            <td>${courseRowLabel(c).icon} ${esc(subShort(c))}</td>
            <td>${esc(t ? t.name : '-')}</td>
            <td>${pl.topic ? esc(pl.topic) : '<span class="muted">Belum diisi</span>'}</td>
            <td>${statusBadge(pl.status)}</td></tr>`; }).join('')}</tbody></table></div>`
    });
    if (global.Effects) Effects.enhance(box);
    if (global.Responsive) Responsive.apply(box);
  }

  global.Jadwal = {
    plansForUser, courseScheduleCardHtml, renderStudentSchedule, planTimeLabel, groupByMainClass,
    renderJadwalPage, renderWarSheet, renderAgenda, renderPlanTable,
    openPlanForm, planCardHtml, courseRowLabel, meetingLinkOf, notifyPlanChange
  };
})(window);
