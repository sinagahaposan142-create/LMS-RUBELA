/* =====================================================================
 * js/course-hub.js — Course mandiri Rubela (dikelola admin, tanpa tutor)
 * ---------------------------------------------------------------------
 * Terpisah dari "Kelas" (yang memiliki tutor). Materi course tidak
 * pernah masuk ke materi kelas.
 *  Mentee : katalog, halaman course (hasil belajar, prasyarat, kurikulum),
 *           pemutar pelajaran (artikel, video, PDF/tautan, kuis), catatan,
 *           progres, sertifikat penyelesaian.
 *  Admin  : buat/ubah course, kurikulum bab & pelajaran, sasaran peserta,
 *           mode pendaftaran, aktif/nonaktif, aktifkan ulang (siswa baru),
 *           jadwal buka bertahap (drip), statistik progres peserta.
 *  Orang tua: progres course anak (hanya baca).
 * ===================================================================*/
(function (global) {
  'use strict';
  const esc = (s) => UI.esc(s);
  const TYPE = {
    article: { ic: '📄', label: 'Artikel' }, video: { ic: '🎬', label: 'Video' },
    pdf: { ic: '📑', label: 'Dokumen PDF' }, link: { ic: '🔗', label: 'Tautan' }, quiz: { ic: '📝', label: 'Kuis' }
  };
  const nid = (p) => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  let view = { mode: 'catalog', courseId: null, lessonId: null, tab: 'mine' };
  let readTimer = null;
  const stopTimer = () => { if (readTimer) { clearInterval(readTimer); readTimer = null; } };

  const lessonsOf = (c) => DB.hubLessons(c);
  const totalMin = (c) => lessonsOf(c).filter(l => l.active !== false).reduce((n, l) => n + (Number(l.durationMin) || 0), 0);
  const fmtMin = (m) => m >= 60 ? `${Math.floor(m / 60)} j ${m % 60} mnt` : `${m} mnt`;
  function coverHtml(c, cls) {
    return `<div class="hub-cover ${cls || ''}" style="--hub-c:${esc(c.color || '#4f46e5')}">${c.cover ? `<img src="${esc(c.cover)}" alt="" loading="lazy" />` : `<span>${esc((c.title || '?').slice(0, 1).toUpperCase())}</span>`}</div>`;
  }

  /* =====================================================================
   * MENTEE
   * ===================================================================*/
  function render(container, user) {
    stopTimer();
    const me = DB.getUser(user.id) || user;
    if (view.mode === 'player' && view.courseId) return renderPlayer(container, me);
    if (view.mode === 'landing' && view.courseId) return renderLanding(container, me);
    return renderCatalog(container, me);
  }
  function go(container, user, patch) { Object.assign(view, patch); render(container, user); window.scrollTo({ top: 0, behavior: 'smooth' }); }

  function renderCatalog(container, user) {
    const all = DB.hubCoursesForStudent(user.id);
    const progress = DB.getHubProgressByStudent(user.id);
    const mine = all.filter(c => progress.some(p => p.courseId === c.id));
    const tab = view.tab === 'explore' || !mine.length ? 'explore' : 'mine';
    container.innerHTML = `
      <section class="welcome-hero hub-hero"><span class="blob b1"></span><span class="blob b2"></span>
        <div class="wh-inner"><div class="wh-eyebrow">📚 Course Rubela</div><h2>Belajar Mandiri, Kapan Saja</h2>
          <p class="wh-sub">Course pilihan yang disusun tim Rubela — terpisah dari kelas bersama tutor. Selesaikan pelajarannya untuk menyalakan streak dan mendapat sertifikat.</p>
          <div class="wh-chips"><span class="wh-chip">🎓 ${mine.length} diikuti</span><span class="wh-chip">✅ ${progress.filter(p => p.completedAt).length} selesai</span><span class="wh-chip">🧭 ${all.length} tersedia</span></div></div></section>
      <div class="tabs"><button type="button" class="tab-btn ${tab === 'mine' ? 'active' : ''}" data-hub-tab="mine" ${mine.length ? '' : 'disabled'}>Course Saya (${mine.length})</button>
        <button type="button" class="tab-btn ${tab === 'explore' ? 'active' : ''}" data-hub-tab="explore">Jelajahi (${all.length})</button></div>
      <div id="hubList"></div>`;
    container.querySelectorAll('[data-hub-tab]').forEach(b => b.addEventListener('click', () => go(container, user, { tab: b.dataset.hubTab })));
    const items = tab === 'mine' ? mine : all;
    const cats = [...new Set(all.map(c => c.category).filter(Boolean))];
    DataSearch.mount({
      container: container.querySelector('#hubList'), items, stateKey: 'hub-cat-' + tab,
      placeholder: 'Cari judul, topik, atau isi pelajaran…',
      fields: c => [c.title, c.subtitle, c.category, c.level, DataSearch.plain(c.description), (c.outcomes || []), lessonsOf(c).map(l => l.title)],
      filters: [{ key: 'cat', label: 'Semua kategori', get: c => c.category || '', options: cats.map(k => ({ value: k, label: k })) },
        { key: 'lv', label: 'Semua level', get: c => c.level || '', options: [...new Set(all.map(c => c.level).filter(Boolean))].map(k => ({ value: k, label: k })) }],
      sorts: [{ key: 'new', label: 'Terbaru', cmp: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) }, { key: 'az', label: 'Judul A–Z', cmp: (a, b) => a.title.localeCompare(b.title) }],
      pageSize: 9,
      empty: tab === 'mine' ? 'Belum mengikuti course.' : 'Belum ada course untukmu. Admin akan menambahkannya.',
      render: (rows, ctx) => `<div class="hub-grid">${rows.map(c => {
        const p = progress.find(x => x.courseId === c.id);
        const pct = DB.hubPercent(c, p);
        const n = lessonsOf(c).filter(l => DB.hubLessonVisible(c, l, p)).length;
        return `<article class="hub-card" data-hub-open="${c.id}" tabindex="0" role="button" aria-label="Buka course ${esc(c.title)}">
          ${coverHtml(c)}<div class="hub-card-body"><span class="hub-cat">${esc(c.category || 'Umum')}</span>
          <h4>${ctx.highlight(c.title)}</h4><p>${esc(c.subtitle || '')}</p>
          <div class="hub-meta">${n} pelajaran • ${fmtMin(totalMin(c))} • ${esc(c.level || 'Semua level')}</div>
          ${p ? `<div class="hub-prog"><i style="width:${pct}%"></i></div><div class="hub-meta">${p.completedAt ? '✅ Selesai' : `${pct}% selesai`}</div>`
            : `<div class="hub-meta">${c.enrollMode === 'assigned' ? '🔐 Didaftarkan admin' : '🆓 Bebas bergabung'}</div>`}</div></article>`;
      }).join('')}</div>`,
      onPaint: (box) => box.querySelectorAll('[data-hub-open]').forEach(el => {
        const open = () => go(container, user, { mode: 'landing', courseId: el.dataset.hubOpen });
        el.addEventListener('click', open);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      })
    });
  }

  function lessonState(c, l, p) {
    if (!DB.hubLessonVisible(c, l, p)) return 'hidden';
    if (p && (p.completed || {})[l.id]) return 'done';
    if (DB.hubLessonOpensAt(l, p)) return 'drip';
    return 'open';
  }
  function nextLesson(c, p) {
    const ls = lessonsOf(c).filter(l => lessonState(c, l, p) === 'open');
    return (p && ls.find(l => l.id === p.lastLessonId)) || ls[0] || lessonsOf(c).find(l => lessonState(c, l, p) === 'done') || null;
  }

  function renderLanding(container, user) {
    const c = DB.getHubCourse(view.courseId);
    if (!c || c.active === false || !DB.hubAudienceIncludes(c, user)) { view = { mode: 'catalog', tab: 'explore' }; return renderCatalog(container, user); }
    const p = DB.getHubProgress(c.id, user.id);
    const pct = DB.hubPercent(c, p);
    const nl = p ? nextLesson(c, p) : null;
    const visibleCount = lessonsOf(c).filter(l => DB.hubLessonVisible(c, l, p)).length;
    container.innerHTML = `
      <button type="button" class="btn btn-secondary btn-sm mb-2" id="hubBack">← Semua course</button>
      <section class="hub-landing" style="--hub-c:${esc(c.color || '#4f46e5')}">
        <div class="hub-landing-main"><span class="hub-cat">${esc(c.category || 'Umum')}</span>
          <h1>${esc(c.title)}</h1><p class="hub-sub">${esc(c.subtitle || '')}</p>
          <div class="hub-facts"><span>📚 ${visibleCount} pelajaran</span><span>⏱️ ${fmtMin(totalMin(c))}</span><span>📶 ${esc(c.level || 'Semua level')}</span>
            <span>🌐 ${esc(c.language || 'Bahasa Indonesia')}</span><span>🏫 Disusun tim Rubela</span>${c.certificate ? '<span>🎓 Sertifikat</span>' : ''}</div></div>
        <aside class="hub-landing-card">${coverHtml(c, 'is-lg')}
          ${p ? `<div class="hub-prog is-lg"><i style="width:${pct}%"></i></div><div class="muted small">${pct}% selesai${p.completedAt ? ' • ✅ tuntas' : ''}</div>
              <button type="button" class="btn btn-primary btn-block" id="hubContinue" ${nl ? '' : 'disabled'}>${pct === 0 ? 'Mulai belajar' : p.completedAt ? 'Ulas kembali' : 'Lanjutkan belajar'}</button>
              ${p.completedAt && c.certificate ? '<button type="button" class="btn btn-secondary btn-block mt-1" id="hubCert">🎓 Lihat sertifikat</button>' : ''}`
            : (c.enrollMode === 'assigned' ? '<div class="alert alert-info small">Course ini didaftarkan oleh admin. Hubungi admin bila ingin mengikutinya.</div>'
              : '<button type="button" class="btn btn-primary btn-block" id="hubEnroll">Ikuti course — gratis</button>')}
        </aside>
      </section>
      ${(c.outcomes || []).length ? `<div class="card"><div class="card-header">${UI.secHead('✅', 'Yang akan kamu pelajari', '')}</div>
        <ul class="hub-outcomes">${c.outcomes.map(o => `<li>${esc(o)}</li>`).join('')}</ul></div>` : ''}
      <div class="card"><div class="card-header">${UI.secHead('🧭', 'Kurikulum', `${(c.sections || []).length} bab • ${visibleCount} pelajaran`)}</div>
        <div class="hub-curr">${(c.sections || []).map((sec, si) => {
          const ls = (sec.lessons || []).filter(l => DB.hubLessonVisible(c, l, p));
          if (!ls.length) return '';
          return `<details class="hub-sec" ${si === 0 ? 'open' : ''}><summary><strong>${esc(sec.title)}</strong><span class="muted small">${ls.length} pelajaran • ${fmtMin(ls.reduce((n, l) => n + (Number(l.durationMin) || 0), 0))}</span></summary>
            <ol>${ls.map(l => { const s = lessonState(c, l, p); const opens = DB.hubLessonOpensAt(l, p);
              return `<li class="hub-li is-${s}"><span>${TYPE[l.type].ic}</span><span class="hub-li-t">${esc(l.title)}</span>
                <span class="muted small">${s === 'done' ? '✓ selesai' : s === 'drip' ? `🔒 buka ${UI.fmtDate(opens)}` : (l.durationMin ? l.durationMin + ' mnt' : TYPE[l.type].label)}</span>
                ${p && s !== 'drip' ? `<button type="button" class="btn btn-sm btn-ghost" data-hub-lesson="${l.id}">Buka</button>` : ''}</li>`; }).join('')}</ol></details>`;
        }).join('') || '<div class="muted small">Kurikulum belum tersedia.</div>'}</div></div>
      ${(c.requirements || []).length ? `<div class="card"><div class="card-header">${UI.secHead('📋', 'Persyaratan', '')}</div><ul class="hub-req">${c.requirements.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}
      ${c.description ? `<div class="card"><div class="card-header">${UI.secHead('📝', 'Deskripsi', '')}</div><div class="rt-content">${RichText.render(c.description)}</div></div>` : ''}`;
    container.querySelector('#hubBack').addEventListener('click', () => go(container, user, { mode: 'catalog', courseId: null }));
    const en = container.querySelector('#hubEnroll');
    if (en) en.addEventListener('click', () => {
      try { DB.hubEnroll(c.id, user.id); UI.toast('Berhasil bergabung. Selamat belajar! 🎉'); go(container, user, {}); } catch (e) { UI.toast(e.message, 'error'); }
    });
    const cont = container.querySelector('#hubContinue');
    if (cont) cont.addEventListener('click', () => go(container, user, { mode: 'player', lessonId: nl ? nl.id : null }));
    const cert = container.querySelector('#hubCert');
    if (cert) cert.addEventListener('click', () => openCertificate(c, user, p));
    container.querySelectorAll('[data-hub-lesson]').forEach(b => b.addEventListener('click', () => go(container, user, { mode: 'player', lessonId: b.dataset.hubLesson })));
  }

  function renderPlayer(container, user) {
    const c = DB.getHubCourse(view.courseId);
    const p = c ? DB.getHubProgress(c.id, user.id) : null;
    if (!c || c.active === false || !p) { view.mode = 'landing'; return renderLanding(container, user); }
    const all = lessonsOf(c).filter(l => DB.hubLessonVisible(c, l, p));
    let l = all.find(x => x.id === view.lessonId) || nextLesson(c, p);
    if (!l) { view.mode = 'landing'; return renderLanding(container, user); }
    if (DB.hubLessonOpensAt(l, p)) { UI.toast('Pelajaran ini belum dibuka.', 'info'); l = nextLesson(c, p); if (!l) { view.mode = 'landing'; return renderLanding(container, user); } }
    view.lessonId = l.id;
    const idx = all.findIndex(x => x.id === l.id);
    const prev = all.slice(0, idx).reverse().find(x => !DB.hubLessonOpensAt(x, p));
    const nxt = all.slice(idx + 1).find(x => !DB.hubLessonOpensAt(x, p));
    const done = !!(p.completed || {})[l.id];
    const pct = DB.hubPercent(c, p);
    const qr = (p.quiz || {})[l.id];
    let content = '';
    if (l.type === 'article') content = `<div class="rt-content hub-article">${RichText.render(l.content || '')}</div>`;
    else if (l.type === 'video') content = `${l.url ? Shared.videoEmbedHtml(l.url) : '<div class="muted">Video belum diatur.</div>'}<div class="rt-content mt-1">${RichText.render(l.content || '')}</div>`;
    else if (l.type === 'pdf' || l.type === 'link') content = `<div class="rt-content">${RichText.render(l.content || '')}</div>
      ${l.url ? `<a class="btn btn-secondary" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${TYPE[l.type].ic} Buka ${l.type === 'pdf' ? 'dokumen' : 'tautan'} ↗</a>` : '<div class="muted">Tautan belum diatur.</div>'}`;
    else content = `<div class="rt-content">${RichText.render(l.content || '')}</div>
      <form id="hubQuiz" class="hub-quiz">${(l.questions || []).map((q, i) => `<fieldset class="ar-q"><legend><span class="ar-qn">${i + 1}</span>${esc(q.text)}</legend>
        <div class="ar-opts">${q.options.map((o, k) => `<label class="ar-opt ${qr && qr.answers && qr.passed ? (k === q.correctIndex ? 'is-key' : (qr.answers[i] === k ? 'is-wrong' : '')) : ''}">
          <input type="radio" name="hq${i}" value="${k}" ${qr && qr.answers && qr.answers[i] === k ? 'checked' : ''}/><span class="ar-letter">${String.fromCharCode(65 + k)}</span><span>${esc(o)}</span></label>`).join('')}</div></fieldset>`).join('')}
        ${qr ? `<div class="alert ${qr.passed ? 'alert-success' : 'alert-warning'}">Skor terakhir ${qr.score} (lulus ≥ ${l.passScore || 70}) • ${qr.attempts || 1}× percobaan</div>` : ''}
        <div class="flex-gap" style="justify-content:flex-end;"><button class="btn btn-primary" type="submit">${qr ? 'Kirim ulang' : 'Kirim jawaban'}</button></div></form>`;

    container.innerHTML = `
      <div class="hub-player">
        <aside class="hub-side" aria-label="Kurikulum">
          <button type="button" class="btn btn-secondary btn-sm" id="hubToLanding">← ${esc(c.title)}</button>
          <div class="hub-prog"><i style="width:${pct}%"></i></div><div class="muted small">${pct}% selesai</div>
          <nav class="hub-side-list">${(c.sections || []).map(sec => {
            const ls = (sec.lessons || []).filter(x => DB.hubLessonVisible(c, x, p));
            return ls.length ? `<div class="hub-side-sec">${esc(sec.title)}</div>${ls.map(x => { const s = lessonState(c, x, p);
              return `<button type="button" class="hub-side-item ${x.id === l.id ? 'is-cur' : ''} is-${s}" data-hub-lesson="${x.id}" ${s === 'drip' ? 'disabled' : ''}>
                <span>${s === 'done' ? '✅' : s === 'drip' ? '🔒' : TYPE[x.type].ic}</span><span>${esc(x.title)}</span></button>`; }).join('')}` : '';
          }).join('')}</nav>
        </aside>
        <article class="card hub-main">
          <div class="hub-main-head"><span class="muted small">${esc(l.sectionTitle)} • ${TYPE[l.type].label}${l.durationMin ? ` • ${l.durationMin} mnt` : ''}</span>
            <h2>${esc(l.title)}</h2></div>
          ${content}
          <div class="hub-actions">
            <button type="button" class="btn btn-secondary" id="hubPrev" ${prev ? '' : 'disabled'}>← Sebelumnya</button>
            ${l.type !== 'quiz' ? (done ? '<span class="badge badge-success">✓ Pelajaran selesai</span>'
              : '<button type="button" class="btn btn-primary" id="hubDone" disabled>Membaca…</button>') : ''}
            <button type="button" class="btn btn-secondary" id="hubNext" ${nxt ? '' : 'disabled'}>Berikutnya →</button>
          </div>
          <div class="hub-notes"><label for="hubNote">📝 Catatan pribadi untuk pelajaran ini</label>
            <textarea id="hubNote" rows="3" maxlength="4000" placeholder="Tulis ringkasan atau pertanyaanmu…">${esc((p.notes || {})[l.id] || '')}</textarea>
            <span class="muted small" id="hubNoteSt">Tersimpan otomatis</span></div>
        </article>
      </div>`;
    container.querySelector('#hubToLanding').addEventListener('click', () => go(container, user, { mode: 'landing' }));
    container.querySelectorAll('[data-hub-lesson]').forEach(b => b.addEventListener('click', () => go(container, user, { lessonId: b.dataset.hubLesson })));
    const pv = container.querySelector('#hubPrev'); if (prev) pv.addEventListener('click', () => go(container, user, { lessonId: prev.id }));
    const nx = container.querySelector('#hubNext'); if (nxt) nx.addEventListener('click', () => go(container, user, { lessonId: nxt.id }));
    // Catatan: simpan otomatis (debounce)
    const note = container.querySelector('#hubNote');
    let nt = null;
    note.addEventListener('input', () => {
      clearTimeout(nt);
      container.querySelector('#hubNoteSt').textContent = 'Menyimpan…';
      nt = setTimeout(() => { try { DB.hubSaveNote(c.id, l.id, user.id, note.value); container.querySelector('#hubNoteSt').textContent = 'Tersimpan otomatis'; } catch (e) { UI.toast(e.message, 'error'); } }, 600);
    });
    // Penyelesaian: token durasi (artikel/video/tautan) atau kuis
    const doneBtn = container.querySelector('#hubDone');
    if (doneBtn) {
      let tok;
      try { tok = DB.beginLearning(user.id, 'materi', 'hub:' + l.id); } catch (e) { doneBtn.textContent = 'Tandai selesai'; doneBtn.disabled = true; }
      if (tok) {
        const tick = () => {
          const w = DB.learningTokenWait(tok.token);
          if (w == null || !doneBtn.isConnected) { stopTimer(); return; }
          if (w > 0) doneBtn.textContent = `Pelajari dulu… ${w} dtk`;
          else { doneBtn.disabled = false; doneBtn.textContent = '✓ Tandai selesai'; stopTimer(); }
        };
        tick(); readTimer = setInterval(tick, 1000);
        doneBtn.addEventListener('click', () => {
          try {
            const r = DB.hubCompleteLesson(c.id, l.id, user.id, { token: tok.token });
            UI.toast(r.progress.completedAt && !p.completedAt ? '🎓 Course selesai! Sertifikat tersedia.' : 'Pelajaran selesai ✓');
            go(container, user, { lessonId: nxt ? nxt.id : l.id });
          } catch (e) { UI.toast(e.message, 'error'); }
        });
      }
    }
    const qf = container.querySelector('#hubQuiz');
    if (qf) qf.addEventListener('submit', (e) => {
      e.preventDefault();
      const answers = (l.questions || []).map((_, i) => { const v = qf.querySelector(`input[name=hq${i}]:checked`); return v ? Number(v.value) : null; });
      if (answers.some(a => a == null)) { UI.toast('Jawab semua soal kuis.', 'error'); return; }
      try {
        const r = DB.hubCompleteLesson(c.id, l.id, user.id, { answers });
        UI.toast(r.passed ? `Lulus dengan skor ${r.score}! 🎉` : `Skor ${r.score}. Belum mencapai ${l.passScore || 70}, coba lagi.`, r.passed ? 'success' : 'info');
        go(container, user, {});
      } catch (ex) { UI.toast(ex.message, 'error'); }
    });
  }

  function certId(c, user, p) {
    let h = 0; for (const ch of c.id + user.id + p.completedAt) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return 'RBL-' + h.toString(36).toUpperCase().padStart(7, '0');
  }
  function openCertificate(c, user, p) {
    const win = global.open('', '_blank');
    if (!win) { UI.toast('Popup diblokir browser. Izinkan popup untuk membuka sertifikat.', 'error'); return; }
    const app = DB.getSettings().appName || 'LMS Rubela';
    win.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Sertifikat ${esc(c.title)}</title>
      <style>@page{size:A4 landscape;margin:0}body{margin:0;font-family:Georgia,serif;background:#f8fafc}
      .c{box-sizing:border-box;width:297mm;height:210mm;padding:22mm;border:10px double ${esc(c.color || '#4f46e5')};background:#fff;text-align:center;display:flex;flex-direction:column;justify-content:center}
      h1{font-size:38px;margin:0 0 8px;letter-spacing:2px}h2{font-size:30px;margin:18px 0}p{font-size:16px;color:#334155}.id{margin-top:26px;font-size:12px;color:#64748b;font-family:monospace}</style></head>
      <body><div class="c"><p>${esc(app)}</p><h1>SERTIFIKAT PENYELESAIAN</h1><p>diberikan kepada</p><h2>${esc(user.name)}</h2>
      <p>atas penyelesaian course <strong>${esc(c.title)}</strong></p><p>${new Date(p.completedAt).toLocaleDateString('id-ID', { dateStyle: 'long' })}</p>
      <div class="id">ID: ${certId(c, user, p)}</div></div><script>setTimeout(function(){window.print()},300)<\/script></body></html>`);
    win.document.close();
  }

  /* =====================================================================
   * ORANG TUA
   * ===================================================================*/
  function renderParent(container, child) {
    const progress = DB.getHubProgressByStudent(child.id);
    const rows = progress.map(p => ({ p, c: DB.getHubCourse(p.courseId) })).filter(x => x.c);
    container.innerHTML = `<div class="card"><div class="card-header">${UI.secHead('📚', `Course Mandiri ${esc(child.name)}`, 'course yang disusun tim Rubela (hanya baca)')}</div>
      ${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Course</th><th>Bergabung</th><th>Progres</th><th>Kuis</th><th>Status</th></tr></thead>
        <tbody>${rows.map(({ p, c }) => { const qs = Object.values(p.quiz || {});
          return `<tr><td><strong>${esc(c.title)}</strong><div class="muted small">${esc(c.category || '')}</div></td><td>${UI.fmtDate(p.enrolledAt)}</td>
            <td style="min-width:140px;"><div class="hub-prog"><i style="width:${DB.hubPercent(c, p)}%"></i></div><span class="small">${DB.hubPercent(c, p)}%</span></td>
            <td>${qs.length ? qs.map(q => `${q.score}${q.passed ? '✓' : ''}`).join(', ') : '-'}</td>
            <td>${p.completedAt ? `<span class="badge badge-success">Selesai ${UI.fmtDate(p.completedAt)}</span>` : '<span class="badge badge-info">Berjalan</span>'}</td></tr>`; }).join('')}</tbody></table></div>`
        : `<div class="empty"><div class="empty-icon">📭</div>${esc(child.name)} belum mengikuti course mandiri. Tersedia ${DB.hubCoursesForStudent(child.id).length} course.</div>`}</div>`;
  }

  /* =====================================================================
   * ADMIN
   * ===================================================================*/
  let adm = { mode: 'list', draft: null };
  function renderAdmin(container, admin) {
    if (adm.mode === 'edit' && adm.draft) return renderEditor(container, admin);
    const list = DB.getHubCourses();
    const prog = (id) => DB.getHubProgressByCourse(id);
    container.innerHTML = `<div class="card"><div class="card-header">${UI.secHead('📚', `Course Mandiri (${list.length})`, 'tanpa tutor — seluruh isi diatur admin; tidak tercampur dengan materi kelas')}
      <button type="button" class="btn btn-primary btn-sm" id="hubNew">+ Buat Course</button></div><div id="hubAdmList"></div></div>`;
    container.querySelector('#hubNew').addEventListener('click', () => {
      adm = { mode: 'edit', draft: { id: null, title: '', subtitle: '', description: '', category: '', level: 'Pemula', language: 'Bahasa Indonesia', color: '#4f46e5', cover: '',
        outcomes: [], requirements: [], audience: { type: 'all', classes: [], studentIds: [] }, enrollMode: 'open', active: false, newStudentPolicy: 'all', certificate: true,
        sections: [{ id: nid('sec'), title: 'Bab 1', lessons: [] }] } };
      renderAdmin(container, admin);
    });
    DataSearch.mount({
      container: container.querySelector('#hubAdmList'), items: list, stateKey: 'hub-admin',
      placeholder: 'Cari judul, kategori, atau pelajaran…', fields: c => [c.title, c.subtitle, c.category, lessonsOf(c).map(l => l.title)],
      filters: [{ key: 'st', label: 'Semua status', get: c => c.active !== false ? 'on' : 'off', options: [{ value: 'on', label: 'Aktif' }, { value: 'off', label: 'Nonaktif' }] }],
      pageSize: 15, empty: 'Belum ada course. Klik "Buat Course".',
      render: (rows, ctx) => `<div class="table-wrap"><table class="table"><thead><tr><th>Course</th><th>Pelajaran</th><th>Sasaran</th><th>Peserta</th><th>Rata progres</th><th>Status</th><th>Aksi</th></tr></thead>
        <tbody>${rows.map(c => { const ps = prog(c.id); const avg = ps.length ? Math.round(ps.reduce((n, p) => n + DB.hubPercent(c, p), 0) / ps.length) : 0;
          const a = c.audience || {};
          return `<tr><td><div class="user-cell">${coverHtml(c, 'is-sm')}<div><strong>${ctx.highlight(c.title)}</strong><div class="muted small">${esc(c.category || '-')} • ${c.enrollMode === 'assigned' ? 'didaftarkan admin' : 'bebas bergabung'}</div></div></div></td>
            <td>${lessonsOf(c).length}</td><td class="small">${a.type === 'kelas' ? esc((a.classes || []).join(', ') || '-') : a.type === 'students' ? `${(a.studentIds || []).length} mentee` : 'Semua mentee'}</td>
            <td>${ps.length}<div class="muted small">${ps.filter(p => p.completedAt).length} selesai</div></td><td>${avg}%</td>
            <td>${c.active !== false ? '<span class="badge badge-success">Aktif</span>' : '<span class="badge badge-gray">Nonaktif</span>'}${c.newStudentPolicy === 'fromJoin' ? '<div class="muted small">siswa baru: konten baru</div>' : ''}</td>
            <td class="actions"><button type="button" class="btn btn-sm btn-primary" data-hub-edit="${c.id}">Edit</button>
              <button type="button" class="btn btn-sm btn-secondary" data-hub-stats="${c.id}">Peserta</button>
              <button type="button" class="btn btn-sm btn-secondary" data-hub-toggle="${c.id}">${c.active !== false ? '⏸ Matikan' : '▶ Aktifkan'}</button>
              <button type="button" class="btn btn-sm btn-danger" data-hub-del="${c.id}">Hapus</button></td></tr>`; }).join('')}</tbody></table></div>`,
      onPaint: (box) => {
        box.querySelectorAll('[data-hub-edit]').forEach(b => b.addEventListener('click', () => { adm = { mode: 'edit', draft: clone(DB.getHubCourse(b.dataset.hubEdit)) }; renderAdmin(container, admin); }));
        box.querySelectorAll('[data-hub-toggle]').forEach(b => b.addEventListener('click', () => {
          const c = DB.getHubCourse(b.dataset.hubToggle);
          if (c.active !== false && !UI.confirmDialog('Matikan course ini? Mentee tidak dapat membukanya sampai diaktifkan kembali.')) return;
          try { DB.setHubCourseActive(c.id, c.active === false, admin); UI.toast('Status course diperbarui.'); renderAdmin(container, admin); } catch (e) { UI.toast(e.message, 'error'); }
        }));
        box.querySelectorAll('[data-hub-del]').forEach(b => b.addEventListener('click', () => {
          if (!UI.confirmDialog('Hapus course beserta seluruh progres peserta?')) return;
          try { DB.deleteHubCourse(b.dataset.hubDel, admin); UI.toast('Course dihapus.'); renderAdmin(container, admin); } catch (e) { UI.toast(e.message, 'error'); }
        }));
        box.querySelectorAll('[data-hub-stats]').forEach(b => b.addEventListener('click', () => openStats(container, admin, b.dataset.hubStats)));
      }
    });
  }

  function linesOf(text) { return String(text || '').split('\n').map(s => s.trim()).filter(Boolean); }

  function renderEditor(container, admin) {
    const d = adm.draft;
    const classes = DB.getMainClasses();
    const students = DB.getUsers().filter(u => u.role === 'siswa');
    container.innerHTML = `
      <div class="flex-between mb-2"><button type="button" class="btn btn-secondary btn-sm" id="hubCancel">← Kembali tanpa menyimpan</button>
        <button type="button" class="btn btn-primary" id="hubSave">💾 Simpan Course</button></div>
      <div class="hub-editor">
        <form class="card form" id="hubInfo"><div class="card-header">${UI.secHead('🧾', 'Informasi Course', 'tampil di halaman course mentee')}</div>
          <div class="form-group"><label>Judul</label><input name="title" class="input" maxlength="140" required value="${esc(d.title)}" /></div>
          <div class="form-group"><label>Subjudul</label><input name="subtitle" class="input" maxlength="240" value="${esc(d.subtitle)}" /></div>
          <div class="form-row"><div class="form-group"><label>Kategori</label><input name="category" class="input" maxlength="60" value="${esc(d.category)}" /></div>
            <div class="form-group"><label>Level</label><select name="level" class="input">${['Pemula', 'Menengah', 'Lanjutan', 'Semua level'].map(v => `<option ${d.level === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
            <div class="form-group"><label>Bahasa</label><input name="language" class="input" maxlength="40" value="${esc(d.language || 'Bahasa Indonesia')}" /></div></div>
          <div class="form-row"><div class="form-group"><label>Warna tema</label><input type="color" name="color" value="${esc(d.color || '#4f46e5')}" /></div>
            <div class="form-group"><label>Cover</label><div class="photo-field">${coverHtml(d, 'is-sm')}<input type="file" name="cover" class="input" accept="image/jpeg,image/png,image/webp" />
              ${d.cover ? '<button type="button" class="btn btn-sm btn-ghost" id="hubRmCover">Hapus</button>' : ''}</div></div></div>
          <div class="form-group"><label>Deskripsi</label>${Editor.toolbarHtml('hubDesc')}<div id="hubDesc" class="qe-editor" contenteditable="true">${d.description || ''}</div></div>
          <div class="form-row"><div class="form-group"><label>Yang akan dipelajari (satu per baris)</label><textarea name="outcomes" rows="4">${esc((d.outcomes || []).join('\n'))}</textarea></div>
            <div class="form-group"><label>Persyaratan (satu per baris)</label><textarea name="requirements" rows="4">${esc((d.requirements || []).join('\n'))}</textarea></div></div>
          <h4>Peserta & akses</h4>
          <div class="form-row"><div class="form-group"><label>Sasaran</label><select name="aud" class="input">
              <option value="all" ${d.audience.type === 'all' ? 'selected' : ''}>Semua mentee</option><option value="kelas" ${d.audience.type === 'kelas' ? 'selected' : ''}>Kelas utama tertentu</option>
              <option value="students" ${d.audience.type === 'students' ? 'selected' : ''}>Mentee tertentu</option></select></div>
            <div class="form-group"><label>Pendaftaran</label><select name="enroll" class="input"><option value="open" ${d.enrollMode !== 'assigned' ? 'selected' : ''}>Mentee bergabung sendiri</option>
              <option value="assigned" ${d.enrollMode === 'assigned' ? 'selected' : ''}>Didaftarkan admin</option></select></div></div>
          <div class="form-group ${d.audience.type === 'kelas' ? '' : 'hidden'}" id="hubAudKelas"><label>Kelas utama</label><div class="hub-checks">${classes.map(k => `<label class="check-row"><input type="checkbox" name="cls" value="${esc(k)}" ${(d.audience.classes || []).includes(k) ? 'checked' : ''}/> ${esc(k)}</label>`).join('')}</div></div>
          <div class="form-group ${d.audience.type === 'students' ? '' : 'hidden'}" id="hubAudStu"><label>Mentee</label><div class="hub-checks">${students.map(s => `<label class="check-row"><input type="checkbox" name="stu" value="${s.id}" ${(d.audience.studentIds || []).includes(s.id) ? 'checked' : ''}/> ${esc(s.name)} <span class="muted small">${esc(s.kelas || '')}</span></label>`).join('')}</div></div>
          <div class="form-group"><label>Konten untuk mentee yang bergabung belakangan</label><select name="policy" class="input">
            <option value="all" ${d.newStudentPolicy !== 'fromJoin' ? 'selected' : ''}>Langsung melihat semua pelajaran</option>
            <option value="fromJoin" ${d.newStudentPolicy === 'fromJoin' ? 'selected' : ''}>Hanya pelajaran baru / yang diaktifkan ulang</option></select></div>
          <label class="check-row"><input type="checkbox" name="cert" ${d.certificate ? 'checked' : ''}/> Berikan sertifikat penyelesaian</label>
          <label class="check-row"><input type="checkbox" name="active" ${d.active !== false ? 'checked' : ''}/> Course aktif (tampil untuk mentee)</label>
        </form>
        <div class="card"><div class="card-header">${UI.secHead('🧭', 'Kurikulum', 'bab berisi pelajaran: artikel, video, PDF, tautan, atau kuis')}
          <button type="button" class="btn btn-sm btn-secondary" id="hubAddSec">+ Bab</button></div>
          <div id="hubSecs">${(d.sections || []).map((sec, si) => `<div class="hub-esec" data-si="${si}">
            <div class="hub-esec-head"><input class="input" data-sec-title="${si}" maxlength="120" value="${esc(sec.title)}" aria-label="Judul bab" />
              <button type="button" class="btn btn-sm btn-ghost" data-sec-up="${si}" ${si ? '' : 'disabled'} aria-label="Naikkan bab">↑</button>
              <button type="button" class="btn btn-sm btn-ghost" data-sec-down="${si}" ${si < d.sections.length - 1 ? '' : 'disabled'} aria-label="Turunkan bab">↓</button>
              <button type="button" class="btn btn-sm btn-danger" data-sec-del="${si}">Hapus</button></div>
            <ol class="hub-elessons">${(sec.lessons || []).map((l, li) => `<li class="${l.active === false ? 'is-off' : ''}"><span>${TYPE[l.type].ic}</span><span class="hub-li-t">${esc(l.title || '(tanpa judul)')}</span>
              <span class="muted small">${TYPE[l.type].label}${l.durationMin ? ' • ' + l.durationMin + ' mnt' : ''}${l.dripDays ? ` • buka H+${l.dripDays}` : ''}${l.active === false ? ' • nonaktif' : ''}</span>
              <span class="hub-li-act"><button type="button" class="btn btn-sm btn-ghost" data-les-up="${si}:${li}" ${li ? '' : 'disabled'} aria-label="Naikkan">↑</button>
                <button type="button" class="btn btn-sm btn-ghost" data-les-down="${si}:${li}" ${li < sec.lessons.length - 1 ? '' : 'disabled'} aria-label="Turunkan">↓</button>
                <button type="button" class="btn btn-sm btn-secondary" data-les-edit="${si}:${li}">Edit</button>
                <button type="button" class="btn btn-sm btn-secondary" data-les-toggle="${si}:${li}">${l.active === false ? '▶ Aktifkan' : '⏸ Matikan'}</button>
                ${d.newStudentPolicy === 'fromJoin' && d.id ? `<button type="button" class="btn btn-sm btn-ghost" data-les-re="${si}:${li}" title="Buka juga untuk mentee yang bergabung belakangan">🔄 Aktifkan ulang</button>` : ''}
                <button type="button" class="btn btn-sm btn-danger" data-les-del="${si}:${li}" aria-label="Hapus pelajaran">✕</button></span></li>`).join('')}</ol>
            <button type="button" class="btn btn-sm btn-secondary" data-les-add="${si}">+ Pelajaran</button></div>`).join('')}</div>
        </div>
      </div>`;
    const info = container.querySelector('#hubInfo');
    Editor.attach(info);
    const syncInfo = () => {
      const f = info;
      Object.assign(d, { title: f.title.value, subtitle: f.subtitle.value, category: f.category.value, level: f.level.value, language: f.language.value,
        color: f.color.value, description: RichText.sanitize(f.querySelector('#hubDesc').innerHTML), outcomes: linesOf(f.outcomes.value), requirements: linesOf(f.requirements.value),
        enrollMode: f.enroll.value, newStudentPolicy: f.policy.value, certificate: f.cert.checked, active: f.active.checked,
        audience: { type: f.aud.value, classes: [...f.querySelectorAll('input[name=cls]:checked')].map(x => x.value), studentIds: [...f.querySelectorAll('input[name=stu]:checked')].map(x => x.value) } });
      container.querySelectorAll('[data-sec-title]').forEach(inp => { d.sections[Number(inp.dataset.secTitle)].title = inp.value; });
    };
    const rerender = () => { syncInfo(); renderEditor(container, admin); };
    info.aud.addEventListener('change', () => {
      container.querySelector('#hubAudKelas').classList.toggle('hidden', info.aud.value !== 'kelas');
      container.querySelector('#hubAudStu').classList.toggle('hidden', info.aud.value !== 'students');
    });
    info.cover.addEventListener('change', async () => {
      const f = info.cover.files[0];
      if (!f) return;
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { UI.toast('Cover harus JPG, PNG, atau WEBP.', 'error'); return; }
      try { syncInfo(); d.cover = await Editor.compressImage(f); renderEditor(container, admin); } catch (e) { UI.toast(e.message, 'error'); }
    });
    const rmc = container.querySelector('#hubRmCover'); if (rmc) rmc.addEventListener('click', () => { syncInfo(); d.cover = ''; renderEditor(container, admin); });
    container.querySelector('#hubCancel').addEventListener('click', () => { if (UI.confirmDialog('Keluar tanpa menyimpan perubahan?')) { adm = { mode: 'list' }; renderAdmin(container, admin); } });
    container.querySelector('#hubSave').addEventListener('click', () => {
      syncInfo();
      if (d.audience.type === 'kelas' && !d.audience.classes.length) { UI.toast('Pilih minimal satu kelas utama.', 'error'); return; }
      if (d.audience.type === 'students' && !d.audience.studentIds.length) { UI.toast('Pilih minimal satu mentee.', 'error'); return; }
      try {
        const saved = DB.saveHubCourse(d, admin);
        // Mode "didaftarkan admin": daftarkan otomatis mentee sasaran tertentu.
        if (saved.enrollMode === 'assigned' && saved.audience.type === 'students') saved.audience.studentIds.forEach(id => { try { DB.hubEnroll(saved.id, id); } catch (e) { /* lewati */ } });
        UI.toast('Course disimpan.');
        adm = { mode: 'edit', draft: clone(saved) };
        renderEditor(container, admin);
      } catch (e) { UI.toast(e.message, 'error'); }
    });
    container.querySelector('#hubAddSec').addEventListener('click', () => { syncInfo(); d.sections.push({ id: nid('sec'), title: `Bab ${d.sections.length + 1}`, lessons: [] }); renderEditor(container, admin); });
    const at = (v) => v.split(':').map(Number);
    const on = (sel, fn) => container.querySelectorAll(sel).forEach(b => b.addEventListener('click', () => { syncInfo(); fn(b); }));
    on('[data-sec-up]', b => { const i = Number(b.dataset.secUp); [d.sections[i - 1], d.sections[i]] = [d.sections[i], d.sections[i - 1]]; renderEditor(container, admin); });
    on('[data-sec-down]', b => { const i = Number(b.dataset.secDown); [d.sections[i + 1], d.sections[i]] = [d.sections[i], d.sections[i + 1]]; renderEditor(container, admin); });
    on('[data-sec-del]', b => { const i = Number(b.dataset.secDel); if ((d.sections[i].lessons || []).length && !UI.confirmDialog('Hapus bab beserta pelajarannya?')) return; d.sections.splice(i, 1); renderEditor(container, admin); });
    on('[data-les-add]', b => openLesson(container, admin, Number(b.dataset.lesAdd), -1));
    on('[data-les-edit]', b => { const [si, li] = at(b.dataset.lesEdit); openLesson(container, admin, si, li); });
    on('[data-les-del]', b => { const [si, li] = at(b.dataset.lesDel); if (!UI.confirmDialog('Hapus pelajaran ini?')) return; d.sections[si].lessons.splice(li, 1); renderEditor(container, admin); });
    on('[data-les-up]', b => { const [si, li] = at(b.dataset.lesUp); const ls = d.sections[si].lessons; [ls[li - 1], ls[li]] = [ls[li], ls[li - 1]]; renderEditor(container, admin); });
    on('[data-les-down]', b => { const [si, li] = at(b.dataset.lesDown); const ls = d.sections[si].lessons; [ls[li + 1], ls[li]] = [ls[li], ls[li + 1]]; renderEditor(container, admin); });
    on('[data-les-toggle]', b => { const [si, li] = at(b.dataset.lesToggle); const l = d.sections[si].lessons[li]; l.active = l.active === false; renderEditor(container, admin); });
    on('[data-les-re]', b => {
      const [si, li] = at(b.dataset.lesRe); const l = d.sections[si].lessons[li];
      l.active = true; l.reactivatedAt = Date.now();
      UI.toast('Pelajaran akan dibuka untuk mentee yang bergabung belakangan setelah course disimpan.', 'info');
      renderEditor(container, admin);
    });
  }

  function openLesson(container, admin, si, li) {
    const d = adm.draft;
    const isNew = li < 0;
    const l = isNew ? { id: nid('les'), title: '', type: 'article', durationMin: 5, dripDays: 0, active: true, createdAt: Date.now(), content: '', url: '', questions: [], passScore: 70 } : clone(d.sections[si].lessons[li]);
    if (!l.questions) l.questions = [];
    const paint = () => {
      UI.modal.open(isNew ? 'Tambah Pelajaran' : 'Edit Pelajaran', `<form id="lesForm" class="form">
        <div class="form-row"><div class="form-group"><label>Judul pelajaran</label><input name="title" class="input" maxlength="140" required value="${esc(l.title)}" /></div>
          <div class="form-group"><label>Jenis</label><select name="type" class="input">${Object.keys(TYPE).map(k => `<option value="${k}" ${l.type === k ? 'selected' : ''}>${TYPE[k].ic} ${TYPE[k].label}</option>`).join('')}</select></div></div>
        <div class="form-row"><div class="form-group"><label>Durasi (menit)</label><input type="number" name="dur" class="input" min="0" max="600" value="${Number(l.durationMin) || 0}" /></div>
          <div class="form-group"><label>Buka setelah H+ hari bergabung (0 = langsung)</label><input type="number" name="drip" class="input" min="0" max="365" value="${Number(l.dripDays) || 0}" /></div></div>
        ${['video', 'pdf', 'link'].includes(l.type) ? `<div class="form-group"><label>${l.type === 'video' ? 'URL video (YouTube/Vimeo)' : 'URL dokumen/tautan'} — https://</label><input name="url" class="input" type="url" maxlength="500" value="${esc(l.url || '')}" /></div>` : ''}
        <div class="form-group"><label>${l.type === 'quiz' ? 'Petunjuk kuis' : 'Isi / keterangan'}</label>${Editor.toolbarHtml('lesBody')}<div id="lesBody" class="qe-editor ${l.type === 'article' ? 'ce-editor-tall' : ''}" contenteditable="true">${l.content || ''}</div></div>
        ${l.type === 'quiz' ? `<div class="form-group"><label>Nilai lulus (%)</label><input type="number" name="pass" class="input" min="1" max="100" value="${Number(l.passScore) || 70}" style="max-width:140px;" /></div>
          <div id="lesQs">${l.questions.map((q, i) => `<fieldset class="rt-q" data-qi="${i}"><legend>Soal ${i + 1} <button type="button" class="btn btn-sm btn-ghost" data-rmq="${i}">Hapus</button></legend>
            <input class="input" data-f="text" placeholder="Pertanyaan" value="${esc(q.text || '')}" />
            ${(q.options || ['', '', '', '']).map((o, k) => `<div class="flex-gap mt-1"><input type="radio" name="lk${i}" value="${k}" ${q.correctIndex === k ? 'checked' : ''} aria-label="Kunci ${String.fromCharCode(65 + k)}"/><input class="input" data-f="opt" style="flex:1" value="${esc(o)}" placeholder="Pilihan ${String.fromCharCode(65 + k)}" /></div>`).join('')}
            </fieldset>`).join('')}</div>
          <button type="button" class="btn btn-sm btn-secondary" id="lesAddQ">+ Soal</button>` : ''}
        <div id="lesErr" class="alert alert-error hidden"></div>
        <div class="flex-gap" style="justify-content:flex-end;"><button type="button" class="btn btn-secondary" data-close>Batal</button><button class="btn btn-primary" type="submit">Simpan Pelajaran</button></div></form>`);
      const f = document.getElementById('lesForm');
      Editor.attach(f);
      const collect = () => {
        l.title = f.title.value; l.durationMin = Math.max(0, Math.round(Number(f.dur.value) || 0)); l.dripDays = Math.max(0, Math.min(365, Math.round(Number(f.drip.value) || 0)));
        l.content = RichText.sanitize(f.querySelector('#lesBody').innerHTML);
        if (f.url) l.url = f.url.value.trim();
        if (f.pass) l.passScore = Math.max(1, Math.min(100, Math.round(Number(f.pass.value) || 70)));
        f.querySelectorAll('[data-qi]').forEach(fs => {
          const q = l.questions[Number(fs.dataset.qi)];
          q.text = fs.querySelector('[data-f=text]').value;
          q.options = [...fs.querySelectorAll('[data-f=opt]')].map(x => x.value);
          const k = fs.querySelector('input[type=radio]:checked'); q.correctIndex = k ? Number(k.value) : -1;
        });
      };
      f.type.addEventListener('change', () => { collect(); l.type = f.type.value; paint(); });
      const addQ = f.querySelector('#lesAddQ');
      if (addQ) addQ.addEventListener('click', () => { collect(); if (l.questions.length >= 20) return; l.questions.push({ text: '', options: ['', '', '', ''], correctIndex: 0 }); paint(); });
      f.querySelectorAll('[data-rmq]').forEach(b => b.addEventListener('click', () => { collect(); l.questions.splice(Number(b.dataset.rmq), 1); paint(); }));
      f.querySelector('[data-close]').addEventListener('click', () => UI.modal.close());
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        collect();
        const err = f.querySelector('#lesErr');
        const fail = (m) => { err.textContent = m; err.classList.remove('hidden'); };
        if (!l.title.trim()) return fail('Judul wajib diisi.');
        if (['video', 'pdf', 'link'].includes(l.type) && l.url && !/^https:\/\//i.test(l.url)) return fail('Tautan harus diawali https://');
        if (l.type === 'quiz') {
          if (!l.questions.length) return fail('Tambahkan minimal satu soal.');
          for (let i = 0; i < l.questions.length; i++) {
            const q = l.questions[i];
            q.options = q.options.map(o => o.trim()).filter(Boolean);
            if (!q.text.trim() || q.options.length < 2 || !(q.correctIndex >= 0 && q.correctIndex < q.options.length)) return fail(`Soal ${i + 1}: isi pertanyaan, minimal 2 pilihan, dan pilih kunci.`);
          }
        }
        if (isNew) d.sections[si].lessons.push(l); else d.sections[si].lessons[li] = l;
        UI.modal.close();
        renderEditor(container, admin);
      });
    };
    // Simpan isi form informasi sebelum membuka modal agar tidak hilang.
    const info = container.querySelector('#hubInfo');
    if (info) {
      d.title = info.title.value; d.subtitle = info.subtitle.value;
      container.querySelectorAll('[data-sec-title]').forEach(inp => { d.sections[Number(inp.dataset.secTitle)].title = inp.value; });
    }
    paint();
  }

  function openStats(container, admin, id) {
    const c = DB.getHubCourse(id);
    const ps = DB.getHubProgressByCourse(id);
    const eligible = DB.getUsers().filter(u => u.role === 'siswa' && DB.hubAudienceIncludes(c, u) && !ps.some(p => p.studentId === u.id));
    UI.modal.open(`Peserta — ${c.title}`, `<div class="ai-modal">
      ${eligible.length ? `<form id="hubEnrollForm" class="flex-gap mb-2"><select class="input" name="sid" style="flex:1">${eligible.map(u => `<option value="${u.id}">${esc(u.name)} — ${esc(u.kelas || '-')}</option>`).join('')}</select>
        <button class="btn btn-primary btn-sm" type="submit">+ Daftarkan</button></form>` : ''}
      ${ps.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Mentee</th><th>Bergabung</th><th>Progres</th><th>Kuis</th><th>Selesai</th></tr></thead>
      <tbody>${ps.map(p => { const u = DB.getUser(p.studentId); return `<tr><td><strong>${esc(u ? u.name : '-')}</strong><div class="muted small">${esc(u ? u.kelas || '' : '')}</div></td>
        <td>${UI.fmtDate(p.enrolledAt)}</td><td>${DB.hubPercent(c, p)}%</td><td>${Object.values(p.quiz || {}).map(q => q.score).join(', ') || '-'}</td>
        <td>${p.completedAt ? UI.fmtDate(p.completedAt) : '-'}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty"><div class="empty-icon">📭</div>Belum ada peserta.</div>'}</div>`);
    const f = document.getElementById('hubEnrollForm');
    if (f) f.addEventListener('submit', (e) => {
      e.preventDefault();
      try { DB.hubEnroll(id, f.sid.value); DB.addNotification({ userId: f.sid.value, icon: '📚', title: 'Kamu didaftarkan ke course baru', body: c.title, link: 'course' }); UI.toast('Mentee didaftarkan.'); openStats(container, admin, id); }
      catch (ex) { UI.toast(ex.message, 'error'); }
    });
  }

  global.CourseHub = { render, renderAdmin, renderParent, reset: () => { view = { mode: 'catalog', tab: 'mine' }; adm = { mode: 'list' }; stopTimer(); } };
})(window);
