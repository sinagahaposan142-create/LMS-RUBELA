/* =====================================================================
 * js/scoring.js — penilaian CBT: IRT cohort (200–800) + Poin Manual
 * ---------------------------------------------------------------------
 * Tiga sistem penilaian per ujian (cbt.scoringMode):
 *  - 'irt'    : cohort-weighted + Rasch-like 200–800 (bawaan). Raw: benar=1,
 *               salah/kosong=0, tanpa minus. Kesulitan item dihitung dari
 *               peserta yang SUDAH mengumpulkan CBT yang sama. Karena tidak ada
 *               data nasional, hasil diberi label cohort LMS dan sementara.
 *  - 'points' : Poin Manual. Poin per soal (bawaan dari Bank Soal, dapat
 *               diubah khusus untuk ujian ini) ATAU poin per paket (total
 *               poin paket dibagi rata). Opsional poin jawaban salah (minus).
 *               Esai dinilai tutor (attempt.essayPoints).
 *  - 'both'   : Poin Manual sebagai skor utama + IRT sebagai pembanding.
 * IRT selalu dihitung (murah) agar laporan lintas-ujian tetap konsisten.
 * Field legacy score (0–100) dipertahankan agar laporan lama kompatibel.
 * ===================================================================*/
(function (global) {
  'use strict';
  const VERSION = 2;
  const MODEL = 'empirical-1PL-cohort-v1';
  const MODES = {
    irt: { label: 'IRT UTBK (200–800)', short: 'IRT' },
    points: { label: 'Poin Manual', short: 'Poin' },
    both: { label: 'Poin Manual + IRT', short: 'Poin + IRT' }
  };
  const MAX_POINTS = 10000;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const logistic = x => 1 / (1 + Math.exp(-clamp(x, -20, 20)));
  const r2 = v => Math.round(v * 100) / 100;
  const finite = v => v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v));

  /* ============================ Konfigurasi ============================ */
  function modeOf(cbt) {
    const m = cbt && cbt.scoringMode;
    return m === 'points' || m === 'both' ? m : 'irt';
  }
  const usesPoints = (cbt) => modeOf(cbt) !== 'irt';

  /** Poin bawaan sebuah soal (dari Bank Soal). Kosong/tidak valid → 1. */
  function defaultPoints(q) {
    return q && finite(q.points) && Number(q.points) >= 0 ? clamp(Number(q.points), 0, MAX_POINTS) : 1;
  }

  function pointsConfig(cbt) {
    const c = cbt || {};
    return {
      basis: c.pointsBasis === 'package' ? 'package' : 'question',
      packageTotal: finite(c.packageTotal) && Number(c.packageTotal) > 0 ? clamp(Number(c.packageTotal), 1, 100000) : 100,
      wrongPoints: finite(c.wrongPoints) ? clamp(Number(c.wrongPoints), -1000, 0) : 0,
      points: c.points && typeof c.points === 'object' && !Array.isArray(c.points) ? c.points : {}
    };
  }

  function questionMap(cbt) {
    const out = [];
    if (!cbt) return out;
    DB.cbtSections(cbt).forEach((s, si) => (s.questionIds || []).forEach(qid => {
      const q = DB.getQuestion(qid);
      if (q) out.push({ q, qid, subtest: s.subtest || q.subject || 'Lainnya', sectionIndex: si });
    }));
    return out;
  }

  /** Poin maksimal tiap soal pada ujian ini → { qid: poin }. */
  function maxPointsMap(cbt, itemsIn) {
    const items = itemsIn || questionMap(cbt);
    const cfg = pointsConfig(cbt);
    const out = {};
    if (cfg.basis === 'package') {
      const each = items.length ? cfg.packageTotal / items.length : 0;
      items.forEach(it => { out[it.qid] = each; });
    } else {
      items.forEach(it => {
        const ov = cfg.points[it.qid];
        out[it.qid] = finite(ov) && Number(ov) >= 0 ? clamp(Number(ov), 0, MAX_POINTS) : defaultPoints(it.q);
      });
    }
    return out;
  }

  /** Jawaban dianggap kosong? (dipakai untuk poin minus: kosong tidak dikurangi). */
  function isBlank(q, ans) {
    if (global.Exam && Exam.isAnswered) return !Exam.isAnswered(q, ans);
    if (ans == null || ans === '') return true;
    return Array.isArray(ans) && ans.every(v => v == null || v === '');
  }

  /**
   * Hitung poin satu lembar jawaban.
   * @returns {{basis, earned, max, percent, correct, wrong, blank, objective, pending, wrongPoints, sections, perQuestion}}
   */
  function computePoints(cbt, answers, essayPoints) {
    const cfg = pointsConfig(cbt);
    const items = questionMap(cbt);
    const maxMap = maxPointsMap(cbt, items);
    const ans = answers || {};
    const ess = essayPoints && typeof essayPoints === 'object' ? essayPoints : {};
    const subs = new Map();
    const perQuestion = {};
    let earned = 0, max = 0, correct = 0, wrong = 0, blank = 0, objective = 0, pending = 0;

    items.forEach(it => {
      const m = maxMap[it.qid] || 0;
      if (!subs.has(it.subtest)) subs.set(it.subtest, { subtest: it.subtest, earned: 0, max: 0, correct: 0, total: 0, pending: 0 });
      const sec = subs.get(it.subtest);
      const g = Exam.gradeQuestion(it.q, ans[it.qid]);
      let e = 0, state;
      if (!g.auto) {
        if (finite(ess[it.qid])) { e = clamp(Number(ess[it.qid]), 0, m); state = 'graded'; }
        else { state = 'pending'; pending++; sec.pending++; }
      } else {
        objective++; sec.total++;
        if (g.correct) { e = m; state = 'correct'; correct++; sec.correct++; }
        else if (isBlank(it.q, ans[it.qid])) { state = 'blank'; blank++; }
        else { e = cfg.wrongPoints; state = 'wrong'; wrong++; }
      }
      earned += e; max += m; sec.earned += e; sec.max += m;
      perQuestion[it.qid] = { max: r2(m), earned: state === 'pending' ? null : r2(e), state };
    });

    const pct = (e, m) => (m > 0 ? r2(clamp(e / m * 100, 0, 100)) : 0);
    return {
      basis: cfg.basis, packageTotal: cfg.basis === 'package' ? cfg.packageTotal : null, wrongPoints: cfg.wrongPoints,
      earned: r2(earned), max: r2(max), percent: pct(earned, max),
      correct, wrong, blank, objective, pending,
      sections: [...subs.values()].map(s => Object.assign({}, s, { earned: r2(s.earned), max: r2(s.max), percent: pct(s.earned, s.max) })),
      perQuestion
    };
  }

  /* ============================ IRT cohort ============================ */
  function scoringSignature(cbt, attempts) {
    const pts = usesPoints(cbt);
    const form = questionMap(cbt).map(it => {
      const q = it.q;
      return {
        qid: it.qid, subtest: it.subtest, type: q.questionType,
        correctIndex: q.correctIndex, correctIndices: q.correctIndices,
        answers: q.answers, numeric: q.numeric, shortAnswerPolicy: q.shortAnswerPolicy,
        statements: q.statements, columns: q.columns, pairs: q.pairs, orderItems: q.orderItems,
        pts: pts ? defaultPoints(q) : undefined
      };
    });
    const cfg = pts ? pointsConfig(cbt) : null;
    const data = JSON.stringify({
      mode: modeOf(cbt), cfg, form,
      attempts: attempts.map(a => ({
        id: a.id, submittedAt: a.submittedAt, answers: a.answers, ess: pts ? (a.essayPoints || null) : undefined
      })).sort((a, b) => String(a.id).localeCompare(String(b.id)))
    });
    let h = 2166136261;
    for (let i = 0; i < data.length; i++) { h ^= data.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }

  function outcomes(cbt, attempt) {
    const ans = attempt.answers || {};
    const map = {};
    questionMap(cbt).forEach(it => {
      const g = Exam.gradeQuestion(it.q, ans[it.qid]);
      map[it.qid] = g.auto ? (g.correct ? 1 : 0) : null;
    });
    return map;
  }

  function calibrate(cbt, attempts) {
    const items = questionMap(cbt).filter(it => Exam.gradeQuestion(it.q, undefined).auto);
    const byAttempt = {};
    attempts.forEach(a => { byAttempt[a.id] = outcomes(cbt, a); });
    const stats = {};
    items.forEach(it => {
      let n = 0, correct = 0;
      attempts.forEach(a => {
        const raw = byAttempt[a.id][it.qid];
        if (raw == null) return;
        n++; correct += raw;
      });
      // Jeffreys smoothing mencegah probabilitas ekstrem 0/1 pada cohort kecil.
      const p = (correct + 0.5) / (n + 1);
      const b = clamp(Math.log((1 - p) / p), -3, 3);
      // Soal langka benar mendapat bobot lebih besar, tetapi dibatasi 3×.
      const weight = clamp(1 / p, 0.75, 3);
      stats[it.qid] = {
        questionId: it.qid, subtest: it.subtest, n, correct,
        pCorrect: Math.round(p * 10000) / 10000,
        difficulty: Math.round((1 - p) * 10000) / 10000,
        b: Math.round(b * 10000) / 10000,
        weight: Math.round(weight * 10000) / 10000
      };
    });
    return { items, byAttempt, stats };
  }

  /** MAP Newton estimate 1PL dengan prior N(0, 2²), stabil untuk all-right/wrong. */
  function estimateTheta(rows) {
    if (!rows.length) return 0;
    let theta = 0;
    for (let k = 0; k < 12; k++) {
      let grad = -theta / 4;
      let hess = -0.25;
      rows.forEach(r => {
        const p = logistic(theta - r.b);
        grad += r.raw - p;
        hess -= p * (1 - p);
      });
      const step = grad / hess;
      theta = clamp(theta - step, -3, 3);
      if (Math.abs(step) < 0.0001) break;
    }
    return theta;
  }

  function metricFor(subtest, calibrated, rawMap) {
    const rows = calibrated.items
      .filter(it => it.subtest === subtest && rawMap[it.qid] != null)
      .map(it => ({ raw: rawMap[it.qid], b: calibrated.stats[it.qid].b, weight: calibrated.stats[it.qid].weight }));
    const rawCorrect = rows.reduce((n, r) => n + r.raw, 0);
    const rawTotal = rows.length;
    const sumW = rows.reduce((n, r) => n + r.weight, 0);
    const weightedPercent = sumW ? 100 * rows.reduce((n, r) => n + r.raw * r.weight, 0) / sumW : 0;
    const theta = estimateTheta(rows);
    return {
      subtest, rawCorrect, rawTotal,
      legacyPercent: rawTotal ? Math.round(rawCorrect / rawTotal * 100) : 0,
      weightedPercent: Math.round(weightedPercent * 100) / 100,
      theta: Math.round(theta * 10000) / 10000,
      scaled200_800: rawTotal ? clamp(Math.round(500 + 100 * theta), 200, 800) : null
    };
  }

  function recomputeCbt(cbtId) {
    const cbt = DB.getCbt(cbtId);
    if (!cbt) return [];
    const attempts = DB.getCbtAttemptsByCbt(cbtId).filter(a => a.submittedAt);
    if (!attempts.length) return [];
    const calibrated = calibrate(cbt, attempts);
    const subtests = [...new Set(calibrated.items.map(it => it.subtest))];
    const signature = scoringSignature(cbt, attempts);
    const provisional = attempts.length < 30;
    const mode = modeOf(cbt);
    const updated = [];

    attempts.forEach(a => {
      const rawMap = calibrated.byAttempt[a.id];
      const sections = subtests.map(s => metricFor(s, calibrated, rawMap));
      const allRows = calibrated.items.filter(it => rawMap[it.qid] != null)
        .map(it => ({ raw: rawMap[it.qid], b: calibrated.stats[it.qid].b, weight: calibrated.stats[it.qid].weight }));
      const rawCorrect = allRows.reduce((n, r) => n + r.raw, 0);
      const rawTotal = allRows.length;
      const manualCount = Object.values(rawMap).filter(v => v == null).length;
      const sumW = allRows.reduce((n, r) => n + r.weight, 0);
      const weightedPercent = sumW ? 100 * allRows.reduce((n, r) => n + r.raw * r.weight, 0) / sumW : 0;
      const theta = estimateTheta(allRows);
      const scoring = {
        version: VERSION, model: MODEL, mode, cohortScope: 'cbt-lokal',
        cohortN: attempts.length, provisional, cohortSignature: signature,
        computedAt: Date.now(), rawOutcomes: rawMap,
        rawCorrect, rawTotal, manualCount,
        weightedPercent: Math.round(weightedPercent * 100) / 100,
        theta: Math.round(theta * 10000) / 10000,
        scaled200_800: rawTotal ? clamp(Math.round(500 + 100 * theta), 200, 800) : null,
        sections,
        itemStats: calibrated.stats,
        points: mode === 'irt' ? null : computePoints(cbt, a.answers, a.essayPoints)
      };
      updated.push(DB.updateCbtAttempt(a.id, { scoring }));
    });
    return updated;
  }

  function ensureFresh(attempt) {
    if (!attempt || !attempt.cbtId) return attempt;
    const cbt = DB.getCbt(attempt.cbtId);
    if (!cbt) return attempt;
    const all = DB.getCbtAttemptsByCbt(attempt.cbtId).filter(a => a.submittedAt);
    const sig = scoringSignature(cbt, all);
    if (!attempt.scoring || attempt.scoring.version !== VERSION || attempt.scoring.cohortSignature !== sig) {
      recomputeCbt(attempt.cbtId);
      return DB.getCbtAttempts().find(a => a.id === attempt.id) || attempt;
    }
    return attempt;
  }

  function scaled(attempt) {
    const a = ensureFresh(attempt);
    return a && a.scoring ? a.scoring.scaled200_800 : null;
  }

  function scaledToPercent(value) { return clamp((Number(value) - 200) / 6, 0, 100); }

  /* ============================ Tampilan ============================ */
  function fmtNum(v) {
    const n = Number(v) || 0;
    return n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
  }

  /**
   * Skor utama sebuah attempt (sudah segar) sesuai sistem penilaian ujiannya.
   * kind: 'points' | 'irt' | 'legacy'. value null = menunggu penilaian esai.
   */
  function primary(attempt) {
    const a = attempt;
    if (!a) return null;
    const s = a.scoring;
    const mode = (s && s.mode) || 'irt';
    if (s && mode !== 'irt' && s.points) {
      const p = s.points;
      return {
        mode, kind: 'points', value: p.earned, max: p.max, percent: p.percent, pending: p.pending,
        text: `${fmtNum(p.earned)}/${fmtNum(p.max)} poin${p.pending ? ' (esai menunggu)' : ''}`
      };
    }
    if (s) {
      if (s.scaled200_800 == null) return { mode, kind: 'irt', value: null, max: 800, percent: null, pending: s.manualCount, text: 'menunggu esai' };
      return { mode, kind: 'irt', value: s.scaled200_800, max: 800, percent: scaledToPercent(s.scaled200_800), pending: s.manualCount, text: `${s.scaled200_800}/800` };
    }
    const v = a.score == null ? 0 : a.score;
    return { mode: 'legacy', kind: 'legacy', value: v, max: 100, percent: v, pending: 0, text: String(v) };
  }

  /** Teks singkat skor (untuk notifikasi, linimasa, konteks AI). */
  function label(attempt) {
    const p = primary(ensureFresh(attempt));
    return p ? p.text : '-';
  }

  function scoreHtml(attempt, compact) {
    const a = ensureFresh(attempt);
    if (!a || !a.scoring) return UI.esc(String(a && a.score != null ? a.score : '-'));
    const s = a.scoring;
    const mode = s.mode || 'irt';
    if (mode !== 'irt' && s.points) {
      const p = s.points;
      const irt = mode === 'both' && s.scaled200_800 != null ? s.scaled200_800 : null;
      if (compact) {
        return `<strong>${fmtNum(p.earned)}</strong><span class="muted small"> / ${fmtNum(p.max)} poin • ${p.correct}/${p.objective} benar${irt != null ? ` • IRT ${irt}` : ''}</span>`
          + (p.pending ? ' <span class="badge badge-warning">esai menunggu</span>' : '');
      }
      return `<div class="irt-score pts-score"><strong>${fmtNum(p.earned)}</strong><span>dari ${fmtNum(p.max)} poin (${fmtNum(p.percent)}%)</span>
        <small>${p.correct} benar • ${p.wrong} salah${p.wrongPoints ? ` (${fmtNum(p.wrongPoints)} poin/salah)` : ''} • ${p.blank} kosong${p.pending ? ` • ${p.pending} esai menunggu nilai tutor` : ''}${irt != null ? ` • skor IRT ${irt}/800` : ''}</small></div>`;
    }
    if (s.scaled200_800 == null) {
      return compact
        ? '<span class="badge badge-warning">Menunggu nilai esai</span>'
        : '<div class="irt-score"><strong>—</strong><span>Menunggu penilaian esai</span><small>Tidak ada soal objektif yang dapat dikalibrasi.</small></div>';
    }
    return compact
      ? `<strong>${s.scaled200_800}</strong><span class="muted small"> / 800 • ${s.rawCorrect}/${s.rawTotal}</span>`
      : `<div class="irt-score"><strong>${s.scaled200_800}</strong><span>Skala 200–800</span>
          <small>${s.rawCorrect}/${s.rawTotal} benar${s.manualCount ? ` • ${s.manualCount} esai menunggu nilai` : ''} • bobot ${s.weightedPercent}% • cohort ${s.cohortN}${s.provisional ? ' (sementara)' : ''}</small></div>`;
  }

  /** Ringkasan sistem penilaian sebuah ujian (teks datar). */
  function describe(cbt) {
    const mode = modeOf(cbt);
    if (mode === 'irt') return MODES.irt.label;
    const cfg = pointsConfig(cbt);
    const items = questionMap(cbt);
    const max = Object.values(maxPointsMap(cbt, items)).reduce((n, v) => n + v, 0);
    const basis = cfg.basis === 'package' ? `per paket (${fmtNum(cfg.packageTotal)} poin dibagi rata)` : 'per soal';
    return `${MODES[mode].label} — ${basis}, total ${fmtNum(max)} poin${cfg.wrongPoints ? `, salah ${fmtNum(cfg.wrongPoints)} poin` : ''}`;
  }

  global.Scoring = {
    VERSION, MODEL, MODES, MAX_POINTS,
    outcomes, calibrate, estimateTheta, recomputeCbt,
    scoringSignature, ensureFresh, scaled, scaledToPercent, scoreHtml,
    modeOf, usesPoints, pointsConfig, defaultPoints, maxPointsMap, computePoints,
    primary, label, describe, fmtNum
  };
})(window);
