/* ===== Shared UI helpers ===== */
(function (global) {
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ===== Timezone System ===== */
  const TZ_OFFSETS = { WIB: 7, WITA: 8, WIT: 9 }; // UTC offset hours
  const TZ_LABELS = { WIB: 'WIB (UTC+7)', WITA: 'WITA (UTC+8)', WIT: 'WIT (UTC+9)' };
  const TZ_KEY = 'lms_timezone';

  function getTimezone() {
    return localStorage.getItem(TZ_KEY) || 'WIB';
  }
  function setTimezone(tz) {
    if (TZ_OFFSETS[tz] != null) localStorage.setItem(TZ_KEY, tz);
  }

  /** Get current Date adjusted to selected Indonesian timezone */
  function nowInTz(tz) {
    const zone = tz || getTimezone();
    const offset = TZ_OFFSETS[zone];
    const now = new Date();
    // Convert to UTC then add offset
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    return new Date(utcMs + offset * 3600000);
  }

  /** Convert a UTC timestamp to a Date in the given timezone */
  function toTzDate(ts, tz) {
    if (!ts) return null;
    const zone = tz || getTimezone();
    const offset = TZ_OFFSETS[zone];
    const d = new Date(ts);
    const utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
    return new Date(utcMs + offset * 3600000);
  }

  /** Format time as HH:MM:SS for clock display */
  function fmtClock(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  /** Format full date+time with day name in Indonesian */
  function fmtFullDateTime(d) {
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const p = (n) => String(n).padStart(2, '0');
    return `${days[d.getDay()]}, ${p(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  /** Start the real-time clock widget. Call once after DOM ready. */
  let _clockInterval = null;
  function startClock() {
    const el = document.getElementById('liveClock');
    const dateEl = document.getElementById('liveDate');
    const tzSel = document.getElementById('tzSelector');
    if (!el) return;
    if (tzSel) {
      tzSel.value = getTimezone();
      tzSel.addEventListener('change', (e) => {
        setTimezone(e.target.value);
        tickClock();
      });
    }
    function tickClock() {
      const tz = getTimezone();
      const now = nowInTz(tz);
      el.textContent = fmtClock(now) + ' ' + tz;
      if (dateEl) dateEl.textContent = fmtFullDateTime(now);
    }
    tickClock();
    if (_clockInterval) clearInterval(_clockInterval);
    _clockInterval = setInterval(tickClock, 1000);
  }

  /** Render the clock + timezone selector HTML (for topbar) */
  function clockWidgetHtml() {
    const tz = getTimezone();
    return `
      <div class="clock-widget">
        <div class="clock-time" id="liveClock">--:--:-- ${esc(tz)}</div>
        <div class="clock-date" id="liveDate">-</div>
        <select id="tzSelector" class="tz-select" title="Pilih Zona Waktu">
          <option value="WIB" ${tz === 'WIB' ? 'selected' : ''}>WIB</option>
          <option value="WITA" ${tz === 'WITA' ? 'selected' : ''}>WITA</option>
          <option value="WIT" ${tz === 'WIT' ? 'selected' : ''}>WIT</option>
        </select>
      </div>`;
  }

  /** Convert a local datetime-local input value + timezone to UTC timestamp */
  function tzInputToUtc(datetimeLocalStr, tz) {
    if (!datetimeLocalStr) return null;
    const zone = tz || getTimezone();
    const offset = TZ_OFFSETS[zone];
    // Parse as if local (no timezone)
    const [datePart, timePart] = datetimeLocalStr.split('T');
    const [y, mo, d] = datePart.split('-').map(Number);
    const [h, mi] = (timePart || '00:00').split(':').map(Number);
    // Construct UTC: subtract the timezone offset
    const utcMs = Date.UTC(y, mo - 1, d, h - offset, mi, 0, 0);
    return utcMs;
  }

  /** Convert a UTC timestamp to datetime-local string in given timezone */
  function utcToTzInput(ts, tz) {
    if (!ts) return '';
    const d = toTzDate(ts, tz);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** Format a UTC timestamp for display in the user's selected timezone */
  function fmtDateTimeTz(ts, tz) {
    if (!ts) return '-';
    const d = toTzDate(ts, tz);
    const zone = tz || getTimezone();
    const p = (n) => String(n).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return `${p(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())} ${zone}`;
  }

  /* ===== Original formatting functions ===== */
  function fmtDate(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function fmtDateTime(ts) {
    if (!ts) return '-';
    // Use timezone-aware display
    return fmtDateTimeTz(ts);
  }
  function toDateInput(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function toDateTimeLocalInput(ts) {
    // Use timezone-aware conversion
    return utcToTzInput(ts);
  }
  function todayYMD() {
    const d = nowInTz();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function fmtYMD(ymd) {
    if (!ymd) return '-';
    const [y, m, d] = ymd.split('-');
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    return dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function fmtRp(num) {
    const n = Number(num || 0);
    return 'Rp ' + n.toLocaleString('id-ID');
  }
  function fmtDuration(seconds) {
    const s = Number(seconds || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}j ${m}m`;
    return `${m} menit`;
  }

  /* Preferensi layar penuh per jenis modal disimpan di perangkat ini saja
   * (kunci di luar katalog sinkronisasi). */
  const FULL_PREFIX = 'lms_modal_full:';
  let modalCloseTimer = null;

  function setModalFull(el, on, key) {
    el.classList.toggle('is-full', !!on);
    const btn = document.getElementById('modalFull');
    if (btn) {
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.title = on ? 'Keluar dari layar penuh' : 'Layar penuh';
      btn.setAttribute('aria-label', btn.title);
      btn.innerHTML = on ? '🗗' : '⛶';
    }
    if (key) { try { localStorage.setItem(FULL_PREFIX + key, on ? '1' : '0'); } catch (e) { /* penyimpanan penuh */ } }
  }

  /** Pasang/lepas tombol layar penuh di kepala modal sesuai opsi pemanggil. */
  function applyModalChrome(el, o) {
    const head = el.querySelector('.modal-header');
    let btn = document.getElementById('modalFull');
    if (!o.fullscreenToggle) {
      if (btn) btn.remove();
      el.classList.remove('is-full');
      return;
    }
    if (!btn && head) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'modalFull';
      btn.className = 'icon-btn modal-full-btn';
      head.insertBefore(btn, document.getElementById('modalClose'));
    }
    const key = o.fullKey ? String(o.fullKey) : '';
    let on = false;
    if (o.fullscreen != null) on = !!o.fullscreen;
    else if (key) { try { on = localStorage.getItem(FULL_PREFIX + key) === '1'; } catch (e) { on = false; } }
    if (btn) btn.onclick = () => setModalFull(el, !el.classList.contains('is-full'), key);
    setModalFull(el, on, '');
  }

  const modal = {
    /**
     * Buka modal umum.
     * @param {string} title
     * @param {string} bodyHTML
     * @param {object} [opts] { fullscreenToggle, fullKey, fullscreen, animate, autofocus }
     *   fullscreenToggle → tampilkan tombol layar penuh (preferensi diingat per fullKey)
     *   animate:false    → jangan memutar animasi masuk
     *   autofocus:false  → jangan memfokuskan kolom pertama
     */
    open(title, bodyHTML, opts) {
      const o = opts || {};
      const el = document.getElementById('genericModal');
      if (modalCloseTimer) { clearTimeout(modalCloseTimer); modalCloseTimer = null; }
      const wasOpen = !el.classList.contains('hidden') && !el.classList.contains('is-closing');
      document.getElementById('modalTitle').textContent = title;
      document.getElementById('modalBody').innerHTML = bodyHTML;
      el.classList.remove('is-closing');
      el.classList.remove('hidden');
      applyModalChrome(el, o);
      // Animasi masuk hanya saat modal baru dibuka — bukan saat isinya diganti
      // ketika modal masih tampil (mencegah kedip/lompatan saat memperbarui isi).
      const box = el.querySelector('.modal-content');
      if (box) {
        if (o.animate === false) box.style.animation = 'none';
        else if (!wasOpen) { box.style.animation = 'none'; void box.offsetWidth; box.style.animation = ''; }
      }
      // Autofocus the first meaningful field for faster data entry
      if (o.autofocus !== false) {
        setTimeout(() => {
          const first = el.querySelector('#modalBody input:not([type=hidden]):not([readonly]), #modalBody textarea, #modalBody select');
          if (first) try { first.focus({ preventScroll: true }); } catch (e) { /* noop */ }
        }, 60);
      }
      if (global.Effects) Effects.enhance(el);
      if (global.Responsive) Responsive.apply(el);
    },
    close() {
      const el = document.getElementById('genericModal');
      if (!el || el.classList.contains('hidden')) return;
      el.classList.add('is-closing');
      if (modalCloseTimer) clearTimeout(modalCloseTimer);
      modalCloseTimer = setTimeout(() => {
        modalCloseTimer = null;
        el.classList.add('hidden');
        el.classList.remove('is-closing');
        el.classList.remove('is-full');
        const fb = document.getElementById('modalFull');
        if (fb) fb.remove();
      }, 170);
    },
    isOpen() {
      const el = document.getElementById('genericModal');
      return !!el && !el.classList.contains('hidden') && !el.classList.contains('is-closing');
    }
  };

  const TOAST_ICONS = { success: '✓', error: '!', info: 'i', warning: '⚠' };

  function toast(msg, type = 'success') {
    const kind = ['success', 'error', 'info', 'warning'].includes(type) ? type : 'success';
    let t = document.getElementById('toastBox');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toastBox';
      // Posisi & tampilan diatur css/design-system.css (kanan atas, di bawah topbar).
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      document.body.appendChild(t);
    }
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    if (kind === 'error') el.setAttribute('role', 'alert');
    el.innerHTML = `<span class="t-icon">${TOAST_ICONS[kind]}</span><span class="t-msg"></span>`;
    el.querySelector('.t-msg').textContent = msg;
    t.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  function confirmDialog(msg) { return window.confirm(msg); }

  /**
   * Kolom pilihan warna: kotak contoh warna + kode heksa, dengan garis tepi
   * yang ikut berubah sesuai warna terpilih.
   * @param {string} name   atribut name input
   * @param {string} value  warna awal (#rrggbb)
   * @param {string} [attrs] atribut tambahan untuk <input> (mis. 'id="x"')
   * @param {string} [fallback] warna bila value tidak valid
   */
  function colorFieldHtml(name, value, attrs, fallback) {
    const ok = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ''));
    const v = ok(value) ? String(value) : (ok(fallback) ? String(fallback) : '#4f46e5');
    return `<span class="color-field" style="--picked:${v}"><input type="color" name="${esc(name)}" value="${v}" ${attrs || ''} />` +
      `<code class="color-hex" aria-hidden="true">${v.toUpperCase()}</code></span>`;
  }
  function syncColorField(e) {
    const t = e.target;
    if (!t || t.type !== 'color' || !t.closest) return;
    const wrap = t.closest('.color-field');
    if (!wrap) return;
    wrap.style.setProperty('--picked', t.value);
    const hex = wrap.querySelector('.color-hex');
    if (hex) hex.textContent = String(t.value || '').toUpperCase();
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('input', syncColorField, true);
    document.addEventListener('change', syncColorField, true);
  }

  /** Status memuat pada tombol (spinner + nonaktif sementara). */
  function setBusy(btn, busy) {
    if (!btn) return;
    btn.classList.toggle('is-loading', !!busy);
    btn.disabled = !!busy;
    if (busy) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
  }

  function initials(name) {
    return (name || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
  }

  function bannerClass(idx) {
    const classes = ['', 'v2', 'v3', 'v4'];
    return classes[idx % classes.length];
  }

  /* ===== Visual building blocks ===== */
  /** Animated progress bar. tone: auto | good | warn | bad */
  function progressHtml(pct, label, tone) {
    const v = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    let cls = tone;
    if (!cls || cls === 'auto') cls = v >= 75 ? 'good' : (v >= 45 ? 'warn' : 'bad');
    return `
      ${label ? `<div class="progress-label"><span>${esc(label)}</span><strong>${v}%</strong></div>` : ''}
      <div class="progress ${cls}"><span data-pct="${v}" style="width:0"></span></div>`;
  }

  /** Circular percentage meter. */
  function meterHtml(pct, tone) {
    const v = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    let cls = tone;
    if (!cls || cls === 'auto') cls = v >= 75 ? 'good' : (v >= 45 ? 'warn' : 'bad');
    return `<div class="meter ${cls}" data-val="${v}" style="--val:${v};"><span>${v}%</span></div>`;
  }

  /** Section heading with an icon chip. */
  function secHead(icon, title, sub) {
    return `<div class="sec-head">
      <div class="sh-ic">${icon}</div>
      <div><h3>${esc(title)}</h3>${sub ? `<div class="sh-sub">${esc(sub)}</div>` : ''}</div>
    </div>`;
  }

  /** Human friendly relative time ("5 menit lalu"). */
  function fmtRelative(ts) {
    if (!ts) return '-';
    const diff = Date.now() - Number(ts);
    if (diff < 0) return fmtDateTime(ts);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'baru saja';
    if (mins < 60) return `${mins} menit lalu`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} jam lalu`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days} hari lalu`;
    return fmtDate(ts);
  }

  /** Time-of-day greeting in Indonesian, timezone aware. */
  function greeting() {
    const h = nowInTz().getHours();
    if (h < 11) return 'Selamat pagi';
    if (h < 15) return 'Selamat siang';
    if (h < 18) return 'Selamat sore';
    return 'Selamat malam';
  }

  /** Muat ulang halaman setelah perubahan terkirim ke server (mode server) agar tidak hilang. */
  function reloadAfterSync(delay) {
    const go = () => location.reload();
    const wait = Number(delay) || 400;
    if (global.Sync && Sync.isServer && Sync.isServer()) {
      setTimeout(() => {
        Promise.race([Sync.flush(), new Promise(r => setTimeout(r, 8000))]).then(go, go);
      }, wait);
      return;
    }
    setTimeout(go, wait);
  }

  global.UI = {
    esc, fmtDate, fmtDateTime, toDateInput, toDateTimeLocalInput, todayYMD, fmtYMD, fmtRp, fmtDuration,
    modal, toast, confirmDialog, setBusy, initials, bannerClass, reloadAfterSync, colorFieldHtml,
    progressHtml, meterHtml, secHead, fmtRelative, greeting,
    // Timezone
    TZ_OFFSETS, TZ_LABELS, getTimezone, setTimezone, nowInTz, toTzDate, fmtClock, fmtFullDateTime,
    startClock, clockWidgetHtml, tzInputToUtc, utcToTzInput, fmtDateTimeTz
  };
})(window);
