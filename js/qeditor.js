/* ===== LMS Rubela - Editor Soal (halaman penuh) =====
 * Menggantikan form soal berbasis modal dengan ruang kerja satu layar penuh:
 *
 *  - Delapan format soal (pilihan ganda, pilihan ganda kompleks, benar/salah,
 *    isian singkat, esai, menjodohkan, pernyataan majemuk, dan urutan).
 *  - Editor teks kaya bergaya Word: tebal/miring/garis bawah, daftar, perataan,
 *    kutipan, kode, sub/superskrip, dan penyisipan tabel bergaya Excel.
 *  - Dukungan LaTeX untuk matematika, fisika, dan kimia lewat palet simbol
 *    serta dialog rumus, dengan pratinjau langsung.
 *  - Penyisipan gambar (unggah/URL, otomatis dikompresi), audio, dan tautan
 *    yang langsung ditampilkan sebagai pratinjau di halaman ujian.
 *
 * Catatan: toolbar memakai document.execCommand. API ini memang berstatus
 * deprecated, namun masih satu-satunya cara yang didukung seluruh browser
 * untuk contenteditable tanpa pustaka pihak ketiga.
 */
(function (global) {

  /* =====================================================================
   * Definisi format soal
   * ===================================================================*/
  const FORMATS = [
    { key: 'Pilihan Ganda', icon: '🔘', desc: 'Satu jawaban benar dari beberapa pilihan.', auto: true },
    { key: 'Pilihan Lebih dari Satu', icon: '☑️', desc: 'Beberapa jawaban benar sekaligus.', auto: true },
    { key: 'Benar/Salah', icon: '⚖️', desc: 'Pernyataan tunggal bernilai benar atau salah.', auto: true },
    { key: 'Isian Singkat', icon: '✏️', desc: 'Jawaban singkat berupa kata/angka, dinilai otomatis.', auto: true },
    { key: 'Majemuk Kompleks', icon: '🧩', desc: 'Beberapa pernyataan, tiap baris benar/salah.', auto: true },
    { key: 'Menjodohkan', icon: '🔗', desc: 'Pasangkan kolom kiri dengan kolom kanan.', auto: true },
    { key: 'Urutan', icon: '🔢', desc: 'Susun item ke urutan yang benar.', auto: true },
    { key: 'Esai', icon: '📝', desc: 'Jawaban uraian, dinilai manual oleh guru.', auto: false }
  ];

  /* Palet simbol LaTeX yang paling sering dipakai */
  /* =====================================================================
   * Mesin editor bersama (js/editor.js)
   * Toolbar, dialog rumus/simbol/tabel/gambar/audio/tautan, dan seluruh
   * penanganan seleksi dipusatkan di window.Editor agar Bank Soal, Materi,
   * Modul, dan Tugas memakai alat yang persis sama.
   * ===================================================================*/
  let wsEl = null;

  function esc(s) { return global.UI ? UI.esc(s) : String(s == null ? '' : s); }

  const toolbarHtml = (idPrefix, o) => Editor.toolbarHtml(idPrefix, o);
  /* =====================================================================
   * Pembangun jawaban per format
   * ===================================================================*/
  function answerBuilderHtml(draft) {
    const f = draft.questionType;
    const opts = draft.options || [];

    if (f === 'Esai') {
      return `
        <div class="alert alert-info">Soal esai dinilai manual oleh guru. Anda dapat menuliskan rambu-rambu penilaian pada kolom pembahasan.</div>
        <div class="form-group">
          <label>Kata kunci penilaian (opsional, pisahkan dengan koma)</label>
          <input id="qeKeywords" value="${esc((draft.keywords || []).join(', '))}" placeholder="mis. fotosintesis, klorofil, cahaya" />
        </div>`;
    }

    if (f === 'Benar/Salah') {
      return `
        <div class="form-group">
          <label>Kunci Jawaban</label>
          <div class="qe-tf">
            <label class="qe-radio ${draft.correctIndex === 0 ? 'on' : ''}"><input type="radio" name="qeTF" value="0" ${draft.correctIndex === 0 ? 'checked' : ''} /> ✔ Benar</label>
            <label class="qe-radio ${draft.correctIndex === 1 ? 'on' : ''}"><input type="radio" name="qeTF" value="1" ${draft.correctIndex === 1 ? 'checked' : ''} /> ✘ Salah</label>
          </div>
        </div>`;
    }

    if (f === 'Isian Singkat') {
      return `
        <div class="form-group">
          <label>Jawaban yang Diterima</label>
          <div id="qeAnsList" class="qe-list">
            ${(draft.answers && draft.answers.length ? draft.answers : ['']).map((a, i) => `
              <div class="qe-row" data-idx="${i}">
                <input class="qe-ans" value="${esc(a)}" placeholder="mis. 42 atau empat puluh dua" />
                <button type="button" class="btn btn-sm btn-danger" data-del-ans="${i}" title="Hapus">✕</button>
              </div>`).join('')}
          </div>
          <button type="button" class="btn btn-sm btn-secondary mt-1" id="qeAddAns">+ Tambah alternatif jawaban</button>
          <p class="muted small" style="margin:8px 0 0;">Penilaian tidak membedakan huruf besar/kecil dan spasi berlebih.</p>
        </div>
        <label class="qe-check"><input type="checkbox" id="qeNumeric" ${draft.numeric ? 'checked' : ''} /> Bandingkan sebagai angka (mis. 0,5 = 0.5)</label>`;
    }

    if (f === 'Majemuk Kompleks') {
      const st = draft.statements && draft.statements.length
        ? draft.statements : [{ text: '', value: true }, { text: '', value: false }];
      return `
        <div class="form-group">
          <label>Pernyataan (tandai Benar/Salah tiap baris)</label>
          <div id="qeStList" class="qe-list">
            ${st.map((s, i) => `
              <div class="qe-row st" data-idx="${i}">
                <input class="qe-st-text" value="${esc(s.text)}" placeholder="Pernyataan ${i + 1}" />
                <div class="qe-tf small">
                  <label class="qe-radio ${s.value ? 'on' : ''}"><input type="radio" name="qeSt${i}" value="1" ${s.value ? 'checked' : ''} /> B</label>
                  <label class="qe-radio ${!s.value ? 'on' : ''}"><input type="radio" name="qeSt${i}" value="0" ${!s.value ? 'checked' : ''} /> S</label>
                </div>
                <button type="button" class="btn btn-sm btn-danger" data-del-st="${i}" title="Hapus">✕</button>
              </div>`).join('')}
          </div>
          <button type="button" class="btn btn-sm btn-secondary mt-1" id="qeAddSt">+ Tambah pernyataan</button>
        </div>`;
    }

    if (f === 'Menjodohkan') {
      const pairs = draft.pairs && draft.pairs.length ? draft.pairs : [{ left: '', right: '' }, { left: '', right: '' }];
      return `
        <div class="form-group">
          <label>Pasangan Jawaban (kiri dijodohkan dengan kanan)</label>
          <div id="qePairList" class="qe-list">
            ${pairs.map((p, i) => `
              <div class="qe-row pair" data-idx="${i}">
                <input class="qe-pl" value="${esc(p.left)}" placeholder="Kiri ${i + 1}" />
                <span class="qe-arrow">→</span>
                <input class="qe-pr" value="${esc(p.right)}" placeholder="Kanan ${i + 1}" />
                <button type="button" class="btn btn-sm btn-danger" data-del-pair="${i}" title="Hapus">✕</button>
              </div>`).join('')}
          </div>
          <button type="button" class="btn btn-sm btn-secondary mt-1" id="qeAddPair">+ Tambah pasangan</button>
          <p class="muted small" style="margin:8px 0 0;">Saat ujian, kolom kanan otomatis diacak.</p>
        </div>`;
    }

    if (f === 'Urutan') {
      const items = draft.orderItems && draft.orderItems.length ? draft.orderItems : ['', ''];
      return `
        <div class="form-group">
          <label>Item dalam Urutan yang Benar</label>
          <div id="qeOrderList" class="qe-list">
            ${items.map((it, i) => `
              <div class="qe-row ord" data-idx="${i}">
                <span class="qe-ord-num">${i + 1}</span>
                <input class="qe-ord" value="${esc(it)}" placeholder="Langkah ${i + 1}" />
                <button type="button" class="btn btn-sm btn-secondary" data-up="${i}" title="Naik">↑</button>
                <button type="button" class="btn btn-sm btn-secondary" data-down="${i}" title="Turun">↓</button>
                <button type="button" class="btn btn-sm btn-danger" data-del-ord="${i}" title="Hapus">✕</button>
              </div>`).join('')}
          </div>
          <button type="button" class="btn btn-sm btn-secondary mt-1" id="qeAddOrd">+ Tambah item</button>
          <p class="muted small" style="margin:8px 0 0;">Urutan di atas adalah kunci. Saat ujian, item diacak.</p>
        </div>`;
    }

    /* Pilihan Ganda & Pilihan Lebih dari Satu */
    const multi = f === 'Pilihan Lebih dari Satu';
    const list = opts.length ? opts : ['', '', '', ''];
    const correctSet = new Set(multi
      ? (draft.correctIndices || [])
      : (draft.correctIndex != null ? [draft.correctIndex] : []));
    return `
      <div class="form-group">
        <label>Pilihan Jawaban ${multi ? '(centang semua yang benar)' : '(pilih satu kunci)'}</label>
        <div id="qeOptList" class="qe-list">
          ${list.map((o, i) => `
            <div class="qe-row opt" data-idx="${i}">
              <label class="qe-key ${correctSet.has(i) ? 'on' : ''}" title="Tandai sebagai kunci">
                <input type="${multi ? 'checkbox' : 'radio'}" name="qeKey" value="${i}" ${correctSet.has(i) ? 'checked' : ''} />
                <span class="qe-letter">${String.fromCharCode(65 + i)}</span>
              </label>
              <input class="qe-opt" value="${esc(o)}" placeholder="Pilihan ${String.fromCharCode(65 + i)}" />
              <button type="button" class="btn btn-sm btn-danger" data-del-opt="${i}" title="Hapus">✕</button>
            </div>`).join('')}
        </div>
        <button type="button" class="btn btn-sm btn-secondary mt-1" id="qeAddOpt">+ Tambah pilihan</button>
        <p class="muted small" style="margin:8px 0 0;">Pilihan mendukung rumus LaTeX, mis. <code>$\\frac{1}{2}$</code>.</p>
      </div>`;
  }

  /* =====================================================================
   * Editor utama
   * ===================================================================*/
  /**
   * Buka editor soal satu layar penuh.
   * @param {object} user     pengguna aktif (penulis soal)
   * @param {string|null} editId  id soal yang disunting, null untuk soal baru
   * @param {function} onSaved  callback setelah disimpan/ditutup
   * @param {object} opts     { bank: 'questions' | 'security', subtest: nama }
   */
  function open(user, editId, onSaved, opts) {
    const o = opts || {};
    const bank = o.bank === 'security' ? 'security' : 'questions';
    const existing = editId
      ? (bank === 'security'
          ? DB.getSecurityQuestions().find(q => q.id === editId)
          : DB.getQuestion(editId))
      : null;

    const draft = Object.assign({
      subject: o.subtest || (DB.SUBTESTS[0] && DB.SUBTESTS[0].name),
      subtest: o.subtest || (DB.SUBTESTS[0] && DB.SUBTESTS[0].name),
      questionType: 'Pilihan Ganda',
      difficulty: 'sedang',
      text: '',
      options: ['', '', '', ''],
      correctIndex: 0,
      correctIndices: [],
      answers: [''],
      numeric: false,
      statements: [],
      pairs: [],
      orderItems: [],
      keywords: [],
      explanation: ''
    }, existing || {});
    // Bank keamanan memakai field "subtest", bank soal utama memakai "subject"
    if (bank === 'security') draft.subject = draft.subtest || draft.subject;
    else draft.subtest = draft.subject;

    buildShell();
    paint();

    /* ---------- Rangka halaman ---------- */
    function buildShell() {
      close();   // pastikan tidak ada editor ganda
      wsEl = document.createElement('div');
      wsEl.className = 'qe-workspace';
      wsEl.innerHTML = `
        <div class="qe-top">
          <button class="btn btn-secondary btn-sm" id="qeBack">← Batal</button>
          <div class="qe-title">
            <strong id="qeHeading">${existing ? 'Edit Soal' : 'Tambah Soal'}</strong>
            <div class="muted small">${bank === 'security' ? 'Bank soal verifikasi login' : 'Bank soal ujian CBT'} • mendukung LaTeX, gambar, audio, dan tautan</div>
          </div>
          <div class="qe-top-actions">
            <button class="btn btn-secondary btn-sm" id="qePreviewToggle">👁 Pratinjau</button>
            <button class="btn btn-success btn-sm" id="qeSave">💾 Simpan Soal</button>
          </div>
        </div>
        <div class="qe-body">
          <div class="qe-main" id="qeMain"></div>
          <aside class="qe-side" id="qeSide"></aside>
        </div>`;
      document.body.appendChild(wsEl);
      document.body.style.overflow = 'hidden';

      wsEl.querySelector('#qeBack').addEventListener('click', () => {
        if (UI.confirmDialog('Tutup editor? Perubahan yang belum disimpan akan hilang.')) {
          close();
          if (typeof onSaved === 'function') onSaved(null);
        }
      });
      wsEl.querySelector('#qeSave').addEventListener('click', save);
      wsEl.querySelector('#qePreviewToggle').addEventListener('click', () => {
        wsEl.classList.toggle('show-preview');
      });
    }

    /* ---------- Render isi ---------- */
    function paint() {
      const main = wsEl.querySelector('#qeMain');
      const fmt = FORMATS.find(f => f.key === draft.questionType) || FORMATS[0];

      main.innerHTML = `
        <section class="qe-card">
          <h4 class="qe-h">1. Klasifikasi Soal</h4>
          <div class="form-row">
            <div class="form-group">
              <label>Subtest</label>
              <select id="qeSubtest">
                ${DB.SUBTESTS.map(s => `<option value="${esc(s.name)}" ${draft.subject === s.name ? 'selected' : ''}>${s.icon} ${esc(s.name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Tingkat Kesulitan</label>
              <select id="qeDiff">
                ${DB.DIFFICULTIES.map(d => `<option value="${d}" ${draft.difficulty === d ? 'selected' : ''}>${d.charAt(0).toUpperCase() + d.slice(1)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Format Soal</label>
            <div class="qe-fmt-grid">
              ${FORMATS.map(f => `
                <button type="button" class="qe-fmt ${draft.questionType === f.key ? 'on' : ''}" data-fmt="${esc(f.key)}">
                  <span class="qf-ic">${f.icon}</span>
                  <span class="qf-nm">${esc(f.key)}</span>
                  <span class="qf-ds">${esc(f.desc)}</span>
                  <span class="badge ${f.auto ? 'badge-success' : 'badge-warning'} qf-badge">${f.auto ? 'Otomatis' : 'Manual'}</span>
                </button>`).join('')}
            </div>
          </div>
        </section>

        <section class="qe-card">
          <h4 class="qe-h">2. Isi Pertanyaan</h4>
          ${toolbarHtml('qeText')}
          <div class="qe-editor" id="qeText" contenteditable="true" spellcheck="false"
               data-ph="Tulis pertanyaan di sini. Gunakan tombol ∑ Rumus untuk menyisipkan LaTeX…">${draft.text || ''}</div>
          <p class="muted small" style="margin:8px 0 0;">
            Tip: ketik <code>$...$</code> untuk rumus sebaris dan <code>$$...$$</code> untuk rumus blok.
          </p>
        </section>

        <section class="qe-card">
          <h4 class="qe-h">3. Kunci &amp; Pilihan Jawaban <span class="badge ${fmt.auto ? 'badge-success' : 'badge-warning'}">${fmt.auto ? 'Dinilai otomatis' : 'Dinilai manual'}</span></h4>
          <div id="qeAnswerBox">${answerBuilderHtml(draft)}</div>
        </section>

        <section class="qe-card">
          <h4 class="qe-h">4. Pembahasan <span class="muted small">(opsional)</span></h4>
          ${toolbarHtml('qeExp')}
          <div class="qe-editor short" id="qeExp" contenteditable="true" spellcheck="false"
               data-ph="Jelaskan langkah penyelesaian…">${draft.explanation || ''}</div>
        </section>
      `;
      bindMain();
      renderPreview();
    }

    /* ---------- Pengikatan kejadian ---------- */
    function bindMain() {
      const main = wsEl.querySelector('#qeMain');

      // Klasifikasi
      main.querySelector('#qeSubtest').addEventListener('change', (e) => {
        draft.subject = e.target.value;
        draft.subtest = e.target.value;
        renderPreview();
      });
      main.querySelector('#qeDiff').addEventListener('change', (e) => {
        draft.difficulty = e.target.value;
        renderPreview();
      });
      main.querySelectorAll('[data-fmt]').forEach(b => b.addEventListener('click', () => {
        if (draft.questionType === b.dataset.fmt) return;
        collect();                       // simpan isi sebelum ganti format
        draft.questionType = b.dataset.fmt;
        seedDefaultsForFormat();
        paint();
      }));

      // Editor teks kaya
      ['qeText', 'qeExp'].forEach(id => {
        const el = main.querySelector('#' + id);
        if (!el) return;
        const sync = () => {
          if (id === 'qeText') draft.text = el.innerHTML;
          else draft.explanation = el.innerHTML;
          renderPreview();
        };
        el.addEventListener('input', sync);
      });

      // Bilah alat & penanganan seleksi ditangani mesin editor bersama
      Editor.setHost(wsEl);
      Editor.attach(main, {
        onInput: (el) => {
          if (el.id === 'qeText') draft.text = el.innerHTML;
          else if (el.id === 'qeExp') draft.explanation = el.innerHTML;
          renderPreview();
        }
      });

      bindAnswerBox();
    }

    function bindAnswerBox() {
      const box = wsEl.querySelector('#qeAnswerBox');
      if (!box) return;
      const f = draft.questionType;

      // Pilihan ganda / lebih dari satu
      box.querySelectorAll('.qe-opt').forEach(inp => inp.addEventListener('input', () => { collect(); renderPreview(); }));
      box.querySelectorAll('[name="qeKey"]').forEach(r => r.addEventListener('change', () => {
        box.querySelectorAll('.qe-key').forEach(k => k.classList.toggle('on', k.querySelector('input').checked));
        collect(); renderPreview();
      }));
      const addOpt = box.querySelector('#qeAddOpt');
      if (addOpt) addOpt.addEventListener('click', () => {
        collect();
        if (draft.options.length >= 8) { UI.toast('Maksimal 8 pilihan.', 'info'); return; }
        draft.options.push('');
        paint();
      });
      box.querySelectorAll('[data-del-opt]').forEach(b => b.addEventListener('click', () => {
        collect();
        if (draft.options.length <= 2) { UI.toast('Minimal 2 pilihan.', 'info'); return; }
        const i = Number(b.dataset.delOpt);
        draft.options.splice(i, 1);
        if (f === 'Pilihan Lebih dari Satu') {
          draft.correctIndices = (draft.correctIndices || []).filter(x => x !== i).map(x => (x > i ? x - 1 : x));
        } else if (draft.correctIndex === i) draft.correctIndex = 0;
        else if (draft.correctIndex > i) draft.correctIndex--;
        paint();
      }));

      // Benar/Salah
      box.querySelectorAll('[name="qeTF"]').forEach(r => r.addEventListener('change', () => {
        draft.correctIndex = Number(r.value);
        box.querySelectorAll('.qe-radio').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
        renderPreview();
      }));

      // Isian singkat
      box.querySelectorAll('.qe-ans').forEach(i => i.addEventListener('input', () => { collect(); renderPreview(); }));
      const addAns = box.querySelector('#qeAddAns');
      if (addAns) addAns.addEventListener('click', () => { collect(); draft.answers.push(''); paint(); });
      box.querySelectorAll('[data-del-ans]').forEach(b => b.addEventListener('click', () => {
        collect();
        if (draft.answers.length <= 1) { UI.toast('Minimal satu jawaban.', 'info'); return; }
        draft.answers.splice(Number(b.dataset.delAns), 1);
        paint();
      }));
      const numeric = box.querySelector('#qeNumeric');
      if (numeric) numeric.addEventListener('change', () => { draft.numeric = numeric.checked; });

      // Pernyataan majemuk
      box.querySelectorAll('.qe-st-text').forEach(i => i.addEventListener('input', () => { collect(); renderPreview(); }));
      box.querySelectorAll('.qe-row.st [type="radio"]').forEach(r => r.addEventListener('change', () => {
        box.querySelectorAll('.qe-row.st .qe-radio').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
        collect(); renderPreview();
      }));
      const addSt = box.querySelector('#qeAddSt');
      if (addSt) addSt.addEventListener('click', () => {
        collect();
        draft.statements.push({ text: '', value: true });
        paint();
      });
      box.querySelectorAll('[data-del-st]').forEach(b => b.addEventListener('click', () => {
        collect();
        if (draft.statements.length <= 2) { UI.toast('Minimal 2 pernyataan.', 'info'); return; }
        draft.statements.splice(Number(b.dataset.delSt), 1);
        paint();
      }));

      // Menjodohkan
      box.querySelectorAll('.qe-pl, .qe-pr').forEach(i => i.addEventListener('input', () => { collect(); renderPreview(); }));
      const addPair = box.querySelector('#qeAddPair');
      if (addPair) addPair.addEventListener('click', () => { collect(); draft.pairs.push({ left: '', right: '' }); paint(); });
      box.querySelectorAll('[data-del-pair]').forEach(b => b.addEventListener('click', () => {
        collect();
        if (draft.pairs.length <= 2) { UI.toast('Minimal 2 pasangan.', 'info'); return; }
        draft.pairs.splice(Number(b.dataset.delPair), 1);
        paint();
      }));

      // Urutan
      box.querySelectorAll('.qe-ord').forEach(i => i.addEventListener('input', () => { collect(); renderPreview(); }));
      const addOrd = box.querySelector('#qeAddOrd');
      if (addOrd) addOrd.addEventListener('click', () => { collect(); draft.orderItems.push(''); paint(); });
      box.querySelectorAll('[data-del-ord]').forEach(b => b.addEventListener('click', () => {
        collect();
        if (draft.orderItems.length <= 2) { UI.toast('Minimal 2 item.', 'info'); return; }
        draft.orderItems.splice(Number(b.dataset.delOrd), 1);
        paint();
      }));
      box.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => {
        collect();
        const i = Number(b.dataset.up);
        if (i > 0) { const t = draft.orderItems[i - 1]; draft.orderItems[i - 1] = draft.orderItems[i]; draft.orderItems[i] = t; }
        paint();
      }));
      box.querySelectorAll('[data-down]').forEach(b => b.addEventListener('click', () => {
        collect();
        const i = Number(b.dataset.down);
        if (i < draft.orderItems.length - 1) { const t = draft.orderItems[i + 1]; draft.orderItems[i + 1] = draft.orderItems[i]; draft.orderItems[i] = t; }
        paint();
      }));

      // Kata kunci esai
      const kw = box.querySelector('#qeKeywords');
      if (kw) kw.addEventListener('input', () => {
        draft.keywords = kw.value.split(',').map(s => s.trim()).filter(Boolean);
      });
    }

    /** Isi nilai bawaan saat format berubah. */
    function seedDefaultsForFormat() {
      const f = draft.questionType;
      if (f === 'Pilihan Ganda' || f === 'Pilihan Lebih dari Satu') {
        if (!draft.options || draft.options.length < 2) draft.options = ['', '', '', ''];
      }
      if (f === 'Benar/Salah') {
        draft.options = ['Benar', 'Salah'];
        if (draft.correctIndex !== 0 && draft.correctIndex !== 1) draft.correctIndex = 0;
      }
      if (f === 'Isian Singkat' && (!draft.answers || !draft.answers.length)) draft.answers = [''];
      if (f === 'Majemuk Kompleks' && (!draft.statements || draft.statements.length < 2)) {
        draft.statements = [{ text: '', value: true }, { text: '', value: false }];
      }
      if (f === 'Menjodohkan' && (!draft.pairs || draft.pairs.length < 2)) {
        draft.pairs = [{ left: '', right: '' }, { left: '', right: '' }];
      }
      if (f === 'Urutan' && (!draft.orderItems || draft.orderItems.length < 2)) draft.orderItems = ['', ''];
    }

    /** Ambil semua nilai dari DOM ke draft. */
    function collect() {
      const main = wsEl.querySelector('#qeMain');
      if (!main) return;
      const textEl = main.querySelector('#qeText');
      const expEl = main.querySelector('#qeExp');
      if (textEl) draft.text = textEl.innerHTML;
      if (expEl) draft.explanation = expEl.innerHTML;

      const f = draft.questionType;
      const box = main.querySelector('#qeAnswerBox');
      if (!box) return;

      if (f === 'Pilihan Ganda' || f === 'Pilihan Lebih dari Satu') {
        draft.options = [...box.querySelectorAll('.qe-opt')].map(i => i.value);
        const checked = [...box.querySelectorAll('[name="qeKey"]')].filter(r => r.checked).map(r => Number(r.value));
        if (f === 'Pilihan Lebih dari Satu') draft.correctIndices = checked;
        else draft.correctIndex = checked.length ? checked[0] : 0;
      } else if (f === 'Benar/Salah') {
        const c = box.querySelector('[name="qeTF"]:checked');
        draft.correctIndex = c ? Number(c.value) : 0;
        draft.options = ['Benar', 'Salah'];
      } else if (f === 'Isian Singkat') {
        draft.answers = [...box.querySelectorAll('.qe-ans')].map(i => i.value);
        const n = box.querySelector('#qeNumeric');
        draft.numeric = n ? n.checked : false;
      } else if (f === 'Majemuk Kompleks') {
        draft.statements = [...box.querySelectorAll('.qe-row.st')].map((row, i) => ({
          text: row.querySelector('.qe-st-text').value,
          value: (row.querySelector(`[name="qeSt${row.dataset.idx}"]:checked`) || {}).value === '1'
        }));
      } else if (f === 'Menjodohkan') {
        draft.pairs = [...box.querySelectorAll('.qe-row.pair')].map(row => ({
          left: row.querySelector('.qe-pl').value,
          right: row.querySelector('.qe-pr').value
        }));
      } else if (f === 'Urutan') {
        draft.orderItems = [...box.querySelectorAll('.qe-ord')].map(i => i.value);
      } else if (f === 'Esai') {
        const kw = box.querySelector('#qeKeywords');
        draft.keywords = kw ? kw.value.split(',').map(s => s.trim()).filter(Boolean) : [];
      }
    }

    /* ---------- Pratinjau langsung ---------- */
    function renderPreview() {
      const side = wsEl.querySelector('#qeSide');
      if (!side) return;
      const st = DB.subtestByName(draft.subject);
      const fmt = FORMATS.find(f => f.key === draft.questionType) || FORMATS[0];

      side.innerHTML = `
        <div class="qe-side-head">
          <strong>👁 Pratinjau Siswa</strong>
          <span class="muted small">Tampilan saat ujian</span>
        </div>
        <div class="qe-preview">
          <div class="qc-tags" style="margin-bottom:10px;">
            <span class="qc-chip sub">${st ? st.icon : '📘'} ${esc(st ? st.short : draft.subject)}</span>
            <span class="qc-chip type">${esc(draft.questionType)}</span>
            <span class="qc-chip d-${esc(draft.difficulty)}">${esc((draft.difficulty || '').toUpperCase())}</span>
          </div>
          <div class="rt-content qe-prev-text">${draft.text ? RichText.render(draft.text) : '<span class="muted">Pertanyaan belum diisi…</span>'}</div>
          <div class="qe-prev-ans">${previewAnswerHtml()}</div>
          ${draft.explanation ? `<div class="alert alert-info mt-2"><strong>Pembahasan:</strong> <span class="rt-content">${RichText.render(draft.explanation)}</span></div>` : ''}
        </div>
        <div class="qe-side-foot muted small">
          ${fmt.auto ? '✓ Soal ini dinilai otomatis oleh sistem.' : '⚠ Soal ini perlu dinilai manual oleh guru.'}
        </div>`;
    }

    function previewAnswerHtml() {
      const f = draft.questionType;
      const R = (s) => RichText.render(s || '');

      if (f === 'Esai') {
        return `<div class="qe-prev-essay muted small">[ Area jawaban uraian siswa ]</div>`;
      }
      if (f === 'Isian Singkat') {
        return `<div class="qe-prev-short">
          <input disabled placeholder="Jawaban singkat…" />
          <div class="muted small mt-1">Kunci: ${esc((draft.answers || []).filter(Boolean).join(' / ') || '—')}</div>
        </div>`;
      }
      if (f === 'Majemuk Kompleks') {
        return `<table class="qe-prev-table"><thead><tr><th>Pernyataan</th><th>B</th><th>S</th></tr></thead><tbody>
          ${(draft.statements || []).map(s => `<tr>
            <td>${R(s.text) || '<span class="muted">—</span>'}</td>
            <td class="ct">${s.value ? '<span class="qe-keyflag">✓</span>' : '○'}</td>
            <td class="ct">${!s.value ? '<span class="qe-keyflag">✓</span>' : '○'}</td>
          </tr>`).join('')}
        </tbody></table>`;
      }
      if (f === 'Menjodohkan') {
        return `<table class="qe-prev-table"><tbody>
          ${(draft.pairs || []).map((p, i) => `<tr>
            <td>${i + 1}. ${R(p.left) || '<span class="muted">—</span>'}</td>
            <td>→ <span class="qe-keyflag">${R(p.right) || '—'}</span></td>
          </tr>`).join('')}
        </tbody></table>`;
      }
      if (f === 'Urutan') {
        return `<ol class="qe-prev-order">
          ${(draft.orderItems || []).map(it => `<li>${R(it) || '<span class="muted">—</span>'}</li>`).join('')}
        </ol><div class="muted small">Urutan di atas adalah kunci; saat ujian akan diacak.</div>`;
      }
      // Pilihan
      const multi = f === 'Pilihan Lebih dari Satu';
      const keys = new Set(multi ? (draft.correctIndices || []) : [draft.correctIndex]);
      return `<div class="option-list">
        ${(draft.options || []).map((o, i) => `
          <div class="option-item ${keys.has(i) ? 'correct' : ''}">
            <span class="letter">${String.fromCharCode(65 + i)}.</span>
            <span class="rt-content" style="flex:1;">${R(o) || '<span class="muted">(kosong)</span>'}</span>
            ${keys.has(i) ? '<span class="qe-keyflag">kunci</span>' : ''}
          </div>`).join('')}
      </div>`;
    }

    /* ---------- Validasi & simpan ---------- */
    function validate() {
      collect();
      const plainText = RichText.plain(draft.text);
      if (!plainText) return 'Isi pertanyaan tidak boleh kosong.';
      const f = draft.questionType;

      if (f === 'Pilihan Ganda' || f === 'Pilihan Lebih dari Satu') {
        const filled = draft.options.filter(o => RichText.plain(o));
        if (filled.length < 2) return 'Isi minimal 2 pilihan jawaban.';
        if (draft.options.some(o => !RichText.plain(o))) return 'Masih ada pilihan jawaban yang kosong.';
        if (f === 'Pilihan Lebih dari Satu') {
          if (!(draft.correctIndices || []).length) return 'Tandai minimal satu kunci jawaban.';
        } else if (draft.correctIndex == null) return 'Pilih satu kunci jawaban.';
      }
      if (f === 'Isian Singkat') {
        if (!draft.answers.filter(a => a.trim()).length) return 'Isi minimal satu jawaban yang diterima.';
      }
      if (f === 'Majemuk Kompleks') {
        if (draft.statements.filter(s => RichText.plain(s.text)).length < 2) return 'Isi minimal 2 pernyataan.';
      }
      if (f === 'Menjodohkan') {
        const ok = draft.pairs.filter(p => RichText.plain(p.left) && RichText.plain(p.right));
        if (ok.length < 2) return 'Isi minimal 2 pasangan lengkap (kiri dan kanan).';
      }
      if (f === 'Urutan') {
        if (draft.orderItems.filter(i => RichText.plain(i)).length < 2) return 'Isi minimal 2 item urutan.';
      }
      return null;
    }

    function save() {
      const err = validate();
      if (err) { UI.toast(err, 'error'); return; }

      const f = draft.questionType;
      const payload = {
        questionType: f,
        difficulty: draft.difficulty,
        text: RichText.sanitize(draft.text),
        explanation: RichText.sanitize(draft.explanation || ''),
        options: (draft.options || []).map(o => RichText.sanitize(o))
      };

      // Simpan kunci sesuai format
      if (f === 'Pilihan Ganda' || f === 'Benar/Salah') {
        payload.correctIndex = draft.correctIndex;
        payload.correctIndices = null;
      } else if (f === 'Pilihan Lebih dari Satu') {
        payload.correctIndices = (draft.correctIndices || []).slice().sort((a, b) => a - b);
        payload.correctIndex = payload.correctIndices[0] != null ? payload.correctIndices[0] : 0;
      } else if (f === 'Isian Singkat') {
        payload.answers = draft.answers.map(a => a.trim()).filter(Boolean);
        payload.numeric = !!draft.numeric;
        payload.options = [];
        payload.correctIndex = null;
      } else if (f === 'Majemuk Kompleks') {
        payload.statements = draft.statements
          .filter(s => RichText.plain(s.text))
          .map(s => ({ text: RichText.sanitize(s.text), value: !!s.value }));
        payload.options = [];
        payload.correctIndex = null;
      } else if (f === 'Menjodohkan') {
        payload.pairs = draft.pairs
          .filter(p => RichText.plain(p.left) && RichText.plain(p.right))
          .map(p => ({ left: RichText.sanitize(p.left), right: RichText.sanitize(p.right) }));
        payload.options = [];
        payload.correctIndex = null;
      } else if (f === 'Urutan') {
        payload.orderItems = draft.orderItems.filter(i => RichText.plain(i)).map(i => RichText.sanitize(i));
        payload.options = [];
        payload.correctIndex = null;
      } else if (f === 'Esai') {
        payload.keywords = draft.keywords || [];
        payload.options = [];
        payload.correctIndex = null;
      }

      let saved;
      if (bank === 'security') {
        payload.subtest = draft.subject;
        payload.active = existing ? (existing.active !== false) : true;
        // Bank login hanya mendukung pilihan tunggal agar cepat dikerjakan
        if (f !== 'Pilihan Ganda' && f !== 'Benar/Salah') {
          UI.toast('Soal verifikasi login hanya mendukung Pilihan Ganda atau Benar/Salah.', 'error');
          return;
        }
        saved = existing
          ? DB.updateSecurityQuestion(existing.id, payload)
          : DB.addSecurityQuestion(payload);
      } else {
        payload.subject = draft.subject;
        payload.authorId = (existing && existing.authorId) || user.id;
        saved = existing ? DB.updateQuestion(existing.id, payload) : DB.addQuestion(payload);
      }

      UI.toast(existing ? 'Soal diperbarui.' : 'Soal berhasil ditambahkan.', 'success');
      close();
      if (typeof onSaved === 'function') onSaved(saved);
    }
  }

  function close() {
    if (wsEl) { wsEl.remove(); wsEl = null; }
    document.body.style.overflow = '';
    Editor.setHost(null);
  }

  global.QEditor = { open, close, FORMATS };
})(window);
