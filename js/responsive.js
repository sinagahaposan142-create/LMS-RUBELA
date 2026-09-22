/* ===== LMS Rubela - Responsive Enhancements =====
 * Penyempurnaan responsif yang tidak memerlukan perubahan markup di modul lain.
 *
 *  1. Tabel: menyalin judul kolom <th> ke atribut data-label pada setiap <td>
 *     sehingga CSS dapat mengubah tabel menjadi kartu di layar sempit.
 *  2. Menandai .table-wrap yang isinya melebihi lebar (petunjuk gulir).
 *  3. Menyisipkan jam ke dalam drawer saat topbar terlalu sempit.
 *  4. Menutup drawer otomatis saat layar kembali lebar / orientasi berubah.
 *  5. Memperbaiki tinggi viewport pada browser mobile (--vh) untuk elemen 100vh.
 *
 * Semua bersifat progressive enhancement: bila gagal, tampilan tetap berfungsi.
 */
(function (global) {
  const MOBILE_TABLE_BP = 760;   // selaras dengan responsive.css
  const NARROW_TOPBAR_BP = 560;

  /* =====================================================================
   * 1 & 2. Tabel responsif
   * ===================================================================*/
  /** Salin header kolom ke data-label tiap sel + tandai tabel siap kartu. */
  function labelTables(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('table.table').forEach(table => {
      // Ambil label dari baris header pertama
      const headRow = table.querySelector('thead tr');
      const labels = headRow
        ? [...headRow.children].map(th => (th.textContent || '').trim())
        : [];

      // Tabel "kunci-nilai" (tanpa thead, kolom pertama adalah <th>) tidak diubah
      const isKeyValue = !headRow && table.querySelector('tbody th');
      if (isKeyValue) { table.classList.remove('as-cards'); return; }

      if (labels.length) table.classList.add('as-cards');

      table.querySelectorAll('tbody tr').forEach(tr => {
        let colIndex = 0;
        [...tr.children].forEach(cell => {
          if (cell.tagName !== 'TD') { colIndex += cell.colSpan || 1; return; }
          if (!cell.hasAttribute('data-label')) {
            const raw = labels[colIndex] != null ? labels[colIndex] : '';
            // Kolom aksi tidak perlu label
            const isAction = cell.classList.contains('actions') || /^aksi$/i.test(raw);
            cell.setAttribute('data-label', isAction ? '' : raw);
            if (isAction) cell.classList.add('no-label');
          }
          colIndex += cell.colSpan || 1;
        });
      });
    });
  }

  /** Tandai wrapper yang isinya lebih lebar dari area tampil. */
  function markOverflow(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('.table-wrap').forEach(wrap => {
      const overflowing = wrap.scrollWidth > wrap.clientWidth + 2;
      wrap.classList.toggle('has-overflow', overflowing);
      // Sisipkan petunjuk tekstual sekali saja
      if (overflowing && window.innerWidth > MOBILE_TABLE_BP) {
        if (!wrap.nextElementSibling || !wrap.nextElementSibling.classList.contains('table-scroll-hint')) {
          const hint = document.createElement('div');
          hint.className = 'table-scroll-hint';
          hint.textContent = '← geser tabel untuk melihat kolom lainnya →';
          wrap.insertAdjacentElement('afterend', hint);
        }
      }
    });
  }

  /* =====================================================================
   * 3. Jam di dalam drawer saat topbar sempit
   * ===================================================================*/
  let sideClockTimer = null;
  function syncSideClock() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || !global.UI || !UI.nowInTz) return;
    const narrow = window.innerWidth <= NARROW_TOPBAR_BP;
    let box = document.getElementById('sideClock');

    if (!narrow) {
      if (box) box.remove();
      if (sideClockTimer) { clearInterval(sideClockTimer); sideClockTimer = null; }
      return;
    }
    if (!box) {
      box = document.createElement('div');
      box.className = 'side-clock';
      box.id = 'sideClock';
      box.innerHTML = '<div class="sc-time" id="scTime">--:--:--</div><div class="sc-date" id="scDate">-</div>';
      const brand = sidebar.querySelector('.brand');
      if (brand) brand.insertAdjacentElement('afterend', box);
      else sidebar.prepend(box);
    }
    const tick = () => {
      const t = document.getElementById('scTime');
      const d = document.getElementById('scDate');
      if (!t || !d) return;
      const now = UI.nowInTz();
      t.textContent = UI.fmtClock(now) + ' ' + UI.getTimezone();
      d.textContent = UI.fmtFullDateTime(now);
    };
    tick();
    if (sideClockTimer) clearInterval(sideClockTimer);
    sideClockTimer = setInterval(tick, 1000);
  }

  /* =====================================================================
   * 4. Drawer: tutup saat kembali ke layar lebar
   * ===================================================================*/
  function closeDrawerIfWide() {
    if (window.innerWidth >= 1024) {
      const sidebar = document.getElementById('sidebar');
      if (sidebar && sidebar.classList.contains('open')) sidebar.classList.remove('open');
      const scrim = document.querySelector('.sidebar-scrim');
      if (scrim) scrim.remove();
    }
  }

  /* =====================================================================
   * 5. Tinggi viewport nyata (--vh) untuk browser mobile
   * ===================================================================*/
  function setVhUnit() {
    document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');
  }

  /* =====================================================================
   * Orkestrasi
   * ===================================================================*/
  function apply(root) {
    try {
      labelTables(root);
      markOverflow(root);
      syncSideClock();
    } catch (e) {
      // Penyempurnaan gagal tidak boleh mematikan aplikasi
      console.warn('[Responsive] gagal menerapkan penyempurnaan:', e);
    }
  }

  let resizeRaf = null;
  function onResize() {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      setVhUnit();
      markOverflow(document);
      syncSideClock();
      closeDrawerIfWide();
    });
  }

  /* Amati perubahan DOM di area konten agar tabel baru ikut diproses.
   * Dibatasi ke #content + overlay agar ringan. */
  function observe() {
    if (!('MutationObserver' in global)) return;
    const observer = new MutationObserver((mutations) => {
      let touched = false;
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches && (node.matches('table.table, .table-wrap') ||
              node.querySelector && node.querySelector('table.table'))) {
            touched = true;
            break;
          }
        }
        if (touched) break;
      }
      if (touched) apply(document);
    });
    const content = document.getElementById('content');
    if (content) observer.observe(content, { childList: true, subtree: true });
    observer.observe(document.body, { childList: true });
  }

  setVhUnit();
  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('orientationchange', onResize, { passive: true });
  document.addEventListener('DOMContentLoaded', () => {
    apply(document);
    observe();
  });

  global.Responsive = { apply, labelTables, markOverflow, syncSideClock };
})(window);
