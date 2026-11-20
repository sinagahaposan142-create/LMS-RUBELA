/* =========================================================================
 * UtbkCalc — Tools → Kalkulator UTBK (semua peran).
 *
 * Alur: isi skor 7 subtest (atau ambil dari tryout LMS) → pilih Kampus →
 * Fakultas → Jurusan (atau cari) → hasil: peluang, rata-rata & skor minimum
 * diterima, total skor 7 subtest, selisih per subtest, keketatan, jurusan
 * serupa yang lebih aman, analisis AI, dan perbandingan hingga 4 pilihan.
 * Data jurusan diisi admin (js/ptn-admin.js); model peluang ada di js/ptn.js.
 * Skor & pilihan tersimpan di akun pengguna (lms_utbk_plans).
 * =======================================================================*/
(function (global) {
  'use strict';

  const esc = (s) => UI.esc(s);
  const fmt = (n, d) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('id-ID', { maximumFractionDigits: d == null ? 1 : d }));
  const signed = (n) => (n == null ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '±') + fmt(Math.abs(n)));
  const svg = (d, size) => `<svg viewBox="0 0 24 24" width="${size || 16}" height="${size || 16}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    calc: svg('<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h8"/>', 20),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    star: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"/>'),
    spark: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/>')
  };
  const SUB = () => (global.DB && DB.SUBTESTS ? DB.SUBTESTS : PTN.CODES.map(code => ({ code, short: code, name: code })));
  const SYSTEM = 'Kamu konselor pendidikan untuk siswa SMA di Indonesia yang bersiap UTBK-SNBT. Gunakan HANYA data yang diberikan. ' +
    'Jangan mengarang skor, daya tampung, kampus, atau jurusan di luar data. Peluang berasal dari model sederhana aplikasi, bukan prediksi resmi SNPMB; ' +
    'sampaikan dengan jujur. Jawab dalam Bahasa Indonesia yang ringkas, hangat, dan konkret.';

  // Pilihan jurusan terakhir dipertahankan selama sesi (pindah menu lalu kembali).
  const sel = { campusId: '', facultyId: '', majorId: '' };

  function render(container, user) {
    const plan = PTN.plan(user.id);
    const scores = Object.assign({}, plan.scores);
    let choices = plan.choices.filter(id => PTN.major(id));
    let saveTimer = null;
    const allMajors = PTN.majors();
    if (sel.majorId && !PTN.major(sel.majorId)) { sel.campusId = ''; sel.facultyId = ''; sel.majorId = ''; }

    const head = `<div class="card tl-head">
        ${UI.secHead(ICON.calc, 'Kalkulator UTBK', 'Perkirakan peluang masuk jurusan dari skor UTBK-mu dan data jurusan yang diisi admin.')}
        ${user.role === 'admin' ? '<button type="button" class="btn btn-secondary btn-sm" data-go="data-ptn">Kelola data PTN</button>' : ''}
      </div>`;
    if (!allMajors.length) {
      container.innerHTML = `${head}<div class="card"><div class="tl-empty">
        <strong>Data kampus dan jurusan belum tersedia</strong>
        <span>${user.role === 'admin' ? 'Tambahkan kampus, fakultas, dan jurusan beserta rata-rata skornya di menu Data PTN, atau impor dari Excel.' : 'Admin belum mengisi data jurusan. Coba lagi nanti.'}</span>
        ${user.role === 'admin' ? '<button type="button" class="btn btn-primary btn-sm" data-go="data-ptn">Buka Data PTN</button>' : ''}</div></div>`;
      bindGo(container);
      return;
    }

    const tryout = user.role === 'siswa' ? PTN.tryoutScores(user.id) : { scores: {}, attempts: 0 };
    container.innerHTML = `${head}
      <div class="tl-grid">
        <section class="card tl-card" aria-labelledby="tlScoreHead">
          <div class="tl-card-head"><h3 id="tlScoreHead"><span class="tl-step">1</span>Skor kamu</h3>
            <p>Skala skor UTBK per subtest (0–1000). Kosongkan subtest yang belum ada nilainya.</p></div>
          <div class="tl-score-grid">${SUB().map(s => `<label class="tl-score">
              <span class="tl-code">${esc(s.code)}</span><span class="tl-name">${esc(PTN.subLabel(s))}</span>
              <input type="text" inputmode="decimal" autocomplete="off" data-code="${esc(s.code)}" value="${scores[s.code] != null ? esc(String(scores[s.code]).replace('.', ',')) : ''}" placeholder="—" aria-label="Skor ${esc(s.name)}" />
            </label>`).join('')}</div>
          <div class="tl-sum" id="tlSum"></div>
          <div class="tl-actions">
            ${user.role === 'siswa' ? `<button type="button" class="btn btn-secondary btn-sm" id="tlTryout" ${Object.keys(tryout.scores).length ? '' : 'disabled'}>Isi dari tryout LMS</button>` : ''}
            <button type="button" class="btn btn-ghost btn-sm" id="tlClear">Kosongkan</button>
          </div>
          ${user.role === 'siswa' ? `<p class="tl-note">${Object.keys(tryout.scores).length
            ? 'Tryout LMS memakai skor IRT cohort 200–800 (rata-rata 3 tryout terakhir per subtest). Skalanya berbeda dari UTBK resmi, jadi anggap sebagai perkiraan kasar.'
            : 'Belum ada hasil tryout ber-skor IRT di LMS untuk diisi otomatis.'}</p>` : ''}
        </section>
        <section class="card tl-card" aria-labelledby="tlPickHead">
          <div class="tl-card-head"><h3 id="tlPickHead"><span class="tl-step">2</span>Pilih jurusan</h3>
            <p>${allMajors.length.toLocaleString('id-ID')} jurusan dari ${PTN.campuses().length.toLocaleString('id-ID')} kampus.</p></div>
          <div class="tl-search">
            <label class="tl-search-in">${ICON.search}<span class="sr-only">Cari jurusan atau kampus</span>
              <input type="search" id="tlQ" placeholder="Cari jurusan atau kampus, mis. kedokteran ugm" autocomplete="off" aria-controls="tlHits" /></label>
            <div class="tl-hits" id="tlHits" role="listbox" hidden></div>
          </div>
          <div class="form tl-selects">
            <div class="form-group"><label for="tlCampus">Kampus</label><select id="tlCampus"></select></div>
            <div class="form-group"><label for="tlFaculty">Fakultas</label><select id="tlFaculty"></select></div>
            <div class="form-group"><label for="tlMajor">Jurusan</label><select id="tlMajor"></select></div>
          </div>
        </section>
      </div>
      <div id="tlResult"></div>
      <section class="card tl-card" id="tlChoices" aria-labelledby="tlChoiceHead"></section>`;
    bindGo(container);

    const $ = (s) => container.querySelector(s);
    const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => PTN.savePlan(user.id, { scores, choices }), 500); };

    /* ---- skor ---- */
    function paintSum() {
      const s = PTN.summary(scores);
      $('#tlSum').innerHTML = `<div><span>Rata-rata</span><strong>${fmt(s.avg)}</strong></div>
        <div><span>Total ${s.complete ? '7 subtest' : s.filled + ' subtest'}</span><strong>${s.filled ? fmt(s.total) : '—'}</strong></div>
        <div><span>Terisi</span><strong>${s.filled}/7</strong></div>`;
    }
    container.querySelectorAll('[data-code]').forEach(inp => {
      inp.addEventListener('input', () => {
        const n = PTN.num(inp.value, 0, 1000, false);
        const bad = Number.isNaN(n);
        inp.classList.toggle('is-bad', bad);
        inp.setAttribute('aria-invalid', bad ? 'true' : 'false');
        if (bad) delete scores[inp.dataset.code]; else if (n == null) delete scores[inp.dataset.code]; else scores[inp.dataset.code] = n;
        paintSum(); paintResult(); paintChoices(); persist();
      });
    });
    const tBtn = $('#tlTryout');
    if (tBtn) tBtn.addEventListener('click', () => {
      Object.assign(scores, tryout.scores);
      container.querySelectorAll('[data-code]').forEach(inp => {
        if (scores[inp.dataset.code] != null) { inp.value = String(scores[inp.dataset.code]).replace('.', ','); inp.classList.remove('is-bad'); }
      });
      paintSum(); paintResult(); paintChoices(); persist();
      UI.toast(`Skor diisi dari ${Math.min(3, tryout.attempts)} tryout terakhir.`, 'info');
    });
    $('#tlClear').addEventListener('click', () => {
      Object.keys(scores).forEach(k => delete scores[k]);
      container.querySelectorAll('[data-code]').forEach(inp => { inp.value = ''; inp.classList.remove('is-bad'); });
      paintSum(); paintResult(); paintChoices(); persist();
    });

    /* ---- pilih jurusan ---- */
    const campusSel = $('#tlCampus'), facSel = $('#tlFaculty'), majorSel = $('#tlMajor');
    function paintSelects() {
      const cs = PTN.campuses().filter(c => allMajors.some(m => m.campusId === c.id));
      campusSel.innerHTML = '<option value="">Pilih kampus</option>' + cs.map(c => `<option value="${esc(c.id)}" ${sel.campusId === c.id ? 'selected' : ''}>${esc(c.name)}${c.short ? ' (' + esc(c.short) + ')' : ''}</option>`).join('');
      const fs = sel.campusId ? PTN.faculties(sel.campusId).filter(f => allMajors.some(m => m.facultyId === f.id)) : [];
      facSel.disabled = !sel.campusId;
      facSel.innerHTML = `<option value="">${sel.campusId ? 'Semua fakultas' : 'Pilih kampus dulu'}</option>` + fs.map(f => `<option value="${esc(f.id)}" ${sel.facultyId === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
      const ms = sel.campusId ? PTN.majors({ campusId: sel.campusId, facultyId: sel.facultyId || null }) : [];
      majorSel.disabled = !sel.campusId;
      majorSel.innerHTML = `<option value="">${sel.campusId ? 'Pilih jurusan' : 'Pilih kampus dulu'}</option>` + ms.map(m => `<option value="${esc(m.id)}" ${sel.majorId === m.id ? 'selected' : ''}>${esc(m.name)}${m.level !== 'S1' ? ' (' + esc(m.level) + ')' : ''}</option>`).join('');
    }
    function pick(majorId) {
      const m = PTN.major(majorId);
      if (!m) return;
      sel.campusId = m.campusId; sel.facultyId = m.facultyId || ''; sel.majorId = m.id;
      paintSelects(); paintResult();
      const r = $('#tlResult');
      if (r && r.scrollIntoView) r.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }
    campusSel.addEventListener('change', () => { sel.campusId = campusSel.value; sel.facultyId = ''; sel.majorId = ''; paintSelects(); paintResult(); });
    facSel.addEventListener('change', () => { sel.facultyId = facSel.value; const m = PTN.major(sel.majorId); if (m && sel.facultyId && m.facultyId !== sel.facultyId) sel.majorId = ''; paintSelects(); paintResult(); });
    majorSel.addEventListener('change', () => { sel.majorId = majorSel.value; paintResult(); });

    const q = $('#tlQ'), hits = $('#tlHits');
    const index = allMajors.map(m => {
      const c = PTN.campus(m.campusId) || {}, f = PTN.faculty(m.facultyId) || {};
      return { m, c, f, hay: PTN.norm([m.name, m.level, c.name, c.short, c.city, f.name].join(' ')) };
    });
    function search() {
      const terms = PTN.norm(q.value).split(' ').filter(Boolean);
      if (!terms.length) { hits.hidden = true; hits.innerHTML = ''; return; }
      const found = index.filter(x => terms.every(t => x.hay.includes(t))).slice(0, 8);
      hits.hidden = false;
      hits.innerHTML = found.length ? found.map(x => `<button type="button" role="option" class="tl-hit" data-pick="${esc(x.m.id)}">
          <strong>${esc(x.m.name)}${x.m.level !== 'S1' ? ' (' + esc(x.m.level) + ')' : ''}</strong>
          <span>${esc(x.c.name || '')}${x.f.name ? ' · ' + esc(x.f.name) : ''}</span></button>`).join('')
        : '<div class="tl-hit-empty">Tidak ada jurusan yang cocok.</div>';
      hits.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => { q.value = ''; hits.hidden = true; pick(b.dataset.pick); }));
    }
    q.addEventListener('input', search);
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const first = hits.querySelector('[data-pick]'); if (first) first.click(); }
      else if (e.key === 'Escape') { hits.hidden = true; }
    });

    /* ---- hasil ---- */
    function dataBlock(m, ch) {
      const c = PTN.campus(m.campusId) || {}, f = PTN.faculty(m.facultyId) || {};
      const sub = SUB().map(s => `${s.code} (${s.name}): skor saya ${scores[s.code] != null ? scores[s.code] : 'kosong'}; rata-rata jurusan ${m.subtests && m.subtests[s.code] != null ? m.subtests[s.code] : 'tidak ada data'}`).join('\n');
      const alts = PTN.alternatives(scores, m, 5).map(a => `- ${PTN.majorLabel(a.major)}: peluang ${a.chance.pct}% (rata-rata diterima ${fmt(a.major.avgScore)})`).join('\n') || '- (tidak ada data pembanding)';
      const saved = choices.filter(id => id !== m.id).map(id => { const x = PTN.major(id); const cx = PTN.chance(scores, x); return x ? `- ${PTN.majorLabel(x)}: peluang ${cx ? cx.pct + '%' : 'belum dihitung'}` : ''; }).filter(Boolean).join('\n') || '- (belum ada)';
      return `DATA JURUSAN: ${m.name} (${m.level}), ${f.name || 'fakultas tidak diisi'}, ${c.name || ''}${c.city ? ', ' + c.city : ''}. Tahun data ${m.year || 'tidak diisi'}, sumber: ${m.source || 'tidak diisi'}.
Rata-rata skor diterima: ${m.avgScore != null ? m.avgScore : 'tidak ada'}; skor minimum diterima: ${m.minScore != null ? m.minScore : 'tidak ada'}.
Daya tampung: ${m.capacity != null ? m.capacity : 'tidak ada'}; peminat: ${m.applicants != null ? m.applicants : 'tidak ada'}.
SKOR SAYA: rata-rata ${fmt(ch.me.avg)} dari ${ch.me.filled}/7 subtest, total ${fmt(ch.me.total)}.
${sub}
HASIL MODEL APLIKASI: peluang ${ch.pct}% (${ch.level.label}); ambang ${fmt(ch.cutoff)} (${ch.basis === 'min' ? 'skor minimum diterima' : 'rata-rata diterima − 45'}); selisih dari rata-rata diterima ${ch.vsAvg != null ? signed(ch.vsAvg) : 'tidak ada'}.
ALTERNATIF (dihitung aplikasi):
${alts}
PILIHAN TERSIMPAN LAIN:
${saved}`;
    }
    function paintResult() {
      const box = $('#tlResult');
      const m = PTN.major(sel.majorId);
      if (!m) { box.innerHTML = ''; return; }
      const c = PTN.campus(m.campusId) || {}, f = PTN.faculty(m.facultyId) || {};
      const ch = PTN.chance(scores, m);
      const saved = choices.includes(m.id);
      const lv = ch ? ch.level.key : 'none';
      const R = 34, C = 2 * Math.PI * R;
      box.innerHTML = `<section class="card tl-result" aria-labelledby="tlResHead" aria-live="polite">
        <header class="tl-r-head">
          <div><span class="tl-kicker">${esc(m.level)}${f.name ? ' · ' + esc(f.name) : ''}</span>
            <h3 id="tlResHead">${esc(m.name)}</h3>
            <p>${esc(c.name || 'Kampus dihapus')}${c.short ? ' (' + esc(c.short) + ')' : ''}${c.city ? ' · ' + esc(c.city) : ''}</p></div>
          <button type="button" class="btn ${saved ? 'btn-secondary' : 'btn-primary'} btn-sm" id="tlSave" ${!saved && choices.length >= PTN.MAX_CHOICES ? 'disabled title="Maksimal 4 pilihan"' : ''}>
            ${ICON.star} ${saved ? 'Hapus dari pilihan' : 'Simpan ke pilihan'}</button>
        </header>
        ${ch ? `<div class="tl-chance is-${lv}">
            <div class="tl-gauge" role="img" aria-label="Peluang ${ch.pct} persen">
              <svg viewBox="0 0 80 80" width="96" height="96" aria-hidden="true"><circle cx="40" cy="40" r="${R}" class="tl-g-bg"/>
                <circle cx="40" cy="40" r="${R}" class="tl-g-val" stroke-dasharray="${(C * ch.pct / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 40 40)"/></svg>
              <strong>${ch.pct}%</strong></div>
            <div class="tl-chance-txt"><span class="tl-level">${esc(ch.level.label)}</span>
              <p>Rata-rata skormu <strong>${fmt(ch.me.avg)}</strong>${ch.vsAvg != null ? `, ${esc(signed(ch.vsAvg))} dari rata-rata diterima (${fmt(m.avgScore)})` : ''}${m.minScore != null ? ` dan ${esc(signed(Math.round((ch.me.avg - m.minScore) * 10) / 10))} dari skor minimum (${fmt(m.minScore)})` : ''}.</p>
              ${ch.me.complete ? '' : `<p class="tl-warn">Baru ${ch.me.filled} dari 7 subtest terisi. Lengkapi agar perkiraan lebih akurat.</p>`}
              <p class="tl-disc">Perkiraan dari data yang diisi admin, bukan prediksi resmi SNPMB.</p></div>
          </div>` : `<div class="tl-chance is-none"><div class="tl-chance-txt"><span class="tl-level">Isi skor dulu</span>
            <p>Masukkan skor subtest di langkah 1 untuk melihat peluangmu di jurusan ini.</p></div></div>`}
        <dl class="tl-stats">
          <div><dt>Rata-rata skor diterima</dt><dd>${fmt(m.avgScore)}</dd></div>
          <div><dt>Skor minimum diterima</dt><dd>${fmt(m.minScore)}</dd></div>
          <div><dt>Total 7 subtest jurusan</dt><dd>${ch && ch.majorTotal != null ? fmt(ch.majorTotal) + (ch.majorTotalExact ? '' : '<small>perkiraan (rata-rata × 7)</small>') : (m.avgScore != null ? fmt(m.avgScore * 7) + '<small>perkiraan (rata-rata × 7)</small>' : '—')}</dd></div>
          <div><dt>Total skor kamu</dt><dd>${ch ? fmt(ch.me.total) + (ch.me.complete ? '' : `<small>${ch.me.filled} subtest</small>`) : '—'}</dd></div>
          <div><dt>Daya tampung</dt><dd>${fmt(m.capacity, 0)}</dd></div>
          <div><dt>Peminat</dt><dd>${fmt(m.applicants, 0)}</dd></div>
          <div><dt>Keketatan</dt><dd>${m.capacity && m.applicants ? `${fmt((m.capacity / m.applicants) * 100, 2)}%<small>±1 dari ${fmt(Math.max(1, Math.round(m.applicants / m.capacity)), 0)} peminat diterima</small>` : '—'}</dd></div>
        </dl>
        <h4 class="tl-sub-h">Skor per subtest</h4>
        ${subtestTable(m)}
        <details class="tl-how"><summary>Cara perhitungan</summary>
          <ol>
            <li>Skor kamu = rata-rata subtest yang diisi${ch ? ` (${fmt(ch.me.avg)})` : ''}.</li>
            <li>Ambang = ${m.minScore != null ? `skor minimum diterima (${fmt(m.minScore)})` : `rata-rata diterima − 45 (${m.avgScore != null ? fmt(m.avgScore - 45) : '—'}), karena skor minimum belum diisi admin`}.</li>
            <li>Peluang = Φ((skor kamu − ambang) ÷ ${m.minScore != null ? 30 : 35}), dibatasi 1–99%. Angka ${m.minScore != null ? 30 : 35} mewakili naik-turunnya ambang antartahun dan selisih skor tryout dengan UTBK sebenarnya.</li>
            <li>Kategori: ≥ 80% Peluang tinggi, 55–79% Berpeluang, 30–54% Kompetitif, &lt; 30% Berisiko.</li>
          </ol>
          <p>Model ini tidak memperhitungkan pilihan peserta lain, kuota afirmasi, atau kebijakan kampus. Gunakan sebagai gambaran, bukan kepastian.</p>
        </details>
        <p class="tl-src">${m.year ? 'Data tahun ' + esc(m.year) : 'Tahun data belum diisi'}${m.source ? ' · Sumber: ' + esc(m.source) : ''}${m.notes ? ' · ' + esc(m.notes) : ''}</p>
        ${ch ? altHtml(m) : ''}
        <div class="tl-ai">
          <div class="tl-ai-head"><h4>Analisis AI</h4>
            <button type="button" class="btn btn-secondary btn-sm" id="tlAi" ${ch && global.AI && AI.ready() ? '' : 'disabled'}>${ICON.spark} Analisis dengan AI</button></div>
          ${global.AI && !AI.ready() ? AI.noticeHtml(user) : ''}
          ${!ch ? '<p class="tl-note">Isi skor dulu agar AI punya bahan untuk dianalisis.</p>' : ''}
          <div id="tlAiOut" class="tl-ai-out"></div>
          ${ch && global.AI && AI.ready() && global.AIChat ? '<details class="tl-ai-chat" id="tlAiChatBox"><summary>Tanya lanjut ke AI</summary><div id="tlAiChat" class="aic-card"></div></details>' : ''}
        </div>
      </section>`;
      $('#tlSave').addEventListener('click', () => {
        choices = saved ? choices.filter(id => id !== m.id) : choices.concat(m.id).slice(0, PTN.MAX_CHOICES);
        PTN.savePlan(user.id, { scores, choices });
        UI.toast(saved ? 'Dihapus dari pilihan.' : 'Disimpan ke pilihan.', 'success');
        paintResult(); paintChoices();
      });
      box.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => pick(b.dataset.pick)));
      const aiBtn = $('#tlAi');
      if (aiBtn && ch) aiBtn.addEventListener('click', async () => {
        const out = $('#tlAiOut');
        aiBtn.disabled = true;
        out.innerHTML = AI.loadingHtml('AI sedang membaca skor dan data jurusan…');
        try {
          const ans = await AI.ask(`Analisis peluang saya masuk jurusan ini.
Susun jawaban dengan judul bagian:
1. Posisi saat ini (2–3 kalimat).
2. Subtest prioritas (maksimal 3) beserta target skor, berdasarkan selisih per subtest.
3. Strategi pilihan aman/realistis/ambisius, hanya dari daftar ALTERNATIF dan PILIHAN TERSIMPAN (bila kosong, katakan belum ada data pembanding).
4. Rencana belajar 4 minggu (poin singkat).
Maksimal 300 kata.

${dataBlock(m, ch)}`, { system: SYSTEM, temperature: 0.4, maxTokens: 1400 });
          if (!out.isConnected) return;
          out.innerHTML = `<div class="tl-ai-md">${AI.renderMarkdown(ans)}</div><p class="tl-disc">Disusun AI dari data di atas. Periksa kembali sebelum mengambil keputusan.</p>`;
        } catch (e) {
          if (out.isConnected) out.innerHTML = AI.errorHtml(e);
        } finally { if (aiBtn.isConnected) aiBtn.disabled = false; }
      });
      const chatBox = $('#tlAiChatBox');
      if (chatBox) chatBox.addEventListener('toggle', () => {
        if (!chatBox.open || chatBox.dataset.mounted) return;
        chatBox.dataset.mounted = '1';
        AIChat.mount(chatBox.querySelector('#tlAiChat'), user, {
          kind: 'utbk', ref: 'utbk:' + m.id, compact: true, icon: 'AI', title: 'Diskusi pilihan jurusan', subtitle: PTN.majorLabel(m),
          temperature: 0.4, maxTokens: 1200, placeholder: 'Tanyakan target skor, strategi, atau perbandingan…',
          intro: 'Saya sudah membaca skormu dan data jurusan ini. Apa yang ingin kamu tanyakan?',
          suggestions: ['Subtest mana yang paling cepat dinaikkan?', 'Berapa target skor aman untuk jurusan ini?', 'Bandingkan dengan pilihan saya yang lain.'],
          context: () => ({ system: SYSTEM + '\n\n' + dataBlock(m, PTN.chance(scores, m) || ch) })
        });
      });
    }
    function subtestTable(m) {
      const sub = m.subtests || {};
      const anyMajor = PTN.CODES.some(c => sub[c] != null);
      const rows = SUB().map(s => {
        const mine = scores[s.code] != null ? scores[s.code] : null;
        const theirs = sub[s.code] != null ? sub[s.code] : null;
        const diff = mine != null && theirs != null ? Math.round((mine - theirs) * 10) / 10 : null;
        const w = diff == null ? 0 : Math.min(50, Math.abs(diff) / 4);
        return `<tr><th scope="row"><span class="tl-code">${esc(s.code)}</span> <span class="tl-sub-name">${esc(PTN.subLabel(s))}</span></th>
          <td class="num">${fmt(mine)}</td><td class="num">${fmt(theirs)}</td>
          <td class="num tl-diff ${diff == null ? '' : diff >= 0 ? 'is-up' : 'is-down'}">${diff == null ? '—' : esc(signed(diff))}</td>
          <td class="tl-bar-cell" aria-hidden="true"><span class="tl-bar"><span class="${diff == null ? '' : diff >= 0 ? 'is-up' : 'is-down'}" style="${diff == null ? 'width:0' : (diff >= 0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%`)}"></span></span></td></tr>`;
      }).join('');
      // Sengaja bukan .table: tabel 4 kolom ini tetap berbentuk tabel di ponsel (tidak diubah jadi kartu).
      return `<div class="tl-sub-wrap"><table class="tl-sub-table">
        <thead><tr><th scope="col">Subtest</th><th scope="col" class="num">Skor kamu</th><th scope="col" class="num">Rata-rata jurusan</th><th scope="col" class="num">Selisih</th><th scope="col" class="tl-bar-cell"><span class="sr-only">Grafik selisih</span></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        ${anyMajor ? '' : '<p class="tl-note">Admin belum mengisi rata-rata per subtest untuk jurusan ini, jadi kolom pembanding kosong.</p>'}`;
    }
    function altHtml(m) {
      const alts = PTN.alternatives(scores, m, 5);
      if (!alts.length) return '';
      return `<div class="tl-alt"><h4>Jurusan serupa dengan peluang lebih baik</h4>
        <div class="tl-alt-list">${alts.map(a => `<button type="button" class="tl-alt-item" data-pick="${esc(a.major.id)}">
          <span><strong>${esc(a.major.name)}</strong><small>${esc((PTN.campus(a.major.campusId) || {}).name || '')}</small></span>
          <span class="tl-pill is-${a.chance.level.key}">${a.chance.pct}%</span></button>`).join('')}</div></div>`;
    }

    /* ---- pilihan tersimpan ---- */
    function paintChoices() {
      const box = $('#tlChoices');
      choices = choices.filter(id => PTN.major(id));
      box.innerHTML = `<div class="tl-card-head"><h3 id="tlChoiceHead"><span class="tl-step">3</span>Pilihan saya <span class="tl-count">${choices.length}/${PTN.MAX_CHOICES}</span></h3>
        <p>Simpan hingga 4 jurusan untuk dibandingkan. Tersimpan di akunmu dan ikut ke perangkat lain.</p></div>
        ${choices.length ? `<div class="table-wrap"><table class="table tl-choice-table">
          <thead><tr><th>#</th><th>Jurusan</th><th class="num">Rata-rata diterima</th><th class="num">Selisih</th><th>Peluang</th><th><span class="sr-only">Aksi</span></th></tr></thead>
          <tbody>${choices.map((id, i) => {
            const m = PTN.major(id);
            const ch = PTN.chance(scores, m);
            return `<tr><td>${i + 1}</td><td><strong>${esc(m.name)}</strong><div class="muted small">${esc((PTN.campus(m.campusId) || {}).name || '')}</div></td>
              <td class="num">${fmt(m.avgScore)}</td><td class="num">${ch && ch.vsAvg != null ? esc(signed(ch.vsAvg)) : '—'}</td>
              <td>${ch ? `<span class="tl-pill is-${ch.level.key}">${ch.pct}% · ${esc(ch.level.label)}</span>` : '<span class="muted small">isi skor</span>'}</td>
              <td class="actions"><button type="button" class="btn btn-sm btn-secondary" data-pick="${esc(m.id)}">Lihat</button>
                <button type="button" class="btn btn-sm btn-ghost" data-unpick="${esc(m.id)}">Hapus</button></td></tr>`;
          }).join('')}</tbody></table></div>` : '<p class="tl-note">Belum ada pilihan. Pilih jurusan lalu tekan "Simpan ke pilihan".</p>'}`;
      box.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => pick(b.dataset.pick)));
      box.querySelectorAll('[data-unpick]').forEach(b => b.addEventListener('click', () => {
        choices = choices.filter(id => id !== b.dataset.unpick);
        PTN.savePlan(user.id, { scores, choices });
        paintChoices(); paintResult();
      }));
    }

    paintSum();
    paintSelects();
    paintResult();
    paintChoices();
  }

  function bindGo(container) {
    container.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => global.Dashboard && Dashboard.navigate(b.dataset.go)));
  }

  global.UtbkCalc = { render };
})(window);
