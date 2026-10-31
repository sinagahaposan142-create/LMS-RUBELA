/* =====================================================================
 * js/birthday.js — perayaan ulang tahun mentee & Birthday Wall
 * ---------------------------------------------------------------------
 * - Deteksi otomatis dari tanggal lahir (DB.birthdayInfo).
 * - Banner + confetti di Overview (menghormati prefers-reduced-motion).
 * - Birthday Wall: foto, nama, kartu ucapan digital dari komunitas.
 * - Hadiah: Birthday Badge, bingkai foto, poin (diatur admin), animasi
 *   membuka kado, dan pesan khusus admin. Poin tercatat di buku besar
 *   DB sehingga tidak pernah ganda.
 * - Moderasi: admin dapat menampilkan/menyembunyikan/menghapus; semua
 *   pengguna dapat melaporkan pesan tidak pantas (≥3 laporan = disembunyikan).
 *
 * Hak akses daftar ulang tahun:
 *   admin  → semua siswa aktif
 *   guru   → siswa di kelas yang diampu
 *   siswa  → sesama siswa aktif (komunitas Rubela)
 *   ortu   → hanya anak sendiri (lihat saja, tidak menulis)
 * ===================================================================*/
(function (global) {
  'use strict';

  const esc = (s) => UI.esc(s);
  const NOTIFIED_KEY = 'lms_birthday_notified';

  const TEMPLATES = [
    { key: 'classic', label: 'Klasik', icon: '🎂' },
    { key: 'party', label: 'Pesta', icon: '🎉' },
    { key: 'balloon', label: 'Balon', icon: '🎈' },
    { key: 'star', label: 'Bintang', icon: '🌟' },
    { key: 'campus', label: 'PTN Impian', icon: '🎓' }
  ];
  const STICKERS = ['🎂', '🎉', '🎈', '🎁', '🥳', '🌟', '💐', '🍰', '🎊', '❤️', '🎓', '💪'];
  const QUICK = [
    'Selamat ulang tahun! Semoga sehat selalu dan lolos PTN impian. 🎓',
    'Happy birthday! Semoga makin semangat belajar dan skor UTBK-nya tembus target! 💪',
    'Barakallah fii umrik! Semoga semua cita-citamu tercapai. 🤲',
    'Selamat bertambah usia, teman! Terima kasih sudah jadi teman belajar yang hebat. 🌟'
  ];

  const prefersReduced = () => global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const enabled = () => DB.getSettings().birthdayEnabled !== false;
  const tpl = (key) => TEMPLATES.find(t => t.key === key) || TEMPLATES[0];

  /* ------------------------- hak akses ------------------------- */
  function scopeStudents(user) {
    const active = (u) => u.role === 'siswa' && !['Dikeluarkan', 'Alumni'].includes(u.status || 'Aktif');
    if (user.role === 'admin') return DB.getUsers().filter(active);
    if (user.role === 'orangtua') return DB.getChildren(user.id).filter(Boolean);
    if (user.role === 'guru') {
      const ids = new Set();
      DB.getCoursesByTeacher(user.id).forEach(c => DB.getEnrollmentsByCourse(c.id).forEach(e => ids.add(e.studentId)));
      return DB.getUsers().filter(u => ids.has(u.id) && active(u));
    }
    return DB.getUsers().filter(active);
  }
  function canView(viewer, student) {
    return !!student && scopeStudents(viewer).some(s => s.id === student.id);
  }

  /* ------------------------- hadiah & bingkai ------------------------- */
  function rewardFor(student) {
    const win = DB.birthdayWishWindow(student);
    return win ? DB.birthdayRewardFor(student.id, win.year) : null;
  }
  /** Bingkai spesial tampil pada pekan ulang tahun (hari H atau setelah kado dibuka). */
  function hasFrame(user) {
    if (!enabled() || !user || user.role !== 'siswa') return false;
    const win = DB.birthdayWishWindow(user);
    if (!win || !win.open) return false;
    return win.phase === 'today' || (win.phase === 'after' && !!DB.birthdayRewardFor(user.id, win.year));
  }

  /** Avatar foto (atau inisial) + bingkai ulang tahun bila berlaku. */
  function avatarHtml(user, size) {
    const s = size || 44;
    const frame = hasFrame(user);
    const inner = user && user.photo
      ? `<img src="${esc(user.photo)}" alt="Foto ${esc(user.name)}" loading="lazy" />`
      : `<span>${esc(UI.initials(user ? user.name : '?'))}</span>`;
    return `<span class="bd-avatar ${frame ? 'bd-frame' : ''}" style="--bd-s:${s}px">${inner}${frame ? '<i class="bd-crown" aria-hidden="true">👑</i>' : ''}</span>`;
  }

  /** Lencana yang pernah diterima (satu per tahun hadiah dibuka). */
  function badgesHtml(student) {
    const list = DB.getBirthdayRewards().filter(r => r.studentId === student.id && r.openedAt)
      .sort((a, b) => b.year - a.year);
    if (!list.length) return '';
    return `<div class="bd-badges">${list.map(r =>
      `<span class="bd-badge" title="Birthday Badge ${r.year} • +${r.points} poin">🎂 Birthday Badge ${r.year}</span>`).join('')}</div>`;
  }

  /* ------------------------- confetti ------------------------- */
  function confetti(host) {
    if (prefersReduced() || !host) return;
    const layer = document.createElement('div');
    layer.className = 'bd-confetti';
    layer.setAttribute('aria-hidden', 'true');
    const colors = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#ec4899'];
    let html = '';
    for (let i = 0; i < 60; i++) {
      html += `<i style="left:${Math.random() * 100}%;background:${colors[i % colors.length]};` +
        `animation-delay:${(Math.random() * 0.8).toFixed(2)}s;animation-duration:${(2.2 + Math.random() * 1.6).toFixed(2)}s;` +
        `transform:rotate(${Math.round(Math.random() * 360)}deg);"></i>`;
    }
    layer.innerHTML = html;
    host.appendChild(layer);
    setTimeout(() => layer.remove(), 4400);
  }

  /* ------------------------- notifikasi otomatis ------------------------- */
  /**
   * Kirim notifikasi ulang tahun sekali per siswa per tahun ke siswa,
   * orang tua, tutor kelasnya, dan teman sekelas. Idempoten: dicatat di
   * `lms_birthday_notified` sehingga siapa pun yang membuka dashboard
   * lebih dulu memicu tepat satu kali.
   */
  function ensureNotifications() {
    if (!enabled()) return;
    let sent = {};
    try { sent = JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '{}') || {}; } catch (e) { sent = {}; }
    let changed = false;
    DB.getBirthdays(0).forEach(({ user: s, info }) => {
      const key = `${s.id}:${info.year}`;
      if (sent[key]) return;
      sent[key] = Date.now();
      changed = true;
      const first = s.name.split(' ')[0];
      DB.notifyStudentAndParents(s.id,
        { icon: '🎂', title: `Selamat ulang tahun, ${first}!`, body: 'Buka Birthday Wall untuk membuka kado dan membaca ucapan dari teman-teman.', link: 'birthday' },
        { title: `Hari ini ${s.name} berulang tahun 🎉`, body: 'Lihat ucapan dari teman dan tutornya di menu Ulang Tahun.' });
      const courseIds = DB.getEnrollmentsByStudent(s.id).map(e => e.courseId);
      const tutors = [];
      const mates = [];
      courseIds.forEach(cid => {
        const c = DB.getCourse(cid);
        if (c) tutors.push(...DB.courseTeacherIds(c));
        DB.getEnrollmentsByCourse(cid).forEach(e => { if (e.studentId !== s.id) mates.push(e.studentId); });
      });
      DB.notifyUsers(tutors.concat(mates), {
        icon: '🎉', title: `${s.name} berulang tahun hari ini`,
        body: 'Kirim ucapan atau kartu digital di Birthday Wall.', link: 'birthday'
      });
    });
    if (changed) {
      // Simpan hanya 400 entri terbaru agar tidak membengkak.
      const trimmed = Object.fromEntries(Object.entries(sent).sort((a, b) => b[1] - a[1]).slice(0, 400));
      localStorage.setItem(NOTIFIED_KEY, JSON.stringify(trimmed));
      if (global.Dashboard && Dashboard.refreshNotifications) Dashboard.refreshNotifications();
    }
  }

  /* ------------------------- banner di Overview ------------------------- */
  function mountBanner(container, user) {
    if (!enabled() || !container) return;
    const me = DB.getUser(user.id) || user;
    const mine = me.role === 'siswa' ? DB.birthdayInfo(me) : null;
    const todays = scopeStudents(me).filter(s => s.id !== me.id).map(s => ({ s, info: DB.birthdayInfo(s) }))
      .filter(x => x.info && x.info.isToday);
    if (!(mine && mine.isToday) && !todays.length) return;

    const el = document.createElement('section');
    el.className = 'bd-banner card';
    if (mine && mine.isToday) {
      const reward = DB.birthdayRewardFor(me.id, mine.year);
      el.classList.add('is-mine');
      el.innerHTML = `
        <div class="bd-banner-inner">
          ${avatarHtml(me, 72)}
          <div class="bd-banner-body">
            <div class="bd-eyebrow">🎂 Hari spesialmu</div>
            <h3>Selamat ulang tahun ke-${mine.age}, ${esc(me.name.split(' ')[0])}!</h3>
            <p class="muted">${esc(DB.getSettings().birthdayMessage || '')}</p>
            <div class="flex-gap">
              <button type="button" class="btn btn-primary btn-sm" data-bd-go>${reward ? 'Lihat Birthday Wall' : '🎁 Buka Kado'}</button>
              ${reward ? `<span class="bd-badge">🎂 +${reward.points} poin diterima</span>` : ''}
            </div>
          </div>
        </div>`;
    } else {
      const names = todays.slice(0, 3).map(x => esc(x.s.name)).join(', ') + (todays.length > 3 ? ` dan ${todays.length - 3} lainnya` : '');
      el.innerHTML = `
        <div class="bd-banner-inner">
          <div class="bd-avatars">${todays.slice(0, 4).map(x => avatarHtml(x.s, 52)).join('')}</div>
          <div class="bd-banner-body">
            <div class="bd-eyebrow">🎉 Ulang tahun hari ini</div>
            <h3>${names}</h3>
            <p class="muted">${me.role === 'orangtua' ? 'Lihat ucapan dari teman dan tutor di Birthday Wall.' : 'Kirim ucapan dan kartu digital untuk merayakannya.'}</p>
            <button type="button" class="btn btn-primary btn-sm" data-bd-go>${me.role === 'orangtua' ? 'Lihat Birthday Wall' : 'Kirim Ucapan'}</button>
          </div>
        </div>`;
    }
    container.insertBefore(el, container.firstChild);
    el.querySelector('[data-bd-go]').addEventListener('click', () => {
      if (mine && mine.isToday) focusId = me.id;
      else if (todays[0]) focusId = todays[0].s.id;
      Dashboard.navigate('birthday');
    });
    // Confetti sekali per sesi per hari agar tidak mengganggu.
    const k = `lms_bd_confetti:${me.id}:${DB.ymdOf(Date.now())}`;
    if (!sessionStorage.getItem(k)) {
      sessionStorage.setItem(k, '1');
      confetti(el);
    }
  }

  /* ------------------------- Birthday Wall ------------------------- */
  let focusId = null;   // siswa yang sedang dibuka di wall

  function renderWall(container, user) {
    const me = DB.getUser(user.id) || user;
    if (!enabled() && me.role !== 'admin') {
      container.innerHTML = '<div class="empty"><div class="empty-icon">🎂</div>Fitur ulang tahun sedang dinonaktifkan oleh admin.</div>';
      return;
    }
    const students = scopeStudents(me).concat(me.role === 'siswa' && !scopeStudents(me).some(s => s.id === me.id) ? [me] : []);
    const rows = students.map(s => ({ s, info: DB.birthdayInfo(s), win: DB.birthdayWishWindow(s) }));
    const today = rows.filter(r => r.info && r.info.isToday);
    const soon = rows.filter(r => r.info && !r.info.isToday && r.info.daysUntil <= 30)
      .sort((a, b) => a.info.daysUntil - b.info.daysUntil);
    const recent = rows.filter(r => r.win && r.win.phase === 'after');
    const noDate = rows.filter(r => !r.info).length;

    if (!focusId || !students.some(s => s.id === focusId)) {
      focusId = (today[0] || recent[0] || soon[0] || {}).s ? (today[0] || recent[0] || soon[0]).s.id : null;
      if (me.role === 'siswa' && DB.birthdayInfo(me) && DB.birthdayInfo(me).isToday) focusId = me.id;
    }

    const pending = me.role === 'admin' ? DB.getBirthdayWishes()
      .filter(w => w.status === 'pending' || (w.reports || []).length) : [];

    container.innerHTML = `
      ${!enabled() ? '<div class="alert alert-info">Fitur ulang tahun sedang <strong>nonaktif</strong> — hanya admin yang melihat halaman ini. Aktifkan di Pengaturan.</div>' : ''}
      <section class="welcome-hero bd-hero">
        <span class="blob b1"></span><span class="blob b2"></span>
        <div class="wh-inner">
          <div class="wh-eyebrow">🎂 Birthday Wall</div>
          <h2>Rayakan Hari Spesial Mentee Rubela</h2>
          <p class="wh-sub">Ucapan dibuka 7 hari sebelum hingga 7 hari sesudah ulang tahun. Setiap orang dapat mengirim satu ucapan per teman per tahun.</p>
          <div class="wh-chips">
            <span class="wh-chip">🎉 ${today.length} hari ini</span>
            <span class="wh-chip">📅 ${soon.length} dalam 30 hari</span>
            ${me.role === 'admin' ? `<span class="wh-chip">📝 ${noDate} belum mengisi tanggal lahir</span>` : ''}
            ${pending.length ? `<span class="wh-chip">🛡️ ${pending.length} perlu moderasi</span>` : ''}
          </div>
        </div>
      </section>

      <div class="bd-layout">
        <aside class="card bd-side">
          <div class="card-header">${UI.secHead('🎈', 'Daftar Ulang Tahun', me.role === 'orangtua' ? 'anak Anda' : 'hari ini & mendatang')}</div>
          ${listHtml('Hari ini', today)}
          ${listHtml('Baru saja (7 hari terakhir)', recent)}
          ${listHtml('30 hari ke depan', soon)}
          ${!today.length && !soon.length && !recent.length ? `<div class="empty"><div class="empty-icon">📭</div>
            Belum ada ulang tahun dalam waktu dekat.${me.role === 'siswa' && !DB.birthdayInfo(me) ? '<br>Isi tanggal lahirmu di menu Profil.' : ''}</div>` : ''}
        </aside>
        <div class="bd-main" id="bdMain"></div>
      </div>

      ${me.role === 'admin' ? '<div class="card" id="bdModeration"></div>' : ''}`;

    container.querySelectorAll('[data-bd-open]').forEach(b => b.addEventListener('click', () => {
      focusId = b.dataset.bdOpen;
      container.querySelectorAll('[data-bd-open]').forEach(x => x.classList.toggle('is-active', x.dataset.bdOpen === focusId));
      paintMain(container.querySelector('#bdMain'), me, container);
    }));
    paintMain(container.querySelector('#bdMain'), me, container);
    if (me.role === 'admin') paintModeration(container.querySelector('#bdModeration'), me, container);
  }

  function listHtml(title, list) {
    if (!list.length) return '';
    return `<div class="bd-list-title">${esc(title)}</div>
      <div class="bd-list">${list.map(r => `
        <button type="button" class="bd-person ${r.s.id === focusId ? 'is-active' : ''}" data-bd-open="${r.s.id}">
          ${avatarHtml(r.s, 40)}
          <span class="bd-person-body"><strong>${esc(r.s.name)}</strong>
            <span class="muted small">${esc(r.s.kelas || '-')} • ${r.info.isToday ? 'hari ini 🎉' : (r.win && r.win.phase === 'after' ? 'baru saja' : `${r.info.daysUntil} hari lagi`)} • ${UI.fmtYMD(r.win && r.win.phase === 'after' ? r.win.date : r.info.nextDate)}</span>
          </span>
        </button>`).join('')}</div>`;
  }

  function paintMain(box, me, root) {
    const s = focusId ? DB.getUser(focusId) : null;
    if (!s || !canView(me, s) && s.id !== me.id) {
      box.innerHTML = `<div class="card"><div class="empty"><div class="empty-icon">🎂</div>
        Pilih nama di daftar untuk membuka Birthday Wall-nya.</div></div>`;
      return;
    }
    const info = DB.birthdayInfo(s);
    const win = DB.birthdayWishWindow(s);
    const year = win ? win.year : new Date().getFullYear();
    const wishes = DB.getWishesFor(s.id, year, me);
    const isSelf = me.id === s.id;
    const already = DB.getBirthdayWishes().some(w => w.recipientId === s.id && w.authorId === me.id && w.year === year);
    const canWrite = enabled() && DB.canSendWish(me, s) && win && win.open && !already;
    const reward = info ? DB.birthdayRewardFor(s.id, year) : null;
    const showGift = isSelf && info && info.isToday && enabled();

    box.innerHTML = `
      <div class="card bd-profile">
        ${avatarHtml(s, 96)}
        <div class="bd-profile-body">
          <h3 class="mt-0">${esc(s.name)}</h3>
          <div class="muted small">${esc(s.kelas || '-')}${s.targetUniv ? ` • 🎯 ${esc(s.targetUniv)}` : ''}</div>
          <div class="muted small">${info ? `🎂 ${UI.fmtYMD(win && win.phase === 'after' ? win.date : info.nextDate)} • ${info.isToday ? `berulang tahun ke-${info.age} hari ini` : (win && win.phase === 'after' ? 'ulang tahun baru saja lewat' : `${info.daysUntil} hari lagi`)}` : 'Tanggal lahir belum diisi'}</div>
          ${badgesHtml(s)}
        </div>
        ${showGift ? `<div class="bd-gift ${reward ? 'is-open' : ''}" id="bdGift">
          <button type="button" class="bd-gift-box" ${reward ? 'disabled' : ''} aria-label="Buka kado ulang tahun">
            <span class="bd-gift-lid">🎀</span><span class="bd-gift-body">🎁</span>
          </button>
          <div class="bd-gift-msg">${reward ? giftMessage(reward) : '<strong>Kado untukmu!</strong><span class="muted small">Klik untuk membuka.</span>'}</div>
        </div>` : ''}
      </div>

      ${canWrite ? formHtml(s) : `<div class="card bd-note muted small">${
        isSelf ? 'Ini Birthday Wall milikmu. Ucapan dari teman akan muncul di sini.'
        : me.role === 'orangtua' ? 'Orang tua dapat melihat ucapan, namun tidak dapat menulis di Birthday Wall.'
        : already ? '✅ Kamu sudah mengirim ucapan untuk teman ini tahun ini.'
        : !enabled() ? 'Fitur ulang tahun nonaktif.'
        : 'Ucapan dibuka 7 hari sebelum hingga 7 hari sesudah ulang tahun.'}</div>`}

      <div class="card">
        <div class="card-header">${UI.secHead('💌', `Ucapan ${year}`, `${wishes.filter(w => w.status === 'visible').length} ucapan tampil`)}</div>
        <div id="bdWishes"></div>
      </div>`;

    if (global.DataSearch) {
      DataSearch.mount({
        container: box.querySelector('#bdWishes'),
        items: wishes.slice().reverse(),
        placeholder: 'Cari isi ucapan atau nama pengirim…',
        fields: (w) => { const a = DB.getUser(w.authorId); return [w.text, a ? a.name : '', tpl(w.template).label, w.sticker]; },
        pageSize: 12,
        empty: 'Belum ada ucapan. Jadilah yang pertama!',
        render: (list, ctx) => `<div class="bd-cards">${list.map(w => cardHtml(w, me, ctx)).join('')}</div>`,
        onPaint: (res) => bindCards(res, me, () => paintMain(box, me, root))
      });
    }

    if (canWrite) bindForm(box, s, me, () => paintMain(box, me, root));

    const gift = box.querySelector('#bdGift .bd-gift-box');
    if (gift && !reward) gift.addEventListener('click', () => {
      const wrap = box.querySelector('#bdGift');
      wrap.classList.add('is-opening');
      setTimeout(() => {
        try {
          const r = DB.claimBirthdayReward(DB.getUser(s.id));
          wrap.classList.remove('is-opening');
          wrap.classList.add('is-open');
          wrap.querySelector('.bd-gift-msg').innerHTML = giftMessage(r);
          gift.disabled = true;
          confetti(box.querySelector('.bd-profile'));
          UI.toast(`🎁 Kado dibuka! +${r.points} poin dan Birthday Badge ${r.year}.`);
          setTimeout(() => paintMain(box, me, root), 1600);
        } catch (err) {
          wrap.classList.remove('is-opening');
          UI.toast(err.message, 'error');
        }
      }, prefersReduced() ? 0 : 900);
    });
  }

  function giftMessage(r) {
    return `<strong>🎉 +${r.points} poin & Birthday Badge ${r.year}</strong>
      <span class="small">${esc(DB.getSettings().birthdayMessage || '')}</span>
      <span class="muted small">Bingkai foto spesial aktif selama pekan ulang tahunmu.</span>`;
  }

  function formHtml(s) {
    return `<form class="card bd-form" id="bdForm">
      <div class="card-header">${UI.secHead('✍️', `Kirim ucapan untuk ${s.name.split(' ')[0]}`, 'pesan pribadi, kartu digital, dan stiker')}</div>
      <div class="form-group"><label>Desain kartu</label>
        <div class="bd-tpls" role="radiogroup">${TEMPLATES.map((t, i) => `
          <label class="bd-tpl bd-tpl-${t.key}"><input type="radio" name="template" value="${t.key}" ${i === 0 ? 'checked' : ''} />
            <span>${t.icon} ${esc(t.label)}</span></label>`).join('')}</div>
      </div>
      <div class="form-group"><label>Stiker</label>
        <div class="bd-stickers">${STICKERS.map((e, i) => `
          <label><input type="radio" name="sticker" value="${e}" ${i === 0 ? 'checked' : ''} /><span>${e}</span></label>`).join('')}</div>
      </div>
      <div class="form-group"><label for="bdText">Pesan</label>
        <div class="bd-quick">${QUICK.map((q, i) => `<button type="button" class="chip" data-bd-quick="${i}">${esc(q.slice(0, 34))}…</button>`).join('')}</div>
        <textarea id="bdText" name="text" rows="3" maxlength="500" required placeholder="Tulis ucapan terbaikmu…"></textarea>
        <div class="muted small"><span id="bdCount">0</span>/500 karakter${DB.getSettings().birthdayModeration === 'pre' ? ' • ucapan ditinjau admin sebelum tampil' : ''}</div>
      </div>
      <div class="bd-preview" id="bdPreview"></div>
      <div class="flex-gap" style="justify-content:flex-end;"><button type="submit" class="btn btn-primary">Kirim Ucapan 🎉</button></div>
    </form>`;
  }

  function bindForm(box, s, me, done) {
    const form = box.querySelector('#bdForm');
    const text = form.querySelector('#bdText');
    const prev = form.querySelector('#bdPreview');
    const count = form.querySelector('#bdCount');
    const preview = () => {
      const fd = new FormData(form);
      count.textContent = text.value.length;
      prev.innerHTML = cardHtml({ id: 'preview', authorId: me.id, template: fd.get('template'), sticker: fd.get('sticker'),
        text: text.value || 'Pratinjau kartu ucapanmu…', status: 'visible', reports: [], createdAt: Date.now() }, me, null, true);
    };
    form.addEventListener('input', preview);
    form.addEventListener('change', preview);
    form.querySelectorAll('[data-bd-quick]').forEach(b => b.addEventListener('click', () => {
      text.value = QUICK[Number(b.dataset.bdQuick)];
      preview();
      text.focus();
    }));
    preview();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        const w = DB.addBirthdayWish({ recipientId: s.id, template: fd.get('template'), sticker: fd.get('sticker'), text: fd.get('text') }, me);
        if (w.status === 'visible') {
          DB.addNotification({ userId: s.id, icon: w.sticker || '💌', title: `Ucapan dari ${me.name}`, body: w.text.slice(0, 120), link: 'birthday' });
        } else {
          DB.notifyUsers(DB.getUsers().filter(u => u.role === 'admin').map(u => u.id),
            { icon: '🛡️', title: 'Ucapan ulang tahun menunggu moderasi', body: `${me.name} → ${s.name}`, link: 'birthday' });
        }
        UI.toast(w.status === 'visible' ? 'Ucapan terkirim! 🎉' : 'Ucapan terkirim dan menunggu persetujuan admin.');
        done();
      } catch (err) {
        UI.toast(err.message, 'error');
      }
    });
  }

  function cardHtml(w, me, ctx, isPreview) {
    const a = DB.getUser(w.authorId);
    const t = tpl(w.template);
    const reports = (w.reports || []).length;
    const mine = w.authorId === me.id;
    const text = ctx ? ctx.highlight(w.text) : esc(w.text);
    return `<article class="bd-card bd-tpl-${t.key} ${w.status !== 'visible' ? 'is-' + w.status : ''}">
      <div class="bd-card-sticker" aria-hidden="true">${esc(w.sticker || t.icon)}</div>
      <p class="bd-card-text">${text}</p>
      <footer class="bd-card-foot">
        ${a ? avatarHtml(a, 26) : ''}
        <span><strong>${esc(a ? a.name : 'Pengguna terhapus')}</strong>
          <span class="small">${esc(a ? (Auth.ROLE_LABELS[a.role] || a.role) : '')} • ${isPreview ? 'pratinjau' : UI.fmtRelative(w.createdAt)}</span></span>
      </footer>
      ${!isPreview ? `<div class="bd-card-meta">
        ${w.status === 'pending' ? '<span class="badge badge-warning">menunggu moderasi</span>' : ''}
        ${w.status === 'hidden' ? '<span class="badge badge-gray">disembunyikan</span>' : ''}
        ${me.role === 'admin' && reports ? `<span class="badge badge-danger">${reports} laporan</span>` : ''}
        <span class="bd-card-actions">
          ${!mine && me.role !== 'admin' && me.role !== 'orangtua' ? `<button type="button" class="btn btn-sm btn-ghost" data-bd-report="${w.id}" title="Laporkan pesan tidak pantas">🚩 Laporkan</button>` : ''}
          ${me.role === 'admin' ? (w.status === 'visible'
            ? `<button type="button" class="btn btn-sm btn-secondary" data-bd-mod="${w.id}" data-st="hidden">Sembunyikan</button>`
            : `<button type="button" class="btn btn-sm btn-secondary" data-bd-mod="${w.id}" data-st="visible">Tampilkan</button>`) : ''}
          ${mine || me.role === 'admin' ? `<button type="button" class="btn btn-sm btn-danger" data-bd-del="${w.id}">Hapus</button>` : ''}
        </span>
      </div>` : ''}
    </article>`;
  }

  function bindCards(box, me, done) {
    box.querySelectorAll('[data-bd-report]').forEach(b => b.addEventListener('click', () => {
      const reason = global.prompt('Alasan melaporkan ucapan ini (mis. kata kasar, spam):', '');
      if (reason == null) return;
      try {
        const w = DB.reportWish(b.dataset.bdReport, reason, me);
        DB.notifyUsers(DB.getUsers().filter(u => u.role === 'admin').map(u => u.id),
          { icon: '🚩', title: 'Ucapan ulang tahun dilaporkan', body: (reason || 'tanpa alasan').slice(0, 100), link: 'birthday' });
        UI.toast(w && w.status === 'hidden' ? 'Laporan diterima. Ucapan disembunyikan sementara untuk ditinjau admin.' : 'Terima kasih, laporan dikirim ke admin.', 'info');
        done();
      } catch (err) { UI.toast(err.message, 'error'); }
    }));
    box.querySelectorAll('[data-bd-mod]').forEach(b => b.addEventListener('click', () => {
      try { DB.moderateWish(b.dataset.bdMod, b.dataset.st, me); UI.toast('Status ucapan diperbarui.'); done(); }
      catch (err) { UI.toast(err.message, 'error'); }
    }));
    box.querySelectorAll('[data-bd-del]').forEach(b => b.addEventListener('click', () => {
      if (!UI.confirmDialog('Hapus ucapan ini?')) return;
      try { DB.deleteBirthdayWish(b.dataset.bdDel, me); UI.toast('Ucapan dihapus.'); done(); }
      catch (err) { UI.toast(err.message, 'error'); }
    }));
  }

  /** Antrian moderasi admin: menunggu persetujuan, dilaporkan, disembunyikan. */
  function paintModeration(box, me, root) {
    const all = DB.getBirthdayWishes().slice().sort((a, b) => b.createdAt - a.createdAt);
    box.innerHTML = `<div class="card-header">${UI.secHead('🛡️', 'Moderasi Ucapan', 'tinjau ucapan yang menunggu persetujuan atau dilaporkan')}</div>
      <div id="bdModList"></div>`;
    DataSearch.mount({
      container: box.querySelector('#bdModList'),
      items: all,
      stateKey: 'bd-moderation',
      placeholder: 'Cari isi ucapan, pengirim, atau penerima…',
      fields: (w) => { const a = DB.getUser(w.authorId); const r = DB.getUser(w.recipientId);
        return [w.text, a ? a.name : '', r ? r.name : '', (w.reports || []).map(x => x.reason)]; },
      filters: [{ key: 'state', label: 'Semua status', get: w => [w.status, (w.reports || []).length ? 'reported' : ''],
        options: [{ value: 'pending', label: 'Menunggu moderasi' }, { value: 'reported', label: 'Dilaporkan' },
          { value: 'hidden', label: 'Disembunyikan' }, { value: 'visible', label: 'Tampil' }] }],
      sorts: [
        { key: 'new', label: 'Terbaru', cmp: (a, b) => b.createdAt - a.createdAt },
        { key: 'reports', label: 'Laporan terbanyak', cmp: (a, b) => (b.reports || []).length - (a.reports || []).length }
      ],
      pageSize: 10,
      empty: 'Belum ada ucapan.',
      render: (list, ctx) => `<div class="table-wrap"><table class="table">
        <thead><tr><th>Ucapan</th><th>Pengirim → Penerima</th><th>Status</th><th>Laporan</th><th>Aksi</th></tr></thead>
        <tbody>${list.map(w => { const a = DB.getUser(w.authorId); const r = DB.getUser(w.recipientId);
          return `<tr>
            <td>${esc(w.sticker || '')} ${ctx.highlight(w.text)}</td>
            <td>${esc(a ? a.name : '-')} → <strong>${esc(r ? r.name : '-')}</strong><div class="muted small">${UI.fmtRelative(w.createdAt)}</div></td>
            <td><span class="badge ${w.status === 'visible' ? 'badge-success' : w.status === 'pending' ? 'badge-warning' : 'badge-gray'}">${{ visible: 'Tampil', pending: 'Menunggu', hidden: 'Disembunyikan' }[w.status] || w.status}</span></td>
            <td>${(w.reports || []).length ? (w.reports || []).map(x => `<div class="small">🚩 ${esc(x.reason || 'tanpa alasan')}</div>`).join('') : '<span class="muted small">-</span>'}</td>
            <td class="actions">
              ${w.status !== 'visible' ? `<button type="button" class="btn btn-sm btn-primary" data-bd-mod="${w.id}" data-st="visible">Setujui</button>` : ''}
              ${w.status !== 'hidden' ? `<button type="button" class="btn btn-sm btn-secondary" data-bd-mod="${w.id}" data-st="hidden">Sembunyikan</button>` : ''}
              <button type="button" class="btn btn-sm btn-danger" data-bd-del="${w.id}">Hapus</button>
            </td></tr>`; }).join('')}</tbody></table></div>`,
      onPaint: (res) => bindCards(res, me, () => renderWall(root, me))
    });
  }

  global.Birthday = { mountBanner, renderWall, avatarHtml, badgesHtml, hasFrame, ensureNotifications, confetti, scopeStudents };
})(window);
