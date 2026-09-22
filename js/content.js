/* ===== LMS Rubela - Ruang Kerja Konten Kelas =====
 * Halaman penuh untuk membuat Materi, Modul, dan Rekaman kelas, memakai
 * mesin editor bersama (js/editor.js) sehingga alatnya persis sama dengan
 * Bank Soal: format teks lengkap, tabel bergaya lembar kerja, rumus LaTeX
 * untuk matematika/fisika/kimia, gambar, audio, dan tautan berpratinjau.
 *
 * Dipakai identik oleh panel tutor dan panel admin.
 *
 * ATRIBUSI PEMBUAT
 * Satu kelas subtest bisa diampu lebih dari satu tutor, tetapi satu
 * pertemuan hanya diajar satu tutor. Karena itu setiap konten mencatat
 * tutor penanggung jawab:
 *   - Tutor yang membuat sendiri  -> otomatis tercatat atas namanya.
 *   - Admin yang membuat          -> memilih tutor penanggung jawab secara
 *     manual (mis. tutornya sedang tidak bisa mengetik), dan sistem tetap
 *     mencatat bahwa admin yang mengetiknya.
 * Rekap keaktifan tiap tutor mengambil data dari sini.
 */
(function (global) {

  let wsEl = null;

  function esc(s) { return UI.esc(s); }

  /* =====================================================================
   * Kredit pembuat — dipakai seluruh panel
   * ===================================================================*/
  /** Lencana "oleh Bu Maria" untuk ditempel di kartu/baris konten. */
  function creditHtml(rec, course, opts) {
    const o = opts || {};
    const label = DB.contentCreditLabel(rec, course);
    if (!label) return '';
    const icon = o.icon || '👤';
    return `<span class="credit-chip" title="Tutor penanggung jawab konten ini">${icon} ${esc(label)}</span>`;
  }

  /** Baris meta standar: "oleh <tutor> • <tanggal>". */
  function metaHtml(rec, course, dateTs) {
    const bits = [];
    const credit = creditHtml(rec, course);
    if (credit) bits.push(credit);
    if (dateTs) bits.push(UI.fmtDate(dateTs));
    return bits.join(' • ');
  }

  /**
   * Bidang "tutor penanggung jawab".
   * Tutor melihat keterangan tetap (dirinya sendiri); admin mendapat pilihan
   * tutor kelas + opsi menulis nama manual bila tutornya belum terdaftar.
   */
  function ownerFieldHtml(user, course, rec) {
    const tutors = DB.courseTeachers(course);
    const current = (rec && rec.createdBy) || (user.role === 'guru' ? user.id : (tutors[0] && tutors[0].id) || '');

    if (user.role !== 'admin') {
      const me = DB.getUser(current) || user;
      return `
        <input type="hidden" name="ownerId" value="${esc(user.id)}" />
        <div class="ce-owner-note">
          <span class="ce-owner-ic">👤</span>
          <div>
            <strong>Tercatat atas nama Anda: ${esc(me.name)}</strong>
            <div class="muted small">Konten ini akan dihitung sebagai keaktifan Anda pada rekapan.</div>
          </div>
        </div>`;
    }

    return `
      <div class="form-group">
        <label for="ceOwner">Tutor Penanggung Jawab</label>
        <select name="ownerId" id="ceOwner" required>
          ${tutors.map(t => `<option value="${esc(t.id)}" ${current === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
          ${tutors.length === 0 ? '<option value="">(kelas ini belum punya tutor)</option>' : ''}
        </select>
        <div class="muted small">
          Anda mencatat sebagai admin. Pilih tutor yang benar-benar mengajarkan materi ini agar
          rekapan keaktifan tutor tetap akurat. Sistem menyimpan bahwa admin yang mengetiknya.
        </div>
      </div>`;
  }

  /** Ambil id tutor penanggung jawab dari form. */
  function readOwnerId(formEl, user, course) {
    const el = formEl.querySelector('[name="ownerId"]');
    const val = el ? String(el.value || '').trim() : '';
    if (val) return val;
    if (user.role === 'guru') return user.id;
    return (DB.courseTeachers(course)[0] || {}).id || null;
  }

  /* =====================================================================
   * Kerangka ruang kerja satu layar penuh
   * ===================================================================*/
  function openWorkspace(title, subtitle, actionsHtml) {
    closeWorkspace();
    wsEl = document.createElement('div');
    wsEl.className = 'ce-workspace';
    wsEl.innerHTML = `
      <header class="ce-top">
        <button type="button" class="btn btn-secondary btn-sm" id="ceBack">← Batal</button>
        <div class="ce-title">
          <h2>${esc(title)}</h2>
          <p>${subtitle}</p>
        </div>
        <div class="ce-actions">${actionsHtml || ''}</div>
      </header>
      <div class="ce-body">
        <div class="ce-main" id="ceMain"></div>
        <aside class="ce-side" id="ceSide"></aside>
      </div>`;
    document.body.appendChild(wsEl);
    document.body.style.overflow = 'hidden';
    Editor.setHost(wsEl);
    return wsEl;
  }

  function closeWorkspace() {
    if (wsEl) wsEl.remove();
    wsEl = null;
    document.body.style.overflow = '';
    Editor.setHost(null);
  }

  /** Tombol kembali dengan konfirmasi bila ada perubahan belum disimpan. */
  function bindBack(isDirty, onClose) {
    wsEl.querySelector('#ceBack').addEventListener('click', () => {
      if (isDirty() && !UI.confirmDialog('Tutup tanpa menyimpan? Perubahan akan hilang.')) return;
      closeWorkspace();
      if (typeof onClose === 'function') onClose(null);
    });
  }

  /* =====================================================================
   * 1. MATERI
   * ===================================================================*/
  function openMaterial(opts) {
    const o = opts || {};
    const user = o.user;
    const course = o.course;
    const editing = o.editId ? DB.getMaterial(o.editId) : null;

    if (editing && !DB.canManageContent(user, editing, course)) {
      UI.toast('Materi ini dibuat tutor lain, jadi hanya dia (atau admin) yang boleh menyuntingnya.', 'error');
      return;
    }

    const draft = {
      title: editing ? editing.title : '',
      content: editing ? editing.content : '',
      link: editing ? (editing.link || '') : ''
    };
    let dirty = false;

    openWorkspace(
      editing ? 'Edit Materi' : 'Tambah Materi',
      `${esc(DB.courseTitle(course))} • editor lengkap dengan rumus, tabel, gambar, dan audio`,
      '<button type="button" class="btn btn-primary" id="ceSave">💾 Simpan Materi</button>'
    );

    wsEl.querySelector('#ceMain').innerHTML = `
      <form id="ceForm" class="form ce-form">
        <div class="ce-card">
          <h3 class="ce-h">1. Identitas Materi</h3>
          <div class="form-group">
            <label for="ceTitle">Judul Materi</label>
            <input id="ceTitle" name="title" required value="${esc(draft.title)}"
                   placeholder="mis. Barisan & Deret Aritmetika" />
          </div>
          ${ownerFieldHtml(user, course, editing)}
        </div>

        <div class="ce-card">
          <h3 class="ce-h">2. Isi Materi</h3>
          ${Editor.toolbarHtml('ceContent')}
          <div id="ceContent" class="qe-editor ce-editor-tall" contenteditable="true"
               data-ph="Tulis materi di sini. Gunakan bilah alat di atas untuk rumus, tabel, gambar, audio, dan tautan.">${draft.content}</div>
          <p class="muted small mt-1">
            Tip: ketik <code>$...$</code> untuk rumus sebaris dan <code>$$...$$</code> untuk rumus blok.
            Tombol <strong>▦⋯</strong> menyunting baris/kolom tabel.
          </p>
        </div>

        <div class="ce-card">
          <h3 class="ce-h">3. Lampiran Tautan (opsional)</h3>
          <div class="form-group">
            <label for="ceLink">Tautan pendukung</label>
            <input id="ceLink" name="link" type="url" value="${esc(draft.link)}"
                   placeholder="https://drive.google.com/..." />
            <div class="muted small">Tautan Google Drive, YouTube, atau situs rujukan. Tampil sebagai tombol di halaman siswa.</div>
          </div>
        </div>
      </form>`;

    const main = wsEl.querySelector('#ceMain');
    Editor.attach(main, {
      onInput: (el) => {
        if (el.id === 'ceContent') { draft.content = el.innerHTML; dirty = true; paintPreview(); }
      }
    });
    main.querySelector('#ceTitle').addEventListener('input', (e) => {
      draft.title = e.target.value; dirty = true; paintPreview();
    });
    main.querySelector('#ceLink').addEventListener('input', (e) => {
      draft.link = e.target.value; dirty = true; paintPreview();
    });

    function paintPreview() {
      wsEl.querySelector('#ceSide').innerHTML = `
        <div class="ce-side-head">
          <h3>👁️ Pratinjau Siswa</h3>
          <p class="muted small">Tampilan materi ini di halaman siswa</p>
        </div>
        <div class="ce-preview">
          <div class="list-item">
            <div class="title">${esc(draft.title || '(judul belum diisi)')}</div>
            <div class="meta">${creditHtml({ createdBy: readOwnerId(main.querySelector('#ceForm') || main, user, course) }, course)} • ${UI.fmtDate(Date.now())}</div>
            <div class="content rt-content">${draft.content ? RichText.render(draft.content) : '<span class="muted">Isi materi belum ditulis.</span>'}</div>
            ${draft.link && /^https?:\/\//i.test(draft.link)
              ? `<div class="mt-1"><a href="${esc(draft.link)}" target="_blank" rel="noopener">Buka tautan →</a></div>` : ''}
          </div>
        </div>`;
    }
    paintPreview();

    bindBack(() => dirty, o.onSaved);
    wsEl.querySelector('#ceSave').addEventListener('click', () => {
      const form = main.querySelector('#ceForm');
      const title = form.querySelector('#ceTitle').value.trim();
      if (!title) { UI.toast('Judul materi wajib diisi.', 'error'); return; }
      if (!RichText.plain(draft.content, 400).trim()) { UI.toast('Isi materi masih kosong.', 'error'); return; }

      const base = {
        courseId: course.id,
        title,
        content: RichText.sanitize(draft.content),
        link: form.querySelector('#ceLink').value.trim()
      };
      let saved;
      if (editing) {
        const patch = DB.stampEditor(base, user);
        patch.createdBy = readOwnerId(form, user, course) || editing.createdBy || null;
        saved = DB.updateMaterial(editing.id, patch);
      } else {
        saved = DB.addMaterial(DB.stampCreator(base, user, readOwnerId(form, user, course)));
      }
      UI.toast('Materi disimpan.', 'success');
      closeWorkspace();
      if (typeof o.onSaved === 'function') o.onSaved(saved);
    });
  }

  /* =====================================================================
   * 2. MODUL (banyak bagian)
   * ===================================================================*/
  function openModule(opts) {
    const o = opts || {};
    const user = o.user;
    const course = o.course;
    const editing = o.editId ? DB.getModule(o.editId) : null;

    if (editing && !DB.canManageContent(user, editing, course)) {
      UI.toast('Modul ini dibuat tutor lain, jadi hanya dia (atau admin) yang boleh menyuntingnya.', 'error');
      return;
    }

    const draft = {
      title: editing ? editing.title : '',
      description: editing ? (editing.description || '') : '',
      link: editing ? (editing.link || '') : '',
      sections: editing && editing.sections && editing.sections.length
        ? JSON.parse(JSON.stringify(editing.sections))
        : [{ title: '', content: '' }]
    };
    let dirty = false;
    let activeSec = 0;

    openWorkspace(
      editing ? 'Edit Modul' : 'Tambah Modul',
      `${esc(DB.courseTitle(course))} • modul berbagian dengan editor lengkap`,
      '<button type="button" class="btn btn-primary" id="ceSave">💾 Simpan Modul</button>'
    );

    function paint() {
      wsEl.querySelector('#ceMain').innerHTML = `
        <form id="ceForm" class="form ce-form">
          <div class="ce-card">
            <h3 class="ce-h">1. Identitas Modul</h3>
            <div class="form-group">
              <label for="ceTitle">Judul Modul</label>
              <input id="ceTitle" name="title" required value="${esc(draft.title)}"
                     placeholder="mis. Modul 1 — Aljabar Dasar" />
            </div>
            <div class="form-group">
              <label for="ceDesc">Deskripsi Singkat</label>
              <input id="ceDesc" name="description" value="${esc(draft.description)}"
                     placeholder="mis. Pengantar aljabar dengan latihan bertahap" />
            </div>
            <div class="form-group">
              <label for="ceLink">Tautan Modul (opsional)</label>
              <input id="ceLink" name="link" type="url" value="${esc(draft.link)}" placeholder="https://..." />
            </div>
            ${ownerFieldHtml(user, course, editing)}
          </div>

          <div class="ce-card">
            <div class="flex-between" style="flex-wrap:wrap;gap:10px;">
              <h3 class="ce-h" style="margin:0;">2. Bagian Modul (${draft.sections.length})</h3>
              <button type="button" class="btn btn-sm btn-secondary" id="ceAddSec">+ Tambah Bagian</button>
            </div>
            <div class="ce-sec-tabs" id="ceSecTabs">
              ${draft.sections.map((s, i) => `
                <button type="button" class="ce-sec-tab ${i === activeSec ? 'is-active' : ''}" data-sec="${i}">
                  <span class="ss-n">${i + 1}</span>
                  <span class="ss-t">${esc(RichText.plain(s.title, 18) || 'Bagian ' + (i + 1))}</span>
                </button>`).join('')}
            </div>

            <div class="ce-sec-body">
              <div class="form-group">
                <label for="ceSecTitle">Judul Bagian ${activeSec + 1}</label>
                <div class="flex-gap">
                  <input id="ceSecTitle" value="${esc(draft.sections[activeSec].title)}"
                         placeholder="mis. Pengertian Variabel" style="flex:1;" />
                  ${draft.sections.length > 1
                    ? '<button type="button" class="btn btn-sm btn-danger" id="ceDelSec">🗑 Hapus Bagian</button>' : ''}
                </div>
              </div>
              <label>Isi Bagian ${activeSec + 1}</label>
              ${Editor.toolbarHtml('ceSecContent')}
              <div id="ceSecContent" class="qe-editor ce-editor-tall" contenteditable="true"
                   data-ph="Tulis isi bagian ini. Rumus, tabel, gambar, audio, dan tautan tersedia di bilah alat.">${draft.sections[activeSec].content}</div>
            </div>
          </div>
        </form>`;

      const main = wsEl.querySelector('#ceMain');
      Editor.attach(main, {
        onInput: (el) => {
          if (el.id === 'ceSecContent') {
            draft.sections[activeSec].content = el.innerHTML;
            dirty = true;
            paintPreview();
          }
        }
      });
      main.querySelector('#ceTitle').addEventListener('input', (e) => { draft.title = e.target.value; dirty = true; paintPreview(); });
      main.querySelector('#ceDesc').addEventListener('input', (e) => { draft.description = e.target.value; dirty = true; paintPreview(); });
      main.querySelector('#ceLink').addEventListener('input', (e) => { draft.link = e.target.value; dirty = true; paintPreview(); });
      main.querySelector('#ceSecTitle').addEventListener('input', (e) => {
        draft.sections[activeSec].title = e.target.value;
        dirty = true;
        const tab = main.querySelector(`.ce-sec-tab[data-sec="${activeSec}"] .ss-t`);
        if (tab) tab.textContent = RichText.plain(e.target.value, 18) || 'Bagian ' + (activeSec + 1);
        paintPreview();
      });
      main.querySelectorAll('[data-sec]').forEach(b => b.addEventListener('click', () => {
        activeSec = Number(b.dataset.sec);
        paint();
      }));
      main.querySelector('#ceAddSec').addEventListener('click', () => {
        draft.sections.push({ title: '', content: '' });
        activeSec = draft.sections.length - 1;
        dirty = true;
        paint();
      });
      const delSec = main.querySelector('#ceDelSec');
      if (delSec) delSec.addEventListener('click', () => {
        if (!UI.confirmDialog(`Hapus bagian ${activeSec + 1}?`)) return;
        draft.sections.splice(activeSec, 1);
        if (activeSec >= draft.sections.length) activeSec = draft.sections.length - 1;
        dirty = true;
        paint();
      });
      paintPreview();
    }

    function paintPreview() {
      const filled = draft.sections.filter(s => (s.title || '').trim() || RichText.plain(s.content, 50).trim());
      wsEl.querySelector('#ceSide').innerHTML = `
        <div class="ce-side-head">
          <h3>👁️ Pratinjau Siswa</h3>
          <p class="muted small">${filled.length} bagian akan tampil</p>
        </div>
        <div class="ce-preview">
          <div class="module-card">
            <div class="module-head">
              <h4>${esc(draft.title || '(judul belum diisi)')}</h4>
              <div class="meta">${esc(draft.description || '')} • ${filled.length} bagian</div>
            </div>
            <div class="module-body">
              ${filled.length ? filled.map(s => `
                <div class="module-section">
                  <div class="module-section-title">${esc(s.title || 'Tanpa judul')}</div>
                  <div class="module-section-content rt-content">${s.content ? RichText.render(s.content) : '<span class="muted">(kosong)</span>'}</div>
                </div>`).join('')
                : '<div class="module-section muted">Belum ada bagian yang terisi.</div>'}
              ${draft.link && /^https?:\/\//i.test(draft.link)
                ? `<div class="module-section"><a href="${esc(draft.link)}" target="_blank" rel="noopener">Buka tautan modul →</a></div>` : ''}
            </div>
          </div>
        </div>`;
    }

    paint();
    bindBack(() => dirty, o.onSaved);
    wsEl.querySelector('#ceSave').addEventListener('click', () => {
      const form = wsEl.querySelector('#ceForm');
      const title = form.querySelector('#ceTitle').value.trim();
      if (!title) { UI.toast('Judul modul wajib diisi.', 'error'); return; }
      const sections = draft.sections
        .map(s => ({ title: (s.title || '').trim(), content: RichText.sanitize(s.content || '') }))
        .filter(s => s.title || RichText.plain(s.content, 50).trim());
      if (!sections.length) { UI.toast('Isi minimal satu bagian modul.', 'error'); return; }

      const base = {
        courseId: course.id,
        title,
        description: form.querySelector('#ceDesc').value.trim(),
        link: form.querySelector('#ceLink').value.trim(),
        sections
      };
      let saved;
      if (editing) {
        const patch = DB.stampEditor(base, user);
        patch.createdBy = readOwnerId(form, user, course) || editing.createdBy || null;
        saved = DB.updateModule(editing.id, patch);
      } else {
        saved = DB.addModule(DB.stampCreator(base, user, readOwnerId(form, user, course)));
      }
      UI.toast('Modul disimpan.', 'success');
      closeWorkspace();
      if (typeof o.onSaved === 'function') o.onSaved(saved);
    });
  }

  /* =====================================================================
   * 3. REKAMAN
   * ===================================================================*/
  function openRecording(opts) {
    const o = opts || {};
    const user = o.user;
    const course = o.course;
    const editing = o.editId ? DB.getRecording(o.editId) : null;

    if (editing && !DB.canManageContent(user, editing, course)) {
      UI.toast('Rekaman ini diunggah tutor lain, jadi hanya dia (atau admin) yang boleh menyuntingnya.', 'error');
      return;
    }

    const draft = {
      title: editing ? editing.title : '',
      url: editing ? editing.url : '',
      notes: editing ? (editing.notes || '') : '',
      duration: editing ? Math.round((editing.duration || 0) / 60) : 90,
      date: UI.toDateInput(editing ? editing.recordedAt : Date.now())
    };
    let dirty = false;

    openWorkspace(
      editing ? 'Edit Rekaman' : 'Tambah Rekaman Kelas',
      `${esc(DB.courseTitle(course))} • rekaman pertemuan dengan catatan lengkap`,
      '<button type="button" class="btn btn-primary" id="ceSave">💾 Simpan Rekaman</button>'
    );

    wsEl.querySelector('#ceMain').innerHTML = `
      <form id="ceForm" class="form ce-form">
        <div class="ce-card">
          <h3 class="ce-h">1. Identitas Rekaman</h3>
          <div class="form-group">
            <label for="ceTitle">Judul</label>
            <input id="ceTitle" name="title" required value="${esc(draft.title)}"
                   placeholder="mis. Pertemuan 3 — Barisan Aritmetika" />
          </div>
          <div class="form-group">
            <label for="ceUrl">URL Video (YouTube, Vimeo, Drive, atau mp4)</label>
            <input id="ceUrl" name="url" type="url" required value="${esc(draft.url)}" placeholder="https://..." />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="ceDate">Tanggal Rekam</label>
              <input id="ceDate" name="date" type="date" required value="${esc(draft.date)}" />
            </div>
            <div class="form-group">
              <label for="ceDur">Durasi (menit)</label>
              <input id="ceDur" name="duration" type="number" min="0" max="600" value="${draft.duration}" />
            </div>
          </div>
          ${ownerFieldHtml(user, course, editing)}
        </div>

        <div class="ce-card">
          <h3 class="ce-h">2. Catatan Pertemuan</h3>
          ${Editor.toolbarHtml('ceNotes')}
          <div id="ceNotes" class="qe-editor" contenteditable="true"
               data-ph="Ringkasan yang dibahas, menit penting, dan tugas yang diberikan.">${draft.notes}</div>
        </div>
      </form>`;

    const main = wsEl.querySelector('#ceMain');
    Editor.attach(main, {
      onInput: (el) => { if (el.id === 'ceNotes') { draft.notes = el.innerHTML; dirty = true; paintPreview(); } }
    });
    ['ceTitle', 'ceUrl', 'ceDate', 'ceDur'].forEach(id => {
      main.querySelector('#' + id).addEventListener('input', () => { dirty = true; paintPreview(); });
    });

    function paintPreview() {
      const url = main.querySelector('#ceUrl').value.trim();
      const dur = Number(main.querySelector('#ceDur').value) || 0;
      wsEl.querySelector('#ceSide').innerHTML = `
        <div class="ce-side-head">
          <h3>👁️ Pratinjau Siswa</h3>
          <p class="muted small">Tampilan rekaman di halaman siswa</p>
        </div>
        <div class="ce-preview">
          <div class="list-item">
            <div class="flex-between">
              <div class="title">${esc(main.querySelector('#ceTitle').value || '(judul belum diisi)')}</div>
              <span class="muted small">${UI.fmtDuration(dur * 60)}</span>
            </div>
            <div class="meta">${creditHtml({ createdBy: readOwnerId(main, user, course) }, course)}</div>
            ${url && /^https?:\/\//i.test(url)
              ? Shared.videoEmbedHtml(url)
              : '<div class="empty" style="padding:18px;"><div class="empty-icon">🎥</div>Tempel URL video untuk melihat pratinjau.</div>'}
            ${draft.notes ? `<div class="content rt-content">${RichText.render(draft.notes)}</div>` : ''}
          </div>
        </div>`;
    }
    paintPreview();

    bindBack(() => dirty, o.onSaved);
    wsEl.querySelector('#ceSave').addEventListener('click', () => {
      const form = main.querySelector('#ceForm');
      const title = form.querySelector('#ceTitle').value.trim();
      const url = form.querySelector('#ceUrl').value.trim();
      if (!title) { UI.toast('Judul rekaman wajib diisi.', 'error'); return; }
      if (!/^https?:\/\//i.test(url)) { UI.toast('URL video belum valid.', 'error'); return; }

      const base = {
        courseId: course.id,
        title,
        url,
        notes: RichText.sanitize(draft.notes),
        duration: (Number(form.querySelector('#ceDur').value) || 0) * 60,
        recordedAt: new Date(form.querySelector('#ceDate').value).getTime() || Date.now()
      };
      let saved;
      if (editing) {
        const patch = DB.stampEditor(base, user);
        patch.createdBy = readOwnerId(form, user, course) || editing.createdBy || null;
        saved = DB.updateRecording(editing.id, patch);
      } else {
        saved = DB.addRecording(DB.stampCreator(base, user, readOwnerId(form, user, course)));
      }
      UI.toast('Rekaman disimpan.', 'success');
      closeWorkspace();
      if (typeof o.onSaved === 'function') o.onSaved(saved);
    });
  }

  /* =====================================================================
   * 4. TUGAS
   * Dua mode:
   *   uraian — siswa menulis jawaban bebas (dinilai manual tutor).
   *   soal   — tugas disusun dari Bank Soal pusat, memakai kedelapan format
   *            soal yang sama dengan CBT (pilihan ganda, kompleks, benar/
   *            salah, isian singkat, menjodohkan, urutan, majemuk, esai),
   *            lengkap dengan LaTeX dan media. Format yang bisa dinilai
   *            otomatis langsung diskor sistem.
   * ===================================================================*/
  const ASSIGN_MODES = [
    { key: 'uraian', icon: '✍️', label: 'Jawaban Uraian',
      desc: 'Siswa menulis jawaban bebas. Dinilai manual oleh tutor.' },
    { key: 'soal', icon: '🧮', label: 'Berbasis Soal',
      desc: 'Susun dari Bank Soal dengan 8 format soal. Nilai otomatis untuk format objektif.' }
  ];

  function openAssignment(opts) {
    const o = opts || {};
    const user = o.user;
    const course = o.course;
    const editing = o.editId ? DB.getAssignment(o.editId) : null;

    if (editing && !DB.canManageContent(user, editing, course)) {
      UI.toast('Tugas ini dibuat tutor lain, jadi hanya dia (atau admin) yang boleh menyuntingnya.', 'error');
      return;
    }

    const draft = {
      title: editing ? editing.title : '',
      description: editing ? (editing.description || '') : '',
      dueDate: UI.toDateInput(editing ? editing.dueDate : (Date.now() + 7 * 86400000)),
      mode: editing ? (editing.mode || 'uraian') : 'uraian',
      questionIds: editing && Array.isArray(editing.questionIds) ? editing.questionIds.slice() : [],
      maxScore: editing ? (editing.maxScore || 100) : 100
    };
    let dirty = false;

    openWorkspace(
      editing ? 'Edit Tugas' : 'Buat Tugas',
      `${esc(DB.courseTitle(course))} • editor tugas dengan format soal seperti Bank Soal`,
      '<button type="button" class="btn btn-primary" id="ceSave">💾 Simpan Tugas</button>'
    );

    function questionRowHtml(qid, i) {
      const q = DB.getQuestion(qid);
      if (!q) {
        return `<div class="ce-q-row is-missing">
          <span class="ce-q-n">${i + 1}</span>
          <div class="ce-q-body"><em class="muted">Soal sudah dihapus dari bank.</em></div>
          <button type="button" class="btn btn-sm btn-danger" data-rm-q="${esc(qid)}">Buang</button>
        </div>`;
      }
      const st = DB.subtestByName(q.subject);
      const auto = (q.questionType || 'Pilihan Ganda') !== 'Esai';
      return `<div class="ce-q-row">
        <span class="ce-q-n">${i + 1}</span>
        <div class="ce-q-body">
          <div class="ce-q-meta">
            <span class="badge badge-info">${st ? st.icon + ' ' + esc(st.short) : esc(q.subject || '-')}</span>
            <span class="badge badge-gray">${esc(q.questionType || 'Pilihan Ganda')}</span>
            <span class="badge ${auto ? 'badge-success' : 'badge-warning'}">${auto ? 'Nilai otomatis' : 'Nilai manual'}</span>
          </div>
          <div class="ce-q-text rt-content">${RichText.render(q.text || '')}</div>
        </div>
        <div class="ce-q-act">
          <button type="button" class="btn btn-sm btn-secondary" data-up-q="${i}" ${i === 0 ? 'disabled' : ''} title="Naikkan">↑</button>
          <button type="button" class="btn btn-sm btn-secondary" data-down-q="${i}" title="Turunkan">↓</button>
          <button type="button" class="btn btn-sm btn-secondary" data-edit-q="${esc(qid)}">Sunting</button>
          <button type="button" class="btn btn-sm btn-danger" data-rm-q="${esc(qid)}">Buang</button>
        </div>
      </div>`;
    }

    function paint() {
      const isSoal = draft.mode === 'soal';
      wsEl.querySelector('#ceMain').innerHTML = `
        <form id="ceForm" class="form ce-form">
          <div class="ce-card">
            <h3 class="ce-h">1. Identitas Tugas</h3>
            <div class="form-group">
              <label for="ceTitle">Judul Tugas</label>
              <input id="ceTitle" name="title" required value="${esc(draft.title)}"
                     placeholder="mis. Latihan Persamaan Linear" />
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="ceDue">Batas Pengumpulan</label>
                <input id="ceDue" name="dueDate" type="date" required value="${esc(draft.dueDate)}" />
              </div>
              <div class="form-group">
                <label for="ceMax">Nilai Maksimum</label>
                <input id="ceMax" name="maxScore" type="number" min="1" max="100" value="${draft.maxScore}" />
              </div>
            </div>
            ${ownerFieldHtml(user, course, editing)}
          </div>

          <div class="ce-card">
            <h3 class="ce-h">2. Bentuk Tugas</h3>
            <div class="ce-mode-grid">
              ${ASSIGN_MODES.map(m => `
                <button type="button" class="ce-mode ${draft.mode === m.key ? 'is-active' : ''}" data-mode="${m.key}">
                  <span class="cm-ic">${m.icon}</span>
                  <span class="cm-nm">${esc(m.label)}</span>
                  <span class="cm-ds">${esc(m.desc)}</span>
                </button>`).join('')}
            </div>
          </div>

          <div class="ce-card">
            <h3 class="ce-h">3. Instruksi Tugas</h3>
            ${Editor.toolbarHtml('ceDesc')}
            <div id="ceDesc" class="qe-editor" contenteditable="true"
                 data-ph="Jelaskan apa yang harus dikerjakan siswa. Rumus, tabel, gambar, dan tautan tersedia.">${draft.description}</div>
          </div>

          ${isSoal ? `
          <div class="ce-card">
            <div class="flex-between" style="flex-wrap:wrap;gap:10px;">
              <h3 class="ce-h" style="margin:0;">4. Daftar Soal (${draft.questionIds.length})</h3>
              <div class="flex-gap">
                <button type="button" class="btn btn-sm btn-secondary" id="cePickQ">📚 Ambil dari Bank Soal</button>
                <button type="button" class="btn btn-sm btn-primary" id="ceNewQ">+ Tulis Soal Baru</button>
              </div>
            </div>
            <p class="muted small">
              Soal diambil dari Bank Soal pusat sehingga formatnya sama dengan CBT dan bisa dipakai ulang.
              Soal baru yang Anda tulis di sini otomatis masuk ke Bank Soal.
            </p>
            <div class="ce-q-list">
              ${draft.questionIds.length
                ? draft.questionIds.map(questionRowHtml).join('')
                : '<div class="empty"><div class="empty-icon">📚</div>Belum ada soal. Ambil dari Bank Soal atau tulis soal baru.</div>'}
            </div>
          </div>` : ''}
        </form>`;

      const main = wsEl.querySelector('#ceMain');
      Editor.attach(main, {
        onInput: (el) => { if (el.id === 'ceDesc') { draft.description = el.innerHTML; dirty = true; paintPreview(); } }
      });
      ['ceTitle', 'ceDue', 'ceMax'].forEach(id => {
        const el = main.querySelector('#' + id);
        if (el) el.addEventListener('input', () => {
          draft.title = main.querySelector('#ceTitle').value;
          draft.dueDate = main.querySelector('#ceDue').value;
          draft.maxScore = Number(main.querySelector('#ceMax').value) || 100;
          dirty = true; paintPreview();
        });
      });
      main.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
        draft.description = (main.querySelector('#ceDesc') || {}).innerHTML || draft.description;
        draft.mode = b.dataset.mode;
        dirty = true;
        paint();
      }));

      const pick = main.querySelector('#cePickQ');
      if (pick) pick.addEventListener('click', () => openQuestionPicker());
      const newQ = main.querySelector('#ceNewQ');
      if (newQ) newQ.addEventListener('click', () => {
        draft.description = (main.querySelector('#ceDesc') || {}).innerHTML || draft.description;
        QEditor.open(user, null, (saved) => {
          if (saved && saved.id) { draft.questionIds.push(saved.id); dirty = true; }
          paint();
        }, { subtest: course.subtest });
      });
      main.querySelectorAll('[data-edit-q]').forEach(b => b.addEventListener('click', () => {
        draft.description = (main.querySelector('#ceDesc') || {}).innerHTML || draft.description;
        QEditor.open(user, b.dataset.editQ, () => paint(), { subtest: course.subtest });
      }));
      main.querySelectorAll('[data-rm-q]').forEach(b => b.addEventListener('click', () => {
        draft.questionIds = draft.questionIds.filter(x => x !== b.dataset.rmQ);
        dirty = true;
        paint();
      }));
      main.querySelectorAll('[data-up-q]').forEach(b => b.addEventListener('click', () => {
        const i = Number(b.dataset.upQ);
        if (i <= 0) return;
        const t = draft.questionIds[i - 1];
        draft.questionIds[i - 1] = draft.questionIds[i];
        draft.questionIds[i] = t;
        dirty = true;
        paint();
      }));
      main.querySelectorAll('[data-down-q]').forEach(b => b.addEventListener('click', () => {
        const i = Number(b.dataset.downQ);
        if (i >= draft.questionIds.length - 1) return;
        const t = draft.questionIds[i + 1];
        draft.questionIds[i + 1] = draft.questionIds[i];
        draft.questionIds[i] = t;
        dirty = true;
        paint();
      }));

      paintPreview();
    }

    /** Pemilih soal dari bank pusat, difilter per subtest dan kata kunci. */
    function openQuestionPicker() {
      draft.description = (wsEl.querySelector('#ceDesc') || {}).innerHTML || draft.description;
      let sub = course.subtest || (DB.SUBTESTS[0] && DB.SUBTESTS[0].name);
      let q = '';

      Editor.openSubDialog('Ambil Soal dari Bank Soal', `
        <div class="form-row">
          <div class="form-group">
            <label>Subtest</label>
            <select id="cePkSub" class="input">
              <option value="">Semua subtest</option>
              ${DB.SUBTESTS.map(s => `<option value="${esc(s.name)}" ${s.name === sub ? 'selected' : ''}>${s.icon} ${esc(s.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Cari</label>
            <input type="search" id="cePkQ" class="input" placeholder="kata kunci soal…" />
          </div>
        </div>
        <div id="cePkList" class="ce-pick-list"></div>
        <div class="flex-gap mt-2" style="justify-content:space-between;">
          <span class="muted small" id="cePkCount"></span>
          <div class="flex-gap">
            <button type="button" class="btn btn-secondary" data-cancel>Tutup</button>
            <button type="button" class="btn btn-primary" data-ok>Tambahkan Terpilih</button>
          </div>
        </div>
      `, (back, close) => {
        const listEl = back.querySelector('#cePkList');
        const subEl = back.querySelector('#cePkSub');
        const qEl = back.querySelector('#cePkQ');
        const countEl = back.querySelector('#cePkCount');
        const chosen = new Set();

        function paintList() {
          let list = DB.getQuestions();
          if (subEl.value) list = list.filter(x => x.subject === subEl.value);
          const needle = qEl.value.trim().toLowerCase();
          if (needle) list = list.filter(x => RichText.plain(x.text, 400).toLowerCase().includes(needle));
          countEl.textContent = `${list.length} soal cocok • ${chosen.size} dipilih`;
          if (!list.length) {
            listEl.innerHTML = '<div class="empty" style="padding:22px;"><div class="empty-icon">🔎</div>Tidak ada soal yang cocok.</div>';
            return;
          }
          listEl.innerHTML = list.map(x => {
            const already = draft.questionIds.includes(x.id);
            return `<label class="ce-pick-item ${already ? 'is-used' : ''}">
              <input type="checkbox" value="${esc(x.id)}" ${chosen.has(x.id) ? 'checked' : ''} ${already ? 'disabled' : ''} />
              <div>
                <div class="cp-meta">
                  <span class="badge badge-gray">${esc(x.questionType || 'Pilihan Ganda')}</span>
                  <span class="muted small">${esc(x.subject || '-')}</span>
                  ${already ? '<span class="badge badge-success">sudah dipakai</span>' : ''}
                </div>
                <div class="cp-text">${esc(RichText.plain(x.text, 150))}</div>
              </div>
            </label>`;
          }).join('');
          listEl.querySelectorAll('input[type="checkbox"]').forEach(cb =>
            cb.addEventListener('change', () => {
              if (cb.checked) chosen.add(cb.value); else chosen.delete(cb.value);
              countEl.textContent = `${list.length} soal cocok • ${chosen.size} dipilih`;
            }));
        }

        subEl.addEventListener('change', paintList);
        qEl.addEventListener('input', paintList);
        back.querySelector('[data-cancel]').addEventListener('click', close);
        back.querySelector('[data-ok]').addEventListener('click', () => {
          if (!chosen.size) { UI.toast('Belum ada soal yang dipilih.', 'info'); return; }
          chosen.forEach(id => { if (!draft.questionIds.includes(id)) draft.questionIds.push(id); });
          dirty = true;
          close();
          UI.toast(`${chosen.size} soal ditambahkan ke tugas.`, 'success');
          paint();
        });
        paintList();
      });
    }

    function paintPreview() {
      const isSoal = draft.mode === 'soal';
      const qs = draft.questionIds.map(id => DB.getQuestion(id)).filter(Boolean);
      const autoCount = qs.filter(q => (q.questionType || 'Pilihan Ganda') !== 'Esai').length;
      wsEl.querySelector('#ceSide').innerHTML = `
        <div class="ce-side-head">
          <h3>👁️ Pratinjau Siswa</h3>
          <p class="muted small">${isSoal ? `${qs.length} soal • ${autoCount} dinilai otomatis` : 'jawaban uraian'}</p>
        </div>
        <div class="ce-preview">
          <div class="list-item">
            <div class="flex-between">
              <div class="title">${esc(draft.title || '(judul belum diisi)')}</div>
              <span class="badge badge-info">${isSoal ? 'Berbasis Soal' : 'Uraian'}</span>
            </div>
            <div class="meta">${creditHtml({ createdBy: readOwnerId(wsEl.querySelector('#ceForm') || wsEl, user, course) }, course)}
              • Batas ${draft.dueDate ? UI.fmtYMD(draft.dueDate) : '-'}</div>
            <div class="content rt-content">${draft.description ? RichText.render(draft.description)
              : '<span class="muted">Instruksi belum ditulis.</span>'}</div>
            ${isSoal ? (qs.length ? `<ol class="ce-prev-q">${qs.map(q =>
              `<li><span class="muted small">${esc(q.questionType || '')}</span><div class="rt-content">${RichText.render(q.text || '')}</div></li>`).join('')}</ol>`
              : '<div class="empty" style="padding:16px;"><div class="empty-icon">📚</div>Belum ada soal.</div>')
              : '<div class="ce-prev-answer">Kolom jawaban uraian siswa</div>'}
          </div>
        </div>`;
    }

    paint();
    bindBack(() => dirty, o.onSaved);
    wsEl.querySelector('#ceSave').addEventListener('click', () => {
      const form = wsEl.querySelector('#ceForm');
      const title = form.querySelector('#ceTitle').value.trim();
      const due = form.querySelector('#ceDue').value;
      if (!title) { UI.toast('Judul tugas wajib diisi.', 'error'); return; }
      if (!due) { UI.toast('Batas pengumpulan wajib diisi.', 'error'); return; }
      if (!RichText.plain(draft.description, 400).trim()) { UI.toast('Instruksi tugas masih kosong.', 'error'); return; }
      if (draft.mode === 'soal' && !draft.questionIds.length) {
        UI.toast('Tugas berbasis soal membutuhkan minimal satu soal.', 'error');
        return;
      }

      const base = {
        courseId: course.id,
        title,
        description: RichText.sanitize(draft.description),
        dueDate: new Date(due).getTime(),
        mode: draft.mode,
        questionIds: draft.mode === 'soal' ? draft.questionIds.slice() : [],
        maxScore: Math.max(1, Math.min(100, Number(form.querySelector('#ceMax').value) || 100))
      };
      let saved;
      if (editing) {
        const patch = DB.stampEditor(base, user);
        patch.createdBy = readOwnerId(form, user, course) || editing.createdBy || null;
        saved = DB.updateAssignment(editing.id, patch);
      } else {
        saved = DB.addAssignment(DB.stampCreator(base, user, readOwnerId(form, user, course)));
        // Beri tahu siswa kelas ini bahwa ada tugas baru
        const ids = DB.getEnrollmentsByCourse(course.id).map(e => e.studentId);
        if (ids.length) {
          DB.notifyUsers(ids, {
            type: 'tugas', icon: '📝', title: 'Tugas baru',
            body: `${title} — ${DB.courseTitle(course)}. Batas ${UI.fmtDate(base.dueDate)}.`,
            link: 'assignments'
          });
        }
      }
      UI.toast('Tugas disimpan.', 'success');
      closeWorkspace();
      if (typeof o.onSaved === 'function') o.onSaved(saved);
    });
  }

  global.ContentEditor = {
    openMaterial, openModule, openRecording, openAssignment,
    closeWorkspace,
    creditHtml, metaHtml, ownerFieldHtml, readOwnerId,
    openWorkspace, bindBack,
    ASSIGN_MODES
  };
})(window);
