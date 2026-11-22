/* ===== Shared feature modules used across roles =====
 * CBT (take/grade), video embed helper, attendance rendering.
 */
(function (global) {
  // Isi lingkaran avatar: avatar almamater / foto / inisial (js/avatars.js).
  const AV = (u) => (global.Avatars ? Avatars.inner(u) : UI.esc(UI.initials(u && u.name)));

  /* ===== YouTube / Video embed helper ===== */
  /** URL embed Vimeo (YouTube ditangani YTPlayer: thumbnail dulu, youtube-nocookie saat diputar). */
  function toEmbedUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      if (u.hostname.includes('vimeo.com')) {
        const v = u.pathname.split('/').filter(Boolean).pop();
        if (v) return `https://player.vimeo.com/video/${v}`;
      }
    } catch (e) { /* noop */ }
    return url;
  }

  function videoEmbedHtml(url) {
    if (!url) return '';
    const ytId = global.YTPlayer ? YTPlayer.parseId(url) : null;
    if (ytId) return YTPlayer.cardHtml(ytId);
    const embed = toEmbedUrl(url);
    if (/player\.vimeo\.com/.test(embed)) {
      return `<div class="video-wrap"><iframe src="${UI.esc(embed)}" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe></div>`;
    }
    // Fallback: external link
    return `<p class="muted small">Video: <a href="${UI.esc(url)}" target="_blank" rel="noopener">${UI.esc(url)}</a></p>`;
  }

  /* ===== CBT: take exam ===== */
  function startCbt(cbt, user, onFinish) {
    if (!cbt.questionIds || cbt.questionIds.length === 0) {
      UI.toast('Ujian ini belum memiliki soal.', 'error');
      return;
    }
    const existing = DB.getCbtAttemptByStudent(cbt.id, user.id);
    if (existing && existing.submittedAt) {
      showCbtResult(cbt, existing);
      return;
    }
    if (existing) {
      renderTakeExam(cbt, user, existing);
    } else {
      const attempt = DB.addCbtAttempt({
        cbtId: cbt.id, studentId: user.id, answers: {},
        startedAt: Date.now(), submittedAt: null, score: null, correctCount: null, totalCount: cbt.questionIds.length
      });
      renderTakeExam(cbt, user, attempt);
    }

    function renderTakeExam(cbt, user, attempt) {
      const content = document.getElementById('content');
      const questions = cbt.questionIds.map(qid => DB.getQuestion(qid)).filter(Boolean);
      const startedAt = attempt.startedAt;
      const durationMs = (cbt.durationMinutes || 30) * 60000;
      const deadline = startedAt + durationMs;
      const answers = Object.assign({}, attempt.answers);

      content.innerHTML = `
        <div class="cbt-timer">
          <div>
            <strong>${UI.esc(cbt.title)}</strong>
            <div class="muted small">${questions.length} soal • Durasi ${cbt.durationMinutes} menit</div>
          </div>
          <div>
            <div class="time" id="cbtTime">--:--</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Navigasi Soal</h3>
            <button class="btn btn-success" id="finishBtn">Selesai & Kirim</button>
          </div>
          <div class="q-nav" id="qNav">
            ${questions.map((_, i) => `<button type="button" data-jump="${i}">${i + 1}</button>`).join('')}
          </div>
          <p class="muted small" id="progressLabel">Terjawab: 0 / ${questions.length}</p>
        </div>

        <div id="questionsList">
          ${questions.map((q, i) => `
            <div class="question-card" id="q-${i}">
              <div class="q-text"><span class="q-num">${i + 1}</span>${UI.esc(q.text)}</div>
              <div class="option-list">
                ${q.options.map((opt, oi) => `
                  <label class="option-item" data-q="${i}" data-o="${oi}">
                    <input type="radio" name="q_${i}" value="${oi}" />
                    <span class="letter">${String.fromCharCode(65 + oi)}.</span>
                    <span>${UI.esc(opt)}</span>
                  </label>`).join('')}
              </div>
            </div>`).join('')}
        </div>

        <div class="card" style="text-align:center;">
          <button class="btn btn-success" id="finishBtn2">Selesai & Kirim Jawaban</button>
          <p class="muted small mt-1">Pastikan semua soal sudah dijawab. Jawaban terkirim otomatis saat waktu habis.</p>
        </div>
      `;

      // Prefill answers
      questions.forEach((q, i) => {
        if (answers[q.id] != null) {
          const radio = content.querySelector(`input[name="q_${i}"][value="${answers[q.id]}"]`);
          if (radio) {
            radio.checked = true;
            radio.closest('.option-item').classList.add('selected');
          }
        }
      });
      updateProgress();

      // Attach answer handlers
      content.querySelectorAll('.option-item').forEach(el => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          const qi = Number(el.dataset.q);
          const oi = Number(el.dataset.o);
          const q = questions[qi];
          // Uncheck siblings visually
          content.querySelectorAll(`.option-item[data-q="${qi}"]`).forEach(s => s.classList.remove('selected'));
          el.classList.add('selected');
          const radio = el.querySelector('input');
          if (radio) radio.checked = true;
          answers[q.id] = oi;
          // Persist
          DB.updateCbtAttempt(attempt.id, { answers });
          updateProgress();
        });
      });

      content.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => {
        const idx = Number(b.dataset.jump);
        const el = document.getElementById('q-' + idx);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }));

      const finish = () => {
        if (!UI.confirmDialog('Kirim jawaban sekarang? Tidak bisa diubah lagi.')) return;
        clearInterval(timer);
        submitAttempt();
      };
      document.getElementById('finishBtn').addEventListener('click', finish);
      document.getElementById('finishBtn2').addEventListener('click', finish);

      // Timer
      const timerEl = document.getElementById('cbtTime');
      const tick = () => {
        const remaining = Math.max(0, deadline - Date.now());
        const m = Math.floor(remaining / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        timerEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        timerEl.classList.toggle('warn', remaining < 300000 && remaining >= 60000);
        timerEl.classList.toggle('danger', remaining < 60000);
        if (remaining <= 0) {
          clearInterval(timer);
          UI.toast('Waktu habis! Jawaban dikirim otomatis.', 'info');
          submitAttempt();
        }
      };
      tick();
      const timer = setInterval(tick, 1000);

      function updateProgress() {
        const answered = Object.keys(answers).length;
        document.getElementById('progressLabel').textContent = `Terjawab: ${answered} / ${questions.length}`;
        content.querySelectorAll('[data-jump]').forEach(b => {
          const qi = Number(b.dataset.jump);
          const q = questions[qi];
          b.classList.toggle('answered', answers[q.id] != null);
        });
      }

      function submitAttempt() {
        let correct = 0;
        questions.forEach(q => { if (answers[q.id] === q.correctIndex) correct++; });
        const score = Math.round((correct / questions.length) * 100);
        DB.updateCbtAttempt(attempt.id, {
          answers, score,
          correctCount: correct,
          totalCount: questions.length,
          submittedAt: Date.now()
        });
        UI.toast(`Ujian selesai. Skor: ${score}`, 'success');
        const updated = DB.getCbtAttempts().find(a => a.id === attempt.id);
        showCbtResult(cbt, updated);
        if (typeof onFinish === 'function') onFinish();
      }
    }
  }

  function showCbtResult(cbt, attempt) {
    const content = document.getElementById('content');
    const questions = cbt.questionIds.map(qid => DB.getQuestion(qid)).filter(Boolean);
    content.innerHTML = `
      <div class="card">
        <div class="score-display">
          <div class="score">${attempt.score ?? 0}</div>
          <div class="label">Skor Akhir (${attempt.correctCount || 0} benar dari ${attempt.totalCount || questions.length})</div>
        </div>
        <div class="muted small" style="text-align:center;">
          Dikerjakan ${UI.fmtDateTime(attempt.startedAt)} — Dikirim ${UI.fmtDateTime(attempt.submittedAt)}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Pembahasan</h3>
          <button class="btn btn-secondary btn-sm" id="backToCbt">← Kembali</button></div>
        ${questions.map((q, i) => {
          const picked = attempt.answers ? attempt.answers[q.id] : null;
          const correct = q.correctIndex;
          return `
            <div class="question-card">
              <div class="q-text"><span class="q-num">${i + 1}</span>${UI.esc(q.text)}</div>
              <div class="option-list">
                ${q.options.map((opt, oi) => {
                  let cls = '';
                  if (oi === correct) cls = 'correct';
                  else if (oi === picked) cls = 'incorrect';
                  return `<div class="option-item ${cls}">
                    <span class="letter">${String.fromCharCode(65 + oi)}.</span>
                    <span>${UI.esc(opt)}</span>
                  </div>`;
                }).join('')}
              </div>
              ${q.explanation ? `<div class="alert alert-info mt-2"><strong>Pembahasan:</strong> ${UI.esc(q.explanation)}</div>` : ''}
              ${YTPlayer.expVideo(q)}
            </div>`;
        }).join('')}
      </div>
    `;
    document.getElementById('backToCbt').addEventListener('click', () => Dashboard.navigate('cbt'));
  }

  /** Teks pesan (Chat & Grup Belajar): rumus $…$ dirender, tautan http(s) aktif, sisanya di-escape. */
  function chatTextHtml(text) {
    const s = String(text || '');
    const re = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;
    let out = '', last = 0, m;
    const plain = (t) => (global.RichText ? RichText.renderMathInText(t) : UI.esc(t));
    while ((m = re.exec(s))) {
      out += plain(s.slice(last, m.index));
      out += `<a href="${UI.esc(m[0])}" target="_blank" rel="noopener noreferrer nofollow">${UI.esc(m[0])}</a>`;
      last = m.index + m[0].length;
    }
    return out + plain(s.slice(last));
  }

  /* ===== Calendar Renderer ===== */
  function renderCalendar(container, user) {
    const canEdit = user.role === 'admin' || user.role === 'guru';
    const now = UI.nowInTz();
    let viewYear = now.getFullYear();
    let viewMonth = now.getMonth();

    render();

    function render() {
      const firstDay = new Date(viewYear, viewMonth, 1);
      const lastDay = new Date(viewYear, viewMonth + 1, 0);
      const startDow = firstDay.getDay(); // 0=Sun
      const daysInMonth = lastDay.getDate();
      const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
      const dayLabels = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

      const events = DB.getEvents();
      const p = n => String(n).padStart(2, '0');
      const ymd = (y, m, d) => `${y}-${p(m + 1)}-${p(d)}`;
      const todayStr = UI.todayYMD();

      /* Rencana kelas (War Jadwal) ikut tampil di kalender agar jadwal belajar
       * dan acara lain terlihat di satu tempat. Cakupannya otomatis mengikuti
       * peran: admin semua, tutor kelasnya, siswa kelas yang diikuti, dan
       * orang tua gabungan kelas anak-anaknya. */
      const monthFrom = ymd(viewYear, viewMonth, 1);
      const monthTo = ymd(viewYear, viewMonth, daysInMonth);
      const plans = (global.Jadwal && Jadwal.plansForUser)
        ? Jadwal.plansForUser(user, monthFrom, monthTo)
        : [];
      const planColor = (st) => st === 'fixed' ? 'var(--success-bg)'
        : (st === 'cancelled' ? 'var(--danger-bg)'
        : (st === 'changed' ? 'var(--warning-bg)' : 'var(--gray-100)'));
      const planLabel = (pl) => {
        const c = DB.getCourse(pl.courseId);
        const short = c ? ((c.mainClasses || [])[0] || DB.courseTitle(c)) : 'Kelas';
        return `${short}${pl.time ? ' ' + pl.time : ''}`;
      };
      const planTooltip = (pl) => {
        const c = DB.getCourse(pl.courseId);
        const t = DB.planTeacherNames(pl);
        const st = (DB.PLAN_STATUS && DB.PLAN_STATUS[pl.status]) || { label: pl.status };
        return [c ? DB.courseTitle(c) : 'Kelas dihapus',
          pl.topic || 'materi belum diisi',
          t ? 'diajar ' + t : '',
          pl.time ? pl.time + (pl.endTime ? '–' + pl.endTime : '') : '',
          st.label,
          pl.__childName ? 'anak: ' + pl.__childName : ''].filter(Boolean).join(' • ');
      };

      // Build cells
      let cells = '';
      for (let i = 0; i < startDow; i++) cells += '<div class="cal-cell empty"></div>';
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = ymd(viewYear, viewMonth, d);
        const dayEvents = events.filter(e => e.date === dateStr);
        const dayPlans = plans.filter(pl => pl.date === dateStr);
        const isToday = dateStr === todayStr;
        cells += `<div class="cal-cell${isToday ? ' today' : ''}" data-date="${dateStr}">
          <div class="cal-day">${d}</div>
          ${dayPlans.slice(0, 2).map(pl => `<div class="cal-event cal-plan" data-plan-chip="${pl.id}"
              style="background:${planColor(pl.status)};" title="${UI.esc(planTooltip(pl))}">🎓 ${UI.esc(planLabel(pl))}</div>`).join('')}
          ${dayPlans.length > 2 ? `<div class="cal-event muted">+${dayPlans.length - 2} kelas</div>` : ''}
          ${dayEvents.slice(0, 2).map(ev => `<div class="cal-event" style="background:${ev.color || 'var(--primary-light)'};" title="${UI.esc(ev.title)}">${UI.esc(ev.title.length > 12 ? ev.title.slice(0, 12) + '...' : ev.title)}</div>`).join('')}
          ${dayEvents.length > 2 ? `<div class="cal-event muted">+${dayEvents.length - 2} acara</div>` : ''}
          ${global.AdmissionCal ? AdmissionCal.calendarChips(dateStr) : ''}
        </div>`;
      }

      container.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="flex-gap" style="align-items:center;">
              <button class="btn btn-sm btn-secondary" id="calPrev">&lt;</button>
              <h3 style="margin:0;min-width:180px;text-align:center;">${monthNames[viewMonth]} ${viewYear}</h3>
              <button class="btn btn-sm btn-secondary" id="calNext">&gt;</button>
            </div>
            ${canEdit ? '<button class="btn btn-primary btn-sm" id="addEventBtn">+ Tambah Acara</button>' : ''}
          </div>
          <div class="cal-grid">
            ${dayLabels.map(l => `<div class="cal-header">${l}</div>`).join('')}
            ${cells}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            ${UI.secHead('🎓', `Jadwal Kelas Bulan Ini (${plans.length})`, 'diambil dari War Jadwal Kelas')}
          </div>
          ${plans.length === 0
            ? '<div class="empty"><div class="empty-icon">🗓️</div>Belum ada rencana kelas pada bulan ini.</div>'
            : `<div class="table-wrap"><table class="table">
                <thead><tr><th>Tanggal</th><th>Kelas</th><th>Tutor</th><th>Materi</th><th>Jam</th><th>Status</th></tr></thead>
                <tbody>${plans.slice().sort((a, b) => a.date.localeCompare(b.date)).map(pl => {
                  const c = DB.getCourse(pl.courseId);
                  const t = DB.planTeacherNames(pl, ', ');
                  const st = (DB.PLAN_STATUS && DB.PLAN_STATUS[pl.status]) || { label: pl.status, badge: 'badge-gray' };
                  return `<tr>
                    <td>${UI.fmtYMD(pl.date)}</td>
                    <td>${UI.esc(c ? DB.courseTitle(c) : 'Kelas dihapus')}${pl.__childName ? `<div class="muted small">anak: ${UI.esc(pl.__childName)}</div>` : ''}</td>
                    <td>${UI.esc(t || '-')}</td>
                    <td>${pl.topic ? UI.esc(pl.topic) : '<span class="muted">belum diisi</span>'}</td>
                    <td>${UI.esc(pl.time || '-')}${pl.endTime ? '–' + UI.esc(pl.endTime) : ''}</td>
                    <td><span class="badge ${st.badge}">${UI.esc(st.label)}</span></td>
                  </tr>`;
                }).join('')}</tbody>
              </table></div>`}
        </div>

        <div class="card">
          <div class="card-header"><h3>Acara Bulan Ini</h3></div>
          <div id="monthEvents"></div>
        </div>
      `;

      // Month event list
      const monthEvts = events.filter(e => e.date && e.date.startsWith(`${viewYear}-${p(viewMonth + 1)}`))
        .sort((a, b) => a.date.localeCompare(b.date));
      const evBox = document.getElementById('monthEvents');
      if (monthEvts.length === 0) {
        evBox.innerHTML = '<div class="empty"><div class="empty-icon">📅</div>Tidak ada acara bulan ini.</div>';
      } else {
        evBox.innerHTML = monthEvts.map(ev => `
          <div class="list-item">
            <div class="flex-between">
              <div>
                <div class="title">${UI.esc(ev.title)}</div>
                <div class="meta">${UI.fmtYMD(ev.date)}${ev.time ? ' • ' + UI.esc(ev.time) : ''} • <span class="badge badge-info">${UI.esc(ev.category || 'Umum')}</span></div>
              </div>
              ${canEdit ? `<div class="flex-gap">
                <button class="btn btn-sm btn-secondary" data-edit-ev="${ev.id}">Edit</button>
                <button class="btn btn-sm btn-danger" data-del-ev="${ev.id}">Hapus</button>
              </div>` : ''}
            </div>
            ${ev.description ? `<div class="content">${UI.esc(ev.description)}</div>` : ''}
          </div>`).join('');
      }

      // Nav
      document.getElementById('calPrev').addEventListener('click', () => { viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } render(); });
      document.getElementById('calNext').addEventListener('click', () => { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } render(); });

      // Penanda jadwal seleksi (SNBP/SNBT/Mandiri) membuka Kalender Seleksi.
      container.querySelectorAll('[data-adm-chip]').forEach(chip => {
        chip.addEventListener('click', () => Dashboard.navigate('kalender-seleksi'));
        chip.addEventListener('dblclick', (e) => e.stopPropagation());
      });

      // Click date to add event
      if (canEdit) {
        // Klik ganda pada chip jadwal kelas tidak boleh membuka form acara baru
        container.querySelectorAll('[data-plan-chip]').forEach(chip =>
          chip.addEventListener('dblclick', (e) => e.stopPropagation()));
        container.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
          cell.addEventListener('dblclick', () => openEventForm(cell.dataset.date));
        });
        const addBtn = document.getElementById('addEventBtn');
        if (addBtn) addBtn.addEventListener('click', () => openEventForm(todayStr));
        container.querySelectorAll('[data-edit-ev]').forEach(b => b.addEventListener('click', () => openEventForm(null, b.dataset.editEv)));
        container.querySelectorAll('[data-del-ev]').forEach(b => b.addEventListener('click', () => {
          if (!UI.confirmDialog('Hapus acara ini?')) return;
          DB.deleteEvent(b.dataset.delEv);
          UI.toast('Acara dihapus.');
          render();
        }));
      }
    }

    function openEventForm(dateStr, editId) {
      const editing = editId ? DB.getEvent(editId) : null;
      const CATEGORIES = ['Jadwal Kelas', 'Ujian/CBT', 'Rapat', 'Acara', 'Deadline', 'Lainnya'];
      const body = `
        <form id="eventForm" class="form">
          <div class="form-group"><label>Judul</label>
            <input name="title" required value="${UI.esc(editing?.title || '')}" /></div>
          <div class="form-row">
            <div class="form-group"><label>Tanggal</label>
              <input name="date" type="date" required value="${editing?.date || dateStr || UI.todayYMD()}" /></div>
            <div class="form-group"><label>Waktu (opsional)</label>
              <input name="time" type="time" value="${UI.esc(editing?.time || '')}" /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Kategori</label>
              <select name="category">
                ${CATEGORIES.map(c => `<option value="${c}" ${editing?.category === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Warna</label>
              ${UI.colorFieldHtml('color', editing?.color, 'aria-label="Warna acara"', '#eef2ff')}</div>
          </div>
          <div class="form-group"><label>Deskripsi (opsional)</label>
            <textarea name="description" rows="3">${UI.esc(editing?.description || '')}</textarea></div>
          <div class="flex-gap" style="justify-content:flex-end;">
            <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
            <button type="submit" class="btn btn-primary">Simpan</button>
          </div>
        </form>`;
      UI.modal.open(editing ? 'Edit Acara' : 'Tambah Acara', body);
      document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());
      document.getElementById('eventForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const payload = {
          title: fd.get('title').trim(),
          date: fd.get('date'),
          time: fd.get('time') || '',
          category: fd.get('category'),
          color: fd.get('color'),
          description: fd.get('description').trim(),
          authorId: user.id
        };
        if (editing) DB.updateEvent(editing.id, payload);
        else DB.addEvent(payload);
        UI.toast('Acara disimpan.');
        UI.modal.close();
        render();
      });
    }
  }

  /* ===== Feedback / Kritik & Saran ===== */
  /* Tab terakhir per pengguna (bertahan selama sesi halaman). */
  const fbTabs = {};
  function renderFeedback(container, user) {
    const list = DB.getFeedbacks(user).sort((a, b) => b.createdAt - a.createdAt);
    const isStaff = user.role === 'admin' || user.role === 'guru';
    const mine = (fb) => !!fb.senderId && fb.senderId === user.id;
    const inbox = list.filter(fb => !mine(fb) && (user.role === 'admin'
      ? DB.feedbackTarget(fb) === 'admin'
      : DB.feedbackTarget(fb) === 'tutor' && fb.recipientId === user.id));
    const sent = list.filter(mine);
    const publik = list.filter(fb => DB.feedbackTarget(fb) === 'umum');
    const tabs = (isStaff ? [['inbox', 'Kotak Masuk', inbox]] : []).concat([['sent', 'Terkirim', sent], ['umum', 'Umum', publik]]);
    let tab = fbTabs[user.id] && tabs.some(t => t[0] === fbTabs[user.id]) ? fbTabs[user.id] : tabs[0][0];

    // Penerima: tutor dari kelas pengguna (mentee/anak) didahulukan.
    const tutors = DB.feedbackRecipients(user);
    const studentIds = user.role === 'siswa' ? [user.id] : (user.role === 'orangtua' ? (DB.getChildren(user.id) || []).map(c => c.id) : []);
    const myTutorIds = new Set();
    studentIds.forEach(sid => DB.getEnrollmentsByStudent(sid).forEach(e => {
      const c = DB.getCourse(e.courseId);
      if (c) DB.courseTeacherIds(c).forEach(t => myTutorIds.add(t));
    }));
    const tutorLabel = (u) => UI.esc(u.name || u.username) + (Array.isArray(u.subjects) && u.subjects.length ? ' — ' + UI.esc(u.subjects.slice(0, 3).join(', ')) : '');
    const opt = (u) => `<option value="${UI.esc(u.id)}">${tutorLabel(u)}</option>`;
    const near = tutors.filter(u => myTutorIds.has(u.id)), far = tutors.filter(u => !myTutorIds.has(u.id));
    const tutorOptions = near.length
      ? `<optgroup label="Tutor kelas ${user.role === 'orangtua' ? 'anak Anda' : 'Anda'}">${near.map(opt).join('')}</optgroup>${far.length ? `<optgroup label="Tutor lainnya">${far.map(opt).join('')}</optgroup>` : ''}`
      : tutors.map(opt).join('');
    const TARGET_INFO = {
      admin: ['Admin / Manajemen', 'Hanya admin yang dapat membaca.'],
      tutor: ['Tutor tertentu', 'Hanya tutor yang Anda pilih yang dapat membaca.'],
      umum: ['Umum', 'Terlihat oleh semua pengguna LMS.']
    };

    container.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Kirim Kritik & Saran</h3></div>
        <form id="feedbackForm" class="form" novalidate>
          <fieldset class="fb-targets">
            <legend>Tujuan</legend>
            ${Object.keys(TARGET_INFO).map((k, i) => `<label class="fb-target">
              <input type="radio" name="target" value="${k}" ${i === 0 ? 'checked' : ''} ${k === 'tutor' && !tutors.length ? 'disabled' : ''} />
              <span><strong>${TARGET_INFO[k][0]}</strong><small>${k === 'tutor' && !tutors.length ? 'Belum ada akun tutor.' : TARGET_INFO[k][1]}</small></span>
            </label>`).join('')}
          </fieldset>
          <div class="form-group" id="fbRecipientWrap" hidden>
            <label for="fbRecipient">Tutor penerima</label>
            <select id="fbRecipient" name="recipientId"><option value="">— Pilih tutor —</option>${tutorOptions}</select>
          </div>
          <div class="form-group">
            <label for="fbMessage">Pesan</label>
            <textarea id="fbMessage" name="message" rows="4" maxlength="2000" placeholder="Tulis kritik atau saran Anda…"></textarea>
            <div class="fb-count muted small" id="fbCount">0/2000</div>
          </div>
          <div class="fb-actions">
            <label class="fb-anon"><input type="checkbox" name="anonymous" /> Kirim anonim <span class="muted small">(nama Anda tidak ditampilkan ke siapa pun)</span></label>
            <button type="submit" class="btn btn-primary">Kirim</button>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="tabs" role="tablist">${tabs.map(([k, l, items]) => `<button type="button" role="tab" aria-selected="${k === tab}" class="tab-btn ${k === tab ? 'active' : ''}" data-fb-tab="${k}">${l}${(() => {
          // Kotak masuk: jumlah yang belum dibalas (merah). Tab lain: jumlah total (netral).
          const n = k === 'inbox' ? items.filter(f => !f.reply).length : items.length;
          return n ? ` <span class="tab-count ${k === 'inbox' ? '' : 'is-muted'}" ${k === 'inbox' ? 'title="Belum dibalas"' : ''}>${n > 99 ? '99+' : n}</span>` : '';
        })()}</button>`).join('')}</div>
        <p class="muted small fb-tab-note" id="fbTabNote"></p>
        <div id="fbSearch"></div>
      </div>
    `;

    const nameOf = (id) => { const u = DB.getUser(id); return u ? (u.name || u.username) : 'Akun terhapus'; };
    const senderOf = (fb) => {
      if (mine(fb)) return fb.anonymous ? 'Anda (anonim)' : 'Anda';
      if (fb.anonymous || !fb.senderId) return 'Anonim';
      const u = DB.getUser(fb.senderId);
      return u ? `${u.name || u.username} · ${Auth.ROLE_LABELS[u.role] || u.role}` : 'Akun terhapus';
    };
    const audienceOf = (fb) => {
      const t = DB.feedbackTarget(fb);
      if (t === 'tutor') return 'Untuk tutor: ' + nameOf(fb.recipientId);
      if (t === 'umum') return 'Umum';
      if (fb.target === 'individu' && fb.targetName) return 'Untuk: ' + fb.targetName + ' (data lama, hanya admin)';
      return 'Untuk admin';
    };
    const BADGE = { admin: 'badge-warning', tutor: 'badge-info', umum: 'badge-success' };
    const NOTES = {
      inbox: user.role === 'admin' ? 'Masukan yang dikirim ke admin. Hanya admin yang dapat membacanya.' : 'Masukan yang dikirim khusus kepada Anda. Orang lain tidak dapat membacanya.',
      sent: 'Masukan yang Anda kirim beserta balasannya.',
      umum: 'Masukan bertujuan umum, terlihat oleh semua pengguna.'
    };
    const paintList = () => {
      const items = (tabs.find(t => t[0] === tab) || tabs[0])[2];
      container.querySelector('#fbTabNote').textContent = NOTES[tab];
      DataSearch.mount({
        container: container.querySelector('#fbSearch'),
        items,
        stateKey: 'feedback-' + tab + '-' + user.id,
        placeholder: 'Cari isi pesan, pengirim, atau penerima…',
        fields: fb => [fb.message, senderOf(fb), audienceOf(fb), fb.reply ? fb.reply.text : ''],
        filters: tab === 'sent' ? [{ key: 'target', label: 'Semua tujuan', get: fb => DB.feedbackTarget(fb),
          options: Object.keys(DB.FEEDBACK_TARGETS).map(k => ({ value: k, label: DB.FEEDBACK_TARGETS[k] })) }] : [],
        dateRange: fb => DB.ymdOf(fb.createdAt),
        sorts: [
          { key: 'new', label: 'Terbaru', cmp: (a, b) => b.createdAt - a.createdAt },
          { key: 'old', label: 'Terlama', cmp: (a, b) => a.createdAt - b.createdAt }
        ],
        pageSize: 15,
        empty: tab === 'inbox' ? 'Belum ada masukan untuk Anda.' : (tab === 'sent' ? 'Anda belum mengirim kritik atau saran.' : 'Belum ada masukan umum.'),
        render: (rows, ctx) => rows.map(fb => {
          const t = DB.feedbackTarget(fb);
          const canReply = DB.canReplyFeedback(fb, user) && !mine(fb);
          return `<div class="list-item fb-item">
            <div class="fb-head">
              <div class="fb-who">
                <strong>${ctx.highlight(senderOf(fb))}</strong>
                <span class="badge ${BADGE[t]}">${ctx.highlight(audienceOf(fb))}</span>
              </div>
              <div class="fb-tools">
                <span class="muted small">${UI.fmtDateTime(fb.createdAt)}</span>
                ${canReply ? `<button type="button" class="btn btn-sm btn-outline" data-reply-fb="${UI.esc(fb.id)}">${fb.reply ? 'Ubah balasan' : 'Balas'}</button>` : ''}
                ${DB.canDeleteFeedback(fb, user) ? `<button type="button" class="btn btn-sm btn-danger" data-del-fb="${UI.esc(fb.id)}">Hapus</button>` : ''}
              </div>
            </div>
            <div class="fb-msg">${ctx.highlight(fb.message)}</div>
            ${fb.reply && fb.reply.text ? `<div class="fb-reply">
              <div class="muted small">Balasan ${UI.esc(nameOf(fb.reply.by))} · ${UI.fmtDateTime(fb.reply.at)}</div>
              <div class="fb-msg">${ctx.highlight(fb.reply.text)}</div>
            </div>` : ''}
          </div>`;
        }).join(''),
        onPaint: (box) => {
          box.querySelectorAll('[data-del-fb]').forEach(b => b.addEventListener('click', () => {
            if (!UI.confirmDialog('Hapus kritik/saran ini? Pengirim dan penerima tidak akan melihatnya lagi.')) return;
            if (DB.deleteFeedback(user, b.dataset.delFb)) UI.toast('Kritik/saran dihapus.');
            else UI.toast('Anda tidak dapat menghapus masukan ini.', 'error');
            renderFeedback(container, user);
          }));
          box.querySelectorAll('[data-reply-fb]').forEach(b => b.addEventListener('click', () => openReply(b.dataset.replyFb)));
        }
      });
    };

    function openReply(id) {
      const fb = DB.getFeedbacks(user).find(f => f.id === id);
      if (!fb) return;
      UI.modal.open('Balas Kritik & Saran', `
        <div class="fb-quote">${UI.esc(fb.message)}</div>
        <form id="fbReplyForm" class="form">
          <div class="form-group"><label for="fbReplyText">Balasan</label>
            <textarea id="fbReplyText" rows="4" maxlength="2000" placeholder="Tulis balasan…">${UI.esc((fb.reply && fb.reply.text) || '')}</textarea>
            <p class="muted small">${fb.anonymous ? 'Pengirim anonim akan melihat balasan di tab Terkirim.' : 'Pengirim mendapat notifikasi balasan.'} Kosongkan untuk menghapus balasan.</p>
          </div>
          <div class="flex-gap" style="justify-content:flex-end;">
            <button type="button" class="btn btn-outline" data-close>Batal</button>
            <button type="submit" class="btn btn-primary">Simpan</button>
          </div>
        </form>`);
      const form = document.getElementById('fbReplyForm');
      form.querySelector('[data-close]').addEventListener('click', () => UI.modal.close());
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const res = DB.replyFeedback(user, id, form.querySelector('#fbReplyText').value);
        if (res.error) return UI.toast(res.error, 'error');
        UI.modal.close();
        UI.toast(res.record.reply ? 'Balasan disimpan.' : 'Balasan dihapus.');
        renderFeedback(container, user);
      });
    }

    container.querySelectorAll('[data-fb-tab]').forEach(b => b.addEventListener('click', () => {
      tab = fbTabs[user.id] = b.dataset.fbTab;
      container.querySelectorAll('[data-fb-tab]').forEach(x => {
        const on = x.dataset.fbTab === tab;
        x.classList.toggle('active', on);
        x.setAttribute('aria-selected', String(on));
      });
      paintList();
    }));
    paintList();

    const form = document.getElementById('feedbackForm');
    const recWrap = form.querySelector('#fbRecipientWrap');
    const msg = form.querySelector('#fbMessage');
    form.querySelectorAll('input[name="target"]').forEach(r => r.addEventListener('change', () => {
      recWrap.hidden = form.querySelector('input[name="target"]:checked').value !== 'tutor';
    }));
    msg.addEventListener('input', () => { form.querySelector('#fbCount').textContent = msg.value.length + '/2000'; });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const res = DB.addFeedback(user, {
        target: fd.get('target'),
        recipientId: fd.get('recipientId'),
        message: fd.get('message'),
        anonymous: !!fd.get('anonymous')
      });
      if (res.error) {
        UI.toast(res.error, 'error');
        (fd.get('target') === 'tutor' && !fd.get('recipientId') ? form.querySelector('#fbRecipient') : msg).focus();
        return;
      }
      fbTabs[user.id] = 'sent';
      UI.toast('Kritik & saran terkirim.');
      renderFeedback(container, user);
    });
  }

  /* ===== Announcements / Pengumuman ===== */
  /** Label ramah untuk sasaran pengumuman, mis. "Peran: Orang Tua". */
  function audienceLabel(a) {
    const roles = { guru: 'Tutor', siswa: 'Mentee', orangtua: 'Orang Tua', admin: 'Admin' };
    if (a.targetType === 'semua') return 'Semua pengguna';
    if (a.targetType === 'role') return 'Peran: ' + (roles[a.targetRole] || a.targetRole || '-');
    if (a.targetType === 'kelas') {
      const n = (a.targetIds || []).length;
      return n === 1
        ? 'Kelas: ' + (DB.getCourse(a.targetIds[0]) ? DB.courseTitle(DB.getCourse(a.targetIds[0])) : '-')
        : `Kelas tertentu (${n})`;
    }
    if (a.targetType === 'individu') return `Individu (${(a.targetIds || []).length})`;
    return a.targetType || '-';
  }

  /** Satu sumber aturan audience untuk halaman Pengumuman DAN papan berjalan. */
  function isAnnouncementVisible(a, user) {
    if (!a || !user) return false;
    if (user.role === 'admin') return true;
    if (a.targetType === 'semua') return true;
    if (a.targetType === 'individu') return !!(a.targetIds || []).includes(user.id);
    if (a.targetType === 'role') return a.targetRole === user.role;
    if (a.targetType !== 'kelas') return false;

    const allowed = new Set();
    if (user.role === 'guru') {
      // Bug lama: guru diperiksa sebagai enrollment siswa sehingga tidak pernah
      // menerima pengumuman kelasnya. Kini memakai relasi tutor kelas.
      DB.getCoursesByTeacher(user.id).forEach(c => allowed.add(c.id));
    } else if (user.role === 'orangtua') {
      (DB.getChildren(user.id) || []).forEach(ch =>
        DB.getEnrollmentsByStudent(ch.id).forEach(e => allowed.add(e.courseId)));
    } else if (user.role === 'siswa') {
      DB.getEnrollmentsByStudent(user.id).forEach(e => allowed.add(e.courseId));
    }
    return (a.targetIds || []).some(id => allowed.has(id));
  }

  function visibleAnnouncementsFor(user) {
    return DB.getAnnouncements().filter(a => isAnnouncementVisible(a, user))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Escape dulu, lalu ubah URL http(s) menjadi tautan aman berwarna biru. */
  function autoLinkText(text) {
    const safe = UI.esc(String(text || ''));
    const linked = safe.replace(/(https?:\/\/[^\s<]+)/gi, raw => {
      let url = raw;
      let tail = '';
      while (/[.,!?;:)]$/.test(url)) { tail = url.slice(-1) + tail; url = url.slice(0, -1); }
      return `<a class="ann-auto-link" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${tail}`;
    });
    return linked.replace(/\n/g, '<br>');
  }

  function announcementContentHtml(a) {
    return `${a.imageData ? `<img class="ann-image" src="${UI.esc(a.imageData)}" alt="Gambar pengumuman ${UI.esc(a.title || '')}" loading="lazy" />` : ''}
      <div class="ann-content">${autoLinkText(a.content)}</div>`;
  }

  /** Pengumuman masih tayang di papan berjalan? (tickerUntil kosong = tanpa batas waktu) */
  function tickerActive(a, now) {
    if (!a || !a.showInTicker) return false;
    const until = Number(a.tickerUntil) || 0;
    return !until || until > (now || Date.now());
  }

  /**
   * Papan berjalan permanen di bawah topbar, audience-nya sama dengan pengumuman.
   * Hanya JUDUL yang ditampilkan, dan pengumuman otomatis berhenti tayang saat
   * waktu tayangnya (tickerUntil) berakhir — dijadwalkan ulang tepat pada waktunya.
   */
  let tickerTimer = null;
  function renderTicker(container, user) {
    if (!container) return;
    if (tickerTimer) { clearTimeout(tickerTimer); tickerTimer = null; }
    const now = Date.now();
    const marked = visibleAnnouncementsFor(user).filter(a => tickerActive(a, now));
    const fallback = `Selamat datang di ${DB.getSettings().appName || 'LMS Rubela'} • Tetap konsisten belajar dan raih kampus impianmu!`;
    const shown = marked.slice(0, 8);
    const items = shown.length ? shown.map(a => String(a.title || '').trim() || 'Pengumuman') : [fallback];
    const text = items.join('   ✦   ');
    // Render ulang saat pengumuman terdekat berakhir (maks. 6 jam sekali agar tetap segar).
    const ends = shown.map(a => Number(a.tickerUntil) || 0).filter(t => t > now);
    const wait = Math.min(ends.length ? Math.min(...ends) - now + 500 : Infinity, 6 * 3600000);
    tickerTimer = setTimeout(() => { if (container.isConnected) renderTicker(container, user); }, wait);
    container.innerHTML = `<div class="ticker-label">📢 INFO</div>
      <button type="button" class="ticker-viewport" id="tickerOpen" title="Buka Pengumuman">
        <span class="ticker-track">${UI.esc(text)}</span>
      </button>
      <button type="button" class="ticker-toggle" id="tickerToggle" aria-label="Jeda papan berjalan" title="Jeda/lanjutkan">⏸</button>`;
    const open = container.querySelector('#tickerOpen');
    if (open && global.Dashboard && Dashboard.hasSection('pengumuman')) {
      open.addEventListener('click', () => Dashboard.navigate('pengumuman'));
    }
    const toggle = container.querySelector('#tickerToggle');
    if (toggle) toggle.addEventListener('click', () => {
      const paused = container.classList.toggle('is-paused');
      toggle.textContent = paused ? '▶' : '⏸';
      toggle.setAttribute('aria-label', paused ? 'Lanjutkan papan berjalan' : 'Jeda papan berjalan');
    });
  }

  function renderAnnouncements(container, user) {
    const canEdit = user.role === 'admin' || user.role === 'guru';
    const visible = user.role === 'admin'
      ? DB.getAnnouncements().sort((a, b) => b.createdAt - a.createdAt)
      : visibleAnnouncementsFor(user);

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Pengumuman (${visible.length})</h3>
          ${canEdit ? '<button class="btn btn-primary btn-sm" id="addAnnBtn">+ Buat Pengumuman</button>' : ''}
        </div>
        ${visible.length === 0 ? '<div class="empty"><div class="empty-icon">📢</div>Tidak ada pengumuman.</div>' :
          visible.map(a => {
            const author = DB.getUser(a.authorId);
            return `<div class="list-item">
              <div class="flex-between">
                <div class="title">${UI.esc(a.title)}</div>
                <div class="flex-gap">
                  <span class="badge ${a.targetType === 'semua' ? 'badge-success' : 'badge-info'}">${UI.esc(audienceLabel(a))}</span>
                  ${tickerBadge(a)}
                  ${canEdit && (user.role === 'admin' || a.authorId === user.id) && a.showInTicker ? `<button class="btn btn-sm btn-secondary" data-ticker-ann="${a.id}">⏱ Waktu tayang</button>` : ''}
                  ${canEdit && (user.role === 'admin' || a.authorId === user.id) ? `<button class="btn btn-sm btn-danger" data-del-ann="${a.id}">Hapus</button>` : ''}
                </div>
              </div>
              <div class="meta">${UI.esc(author?.name || '-')} • ${UI.fmtDateTime(a.createdAt)}</div>
              ${announcementContentHtml(a)}
            </div>`;
          }).join('')}
      </div>
    `;

    if (canEdit) {
      const addBtn = document.getElementById('addAnnBtn');
      if (addBtn) addBtn.addEventListener('click', () => openAnnouncementForm(container, user));
    }
    container.querySelectorAll('[data-del-ann]').forEach(b => b.addEventListener('click', () => {
      DB.deleteAnnouncement(b.dataset.delAnn);
      global.dispatchEvent(new CustomEvent('lms:announcements-changed'));
      UI.toast('Pengumuman dihapus.');
      renderAnnouncements(container, user);
    }));
    container.querySelectorAll('[data-ticker-ann]').forEach(b => b.addEventListener('click', () => openTickerTimeForm(container, user, b.dataset.tickerAnn)));
  }

  function tickerBadge(a) {
    if (!a.showInTicker) return '';
    const until = Number(a.tickerUntil) || 0;
    if (until && until <= Date.now()) return `<span class="badge badge-gray" title="Berakhir ${UI.esc(UI.fmtDateTime(until))}">⏹ Papan berjalan berakhir</span>`;
    return `<span class="badge badge-warning">📢 Papan berjalan${until ? ' s/d ' + UI.esc(UI.fmtDateTime(until)) : ''}</span>`;
  }

  /** Ubah/hentikan waktu tayang papan berjalan sebuah pengumuman. */
  function openTickerTimeForm(container, user, id) {
    const a = DB.getAnnouncement(id);
    if (!a) return;
    const until = Number(a.tickerUntil) || 0;
    UI.modal.open('Waktu Tayang Papan Berjalan', `
      <form id="annTickForm" class="form">
        <p class="muted small" style="margin-top:0;">"${UI.esc(a.title)}" — hanya judulnya yang bergerak di papan berjalan.</p>
        <div class="form-group"><label for="annTickUntil">Tayang sampai</label>
          <input type="datetime-local" id="annTickUntil" value="${UI.esc(until ? UI.utcToTzInput(until) : '')}" />
          <div class="muted small">Kosongkan bila ingin tayang tanpa batas waktu.</div></div>
        <div class="flex-gap" style="justify-content:space-between;flex-wrap:wrap;">
          <button type="button" class="btn btn-danger" id="annTickStop">⏹ Hentikan sekarang</button>
          <div class="flex-gap"><button type="button" class="btn btn-secondary" id="annTickCancel">Batal</button>
            <button type="submit" class="btn btn-primary">Simpan</button></div>
        </div>
      </form>`);
    const done = (patch, msg) => {
      DB.updateAnnouncement(id, patch);
      global.dispatchEvent(new CustomEvent('lms:announcements-changed'));
      UI.toast(msg);
      UI.modal.close();
      renderAnnouncements(container, user);
    };
    document.getElementById('annTickCancel').addEventListener('click', () => UI.modal.close());
    document.getElementById('annTickStop').addEventListener('click', () => done({ tickerUntil: Date.now() }, 'Pengumuman dihentikan dari papan berjalan.'));
    document.getElementById('annTickForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = document.getElementById('annTickUntil').value;
      const ts = v ? UI.tzInputToUtc(v) : null;
      if (v && (!ts || !isFinite(ts))) { UI.toast('Tanggal tidak valid.', 'error'); return; }
      if (ts && ts <= Date.now()) { UI.toast('Waktu tayang harus di masa depan. Gunakan "Hentikan sekarang" untuk berhenti.', 'error'); return; }
      done({ tickerUntil: ts || null }, ts ? 'Waktu tayang diperbarui.' : 'Papan berjalan tanpa batas waktu.');
    });
  }

  function openAnnouncementForm(container, user) {
    // Tutor hanya dapat menargetkan kelas yang benar-benar dia ampu.
    const courses = user.role === 'guru' ? DB.getCoursesByTeacher(user.id) : DB.getCourses();
    let pendingImage = '';
    let imageJob = 0;
    let imageProcessing = false;
    const body = `
      <form id="annForm" class="form">
        <div class="form-group"><label>Judul</label>
          <input name="title" required placeholder="Judul pengumuman..." /></div>
        <div class="form-group"><label>Isi Pengumuman</label>
          <textarea name="content" required rows="4" placeholder="Tulis pengumuman... Tautan https:// akan otomatis menjadi biru dan bisa diklik."></textarea>
          <div class="muted small">Tautan yang diawali http:// atau https:// otomatis menjadi tautan biru yang aman.</div></div>
        <div class="form-group"><label for="annImage">Gambar (opsional)</label>
          <input type="file" id="annImage" accept="image/png,image/jpeg,image/webp,image/gif" />
          <div class="muted small">Gambar diperkecil otomatis agar hemat penyimpanan browser.</div>
          <div id="annImagePreview"></div>
        </div>
        <label class="sec-opt">
          <input type="checkbox" name="showInTicker" value="1" id="annTicker" />
          <div><div class="so-nm">📢 Tampilkan di papan berjalan</div>
          <div class="so-ds">Hanya judul yang bergerak di bagian atas dashboard sesuai sasaran pengumuman, dan berhenti otomatis saat waktu tayang berakhir.</div></div>
        </label>
        <div class="form-group hidden" id="annTickerUntilBox"><label for="annTickerUntil">Tayang di papan berjalan sampai</label>
          <input type="datetime-local" name="tickerUntil" id="annTickerUntil" value="${UI.esc(UI.utcToTzInput(Date.now() + 7 * 86400000))}" />
          <div class="muted small">Bawaan 7 hari. Kosongkan bila ingin tayang tanpa batas waktu.</div></div>
        <div class="form-group"><label>Ditujukan Kepada</label>
          <select name="targetType" id="annTarget">
            <option value="semua">Semua Pengguna (Tutor + Mentee + Orang Tua)</option>
            <option value="role">Peran Tertentu</option>
            <option value="kelas">Kelas Tertentu</option>
            <option value="individu">Individu</option>
          </select>
        </div>
        <div id="annTargetDetail" class="form-group hidden"></div>
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
          <button type="submit" class="btn btn-primary" id="annSubmit">Kirim</button>
        </div>
      </form>`;
    UI.modal.open('Buat Pengumuman', body);
    document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());
    const tickChk = document.getElementById('annTicker');
    tickChk.addEventListener('change', () => document.getElementById('annTickerUntilBox').classList.toggle('hidden', !tickChk.checked));
    document.getElementById('annImage').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      const preview = document.getElementById('annImagePreview');
      const submit = document.getElementById('annSubmit');
      const token = ++imageJob;
      if (!file) { pendingImage = ''; imageProcessing = false; submit.disabled = false; preview.innerHTML = ''; return; }
      imageProcessing = true;
      submit.disabled = true;
      preview.innerHTML = global.AI ? AI.loadingHtml('Memproses gambar…') : '<span class="muted">Memproses gambar…</span>';
      try {
        const result = await Editor.compressImage(file);
        if (token !== imageJob) return;
        pendingImage = result;
        imageProcessing = false;
        submit.disabled = false;
        preview.innerHTML = `<img class="ann-image is-preview" src="${UI.esc(pendingImage)}" alt="Pratinjau gambar" />
          <button type="button" class="btn btn-sm btn-secondary" id="annRemoveImage">Hapus gambar</button>`;
        document.getElementById('annRemoveImage').addEventListener('click', () => {
          pendingImage = '';
          imageJob++;
          imageProcessing = false;
          document.getElementById('annSubmit').disabled = false;
          document.getElementById('annImage').value = '';
          preview.innerHTML = '';
        });
      } catch (err) {
        if (token !== imageJob) return;
        pendingImage = '';
        imageProcessing = false;
        submit.disabled = false;
        preview.innerHTML = '';
        UI.toast(err.message || 'Gagal membaca gambar.', 'error');
      }
    });

    const targetSel = document.getElementById('annTarget');
    const detailBox = document.getElementById('annTargetDetail');
    targetSel.addEventListener('change', () => {
      const t = targetSel.value;
      if (t === 'semua') { detailBox.classList.add('hidden'); detailBox.innerHTML = ''; return; }
      detailBox.classList.remove('hidden');
      if (t === 'role') {
        detailBox.innerHTML = `<label>Peran</label>
        <select name="targetRole">
          <option value="siswa">Mentee</option>
          <option value="guru">Tutor</option>
          <option value="orangtua">Orang Tua</option>
        </select>
        <div class="muted small">Pengumuman hanya tampil pada dashboard peran yang dipilih.</div>`;
      } else if (t === 'kelas') {
        detailBox.innerHTML = '<label>Kelas</label><div style="max-height:150px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:6px;padding:6px;">' +
          courses.map(c => `<label style="display:block;padding:4px;"><input type="checkbox" name="tid" value="${c.id}" /> ${UI.esc(c.title)}</label>`).join('') + '</div>';
      } else {
        const users = DB.getUsers().filter(u => u.role !== 'admin');
        detailBox.innerHTML = '<label>Individu</label><input id="annIndSearch" placeholder="Cari..." style="margin-bottom:6px;padding:6px;border:1px solid var(--gray-300);border-radius:4px;width:100%;" /><div id="annIndList" style="max-height:150px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:6px;padding:6px;">' +
          users.map(u => `<label style="display:block;padding:4px;" data-n="${u.name.toLowerCase()}"><input type="checkbox" name="tid" value="${u.id}" /> ${UI.esc(u.name)} (${UI.esc(Auth.ROLE_LABELS[u.role] || u.role)})</label>`).join('') + '</div>';
        setTimeout(() => {
          const search = document.getElementById('annIndSearch');
          if (search) search.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            document.querySelectorAll('#annIndList label').forEach(l => { l.style.display = l.dataset.n.includes(q) ? '' : 'none'; });
          });
        }, 50);
      }
    });

    document.getElementById('annForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (imageProcessing) { UI.toast('Tunggu hingga gambar selesai diproses.', 'info'); return; }
      const fd = new FormData(e.target);
      const untilRaw = String(fd.get('tickerUntil') || '');
      const tickerUntil = fd.get('showInTicker') === '1' && untilRaw ? UI.tzInputToUtc(untilRaw) : null;
      if (fd.get('showInTicker') === '1' && untilRaw && (!tickerUntil || tickerUntil <= Date.now())) {
        UI.toast('Waktu tayang papan berjalan harus di masa depan.', 'error');
        return;
      }
      const payload = {
        title: fd.get('title').trim(),
        content: fd.get('content').trim(),
        targetType: fd.get('targetType'),
        targetRole: fd.get('targetRole') || null,
        targetIds: fd.getAll('tid').length > 0 ? fd.getAll('tid') : null,
        showInTicker: fd.get('showInTicker') === '1',
        tickerUntil: tickerUntil || null,
        imageData: pendingImage || '',
        authorId: user.id
      };
      if ((payload.targetType === 'kelas' || payload.targetType === 'individu') && !payload.targetIds) {
        UI.toast('Pilih minimal satu sasaran.', 'error');
        return;
      }
      DB.addAnnouncement(payload);
      global.dispatchEvent(new CustomEvent('lms:announcements-changed'));
      UI.toast('Pengumuman dipublikasikan!');
      UI.modal.close();
      renderAnnouncements(container, user);
    });
  }

  /* ===== Live Chat ===== */
  function renderChat(container, user) {
    let activeChatUserId = null;
    // Show relevant contacts: admin sees all, guru sees students+admin, siswa sees guru+admin
    let contacts;
    if (user.role === 'admin') {
      contacts = DB.getUsers().filter(u => u.id !== user.id);
    } else if (user.role === 'guru') {
      contacts = DB.getUsers().filter(u => u.id !== user.id && (u.role === 'siswa' || u.role === 'admin'));
    } else {
      contacts = DB.getUsers().filter(u => u.id !== user.id && (u.role === 'guru' || u.role === 'admin'));
    }

    renderLayout();

    function renderLayout() {
      const partners = DB.getConversationPartners(user.id);
      // Sort contacts: those with existing conversations first
      const sorted = contacts.slice().sort((a, b) => {
        const ai = partners.includes(a.id) ? 0 : 1;
        const bi = partners.includes(b.id) ? 0 : 1;
        return ai - bi || a.name.localeCompare(b.name);
      });

      container.innerHTML = `
        <div class="chat-layout ${activeChatUserId ? 'show-conv' : ''}" id="chatLayout">
          <div class="chat-sidebar">
            <div class="chat-search">
              <input id="chatSearch" placeholder="Cari kontak..." />
            </div>
            <div class="chat-contacts" id="chatContacts">
              ${sorted.map(c => {
                const lastMsg = getLastMessage(user.id, c.id);
                return `<div class="chat-contact ${activeChatUserId === c.id ? 'active' : ''}" data-uid="${c.id}">
                  <div class="avatar" style="width:32px;height:32px;font-size:12px;">${AV(c)}</div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:500;">${UI.esc(c.name)}</div>
                    <div class="muted small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${lastMsg ? UI.esc(previewText(lastMsg, 30)) : '<i>Belum ada pesan</i>'}</div>
                  </div>
                  <span class="badge badge-gray" style="font-size:9px;">${c.role}</span>
                </div>`;
              }).join('')}
            </div>
          </div>
          <div class="chat-main" id="chatMain">
            ${activeChatUserId ? '' : '<div class="empty" style="margin:auto;"><div class="empty-icon">💭</div>Pilih kontak untuk mulai chat</div>'}
          </div>
        </div>
      `;

      // Search
      document.getElementById('chatSearch').addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('.chat-contact').forEach(el => {
          const name = DB.getUser(el.dataset.uid)?.name?.toLowerCase() || '';
          el.style.display = name.includes(q) ? '' : 'none';
        });
      });

      // Click contact
      container.querySelectorAll('.chat-contact').forEach(el => {
        el.addEventListener('click', () => {
          activeChatUserId = el.dataset.uid;
          renderLayout();
          renderConversation();
        });
      });

      if (activeChatUserId) renderConversation();
      fitChat();
    }

    /* Tinggi panel chat = tinggi area pandang yang benar-benar terlihat
     * (visualViewport ikut mengecil saat keyboard ponsel muncul), sehingga
     * kotak ketik selalu tampil tanpa perlu zoom out. */
    function fitChat() {
      const layout = document.getElementById('chatLayout');
      if (!layout) return;
      const vv = global.visualViewport;
      const viewH = vv ? vv.height : global.innerHeight;
      const top = layout.getBoundingClientRect().top + (global.scrollY || 0);
      const bottomPad = global.innerWidth <= 560 ? 8 : 20;
      // Navigasi bawah ponsel menutupi bagian bawah layar — kurangi tingginya.
      const bn = document.getElementById('bottomNav');
      const bnH = bn && getComputedStyle(bn).display !== 'none' ? bn.offsetHeight : 0;
      const h = Math.max(300, Math.round(viewH - Math.min(top, viewH * 0.45) - bottomPad - bnH));
      layout.style.setProperty('--chat-h', h + 'px');
    }
    if (global.__chatFit) {
      global.removeEventListener('resize', global.__chatFit);
      if (global.visualViewport) global.visualViewport.removeEventListener('resize', global.__chatFit);
    }
    global.__chatFit = () => {
      if (!document.getElementById('chatLayout')) {
        global.removeEventListener('resize', global.__chatFit);
        if (global.visualViewport) global.visualViewport.removeEventListener('resize', global.__chatFit);
        global.__chatFit = null;
        return;
      }
      fitChat();
      const box = document.getElementById('chatMessages');
      if (box) box.scrollTop = box.scrollHeight;
    };
    global.addEventListener('resize', global.__chatFit);
    if (global.visualViewport) global.visualViewport.addEventListener('resize', global.__chatFit);
    setTimeout(fitChat, 60);

    function getLastMessage(uid1, uid2) {
      const conv = DB.getConversation(uid1, uid2);
      return conv.length > 0 ? conv[conv.length - 1] : null;
    }

    /* ---------- Ikon (SVG, mengikuti warna teks) ---------- */
    const ICON = {
      reply: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
      forward: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>',
      trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
      copy: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
      more: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
      close: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'
    };
    const reducedMotion = () => !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    let replyTarget = null;          // pesan yang sedang dibalas

    const nameOf = (id) => (id === user.id ? 'Anda' : ((DB.getUser(id) || {}).name || 'Pengguna'));
    /** Teks pratinjau satu baris (daftar kontak, kutipan). */
    function previewText(m, max) {
      if (!m) return '';
      if (m.deleted) return 'Pesan telah dihapus';
      const t = String(m.text || '').replace(/\s+/g, ' ').trim();
      return t.length > max ? t.slice(0, max - 1) + '…' : t;
    }
    /** Teks kutipan satu baris; rumus tetap dirender. */
    const quoteText = (t) => (global.RichText ? RichText.renderMathInText(t) : UI.esc(t));
    /** Isi pesan: rumus ($...$) dirender, tautan http(s) bisa diklik, sisanya di-escape. */
    function renderConversation() {
      const chatMain = document.getElementById('chatMain');
      const partner = DB.getUser(activeChatUserId);
      if (!partner) return;
      const messages = DB.getConversation(user.id, activeChatUserId);
      replyTarget = null;

      chatMain.innerHTML = `
        <div class="chat-header">
          <button type="button" class="chat-back" id="chatBack" aria-label="Kembali ke daftar kontak">←</button>
          <div class="avatar" style="width:32px;height:32px;font-size:12px;">${AV(partner)}</div>
          <div>
            <strong>${UI.esc(partner.name)}</strong>
            <div class="muted small">${UI.esc(partner.role)} ${partner.subject ? '• ' + UI.esc(partner.subject) : ''}</div>
          </div>
        </div>
        <div class="chat-messages" id="chatMessages" aria-label="Riwayat pesan">${messagesHtml(messages)}</div>
        <div class="chat-reply-bar" id="chatReplyBar" hidden></div>
        <form class="chat-input-box" id="chatForm">
          <button type="button" class="chat-fx-btn" id="chatFx" title="Sisipkan rumus" aria-label="Sisipkan rumus">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 5H7l6 7-6 7h11"/></svg>
          </button>
          <input id="chatInput" placeholder="Ketik pesan..." autocomplete="off" maxlength="2000" aria-label="Ketik pesan" enterkeyhint="send" />
          <button type="submit" class="btn btn-primary btn-sm" id="chatSendBtn">Kirim</button>
        </form>
      `;
      document.getElementById('chatBack').addEventListener('click', () => {
        activeChatUserId = null;
        renderLayout();
      });

      const msgBox = document.getElementById('chatMessages');
      msgBox.scrollTop = msgBox.scrollHeight;
      bindMessageEvents(msgBox);

      const send = () => {
        const input = document.getElementById('chatInput');
        const text = input.value.trim();
        if (!text) return;
        const sent = DB.addMessage({ senderId: user.id, receiverId: activeChatUserId, text }, { replyTo: replyTarget });
        if (!sent) { UI.toast('Pesan tidak dapat dikirim.', 'error'); return; }
        input.value = '';
        renderConversation();
        const again = document.getElementById('chatInput');
        if (again) again.focus({ preventScroll: true });
      };
      document.getElementById('chatForm').addEventListener('submit', (e) => { e.preventDefault(); send(); });
      document.getElementById('chatFx').addEventListener('click', () => {
        if (!global.MathPad) return;
        MathPad.open({
          onInsert: (latex, isBlock) => {
            const box = document.getElementById('chatInput');
            if (!box) return;
            const d = isBlock ? '$$' : '$';
            const add = d + latex.replace(/\s*\n\s*/g, ' ') + d;
            const a = box.selectionStart == null ? box.value.length : box.selectionStart;
            const b = box.selectionEnd == null ? a : box.selectionEnd;
            box.value = (box.value.slice(0, a) + add + box.value.slice(b)).slice(0, 2000);
            box.focus({ preventScroll: true });
          }
        });
      });
      const input = document.getElementById('chatInput');
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && replyTarget) { e.preventDefault(); setReply(null); }
      });
      // Fokus otomatis hanya di layar lebar agar keyboard ponsel tidak langsung muncul.
      if (global.innerWidth > 860) input.focus({ preventScroll: true });
    }

    function formatChatTime(ts) {
      const d = UI.toTzDate(ts);
      const p = n => String(n).padStart(2, '0');
      return `${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    /** Kutipan pesan yang dibalas. Utamakan pesan asli (anti cuplikan palsu); cuplikan hanya cadangan. */
    function quoteHtml(m, byId) {
      if (!m.replyToId) return '';
      const orig = byId.get(m.replyToId);
      let who, text, cls = '';
      if (orig) {
        who = nameOf(orig.senderId);
        text = previewText(orig, 120);
        if (orig.deleted) cls = ' is-deleted';
      } else {
        const snap = m.replyTo || {};
        who = snap.senderId ? nameOf(snap.senderId) : 'Pesan';
        text = snap.text ? previewText({ text: snap.text }, 120) : 'Pesan asli tidak tersedia';
        cls = ' is-missing';
      }
      return `<button type="button" class="chat-quote${cls}" data-jump="${UI.esc(m.replyToId)}" aria-label="Lihat pesan yang dibalas dari ${UI.esc(who)}">
          <span class="chat-quote-who">${UI.esc(who)}</span>
          <span class="chat-quote-text">${quoteText(text)}</span>
        </button>`;
    }

    function messagesHtml(messages) {
      if (messages.length === 0) return '<div class="chat-empty">Belum ada pesan. Kirim pesan pertama.</div>';
      const byId = new Map(messages.map(m => [m.id, m]));
      return messages.map(m => {
        const mine = m.senderId === user.id;
        const side = mine ? 'sent' : 'received';
        const time = formatChatTime(m.createdAt);
        if (m.deleted) {
          return `<div class="chat-row ${side}" data-mid="${UI.esc(m.id)}">
            <div class="chat-bubble ${side} is-deleted" tabindex="0" data-mid="${UI.esc(m.id)}">
              <div class="chat-text">${mine ? 'Anda menghapus pesan ini' : 'Pesan ini telah dihapus'}</div>
              <div class="chat-time">${time}</div>
            </div></div>`;
        }
        const fwd = m.forwarded
          ? `<div class="chat-fwd">${ICON.forward}<span>Diteruskan${m.forwardedFrom ? ' dari ' + UI.esc(m.forwardedFrom) : ''}</span></div>` : '';
        return `<div class="chat-row ${side}" data-mid="${UI.esc(m.id)}">
          <span class="chat-swipe-ind" aria-hidden="true">${ICON.reply}</span>
          <div class="chat-bubble ${side}" tabindex="0" data-mid="${UI.esc(m.id)}"
               aria-label="Pesan dari ${UI.esc(nameOf(m.senderId))}, pukul ${time}. Tekan Enter untuk menu.">
            ${fwd}${quoteHtml(m, byId)}
            <div class="chat-text">${chatTextHtml(m.text)}</div>
            <div class="chat-time">${time}</div>
          </div>
          <div class="chat-actions">
            <button type="button" class="chat-act" data-act="reply" title="Balas" aria-label="Balas">${ICON.reply}</button>
            <button type="button" class="chat-act" data-act="forward" title="Teruskan" aria-label="Teruskan">${ICON.forward}</button>
            <button type="button" class="chat-act" data-act="menu" title="Lainnya" aria-label="Aksi lainnya" aria-haspopup="menu">${ICON.more}</button>
          </div>
        </div>`;
      }).join('');
    }

    const findMsg = (id) => DB.getConversation(user.id, activeChatUserId).find(m => m.id === id) || null;

    /* ---------- Balas ---------- */
    function setReply(m) {
      replyTarget = m && !m.deleted ? m : null;
      const bar = document.getElementById('chatReplyBar');
      if (!bar) return;
      if (!replyTarget) { bar.hidden = true; bar.innerHTML = ''; return; }
      bar.innerHTML = `
        <div class="chat-reply-quote">
          <span class="chat-quote-who">Membalas ${UI.esc(nameOf(replyTarget.senderId))}</span>
          <span class="chat-quote-text">${quoteText(previewText(replyTarget, 140))}</span>
        </div>
        <button type="button" class="chat-act" id="chatReplyCancel" title="Batal membalas" aria-label="Batal membalas">${ICON.close}</button>`;
      bar.hidden = false;
      bar.querySelector('#chatReplyCancel').addEventListener('click', () => setReply(null));
      const input = document.getElementById('chatInput');
      if (input) input.focus({ preventScroll: true });
    }

    /* ---------- Lompat ke pesan asal ---------- */
    function jumpTo(id) {
      const box = document.getElementById('chatMessages');
      const row = box && box.querySelector(`.chat-row[data-mid="${CSS.escape(id)}"]`);
      if (!row) { UI.toast('Pesan asal tidak lagi tersedia.', 'info'); return; }
      row.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      row.classList.remove('is-flash');
      void row.offsetWidth;
      row.classList.add('is-flash');
      setTimeout(() => row.classList.remove('is-flash'), 1600);
      const b = row.querySelector('.chat-bubble');
      if (b) b.focus({ preventScroll: true });
    }

    /* ---------- Hapus ---------- */
    function deleteMsg(m) {
      if (!m || m.senderId !== user.id || m.deleted) return;
      if (!UI.confirmDialog('Hapus pesan ini? Isi pesan akan hilang untuk Anda dan penerima.')) return;
      if (!DB.deleteMessage(m.id, user.id)) { UI.toast('Pesan tidak dapat dihapus.', 'error'); return; }
      if (replyTarget && replyTarget.id === m.id) setReply(null);
      refreshMessages(true);
      UI.toast('Pesan dihapus.', 'success');
    }

    function copyMsg(m) {
      const t = String((m && m.text) || '');
      const done = () => UI.toast('Teks pesan disalin.', 'success');
      const fail = () => UI.toast('Gagal menyalin. Tekan lama pada teks untuk menyalin manual.', 'error');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fail);
      else fail();
    }

    /* ---------- Teruskan ---------- */
    function openForward(m) {
      if (!m || m.deleted) return;
      const origin = m.forwarded ? (m.forwardedFrom || '') : (m.senderId === user.id ? (user.name || '') : nameOf(m.senderId));
      const list = contacts.slice().sort((a, b) => a.name.localeCompare(b.name));
      UI.modal.open('Teruskan pesan', `
        <div class="chat-fwd-dialog">
          <div class="chat-fwd-preview">${UI.esc(previewText(m, 200))}</div>
          <label class="sr-only" for="fwdSearch">Cari kontak</label>
          <input type="search" id="fwdSearch" class="input" placeholder="Cari nama kontak…" autocomplete="off" />
          <div class="chat-fwd-list" id="fwdList" role="group" aria-label="Pilih tujuan">
            ${list.map(c => `
              <label class="chat-fwd-item" data-name="${UI.esc(c.name.toLowerCase())}">
                <input type="checkbox" value="${UI.esc(c.id)}" />
                <span class="avatar" style="width:30px;height:30px;font-size:11px;">${AV(c)}</span>
                <span class="chat-fwd-name">${UI.esc(c.name)}<small>${UI.esc(c.role)}</small></span>
              </label>`).join('')}
            <div class="chat-empty" id="fwdEmpty" hidden>Tidak ada kontak yang cocok.</div>
          </div>
          <div class="chat-fwd-foot">
            <span class="muted small" id="fwdCount">Belum ada tujuan dipilih</span>
            <button type="button" class="btn btn-secondary" id="fwdCancel">Batal</button>
            <button type="button" class="btn btn-primary" id="fwdSend" disabled>Teruskan</button>
          </div>
        </div>`);
      const body = document.getElementById('modalBody');
      const q = body.querySelector('#fwdSearch');
      const sendBtn = body.querySelector('#fwdSend');
      const picked = () => [...body.querySelectorAll('#fwdList input:checked')].map(i => i.value);
      const sync = () => {
        const n = picked().length;
        sendBtn.disabled = n === 0;
        body.querySelector('#fwdCount').textContent = n ? n + ' tujuan dipilih' : 'Belum ada tujuan dipilih';
      };
      body.querySelector('#fwdList').addEventListener('change', sync);
      q.addEventListener('input', () => {
        const v = q.value.trim().toLowerCase();
        let shown = 0;
        body.querySelectorAll('.chat-fwd-item').forEach(el => {
          const hit = !v || el.dataset.name.includes(v);
          el.hidden = !hit;
          if (hit) shown++;
        });
        body.querySelector('#fwdEmpty').hidden = shown > 0;
      });
      body.querySelector('#fwdCancel').addEventListener('click', () => UI.modal.close());
      sendBtn.addEventListener('click', () => {
        const ids = picked();
        let ok = 0;
        ids.forEach(rid => { if (DB.addMessage({ senderId: user.id, receiverId: rid, text: m.text }, { forwardedFrom: origin })) ok++; });
        UI.modal.close();
        UI.toast(ok ? `Pesan diteruskan ke ${ok} kontak.` : 'Pesan gagal diteruskan.', ok ? 'success' : 'error');
        if (ids.includes(activeChatUserId)) refreshMessages(true);
        refreshPreviews();
      });
    }

    /* ---------- Menu konteks ---------- */
    function closeMenu() {
      const old = document.getElementById('chatMenu');
      if (old) old.remove();
    }
    function openMenu(m, x, y, anchorEl) {
      closeMenu();
      if (!m) return;
      const mine = m.senderId === user.id;
      const items = m.deleted ? [] : [
        ['reply', ICON.reply, 'Balas'], ['forward', ICON.forward, 'Teruskan'], ['copy', ICON.copy, 'Salin teks']
      ];
      if (mine && !m.deleted) items.push(['delete', ICON.trash, 'Hapus pesan']);
      if (!items.length) return;
      const menu = document.createElement('div');
      menu.id = 'chatMenu';
      menu.className = 'chat-menu';
      menu.setAttribute('role', 'menu');
      menu.innerHTML = items.map(([a, ic, label]) =>
        `<button type="button" role="menuitem" class="chat-menu-item${a === 'delete' ? ' is-danger' : ''}" data-menu="${a}">${ic}<span>${label}</span></button>`).join('');
      document.body.appendChild(menu);
      const w = menu.offsetWidth, h = menu.offsetHeight;
      const vw = global.innerWidth, vh = global.innerHeight;
      menu.style.left = Math.max(8, Math.min(x, vw - w - 8)) + 'px';
      menu.style.top = Math.max(8, Math.min(y, vh - h - 8)) + 'px';
      const btns = [...menu.querySelectorAll('button')];
      btns[0].focus();
      const done = () => { closeMenu(); document.removeEventListener('pointerdown', outside, true); if (anchorEl && anchorEl.isConnected) anchorEl.focus({ preventScroll: true }); };
      const outside = (e) => { if (!menu.contains(e.target)) { closeMenu(); document.removeEventListener('pointerdown', outside, true); } };
      setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
      menu.addEventListener('keydown', (e) => {
        const i = btns.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
        else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); done(); }
      });
      menu.addEventListener('click', (e) => {
        const b = e.target.closest('[data-menu]');
        if (!b) return;
        const act = b.dataset.menu;
        done();
        runAction(act, m);
      });
    }
    function runAction(act, m) {
      if (act === 'reply') setReply(m);
      else if (act === 'forward') openForward(m);
      else if (act === 'copy') copyMsg(m);
      else if (act === 'delete') deleteMsg(m);
    }

    /* ---------- Delegasi peristiwa (daftar pesan diganti utuh saat sinkron) ---------- */
    function bindMessageEvents(box) {
      box.addEventListener('click', (e) => {
        const q = e.target.closest('.chat-quote');
        if (q) { jumpTo(q.dataset.jump); return; }
        const act = e.target.closest('.chat-act');
        if (act) {
          const m = findMsg(act.closest('.chat-row').dataset.mid);
          if (act.dataset.act === 'menu') {
            const r = act.getBoundingClientRect();
            openMenu(m, r.left, r.bottom + 4, act);
          } else runAction(act.dataset.act, m);
        }
      });
      box.addEventListener('contextmenu', (e) => {
        const b = e.target.closest('.chat-bubble');
        if (!b || e.target.closest('a')) return;
        e.preventDefault();
        openMenu(findMsg(b.dataset.mid), e.clientX, e.clientY, b);
      });
      box.addEventListener('keydown', (e) => {
        const b = e.target.closest && e.target.closest('.chat-bubble');
        if (!b || e.target !== b) return;
        if (e.key === 'Enter' || e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault();
          const r = b.getBoundingClientRect();
          openMenu(findMsg(b.dataset.mid), r.left + 12, r.bottom + 4, b);
        }
      });

      /* Geser kanan untuk membalas (Pointer Events). touch-action: pan-y pada
       * gelembung membuat gulir vertikal tetap milik peramban; geseran baru
       * "dikunci" sebagai balasan bila gerak horizontal dominan setelah 8px. */
      const THRESH = 64, MAX = 96, LOCK = 8;
      let g = null;
      let suppressClickUntil = 0;
      box.addEventListener('click', (e) => {
        if (Date.now() < suppressClickUntil) { e.preventDefault(); e.stopPropagation(); }
      }, true);
      const reset = (row, bubble) => {
        if (!row) return;
        bubble.style.transition = reducedMotion() ? 'none' : '';
        bubble.style.transform = '';
        row.style.removeProperty('--swipe');
        row.classList.remove('is-swiping', 'is-armed');
      };
      box.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const bubble = e.target.closest('.chat-bubble');
        if (!bubble || bubble.classList.contains('is-deleted')) return;
        g = { id: e.pointerId, x: e.clientX, y: e.clientY, bubble, row: bubble.closest('.chat-row'), mode: null, dx: 0, armed: false,
              timer: e.pointerType !== 'mouse' ? setTimeout(() => {   // tekan lama (ponsel) = menu
                if (g && !g.mode) {
                  g.mode = 'menu';
                  if (navigator.vibrate) try { navigator.vibrate(12); } catch (err) { /* abaikan */ }
                  openMenu(findMsg(bubble.dataset.mid), g.x, g.y, bubble);
                }
              }, 500) : 0 };
      });
      box.addEventListener('pointermove', (e) => {
        if (!g || e.pointerId !== g.id || g.mode === 'menu' || g.mode === 'scroll') return;
        const dx = e.clientX - g.x, dy = e.clientY - g.y;
        if (!g.mode) {
          if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return;
          clearTimeout(g.timer);
          if (dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.3) {
            g.mode = 'swipe';
            g.row.classList.add('is-swiping');
            try { g.bubble.setPointerCapture(e.pointerId); } catch (err) { /* abaikan */ }
          } else { g.mode = 'scroll'; return; }
        }
        g.dx = Math.max(0, Math.min(MAX, dx));
        const pull = g.dx < THRESH ? g.dx : THRESH + (g.dx - THRESH) * 0.35;   // terasa "tertahan" setelah ambang
        g.bubble.style.transition = 'none';
        g.bubble.style.transform = `translateX(${pull}px)`;
        g.row.style.setProperty('--swipe', Math.min(1, g.dx / THRESH).toFixed(3));
        const armed = g.dx >= THRESH;
        if (armed !== g.armed) {
          g.armed = armed;
          g.row.classList.toggle('is-armed', armed);
          if (armed && navigator.vibrate) try { navigator.vibrate(10); } catch (err) { /* abaikan */ }
        }
      });
      const end = (e) => {
        if (!g || e.pointerId !== g.id) return;
        clearTimeout(g.timer);
        const s = g;
        g = null;
        if (s.mode === 'menu') suppressClickUntil = Date.now() + 400;
        if (s.mode !== 'swipe') return;
        suppressClickUntil = Date.now() + 400;   // geser di atas kutipan/tautan tidak ikut "mengklik"
        reset(s.row, s.bubble);
        if (s.armed && e.type === 'pointerup') setReply(findMsg(s.bubble.dataset.mid));
      };
      box.addEventListener('pointerup', end);
      box.addEventListener('pointercancel', end);
      // Klik setelah geser tidak boleh memicu aksi lain
      box.addEventListener('scroll', () => { if (g && !g.mode) { clearTimeout(g.timer); g.mode = 'scroll'; } }, { passive: true });
    }

    function refreshPreviews() {
      container.querySelectorAll('.chat-contact[data-uid]').forEach(el => {
        const last = getLastMessage(user.id, el.dataset.uid);
        const prev = el.querySelector('.muted.small');
        if (prev) prev.innerHTML = last ? UI.esc(previewText(last, 30)) : '<i>Belum ada pesan</i>';
      });
    }
    function refreshMessages(toBottom) {
      const box = document.getElementById('chatMessages');
      if (!activeChatUserId || !box) return;
      const nearBottom = toBottom || box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      box.innerHTML = messagesHtml(DB.getConversation(user.id, activeChatUserId));
      if (nearBottom) box.scrollTop = box.scrollHeight;
      // Pesan yang sedang dibalas dihapus di perangkat lain → batalkan balasan
      if (replyTarget) {
        const cur = findMsg(replyTarget.id);
        if (!cur || cur.deleted) setReply(null);
      }
    }

    /* Mode server: pesan dari perangkat lain langsung tampil tanpa mengganggu
     * kotak ketik (hanya daftar pesan & pratinjau kontak yang diperbarui). */
    if (global.__chatLive) global.removeEventListener('lms:remote-change', global.__chatLive);
    global.__chatLive = (e) => {
      const keys = (e && e.detail && e.detail.keys) || [];
      if (!keys.includes('lms_messages')) return;
      if (!document.getElementById('chatLayout')) {
        global.removeEventListener('lms:remote-change', global.__chatLive);
        global.__chatLive = null;
        closeMenu();
        return;
      }
      refreshPreviews();
      refreshMessages(false);
    };
    global.addEventListener('lms:remote-change', global.__chatLive);
  }

  /* ===== AI Tools (Siswa Panel) ===== */
  function renderAiTools(container, user) {
    const enrolled = DB.getEnrollmentsByStudent(user.id);
    const courses = enrolled.map(e => DB.getCourse(e.courseId)).filter(Boolean);
    const attempts = DB.getCbtAttemptsByStudent(user.id).filter(a => a.submittedAt);
    const avgScore = attempts.length ? Math.round(attempts.reduce((s, a) => s + (a.score || 0), 0) / attempts.length) : null;

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-primary" style="cursor:pointer;" id="aiStudyPlanner">
          <div class="label">AI Study Planner</div>
          <div class="value" style="font-size:20px;">📅</div>
          <div class="sub">Rencana belajar personal</div>
        </div>
        <div class="stat-card accent-success" style="cursor:pointer;" id="aiGuru">
          <div class="label">AI Tutor</div>
          <div class="value" style="font-size:20px;">🧠</div>
          <div class="sub">Tanya materi kapan saja</div>
        </div>
        <div class="stat-card accent-warning" style="cursor:pointer;" id="aiRekomendasi">
          <div class="label">AI Rekomendasi Materi</div>
          <div class="value" style="font-size:20px;">📚</div>
          <div class="sub">Materi sesuai kelemahanmu</div>
        </div>
        <div class="stat-card accent-danger" style="cursor:pointer;" id="aiPtn">
          <div class="label">PTN Predictor</div>
          <div class="value" style="font-size:20px;">🎯</div>
          <div class="sub">Prediksi peluang PTN</div>
        </div>
      </div>
      <div id="aiContent"></div>
    `;

    document.getElementById('aiStudyPlanner').addEventListener('click', () => showStudyPlanner(user, courses));
    document.getElementById('aiGuru').addEventListener('click', () => showAiGuru(user));
    document.getElementById('aiRekomendasi').addEventListener('click', () => showAiRekomendasi(user, attempts));
    document.getElementById('aiPtn').addEventListener('click', () => showPtnPredictor(user, avgScore));

    /**
     * Study Planner — disusun dari JADWAL KELAS yang sebenarnya (hari & jam
     * asli tiap kelas) ditambah prioritas subtest terlemah dari hasil CBT.
     * Hari tanpa kelas diisi belajar mandiri pada subtest yang paling lemah.
     */
    function showStudyPlanner(user, courses) {
      const box = document.getElementById('aiContent');
      const days = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
      const stats = DB.studentSubtestStats(user.id);
      const weak = stats.filter(s => s.avg != null);
      const tz = UI.getTimezone();

      // Jadwal nyata: hari -> daftar kelas yang benar-benar terjadwal.
      const byDay = {};
      days.forEach(d => { byDay[d] = []; });
      courses.forEach(c => {
        const sc = c.schedule || {};
        (sc.days || []).forEach(d => {
          if (!byDay[d]) byDay[d] = [];
          byDay[d].push({
            title: DB.courseTitle(c),
            subtest: c.subtest || c.category || '-',
            time: sc.time ? `${sc.time}–${DB.planEndFor(sc.time)}` : 'jam belum diatur',
            tutor: DB.courseTeachers(c).map(t => t.name).join(' & ') || '-'
          });
        });
      });

      const rows = days.map((d, i) => {
        const cls = byDay[d] || [];
        if (cls.length) {
          return {
            day: d, kind: 'Kelas',
            detail: cls.map(x => `${UI.esc(x.time)} ${tz} — ${UI.esc(x.title)}`).join('<br>'),
            focus: 'Hadir kelas + kerjakan tugasnya'
          };
        }
        const target = weak.length ? weak[i % weak.length] : null;
        return {
          day: d, kind: 'Belajar mandiri',
          detail: target
            ? `${target.icon} ${UI.esc(target.short)} <span class="muted">(rata-rata ${target.avg})</span>`
            : '<span class="muted">Review umum — belum ada data CBT</span>',
          focus: target ? (target.avg < 60 ? 'Perkuat konsep dasar' : 'Latihan soal bertimer') : 'Latihan soal campuran'
        };
      });

      box.innerHTML = `
        <div class="card">
          <div class="card-header">${UI.secHead('📅', 'Rencana Belajar Mingguan', 'Disusun dari jadwal kelasmu yang sebenarnya')}</div>
          ${courses.length === 0 ? '<div class="alert alert-warning">Kamu belum tergabung di kelas mana pun, jadi rencana ini hanya berisi belajar mandiri.</div>' : ''}
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Hari</th><th>Agenda</th><th>Rincian</th><th>Fokus</th></tr></thead>
            <tbody>${rows.map(p => `<tr>
              <td><strong>${p.day}</strong></td>
              <td><span class="badge ${p.kind === 'Kelas' ? 'badge-success' : 'badge-gray'}">${p.kind}</span></td>
              <td class="small">${p.detail}</td>
              <td class="muted small">${UI.esc(p.focus)}</td>
            </tr>`).join('')}</tbody>
          </table></div>
          ${AI.noticeHtml(user)}
          ${AI.ready() ? `<div class="flex-gap mt-2">
            <button class="btn btn-primary btn-sm" id="aiPlanNarrate">🤖 Minta AI Merapikan Rencana Ini</button>
          </div><div id="aiPlanOut" style="margin-top:10px;"></div>` : ''}
        </div>`;

      const btn = document.getElementById('aiPlanNarrate');
      if (btn) btn.addEventListener('click', async () => {
        const out = document.getElementById('aiPlanOut');
        btn.disabled = true;
        out.innerHTML = AI.loadingHtml('AI menyusun rencana belajar…');
        const jadwal = days.map(d => {
          const cls = (byDay[d] || []);
          return `${d}: ` + (cls.length ? cls.map(x => `${x.title} (${x.time})`).join(', ') : 'kosong');
        }).join('; ');
        try {
          const ans = await AI.ask(
            `Susun rencana belajar mingguan untuk mentee UTBK bernama ${user.name} dalam Bahasa Indonesia. ` +
            `Jadwal kelas yang sudah pasti: ${jadwal}. ` +
            (weak.length
              ? `Rata-rata skor per subtest: ${weak.map(w => `${w.short} ${w.avg}`).join(', ')}. `
              : 'Belum ada data skor CBT. ') +
            'Isi hari yang kosong dengan belajar mandiri pada subtest terlemah. ' +
            'Jangan mengubah jadwal kelas yang sudah pasti dan jangan mengarang kelas baru. ' +
            'Tampilkan sebagai daftar per hari, maksimal 250 kata.',
            { temperature: 0.5, maxTokens: 900 });
          out.innerHTML = `<div class="alert alert-info"><div class="ai-answer">${AI.renderMarkdown(ans)}</div></div>`;
        } catch (e) {
          out.innerHTML = AI.errorHtml(e);
        } finally {
          btn.disabled = false;
        }
      });
    }

    /**
     * AI Guru — percakapan sungguhan dengan AI (penyedia sesuai pengaturan admin).
     * Konteks siswa (kelas yang diikuti + subtest terlemah) dikirim sebagai
     * systemInstruction agar jawaban relevan dengan kondisi belajarnya.
     */
    function showAiGuru(user) {
      const box = document.getElementById('aiContent');
      const stats = DB.studentSubtestStats(user.id);
      const weak = stats.filter(s => s.avg != null).slice(0, 3);
      box.innerHTML = '<div class="card aic-card" id="aiGuruChat"></div>';
      // Percakapan tersimpan (7 hari) & tersinkron; konteks siswa dibaca ulang setiap pertanyaan.
      AIChat.mount(document.getElementById('aiGuruChat'), user, {
        kind: 'tutor', title: 'AI Tutor — Asisten Belajar', icon: '🧠', temperature: 0.6, maxTokens: 1600,
        placeholder: 'Tanyakan materi, contoh soal, atau strategi UTBK…',
        intro: `Halo ${UI.esc(String(user.name || '').split(' ')[0])}! Saya AI Tutor. Tanyakan materi apa saja —
          konsep, contoh soal, atau strategi UTBK. ${weak.length
            ? `Dari hasil CBT-mu, subtest yang paling perlu dikuatkan saat ini adalah <strong>${UI.esc(weak[0].short)}</strong> (rata-rata ${weak[0].avg}).`
            : 'Kerjakan beberapa CBT dulu agar saya bisa memberi saran yang lebih terarah.'}`,
        suggestions: [
          weak.length ? `Jelaskan strategi mengerjakan soal ${weak[0].short} dengan cepat.` : 'Bagaimana cara memulai persiapan UTBK dari nol?',
          'Buatkan jadwal belajar 7 hari berdasarkan kelemahanku.',
          'Beri 3 soal latihan Penalaran Umum beserta pembahasannya.'
        ],
        context: () => AIContext.forStudent(user)
      });
    }

    /**
     * Rekomendasi materi — SELURUH angka berasal dari hasil CBT nyata
     * (DB.studentSubtestStats). Materi/modul yang disarankan diambil dari
     * konten asli kelas yang diikuti siswa, bukan daftar karangan.
     */
    function showAiRekomendasi(user, attempts) {
      const box = document.getElementById('aiContent');
      const stats = DB.studentSubtestStats(user.id);
      const done = stats.filter(s => s.avg != null);

      // Materi & modul nyata pada kelas siswa, dikelompokkan per subtest.
      const contentBySubtest = {};
      courses.forEach(c => {
        const key = c.subtest || c.category || 'Lainnya';
        if (!contentBySubtest[key]) contentBySubtest[key] = [];
        // Hanya konten yang memang terlihat siswa (aktif, sudah dirilis untuk angkatannya)
        DB.studentContent('material', user.id, c.id).forEach(m => contentBySubtest[key].push({ kind: 'Materi', title: m.title }));
        DB.studentContent('module', user.id, c.id).forEach(m => contentBySubtest[key].push({ kind: 'Modul', title: m.title }));
      });

      const priorityOf = (avg) => (avg < 55 ? 'Tinggi' : (avg < 75 ? 'Sedang' : 'Rendah'));
      const adviceOf = (s) => {
        const acc = s.total ? Math.round((s.correct / s.total) * 100) : null;
        if (s.avg < 55) return 'Perlu penguatan konsep dasar sebelum menambah kecepatan.';
        if (s.avg < 75) return acc != null && acc < 70 ? 'Perbaiki ketelitian membaca soal.' : 'Tingkatkan kecepatan & akurasi lewat latihan bertimer.';
        return 'Pertahankan dengan latihan soal tingkat sulit.';
      };

      box.innerHTML = `
        <div class="card">
          <div class="card-header">${UI.secHead('📚', 'AI Rekomendasi Materi', 'Prioritas belajar dari hasil CBT-mu yang sebenarnya')}</div>
          ${done.length === 0 ? `
            <div class="empty"><div class="empty-icon">📊</div>
              Belum ada hasil CBT yang bisa dianalisis. Kerjakan minimal satu ujian pada menu
              <strong>CBT/Ujian</strong>, lalu buka halaman ini kembali.
            </div>` : `
            <p class="muted small">Dihitung dari ${done.reduce((n, s) => n + s.attempts, 0)} bagian ujian yang sudah kamu kumpulkan. Subtest terlemah ditampilkan lebih dulu.</p>
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Subtest</th><th>Rata-rata</th><th>Benar</th><th>Prioritas</th><th>Rekomendasi</th><th>Materi di kelasmu</th></tr></thead>
              <tbody>${done.map(s => {
                const pr = priorityOf(s.avg);
                const items = (contentBySubtest[s.subtest] || []).slice(0, 3);
                return `<tr>
                  <td><strong>${s.icon} ${UI.esc(s.short)}</strong></td>
                  <td><span style="color:${s.avg < 60 ? 'var(--danger)' : (s.avg < 75 ? 'var(--warning)' : 'var(--success)')};font-weight:700;">${s.avg}</span>/100</td>
                  <td class="small">${s.correct}/${s.total || '-'}</td>
                  <td><span class="badge ${pr === 'Tinggi' ? 'badge-warning' : (pr === 'Sedang' ? 'badge-info' : 'badge-gray')}">${pr}</span></td>
                  <td class="muted small">${UI.esc(adviceOf(s))}</td>
                  <td class="small">${items.length
                    ? items.map(i => `<div>${UI.esc(i.kind)}: ${UI.esc(i.title)}</div>`).join('')
                    : '<span class="muted">Belum ada materi</span>'}</td>
                </tr>`;
              }).join('')}</tbody>
            </table></div>
            ${AI.noticeHtml(user)}
            ${AI.ready() ? `<div class="flex-gap mt-2">
              <button class="btn btn-primary btn-sm" id="aiRecNarrate">🤖 Minta Rencana Belajar dari AI</button>
            </div><div id="aiRecOut" style="margin-top:10px;"></div>` : ''}
          `}
        </div>`;

      const btn = document.getElementById('aiRecNarrate');
      if (btn) btn.addEventListener('click', async () => {
        const out = document.getElementById('aiRecOut');
        btn.disabled = true;
        out.innerHTML = AI.loadingHtml('AI menyusun rencana belajar…');
        const facts = done.map(s => `${s.short}: rata-rata ${s.avg}/100, benar ${s.correct} dari ${s.total}`).join('; ');
        const materi = Object.keys(contentBySubtest)
          .map(k => `${k}: ${(contentBySubtest[k] || []).map(i => i.title).slice(0, 5).join(', ') || '-'}`).join(' | ');
        try {
          const ans = await AI.ask(
            `Mentee bernama ${user.name} mengikuti bimbel UTBK. Data nyata hasil CBT: ${facts}. ` +
            `Materi yang tersedia di kelasnya: ${materi}. ` +
            (user.targetUniv ? `Target: ${user.targetUniv} ${user.targetMajor || ''}. ` : '') +
            'Susun rencana belajar 2 minggu yang konkret dalam Bahasa Indonesia. ' +
            'Fokuskan pada subtest dengan rata-rata terendah, sebutkan materi yang tersedia di kelasnya bila relevan. ' +
            'Jangan mengarang angka lain di luar data yang saya berikan. Maksimal 300 kata.',
            { temperature: 0.5, maxTokens: 900 });
          out.innerHTML = `<div class="alert alert-info"><div class="ai-answer">${AI.renderMarkdown(ans)}</div></div>`;
        } catch (e) {
          out.innerHTML = AI.errorHtml(e);
        } finally {
          btn.disabled = false;
        }
      });
    }

    /**
     * PTN Predictor — memakai skor CBT nyata dan target siswa sendiri.
     * Tidak lagi mengarang daftar universitas maupun persentase acak: yang
     * ditampilkan adalah kesiapan terukur per subtest plus ulasan AI.
     */
    function showPtnPredictor(user, avgScore) {
      const box = document.getElementById('aiContent');
      const stats = DB.studentSubtestStats(user.id);
      const done = stats.filter(s => s.avg != null);
      const overall = done.length
        ? Math.round(done.reduce((n, s) => n + s.avg, 0) / done.length)
        : null;

      const readiness = (v) => v >= 80 ? { label: 'Sangat Siap', cls: 'badge-success' }
        : v >= 70 ? { label: 'Siap', cls: 'badge-success' }
        : v >= 55 ? { label: 'Perlu Usaha', cls: 'badge-warning' }
        : { label: 'Belum Siap', cls: 'badge-gray' };

      const hasTarget = !!(user.targetUniv || user.targetMajor);

      box.innerHTML = `
        <div class="card">
          <div class="card-header">${UI.secHead('🎯', 'Kesiapan PTN', 'Dihitung dari skor CBT-mu yang sebenarnya')}</div>
          ${!hasTarget ? `<div class="alert alert-warning">
            Target kampus belum diisi. Lengkapi <strong>Universitas & Jurusan Impian</strong> di menu Profil
            agar analisis ini menyebut targetmu sendiri.</div>` : ''}
          ${overall == null ? `
            <div class="empty"><div class="empty-icon">📊</div>
              Belum ada hasil CBT. Kerjakan minimal satu ujian agar kesiapanmu bisa diukur.
            </div>` : `
            <div class="stats-grid" style="margin-bottom:12px;">
              <div class="stat-card accent-primary">
                <div class="label">Rata-rata Skor CBT</div>
                <div class="value">${overall}</div><div class="sub">dari 100</div>
              </div>
              <div class="stat-card accent-success">
                <div class="label">Status Kesiapan</div>
                <div class="value" style="font-size:18px;">${readiness(overall).label}</div>
                <div class="sub">${hasTarget ? UI.esc(user.targetUniv || '-') : 'target belum diisi'}</div>
              </div>
              <div class="stat-card accent-warning">
                <div class="label">Subtest Terlemah</div>
                <div class="value" style="font-size:18px;">${UI.esc(done[0].short)}</div>
                <div class="sub">rata-rata ${done[0].avg}</div>
              </div>
              <div class="stat-card accent-danger">
                <div class="label">Bagian Ujian Dinilai</div>
                <div class="value">${done.reduce((n, s) => n + s.attempts, 0)}</div>
                <div class="sub">sumber perhitungan</div>
              </div>
            </div>
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Subtest</th><th>Rata-rata</th><th>Benar</th><th>Kesiapan</th></tr></thead>
              <tbody>${done.map(s => {
                const r = readiness(s.avg);
                return `<tr>
                  <td><strong>${s.icon} ${UI.esc(s.short)}</strong></td>
                  <td><strong>${s.avg}</strong>/100</td>
                  <td class="small">${s.correct}/${s.total || '-'}</td>
                  <td><span class="badge ${r.cls}">${r.label}</span></td>
                </tr>`;
              }).join('')}</tbody>
            </table></div>
            <p class="muted small mt-2">
              <strong>Catatan:</strong> angka di atas adalah kesiapan berdasarkan skor CBT di aplikasi ini,
              bukan prediksi resmi kelulusan SNBT. Persaingan sebenarnya bergantung pada daya tampung
              dan nilai peserta lain yang tidak tersedia di sistem ini.
            </p>
            ${AI.noticeHtml(user)}
            ${AI.ready() ? `<div class="flex-gap mt-2">
              <button class="btn btn-primary btn-sm" id="aiPtnNarrate">🤖 Minta Ulasan & Strategi dari AI</button>
            </div><div id="aiPtnOut" style="margin-top:10px;"></div>` : ''}
          `}
        </div>`;

      const btn = document.getElementById('aiPtnNarrate');
      if (btn) btn.addEventListener('click', async () => {
        const out = document.getElementById('aiPtnOut');
        btn.disabled = true;
        out.innerHTML = AI.loadingHtml('AI menganalisis kesiapanmu…');
        try {
          const ans = await AI.ask(
            `Mentee ${user.name} menyiapkan UTBK/SNBT. ` +
            (hasTarget ? `Target: ${user.targetUniv || '-'} jurusan ${user.targetMajor || '-'}. ` : 'Target kampus belum ditentukan. ') +
            `Rata-rata skor CBT keseluruhan ${overall}/100. Rincian per subtest: ` +
            done.map(s => `${s.short} ${s.avg}`).join(', ') + '. ' +
            'Berikan ulasan kesiapan yang jujur dan strategi perbaikan dalam Bahasa Indonesia. ' +
            'Jangan menyebut persentase peluang lulus karena data daya tampung tidak tersedia. ' +
            'Jangan mengarang angka di luar yang saya berikan. Maksimal 250 kata.',
            { temperature: 0.5, maxTokens: 800 });
          out.innerHTML = `<div class="alert alert-info"><div class="ai-answer">${AI.renderMarkdown(ans)}</div></div>`;
        } catch (e) {
          out.innerHTML = AI.errorHtml(e);
        } finally {
          btn.disabled = false;
        }
      });
    }
  }

  /* ===== AI Analytics (Admin/Guru Panel) ===== */
  function renderAiAnalytics(container, user) {
    let students = DB.getUsers().filter(u => u.role === 'siswa' && (u.status || 'Aktif') === 'Aktif');
    // Tutor hanya boleh melihat siswa pada kelas yang dia ampu, bukan seluruh
    // siswa lembaga. Admin melihat semuanya.
    const myCourses = user.role === 'guru' ? DB.getCoursesByTeacher(user.id) : [];
    if (user.role === 'guru') {
      const mine = new Set();
      myCourses.forEach(c => DB.getEnrollmentsByCourse(c.id).forEach(e => mine.add(e.studentId)));
      students = students.filter(s => mine.has(s.id));
    }
    const allSubs = DB.getSubmissions();
    const allAttempts = DB.getCbtAttempts();
    const threshold = DB.attendanceThreshold();
    const since30 = DB.ymdOf(Date.now() - 30 * 86400000);
    // Presensi mentee (tutor: hanya kelas yang diampu), tanpa sesi yang dibatalkan.
    const scopeIds = user.role === 'guru' ? new Set(myCourses.map(c => c.id)) : null;
    const planOn = new Set(), planOff = new Set();
    DB.getClassPlans().forEach(p => (p.status === 'cancelled' ? planOff : planOn).add(p.courseId + '|' + p.date));
    const attBy = new Map();
    DB.getAttendance().forEach(a => {
      if (a.role !== 'siswa' || (scopeIds && !scopeIds.has(a.courseId))) return;
      const k = a.courseId + '|' + a.date;
      if (planOff.has(k) && !planOn.has(k)) return;
      if (!attBy.has(a.userId)) attBy.set(a.userId, []);
      attBy.get(a.userId).push(a);
    });
    const limits = new Map(DB.absenceReport(null, students.map(s => s.id)).map(r => [r.studentId, r]));

    // Analisis dini dari data nyata: jumlah ketidakhadiran (bukan sekadar persentase),
    // batas ketidakhadiran status pendidikan, keterlambatan tugas, tren skor.
    const warnings = students.map(s => {
      const att = (attBy.get(s.id) || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const alfa = att.filter(a => a.status === 'alfa');
      const alfaAll = alfa.length;
      const alfa30 = alfa.filter(a => a.date >= since30).length;
      const excused = att.filter(a => a.status === 'izin' || a.status === 'sakit').length;
      let streak = 0;
      for (let i = att.length - 1; i >= 0 && att[i].status === 'alfa'; i--) streak++;
      const sum = DB.attendanceSummary(att);
      const lim = limits.get(s.id);

      const subs = allSubs.filter(sub => sub.studentId === s.id);
      const lateSubs = subs.filter(sub => {
        const asg = DB.getAssignment(sub.assignmentId);
        return asg && sub.submittedAt > asg.dueDate;
      }).length;

      const attempts = allAttempts.filter(a => a.studentId === s.id && a.submittedAt);
      const avgScore = attempts.length ? Math.round(attempts.reduce((n, a) => n + (a.score || 0), 0) / attempts.length) : null;
      const recentScores = attempts.slice(-3).map(a => a.score || 0);
      const declining = recentScores.length >= 2 && recentScores[recentScores.length - 1] < recentScores[0] - 15;

      let risk = 0;
      const reasons = [];
      if (alfaAll >= 5) { risk += 5; reasons.push(`Alfa ${alfaAll}×`); }
      else if (alfa30 >= 3) { risk += 4; reasons.push(`Alfa ${alfa30}× dalam 30 hari`); }
      else if (alfaAll >= 3) { risk += 3; reasons.push(`Alfa ${alfaAll}×`); }
      else if (alfaAll >= 1) { risk += 1; reasons.push(`Alfa ${alfaAll}×`); }
      if (streak >= 2) { risk += 2; reasons.push(`${streak}× berturut-turut tidak hadir`); }
      if (lim && lim.exceeded) { risk += 5; reasons.push(`Melewati batas ketidakhadiran (${lim.count}/${lim.limit})`); }
      else if (lim && lim.atLimit) { risk += 2; reasons.push(`Tepat di batas ketidakhadiran (${lim.count}/${lim.limit})`); }
      if (sum.sessions >= 3 && sum.pct < threshold) { risk += 2; reasons.push(`Kehadiran ${sum.pct}% < ${threshold}%`); }
      if (excused >= 4) { risk += 1; reasons.push(`Izin/sakit ${excused}×`); }
      if (lateSubs > 2) { risk += 2; reasons.push('Tugas sering telat'); }
      if (declining) { risk += 2; reasons.push('Nilai menurun'); }
      if (avgScore != null && avgScore < 40) { risk += 2; reasons.push('Skor rendah'); }
      if (att.length === 0 && subs.length === 0) { risk += 1; reasons.push('Belum ada aktivitas'); }

      let category = 'Normal';
      if (risk >= 5) category = 'Critical';
      else if (risk >= 3) category = 'Warning';
      else if (risk >= 1) category = 'Watch';

      return { student: s, alfaAll, alfa30, excused, streak, sum, lim, lateSubs, avgScore, declining, risk, reasons, category, att };
    });

    const critical = warnings.filter(w => w.category === 'Critical');
    const warning = warnings.filter(w => w.category === 'Warning');
    const watch = warnings.filter(w => w.category === 'Watch');
    const absentCount = warnings.filter(w => w.att.some(a => a.date >= since30 && (a.status === 'alfa' || a.status === 'izin' || a.status === 'sakit'))).length;

    // Tutor & jadwal kelas (War Jadwal): tutor aktif yang mengampu kelas tetapi tidak/jarang membuat jadwal.
    const plans = DB.getClassPlans();
    const in14 = DB.ymdOf(Date.now() + 14 * 86400000);
    const tutorRows = user.role !== 'admin' ? [] : DB.getUsers()
      .filter(u => u.role === 'guru' && (u.status || 'Aktif') === 'Aktif')
      .map(t => {
        const courses = DB.getCoursesByTeacher(t.id);
        const made = plans.filter(p => p.createdBy === t.id);
        const mine = plans.filter(p => p.status !== 'cancelled' && DB.planTeacherIds(p).includes(t.id));
        const upcoming = mine.filter(p => p.date >= UI.todayYMD() && p.date <= in14);
        const lastMade = made.reduce((m, p) => Math.max(m, Number(p.createdAt) || 0), 0);
        const state = !courses.length ? 'nocourse' : (!made.length ? 'never' : (!upcoming.length ? 'idle' : 'ok'));
        return { t, courses, made: made.length, assigned: mine.length, upcoming: upcoming.length, lastMade, state };
      });
    const tutorIssues = tutorRows.filter(r => r.state === 'never' || r.state === 'idle').length;

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-danger">
          <div class="label">Critical</div>
          <div class="value">${critical.length}</div>
          <div class="sub">Butuh intervensi segera</div>
        </div>
        <div class="stat-card accent-warning">
          <div class="label">Warning</div>
          <div class="value">${warning.length}</div>
          <div class="sub">Perlu perhatian</div>
        </div>
        <div class="stat-card accent-primary">
          <div class="label">Watch</div>
          <div class="value">${watch.length}</div>
          <div class="sub">Dalam pemantauan</div>
        </div>
        <div class="stat-card accent-success">
          <div class="label">Normal</div>
          <div class="value">${warnings.filter(w => w.category === 'Normal').length}</div>
          <div class="sub">Berjalan baik</div>
        </div>
      </div>

      ${user.role === 'guru' ? `<p class="muted small">Menampilkan ${students.length} mentee dari ${myCourses.length} kelas yang Anda ampu.</p>` : ''}
      ${AI.noticeHtml(user)}
      ${AI.ready() ? `<div class="flex-gap" style="margin-bottom:10px;">
        <button class="btn btn-primary btn-sm" id="aiAnalyticsNarrate">🤖 Minta Ringkasan & Saran Tindak Lanjut dari AI</button>
      </div><div id="aiAnalyticsAiOut" style="margin-bottom:10px;"></div>` : ''}

      <div class="subtabs">
        <button class="subtab-btn active" data-aitab="earlyWarning">Deteksi Dini Mentee</button>
        <button class="subtab-btn" data-aitab="absent">Mentee Tidak Hadir${absentCount ? ` <span class="tab-count">${absentCount}</span>` : ''}</button>
        ${user.role === 'admin' ? `<button class="subtab-btn" data-aitab="tutorPlan">Jadwal Tutor${tutorIssues ? ` <span class="tab-count">${tutorIssues}</span>` : ''}</button>` : ''}
        <button class="subtab-btn" data-aitab="fraud">Integritas Ujian</button>
      </div>
      <div id="aiAnalyticsBox"></div>
    `;

    const narrateBtn = document.getElementById('aiAnalyticsNarrate');
    if (narrateBtn) narrateBtn.addEventListener('click', async () => {
      const out = document.getElementById('aiAnalyticsAiOut');
      narrateBtn.disabled = true;
      out.innerHTML = AI.loadingHtml('AI merangkum kondisi mentee…');
      const facts = warnings
        .filter(w => w.category !== 'Normal')
        .slice(0, 20)
        .map(w => `${w.student.name}: kategori ${w.category}, alfa ${w.alfaAll}× (${w.alfa30}× dalam 30 hari), kehadiran ${w.sum.sessions ? w.sum.pct + '%' : 'belum ada data'}, tugas terlambat ${w.lateSubs}, rata-rata nilai ${w.avgScore == null ? 'belum ada' : w.avgScore}; indikasi: ${w.reasons.join(', ') || '-'}`)
        .join('; ');
      try {
        const ans = await AI.ask(
          'Kamu asisten analitik untuk bimbel UTBK. Berikut data nyata mentee yang perlu perhatian: ' +
          (facts || 'tidak ada mentee berkategori bermasalah') + '. ' +
          'Buat ringkasan singkat dan saran tindak lanjut yang konkret untuk ' +
          (user.role === 'guru' ? 'tutor kelas' : 'admin lembaga') + ' dalam Bahasa Indonesia. ' +
          'Kelompokkan berdasarkan prioritas. Jangan menambah nama atau angka yang tidak saya berikan. Maksimal 300 kata.',
          { temperature: 0.4, maxTokens: 900 });
        out.innerHTML = `<div class="alert alert-info"><div class="ai-answer">${AI.renderMarkdown(ans)}</div></div>`;
      } catch (e) {
        out.innerHTML = AI.errorHtml(e);
      } finally {
        narrateBtn.disabled = false;
      }
    });

    let currentTab = 'earlyWarning';
    let absentRange = '30';
    const renderTab = () => {
      const box = document.getElementById('aiAnalyticsBox');
      if (currentTab === 'earlyWarning') {
        const atRisk = warnings.filter(w => w.category !== 'Normal').sort((a, b) => b.risk - a.risk);
        const CAT = { Critical: 'badge-danger', Warning: 'badge-warning', Watch: 'badge-info' };
        box.innerHTML = `
          <div class="card">
            <div class="card-header"><h3>Deteksi Dini: Mentee Berisiko (${atRisk.length})</h3></div>
            <p class="muted small">Dihitung dari jumlah Alfa (3× = Warning, 3× dalam 30 hari atau 5× = lebih tinggi), ketidakhadiran berturut-turut,
              batas ketidakhadiran status pendidikan, kehadiran di bawah ${threshold}%, keterlambatan tugas, dan tren nilai. Sesi yang dibatalkan tidak dihitung.</p>
            ${atRisk.length === 0 ? '<div class="empty"><div class="empty-icon">✅</div>Semua mentee dalam kondisi baik!</div>' : `
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Mentee</th><th>Kategori</th><th>Alfa</th><th>Kehadiran</th><th>Batas Absen</th><th>Tugas Telat</th><th>Avg CBT</th><th>Indikasi</th></tr></thead>
              <tbody>${atRisk.map(w => `<tr>
                  <td><strong>${UI.esc(w.student.name)}</strong><div class="muted small">${UI.esc(w.student.kelas || '-')}</div></td>
                  <td><span class="badge ${CAT[w.category]}">${w.category}</span></td>
                  <td class="nowrap"><strong>${w.alfaAll}×</strong><div class="muted small">${w.alfa30}× / 30 hari</div></td>
                  <td>${w.sum.sessions ? `${w.sum.pct}%` : '<span class="muted small">-</span>'}</td>
                  <td>${AttendanceInsights.absencePillHtml(w.lim)}</td>
                  <td>${w.lateSubs}</td>
                  <td>${w.avgScore ?? '-'}${w.declining ? ' <span class="ai-trend-down" title="Tren nilai menurun">↓</span>' : ''}</td>
                  <td class="muted small">${UI.esc(w.reasons.join(', ') || '-')}</td>
                </tr>`).join('')}</tbody>
            </table></div>`}
          </div>`;
      } else if (currentTab === 'absent') {
        const RANGES = [['7', '7 hari terakhir'], ['30', '30 hari terakhir'], ['all', 'Sepanjang waktu']];
        const from = absentRange === 'all' ? '' : DB.ymdOf(Date.now() - Number(absentRange) * 86400000);
        const rows = warnings.map(w => {
          const miss = w.att.filter(a => (a.status === 'alfa' || a.status === 'izin' || a.status === 'sakit') && (!from || a.date >= from));
          const n = (k) => miss.filter(a => a.status === k).length;
          const last = miss[miss.length - 1] || null;
          return { w, miss, alfa: n('alfa'), izin: n('izin'), sakit: n('sakit'), last, courses: [...new Set(miss.map(a => a.courseId))] };
        }).filter(r => r.miss.length);
        box.innerHTML = `
          <div class="card">
            <div class="card-header">${UI.secHead('🚪', 'Mentee Tidak Hadir', `${rows.length} mentee tercatat tidak hadir${user.role === 'guru' ? ' di kelas Anda' : ''}`)}
              <select class="input" id="aiAbsentRange" aria-label="Rentang waktu" style="width:auto;">
                ${RANGES.map(([k, l]) => `<option value="${k}" ${k === absentRange ? 'selected' : ''}>${l}</option>`).join('')}
              </select></div>
            <div id="aiAbsentList"></div>
          </div>`;
        box.querySelector('#aiAbsentRange').addEventListener('change', (e) => { absentRange = e.target.value; renderTab(); });
        DataSearch.mount({
          container: box.querySelector('#aiAbsentList'),
          items: rows,
          placeholder: 'Cari nama mentee atau kelas…',
          fields: r => [r.w.student.name, r.w.student.username, r.w.student.kelas, ...r.courses.map(id => { const c = DB.getCourse(id); return c ? DB.courseTitle(c) : ''; })],
          filters: [{ key: 'kind', label: 'Semua jenis', get: r => ['alfa', 'izin', 'sakit'].filter(k => r[k] > 0),
            options: ['alfa', 'izin', 'sakit'].map(k => ({ value: k, label: DB.attStatusMeta(k).label })) }],
          sorts: [
            { key: 'alfa', label: 'Alfa terbanyak', cmp: (a, b) => (b.alfa - a.alfa) || (b.miss.length - a.miss.length) },
            { key: 'recent', label: 'Terakhir tidak hadir', cmp: (a, b) => String(b.last.date).localeCompare(String(a.last.date)) },
            { key: 'name', label: 'Nama A–Z', cmp: (a, b) => a.w.student.name.localeCompare(b.w.student.name) }
          ],
          pageSize: 20,
          empty: 'Tidak ada mentee yang tercatat tidak hadir pada rentang ini.',
          render: (list, ctx) => `<div class="table-wrap"><table class="table">
            <thead><tr><th>Mentee</th><th>Alfa</th><th>Izin</th><th>Sakit</th><th>Berturut-turut</th><th>Terakhir tidak hadir</th><th>Batas Absen</th></tr></thead>
            <tbody>${list.map(r => {
              const lc = DB.getCourse(r.last.courseId);
              return `<tr class="${r.alfa >= 3 || r.w.streak >= 2 ? 'ai-row-warn' : ''}">
                <td><strong>${ctx.highlight(r.w.student.name)}</strong><div class="muted small">${ctx.highlight(r.w.student.kelas || '-')}</div></td>
                <td><strong>${r.alfa}</strong></td><td>${r.izin}</td><td>${r.sakit}</td>
                <td>${r.w.streak >= 2 ? `<span class="badge badge-danger">${r.w.streak}× Alfa</span>` : '-'}</td>
                <td>${UI.esc(UI.fmtYMD(r.last.date))} · ${AttendanceInsights.statusBadge(r.last.status)}<div class="muted small">${UI.esc(lc ? DB.courseTitle(lc) : '-')}</div></td>
                <td>${AttendanceInsights.absencePillHtml(r.w.lim)}</td>
              </tr>`;
            }).join('')}</tbody></table></div>`
        });
      } else if (currentTab === 'tutorPlan') {
        const STATE = {
          never: ['badge-danger', 'Belum pernah membuat jadwal'],
          idle: ['badge-warning', 'Tidak ada jadwal 14 hari ke depan'],
          ok: ['badge-success', 'Aktif menjadwalkan'],
          nocourse: ['badge-gray', 'Belum mengampu kelas']
        };
        box.innerHTML = `
          <div class="card">
            <div class="card-header">${UI.secHead('🗓️', 'Tutor & Jadwal Kelas', `${tutorRows.filter(r => r.state === 'never').length} tutor belum pernah membuat jadwal • ${tutorRows.filter(r => r.state === 'idle').length} tanpa jadwal mendatang`)}</div>
            <p class="muted small">"Dibuat" = pertemuan yang dibuat tutor sendiri di Jadwal Kelas / War Jadwal. "Diampu" = pertemuan aktif yang mencantumkan tutor ini, termasuk yang dibuat admin.</p>
            <div id="aiTutorList"></div>
          </div>`;
        DataSearch.mount({
          container: box.querySelector('#aiTutorList'),
          items: tutorRows,
          placeholder: 'Cari nama tutor atau subtest…',
          fields: r => [r.t.name, r.t.username, DB.userSubjectsLabel(r.t), ...r.courses.map(c => DB.courseTitle(c))],
          filters: [{ key: 'state', label: 'Semua kondisi', get: r => r.state, options: Object.keys(STATE).map(k => ({ value: k, label: STATE[k][1] })) }],
          sorts: [
            { key: 'risk', label: 'Perlu perhatian dulu', cmp: (a, b) => (['never', 'idle', 'ok', 'nocourse'].indexOf(a.state) - ['never', 'idle', 'ok', 'nocourse'].indexOf(b.state)) || a.t.name.localeCompare(b.t.name) },
            { key: 'name', label: 'Nama A–Z', cmp: (a, b) => a.t.name.localeCompare(b.t.name) }
          ],
          pageSize: 20,
          empty: 'Belum ada tutor aktif.',
          render: (list, ctx) => `<div class="table-wrap"><table class="table">
            <thead><tr><th>Tutor</th><th>Kelas diampu</th><th>Jadwal dibuat</th><th>Jadwal diampu</th><th>14 hari ke depan</th><th>Terakhir membuat</th><th>Kondisi</th></tr></thead>
            <tbody>${list.map(r => `<tr class="${r.state === 'never' ? 'ai-row-warn' : ''}">
              <td><strong>${ctx.highlight(r.t.name)}</strong><div class="muted small">${ctx.highlight(DB.userSubjectsLabel(r.t) || '-')}</div></td>
              <td>${r.courses.length ? `${r.courses.length} kelas<div class="muted small">${ctx.highlight(r.courses.slice(0, 3).map(c => DB.courseTitle(c)).join(', '))}${r.courses.length > 3 ? ', …' : ''}</div>` : '<span class="muted small">-</span>'}</td>
              <td><strong>${r.made}</strong></td>
              <td>${r.assigned}</td>
              <td>${r.upcoming}</td>
              <td class="muted small">${r.lastMade ? UI.esc(UI.fmtDate(r.lastMade)) : '-'}</td>
              <td><span class="badge ${STATE[r.state][0]}">${STATE[r.state][1]}</span></td>
            </tr>`).join('')}</tbody></table></div>`
        });
      } else {
        /* Integritas ujian — HANYA dari kejadian yang benar-benar tercatat.
         * Versi sebelumnya menuduh siswa secara acak (Math.random) sehingga
         * bisa memfitnah siswa yang tidak melakukan pelanggaran. */
        const scope = user.role === 'guru'
          ? { courseIds: DB.getCoursesByTeacher(user.id).map(c => c.id) }
          : {};
        const fraudAlerts = DB.cbtIntegritySignals(scope);

        box.innerHTML = `
          <div class="card">
            <div class="card-header">${UI.secHead('🛡️', 'Integritas Ujian', 'Hanya menampilkan pelanggaran yang tercatat sistem')}</div>
            <p class="muted small">
              Sumber data: pelanggaran yang terekam saat ujian (pindah tab, keluar layar penuh, dan sejenisnya),
              durasi pengerjaan dibanding alokasi waktu, serta skor sempurna dengan waktu tidak wajar.
              Daftar ini <strong>bukan tuduhan</strong> — mohon diperiksa manual sebelum ditindaklanjuti.
            </p>
            ${fraudAlerts.length === 0 ? '<div class="empty"><div class="empty-icon">🛡️</div>Tidak ada pelanggaran atau anomali yang tercatat.</div>' : `
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Mentee</th><th>Ujian</th><th>Skor</th><th>Durasi</th><th>Pelanggaran</th><th>Tingkat</th><th>Temuan</th></tr></thead>
              <tbody>${fraudAlerts.map(f => `<tr>
                <td><strong>${UI.esc(f.student.name)}</strong></td>
                <td>${UI.esc(f.exam?.title || '-')}</td>
                <td>${f.score == null ? '-' : f.score}</td>
                <td class="small">${f.durationMinutes == null ? '-' : f.durationMinutes + ' mnt'}</td>
                <td>${f.violations}</td>
                <td><span class="badge ${f.severity === 'Tinggi' ? 'badge-warning' : (f.severity === 'Sedang' ? 'badge-info' : 'badge-gray')}">${f.severity}</span></td>
                <td class="muted small">${f.reasons.map(r => UI.esc(r)).join('<br>')}</td>
              </tr>`).join('')}</tbody>
            </table></div>`}
            <div class="alert alert-info mt-2">Sistem fraud detection berjalan otomatis pada setiap sesi ujian CBT. Hasil hanya bersifat indikasi dan memerlukan verifikasi manual.</div>
          </div>`;
      }
    };

    container.querySelectorAll('[data-aitab]').forEach(b => b.addEventListener('click', () => {
      container.querySelectorAll('[data-aitab]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      currentTab = b.dataset.aitab;
      renderTab();
    }));
    renderTab();
  }

  /* =======================================================================
   * PASSWORD KELAS
   * Admin dan guru pemilik kelas dapat mengatur password; siswa memasukkan
   * password tersebut saat bergabung sendiri lewat "Jelajah Kelas".
   * ===================================================================== */

  /** Form pengaturan password kelas (dipakai admin & guru). */
  function openCoursePasswordForm(courseId, onDone) {
    const course = DB.getCourse(courseId);
    if (!course) { UI.toast('Kelas tidak ditemukan.', 'error'); return; }
    const current = course.password || '';
    const body = `
      <div class="muted small mb-2">Kelas: <strong>${UI.esc(course.title)}</strong></div>
      <form id="coursePwForm" class="form">
        <div class="form-group">
          <label>Password Kelas</label>
          <input name="password" id="coursePwInput" value="${UI.esc(current)}" placeholder="mis. mat2026" autocomplete="off" />
          <p class="muted small" style="margin:6px 0 0;">Kosongkan untuk membuat kelas terbuka (tanpa password).</p>
        </div>
        <div class="alert alert-info">
          Password ini hanya diminta ketika <strong>mentee bergabung sendiri</strong> dari halaman Jelajah Kelas.
          Admin tetap dapat menambahkan mentee langsung tanpa password.
        </div>
        <div class="flex-gap" style="justify-content:space-between;">
          <button type="button" class="btn btn-secondary" id="genPwBtn">🎲 Buat Otomatis</button>
          <div class="flex-gap">
            ${current ? '<button type="button" class="btn btn-danger" id="clearPwBtn">Hapus Password</button>' : ''}
            <button type="submit" class="btn btn-primary">Simpan</button>
          </div>
        </div>
      </form>`;
    UI.modal.open('🔒 Password Kelas', body);

    document.getElementById('genPwBtn').addEventListener('click', () => {
      const slug = (course.title || 'kelas').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4) || 'kls';
      const input = document.getElementById('coursePwInput');
      input.value = slug + Math.floor(1000 + Math.random() * 9000);
      if (window.Effects) Effects.pop(input);
    });
    const clearBtn = document.getElementById('clearPwBtn');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      DB.updateCourse(courseId, { password: '' });
      UI.toast('Password dihapus. Kelas kini terbuka.', 'info');
      UI.modal.close();
      if (typeof onDone === 'function') onDone();
    });
    document.getElementById('coursePwForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const pw = (new FormData(e.target).get('password') || '').trim();
      DB.updateCourse(courseId, { password: pw });
      UI.toast(pw ? 'Password kelas disimpan. 🔒' : 'Kelas disetel terbuka tanpa password.');
      UI.modal.close();
      if (typeof onDone === 'function') onDone();
    });
  }

  /** Gerbang password saat siswa ingin bergabung ke kelas terkunci. */
  function openCoursePasswordGate(course, user, onSuccess) {
    // Kelas terbuka -> langsung lolos
    if (!DB.hasCoursePassword(course.id)) { onSuccess(); return; }
    const teacher = DB.getUser(course.teacherId);
    let attempts = 0;
    const body = `
      <div class="pw-gate">
        <span class="lock-ic">🔐</span>
        <h3 style="margin:0 0 4px;">${UI.esc(course.title)}</h3>
        <p class="muted small">Kelas ini dilindungi password. Mintalah password kepada
        <strong>${UI.esc(teacher ? teacher.name : 'tutor pengajar')}</strong> atau admin.</p>
      </div>
      <form id="gateForm" class="form mt-2">
        <div class="form-group">
          <label>Password Kelas</label>
          <input class="pw-input-big" type="password" name="pw" id="gatePw" autocomplete="off" required />
        </div>
        <div id="gateErr" class="alert alert-error hidden"></div>
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="gateCancel">Batal</button>
          <button type="submit" class="btn btn-primary">Buka & Gabung</button>
        </div>
      </form>`;
    UI.modal.open('Masuk Kelas Terkunci', body);
    document.getElementById('gateCancel').addEventListener('click', () => UI.modal.close());
    document.getElementById('gateForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const val = new FormData(e.target).get('pw');
      const err = document.getElementById('gateErr');
      if (DB.verifyCoursePassword(course.id, val)) {
        UI.modal.close();
        onSuccess();
        return;
      }
      attempts++;
      err.textContent = attempts >= 3
        ? 'Password masih salah. Hubungi tutor atau admin untuk mendapatkan password kelas.'
        : 'Password kelas salah. Coba lagi.';
      err.classList.remove('hidden');
      const input = document.getElementById('gatePw');
      input.value = '';
      input.focus();
      if (window.Effects) {
        Effects.shake(document.querySelector('#genericModal .modal-content'));
        Effects.pop(err);
      }
    });
  }

  /* =======================================================================
   * GAMIFIKASI: poin, level, papan peringkat, lencana
   * Semua dihitung dari data nyata (tugas, CBT, absensi) agar selalu sinkron.
   * ===================================================================== */
  function studentStats(studentId) {
    const subs = DB.getSubmissionsByStudent(studentId);
    const graded = subs.filter(s => s.grade != null);
    const avgAsg = graded.length ? Math.round(graded.reduce((a, s) => a + s.grade, 0) / graded.length) : null;
    const attempts = DB.getCbtAttemptsByStudent(studentId).filter(a => a.submittedAt)
      .map(a => global.Scoring ? Scoring.ensureFresh(a) : a);
    const avgCbt = attempts.length ? Math.round(attempts.reduce((a, x) => a + (x.score || 0), 0) / attempts.length) : null;
    const scaledVals = attempts.map(a => a.scoring && a.scoring.scaled200_800).filter(v => v != null);
    const avgCbtScaled = scaledVals.length ? Math.round(scaledVals.reduce((a, v) => a + v, 0) / scaledVals.length) : null;
    const att = DB.getAttendanceByUser(studentId).filter(a => a.role === 'siswa');
    const attSum = DB.attendanceSummary(att);
    const counts = attSum.counts;
    const attendancePct = Math.round(attSum.pct);
    const enrolled = DB.getEnrollmentsByStudent(studentId);

    // Poin: aktivitas nyata + kualitas hasil + hadiah ulang tahun yang dibuka
    const points = Math.max(0, Math.round(
      counts.hadir * 5
      + (counts.terlambat || 0) * 3
      + DB.birthdayBonusPoints(studentId)
      + (global.StreakAPI ? StreakAPI.bonusPoints(studentId) : 0)
      + subs.length * 10
      + graded.reduce((a, s) => a + s.grade, 0) / 10
      + attempts.length * 15
      + attempts.reduce((a, x) => a + (x.score || 0), 0) / 10
      - counts.alfa * 4
    ));
    const level = Math.floor(points / 120) + 1;
    const nextLevelAt = level * 120;
    const levelProgress = Math.min(100, Math.round(((points - (level - 1) * 120) / 120) * 100));

    // Tugas yang belum dikumpulkan dari kelas yang diikuti
    // Hanya tugas yang terlihat oleh siswa (aktif & sesuai kebijakan siswa baru).
    const allAsg = DB.studentContent('assignment', studentId);
    const submittedIds = new Set(subs.map(s => s.assignmentId));
    const pendingAsg = allAsg.filter(a => !submittedIds.has(a.id));

    return {
      studentId, points, level, nextLevelAt, levelProgress,
      submissions: subs.length, gradedCount: graded.length, avgAsg,
      cbtDone: attempts.length, avgCbt, avgCbtScaled,
      attendanceCounts: counts, attendanceTotal: attSum.sessions, attendancePct,
      attendanceSessions: attSum.sessions, attendanceCancelled: attSum.cancelled,
      courses: enrolled.length, assignmentsTotal: allAsg.length, pendingAsg
    };
  }

  const ACHIEVEMENTS = [
    { id: 'first_step', ic: '🌱', nm: 'Langkah Pertama', ds: 'Gabung kelas pertama', test: s => s.courses >= 1 },
    { id: 'collector', ic: '📚', nm: 'Kolektor Kelas', ds: 'Ikuti 3 kelas', test: s => s.courses >= 3 },
    { id: 'rajin', ic: '✍️', nm: 'Rajin Mengerjakan', ds: 'Kumpulkan 5 tugas', test: s => s.submissions >= 5 },
    { id: 'perfect_att', ic: '🎯', nm: 'Disiplin', ds: 'Kehadiran ≥ 90%', test: s => s.attendanceTotal >= 3 && s.attendancePct >= 90 },
    { id: 'cbt_master', ic: '🖥️', nm: 'Jagoan CBT', ds: 'Selesaikan 3 ujian', test: s => s.cbtDone >= 3 },
    { id: 'high_score', ic: '⭐', nm: 'Nilai Cemerlang', ds: 'Rata-rata tugas ≥ 85', test: s => s.avgAsg != null && s.avgAsg >= 85 },
    { id: 'cbt_ace', ic: '🧠', nm: 'Otak Encer', ds: 'Rata-rata CBT ≥ 80', test: s => s.avgCbt != null && s.avgCbt >= 80 },
    { id: 'level5', ic: '🚀', nm: 'Level 5', ds: 'Capai level 5', test: s => s.level >= 5 },
    { id: 'no_pending', ic: '✅', nm: 'Zero Tunggakan', ds: 'Tidak ada tugas tertunda', test: s => s.assignmentsTotal > 0 && s.pendingAsg.length === 0 }
  ];

  function achievementsFor(stats) {
    return ACHIEVEMENTS.map(a => ({ ...a, unlocked: !!a.test(stats) }));
  }

  function achievementsHtml(stats) {
    const list = achievementsFor(stats);
    const got = list.filter(a => a.unlocked).length;
    return `
      <div class="card">
        <div class="card-header">
          ${UI.secHead('🏅', 'Lencana Pencapaian', `${got} dari ${list.length} lencana terbuka`)}
        </div>
        ${UI.progressHtml(Math.round(got / list.length * 100), 'Progres koleksi lencana')}
        <div class="ach-grid mt-2">
          ${list.map(a => `
            <div class="ach ${a.unlocked ? 'unlocked' : 'locked'}" title="${UI.esc(a.ds)}">
              <span class="ic">${a.unlocked ? a.ic : '🔒'}</span>
              <div class="nm">${UI.esc(a.nm)}</div>
              <div class="ds">${UI.esc(a.ds)}</div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  /** Papan peringkat siswa. Bisa difilter per kelas via chip (tanpa dropdown). */
  function renderLeaderboard(container, user) {
    const courses = DB.getCourses();
    let activeCourse = '';

    const build = () => {
      let students = DB.getUsers().filter(u => u.role === 'siswa' && (u.status || 'Aktif') === 'Aktif');
      if (activeCourse) {
        const ids = new Set(DB.getEnrollmentsByCourse(activeCourse).map(e => e.studentId));
        students = students.filter(s => ids.has(s.id));
      }
      const rows = students
        .map(s => ({ s, st: studentStats(s.id) }))
        .sort((a, b) => b.st.points - a.st.points || a.s.name.localeCompare(b.s.name));

      const top = rows[0];
      const myRank = rows.findIndex(r => r.s.id === user.id) + 1;
      const avgPoints = rows.length ? Math.round(rows.reduce((a, r) => a + r.st.points, 0) / rows.length) : 0;

      container.innerHTML = `
        <div class="stats-grid">
          <div class="stat-card accent-warning">
            <div class="label">Juara Saat Ini</div>
            <div class="value" style="font-size:20px;">${top ? UI.esc(top.s.name.split(' ')[0]) : '-'}</div>
            <div class="sub">${top ? top.st.points + ' poin • Level ' + top.st.level : 'Belum ada data'}</div>
          </div>
          <div class="stat-card accent-primary">
            <div class="label">Peserta</div>
            <div class="value">${rows.length}</div>
            <div class="sub">mentee aktif diperingkat</div>
          </div>
          <div class="stat-card accent-success">
            <div class="label">Rata-rata Poin</div>
            <div class="value">${avgPoints}</div>
            <div class="sub">seluruh peserta</div>
          </div>
          ${user.role === 'siswa' ? `
          <div class="stat-card accent-danger">
            <div class="label">Peringkat Saya</div>
            <div class="value">${myRank > 0 ? '#' + myRank : '-'}</div>
            <div class="sub">${myRank > 0 ? rows[myRank - 1].st.points + ' poin' : 'Belum masuk peringkat'}</div>
          </div>` : ''}
        </div>

        <div class="card">
          <div class="card-header">
            ${UI.secHead('🏆', 'Papan Peringkat', 'Poin dihitung dari kehadiran, tugas, dan hasil CBT')}
          </div>
          <div class="class-chips">
            <button type="button" class="class-chip ${activeCourse === '' ? 'is-active' : ''}" data-lb-course="">
              <span class="cc-dot"></span>
              <span class="cc-title">Semua Kelas</span>
              <span class="cc-meta">${DB.getUsers().filter(u => u.role === 'siswa').length} mentee</span>
            </button>
            ${courses.map(c => `
              <button type="button" class="class-chip ${activeCourse === c.id ? 'is-active' : ''}" data-lb-course="${c.id}">
                <span class="cc-dot"></span>
                <span class="cc-title">${UI.esc(c.title)}</span>
                <span class="cc-meta">${DB.getEnrollmentsByCourse(c.id).length} mentee</span>
              </button>`).join('')}
          </div>
        </div>

        <div class="card">
          ${rows.length === 0
            ? '<div class="empty"><div class="empty-icon">🏅</div>Belum ada mentee untuk diperingkat.</div>'
            : `<div class="lb-list">${rows.map((r, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
                const cls = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
                return `<div class="lb-row ${cls} ${r.s.id === user.id ? 'is-me' : ''}" style="animation-delay:${Math.min(0.4, i * 0.04)}s;">
                  <div class="rank">${medal}</div>
                  <div class="avatar">${AV(r.s)}</div>
                  <div class="who">
                    <div class="nm">${UI.esc(r.s.name)}${r.s.id === user.id ? ' <span class="badge badge-info">Saya</span>' : ''}</div>
                    <div class="mt">Level ${r.st.level} • ${UI.esc(r.s.kelas || '-')} • Kehadiran ${r.st.attendancePct}% • ${r.st.submissions} tugas • ${r.st.cbtDone} CBT</div>
                  </div>
                  <div class="pts">${r.st.points}<small>poin</small></div>
                </div>`;
              }).join('')}</div>`}
        </div>
      `;

      container.querySelectorAll('[data-lb-course]').forEach(b => b.addEventListener('click', () => {
        activeCourse = b.dataset.lbCourse;
        build();
        if (window.Effects) Effects.enhance(container);
      }));
      if (window.Effects) Effects.enhance(container);
    };
    build();
  }

  /* =======================================================================
   * ABSENSI: lembar presensi dengan pilihan status berbentuk kotak/bulat
   * yang berbaris ke samping (tanpa dropdown) — dipakai guru & admin.
   * ===================================================================== */
  // Satu sumber kebenaran: status presensi didefinisikan di DB.ATT_STATUSES.
  const ATT_STATUSES = DB.ATT_STATUSES;
  const ATT_COLORS = {
    hadir: 'var(--success)', terlambat: '#0ea5e9', izin: 'var(--accent)',
    sakit: 'var(--warning)', alfa: 'var(--danger)'
  };
  function attLegendHtml(c, extra) {
    return ATT_STATUSES.map(s =>
      `<span><i style="background:${ATT_COLORS[s.key]};"></i>${s.label} ${c[s.key] || 0}</span>`).join('') + (extra || '');
  }
  function attSummaryText(c) {
    return ATT_STATUSES.map(s => `<strong>${c[s.key] || 0}</strong> ${s.label.toLowerCase()}`).join(' • ');
  }

  /** Deretan kotak pemilih kelas (pengganti dropdown). */
  function classChipsHtml(courses, activeId, attrName) {
    const attr = attrName || 'data-course-chip';
    if (!courses.length) return '';
    return `<div class="class-chips">
      ${courses.map(c => `<button type="button" class="class-chip ${activeId === c.id ? 'is-active' : ''}" ${attr}="${UI.esc(c.id)}">
          <span class="cc-dot"></span>
          <span class="cc-title">${UI.esc(DB.courseTitle(c))}</span>
          <span class="cc-meta">${DB.getEnrollmentsByCourse(c.id).length} mentee • ${UI.esc(DB.courseTutorsShort(c, 1) || 'tanpa tutor')}</span>
        </button>`).join('')}
    </div>`;
  }

  /**
   * Lembar presensi per pertemuan.
   * opts = { container, courseId, date, planId, user, canMarkTeacher, round, onDateChange, onSaved }
   *
   *  - Baris kosong sampai ditandai: tidak ada status bawaan, tidak ada "tersimpan" palsu.
   *  - Klik status langsung tersimpan; status dapat diganti atau dikosongkan (dengan Urungkan).
   *  - Kelas dengan beberapa pertemuan di hari yang sama dipilih per sesi.
   *  - Tutor yang tampil hanya tutor yang mengajar sesi itu (rencana kelas).
   *  - Hanya tutor sesi itu atau admin yang dapat mengisi/mengubah (juga dijaga server).
   */
  function renderAttendanceSheet(opts) {
    const { container, courseId, user } = opts;
    const course = DB.getCourse(courseId);
    if (!course) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">📭</div>Kelas tidak ditemukan.</div>';
      return;
    }
    const esc = UI.esc;
    const canMarkTeacher = opts.canMarkTeacher !== false;
    const roundStyle = !!opts.round;
    const fmtTime = (t) => String(t || '').replace(':', '.');
    const timeLabel = (pl) => (pl && pl.time ? `${fmtTime(pl.time)}–${fmtTime(pl.endTime || DB.planEndFor(pl.time))}` : '');
    let date = opts.date || UI.todayYMD();
    let planId = opts.planId || null;
    let ses, editable, people, recs;

    /** Sesi, hak ubah, peserta, dan catatan tersimpan untuk tanggal/sesi terpilih. */
    function load() {
      const all = DB.getPlansForCourseDate(course.id, date);
      ses = DB.sessionTutors(course, date, planId);
      if (!ses.plans.some(p => p.id === planId)) planId = ses.plan ? ses.plan.id : null;
      ses.cancelledOnly = all.length > 0 && !ses.plans.length;
      editable = !ses.cancelledOnly && DB.canTakeAttendance(user, course, date, planId);
      recs = new Map();
      DB.getSessionAttendance(course.id, date, planId).forEach(a => {
        // Satu orang satu catatan per sesi: catatan bertanda sesi diutamakan dari catatan lama tanpa planId.
        const prev = recs.get(a.userId);
        if (!prev || (!prev.planId && a.planId)) recs.set(a.userId, a);
      });

      people = [];
      const seen = new Set();
      const push = (u, role, tag, extra) => {
        if (!u || seen.has(u.id)) return;
        seen.add(u.id);
        people.push(Object.assign({ u, role, tag }, extra || {}));
      };
      if (canMarkTeacher) {
        if (ses.plan) {
          ses.users.forEach(t => push(t, 'guru', t.id === user.id ? 'Saya — mengajar sesi ini' : 'Mengajar sesi ini', { isSession: true }));
        } else if (user.role === 'guru') {
          push(user, 'guru', 'Saya (tutor kelas)');
        } else {
          DB.courseTeachers(course).forEach(t => push(t, 'guru', 'Tutor kelas — tandai yang mengajar'));
        }
        // Tutor yang sudah tercatat walau bukan pengajar sesi (mis. tim pengajar diubah) tetap terlihat.
        recs.forEach(a => { if (a.role === 'guru') push(DB.getUser(a.userId), 'guru', 'Bukan pengajar sesi ini'); });
      }
      DB.getEnrollmentsByCourse(course.id).map(e => DB.getUser(e.studentId)).filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(st => push(st, 'siswa', st.kelas || 'Mentee'));
      recs.forEach(a => { if (a.role === 'siswa') push(DB.getUser(a.userId), 'siswa', 'Tidak lagi terdaftar di kelas ini'); });
    }

    const countOf = () => {
      const c = { empty: 0 };
      ATT_STATUSES.forEach(s => { c[s.key] = 0; });
      people.forEach(p => { const r = recs.get(p.u.id); if (r) c[r.status] = (c[r.status] || 0) + 1; else c.empty++; });
      return c;
    };

    function bannerHtml() {
      const tutors = DB.courseTeachers(course);
      if (!tutors.length) return '<div class="alert alert-error">Kelas ini belum memiliki tutor.</div>';
      if (ses.cancelledOnly) {
        return `<div class="att-session is-locked"><span class="as-ic">✕</span><div>
          <strong>Pertemuan pada tanggal ini dibatalkan</strong>
          <div class="muted small">Presensi tidak diisi dan tidak dihitung. Pulihkan pertemuannya di Jadwal Kelas bila ternyata tetap berlangsung.</div></div></div>`;
      }
      if (ses.plan) {
        const pl = ses.plan;
        const st = (DB.PLAN_STATUS && DB.PLAN_STATUS[pl.status]) || { label: pl.status, badge: 'badge-gray' };
        return `<div class="att-session ${editable ? '' : 'is-locked'}">
          <span class="as-ic">${editable ? '👨‍🏫' : '🔒'}</span>
          <div>
            <strong>Diajar ${esc(DB.planTeacherNames(pl) || '-')}</strong>
            <span class="badge ${st.badge}">${esc(st.label)}</span>
            <div class="muted small">${esc(timeLabel(pl))}${pl.topic ? ' • ' + esc(pl.topic) : ''}</div>
            ${editable ? '' : `<div class="att-lock small">Presensi pertemuan ini hanya dapat diisi atau diubah oleh ${esc(DB.planTeacherNames(pl, ', ') || 'tutor yang mengajar')} atau admin.</div>`}
          </div>
        </div>`;
      }
      return `<div class="att-session is-loose ${editable ? '' : 'is-locked'}">
        <span class="as-ic">${editable ? '❓' : '🔒'}</span>
        <div>
          <strong>Belum ada rencana pertemuan pada tanggal ini</strong>
          <div class="muted small">${editable
            ? 'Presensi tetap dapat diisi tutor kelas. Buat pertemuannya di War Jadwal agar tutor sesi tercatat tepat.'
            : 'Hanya tutor kelas ini atau admin yang dapat mengisi presensi.'}</div>
        </div>
      </div>`;
    }

    function sessionPickerHtml() {
      if (ses.plans.length < 2) return '';
      return `<div class="att-sessions" role="group" aria-label="Pilih pertemuan">
        ${ses.plans.map((p, i) => `<button type="button" class="att-ses ${p.id === planId ? 'is-on' : ''}" data-att-plan="${esc(p.id)}" aria-pressed="${p.id === planId}">
          <strong>Sesi ${i + 1} · ${esc(timeLabel(p))}</strong><span>${esc(p.topic || 'materi belum diisi')} • ${esc(DB.planTeacherNames(p) || '-')}</span></button>`).join('')}
      </div>`;
    }

    function stateHtml(p) {
      const r = recs.get(p.u.id);
      if (!r) return '<span class="att-empty-tag">Belum diisi</span>';
      const by = r.markedBy ? DB.getUser(r.markedBy) : null;
      const when = r.markedAt ? UI.fmtDateTime(r.markedAt) : '';
      return `<span class="att-by" title="${esc([by ? 'oleh ' + by.name : '', when].filter(Boolean).join(' • '))}">✓ ${by ? esc(by.id === user.id ? 'oleh Anda' : 'oleh ' + by.name.split(' ').slice(0, 2).join(' ')) : 'tercatat'}</span>
        ${editable ? `<button type="button" class="att-clear" data-att-clear aria-label="Kosongkan presensi ${esc(p.u.name)}" title="Kosongkan">×</button>` : ''}`;
    }

    function rowHtml(p) {
      const r = recs.get(p.u.id);
      return `<div class="att-row ${p.isSession ? 'is-session' : ''} ${r ? 'is-marked' : 'is-empty'}" data-uid="${esc(p.u.id)}" data-role="${p.role}">
          <div class="att-person">
            <div class="avatar">${AV(p.u)}</div>
            <div class="att-who">
              <div class="nm">${esc(p.u.name)}</div>
              <div class="sub">${esc(p.tag)}</div>
            </div>
            <div class="att-state">${stateHtml(p)}</div>
          </div>
          <div class="att-pills ${roundStyle ? 'round' : ''}" role="radiogroup" aria-label="Status ${esc(p.u.name)}">
            ${ATT_STATUSES.map(s => `<button type="button" role="radio" aria-checked="${!!r && r.status === s.key}" class="att-pill p-${s.key} ${r && r.status === s.key ? 'is-on' : ''}"
                      data-status="${s.key}" title="${s.label}" ${editable ? '' : 'disabled'}>
                <span class="dot"></span>${roundStyle ? s.short : s.label}
              </button>`).join('')}
          </div>
          <input class="att-note" maxlength="500" placeholder="${!editable ? '' : (r ? 'Catatan (opsional)…' : 'Pilih status dulu')}" value="${esc(r ? (r.note || '') : '')}" ${editable && r ? '' : 'disabled'} aria-label="Catatan ${esc(p.u.name)}" />
        </div>`;
    }

    function groupHtml(role, title) {
      const list = people.filter(p => p.role === role);
      if (!list.length) return '';
      return `<div class="att-group-head">${title} <span>${list.length}</span></div>${list.map(rowHtml).join('')}`;
    }

    function legendHtml() {
      const c = countOf();
      return attLegendHtml(c, `<span class="${c.empty ? 'att-empty-count' : 'muted'}">• ${c.empty ? c.empty + ' belum diisi' : 'semua sudah diisi'}</span>`);
    }

    function paint() {
      load();
      const hasPeople = people.length > 0;
      container.innerHTML = `
        <div class="card att-card">
          <div class="card-header">
            ${UI.secHead('📋', 'Ambil Presensi', `${DB.courseTitle(course)} • ${UI.fmtYMD(date)}`)}
          </div>
          <div class="att-toolbar">
            <label class="att-date"><span class="lbl">Tanggal</span><input type="date" id="attSheetDate" class="input" value="${esc(date)}" /></label>
            ${editable && hasPeople ? `<div class="att-bulk"><span class="lbl">Isi yang kosong</span>
              ${ATT_STATUSES.map(s => `<button type="button" class="att-pill p-${s.key}" data-bulk="${s.key}" title="Tandai ${s.label} untuk peserta yang belum diisi"><span class="dot"></span>${s.label}</button>`).join('')}</div>` : ''}
          </div>
          ${sessionPickerHtml()}
          ${bannerHtml()}
          <div class="att-legend">${legendHtml()}</div>
          ${!hasPeople
            ? '<div class="empty"><div class="empty-icon">👥</div>Belum ada mentee terdaftar di kelas ini.</div>'
            : `<div class="att-sheet">${groupHtml('guru', 'Tutor')}${groupHtml('siswa', 'Mentee')}</div>`}
          ${hasPeople && editable ? `
          <div class="att-sticky-save">
            <div class="muted small" id="attSummary">${attSummaryText(countOf())}<div>Status tersimpan otomatis saat diklik; catatan saat kolom ditinggalkan.</div></div>
            <button type="button" class="btn btn-success" id="attDone">✔ Selesai</button>
          </div>` : ''}
        </div>`;
      if (window.Effects) Effects.enhance(container);
    }

    function refreshRow(uid) {
      const p = people.find(x => x.u.id === uid);
      const row = p && container.querySelector(`.att-row[data-uid="${CSS.escape(uid)}"]`);
      if (row) row.outerHTML = rowHtml(p);
      const legend = container.querySelector('.att-legend');
      if (legend) legend.innerHTML = legendHtml();
      const sum = container.querySelector('#attSummary');
      if (sum) sum.innerHTML = `${attSummaryText(countOf())}<div>Status tersimpan otomatis saat diklik; catatan saat kolom ditinggalkan.</div>`;
    }

    const sessionOpts = () => ({ planId, actor: user });
    function mark(p, status, note) {
      const rec = DB.upsertAttendance(course.id, p.u.id, p.role, date, status, note, sessionOpts());
      recs.set(p.u.id, rec);
      return rec;
    }
    const guard = () => {
      if (editable) return true;
      UI.toast('Presensi pertemuan ini hanya dapat diubah tutor yang mengajar sesi tersebut atau admin.', 'error');
      return false;
    };

    // Penanganan event lewat properti agar pemanggilan ulang pada wadah yang sama tidak menumpuk pendengar.
    container.onclick = (e) => {
      const planBtn = e.target.closest('[data-att-plan]');
      if (planBtn) { planId = planBtn.dataset.attPlan; paint(); return; }
      const row = e.target.closest('.att-row');
      const p = row && people.find(x => x.u.id === row.dataset.uid);
      const pill = e.target.closest('.att-row [data-status]');
      if (pill && p) {
        if (!guard()) return;
        const prev = recs.get(p.u.id);
        if (prev && prev.status === pill.dataset.status) return;
        try { mark(p, pill.dataset.status, prev ? prev.note : ''); } catch (err) { UI.toast(err.message, 'error'); return; }
        refreshRow(p.u.id);
        return;
      }
      if (e.target.closest('[data-att-clear]') && p) {
        if (!guard()) return;
        let removed;
        try { removed = DB.clearAttendance(course.id, p.u.id, date, sessionOpts()); } catch (err) { UI.toast(err.message, 'error'); return; }
        recs.delete(p.u.id);
        refreshRow(p.u.id);
        if (removed) UI.toast(`Presensi ${p.u.name} dikosongkan.`, 'info', {
          label: 'Urungkan', onClick: () => { if (DB.restoreAttendance(removed)) { recs.set(p.u.id, removed); refreshRow(p.u.id); } }
        });
        return;
      }
      const bulk = e.target.closest('[data-bulk]');
      if (bulk) {
        if (!guard()) return;
        const st = bulk.dataset.bulk;
        const todo = people.filter(x => !recs.has(x.u.id));
        if (!todo.length) { UI.toast('Semua peserta sudah diisi. Ubah satu per satu bila perlu.', 'info'); return; }
        const done = [];
        try { todo.forEach(x => { mark(x, st, ''); done.push(x); }); } catch (err) { UI.toast(err.message, 'error'); }
        const label = (ATT_STATUSES.find(s => s.key === st) || {}).label || st;
        paint();
        UI.toast(`${done.length} peserta yang kosong ditandai ${label}.`, 'success', {
          label: 'Urungkan', onClick: () => {
            done.forEach(x => { try { DB.clearAttendance(course.id, x.u.id, date, sessionOpts()); } catch (err) { /* hak sudah dicek saat menandai */ } });
            paint();
          }
        });
        return;
      }
      if (e.target.closest('#attDone')) finish();
    };
    container.onchange = (e) => {
      if (e.target.id === 'attSheetDate') {
        date = e.target.value || UI.todayYMD();
        planId = null;
        if (typeof opts.onDateChange === 'function') opts.onDateChange(date);
        paint();
        return;
      }
      if (e.target.classList.contains('att-note')) {
        const row = e.target.closest('.att-row');
        const p = row && people.find(x => x.u.id === row.dataset.uid);
        const r = p && recs.get(p.u.id);
        if (!p || !r || !guard()) return;
        try { mark(p, r.status, e.target.value.trim()); } catch (err) { UI.toast(err.message, 'error'); }
      }
    };

    /** Selesai: ingatkan baris kosong, kirim notifikasi Alfa sekali per catatan. */
    function finish() {
      if (!guard()) return;
      const c = countOf();
      if (c.empty && !UI.confirmDialog(`${c.empty} peserta belum diisi presensinya. Tetap selesai? Baris kosong tidak dihitung dalam rekap.`)) return;
      let alerted = 0, overLimit = 0;
      const counted = new Set(DB.absencePolicy().statuses);
      const where = `${DB.courseTitle(course)} — ${UI.fmtYMD(date)}${ses.plan ? ' ' + timeLabel(ses.plan) : ''}`;
      const admins = DB.getUsers().filter(u => u.role === 'admin' && u.id !== user.id).map(u => u.id);
      people.filter(p => p.role === 'siswa').forEach(p => {
        const r = recs.get(p.u.id);
        if (!r || r.notifiedAt || (r.status !== 'alfa' && !counted.has(r.status))) return;
        // Batas ketidakhadiran status pendidikan: dicek sekali per catatan (bersama penanda notifikasi).
        const st = counted.has(r.status) ? DB.absenceStatusFor(p.u, String(date).slice(0, 7)) : null;
        const over = st && st.exceeded ? ` Ketidakhadiran ${st.periodLabel}: ${st.count}× dari batas ${st.limit}×${st.fine > 0 ? ', dapat dikenai denda' : ''}.` : '';
        if (r.status === 'alfa') {
          DB.notifyStudentAndParents(p.u.id, {
            type: 'absensi', icon: '⚠️',
            title: st && st.exceeded ? 'Alfa: melewati batas ketidakhadiran' : 'Tercatat tidak hadir (Alfa)',
            body: `${where}${r.note ? ' • ' + r.note : ''}${over}`,
            link: 'absensi'
          }, { link: 'anak-absensi', title: `${p.u.name} tercatat Alfa` });
          alerted++;
        } else if (over) {
          DB.notifyStudentAndParents(p.u.id, {
            type: 'absensi', icon: '⏰', title: 'Melewati batas ketidakhadiran',
            body: `${DB.attStatusMeta(r.status).label} pada ${where}.${over}`, link: 'absensi'
          }, { link: 'anak-absensi', title: `${p.u.name} melewati batas ketidakhadiran` });
        }
        if (over) {
          overLimit++;
          DB.notifyUsers(admins, { type: 'absensi', icon: '⏰', title: `${p.u.name} melewati batas ketidakhadiran`,
            body: `${DB.eduStatusLabel(st.eduStatus)} • ${st.count}× dari batas ${st.limit}× (${st.periodLabel})`, link: 'attendance' });
        }
        recs.set(p.u.id, DB.markAttendanceNotified(r.id));
      });
      UI.toast(`Presensi selesai: ${ATT_STATUSES.map(s => `${c[s.key] || 0} ${s.label.toLowerCase()}`).join(', ')}.` +
        (alerted ? ` ${alerted} notifikasi Alfa dikirim.` : '') + (overLimit ? ` ${overLimit} mentee melewati batas ketidakhadiran.` : ''));
      if (typeof opts.onSaved === 'function') opts.onSaved(date);
    }

    paint();
  }

  /* =====================================================================
   * KOTAK KATA MOTIVASI
   * Kalimatnya berbeda untuk siswa, tutor, dan orang tua, serta seluruhnya
   * dikelola admin pada halaman "Kata Motivasi".
   * ===================================================================*/
  const MOTIV_LOOK = {
    siswa:    { icon: '🚀', title: 'Semangat Hari Ini', cls: 'mv-siswa' },
    guru:     { icon: '🌟', title: 'Untuk Tutor Hebat', cls: 'mv-guru' },
    orangtua: { icon: '🤝', title: 'Pesan untuk Orang Tua', cls: 'mv-ortu' }
  };

  /** HTML kotak motivasi. Mengembalikan '' bila fitur dimatikan admin. */
  function motivationHtml(role, opts) {
    const o = opts || {};
    const settings = DB.getSettings();
    if (settings.motivationEnabled === false) return '';
    const pool = DB.getMotivations(role).filter(m => m.active !== false);
    if (!pool.length) return '';
    const picked = o.id ? (pool.find(m => m.id === o.id) || pool[0]) : DB.getActiveMotivation(role);
    if (!picked) return '';
    const look = MOTIV_LOOK[role] || { icon: '💡', title: 'Kata Motivasi', cls: '' };
    return `
      <section class="motiv-box ${look.cls}" data-motiv-role="${UI.esc(role)}" data-motiv-id="${UI.esc(picked.id)}">
        <div class="mv-ic">${look.icon}</div>
        <div class="mv-body">
          <div class="mv-title">${UI.esc(look.title)}</div>
          <blockquote class="mv-text">${UI.esc(picked.text)}</blockquote>
          <div class="mv-foot">
            <span class="mv-author">— ${UI.esc(picked.author || 'Tim Rubela')}</span>
            ${pool.length > 1 ? '<button type="button" class="btn btn-ghost btn-sm mv-next">🔄 Kutipan Lain</button>' : ''}
          </div>
        </div>
      </section>`;
  }

  /** Aktifkan tombol "Kutipan Lain" pada setiap kotak motivasi di dalam scope. */
  function bindMotivation(scope) {
    const root = scope && scope.querySelectorAll ? scope : document;
    root.querySelectorAll('.motiv-box').forEach(boxEl => {
      const btn = boxEl.querySelector('.mv-next');
      if (!btn) return;
      btn.addEventListener('click', () => {
        const role = boxEl.dataset.motivRole;
        const pool = DB.getMotivations(role).filter(m => m.active !== false);
        if (pool.length < 2) return;
        const others = pool.filter(m => m.id !== boxEl.dataset.motivId);
        const next = others[Math.floor(Math.random() * others.length)];
        const html = motivationHtml(role, { id: next.id });
        if (!html) return;
        const holder = document.createElement('div');
        holder.innerHTML = html.trim();
        const fresh = holder.firstElementChild;
        fresh.classList.add('mv-in');
        boxEl.replaceWith(fresh);
        bindMotivation(fresh.parentElement || document);
      });
    });
  }

  /* ===== Public API =====
   * Diekspor di akhir file agar semua const (mis. ATT_STATUSES) sudah
   * terinisialisasi saat objek ini dibuat.
   */
  global.Shared = {
    toEmbedUrl, videoEmbedHtml, startCbt, showCbtResult, renderCalendar, renderFeedback,
    renderAnnouncements, renderTicker, visibleAnnouncementsFor, isAnnouncementVisible, tickerActive,
    autoLinkText, announcementContentHtml, renderChat, chatTextHtml, renderAiTools, renderAiAnalytics,
    // Password kelas
    openCoursePasswordForm, openCoursePasswordGate,
    // Gamifikasi & rekap lintas peran
    studentStats, renderLeaderboard, achievementsFor, achievementsHtml,
    // Absensi (layout pill / kotak berbaris)
    renderAttendanceSheet, classChipsHtml, ATT_STATUSES,
    // Kata motivasi
    motivationHtml, bindMotivation
  };
})(window);
