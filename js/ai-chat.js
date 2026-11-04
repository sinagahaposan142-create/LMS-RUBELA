/* =====================================================================
 * js/ai-chat.js — komponen chat AI bersama (riwayat tersimpan 7 hari)
 * ---------------------------------------------------------------------
 * Dipakai oleh: Asisten AI (admin & tutor), AI Guru (mentee), dan
 * pembahasan soal CBT setelah ujian (mentee).
 *
 * AIChat.mount(container, user, {
 *   kind:'assistant'|'tutor'|'cbt', ref (opsional: satu utas per ref),
 *   title, subtitle, icon, intro (HTML aman), placeholder, suggestions:[…],
 *   context:(pertanyaan) => ({ system, pseudo }),   // js/ai-context.js
 *   modePick:boolean, compact:boolean, temperature, maxTokens
 * })
 *
 * Riwayat disimpan di DB.saveAiChat (tersinkron, hanya dapat dibaca
 * pemiliknya). Pesan > 7 hari dan utas kosong terhapus otomatis.
 * ===================================================================*/
(function (global) {
  'use strict';
  const esc = (s) => UI.esc(s);
  const HISTORY_TURNS = 12;

  function relTime(ts) {
    const d = Date.now() - (Number(ts) || 0);
    if (d < 60000) return 'baru saja';
    if (d < 3600000) return Math.floor(d / 60000) + ' mnt lalu';
    if (d < 86400000) return Math.floor(d / 3600000) + ' jam lalu';
    return Math.floor(d / 86400000) + ' hari lalu';
  }
  function expiresLabel(t) {
    const left = (Number(t.updatedAt) || 0) + DB.AI_CHAT_TTL_MS - Date.now();
    const days = Math.max(0, Math.ceil(left / 86400000));
    return days <= 1 ? 'terhapus < 1 hari' : `terhapus ${days} hari lagi`;
  }

  function mount(container, user, opts) {
    const o = Object.assign({ kind: 'assistant', title: 'Asisten AI', icon: '🤖', placeholder: 'Ketik pertanyaan…', suggestions: [],
      temperature: 0.5, maxTokens: 1800 }, opts || {});
    const st = { threadId: null, busy: false, mode: '' };
    const single = o.ref != null;
    const canPick = !!o.modePick && (user.role === 'admin' || user.role === 'guru');

    function threads() { return DB.getAiChats(user.id, o.kind, single ? String(o.ref) : null); }
    function current() {
      if (single) return threads()[0] || null;
      return st.threadId ? DB.getAiChat(st.threadId) : null;
    }

    function shell() {
      const c = AI.cfg();
      const ready = AI.ready();
      container.innerHTML = `
        <div class="aic ${o.compact ? 'is-compact' : ''} ${single ? 'is-single' : ''}">
          ${single ? '' : `<aside class="aic-side" aria-label="Riwayat percakapan">
            <button type="button" class="btn btn-primary btn-sm btn-block aic-new">＋ Percakapan baru</button>
            <div class="aic-list" role="list"></div>
            <p class="aic-ttl muted small">🕒 Riwayat tersimpan 7 hari sejak pesan terakhir, lalu terhapus otomatis.</p>
          </aside>`}
          <section class="aic-main">
            <header class="aic-head">
              <div class="aic-title"><span class="aic-ic" aria-hidden="true">${esc(o.icon)}</span>
                <div><strong>${esc(o.title)}</strong>
                  <div class="muted small aic-sub">${o.subtitle ? esc(o.subtitle) + ' • ' : ''}Ditenagai <span class="aic-prov">${esc(AI.providerLabel())}</span></div></div></div>
              <div class="aic-tools">
                ${canPick && c.ensemblePossible ? `<label class="aic-mode"><span class="sr-only">Mode jawaban</span>
                  <select class="aic-mode-sel" aria-label="Mode jawaban AI">
                    <option value="">Mode: sesuai pengaturan</option>
                    <option value="single">⚡ Satu AI (cepat)</option>
                    <option value="ensemble">🧠 Gabungan AI (lebih teliti)</option>
                  </select></label>` : ''}
                ${single ? '<button type="button" class="btn btn-ghost btn-sm aic-reset" title="Hapus percakapan ini">🗑 Mulai ulang</button>' : ''}
              </div>
            </header>
            ${AI.noticeHtml(user)}
            <div class="aic-msgs" aria-live="polite"></div>
            <div class="aic-sugs"></div>
            <form class="aic-form">
              <label class="sr-only" for="aicIn_${o.kind}">Pertanyaan</label>
              <textarea id="aicIn_${o.kind}" class="aic-input" rows="1" maxlength="4000" placeholder="${esc(o.placeholder)}" ${ready ? '' : 'disabled'}></textarea>
              <button type="submit" class="btn btn-primary aic-send" ${ready ? '' : 'disabled'} aria-label="Kirim">Kirim ➤</button>
            </form>
            <p class="aic-foot muted small">${single ? '🕒 Tersimpan 7 hari. ' : ''}AI dapat keliru — periksa kembali informasi penting.</p>
          </section>
        </div>`;
      const sel = container.querySelector('.aic-mode-sel');
      if (sel) { sel.value = st.mode; sel.addEventListener('change', () => { st.mode = sel.value; }); }
      const ta = container.querySelector('.aic-input');
      ta.addEventListener('input', autosize);
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
      });
      container.querySelector('.aic-form').addEventListener('submit', (e) => { e.preventDefault(); send(); });
      const nb = container.querySelector('.aic-new');
      if (nb) nb.addEventListener('click', () => { st.threadId = null; paintList(); paintMsgs(); ta.focus(); });
      const rb = container.querySelector('.aic-reset');
      if (rb) rb.addEventListener('click', () => {
        const t = current();
        if (!t || !UI.confirmDialog('Hapus percakapan ini?')) return;
        DB.deleteAiChat(t.id, user.id);
        paintMsgs();
      });
      paintList(); paintMsgs();
    }

    function autosize() {
      const ta = container.querySelector('.aic-input');
      if (!ta) return;
      ta.style.height = 'auto';
      ta.style.height = Math.min(180, ta.scrollHeight) + 'px';
    }

    function paintList() {
      const box = container.querySelector('.aic-list');
      if (!box) return;
      const list = threads();
      if (st.threadId && !list.some(t => t.id === st.threadId)) st.threadId = null;
      box.innerHTML = list.length ? list.map(t => `
        <div class="aic-item ${t.id === st.threadId ? 'is-on' : ''}" role="listitem">
          <button type="button" class="aic-open" data-open="${esc(t.id)}" title="${esc(t.title)}">
            <span class="aic-it">${esc(t.title)}</span>
            <span class="aic-im muted small">${esc(relTime(t.updatedAt))} • ${esc(expiresLabel(t))}</span>
          </button>
          <button type="button" class="aic-del" data-del="${esc(t.id)}" aria-label="Hapus percakapan ${esc(t.title)}" title="Hapus">✕</button>
        </div>`).join('') : '<p class="muted small" style="margin:8px 2px;">Belum ada riwayat.</p>';
      box.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { st.threadId = b.dataset.open; paintList(); paintMsgs(); }));
      box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
        if (!UI.confirmDialog('Hapus percakapan ini dari riwayat?')) return;
        DB.deleteAiChat(b.dataset.del, user.id);
        if (st.threadId === b.dataset.del) st.threadId = null;
        paintList(); paintMsgs();
      }));
    }

    function bubble(m) {
      if (m.role === 'user') return `<div class="aic-b is-user"><div class="aic-bt">${esc(m.text).replace(/\n/g, '<br>')}</div></div>`;
      return `<div class="aic-b is-ai"><div class="aic-bt ai-answer">${AI.renderMarkdown(m.text)}</div>
        <div class="aic-bm muted small">${m.via ? esc(m.via) + ' • ' : ''}${esc(relTime(m.at))}
          <button type="button" class="aic-copy" data-copy="1" title="Salin jawaban">📋 Salin</button></div></div>`;
    }

    function paintMsgs() {
      const box = container.querySelector('.aic-msgs');
      if (!box) return;
      const t = current();
      const msgs = t ? t.messages : [];
      box.innerHTML = (o.intro ? `<div class="aic-b is-ai is-intro"><div class="aic-bt">${o.intro}</div></div>` : '') + msgs.map(bubble).join('');
      box.querySelectorAll('[data-copy]').forEach((b, i) => b.addEventListener('click', () => {
        const ai = msgs.filter(m => m.role === 'model')[i];
        if (ai && navigator.clipboard) navigator.clipboard.writeText(ai.text).then(() => UI.toast('Jawaban disalin.', 'success'), () => {});
      }));
      const sug = container.querySelector('.aic-sugs');
      if (sug) {
        sug.innerHTML = !msgs.length && o.suggestions.length && AI.ready()
          ? o.suggestions.map((x, i) => `<button type="button" class="aic-chip" data-sug="${i}">${esc(x)}</button>`).join('') : '';
        sug.querySelectorAll('[data-sug]').forEach(b => b.addEventListener('click', () => {
          const ta = container.querySelector('.aic-input');
          ta.value = o.suggestions[Number(b.dataset.sug)];
          autosize(); send();
        }));
      }
      box.scrollTop = box.scrollHeight;
    }

    async function send() {
      const ta = container.querySelector('.aic-input');
      const q = (ta.value || '').trim();
      if (!q || st.busy) return;
      if (!AI.ready()) { UI.toast('Fitur AI belum aktif. Hubungi admin.', 'error'); return; }
      st.busy = true;
      const btn = container.querySelector('.aic-send');
      ta.disabled = true; btn.disabled = true;
      ta.value = ''; autosize();

      let t = current();
      if (!t) t = { userId: user.id, kind: o.kind, ref: single ? String(o.ref) : null, title: q, messages: [] };
      const history = (t.messages || []).slice(-HISTORY_TURNS);
      t.messages = (t.messages || []).concat([{ role: 'user', text: q, at: Date.now() }]);
      t = DB.saveAiChat(t);
      const tid = t.id;
      if (!single) st.threadId = tid;
      paintList(); paintMsgs();
      const box = container.querySelector('.aic-msgs');
      const holder = document.createElement('div');
      holder.className = 'aic-b is-ai';
      holder.innerHTML = `<div class="aic-bt">${AI.loadingHtml(st.mode === 'ensemble' || (!st.mode && AI.cfg().ensembleActive) ? 'Beberapa AI sedang menjawab lalu digabungkan… (±30–50 detik)' : 'AI sedang menyusun jawaban…')}</div>`;
      box.appendChild(holder);
      box.scrollTop = box.scrollHeight;

      try {
        const ctx = o.context ? o.context(q) : { system: '', pseudo: null };
        const P = ctx.pseudo;
        const enc = (s) => (P ? P.enc(s) : s);
        const turns = history.map(m => ({ role: m.role, text: enc(m.text) })).concat([{ role: 'user', text: enc(q) }]);
        const ans = await AI.chat(turns, { system: ctx.system, temperature: o.temperature, maxTokens: o.maxTokens, mode: st.mode || undefined });
        const text = P ? P.dec(ans) : ans;
        const fresh = DB.getAiChat(tid) || t;
        fresh.messages = (fresh.messages || []).concat([{ role: 'model', text, at: Date.now(), via: AI.describeUsed(AI.lastUsed()) }]);
        DB.saveAiChat(fresh);
        if (container.isConnected) {
          const prov = container.querySelector('.aic-prov');
          if (prov) prov.textContent = AI.providerLabel();
        }
      } catch (e) {
        // Pertanyaan gagal dijawab → kembalikan ke kotak input agar mudah dikirim ulang.
        const fresh = DB.getAiChat(tid);
        if (fresh) {
          fresh.messages = (fresh.messages || []).filter((m, i, arr) => !(i === arr.length - 1 && m.role === 'user' && m.text === q));
          if (fresh.messages.length) DB.saveAiChat(fresh); else { DB.deleteAiChat(tid, user.id); if (st.threadId === tid) st.threadId = null; }
        }
        if (container.isConnected) {
          paintList(); paintMsgs();
          const b2 = container.querySelector('.aic-msgs');
          b2.insertAdjacentHTML('beforeend', `<div class="aic-b is-ai is-err"><div class="aic-bt">${AI.errorHtml(e)}</div></div>`);
          b2.scrollTop = b2.scrollHeight;
          const ta2 = container.querySelector('.aic-input');
          if (ta2 && !ta2.value) { ta2.value = q; autosize(); }
        }
        st.busy = false;
        if (container.isConnected) { const ta3 = container.querySelector('.aic-input'); const b3 = container.querySelector('.aic-send'); if (ta3) ta3.disabled = false; if (b3) b3.disabled = false; }
        return;
      }
      st.busy = false;
      if (!container.isConnected) return;
      if (single || st.threadId === tid) { paintList(); paintMsgs(); }
      else paintList();
      const ta4 = container.querySelector('.aic-input');
      const b4 = container.querySelector('.aic-send');
      if (ta4) { ta4.disabled = false; ta4.focus(); }
      if (b4) b4.disabled = false;
    }

    shell();
    return { refresh: shell };
  }

  /** Halaman "Asisten AI" untuk admin & tutor. */
  function renderAssistant(container, user) {
    const isAdmin = user.role === 'admin';
    const c = AI.cfg();
    container.innerHTML = `
      <section class="welcome-hero aic-hero"><span class="blob b1"></span><span class="blob b2"></span>
        <div class="wh-inner"><div class="wh-eyebrow">🤖 Asisten AI</div>
          <h2>Tanya apa saja tentang ${isAdmin ? 'bimbel Anda' : 'kelas & mentee Anda'}</h2>
          <p class="wh-sub">Jawaban memakai data internal LMS (${isAdmin ? 'seluruh mentee, kelas, tutor, jadwal, CBT' : 'kelas yang Anda ajar dan mentee di dalamnya'}) ditambah pengetahuan umum AI yang ditandai terpisah.
            ${c.pseudonymize ? 'Nama mentee disamarkan sebelum dikirim ke penyedia AI.' : ''}</p>
          <div class="wh-chips"><span class="wh-chip">${c.ensembleActive ? '🧠 Mode gabungan aktif' : '⚡ Mode satu AI + cadangan'}</span>
            <span class="wh-chip">🕒 Riwayat 7 hari</span><span class="wh-chip">🔒 Riwayat hanya terlihat oleh Anda</span></div></div></section>
      <div class="card aic-card" id="aicAssistant"></div>`;
    mount(container.querySelector('#aicAssistant'), user, {
      kind: 'assistant',
      title: 'Asisten AI LMS', icon: '🤖', subtitle: isAdmin ? 'Admin' : 'Tutor',
      modePick: true, temperature: 0.4, maxTokens: 2200,
      placeholder: 'Contoh: Siapa mentee yang kehadirannya di bawah standar minggu ini dan apa saran tindak lanjutnya?',
      intro: `Halo ${esc(String(user.name || '').split(' ')[0] || '')}! Saya membaca data LMS terkini setiap kali Anda bertanya.
        Sebut <strong>nama lengkap mentee</strong> untuk melihat rincian, atau tanyakan analisis kelas, jadwal, dan strategi belajar.`,
      suggestions: isAdmin ? [
        'Ringkas kondisi bimbel minggu ini: kehadiran, tugas, dan CBT.',
        'Siapa 5 mentee paling berisiko dan apa tindak lanjut yang disarankan?',
        'Kelas subtest mana yang rata-rata CBT-nya paling rendah? Apa penyebab yang mungkin?',
        'Buat draf pengumuman pengingat tugas untuk mentee yang belum mengumpulkan.'
      ] : [
        'Mentee mana di kelas saya yang perlu perhatian khusus?',
        'Subtest apa yang paling lemah di kelas saya dan bagaimana strategi mengajarnya?',
        'Susun rencana pertemuan minggu depan berdasarkan hasil CBT terakhir.',
        'Buat 3 contoh soal PU tingkat sedang beserta pembahasannya.'
      ],
      context: (q) => AIContext.forStaff(user, q)
    });
  }

  global.AIChat = { mount, renderAssistant };
})(window);
