/* =========================================================================
 * PtnAdmin — Tools → Data PTN (khusus admin).
 *
 * Kelola kampus, fakultas, dan jurusan beserta rata-rata skor, skor minimum,
 * skor per subtest, daya tampung, dan peminat. Data inilah yang dipakai
 * Kalkulator UTBK. Impor/ekspor Excel (.xlsx) atau CSV dengan kolom
 * PTN.COLUMNS; impor menampilkan pratinjau dulu sebelum disimpan.
 * Tidak ada data bawaan: semua angka diisi admin dari sumber yang ia pilih.
 * =======================================================================*/
(function (global) {
  'use strict';

  const esc = (s) => UI.esc(s);
  const fmt = (n, d) => (n == null ? '—' : Number(n).toLocaleString('id-ID', { maximumFractionDigits: d == null ? 1 : d }));
  const svg = (d, size) => `<svg viewBox="0 0 24 24" width="${size || 16}" height="${size || 16}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    db: svg('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>', 20),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    up: svg('<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>'),
    down: svg('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>')
  };
  const ui = { tab: 'majors' };

  function guardView(container, user) {
    if (user && user.role === 'admin') return true;
    container.innerHTML = '<div class="card"><div class="alert alert-error">Data PTN hanya dapat dikelola admin.</div></div>';
    return false;
  }

  function render(container, user) {
    if (!guardView(container, user)) return;
    const cs = PTN.campuses(), fs = PTN.faculties(), ms = PTN.majors();
    const years = [...new Set(ms.map(m => m.year).filter(Boolean))].sort((a, b) => b - a);
    container.innerHTML = `
      <div class="card tl-head">
        ${UI.secHead(ICON.db, 'Data PTN', 'Kampus, fakultas, dan jurusan untuk Kalkulator UTBK. Isi dari sumber resmi atau rekap yang Anda percaya, dan cantumkan sumbernya.')}
        <div class="flex-gap">
          <label class="btn btn-secondary btn-sm pa-file">${ICON.up} Impor Excel/CSV<input type="file" id="paFile" accept=".xlsx,.xls,.csv,.tsv,.txt" /></label>
          <button type="button" class="btn btn-secondary btn-sm" id="paExport" ${ms.length ? '' : 'disabled'}>${ICON.down} Ekspor</button>
          <button type="button" class="btn btn-ghost btn-sm" id="paTemplate">Unduh templat</button>
        </div>
      </div>
      <dl class="nwa-stats pa-stats">
        <div><dt>Kampus</dt><dd>${cs.length}</dd></div>
        <div><dt>Fakultas</dt><dd>${fs.length}</dd></div>
        <div><dt>Jurusan</dt><dd>${ms.length}</dd></div>
      </dl>
      <div class="pa-tabs" role="tablist" aria-label="Jenis data">
        <button type="button" role="tab" aria-selected="${ui.tab === 'majors'}" data-tab="majors">Jurusan</button>
        <button type="button" role="tab" aria-selected="${ui.tab === 'campuses'}" data-tab="campuses">Kampus &amp; fakultas</button>
      </div>
      <div class="card" id="paBody"></div>`;
    const reload = () => render(container, user);
    container.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { ui.tab = b.dataset.tab; reload(); }));
    container.querySelector('#paExport').addEventListener('click', () => exportData());
    container.querySelector('#paTemplate').addEventListener('click', () => downloadCsv([PTN.COLUMNS], 'templat_data_ptn.csv'));
    container.querySelector('#paFile').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        if (!global.Office) throw new Error('Modul impor belum termuat. Muat ulang halaman.');
        const rows = await Office.readTableFile(f);
        openImportPreview(PTN.planImport(rows), user, reload);
      } catch (err) { UI.toast(err.message || 'Berkas tidak dapat dibaca.', 'error'); }
    });

    const body = container.querySelector('#paBody');
    if (ui.tab === 'campuses') return paintCampuses(body, user, reload);

    body.innerHTML = `<div class="pa-bar"><h3>Jurusan</h3>
        <button type="button" class="btn btn-primary btn-sm" id="paAddMajor" ${cs.length ? '' : 'disabled title="Tambahkan kampus terlebih dahulu"'}>${ICON.plus} Tambah jurusan</button></div>
      ${cs.length ? '' : `<div class="tl-empty"><strong>Belum ada kampus</strong><span>Tambahkan kampus di tab "Kampus &amp; fakultas", atau impor berkas Excel/CSV sesuai templat.</span>
        <button type="button" class="btn btn-primary btn-sm" id="paGoCampus">Tambah kampus</button></div>`}
      <div id="paMajors"></div>`;
    const add = body.querySelector('#paAddMajor');
    if (add) add.addEventListener('click', () => openMajorForm(user, null, reload));
    const go = body.querySelector('#paGoCampus');
    if (go) go.addEventListener('click', () => { ui.tab = 'campuses'; reload(); setTimeout(() => openCampusForm(user, null, reload), 50); });
    if (!cs.length) return;
    DataSearch.mount({
      container: body.querySelector('#paMajors'),
      items: ms,
      stateKey: 'admin-ptn-majors',
      placeholder: 'Cari jurusan, kampus, fakultas, atau sumber…',
      fields: m => { const c = PTN.campus(m.campusId) || {}, f = PTN.faculty(m.facultyId) || {}; return [m.name, m.level, c.name, c.short, c.city, f.name, m.source]; },
      filters: [
        { key: 'campus', label: 'Semua kampus', get: m => m.campusId, options: cs.map(c => ({ value: c.id, label: c.short ? `${c.name} (${c.short})` : c.name })) },
        { key: 'level', label: 'Semua jenjang', get: m => m.level, options: PTN.LEVELS.map(l => ({ value: l, label: l })) },
        { key: 'year', label: 'Semua tahun data', get: m => String(m.year || ''), options: years.map(y => ({ value: String(y), label: String(y) })) }
      ],
      sorts: [
        { key: 'name', label: 'Jurusan A–Z', cmp: (a, b) => a.name.localeCompare(b.name, 'id') },
        { key: 'avg', label: 'Rata-rata tertinggi', cmp: (a, b) => (b.avgScore || 0) - (a.avgScore || 0) },
        { key: 'upd', label: 'Terakhir diubah', cmp: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) }
      ],
      pageSize: 25,
      empty: 'Tidak ada jurusan yang cocok.',
      render: (rows, ctx) => `<div class="table-wrap"><table class="table pa-table">
        <thead><tr><th>Jurusan</th><th>Kampus · Fakultas</th><th class="num">Rata-rata</th><th class="num">Minimum</th><th class="num">Daya tampung / peminat</th><th>Subtest</th><th>Tahun</th><th><span class="sr-only">Aksi</span></th></tr></thead>
        <tbody>${rows.map(m => {
          const c = PTN.campus(m.campusId) || {}, f = PTN.faculty(m.facultyId) || {};
          const nSub = PTN.CODES.filter(k => (m.subtests || {})[k] != null).length;
          return `<tr><td><strong>${ctx.highlight(m.name)}</strong>${m.level !== 'S1' ? ` <span class="badge badge-gray">${esc(m.level)}</span>` : ''}</td>
            <td>${ctx.highlight(c.short || c.name || '—')}<div class="muted small">${ctx.highlight(f.name || 'Tanpa fakultas')}</div></td>
            <td class="num">${fmt(m.avgScore)}</td><td class="num">${fmt(m.minScore)}</td>
            <td class="num">${fmt(m.capacity, 0)} / ${fmt(m.applicants, 0)}</td>
            <td><span class="pa-sub ${nSub === 7 ? 'is-full' : ''}">${nSub}/7</span></td>
            <td>${m.year || '<span class="muted">—</span>'}</td>
            <td class="actions"><button type="button" class="btn btn-sm btn-secondary" data-edit="${esc(m.id)}">Sunting</button>
              <button type="button" class="btn btn-sm btn-ghost nwa-del" data-del="${esc(m.id)}">Hapus</button></td></tr>`;
        }).join('')}</tbody></table></div>`,
      onPaint: (box) => {
        box.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openMajorForm(user, PTN.major(b.dataset.edit), reload)));
        box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
          const m = PTN.major(b.dataset.del);
          if (!m || !UI.confirmDialog(`Hapus jurusan "${PTN.majorLabel(m)}"? Jurusan ini juga keluar dari pilihan tersimpan siswa.`)) return;
          PTN.deleteMajor(m.id, user);
          UI.toast('Jurusan dihapus.', 'success');
          reload();
        }));
      }
    });
  }

  /* ============================ kampus & fakultas ============================ */
  function paintCampuses(body, user, reload) {
    const cs = PTN.campuses();
    body.innerHTML = `<div class="pa-bar"><h3>Kampus &amp; fakultas</h3>
        <button type="button" class="btn btn-primary btn-sm" id="paAddCampus">${ICON.plus} Tambah kampus</button></div>
      ${cs.length ? `<ul class="pa-campus-list">${cs.map(c => {
        const fs = PTN.faculties(c.id);
        const nm = PTN.majors({ campusId: c.id }).length;
        return `<li class="pa-campus">
          <div class="pa-c-head"><div><strong>${esc(c.name)}</strong>${c.short ? ` <span class="muted">(${esc(c.short)})</span>` : ''}
              <div class="muted small">${esc([c.type, c.city, c.province].filter(Boolean).join(' · ') || 'Lokasi belum diisi')} · ${nm} jurusan</div></div>
            <div class="flex-gap">${c.website ? `<a class="btn btn-sm btn-ghost" href="${esc(c.website)}" target="_blank" rel="noopener noreferrer">Situs</a>` : ''}
              <button type="button" class="btn btn-sm btn-secondary" data-cedit="${esc(c.id)}">Sunting</button>
              <button type="button" class="btn btn-sm btn-ghost nwa-del" data-cdel="${esc(c.id)}">Hapus</button></div></div>
          <div class="pa-facs">${fs.map(f => `<span class="pa-fac"><span>${esc(f.name)}</span>
              <button type="button" class="link-btn" data-fedit="${esc(f.id)}" aria-label="Ganti nama ${esc(f.name)}">ubah</button>
              <button type="button" class="link-btn pa-x" data-fdel="${esc(f.id)}" aria-label="Hapus ${esc(f.name)}">hapus</button></span>`).join('')}
            <form class="pa-fac-add" data-fadd="${esc(c.id)}"><label class="sr-only" for="paF_${esc(c.id)}">Fakultas baru untuk ${esc(c.name)}</label>
              <input id="paF_${esc(c.id)}" maxlength="120" placeholder="Tambah fakultas…" /><button type="submit" class="btn btn-sm btn-secondary">Tambah</button></form></div>
        </li>`;
      }).join('')}</ul>` : '<div class="tl-empty"><strong>Belum ada kampus</strong><span>Tambahkan kampus pertama, atau impor berkas Excel/CSV sesuai templat.</span></div>'}`;
    body.querySelector('#paAddCampus').addEventListener('click', () => openCampusForm(user, null, reload));
    body.querySelectorAll('[data-cedit]').forEach(b => b.addEventListener('click', () => openCampusForm(user, PTN.campus(b.dataset.cedit), reload)));
    body.querySelectorAll('[data-cdel]').forEach(b => b.addEventListener('click', () => {
      const c = PTN.campus(b.dataset.cdel);
      if (!c) return;
      const nm = PTN.majors({ campusId: c.id }).length;
      if (!UI.confirmDialog(`Hapus kampus "${c.name}" beserta ${PTN.faculties(c.id).length} fakultas dan ${nm} jurusannya? Jadwal seleksi kampus ini tetap ada.`)) return;
      PTN.deleteCampus(c.id, user);
      UI.toast('Kampus dihapus.', 'success');
      reload();
    }));
    body.querySelectorAll('[data-fadd]').forEach(form => form.addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = form.querySelector('input');
      try { PTN.saveFaculty({ campusId: form.dataset.fadd, name: inp.value }, user); UI.toast('Fakultas ditambahkan.', 'success'); reload(); }
      catch (err) { UI.toast(err.message, 'error'); inp.focus(); }
    }));
    body.querySelectorAll('[data-fedit]').forEach(b => b.addEventListener('click', () => {
      const f = PTN.faculty(b.dataset.fedit);
      if (!f) return;
      const name = global.prompt('Nama fakultas', f.name);
      if (name == null || name.trim() === f.name) return;
      try { PTN.saveFaculty(Object.assign({}, f, { name }), user); reload(); } catch (err) { UI.toast(err.message, 'error'); }
    }));
    body.querySelectorAll('[data-fdel]').forEach(b => b.addEventListener('click', () => {
      const f = PTN.faculty(b.dataset.fdel);
      if (!f) return;
      const nm = PTN.majors({ facultyId: f.id }).length;
      if (!UI.confirmDialog(`Hapus fakultas "${f.name}"${nm ? ` beserta ${nm} jurusannya` : ''}?`)) return;
      PTN.deleteFaculty(f.id, user);
      reload();
    }));
  }

  function openCampusForm(user, c, onDone) {
    const e = c || {};
    UI.modal.open(e.id ? 'Sunting kampus' : 'Tambah kampus', `
      <form class="form" id="paCampusForm" novalidate>
        <div class="form-row">
          <div class="form-group"><label for="pcName">Nama kampus</label><input id="pcName" name="name" maxlength="120" required value="${esc(e.name || '')}" placeholder="mis. Universitas Gadjah Mada" /></div>
          <div class="form-group"><label for="pcShort">Singkatan</label><input id="pcShort" name="short" maxlength="20" value="${esc(e.short || '')}" placeholder="mis. UGM" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label for="pcCity">Kota</label><input id="pcCity" name="city" maxlength="60" value="${esc(e.city || '')}" /></div>
          <div class="form-group"><label for="pcProv">Provinsi</label><input id="pcProv" name="province" maxlength="60" value="${esc(e.province || '')}" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label for="pcType">Jenis</label><select id="pcType" name="type">${PTN.CAMPUS_TYPES.map(t => `<option ${(e.type || 'PTN') === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
          <div class="form-group"><label for="pcWeb">Situs resmi</label><input id="pcWeb" name="website" type="url" maxlength="300" value="${esc(e.website || '')}" placeholder="https://" /></div>
        </div>
        <div class="flex-gap"><button type="button" class="btn btn-secondary" data-cancel>Batal</button><button type="submit" class="btn btn-primary">Simpan kampus</button></div>
      </form>`);
    const f = document.getElementById('paCampusForm');
    f.querySelector('[data-cancel]').addEventListener('click', () => UI.modal.close());
    f.addEventListener('submit', (x) => {
      x.preventDefault();
      const d = Object.fromEntries(new FormData(f).entries());
      try { PTN.saveCampus(Object.assign({ id: e.id || null }, d), user); }
      catch (err) { UI.toast(err.message, 'error'); return; }
      UI.modal.close();
      UI.toast('Kampus disimpan.', 'success');
      onDone();
    });
  }

  /* ============================ jurusan ============================ */
  function openMajorForm(user, m, onDone) {
    const e = m || {};
    const cs = PTN.campuses();
    const v = (x) => (x == null ? '' : esc(String(x).replace('.', ',')));
    UI.modal.open(e.id ? 'Sunting jurusan' : 'Tambah jurusan', `
      <form class="form" id="paMajorForm" novalidate>
        <div class="form-row">
          <div class="form-group"><label for="pmCampus">Kampus</label><select id="pmCampus" name="campusId" required>
            <option value="">Pilih kampus</option>${cs.map(c => `<option value="${esc(c.id)}" ${e.campusId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
          <div class="form-group"><label for="pmFaculty">Fakultas</label><select id="pmFaculty" name="facultyId"></select>
            <input id="pmFacNew" maxlength="120" placeholder="Nama fakultas baru" hidden class="mt-1" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label for="pmName">Nama jurusan / program studi</label><input id="pmName" name="name" maxlength="120" required value="${esc(e.name || '')}" /></div>
          <div class="form-group pa-narrow"><label for="pmLevel">Jenjang</label><select id="pmLevel" name="level">${PTN.LEVELS.map(l => `<option ${(e.level || 'S1') === l ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="form-group pa-narrow"><label for="pmYear">Tahun data</label><input id="pmYear" name="year" inputmode="numeric" value="${v(e.year)}" placeholder="${new Date().getFullYear() - 1}" /></div>
        </div>
        <fieldset class="pa-fs"><legend>Skor diterima <span class="muted">(skala UTBK, isi minimal salah satu)</span></legend>
          <div class="form-row">
            <div class="form-group"><label for="pmAvg">Rata-rata skor</label><input id="pmAvg" name="avgScore" inputmode="decimal" value="${v(e.avgScore)}" placeholder="mis. 650,5" /></div>
            <div class="form-group"><label for="pmMin">Skor minimum</label><input id="pmMin" name="minScore" inputmode="decimal" value="${v(e.minScore)}" placeholder="mis. 610" /></div>
          </div>
          <div class="pa-sub-grid">${(DB.SUBTESTS || []).map(s => `<div class="form-group"><label for="pmS_${s.code}">${esc(s.code)}</label>
            <input id="pmS_${s.code}" data-sub="${s.code}" inputmode="decimal" value="${v((e.subtests || {})[s.code])}" title="${esc(s.name)}" /></div>`).join('')}</div>
          <p class="muted small">Rata-rata per subtest opsional. Bila diisi, siswa melihat selisih skornya per subtest.</p>
        </fieldset>
        <div class="form-row">
          <div class="form-group"><label for="pmCap">Daya tampung</label><input id="pmCap" name="capacity" inputmode="numeric" value="${v(e.capacity)}" /></div>
          <div class="form-group"><label for="pmApp">Peminat</label><input id="pmApp" name="applicants" inputmode="numeric" value="${v(e.applicants)}" /></div>
        </div>
        <div class="form-group"><label for="pmSrc">Sumber data</label><input id="pmSrc" name="source" maxlength="200" value="${esc(e.source || '')}" placeholder="mis. Rekap SNBT 2025 dari situs kampus" /></div>
        <div class="form-group"><label for="pmNotes">Catatan</label><textarea id="pmNotes" name="notes" rows="2" maxlength="500">${esc(e.notes || '')}</textarea></div>
        <div class="flex-gap"><button type="button" class="btn btn-secondary" data-cancel>Batal</button><button type="submit" class="btn btn-primary">Simpan jurusan</button></div>
      </form>`, { fullscreenToggle: true, fullKey: 'ptn-major' });
    const f = document.getElementById('paMajorForm');
    const campusSel = f.querySelector('#pmCampus'), facSel = f.querySelector('#pmFaculty'), facNew = f.querySelector('#pmFacNew');
    const paintFac = (keep) => {
      const fs = campusSel.value ? PTN.faculties(campusSel.value) : [];
      facSel.disabled = !campusSel.value;
      facSel.innerHTML = `<option value="">${campusSel.value ? 'Tanpa fakultas' : 'Pilih kampus dulu'}</option>` +
        fs.map(x => `<option value="${esc(x.id)}" ${keep === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('') +
        (campusSel.value ? '<option value="__new">+ Fakultas baru…</option>' : '');
      facNew.hidden = true;
    };
    paintFac(e.facultyId);
    campusSel.addEventListener('change', () => paintFac(null));
    facSel.addEventListener('change', () => { facNew.hidden = facSel.value !== '__new'; if (!facNew.hidden) facNew.focus(); });
    f.querySelector('[data-cancel]').addEventListener('click', () => UI.modal.close());
    f.addEventListener('submit', (x) => {
      x.preventDefault();
      const d = Object.fromEntries(new FormData(f).entries());
      const subtests = {};
      f.querySelectorAll('[data-sub]').forEach(i => { subtests[i.dataset.sub] = i.value; });
      let facultyId = d.facultyId || null;
      let created = null;
      try {
        if (facultyId === '__new') {
          // Nama yang sudah ada dipakai ulang; fakultas baru dibatalkan bila jurusan gagal disimpan.
          const same = PTN.faculties(d.campusId).find(x => PTN.norm(x.name) === PTN.norm(facNew.value));
          facultyId = same ? same.id : (created = PTN.saveFaculty({ campusId: d.campusId, name: facNew.value }, user)).id;
        }
        PTN.saveMajor(Object.assign({}, d, { id: e.id || null, facultyId, subtests }), user);
      } catch (err) {
        if (created) PTN.deleteFaculty(created.id, user);
        UI.toast(err.message, 'error');
        return;
      }
      UI.modal.close();
      UI.toast('Jurusan disimpan.', 'success');
      onDone();
    });
  }

  /* ============================ impor / ekspor ============================ */
  function openImportPreview(plan, user, onDone) {
    const c = plan.counts;
    const total = c.newMajor + c.updMajor;
    UI.modal.open('Pratinjau impor data PTN', `
      <div class="pa-import">
        <dl class="nwa-stats">
          <div><dt>Kampus baru</dt><dd>${c.newCampus}</dd></div>
          <div><dt>Jurusan baru</dt><dd>${c.newMajor}</dd></div>
          <div><dt>Jurusan diperbarui</dt><dd>${c.updMajor}</dd></div>
        </dl>
        <p class="muted small">${c.newFaculty} fakultas baru${c.updCampus ? `, ${c.updCampus} data kampus diperbarui` : ''}. Jurusan dicocokkan dari kampus, fakultas, nama, dan jenjang; baris yang cocok menimpa data lama.</p>
        ${plan.errors.length ? `<div class="alert alert-warning"><strong>${plan.errors.length} baris dilewati</strong>
          <ul class="pa-errs">${plan.errors.slice(0, 30).map(x => `<li>${esc(x)}</li>`).join('')}</ul>${plan.errors.length > 30 ? `<div class="small">…dan ${plan.errors.length - 30} lainnya.</div>` : ''}</div>` : ''}
        ${total ? `<div class="table-wrap"><table class="table"><thead><tr><th>Jurusan</th><th>Kampus</th><th class="num">Rata-rata</th><th class="num">Minimum</th></tr></thead>
          <tbody>${plan.majors.slice(0, 15).map(m => { const cp = plan.campuses.find(x => x.id === m.campusId) || PTN.campus(m.campusId) || {};
            return `<tr><td>${esc(m.name)} <span class="muted small">${esc(m.level)}</span></td><td>${esc(cp.short || cp.name || '')}</td><td class="num">${fmt(m.avgScore)}</td><td class="num">${fmt(m.minScore)}</td></tr>`; }).join('')}</tbody></table></div>
          ${plan.majors.length > 15 ? `<p class="muted small">Menampilkan 15 dari ${plan.majors.length} jurusan.</p>` : ''}` : '<p>Tidak ada baris yang dapat diimpor.</p>'}
        <div class="flex-gap mt-2"><button type="button" class="btn btn-secondary" data-cancel>Batal</button>
          <button type="button" class="btn btn-primary" data-ok ${total || c.newCampus || c.updCampus ? '' : 'disabled'}>Simpan ${total} jurusan</button></div>
      </div>`, { fullscreenToggle: true, fullKey: 'ptn-import', autofocus: false });
    const box = document.getElementById('modalBody');
    box.querySelector('[data-cancel]').addEventListener('click', () => UI.modal.close());
    box.querySelector('[data-ok]').addEventListener('click', () => {
      try { PTN.applyImport(plan, user); } catch (err) { UI.toast(err.message, 'error'); return; }
      UI.modal.close();
      UI.toast(`${total} jurusan diimpor.`, 'success');
      onDone();
    });
  }

  function exportData() {
    const rows = PTN.exportRows();
    const stamp = UI.todayYMD();
    if (typeof XLSX !== 'undefined') {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Data PTN');
      XLSX.writeFile(wb, `data_ptn_${stamp}.xlsx`);
    } else downloadCsv(rows, `data_ptn_${stamp}.csv`);
    UI.toast(`${rows.length - 1} jurusan diekspor.`, 'success');
  }
  /** CSV titik-koma (dibuka rapi di Excel berbahasa Indonesia); angka desimal memakai koma. */
  function downloadCsv(rows, name) {
    const cell = (v) => {
      const s = typeof v === 'number' ? String(v).replace('.', ',') : (v == null ? '' : String(v));
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const blob = new Blob(['\uFEFF' + rows.map(r => r.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  global.PtnAdmin = { render };
})(window);
