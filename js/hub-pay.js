/* =========================================================================
 * HubPay — Course Mandiri berbayar dengan PEMBAYARAN MANUAL.
 *
 *  Siswa : lihat harga & tujuan transfer/QRIS → unggah bukti → status
 *          menunggu / disetujui / ditolak (dengan alasan).
 *  Admin : halaman "Pembayaran Course" — periksa bukti, setujui/tolak,
 *          beri akses manual.
 *
 * Tidak ada verifikasi otomatis: admin mencocokkan bukti dengan mutasi
 * rekening/QRIS secara manual. Akses isi course ditegakkan di server
 * (api/_lib/rules.js: lockedCourse & checkHubPayment).
 * =======================================================================*/
(function (global) {
  'use strict';

  const esc = (s) => UI.esc(s);
  const rp = (n) => DB.formatRupiah(n);
  const RAW_MAX = 10 * 1024 * 1024;               // berkas asli sebelum dikompres
  const OUT_MAX = { qris: 1.4 * 1024 * 1024, proof: 2.8 * 1024 * 1024 };
  const IMG_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

  const ICON = {
    bank: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10 12 4l9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 20h18"/></svg>',
    qr: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v7h-4M14 18v3"/></svg>',
    copy: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    clock: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    upload: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>'
  };

  /* ---------------------------------------------------------------- berkas */
  /** Kecilkan gambar di peramban (sisi terpanjang ≤ max px). PNG kecil dibiarkan (QR tetap tajam). */
  async function compress(file, kind) {
    if (!file || !IMG_TYPES.includes(file.type)) throw new Error('Pilih gambar PNG, JPG, atau WEBP.');
    if (file.size > RAW_MAX) throw new Error('Ukuran gambar maksimal 10 MB.');
    const limit = OUT_MAX[kind] || OUT_MAX.proof;
    if (file.type === 'image/png' && file.size <= limit && kind === 'qris') return file;
    const bmp = await loadImage(file);
    const max = 1600;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.drawImage(bmp, 0, 0, w, h);
    for (const q of [0.88, 0.8, 0.7, 0.6]) {
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= limit) return blob;
    }
    throw new Error('Gambar terlalu besar setelah dikompres. Coba foto dengan resolusi lebih kecil.');
  }
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Berkas bukan gambar yang valid.')); };
      img.src = url;
    });
  }

  /** Simpan QRIS (admin). Kunci berversi agar cache perangkat lain tidak memakai gambar lama. */
  async function uploadQris(courseId, file) {
    const blob = await compress(file, 'qris');
    const key = `qris:${courseId}:${Date.now()}`;
    await BlobStore.put(key, blob, { name: 'qris' });
    return key;
  }

  /** Isi <img data-blob-key> dari BlobStore (server/IndexedDB). */
  const urlCache = new Map();
  function hydrate(root) {
    (root || document).querySelectorAll('img[data-blob-key]:not([data-blob-done])').forEach(img => {
      const key = img.getAttribute('data-blob-key');
      img.setAttribute('data-blob-done', '1');
      const wrap = img.closest('.hp-img');
      if (wrap) wrap.classList.add('is-loading');
      const done = (url) => {
        if (wrap) wrap.classList.remove('is-loading');
        if (url) { img.src = url; return; }
        if (wrap) { wrap.classList.add('is-missing'); wrap.setAttribute('data-msg', 'Gambar tidak dapat dimuat'); }
      };
      if (urlCache.has(key)) { done(urlCache.get(key)); return; }
      Promise.resolve(global.BlobStore ? BlobStore.get(key) : null).then(b => {
        const url = b ? URL.createObjectURL(b) : null;
        if (url) urlCache.set(key, url);
        done(url);
      }).catch(() => done(null));
    });
  }
  const imgHtml = (key, alt, cls) => `<span class="hp-img ${cls || ''}"><img data-blob-key="${esc(key)}" alt="${esc(alt)}" /></span>`;

  function copy(text, label) {
    const ok = () => UI.toast(label + ' disalin.', 'success');
    const fail = () => UI.toast('Gagal menyalin. Salin manual: ' + text, 'error');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fail); else fail();
  }

  /* ------------------------------------------------------------ siswa */
  const STATUS = {
    pending: { label: 'Menunggu verifikasi', cls: 'is-pending', ic: ICON.clock },
    approved: { label: 'Disetujui', cls: 'is-approved', ic: ICON.check },
    rejected: { label: 'Ditolak', cls: 'is-rejected', ic: ICON.x }
  };
  const badge = (st) => { const s = STATUS[st] || STATUS.pending; return `<span class="hp-badge ${s.cls}">${s.ic}<span>${s.label}</span></span>`; };

  /** Panel samping halaman course untuk siswa yang belum punya akses. */
  function landingAside(c, user) {
    const last = DB.hubPaymentFor(c.id, user.id);
    const price = `<div class="hp-price"><span class="hp-price-amt">${rp(c.price)}</span><span class="hp-price-note">sekali bayar · akses penuh setelah diverifikasi</span></div>`;
    if (c.enrollMode === 'assigned') {
      return price + '<div class="alert alert-info small">Course ini didaftarkan oleh admin. Hubungi admin untuk mengikutinya.</div>';
    }
    if (last && last.status === 'approved') {
      return price + `<div class="hp-state is-approved">${ICON.check}<div><strong>Pembayaran disetujui</strong><span>Akses course sudah terbuka.</span></div></div>
        <button type="button" class="btn btn-primary btn-block" id="hubEnroll">Mulai belajar</button>`;
    }
    if (last && last.status === 'pending') {
      return price + `<div class="hp-state is-pending">${ICON.clock}<div><strong>Menunggu verifikasi admin</strong>
          <span>Bukti dikirim ${esc(UI.fmtRelative(last.createdAt))}. Admin memeriksa transfer secara manual; kamu akan mendapat notifikasi.</span></div></div>
        <button type="button" class="btn btn-secondary btn-block" data-hp-proof="${esc(last.id)}">Lihat bukti yang dikirim</button>`;
    }
    const rejected = last && last.status === 'rejected'
      ? `<div class="hp-state is-rejected">${ICON.x}<div><strong>Pembayaran ditolak</strong><span>Alasan: ${esc(last.rejectReason || '-')}</span></div></div>` : '';
    return price + rejected + `<button type="button" class="btn btn-primary btn-block" id="hpBuy">${rejected ? 'Kirim ulang bukti pembayaran' : 'Beli course'}</button>
      <p class="hp-fine">Pembayaran manual lewat transfer bank/QRIS. Akses dibuka setelah admin mencocokkan bukti transfer.</p>`;
  }

  function bindLanding(container, c, user, rerender) {
    const buy = container.querySelector('#hpBuy');
    if (buy) buy.addEventListener('click', () => openCheckout(c, user, rerender));
    container.querySelectorAll('[data-hp-proof]').forEach(b => b.addEventListener('click', () => openProof(DB.getHubPayment(b.dataset.hpProof))));
  }

  function payToHtml(c) {
    const p = c.payment || {};
    const bank = p.bank && p.accountNo && p.accountName ? `
      <div class="hp-dest">
        <div class="hp-dest-head">${ICON.bank}<strong>Transfer bank</strong></div>
        <dl class="hp-dl">
          <div><dt>Bank</dt><dd>${esc(p.bank)}</dd></div>
          <div><dt>Nomor rekening</dt><dd><span class="hp-mono">${esc(p.accountNo)}</span>
            <button type="button" class="hp-copy" data-hp-copy="${esc(p.accountNo.replace(/[^0-9]/g, ''))}" data-hp-label="Nomor rekening" aria-label="Salin nomor rekening">${ICON.copy}</button></dd></div>
          <div><dt>Atas nama</dt><dd>${esc(p.accountName)}</dd></div>
        </dl>
      </div>` : '';
    const qris = p.qrisKey ? `
      <div class="hp-dest">
        <div class="hp-dest-head">${ICON.qr}<strong>QRIS</strong></div>
        ${imgHtml(p.qrisKey, 'Kode QRIS pembayaran ' + c.title, 'hp-qris')}
        <p class="hp-fine">Pindai dengan aplikasi bank atau dompet digital, lalu masukkan nominal ${rp(c.price)} bila diminta.</p>
      </div>` : '';
    return `<div class="hp-dests">${bank}${qris}</div>${p.instructions ? `<div class="hp-instr">${esc(p.instructions).replace(/\n/g, '<br>')}</div>` : ''}`;
  }

  function openCheckout(c, user, onDone) {
    let file = null;
    UI.modal.open('Pembayaran course', `
      <div class="hp-checkout">
        <div class="hp-summary"><div><span class="hp-fine">Course</span><strong>${esc(c.title)}</strong></div>
          <div class="hp-sum-amt"><span class="hp-fine">Nominal transfer</span><strong>${rp(c.price)}</strong>
          <button type="button" class="hp-copy" data-hp-copy="${c.price}" data-hp-label="Nominal" aria-label="Salin nominal">${ICON.copy}</button></div></div>
        <ol class="hp-steps">
          <li><strong>Transfer tepat ${rp(c.price)}</strong> ke salah satu tujuan berikut.${payToHtml(c)}</li>
          <li><strong>Unggah bukti transfer</strong> (tangkapan layar atau foto struk). Pastikan nominal, tanggal, dan tujuan terbaca.
            <label class="hp-drop" id="hpDrop">
              <input type="file" id="hpFile" accept="image/png,image/jpeg,image/webp" class="sr-only" />
              <span class="hp-drop-empty">${ICON.upload}<span>Pilih gambar<small>PNG, JPG, atau WEBP · maks. 10 MB</small></span></span>
              <img id="hpPrev" alt="Pratinjau bukti transfer" hidden />
            </label>
            <div class="hp-err" id="hpErr" role="alert" hidden></div></li>
          <li><label for="hpNote"><strong>Catatan untuk admin</strong> <span class="hp-fine">(opsional, mis. nama pengirim di rekening)</span></label>
            <textarea id="hpNote" rows="2" maxlength="300" class="input"></textarea></li>
        </ol>
        <p class="hp-fine">Pembayaran diperiksa manual oleh admin. Belum ada verifikasi otomatis, jadi akses terbuka setelah admin menyetujui.</p>
        <div class="hp-actions"><button type="button" class="btn btn-secondary" id="hpCancel">Batal</button>
          <button type="button" class="btn btn-primary" id="hpSend" disabled>Kirim bukti</button></div>
      </div>`, { autofocus: false });
    const body = document.getElementById('modalBody');
    hydrate(body);
    bindCopy(body);
    const err = body.querySelector('#hpErr'), prev = body.querySelector('#hpPrev'), send = body.querySelector('#hpSend');
    const showErr = (m) => { err.hidden = !m; err.textContent = m || ''; };
    body.querySelector('#hpFile').addEventListener('change', (e) => {
      const f = e.target.files[0];
      showErr('');
      file = null; send.disabled = true; prev.hidden = true;
      if (!f) return;
      if (!IMG_TYPES.includes(f.type)) { showErr('Bukti harus berupa gambar PNG, JPG, atau WEBP.'); return; }
      if (f.size > RAW_MAX) { showErr('Ukuran gambar maksimal 10 MB.'); return; }
      file = f;
      prev.src = URL.createObjectURL(f);
      prev.hidden = false;
      body.querySelector('#hpDrop').classList.add('has-file');
      send.disabled = false;
    });
    body.querySelector('#hpCancel').addEventListener('click', () => UI.modal.close());
    send.addEventListener('click', async () => {
      if (!file) return;
      send.disabled = true;
      send.innerHTML = '<span class="spinner"></span> Mengirim…';
      try {
        const blob = await compress(file, 'proof');
        const key = `proof:${user.id}:${DB.uid('pf')}`;
        await BlobStore.put(key, blob, { name: file.name });
        DB.hubSubmitPayment({ courseId: c.id, proofKey: key, proofName: file.name, note: body.querySelector('#hpNote').value });
        if (global.Sync && Sync.isServer && Sync.isServer() && Sync.flush) await Sync.flush();
        UI.modal.close();
        UI.toast('Bukti pembayaran terkirim. Admin akan memverifikasinya.', 'success');
        if (onDone) onDone();
      } catch (e) {
        showErr(e.message || 'Bukti gagal dikirim. Periksa koneksi lalu coba lagi.');
        send.disabled = false;
        send.textContent = 'Kirim bukti';
      }
    });
  }

  function bindCopy(root) {
    root.querySelectorAll('[data-hp-copy]').forEach(b => b.addEventListener('click', () => copy(b.dataset.hpCopy, b.dataset.hpLabel || 'Teks')));
  }

  function openProof(p) {
    if (!p) { UI.toast('Data pembayaran tidak ditemukan.', 'error'); return; }
    if (!p.proofKey) { UI.toast('Akses ini diberikan admin tanpa bukti transfer.', 'info'); return; }
    UI.modal.open('Bukti transfer', `<div class="hp-proof-view">${imgHtml(p.proofKey, 'Bukti transfer', 'hp-proof-full')}
      ${p.note ? `<p class="hp-fine">Catatan siswa: ${esc(p.note)}</p>` : ''}</div>`, { autofocus: false });
    hydrate(document.getElementById('modalBody'));
  }

  /* ------------------------------------------------------------ admin */
  let admView = { tab: 'pending' };
  function renderAdmin(container, admin) {
    const pays = DB.getHubPayments().slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const count = (st) => pays.filter(p => p.status === st).length;
    const tabs = [['pending', 'Menunggu'], ['approved', 'Disetujui'], ['rejected', 'Ditolak'], ['all', 'Semua']];
    const tab = tabs.some(t => t[0] === admView.tab) ? admView.tab : 'pending';
    const rows = tab === 'all' ? pays : pays.filter(p => p.status === tab);
    const paidCourses = DB.getHubCourses().filter(c => DB.hubIsPaid(c));
    container.innerHTML = `
      <div class="card">
        <div class="card-header">${UI.secHead(ICON.bank, 'Pembayaran Course', 'verifikasi manual bukti transfer/QRIS untuk Course Mandiri berbayar')}
          <button type="button" class="btn btn-secondary btn-sm" id="hpGrant" ${paidCourses.length ? '' : 'disabled'}>Beri akses manual</button></div>
        <div class="alert alert-info small">Cocokkan nominal, tanggal, dan nama pengirim dengan mutasi rekening atau riwayat QRIS sebelum menyetujui. Sistem tidak memverifikasi transfer secara otomatis.</div>
        <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${k === tab}" class="tab-btn ${k === tab ? 'active' : ''}" data-hp-tab="${k}">${l} (${k === 'all' ? pays.length : count(k)})</button>`).join('')}</div>
        <div id="hpList">${rows.length ? `<div class="hp-list">${rows.map(p => rowHtml(p)).join('')}</div>`
          : `<div class="empty"><div class="empty-icon">${ICON.bank}</div>${tab === 'pending' ? 'Tidak ada pembayaran yang menunggu verifikasi.' : 'Belum ada data pada kategori ini.'}</div>`}</div>
      </div>`;
    container.querySelectorAll('[data-hp-tab]').forEach(b => b.addEventListener('click', () => { admView.tab = b.dataset.hpTab; renderAdmin(container, admin); }));
    hydrate(container);
    container.querySelectorAll('[data-hp-view]').forEach(b => b.addEventListener('click', () => openProof(DB.getHubPayment(b.dataset.hpView))));
    container.querySelectorAll('[data-hp-approve]').forEach(b => b.addEventListener('click', () => {
      const p = DB.getHubPayment(b.dataset.hpApprove);
      if (!UI.confirmDialog(`Setujui pembayaran ${rp(p.amount)} dan buka akses course untuk siswa ini?`)) return;
      try { DB.hubDecidePayment(p.id, 'approved', '', admin); UI.toast('Pembayaran disetujui. Siswa sudah didaftarkan.', 'success'); renderAdmin(container, admin); }
      catch (e) { UI.toast(e.message, 'error'); }
    }));
    container.querySelectorAll('[data-hp-reject]').forEach(b => b.addEventListener('click', () => openReject(container, admin, b.dataset.hpReject)));
    container.querySelectorAll('[data-hp-revoke]').forEach(b => b.addEventListener('click', () => openReject(container, admin, b.dataset.hpRevoke, true)));
    const g = container.querySelector('#hpGrant');
    if (g) g.addEventListener('click', () => openGrant(container, admin, paidCourses));
  }

  function rowHtml(p) {
    const st = DB.getUser(p.studentId);
    const c = DB.getHubCourse(p.courseId);
    const mismatch = c && DB.hubIsPaid(c) && p.amount && p.amount !== c.price;
    return `<article class="hp-row">
      ${p.proofKey ? `<button type="button" class="hp-thumb" data-hp-view="${esc(p.id)}" aria-label="Lihat bukti transfer">${imgHtml(p.proofKey, 'Bukti transfer')}</button>`
        : `<div class="hp-thumb is-empty" aria-hidden="true">${ICON.check}</div>`}
      <div class="hp-row-main">
        <div class="hp-row-top"><strong>${esc(st ? st.name : '(akun dihapus)')}</strong>${badge(p.status)}</div>
        <div class="hp-row-meta">${esc(c ? c.title : '(course dihapus)')} · <strong>${p.method === 'manual' ? 'Akses manual' : rp(p.amount)}</strong>${mismatch ? ` <span class="hp-warn">harga sekarang ${rp(c.price)}</span>` : ''}</div>
        <div class="hp-row-meta">Dikirim ${esc(UI.fmtDateTime ? UI.fmtDateTime(p.createdAt) : UI.fmtDate(p.createdAt))}${p.decidedAt ? ` · diputuskan ${esc(UI.fmtRelative(p.decidedAt))}` : ''}</div>
        ${p.note ? `<div class="hp-row-note">Catatan: ${esc(p.note)}</div>` : ''}
        ${p.status === 'rejected' && p.rejectReason ? `<div class="hp-row-note is-reject">Alasan ditolak: ${esc(p.rejectReason)}</div>` : ''}
      </div>
      <div class="hp-row-act">
        ${p.status === 'pending' ? `<button type="button" class="btn btn-sm btn-primary" data-hp-approve="${esc(p.id)}">Setujui</button>
          <button type="button" class="btn btn-sm btn-danger" data-hp-reject="${esc(p.id)}">Tolak</button>` : ''}
        ${p.status === 'approved' ? `<button type="button" class="btn btn-sm btn-ghost" data-hp-revoke="${esc(p.id)}">Cabut akses</button>` : ''}
      </div>
    </article>`;
  }

  function openReject(container, admin, id, revoke) {
    const p = DB.getHubPayment(id);
    if (!p) return;
    UI.modal.open(revoke ? 'Cabut akses course' : 'Tolak pembayaran', `
      <form id="hpRejForm" class="form">
        <div class="form-group"><label for="hpReason">Alasan (dikirim ke siswa)</label>
          <textarea id="hpReason" rows="3" maxlength="300" required placeholder="Contoh: nominal transfer kurang Rp5.000, atau bukti tidak terbaca."></textarea></div>
        <div class="hp-chips">${['Nominal tidak sesuai', 'Bukti tidak terbaca', 'Transfer belum masuk ke rekening', 'Bukti bukan untuk course ini']
          .map(t => `<button type="button" class="hp-chip" data-hp-reason="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <div class="hp-err" id="hpRejErr" role="alert" hidden></div>
        <div class="hp-actions"><button type="button" class="btn btn-secondary" id="hpRejCancel">Batal</button>
          <button type="submit" class="btn btn-danger">${revoke ? 'Cabut akses' : 'Tolak'}</button></div>
      </form>`);
    const f = document.getElementById('hpRejForm');
    const ta = f.querySelector('#hpReason');
    f.querySelectorAll('[data-hp-reason]').forEach(b => b.addEventListener('click', () => { ta.value = b.dataset.hpReason; ta.focus(); }));
    f.querySelector('#hpRejCancel').addEventListener('click', () => UI.modal.close());
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      try {
        DB.hubDecidePayment(id, 'rejected', ta.value, admin);
        UI.modal.close();
        UI.toast(revoke ? 'Akses dicabut.' : 'Pembayaran ditolak. Siswa mendapat notifikasi.', 'success');
        renderAdmin(container, admin);
      } catch (err) { const el = f.querySelector('#hpRejErr'); el.hidden = false; el.textContent = err.message; }
    });
  }

  function openGrant(container, admin, courses) {
    const students = DB.getUsers().filter(u => u.role === 'siswa' && u.status !== 'Dikeluarkan').sort((a, b) => a.name.localeCompare(b.name));
    UI.modal.open('Beri akses manual', `
      <form id="hpGrantForm" class="form">
        <p class="muted small">Untuk pembayaran tunai, beasiswa, atau kasus khusus. Tercatat sebagai "Akses manual" tanpa nominal.</p>
        <div class="form-group"><label for="hpGC">Course berbayar</label><select id="hpGC" class="input" required>
          ${courses.map(c => `<option value="${esc(c.id)}">${esc(c.title)} — ${rp(c.price)}</option>`).join('')}</select></div>
        <div class="form-group"><label for="hpGS">Siswa</label><select id="hpGS" class="input" required>
          ${students.map(s => `<option value="${esc(s.id)}">${esc(s.name)}${s.kelas ? ' · ' + esc(s.kelas) : ''}</option>`).join('')}</select></div>
        <div class="form-group"><label for="hpGN">Catatan</label><input id="hpGN" class="input" maxlength="300" placeholder="mis. Bayar tunai di kantor" /></div>
        <div class="hp-err" id="hpGErr" role="alert" hidden></div>
        <div class="hp-actions"><button type="button" class="btn btn-secondary" id="hpGCancel">Batal</button><button type="submit" class="btn btn-primary">Beri akses</button></div>
      </form>`);
    const f = document.getElementById('hpGrantForm');
    f.querySelector('#hpGCancel').addEventListener('click', () => UI.modal.close());
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const cid = f.querySelector('#hpGC').value, sid = f.querySelector('#hpGS').value;
      try {
        const c = DB.getHubCourse(cid);
        if (DB.hubHasAccess(c, sid)) throw new Error('Siswa ini sudah memiliki akses.');
        DB.hubGrantAccess(cid, sid, admin, f.querySelector('#hpGN').value);
        try { DB.hubEnroll(cid, sid); } catch (er) { /* di luar sasaran: akses tetap tercatat */ }
        DB.addNotification({ userId: sid, icon: '💳', link: 'course', title: 'Akses course dibuka', body: c.title });
        UI.modal.close();
        UI.toast('Akses diberikan.', 'success');
        admView.tab = 'approved';
        renderAdmin(container, admin);
      } catch (err) { const el = f.querySelector('#hpGErr'); el.hidden = false; el.textContent = err.message; }
    });
  }

  const lockedIcon = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  global.HubPay = { landingAside, bindLanding, renderAdmin, uploadQris, hydrate, imgHtml, compress, badge, lockedIcon };
})(window);
