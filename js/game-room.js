/* =====================================================================
 * js/game-room.js — Main Bareng Kelas (multipemain dengan kode ruang)
 * ---------------------------------------------------------------------
 * Tutor/admin membuat ruang (Kelola Game Battle → Main Bareng) dan
 * menampilkan layar tuan rumah di proyektor. Siswa bergabung dari HP
 * (Game Battle → Main Bareng → kode 6 huruf).
 *
 *  Monster Co-op : setiap soal = satu ronde. Di HP siswa memilih jurus lalu
 *                  menjawab; layar tuan rumah memutar pertarungannya. Peran:
 *                  Penyerang, Penyihir, Penjaga, Penyembuh. Benar = jurus
 *                  kena, cepat = kritis, monster membalas, teman pingsan
 *                  bangkit bila menjawab benar atau disembuhkan. Goblin →
 *                  Orc → Golem raksasa; darah monster mengikuti jumlah siswa.
 *  Balap Kelas   : setiap siswa menyetir mobilnya sendiri dari HP (pindah
 *                  lajur, pakai item), gerbang "?" berisi soal (bisa dijawab
 *                  dengan suara). Benar = Turbo / Perisai / Oli untuk mobil
 *                  di depan; salah = tergelincir. Layar tuan rumah menampilkan
 *                  peta sirkuit & klasemen seluruh kelas.
 *
 * Data (tersinkron, divalidasi server di api/_lib/rules.js):
 *   lms_game_rooms   — ruang (tuan rumah yang menulis; keadaan pertarungan)
 *   lms_game_players — satu record per siswa per ruang (peran, jawaban, mobil)
 * Tuan rumah adalah wasit: menilai ulang jawaban dengan kunci soal dan
 * menghitung kerusakan. Selama ruang terbuka perangkat menyinkron tiap
 * 1,5–2 detik (lebih cepat lagi bila Supabase Realtime aktif).
 * ===================================================================*/
(function (global) {
  'use strict';
  if (!global.Games || !global.Arcade || !global.RaceEngine || !global.GameArt) return;
  const K = { rooms: 'lms_game_rooms', players: 'lms_game_players' };
  const { esc, rt, beep, shuffle, gainHtml, fmt, reducedMotion, resolveRef } = Games.kit;
  const Art = global.GameArt, RE = global.RaceEngine, AR = global.Arcade;
  const ic = (n, s) => Art.icon(n, s);
  const AV = (u) => (global.Avatars ? Avatars.inner(u) : esc(UI.initials(u && u.name)));
  const server = () => !!(global.Sync && Sync.isServer && Sync.isServer());
  const clock = () => (global.Sync && Sync.serverNow ? Sync.serverNow() : Date.now());
  const uid = (p) => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const push = (why) => { if (server()) Sync.syncNow(why || 'room').catch(() => {}); };

  /* ---------------- Penyimpanan ---------------- */
  function load(k) { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function upsert(k, rec) {
    const all = load(k);
    const i = all.findIndex(x => x.id === rec.id);
    if (i >= 0) all[i] = rec; else all.push(rec);
    localStorage.setItem(k, JSON.stringify(all));
    return rec;
  }
  function removeWhere(k, fn) { localStorage.setItem(k, JSON.stringify(load(k).filter(x => !fn(x)))); }
  const getRoom = (id) => load(K.rooms).find(r => r.id === id) || null;
  const playersOf = (roomId) => load(K.players).filter(p => p.roomId === roomId && DB.getUser(p.userId)).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  const myPlayer = (roomId, me) => load(K.players).find(p => p.id === roomId + ':' + me) || null;
  const userName = (id) => { const u = DB.getUser(id); return u ? u.name : 'Mentee'; };
  const firstName = (id) => userName(id).split(' ')[0];
  // Tulisan di tab ini tidak memicu event "storage" di tab yang sama → tampilan disegarkan sendiri.
  const kick = (ms) => { const s = live; if (s && s.onData) setTimeout(() => { if (live === s) s.onData(); }, ms); };
  const saveRoom = (room) => { upsert(K.rooms, room); push('room'); kick(30); return room; };
  const savePlayer = (p, ms) => { upsert(K.players, p); push('room'); kick(ms == null ? 700 : ms); return p; };

  const KINDS = {
    raid: { name: 'Monster Co-op', game: 'monster', icon: 'skull', color: '#65a30d', art: 'raid',
      desc: 'Seluruh kelas melawan Goblin, Orc, lalu Golem raksasa. Tiap soal satu ronde: pilih jurus di HP lalu jawab.' },
    race: { name: 'Balap Kelas', game: 'balap', icon: 'car', color: '#e11d48', art: 'balap',
      desc: 'Tiap mentee menyetir mobilnya dari HP. Gerbang "?" berisi soal: benar = item, salah = tergelincir.' }
  };
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const ACTIVE_MS = 4 * 3600000;
  const isActive = (r) => r && (r.status === 'lobby' || r.status === 'playing') && clock() - (r.updatedAt || r.createdAt || 0) < ACTIVE_MS;
  function newCode() {
    const used = new Set(load(K.rooms).map(r => r.code));
    for (let i = 0; i < 50; i++) {
      let c = '';
      const buf = new Uint32Array(6);
      (global.crypto || {}).getRandomValues ? crypto.getRandomValues(buf) : buf.forEach((_, j) => { buf[j] = Math.floor(Math.random() * 1e9); });
      buf.forEach(n => { c += CODE_CHARS[n % CODE_CHARS.length]; });
      if (!used.has(c)) return c;
    }
    return 'R' + Date.now().toString(36).toUpperCase().slice(-5).replace(/[01IO]/g, 'X');
  }

  /* ---------------- Sesi tampilan berjalan ---------------- */
  let live = null;
  function stop() { if (live) { const l = live; live = null; l.dispose(); } }
  /** Sedang menampilkan ruang? (halaman Game Battle tidak dirender ulang). */
  function busy() { return !!(live && live.el && live.el.isConnected); }
  function startLive(o) {
    stop();
    const s = Object.assign({ timers: new Set(), intervals: new Set(), disposers: [] }, o);
    s.after = (ms, fn) => { const id = setTimeout(() => { s.timers.delete(id); if (live === s) fn(); }, ms); s.timers.add(id); return id; };
    s.every = (ms, fn) => { const id = setInterval(() => { if (live === s && s.el.isConnected) fn(); else if (!s.el.isConnected) stop(); }, ms); s.intervals.add(id); return id; };
    s.onDispose = (fn) => s.disposers.push(fn);
    s.dispose = () => {
      s.timers.forEach(clearTimeout); s.intervals.forEach(clearInterval);
      s.disposers.forEach(fn => { try { fn(); } catch (e) { /* noop */ } });
      if (global.Sync && Sync.setUrgent && s.urgent) Sync.setUrgent(false);
    };
    // Data berubah (perangkat lain / sinkronisasi) → perbarui tampilan, paling sering per frame.
    let raf = 0;
    const onStore = (e) => {
      if (e.key !== K.rooms && e.key !== K.players) return;
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; if (live === s && s.onData) s.onData(); });
    };
    global.addEventListener('storage', onStore);
    s.onDispose(() => { global.removeEventListener('storage', onStore); cancelAnimationFrame(raf); });
    if (server()) {
      s.every(s.host ? 1500 : 2000, () => Sync.syncNow('room').catch(() => {}));
      if (Sync.setUrgent) { Sync.setUrgent(true); s.urgent = true; }
    } else s.every(1000, () => { if (s.onData) s.onData(); });
    // Kanvas/arena butuh "stage" & onDispose seperti ctx game.
    s.ctx = { stage: s.el, rng: Math.random, onDispose: s.onDispose, mode: 'kelas' };
    live = s;
    return s;
  }

  const timerBar = (endsAt, totalMs) => {
    const left = Math.max(0, endsAt - clock());
    return { left, pct: totalMs ? clamp(left / totalMs * 100, 0, 100) : 0, sec: Math.ceil(left / 1000) };
  };
  function avatarChip(userId, extra) {
    const u = DB.getUser(userId) || { name: 'Mentee' };
    return `<span class="mbk-av">${AV(u)}</span><span class="mbk-nm">${esc(u.name.split(' ')[0])}</span>${extra || ''}`;
  }

  /* =================================================================
   * TUAN RUMAH (tutor/admin)
   * ===============================================================*/
  const hostView = { kind: 'raid', track: 'taman', laps: 3, count: 15, roundSec: 25, subject: '' };

  function renderHost(container, user) {
    if (live && live.host && live.el === container && live.el.isConnected) return;
    stop();
    const mine = load(K.rooms).filter(r => r.hostId === user.id || user.role === 'admin').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const open = mine.filter(isActive);
    const recent = mine.filter(r => r.status === 'done').slice(0, 6);
    const kind = KINDS[hostView.kind];
    const game = Games.GAME[kind.game];
    const pool = Games.poolFor(game, hostView.subject);
    container.innerHTML = `
      <div class="mbk-wrap">
      ${open.length ? `<div class="card"><div class="card-header">${UI.secHead('🎪', 'Ruang yang sedang terbuka', 'lanjutkan di layar ini')}</div>
        ${open.map(r => `<div class="gb-inv-row"><span class="mbk-kind-ic" style="--gc:${KINDS[r.kind].color}">${ic(KINDS[r.kind].icon, 20)}</span>
          <div class="gb-inv-main"><strong>${esc(r.title)}</strong><div class="muted small">${esc(KINDS[r.kind].name)} • kode <b>${esc(r.code)}</b> • ${playersOf(r.id).length} mentee • ${r.status === 'lobby' ? 'menunggu mulai' : 'sedang bermain'}${r.hostId !== user.id ? ' • tuan rumah ' + esc(userName(r.hostId)) : ''}</div></div>
          <div class="flex-gap">${r.hostId === user.id ? `<button type="button" class="btn btn-sm btn-primary" data-open="${r.id}">Buka layar</button>` : ''}
          <button type="button" class="btn btn-sm btn-ghost" data-close="${r.id}">Tutup</button></div></div>`).join('')}</div>` : ''}
      <div class="card">
        <div class="card-header">${UI.secHead('🎪', 'Buat Ruang Main Bareng', 'tampilkan layar ini di proyektor, mentee bergabung dari HP dengan kode')}</div>
        <div class="mbk-kinds">${Object.entries(KINDS).map(([k, v]) => `
          <button type="button" class="mbk-kind ${hostView.kind === k ? 'is-on' : ''}" data-kind="${k}" aria-pressed="${hostView.kind === k}" style="--gc:${v.color}">
            <span class="mbk-kind-art">${Art.cardArt(v.art)}</span><strong>${esc(v.name)}</strong><small>${esc(v.desc)}</small></button>`).join('')}</div>
        <div class="form form-row mbk-form">
          <div class="form-group"><label for="mbkTitle">Judul</label><input id="mbkTitle" maxlength="80" value="${esc(kind.name + ' — ' + (DB.getUser(user.id) || user).name)}" /></div>
          <div class="form-group"><label for="mbkSub">Subtest</label><select id="mbkSub"><option value="">Semua subtest</option>
            ${DB.SUBTESTS.map(s => `<option value="${esc(s.name)}" ${hostView.subject === s.name ? 'selected' : ''}>${esc(s.short)}</option>`).join('')}</select></div>
          <div class="form-group"><label for="mbkCount">Jumlah soal</label><select id="mbkCount">${[10, 15, 20, 30].map(n => `<option ${hostView.count === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          ${hostView.kind === 'raid' ? `<div class="form-group"><label for="mbkSec">Waktu per ronde</label><select id="mbkSec">${[15, 20, 25, 30, 45, 60].map(n => `<option value="${n}" ${hostView.roundSec === n ? 'selected' : ''}>${n} detik</option>`).join('')}</select></div>`
            : `<div class="form-group"><label for="mbkLaps">Putaran</label><select id="mbkLaps">${[2, 3, 4].map(n => `<option ${hostView.laps === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`}
        </div>
        ${hostView.kind === 'race' ? `<h4 class="gb-sub-h">${ic('flag', 16)} Sirkuit</h4><div class="ar-tracks mbk-tracks" style="--gc:${kind.color}">${RE.TRACKS.map(t => `
          <button type="button" class="ar-track ${t.id === hostView.track ? 'is-on' : ''}" data-track="${t.id}" aria-pressed="${t.id === hostView.track}">
            <svg viewBox="0 0 400 260" aria-hidden="true"><rect width="400" height="260" rx="22" fill="${t.c.ground}"/><path d="${t.path}" fill="none" stroke="${t.c.edge}" stroke-width="26"/><path d="${t.path}" fill="none" stroke="${t.c.road}" stroke-width="18"/></svg>
            <span>${esc(t.name)}</span></button>`).join('')}</div>` : ''}
        <p class="muted small">${pool.length} soal cocok tersedia (${esc(game.formats.join(', '))}). ${pool.length < 5 ? '<b>Soal belum cukup — tambah lewat tab Soal Game atau Paket Soal Contoh.</b>' : ''}</p>
        <button type="button" class="btn btn-primary" id="mbkCreate" ${pool.length >= 3 ? '' : 'disabled'}>${ic('play', 16)} Buat Ruang & Tampilkan Kode</button>
      </div>
      ${recent.length ? `<div class="card"><div class="card-header">${UI.secHead('📜', 'Riwayat Main Bareng', '6 terakhir')}</div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Ruang</th><th>Jenis</th><th>Mentee</th><th>Hasil</th><th>Waktu</th></tr></thead><tbody>
        ${recent.map(r => `<tr><td>${esc(r.title)}</td><td>${esc(KINDS[r.kind].name)}</td><td>${playersOf(r.id).length}</td>
          <td>${r.kind === 'raid' ? (r.state && r.state.raid && r.state.raid.victory ? 'Menang' : 'Kalah') : esc(((r.results || [])[0] && userName(r.results[0].uid)) ? 'Juara: ' + userName(r.results[0].uid) : '-')}</td>
          <td class="small">${esc(UI.fmtDateTime(r.createdAt))}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      </div>`;
    const re = () => renderHost(container, user);
    container.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => { hostView.kind = b.dataset.kind; re(); }));
    container.querySelectorAll('[data-track]').forEach(b => b.addEventListener('click', () => { hostView.track = b.dataset.track; re(); }));
    container.querySelector('#mbkSub').addEventListener('change', (e) => { hostView.subject = e.target.value; re(); });
    container.querySelector('#mbkCount').addEventListener('change', (e) => { hostView.count = Number(e.target.value); });
    const sec = container.querySelector('#mbkSec');
    if (sec) sec.addEventListener('change', (e) => { hostView.roundSec = Number(e.target.value); });
    const laps = container.querySelector('#mbkLaps');
    if (laps) laps.addEventListener('change', (e) => { hostView.laps = Number(e.target.value); });
    container.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openHost(container, user, b.dataset.open)));
    container.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => {
      const r = getRoom(b.dataset.close);
      if (!r || !UI.confirmDialog('Tutup ruang ini? Mentee di dalamnya akan keluar.')) return;
      saveRoom(Object.assign({}, r, { status: 'closed', phase: 'end' }));
      re();
    }));
    container.querySelector('#mbkCreate').addEventListener('click', () => {
      const title = container.querySelector('#mbkTitle').value.replace(/[<>]/g, '').trim() || kind.name;
      const qs = shuffle(Games.poolFor(game, hostView.subject), Math.random).slice(0, hostView.count);
      if (!qs.length) { UI.toast('Soal belum tersedia.', 'error'); return; }
      const room = {
        id: uid('gr'), code: newCode(), kind: hostView.kind, hostId: user.id, title: title.slice(0, 80), subject: hostView.subject,
        status: 'lobby', phase: 'lobby', round: 0, roundSec: hostView.roundSec, qids: qs.map(q => q._ref), playerIds: [],
        track: hostView.kind === 'race' ? hostView.track : null, laps: hostView.kind === 'race' ? hostView.laps : null,
        state: {}, createdAt: clock(), updatedAt: clock()
      };
      if (room.kind !== 'race') { delete room.track; delete room.laps; }
      saveRoom(room);
      openHost(container, user, room.id);
    });
    if (global.Responsive) Responsive.apply(container);
  }

  function openHost(container, user, roomId) {
    const s = startLive({ host: true, roomId, el: container, user });
    s.sig = '';
    s.onData = () => hostPaint(s);
    s.every(300, () => hostTick(s));
    hostPaint(s);
  }

  /** Bingkai tuan rumah: kode ruang, layar penuh, tutup. */
  function hostFrame(s, room) {
    const k = KINDS[room.kind];
    s.el.innerHTML = `<div class="mbk-host" style="--gc:${k.color}">
        <div class="mbk-bar">
          <button type="button" class="btn btn-sm btn-secondary" data-mbk="back">${ic('left', 14)} Kembali</button>
          <div class="mbk-bar-t"><strong>${esc(room.title)}</strong><small>${esc(k.name)}${room.kind === 'race' ? ' • ' + esc((RE.TRACK[room.track] || RE.TRACKS[0]).name) + ' • ' + room.laps + ' putaran' : ''}</small></div>
          <div class="mbk-code" aria-label="Kode ruang">${ic('users', 16)} Kode <b>${esc(room.code)}</b></div>
          <button type="button" class="icon-btn" data-mbk="full" aria-label="Layar penuh" title="Layar penuh (proyektor)">${ic('screen', 18)}</button>
          <button type="button" class="btn btn-sm btn-ghost" data-mbk="close">${room.status === 'done' ? 'Selesai' : 'Tutup ruang'}</button>
        </div>
        <div class="mbk-stage" id="mbkStage"></div>
      </div>`;
    s.el.querySelector('[data-mbk="back"]').addEventListener('click', () => { const c = s.el, u = s.user; stop(); renderHost(c, u); });
    s.el.querySelector('[data-mbk="full"]').addEventListener('click', () => {
      const el = s.el.querySelector('.mbk-host');
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (el.requestFullscreen) el.requestFullscreen().catch(() => UI.toast('Layar penuh tidak tersedia di peramban ini.', 'info'));
    });
    s.el.querySelector('[data-mbk="close"]').addEventListener('click', () => {
      const r = getRoom(s.roomId);
      if (r && r.status !== 'done' && r.status !== 'closed') {
        if (!UI.confirmDialog('Tutup ruang? Permainan dihentikan untuk semua mentee.')) return;
        saveRoom(Object.assign({}, r, { status: 'closed', phase: 'end' }));
      }
      const c = s.el, u = s.user; stop(); renderHost(c, u);
    });
  }

  function hostPaint(s) {
    const room = getRoom(s.roomId);
    if (!room) { const c = s.el, u = s.user; stop(); renderHost(c, u); return; }
    const players = playersOf(room.id);
    // Daftar pemain di ruang (untuk sinyal realtime ke HP siswa).
    const ids = players.map(p => p.userId);
    if (room.status !== 'done' && room.status !== 'closed' && ids.join() !== (room.playerIds || []).join()) saveRoom(Object.assign({}, room, { playerIds: ids.slice(0, 200) }));
    const sig = [room.status, room.phase, room.round].join('|');
    if (!s.el.querySelector('#mbkStage') || s.frameStatus !== room.status) { hostFrame(s, room); s.sig = ''; s.frameStatus = room.status; }
    const stage = s.el.querySelector('#mbkStage');
    if (sig !== s.sig) {
      s.sig = sig;
      if (s.race) { s.race.destroy(); s.race = null; }
      if (room.status === 'lobby') hostLobby(s, stage, room, players);
      else if (room.status === 'playing' && room.kind === 'raid') raidHostScene(s, stage, room, players);
      else if (room.status === 'playing' && room.kind === 'race') raceHostScene(s, stage, room, players);
      else hostResults(s, stage, room, players);
    } else if (s.update) s.update(room, players);
  }

  function hostLobby(s, stage, room, players) {
    const k = KINDS[room.kind];
    stage.innerHTML = `<div class="mbk-lobby">
        <div class="mbk-join-card"><p>Buka LMS di HP → <b>Game Battle</b> → <b>Main Bareng</b>, lalu masukkan kode:</p>
          <div class="mbk-bigcode">${room.code.split('').map(c => `<span>${esc(c)}</span>`).join('')}</div>
          <p class="muted small">${esc(k.desc)}</p>
          <button type="button" class="btn btn-primary btn-lg" id="mbkStart" ${players.length ? '' : 'disabled'}>${ic('play', 18)} Mulai (${players.length} mentee)</button></div>
        <div class="mbk-roster"><h3>${ic('users', 18)} Mentee bergabung <b id="mbkN">${players.length}</b></h3><div class="mbk-roster-list" id="mbkRoster"></div></div>
      </div>`;
    const paintRoster = (ps) => {
      stage.querySelector('#mbkN').textContent = ps.length;
      const btn = stage.querySelector('#mbkStart');
      btn.disabled = !ps.length;
      btn.innerHTML = `${ic('play', 18)} Mulai (${ps.length} mentee)`;
      stage.querySelector('#mbkRoster').innerHTML = ps.length ? ps.map(p => `<div class="mbk-chip">${avatarChip(p.userId, room.kind === 'raid'
        ? (p.role ? `<em style="--rc:${Art.ROLES[p.role].color}">${ic(Art.ROLES[p.role].icon, 12)} ${esc(Art.ROLES[p.role].name)}</em>` : '<em class="muted">memilih peran…</em>')
        : `<i class="mbk-car-dot" style="background:${Art.CAR_COLORS[(p.color || 0) % 12]}"></i>`)}</div>`).join('')
        : '<div class="empty"><div class="empty-icon">📱</div>Belum ada mentee. Minta mentee memasukkan kode di atas.</div>';
    };
    paintRoster(players);
    s.update = (r, ps) => paintRoster(ps);
    stage.querySelector('#mbkStart').addEventListener('click', () => {
      const r = getRoom(s.roomId);
      const ps = playersOf(s.roomId);
      if (!r || !ps.length) return;
      beep('go');
      if (r.kind === 'raid') raidStart(r, ps);
      else saveRoom(Object.assign({}, r, { status: 'playing', phase: 'race', startIn: 6000, startAt: clock() + 6000, phaseAt: clock(), phaseEndsAt: clock() + 9 * 60000, results: null }));
    });
  }

  /* ---------------- Monster Co-op: wasit di perangkat tuan rumah ---------------- */
  const MAX_ROUNDS = 30;
  const memberOf = (p) => ({ hp: 100, max: 100, ko: false, role: p.role || 'penyerang' });
  function raidStart(room, players) {
    const party = {};
    players.forEach(p => { party[p.userId] = memberOf(p); });
    const n = Math.max(1, players.length);
    const M = Art.MONSTERS.goblin;
    const raid = { stage: 0, monster: { kind: 'goblin', hp: M.hpPer * n, max: M.hpPer * n }, party, totals: {}, last: null, victory: false };
    const t = clock();
    saveRoom(Object.assign({}, room, { status: 'playing', phase: 'question', round: 1, phaseAt: t, phaseEndsAt: t + room.roundSec * 1000, state: { raid } }));
  }
  function raidQuestion(room, round) { return resolveRef(room.qids[(round - 1) % room.qids.length]); }
  function hostTick(s) {
    const room = getRoom(s.roomId);
    if (!room || room.status !== 'playing') return;
    const t = clock();
    if (room.kind === 'raid') {
      if (room.phase === 'question' && s.resolved !== room.round) {
        const R = room.state.raid;
        const ps = playersOf(room.id);
        const inParty = ps.filter(p => R.party[p.userId]);
        const answered = inParty.filter(p => p.ans && p.ans[room.round]);
        const all = inParty.length > 0 && answered.length >= inParty.length;
        if (t >= room.phaseEndsAt + 1500 || (all && t >= room.phaseAt + 2000)) { s.resolved = room.round; raidResolve(room, ps); }
      } else if (room.phase === 'resolve' && t >= room.phaseEndsAt && s.advanced !== room.round) {
        s.advanced = room.round;
        raidNext(room);
      }
      if (s.tick) s.tick(room);
    } else if (room.kind === 'race') {
      if (s.tick) s.tick(room);
    }
  }
  function raidResolve(room, players) {
    const R = clone(room.state.raid);
    const r = room.round;
    const q = raidQuestion(room, r);
    const byId = new Map(players.map(p => [p.userId, p]));
    players.forEach(p => { if (!R.party[p.userId]) R.party[p.userId] = memberOf(p); });
    const ev = {};
    let total = 0, guard = 1, weaken = 1;
    const taunts = [], heals = [];
    Object.keys(R.party).forEach(u => {
      const m = R.party[u];
      const p = byId.get(u);
      const a = p && p.ans && p.ans[r];
      if (!a) { ev[u] = { none: true }; return; }
      const ok = q ? !!Exam.gradeQuestion(q, a.o).correct : !!a.ok;
      const crit = ok && Number(a.ms) <= room.roundSec * 1000 * (1 - AR.CRIT_AT);
      const list = AR.SKILLS[m.role] || AR.SKILLS.penyerang;
      const sk = list.find(x => x.id === a.sk) || list[0];
      const tt = R.totals[u] || (R.totals[u] = { dmg: 0, heal: 0, ok: 0, n: 0 });
      tt.n++; if (ok) tt.ok++;
      ev[u] = { ok, crit, sk: sk.id };
      if (m.ko) { if (ok) { m.ko = false; m.hp = 30; ev[u].revived = true; } return; }
      if (!ok) { if (sk.risk) { m.hp -= sk.risk; ev[u].self = sk.risk; if (m.hp <= 0) { m.hp = 0; m.ko = true; } } return; }
      const dmg = Math.round(sk.dmg * AR.diffMult(q) * (crit ? AR.CRIT_MULT : 1));
      total += dmg; tt.dmg += dmg; ev[u].dmg = dmg;
      if (sk.guard) guard = Math.min(guard, 1 - sk.guard);
      if (sk.taunt) taunts.push(u);
      if (sk.weaken) weaken = Math.min(weaken, 1 - sk.weaken);
      if (sk.heal || sk.healAll) heals.push({ u, sk, crit });
    });
    heals.forEach(h => {
      const amt = Math.round((h.sk.heal || h.sk.healAll) * (h.crit ? 1.5 : 1));
      let real = 0;
      if (h.sk.healAll) {
        Object.values(R.party).forEach(m => { if (!m.ko) { const d = Math.min(amt, m.max - m.hp); m.hp += d; real += d; } });
      } else {
        const ko = Object.keys(R.party).find(u => R.party[u].ko);
        const tgt = ko || Object.keys(R.party).filter(u => !R.party[u].ko && R.party[u].hp < R.party[u].max).sort((a, b) => R.party[a].hp / R.party[a].max - R.party[b].hp / R.party[b].max)[0];
        if (tgt) {
          const m = R.party[tgt];
          if (m.ko) { m.ko = false; m.hp = Math.min(m.max, amt); real = m.hp; ev[tgt] = Object.assign(ev[tgt] || {}, { revivedBy: h.u }); }
          else { real = Math.min(amt, m.max - m.hp); m.hp += real; }
          ev[h.u].healed = tgt;
        }
      }
      ev[h.u].heal = real;
      R.totals[h.u].heal += real;
    });
    R.monster.hp = Math.max(0, R.monster.hp - total);
    let outcome = 'continue';
    const hits = [];
    if (R.monster.hp <= 0) outcome = R.stage >= AR.MON_ORDER.length - 1 ? 'victory' : 'next';
    else {
      const M = Art.MONSTERS[R.monster.kind];
      const alive = Object.keys(R.party).filter(u => !R.party[u].ko);
      const tauntAlive = taunts.filter(u => !R.party[u].ko);
      const targets = tauntAlive.length ? tauntAlive : (M.hits >= alive.length ? alive : shuffle(alive, Math.random).slice(0, M.hits));
      const base = M.atk + R.stage * 2;
      targets.forEach(u => {
        const m = R.party[u];
        const d = Math.max(1, Math.round((base + Math.floor(Math.random() * 5) - 2) * guard * weaken * (tauntAlive.includes(u) ? 0.5 : 1)));
        m.hp -= d;
        if (m.hp <= 0) { m.hp = 0; m.ko = true; }
        hits.push({ u, d, ko: m.ko });
      });
      if (Object.values(R.party).every(m => m.ko)) outcome = 'defeat';
    }
    R.last = { round: r, ev, hits, total, guard: guard < 1, weaken: weaken < 1, outcome, monster: R.monster.kind };
    const t = clock();
    saveRoom(Object.assign({}, room, { phase: 'resolve', phaseAt: t, phaseEndsAt: t + 6500, state: { raid: R } }));
  }
  function raidNext(room) {
    const R = clone(room.state.raid);
    const o = R.last && R.last.outcome;
    if (o === 'victory' || o === 'defeat' || room.round >= MAX_ROUNDS) return raidEnd(room, R, o === 'victory');
    if (o === 'next') {
      R.stage++;
      const kind = AR.MON_ORDER[R.stage];
      const n = Math.max(1, Object.keys(R.party).length);
      const M = Art.MONSTERS[kind];
      R.monster = { kind, hp: M.hpPer * n, max: M.hpPer * n };
      Object.values(R.party).forEach(m => { if (m.ko) { m.ko = false; m.hp = 30; } else m.hp = Math.min(m.max, m.hp + 25); });
    }
    const t = clock();
    saveRoom(Object.assign({}, room, { phase: 'question', round: room.round + 1, phaseAt: t, phaseEndsAt: t + room.roundSec * 1000, state: { raid: R } }));
  }
  function raidEnd(room, R, victory) {
    R.victory = !!victory;
    const results = Object.keys(R.party).map(u => Object.assign({ uid: u }, R.totals[u] || { dmg: 0, heal: 0, ok: 0, n: 0 }))
      .sort((a, b) => (b.dmg + b.heal) - (a.dmg + a.heal)).map((x, i) => Object.assign(x, { pos: i + 1 }));
    saveRoom(Object.assign({}, room, { status: 'done', phase: 'end', state: { raid: R }, results, endedAt: clock() }));
  }

  /* ---------------- Monster Co-op: layar tuan rumah ---------------- */
  function partyCard(u, m, extra) {
    return `<div class="mbk-mem ${m.ko ? 'is-ko' : ''}" data-u="${esc(u)}" style="--rc:${Art.ROLES[m.role] ? Art.ROLES[m.role].color : '#64748b'}">
      <span class="mbk-mem-fig">${Art.hero(m.role, { ko: m.ko })}</span>
      <span class="mbk-mem-main"><b>${esc(firstName(u))}</b><span class="mbk-mem-hp"><i style="width:${m.hp / m.max * 100}%"></i></span></span>
      <span class="mbk-mem-st">${extra || ''}</span></div>`;
  }
  function raidHostScene(s, stage, room) {
    const R = room.state.raid;
    const q = raidQuestion(room, room.round);
    const M = Art.MONSTERS[R.monster.kind];
    stage.innerHTML = `<div class="mbk-raid">
        <div class="mbk-raid-top"><span>${ic('skull', 16)} Monster <b>${R.stage + 1}/3</b> — ${esc(M.title)}</span><span>Ronde <b>${room.round}</b></span>
          <span class="mbk-raid-timer"><span class="ar-oq-bar"><i id="mbkBar"></i></span><b id="mbkSec"></b></span></div>
        <div class="mbk-raid-scene">
          <div class="mbk-party" id="mbkParty"></div>
          <div class="mbk-boss"><div class="ar-hp is-mon mbk-boss-hp"><i style="width:${R.monster.hp / R.monster.max * 100}%"></i><b>${Math.round(R.monster.hp)}/${R.monster.max}</b></div>
            <div class="mbk-boss-fig">${Art.monster(R.monster.kind, room.phase === 'question' && room.round === 1 ? 'is-enter' : '')}</div></div>
          <div class="ar-fx" id="mbkFx" aria-hidden="true"></div>
        </div>
        <div class="mbk-raid-q" id="mbkQ"></div>
      </div>`;
    const party = stage.querySelector('#mbkParty'), qEl = stage.querySelector('#mbkQ'), fx = stage.querySelector('#mbkFx');
    const paintParty = (r, ps) => {
      const RR = r.state.raid;
      const ans = new Set(ps.filter(p => p.ans && p.ans[r.round]).map(p => p.userId));
      party.innerHTML = Object.keys(RR.party).map(u => partyCard(u, RR.party[u], r.phase === 'question' ? (ans.has(u) ? `<span class="mbk-ok">${ic('check', 14)}</span>` : '<span class="mbk-wait"></span>') : '')).join('');
      const cnt = stage.querySelector('#mbkAns');
      if (cnt) cnt.textContent = `${ans.size}/${Object.keys(RR.party).length} menjawab`;
    };
    paintParty(room, playersOf(room.id));
    if (room.phase === 'question') {
      qEl.innerHTML = q ? `<div class="mbk-q-head"><span class="gb-qnum">Soal ronde ${room.round}</span><span class="mbk-ans-n" id="mbkAns"></span></div><div class="gb-qtext">${rt(q.text)}</div>
        ${Array.isArray(q.options) && (q.questionType || 'Pilihan Ganda') === 'Pilihan Ganda' ? `<ol class="mbk-q-opts">${q.options.map((o, i) => `<li><b>${String.fromCharCode(65 + i)}</b> ${rt(o)}</li>`).join('')}</ol>` : '<p class="muted small">Jawab di HP masing-masing.</p>'}`
        : '<p class="muted">Soal tidak ditemukan — ronde ini dilewati.</p>';
      paintParty(room, playersOf(room.id));
    } else {
      const L = R.last || { ev: {}, hits: [] };
      const hitList = Object.keys(L.ev).filter(u => L.ev[u].dmg);
      const lines = [];
      if (L.total) lines.push(`<b>${hitList.length}</b> jurus mengenai monster: <b class="mbk-dmg">−${L.total}</b>`);
      Object.keys(L.ev).forEach(u => {
        const e = L.ev[u];
        if (e.revived) lines.push(`${esc(firstName(u))} bangkit kembali!`);
        if (e.heal) lines.push(`${esc(firstName(u))} memulihkan ${e.heal} HP${e.healed && e.healed !== u ? ' ' + esc(firstName(e.healed)) : ''}`);
      });
      if (L.guard) lines.push('Perisai Penjaga menahan serangan');
      if (L.weaken) lines.push('Kutukan melemahkan monster');
      if (L.hits.length) lines.push(`${esc(Art.MONSTERS[L.monster].name)} membalas ${L.hits.length} siswa${L.hits.some(h => h.ko) ? ` — ${L.hits.filter(h => h.ko).map(h => esc(firstName(h.u))).join(', ')} pingsan` : ''}`);
      if (L.outcome === 'next') lines.push(`<b>${esc(Art.MONSTERS[L.monster].title)} kalah!</b> Monster berikutnya datang…`);
      if (L.outcome === 'victory') lines.push('<b>Golem raksasa runtuh — kelas menang!</b>');
      if (L.outcome === 'defeat') lines.push('<b>Semua mentee pingsan…</b>');
      qEl.innerHTML = `<div class="mbk-q-head"><span class="gb-qnum">Hasil ronde ${room.round}</span><span class="muted small">Kunci: ${q ? esc(Games.keyText(q)) : '-'}</span></div><ul class="mbk-log">${lines.map(l => `<li>${l}</li>`).join('') || '<li>Tidak ada yang menjawab ronde ini.</li>'}</ul>`;
      // Putar animasi: jurus satu per satu, lalu monster membalas.
      const fig = () => stage.querySelector('.mbk-boss .ga-monster');
      const anim = (el, cls, ms) => { if (!el) return; el.classList.remove(cls); void el.getBoundingClientRect(); el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); };
      const step = reducedMotion() ? 60 : Math.max(90, Math.min(260, 2400 / Math.max(1, hitList.length)));
      hitList.forEach((u, i) => s.after(300 + i * step, () => {
        const e = L.ev[u];
        anim(fig(), 'is-hit', 420);
        AR.floatNum(fx, (e.crit ? 'KRITIS −' : '−') + e.dmg, e.crit ? 'is-crit' : 'is-dmg', 64 + Math.random() * 22, 18 + Math.random() * 30);
        if (!reducedMotion()) { const p = document.createElement('span'); p.className = 'ar-proj is-' + (Object.keys(AR.SKILLS).find(k => AR.SKILLS[k].some(x => x.id === e.sk)) || 'penyerang'); p.style.top = (30 + Math.random() * 40) + '%'; fx.appendChild(p); setTimeout(() => p.remove(), 700); }
        if (i % 3 === 0) beep('pop');
      }));
      const tAtk = 400 + hitList.length * step + 300;
      s.after(tAtk, () => {
        if (L.outcome === 'next' || L.outcome === 'victory') { anim(fig(), 'is-down', 1300); beep('win'); return; }
        anim(fig(), 'is-attack', 600);
        if (!reducedMotion()) anim(stage.querySelector('.mbk-raid-scene'), 'is-shake', 400);
        s.after(300, () => {
          L.hits.forEach(h => {
            const card = party.querySelector(`[data-u="${CSS.escape(h.u)}"]`);
            if (card) { anim(card, 'is-hurt', 500); const r = card.getBoundingClientRect(), sr = stage.querySelector('.mbk-raid-scene').getBoundingClientRect(); AR.floatNum(fx, '−' + h.d, 'is-dmg', ((r.left + r.width / 2 - sr.left) / sr.width) * 100, ((r.top - sr.top) / sr.height) * 100); }
          });
          paintParty(room, playersOf(room.id));
          beep('bad');
        });
      });
    }
    s.update = (r, ps) => { if (r.phase === 'question') paintParty(r, ps); };
    s.tick = (r) => {
      const tb = timerBar(r.phaseEndsAt, r.phase === 'question' ? r.roundSec * 1000 : 6500);
      const bar = stage.querySelector('#mbkBar'), sec = stage.querySelector('#mbkSec');
      if (bar) { bar.style.width = tb.pct + '%'; sec.textContent = r.phase === 'question' ? tb.sec + ' dtk' : 'hasil…'; }
    };
  }

  function hostResults(s, stage, room, players) {
    s.update = null; s.tick = null;
    if (room.status === 'closed') { stage.innerHTML = '<div class="empty"><div class="empty-icon">🚪</div>Ruang ditutup.</div>'; return; }
    const res = room.results || [];
    if (room.kind === 'raid') {
      const R = room.state.raid || {};
      stage.innerHTML = `<div class="mbk-final ${R.victory ? 'is-win' : ''}">
        <div class="mbk-final-ic">${R.victory ? ic('trophy', 54) : ic('skull', 54)}</div>
        <h2>${R.victory ? 'Kelas mengalahkan Golem raksasa!' : `Pertarungan berakhir di monster ${(R.stage || 0) + 1}/3`}</h2>
        <p class="muted">${room.round} ronde • ${players.length} mentee</p>
        <ol class="mbk-podium">${res.slice(0, 10).map(x => `<li><span class="mbk-pos">${x.pos}</span>${avatarChip(x.uid)}<span class="mbk-stat">${ic('sword', 14)} ${fmt(x.dmg)} • ${ic('heart', 14)} ${fmt(x.heal)} • ${x.ok}/${x.n} benar</span></li>`).join('')}</ol>
      </div>`;
      if (R.victory && global.Birthday && Birthday.confetti) Birthday.confetti(stage);
    } else {
      stage.innerHTML = `<div class="mbk-final is-win"><div class="mbk-final-ic">${ic('flag', 54)}</div><h2>Balapan selesai!</h2>
        <ol class="mbk-podium">${res.slice(0, 12).map(x => `<li><span class="mbk-pos">${x.pos}</span><i class="mbk-car-dot" style="background:${Art.CAR_COLORS[(x.color || 0) % 12]}"></i>${avatarChip(x.uid)}
          <span class="mbk-stat">${x.fin ? (x.fin / 1000).toFixed(1) + ' dtk' : 'belum finis'} • ${x.ok} benar</span></li>`).join('')}</ol></div>`;
      if (res.length && global.Birthday && Birthday.confetti) Birthday.confetti(stage);
    }
    beep('win');
  }

  /* ---------------- Balap Kelas: layar tuan rumah ---------------- */
  const carEst = (car, course) => {
    if (!car) return 0;
    if (car.fin) return course.total;
    return Math.min(course.total, car.d + car.v * Math.max(0, clock() - car.at) / 1000);
  };
  const correctCount = (room, p) => Object.keys(p.ans || {}).filter(k => { const a = p.ans[k]; const q = resolveRef(room.qids[Number(k) % room.qids.length]); return q ? Exam.gradeQuestion(q, a.o).correct : a.ok; }).length;
  function raceHostScene(s, stage, room) {
    const course = RE.buildCourse(room.track, room.laps, hashStr(room.id));
    stage.innerHTML = `<div class="mbk-race">
        <div class="mbk-race-map" id="mbkMap"></div>
        <div class="mbk-race-side"><div class="mbk-race-clock" id="mbkClock"></div><ol class="mbk-race-board" id="mbkBoard"></ol><ul class="mbk-feed" id="mbkFeed" aria-live="polite"></ul></div>
        <div class="mbk-count" id="mbkCount" hidden></div>
      </div>`;
    const map = RE.mountMap(stage.querySelector('#mbkMap'), course, { labels: true });
    s.race = { destroy: () => map.destroy() };
    const shown = new Map();
    const seenEv = new Set();
    let feed = [];
    const addFeed = (html) => { feed.unshift(html); feed = feed.slice(0, 8); stage.querySelector('#mbkFeed').innerHTML = feed.map(f => `<li>${f}</li>`).join(''); };
    playersOf(room.id).forEach(p => (p.ev || []).forEach(e => seenEv.add(p.userId + ':' + e.n)));
    s.update = null;
    s.tick = (r) => {
      const t = clock();
      const cnt = stage.querySelector('#mbkCount');
      const ps = playersOf(r.id);
      if (t < r.startAt) { cnt.hidden = false; cnt.innerHTML = `<b>${Math.ceil((r.startAt - t) / 1000)}</b><span>Bersiap di HP masing-masing…</span>`; }
      else cnt.hidden = true;
      const cars = ps.map(p => {
        const d = carEst(p.car, course);
        const prev = shown.has(p.userId) ? shown.get(p.userId) : d;
        const sm = prev + (d - prev) * 0.35;
        shown.set(p.userId, sm);
        return { id: p.userId, d: sm, est: d, color: Art.CAR_COLORS[(p.color || 0) % 12], name: firstName(p.userId), fin: p.car && p.car.fin, it: p.car && p.car.it, p };
      });
      map.update(cars);
      const order = cars.slice().sort((a, b) => (a.fin && b.fin ? a.fin - b.fin : a.fin ? -1 : b.fin ? 1 : b.est - a.est));
      stage.querySelector('#mbkBoard').innerHTML = order.map((c, i) => `<li class="${c.fin ? 'is-fin' : ''}"><span class="mbk-pos">${i + 1}</span><i class="mbk-car-dot" style="background:${c.color}"></i><b>${esc(c.name)}</b>
        <span class="mbk-lap">${c.fin ? ic('flag', 13) + ' ' + ((c.fin - r.startAt) / 1000).toFixed(1) + 's' : 'P' + Math.min(r.laps, Math.floor(c.est / RE.LAP) + 1) + '/' + r.laps}</span>${c.it ? `<span class="mbk-it" title="${esc(RE.ITEMS[c.it].name)}">${ic(RE.ITEMS[c.it].icon, 13)}</span>` : ''}</li>`).join('') || '<li class="muted">Belum ada mobil.</li>';
      const el = t - r.startAt;
      stage.querySelector('#mbkClock').innerHTML = el > 0 ? `${ic('clock', 14)} ${Math.floor(el / 60000)}:${String(Math.floor(el / 1000) % 60).padStart(2, '0')}` : `${ic('clock', 14)} 0:00`;
      ps.forEach(p => (p.ev || []).forEach(e => {
        const k = p.userId + ':' + e.n;
        if (seenEv.has(k)) return;
        seenEv.add(k);
        addFeed(`${ic('oil', 13)} <b>${esc(firstName(p.userId))}</b> melempar oli ke <b>${esc(firstName(e.to))}</b>`);
      }));
      order.forEach(c => { if (c.fin && !shown.has('fin:' + c.id)) { shown.set('fin:' + c.id, 1); addFeed(`${ic('flag', 13)} <b>${esc(c.name)}</b> finis posisi ${order.filter(x => x.fin).indexOf(c) + 1}`); } });
      // Selesai: semua finis, 60 detik setelah juara 1, atau batas 9 menit.
      const fins = order.filter(c => c.fin);
      const firstFin = fins.length ? Math.min(...fins.map(c => c.fin)) : 0;
      if (t > r.startAt && !s.ended && ((ps.length && fins.length === ps.length) || (firstFin && t - firstFin > 60000) || t - r.startAt > 9 * 60000)) {
        s.ended = true;
        const results = order.map((c, i) => ({ uid: c.id, pos: i + 1, fin: c.fin ? c.fin - r.startAt : null, d: Math.round(c.est), ok: correctCount(r, c.p), color: c.p.color || 0 }));
        saveRoom(Object.assign({}, r, { status: 'done', phase: 'end', results, endedAt: t }));
      }
    };
  }
  function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  /* =================================================================
   * SISWA
   * ===============================================================*/
  function renderJoin(container, user, opts) {
    const o = opts || {};
    if (live && !live.host && live.el === container && live.el.isConnected) return;
    stop();
    // Lanjutkan ruang yang masih berjalan, atau tampilkan hasil yang belum tercatat (≤ 2 jam).
    const mineActive = load(K.players).filter(p => p.userId === user.id)
      .map(p => ({ p, r: getRoom(p.roomId) }))
      .filter(x => isActive(x.r) || (x.r && x.r.status === 'done' && !x.p.saved && clock() - (x.r.endedAt || x.r.updatedAt || 0) < 2 * 3600000))
      .map(x => x.r).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    if (mineActive && !o.noResume) return openPlayer(container, user, mineActive.id);
    const openRooms = load(K.rooms).filter(r => isActive(r)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 8);
    container.innerHTML = `<div class="mbk-wrap">
      <div class="card mbk-joinbox">
        <div class="card-header">${UI.secHead('🎪', 'Main Bareng Kelas', 'masukkan kode 6 huruf dari tutor')}</div>
        <form class="mbk-codeform" id="mbkForm" autocomplete="off">
          <input id="mbkCodeIn" class="mbk-code-in" maxlength="6" placeholder="KODE" aria-label="Kode ruang" autocapitalize="characters" spellcheck="false" />
          <button type="submit" class="btn btn-primary btn-lg">${ic('play', 16)} Gabung</button>
        </form>
        <div class="mbk-kinds is-info">${Object.values(KINDS).map(k => `<div class="mbk-kind" style="--gc:${k.color}"><span class="mbk-kind-art">${Art.cardArt(k.art)}</span><strong>${esc(k.name)}</strong><small>${esc(k.desc)}</small></div>`).join('')}</div>
      </div>
      ${openRooms.length ? `<div class="card"><div class="card-header">${UI.secHead('🟢', 'Ruang yang sedang dibuka', 'ketuk untuk bergabung')}</div>
        ${openRooms.map(r => `<div class="gb-inv-row"><span class="mbk-kind-ic" style="--gc:${KINDS[r.kind].color}">${ic(KINDS[r.kind].icon, 20)}</span>
          <div class="gb-inv-main"><strong>${esc(r.title)}</strong><div class="muted small">${esc(KINDS[r.kind].name)} • ${esc(userName(r.hostId))} • ${playersOf(r.id).length} mentee • ${r.status === 'lobby' ? 'menunggu mulai' : 'sedang bermain'}</div></div>
          <button type="button" class="btn btn-sm btn-primary" data-join="${esc(r.code)}">Gabung</button></div>`).join('')}</div>` : ''}
    </div>`;
    const inp = container.querySelector('#mbkCodeIn');
    inp.addEventListener('input', () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
    const join = async (code, btn) => {
      code = String(code || '').toUpperCase().trim();
      if (code.length !== 6) { UI.toast('Kode ruang terdiri dari 6 huruf/angka.', 'info'); return; }
      let room = load(K.rooms).find(r => r.code === code);
      if (!room && server()) { if (btn) UI.setBusy(btn, true); try { await Sync.syncNow('room-join'); } catch (e) { /* noop */ } if (btn) UI.setBusy(btn, false); room = load(K.rooms).find(r => r.code === code); }
      if (!room) { UI.toast('Kode ruang tidak ditemukan. Periksa lagi kodenya.', 'error'); return; }
      if (!isActive(room)) { UI.toast('Ruang ini sudah selesai atau ditutup.', 'info'); return; }
      if (!container.isConnected) return;
      let p = myPlayer(room.id, user.id);
      if (!p) {
        p = { id: room.id + ':' + user.id, roomId: room.id, hostId: room.hostId, userId: user.id, role: null, color: playersOf(room.id).length % 12, ans: {}, joinedAt: clock(), at: clock() };
        savePlayer(p);
      }
      beep('go');
      openPlayer(container, user, room.id);
    };
    container.querySelector('#mbkForm').addEventListener('submit', (e) => { e.preventDefault(); join(inp.value, e.submitter || container.querySelector('#mbkForm button')); });
    container.querySelectorAll('[data-join]').forEach(b => b.addEventListener('click', () => join(b.dataset.join, b)));
    try { inp.focus({ preventScroll: true }); } catch (e) { /* noop */ }
  }

  function openPlayer(container, user, roomId) {
    const s = startLive({ host: false, roomId, el: container, user });
    s.sig = '';
    s.onData = () => playerPaint(s);
    s.every(250, () => { const r = getRoom(s.roomId); if (r && s.tick) s.tick(r); });
    playerPaint(s);
    try { container.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }); } catch (e) { /* noop */ }
  }
  function playerFrame(s, room) {
    const k = KINDS[room.kind];
    s.el.innerHTML = `<div class="mbk-phone" style="--gc:${k.color}">
        <div class="mbk-bar is-phone">
          <button type="button" class="btn btn-sm btn-secondary" data-mbk="leave">${ic('left', 14)} Keluar</button>
          <div class="mbk-bar-t"><strong>${esc(room.title)}</strong><small>${esc(k.name)} • kode ${esc(room.code)}</small></div>
          <span class="mbk-me">${avatarChip(s.user.id)}</span>
          ${global.GameFS ? GameFS.buttonHtml() : ''}
        </div>
        <div class="mbk-stage" id="mbkStage"></div></div>`;
    if (global.GameFS) {
      const release = GameFS.bind(s.el.querySelector('.mbk-phone'));
      s.onDispose(() => release());
    }
    s.el.querySelector('[data-mbk="leave"]').addEventListener('click', () => {
      const r = getRoom(s.roomId);
      if (r && r.status === 'playing' && !UI.confirmDialog('Keluar dari permainan? Kamu bisa bergabung lagi dengan kode yang sama.')) return;
      const c = s.el, u = s.user; stop(); renderJoin(c, u, { noResume: true });
    });
  }
  function playerPaint(s) {
    const room = getRoom(s.roomId);
    if (!room) { const c = s.el, u = s.user; stop(); renderJoin(c, u, { noResume: true }); return; }
    const me = myPlayer(room.id, s.user.id);
    if (!me) { const c = s.el, u = s.user; stop(); renderJoin(c, u, { noResume: true }); return; }
    if (!s.el.querySelector('#mbkStage')) playerFrame(s, room);
    const stage = s.el.querySelector('#mbkStage');
    const answered = room.kind === 'raid' && me.ans && me.ans[room.round] ? 1 : 0;
    const sig = [room.status, room.phase, room.round, room.kind === 'raid' ? answered : '', room.kind === 'raid' && room.status === 'lobby' ? me.role : ''].join('|');
    if (sig !== s.sig) {
      if (room.kind === 'race' && room.status === 'playing' && s.drive) { s.sig = sig; return; }
      s.sig = sig;
      if (s.drive) { s.drive.destroy(); s.drive = null; }
      s.tick = null; s.update = null;
      if (room.status === 'lobby') playerLobby(s, stage, room, me);
      else if (room.status === 'playing' && room.kind === 'raid') raidPlayer(s, stage, room, me);
      else if (room.status === 'playing' && room.kind === 'race') racePlayer(s, stage, room, me);
      else playerResults(s, stage, room, me);
    } else if (s.update) s.update(room, me);
  }
  function playerLobby(s, stage, room, me) {
    if (room.kind === 'raid') {
      stage.innerHTML = `<div class="mbk-plobby"><h3 class="ar-h">${ic('users', 20)} Pilih peranmu</h3>${AR.roleCardsHtml()}
        <p class="mbk-waitmsg" id="mbkWait">${me.role ? `Peran: <b>${esc(Art.ROLES[me.role].name)}</b> • menunggu tutor memulai…` : 'Pilih satu peran, lalu tunggu tutor memulai.'}</p>
        <div class="mbk-team" id="mbkTeam"></div></div>`;
      stage.querySelectorAll('[data-role]').forEach(b => {
        b.classList.toggle('is-on', b.dataset.role === me.role);
        b.setAttribute('aria-pressed', String(b.dataset.role === me.role));
        b.addEventListener('click', () => { const cur = myPlayer(room.id, s.user.id); if (cur) { savePlayer(Object.assign({}, cur, { role: b.dataset.role }), 30); beep('pop'); } });
      });
    } else {
      stage.innerHTML = `<div class="mbk-plobby is-race"><div class="mbk-mycar">${Art.carSvg(Art.CAR_COLORS[(me.color || 0) % 12])}</div>
        <h3>Mobilmu siap di garis start</h3><p class="muted">${esc((RE.TRACK[room.track] || RE.TRACKS[0]).name)} • ${room.laps} putaran. Pegang HP tegak; tombol kiri/kanan untuk pindah lajur, tombol tengah untuk memakai item.</p>
        <p class="mbk-waitmsg">Menunggu tutor memulai balapan…</p><div class="mbk-team" id="mbkTeam"></div></div>`;
    }
    const team = (r) => { const el = stage.querySelector('#mbkTeam'); if (el) el.innerHTML = playersOf(r.id).map(p => `<span class="mbk-chip">${avatarChip(p.userId, room.kind === 'raid' && p.role ? `<em style="--rc:${Art.ROLES[p.role].color}">${ic(Art.ROLES[p.role].icon, 12)}</em>` : '')}</span>`).join(''); };
    team(room);
    s.update = (r) => team(r);
  }

  /* ---------------- Monster Co-op di HP ---------------- */
  function raidPlayer(s, stage, room, me) {
    const R = room.state.raid || {};
    const m = (R.party || {})[me.userId] || { hp: 100, max: 100, ko: false, role: me.role || 'penyerang' };
    const M = Art.MONSTERS[(R.monster || {}).kind || 'goblin'];
    const head = `<div class="mbk-phud"><span class="mbk-phud-me" style="--rc:${(Art.ROLES[m.role] || Art.ROLES.penyerang).color}">${ic((Art.ROLES[m.role] || Art.ROLES.penyerang).icon, 16)} ${esc((Art.ROLES[m.role] || Art.ROLES.penyerang).name)}
        <span class="mbk-mem-hp"><i style="width:${m.hp / m.max * 100}%"></i></span><b>${Math.round(m.hp)}</b></span>
      <span>${esc(M.name)} <span class="mbk-mem-hp is-mon"><i style="width:${R.monster ? R.monster.hp / R.monster.max * 100 : 100}%"></i></span></span></div>
      <div class="mbk-ptimer"><span class="ar-oq-bar"><i id="mbkBar"></i></span><b id="mbkSec"></b></div>`;
    const tick = (r) => { const tb = timerBar(r.phaseEndsAt, r.phase === 'question' ? r.roundSec * 1000 : 6500); const bar = stage.querySelector('#mbkBar'); if (bar) { bar.style.width = tb.pct + '%'; stage.querySelector('#mbkSec').textContent = r.phase === 'question' ? tb.sec + ' dtk' : ''; } };
    s.tick = tick;
    if (room.phase === 'question') {
      const mine = me.ans && me.ans[room.round];
      const q = raidQuestion(room, room.round);
      if (mine) {
        stage.innerHTML = `${head}<div class="mbk-sent ${mine.ok ? 'is-ok' : 'is-no'}">${ic(mine.ok ? 'check' : 'x', 34)}<h3>${mine.ok ? 'Jawabanmu benar!' : 'Jawabanmu belum tepat'}</h3>
          <p class="muted">${m.ko ? (mine.ok ? 'Kamu akan bangkit di akhir ronde.' : 'Kamu masih pingsan — coba lagi ronde berikutnya.') : (mine.ok ? 'Jurusmu akan dilancarkan di layar kelas.' : 'Jurusmu meleset ronde ini.')}</p>
          ${q && !mine.ok ? `<p class="small">Kunci: ${esc(Games.keyText(q))}</p>` : ''}<p class="mbk-waitmsg">Menunggu teman lain…</p></div>`;
        tick(room);
        return;
      }
      if (!q) { stage.innerHTML = `${head}<p class="muted">Soal ronde ini tidak tersedia di perangkatmu. Tunggu ronde berikutnya.</p>`; return; }
      const ask = (sk) => {
        stage.innerHTML = `${head}<div class="mbk-pq">${sk ? `<span class="gb-chip-s">${ic(sk.icon, 12)} ${esc(sk.name)}</span>` : `<span class="gb-chip-s d-sulit">${ic('heart', 12)} Jawab benar untuk bangkit</span>`}
          <div class="gb-qtext">${rt(q.text)}</div><div class="gb-ans"></div><div class="gb-fb" aria-live="polite"></div></div>`;
        tick(room);
        const shown = performance.now();
        const ansEl = stage.querySelector('.gb-ans');
        const ui = Games.AnswerUI.render(q, ansEl, (ans) => {
          const ok = !!Exam.gradeQuestion(q, ans).correct;
          ui.reveal(ok);
          const cur = myPlayer(room.id, s.user.id);
          if (!cur) return;
          const r2 = getRoom(room.id);
          if (!r2 || r2.round !== room.round || r2.phase !== 'question') { UI.toast('Waktu ronde sudah habis.', 'info'); return; }
          const a = Object.assign({}, cur.ans || {});
          a[room.round] = { o: ans, ok, ms: Math.round(performance.now() - shown), sk: sk ? sk.id : null };
          beep(ok ? 'ok' : 'bad');
          savePlayer(Object.assign({}, cur, { ans: a }), 900);
        }, { rng: Math.random });
        if (global.VoiceAnswer) VoiceAnswer.attach(ansEl, q, {});
      };
      if (m.ko) { ask(null); return; }
      const list = AR.SKILLS[m.role] || AR.SKILLS.penyerang;
      stage.innerHTML = `${head}<div class="mbk-pskills"><h3 class="ar-h">Ronde ${room.round}: pilih jurus</h3>
        <div class="ar-sk-row">${list.map((x, i) => `<button type="button" class="ar-sk" data-sk="${i}" style="--rc:${(Art.ROLES[m.role] || Art.ROLES.penyerang).color}">${ic(x.icon, 22)}<strong>${esc(x.name)}</strong><small>${esc(x.desc)}</small></button>`).join('')}</div>
        <p class="muted small">Jawab cepat (40% waktu pertama) untuk serangan kritis.</p></div>`;
      tick(room);
      stage.querySelectorAll('[data-sk]').forEach(b => b.addEventListener('click', () => { beep('pop'); ask(list[Number(b.dataset.sk)]); }));
      return;
    }
    // Hasil ronde untukku
    const L = R.last || { ev: {}, hits: [] };
    const e = L.ev[me.userId] || {};
    const hit = (L.hits || []).find(h => h.u === me.userId);
    const lines = [];
    if (e.none) lines.push('Kamu tidak menjawab ronde ini.');
    if (e.dmg) lines.push(`Jurusmu mengenai monster <b class="mbk-dmg">−${e.dmg}</b>${e.crit ? ' <b class="mbk-crit">KRITIS!</b>' : ''}`);
    if (e.ok === false && !e.none) lines.push('Jurusmu meleset.');
    if (e.self) lines.push(`Serangan berat membuatmu lelah −${e.self}`);
    if (e.revived) lines.push('Kamu bangkit kembali!');
    if (e.revivedBy) lines.push(`${esc(firstName(e.revivedBy))} membangkitkanmu!`);
    if (e.heal) lines.push(`Kamu memulihkan ${e.heal} HP${e.healed && e.healed !== me.userId ? ' untuk ' + esc(firstName(e.healed)) : ''}`);
    if (hit) lines.push(`${esc(Art.MONSTERS[L.monster].name)} menyerangmu −${hit.d}${hit.ko ? ' — kamu pingsan! Jawab benar ronde berikutnya untuk bangkit.' : ''}`);
    if (L.outcome === 'next') lines.push(`<b>${esc(Art.MONSTERS[L.monster].title)} kalah!</b>`);
    if (L.outcome === 'victory') lines.push('<b>Kelas menang!</b>');
    stage.innerHTML = `${head}<div class="mbk-presult"><h3>Hasil ronde ${room.round}</h3><ul class="mbk-log">${lines.map(l => `<li>${l}</li>`).join('')}</ul>
      <p class="muted small">Lihat pertarungannya di layar kelas.</p></div>`;
    tick(room);
  }

  /* ---------------- Balap Kelas di HP ---------------- */
  function racePlayer(s, stage, room, meRec) {
    const course = RE.buildCourse(room.track, room.laps, hashStr(room.id));
    const color = Art.CAR_COLORS[(meRec.color || 0) % 12];
    const startLane = [1, 0, 2][(meRec.color || 0) % 3];      // mobil di grid start tersebar ke 3 lajur
    const me = RE.createCar({ id: meRec.userId, name: 'Kamu', color, lane: startLane, lx: startLane });
    // Lanjutkan dari posisi tersimpan (mis. halaman dimuat ulang).
    if (meRec.car) { me.d = meRec.car.d; me.lane = me.lx = meRec.car.lane; me.gate = meRec.car.gate || course.gates.filter(g => g <= me.d).length; me.item = meRec.car.it || null; if (meRec.car.fin) me.fin = 1; }
    const puddles = [];
    const seen = new Set();
    // Baca ulang data ruang paling sering tiap 400 ms (bukan tiap frame).
    let cache = { t: -1e9, ps: [], room };
    const fresh = () => { const t = performance.now(); if (t - cache.t > 400) cache = { t, ps: playersOf(room.id), room: getRoom(room.id) || room }; return cache; };
    playersOf(room.id).forEach(p => (p.ev || []).forEach(e => seen.add(p.userId + ':' + e.n)));
    let oq = null, lastWrite = 0, dirty = true, evN = (meRec.ev || []).reduce((m, e) => Math.max(m, e.n), 0), msgT = null, saidStart = false;
    stage.innerHTML = `<div class="ar-race mbk-prace">
        <div class="ar-race-top"><div class="ar-race-map"></div><ol class="ar-race-board" aria-label="Klasemen"></ol></div>
        <div class="ar-race-road"><div class="ar-race-hud"></div><div class="ar-race-msg" aria-live="assertive"></div><div class="ar-race-q" hidden></div><div class="mbk-count" hidden></div></div>
        <div class="ar-race-ctrl">
          <button type="button" class="ar-ctl" data-act="left" aria-label="Pindah lajur kiri">${ic('left', 28)}</button>
          <button type="button" class="ar-ctl ar-item" data-act="item" aria-label="Pakai item" disabled>${ic('star', 22)}<span>Item kosong</span></button>
          <button type="button" class="ar-ctl" data-act="right" aria-label="Pindah lajur kanan">${ic('right', 28)}</button>
        </div></div>`;
    const $ = (x) => stage.querySelector(x);
    const map = RE.mountMap($('.ar-race-map'), course);
    const roadHost = $('.ar-race-road');
    const road = RE.mountRoad(roadHost, course);
    const qHost = $('.ar-race-q'), msg = $('.ar-race-msg'), hud = $('.ar-race-hud'), board = $('.ar-race-board'), cnt = $('.mbk-count');
    const itemBtn = $('[data-act="item"]');
    const say = (html, cls) => { msg.innerHTML = `<span class="${cls || ''}">${html}</span>`; clearTimeout(msgT); msgT = setTimeout(() => { msg.innerHTML = ''; }, 1900); };
    const paintItem = () => {
      const it = me.item ? RE.ITEMS[me.item] : null;
      itemBtn.disabled = !it;
      itemBtn.classList.toggle('is-ready', !!it);
      itemBtn.innerHTML = it ? `${ic(it.icon, 22)}<span>${esc(it.name)}</span>` : `${ic('star', 22)}<span>Item kosong</span>`;
    };
    const perfToServer = (pt) => (pt ? clock() + (pt - performance.now()) : 0);
    const serverToPerf = (st) => (st ? performance.now() + (st - clock()) : 0);
    const others = () => fresh().ps.filter(p => p.userId !== meRec.userId).map(p => {
      const c = p.car || { d: 0, lane: [1, 0, 2][(p.color || 0) % 3], v: 0, at: clock(), fx: {} };
      return { id: p.userId, name: firstName(p.userId), color: Art.CAR_COLORS[(p.color || 0) % 12], d: carEst(c, course), lane: c.lane, lx: c.lane, fin: c.fin,
        fx: { turbo: serverToPerf(c.fx && c.fx.t), skid: serverToPerf(c.fx && c.fx.s), shield: serverToPerf(c.fx && c.fx.h) }, spin: 0 };
    });
    const write = (force) => {
      const t = performance.now();
      if (!force && t - lastWrite < 2000) return;
      if (force && t - lastWrite < 400) { dirty = true; return; }
      lastWrite = t; dirty = false;
      const cur = myPlayer(room.id, meRec.userId);
      if (!cur) return;
      savePlayer(Object.assign({}, cur, { car: { d: Math.round(me.d * 10) / 10, lane: me.lane, v: Math.round(me.v * 10) / 10, at: Math.round(clock()), fin: me.fin ? (cur.car && cur.car.fin) || Math.round(clock()) : 0, it: me.item, gate: me.gate,
        fx: { t: Math.round(perfToServer(me.fx.turbo)), s: Math.round(perfToServer(me.fx.skid)), h: Math.round(perfToServer(me.fx.shield)) } } }), 5000);
      cache.t = -1e9;
    };
    const lane = (d) => { if (me.cruise || me.fin || clock() < room.startAt) return; me.lane = clamp(me.lane + d, 0, 2); write(true); };
    const use = () => {
      if (!me.item || me.fin) return;
      const t = performance.now();
      const it = RE.useItem(me, t);
      if (it === 'oil') {
        const os = others().filter(c => !c.fin);
        const ahead = os.filter(c => c.d > me.d).sort((a, b) => a.d - b.d)[0];
        const tgt = ahead || os.filter(c => c.d <= me.d).sort((a, b) => b.d - a.d)[0];
        if (tgt) {
          const cur = myPlayer(room.id, meRec.userId);
          evN++;
          savePlayer(Object.assign({}, cur, { ev: (cur.ev || []).slice(-11).concat({ t: 'oil', n: evN, to: tgt.id, at: Math.round(clock()), lane: tgt.lane }) }));
          say(`${ic('oil', 16)} Oli dilempar ke ${esc(tgt.name)}!`);
        } else say('Tidak ada mobil lain di lintasan.');
      } else if (it === 'turbo') { say(`${ic('turbo', 16)} TURBO!`, 'is-turbo'); beep('go'); }
      else if (it === 'shield') say(`${ic('shield', 16)} Perisai aktif 12 detik`);
      paintItem();
      write(true);
    };
    itemBtn.addEventListener('click', use);
    $('[data-act="left"]').addEventListener('click', () => lane(-1));
    $('[data-act="right"]').addEventListener('click', () => lane(1));
    AR.swipe(s.ctx, roadHost, (d) => { if (d === 'left') lane(-1); else if (d === 'right') lane(1); else if (d === 'up') use(); });
    const letter = (i) => () => { if (oq && !oq.done) oq.pick(i); else if (i === 0) lane(-1); else if (i === 3) lane(1); };
    AR.keys(s.ctx, { ArrowLeft: () => lane(-1), ArrowRight: () => lane(1), ' ': use, ArrowUp: use, w: use, a: letter(0), b: letter(1), c: letter(2), d: letter(3), e: letter(4) });
    const gate = (i) => {
      const q = resolveRef(room.qids[i % room.qids.length]);
      if (!q) return;
      me.cruise = true;
      const prevAns = (myPlayer(room.id, meRec.userId) || {}).ans || {};
      if (prevAns[i]) { me.cruise = false; return; }        // gerbang ini sudah dijawab (muat ulang)
      oq = AR.overlayQuestion(qHost, q, s.ctx, {
        sec: 15,
        onDone: (r) => {
          const t = performance.now();
          const cur = myPlayer(room.id, meRec.userId);
          if (cur) { const a = Object.assign({}, cur.ans || {}); a[i] = { o: r.ans == null ? null : r.ans, ok: r.correct, ms: Math.round((1 - r.leftRatio) * 15000) }; savePlayer(Object.assign({}, cur, { ans: a })); }
          if (r.correct) {
            if (me.item) say('Benar! Slot item masih terisi — pakai dulu itemmu.', 'is-good');
            else {
              const os = others();
              const rank = os.filter(c => c.d > me.d).length;
              me.item = RE.rollItem(rank, os.length + 1);
              say(`Benar! Dapat <b>${esc(RE.ITEMS[me.item].name)}</b> ${ic(RE.ITEMS[me.item].icon, 16)}`, 'is-good');
            }
            paintItem();
          } else if (!r.timedOut) {
            RE.hit(me, 'skid', t) === 'blocked' ? say(`${ic('shield', 16)} Perisai menahan tergelincir`) : say('Salah — mobilmu tergelincir!', 'is-bad');
          } else say('Waktu habis — tanpa item.');
          write(true);
          s.after(r.correct ? 900 : 1500, () => { if (oq) oq.close(); oq = null; me.cruise = false; });
        }
      });
      beep('pop');
    };
    let lastHud = 0;
    const stopLoop = AR.loop(s.ctx, (dt, t) => {
      const room2 = fresh().room;
      const now = clock();
      if (now < room2.startAt) {
        cnt.hidden = false;
        cnt.innerHTML = `<b>${Math.ceil((room2.startAt - now) / 1000)}</b><span>Bersiap…</span>`;
        road.draw({ me, others: others(), puddles, t });
        return;
      }
      if (!saidStart) { saidStart = true; cnt.hidden = true; beep('go'); say(`${ic('flag', 16)} MULAI!`, 'is-turbo'); }
      // Oli dari mobil lain yang ditujukan padaku.
      fresh().ps.forEach(p => (p.ev || []).forEach(e => {
        const k = p.userId + ':' + e.n;
        if (seen.has(k)) return;
        seen.add(k);
        if (e.to !== meRec.userId || me.fin || now - e.at > 20000) return;
        puddles.push({ d: me.d + 55, lane: me.lane, to: me.id });
        say(`${ic('oil', 16)} Oli dari ${esc(firstName(p.userId))}! Pindah lajur!`, 'is-bad');
        beep('bad');
      }));
      const ev = RE.step(me, dt, t, course, puddles);
      ev.forEach(e => {
        if (e.type === 'gate') gate(e.i);
        else if (e.type === 'obstacle' && !me.cruise) { const r = RE.hit(me, 'obstacle', t); r === 'blocked' ? say(`${ic('shield', 16)} Perisai menahan tabrakan`) : (say('Tabrakan! Pindah lajur untuk menghindar.', 'is-bad'), beep('bad')); write(true); }
        else if (e.type === 'pad' && !me.cruise) { me.fx.turbo = Math.max(me.fx.turbo, t + RE.FX.pad); say(`${ic('turbo', 16)} Papan turbo!`, 'is-turbo'); }
        else if (e.type === 'oil') { e.p.used = true; const r = RE.hit(me, 'oil', t); say(r === 'blocked' ? `${ic('shield', 16)} Perisai menahan oli` : 'Terpeleset oli!', r === 'blocked' ? '' : 'is-bad'); write(true); }
        else if (e.type === 'finish') { if (oq) { oq.close(); oq = null; } me.cruise = false; beep('win'); say(`${ic('flag', 16)} FINIS!`, 'is-good'); write(true); }
      });
      const os = others();
      road.draw({ me, others: os, puddles, t });
      if (dirty) write(true); else write(false);
      if (t - lastHud > 200) {
        lastHud = t;
        const all = os.concat([Object.assign({}, me, { id: me.id, name: 'Kamu', fin: me.fin ? 1 : 0, me: true })]);
        const order = all.slice().sort((a, b) => (a.fin && b.fin ? 0 : a.fin ? -1 : b.fin ? 1 : b.d - a.d));
        const pos = order.findIndex(c => c.me) + 1;
        hud.innerHTML = `<span>${ic('flag', 14)} Putaran <b>${RE.lapOf(me, course)}/${course.laps}</b></span><span>Posisi <b>${pos}/${all.length}</b></span>${me.fin ? '<span>Finis — tunggu hasil</span>' : ''}`;
        board.innerHTML = order.slice(0, 8).map((c, i) => `<li class="${c.me ? 'is-me' : ''}"><span style="background:${c.color}"></span>${i + 1}. ${esc(c.name)}</li>`).join('');
        map.update(all.map(c => ({ id: c.id, d: c.d, color: c.color, me: !!c.me })));
      }
    });
    paintItem();
    s.drive = { destroy() { stopLoop(); road.destroy(); map.destroy(); if (oq) oq.close(); } };
    // Di HP: jalan & tombol harus terlihat penuh.
    try { stage.scrollIntoView({ behavior: 'auto', block: 'start' }); } catch (e) { /* noop */ }
  }

  function playerResults(s, stage, room, me) {
    if (s.drive) { s.drive.destroy(); s.drive = null; }
    if (room.status === 'closed') { stage.innerHTML = '<div class="empty"><div class="empty-icon">🚪</div>Tutor menutup ruang ini.</div>'; return; }
    const res = room.results || [];
    const mine = res.find(x => x.uid === me.userId);
    let score = 0, correct = 0, answered = Object.keys(me.ans || {}).length, result = null, html = '';
    if (room.kind === 'raid') {
      const R = room.state.raid || {};
      // Angka dari data lama/parsial bisa kosong: jangan sampai skor menjadi NaN.
      const n0 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
      const t = mine ? { dmg: n0(mine.dmg), heal: n0(mine.heal), ok: n0(mine.ok), n: n0(mine.n), pos: mine.pos } : { dmg: 0, heal: 0, ok: 0, n: 0 };
      correct = t.ok; answered = t.n;
      score = Math.round(t.dmg + t.heal * 0.6 + t.ok * 50 + (R.victory && mine ? 300 : 0));
      result = R.victory ? 'win' : 'lose';
      html = `<div class="mbk-final ${R.victory ? 'is-win' : ''}"><div class="mbk-final-ic">${R.victory ? ic('trophy', 48) : ic('skull', 48)}</div>
        <h2>${R.victory ? 'Kelas menang!' : 'Monster terlalu kuat kali ini'}</h2>
        <p>Seranganmu <b>${fmt(t.dmg)}</b> • pemulihan <b>${fmt(t.heal)}</b> • ${t.ok}/${t.n} benar${mine ? ` • peringkat kontribusi <b>${t.pos}</b> dari ${res.length}` : ''}</p>
        <p class="mbk-score">${gainHtml(score)} poin</p></div>`;
    } else {
      // Pemain yang tidak tercatat di hasil (mis. bergabung terlambat) berada di belakang semua peserta
      // dan tidak pernah dihitung juara; sebelumnya posisinya = jumlah hasil (0 bila kosong → skor 720).
      const pos = mine && Number(mine.pos) >= 1 ? Number(mine.pos) : res.length + 1;
      const won = !!mine && pos === 1;
      correct = mine ? (Number(mine.ok) || 0) : Object.values(me.ans || {}).filter(a => a && a.ok).length;
      score = mine ? Math.max(80, 650 - (pos - 1) * 70) + correct * 80 : correct * 80;
      result = won ? 'win' : 'lose';
      const title = won ? 'Juara 1!' : (!mine ? 'Belum tercatat di hasil balapan' : (mine.fin ? `Finis posisi ${pos}` : `Posisi ${pos} (belum finis)`));
      html = `<div class="mbk-final ${won ? 'is-win' : ''}"><div class="mbk-final-ic">${won ? ic('trophy', 48) : ic('flag', 48)}</div>
        <h2>${title}</h2><p>${mine && mine.fin ? (mine.fin / 1000).toFixed(1) + ' detik • ' : ''}${correct} gerbang dijawab benar</p>
        <p class="mbk-score">${gainHtml(score)} poin</p></div>`;
    }
    stage.innerHTML = html + `<div class="flex-gap" style="justify-content:center;"><button type="button" class="btn btn-secondary" data-mbk="out">Kembali</button></div>`;
    stage.querySelector('[data-mbk="out"]').addEventListener('click', () => { const c = s.el, u = s.user; stop(); renderJoin(c, u, { noResume: true }); });
    if (!me.saved && s.user.role === 'siswa') {
      Games.kit.saveScore({ id: uid('gs'), studentId: me.userId, game: KINDS[room.kind].game, mode: 'kelas', score, correct, answered,
        subject: room.subject || '', battleId: null, opponentId: null, result, durationMs: Math.max(0, (room.endedAt || clock()) - (me.joinedAt || clock())), createdAt: Date.now() });
      savePlayer(Object.assign({}, me, { saved: true }));
    }
    if (result === 'win') beep('win');
  }

  /* ---------------- Perapian data lama ---------------- */
  /** Hapus ruang & pemain milik sendiri yang sudah lebih dari 2 hari (dipanggil saat halaman dibuka). */
  function tidy(user) {
    const old = clock() - 2 * 86400000;
    const rooms = load(K.rooms).filter(r => r.hostId === user.id && (r.updatedAt || r.createdAt || 0) < old).map(r => r.id);
    if (rooms.length) {
      removeWhere(K.rooms, r => rooms.includes(r.id));
      if (user.role !== 'siswa') removeWhere(K.players, p => rooms.includes(p.roomId));
    }
    if (user.role === 'siswa' && load(K.players).some(p => p.userId === user.id && (p.at || 0) < old)) removeWhere(K.players, p => p.userId === user.id && (p.at || 0) < old);
  }

  /** Jumlah ruang yang sedang dibuka (lencana tab siswa). */
  const openCount = () => load(K.rooms).filter(isActive).length;

  global.GameRoom = { renderHost, renderJoin, stop, busy, tidy, openCount, KINDS, _test: { raidResolve, raidNext, raidStart, newCode, carEst } };
})(window);
