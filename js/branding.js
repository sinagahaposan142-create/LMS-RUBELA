/* ===== LMS Rubela - Identitas & Logo =====
 * Menerapkan nama, tagline, dan logo yang diunggah admin ke seluruh tampilan:
 * halaman masuk (index.html), sidebar dashboard, judul tab peramban, dan
 * ikon pintasan. Bila belum ada logo, dipakai inisial nama aplikasi.
 */
(function (global) {

  /* Halaman masuk tidak memuat js/ui.js, jadi modul ini harus mandiri. */
  function esc(s) {
    if (global.UI && UI.esc) return UI.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function settings() {
    try { return DB.getSettings(); } catch (e) { return {}; }
  }

  /** Isi sebuah kotak .brand-logo dengan gambar atau inisial. */
  function fillLogo(el, st) {
    if (!el) return;
    const name = (st.appName || 'LMS Rubela').trim();
    if (st.appLogo) {
      el.innerHTML = `<img src="${esc(st.appLogo)}" alt="${esc(name)}" />`;
      el.classList.add('has-img');
    } else {
      el.textContent = name.charAt(0).toUpperCase() || 'R';
      el.classList.remove('has-img');
    }
  }

  /** Terapkan identitas ke seluruh elemen yang relevan pada halaman ini. */
  function apply() {
    const st = settings();
    const name = (st.appName || 'LMS Rubela').trim();
    const tagline = st.appTagline || '';

    document.querySelectorAll('.brand-logo').forEach(el => fillLogo(el, st));

    // Nama aplikasi di hero halaman masuk & sidebar dashboard
    document.querySelectorAll('.brand h1').forEach(el => { el.textContent = name; });
    // Tagline hanya ada di halaman masuk; sidebar memakai <p id="sideRole">
    document.querySelectorAll('.brand p:not(#sideRole)').forEach(el => { el.textContent = tagline; });

    document.querySelectorAll('[data-app-name]').forEach(el => { el.textContent = name; });

    /* Judul tab dibangun dari label halaman yang tersimpan di atribut
     * data-page, bukan dari judul saat ini — kalau memotong judul lama,
     * nama merek sebelumnya bisa ikut tertinggal. */
    const titleEl = document.querySelector('title');
    if (titleEl) {
      const page = titleEl.dataset.page || '';
      titleEl.textContent = page ? `${page} - ${name}` : name;
    }

    // Ikon pintasan mengikuti logo bila ada
    if (st.appLogo) {
      let link = document.querySelector('link[rel="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = st.appLogo;
    }

    // Footer hak cipta di halaman masuk
    document.querySelectorAll('.hero-footer').forEach(el => {
      el.innerHTML = `&copy; ${new Date().getFullYear()} ${esc(name)}`;
    });
  }

  // Jalankan segera setelah DOM siap agar tidak ada kedipan teks lama
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }

  global.Branding = { apply, fillLogo };
})(window);
