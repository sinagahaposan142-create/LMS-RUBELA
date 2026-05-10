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

  function fmtDate(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function fmtDateTime(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function toDateInput(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function toDateTimeLocalInput(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function todayYMD() {
    const d = new Date();
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

  global.UI = { esc, fmtDate, fmtDateTime, toDateInput, toDateTimeLocalInput, todayYMD, fmtYMD, fmtRp, fmtDuration, modal, toast, confirmDialog, initials, bannerClass };
})(window);
