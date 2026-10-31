/* =====================================================================
 * js/attendance-insights.js — visualisasi persentase kehadiran
 * ---------------------------------------------------------------------
 * Dipakai bersama panel admin, tutor, siswa, dan orang tua sehingga rumus,
 * warna, dan tata letaknya identik di seluruh dashboard.
 *
 * Rumus (DB.attendanceSummary):
 *   (hadir + terlambat) / total sesi terlaksana × 100%
 *   - sesi yang rencana kelasnya DIBATALKAN tidak dihitung
 *   - izin/sakit mengikuti kebijakan admin (attendanceExcusedPolicy)
 * ===================================================================*/
(function (global) {
  'use strict';

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const COLORS = {
    hadir: 'var(--success)', terlambat: '#0ea5e9', izin: 'var(--accent)',
    sakit: 'var(--warning)', alfa: 'var(--danger)'
  };
  const esc = (s) => UI.esc(s);

  function monthLabel(ym) {
    const [y, m] = String(ym).split('-');
    return `${MONTHS[Number(m) - 1] || m} ${String(y).slice(2)}`;
  }

  /** Nada warna sesuai ambang batas admin. */
  function tone(pct, threshold) {
    const t = threshold == null ? DB.attendanceThreshold() : threshold;
    if (pct >= Math.max(t + 10, 90)) return 'good';
    if (pct >= t) return 'ok';
    return 'bad';
  }

  /** Circular progress SVG (aksesibel, tanpa library). */
  function ringHtml(pct, label, size) {
    const s = size || 112;
    const r = (s / 2) - 9;
    const c = 2 * Math.PI * r;
    const v = Math.max(0, Math.min(100, Number(pct) || 0));
    const t = tone(v);
    return `<div class="ai-ring ai-${t}" style="width:${s}px;height:${s}px;" role="img"
        aria-label="${esc(label || 'Kehadiran')} ${v}%">
      <svg viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
        <circle cx="${s / 2}" cy="${s / 2}" r="${r}" class="ai-ring-bg" />
        <circle cx="${s / 2}" cy="${s / 2}" r="${r}" class="ai-ring-fg"
          stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - v / 100)).toFixed(2)}"
          transform="rotate(-90 ${s / 2} ${s / 2})" />
      </svg>
      <div class="ai-ring-val"><strong>${v}%</strong><span>${esc(label || 'hadir')}</span></div>
    </div>`;
  }

  /** Bar progress sesuai nada ambang. */
  function barHtml(pct) {
    const v = Math.max(0, Math.min(100, Number(pct) || 0));
    return `<div class="ai-bar ai-${tone(v)}" title="${v}%"><span style="width:${v}%"></span><em>${v}%</em></div>`;
  }

  /** Grafik batang sederhana berbasis CSS (bulanan / semester). */
  function chartHtml(rows, keyFn, labelFn) {
    if (!rows.length) return '<div class="muted small">Belum ada data untuk digrafikkan.</div>';
    const threshold = DB.attendanceThreshold();
    return `<div class="ai-chart" role="img" aria-label="Grafik persentase kehadiran">
      <div class="ai-chart-line" style="bottom:calc(26px + ${(threshold * 1.5).toFixed(1)}px)" title="Ambang ${threshold}%"><span>${threshold}%</span></div>
      ${rows.map(r => `
        <div class="ai-col" title="${esc(labelFn(r))}: ${r.pct}% (${r.present}/${r.sessions} sesi)">
          <div class="ai-col-val">${r.sessions ? Math.round(r.pct) + '%' : '–'}</div>
          <div class="ai-col-bar ai-${tone(r.pct)}" style="height:${r.sessions ? Math.max(3, r.pct) : 0}%"></div>
          <div class="ai-col-lbl">${esc(keyFn(r))}</div>
        </div>`).join('')}
    </div>`;
  }

  /** Kartu ringkasan jumlah per status. */
  function countsHtml(sum) {
    return `<div class="ai-counts">
      <div class="ai-count"><span>Total sesi</span><strong>${sum.sessions}</strong></div>
      ${DB.ATT_STATUSES.map(s => `
        <div class="ai-count"><span><i style="background:${COLORS[s.key]}"></i>${esc(s.label)}</span><strong>${sum.counts[s.key] || 0}</strong></div>`).join('')}
      ${sum.cancelled ? `<div class="ai-count is-muted"><span>Sesi dibatalkan</span><strong>${sum.cancelled}</strong></div>` : ''}
    </div>`;
  }

  function warningHtml(sum, who) {
    const t = DB.attendanceThreshold();
    if (!sum.sessions || sum.pct >= t) return '';
    return `<div class="alert alert-error ai-warn" role="alert">
      ⚠️ Kehadiran ${esc(who || '')} <strong>${sum.pct}%</strong> berada di bawah standar <strong>${t}%</strong>
      yang ditetapkan admin.</div>`;
  }

  /** Filter periode berbasis tanggal YYYY-MM-DD. */
  const PERIODS = [
    { key: 'all', label: 'Semua periode' },
    { key: '30', label: '30 hari terakhir' },
    { key: '90', label: '3 bulan terakhir' },
    { key: 'sem', label: 'Semester berjalan' },
    { key: 'year', label: 'Tahun ini' }
  ];
  function inPeriod(ymd, period) {
    if (!period || period === 'all') return true;
    const today = DB.ymdOf(Date.now());
    if (period === 'year') return ymd.slice(0, 4) === today.slice(0, 4);
    if (period === 'sem') {
      const y = Number(today.slice(0, 4));
      const m = Number(today.slice(5, 7));
      const from = m >= 7 ? `${y}-07-01` : `${y}-01-01`;
      const to = m >= 7 ? `${y}-12-31` : `${y}-06-30`;
      return ymd >= from && ymd <= to;
    }
    const days = Number(period) || 0;
    const from = DB.ymdOf(Date.now() - days * 86400000);
    return ymd >= from && ymd <= today;
  }

  /**
   * Panel lengkap kehadiran untuk SATU orang.
   * opts = { container, user, role:'siswa'|'guru', courses?, title? }
   */
  function renderPersonal(opts) {
    const { container, user } = opts;
    const role = opts.role || user.role;
    const courses = opts.courses || (role === 'guru'
      ? DB.getCoursesByTeacher(user.id)
      : DB.getEnrollmentsByStudent(user.id).map(e => DB.getCourse(e.courseId)).filter(Boolean));
    let period = 'all';
    let courseId = '';
    let view = 'month';

    // Bila pemanggil membatasi kelas (mis. tutor), data di luar kelas itu tidak ikut.
    const allowed = opts.courses ? new Set(courses.map(c => c.id)) : null;
    function records() {
      return DB.getAttendanceByUser(user.id)
        .filter(a => a.role === role)
        .filter(a => !allowed || allowed.has(a.courseId))
        .filter(a => !courseId || a.courseId === courseId)
        .filter(a => inPeriod(a.date, period));
    }

    function paint() {
      const recs = records();
      const sum = DB.attendanceSummary(recs);
      const monthly = DB.attendanceByMonth(recs);
      const semesters = DB.attendanceBySemester(recs);
      const perCourse = courses.map(c => ({
        c, s: DB.attendanceSummary(recs.filter(a => a.courseId === c.id))
      })).filter(x => x.s.total || x.s.cancelled);
      const t = DB.attendanceThreshold();
      const history = recs.slice().sort((a, b) => b.date.localeCompare(a.date));

      container.innerHTML = `
        <div class="card ai-card">
          <div class="card-header">
            ${UI.secHead('📊', opts.title || 'Persentase Kehadiran',
              role === 'guru' ? 'kehadiran mengajar dihitung dari jadwal yang telah dilaksanakan' : 'dihitung otomatis dari presensi tiap pertemuan')}
            <div class="ai-filters">
              <select class="input" data-ai="period" aria-label="Periode">
                ${PERIODS.map(p => `<option value="${p.key}" ${p.key === period ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
              </select>
              ${courses.length > 1 ? `<select class="input" data-ai="course" aria-label="Kelas">
                <option value="">Semua kelas</option>
                ${courses.map(c => `<option value="${c.id}" ${c.id === courseId ? 'selected' : ''}>${esc(DB.courseTitle(c))}</option>`).join('')}
              </select>` : ''}
            </div>
          </div>
          ${warningHtml(sum, role === 'guru' ? 'mengajar' : '')}
          <div class="ai-top">
            ${ringHtml(sum.pct, 'kehadiran')}
            <div class="ai-top-body">
              ${countsHtml(sum)}
              ${barHtml(sum.pct)}
              <div class="muted small ai-formula">
                Rumus: (hadir + terlambat) ÷ total sesi terlaksana × 100% • ambang standar ${t}%
                ${DB.getSettings().attendanceExcusedPolicy === 'exclude' ? ' • izin/sakit tidak dihitung dalam penyebut' : ' • izin/sakit tetap dihitung dalam penyebut'}
              </div>
            </div>
          </div>
        </div>

        <div class="card ai-card">
          <div class="card-header">
            ${UI.secHead('📈', 'Grafik Kehadiran', view === 'month' ? 'perkembangan per bulan' : 'perkembangan per semester')}
            <div class="ai-seg" role="tablist">
              <button type="button" class="${view === 'month' ? 'is-on' : ''}" data-ai-view="month">Bulanan</button>
              <button type="button" class="${view === 'sem' ? 'is-on' : ''}" data-ai-view="sem">Semester</button>
            </div>
          </div>
          ${view === 'month'
            ? chartHtml(monthly, r => monthLabel(r.month), r => monthLabel(r.month))
            : chartHtml(semesters, r => r.semester.replace(/^\d{2}(\d{2})\/\d{2}(\d{2})/, '$1/$2'), r => r.semester)}
        </div>

        ${perCourse.length > 1 ? `<div class="card ai-card">
          <div class="card-header">${UI.secHead('🏫', 'Statistik per Kelas', 'bandingkan kehadiran antar kelas')}</div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Kelas</th><th>Sesi</th>${DB.ATT_STATUSES.map(s => `<th>${esc(s.label)}</th>`).join('')}<th>Kehadiran</th></tr></thead>
            <tbody>${perCourse.map(x => `<tr>
              <td><strong>${esc(DB.courseTitle(x.c))}</strong></td>
              <td>${x.s.sessions}</td>
              ${DB.ATT_STATUSES.map(s => `<td>${x.s.counts[s.key] || 0}</td>`).join('')}
              <td style="min-width:150px;">${barHtml(x.s.pct)}</td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>` : ''}

        <div class="card ai-card">
          <div class="card-header">${UI.secHead('🗓️', 'Riwayat per Bulan', `${monthly.length} bulan tercatat`)}</div>
          ${monthly.length === 0 ? '<div class="empty"><div class="empty-icon">📭</div>Belum ada data kehadiran.</div>' : `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Bulan</th><th>Sesi</th>${DB.ATT_STATUSES.map(s => `<th>${esc(s.label)}</th>`).join('')}<th>Kehadiran</th></tr></thead>
            <tbody>${monthly.slice().reverse().map(m => `<tr>
              <td><strong>${esc(monthLabel(m.month))}</strong></td>
              <td>${m.sessions}</td>
              ${DB.ATT_STATUSES.map(s => `<td>${m.counts[s.key] || 0}</td>`).join('')}
              <td style="min-width:150px;">${barHtml(m.pct)}</td>
            </tr>`).join('')}</tbody>
          </table></div>`}
        </div>

        <div class="card ai-card">
          <div class="card-header">${UI.secHead('📋', role === 'guru' ? 'Riwayat Kehadiran Mengajar' : 'Riwayat Kehadiran', `${history.length} catatan`)}</div>
          <div id="aiHistory"></div>
        </div>`;

      // Riwayat lengkap memakai komponen pencarian bersama (filter + pagination).
      if (global.DataSearch) {
        DataSearch.mount({
          container: container.querySelector('#aiHistory'),
          items: history,
          placeholder: 'Cari tanggal, kelas, status, atau catatan…',
          fields: (a) => {
            const c = DB.getCourse(a.courseId);
            return [a.date, UI.fmtYMD(a.date), c ? DB.courseTitle(c) : '', DB.attStatusMeta(a.status).label, a.note || ''];
          },
          filters: [{ key: 'status', label: 'Semua status', options: DB.ATT_STATUSES.map(s => ({ value: s.key, label: s.label })), get: a => a.status }],
          sorts: [
            { key: 'new', label: 'Terbaru', cmp: (a, b) => b.date.localeCompare(a.date) },
            { key: 'old', label: 'Terlama', cmp: (a, b) => a.date.localeCompare(b.date) }
          ],
          pageSize: 10,
          empty: 'Belum ada catatan kehadiran.',
          render: (rows) => `<div class="table-wrap"><table class="table">
            <thead><tr><th>Tanggal</th><th>Kelas</th><th>Status</th><th>Catatan</th></tr></thead>
            <tbody>${rows.map(a => {
              const c = DB.getCourse(a.courseId);
              const cancelled = DB.isCancelledSession(a.courseId, a.date);
              return `<tr>
                <td>${UI.fmtYMD(a.date)}</td>
                <td>${esc(c ? DB.courseTitle(c) : '-')}</td>
                <td>${statusBadge(a.status)}${cancelled ? ' <span class="badge badge-gray">sesi dibatalkan</span>' : ''}</td>
                <td class="muted small">${esc(a.note || '-')}</td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>`
        });
      }

      container.querySelectorAll('[data-ai]').forEach(sel => sel.addEventListener('change', () => {
        if (sel.dataset.ai === 'period') period = sel.value;
        if (sel.dataset.ai === 'course') courseId = sel.value;
        paint();
      }));
      container.querySelectorAll('[data-ai-view]').forEach(b => b.addEventListener('click', () => {
        view = b.dataset.aiView; paint();
      }));
      if (global.Responsive) Responsive.apply(container);
    }
    paint();
  }

  function statusBadge(key) {
    const m = DB.attStatusMeta(key);
    const cls = { hadir: 'badge-success', terlambat: 'badge-info', izin: 'badge-warning', sakit: 'badge-warning', alfa: 'badge-danger' }[key] || 'badge-gray';
    return `<span class="badge ${cls}">${esc(m.label)}</span>`;
  }

  /**
   * Rekap kehadiran banyak orang (admin / tutor).
   * opts = { container, people:[user], role, courses:[course], onOpen(user) }
   */
  function renderRoster(opts) {
    const { container, role } = opts;
    const courses = opts.courses || DB.getCourses();
    const courseIds = new Set(courses.map(c => c.id));
    let period = 'all';
    let courseId = '';

    function rows() {
      return opts.people.map(u => {
        const recs = DB.getAttendanceByUser(u.id)
          .filter(a => a.role === role && courseIds.has(a.courseId))
          .filter(a => !courseId || a.courseId === courseId)
          .filter(a => inPeriod(a.date, period));
        return { u, s: DB.attendanceSummary(recs) };
      });
    }

    function paint() {
      const list = rows();
      const t = DB.attendanceThreshold();
      const withData = list.filter(r => r.s.sessions);
      const all = DB.attendanceSummary(opts.people.flatMap(u => DB.getAttendanceByUser(u.id)
        .filter(a => a.role === role && courseIds.has(a.courseId))
        .filter(a => !courseId || a.courseId === courseId)
        .filter(a => inPeriod(a.date, period))));
      const below = withData.filter(r => r.s.pct < t);

      container.innerHTML = `
        <div class="card ai-card">
          <div class="card-header">
            ${UI.secHead('📊', role === 'guru' ? 'Persentase Kehadiran Tutor' : 'Persentase Kehadiran Siswa',
              `ambang standar ${t}% • ${below.length} di bawah standar`)}
            <div class="ai-filters">
              <select class="input" data-ai="period" aria-label="Periode">
                ${PERIODS.map(p => `<option value="${p.key}" ${p.key === period ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
              </select>
              <select class="input" data-ai="course" aria-label="Kelas">
                <option value="">Semua kelas</option>
                ${courses.map(c => `<option value="${c.id}" ${c.id === courseId ? 'selected' : ''}>${esc(DB.courseTitle(c))}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="ai-top">
            ${ringHtml(all.pct, 'rata-rata')}
            <div class="ai-top-body">${countsHtml(all)}${barHtml(all.pct)}</div>
          </div>
          ${below.length ? `<div class="alert alert-error ai-warn" role="alert">⚠️ ${below.length} ${role === 'guru' ? 'tutor' : 'siswa'} di bawah standar kehadiran ${t}%:
            ${below.slice(0, 8).map(r => `<strong>${esc(r.u.name)}</strong> (${r.s.pct}%)`).join(', ')}${below.length > 8 ? ', …' : ''}</div>` : ''}
        </div>
        <div class="card ai-card"><div id="aiRoster"></div></div>`;

      DataSearch.mount({
        container: container.querySelector('#aiRoster'),
        items: list,
        placeholder: `Cari nama, username, atau ${role === 'guru' ? 'subtest' : 'kelas'}…`,
        fields: r => [r.u.name, r.u.username, r.u.id, r.u.kelas || '', r.u.subject || '', r.u.email || ''],
        filters: [
          { key: 'level', label: 'Semua tingkat', get: r => !r.s.sessions ? 'none' : (r.s.pct < t ? 'below' : 'ok'),
            options: [{ value: 'below', label: `Di bawah ${t}%` }, { value: 'ok', label: `≥ ${t}%` }, { value: 'none', label: 'Belum ada data' }] }
        ].concat(role === 'siswa' ? [{ key: 'kelas', label: 'Semua kelas utama', get: r => r.u.kelas || '',
          options: DB.getMainClasses().map(k => ({ value: k, label: k })) }] : []),
        sorts: [
          { key: 'low', label: 'Kehadiran terendah', cmp: (a, b) => (a.s.sessions ? a.s.pct : 999) - (b.s.sessions ? b.s.pct : 999) },
          { key: 'high', label: 'Kehadiran tertinggi', cmp: (a, b) => (b.s.sessions ? b.s.pct : -1) - (a.s.sessions ? a.s.pct : -1) },
          { key: 'name', label: 'Nama A–Z', cmp: (a, b) => a.u.name.localeCompare(b.u.name) }
        ],
        pageSize: 15,
        empty: 'Tidak ada data yang cocok.',
        render: (pageRows) => `<div class="table-wrap"><table class="table">
          <thead><tr><th>Nama</th><th>Sesi</th>${DB.ATT_STATUSES.map(s => `<th>${esc(s.label)}</th>`).join('')}<th>Kehadiran</th>${opts.onOpen ? '<th>Aksi</th>' : ''}</tr></thead>
          <tbody>${pageRows.map(r => `<tr class="${r.s.sessions && r.s.pct < t ? 'ai-row-warn' : ''}">
            <td><strong>${esc(r.u.name)}</strong><div class="muted small">${esc(role === 'guru' ? (r.u.subject || '-') : (r.u.kelas || '-'))}</div></td>
            <td>${r.s.sessions}</td>
            ${DB.ATT_STATUSES.map(s => `<td>${r.s.counts[s.key] || 0}</td>`).join('')}
            <td style="min-width:150px;">${r.s.sessions ? barHtml(r.s.pct) : '<span class="muted small">Belum ada data</span>'}</td>
            ${opts.onOpen ? `<td><button type="button" class="btn btn-sm btn-primary" data-ai-open="${r.u.id}">Detail</button></td>` : ''}
          </tr>`).join('')}</tbody>
        </table></div>`,
        onPaint: (box) => {
          box.querySelectorAll('[data-ai-open]').forEach(b => b.addEventListener('click', () =>
            opts.onOpen(DB.getUser(b.dataset.aiOpen))));
        }
      });

      container.querySelectorAll('[data-ai]').forEach(sel => sel.addEventListener('change', () => {
        if (sel.dataset.ai === 'period') period = sel.value;
        if (sel.dataset.ai === 'course') courseId = sel.value;
        paint();
      }));
    }
    paint();
  }

  global.AttendanceInsights = {
    renderPersonal, renderRoster, ringHtml, barHtml, chartHtml, countsHtml,
    statusBadge, tone, inPeriod, PERIODS, monthLabel
  };
})(window);
