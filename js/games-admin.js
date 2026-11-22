/* =====================================================================
 * js/games-admin.js — Kelola Game Battle (admin & tutor)
 * ---------------------------------------------------------------------
 *  - Ringkasan  : kesiapan soal tiap game, statistik main & battle.
 *  - Soal Game  : buat/edit soal khusus game dengan editor soal LMS
 *                 (semua format otomatis), atur game tujuan, aktif/nonaktif.
 *  - Bank Soal  : salin soal dari Bank Soal ke Soal Game; kecocokan tiap
 *                 soal dengan semua game ditampilkan otomatis.
 *  - Buat dg AI : generate soal sesuai format yang dibutuhkan game,
 *                 wajib ditinjau sebelum disimpan.
 *  - Coba Game  : pratinjau semua game (tidak tersimpan).
 *  - Pengaturan : (admin) aktif/nonaktif fitur, battle, bot, sumber soal, tiap game.
 * Data: lms_game_questions (STAFF_ONLY di server).
 * ===================================================================*/
(function (global) {
  'use strict';

  const esc = (s) => UI.esc(s);
  const plain = (h, n) => RichText.plain(h || '', n || 200).trim();
  const view = { tab: 'ringkasan' };
  let host = null;

  /* Format yang dihasilkan AI per game (urut sesuai kecocokan terbaik). */
  const AI_FORMATS = {
    kilat: ['Pilihan Ganda', 'Benar/Salah', 'Pilihan Lebih dari Satu'],
    bsturbo: ['Benar/Salah', 'Benar/Salah Majemuk'],
    survival: ['Pilihan Ganda', 'Pilihan Lebih dari Satu', 'Benar/Salah', 'Isian Singkat', 'Benar/Salah Majemuk', 'Majemuk Kompleks', 'Menjodohkan', 'Urutan'],
    jutawan: ['Pilihan Ganda'],
    taruhan: ['Pilihan Ganda', 'Pilihan Lebih dari Satu', 'Benar/Salah', 'Isian Singkat', 'Benar/Salah Majemuk', 'Menjodohkan', 'Urutan'],
    isian: ['Isian Singkat'],
    jodoh: ['Menjodohkan'],
    memori: ['Menjodohkan', 'Pilihan Ganda'],
    urutan: ['Urutan'],
    balon: ['Pilihan Ganda']
  };
  const AI_HINT = {
    jutawan: 'Setiap soal WAJIB punya 4 pilihan (A–D) dengan pengecoh yang masuk akal.',
    balon: 'Pilihan jawaban sangat singkat (maksimal 5 kata), 3–4 pilihan.',
    memori: 'Teks setiap item sangat pendek (maksimal 6 kata) karena ditampilkan di kartu kecil.',
    bsturbo: 'Pernyataan singkat dan tegas, dapat dinilai benar/salah tanpa ambigu.',
    jodoh: 'Buat 4–6 pasangan per soal; teks kiri & kanan singkat.',
    urutan: 'Buat 4–6 item yang harus diurutkan; kunci = urutan yang benar.',
    isian: 'Jawaban berupa satu kata/angka singkat yang tidak ambigu; boleh beberapa jawaban yang diterima dipisah koma.'
  };

  function canManage(user, q) { return user.role === 'admin' || !q.authorId || q.authorId === user.id; }
  const compatGames = (q) => Games.GAMES.filter(g => Games.autoValid(q) && g.accepts(q));
  const isEssay = (q) => (q.questionType || 'Pilihan Ganda') === 'Esai';

  /* ================================================================ */
  function render(container, user) {
    host = { container, user };
    const tabs = [['ringkasan', '📊 Ringkasan'], ['soal', '🧩 Soal Game'], ['bank', '📥 Ambil dari Bank Soal'], ['ai', '🤖 Buat dengan AI'], ['coba', '🎮 Coba Game']];
    if (global.GameRoom) tabs.push(['bareng', '🎪 Main Bareng']);
    if (user.role === 'admin') tabs.push(['atur', '⚙️ Pengaturan']);
    if (!tabs.some(t => t[0] === view.tab)) view.tab = 'ringkasan';
    const st = Games.settings();
    container.innerHTML = `
      <section class="welcome-hero gb-hero">
        <span class="blob b1"></span><span class="blob b2"></span>
        <div class="wh-inner">
          <div class="wh-eyebrow">⚔️ Kelola Game Battle</div>
          <h2>${Games.GAMES.length} game edukasi berbasis Bank Soal</h2>
          <p class="wh-sub">Siapkan soal untuk setiap game: tulis sendiri dengan format soal LMS, salin dari Bank Soal, atau buat dengan AI.
            Siswa bermain sendiri, battle 1 lawan 1 dengan teman yang sedang online, atau Main Bareng sekelas (Monster Co-op & Balap Kelas) dengan kode ruang.</p>
          <div class="wh-chips"><span class="wh-chip">${st.enabled ? '🟢 Aktif' : '🔴 Nonaktif'}</span>
            <span class="wh-chip">📚 Sumber: ${esc({ both: 'Bank Soal + Soal Game', game: 'Soal Game saja', bank: 'Bank Soal saja' }[st.source])}</span>
            <span class="wh-chip">🧩 ${Games.getGameQuestions().length} soal game</span></div>
        </div>
      </section>
      <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" class="tab-btn ${view.tab === k ? 'active' : ''}" data-gtab="${k}">${l}</button>`).join('')}</div>
      <div id="gaBody"></div>`;
    container.querySelectorAll('[data-gtab]').forEach(b => b.addEventListener('click', () => { Games.stopSession('tab'); if (global.GameRoom) GameRoom.stop(); view.tab = b.dataset.gtab; render(container, user); }));
    const body = container.querySelector('#gaBody');
    const paintBareng = (el, u) => { GameRoom.tidy(u); GameRoom.renderHost(el, u); };
    ({ ringkasan: paintSummary, soal: paintQuestions, bank: paintBank, ai: paintAi, coba: paintTry, atur: paintSettings, bareng: paintBareng })[view.tab](body, user);
    if (global.Effects) Effects.enhance(container);
    if (global.Responsive) Responsive.apply(container);
  }
  const rerender = () => { if (host && host.container.isConnected) render(host.container, host.user); };

  /* ---------------- Ringkasan ---------------- */
  function paintSummary(body, user) {
    const scores = Games.getScores();
    const battles = Games.getBattles();
    const today = DB.ymdOf(Date.now());
    const playsToday = scores.filter(s => DB.ymdOf(s.createdAt) === today).length;
    const players = new Set(scores.map(s => s.studentId)).size;
    const done = battles.filter(b => b.status === 'done').length;
    const st = Games.settings();
    const list = Games.playableGames('');
    body.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-primary"><div class="label">Ronde dimainkan</div><div class="value">${scores.length}</div><div class="sub">${playsToday} hari ini</div></div>
        <div class="stat-card accent-success"><div class="label">Battle selesai</div><div class="value">${done}</div><div class="sub">dari ${battles.length} tantangan</div></div>
        <div class="stat-card accent-warning"><div class="label">Pemain</div><div class="value">${players}</div><div class="sub">siswa unik</div></div>
        <div class="stat-card accent-danger"><div class="label">Game siap</div><div class="value">${list.filter(x => x.ok).length}/${list.length}</div><div class="sub">soal mencukupi</div></div>
      </div>
      ${global.GamesStarter ? (() => {
        const total = GamesStarter.count(), have = GamesStarter.installed();
        return have >= total ? '' : `<div class="card ga-starter">
          <div class="card-header">${UI.secHead('📦', 'Paket Soal Contoh', `${total} soal siap pakai untuk semua format — langsung bisa dimainkan di semua game`)}
            <button type="button" class="btn btn-primary btn-sm" id="gaStarter">📦 Pasang ${have ? `${total - have} soal tersisa` : 'Paket Soal'}</button></div>
          <p class="muted small" style="margin:0;">Berisi Pilihan Ganda, Pilihan Lebih dari Satu, Benar/Salah, Benar/Salah Majemuk, Isian Singkat, Menjodohkan, dan Urutan
            dari 7 subtest UTBK. Soal dapat diedit atau dihapus setelah dipasang.</p></div>`;
      })() : ''}
      <div class="card">
        <div class="card-header">${UI.secHead('🧩', 'Kesiapan Soal per Game', 'jumlah soal/unit dari sumber yang aktif')}</div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Game</th><th>Format soal</th><th>Tersedia</th><th>Minimal</th><th>Dimainkan</th><th>Status</th></tr></thead>
          <tbody>${Games.GAMES.map(g => {
            const x = list.find(y => y.g.id === g.id);
            const off = st.disabled.includes(g.id);
            return `<tr><td><strong>${g.icon} ${esc(g.name)}</strong><div class="muted small">${esc(g.tag)}</div></td>
              <td class="small">${esc(g.formats.join(', '))}</td>
              <td><strong>${x ? x.units : Games.unitsOf(g, Games.poolFor(g, ''))}</strong> ${g.units ? 'unit' : 'soal'}</td>
              <td>${g.min}</td>
              <td>${scores.filter(s => s.game === g.id).length}</td>
              <td>${off ? '<span class="badge badge-gray">Dimatikan</span>' : (x && x.ok ? '<span class="badge badge-success">Siap</span>' : '<span class="badge badge-warning">Soal kurang</span>')}</td></tr>`;
          }).join('')}</tbody></table></div>
        <p class="muted small">"Unit" = pernyataan (Benar–Salah Turbo), pasangan (Jodohkan & Memori). Tambah soal lewat tab <b>Soal Game</b>, <b>Ambil dari Bank Soal</b>, atau <b>Buat dengan AI</b>.</p>
      </div>`;
    const sb = body.querySelector('#gaStarter');
    if (sb) sb.addEventListener('click', () => {
      const n = GamesStarter.install(user);
      UI.toast(n ? `${n} soal contoh dipasang ke Soal Game.` : 'Paket soal contoh sudah terpasang.', 'success');
      rerender();
    });
  }

  /* ---------------- Soal Game ---------------- */
  function sourceBadge(q) {
    return { bank: '<span class="badge badge-info">dari Bank Soal</span>', ai: '<span class="badge badge-warning">AI</span>', contoh: '<span class="badge badge-success">paket contoh</span>' }[q.source] || '<span class="badge badge-gray">manual</span>';
  }
  function gamesChips(q) {
    const compat = compatGames(q);
    const target = Array.isArray(q.games) && q.games.length ? compat.filter(g => q.games.includes(g.id)) : compat;
    if (!compat.length) return '<span class="badge badge-danger">tidak cocok untuk game mana pun</span>';
    return target.map(g => `<span class="gb-gchip" title="${esc(g.name)}">${g.icon}</span>`).join('') +
      (Array.isArray(q.games) && q.games.length ? '' : ' <span class="muted small">semua yang cocok</span>');
  }

  function paintQuestions(body, user) {
    const list = Games.getGameQuestions().slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    body.innerHTML = `<div class="card">
        <div class="card-header">${UI.secHead('🧩', 'Soal Game', `${list.length} soal • format sama dengan Bank Soal (kecuali Esai)`)}
          <button type="button" class="btn btn-primary btn-sm" id="gaAdd">+ Tambah Soal</button></div>
        <div id="gaList"></div></div>`;
    body.querySelector('#gaAdd').addEventListener('click', () => openEditor(user, null));
    DataSearch.mount({
      container: body.querySelector('#gaList'), items: list, stateKey: 'game-questions',
      placeholder: 'Cari teks soal…',
      fields: q => [plain(q.text, 600), q.subject, q.questionType],
      filters: [
        { key: 'game', label: 'Semua game', get: q => compatGames(q).filter(g => !(q.games || []).length || q.games.includes(g.id)).map(g => g.id),
          options: Games.GAMES.map(g => ({ value: g.id, label: `${g.icon} ${g.name}` })) },
        { key: 'fmt', label: 'Semua format', get: q => q.questionType || 'Pilihan Ganda', options: DB.QUESTION_TYPES.filter(t => t !== 'Esai').map(t => ({ value: t, label: t })) },
        { key: 'sub', label: 'Semua subtest', get: q => q.subject || '', options: DB.SUBTESTS.map(s => ({ value: s.name, label: s.short })) },
        { key: 'src', label: 'Semua sumber', get: q => q.source || 'manual', options: [{ value: 'manual', label: 'Manual' }, { value: 'bank', label: 'Bank Soal' }, { value: 'ai', label: 'AI' }, { value: 'contoh', label: 'Paket contoh' }] }
      ],
      sorts: [{ key: 'new', label: 'Terbaru', cmp: (a, b) => (b.createdAt || 0) - (a.createdAt || 0) }, { key: 'old', label: 'Terlama', cmp: (a, b) => (a.createdAt || 0) - (b.createdAt || 0) }],
      pageSize: 15, empty: 'Belum ada soal game. Tambah soal, salin dari Bank Soal, atau buat dengan AI.',
      render: (rows, ctx) => `<div class="ga-qlist">${rows.map(q => {
        const st = DB.subtestByName(q.subject);
        const mine = canManage(user, q);
        return `<article class="ga-q ${q.active === false ? 'is-off' : ''}">
          <div class="ga-q-main"><div class="ga-q-text">${ctx.highlight(plain(q.text, 220))}</div>
            <div class="qc-tags"><span class="qc-chip type">${esc(q.questionType || 'Pilihan Ganda')}</span>
              <span class="qc-chip sub">${st ? st.icon + ' ' + esc(st.short) : esc(q.subject || '-')}</span>
              <span class="qc-chip">${esc(q.difficulty || 'sedang')}</span>${sourceBadge(q)}
              ${q.active === false ? '<span class="badge badge-gray">nonaktif</span>' : ''}</div>
            <div class="ga-q-games">${gamesChips(q)}</div>
            <div class="muted small">Kunci: ${esc(Games.keyText(q))}</div></div>
          <div class="ga-q-act">${mine ? `
            <button type="button" class="btn btn-sm btn-secondary" data-edit="${q.id}">Edit</button>
            <button type="button" class="btn btn-sm btn-secondary" data-games="${q.id}">🎮 Game</button>
            <button type="button" class="btn btn-sm btn-secondary" data-toggle="${q.id}">${q.active === false ? 'Aktifkan' : 'Matikan'}</button>
            <button type="button" class="btn btn-sm btn-danger" data-del="${q.id}">Hapus</button>` : `<span class="muted small">oleh ${esc((DB.getUser(q.authorId) || {}).name || 'tutor lain')}</span>`}</div>
        </article>`;
      }).join('')}</div>`,
      onPaint: (res) => {
        const find = (id) => Games.getGameQuestions().find(x => x.id === id);
        res.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openEditor(user, find(b.dataset.edit))));
        res.querySelectorAll('[data-games]').forEach(b => b.addEventListener('click', () => openGamesPicker(find(b.dataset.games), (games) => {
          Games.upsertQuestion(Object.assign({}, find(b.dataset.games), { games, updatedAt: Date.now() }));
          UI.toast('Game tujuan diperbarui.', 'success'); rerender();
        })));
        res.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
          const q = find(b.dataset.toggle);
          Games.upsertQuestion(Object.assign({}, q, { active: q.active === false, updatedAt: Date.now() }));
          rerender();
        }));
        res.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
          if (!UI.confirmDialog('Hapus soal game ini? Battle yang sedang berjalan tidak terpengaruh.')) return;
          Games.removeQuestion(b.dataset.del); UI.toast('Soal dihapus.', 'info'); rerender();
        }));
      }
    });
  }

  /** Editor soal LMS (mode terpisah) → simpan ke Soal Game. */
  function openEditor(user, existing) {
    QEditor.open(user, null, (payload) => {
      if (isEssay(payload)) { UI.toast('Esai tidak dapat dinilai otomatis sehingga tidak dipakai di game. Pilih format lain.', 'error'); return; }
      const rec = Object.assign({}, existing || {}, payload, {
        id: existing ? existing.id : 'gq_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        authorId: (existing && existing.authorId) || user.id,
        source: (existing && existing.source) || 'manual',
        active: existing ? existing.active !== false : true,
        games: existing && Array.isArray(existing.games) ? existing.games.filter(id => compatGames(payload).some(g => g.id === id)) : [],
        createdAt: (existing && existing.createdAt) || Date.now(),
        updatedAt: Date.now()
      });
      delete rec._ref;
      if (!compatGames(rec).length) UI.toast('Soal tersimpan, tetapi belum cocok untuk game mana pun (periksa kunci/jumlah pilihan).', 'warning');
      Games.upsertQuestion(rec);
      if (!existing) {
        openGamesPicker(rec, (games) => {
          Games.upsertQuestion(Object.assign({}, rec, { games }));
          UI.toast('Soal game ditambahkan.', 'success'); view.tab = 'soal'; rerender();
        });
      } else { UI.toast('Soal game diperbarui.', 'success'); rerender(); }
    }, {
      detached: true, question: existing || null, subtest: existing ? existing.subject : undefined,
      heading: existing ? 'Edit Soal Game' : 'Tambah Soal Game',
      where: 'Soal Game Battle — tersimpan di Soal Game, Bank Soal tidak berubah'
    });
  }

  /** Pilih game tujuan (kosong = semua game yang cocok). */
  function openGamesPicker(q, onSave) {
    if (!q) return;
    const compat = compatGames(q);
    const cur = Array.isArray(q.games) ? q.games : [];
    UI.modal.open('🎮 Dipakai di game mana?', `
      <p class="muted small" style="margin-top:0;">Game di bawah ini dipilih otomatis sesuai format soal. Biarkan "Semua game yang cocok" agar soal dapat dipakai di game mana pun yang mendukung formatnya.</p>
      ${compat.length ? `<label class="check-row"><input type="checkbox" id="gaAllG" ${cur.length ? '' : 'checked'} /> <b>Semua game yang cocok</b> (${compat.length})</label>
      <div class="ga-gpick" id="gaGList">${compat.map(g => `<label class="check-row"><input type="checkbox" data-g="${g.id}" ${!cur.length || cur.includes(g.id) ? 'checked' : ''} ${cur.length ? '' : 'disabled'} /> ${g.icon} ${esc(g.name)} <span class="muted small">— ${esc(g.tag)}</span></label>`).join('')}</div>`
        : '<div class="alert alert-warning">Soal ini belum cocok untuk game mana pun. Periksa formatnya (mis. Pilihan Ganda butuh minimal 2 pilihan, Menjodohkan minimal 2 pasangan).</div>'}
      <div class="flex-gap" style="margin-top:12px;"><button type="button" class="btn btn-primary" id="gaGSave">Simpan</button></div>`);
    const all = document.getElementById('gaAllG');
    if (all) all.addEventListener('change', () => document.querySelectorAll('#gaGList [data-g]').forEach(c => { c.disabled = all.checked; if (all.checked) c.checked = true; }));
    document.getElementById('gaGSave').addEventListener('click', () => {
      let games = [];
      if (all && !all.checked) {
        games = [...document.querySelectorAll('#gaGList [data-g]')].filter(c => c.checked).map(c => c.dataset.g);
        if (!games.length) { UI.toast('Pilih minimal satu game, atau centang "Semua game yang cocok".', 'error'); return; }
      }
      UI.modal.close();
      onSave(games);
    });
  }

  /* ---------------- Ambil dari Bank Soal ---------------- */
  function paintBank(body, user) {
    const copied = new Set(Games.getGameQuestions().map(q => q.bankId).filter(Boolean));
    const list = DB.getQuestions().filter(q => !isEssay(q));
    const picked = new Set();
    const st = Games.settings();
    body.innerHTML = `
      <div class="alert alert-info small">Bank Soal ${st.source === 'game' ? '<b>tidak</b> dipakai langsung oleh game (sumber: Soal Game saja)' : '<b>sudah dipakai langsung</b> oleh game (sesuai pengaturan sumber soal)'}.
        Menyalin ke Soal Game berguna untuk memilih game tujuan tertentu, menyesuaikan soal tanpa mengubah Bank Soal, atau bila sumber diatur "Soal Game saja".</div>
      <div class="card"><div class="card-header">${UI.secHead('📥', 'Bank Soal', `${list.length} soal objektif • ikon = game yang cocok`)}
        <button type="button" class="btn btn-primary btn-sm" id="gaCopy" disabled>Salin ke Soal Game (0)</button></div>
        <div id="gaBankList"></div></div>`;
    const btn = body.querySelector('#gaCopy');
    const refresh = () => { btn.disabled = !picked.size; btn.textContent = `Salin ke Soal Game (${picked.size})`; };
    DataSearch.mount({
      container: body.querySelector('#gaBankList'), items: list, stateKey: 'game-bank',
      placeholder: 'Cari teks soal…', fields: q => [plain(q.text, 600), q.subject, q.questionType],
      filters: [
        { key: 'sub', label: 'Semua subtest', get: q => q.subject || '', options: DB.SUBTESTS.map(s => ({ value: s.name, label: s.short })) },
        { key: 'fmt', label: 'Semua format', get: q => q.questionType || 'Pilihan Ganda', options: DB.QUESTION_TYPES.filter(t => t !== 'Esai').map(t => ({ value: t, label: t })) },
        { key: 'game', label: 'Cocok untuk game', get: q => compatGames(q).map(g => g.id), options: Games.GAMES.map(g => ({ value: g.id, label: `${g.icon} ${g.name}` })) },
        { key: 'cp', label: 'Semua status', get: q => (copied.has(q.id) ? 'yes' : 'no'), options: [{ value: 'no', label: 'Belum disalin' }, { value: 'yes', label: 'Sudah disalin' }] }
      ],
      pageSize: 20, empty: 'Bank Soal belum berisi soal objektif.',
      render: (rows, ctx) => `<div class="ga-qlist">${rows.map(q => {
        const compat = compatGames(q);
        return `<label class="ga-q is-pick ${copied.has(q.id) ? 'is-copied' : ''}">
          <input type="checkbox" data-pick="${q.id}" ${picked.has(q.id) ? 'checked' : ''} ${copied.has(q.id) || !compat.length ? 'disabled' : ''} />
          <div class="ga-q-main"><div class="ga-q-text">${ctx.highlight(plain(q.text, 200))}</div>
            <div class="qc-tags"><span class="qc-chip type">${esc(q.questionType || 'Pilihan Ganda')}</span><span class="qc-chip sub">${esc((DB.subtestByName(q.subject) || {}).short || q.subject || '-')}</span>
              ${copied.has(q.id) ? '<span class="badge badge-success">sudah disalin</span>' : ''}</div>
            <div class="ga-q-games">${compat.length ? compat.map(g => `<span class="gb-gchip" title="${esc(g.name)}">${g.icon}</span>`).join('') : '<span class="badge badge-danger">tidak cocok untuk game</span>'}</div></div>
        </label>`;
      }).join('')}</div>`,
      onPaint: (res) => res.querySelectorAll('[data-pick]').forEach(c => c.addEventListener('change', () => {
        if (c.checked) picked.add(c.dataset.pick); else picked.delete(c.dataset.pick);
        refresh();
      }))
    });
    btn.addEventListener('click', () => {
      let n = 0;
      picked.forEach(id => {
        const q = DB.getQuestion(id);
        if (!q || copied.has(id)) return;
        const copy = JSON.parse(JSON.stringify(q));
        delete copy.id; delete copy.points; delete copy._ref;
        Games.upsertQuestion(Object.assign(copy, {
          id: 'gq_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + n,
          bankId: id, source: 'bank', authorId: user.id, active: true, games: [], createdAt: Date.now() + n
        }));
        n++;
      });
      UI.toast(`${n} soal disalin ke Soal Game.`, 'success');
      view.tab = 'soal'; rerender();
    });
  }

  /* ---------------- Buat dengan AI ---------------- */
  let aiItems = [];
  function shapeFor(fmt) {
    switch (fmt) {
      case 'Benar/Salah Majemuk': return '{"Pertanyaan":"instruksi + konteks","A":"pernyataan 1","B":"pernyataan 2","C":"pernyataan 3","D":"pernyataan 4","Kunci":"Benar; Salah; Benar; Salah","Pembahasan":"..."}';
      case 'Majemuk Kompleks': return '{"Pertanyaan":"instruksi + konteks","Kolom":"Benar | Salah | Tidak dapat ditentukan","A":"pernyataan 1","B":"pernyataan 2","C":"pernyataan 3","Kunci":"Benar; Tidak dapat ditentukan; Salah","Pembahasan":"..."}';
      case 'Benar/Salah': return '{"Pertanyaan":"satu pernyataan","Kunci":"Benar atau Salah","Pembahasan":"..."}';
      case 'Isian Singkat': return '{"Pertanyaan":"...","Kunci":"jawaban singkat (boleh beberapa dipisah koma)","Pembahasan":"..."}';
      case 'Pilihan Lebih dari Satu': return '{"Pertanyaan":"...","A":"...","B":"...","C":"...","D":"...","Kunci":"A,C","Pembahasan":"..."}';
      case 'Menjodohkan': return '{"Pertanyaan":"instruksi menjodohkan","Pasangan":[{"Kiri":"...","Kanan":"..."},{"Kiri":"...","Kanan":"..."}],"Pembahasan":"..."}';
      case 'Urutan': return '{"Pertanyaan":"instruksi mengurutkan","Urutan":["langkah pertama","langkah kedua","langkah ketiga","langkah keempat"],"Pembahasan":"..."}';
      default: return '{"Pertanyaan":"...","A":"...","B":"...","C":"...","D":"...","Kunci":"B","Pembahasan":"..."}';
    }
  }
  const wrapP = (t) => { const s = String(t == null ? '' : t).trim(); return s ? '<p>' + RichText.sanitize(s).replace(/\n+/g, '<br>') + '</p>' : ''; };
  /** Baris AI → soal (format bawaan Bank Soal + Menjodohkan & Urutan). */
  function rowToGameQuestion(r, fmt, subtest, diff) {
    if (!r || !String(r.Pertanyaan || '').trim()) return { error: 'Pertanyaan kosong' };
    const base = { subject: subtest, difficulty: diff, questionType: fmt, text: wrapP(r.Pertanyaan), explanation: wrapP(r.Pembahasan), options: [], correctIndex: null };
    if (fmt === 'Menjodohkan') {
      const pairs = (Array.isArray(r.Pasangan) ? r.Pasangan : []).map(p => ({ left: wrapP(p && (p.Kiri || p.kiri || p.left)), right: wrapP(p && (p.Kanan || p.kanan || p.right)) }))
        .filter(p => plain(p.left) && plain(p.right));
      if (pairs.length < 2) return { error: 'Minimal 2 pasangan' };
      if (new Set(pairs.map(p => plain(p.right).toLowerCase())).size !== pairs.length) return { error: 'Item kanan tidak boleh sama' };
      return { question: Object.assign(base, { pairs }) };
    }
    if (fmt === 'Urutan') {
      const items = (Array.isArray(r.Urutan) ? r.Urutan : []).map(wrapP).filter(x => plain(x));
      if (items.length < 3) return { error: 'Minimal 3 item urutan' };
      if (new Set(items.map(x => plain(x).toLowerCase())).size !== items.length) return { error: 'Item urutan tidak boleh sama' };
      return { question: Object.assign(base, { orderItems: items }) };
    }
    const res = BankTools.rowToQuestion(Object.assign({}, r, { Subtest: subtest, Tingkat: diff, Format: fmt }), { subtest });
    if (res.error) return res;
    return { question: Object.assign(res.question, { subject: subtest, difficulty: diff, questionType: fmt }) };
  }

  function paintAi(body, user) {
    const ready = global.AI && AI.ready && AI.ready();
    const g0 = Games.GAMES[0];
    body.innerHTML = `
      <div class="card">
        <div class="card-header">${UI.secHead('🤖', 'Buat Soal Game dengan AI', 'format soal menyesuaikan sistem game yang dipilih')}</div>
        ${ready ? '' : (AI.noticeHtml ? AI.noticeHtml(user) : '<div class="alert alert-warning">AI belum diaktifkan. Admin dapat mengisi kunci di Pengaturan → Integrasi AI.</div>')}
        <div class="form">
          <div class="form-row">
            <div class="form-group"><label for="aiGame">Untuk game</label>
              <select id="aiGame">${Games.GAMES.map(g => `<option value="${g.id}">${g.icon} ${esc(g.name)}</option>`).join('')}</select></div>
            <div class="form-group"><label for="aiFmt">Format soal</label><select id="aiFmt"></select></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label for="aiSub">Subtest</label>
              <select id="aiSub">${DB.SUBTESTS.map(s => `<option value="${esc(s.name)}">${s.icon} ${esc(s.name)}</option>`).join('')}</select></div>
            <div class="form-group"><label for="aiDiff">Tingkat</label>
              <select id="aiDiff">${DB.DIFFICULTIES.map(d => `<option value="${d}" ${d === 'sedang' ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
            <div class="form-group"><label for="aiN">Jumlah</label><input type="number" id="aiN" min="1" max="15" value="6" /></div>
          </div>
          <div class="form-group"><label for="aiTopic">Topik</label><input id="aiTopic" placeholder="mis. Barisan aritmetika, sinonim kata, sistem pernapasan…" maxlength="200" /></div>
          <div class="form-group"><label for="aiNote">Catatan tambahan (opsional)</label><input id="aiNote" maxlength="300" placeholder="mis. gunakan konteks kehidupan sehari-hari" /></div>
          <div class="muted small" id="aiHint"></div>
          <div class="flex-gap" style="margin-top:10px;"><button type="button" class="btn btn-primary" id="aiGo" ${ready ? '' : 'disabled'}>✨ Buat Soal</button></div>
        </div>
        <div id="aiOut" style="margin-top:14px;"></div>
      </div>`;
    const gameSel = body.querySelector('#aiGame'), fmtSel = body.querySelector('#aiFmt');
    const syncFmt = () => {
      const fs = AI_FORMATS[gameSel.value] || ['Pilihan Ganda'];
      fmtSel.innerHTML = fs.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
      body.querySelector('#aiHint').textContent = AI_HINT[gameSel.value] || '';
    };
    gameSel.value = g0.id; syncFmt();
    gameSel.addEventListener('change', syncFmt);
    body.querySelector('#aiGo').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const game = Games.GAME[gameSel.value];
      const fmt = fmtSel.value, subtest = body.querySelector('#aiSub').value, diff = body.querySelector('#aiDiff').value;
      const n = Math.max(1, Math.min(15, Number(body.querySelector('#aiN').value) || 6));
      const topic = body.querySelector('#aiTopic').value.trim(), note = body.querySelector('#aiNote').value.trim();
      if (!topic) { UI.toast('Isi topik soal terlebih dahulu.', 'error'); return; }
      const out = body.querySelector('#aiOut');
      UI.setBusy(btn, true);
      out.innerHTML = AI.loadingHtml(`AI menyusun ${n} soal untuk ${game.name}…`);
      try {
        const data = await AI.askJson(
          `Buat ${n} soal latihan UTBK untuk game edukasi "${game.name}" (${game.desc}). Subtest "${subtest}", tingkat ${diff}. ` +
          `Topik: ${topic}. Format soal: ${fmt}. ${AI_HINT[game.id] || ''} ` + (note ? `Catatan: ${note}. ` : '') +
          'Gunakan Bahasa Indonesia baku, pastikan kunci jawaban benar secara ilmiah, dan sertakan pembahasan singkat. ' +
          `Balas HANYA berupa array JSON, setiap elemen berbentuk ${shapeFor(fmt)}`, { maxTokens: 4096 });
        const rows = Array.isArray(data) ? data : AI.normalizeRows(data);
        aiItems = (rows || []).map(r => {
          const res = rowToGameQuestion(r, fmt, subtest, diff);
          if (res.error) return { error: res.error, raw: r };
          const q = res.question;
          const ok = Games.autoValid(q) && game.accepts(q);
          return { q, ok, pick: ok, error: ok ? '' : `Tidak memenuhi syarat ${game.name}` };
        });
        if (!aiItems.length) throw new Error('AI tidak menghasilkan soal yang bisa dibaca. Coba ulangi.');
        paintAiPreview(out, user, game);
      } catch (err) {
        aiItems = [];
        out.innerHTML = AI.errorHtml(err);
      } finally { UI.setBusy(btn, false); }
    });
  }

  function paintAiPreview(out, user, game) {
    const good = aiItems.filter(x => x.q && x.ok).length;
    out.innerHTML = `<div class="alert alert-info small">Periksa setiap soal hasil AI sebelum disimpan. ${good} dari ${aiItems.length} soal siap dipakai di ${esc(game.name)}.</div>
      <div class="ga-qlist">${aiItems.map((x, i) => x.q ? `
        <label class="ga-q is-pick ${x.ok ? '' : 'is-bad'}">
          <input type="checkbox" data-ai="${i}" ${x.pick ? 'checked' : ''} ${x.ok ? '' : 'disabled'} />
          <div class="ga-q-main"><div class="ga-q-text rt-content">${RichText.render(x.q.text)}</div>
            ${(x.q.options || []).length ? `<ol type="A" class="ga-opts">${x.q.options.map(o => `<li>${esc(plain(o, 120))}</li>`).join('')}</ol>` : ''}
            <div class="muted small"><b>Kunci:</b> ${esc(Games.keyText(x.q))}</div>
            ${x.q.explanation ? `<div class="muted small"><b>Pembahasan:</b> ${esc(plain(x.q.explanation, 300))}</div>` : ''}
            ${x.error ? `<div class="badge badge-danger">${esc(x.error)}</div>` : ''}</div>
        </label>` : `<div class="ga-q is-bad"><div class="ga-q-main"><span class="badge badge-danger">Baris ${i + 1} tidak terbaca: ${esc(x.error)}</span></div></div>`).join('')}</div>
      <label class="check-row" style="margin-top:10px;"><input type="checkbox" id="aiOnly" /> Hanya untuk ${esc(game.name)} (bila tidak dicentang, soal juga dipakai game lain yang cocok)</label>
      <div class="flex-gap"><button type="button" class="btn btn-success" id="aiSave" ${good ? '' : 'disabled'}>💾 Simpan soal terpilih</button></div>`;
    out.querySelectorAll('[data-ai]').forEach(c => c.addEventListener('change', () => { aiItems[Number(c.dataset.ai)].pick = c.checked; }));
    out.querySelector('#aiSave').addEventListener('click', () => {
      const only = out.querySelector('#aiOnly').checked;
      let n = 0;
      aiItems.forEach((x, i) => {
        if (!x.q || !x.ok || !x.pick) return;
        Games.upsertQuestion(Object.assign({}, x.q, {
          id: 'gq_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + i,
          source: 'ai', authorId: user.id, active: true, games: only ? [game.id] : [], createdAt: Date.now() + i
        }));
        n++;
      });
      if (!n) { UI.toast('Centang minimal satu soal.', 'info'); return; }
      aiItems = [];
      UI.toast(`${n} soal AI disimpan ke Soal Game.`, 'success');
      view.tab = 'soal'; rerender();
    });
  }

  /* ---------------- Coba Game ---------------- */
  function paintTry(body, user) {
    const list = Games.playableGames('');
    body.innerHTML = `<div class="alert alert-info small">Pratinjau memainkan game persis seperti siswa, tetapi skor tidak disimpan.</div>
      <div class="gb-grid">${list.map(x => Games.gameCardHtml(x, user, { preview: true })).join('')}</div>`;
    body.querySelectorAll('[data-preview]').forEach(b => b.addEventListener('click', () => {
      Games.runSession(body, user, { gameId: b.dataset.preview, mode: 'preview', onExit: () => paintTry(body, user) });
    }));
  }

  /* ---------------- Pengaturan (admin) ---------------- */
  function paintSettings(body) {
    const st = Games.settings();
    body.innerHTML = `<div class="card">
        <div class="card-header">${UI.secHead('⚙️', 'Pengaturan Game Battle', 'berlaku untuk semua siswa')}</div>
        <label class="check-row"><input type="checkbox" data-set="gamesEnabled" ${st.enabled ? 'checked' : ''} /> Aktifkan Game Battle untuk siswa</label>
        <label class="check-row"><input type="checkbox" data-set="gameBattleEnabled" ${st.battle ? 'checked' : ''} /> Izinkan battle 1 lawan 1 antarsiswa</label>
        <label class="check-row"><input type="checkbox" data-set="gameBotEnabled" ${st.bot ? 'checked' : ''} /> Izinkan bermain melawan bot</label>
        <h4 class="gb-sub-h">📚 Sumber soal game</h4>
        <div class="tgt-grid">${[['both', 'Bank Soal + Soal Game', 'Semua soal objektif Bank Soal ditambah Soal Game.'], ['game', 'Soal Game saja', 'Hanya soal yang disiapkan khusus untuk game.'], ['bank', 'Bank Soal saja', 'Langsung memakai Bank Soal; Soal Game diabaikan.']].map(([k, n, d]) => `
          <label class="tgt-box ${st.source === k ? 'is-on' : ''}"><input type="radio" name="gaSrc" value="${k}" ${st.source === k ? 'checked' : ''} />
            <div><div class="tgt-name">${esc(n)}</div><div class="tgt-meta">${esc(d)}</div></div></label>`).join('')}</div>
        <h4 class="gb-sub-h">🎮 Game yang tersedia</h4>
        <div class="ga-gpick">${Games.GAMES.map(g => `<label class="check-row"><input type="checkbox" data-gon="${g.id}" ${st.disabled.includes(g.id) ? '' : 'checked'} /> ${g.icon} ${esc(g.name)} <span class="muted small">— ${esc(g.tag)}</span></label>`).join('')}</div>
        <p class="muted small">XP streak dari game mengikuti aturan "Games Area" (maks. 3 ronde per hari, minimal 6 jawaban benar). Siswa dapat memilih untuk tidak menerima tantangan battle dari halaman Game Battle.</p>
      </div>`;
    body.querySelectorAll('[data-set]').forEach(c => c.addEventListener('change', () => { DB.setSetting(c.dataset.set, c.checked); UI.toast('Pengaturan disimpan.', 'success'); rerender(); }));
    body.querySelectorAll('[name="gaSrc"]').forEach(r => r.addEventListener('change', () => { DB.setSetting('gameSource', r.value); UI.toast('Sumber soal diperbarui.', 'success'); rerender(); }));
    body.querySelectorAll('[data-gon]').forEach(c => c.addEventListener('change', () => {
      const off = [...body.querySelectorAll('[data-gon]')].filter(x => !x.checked).map(x => x.dataset.gon);
      if (off.length === Games.GAMES.length) { c.checked = true; UI.toast('Minimal satu game harus aktif.', 'error'); return; }
      DB.setSetting('gameDisabled', off);
      UI.toast('Daftar game diperbarui.', 'success');
    }));
  }

  function stop() { if (global.Games) Games.stopSession('nav'); if (global.GameRoom) GameRoom.stop(); host = null; }

  global.GamesAdmin = { render, stop, rowToGameQuestion, AI_FORMATS };
})(window);
