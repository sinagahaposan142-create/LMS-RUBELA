/* =====================================================================
 * js/scoring.js — skor CBT cohort-weighted + Rasch-like 200–800
 * ---------------------------------------------------------------------
 * Raw: benar=1, salah/kosong=0, tanpa minus. Kesulitan item dihitung dari
 * peserta yang SUDAH mengumpulkan CBT yang sama. Karena tidak ada data
 * nasional/backend, hasil diberi label cohort LMS dan provisional.
 * Field legacy score (0–100) dipertahankan agar laporan lama kompatibel.
 * ===================================================================*/
(function (global) {
  'use strict';
  const VERSION = 1;
  const MODEL = 'empirical-1PL-cohort-v1';

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const logistic = x => 1 / (1 + Math.exp(-clamp(x, -20, 20)));

  function questionMap(cbt) {
    const out = [];
    DB.cbtSections(cbt).forEach((s, si) => (s.questionIds || []).forEach(qid => {
      const q = DB.getQuestion(qid);
      if (q) out.push({ q, qid, subtest: s.subtest || q.subject || 'Lainnya', sectionIndex: si });
    }));
    return out;
  }

  function scoringSignature(cbt, attempts) {
    const form = questionMap(cbt).map(it => {
      const q = it.q;
      return {
        qid: it.qid, subtest: it.subtest, type: q.questionType,
        correctIndex: q.correctIndex, correctIndices: q.correctIndices,
        answers: q.answers, numeric: q.numeric, shortAnswerPolicy: q.shortAnswerPolicy,
        statements: q.statements, pairs: q.pairs, orderItems: q.orderItems
      };
    });
    const data = JSON.stringify({ form, attempts: attempts.map(a => ({
      id: a.id, submittedAt: a.submittedAt, answers: a.answers
    })).sort((a, b) => String(a.id).localeCompare(String(b.id))) });
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
        version: VERSION, model: MODEL, cohortScope: 'cbt-lokal',
        cohortN: attempts.length, provisional, cohortSignature: signature,
        computedAt: Date.now(), rawOutcomes: rawMap,
        rawCorrect, rawTotal, manualCount,
        weightedPercent: Math.round(weightedPercent * 100) / 100,
        theta: Math.round(theta * 10000) / 10000,
        scaled200_800: rawTotal ? clamp(Math.round(500 + 100 * theta), 200, 800) : null,
        sections,
        itemStats: calibrated.stats
      };
      updated.push(DB.updateCbtAttempt(a.id, { scoring }));
    });
    return updated;
  }

  function ensureFresh(attempt) {
    if (!attempt || !attempt.cbtId) return attempt;
    const all = DB.getCbtAttemptsByCbt(attempt.cbtId).filter(a => a.submittedAt);
    const sig = scoringSignature(DB.getCbt(attempt.cbtId), all);
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
  function scoreHtml(attempt, compact) {
    const a = ensureFresh(attempt);
    if (!a || !a.scoring) return UI.esc(String(a && a.score != null ? a.score : '-'));
    const s = a.scoring;
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

  global.Scoring = {
    VERSION, MODEL, outcomes, calibrate, estimateTheta, recomputeCbt,
    scoringSignature, ensureFresh, scaled, scaledToPercent, scoreHtml
  };
})(window);
