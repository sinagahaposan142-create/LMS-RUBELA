/* =========================================================================
 * Groups — Grup Belajar (admin, tutor, mentee).
 *
 *  - Admin membuat grup, memilih anggota (mentee) dan tutor, mengarsipkan, menghapus.
 *  - Semua anggota mengobrol di grup (rumus $…$ dan tautan didukung).
 *  - Admin & tutor grup mengirim: Kuis (soal dari Bank Soal), Bahan diskusi (dengan
 *    utas balasan), Materi (editor lengkap + Impor Word / Lembar Data), Pengumuman;
 *    menyematkan dan menghapus kiriman; melihat dan mengatur ulang hasil kuis.
 *  - Kuis dinilai otomatis dengan Exam.gradeQuestion (sama dengan CBT). Soal disalin
 *    ke kiriman saat dibuat, jadi perubahan Bank Soal sesudahnya tidak mengubah kuis.
 *  - Penanda "belum dibaca" disimpan di perangkat (lms_grp_read, tidak disinkronkan).
 * Data: lms_groups, lms_group_posts, lms_group_answers (aturan di api/_lib/rules.js).
 * =======================================================================*/
(function (global) {
  'use strict';

  const K = { g: 'lms_groups', p: 'lms_group_posts', a: 'lms_group_answers' };
  const READ_KEY = 'lms_grp_read';
  const COLORS = ['#0d9488', '#2563eb', '#c2410c', '#be185d', '#4d7c0f', '#475569'];
  const KINDS = {
    message: { label: 'Pesan' },
    announcement: { label: 'Pengumuman' },
    discussion: { label: 'Bahan diskusi' },
    material: { label: 'Materi' },
    quiz: { label: 'Kuis' }
  };
  const MAX_TEXT = 4000;
  const esc = (s) => UI.esc(s);
  const svg = (d, size) => `<svg viewBox="0 0 24 24" width="${size || 16}" height="${size || 16}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    group: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>', 20),
    send: svg('<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/>', 18),
    plus: svg('<path d="M12 5v14M5 12h14"/>', 18),
    pin: svg('<path d="M12 17v5"/><path d="M9 3h6l-1 6 4 4H6l4-4Z"/>', 14),
    quiz: svg('<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>', 18),
    discussion: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/><path d="M8 9h8M8 13h5"/>', 18),
    material: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5Z"/><path d="M8 7h8M8 11h6"/>', 18),
    announcement: svg('<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>', 18),
    back: svg('<path d="M19 12H5M11 18l-6-6 6-6"/>', 18),
    dots: svg('<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>', 18),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>')
  };

  /* ============================ data ============================ */
  const load = (k) => { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const uid = (p) => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clean = (v, max) => String(v == null ? '' : v).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

  const all = () => load(K.g);
  const get = (id) => all().find(g => g.id === id) || null;
  function roleIn(g, user) {
    if (!g || !user) return null;
    if (user.role === 'admin') return 'staff';
    if ((g.tutorIds || []).includes(user.id)) return 'staff';
    if ((g.memberIds || []).includes(user.id)) return 'member';
    return null;
  }
  const forUser = (user) => all().filter(g => roleIn(g, user));
  const posts = (groupId) => load(K.p).filter(p => p.groupId === groupId).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const post = (id) => load(K.p).find(p => p.id === id) || null;
  const answersOf = (postId) => load(K.a).filter(a => a.postId === postId);
  const answer = (postId, userId) => load(K.a).find(a => a.id === postId + ':' + userId) || null;

  function saveGroup(rec, actor) {
    if (!actor || actor.role !== 'admin') throw new Error('Grup hanya dapat dikelola admin.');
    const name = clean(rec.name, 80);
    if (name.length < 2) throw new Error('Nama grup minimal 2 karakter.');
    const list = all();
    const i = rec.id ? list.findIndex(g => g.id === rec.id) : -1;
    const users = new Map(DB.getUsers().map(u => [u.id, u]));
    const out = {
      id: i >= 0 ? list[i].id : uid('grp'), name, description: clean(rec.description, 500),
      color: COLORS.includes(rec.color) ? rec.color : COLORS[0],
      memberIds: [...new Set(rec.memberIds || [])].filter(id => users.has(id) && users.get(id).role === 'siswa'),
      tutorIds: [...new Set(rec.tutorIds || [])].filter(id => users.has(id) && users.get(id).role === 'guru'),
      archived: !!rec.archived, createdBy: i >= 0 ? (list[i].createdBy || actor.id) : actor.id,
      createdAt: i >= 0 ? (list[i].createdAt || Date.now()) : Date.now(), updatedAt: Date.now()
    };
    if (i >= 0) list[i] = out; else list.push(out);
    save(K.g, list);
    DB.logActivity('group.save', `${i >= 0 ? 'Mengubah' : 'Membuat'} grup belajar "${name}"`, out.id);
    return out;
  }
  function deleteGroup(id, actor) {
    if (!actor || actor.role !== 'admin') throw new Error('Grup hanya dapat dikelola admin.');
    const g = get(id);
    save(K.a, load(K.a).filter(a => a.groupId !== id));
    save(K.p, load(K.p).filter(p => p.groupId !== id));
    save(K.g, all().filter(x => x.id !== id));
    if (g) DB.logActivity('group.delete', `Menghapus grup belajar "${g.name}"`, id);
  }
  function addPost(rec) {
    const list = load(K.p);
    const out = Object.assign({ id: uid('gp'), text: '', title: '', content: '', threadId: null, quiz: null, pinned: false, deleted: false, createdAt: Date.now() }, rec);
    list.push(out);
    save(K.p, list);
    return out;
  }
  function patchPost(id, patch) {
    const list = load(K.p);
    const i = list.findIndex(p => p.id === id);
    if (i < 0) return null;
    list[i] = Object.assign({}, list[i], patch, { editedAt: Date.now() });
    save(K.p, list);
    return list[i];
  }
  function removePost(id, user) {
    patchPost(id, { deleted: true, text: '', title: '', content: '', quiz: null, deletedBy: user.id, deletedAt: Date.now() });
  }
  function saveAnswer(rec) {
    const list = load(K.a);
    const i = list.findIndex(a => a.id === rec.id);
    if (i >= 0) list[i] = Object.assign({}, list[i], rec); else list.push(rec);
    save(K.a, list);
  }
  const resetAnswer = (id) => save(K.a, load(K.a).filter(a => a.id !== id));

  /* ---- belum dibaca (per perangkat) ---- */
  const readMap = () => { try { return JSON.parse(localStorage.getItem(READ_KEY) || '{}') || {}; } catch (e) { return {}; } };
  function markRead(groupId) {
    const m = readMap();
    m[groupId] = Date.now();
    try { localStorage.setItem(READ_KEY, JSON.stringify(m)); } catch (e) { /* penyimpanan penuh: abaikan */ }
  }
  function unreadCount(g, user) {
    const since = readMap()[g.id] || 0;
    return load(K.p).filter(p => p.groupId === g.id && !p.deleted && p.authorId !== user.id && (p.createdAt || 0) > since).length;
  }
  function unreadTotal(user) { return forUser(user).reduce((n, g) => n + (g.archived ? 0 : unreadCount(g, user)), 0); }

  /* ============================ bantu tampilan ============================ */
  const userName = (id) => { const u = DB.getUser(id); return u ? u.name : 'Akun dihapus'; };
  const roleTag = (g, uid2) => {
    const u = DB.getUser(uid2);
    if (u && u.role === 'admin') return '<span class="gr-tag">Admin</span>';
    if (g && (g.tutorIds || []).includes(uid2)) return '<span class="gr-tag">Tutor</span>';
    return '';
  };
  const avatar = (id, size) => {
    const u = DB.getUser(id);
    return global.Birthday && u ? Birthday.avatarHtml(u, size || 32) : `<span class="gr-av" style="--s:${size || 32}px">${esc(UI.initials(u ? u.name : '?'))}</span>`;
  };
  const groupMark = (g, size) => `<span class="gr-mark" style="--c:${esc(g.color || COLORS[0])};--s:${size || 40}px" aria-hidden="true">${esc(UI.initials(g.name))}</span>`;
  // Waktu mengikuti zona waktu aplikasi (WIB/WITA/WIT di topbar), bukan zona peramban.
  const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const pad2 = (n) => String(n).padStart(2, '0');
  const tzDate = (ts) => UI.toTzDate(ts);
  const dayKey = (d) => d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  const timeOf = (ts) => { const d = tzDate(ts); return pad2(d.getHours()) + '.' + pad2(d.getMinutes()); };
  function dayLabel(ts) {
    const d = tzDate(ts), t = UI.nowInTz();
    const y = new Date(t); y.setDate(t.getDate() - 1);
    if (dayKey(d) === dayKey(t)) return 'Hari ini';
    if (dayKey(d) === dayKey(y)) return 'Kemarin';
    return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === t.getFullYear() ? '' : ' ' + d.getFullYear()}`;
  }
  const textHtml = (t) => (global.Shared && Shared.chatTextHtml ? Shared.chatTextHtml(t) : esc(t));
  function previewOf(p) {
    if (!p) return 'Belum ada pesan';
    if (p.deleted) return 'Pesan dihapus';
    const who = userName(p.authorId).split(' ')[0];
    if (p.kind === 'message') return `${who}: ${p.text}`;
    return `${KINDS[p.kind].label}: ${p.title}`;
  }
  function dueText(q) {
    if (!q || !q.dueAt) return 'Tanpa batas waktu';
    return (Date.now() > q.dueAt ? 'Ditutup ' : 'Batas ') + UI.fmtDateTime(q.dueAt);
  }
  const quizClosed = (p) => !!(p.quiz && p.quiz.dueAt && Date.now() > p.quiz.dueAt);
  const keyVisible = (p, ans) => !!(ans && ans.submittedAt) && (!p.quiz || p.quiz.showKey !== 'after-due' || quizClosed(p));

  /* ============================ halaman ============================ */
  const st = { groupId: null, q: '' };
  let liveHandler = null;

  function render(container, user) {
    const list = forUser(user).sort((a, b) => (a.archived - b.archived) || lastAt(b) - lastAt(a));
    if (st.groupId && !list.some(g => g.id === st.groupId)) st.groupId = null;
    // Dibuka dari notifikasi: tampilkan grup dengan pesan belum dibaca terbaru (layar lebar).
    if (!st.groupId && list.length && global.matchMedia && matchMedia('(min-width: 861px)').matches) {
      const unread = list.filter(g => unreadCount(g, user));
      st.groupId = (unread[0] || list[0]).id;
    }
    container.innerHTML = `<div class="gr ${st.groupId ? 'show-group' : ''}" id="grRoot">
      <aside class="gr-side" aria-label="Daftar grup">
        <div class="gr-side-head"><div><h2>Grup Belajar</h2><p>${list.length} grup</p></div>
          ${user.role === 'admin' ? `<button type="button" class="btn btn-primary btn-sm" id="grNew">${ICON.plus} Grup baru</button>` : ''}</div>
        <label class="gr-search">${ICON.search}<span class="sr-only">Cari grup</span><input type="search" id="grQ" placeholder="Cari grup…" value="${esc(st.q)}" autocomplete="off" /></label>
        <div class="gr-list" id="grList" role="list"></div>
      </aside>
      <section class="gr-main" id="grMain" aria-live="off"></section>
    </div>`;
    const root = container.querySelector('#grRoot');
    paintList(root, user);
    paintMain(root, user);
    const nb = container.querySelector('#grNew');
    if (nb) nb.addEventListener('click', () => openGroupForm(user, null, (g) => { st.groupId = g.id; render(container, user); }));
    let t = null;
    container.querySelector('#grQ').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); paintList(root, user); }, 150); });

    // Pembaruan dari perangkat lain: perbarui daftar & percakapan tanpa menghapus isian.
    if (liveHandler) global.removeEventListener('lms:remote-change', liveHandler);
    liveHandler = (e) => {
      if (!root.isConnected) { global.removeEventListener('lms:remote-change', liveHandler); liveHandler = null; return; }
      const keys = (e.detail && e.detail.keys) || [];
      if (!keys.some(k => k === K.g || k === K.p || k === K.a || k === 'lms_users')) return;
      if (st.groupId && !forUser(user).some(g => g.id === st.groupId)) { st.groupId = null; render(container, user); return; }
      paintList(root, user);
      refreshFeed(root, user);
      if (openThread) openThread.repaint();
    };
    global.addEventListener('lms:remote-change', liveHandler);
  }
  function lastAt(g) { const ps = posts(g.id); return ps.length ? ps[ps.length - 1].createdAt : (g.createdAt || 0); }

  function paintList(root, user) {
    const box = root.querySelector('#grList');
    const list = forUser(user).filter(g => DataSearch.matches(DataSearch.norm(g.name + ' ' + (g.description || '')), st.q))
      .sort((a, b) => (a.archived - b.archived) || lastAt(b) - lastAt(a));
    if (!list.length) {
      box.innerHTML = `<div class="gr-empty-list">${forUser(user).length ? 'Tidak ada grup yang cocok.' : (user.role === 'admin' ? 'Belum ada grup. Buat grup lalu pilih anggotanya.' : 'Kamu belum dimasukkan ke grup belajar mana pun.')}</div>`;
      return;
    }
    box.innerHTML = list.map(g => {
      const ps = posts(g.id);
      const last = ps[ps.length - 1];
      const n = g.archived ? 0 : unreadCount(g, user);
      return `<button type="button" role="listitem" class="gr-item ${st.groupId === g.id ? 'is-active' : ''} ${g.archived ? 'is-archived' : ''}" data-gid="${esc(g.id)}" aria-current="${st.groupId === g.id}">
        ${groupMark(g, 40)}
        <span class="gr-item-body"><span class="gr-item-top"><strong>${esc(g.name)}</strong><time>${last ? esc(timeOrDate(last.createdAt)) : ''}</time></span>
          <span class="gr-item-sub"><span>${g.archived ? 'Diarsipkan' : esc(previewOf(last).slice(0, 80))}</span>${n ? `<span class="gr-badge" aria-label="${n} belum dibaca">${n > 99 ? '99+' : n}</span>` : ''}</span></span>
      </button>`;
    }).join('');
    box.querySelectorAll('[data-gid]').forEach(b => b.addEventListener('click', () => {
      st.groupId = b.dataset.gid;
      root.classList.add('show-group');
      paintList(root, user);
      paintMain(root, user);
    }));
  }
  function timeOrDate(ts) {
    const d = tzDate(ts);
    return dayKey(d) === dayKey(UI.nowInTz()) ? timeOf(ts) : `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
  }

  /* ============================ percakapan ============================ */
  function paintMain(root, user) {
    const main = root.querySelector('#grMain');
    const g = st.groupId ? get(st.groupId) : null;
    if (!g) {
      main.innerHTML = `<div class="gr-placeholder">${ICON.group}<strong>Pilih grup</strong><span>Obrolan, kuis, bahan diskusi, dan materi grup tampil di sini.</span></div>`;
      return;
    }
    const role = roleIn(g, user);
    const staff = role === 'staff';
    main.innerHTML = `
      <header class="gr-head">
        <button type="button" class="gr-back" id="grBack" aria-label="Kembali ke daftar grup">${ICON.back}</button>
        ${groupMark(g, 38)}
        <div class="gr-head-txt"><strong>${esc(g.name)}</strong>
          <span>${(g.memberIds || []).length} anggota · ${(g.tutorIds || []).length} tutor${g.archived ? ' · diarsipkan' : ''}</span></div>
        <div class="gr-head-actions">
          <button type="button" class="btn btn-sm btn-secondary" id="grMembers">Anggota</button>
          ${user.role === 'admin' ? '<button type="button" class="btn btn-sm btn-secondary" id="grEdit">Atur grup</button>' : ''}
        </div>
      </header>
      <div class="gr-pins" id="grPins"></div>
      <div class="gr-feed" id="grFeed" role="log" aria-label="Percakapan grup"></div>
      ${g.archived ? '<div class="gr-closed">Grup ini diarsipkan. Riwayat tetap bisa dibaca, tetapi tidak bisa mengirim pesan baru.</div>' : `
      <form class="gr-composer" id="grForm" autocomplete="off">
        ${staff ? `<div class="gr-add-wrap"><button type="button" class="gr-add" id="grAdd" aria-haspopup="menu" aria-expanded="false" aria-label="Kirim kuis, diskusi, materi, atau pengumuman">${ICON.plus}</button>
          <div class="gr-menu" id="grMenu" role="menu" hidden>
            ${['quiz', 'discussion', 'material', 'announcement'].map(k => `<button type="button" role="menuitem" data-make="${k}">${ICON[k]}<span><strong>${KINDS[k].label}</strong><small>${{ quiz: 'Soal dari Bank Soal, dinilai otomatis', discussion: 'Topik dengan utas balasan', material: 'Bacaan dengan editor lengkap', announcement: 'Info penting untuk anggota' }[k]}</small></span></button>`).join('')}
          </div></div>` : ''}
        <label class="sr-only" for="grText">Tulis pesan</label>
        <textarea id="grText" rows="1" maxlength="${MAX_TEXT}" placeholder="Tulis pesan…" title="Enter untuk mengirim, Shift+Enter untuk baris baru" aria-describedby="grHint"></textarea>
        <span class="sr-only" id="grHint">Enter untuk mengirim, Shift+Enter untuk baris baru.</span>
        <button type="submit" class="gr-send" aria-label="Kirim">${ICON.send}</button>
      </form>`}`;
    main.querySelector('#grBack').addEventListener('click', () => { st.groupId = null; root.classList.remove('show-group'); paintList(root, user); paintMain(root, user); });
    main.querySelector('#grMembers').addEventListener('click', () => openMembers(g, user));
    const eb = main.querySelector('#grEdit');
    if (eb) eb.addEventListener('click', () => openGroupForm(user, g, () => render(root.parentElement, user)));
    refreshFeed(root, user, true);

    const form = main.querySelector('#grForm');
    if (!form) return;
    const ta = form.querySelector('#grText');
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      addPost({ groupId: g.id, authorId: user.id, kind: 'message', text: text.slice(0, MAX_TEXT) });
      ta.value = ''; grow();
      markRead(g.id);
      paintList(root, user);
      refreshFeed(root, user, true);
    });
    const add = form.querySelector('#grAdd'), menu = form.querySelector('#grMenu');
    if (add) {
      const close = () => { menu.hidden = true; add.setAttribute('aria-expanded', 'false'); };
      add.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; add.setAttribute('aria-expanded', String(!menu.hidden)); });
      document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) close(); });
      menu.querySelectorAll('[data-make]').forEach(b => b.addEventListener('click', () => {
        close();
        const done = () => { markRead(g.id); paintList(root, user); refreshFeed(root, user, true); };
        if (b.dataset.make === 'quiz') openQuizForm(g, user, done);
        else openPostForm(g, user, b.dataset.make, null, done);
      }));
    }
  }

  /** Gambar ulang isi percakapan; tetap di bawah bila sebelumnya di bawah. */
  function refreshFeed(root, user, toBottom) {
    const feed = root.querySelector('#grFeed');
    const g = st.groupId ? get(st.groupId) : null;
    if (!feed || !g) return;
    const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    const prevTop = feed.scrollTop;
    const all2 = posts(g.id);
    const top = all2.filter(p => !p.threadId);
    const replies = {};
    all2.filter(p => p.threadId && !p.deleted).forEach(p => { replies[p.threadId] = (replies[p.threadId] || 0) + 1; });
    const staff = roleIn(g, user) === 'staff';
    let lastDay = '';
    feed.innerHTML = top.length ? top.map(p => {
      const day = dayLabel(p.createdAt);
      const sep = day !== lastDay ? `<div class="gr-day"><span>${esc(day)}</span></div>` : '';
      lastDay = day;
      return sep + postHtml(p, g, user, staff, replies[p.id] || 0);
    }).join('') : `<div class="gr-feed-empty"><strong>Belum ada percakapan</strong><span>${staff ? 'Sapa anggota, atau kirim kuis dan bahan diskusi lewat tombol +.' : 'Mulai percakapan dengan teman satu grup.'}</span></div>`;
    paintPins(root, g, top);
    bindFeed(root, feed, g, user);
    if (toBottom || nearBottom) feed.scrollTop = feed.scrollHeight; else feed.scrollTop = prevTop;
    markRead(g.id);
  }
  function paintPins(root, g, top) {
    const box = root.querySelector('#grPins');
    const pins = top.filter(p => p.pinned && !p.deleted).slice(-5).reverse();
    box.hidden = !pins.length;
    box.innerHTML = pins.length ? `<span class="gr-pins-lbl">${ICON.pin} Disematkan</span>` + pins.map(p => `<button type="button" class="gr-pin" data-jump="${esc(p.id)}">
      ${p.kind === 'message' ? esc(p.text.slice(0, 60)) : `<strong>${esc(KINDS[p.kind].label)}</strong> ${esc(p.title.slice(0, 60))}`}</button>`).join('') : '';
    box.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => {
      const el = root.querySelector(`[data-post="${CSS.escape(b.dataset.jump)}"]`);
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      el.classList.add('is-flash');
      setTimeout(() => el.classList.remove('is-flash'), 1400);
    }));
  }

  function postActions(p, g, user, staff) {
    if (p.deleted) return '';
    const mine = p.authorId === user.id;
    const items = [];
    if (mine && p.kind === 'message') items.push(['edit', 'Sunting']);
    if (mine && p.kind !== 'message') items.push(['editpost', 'Sunting']);
    if (staff) items.push(['pin', p.pinned ? 'Lepas sematan' : 'Sematkan']);
    if (mine || staff) items.push(['del', 'Hapus']);
    if (!items.length) return '';
    return `<details class="gr-more"><summary aria-label="Aksi pesan">${ICON.dots}</summary>
      <div class="gr-more-menu">${items.map(([a, l]) => `<button type="button" data-act="${a}" data-id="${esc(p.id)}">${l}</button>`).join('')}</div></details>`;
  }
  function postHtml(p, g, user, staff, nReplies) {
    const mine = p.authorId === user.id;
    const head = `<span class="gr-who">${esc(userName(p.authorId))}</span>${roleTag(g, p.authorId)}<time datetime="${new Date(p.createdAt).toISOString()}">${esc(timeOf(p.createdAt))}</time>${p.editedAt && !p.deleted ? '<span class="gr-edited">disunting</span>' : ''}`;
    if (p.kind === 'message') {
      return `<div class="gr-msg ${mine ? 'is-mine' : ''} ${p.pinned ? 'is-pinned' : ''}" data-post="${esc(p.id)}">
        ${mine ? '' : avatar(p.authorId, 32)}
        <div class="gr-bubble">
          <div class="gr-meta">${head}${p.pinned ? `<span class="gr-pinned">${ICON.pin}</span>` : ''}${postActions(p, g, user, staff)}</div>
          <div class="gr-text chat-text">${p.deleted ? '<em class="gr-gone">Pesan dihapus</em>' : textHtml(p.text)}</div>
        </div></div>`;
    }
    if (p.deleted) return `<div class="gr-card is-gone" data-post="${esc(p.id)}"><em class="gr-gone">${esc(KINDS[p.kind].label)} dihapus</em></div>`;
    let body = '', foot = '';
    if (p.kind === 'announcement') body = `<div class="gr-card-body rt-content">${RichText.render(p.content || '')}</div>`;
    if (p.kind === 'material') {
      body = `<div class="gr-card-body rt-content is-clamp">${RichText.render(p.content || '')}</div>`;
      foot = `<button type="button" class="btn btn-sm btn-secondary" data-act="open" data-id="${esc(p.id)}">Buka materi</button>`;
    }
    if (p.kind === 'discussion') {
      body = `<div class="gr-card-body rt-content is-clamp">${RichText.render(p.content || '')}</div>`;
      foot = `<button type="button" class="btn btn-sm btn-primary" data-act="thread" data-id="${esc(p.id)}">${nReplies ? `Lihat ${nReplies} balasan` : 'Mulai diskusi'}</button>`;
    }
    if (p.kind === 'quiz') {
      const q = p.quiz || { questions: [] };
      const meta = `<p class="gr-quiz-meta">${q.questions.length} soal · ${esc(dueText(q))}</p>${p.text ? `<p class="gr-quiz-note">${textHtml(p.text)}</p>` : ''}`;
      if (staff) {
        const done = answersOf(p.id).filter(a => a.submittedAt).length;
        body = meta + `<p class="gr-quiz-stat">${done} dari ${(g.memberIds || []).length} anggota sudah mengirim</p>`;
        foot = `<button type="button" class="btn btn-sm btn-primary" data-act="results" data-id="${esc(p.id)}">Lihat hasil</button>
          <button type="button" class="btn btn-sm btn-secondary" data-act="take" data-id="${esc(p.id)}">Pratinjau soal</button>`;
      } else {
        const a = answer(p.id, user.id);
        const closed = quizClosed(p);
        const status = a && a.submittedAt ? `<span class="gr-status is-done">Terkirim · ${a.score ? `${a.score.correct}/${a.score.total} benar` : ''}</span>`
          : (closed ? '<span class="gr-status is-closed">Waktu habis</span>' : `<span class="gr-status">${a ? 'Sedang dikerjakan' : 'Belum dikerjakan'}</span>`);
        body = meta + status;
        foot = a && a.submittedAt ? `<button type="button" class="btn btn-sm btn-secondary" data-act="take" data-id="${esc(p.id)}">Lihat jawaban</button>`
          : (closed ? '' : `<button type="button" class="btn btn-sm btn-primary" data-act="take" data-id="${esc(p.id)}">${a ? 'Lanjutkan' : 'Kerjakan'}</button>`);
      }
    }
    return `<article class="gr-card is-${p.kind} ${p.pinned ? 'is-pinned' : ''}" data-post="${esc(p.id)}">
      <div class="gr-card-head"><span class="gr-kind">${ICON[p.kind]}${esc(KINDS[p.kind].label)}</span>${p.pinned ? `<span class="gr-pinned">${ICON.pin} Disematkan</span>` : ''}${postActions(p, g, user, staff)}</div>
      <h3 class="gr-card-title">${esc(p.title)}</h3>
      <div class="gr-meta">${avatar(p.authorId, 22)}${head}</div>
      ${body}
      ${foot ? `<div class="gr-card-foot">${foot}</div>` : ''}
    </article>`;
  }

  function bindFeed(root, feed, g, user) {
    const again = () => { paintList(root, user); refreshFeed(root, user); };
    feed.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      const p = post(b.dataset.id);
      if (!p) return;
      const det = b.closest('details'); if (det) det.open = false;
      switch (b.dataset.act) {
        case 'edit': openEditMessage(p, again); break;
        case 'editpost': if (p.kind === 'quiz') openQuizForm(g, user, again, p); else openPostForm(g, user, p.kind, p, again); break;
        case 'pin': patchPost(p.id, { pinned: !p.pinned }); again(); break;
        case 'del':
          if (!UI.confirmDialog(p.kind === 'quiz' ? 'Hapus kuis ini? Jawaban anggota tidak ditampilkan lagi.' : 'Hapus kiriman ini untuk semua anggota?')) return;
          removePost(p.id, user); again(); break;
        case 'open': openMaterial(p); break;
        case 'thread': openThreadView(g, p, user, again); break;
        case 'take': openQuiz(g, p, user, again); break;
        case 'results': openResults(g, p, user, again); break;
        default: break;
      }
    }));
  }

  function openEditMessage(p, done) {
    UI.modal.open('Sunting pesan', `<form class="form" id="grEditForm"><div class="form-group"><label for="grEditText">Pesan</label>
      <textarea id="grEditText" rows="5" maxlength="${MAX_TEXT}">${esc(p.text)}</textarea></div>
      <div class="flex-gap"><button type="button" class="btn btn-secondary" data-cancel>Batal</button><button type="submit" class="btn btn-primary">Simpan</button></div></form>`);
    const f = document.getElementById('grEditForm');
    f.querySelector('[data-cancel]').addEventListener('click', () => UI.modal.close());
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = f.querySelector('#grEditText').value.trim();
      if (!text) { UI.toast('Pesan tidak boleh kosong.', 'error'); return; }
      patchPost(p.id, { text: text.slice(0, MAX_TEXT) });
      UI.modal.close();
      done();
    });
  }
  function openMaterial(p) {
    UI.modal.open(p.title, `<div class="gr-material"><div class="rt-content">${RichText.render(p.content || '')}</div>
      <p class="muted small">Dikirim ${esc(userName(p.authorId))} · ${esc(UI.fmtDateTime(p.createdAt))}</p></div>`, { fullscreenToggle: true, fullKey: 'grp-material', autofocus: false });
  }

  /* ============================ diskusi (utas) ============================ */
  let openThread = null;
  function openThreadView(g, p, user, onChange) {
    const archived = !!g.archived;
    UI.modal.open('Diskusi: ' + p.title, `<div class="gr-thread">
      <div class="gr-thread-topic rt-content">${RichText.render(p.content || '')}</div>
      <div class="gr-thread-list" id="grThreadList" role="log"></div>
      ${archived ? '<div class="gr-closed">Grup diarsipkan.</div>' : `<form class="gr-composer is-thread" id="grThreadForm" autocomplete="off">
        <label class="sr-only" for="grReply">Tulis balasan</label>
        <textarea id="grReply" rows="2" maxlength="${MAX_TEXT}" placeholder="Tulis pendapat atau jawabanmu…"></textarea>
        <button type="submit" class="gr-send" aria-label="Kirim balasan">${ICON.send}</button></form>`}
    </div>`, { fullscreenToggle: true, fullKey: 'grp-thread' });
    const list = document.getElementById('grThreadList');
    const staff = roleIn(g, user) === 'staff';
    const repaint = () => {
      if (!list.isConnected) { openThread = null; return; }
      const rs = posts(g.id).filter(x => x.threadId === p.id);
      list.innerHTML = rs.length ? rs.map(r => postHtml(r, g, user, staff, 0)).join('') : '<p class="muted small">Belum ada balasan. Jadilah yang pertama.</p>';
      list.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
        const r = post(b.dataset.id);
        if (!r) return;
        if (b.dataset.act === 'del') { if (!UI.confirmDialog('Hapus balasan ini?')) return; removePost(r.id, user); }
        else if (b.dataset.act === 'pin') patchPost(r.id, { pinned: !r.pinned });
        else if (b.dataset.act === 'edit') {
          const text = global.prompt('Sunting balasan', r.text);
          if (text == null || !text.trim()) return;
          patchPost(r.id, { text: text.trim().slice(0, MAX_TEXT) });
        }
        repaint(); onChange();
      }));
      list.scrollTop = list.scrollHeight;
    };
    openThread = { repaint };
    repaint();
    const f = document.getElementById('grThreadForm');
    if (f) {
      const ta = f.querySelector('#grReply');
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); f.requestSubmit(); } });
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = ta.value.trim();
        if (!text) return;
        addPost({ groupId: g.id, authorId: user.id, kind: 'message', text: text.slice(0, MAX_TEXT), threadId: p.id });
        ta.value = '';
        repaint(); onChange();
      });
    }
  }

  /* ============================ kirim materi / diskusi / pengumuman ============================ */
  function recipients(g, user) { return (g.memberIds || []).concat(g.tutorIds || []).filter(id => id !== user.id); }
  function notifyGroup(g, user, kind, title) {
    DB.notifyUsers(recipients(g, user), { icon: kind === 'quiz' ? '📝' : kind === 'announcement' ? '📢' : '📚', title: `${g.name}: ${KINDS[kind].label.toLowerCase()} baru`, body: title, link: 'grup' });
  }
  function openPostForm(g, user, kind, editing, done) {
    const e = editing || {};
    UI.modal.open((editing ? 'Sunting ' : 'Kirim ') + KINDS[kind].label.toLowerCase(), `<form class="form" id="grPostForm" novalidate>
      <div class="form-group"><label for="gpTitle">Judul</label><input id="gpTitle" maxlength="160" required value="${esc(e.title || '')}"
        placeholder="${{ discussion: 'mis. Bagaimana cara cepat menjawab soal deret?', material: 'mis. Ringkasan Logika Proposisi', announcement: 'mis. Tryout pekan depan pindah ke Sabtu' }[kind]}" /></div>
      <div class="form-group"><label>${kind === 'discussion' ? 'Bahan diskusi' : kind === 'material' ? 'Isi materi' : 'Isi pengumuman'}</label>
        ${Editor.toolbarHtml('gpBody', { word: kind === 'material', noAudio: kind === 'announcement' })}
        <div id="gpBody" class="qe-editor ${kind === 'material' ? 'ce-editor-tall' : ''}" contenteditable="true" data-ph="${kind === 'discussion' ? 'Tulis pertanyaan pemantik, kasus, atau soal yang ingin dibahas.' : 'Tulis isinya di sini.'}">${e.content || ''}</div></div>
      ${editing ? '' : `<label class="gr-check"><input type="checkbox" id="gpNotify" checked /> Kirim notifikasi ke anggota</label>`}
      <label class="gr-check"><input type="checkbox" id="gpPin" ${e.pinned || (!editing && kind === 'announcement') ? 'checked' : ''} /> Sematkan di atas percakapan</label>
      <div class="flex-gap"><button type="button" class="btn btn-secondary" data-cancel>Batal</button><button type="submit" class="btn btn-primary">${editing ? 'Simpan' : 'Kirim ke grup'}</button></div>
    </form>`, { fullscreenToggle: true, fullKey: 'grp-post' });
    const f = document.getElementById('grPostForm');
    Editor.attach(f);
    f.querySelector('[data-cancel]').addEventListener('click', () => UI.modal.close());
    f.addEventListener('submit', (x) => {
      x.preventDefault();
      const title = clean(f.querySelector('#gpTitle').value, 160);
      const content = RichText.sanitize(f.querySelector('#gpBody').innerHTML);
      if (title.length < 2) { UI.toast('Judul minimal 2 karakter.', 'error'); return; }
      if (!RichText.plain(content, 200).trim() && !/<img|<table/i.test(content)) { UI.toast('Isi masih kosong.', 'error'); return; }
      if (content.length > 1500000) { UI.toast('Isi terlalu besar. Perkecil atau kurangi gambar.', 'error'); return; }
      const pinned = f.querySelector('#gpPin').checked;
      if (editing) patchPost(editing.id, { title, content, pinned });
      else {
        addPost({ groupId: g.id, authorId: user.id, kind, title, content, pinned });
        if (f.querySelector('#gpNotify').checked) notifyGroup(g, user, kind, title);
      }
      UI.modal.close();
      UI.toast(editing ? 'Perubahan disimpan.' : `${KINDS[kind].label} dikirim ke grup.`, 'success');
      done();
    });
  }

  /* ============================ kuis ============================ */
  const META_FIELDS = ['authorId', 'createdBy', 'createdAt', 'updatedAt', 'updatedBy', 'stats', 'usage', 'active', 'ownerChangedAt', 'ownerChangedFrom'];
  function snapshot(q) {
    const c = JSON.parse(JSON.stringify(q));
    META_FIELDS.forEach(f => delete c[f]);
    return c;
  }
  function openQuizForm(g, user, done, editing) {
    const e = editing || {};
    const chosen = new Map(((e.quiz && e.quiz.questions) || []).map(q => [q.id, q]));
    const f0 = { subtest: '', topicId: '', subtopicId: '', q: '' };
    const usable = () => DB.getQuestions().filter(q => q.active !== false && (q.questionType || 'Pilihan Ganda') !== 'Esai');
    UI.modal.open(editing ? 'Sunting kuis' : 'Kirim kuis ke grup', `<form class="form" id="grQuizForm" novalidate>
      <div class="form-row">
        <div class="form-group"><label for="gqTitle">Judul kuis</label><input id="gqTitle" maxlength="160" value="${esc(e.title || '')}" placeholder="mis. Latihan PK: Barisan & Deret" /></div>
        <div class="form-group"><label for="gqDue">Batas waktu <span class="muted">(opsional)</span></label><input type="datetime-local" id="gqDue" value="${e.quiz && e.quiz.dueAt ? esc(UI.utcToTzInput(e.quiz.dueAt)) : ''}" /></div>
      </div>
      <div class="form-group"><label for="gqNote">Petunjuk <span class="muted">(opsional)</span></label><textarea id="gqNote" rows="2" maxlength="600">${esc(e.text || '')}</textarea></div>
      <fieldset class="gr-fs"><legend>Kunci jawaban &amp; pembahasan</legend>
        <label class="gr-check"><input type="radio" name="gqKey" value="after-submit" ${!e.quiz || e.quiz.showKey !== 'after-due' ? 'checked' : ''} /> Tampil setelah anggota mengirim jawaban</label>
        <label class="gr-check"><input type="radio" name="gqKey" value="after-due" ${e.quiz && e.quiz.showKey === 'after-due' ? 'checked' : ''} /> Tampil setelah batas waktu berakhir</label>
      </fieldset>
      <fieldset class="gr-fs"><legend>Pilih soal dari Bank Soal <span class="gr-count" id="gqCount"></span></legend>
        <div class="gr-qfilter">
          <select id="gqSubtest" aria-label="Subtest"><option value="">Semua subtest</option>${DB.SUBTEST_NAMES.map(n => `<option>${esc(n)}</option>`).join('')}</select>
          <span id="gqTopicBox"></span>
          <input type="search" id="gqSearch" placeholder="Cari isi soal…" aria-label="Cari soal" />
        </div>
        <div class="gr-qlist" id="gqList"></div>
        <p class="muted small">Soal esai tidak tersedia di kuis grup karena harus dinilai manual. Soal disalin ke kuis: perubahan Bank Soal sesudahnya tidak memengaruhi kuis ini.</p>
      </fieldset>
      ${editing ? '' : '<label class="gr-check"><input type="checkbox" id="gqNotify" checked /> Kirim notifikasi ke anggota</label>'}
      <div class="flex-gap"><button type="button" class="btn btn-secondary" data-cancel>Batal</button><button type="submit" class="btn btn-primary">${editing ? 'Simpan kuis' : 'Kirim kuis'}</button></div>
    </form>`, { fullscreenToggle: true, fullKey: 'grp-quiz', autofocus: false });
    const f = document.getElementById('grQuizForm');
    const listBox = f.querySelector('#gqList');
    const answered = editing ? answersOf(editing.id).length : 0;
    if (answered) f.querySelector('#gqList').insertAdjacentHTML('beforebegin', `<div class="alert alert-warning small">${answered} anggota sudah mulai/mengirim. Mengubah soal dapat membuat nilai mereka tidak sesuai; atur ulang jawaban mereka di "Lihat hasil" bila perlu.</div>`);
    // Filter Materi & Sub Materi (js/topics.js) muncul setelah subtest dipilih.
    function paintTopics() {
      const box = f.querySelector('#gqTopicBox');
      if (!global.Topics || !f0.subtest) { box.innerHTML = ''; f0.topicId = ''; f0.subtopicId = ''; return; }
      box.innerHTML = Topics.filterHtml(f0.subtest, f0, 'gq');
      box.querySelector('#gqTopic').addEventListener('change', (x) => { f0.topicId = x.target.value; f0.subtopicId = ''; paintTopics(); paintQs(); });
      box.querySelector('#gqSub').addEventListener('change', (x) => { f0.subtopicId = x.target.value; paintQs(); });
    }
    function paintQs() {
      const rows = usable().filter(q => (!f0.subtest || q.subject === f0.subtest) && (!global.Topics || !f0.subtest || Topics.matches(q, f0)) &&
        DataSearch.matches(DataSearch.norm(DataSearch.plain(q.text) + ' ' + (q.subject || '')), f0.q));
      const shownRows = rows.slice(0, 200);
      listBox.innerHTML = shownRows.length ? shownRows.map(q => `<label class="gr-qitem ${chosen.has(q.id) ? 'is-on' : ''}">
          <input type="checkbox" value="${esc(q.id)}" ${chosen.has(q.id) ? 'checked' : ''} />
          <span><span class="gr-qtext">${esc(RichText.plain(q.text || '', 160) || '(tanpa teks)')}</span>
            <small>${esc(q.questionType || 'Pilihan Ganda')} · ${esc((DB.subtestByName(q.subject) || {}).short || q.subject || 'Tanpa subtest')}${global.Topics && Topics.labelOf(q) ? ' · ' + esc(Topics.labelOf(q).text) : ''}</small></span></label>`).join('')
        : '<p class="muted small">Tidak ada soal yang cocok.</p>';
      if (rows.length > shownRows.length) listBox.insertAdjacentHTML('beforeend', `<p class="muted small">Menampilkan 200 dari ${rows.length} soal. Persempit dengan filter atau pencarian.</p>`);
      listBox.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', () => {
        if (cb.checked) {
          if (chosen.size >= 40) { cb.checked = false; UI.toast('Maksimal 40 soal per kuis.', 'error'); return; }
          chosen.set(cb.value, snapshot(DB.getQuestion(cb.value)));
        } else chosen.delete(cb.value);
        cb.closest('.gr-qitem').classList.toggle('is-on', cb.checked);
        paintCount();
      }));
      paintCount();
    }
    const paintCount = () => { f.querySelector('#gqCount').textContent = `${chosen.size} dipilih`; };
    f.querySelector('#gqSubtest').addEventListener('change', (x) => { f0.subtest = x.target.value; f0.topicId = ''; f0.subtopicId = ''; paintTopics(); paintQs(); });
    let t = null;
    f.querySelector('#gqSearch').addEventListener('input', (x) => { clearTimeout(t); t = setTimeout(() => { f0.q = x.target.value.trim(); paintQs(); }, 200); });
    paintTopics(); paintQs();
    f.querySelector('[data-cancel]').addEventListener('click', () => UI.modal.close());
    f.addEventListener('submit', (x) => {
      x.preventDefault();
      const title = clean(f.querySelector('#gqTitle').value, 160);
      if (title.length < 2) { UI.toast('Judul kuis minimal 2 karakter.', 'error'); return; }
      if (!chosen.size) { UI.toast('Pilih minimal satu soal.', 'error'); return; }
      const dueIn = f.querySelector('#gqDue').value;
      const dueAt = dueIn ? UI.tzInputToUtc(dueIn) : null;
      if (dueAt && dueAt < Date.now() + 60000 && !(editing && editing.quiz && editing.quiz.dueAt === dueAt)) { UI.toast('Batas waktu harus di masa depan.', 'error'); return; }
      const quiz = { questions: [...chosen.values()], dueAt, showKey: f.querySelector('input[name=gqKey]:checked').value };
      if (JSON.stringify(quiz).length > 2500000) { UI.toast('Soal yang dipilih terlalu besar (banyak gambar). Kurangi jumlah soal.', 'error'); return; }
      const text = String(f.querySelector('#gqNote').value || '').trim().slice(0, 600);
      if (editing) patchPost(editing.id, { title, text, quiz });
      else {
        addPost({ groupId: g.id, authorId: user.id, kind: 'quiz', title, text, quiz });
        if (f.querySelector('#gqNotify').checked) notifyGroup(g, user, 'quiz', title);
      }
      UI.modal.close();
      UI.toast(editing ? 'Kuis disimpan.' : 'Kuis dikirim ke grup.', 'success');
      done();
    });
  }

  function keyHtml(q) {
    const t = q.questionType || 'Pilihan Ganda';
    const R = (v) => RichText.render(v || '');
    const L = (i) => String.fromCharCode(65 + Number(i));
    let body = '';
    if (t === 'Pilihan Ganda' || t === 'Benar/Salah') { const k = Number(q.correctIndex); body = `${L(k)}. ${R((q.options || [])[k])}`; }
    else if (t === 'Pilihan Lebih dari Satu') body = (q.correctIndices || []).map(i => `${L(i)}. ${R((q.options || [])[Number(i)])}`).join('<br>');
    else if (t === 'Isian Singkat') body = (q.answers || []).filter(a => String(a).trim()).map(a => esc(a)).join(' / ');
    else if (t === 'Benar/Salah Majemuk') body = (q.statements || []).map(s => `${s.value ? 'Benar' : 'Salah'} — ${R(s.text)}`).join('<br>');
    else if (t === 'Majemuk Kompleks') { const cols = DB.qMatrixColumns(q), keys = DB.qMatrixKeys(q); body = (q.statements || []).map((s, i) => `<strong>${esc(keys[i] == null ? '—' : cols[keys[i]])}</strong> — ${R(s.text)}`).join('<br>'); }
    else if (t === 'Menjodohkan') body = (q.pairs || []).map(p => `${R(p.left)} → ${R(p.right)}`).join('<br>');
    else if (t === 'Urutan') body = `<ol>${(q.orderItems || []).map(it => `<li>${R(it)}</li>`).join('')}</ol>`;
    const exp = (q.explanation && RichText.plain(q.explanation) ? `<div class="mt-1"><strong>Pembahasan:</strong> <span class="rt-content">${R(q.explanation)}</span></div>` : '') + (global.YTPlayer ? YTPlayer.expVideo(q) : '');
    return body || exp ? `<div class="gr-key">${body ? `<strong>Kunci:</strong><div class="rt-content">${body}</div>` : ''}${exp}</div>` : '';
  }

  function openQuiz(g, p, user, done) {
    const qs = (p.quiz && p.quiz.questions) || [];
    const staff = roleIn(g, user) === 'staff';
    const prev = staff ? null : answer(p.id, user.id);
    const submitted = !!(prev && prev.submittedAt);
    const answers = Object.assign({}, prev ? prev.answers : {});
    const showKey = staff || keyVisible(p, prev);
    const readOnly = staff || submitted || quizClosed(p);
    const QUI = global.QuestionUI;
    const grade = (q) => global.Exam ? Exam.gradeQuestion(q, answers[q.id]) : { auto: false, correct: false };
    UI.modal.open(p.title, `<form class="gr-quiz" id="grQuiz" novalidate>
      <div class="gr-quiz-top">${staff ? '<span class="gr-status">Pratinjau tutor: jawaban tidak disimpan</span>' : submitted
        ? `<span class="gr-status is-done">Terkirim ${esc(UI.fmtDateTime(prev.submittedAt))} · ${prev.score.correct}/${prev.score.total} benar</span>`
        : `<span class="gr-status">${esc(dueText(p.quiz))}</span>`}
        ${p.text ? `<p class="gr-quiz-note">${textHtml(p.text)}</p>` : ''}
        ${submitted && !showKey ? '<p class="muted small">Kunci jawaban dan pembahasan tampil setelah batas waktu berakhir.</p>' : ''}</div>
      ${qs.map((q, i) => {
        const res = submitted && showKey ? grade(q) : null;
        return `<div class="gr-q ${res ? (res.correct ? 'is-right' : 'is-wrong') : ''}" data-qid="${esc(q.id)}">
          <div class="gr-q-head"><span class="gr-q-n">${i + 1}</span><span class="muted small">${esc(q.questionType || 'Pilihan Ganda')}</span>${res ? `<span class="gr-q-res">${res.correct ? 'Benar' : 'Salah'}</span>` : ''}</div>
          <div class="rt-content gr-q-text">${RichText.render(q.text || '')}</div>
          <div class="asg-q-answer">${QUI ? QUI.answerInputHtml(q, answers[q.id]) : '<p class="muted small">Komponen jawaban belum termuat.</p>'}</div>
          ${showKey && (submitted || staff) ? keyHtml(q) : ''}
        </div>`;
      }).join('')}
      <div class="flex-gap gr-quiz-foot">${readOnly ? '<button type="button" class="btn btn-secondary" data-cancel>Tutup</button>'
        : '<span class="muted small" id="grQuizSaved">Jawaban tersimpan otomatis.</span><button type="button" class="btn btn-secondary" data-cancel>Tutup</button><button type="submit" class="btn btn-primary">Kirim jawaban</button>'}</div>
    </form>`, { fullscreenToggle: true, fullKey: 'grp-quiz-take', autofocus: false });
    const f = document.getElementById('grQuiz');
    if (readOnly) f.querySelectorAll('.asg-q-answer input, .asg-q-answer select, .asg-q-answer textarea, .asg-q-answer button').forEach(el => { el.disabled = true; });
    f.querySelector('[data-cancel]').addEventListener('click', () => UI.modal.close());
    if (readOnly || !QUI) return;
    let timer = null;
    const draft = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (quizClosed(p)) return;
        saveAnswer({ id: p.id + ':' + user.id, postId: p.id, groupId: g.id, userId: user.id, answers: Object.assign({}, answers), startedAt: (prev && prev.startedAt) || Date.now(), submittedAt: null });
        const s = document.getElementById('grQuizSaved');
        if (s) s.textContent = 'Tersimpan ' + timeOf(Date.now());
      }, 800);
    };
    QUI.bindAnswerInputs(f, answers, draft);
    f.addEventListener('submit', (x) => {
      x.preventDefault();
      clearTimeout(timer);
      if (quizClosed(p)) { UI.toast('Waktu kuis sudah habis.', 'error'); UI.modal.close(); done(); return; }
      const empty = qs.filter(q => !(global.Exam ? Exam.isAnswered(q, answers[q.id]) : answers[q.id] != null)).length;
      if (empty && !UI.confirmDialog(`${empty} soal belum dijawab. Kirim sekarang? Jawaban tidak dapat diubah setelah dikirim.`)) return;
      if (!empty && !UI.confirmDialog('Kirim jawaban? Jawaban tidak dapat diubah setelah dikirim.')) return;
      const correct = qs.filter(q => grade(q).correct).length;
      saveAnswer({ id: p.id + ':' + user.id, postId: p.id, groupId: g.id, userId: user.id, answers: Object.assign({}, answers),
        score: { correct, total: qs.length }, startedAt: (prev && prev.startedAt) || Date.now(), submittedAt: Date.now() });
      UI.toast(`Jawaban terkirim: ${correct}/${qs.length} benar.`, 'success');
      UI.modal.close();
      done();
      setTimeout(() => openQuiz(g, post(p.id) || p, user, done), 200);
    });
  }

  function openResults(g, p, user, done) {
    const qs = (p.quiz && p.quiz.questions) || [];
    const paint = () => {
      const ans = new Map(answersOf(p.id).map(a => [a.userId, a]));
      const members = (g.memberIds || []).map(id => DB.getUser(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'id'));
      const sent = members.filter(m => ans.get(m.id) && ans.get(m.id).submittedAt);
      const avg = sent.length ? Math.round(sent.reduce((n, m) => n + (ans.get(m.id).score.correct / Math.max(1, ans.get(m.id).score.total)), 0) / sent.length * 100) : null;
      const perQ = qs.map(q => {
        const done2 = sent.filter(m => global.Exam && Exam.gradeQuestion(q, (ans.get(m.id).answers || {})[q.id]).correct).length;
        return sent.length ? Math.round(done2 / sent.length * 100) : null;
      });
      UI.modal.open('Hasil: ' + p.title, `<div class="gr-results">
        <dl class="nwa-stats"><div><dt>Terkirim</dt><dd>${sent.length}/${members.length}</dd></div>
          <div><dt>Rata-rata benar</dt><dd>${avg == null ? '—' : avg + '%'}</dd></div><div><dt>Jumlah soal</dt><dd>${qs.length}</dd></div></dl>
        <div class="table-wrap"><table class="table"><thead><tr><th>Anggota</th><th>Status</th><th class="num">Benar</th><th>Dikirim</th><th><span class="sr-only">Aksi</span></th></tr></thead>
          <tbody>${members.map(m => { const a = ans.get(m.id);
            return `<tr><td>${esc(m.name)}<div class="muted small">${esc(m.kelas || '')}</div></td>
              <td>${a && a.submittedAt ? '<span class="badge badge-success">Terkirim</span>' : a ? '<span class="badge badge-info">Mengerjakan</span>' : '<span class="badge badge-gray">Belum</span>'}</td>
              <td class="num">${a && a.score ? `${a.score.correct}/${a.score.total}` : '—'}</td>
              <td class="muted small">${a && a.submittedAt ? esc(UI.fmtDateTime(a.submittedAt)) : '—'}</td>
              <td class="actions">${a ? `<button type="button" class="btn btn-sm btn-ghost" data-reset="${esc(a.id)}">Atur ulang</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">Grup belum punya anggota.</td></tr>'}</tbody></table></div>
        ${sent.length ? `<h4 class="gr-res-h">Persentase benar per soal</h4><ol class="gr-perq">${qs.map((q, i) => `<li><span class="gr-perq-t">${esc(RichText.plain(q.text || '', 90))}</span>
          <span class="gr-perq-bar" aria-hidden="true"><span style="width:${perQ[i] || 0}%"></span></span><strong>${perQ[i]}%</strong></li>`).join('')}</ol>` : ''}
      </div>`, { fullscreenToggle: true, fullKey: 'grp-results', autofocus: false });
      document.querySelectorAll('#modalBody [data-reset]').forEach(b => b.addEventListener('click', () => {
        if (!UI.confirmDialog('Atur ulang jawaban anggota ini? Ia dapat mengerjakan kuis lagi dari awal.')) return;
        resetAnswer(b.dataset.reset);
        paint(); done();
      }));
    };
    paint();
  }

  /* ============================ anggota & pengaturan grup ============================ */
  function openMembers(g, user) {
    const people = (ids) => ids.map(id => DB.getUser(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'id'));
    const row = (u) => `<li class="gr-person">${avatar(u.id, 34)}<span><strong>${esc(u.name)}</strong><small>${esc(u.role === 'guru' ? (u.subject || 'Tutor') : (u.kelas || 'Mentee'))}</small></span></li>`;
    UI.modal.open('Anggota ' + g.name, `<div class="gr-people">
      ${g.description ? `<p class="gr-desc">${esc(g.description)}</p>` : ''}
      <h4>Tutor (${(g.tutorIds || []).length})</h4><ul>${people(g.tutorIds || []).map(row).join('') || '<li class="muted small">Belum ada tutor.</li>'}</ul>
      <h4>Anggota (${(g.memberIds || []).length})</h4><ul>${people(g.memberIds || []).map(row).join('') || '<li class="muted small">Belum ada anggota.</li>'}</ul>
      ${user.role === 'admin' ? '<p class="muted small">Ubah anggota lewat tombol "Atur grup".</p>' : ''}</div>`, { autofocus: false });
  }

  function openGroupForm(user, g, done) {
    const e = g || {};
    const members = new Set(e.memberIds || []);
    const tutors = new Set(e.tutorIds || []);
    const siswa = DB.getUsers().filter(u => u.role === 'siswa' && (u.status || 'Aktif') !== 'Dikeluarkan').sort((a, b) => a.name.localeCompare(b.name, 'id'));
    const guru = DB.getUsers().filter(u => u.role === 'guru').sort((a, b) => a.name.localeCompare(b.name, 'id'));
    const classes = [...new Set(siswa.map(u => u.kelas).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
    const fl = { kelas: '', q: '' };
    UI.modal.open(g ? 'Atur grup' : 'Grup belajar baru', `<form class="form" id="grGroupForm" novalidate>
      <div class="form-group"><label for="ggName">Nama grup</label><input id="ggName" maxlength="80" required value="${esc(e.name || '')}" placeholder="mis. Pejuang PK Kelas 12" /></div>
      <div class="form-group"><label for="ggDesc">Deskripsi <span class="muted">(opsional)</span></label><textarea id="ggDesc" rows="2" maxlength="500">${esc(e.description || '')}</textarea></div>
      <fieldset class="gr-fs"><legend>Warna</legend><div class="gr-colors">${COLORS.map(c => `<label class="gr-color"><input type="radio" name="ggColor" value="${c}" ${(e.color || COLORS[0]) === c ? 'checked' : ''} /><span style="--c:${c}" aria-label="Warna ${c}"></span></label>`).join('')}</div></fieldset>
      <fieldset class="gr-fs"><legend>Tutor <span class="gr-count" id="ggTCount"></span></legend>
        <div class="gr-pick is-short">${guru.map(u => `<label class="gr-pick-item"><input type="checkbox" data-tutor value="${esc(u.id)}" ${tutors.has(u.id) ? 'checked' : ''} /><span>${esc(u.name)}<small>${esc(u.subject || '')}</small></span></label>`).join('') || '<p class="muted small">Belum ada akun tutor.</p>'}</div>
        <p class="muted small">Tutor grup dapat mengirim kuis, bahan diskusi, materi, dan pengumuman, serta melihat hasil kuis.</p></fieldset>
      <fieldset class="gr-fs"><legend>Anggota (mentee) <span class="gr-count" id="ggMCount"></span></legend>
        <div class="gr-qfilter"><select id="ggKelas" aria-label="Filter kelas"><option value="">Semua kelas</option>${classes.map(c => `<option>${esc(c)}</option>`).join('')}</select>
          <input type="search" id="ggQ" placeholder="Cari nama atau username…" aria-label="Cari mentee" />
          <button type="button" class="btn btn-sm btn-secondary" id="ggAll">Pilih yang tampil</button><button type="button" class="btn btn-sm btn-ghost" id="ggNone">Lepas yang tampil</button></div>
        <div class="gr-pick" id="ggMembers"></div></fieldset>
      ${g ? `<label class="gr-check"><input type="checkbox" id="ggArchived" ${e.archived ? 'checked' : ''} /> Arsipkan grup (riwayat tetap ada, tidak bisa mengirim pesan baru)</label>` : ''}
      <div class="flex-gap">${g ? '<button type="button" class="btn btn-ghost nwa-del" id="ggDelete">Hapus grup</button>' : ''}
        <button type="button" class="btn btn-secondary" data-cancel>Batal</button><button type="submit" class="btn btn-primary">${g ? 'Simpan' : 'Buat grup'}</button></div>
    </form>`, { fullscreenToggle: true, fullKey: 'grp-form' });
    const f = document.getElementById('grGroupForm');
    const box = f.querySelector('#ggMembers');
    const shown = () => siswa.filter(u => (!fl.kelas || u.kelas === fl.kelas) && (!fl.q || DataSearch.norm(u.name + ' ' + u.username).includes(DataSearch.norm(fl.q))));
    const counts = () => { f.querySelector('#ggMCount').textContent = `${members.size} dipilih`; f.querySelector('#ggTCount').textContent = `${tutors.size} dipilih`; };
    function paint() {
      const rows = shown();
      box.innerHTML = rows.length ? rows.map(u => `<label class="gr-pick-item"><input type="checkbox" data-member value="${esc(u.id)}" ${members.has(u.id) ? 'checked' : ''} />
        <span>${esc(u.name)}<small>${esc(u.kelas || '-')} · ${esc(u.username)}</small></span></label>`).join('') : '<p class="muted small">Tidak ada mentee yang cocok.</p>';
      box.querySelectorAll('[data-member]').forEach(cb => cb.addEventListener('change', () => { if (cb.checked) members.add(cb.value); else members.delete(cb.value); counts(); }));
      counts();
    }
    f.querySelectorAll('[data-tutor]').forEach(cb => cb.addEventListener('change', () => { if (cb.checked) tutors.add(cb.value); else tutors.delete(cb.value); counts(); }));
    f.querySelector('#ggKelas').addEventListener('change', (x) => { fl.kelas = x.target.value; paint(); });
    let t = null;
    f.querySelector('#ggQ').addEventListener('input', (x) => { clearTimeout(t); t = setTimeout(() => { fl.q = x.target.value.trim(); paint(); }, 150); });
    f.querySelector('#ggAll').addEventListener('click', () => { shown().forEach(u => members.add(u.id)); paint(); });
    f.querySelector('#ggNone').addEventListener('click', () => { shown().forEach(u => members.delete(u.id)); paint(); });
    paint();
    f.querySelector('[data-cancel]').addEventListener('click', () => UI.modal.close());
    const del = f.querySelector('#ggDelete');
    if (del) del.addEventListener('click', () => {
      const n = posts(g.id).length;
      if (!UI.confirmDialog(`Hapus grup "${g.name}" beserta ${n} kiriman dan semua jawaban kuisnya? Tindakan ini tidak dapat dibatalkan. Pilih "Arsipkan" bila riwayat ingin disimpan.`)) return;
      deleteGroup(g.id, user);
      st.groupId = null;
      UI.modal.close();
      UI.toast('Grup dihapus.', 'success');
      done(null);
    });
    f.addEventListener('submit', (x) => {
      x.preventDefault();
      let out;
      try {
        out = saveGroup({ id: e.id || null, name: f.querySelector('#ggName').value, description: f.querySelector('#ggDesc').value,
          color: (f.querySelector('input[name=ggColor]:checked') || {}).value, memberIds: [...members], tutorIds: [...tutors],
          archived: !!(f.querySelector('#ggArchived') && f.querySelector('#ggArchived').checked) }, user);
      } catch (err) { UI.toast(err.message, 'error'); return; }
      const added = out.memberIds.concat(out.tutorIds).filter(id => !(e.memberIds || []).includes(id) && !(e.tutorIds || []).includes(id));
      if (added.length) DB.notifyUsers(added, { icon: '👥', title: 'Kamu ditambahkan ke grup belajar', body: out.name, link: 'grup' });
      UI.modal.close();
      UI.toast(g ? 'Grup disimpan.' : 'Grup dibuat.', 'success');
      done(out);
    });
  }

  global.Groups = { render, unreadTotal, roleIn, forUser, _data: { all, posts, answersOf } };
})(window);
