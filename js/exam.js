/* ===== Exam Runner =====
 * Menjalankan ujian CBT bagi siswa:
 *   1. Halaman pembuka: judul, deskripsi/petunjuk, ringkasan bagian
 *   2. Pemeriksaan keamanan: kamera, mikrofon, dan berbagi layar (bila diminta)
 *   3. Pengerjaan per subtest secara berurutan (PU -> PPU -> PBM -> ...)
 *   4. Hasil akhir + rincian skor tiap subtest
 *
 * PERBAIKAN BUG PENTING (lanjut subtest dianggap pelanggaran):
 *   Sebelumnya konfirmasi memakai window.confirm(). Dialog bawaan browser itu
 *   memicu event "blur" DAN memaksa browser keluar dari layar penuh, sehingga
 *   satu klik "Lanjut" tercatat sebagai dua pelanggaran. Sekarang konfirmasi
 *   memakai dialog di dalam halaman (askConfirm) dan setiap aksi yang memang
 *   disengaja dibungkus Guard.suppress() supaya tidak dihitung pelanggaran.
 *
 * Catatan kejujuran teknis: proteksi anti-salin/anti-tangkapan-layar di
 * peramban bersifat PENCEGAH (deterrent). Alat tingkat sistem operasi, kamera
 * ponsel, atau ekstensi tertentu tetap tidak dapat diblokir sepenuhnya oleh
 * kode web mana pun. Karena itu setiap upaya dicatat sebagai pelanggaran agar
 * pengawas dapat menindaklanjuti.
 */
(function (global) {

  /* ===== Sumber daya aktif ===== */
  let mediaStream = null;      // kamera + mikrofon
  let screenStream = null;     // berbagi layar
  let audioCtx = null;
  let micRaf = null;
  let proctorPip = null;
  let lockEl = null;
  const listeners = [];

  /* ===== Penjaga pelanggaran =====
   * suppressUntil: selama tenggang ini, perubahan fokus/layar penuh yang
   * kita sebabkan sendiri tidak dihitung sebagai pelanggaran.
   */
  const Guard = {
    armed: false,
    suppressUntil: 0,
    intentionalExit: false,
    suppress(ms) { this.suppressUntil = Date.now() + (ms == null ? 1500 : ms); },
    get suppressed() { return Date.now() < this.suppressUntil; }
  };

  function stopMedia() {
    if (micRaf) { cancelAnimationFrame(micRaf); micRaf = null; }
    if (audioCtx) { try { audioCtx.close(); } catch (e) { /* noop */ } audioCtx = null; }
    [mediaStream, screenStream].forEach(s => {
      if (!s) return;
      s.getTracks().forEach(t => { try { t.stop(); } catch (e) { /* noop */ } });
    });
    mediaStream = null;
    screenStream = null;
    if (proctorPip) { proctorPip.remove(); proctorPip = null; }
  }

  function detachListeners() {
    listeners.forEach(({ target, type, fn, opts }) => target.removeEventListener(type, fn, opts));
    listeners.length = 0;
  }
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    listeners.push({ target, type, fn, opts });
  }

  function cleanup() {
    Guard.armed = false;
    stopMedia();
    detachListeners();
    if (lockEl) { lockEl.remove(); lockEl = null; }
    document.body.classList.remove('exam-mode', 'exam-nocopy', 'exam-blurred');
  }

  /** Level suara 0-100 dari stream mikrofon. */
  function startMicMeter(stream, onLevel) {
    try {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC || !stream.getAudioTracks().length) return;
      if (audioCtx) { try { audioCtx.close(); } catch (e) { /* noop */ } }
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
    } catch (e) { /* meter bersifat opsional */ }
  }

  /* =====================================================================
   * Dialog konfirmasi di dalam halaman
   * Menggantikan window.confirm agar tidak memicu blur / keluar layar penuh.
   * ===================================================================*/
  function askConfirm(message, opts) {
    const o = opts || {};
    return new Promise(resolve => {
      const back = document.createElement('div');
      back.className = 'exam-ask-back';
      back.innerHTML = `
        <div class="exam-ask" role="alertdialog" aria-modal="true">
          <div class="ea-ic">${o.icon || '❓'}</div>
          <div class="ea-msg">${UI.esc(message)}</div>
          <div class="ea-actions">
            <button type="button" class="btn btn-secondary" data-no>${UI.esc(o.cancelText || 'Batal')}</button>
            <button type="button" class="btn ${o.danger ? 'btn-danger' : 'btn-success'}" data-yes>${UI.esc(o.okText || 'Lanjutkan')}</button>
          </div>
        </div>`;
      document.body.appendChild(back);
      const done = (val) => {
        back.remove();
        // Beri tenggang: fokus berpindah kembali ke halaman ujian
        Guard.suppress(800);
        resolve(val);
      };
      back.querySelector('[data-yes]').addEventListener('click', () => done(true));
      back.querySelector('[data-no]').addEventListener('click', () => done(false));
      back.addEventListener('click', (e) => { if (e.target === back) done(false); });
      setTimeout(() => {
        const btn = back.querySelector('[data-yes]');
        if (btn) btn.focus();
      }, 50);
    });
  }

  /* =====================================================================
   * Entry point
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

  /** Gabungkan pengaturan keamanan ujian dengan bawaan sistem. */
  function secOf(cbt) {
    const d = (DB.getSettings().examSecurityDefaults) || {};
    return Object.assign({
      requireCamera: false, requireMic: false, requireScreenShare: false,
      fullscreen: false, blockTabSwitch: true, blockCopy: true,
      blockScreenshot: true, lockScreen: true, maxViolations: 3
    }, d, cbt.security || {});
  }

  /** Durasi satu bagian dalam menit, tahan terhadap data lama/impor. */
  function secMinutes(section, cbt) {
    const v = Number(section && (section.durationMinutes != null ? section.durationMinutes : section.minutes));
    if (v > 0) return v;
    const total = Number(cbt && cbt.durationMinutes);
    return total > 0 ? total : 30;
  }

  /* =====================================================================
   * 1) Halaman pembuka
   * ===================================================================*/
  function renderIntro(cbt, user, sections, existing, onFinish) {
    const content = document.getElementById('content');
    const totalQ = sections.reduce((n, s) => n + s.questionIds.length, 0);
    const totalMin = sections.reduce((n, s) => n + secMinutes(s, cbt), 0);
    const sec = secOf(cbt);
    const now = Date.now();
    const notOpen = now < cbt.startAt;
    const closed = now > cbt.endAt;

    const rules = [
      sec.requireCamera && '<strong>Kamera wajib aktif.</strong> Pratinjau kamera tampil di sudut layar selama ujian.',
      sec.requireMic && '<strong>Mikrofon wajib aktif.</strong> Tingkat suara di sekitar Anda dipantau.',
      sec.requireScreenShare && '<strong>Berbagi layar wajib aktif.</strong> Pilih <em>Seluruh Layar</em> saat diminta; menghentikan berbagi akan mengunci ujian.',
      sec.fullscreen && '<strong>Mode layar penuh.</strong> Jika keluar, ujian terkunci hingga Anda kembali.',
      sec.blockTabSwitch && `<strong>Dilarang berpindah tab/aplikasi.</strong> Maksimal ${sec.maxViolations} pelanggaran sebelum peringatan keras.`,
      sec.blockCopy && '<strong>Menyalin soal dinonaktifkan.</strong> Klik kanan, seleksi teks, dan pintasan salin diblokir.',
      sec.blockScreenshot && '<strong>Tangkapan layar dipantau.</strong> Tombol Print Screen dicatat dan papan klip dikosongkan.'
    ].filter(Boolean);

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
          ${cbt.description ? `<div class="eh-desc">${RichText.render(cbt.description)}</div>` : ''}
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
                  <div class="sr-meta">${s.questionIds.length} soal • ${secMinutes(s, cbt)} menit</div>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>

        ${rules.length ? `
        <div class="card">
          <div class="card-header">${UI.secHead('🔒', 'Ketentuan Keamanan Ujian', 'Wajib dipenuhi sebelum ujian dimulai')}</div>
          <ul class="exam-rules">${rules.map(r => `<li>${r}</li>`).join('')}</ul>
          <div class="alert alert-info mt-2">
            Tidak ada rekaman video/audio/layar yang dikirim maupun disimpan. Sistem hanya mencatat
            <em>kejadian</em> pelanggaran untuk dilihat pengawas.
          </div>
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
      if (sec.requireCamera || sec.requireMic || sec.requireScreenShare) {
        renderMediaCheck(cbt, user, sections, existing, onFinish);
      } else {
        beginExam(cbt, user, sections, existing, onFinish);
      }
    });
    if (global.Effects) Effects.enhance(content);
  }

  /* =====================================================================
   * 2) Pemeriksaan perangkat (kamera / mikrofon / berbagi layar)
   * ===================================================================*/
  function renderMediaCheck(cbt, user, sections, existing, onFinish) {
    const content = document.getElementById('content');
    const sec = secOf(cbt);
    const needCam = !!sec.requireCamera;
    const needMic = !!sec.requireMic;
    const needScreen = !!sec.requireScreenShare;

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
              ${needScreen ? `
              <div class="cam-frame mt-2" id="scrFrame" style="aspect-ratio:16/9;">
                <div class="cam-ph" id="scrPh">🖥️<br>Menunggu izin berbagi layar…</div>
                <video id="scrVideo" autoplay playsinline muted class="hidden"></video>
              </div>` : ''}
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
              <div class="perm-row">
                <span>🖥️ Berbagi Layar</span>
                <span class="pr-st ${needScreen ? 'wait' : 'ok'}" id="stScr">${needScreen ? 'MENUNGGU' : 'TIDAK WAJIB'}</span>
              </div>
              ${needMic ? `
              <div style="margin:12px 0 4px;font-size:12px;font-weight:600;color:var(--gray-600);">Level suara sekitar</div>
              <div class="mic-meter"><span id="micBar"></span></div>
              <p class="muted small mt-1">Coba berbicara — indikator harus bergerak.</p>` : ''}

              <div id="permMsg" class="alert alert-info mt-2">
                Klik tombol di bawah, lalu pilih <strong>Izinkan / Allow</strong> pada notifikasi browser.
                ${needScreen ? 'Untuk berbagi layar, pilih <strong>Seluruh Layar</strong> (bukan tab saja).' : ''}
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

    const setStatus = (id, text, cls) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = text;
      el.className = 'pr-st ' + cls;
    };

    askBtn.addEventListener('click', async () => {
      askBtn.disabled = true;
      askBtn.innerHTML = '<span class="spinner"></span> Meminta izin…';
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Browser ini tidak mendukung akses kamera/mikrofon.');
        }
        /* --- Kamera & mikrofon --- */
        if (needCam || needMic) {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: needCam ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } : false,
            audio: needMic
          });
          if (needCam) {
            const v = document.getElementById('camVideo');
            v.srcObject = mediaStream;
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
            startMicMeter(mediaStream, (lv) => { if (bar) bar.style.width = lv + '%'; });
          }
        }

        /* --- Berbagi layar --- */
        if (needScreen) {
          if (!navigator.mediaDevices.getDisplayMedia) {
            throw new Error('Browser ini tidak mendukung berbagi layar. Gunakan Chrome/Edge/Firefox versi terbaru di laptop.');
          }
          screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
          const track = screenStream.getVideoTracks()[0];
          const settings = (track && track.getSettings) ? track.getSettings() : {};
          // Bila browser melaporkan jenis permukaan, pastikan seluruh layar
          if (settings.displaySurface && settings.displaySurface !== 'monitor') {
            screenStream.getTracks().forEach(t => t.stop());
            screenStream = null;
            throw new Error('Anda hanya membagikan sebagian (tab/jendela). Ulangi dan pilih "Seluruh Layar".');
          }
          const sv = document.getElementById('scrVideo');
          if (sv) {
            sv.srcObject = screenStream;
            sv.classList.remove('hidden');
            const ph = document.getElementById('scrPh');
            if (ph) ph.classList.add('hidden');
          }
          setStatus('stScr', 'AKTIF', 'ok');
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
        if (needScreen) setStatus('stScr', 'DITOLAK', 'no');
        const needList = [needCam && 'kamera', needMic && 'mikrofon', needScreen && 'berbagi layar'].filter(Boolean).join(', ');
        msg.className = 'alert alert-error mt-2';
        msg.innerHTML = `Gagal mengakses perangkat: <strong>${UI.esc(err.message || 'izin ditolak')}</strong>.<br>
          Ujian ini mewajibkan ${UI.esc(needList)} aktif. Periksa izin situs pada browser Anda lalu coba lagi.`;
      }
    });

    goBtn.addEventListener('click', () => beginExam(cbt, user, sections, existing, onFinish));
    if (global.Effects) Effects.enhance(content);
  }

  /* =====================================================================
   * Acak deterministik (agar urutan tidak berubah saat render ulang)
   * ===================================================================*/
  function seededShuffle(arr, seedStr) {
    let h = 2166136261;
    for (let i = 0; i < seedStr.length; i++) {
      h ^= seedStr.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const rand = () => {
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
      return ((h >>> 0) % 100000) / 100000;
    };
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /* =====================================================================
   * Penilaian per format soal
   * ===================================================================*/
  function normalizeText(s) {
    return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  }
  function asNumber(s) {
    const t = String(s == null ? '' : s).trim().replace(/\s/g, '').replace(',', '.');
    const n = Number(t);
    return isFinite(n) ? n : null;
  }

  /** @returns {{auto:boolean, correct:boolean}} */
  function gradeQuestion(q, ans) {
    const f = q.questionType || 'Pilihan Ganda';
    if (f === 'Esai') return { auto: false, correct: false };

    if (f === 'Pilihan Lebih dari Satu') {
      const key = (q.correctIndices || []).slice().sort((a, b) => a - b).join(',');
      const got = (Array.isArray(ans) ? ans.slice() : []).sort((a, b) => a - b).join(',');
      return { auto: true, correct: key !== '' && key === got };
    }
    if (f === 'Isian Singkat') {
      const accepted = q.answers || [];
      if (!accepted.length || ans == null || ans === '') return { auto: true, correct: false };
      if (q.numeric) {
        const gv = asNumber(ans);
        return { auto: true, correct: gv != null && accepted.some(a => asNumber(a) === gv) };
      }
      return { auto: true, correct: accepted.some(a => normalizeText(a) === normalizeText(ans)) };
    }
    if (f === 'Majemuk Kompleks') {
      const st = q.statements || [];
      if (!st.length || !Array.isArray(ans)) return { auto: true, correct: false };
      return { auto: true, correct: st.every((s, i) => ans[i] === !!s.value) };
    }
    if (f === 'Menjodohkan') {
      const pairs = q.pairs || [];
      if (!pairs.length || !Array.isArray(ans)) return { auto: true, correct: false };
      return { auto: true, correct: pairs.every((p, i) => normalizeText(ans[i]) === normalizeText(p.right)) };
    }
    if (f === 'Urutan') {
      const items = q.orderItems || [];
      if (!items.length || !Array.isArray(ans)) return { auto: true, correct: false };
      return { auto: true, correct: items.every((it, i) => normalizeText(ans[i]) === normalizeText(it)) };
    }
    // Pilihan Ganda & Benar/Salah
    return { auto: true, correct: ans === q.correctIndex };
  }

  function isAnswered(q, ans) {
    const f = q.questionType || 'Pilihan Ganda';
    if (f === 'Esai' || f === 'Isian Singkat') return !!(ans && String(ans).trim());
    if (f === 'Pilihan Lebih dari Satu') return Array.isArray(ans) && ans.length > 0;
    if (f === 'Majemuk Kompleks') return Array.isArray(ans) && ans.some(v => v === true || v === false);
    if (f === 'Menjodohkan') return Array.isArray(ans) && ans.some(v => v);
    if (f === 'Urutan') return Array.isArray(ans) && ans.length > 0;
    return ans != null;
  }

  /* =====================================================================
   * 3) Pengerjaan
   * ===================================================================*/
  function beginExam(cbt, user, sections, existing, onFinish) {
    const sec = secOf(cbt);

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

    Guard.armed = true;
    Guard.suppress(2500);       // tenggang saat ujian baru dibuka
    document.body.classList.add('exam-mode');

    /* ---- Lapis keamanan ---- */
    if (sec.blockCopy) enableAntiCopy();
    if (sec.blockScreenshot) enableAntiScreenshot();
    if (mediaStream) attachPip(sec);
    if (sec.fullscreen) requestFullscreen();
    watchFullscreen();
    if (sec.blockTabSwitch) watchFocus();
    if (screenStream) watchScreenShare();
    watchNavigation();

    paintSection();

    /* =================== Keamanan =================== */
    function requestFullscreen() {
      const el = document.documentElement;
      const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (!fn) return;
      Guard.suppress(1800);
      try {
        const p = fn.call(el);
        if (p && p.catch) p.catch(() => { /* butuh gestur pengguna */ });
      } catch (e) { /* diabaikan */ }
    }

    function watchFullscreen() {
      on(document, 'fullscreenchange', () => {
        if (!Guard.armed) return;
        const inFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
        if (inFs) { hideLock(); return; }
        if (Guard.intentionalExit || Guard.suppressed) return;   // bukan pelanggaran
        if (!sec.fullscreen) return;
        logViolation('Keluar dari mode layar penuh');
        if (sec.lockScreen) showLock('Ujian keluar dari mode layar penuh.',
          'Klik tombol di bawah untuk kembali ke layar penuh dan melanjutkan ujian.');
      });
    }

    function watchFocus() {
      on(document, 'visibilitychange', () => {
        if (!Guard.armed || Guard.suppressed) return;
        if (document.hidden) {
          logViolation('Meninggalkan halaman ujian (pindah tab/aplikasi)');
          // Samarkan konten: tangkapan layar saat tak fokus tidak berguna
          document.body.classList.add('exam-blurred');
          if (sec.lockScreen) showLock('Anda meninggalkan halaman ujian.',
            'Kembali ke ujian untuk melanjutkan. Kejadian ini tercatat oleh pengawas.');
        } else {
          document.body.classList.remove('exam-blurred');
        }
      });
      on(global, 'blur', () => {
        if (!Guard.armed || Guard.suppressed) return;
        document.body.classList.add('exam-blurred');
      });
      on(global, 'focus', () => {
        document.body.classList.remove('exam-blurred');
      });
    }

    function watchScreenShare() {
      const track = screenStream && screenStream.getVideoTracks()[0];
      if (!track) return;
      track.addEventListener('ended', () => {
        if (!Guard.armed) return;
        logViolation('Berbagi layar dihentikan');
        if (sec.lockScreen) showLock('Berbagi layar telah dihentikan.',
          'Ujian ini mewajibkan berbagi layar. Mulai ulang berbagi layar untuk melanjutkan.', 'rescreen');
      });
    }

    function watchNavigation() {
      // Peringatkan bila mencoba menutup / memuat ulang halaman ujian
      on(global, 'beforeunload', (e) => {
        if (!Guard.armed) return;
        e.preventDefault();
        e.returnValue = 'Ujian masih berlangsung. Yakin ingin keluar?';
        return e.returnValue;
      });
    }

    function enableAntiCopy() {
      document.body.classList.add('exam-nocopy');
      const block = (e) => {
        // Input jawaban tetap boleh diketik & dipilih
        if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        e.preventDefault();
        return false;
      };
      on(document, 'contextmenu', block);
      on(document, 'selectstart', block);
      on(document, 'dragstart', block);
      on(document, 'copy', (e) => {
        if (e.target.closest && e.target.closest('input, textarea')) return;
        e.preventDefault();
        try { e.clipboardData.setData('text/plain', ''); } catch (err) { /* noop */ }
        logViolation('Mencoba menyalin isi soal');
        flashWarn('Menyalin soal tidak diizinkan.');
      });
      on(document, 'cut', (e) => {
        if (e.target.closest && e.target.closest('input, textarea')) return;
        e.preventDefault();
      });
    }

    function enableAntiScreenshot() {
      on(document, 'keyup', (e) => {
        if (!Guard.armed) return;
        if (e.key === 'PrintScreen' || e.code === 'PrintScreen') {
          clearClipboard();
          logViolation('Menekan tombol Print Screen');
          flashWarn('Tangkapan layar tidak diizinkan. Kejadian ini dicatat.');
        }
      });
      on(document, 'keydown', (e) => {
        if (!Guard.armed) return;
        const k = (e.key || '').toLowerCase();
        const ctrl = e.ctrlKey || e.metaKey;
        // Pintasan devtools & simpan/cetak halaman
        const devtools = (e.key === 'F12') ||
          (ctrl && e.shiftKey && ['i', 'j', 'c'].includes(k));
        const saveOrPrint = ctrl && ['s', 'p', 'u'].includes(k);
        const selectAll = ctrl && ['a', 'c', 'x'].includes(k) &&
          !(e.target.closest && e.target.closest('input, textarea'));
        if (devtools || saveOrPrint) {
          e.preventDefault();
          logViolation(devtools ? 'Mencoba membuka alat pengembang' : 'Mencoba menyimpan/mencetak halaman ujian');
          flashWarn('Tindakan ini diblokir selama ujian.');
          return false;
        }
        if (selectAll) { e.preventDefault(); return false; }
        // Windows: Win+Shift+S (Snipping Tool)
        if (e.shiftKey && k === 's' && e.metaKey) {
          logViolation('Mencoba tangkapan layar (Win+Shift+S)');
          flashWarn('Tangkapan layar dicatat oleh pengawas.');
        }
      });
    }

    function clearClipboard() {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText('');
      } catch (e) { /* butuh izin; diabaikan */ }
    }

    /* ---- Overlay kunci ujian ---- */
    function showLock(title, body, mode) {
      if (lockEl) lockEl.remove();
      lockEl = document.createElement('div');
      lockEl.className = 'exam-lock';
      lockEl.innerHTML = `
        <div class="el-box">
          <div class="el-ic">🔒</div>
          <h3>${UI.esc(title)}</h3>
          <p>${UI.esc(body)}</p>
          <button class="btn btn-success" id="elResume">
            ${mode === 'rescreen' ? '🖥️ Mulai Berbagi Layar Lagi' : '↩ Lanjutkan Ujian'}
          </button>
          <p class="el-note">Waktu ujian tetap berjalan selama layar terkunci.</p>
        </div>`;
      document.body.appendChild(lockEl);
      document.getElementById('elResume').addEventListener('click', async () => {
        Guard.suppress(1800);
        if (mode === 'rescreen') {
          try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
            watchScreenShare();
          } catch (e) {
            flashWarn('Berbagi layar masih belum aktif.');
            return;
          }
        }
        if (sec.fullscreen) requestFullscreen();
        hideLock();
      });
    }
    function hideLock() {
      if (lockEl) { lockEl.remove(); lockEl = null; }
      document.body.classList.remove('exam-blurred');
    }

    /* ---- Pencatatan pelanggaran ---- */
    function logViolation(type) {
      DB.addCbtViolation(attempt.id, { type });
      const fresh = DB.getCbtAttempts().find(a => a.id === attempt.id);
      const count = fresh ? (fresh.violations || []).length : 0;
      const max = sec.maxViolations || 3;
      showViolationBanner(count >= max
        ? `⚠️ Peringatan keras! ${count} pelanggaran tercatat dan dilaporkan ke pengawas.`
        : `⚠️ Terdeteksi: ${type}. Pelanggaran ${count}/${max}.`);
      if (count === max) {
        const admins = DB.getUsers().filter(u => u.role === 'admin').map(u => u.id);
        const cids = (cbt.courseIds && cbt.courseIds.length) ? cbt.courseIds : (cbt.courseId ? [cbt.courseId] : []);
        const teachers = cids.flatMap(id => DB.courseTeacherIds(DB.getCourse(id)));
        DB.notifyUsers([...new Set([...admins, ...teachers])], {
          type: 'cbt', icon: '🚨',
          title: 'Pelanggaran ujian terdeteksi',
          body: `${user.name} mencatat ${count} pelanggaran pada ujian ${cbt.title}.`,
          link: 'admin-cbt'
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
    function flashWarn(text) { showViolationBanner('🚫 ' + text); }

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
          ${screenStream ? '<span title="Berbagi layar aktif">🖥️</span>' : ''}
        </div>`;
      document.body.appendChild(proctorPip);
      if (secCfg.requireCamera) {
        const pv = proctorPip.querySelector('#pipVideo');
        if (pv) pv.srcObject = mediaStream;
      }
      if (secCfg.requireMic) {
        const mini = proctorPip.querySelector('#pipMic');
        startMicMeter(mediaStream, (lv) => { if (mini) mini.style.width = lv + '%'; });
      }
    }

    /* =================== Render bagian =================== */
    function paintSection() {
      const content = document.getElementById('content');
      const section = sections[sectionIndex];
      const st = DB.subtestByName(section.subtest);
      const questions = section.questionIds.map(id => DB.getQuestion(id)).filter(Boolean);
      sectionDeadline = Date.now() + secMinutes(section, cbt) * 60000;

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
              <div class="muted small">${questions.length} soal • ${secMinutes(section, cbt)} menit • ${UI.esc(cbt.title)}</div>
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

      bindQuestions(questions);

      document.getElementById('exNextSection').addEventListener('click', async () => {
        const unanswered = questions.filter(q => !isAnswered(q, answers[q.id])).length;
        const last = sectionIndex === sections.length - 1;
        const msg = unanswered
          ? `Masih ada ${unanswered} soal belum dijawab. ${last ? 'Kirim jawaban sekarang?' : 'Lanjut ke subtest berikutnya?'}`
          : (last ? 'Kirim seluruh jawaban sekarang?' : 'Lanjut ke subtest berikutnya? Anda tidak dapat kembali.');
        // Dialog dalam halaman: tidak memicu blur / keluar layar penuh
        Guard.suppress(3000);
        const ok = await askConfirm(msg, { okText: last ? 'Kirim Jawaban' : 'Lanjut', icon: last ? '📤' : '➡️' });
        if (!ok) return;
        Guard.suppress(2000);
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
          Guard.suppress(2000);
          advance();
        }
      };
      if (timer) clearInterval(timer);
      tick();
      timer = setInterval(tick, 1000);

      refreshProgress(questions);
      if (global.Effects) Effects.enhance(content);
      if (global.Responsive) Responsive.apply(content);
    }

    function refreshProgress(questions) {
      const answered = questions.filter(q => isAnswered(q, answers[q.id])).length;
      const p = document.getElementById('exProgress');
      if (p) p.textContent = `Terjawab ${answered}/${questions.length}`;
      document.querySelectorAll('[data-jump]').forEach(b => {
        const q = questions[Number(b.dataset.jump)];
        b.classList.toggle('answered', isAnswered(q, answers[q.id]));
      });
    }

    /* ---- Blok soal per format ---- */
    function questionBlock(q, i) {
      const st = DB.subtestByName(q.subject);
      const f = q.questionType || 'Pilihan Ganda';
      const seed = attempt.id + '|' + q.id;
      let body = '';

      if (f === 'Esai') {
        body = `<textarea class="ex-essay" data-essay="${i}" rows="6"
                  placeholder="Tulis jawaban Anda…">${UI.esc(answers[q.id] || '')}</textarea>`;
      } else if (f === 'Isian Singkat') {
        body = `<input type="text" class="ex-short" data-short="${i}"
                  value="${UI.esc(answers[q.id] || '')}" placeholder="Tulis jawaban singkat…" autocomplete="off" />`;
      } else if (f === 'Pilihan Lebih dari Satu') {
        const picked = new Set(Array.isArray(answers[q.id]) ? answers[q.id] : []);
        body = `<div class="option-list">
          ${(q.options || []).map((opt, oi) => `
            <label class="option-item ${picked.has(oi) ? 'selected' : ''}" data-multi="${i}" data-o="${oi}">
              <input type="checkbox" ${picked.has(oi) ? 'checked' : ''} />
              <span class="letter">${String.fromCharCode(65 + oi)}.</span>
              <span class="rt-content">${RichText.render(opt)}</span>
            </label>`).join('')}
        </div>
        <div class="muted small mt-1">Boleh memilih lebih dari satu jawaban.</div>`;
      } else if (f === 'Majemuk Kompleks') {
        const vals = Array.isArray(answers[q.id]) ? answers[q.id] : [];
        body = `<div class="table-wrap"><table class="table ex-cplx">
          <thead><tr><th>Pernyataan</th><th>Benar</th><th>Salah</th></tr></thead>
          <tbody>
            ${(q.statements || []).map((s, si) => `
              <tr>
                <td class="rt-content">${RichText.render(s.text)}</td>
                <td class="ct"><input type="radio" name="cplx_${i}_${si}" data-cplx="${i}" data-si="${si}" data-val="1" ${vals[si] === true ? 'checked' : ''} /></td>
                <td class="ct"><input type="radio" name="cplx_${i}_${si}" data-cplx="${i}" data-si="${si}" data-val="0" ${vals[si] === false ? 'checked' : ''} /></td>
              </tr>`).join('')}
          </tbody></table></div>`;
      } else if (f === 'Menjodohkan') {
        const pairs = q.pairs || [];
        const rights = seededShuffle(pairs.map(p => p.right), seed);
        const vals = Array.isArray(answers[q.id]) ? answers[q.id] : [];
        body = `<div class="ex-match">
          ${pairs.map((p, pi) => `
            <div class="em-row">
              <div class="em-left rt-content">${pi + 1}. ${RichText.render(p.left)}</div>
              <select class="em-sel" data-match="${i}" data-pi="${pi}">
                <option value="">— pilih —</option>
                ${rights.map(r => `<option value="${UI.esc(r)}" ${vals[pi] === r ? 'selected' : ''}>${UI.esc(RichText.plain(r))}</option>`).join('')}
              </select>
            </div>`).join('')}
        </div>`;
      } else if (f === 'Urutan') {
        const saved = Array.isArray(answers[q.id]) && answers[q.id].length
          ? answers[q.id]
          : seededShuffle(q.orderItems || [], seed);
        body = `<ol class="ex-order" data-order="${i}">
          ${saved.map(it => `
            <li class="eo-item" data-val="${UI.esc(it)}">
              <span class="eo-text rt-content">${RichText.render(it)}</span>
              <span class="eo-btns">
                <button type="button" class="btn btn-sm btn-secondary" data-ord-up title="Naik">↑</button>
                <button type="button" class="btn btn-sm btn-secondary" data-ord-down title="Turun">↓</button>
              </span>
            </li>`).join('')}
        </ol>
        <div class="muted small">Susun dari atas ke bawah sesuai urutan yang benar.</div>`;
      } else {
        // Pilihan Ganda & Benar/Salah
        const opts = (f === 'Benar/Salah' && !(q.options || []).length) ? ['Benar', 'Salah'] : (q.options || []);
        body = `<div class="option-list">
          ${opts.map((opt, oi) => `
            <label class="option-item ${answers[q.id] === oi ? 'selected' : ''}" data-single="${i}" data-o="${oi}">
              <input type="radio" name="exq_${i}" ${answers[q.id] === oi ? 'checked' : ''} />
              <span class="letter">${String.fromCharCode(65 + oi)}.</span>
              <span class="rt-content">${RichText.render(opt)}</span>
            </label>`).join('')}
        </div>`;
      }

      return `
        <div class="question-card" id="exq-${i}">
          <div class="qc-tags mb-1">
            <span class="qc-chip sub">${st ? st.icon : '📘'} ${UI.esc(st ? st.short : (q.subject || 'Umum'))}</span>
            <span class="qc-chip type">${UI.esc(f)}</span>
            <span class="qc-chip d-${UI.esc((q.difficulty || 'sedang').toLowerCase())}">${UI.esc((q.difficulty || 'sedang').toUpperCase())}</span>
          </div>
          <div class="q-text"><span class="q-num">${i + 1}</span><span class="rt-content">${RichText.render(q.text)}</span></div>
          ${body}
        </div>`;
    }

    /* ---- Pengikatan jawaban ---- */
    function bindQuestions(questions) {
      const content = document.getElementById('content');
      const save = () => { persist(); refreshProgress(questions); };

      // Pilihan tunggal
      content.querySelectorAll('[data-single]').forEach(el => el.addEventListener('click', (e) => {
        e.preventDefault();
        const qi = Number(el.dataset.single);
        const oi = Number(el.dataset.o);
        content.querySelectorAll(`[data-single="${qi}"]`).forEach(x => {
          x.classList.remove('selected');
          const r = x.querySelector('input'); if (r) r.checked = false;
        });
        el.classList.add('selected');
        const r = el.querySelector('input'); if (r) r.checked = true;
        answers[questions[qi].id] = oi;
        save();
      }));

      // Pilihan ganda kompleks (checkbox)
      content.querySelectorAll('[data-multi]').forEach(el => el.addEventListener('click', (e) => {
        e.preventDefault();
        const qi = Number(el.dataset.multi);
        const oi = Number(el.dataset.o);
        const qid = questions[qi].id;
        const cur = new Set(Array.isArray(answers[qid]) ? answers[qid] : []);
        if (cur.has(oi)) cur.delete(oi); else cur.add(oi);
        answers[qid] = [...cur].sort((a, b) => a - b);
        el.classList.toggle('selected', cur.has(oi));
        const cb = el.querySelector('input'); if (cb) cb.checked = cur.has(oi);
        save();
      }));

      // Esai & isian singkat
      content.querySelectorAll('[data-essay]').forEach(ta => ta.addEventListener('input', () => {
        answers[questions[Number(ta.dataset.essay)].id] = ta.value;
        save();
      }));
      content.querySelectorAll('[data-short]').forEach(inp => inp.addEventListener('input', () => {
        answers[questions[Number(inp.dataset.short)].id] = inp.value;
        save();
      }));

      // Majemuk kompleks
      content.querySelectorAll('[data-cplx]').forEach(r => r.addEventListener('change', () => {
        const qi = Number(r.dataset.cplx);
        const si = Number(r.dataset.si);
        const qid = questions[qi].id;
        const arr = Array.isArray(answers[qid]) ? answers[qid].slice() : [];
        arr[si] = r.dataset.val === '1';
        answers[qid] = arr;
        save();
      }));

      // Menjodohkan
      content.querySelectorAll('[data-match]').forEach(sel => sel.addEventListener('change', () => {
        const qi = Number(sel.dataset.match);
        const pi = Number(sel.dataset.pi);
        const qid = questions[qi].id;
        const arr = Array.isArray(answers[qid]) ? answers[qid].slice() : [];
        arr[pi] = sel.value;
        answers[qid] = arr;
        save();
      }));

      // Urutan
      content.querySelectorAll('[data-order]').forEach(list => {
        const qi = Number(list.dataset.order);
        const qid = questions[qi].id;
        const sync = () => {
          answers[qid] = [...list.querySelectorAll('.eo-item')].map(li => li.dataset.val);
          save();
        };
        list.querySelectorAll('[data-ord-up]').forEach(b => b.addEventListener('click', () => {
          const li = b.closest('.eo-item');
          if (li.previousElementSibling) li.parentNode.insertBefore(li, li.previousElementSibling);
          sync();
        }));
        list.querySelectorAll('[data-ord-down]').forEach(b => b.addEventListener('click', () => {
          const li = b.closest('.eo-item');
          if (li.nextElementSibling) li.parentNode.insertBefore(li.nextElementSibling, li);
          sync();
        }));
        // Simpan urutan awal (hasil pengacakan) agar konsisten
        if (!Array.isArray(answers[qid]) || !answers[qid].length) sync();
      });

      // Navigasi soal
      content.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => {
        const el = document.getElementById('exq-' + b.dataset.jump);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }));
    }

    function persist() {
      DB.updateCbtAttempt(attempt.id, { answers, currentSection: sectionIndex });
    }

    /** Nilai bagian aktif, lalu lanjut atau kirim. */
    function advance() {
      if (timer) clearInterval(timer);
      const section = sections[sectionIndex];
      const questions = section.questionIds.map(id => DB.getQuestion(id)).filter(Boolean);

      let correct = 0, scorable = 0, essays = 0;
      questions.forEach(q => {
        const g = gradeQuestion(q, answers[q.id]);
        if (!g.auto) { essays++; return; }
        scorable++;
        if (g.correct) correct++;
      });
      const score = scorable ? Math.round((correct / scorable) * 100) : 0;

      const fresh = DB.getCbtAttempts().find(a => a.id === attempt.id) || attempt;
      const sectionScores = (fresh.sectionScores || []).filter(s => s.subtest !== section.subtest);
      sectionScores.push({
        subtest: section.subtest, correct, total: scorable, score, essayCount: essays
      });

      if (sectionIndex < sections.length - 1) {
        sectionIndex++;
        DB.updateCbtAttempt(attempt.id, { answers, sectionScores, currentSection: sectionIndex });
        UI.toast(`Bagian selesai. Lanjut ke bagian ${sectionIndex + 1}.`, 'success');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // Pastikan tetap layar penuh setelah pindah bagian
        Guard.suppress(1500);
        if (sec.fullscreen && !document.fullscreenElement) requestFullscreen();
        paintSection();
        return;
      }
      submitAll(sectionScores);
    }

    function submitAll(sectionScores) {
      const allQ = sections.flatMap(s => s.questionIds).map(id => DB.getQuestion(id)).filter(Boolean);
      let correct = 0, scorable = 0;
      allQ.forEach(q => {
        const g = gradeQuestion(q, answers[q.id]);
        if (!g.auto) return;
        scorable++;
        if (g.correct) correct++;
      });
      const score = scorable ? Math.round((correct / scorable) * 100) : 0;

      DB.updateCbtAttempt(attempt.id, {
        answers, score, correctCount: correct, totalCount: scorable,
        sectionScores, currentSection: sections.length, submittedAt: Date.now()
      });

      DB.notifyStudentAndParents(user.id, {
        type: 'cbt', icon: '🖥️',
        title: 'Ujian CBT selesai',
        body: `${cbt.title} — skor ${score} (${correct}/${scorable} benar).`,
        link: 'cbt'
      }, { title: `${user.name} menyelesaikan ujian`, link: 'anak-nilai' });

      // Keluar layar penuh secara sengaja: jangan dihitung pelanggaran
      Guard.intentionalExit = true;
      Guard.armed = false;
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => { /* noop */ });
      }
      cleanup();
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
                ${qs.map((q, qi) => reviewBlock(q, qi, attempt)).join('')}
              </div>`;
          }).join('')}
        </div>
      </div>`;

    document.getElementById('resBack').addEventListener('click', () => Dashboard.navigate('cbt'));
    if (global.Effects) Effects.enhance(content);
    if (global.Responsive) Responsive.apply(content);
  }

  /** Satu blok pembahasan, menyesuaikan format soal. */
  function reviewBlock(q, qi, attempt) {
    const ans = attempt.answers ? attempt.answers[q.id] : null;
    const f = q.questionType || 'Pilihan Ganda';
    const g = gradeQuestion(q, ans);
    const head = `
      <div class="q-text"><span class="q-num">${qi + 1}</span><span class="rt-content">${RichText.render(q.text)}</span></div>
      <div class="qc-tags mb-1">
        <span class="qc-chip type">${UI.esc(f)}</span>
        ${g.auto ? `<span class="qc-chip ${g.correct ? 'd-mudah' : 'd-sulit'}">${g.correct ? 'BENAR' : 'BELUM TEPAT'}</span>`
                 : '<span class="qc-chip">DINILAI MANUAL</span>'}
      </div>`;
    let body = '';

    if (f === 'Esai') {
      body = `<div class="muted small">Jawaban Anda:</div>
        <div class="content" style="white-space:pre-wrap;">${UI.esc(ans || '(tidak dijawab)')}</div>
        <div class="alert alert-info mt-1">Soal esai dinilai manual oleh guru.</div>`;
    } else if (f === 'Isian Singkat') {
      body = `<div class="ex-review-line"><span class="muted small">Jawaban Anda:</span> <strong>${UI.esc(ans || '(kosong)')}</strong></div>
        <div class="ex-review-line"><span class="muted small">Kunci:</span> <strong>${UI.esc((q.answers || []).join(' / '))}</strong></div>`;
    } else if (f === 'Pilihan Lebih dari Satu') {
      const picked = new Set(Array.isArray(ans) ? ans : []);
      const key = new Set(q.correctIndices || []);
      body = `<div class="option-list">
        ${(q.options || []).map((opt, oi) => {
          let cls = '';
          if (key.has(oi)) cls = 'correct';
          else if (picked.has(oi)) cls = 'incorrect';
          return `<div class="option-item ${cls}">
            <span class="letter">${String.fromCharCode(65 + oi)}.</span>
            <span class="rt-content">${RichText.render(opt)}</span>
            ${picked.has(oi) ? '<span class="badge badge-info" style="margin-left:auto;">pilihan Anda</span>' : ''}
          </div>`;
        }).join('')}
      </div>`;
    } else if (f === 'Majemuk Kompleks') {
      const vals = Array.isArray(ans) ? ans : [];
      body = `<div class="table-wrap"><table class="table">
        <thead><tr><th>Pernyataan</th><th>Jawaban Anda</th><th>Kunci</th></tr></thead>
        <tbody>${(q.statements || []).map((s, si) => `
          <tr>
            <td class="rt-content">${RichText.render(s.text)}</td>
            <td>${vals[si] == null ? '<span class="muted">—</span>' : (vals[si] ? 'Benar' : 'Salah')}</td>
            <td><strong>${s.value ? 'Benar' : 'Salah'}</strong></td>
          </tr>`).join('')}</tbody></table></div>`;
    } else if (f === 'Menjodohkan') {
      const vals = Array.isArray(ans) ? ans : [];
      body = `<div class="table-wrap"><table class="table">
        <thead><tr><th>Kiri</th><th>Jawaban Anda</th><th>Kunci</th></tr></thead>
        <tbody>${(q.pairs || []).map((p, pi) => `
          <tr>
            <td class="rt-content">${RichText.render(p.left)}</td>
            <td>${vals[pi] ? UI.esc(RichText.plain(vals[pi])) : '<span class="muted">—</span>'}</td>
            <td><strong>${UI.esc(RichText.plain(p.right))}</strong></td>
          </tr>`).join('')}</tbody></table></div>`;
    } else if (f === 'Urutan') {
      const vals = Array.isArray(ans) ? ans : [];
      body = `<div class="table-wrap"><table class="table">
        <thead><tr><th>#</th><th>Urutan Anda</th><th>Urutan Benar</th></tr></thead>
        <tbody>${(q.orderItems || []).map((it, oi) => `
          <tr>
            <td>${oi + 1}</td>
            <td>${vals[oi] ? UI.esc(RichText.plain(vals[oi])) : '<span class="muted">—</span>'}</td>
            <td><strong>${UI.esc(RichText.plain(it))}</strong></td>
          </tr>`).join('')}</tbody></table></div>`;
    } else {
      const opts = (f === 'Benar/Salah' && !(q.options || []).length) ? ['Benar', 'Salah'] : (q.options || []);
      body = `<div class="option-list">
        ${opts.map((opt, oi) => {
          let cls = '';
          if (oi === q.correctIndex) cls = 'correct';
          else if (oi === ans) cls = 'incorrect';
          return `<div class="option-item ${cls}">
            <span class="letter">${String.fromCharCode(65 + oi)}.</span>
            <span class="rt-content">${RichText.render(opt)}</span>
          </div>`;
        }).join('')}
      </div>`;
    }

    return `<div class="question-card">
      ${head}${body}
      ${q.explanation ? `<div class="alert alert-info mt-2"><strong>Pembahasan:</strong> <span class="rt-content">${RichText.render(q.explanation)}</span></div>` : ''}
    </div>`;
  }

  global.Exam = { start, showResult, cleanup, gradeQuestion, askConfirm };
})(window);
