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

  const modal = {
    open(title, bodyHTML) {
      const el = document.getElementById('genericModal');
      document.getElementById('modalTitle').textContent = title;
      document.getElementById('modalBody').innerHTML = bodyHTML;
      el.classList.remove('hidden');
    },
    close() {
      document.getElementById('genericModal').classList.add('hidden');
    }
  };

  function toast(msg, type = 'success') {
    let t = document.getElementById('toastBox');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toastBox';
      t.style.position = 'fixed';
      t.style.bottom = '24px';
      t.style.right = '24px';
      t.style.zIndex = '200';
      t.style.display = 'flex';
      t.style.flexDirection = 'column';
      t.style.gap = '8px';
      document.body.appendChild(t);
    }
    const el = document.createElement('div');
    el.className = 'alert alert-' + (type === 'error' ? 'error' : type === 'info' ? 'info' : 'success');
    el.style.minWidth = '240px';
    el.style.boxShadow = 'var(--shadow)';
    el.textContent = msg;
    t.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function confirmDialog(msg) { return window.confirm(msg); }

  function initials(name) {
    return (name || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
  }

  function bannerClass(idx) {
    const classes = ['', 'v2', 'v3', 'v4'];
    return classes[idx % classes.length];
  }

  global.UI = {
    esc, fmtDate, fmtDateTime, toDateInput, toDateTimeLocalInput, todayYMD, fmtYMD, fmtRp, fmtDuration,
    modal, toast, confirmDialog, initials, bannerClass,
    // Timezone
    TZ_OFFSETS, TZ_LABELS, getTimezone, setTimezone, nowInTz, toTzDate, fmtClock, fmtFullDateTime,
    startClock, clockWidgetHtml, tzInputToUtc, utcToTzInput, fmtDateTimeTz
  };
})(window);
