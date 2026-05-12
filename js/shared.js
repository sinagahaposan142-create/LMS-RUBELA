/* ===== Shared feature modules used across roles =====
 * CBT (take/grade), video embed helper, attendance rendering.
 */
(function (global) {

  /* ===== YouTube / Video embed helper ===== */
  function toEmbedUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      if (u.hostname.includes('youtube.com')) {
        const v = u.searchParams.get('v');
        if (v) return `https://www.youtube.com/embed/${v}`;
      }
      if (u.hostname === 'youtu.be') {
        const v = u.pathname.slice(1);
        if (v) return `https://www.youtube.com/embed/${v}`;
      }
      if (u.hostname.includes('vimeo.com')) {
        const v = u.pathname.split('/').filter(Boolean).pop();
        if (v) return `https://player.vimeo.com/video/${v}`;
      }
    } catch (e) { /* noop */ }
    return url;
  }

  function videoEmbedHtml(url) {
    if (!url) return '';
    const embed = toEmbedUrl(url);
    const isEmbeddable = /youtube\.com\/embed|player\.vimeo\.com/.test(embed);
    if (isEmbeddable) {
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
            </div>`;
        }).join('')}
      </div>
    `;
    document.getElementById('backToCbt').addEventListener('click', () => Dashboard.navigate('cbt'));
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

      // Build cells
      let cells = '';
      for (let i = 0; i < startDow; i++) cells += '<div class="cal-cell empty"></div>';
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = ymd(viewYear, viewMonth, d);
        const dayEvents = events.filter(e => e.date === dateStr);
        const isToday = dateStr === todayStr;
        cells += `<div class="cal-cell${isToday ? ' today' : ''}" data-date="${dateStr}">
          <div class="cal-day">${d}</div>
          ${dayEvents.slice(0, 3).map(ev => `<div class="cal-event" style="background:${ev.color || 'var(--primary-light)'};" title="${UI.esc(ev.title)}">${UI.esc(ev.title.length > 12 ? ev.title.slice(0, 12) + '...' : ev.title)}</div>`).join('')}
          ${dayEvents.length > 3 ? `<div class="cal-event muted">+${dayEvents.length - 3} lagi</div>` : ''}
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

      // Click date to add event
      if (canEdit) {
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
              <input name="color" type="color" value="${editing?.color || '#eef2ff'}" /></div>
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

  global.Shared = { toEmbedUrl, videoEmbedHtml, startCbt, showCbtResult, renderCalendar, renderFeedback, renderAnnouncements, renderChat, renderAiTools, renderAiAnalytics };

  /* ===== Feedback / Kritik & Saran ===== */
  function renderFeedback(container, user) {
    const allFeedbacks = DB.getFeedbacks().sort((a, b) => b.createdAt - a.createdAt);
    // Users see all (transparency) or filter for self
    const canDelete = user.role === 'admin';

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Kirim Kritik & Saran</h3>
        </div>
        <form id="feedbackForm" class="form">
          <div class="form-row">
            <div class="form-group"><label>Tujuan</label>
              <select name="target">
                <option value="admin">Ke Admin / Manajemen</option>
                <option value="kelas">Ke Kelas Tertentu</option>
                <option value="individu">Ke Individu</option>
              </select>
            </div>
            <div class="form-group"><label>Penerima (opsional)</label>
              <input name="targetName" placeholder="Nama kelas/individu..." /></div>
          </div>
          <div class="form-group"><label>Pesan</label>
            <textarea name="message" required rows="3" placeholder="Tulis kritik atau saran Anda..."></textarea></div>
          <div class="form-row">
            <div class="form-group"><label>
              <input type="checkbox" name="anonymous" /> Kirim anonim
            </label></div>
            <div class="form-group" style="text-align:right;">
              <button type="submit" class="btn btn-primary">Kirim</button>
            </div>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="card-header"><h3>Semua Kritik & Saran (${allFeedbacks.length})</h3></div>
        ${allFeedbacks.length === 0 ? '<div class="empty"><div class="empty-icon">💬</div>Belum ada feedback.</div>' :
          allFeedbacks.map(fb => {
            const sender = fb.anonymous ? 'Anonim' : (DB.getUser(fb.senderId)?.name || '-');
            return `<div class="list-item">
              <div class="flex-between">
                <div>
                  <strong>${UI.esc(sender)}</strong>
                  <span class="badge badge-info" style="margin-left:6px;">${UI.esc(fb.target || 'admin')}</span>
                  ${fb.targetName ? `<span class="muted small"> → ${UI.esc(fb.targetName)}</span>` : ''}
                </div>
                <div class="flex-gap">
                  <span class="muted small">${UI.fmtDateTime(fb.createdAt)}</span>
                  ${canDelete ? `<button class="btn btn-sm btn-danger" data-del-fb="${fb.id}">Hapus</button>` : ''}
                </div>
              </div>
              <div class="content mt-1">${UI.esc(fb.message)}</div>
            </div>`;
          }).join('')}
      </div>
    `;

    document.getElementById('feedbackForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      DB.addFeedback({
        senderId: user.id,
        target: fd.get('target'),
        targetName: fd.get('targetName').trim(),
        message: fd.get('message').trim(),
        anonymous: !!fd.get('anonymous')
      });
      UI.toast('Feedback terkirim!');
      renderFeedback(container, user);
    });
    container.querySelectorAll('[data-del-fb]').forEach(b => b.addEventListener('click', () => {
      DB.deleteFeedback(b.dataset.delFb);
      UI.toast('Feedback dihapus.');
      renderFeedback(container, user);
    }));
  }

  /* ===== Announcements / Pengumuman ===== */
  function renderAnnouncements(container, user) {
    const canEdit = user.role === 'admin' || user.role === 'guru';
    const all = DB.getAnnouncements().sort((a, b) => b.createdAt - a.createdAt);
    // Filter: siswa only see announcements targeted to them or all
    const visible = user.role === 'admin' ? all : all.filter(a => {
      if (a.targetType === 'semua') return true;
      if (a.targetType === 'individu' && a.targetIds && a.targetIds.includes(user.id)) return true;
      if (a.targetType === 'kelas') {
        const enrolled = DB.getEnrollmentsByStudent ? DB.getEnrollmentsByStudent(user.id) : [];
        return enrolled.some(e => a.targetIds && a.targetIds.includes(e.courseId));
      }
      if (a.targetType === 'role' && a.targetRole === user.role) return true;
      return false;
    });

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
                  <span class="badge ${a.targetType === 'semua' ? 'badge-success' : 'badge-info'}">${UI.esc(a.targetType)}</span>
                  ${canEdit && a.authorId === user.id ? `<button class="btn btn-sm btn-danger" data-del-ann="${a.id}">Hapus</button>` : ''}
                </div>
              </div>
              <div class="meta">${UI.esc(author?.name || '-')} • ${UI.fmtDateTime(a.createdAt)}</div>
              <div class="content">${UI.esc(a.content)}</div>
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
      UI.toast('Pengumuman dihapus.');
      renderAnnouncements(container, user);
    }));
  }

  function openAnnouncementForm(container, user) {
    const courses = DB.getCourses();
    const body = `
      <form id="annForm" class="form">
        <div class="form-group"><label>Judul</label>
          <input name="title" required placeholder="Judul pengumuman..." /></div>
        <div class="form-group"><label>Isi Pengumuman</label>
          <textarea name="content" required rows="4" placeholder="Tulis pengumuman..."></textarea></div>
        <div class="form-group"><label>Ditujukan Kepada</label>
          <select name="targetType" id="annTarget">
            <option value="semua">Semua (Guru + Siswa)</option>
            <option value="role">Peran Tertentu</option>
            <option value="kelas">Kelas Tertentu</option>
            <option value="individu">Individu</option>
          </select>
        </div>
        <div id="annTargetDetail" class="form-group hidden"></div>
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
          <button type="submit" class="btn btn-primary">Kirim</button>
        </div>
      </form>`;
    UI.modal.open('Buat Pengumuman', body);
    document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());

    const targetSel = document.getElementById('annTarget');
    const detailBox = document.getElementById('annTargetDetail');
    targetSel.addEventListener('change', () => {
      const t = targetSel.value;
      if (t === 'semua') { detailBox.classList.add('hidden'); detailBox.innerHTML = ''; return; }
      detailBox.classList.remove('hidden');
      if (t === 'role') {
        detailBox.innerHTML = '<label>Peran</label><select name="targetRole"><option value="guru">Guru</option><option value="siswa">Siswa</option></select>';
      } else if (t === 'kelas') {
        detailBox.innerHTML = '<label>Kelas</label><div style="max-height:150px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:6px;padding:6px;">' +
          courses.map(c => `<label style="display:block;padding:4px;"><input type="checkbox" name="tid" value="${c.id}" /> ${UI.esc(c.title)}</label>`).join('') + '</div>';
      } else {
        const users = DB.getUsers().filter(u => u.role !== 'admin');
        detailBox.innerHTML = '<label>Individu</label><input id="annIndSearch" placeholder="Cari..." style="margin-bottom:6px;padding:6px;border:1px solid var(--gray-300);border-radius:4px;width:100%;" /><div id="annIndList" style="max-height:150px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:6px;padding:6px;">' +
          users.map(u => `<label style="display:block;padding:4px;" data-n="${u.name.toLowerCase()}"><input type="checkbox" name="tid" value="${u.id}" /> ${UI.esc(u.name)} (${u.role})</label>`).join('') + '</div>';
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
      const fd = new FormData(e.target);
      const payload = {
        title: fd.get('title').trim(),
        content: fd.get('content').trim(),
        targetType: fd.get('targetType'),
        targetRole: fd.get('targetRole') || null,
        targetIds: fd.getAll('tid').length > 0 ? fd.getAll('tid') : null,
        authorId: user.id
      };
      DB.addAnnouncement(payload);
      UI.toast('Pengumuman dipublikasikan!');
      UI.modal.close();
      renderAnnouncements(container, user);
    });
  }

  /* ===== Live Chat ===== */
  function renderChat(container, user) {
    let activeChatUserId = null;
    const allUsers = DB.getUsers().filter(u => u.id !== user.id && u.role !== 'admin' || (user.role !== 'admin' && u.role === 'admin'));
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
        <div class="chat-layout">
          <div class="chat-sidebar">
            <div class="chat-search">
              <input id="chatSearch" placeholder="Cari kontak..." />
            </div>
            <div class="chat-contacts" id="chatContacts">
              ${sorted.map(c => {
                const lastMsg = getLastMessage(user.id, c.id);
                return `<div class="chat-contact ${activeChatUserId === c.id ? 'active' : ''}" data-uid="${c.id}">
                  <div class="avatar" style="width:32px;height:32px;font-size:12px;">${UI.initials(c.name)}</div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:500;">${UI.esc(c.name)}</div>
                    <div class="muted small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${lastMsg ? UI.esc(lastMsg.text.slice(0, 30)) : '<i>Belum ada pesan</i>'}</div>
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
    }

    function getLastMessage(uid1, uid2) {
      const conv = DB.getConversation(uid1, uid2);
      return conv.length > 0 ? conv[conv.length - 1] : null;
    }

    function renderConversation() {
      const chatMain = document.getElementById('chatMain');
      const partner = DB.getUser(activeChatUserId);
      if (!partner) return;
      const messages = DB.getConversation(user.id, activeChatUserId);

      chatMain.innerHTML = `
        <div class="chat-header">
          <div class="avatar" style="width:32px;height:32px;font-size:12px;">${UI.initials(partner.name)}</div>
          <div>
            <strong>${UI.esc(partner.name)}</strong>
            <div class="muted small">${UI.esc(partner.role)} ${partner.subject ? '• ' + UI.esc(partner.subject) : ''}</div>
          </div>
        </div>
        <div class="chat-messages" id="chatMessages">
          ${messages.length === 0 ? '<div class="muted small" style="text-align:center;padding:20px;">Belum ada pesan. Kirim pesan pertama!</div>' :
            messages.map(m => `
              <div class="chat-bubble ${m.senderId === user.id ? 'sent' : 'received'}">
                <div class="chat-text">${UI.esc(m.text)}</div>
                <div class="chat-time">${formatChatTime(m.createdAt)}</div>
              </div>`).join('')}
        </div>
        <div class="chat-input-box">
          <input id="chatInput" placeholder="Ketik pesan..." autocomplete="off" />
          <button class="btn btn-primary btn-sm" id="chatSendBtn">Kirim</button>
        </div>
      `;

      // Scroll to bottom
      const msgBox = document.getElementById('chatMessages');
      msgBox.scrollTop = msgBox.scrollHeight;

      // Send
      const send = () => {
        const input = document.getElementById('chatInput');
        const text = input.value.trim();
        if (!text) return;
        DB.addMessage({ senderId: user.id, receiverId: activeChatUserId, text });
        input.value = '';
        renderConversation();
      };
      document.getElementById('chatSendBtn').addEventListener('click', send);
      document.getElementById('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    }

    function formatChatTime(ts) {
      const d = UI.toTzDate(ts);
      const p = n => String(n).padStart(2, '0');
      return `${p(d.getHours())}:${p(d.getMinutes())}`;
    }
  }

  /* ===== AI Tools (Siswa Panel) ===== */
  function renderAiTools(container, user) {
    const enrolled = DB.getEnrollmentsByStudent(user.id);
    const courses = enrolled.map(e => DB.getCourse(e.courseId)).filter(Boolean);
    const subs = DB.getSubmissionsByStudent(user.id);
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
          <div class="label">AI Guru</div>
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

    function showStudyPlanner(user, courses) {
      const box = document.getElementById('aiContent');
      const days = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
      const subjects = courses.map(c => c.category || c.title);
      const plan = days.map((d, i) => ({
        day: d,
        subject: subjects[i % subjects.length] || 'Review Umum',
        time: `${7 + (i % 3)}:00 - ${9 + (i % 3)}:00 ${UI.getTimezone()}`,
        focus: ['Latihan Soal', 'Teori & Konsep', 'Review & Diskusi', 'Simulasi CBT'][i % 4]
      }));
      box.innerHTML = `
        <div class="card">
          <div class="card-header"><h3>AI Study Planner - Jadwal Belajar Minggu Ini</h3></div>
          <p class="muted small">Dihasilkan berdasarkan kelas yang kamu ikuti dan performa saat ini.</p>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Hari</th><th>Waktu</th><th>Subtest/Mata Pelajaran</th><th>Fokus</th></tr></thead>
            <tbody>${plan.map(p => `<tr>
              <td><strong>${p.day}</strong></td>
              <td>${p.time}</td>
              <td>${UI.esc(p.subject)}</td>
              <td><span class="badge badge-info">${p.focus}</span></td>
            </tr>`).join('')}</tbody>
          </table></div>
          <div class="alert alert-info mt-2">Tips: Konsistenlah 2 jam/hari. AI menyesuaikan rekomendasi berdasarkan progress mingguan.</div>
        </div>`;
    }

    function showAiGuru(user) {
      const box = document.getElementById('aiContent');
      box.innerHTML = `
        <div class="card">
          <div class="card-header"><h3>AI Guru - Asisten Belajar</h3></div>
          <div class="chat-messages" id="aiChatBox" style="height:300px;overflow-y:auto;background:var(--gray-50);border-radius:var(--radius-sm);padding:16px;margin-bottom:12px;">
            <div class="chat-bubble received">
              <div class="chat-text">Halo ${UI.esc(user.name)}! Saya AI Guru. Tanyakan materi apa saja yang ingin kamu pelajari. Saya bisa membantu menjelaskan konsep, memberikan contoh soal, dan tips mengerjakan UTBK.</div>
            </div>
          </div>
          <div class="chat-input-box" style="border:none;padding:0;">
            <input id="aiGuruInput" placeholder="Ketik pertanyaan..." />
            <button class="btn btn-primary btn-sm" id="aiGuruSend">Tanya</button>
          </div>
        </div>`;
      const send = () => {
        const input = document.getElementById('aiGuruInput');
        const q = input.value.trim();
        if (!q) return;
        const chatBox = document.getElementById('aiChatBox');
        chatBox.innerHTML += `<div class="chat-bubble sent"><div class="chat-text">${UI.esc(q)}</div></div>`;
        input.value = '';
        // Simulate AI response
        setTimeout(() => {
          const responses = [
            `Pertanyaan bagus! Untuk topik "${q}", kunci utamanya adalah memahami konsep dasar terlebih dahulu. Coba review materi terkait di modul kelasmu.`,
            `Mengenai "${q}" - ini sering keluar di UTBK. Tips: pecah masalah menjadi bagian kecil, identifikasi pola, dan latihan soal serupa.`,
            `"${q}" adalah topik penting. Saya sarankan kamu: 1) Baca teori singkat, 2) Kerjakan 5 soal latihan, 3) Review kesalahan. Butuh contoh soal?`,
            `Untuk "${q}", perhatikan kata kunci di soal. Biasanya ada informasi yang tidak relevan. Fokus pada apa yang ditanyakan.`
          ];
          const resp = responses[Math.floor(Math.random() * responses.length)];
          chatBox.innerHTML += `<div class="chat-bubble received"><div class="chat-text">${UI.esc(resp)}</div></div>`;
          chatBox.scrollTop = chatBox.scrollHeight;
        }, 800);
        chatBox.scrollTop = chatBox.scrollHeight;
      };
      document.getElementById('aiGuruSend').addEventListener('click', send);
      document.getElementById('aiGuruInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    }

    function showAiRekomendasi(user, attempts) {
      const box = document.getElementById('aiContent');
      const subtests = ['Penalaran Umum', 'PPU', 'PBM', 'Pengetahuan Kuantitatif', 'Literasi B.Indonesia', 'Literasi B.Inggris', 'Penalaran Matematika'];
      const recs = subtests.map(s => ({
        subtest: s,
        score: 40 + Math.floor(Math.random() * 50),
        recommendation: Math.random() > 0.5 ? 'Perlu penguatan konsep dasar' : 'Tingkatkan kecepatan & akurasi',
        priority: Math.random() > 0.6 ? 'Tinggi' : 'Sedang'
      })).sort((a, b) => a.score - b.score);

      box.innerHTML = `
        <div class="card">
          <div class="card-header"><h3>AI Rekomendasi Materi</h3></div>
          <p class="muted small">Berdasarkan hasil CBT dan pola jawaban, berikut prioritas belajarmu:</p>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Subtest</th><th>Estimasi Skor</th><th>Prioritas</th><th>Rekomendasi</th></tr></thead>
            <tbody>${recs.map(r => `<tr>
              <td><strong>${UI.esc(r.subtest)}</strong></td>
              <td><span style="color:${r.score < 60 ? 'var(--danger)' : 'var(--success)'};">${r.score}</span>/100</td>
              <td><span class="badge ${r.priority === 'Tinggi' ? 'badge-warning' : 'badge-info'}">${r.priority}</span></td>
              <td class="muted small">${UI.esc(r.recommendation)}</td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>`;
    }

    function showPtnPredictor(user, avgScore) {
      const box = document.getElementById('aiContent');
      const baseScore = avgScore || 55;
      const predictions = [
        { univ: user.targetUniv || 'Universitas Indonesia', jurusan: user.targetMajor || 'Teknik Informatika', chance: Math.min(95, baseScore + Math.floor(Math.random() * 20)) },
        { univ: 'ITB', jurusan: 'Teknik Elektro', chance: Math.max(15, baseScore - 10 + Math.floor(Math.random() * 15)) },
        { univ: 'UGM', jurusan: 'Kedokteran', chance: Math.max(10, baseScore - 20 + Math.floor(Math.random() * 10)) },
        { univ: 'Unpad', jurusan: 'Hukum', chance: Math.min(90, baseScore + Math.floor(Math.random() * 25)) },
        { univ: 'ITS', jurusan: 'Sistem Informasi', chance: Math.min(92, baseScore + 5 + Math.floor(Math.random() * 20)) }
      ].sort((a, b) => b.chance - a.chance);

      box.innerHTML = `
        <div class="card">
          <div class="card-header"><h3>PTN Predictor</h3></div>
          <p class="muted small">Estimasi peluang berdasarkan rata-rata skor CBT (${baseScore}/100) dan data historis. <strong>Disclaimer:</strong> ini hanya simulasi.</p>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Universitas</th><th>Jurusan</th><th>Peluang</th><th>Status</th></tr></thead>
            <tbody>${predictions.map(p => {
              const color = p.chance >= 70 ? 'var(--success)' : (p.chance >= 40 ? 'var(--warning)' : 'var(--danger)');
              const label = p.chance >= 70 ? 'Aman' : (p.chance >= 40 ? 'Berjuang' : 'Sulit');
              return `<tr>
                <td><strong>${UI.esc(p.univ)}</strong></td>
                <td>${UI.esc(p.jurusan)}</td>
                <td><strong style="color:${color};">${p.chance}%</strong></td>
                <td><span class="badge ${p.chance >= 70 ? 'badge-success' : (p.chance >= 40 ? 'badge-warning' : 'badge-gray')}">${label}</span></td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>
          <div class="alert alert-info mt-2">Tingkatkan skor di subtest lemah untuk meningkatkan peluang. Gunakan AI Study Planner untuk jadwal optimal.</div>
        </div>`;
    }
  }

  /* ===== AI Analytics (Admin/Guru Panel) ===== */
  function renderAiAnalytics(container, user) {
    const students = DB.getUsers().filter(u => u.role === 'siswa' && (u.status || 'Aktif') === 'Aktif');
    const allAtt = DB.getAttendance();
    const allSubs = DB.getSubmissions();
    const allAttempts = DB.getCbtAttempts();

    // Simulate early warning analysis
    const warnings = students.map(s => {
      const att = allAtt.filter(a => a.userId === s.id && a.role === 'siswa');
      const absentCount = att.filter(a => a.status === 'alfa').length;
      const totalAtt = att.length;
      const absenceRate = totalAtt > 0 ? absentCount / totalAtt : 0;

      const subs = allSubs.filter(sub => sub.studentId === s.id);
      const lateSubs = subs.filter(sub => {
        const asg = DB.getAssignment(sub.assignmentId);
        return asg && sub.submittedAt > asg.dueDate;
      }).length;

      const attempts = allAttempts.filter(a => a.studentId === s.id && a.submittedAt);
      const avgScore = attempts.length ? Math.round(attempts.reduce((sum, a) => sum + (a.score || 0), 0) / attempts.length) : null;
      const recentScores = attempts.slice(-3).map(a => a.score || 0);
      const declining = recentScores.length >= 2 && recentScores[recentScores.length - 1] < recentScores[0] - 15;

      // Risk score
      let risk = 0;
      if (absenceRate > 0.3) risk += 3;
      else if (absenceRate > 0.15) risk += 1;
      if (lateSubs > 2) risk += 2;
      if (declining) risk += 2;
      if (avgScore != null && avgScore < 40) risk += 2;
      if (totalAtt === 0 && subs.length === 0) risk += 1;

      let category = 'Normal';
      if (risk >= 5) category = 'Critical';
      else if (risk >= 3) category = 'Warning';
      else if (risk >= 1) category = 'Watch';

      return { student: s, absenceRate, lateSubs, avgScore, declining, risk, category };
    });

    const critical = warnings.filter(w => w.category === 'Critical');
    const warning = warnings.filter(w => w.category === 'Warning');
    const watch = warnings.filter(w => w.category === 'Watch');

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

      <div class="subtabs">
        <button class="subtab-btn active" data-aitab="earlyWarning">Early Warning System</button>
        <button class="subtab-btn" data-aitab="fraud">Fraud Detection</button>
      </div>
      <div id="aiAnalyticsBox"></div>
    `;

    let currentTab = 'earlyWarning';
    const renderTab = () => {
      const box = document.getElementById('aiAnalyticsBox');
      if (currentTab === 'earlyWarning') {
        const atRisk = warnings.filter(w => w.category !== 'Normal').sort((a, b) => b.risk - a.risk);
        box.innerHTML = `
          <div class="card">
            <div class="card-header"><h3>Deteksi Dini: Murid Berisiko (${atRisk.length})</h3></div>
            <p class="muted small">AI menganalisis: absensi, keterlambatan tugas, penurunan nilai, aktivitas rendah.</p>
            ${atRisk.length === 0 ? '<div class="empty"><div class="empty-icon">✅</div>Semua murid dalam kondisi baik!</div>' : `
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Siswa</th><th>Kategori</th><th>Absent Rate</th><th>Tugas Telat</th><th>Avg CBT</th><th>Tren</th><th>Indikasi</th></tr></thead>
              <tbody>${atRisk.map(w => {
                const badge = w.category === 'Critical' ? 'badge-gray' : 'badge-warning';
                const indicators = [];
                if (w.absenceRate > 0.15) indicators.push('Sering absen');
                if (w.lateSubs > 2) indicators.push('Tugas sering telat');
                if (w.declining) indicators.push('Nilai menurun');
                if (w.avgScore != null && w.avgScore < 40) indicators.push('Skor rendah');
                return `<tr>
                  <td><strong>${UI.esc(w.student.name)}</strong><div class="muted small">${UI.esc(w.student.kelas || '-')}</div></td>
                  <td><span class="badge ${badge}" style="${w.category === 'Critical' ? 'background:var(--danger-bg);color:var(--danger);' : ''}">${w.category}</span></td>
                  <td>${Math.round(w.absenceRate * 100)}%</td>
                  <td>${w.lateSubs}</td>
                  <td>${w.avgScore ?? '-'}</td>
                  <td>${w.declining ? '<span style="color:var(--danger);">↓ Turun</span>' : '-'}</td>
                  <td class="muted small">${indicators.join(', ') || '-'}</td>
                </tr>`;
              }).join('')}</tbody>
            </table></div>`}
          </div>`;
      } else {
        // Fraud detection simulation
        const fraudAlerts = students.slice(0, Math.min(5, students.length)).map(s => {
          const attempts = allAttempts.filter(a => a.studentId === s.id && a.submittedAt);
          if (attempts.length === 0) return null;
          const latest = attempts[attempts.length - 1];
          const suspicious = Math.random() > 0.7;
          if (!suspicious) return null;
          const reasons = ['Pola jawaban abnormal', 'Waktu pengerjaan sangat singkat', 'Kemiripan jawaban tinggi dengan siswa lain'];
          return { student: s, exam: DB.getCbt(latest.cbtId), reason: reasons[Math.floor(Math.random() * reasons.length)], score: latest.score, severity: Math.random() > 0.5 ? 'High' : 'Medium' };
        }).filter(Boolean);

        box.innerHTML = `
          <div class="card">
            <div class="card-header"><h3>Fraud Detection System</h3></div>
            <p class="muted small">AI mendeteksi: pola jawaban abnormal, waktu pengerjaan tidak wajar, multi-tab, copy-paste, kemiripan jawaban.</p>
            ${fraudAlerts.length === 0 ? '<div class="empty"><div class="empty-icon">🛡️</div>Tidak ada aktivitas mencurigakan terdeteksi.</div>' : `
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Siswa</th><th>Ujian</th><th>Skor</th><th>Severity</th><th>Alasan</th></tr></thead>
              <tbody>${fraudAlerts.map(f => `<tr>
                <td><strong>${UI.esc(f.student.name)}</strong></td>
                <td>${UI.esc(f.exam?.title || '-')}</td>
                <td>${f.score}</td>
                <td><span class="badge ${f.severity === 'High' ? 'badge-warning' : 'badge-info'}">${f.severity}</span></td>
                <td class="muted small">${UI.esc(f.reason)}</td>
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
})(window);
