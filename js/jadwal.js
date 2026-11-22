/* ===== LMS Rubela - Jadwal Kelas, War Jadwal & Rencana Materi =====
 * Satu modul untuk seluruh peran:
 *
 *  - renderJadwalPage(container, user)        Admin & Tutor: Hari Ini, Akan Datang,
 *                                              War Jadwal, Rencana Materi, Selesai
 *  - renderStudentSchedule(container, user)   Mentee & orang tua (baca-saja)
 *  - courseScheduleCardHtml(course, user)     kartu jadwal di halaman detail kelas
 *
 * Aturan pertemuan:
 *  - Setiap pertemuan berlangsung 90 menit (DB.PLAN_MINUTES). Tutor cukup memilih
 *    jam mulai; jam selesai dihitung otomatis.
 *  - Satu pertemuan boleh diajar lebih dari satu tutor (teacherIds). Hanya tutor
 *    pertemuan itu atau admin yang dapat mengubah rencana & presensinya.
 *  - Pertemuan pindah sendiri ke "Selesai" begitu jam selesainya lewat.
 *  - Materi pertemuan diambil dari Rencana Materi (minggu ke-n) kelas tersebut.
 */
(function (global) {

  const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const STATUS_FLAG = { fixed: '✔', cancelled: '✕', changed: '↻', draft: '•' };
  const STATUS_OPTION = {
    draft: 'Rencana (belum divalidasi)', fixed: 'Fix (sudah divalidasi)',
    changed: 'Diubah (jadwal bergeser)', cancelled: 'Dibatalkan'
  };

  /* Keadaan halaman yang bertahan saat halaman digambar ulang (per pengguna). */
  const pageTab = {};
  const warState = {};
  const mpState = {};
  const scheduleTab = {};

  function esc(s) { return UI.esc(s); }
  function emptyState(msg, icon) {
    return `<div class="empty"><div class="empty-icon">${icon || '🗓️'}</div>${esc(msg)}</div>`;
  }
  const byDateTime = (a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''));

  /* =====================================================================
   * LABEL & HAK AKSES
   * ===================================================================*/

  /** Kelas yang boleh dikelola pengguna ini. */
  function coursesFor(user) {
    return user.role === 'admin' ? DB.getCourses() : DB.getCoursesByTeacher(user.id);
  }

  /** Rencana yang terlihat di halaman Jadwal: admin semua; tutor kelasnya + pertemuan yang ia ajar. */
  function visiblePlans(user) {
    if (user.role === 'admin') return DB.getClassPlans();
    const ids = new Set(DB.getCoursesByTeacher(user.id).map(c => c.id));
    return DB.getClassPlans().filter(p => ids.has(p.courseId) || DB.planTeacherIds(p).includes(user.id));
  }

  /** Label kelas: "11-A • PK" + "bersama Bu Maria, Pak Budi +3". */
  function courseRowLabel(course) {
    const st = DB.subtestByName(course.subtest);
    const mains = (course.mainClasses || []).join(', ');
    const n = DB.courseTeachers(course).length;
    const sub = st ? st.short : (course.subtest || course.category || 'Kelas');
    return {
      main: [mains, sub].filter(Boolean).join(' • '),
      sub: n ? 'bersama ' + DB.courseTutorsShort(course, 2) : 'belum ada tutor',
      icon: st ? st.icon : '📘'
    };
  }
  function subShort(course) {
    const st = course ? DB.subtestByName(course.subtest) : null;
    return st ? st.short : (course ? (course.subtest || '-') : '-');
  }
  /** "11-A PU" — label ringkas untuk chip. */
  function compactLabel(course) {
    return course ? `${(course.mainClasses || [])[0] || ''} ${subShort(course)}`.trim() : '-';
  }

  /** "Bu Maria Simbolon" → "Bu Maria". */
  function shortName(name) {
    return String(name || '').trim().split(/\s+/).slice(0, 2).join(' ');
  }
  /** Nama tutor pertemuan. short: "Bu Maria +1". */
  function tutorLabel(pl, short) {
    const list = DB.planTeachers(pl);
    if (!list.length) return short ? '' : 'Tutor belum ditentukan';
    if (short) return shortName(list[0].name) + (list.length > 1 ? ' +' + (list.length - 1) : '');
    return list.map(u => u.name).join(' & ');
  }
  function lockText(pl) {
    const names = DB.planTeacherNames(pl, ', ');
    return `Pertemuan ini hanya dapat diubah oleh ${names || 'tutor yang ditugaskan'} atau admin.`;
  }

  function statusBadge(status) {
    const meta = (DB.PLAN_STATUS && DB.PLAN_STATUS[status]) || { label: status, badge: 'badge-gray' };
    return `<span class="badge ${meta.badge}">${esc(meta.label)}</span>`;
  }

  /** Tautan rapat efektif: milik rencana, jatuh ke tautan kelas. */
  function meetingLinkOf(plan, course) {
    return (plan && plan.meetingLink) || (course && course.meetingLink) || '';
  }

  /** "19:20" → "19.20" (format jam Indonesia). */
  function fmtTime(t) { return String(t || '').replace(':', '.'); }
  function planEnd(pl) { return pl.endTime || DB.planEndFor(pl.time); }
  function planTimeLabel(pl) { return pl.time ? fmtTime(pl.time) + '–' + fmtTime(planEnd(pl)) : '--.--'; }
  function shortDate(ymd) {
    const [, m, d] = String(ymd).split('-').map(Number);
    return `${d} ${MONTHS[m - 1].slice(0, 3)}`;
  }
  function shortRange(r) {
    if (!r) return '-';
    return r.from.slice(0, 7) === r.to.slice(0, 7) ? `${Number(r.from.slice(8))}–${shortDate(r.to)}` : `${shortDate(r.from)}–${shortDate(r.to)}`;
  }
  function dowShort(ymd) { return DB.DAY_NAMES[new Date(ymd + 'T00:00:00').getDay()].slice(0, 3); }

  /** "Minggu ke-3" untuk pertemuan (dari rencana materi yang ditautkan, atau tanggal). */
  function weekOfPlan(pl) {
    const mp = pl.materialPlanId ? DB.getMaterialPlan(pl.materialPlanId) : null;
    if (mp) return Number(mp.week);
    return DB.courseWeekOf(DB.getCourse(pl.courseId), pl.date);
  }

  /** Penjaga di setiap aksi (bukan hanya saat menggambar), selaras dengan aturan server. */
  function guardPlan(user, planId) {
    const pl = DB.getClassPlan(planId);
    if (!pl) { UI.toast('Pertemuan tidak ditemukan.', 'error'); return null; }
    if (DB.canManagePlan(user, pl)) return pl;
    UI.toast(lockText(pl), 'error');
    return null;
  }

  /** Bagi rencana menurut fase waktu: hari ini (belum selesai), akan datang, selesai. */
  function splitPlans(plans) {
    const now = DB.nowParts();
    const out = { today: [], upcoming: [], past: [], live: 0 };
    plans.forEach(p => {
      const ph = DB.planPhase(p, now);
      if (ph === 'ended') out.past.push(p);
      else if (ph === 'upcoming') out.upcoming.push(p);
      else { out.today.push(p); if (ph === 'live' && p.status !== 'cancelled') out.live++; }
    });
    out.today.sort(byDateTime);
    out.upcoming.sort(byDateTime);
    out.past.sort((a, b) => byDateTime(b, a));
    return out;
  }

  /**
   * Pindahkan pertemuan ke "Selesai" secara otomatis: tiap 30 detik fase
   * pertemuan diperiksa; bila ada yang berubah, halaman digambar ulang —
   * ditunda selama pengguna sedang mengisi formulir atau membuka dialog.
   */
  let phaseTimer = null;
  function watchPhases(container, getPlans, repaint) {
    clearInterval(phaseTimer);
    const sig = () => { const s = splitPlans(getPlans()); return [s.today.length, s.upcoming.length, s.past.length, s.live].join('/'); };
    let last = sig();
    phaseTimer = setInterval(() => {
      if (!container.isConnected) { clearInterval(phaseTimer); phaseTimer = null; return; }
      const now = sig();
      if (now === last || document.hidden || isBusy(container)) return;
      last = now;
      repaint();
    }, 30000);
  }
  function isBusy(container) {
    if (UI.modal.isOpen() || document.querySelector('details.act-menu[open]') || container.querySelector('.mp-editing')) return true;
    const a = document.activeElement;
    return !!(a && container.contains(a) && a.matches('input, textarea, select, [contenteditable]'));
  }

  /** Kelas dikelompokkan per kelas utama (kelas yang memuat beberapa kelas utama tampil di tiap kelompok). */
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
  /** <option> kelas dikelompokkan per kelas utama (tiap kelas sekali saja). */
  function courseOptionsHtml(courses, selectedId) {
    const seen = new Set();
    return groupByMainClass(courses).map(g => {
      const opts = g.courses.filter(c => !seen.has(c.id)).map(c => {
        seen.add(c.id);
        return `<option value="${esc(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${esc(DB.courseTitle(c))}</option>`;
      }).join('');
      return opts ? `<optgroup label="${esc(g.name === '—' ? 'Tanpa kelas utama' : g.name)}">${opts}</optgroup>` : '';
    }).join('');
  }

  /* =====================================================================
   * SINKRONISASI KE HALAMAN KELAS & KALENDER
   * ===================================================================*/

  /**
   * Rencana kelas yang relevan untuk seorang pengguna pada rentang tanggal.
   * Admin melihat semua, tutor kelas yang diampunya & pertemuan yang ia ajar,
   * mentee kelas yang diikutinya, orang tua gabungan kelas anak-anaknya.
   */
  function plansForUser(user, from, to) {
    if (!user) return [];
    const inRange = (p) => (!from || p.date >= from) && (!to || p.date <= to);
    if (user.role === 'admin' || user.role === 'guru') return visiblePlans(user).filter(inRange);
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
   * Kartu "Jadwal & Kesiapan Materi" di halaman detail kelas: pertemuan hari
   * ini/berikutnya, tutornya, materinya, dan kesiapan bahan ajar.
   */
  function courseScheduleCardHtml(course, user, opts) {
    const o = opts || {};
    const now = DB.nowParts();
    const open = DB.getClassPlansByCourse(course.id).filter(p => DB.planPhase(p, now) !== 'ended').sort(byDateTime);
    const todayPlans = open.filter(p => p.date === now.ymd);
    const upcoming = open.filter(p => p.date > now.ymd).slice(0, 3);
    const week = DB.courseWeekOf(course, now.ymd);
    const weekPlan = DB.materialPlanForDate(course.id, now.ymd);

    const counts = [
      ['📄', DB.getMaterialsByCourse(course.id).length, 'materi'],
      ['📘', DB.getModulesByCourse(course.id).length, 'modul'],
      ['🎥', DB.getRecordingsByCourse(course.id).length, 'rekaman'],
      ['📝', DB.getAssignmentsByCourse(course.id).length, 'tugas'],
      ['🖥️', DB.getCbtsByCourse(course.id).length, 'CBT']
    ];

    const rowFor = (pl, isToday) => {
      const link = meetingLinkOf(pl, course);
      const ahead = DB.planDaysAhead(pl.date);
      const live = DB.planPhase(pl, now) === 'live';
      const tutors = tutorLabel(pl);
      return `<div class="cs-row ${isToday ? 'is-today' : ''} ${pl.status === 'cancelled' ? 'is-cancelled' : ''}">
        <div class="cs-date">
          <span class="cs-d">${esc(shortDate(pl.date))}</span>
          <span class="cs-h">${live ? 'berlangsung' : (isToday ? 'hari ini' : (ahead > 0 ? 'H-' + ahead : ''))}</span>
        </div>
        <div class="cs-body">
          <div class="cs-topic">${pl.topic ? esc(pl.topic) : '<span class="muted">Materi belum diisi tutor</span>'}</div>
          <div class="cs-meta">
            <span>⏰ ${esc(planTimeLabel(pl))}</span>
            <span>👤 ${esc(tutors)}</span>
            ${statusBadge(pl.status)}
          </div>
        </div>
        ${isToday && link && pl.status === 'fixed'
          ? `<a class="btn btn-sm btn-primary" href="${esc(link)}" target="_blank" rel="noopener noreferrer">🎥 Masuk Kelas</a>`
          : ''}
      </div>`;
    };

    return `
      <div class="card course-sched">
        <div class="card-header">
          ${UI.secHead('🗓️', 'Jadwal Kelas & Kesiapan Materi', week ? `minggu ke-${week}${weekPlan ? ' • ' + weekPlan.title : ''}` : 'tersinkron dengan War Jadwal Kelas')}
          ${o.linkToJadwal ? `<button type="button" class="btn btn-sm btn-secondary" id="csGoJadwal">Buka Jadwal Kelas →</button>` : ''}
        </div>
        <div class="cs-list">
          ${todayPlans.length
            ? todayPlans.map(p => rowFor(p, true)).join('')
            : `<div class="cs-row is-empty">
                 <div class="cs-date"><span class="cs-d">Hari ini</span></div>
                 <div class="cs-body"><div class="cs-topic muted">Tidak ada pertemuan yang belum selesai hari ini.</div>
                   <div class="cs-meta">Jadwal rutin: ${esc(DB.courseScheduleLabel(course))}</div></div>
               </div>`}
          ${upcoming.map(p => rowFor(p, false)).join('')}
        </div>
        <div class="cs-ready">
          ${counts.map(([ic, n, label]) => `<span class="cs-chip ${n ? 'ok' : ''}">${ic} ${n} ${label}</span>`).join('')}
        </div>
      </div>`;
  }

  /* =====================================================================
   * FORM PERTEMUAN
   * ===================================================================*/
  function tutorPickerHtml(course, selected) {
    const tutors = DB.courseTeachers(course);
    if (!tutors.length) return '<p class="muted small pf-none">Kelas ini belum punya tutor. Tetapkan tutor lewat menu Semua Kelas.</p>';
    const sel = new Set(selected || []);
    return `<div class="pf-tutors">${tutors.map(t => `
      <label class="pf-tutor"><input type="checkbox" name="teacherIds" value="${esc(t.id)}" ${sel.has(t.id) ? 'checked' : ''} />
        <span class="pf-tutor-av" aria-hidden="true">${esc(UI.initials(t.name))}</span><span class="pf-tutor-name">${esc(t.name)}</span></label>`).join('')}</div>`;
  }
  function defaultTutors(course, user) {
    const ids = DB.courseTeacherIds(course);
    if (user.role === 'guru' && ids.includes(user.id)) return [user.id];
    return ids.slice(0, 1);
  }
  function topicListHtml(courseId) {
    return DB.materialChoices(courseId).map(m =>
      `<option value="${esc(m.name)}">${m.week ? 'Minggu ' + esc(m.week) : 'Materi subtest'}</option>`).join('');
  }
  /** Cocokkan nama materi dengan pilihan materi kelas → { topicId, materialPlanId }. */
  function materialRef(courseId, topic) {
    const t = String(topic || '').trim().toLowerCase();
    const hit = t && DB.materialChoices(courseId).find(m => m.name.toLowerCase() === t);
    return { topicId: (hit && hit.topicId) || null, materialPlanId: (hit && hit.planId) || null };
  }

  /** Jam kosong terdekat (langkah 10 menit) pada hari yang sama. */
  function suggestFreeSlot(d, extra) {
    const w = DB.planWindow(d);
    if (!w) return null;
    const last = 24 * 60 - 1 - DB.PLAN_MINUTES;
    for (let start = w.start + 10; start <= last; start += 10) {
      const time = DB.minutesToTime(start);
      const cand = Object.assign({}, d, { time, endTime: DB.planEndFor(time) });
      if (!DB.planConflicts(cand, { extra }).length) return cand;
    }
    return null;
  }

  function openPlanForm(opts, onDone) {
    const o = opts || {};
    const user = o.user;
    const editing = o.planId ? DB.getClassPlan(o.planId) : null;
    const courses = coursesFor(user);
    let courseId = editing ? editing.courseId : (o.courseId || (courses[0] && courses[0].id));
    let course = DB.getCourse(courseId);
    if (!course) { UI.toast(courses.length ? 'Kelas tidak ditemukan.' : 'Belum ada kelas untuk dijadwalkan.', 'error'); return; }
    if (editing && !DB.canManagePlan(user, editing)) { UI.toast(lockText(editing), 'info'); return; }

    const today = DB.nowParts().ymd;
    const date = editing ? editing.date : (o.date && o.date >= today ? o.date : today);
    const time = editing ? editing.time : ((course.schedule || {}).time || '19:00');
    const settings = DB.getSettings();
    const statuses = ['draft', 'fixed', 'changed'].concat(editing && editing.status === 'cancelled' ? ['cancelled'] : []);
    const curStatus = editing ? editing.status : 'draft';
    let autoTopic = '';
    let topic = editing ? (editing.topic || '') : '';
    if (!editing) {
      const mp = DB.materialPlanForDate(course.id, date);
      if (mp) { topic = mp.title; autoTopic = mp.title; }
    }
    const banner = (c) => {
      const lbl = courseRowLabel(c);
      return `<span class="pf-course-ic" aria-hidden="true">${lbl.icon}</span>
        <span><strong>${esc(lbl.main)}</strong><span class="muted small"> ${esc(lbl.sub)}</span>
        <span class="pf-course-sched">Jadwal rutin: ${esc(DB.courseScheduleLabel(c))}</span></span>`;
    };

    const body = `
      <form id="planForm" class="form pf-form" novalidate>
        <div class="pf-course" id="pfBanner">${banner(course)}</div>

        ${!editing && courses.length > 1 ? `
        <div class="form-group"><label for="pfCourse">Kelas</label>
          <select name="courseId" id="pfCourse">${courseOptionsHtml(courses, courseId)}</select>
        </div>` : ''}

        <div class="form-row">
          <div class="form-group"><label for="pfDate">Tanggal</label>
            <input id="pfDate" name="date" type="date" required value="${esc(date)}" ${editing ? '' : `min="${today}"`} /></div>
          <div class="form-group"><label for="pfTime">Jam mulai</label>
            <div class="pf-time">
              <input id="pfTime" name="time" type="time" required step="300" max="22:29" value="${esc(time)}" />
              <span class="pf-end" id="pfEnd" aria-live="polite"></span>
            </div>
            <div class="pf-quick" id="pfQuick"></div>
          </div>
        </div>
        <p class="pf-rule">Setiap pertemuan berlangsung <strong>${DB.PLAN_MINUTES} menit</strong>; jam selesai terisi otomatis.</p>
        <div id="pfClash" class="pf-clash" aria-live="polite"></div>

        <fieldset class="form-group pf-fs">
          <legend>Tutor pengajar <span class="muted small">boleh lebih dari satu</span></legend>
          <div id="pfTutorBox">${tutorPickerHtml(course, editing ? DB.planTeacherIds(editing) : defaultTutors(course, user))}</div>
          <p class="muted small pf-hint" id="pfTutorHint"></p>
        </fieldset>

        <div class="form-group"><label for="pfTopic">Materi</label>
          <input id="pfTopic" name="topic" list="pfTopicList" maxlength="200" autocomplete="off" required
                 value="${esc(topic)}" placeholder="Pilih dari Rencana Materi atau ketik nama materi" />
          <datalist id="pfTopicList">${topicListHtml(course.id)}</datalist>
          <div class="pf-mat" id="pfMat"></div>
        </div>

        <div class="form-group"><label for="pfLink">Tautan Zoom / Google Meet</label>
          <input id="pfLink" name="meetingLink" type="url" maxlength="300" value="${esc(editing ? (editing.meetingLink || '') : (course.meetingLink || ''))}"
                 placeholder="https://meet.google.com/xxx-xxxx-xxx" />
          <p class="muted small pf-hint">Dipakai tombol "Masuk Kelas" di agenda mentee dan orang tua.</p>
        </div>

        <div class="form-group"><label for="pfStatus">Status</label>
          <select name="status" id="pfStatus">
            ${statuses.map(s => `<option value="${s}" ${s === curStatus ? 'selected' : ''}>${STATUS_OPTION[s]}</option>`).join('')}
          </select>
          <p class="muted small pf-hint" id="pfStatusHint"></p>
        </div>

        <div class="form-group"><label for="pfNote">Catatan <span class="muted small">(opsional)</span></label>
          <textarea id="pfNote" name="note" rows="2" maxlength="1000" placeholder="mis. ruang berubah, bahan yang perlu disiapkan">${esc(editing ? (editing.note || '') : '')}</textarea></div>

        <div class="pf-actions">
          <div class="pf-actions-l">${editing ? `
            <button type="button" class="btn btn-ghost pf-danger" id="pfDelete">Hapus</button>
            ${editing.status !== 'cancelled' ? '<button type="button" class="btn btn-ghost" id="pfCancelPlan">Batalkan pertemuan</button>' : ''}` : ''}
          </div>
          <div class="pf-actions-r">
            <button type="button" class="btn btn-secondary" id="cancelBtn">Tutup</button>
            <button type="submit" class="btn btn-primary">Simpan</button>
          </div>
        </div>
      </form>`;

    UI.modal.open(editing ? 'Ubah Pertemuan' : 'Tambah Pertemuan', body);
    const form = document.getElementById('planForm');
    const $ = (sel) => form.querySelector(sel);
    const dateEl = $('#pfDate'), timeEl = $('#pfTime'), topicEl = $('#pfTopic'), statusEl = $('#pfStatus');
    const clashBox = $('#pfClash');
    $('#cancelBtn').addEventListener('click', () => UI.modal.close());

    const teacherIds = () => [...form.querySelectorAll('input[name="teacherIds"]:checked')].map(x => x.value);
    const readDraft = () => ({
      id: editing ? editing.id : undefined, courseId, teacherIds: teacherIds(),
      date: dateEl.value, time: timeEl.value, endTime: DB.planEndFor(timeEl.value), status: statusEl.value
    });
    const sameTeam = (a, b) => a.slice().sort().join(',') === b.slice().sort().join(',');
    const slotChanged = (d) => !editing || editing.status === 'cancelled' || editing.courseId !== d.courseId
      || editing.date !== d.date || editing.time !== d.time || !sameTeam(DB.planTeacherIds(editing), d.teacherIds);

    function paintEnd() {
      const end = DB.planEndFor(timeEl.value);
      $('#pfEnd').textContent = end ? `s.d. ${fmtTime(end)}` : '';
      const sc = course.schedule || {};
      const quick = $('#pfQuick');
      quick.innerHTML = sc.time && sc.time !== timeEl.value
        ? `<button type="button" class="pf-chip" data-quick-time="${esc(sc.time)}">Jam rutin ${esc(fmtTime(sc.time))}</button>` : '';
    }
    function paintTutorHint() {
      const ids = teacherIds();
      const hint = $('#pfTutorHint');
      const n = DB.courseTeachers(course).length;
      if (!n) { hint.textContent = ''; return; }
      if (!ids.length) { hint.textContent = 'Pilih minimal satu tutor.'; hint.classList.add('is-warn'); return; }
      hint.classList.toggle('is-warn', user.role === 'guru' && !ids.includes(user.id));
      hint.textContent = user.role === 'guru' && !ids.includes(user.id)
        ? 'Anda tidak tercantum sebagai pengajar, sehingga tidak dapat mengubah pertemuan & presensinya setelah disimpan.'
        : `Hanya tutor yang dicentang (dan admin) yang dapat mengubah pertemuan ini dan mengisi presensinya.`;
    }
    function paintStatusHint() {
      const ahead = DB.planDaysAhead(dateEl.value);
      $('#pfStatusHint').textContent = `Validasi Fix dianjurkan mulai H-${settings.planConfirmLead || 5}. `
        + (ahead > 0 ? `Tanggal ini H-${ahead}.` : (ahead === 0 ? 'Tanggal ini hari ini.' : `Tanggal ini sudah lewat ${Math.abs(ahead)} hari.`));
    }
    function paintMaterial() {
      const box = $('#pfMat');
      const ymd = dateEl.value;
      const week = ymd ? DB.courseWeekOf(course, ymd) : 0;
      const mp = ymd ? DB.materialPlanForDate(course.id, ymd) : null;
      if (!ymd) { box.innerHTML = ''; return; }
      if (!week) { box.innerHTML = '<span class="muted small">Tanggal ini sebelum kelas dimulai.</span>'; return; }
      if (!mp) {
        box.innerHTML = `<span class="muted small">Rencana materi minggu ke-${week} belum diisi (tab Rencana Materi).</span>`;
        return;
      }
      const used = topicEl.value.trim().toLowerCase() === mp.title.toLowerCase();
      box.innerHTML = `<span class="small">Minggu ke-${week}: <strong>${esc(mp.title)}</strong></span>
        ${used ? '<span class="pf-mat-ok small">✓ dipakai</span>' : '<button type="button" class="pf-chip" id="pfUseMat">Pakai</button>'}`;
      const use = box.querySelector('#pfUseMat');
      if (use) use.addEventListener('click', () => { topicEl.value = mp.title; autoTopic = mp.title; paintMaterial(); });
    }
    /** Ganti materi otomatis bila tanggal/kelas berubah, selama tutor belum mengetik sendiri. */
    function refreshAutoTopic() {
      const cur = topicEl.value.trim();
      if (cur && cur !== autoTopic) return;
      const mp = dateEl.value ? DB.materialPlanForDate(course.id, dateEl.value) : null;
      autoTopic = mp ? mp.title : '';
      topicEl.value = autoTopic;
    }
    function checkClash() {
      const d = readDraft();
      const err = d.status === 'cancelled' ? null : DB.validatePlanTimes(d);
      if (err) { clashBox.innerHTML = `<div class="alert alert-warning small">${esc(err)}</div>`; return { err, list: [] }; }
      if (!editing && d.date && DB.planPhase(d) === 'ended') {
        clashBox.innerHTML = '<div class="alert alert-warning small">Jam pertemuan ini sudah lewat. Pilih jam atau tanggal lain.</div>';
        return { err: 'past', list: [] };
      }
      const list = DB.planConflicts(d);
      if (!list.length) {
        clashBox.innerHTML = d.status === 'cancelled' ? '' : '<div class="pf-ok small">✓ Tidak bentrok dengan kelas utama, kelas subtest, maupun tutor yang sama.</div>';
        return { list };
      }
      const free = suggestFreeSlot(d);
      clashBox.innerHTML = `<div class="alert alert-error small"><strong>Jadwal bentrok pada ${esc(UI.fmtYMD(d.date))}:</strong>
        <ul class="pf-clash-list">${list.map(c => `<li>${esc(DB.describePlanConflict(c))}</li>`).join('')}</ul>
        ${slotChanged(d) ? 'Ubah tanggal, jam, atau tutor agar tidak bertabrakan.' : 'Bentrok ini sudah ada sebelumnya; sebaiknya jadwal digeser.'}
        ${free ? `<div class="mt-1"><button type="button" class="btn btn-sm btn-secondary" id="pfUseFree">Pakai jam kosong terdekat: ${esc(fmtTime(free.time))}–${esc(fmtTime(free.endTime))}</button></div>` : ''}</div>`;
      const use = clashBox.querySelector('#pfUseFree');
      if (use) use.addEventListener('click', () => { timeEl.value = free.time; paintEnd(); checkClash(); });
      return { list };
    }
    const repaintAll = () => { paintEnd(); paintTutorHint(); paintStatusHint(); paintMaterial(); checkClash(); };

    const courseSel = $('#pfCourse');
    if (courseSel) courseSel.addEventListener('change', () => {
      const c = DB.getCourse(courseSel.value);
      if (!c) return;
      course = c;
      courseId = c.id;
      $('#pfBanner').innerHTML = banner(c);
      $('#pfTutorBox').innerHTML = tutorPickerHtml(c, defaultTutors(c, user));
      $('#pfTopicList').innerHTML = topicListHtml(c.id);
      if ((c.schedule || {}).time) timeEl.value = c.schedule.time;
      const linkEl = $('#pfLink');
      if (!linkEl.value.trim() || courses.some(x => x.meetingLink && x.meetingLink === linkEl.value.trim())) linkEl.value = c.meetingLink || '';
      refreshAutoTopic();
      repaintAll();
    });
    dateEl.addEventListener('change', () => { refreshAutoTopic(); repaintAll(); });
    timeEl.addEventListener('input', () => { paintEnd(); checkClash(); });
    statusEl.addEventListener('change', checkClash);
    topicEl.addEventListener('input', paintMaterial);
    form.addEventListener('change', (e) => { if (e.target.name === 'teacherIds') { paintTutorHint(); checkClash(); } });
    form.addEventListener('click', (e) => {
      const q = e.target.closest('[data-quick-time]');
      if (q) { timeEl.value = q.dataset.quickTime; paintEnd(); checkClash(); }
    });
    repaintAll();

    const del = $('#pfDelete');
    if (del) del.addEventListener('click', () => {
      UI.modal.close();
      deletePlanFlow(user, editing.id, onDone);
    });
    const cancelPlan = $('#pfCancelPlan');
    if (cancelPlan) cancelPlan.addEventListener('click', () => openCancelDialog(user, editing.id, onDone));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const d = readDraft();
      const topicVal = topicEl.value.replace(/\s+/g, ' ').trim();
      const link = $('#pfLink').value.trim();
      if (!d.date) { UI.toast('Tanggal wajib diisi.', 'error'); dateEl.focus(); return; }
      if (!editing && d.date < today) { UI.toast('Tanggal sudah lewat.', 'error'); dateEl.focus(); return; }
      if (DB.courseTeachers(course).length && !d.teacherIds.length) { UI.toast('Pilih minimal satu tutor pengajar.', 'error'); return; }
      if (topicVal.length < 2) { UI.toast('Materi pertemuan wajib diisi.', 'error'); topicEl.focus(); return; }
      if (link && !/^https?:\/\/[^\s<>"']+$/i.test(link)) { UI.toast('Tautan harus diawali http:// atau https://', 'error'); $('#pfLink').focus(); return; }
      const res = checkClash();
      if (res.err) { UI.toast(res.err === 'past' ? 'Jam pertemuan ini sudah lewat.' : res.err, 'error'); timeEl.focus(); return; }
      if (res.list.length && slotChanged(d)) {
        UI.toast(`Jadwal bentrok dengan ${res.list.length} sesi lain. Geser jam/tanggal atau ganti tutor.`, 'error');
        return;
      }
      if (user.role === 'guru' && !d.teacherIds.includes(user.id)
        && !UI.confirmDialog('Anda tidak tercantum sebagai pengajar pertemuan ini, sehingga tidak dapat mengubahnya lagi setelah disimpan. Lanjutkan?')) return;

      const payload = Object.assign({
        courseId, teacherIds: d.teacherIds, date: d.date, time: d.time, endTime: d.endTime,
        topic: topicVal, meetingLink: link, status: d.status, note: $('#pfNote').value.trim()
      }, materialRef(courseId, topicVal));
      if (payload.status === 'fixed' && (!editing || editing.status !== 'fixed')) payload.confirmedAt = Date.now();
      if (editing && editing.status === 'cancelled' && payload.status !== 'cancelled') Object.assign(payload, { cancelledAt: null, cancelReason: '', prevStatus: null });

      const before = editing ? DB.planTeacherIds(editing) : [];
      let saved;
      if (editing) {
        saved = DB.updateClassPlan(editing.id, payload);
        UI.toast('Pertemuan diperbarui.');
        const visible = ['date', 'time', 'topic', 'status', 'meetingLink'].some(k => String(editing[k] || '') !== String(payload[k] || ''));
        if (visible && (editing.status === 'fixed' || ['fixed', 'changed'].includes(payload.status))) notifyPlanChange(saved, editing.status !== 'fixed' && payload.status === 'fixed' ? 'fixed' : 'update');
      } else {
        saved = DB.addClassPlan(Object.assign({ createdBy: user.id }, payload));
        UI.toast('Pertemuan ditambahkan.');
        if (payload.status === 'fixed') notifyPlanChange(saved, 'fixed');
      }
      notifyNewTutors(saved, before, user);
      UI.modal.close();
      if (typeof onDone === 'function') onDone();
    });
  }

  /** Beri tahu tutor yang baru ditambahkan ke sebuah pertemuan. */
  function notifyNewTutors(plan, before, actor) {
    if (!plan) return;
    const was = new Set(before || []);
    const fresh = DB.planTeacherIds(plan).filter(id => !was.has(id) && id !== actor.id);
    if (!fresh.length) return;
    const course = DB.getCourse(plan.courseId);
    DB.notifyUsers(fresh, {
      type: 'jadwal', icon: '🗓️', title: 'Anda dijadwalkan mengajar',
      body: `${course ? DB.courseTitle(course) : 'Kelas'} — ${UI.fmtYMD(plan.date)} ${planTimeLabel(plan)}${plan.topic ? ' • ' + plan.topic : ''}`,
      link: 'jadwal-kelas'
    });
  }

  /** Beritahu mentee & orang tua bila pertemuan difinalkan / berubah / dibatalkan. */
  function notifyPlanChange(plan, kind) {
    const course = plan && DB.getCourse(plan.courseId);
    if (!course) return;
    const students = DB.getEnrollmentsByCourse(course.id).map(e => e.studentId);
    const title = kind === 'fixed' ? 'Jadwal kelas dikonfirmasi'
      : (plan.status === 'cancelled' ? 'Kelas dibatalkan' : 'Jadwal kelas diperbarui');
    const body = `${DB.courseTitle(course)} — ${UI.fmtYMD(plan.date)} ${plan.time ? planTimeLabel(plan) : ''}${plan.topic ? ' • ' + plan.topic : ''}`
      + (plan.status === 'cancelled' && plan.cancelReason ? ` (${plan.cancelReason})` : '');
    DB.notifyUsers(students, { type: 'jadwal', icon: '🗓️', title, body, link: 'jadwal-siswa' });
    students.forEach(sid => {
      DB.getParentsOfStudent(sid).forEach(p => DB.addNotification({
        userId: p.id, type: 'jadwal', icon: '🗓️', title, body, link: 'anak-jadwal'
      }));
    });
  }

  /* ---- Batalkan, pulihkan, hapus ---- */
  function planSummary(pl) {
    const c = DB.getCourse(pl.courseId);
    return `${c ? courseRowLabel(c).main : 'Kelas'} • ${UI.fmtYMD(pl.date)} • ${planTimeLabel(pl)}`;
  }
  function openCancelDialog(user, planId, onDone) {
    const pl = guardPlan(user, planId);
    if (!pl) return;
    const ended = DB.planEnded(pl);
    UI.modal.open('Batalkan Pertemuan', `
      <form id="cancelPlanForm" class="form">
        <div class="pf-course"><span><strong>${esc(planSummary(pl))}</strong>
          <span class="pf-course-sched">${esc(pl.topic || 'Materi belum diisi')} • ${esc(tutorLabel(pl))}</span></span></div>
        <p class="muted small">Pertemuan tetap tercatat dengan status <strong>Dibatalkan</strong> dan tidak dihitung dalam persentase kehadiran. Anda dapat memulihkannya kapan saja.</p>
        <div class="form-group"><label for="cpReason">Alasan <span class="muted small">(opsional)</span></label>
          <input id="cpReason" maxlength="200" placeholder="mis. tutor berhalangan, libur nasional" /></div>
        <label class="check-row"><input type="checkbox" id="cpNotify" ${ended ? '' : 'checked'} /> Beri tahu mentee & orang tua</label>
        <div class="pf-actions"><span></span><div class="pf-actions-r">
          <button type="button" class="btn btn-secondary" id="cpBack">Kembali</button>
          <button type="submit" class="btn btn-danger">Batalkan pertemuan</button></div></div>
      </form>`);
    document.getElementById('cpBack').addEventListener('click', () => UI.modal.close());
    document.getElementById('cancelPlanForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!guardPlan(user, planId)) return;
      const saved = DB.cancelClassPlan(planId, document.getElementById('cpReason').value);
      const notify = document.getElementById('cpNotify').checked;
      UI.modal.close();
      if (notify && saved) notifyPlanChange(saved, 'cancel');
      UI.toast('Pertemuan dibatalkan.', 'success', {
        label: 'Urungkan', onClick: () => { restorePlanFlow(user, planId, onDone); }
      });
      if (typeof onDone === 'function') onDone();
    });
  }
  function restorePlanFlow(user, planId, onDone) {
    const pl = guardPlan(user, planId);
    if (!pl || pl.status !== 'cancelled') return;
    const draft = Object.assign({}, pl, { status: pl.prevStatus && pl.prevStatus !== 'cancelled' ? pl.prevStatus : 'draft', endTime: DB.planEndFor(pl.time) });
    const clash = DB.planConflicts(draft);
    if (clash.length) {
      UI.toast(`Tidak dapat dipulihkan: jamnya kini bentrok dengan ${DB.describePlanConflict(clash[0])}.`, 'error');
      return;
    }
    DB.restoreClassPlan(planId);
    UI.toast('Pertemuan dipulihkan.');
    if (typeof onDone === 'function') onDone();
  }
  function deletePlanFlow(user, planId, onDone) {
    const pl = guardPlan(user, planId);
    if (!pl) return;
    const att = DB.planAttendance(pl).length;
    const msg = `Hapus pertemuan ${planSummary(pl)}?`
      + (att ? `\n\n${att} catatan presensi pertemuan ini ikut terhapus. Pilih "Batalkan" pada pertemuan bila presensinya ingin tetap disimpan.` : '');
    if (!UI.confirmDialog(msg)) return;
    const snap = DB.deleteClassPlan(planId);
    UI.toast(att ? `Pertemuan & ${att} presensi dihapus.` : 'Pertemuan dihapus.', 'success', {
      label: 'Urungkan', onClick: () => {
        if (DB.reinstateClassPlan(snap)) { UI.toast('Pertemuan dikembalikan.'); if (typeof onDone === 'function') onDone(); }
      }
    });
    if (typeof onDone === 'function') onDone();
  }
  function confirmPlanFlow(user, planId, onDone) {
    if (!guardPlan(user, planId)) return;
    const pl = DB.confirmClassPlan(planId);
    UI.toast('Pertemuan divalidasi Fix. Mentee & orang tua diberi notifikasi.');
    if (pl) notifyPlanChange(pl, 'fixed');
    if (typeof onDone === 'function') onDone();
  }

  /** Satu pendengar klik untuk seluruh aksi pertemuan di dalam `root`. */
  function bindPlanActions(root, user, onDone) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-plan-act]');
      if (!b || !root.contains(b)) return;
      const id = b.dataset.plan;
      const act = b.dataset.planAct;
      if (act === 'edit') { if (guardPlan(user, id)) openPlanForm({ user, planId: id }, onDone); }
      else if (act === 'fix') confirmPlanFlow(user, id, onDone);
      else if (act === 'cancel') openCancelDialog(user, id, onDone);
      else if (act === 'restore') restorePlanFlow(user, id, onDone);
      else if (act === 'delete') deletePlanFlow(user, id, onDone);
    });
  }

  /* =====================================================================
   * WAR JADWAL KELAS — rencana satu bulan (tabel atau per hari)
   * ===================================================================*/
  function renderWarSheet(container, user, onChange) {
    const now = UI.nowInTz();
    const st = warState[user.id] || (warState[user.id] = {
      year: now.getFullYear(), month: now.getMonth(),
      view: global.matchMedia && matchMedia('(max-width: 767px)').matches ? 'day' : 'table'
    });
    const changed = () => { if (typeof onChange === 'function') onChange(); else paint(); };
    bindPlanActions(container, user, changed);
    paint();

    function paint() {
      const { year, month } = st;
      const courses = coursesFor(user);
      const visibleIds = new Set(courses.map(c => c.id));
      const nowP = DB.nowParts();
      const todayYmd = nowP.ymd;
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const settings = DB.getSettings();
      const p2 = n => String(n).padStart(2, '0');
      const cellDate = (d) => `${year}-${p2(month + 1)}-${p2(d)}`;
      const from = cellDate(1), to = cellDate(daysInMonth);

      const plans = DB.getClassPlansInRange(from, to);
      const scoped = user.role === 'admin' ? plans
        : plans.filter(x => visibleIds.has(x.courseId) || DB.planTeacherIds(x).includes(user.id));
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
      const myPlans = user.role === 'guru' ? plans.filter(pl => DB.planTeacherIds(pl).includes(user.id)) : [];
      const fixedCount = scoped.filter(x => x.status === 'fixed').length;
      const draftCount = scoped.filter(x => x.status === 'draft').length;
      // Hanya pertemuan yang BOLEH divalidasi pengguna ini.
      const needConfirm = scoped.filter(x => {
        const ahead = DB.planDaysAhead(x.date);
        return x.status === 'draft' && ahead >= 0 && ahead <= (settings.planConfirmLead || 5)
          && DB.planPhase(x, nowP) !== 'ended' && DB.canManagePlan(user, x);
      }).sort(byDateTime);
      const sortByTime = (list) => list.slice().sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
      const tipOf = (pl, label) => {
        const c = DB.getCourse(pl.courseId);
        return [label || (c ? DB.courseTitle(c) : ''), planTimeLabel(pl), pl.topic || '(materi belum diisi)',
          (DB.PLAN_STATUS[pl.status] || {}).label || pl.status, 'diajar ' + tutorLabel(pl),
          clashIds.has(pl.id) ? 'BENTROK' : ''].filter(Boolean).join(' • ');
      };
      const chip = (pl, label) => {
        const clash = clashIds.has(pl.id);
        return `<button type="button" class="wc-chip st-${esc(pl.status)} ${clash ? 'is-clash' : ''} ${DB.planPhase(pl, nowP) === 'ended' ? 'is-ended' : ''}" data-plan="${esc(pl.id)}" title="${esc(tipOf(pl, label))}">
          ${label ? `<span class="wc-sub">${esc(label)}</span>` : ''}
          <span class="wc-time">${esc(fmtTime(pl.time))}</span>
          ${!label && pl.topic ? `<span class="wc-topic">${esc(RichText.plain(pl.topic, 22))}</span>` : ''}
          <span class="wc-tutor">${esc(tutorLabel(pl, true))}</span>
          <span class="wc-flag" aria-hidden="true">${clash ? '⚠' : (STATUS_FLAG[pl.status] || '•')}</span>
        </button>`;
      };

      /* ---------- tampilan tabel ---------- */
      const tableHtml = () => {
        const dayHead = Array.from({ length: daysInMonth }, (_, i) => {
          const ymd = cellDate(i + 1);
          const dow = new Date(year, month, i + 1).getDay();
          return `<th class="wj-day ${ymd === todayYmd ? 'is-today' : ''} ${dow === 0 ? 'is-weekend' : ''}" data-day="${ymd}" title="Lihat semua sesi tanggal ini">
            <span class="wd-num">${i + 1}</span><span class="wd-dow">${DB.DAY_NAMES[dow].slice(0, 3)}</span></th>`;
        }).join('');
        const summaryCells = (pick, labelOf) => Array.from({ length: daysInMonth }, (_, i) => {
          const ymd = cellDate(i + 1);
          const list = sortByTime(pick(ymd));
          return `<td class="wj-cell wj-sum ${list.some(x => clashIds.has(x.id)) ? 'has-clash' : ''} ${ymd === todayYmd ? 'is-today' : ''}" data-date="${ymd}">
            ${list.map(x => chip(x, labelOf(x))).join('')}</td>`;
        }).join('');
        const rows = groups.map(g => {
          const ids = new Set(g.courses.map(c => c.id));
          const sum = `<tr class="wj-grouprow">
            <th class="wj-rowhead wj-ghead"><div class="wr-main">🏫 ${esc(g.name === '—' ? 'Tanpa kelas utama' : g.name)}</div>
              <div class="wr-sub">${g.courses.length} kelas subtest</div></th>
            ${summaryCells(ymd => plans.filter(x => x.date === ymd && ids.has(x.courseId)), x => subShort(DB.getCourse(x.courseId)))}
          </tr>`;
          return sum + g.courses.map(c => {
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
                const list = sortByTime(byCell.get(c.id + '|' + ymd) || []);
                const past = ymd < todayYmd;
                const cls = ['wj-cell', schedDays.has(DB.DAY_NAMES[dow]) ? 'is-sched' : '', list.length ? 'has-plan' : '',
                  list.some(x => clashIds.has(x.id)) ? 'has-clash' : '', ymd === todayYmd ? 'is-today' : '', past ? 'is-past' : ''].filter(Boolean).join(' ');
                return `<td class="${cls}" data-course="${esc(c.id)}" data-date="${ymd}">
                  ${list.map(x => chip(x)).join('')}
                  ${past ? '' : `<button type="button" class="wc-add" data-add-course="${esc(c.id)}" data-date="${ymd}" aria-label="Tambah pertemuan ${esc(subShort(c))} ${esc(UI.fmtYMD(ymd))}">＋</button>`}
                </td>`;
              }).join('')}
            </tr>`;
          }).join('');
        }).join('');
        return `<div class="wj-wrap" id="wjWrap">
            <table class="wj-sheet">
              <thead><tr><th class="wj-corner">Kelas / Tanggal</th>${dayHead}</tr></thead>
              <tbody>
                ${user.role === 'guru' ? `<tr class="wj-grouprow wj-mine">
                  <th class="wj-rowhead wj-ghead"><div class="wr-main">🧑‍🏫 Jadwal Saya</div>
                    <div class="wr-sub">${myPlans.length} pertemuan bulan ini</div></th>
                  ${summaryCells(ymd => myPlans.filter(x => x.date === ymd), x => compactLabel(DB.getCourse(x.courseId)))}
                </tr>` : ''}
                ${rows}
              </tbody>
            </table>
          </div>
          <div class="wj-legend" aria-label="Keterangan warna">
            <span><i class="lg-sched"></i>Hari mengajar</span><span><i class="lg-draft"></i>Rencana</span>
            <span><i class="lg-fixed"></i>Fix</span><span><i class="lg-changed"></i>Diubah</span>
            <span><i class="lg-cancel"></i>Dibatalkan</span><span><i class="lg-clash"></i>Bentrok</span>
          </div>`;
      };

      /* ---------- tampilan per hari (ponsel) ---------- */
      const dayHtml = () => {
        const out = [];
        for (let d = 1; d <= daysInMonth; d++) {
          const ymd = cellDate(d);
          if (!st.showPast && ymd < todayYmd) continue;
          const dow = new Date(year, month, d).getDay();
          const list = sortByTime(scoped.filter(x => x.date === ymd));
          const free = ymd < todayYmd ? [] : courses.filter(c => ((c.schedule || {}).days || []).includes(DB.DAY_NAMES[dow])
            && (c.schedule || {}).time && !list.some(x => x.courseId === c.id));
          if (!list.length && !free.length) continue;
          out.push(`<section class="wjd ${ymd === todayYmd ? 'is-today' : ''} ${ymd < todayYmd ? 'is-past' : ''}">
            <header class="wjd-head">
              <div class="wjd-date"><strong>${d} ${MONTHS[month].slice(0, 3)}</strong><span>${ymd === todayYmd ? 'Hari ini' : DB.DAY_NAMES[dow]}</span></div>
              ${ymd >= todayYmd ? `<button type="button" class="btn btn-sm btn-ghost" data-add-date="${ymd}">＋ Tambah</button>` : ''}
            </header>
            ${list.map(x => {
              const c = DB.getCourse(x.courseId);
              const clash = clashIds.has(x.id);
              return `<button type="button" class="wjd-item st-${esc(x.status)} ${clash ? 'is-clash' : ''} ${DB.planPhase(x, nowP) === 'ended' ? 'is-ended' : ''}" data-plan="${esc(x.id)}">
                <span class="wjd-time">${esc(fmtTime(x.time))}<small>${esc(fmtTime(planEnd(x)))}</small></span>
                <span class="wjd-body"><strong>${esc(c ? courseRowLabel(c).main : 'Kelas dihapus')}</strong>
                  <span class="wjd-topic">${x.topic ? esc(x.topic) : '<em>Materi belum diisi</em>'}</span>
                  <span class="wjd-tutor">${esc(tutorLabel(x))}</span></span>
                <span class="wjd-flag">${clash ? '<span class="badge badge-danger">Bentrok</span>' : statusBadge(x.status)}</span>
              </button>`;
            }).join('')}
            ${free.length ? `<div class="wjd-free"><span>Jadwal rutin belum diisi:</span>
              ${free.map(c => `<button type="button" class="pf-chip" data-add-course="${esc(c.id)}" data-date="${ymd}">＋ ${esc(compactLabel(c))} ${esc(fmtTime(c.schedule.time))}</button>`).join('')}</div>` : ''}
          </section>`);
        }
        const pastToggle = year === now.getFullYear() && month === now.getMonth()
          ? `<button type="button" class="btn btn-sm btn-ghost wjd-past" id="wjPast">${st.showPast ? 'Sembunyikan tanggal yang lewat' : 'Tampilkan tanggal yang lewat'}</button>` : '';
        return `${pastToggle}<div class="wjd-list">${out.join('') || emptyState('Tidak ada pertemuan atau jadwal rutin pada sisa bulan ini.')}</div>`;
      };

      container.innerHTML = `
        <div class="stats-grid wj-stats">
          <div class="stat-card accent-primary"><div class="label">Pertemuan</div><div class="value">${scoped.length}</div><div class="sub">${MONTHS[month]} ${year}</div></div>
          <div class="stat-card accent-success"><div class="label">Sudah Fix</div><div class="value">${fixedCount}</div><div class="sub">tervalidasi tutor</div></div>
          <div class="stat-card accent-warning"><div class="label">Rencana</div><div class="value">${draftCount}</div><div class="sub">${needConfirm.length} perlu validasi Anda</div></div>
          <div class="stat-card accent-danger"><div class="label">Bentrok</div><div class="value">${clashes.length}</div><div class="sub">pasang sesi</div></div>
        </div>

        ${clashes.length ? `
        <div class="card wj-clash-card">
          <div class="card-header">${UI.secHead('⚠️', `Jadwal Bentrok (${clashes.length})`, 'Sesi berjam sama pada kelas utama, kelas subtest, atau tutor yang sama')}</div>
          <div class="wj-confirm-list">
            ${clashes.map(x => `<div class="wj-confirm-row is-clash">
              <div><strong>${UI.fmtYMD(x.a.date)}</strong>
                <div class="small">${esc(DB.courseTitle(DB.getCourse(x.a.courseId)))} ${esc(planTimeLabel(x.a))}</div>
                <div class="small">↔ ${esc(DB.describePlanConflict(x.conflict))}</div></div>
              <div class="flex-gap">
                ${DB.canManagePlan(user, x.a) ? `<button type="button" class="btn btn-sm btn-secondary" data-plan-act="edit" data-plan="${esc(x.a.id)}">Ubah sesi 1</button>` : ''}
                ${DB.canManagePlan(user, x.b) ? `<button type="button" class="btn btn-sm btn-secondary" data-plan-act="edit" data-plan="${esc(x.b.id)}">Ubah sesi 2</button>` : ''}
              </div></div>`).join('')}
          </div>
        </div>` : ''}

        ${needConfirm.length ? `
        <div class="card">
          <div class="card-header">${UI.secHead('⏰', 'Menunggu Validasi Anda', `Pertemuan dalam ${settings.planConfirmLead || 5} hari ke depan yang belum Fix`)}</div>
          <div class="wj-confirm-list">
            ${needConfirm.map(pl => {
              const c = DB.getCourse(pl.courseId);
              const lbl = c ? courseRowLabel(c) : { main: '-', icon: '📘' };
              return `<div class="wj-confirm-row">
                <div>
                  <strong>${lbl.icon} ${esc(lbl.main)}</strong>
                  <div class="muted small">${UI.fmtYMD(pl.date)} • ${esc(planTimeLabel(pl))} • ${esc(pl.topic || 'materi belum diisi')} • H-${DB.planDaysAhead(pl.date)}</div>
                  <div class="muted small">Tutor: ${esc(tutorLabel(pl))}</div>
                </div>
                <div class="flex-gap">
                  <button type="button" class="btn btn-sm btn-secondary" data-plan-act="edit" data-plan="${esc(pl.id)}">Ubah</button>
                  <button type="button" class="btn btn-sm btn-success" data-plan-act="fix" data-plan="${esc(pl.id)}">✔ Validasi Fix</button>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>` : ''}

        <div class="card wj-card">
          <div class="card-header">${UI.secHead('🗂️', 'War Jadwal Kelas', 'Rencana pertemuan satu bulan per kelas utama')}</div>
          <div class="wj-bar">
            <div class="wj-month" role="group" aria-label="Pilih bulan">
              <button type="button" class="btn btn-sm btn-secondary wj-nav" id="wjPrev" aria-label="Bulan sebelumnya">‹</button>
              <strong class="wj-month-label">${MONTHS[month]} ${year}</strong>
              <button type="button" class="btn btn-sm btn-secondary wj-nav" id="wjNext" aria-label="Bulan berikutnya">›</button>
              <button type="button" class="btn btn-sm btn-ghost" id="wjToday">Hari ini</button>
            </div>
            <div class="wj-view" role="group" aria-label="Tampilan">
              <button type="button" class="wj-seg ${st.view === 'table' ? 'is-on' : ''}" data-wjview="table" aria-pressed="${st.view === 'table'}">Tabel</button>
              <button type="button" class="wj-seg ${st.view === 'day' ? 'is-on' : ''}" data-wjview="day" aria-pressed="${st.view === 'day'}">Per hari</button>
            </div>
            <div class="wj-acts">
              <button type="button" class="btn btn-sm btn-secondary" id="wjGenerate" ${courses.length ? '' : 'disabled'} title="Buat pertemuan bulan ini dari jadwal rutin kelas">⚡ Isi otomatis</button>
              <button type="button" class="btn btn-sm btn-primary" id="wjAdd" ${courses.length ? '' : 'disabled'}>＋ Tambah<span class="wj-long"> pertemuan</span></button>
            </div>
          </div>
          <p class="wj-rule">Setiap pertemuan berlangsung <strong>${DB.PLAN_MINUTES} menit</strong>. Pilih jam mulai; jam selesai terisi otomatis.</p>
          ${courses.length === 0
            ? emptyState(user.role === 'admin' ? 'Belum ada kelas. Buat kelas terlebih dahulu.' : 'Anda belum memiliki kelas.')
            : (st.view === 'day' ? dayHtml() : tableHtml())}
        </div>`;

      /* ---- navigasi ---- */
      const go = (dm) => { st.month += dm; if (st.month < 0) { st.month = 11; st.year--; } if (st.month > 11) { st.month = 0; st.year++; } paint(); };
      container.querySelector('#wjPrev').addEventListener('click', () => go(-1));
      container.querySelector('#wjNext').addEventListener('click', () => go(1));
      const wrap = container.querySelector('#wjWrap');
      const scrollToDay = (ymd) => {
        const th = wrap && wrap.querySelector(`[data-day="${ymd}"]`);
        const corner = wrap && wrap.querySelector('.wj-corner');
        if (th && corner) wrap.scrollLeft = Math.max(0, th.offsetLeft - corner.offsetWidth - 8);
      };
      container.querySelector('#wjToday').addEventListener('click', () => {
        if (st.year !== now.getFullYear() || st.month !== now.getMonth()) { st.year = now.getFullYear(); st.month = now.getMonth(); paint(); }
        scrollToDay(todayYmd);
      });
      if (todayYmd >= from && todayYmd <= to) setTimeout(() => scrollToDay(todayYmd), 0);
      container.querySelectorAll('[data-wjview]').forEach(b => b.addEventListener('click', () => {
        if (st.view === b.dataset.wjview) return;
        st.view = b.dataset.wjview;
        paint();
      }));
      const pastBtn = container.querySelector('#wjPast');
      if (pastBtn) pastBtn.addEventListener('click', () => { st.showPast = !st.showPast; paint(); });

      container.querySelector('#wjAdd').addEventListener('click', () => openPlanForm({ user, date: todayYmd }, changed));
      container.querySelector('#wjGenerate').addEventListener('click', () => autoFill(courses, cellDate, daysInMonth, byCell));

      /* ---- sesi, sel, & tanggal ---- */
      container.querySelectorAll('[data-plan]:not([data-plan-act])').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const pl = DB.getClassPlan(b.dataset.plan);
        if (!pl) return;
        if (!DB.canManagePlan(user, pl)) { openDayDetail(pl.date); return; }
        openPlanForm({ user, planId: pl.id }, changed);
      }));
      container.querySelectorAll('[data-add-course]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        openPlanForm({ user, courseId: b.dataset.addCourse, date: b.dataset.date }, changed);
      }));
      container.querySelectorAll('[data-add-date]').forEach(b => b.addEventListener('click', () => openPlanForm({ user, date: b.dataset.addDate }, changed)));
      container.querySelectorAll('.wj-cell[data-course]').forEach(td => td.addEventListener('click', () => {
        if (td.dataset.date < todayYmd) { UI.toast('Tanggal ini sudah lewat.', 'info'); return; }
        openPlanForm({ user, courseId: td.dataset.course, date: td.dataset.date }, changed);
      }));
      container.querySelectorAll('.wj-sum, [data-day]').forEach(el => el.addEventListener('click', () => openDayDetail(el.dataset.date || el.dataset.day)));

      /** Semua sesi satu tanggal, dikelompokkan per kelas utama. */
      function openDayDetail(ymd) {
        const dayPlans = DB.getClassPlansByDate(ymd).filter(x => user.role === 'admin' || visibleIds.has(x.courseId) || DB.planTeacherIds(x).includes(user.id));
        const dayClash = new Set();
        DB.planClashesInRange(ymd, ymd).forEach(x => { dayClash.add(x.a.id); dayClash.add(x.b.id); });
        const html = groups.map(g => {
          const ids = new Set(g.courses.map(c => c.id));
          const list = sortByTime(dayPlans.filter(x => ids.has(x.courseId)));
          return `<div class="wj-day-group"><h4>🏫 ${esc(g.name === '—' ? 'Tanpa kelas utama' : g.name)}</h4>
            ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Jam</th><th>Kelas subtest</th><th>Tutor</th><th>Materi</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
              ${list.map(x => { const c = DB.getCourse(x.courseId);
                return `<tr class="${dayClash.has(x.id) ? 'row-clash' : ''} ${x.status === 'cancelled' ? 'row-cancelled' : ''}">
                  <td><strong>${esc(planTimeLabel(x))}</strong>${dayClash.has(x.id) ? ' <span class="badge badge-danger">bentrok</span>' : ''}</td>
                  <td>${esc(subShort(c))}<div class="muted small">${esc(c ? DB.courseTitle(c) : '-')}</div></td>
                  <td>${esc(tutorLabel(x))}</td><td>${esc(x.topic || '—')}</td><td>${statusBadge(x.status)}</td>
                  <td>${DB.canManagePlan(user, x) ? `<button type="button" class="btn btn-sm btn-secondary" data-dd-edit="${esc(x.id)}">Ubah</button>` : '<span class="muted small">🔒</span>'}</td></tr>`; }).join('')}
            </tbody></table></div>` : '<div class="muted small">Belum ada sesi.</div>'}
            ${ymd >= todayYmd ? `<div class="flex-gap mt-1 wj-dd-add">${g.courses.map(c => `<button type="button" class="pf-chip" data-dd-add="${esc(c.id)}">＋ ${esc(subShort(c))}</button>`).join('')}</div>` : ''}
          </div>`;
        }).join('');
        UI.modal.open(`Semua Sesi — ${UI.fmtYMD(ymd)}`, `<div class="wj-day-detail">${html || emptyState('Tidak ada kelas.')}</div>`);
        const mb = document.getElementById('modalBody');
        mb.querySelectorAll('[data-dd-edit]').forEach(b => b.addEventListener('click', () => openPlanForm({ user, planId: b.dataset.ddEdit }, changed)));
        mb.querySelectorAll('[data-dd-add]').forEach(b => b.addEventListener('click', () => openPlanForm({ user, courseId: b.dataset.ddAdd, date: ymd }, changed)));
        if (global.Responsive) Responsive.apply(mb);
      }

      if (global.Effects) Effects.enhance(container);
      if (global.Responsive) Responsive.apply(container);
    }

    /** Isi otomatis sebulan dari jadwal rutin kelas (90 menit; melewati yang bentrok atau sudah lewat). */
    function autoFill(courses, cellDate, daysInMonth, byCell) {
      const nowP = DB.nowParts();
      const clashed = [];
      const pending = [];
      let skipped = 0;
      courses.forEach(c => {
        const sc = c.schedule || {};
        const days = new Set(sc.days || []);
        if (!days.size || !sc.time) return;
        const ids = DB.courseTeacherIds(c);
        const team = user.role === 'guru' && ids.includes(user.id) ? [user.id] : ids.slice(0, 1);
        for (let d = 1; d <= daysInMonth; d++) {
          const ymd = cellDate(d);
          if (!days.has(DB.DAY_NAMES[new Date(st.year, st.month, d).getDay()])) continue;
          if ((byCell.get(c.id + '|' + ymd) || []).length) { skipped++; continue; }
          const cand = { courseId: c.id, teacherIds: team, date: ymd, time: sc.time, endTime: DB.planEndFor(sc.time), status: 'draft' };
          if (DB.validatePlanTimes(cand) || DB.planPhase(cand, nowP) === 'ended') continue;
          const cf = DB.planConflicts(cand, { extra: pending });
          if (cf.length) { clashed.push(`${UI.fmtYMD(ymd)} ${DB.courseTitle(c)} ↔ ${DB.describePlanConflict(cf[0])}`); continue; }
          pending.push(cand);
        }
      });
      if (!pending.length) {
        UI.toast(clashed.length ? `${clashed.length} tanggal dilewati karena bentrok. Atur jamnya manual.` : 'Tidak ada tanggal baru untuk diisi pada bulan ini.', 'info');
        if (clashed.length) showSkipped(clashed);
        return;
      }
      if (!UI.confirmDialog(`Buat ${pending.length} pertemuan (masing-masing 90 menit) dari jadwal rutin ${MONTHS[st.month]} ${st.year}?`
        + (clashed.length ? `\n${clashed.length} tanggal dilewati karena bentrok.` : ''))) return;
      pending.forEach(cand => {
        const mp = DB.materialPlanForDate(cand.courseId, cand.date);
        DB.addClassPlan(Object.assign({}, cand, {
          topic: mp ? mp.title : '', topicId: mp ? (mp.topicId || null) : null, materialPlanId: mp ? mp.id : null,
          meetingLink: (DB.getCourse(cand.courseId) || {}).meetingLink || '', createdBy: user.id
        }));
      });
      UI.toast(`${pending.length} pertemuan dibuat${skipped ? `, ${skipped} tanggal sudah terisi` : ''}${clashed.length ? `, ${clashed.length} dilewati karena bentrok` : ''}. Lengkapi materinya lalu validasi.`);
      changed();
      if (clashed.length) showSkipped(clashed);
    }
    function showSkipped(clashed) {
      UI.modal.open('Tanggal yang dilewati karena bentrok', `<div class="alert alert-warning small">Jadwal rutin kelas berikut bertabrakan pada tanggal tersebut, sehingga tidak dibuat otomatis. Tambahkan pertemuannya secara manual dengan jam yang berbeda.</div>
        <ul class="pf-clash-list">${clashed.slice(0, 80).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        ${clashed.length > 80 ? `<div class="muted small">…dan ${clashed.length - 80} lainnya.</div>` : ''}`);
    }
  }

  /* =====================================================================
   * AGENDA — Hari Ini / Akan Datang / Selesai
   * ===================================================================*/
  function planCardHtml(pl, opts) {
    const o = opts || {};
    const course = DB.getCourse(pl.courseId);
    const lbl = course ? courseRowLabel(course) : { main: 'Kelas dihapus', sub: '', icon: '📘' };
    const phase = DB.planPhase(pl);
    const ended = phase === 'ended';
    const cancelled = pl.status === 'cancelled';
    const isFixed = pl.status === 'fixed';
    const link = meetingLinkOf(pl, course);
    const ahead = DB.planDaysAhead(pl.date);
    const week = weekOfPlan(pl);
    const manage = o.user && o.staff ? DB.canManagePlan(o.user, pl) : false;
    const id = esc(pl.id);

    let side = '';
    if (cancelled) side = '<div class="muted small">Pertemuan dibatalkan</div>';
    else if (ended) side = '<div class="muted small">Pertemuan selesai</div>';
    else if (isFixed && link) side = `<a class="btn btn-sm ${phase === 'live' ? 'btn-primary' : 'btn-success'}" href="${esc(link)}" target="_blank" rel="noopener noreferrer">🎥 Masuk Kelas</a>`;
    else side = `<div class="muted small">${isFixed ? 'Tautan belum diisi' : 'Menunggu validasi tutor'}</div>`;

    let actions = '';
    if (o.staff && manage) {
      if (ended) {
        actions = `<div class="pc-actions">
          ${cancelled
            ? `<button type="button" class="btn btn-sm btn-secondary" data-plan-act="restore" data-plan="${id}">Pulihkan</button>`
            : `<button type="button" class="btn btn-sm btn-secondary" data-plan-act="cancel" data-plan="${id}">Batalkan</button>`}
          <button type="button" class="btn btn-sm btn-ghost pf-danger" data-plan-act="delete" data-plan="${id}">Hapus</button>
          ${UI.actionMenu([{ label: 'Ubah catatan & materi', icon: '✏️', attrs: `data-plan-act="edit" data-plan="${id}"` }], 'Aksi lain')}
        </div>`;
      } else {
        actions = `<div class="pc-actions">
          ${!cancelled && !isFixed ? `<button type="button" class="btn btn-sm btn-success" data-plan-act="fix" data-plan="${id}">✔ Fix</button>` : ''}
          <button type="button" class="btn btn-sm btn-secondary" data-plan-act="edit" data-plan="${id}">Ubah</button>
          ${UI.actionMenu([
            cancelled ? { label: 'Pulihkan pertemuan', icon: '↩️', attrs: `data-plan-act="restore" data-plan="${id}"` }
              : { label: 'Batalkan pertemuan', icon: '✕', attrs: `data-plan-act="cancel" data-plan="${id}"` },
            { label: 'Hapus', icon: '🗑️', danger: true, attrs: `data-plan-act="delete" data-plan="${id}"` }
          ], 'Aksi lain')}
        </div>`;
      }
    } else if (o.staff) {
      actions = `<div class="pc-actions"><span class="lock-note">🔒 ${esc(lockText(pl))}</span></div>`;
    }

    const when = phase === 'live' ? '<span class="pc-live">● Sedang berlangsung</span>'
      : (ended ? '' : (ahead > 0 ? `H-${ahead}` : (ahead === 0 ? 'hari ini' : '')));
    return `<article class="plan-card ${cancelled ? 'is-cancelled' : ''} ${isFixed ? 'is-fixed' : ''} ${phase === 'live' ? 'is-live' : ''} ${ended ? 'is-ended' : ''}">
      <div class="pc-main">
        <div class="pc-title">${lbl.icon} ${esc(lbl.main)}${pl.__childName ? ` <span class="muted small">• ${esc(pl.__childName)}</span>` : ''}</div>
        <div class="pc-sub">Diajar ${esc(tutorLabel(pl))}</div>
        <div class="pc-meta">
          <span>🗓️ ${UI.fmtYMD(pl.date)}</span>
          <span>⏰ ${esc(planTimeLabel(pl))}</span>
          ${week ? `<span>Minggu ke-${week}</span>` : ''}
          ${when ? `<span>${when}</span>` : ''}
        </div>
        ${pl.topic ? `<div class="pc-topic">📚 ${esc(pl.topic)}</div>` : '<div class="pc-topic muted">Materi belum diisi tutor</div>'}
        ${cancelled && pl.cancelReason ? `<div class="pc-note">Alasan batal: ${esc(pl.cancelReason)}</div>` : ''}
        ${pl.note ? `<div class="pc-note">📝 ${esc(pl.note)}</div>` : ''}
      </div>
      <div class="pc-side">
        ${statusBadge(pl.status)}
        ${side}
      </div>
      ${actions}
    </article>`;
  }

  function renderAgenda(container, user, mode, plans, onChange) {
    const meta = {
      today: ['📅', 'Pertemuan Hari Ini', 'Pertemuan pindah ke Selesai begitu jam selesainya lewat', 'Tidak ada pertemuan tersisa hari ini.'],
      upcoming: ['⏭️', 'Pertemuan Akan Datang', 'Rencana pertemuan berikutnya', 'Belum ada rencana pertemuan ke depan.'],
      past: ['✅', 'Pertemuan Selesai', 'Batalkan pertemuan yang tidak terlaksana, atau hapus yang salah dibuat', 'Belum ada pertemuan yang selesai.']
    }[mode];
    container.innerHTML = `
      <div class="card">
        <div class="card-header">${UI.secHead(meta[0], `${meta[1]} (${plans.length})`, meta[2])}</div>
        <div id="agendaSearch"></div>
      </div>`;
    mountPlanSearch(container.querySelector('#agendaSearch'), plans, {
      stateKey: `agenda-${user.role}-${mode}`,
      empty: meta[3],
      dates: mode !== 'today',
      newestFirst: mode === 'past',
      render: (rows) => `<div class="plan-list">${rows.map(pl => planCardHtml(pl, { user, staff: true })).join('')}</div>`
    });
    bindPlanActions(container, user, onChange);
    if (global.Effects) Effects.enhance(container);
  }

  /** Pencarian bersama untuk daftar rencana kelas (kelas, tutor, materi, catatan, tanggal). */
  function mountPlanSearch(box, plans, o) {
    const courseIds = [...new Set(plans.map(p => p.courseId))];
    const tutorIds = [...new Set(plans.flatMap(p => DB.planTeacherIds(p)))];
    DataSearch.mount({
      container: box,
      items: plans,
      stateKey: o.stateKey,
      placeholder: 'Cari kelas, subtest, tutor, materi, catatan, atau tanggal…',
      fields: pl => { const c = DB.getCourse(pl.courseId);
        return [c ? DB.courseTitle(c) : '', c ? c.subtest : '', c ? (c.mainClasses || []) : [], DB.planTeacherNames(pl, ' '), pl.topic, pl.note,
          pl.cancelReason, pl.date, UI.fmtYMD(pl.date), pl.time, (DB.PLAN_STATUS[pl.status] || {}).label || pl.status]; },
      filters: [
        { key: 'course', label: 'Semua kelas', get: pl => pl.courseId,
          options: courseIds.map(id => DB.getCourse(id)).filter(Boolean).map(c => ({ value: c.id, label: DB.courseTitle(c) })) },
        { key: 'status', label: 'Semua status', get: pl => pl.status,
          options: Object.keys(DB.PLAN_STATUS).map(k => ({ value: k, label: DB.PLAN_STATUS[k].label || k })) }
      ].concat(tutorIds.length > 1 ? [{ key: 'tutor', label: 'Semua tutor', get: pl => DB.planTeacherIds(pl),
        options: tutorIds.map(id => DB.getUser(id)).filter(Boolean).map(u => ({ value: u.id, label: u.name })) }] : []),
      dateRange: o.dates ? (pl => pl.date) : null,
      sorts: o.newestFirst
        ? [{ key: 'new', label: 'Terbaru', cmp: (a, b) => byDateTime(b, a) }, { key: 'old', label: 'Terlama', cmp: byDateTime }]
        : [{ key: 'old', label: 'Terdekat', cmp: byDateTime }, { key: 'new', label: 'Terjauh', cmp: (a, b) => byDateTime(b, a) }],
      pageSize: o.pageSize || 12,
      empty: o.empty,
      render: o.render,
      onPaint: o.onPaint
    });
  }

  /* =====================================================================
   * RENCANA MATERI — tabel minggu, tanggal, materi, pengajar per kelas
   * ===================================================================*/
  function renderMaterialPlans(box, user) {
    const st = mpState[user.id] || (mpState[user.id] = { courseId: '', editId: null });
    const courses = coursesFor(user).filter(c => c.active !== false);
    if (!courses.length) {
      box.innerHTML = `<div class="card">${emptyState(user.role === 'admin' ? 'Belum ada kelas aktif.' : 'Anda belum mengajar kelas aktif.', '📚')}</div>`;
      return;
    }
    if (!courses.some(c => c.id === st.courseId)) { st.courseId = courses[0].id; st.editId = null; }
    paint();

    function paint() {
      const course = DB.getCourse(st.courseId);
      const canEdit = DB.canEditMaterialPlans(user, course);
      const rows = DB.getMaterialPlans(course.id);
      const today = DB.nowParts().ymd;
      const curWeek = DB.courseWeekOf(course, today);
      const sched = course.schedule || {};
      const start = DB.courseStartYmd(course);
      const plans = DB.getClassPlansByCourse(course.id).filter(p => p.status !== 'cancelled').sort(byDateTime);
      const tutors = DB.courseTeachers(course);
      const topics = global.Topics && course.subtest ? Topics.topicsOf(course.subtest) : [];
      const nextWeek = rows.reduce((m, r) => Math.max(m, Number(r.week) || 0), 0) + 1;
      const sessionsOfWeek = (w) => {
        const r = DB.courseWeekRange(course, w);
        return r ? plans.filter(p => p.date >= r.from && p.date <= r.to) : [];
      };
      const names = (ids) => (ids || []).map(id => (DB.getUser(id) || {}).name).filter(Boolean);
      const sesHtml = (r) => {
        const list = sessionsOfWeek(Number(r.week));
        if (!list.length) return '<span class="muted small">Belum ada pertemuan</span>';
        return `<div class="mp-ses-list">${list.slice(0, 3).map(p => {
          const linked = p.materialPlanId === r.id || String(p.topic || '').trim().toLowerCase() === String(r.title || '').toLowerCase();
          return `<span class="mp-ses ${linked ? 'is-linked' : ''}" title="${esc((p.topic || 'materi belum diisi') + ' • ' + tutorLabel(p))}">${esc(dowShort(p.date))} ${esc(shortDate(p.date))} · ${esc(fmtTime(p.time))}</span>`;
        }).join('')}${list.length > 3 ? `<span class="mp-ses">+${list.length - 3}</span>` : ''}</div>`;
      };
      const viewRow = (r) => {
        const isNow = Number(r.week) === curWeek;
        const ppl = names(r.teacherIds);
        return `<tr class="${isNow ? 'is-current' : ''}">
          <td class="mp-week"><strong>${esc(r.week)}</strong>${isNow ? ' <span class="badge badge-info">minggu ini</span>' : ''}</td>
          <td class="mp-range">${esc(shortRange(DB.courseWeekRange(course, Number(r.week))))}</td>
          <td><strong class="mp-title">${esc(r.title)}</strong></td>
          <td>${ppl.length ? esc(ppl.join(', ')) : '<span class="muted">—</span>'}</td>
          <td>${sesHtml(r)}</td>
          <td>${r.note ? esc(r.note) : '<span class="muted">—</span>'}</td>
          <td class="actions">${canEdit ? `<div class="flex-gap mp-acts">
            <button type="button" class="btn btn-sm btn-secondary" data-mp-edit="${esc(r.id)}">Ubah</button>
            <button type="button" class="btn btn-sm btn-ghost pf-danger" data-mp-del="${esc(r.id)}" aria-label="Hapus minggu ${esc(r.week)}">Hapus</button></div>` : ''}</td>
        </tr>`;
      };
      const editRow = (r) => {
        const sel = new Set(r.teacherIds || []);
        return `<tr class="mp-editing" data-mp-form="${esc(r.id || 'new')}">
          <td data-label="Minggu"><input type="number" class="input mp-in-week" name="week" min="1" max="60" step="1" value="${esc(r.week)}" required aria-label="Minggu ke-" /></td>
          <td data-label="Tanggal" class="mp-range" data-mp-range>${esc(shortRange(DB.courseWeekRange(course, Number(r.week))))}</td>
          <td data-label="Materi"><input class="input" name="title" list="mpTopicList" maxlength="80" required value="${esc(r.title || '')}" placeholder="Nama materi" aria-label="Nama materi" autocomplete="off" /></td>
          <td data-label="Pengajar">${tutors.length ? `<div class="mp-tutors">${tutors.map(t => `<label class="pf-tutor is-sm"><input type="checkbox" name="teacherIds" value="${esc(t.id)}" ${sel.has(t.id) ? 'checked' : ''} /><span class="pf-tutor-name">${esc(shortName(t.name))}</span></label>`).join('')}</div>` : '<span class="muted small">Belum ada tutor</span>'}</td>
          <td data-label="Pertemuan">${r.id ? sesHtml(r) : '<span class="muted small">—</span>'}</td>
          <td data-label="Catatan"><input class="input" name="note" maxlength="300" value="${esc(r.note || '')}" placeholder="opsional" aria-label="Catatan" /></td>
          <td data-label="" class="actions no-label"><div class="flex-gap mp-acts">
            <button type="button" class="btn btn-sm btn-primary" data-mp-save>Simpan</button>
            <button type="button" class="btn btn-sm btn-secondary" data-mp-cancel>Batal</button></div></td>
        </tr>`;
      };
      const draftNew = { id: '', week: nextWeek, title: '', teacherIds: user.role === 'guru' ? [user.id] : [], note: '' };
      const bodyRows = rows.map(r => (st.editId === r.id ? editRow(r) : viewRow(r))).join('') + (st.editId === 'new' ? editRow(draftNew) : '');
      const startNote = /^\d{4}-\d{2}-\d{2}$/.test(sched.startDate || '') ? 'tanggal mulai kelas' : 'pertemuan pertama';

      box.innerHTML = `
        <div class="card mp-card">
          <div class="card-header">${UI.secHead('📚', 'Rencana Materi', 'Materi tiap minggu dan pengajarnya; nama materi menjadi pilihan "Materi" saat mengisi pertemuan, whiteboard, materi, dan modul')}</div>
          <div class="mp-bar">
            <label class="mp-course"><span>Kelas</span>
              <select id="mpCourse" class="input">${courseOptionsHtml(courses, course.id)}</select></label>
            ${canEdit ? `<div class="mp-bar-acts">
              <button type="button" class="btn btn-sm btn-secondary" id="mpFill" ${topics.length ? '' : 'disabled'} title="${topics.length ? 'Tambahkan materi subtest yang belum direncanakan sebagai minggu berikutnya' : 'Subtest kelas ini belum punya daftar materi'}">⚡ Isi dari Materi subtest</button>
              <button type="button" class="btn btn-sm btn-primary" id="mpAdd" ${st.editId ? 'disabled' : ''}>＋ Tambah minggu</button>
            </div>` : ''}
          </div>
          <p class="mp-info">Minggu 1 dimulai <strong>${esc(UI.fmtYMD(start))}</strong> (${startNote}).
            ${curWeek ? `Hari ini minggu ke-<strong>${curWeek}</strong>.` : 'Kelas belum dimulai.'}
            ${sched.sessions ? ` Target ${esc(sched.sessions)} pertemuan.` : ''}</p>
          ${rows.length || st.editId === 'new' ? `
          <div class="table-wrap"><table class="table mp-table">
            <thead><tr><th>Minggu</th><th>Tanggal</th><th>Materi</th><th>Pengajar</th><th>Pertemuan</th><th>Catatan</th><th>Aksi</th></tr></thead>
            <tbody>${bodyRows}</tbody>
          </table></div>` : emptyState(canEdit ? 'Belum ada rencana materi. Tambahkan minggu pertama atau isi dari Materi subtest.' : 'Belum ada rencana materi untuk kelas ini.', '📚')}
          <datalist id="mpTopicList">${topics.map(t => `<option value="${esc(t.name)}"></option>`).join('')}</datalist>
        </div>`;

      box.querySelector('#mpCourse').addEventListener('change', (e) => { st.courseId = e.target.value; st.editId = null; paint(); });
      const add = box.querySelector('#mpAdd');
      if (add) add.addEventListener('click', () => { st.editId = 'new'; paint(); });
      const fill = box.querySelector('#mpFill');
      if (fill) fill.addEventListener('click', () => {
        const have = new Set(rows.map(r => String(r.title).toLowerCase()));
        const todo = topics.filter(t => !have.has(t.name.toLowerCase()));
        if (!todo.length) { UI.toast('Semua materi subtest sudah ada di rencana.', 'info'); return; }
        const last = nextWeek + todo.length - 1;
        if (last > 60) { UI.toast('Rencana materi maksimal sampai minggu ke-60.', 'error'); return; }
        if (!UI.confirmDialog(`Tambahkan ${todo.length} materi subtest sebagai minggu ${nextWeek}${todo.length > 1 ? '–' + last : ''}?`)) return;
        let linked = 0;
        try {
          todo.forEach((t, i) => {
            const rec = DB.saveMaterialPlan({ courseId: course.id, week: nextWeek + i, title: t.name, topicId: t.id, teacherIds: draftNew.teacherIds }, user);
            linked += DB.linkMaterialPlanToSessions(rec, user);
          });
        } catch (err) { UI.toast(err.message, 'error'); }
        UI.toast(`${todo.length} minggu ditambahkan${linked ? `; ${linked} pertemuan ikut terisi materinya` : ''}.`);
        paint();
      });

      const form = box.querySelector('[data-mp-form]');
      if (form) {
        const weekEl = form.querySelector('[name="week"]');
        const titleEl = form.querySelector('[name="title"]');
        weekEl.addEventListener('input', () => {
          form.querySelector('[data-mp-range]').textContent = shortRange(DB.courseWeekRange(course, Math.round(Number(weekEl.value))));
        });
        const save = () => {
          const id = form.dataset.mpForm === 'new' ? '' : form.dataset.mpForm;
          const prev = id ? DB.getMaterialPlan(id) : null;
          const week = Math.round(Number(weekEl.value));
          const dup = rows.find(r => Number(r.week) === week && r.id !== id);
          if (dup && !UI.confirmDialog(`Minggu ke-${week} sudah berisi "${dup.title}". Tetap tambahkan materi kedua di minggu yang sama?`)) return;
          try {
            const rec = DB.saveMaterialPlan({
              id, courseId: course.id, week, title: titleEl.value,
              topicId: prev && prev.title === titleEl.value.trim() ? prev.topicId : null,
              teacherIds: [...form.querySelectorAll('[name="teacherIds"]:checked')].map(x => x.value),
              note: form.querySelector('[name="note"]').value
            }, user);
            const linked = DB.linkMaterialPlanToSessions(rec, user, prev ? prev.title : '');
            st.editId = null;
            UI.toast(`Rencana minggu ke-${rec.week} disimpan${linked ? `; ${linked} pertemuan ikut diperbarui` : ''}.`);
            paint();
          } catch (err) { UI.toast(err.message, 'error'); titleEl.focus(); }
        };
        form.querySelector('[data-mp-save]').addEventListener('click', save);
        form.querySelector('[data-mp-cancel]').addEventListener('click', () => { st.editId = null; paint(); });
        form.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && e.target.matches('input:not([type=checkbox])')) { e.preventDefault(); save(); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); st.editId = null; paint(); }
        });
        (form.dataset.mpForm === 'new' ? titleEl : weekEl).focus();
      }
      box.querySelectorAll('[data-mp-edit]').forEach(b => b.addEventListener('click', () => { st.editId = b.dataset.mpEdit; paint(); }));
      box.querySelectorAll('[data-mp-del]').forEach(b => b.addEventListener('click', () => {
        const rec = DB.getMaterialPlan(b.dataset.mpDel);
        if (!rec || !UI.confirmDialog(`Hapus rencana minggu ke-${rec.week} (${rec.title})? Materi pada pertemuan yang sudah terisi tidak ikut terhapus.`)) return;
        try {
          DB.deleteMaterialPlan(rec.id, user);
          UI.toast('Rencana materi dihapus.', 'success', {
            label: 'Urungkan', onClick: () => { try { DB.saveMaterialPlan(rec, user); paint(); } catch (err) { UI.toast(err.message, 'error'); } }
          });
          paint();
        } catch (err) { UI.toast(err.message, 'error'); }
      }));
      if (global.Responsive) Responsive.apply(box);
    }
  }

  /* =====================================================================
   * HALAMAN JADWAL (Admin & Tutor)
   * ===================================================================*/
  function renderJadwalPage(container, user) {
    const part = splitPlans(visiblePlans(user));
    const tabs = [
      ['today', '📅', `Hari Ini (${part.today.length})`],
      ['upcoming', '⏭️', `Akan Datang (${part.upcoming.length})`],
      ['war', '🗂️', 'War Jadwal'],
      ['materi', '📚', 'Rencana Materi'],
      ['past', '✅', `Selesai (${part.past.length})`]
    ];
    const tab = pageTab[user.id] || 'war';
    container.innerHTML = `
      <div class="subtabs" role="tablist" aria-label="Jadwal kelas">
        ${tabs.map(([k, ic, label]) => `<button type="button" role="tab" class="subtab-btn ${k === tab ? 'active' : ''}" aria-selected="${k === tab}" data-jtab="${k}">${ic} ${label}</button>`).join('')}
      </div>
      <div id="jadwalBox"></div>`;
    const box = container.querySelector('#jadwalBox');
    const reload = () => renderJadwalPage(container, user);
    container.querySelectorAll('[data-jtab]').forEach(b => b.addEventListener('click', () => {
      if (pageTab[user.id] === b.dataset.jtab && b.classList.contains('active')) return;
      pageTab[user.id] = b.dataset.jtab;
      reload();
    }));
    if (tab === 'war') renderWarSheet(box, user, reload);
    else if (tab === 'materi') renderMaterialPlans(box, user);
    else renderAgenda(box, user, tab, part[tab], reload);
    watchPhases(container, () => visiblePlans(user), reload);
  }

  /* =====================================================================
   * TAMPILAN MENTEE & ORANG TUA (baca-saja)
   * ===================================================================*/
  function renderPlanTable(container, user, opts) {
    const o = opts || {};
    const studentId = o.studentId || user.id;
    const student = DB.getUser(studentId);
    const all = DB.getClassPlansForStudent(studentId);
    const part = splitPlans(all);

    const rowsHtml = (list) => list.map(pl => {
      const course = DB.getCourse(pl.courseId);
      const lbl = course ? courseRowLabel(course) : { main: '-', icon: '📘' };
      const link = meetingLinkOf(pl, course);
      const ended = DB.planEnded(pl);
      const canJoin = pl.status === 'fixed' && link && !ended;
      return `<tr class="${pl.status === 'cancelled' ? 'row-cancelled' : ''}">
        <td>${UI.fmtYMD(pl.date)}<div class="muted small">${esc(planTimeLabel(pl))}</div></td>
        <td><strong>${lbl.icon} ${esc(lbl.main)}</strong></td>
        <td>${pl.topic ? esc(pl.topic) : '<span class="muted">Belum diisi</span>'}</td>
        <td>${esc(tutorLabel(pl))}</td>
        <td>${statusBadge(pl.status)}</td>
        <td>${canJoin
          ? `<a class="btn btn-sm btn-success" href="${esc(link)}" target="_blank" rel="noopener noreferrer">🎥 Masuk</a>`
          : `<span class="muted small">${pl.status === 'cancelled' ? 'Dibatalkan' : (ended ? 'Selesai' : 'Menunggu')}</span>`}</td>
      </tr>`;
    }).join('');
    const tableFor = (list) => `<div class="table-wrap"><table class="table">
        <thead><tr><th>Tanggal</th><th>Kelas</th><th>Materi</th><th>Tutor</th><th>Status</th><th>Tautan</th></tr></thead>
        <tbody>${rowsHtml(list)}</tbody>
      </table></div>`;

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-success"><div class="label">Kelas Hari Ini</div><div class="value">${part.today.length}</div><div class="sub">${part.today.filter(p => p.status === 'fixed').length} sudah fix</div></div>
        <div class="stat-card accent-primary"><div class="label">Akan Datang</div><div class="value">${part.upcoming.length}</div><div class="sub">rencana kelas</div></div>
        <div class="stat-card accent-warning"><div class="label">Menunggu Validasi</div><div class="value">${part.today.concat(part.upcoming).filter(p => p.status === 'draft').length}</div><div class="sub">belum dipastikan tutor</div></div>
        <div class="stat-card accent-danger"><div class="label">Dibatalkan</div><div class="value">${all.filter(p => p.status === 'cancelled').length}</div></div>
      </div>

      ${o.showChildName && student ? `<div class="alert alert-info">Menampilkan jadwal kelas <strong>${esc(student.name)}</strong> (${esc(student.kelas || '-')}).</div>` : ''}

      <div class="card">
        <div class="card-header">${UI.secHead('📅', `Kelas Hari Ini (${part.today.length})`, 'Klik "Masuk Kelas" untuk membuka Zoom / Google Meet')}</div>
        ${part.today.length === 0 ? emptyState('Tidak ada kelas tersisa hari ini.')
          : `<div class="plan-list">${part.today.map(pl => planCardHtml(pl, {})).join('')}</div>`}
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('🗂️', 'Rencana Kelas (Akan Datang)', 'Tabel rencana kelas yang disusun tutor')}</div>
        <div id="planUpcoming"></div>
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('✅', 'Riwayat Kelas', `${part.past.length} pertemuan`)}</div>
        <div id="planPast"></div>
      </div>`;
    mountPlanSearch(container.querySelector('#planUpcoming'), part.upcoming, {
      stateKey: `plan-up-${studentId}`, dates: true, empty: 'Belum ada rencana kelas ke depan.', render: tableFor
    });
    mountPlanSearch(container.querySelector('#planPast'), part.past, {
      stateKey: `plan-past-${studentId}`, dates: true, newestFirst: true, empty: 'Belum ada riwayat kelas.', render: tableFor
    });

    if (global.Effects) Effects.enhance(container);
    if (global.Responsive) Responsive.apply(container);
  }

  /* =====================================================================
   * JADWAL MENTEE & ORANG TUA — 2 halaman:
   *   1. Jadwal Kelasku   : kelas yang diikuti (dengan tautan masuk kelas)
   *   2. Kelas Utama Lain : jadwal kelas utama lain (baca-saja, tanpa tautan)
   * ===================================================================*/
  function renderStudentSchedule(container, user, opts) {
    const o = opts || {};
    const studentId = o.studentId || user.id;
    const student = DB.getUser(studentId) || user;
    const key = user.id + '|' + studentId;
    const tab = scheduleTab[key] || 'mine';
    const myIds = new Set(DB.getEnrollmentsByStudent(studentId).map(e => e.courseId));
    const activeCourses = DB.getCourses().filter(c => c.active !== false);
    // Kelas utama milik mentee: kelas di profil + kelas utama dari kelas subtest yang diikuti.
    const myMains = new Set([student.kelas].concat(activeCourses.filter(c => myIds.has(c.id)).flatMap(c => c.mainClasses || [])).filter(Boolean));
    // Semua kelas utama: daftar resmi + yang hanya tercatat di kelas subtest.
    const allMains = [...new Set(DB.getMainClasses().concat(activeCourses.flatMap(c => c.mainClasses || [])))];
    const otherMains = allMains.filter(m => !myMains.has(m)
      && activeCourses.some(c => (c.mainClasses || []).includes(m) && !myIds.has(c.id)));
    container.innerHTML = `
      <div class="subtabs" role="tablist">
        <button type="button" class="subtab-btn ${tab === 'mine' ? 'active' : ''}" data-stab="mine" role="tab" aria-selected="${tab === 'mine'}">📚 Jadwal ${o.studentId && o.studentId !== user.id ? 'Kelas Anak' : 'Kelasku'}</button>
        <button type="button" class="subtab-btn ${tab === 'others' ? 'active' : ''}" data-stab="others" role="tab" aria-selected="${tab === 'others'}">🏫 Kelas Utama Lain (${otherMains.length})</button>
      </div>
      <div id="stSchedBox"></div>`;
    const reload = () => renderStudentSchedule(container, user, o);
    container.querySelectorAll('[data-stab]').forEach(b => b.addEventListener('click', () => {
      scheduleTab[key] = b.dataset.stab;
      reload();
    }));
    const box = container.querySelector('#stSchedBox');
    if (tab === 'others') renderOtherMainClasses(box, student, otherMains, myIds, Object.assign({}, o, { myMains: [...myMains] }));
    else renderPlanTable(box, user, o);
    watchPhases(container, () => DB.getClassPlansForStudent(studentId), reload);
  }

  function renderOtherMainClasses(box, student, mains, myIds, o) {
    const mainSet = new Set(mains);
    const courses = DB.getCourses().filter(c => c.active !== false && !myIds.has(c.id) && (c.mainClasses || []).some(m => mainSet.has(m)));
    const cids = new Set(courses.map(c => c.id));
    const nowP = DB.nowParts();
    const plans = DB.getClassPlans().filter(p => cids.has(p.courseId) && DB.planPhase(p, nowP) !== 'ended').sort(byDateTime);
    const today = plans.filter(p => p.date === nowP.ymd);
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
      fields: pl => { const c = DB.getCourse(pl.courseId);
        return [mainOf(pl), c ? c.subtest : '', c ? DB.courseTitle(c) : '', DB.planTeacherNames(pl, ' '), pl.topic, UI.fmtYMD(pl.date), pl.time]; },
      filters: [
        { key: 'main', label: 'Semua kelas utama', get: pl => mainOf(pl), options: mains.map(m => ({ value: m, label: m })) },
        { key: 'sub', label: 'Semua subtest', get: pl => (DB.getCourse(pl.courseId) || {}).subtest || '',
          options: [...new Set(courses.map(c => c.subtest).filter(Boolean))].map(x => ({ value: x, label: (DB.subtestByName(x) || {}).short || x })) }
      ],
      dateRange: pl => pl.date,
      sorts: [{ key: 'old', label: 'Terdekat', cmp: byDateTime }],
      pageSize: 15,
      empty: 'Belum ada jadwal ke depan untuk kelas utama ini.',
      render: (rows) => `<div class="table-wrap"><table class="table">
        <thead><tr><th>Tanggal</th><th>Kelas utama</th><th>Subtest</th><th>Tutor</th><th>Materi</th><th>Status</th></tr></thead>
        <tbody>${rows.map(pl => { const c = DB.getCourse(pl.courseId);
          return `<tr class="${pl.status === 'cancelled' ? 'row-cancelled' : ''}">
            <td>${UI.fmtYMD(pl.date)}<div class="muted small">${esc(planTimeLabel(pl))}</div></td>
            <td><strong>${esc(mainOf(pl).join(', '))}</strong></td>
            <td>${c ? courseRowLabel(c).icon : '📘'} ${esc(subShort(c))}</td>
            <td>${esc(tutorLabel(pl))}</td>
            <td>${pl.topic ? esc(pl.topic) : '<span class="muted">Belum diisi</span>'}</td>
            <td>${statusBadge(pl.status)}</td></tr>`; }).join('')}</tbody></table></div>`
    });
    if (global.Effects) Effects.enhance(box);
    if (global.Responsive) Responsive.apply(box);
  }

  global.Jadwal = {
    plansForUser, courseScheduleCardHtml, renderStudentSchedule, renderJadwalPage, groupByMainClass,
    planTimeLabel, tutorLabel
  };
})(window);
