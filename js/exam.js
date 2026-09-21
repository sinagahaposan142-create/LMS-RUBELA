/* ===== Exam Runner =====
 * Menjalankan ujian CBT bagi siswa:
 *   1. Halaman pembuka: judul, deskripsi/petunjuk, ringkasan bagian
 *   2. Pemeriksaan keamanan: izin kamera & mikrofon (bila diwajibkan)
 *   3. Pengerjaan per subtest secara berurutan (PU → PPU → PBM → ...)
 *   4. Hasil akhir + rincian skor tiap subtest
 *
 * Catatan privasi: stream kamera/mikrofon hanya dipakai lokal untuk pratinjau
 * dan indikator level suara. Tidak ada media yang diunggah/disimpan — sistem
 * hanya mencatat kejadian pelanggaran (pindah tab, keluar layar penuh).
 */
(function (global) {

  /* Media aktif agar bisa dimatikan saat ujian selesai */
  let mediaStream = null;
  let audioCtx = null;
  let micRaf = null;
  let proctorPip = null;
  const listeners = [];

  function stopMedia() {
    if (micRaf) { cancelAnimationFrame(micRaf); micRaf = null; }
    if (audioCtx) { try { audioCtx.close(); } catch (e) { /* noop */ } audioCtx = null; }
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => { try { t.stop(); } catch (e) { /* noop */ } });
      mediaStream = null;
    }
    if (proctorPip) { proctorPip.remove(); proctorPip = null; }
  }

  function detachListeners() {
    listeners.forEach(({ target, type, fn }) => target.removeEventListener(type, fn));
    listeners.length = 0;
  }
  function on(target, type, fn) {
    target.addEventListener(type, fn);
    listeners.push({ target, type, fn });
  }

  function cleanup() { stopMedia(); detachListeners(); }

  /** Level suara 0-100 dari stream mikrofon. */
  function startMicMeter(stream, onLevel) {
    try {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
      const src = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        onLevel(Math.min(100, Math.round((sum / data.length) * 1.6)));
        micRaf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) { /* mic meter opsional */ }
  }

  /* =====================================================================
   * Entry point — dipanggil dari panel siswa
   * ===================================================================*/
  function start(cbt, user, onFinish) {
    const sections = DB.cbtSections(cbt);
    if (sections.length === 0) {
      UI.toast('Ujian ini belum memiliki soal.', 'error');
      return;
    }
    const existing = DB.getCbtAttemptByStudent(cbt.id, user.id);
    if (existing && existing.submittedAt) {
      showResult(cbt, existing);
      return;
    }
    renderIntro(cbt, user, sections, existing, onFinish);
  }

  /* =====================================================================
   * 1) Halaman pembuka + deskripsi
   * ===================================================================*/
  function renderIntro(cbt, user, sections, existing, onFinish) {
    const content = document.getElementById('content');
    const totalQ = sections.reduce((n, s) => n + s.questionIds.length, 0);
    const totalMin = sections.reduce((n, s) => n + (s.durationMinutes || 0), 0);
    const sec = cbt.security || {};
    const now = Date.now();
    const notOpen = now < cbt.startAt;
    const closed = now > cbt.endAt;

    content.innerHTML = `
      <div class="exam-shell">
        <button class="btn btn-secondary btn-sm mb-2" id="exBack">← Kembali ke daftar ujian</button>

        <section class="exam-intro-hero">
          <h2>${UI.esc(cbt.title)}</h2>
          <div class="muted small" style="color:rgba(255,255,255,.85);">
            ${cbt.subtestMode === 'full' ? 'Simulasi Gabungan 7 Subtest UTBK'
              : (cbt.subtestMode === 'single' ? 'Ujian 1 Subtest' : 'Ujian Custom')}
            • ${UI.esc(DB.cbtTargetLabel(cbt))}
          </div>
          ${cbt.description ? `<div class="eh-desc">${UI.esc(cbt.description)}</div>` : ''}
          <div class="exam-meta-grid">
            <div class="emi"><div class="k">Jumlah Soal</div><div class="v">${totalQ} soal</div></div>
            <div class="emi"><div class="k">Total Durasi</div><div class="v">${totalMin} menit</div></div>
            <div class="emi"><div class="k">Bagian</div><div class="v">${sections.length} subtest</div></div>
            <div class="emi"><div class="k">Ditutup</div><div class="v">${UI.fmtDateTime(cbt.endAt)}</div></div>
          </div>
        </section>

        <div class="card">
          <div class="card-header">${UI.secHead('📋', 'Urutan Pengerjaan', 'Bagian dikerjakan berurutan dan tidak dapat diulang')}</div>
          <div class="sec-list">
            ${sections.map((s, i) => {
              const st = DB.subtestByName(s.subtest);
              return `<div class="sec-row">
                <div class="sr-ord">${i + 1}</div>
                <div class="sr-nm">${st ? st.icon : '📘'} ${UI.esc(s.subtest)}
                  <div class="sr-meta">${s.questionIds.length} soal • ${s.durationMinutes} menit</div>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>

        ${(sec.requireCamera || sec.requireMic || sec.fullscreen || sec.blockTabSwitch) ? `
        <div class="card">
          <div class="card-header">${UI.secHead('🔒', 'Ketentuan Keamanan Ujian', 'Wajib dipenuhi sebelum ujian dimulai')}</div>
          <ul style="margin:0;padding-left:20px;font-size:13.5px;line-height:1.9;color:var(--gray-700);">
            ${sec.requireCamera ? '<li><strong>Kamera wajib aktif.</strong> Pratinjau kamera tampil di sudut layar selama ujian.</li>' : ''}
            ${sec.requireMic ? '<li><strong>Mikrofon wajib aktif.</strong> Indikator level suara dipantau selama ujian.</li>' : ''}
            ${sec.fullscreen ? '<li><strong>Mode layar penuh.</strong> Keluar dari layar penuh tercatat sebagai pelanggaran.</li>' : ''}
            ${sec.blockTabSwitch ? `<li><strong>Dilarang berpindah tab/aplikasi.</strong> Maksimal ${sec.maxViolations || 3} pelanggaran sebelum peringatan keras.</li>` : ''}
          </ul>
          <div class="alert alert-info mt-2">Tidak ada rekaman video atau audio yang dikirim maupun disimpan. Sistem hanya mencatat kejadian pelanggaran.</div>
        </div>` : ''}

        <div class="card" style="text-align:center;">
          ${notOpen ? `<div class="alert alert-warning">Ujian belum dibuka. Dibuka pada ${UI.fmtDateTime(cbt.startAt)}.</div>`
            : closed ? '<div class="alert alert-error">Ujian sudah ditutup.</div>'
            : `<button class="btn btn-success" id="exStart" style="padding:12px 28px;font-size:15px;">
                 ${existing ? '▶ Lanjutkan Ujian' : '▶ Mulai Ujian'}
               </button>
               <p class="muted small mt-1">Pastikan koneksi stabil. Waktu tiap bagian berjalan otomatis setelah dimulai.</p>`}
        </div>
      </div>`;

    document.getElementById('exBack').addEventListener('click', () => Dashboard.navigate('cbt'));
    const startBtn = document.getElementById('exStart');
    if (startBtn) startBtn.addEventListener('click', () => {
      if (sec.requireCamera || sec.requireMic) renderMediaCheck(cbt, user, sections, existing, onFinish);
      else beginExam(cbt, user, sections, existing, onFinish);
    });
  }

  /* =====================================================================
   * 2) Pemeriksaan kamera & mikrofon
   * ===================================================================*/
  function renderMediaCheck(cbt, user, sections, existing, onFinish) {
    const content = document.getElementById('content');
    const sec = cbt.security || {};
    const needCam = !!sec.requireCamera;
    const needMic = !!sec.requireMic;

    content.innerHTML = `
      <div class="exam-shell">
        <div class="card">
          <div class="card-header">${UI.secHead('🔐', 'Pemeriksaan Perangkat', 'Izinkan akses agar ujian dapat dimulai')}</div>
          <div class="media-check">
            <div>
              <div class="cam-frame" id="camFrame">
                <div class="cam-ph" id="camPh">${needCam ? '📷<br>Menunggu izin kamera…' : '📷<br>Kamera tidak diwajibkan'}</div>
                <video id="camVideo" autoplay playsinline muted class="hidden"></video>
              </div>
            </div>
            <div>
              <div class="perm-row">
                <span>📷 Kamera</span>
                <span class="pr-st ${needCam ? 'wait' : 'ok'}" id="stCam">${needCam ? 'MENUNGGU' : 'TIDAK WAJIB'}</span>
              </div>
              <div class="perm-row">
                <span>🎙️ Mikrofon</span>
                <span class="pr-st ${needMic ? 'wait' : 'ok'}" id="stMic">${needMic ? 'MENUNGGU' : 'TIDAK WAJIB'}</span>
              </div>
              ${needMic ? `
              <div style="margin:12px 0 4px;font-size:12px;font-weight:600;color:var(--gray-600);">Level suara sekitar</div>
              <div class="mic-meter"><span id="micBar"></span></div>
              <p class="muted small mt-1">Coba berbicara — indikator harus bergerak.</p>` : ''}

              <div id="permMsg" class="alert alert-info mt-2">
                Klik tombol di bawah, lalu pilih <strong>Izinkan / Allow</strong> pada notifikasi browser.
              </div>
              <div class="flex-gap">
                <button class="btn btn-primary" id="askPerm">🔓 Minta Izin Perangkat</button>
                <button class="btn btn-success hidden" id="goExam">▶ Lanjut ke Ujian</button>
              </div>
              <button class="btn btn-secondary btn-sm mt-2" id="camBack">← Batal</button>
            </div>
          </div>
        </div>
      </div>`;

    document.getElementById('camBack').addEventListener('click', () => {
      stopMedia();
      renderIntro(cbt, user, sections, existing, onFinish);
    });

    const askBtn = document.getElementById('askPerm');
    const goBtn = document.getElementById('goExam');
    const msg = document.getElementById('permMsg');

    askBtn.addEventListener('click', async () => {
      askBtn.disabled = true;
      askBtn.innerHTML = '<span class="spinner"></span> Meminta izin…';
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Browser ini tidak mendukung akses kamera/mikrofon.');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: needCam ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } : false,
          audio: needMic
        });
        mediaStream = stream;

        if (needCam) {
          const v = document.getElementById('camVideo');
          v.srcObject = stream;
          v.classList.remove('hidden');
          document.getElementById('camPh').classList.add('hidden');
          const frame = document.getElementById('camFrame');
          if (!frame.querySelector('.cam-rec')) {
            const rec = document.createElement('div');
            rec.className = 'cam-rec';
            rec.innerHTML = '<i></i> DIPANTAU';
            frame.appendChild(rec);
          }
          setStatus('stCam', 'AKTIF', 'ok');
        }
        if (needMic) {
          setStatus('stMic', 'AKTIF', 'ok');
          const bar = document.getElementById('micBar');
          startMicMeter(stream, (lv) => { if (bar) bar.style.width = lv + '%'; });
        }

        msg.className = 'alert alert-success mt-2';
        msg.innerHTML = '✅ Perangkat siap. Klik <strong>Lanjut ke Ujian</strong> untuk memulai.';
        askBtn.classList.add('hidden');
        goBtn.classList.remove('hidden');
      } catch (err) {
        askBtn.disabled = false;
        askBtn.innerHTML = '🔓 Coba Lagi';
        if (needCam) setStatus('stCam', 'DITOLAK', 'no');
        if (needMic) setStatus('stMic', 'DITOLAK', 'no');
        msg.className = 'alert alert-error mt-2';
        msg.innerHTML = `Gagal mengakses perangkat: <strong>${UI.esc(err.message || 'izin ditolak')}</strong>.<br>
          Ujian ini mewajibkan ${needCam && needMic ? 'kamera dan mikrofon' : (needCam ? 'kamera' : 'mikrofon')} aktif.
          Periksa izin situs pada browser Anda lalu coba lagi.`;
      }
    });

    goBtn.addEventListener('click', () => beginExam(cbt, user, sections, existing, onFinish));

    function setStatus(id, text, cls) {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = text;
      el.className = 'pr-st ' + cls;
    }
  }

  /* =====================================================================
   * 3) Pengerjaan berurutan per subtest
   * ===================================================================*/
  function beginExam(cbt, user, sections, existing, onFinish) {
    const sec = cbt.security || {};

    // Buat / ambil attempt
    let attempt = existing;
    if (!attempt) {
      attempt = DB.addCbtAttempt({
        cbtId: cbt.id, studentId: user.id, answers: {},
        startedAt: Date.now(), submittedAt: null, score: null,
        correctCount: null, totalCount: DB.cbtQuestionIds(cbt).length,
        currentSection: 0, sectionScores: [], violations: []
      });
    }
    const answers = Object.assign({}, attempt.answers || {});
    let sectionIndex = Math.min(attempt.currentSection || 0, sections.length - 1);
    let sectionDeadline = 0;
    let timer = null;

    // Pratinjau kamera menempel selama ujian
    if (mediaStream && (sec.requireCamera || sec.requireMic)) attachPip(sec);

    // Layar penuh
    if (sec.fullscreen) {
      const el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen().catch(() => { /* diabaikan */ });
      on(document, 'fullscreenchange', () => {
        if (!document.fullscreenElement) logViolation('Keluar dari mode layar penuh');
      });
    }
    // Deteksi pindah tab / aplikasi
    if (sec.blockTabSwitch) {
      on(document, 'visibilitychange', () => {
        if (document.hidden) logViolation('Meninggalkan halaman ujian (pindah tab/aplikasi)');
      });
      on(global, 'blur', () => logViolation('Jendela ujian kehilangan fokus'));
    }

    paintSection();

    /* ---- Pencatatan pelanggaran ---- */
    function logViolation(type) {
      DB.addCbtViolation(attempt.id, { type });
      const fresh = DB.getCbtAttempts().find(a => a.id === attempt.id);
      const count = fresh ? (fresh.violations || []).length : 0;
      const max = sec.maxViolations || 3;
      showViolationBanner(count >= max
        ? `⚠️ Peringatan keras! ${count} pelanggaran tercatat dan dilaporkan ke pengawas.`
        : `⚠️ Terdeteksi: ${type}. Pelanggaran ${count}/${max}.`);
      // Kabari pengawas (guru pengajar & admin) bila melewati batas
      if (count === max) {
        const admins = DB.getUsers().filter(u => u.role === 'admin').map(u => u.id);
        const cids = (cbt.courseIds && cbt.courseIds.length) ? cbt.courseIds : (cbt.courseId ? [cbt.courseId] : []);
        const teachers = cids.map(id => DB.getCourse(id)?.teacherId).filter(Boolean);
        DB.notifyUsers([...new Set([...admins, ...teachers])], {
          type: 'cbt', icon: '🚨',
          title: 'Pelanggaran ujian terdeteksi',
          body: `${user.name} mencatat ${count} pelanggaran pada ujian ${cbt.title}.`,
          link: user.role === 'admin' ? 'admin-cbt' : 'cbt'
        });
      }
    }

    function showViolationBanner(text) {
      const old = document.querySelector('.vio-banner');
      if (old) old.remove();
      const b = document.createElement('div');
      b.className = 'vio-banner';
      b.textContent = text;
      document.body.appendChild(b);
      setTimeout(() => b.remove(), 4200);
    }

    /* ---- Kamera menempel ---- */
    function attachPip(secCfg) {
      if (proctorPip) proctorPip.remove();
      proctorPip = document.createElement('div');
      proctorPip.className = 'proctor-pip';
      proctorPip.innerHTML = `
        ${secCfg.requireCamera ? '<video id="pipVideo" autoplay playsinline muted></video>' : ''}
        <div class="pip-bar">
          <span>● PANTAU</span>
          ${secCfg.requireMic ? '<span class="mic-mini"><span id="pipMic"></span></span>' : ''}
        </div>`;
      document.body.appendChild(proctorPip);
      if (secCfg.requireCamera) {
        const pv = proctorPip.querySelector('#pipVideo');
        if (pv) pv.srcObject = mediaStream;
      }
      if (secCfg.requireMic) {
        const mini = proctorPip.querySelector('#pipMic');
        // Meter dari media check mungkin sudah berjalan; mulai lagi bila perlu
        if (!audioCtx) startMicMeter(mediaStream, (lv) => { if (mini) mini.style.width = lv + '%'; });
        else {
          // Sambungkan ulang callback sederhana
          startMicMeter(mediaStream, (lv) => { if (mini) mini.style.width = lv + '%'; });
        }
      }
    }

    /* ---- Render satu bagian subtest ---- */
    function paintSection() {
      const content = document.getElementById('content');
      const section = sections[sectionIndex];
      const st = DB.subtestByName(section.subtest);
      const questions = section.questionIds.map(id => DB.getQuestion(id)).filter(Boolean);
      sectionDeadline = Date.now() + (section.durationMinutes || 20) * 60000;

      content.innerHTML = `
        <div class="exam-shell">
          <div class="exam-secbar">
            ${sections.map((s, i) => {
              const s2 = DB.subtestByName(s.subtest);
              const cls = i === sectionIndex ? 'is-now' : (i < sectionIndex ? 'is-done' : '');
              return `<span class="esb ${cls}">${i < sectionIndex ? '✓' : (s2 ? s2.icon : '📘')} ${UI.esc(s2 ? s2.short : s.subtest)}</span>`;
            }).join('')}
          </div>

          <div class="cbt-timer">
            <div>
              <strong>Bagian ${sectionIndex + 1}/${sections.length} — ${st ? st.icon + ' ' + UI.esc(st.name) : UI.esc(section.subtest)}</strong>
              <div class="muted small">${questions.length} soal • ${section.durationMinutes} menit • ${UI.esc(cbt.title)}</div>
            </div>
            <div class="time" id="exTime">--:--</div>
          </div>

          <div class="card">
            <div class="card-header"><h3>Navigasi Soal</h3>
              <span class="muted small" id="exProgress">Terjawab 0/${questions.length}</span>
            </div>
            <div class="q-nav" id="exNav">
              ${questions.map((_, i) => `<button type="button" data-jump="${i}">${i + 1}</button>`).join('')}
            </div>
          </div>

          <div id="exQuestions">
            ${questions.map((q, i) => questionBlock(q, i)).join('')}
          </div>

          <div class="card" style="text-align:center;">
            <button class="btn btn-success" id="exNextSection" style="padding:11px 24px;">
              ${sectionIndex < sections.length - 1 ? '➡ Selesai & Lanjut ke Subtest Berikutnya' : '✔ Selesai & Kirim Jawaban'}
            </button>
            <p class="muted small mt-1">
              ${sectionIndex < sections.length - 1
                ? 'Setelah lanjut, Anda tidak dapat kembali ke subtest ini.'
                : 'Pastikan semua soal telah dijawab sebelum mengirim.'}
            </p>
          </div>
        </div>`;

      // Prefill jawaban
      questions.forEach((q, i) => {
        if (answers[q.id] == null) return;
        if (q.questionType === 'Esai') {
          const ta = content.querySelector(`[data-essay="${i}"]`);
          if (ta) ta.value = answers[q.id];
        } else {
          const item = content.querySelector(`.option-item[data-q="${i}"][data-o="${answers[q.id]}"]`);
          if (item) {
            item.classList.add('selected');
            const r = item.querySelector('input');
            if (r) r.checked = true;
          }
        }
      });

      // Pilih opsi
      content.querySelectorAll('.option-item').forEach(el => el.addEventListener('click', (e) => {
        e.preventDefault();
        const qi = Number(el.dataset.q);
        const oi = Number(el.dataset.o);
        content.querySelectorAll(`.option-item[data-q="${qi}"]`).forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
        const r = el.querySelector('input');
        if (r) r.checked = true;
        answers[questions[qi].id] = oi;
        persist();
        refreshProgress();
      }));
      // Jawaban esai
      content.querySelectorAll('[data-essay]').forEach(ta => ta.addEventListener('input', () => {
        answers[questions[Number(ta.dataset.essay)].id] = ta.value;
        persist();
        refreshProgress();
      }));
      // Navigasi
      content.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => {
        const el = document.getElementById('exq-' + b.dataset.jump);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }));

      document.getElementById('exNextSection').addEventListener('click', () => {
        const unanswered = questions.filter(q => answers[q.id] == null || answers[q.id] === '').length;
        const last = sectionIndex === sections.length - 1;
        const msg = unanswered
          ? `Masih ada ${unanswered} soal belum dijawab. ${last ? 'Kirim jawaban sekarang?' : 'Lanjut ke subtest berikutnya?'}`
          : (last ? 'Kirim seluruh jawaban sekarang?' : 'Lanjut ke subtest berikutnya? Anda tidak dapat kembali.');
        if (!UI.confirmDialog(msg)) return;
        advance();
      });

      // Timer per bagian
      const timeEl = document.getElementById('exTime');
      const tick = () => {
        const remain = Math.max(0, sectionDeadline - Date.now());
        const m = Math.floor(remain / 60000);
        const s = Math.floor((remain % 60000) / 1000);
        timeEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        timeEl.classList.toggle('warn', remain < 300000 && remain >= 60000);
        timeEl.classList.toggle('danger', remain < 60000);
        if (remain <= 0) {
          clearInterval(timer);
          UI.toast('Waktu bagian ini habis — lanjut otomatis.', 'info');
          advance();
        }
      };
      if (timer) clearInterval(timer);
      tick();
      timer = setInterval(tick, 1000);

      refreshProgress();
      if (global.Effects) Effects.enhance(content);

      function refreshProgress() {
        const answered = questions.filter(q => answers[q.id] != null && answers[q.id] !== '').length;
        const p = document.getElementById('exProgress');
        if (p) p.textContent = `Terjawab ${answered}/${questions.length}`;
        content.querySelectorAll('[data-jump]').forEach(b => {
          const q = questions[Number(b.dataset.jump)];
          b.classList.toggle('answered', answers[q.id] != null && answers[q.id] !== '');
        });
      }
    }

    function questionBlock(q, i) {
      const st = DB.subtestByName(q.subject);
      const isEssay = q.questionType === 'Esai';
      return `
        <div class="question-card" id="exq-${i}">
          <div class="qc-tags mb-1">
            <span class="qc-chip sub">${st ? st.icon : '📘'} ${UI.esc(st ? st.short : (q.subject || 'Umum'))}</span>
            <span class="qc-chip type">${UI.esc(q.questionType || 'Pilihan Ganda')}</span>
            <span class="qc-chip d-${UI.esc((q.difficulty || 'sedang').toLowerCase())}">${UI.esc((q.difficulty || 'sedang').toUpperCase())}</span>
          </div>
          <div class="q-text"><span class="q-num">${i + 1}</span>${UI.esc(q.text)}</div>
          ${isEssay
            ? `<textarea data-essay="${i}" rows="5" placeholder="Tulis jawaban Anda..."
                 style="width:100%;padding:11px;border:1px solid var(--gray-300);border-radius:8px;font-family:inherit;font-size:14px;background:var(--surface);color:var(--gray-800);"></textarea>`
            : `<div class="option-list">
                ${(q.options || []).map((opt, oi) => `
                  <label class="option-item" data-q="${i}" data-o="${oi}">
                    <input type="radio" name="exq_${i}" value="${oi}" />
                    <span class="letter">${String.fromCharCode(65 + oi)}.</span>
                    <span>${UI.esc(opt)}</span>
                  </label>`).join('')}
              </div>`}
        </div>`;
    }

    function persist() {
      DB.updateCbtAttempt(attempt.id, { answers, currentSection: sectionIndex });
    }

    /** Nilai bagian aktif, lalu lanjut atau kirim. */
    function advance() {
      if (timer) clearInterval(timer);
      const section = sections[sectionIndex];
      const questions = section.questionIds.map(id => DB.getQuestion(id)).filter(Boolean);
      // Soal esai tidak diauto-nilai
      const scorable = questions.filter(q => q.questionType !== 'Esai');
      const correct = scorable.filter(q => answers[q.id] === q.correctIndex).length;
      const score = scorable.length ? Math.round((correct / scorable.length) * 100) : 0;

      const fresh = DB.getCbtAttempts().find(a => a.id === attempt.id) || attempt;
      const sectionScores = (fresh.sectionScores || []).filter(s => s.subtest !== section.subtest);
      sectionScores.push({
        subtest: section.subtest,
        correct, total: scorable.length, score,
        essayCount: questions.length - scorable.length
      });

      if (sectionIndex < sections.length - 1) {
        sectionIndex++;
        DB.updateCbtAttempt(attempt.id, { answers, sectionScores, currentSection: sectionIndex });
        UI.toast(`Bagian selesai. Lanjut ke bagian ${sectionIndex + 1}.`, 'success');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        paintSection();
        return;
      }
      submitAll(sectionScores);
    }

    function submitAll(sectionScores) {
      const allQ = sections.flatMap(s => s.questionIds).map(id => DB.getQuestion(id)).filter(Boolean);
      const scorable = allQ.filter(q => q.questionType !== 'Esai');
      const correct = scorable.filter(q => answers[q.id] === q.correctIndex).length;
      const score = scorable.length ? Math.round((correct / scorable.length) * 100) : 0;

      DB.updateCbtAttempt(attempt.id, {
        answers, score, correctCount: correct, totalCount: scorable.length,
        sectionScores, currentSection: sections.length, submittedAt: Date.now()
      });

      // Sinkron: kabari siswa & orang tua, serta guru pengajar
      DB.notifyStudentAndParents(user.id, {
        type: 'cbt', icon: '🖥️',
        title: 'Ujian CBT selesai',
        body: `${cbt.title} — skor ${score} (${correct}/${scorable.length} benar).`,
        link: 'cbt'
      }, { title: `${user.name} menyelesaikan ujian`, link: 'anak-nilai' });

      cleanup();
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => { /* noop */ });
      }
      UI.toast(`Ujian selesai. Skor akhir: ${score}`, 'success');
      const updated = DB.getCbtAttempts().find(a => a.id === attempt.id);
      showResult(cbt, updated);
      if (typeof onFinish === 'function') onFinish();
    }
  }

  /* =====================================================================
   * 4) Hasil + pembahasan per subtest
   * ===================================================================*/
  function showResult(cbt, attempt) {
    cleanup();
    const content = document.getElementById('content');
    const sections = DB.cbtSections(cbt);
    const scores = attempt.sectionScores || [];

    content.innerHTML = `
      <div class="exam-shell">
        <div class="card">
          <div class="score-display">
            <div class="score">${attempt.score ?? 0}</div>
            <div class="label">Skor Akhir — ${attempt.correctCount || 0} benar dari ${attempt.totalCount || 0} soal berbobot</div>
          </div>
          <div class="muted small" style="text-align:center;">
            ${UI.esc(cbt.title)} • dikerjakan ${UI.fmtDateTime(attempt.startedAt)} • dikirim ${UI.fmtDateTime(attempt.submittedAt)}
          </div>
          ${(attempt.violations || []).length ? `
            <div class="alert alert-warning mt-2">⚠️ Tercatat ${(attempt.violations || []).length} pelanggaran selama ujian. Pengawas dapat melihat rinciannya.</div>` : ''}
        </div>

        <div class="card">
          <div class="card-header">${UI.secHead('🧪', 'Skor per Subtest', 'Lihat subtest mana yang perlu diperkuat')}</div>
          ${scores.length === 0 ? '<div class="empty"><div class="empty-icon">📭</div>Tidak ada rincian subtest.</div>'
            : scores.slice().sort((a, b) => DB.subtestOrder(a.subtest) - DB.subtestOrder(b.subtest)).map(s => {
              const st = DB.subtestByName(s.subtest);
              return `<div style="margin-bottom:12px;">
                <div class="flex-between">
                  <strong style="font-size:13px;">${st ? st.icon : '📘'} ${UI.esc(s.subtest)}</strong>
                  <span class="muted small">${s.correct}/${s.total} benar${s.essayCount ? ` • ${s.essayCount} esai dinilai manual` : ''}</span>
                </div>
                ${UI.progressHtml(s.score, '', 'auto')}
              </div>`;
            }).join('')}
        </div>

        <div class="card">
          <div class="card-header">
            ${UI.secHead('📖', 'Pembahasan', 'Jawaban Anda dibandingkan kunci jawaban')}
            <button class="btn btn-secondary btn-sm" id="resBack">← Kembali</button>
          </div>
          ${sections.map((sc, si) => {
            const st = DB.subtestByName(sc.subtest);
            const qs = sc.questionIds.map(id => DB.getQuestion(id)).filter(Boolean);
            return `
              <div style="margin-bottom:22px;">
                <h4 style="margin:0 0 10px;">${si + 1}. ${st ? st.icon : '📘'} ${UI.esc(sc.subtest)}</h4>
                ${qs.map((q, qi) => {
                  const picked = attempt.answers ? attempt.answers[q.id] : null;
                  if (q.questionType === 'Esai') {
                    return `<div class="question-card">
                      <div class="q-text"><span class="q-num">${qi + 1}</span>${UI.esc(q.text)}</div>
                      <div class="muted small">Jawaban Anda:</div>
                      <div class="content" style="white-space:pre-wrap;">${UI.esc(picked || '(tidak dijawab)')}</div>
                      <div class="alert alert-info mt-1">Soal esai dinilai manual oleh guru.</div>
                    </div>`;
                  }
                  return `<div class="question-card">
                    <div class="q-text"><span class="q-num">${qi + 1}</span>${UI.esc(q.text)}</div>
                    <div class="option-list">
                      ${(q.options || []).map((opt, oi) => {
                        let cls = '';
                        if (oi === q.correctIndex) cls = 'correct';
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
              </div>`;
          }).join('')}
        </div>
      </div>`;

    document.getElementById('resBack').addEventListener('click', () => Dashboard.navigate('cbt'));
    if (global.Effects) Effects.enhance(content);
  }

  global.Exam = { start, showResult, cleanup };
})(window);
