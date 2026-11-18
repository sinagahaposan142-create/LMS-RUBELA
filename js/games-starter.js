/* =====================================================================
 * js/games-starter.js — Paket soal contoh Game Battle
 * ---------------------------------------------------------------------
 * 47 soal (semua format otomatis) agar ke-10 game langsung dapat dimainkan.
 * Dipasang manual oleh admin/tutor dari Kelola Game Battle → Ringkasan.
 * Id tetap (gq_starter_*) sehingga pemasangan ulang tidak menggandakan soal.
 * ===================================================================*/
(function (global) {
  'use strict';
  const S = { PU: 'Penalaran Umum (PU)', PPU: 'Pengetahuan dan Pemahaman Umum (PPU)', PBM: 'Kemampuan Memahami Bacaan dan Menulis (PBM)',
    PK: 'Pengetahuan Kuantitatif (PK)', LBIND: 'Literasi dalam Bahasa Indonesia', LBING: 'Literasi dalam Bahasa Inggris', PM: 'Penalaran Matematika' };
  const p = (t) => '<p>' + String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>';

  const PG = [
    ['PK', 'mudah', 'Hasil dari 15% × 200 adalah …', ['20', '25', '30', '35'], 2, '15/100 × 200 = 30.'],
    ['PK', 'mudah', 'Jika 3x + 5 = 20, maka nilai x adalah …', ['3', '4', '5', '6'], 2, '3x = 15, sehingga x = 5.'],
    ['PK', 'sedang', 'Rata-rata dari 4, 7, 9, dan 12 adalah …', ['7', '8', '9', '10'], 1, '(4 + 7 + 9 + 12) : 4 = 32 : 4 = 8.'],
    ['PK', 'sedang', 'Suku ke-10 dari barisan 2, 5, 8, 11, … adalah …', ['26', '29', '30', '32'], 1, 'Un = a + (n − 1)b = 2 + 9 × 3 = 29.'],
    ['PM', 'mudah', 'Peluang muncul mata dadu genap pada satu kali pelemparan dadu adalah …', ['1/6', '1/3', '1/2', '2/3'], 2, 'Mata genap: 2, 4, 6 → 3/6 = 1/2.'],
    ['PM', 'sedang', 'Luas lingkaran berjari-jari 7 cm (π = 22/7) adalah …', ['44 cm²', '88 cm²', '154 cm²', '308 cm²'], 2, 'L = πr² = 22/7 × 49 = 154 cm².'],
    ['PM', 'sulit', 'Jika 2^x = 32, maka nilai x adalah …', ['4', '5', '6', '16'], 1, '32 = 2⁵, jadi x = 5.'],
    ['PPU', 'mudah', 'Sinonim kata "akurat" adalah …', ['tepat', 'cepat', 'kuat', 'lambat'], 0, 'Akurat berarti teliti, saksama, tepat.'],
    ['PPU', 'sedang', 'Antonim kata "optimis" adalah …', ['yakin', 'pesimis', 'realistis', 'idealis'], 1, 'Lawan optimis (berpengharapan baik) adalah pesimis.'],
    ['PU', 'sedang', 'Semua siswa yang rajin lulus ujian. Budi adalah siswa yang rajin. Simpulan yang tepat adalah …', ['Budi lulus ujian', 'Budi tidak lulus ujian', 'Budi mungkin lulus ujian', 'Tidak dapat disimpulkan'], 0, 'Silogisme: semua A adalah B, Budi termasuk A, maka Budi B.'],
    ['PU', 'sulit', 'Bilangan berikutnya dari pola 1, 4, 9, 16, … adalah …', ['20', '24', '25', '36'], 2, 'Pola bilangan kuadrat: 1², 2², 3², 4², 5² = 25.'],
    ['LBING', 'sedang', 'The synonym of "happy" is …', ['sad', 'glad', 'angry', 'tired'], 1, '"Glad" means pleased or happy.'],
    ['LBIND', 'mudah', 'Kata baku di bawah ini adalah …', ['apotik', 'apotek', 'apotiek', 'apoteik'], 1, 'Bentuk baku menurut KBBI adalah "apotek".'],
    ['PBM', 'sedang', 'Penulisan kata depan yang benar adalah …', ['di sekolah', 'disekolah', 'di-sekolah', 'kesekolah'], 0, 'Kata depan "di" dan "ke" ditulis terpisah dari kata yang mengikutinya.']
  ];
  const BS = [
    ['PPU', 'mudah', 'Ibu kota Provinsi Jawa Barat adalah Bandung.', true],
    ['PK', 'mudah', 'Bilangan 1 termasuk bilangan prima.', false],
    ['PM', 'mudah', 'Jumlah besar sudut dalam sebuah segitiga adalah 180 derajat.', true],
    ['PPU', 'mudah', 'Indonesia memproklamasikan kemerdekaannya pada 17 Agustus 1945.', true],
    ['LBING', 'mudah', '"Went" is the past tense of "go".', true],
    ['PK', 'sedang', 'Hasil dari 0,5 × 0,5 adalah 2,5.', false],
    ['LBIND', 'sedang', 'Kalimat efektif minimal memiliki subjek dan predikat.', true],
    ['PU', 'sedang', 'Jika semua A adalah B, maka pasti semua B adalah A.', false],
    ['PPU', 'sedang', 'Danau Toba terletak di Provinsi Sumatera Barat.', false],
    ['PM', 'mudah', 'Akar kuadrat dari 144 adalah 12.', true]
  ];
  const BSM = [
    ['PK', 'sedang', 'Tentukan benar atau salah setiap pernyataan tentang bilangan berikut.',
      [['2 adalah bilangan prima yang genap.', true], ['Semua bilangan ganjil adalah bilangan prima.', false], ['0 termasuk bilangan bulat.', true], ['FPB dari 12 dan 18 adalah 6.', true]]],
    ['PPU', 'sedang', 'Tentukan benar atau salah setiap pernyataan tentang geografi Indonesia.',
      [['Indonesia terletak di antara Benua Asia dan Benua Australia.', true], ['Gunung tertinggi di Indonesia adalah Gunung Semeru.', false],
        ['Selat Sunda memisahkan Pulau Jawa dan Pulau Sumatra.', true], ['Wilayah Indonesia dilalui garis khatulistiwa.', true]]],
    ['LBING', 'sedang', 'Decide whether each sentence is grammatically correct (Benar) or not (Salah).',
      [['She goes to school every day.', true], ['They was happy yesterday.', false], ['I have finished my homework.', true], ['He don\'t like coffee.', false]]]
  ];
  const ISIAN = [
    ['PK', 'mudah', 'Hasil dari 7 × 8 adalah …', ['56'], true],
    ['PK', 'mudah', '25% dari 80 adalah …', ['20'], true],
    ['PM', 'sedang', 'Nilai dari 3² + 4² adalah …', ['25'], true],
    ['PPU', 'mudah', 'Ibu kota negara Jepang adalah …', ['Tokyo'], false],
    ['LBING', 'sedang', 'The plural form of "child" is …', ['children'], false],
    ['PPU', 'mudah', 'Planet terbesar di tata surya adalah …', ['Jupiter', 'Yupiter'], false],
    ['LBIND', 'mudah', 'Lawan kata "tinggi" adalah …', ['rendah', 'pendek'], false],
    ['PU', 'sedang', 'Lanjutkan pola bilangan: 2, 4, 8, 16, …', ['32'], true]
  ];
  const JODOH = [
    ['PPU', 'mudah', 'Jodohkan negara dengan ibu kotanya.', [['Jepang', 'Tokyo'], ['Prancis', 'Paris'], ['Mesir', 'Kairo'], ['Australia', 'Canberra'], ['Brasil', 'Brasília']]],
    ['LBING', 'mudah', 'Match the English words with their Indonesian meanings.', [['Book', 'Buku'], ['Window', 'Jendela'], ['Chair', 'Kursi'], ['River', 'Sungai'], ['Teacher', 'Guru']]],
    ['PK', 'sedang', 'Jodohkan setiap operasi hitung dengan hasilnya.', [['6 × 7', '42'], ['81 : 9', '9'], ['15 + 26', '41'], ['100 − 37', '63'], ['2³', '8']]],
    ['PPU', 'sedang', 'Jodohkan tokoh nasional dengan perannya.', [['R.A. Kartini', 'Pelopor emansipasi perempuan'], ['Ir. Soekarno', 'Presiden pertama RI'],
      ['Mohammad Hatta', 'Wakil Presiden pertama RI'], ['W.R. Supratman', 'Pencipta lagu Indonesia Raya'], ['Ki Hajar Dewantara', 'Bapak Pendidikan Nasional']]]
  ];
  const URUT = [
    ['PPU', 'mudah', 'Urutkan planet berikut dari yang paling dekat dengan Matahari.', ['Merkurius', 'Venus', 'Bumi', 'Mars', 'Jupiter']],
    ['PK', 'mudah', 'Urutkan bilangan berikut dari yang terkecil.', ['−3', '0', '0,5', '2', '7']],
    ['PBM', 'sedang', 'Urutkan langkah menulis karangan yang tepat.', ['Menentukan topik', 'Membuat kerangka karangan', 'Mengembangkan kerangka menjadi paragraf', 'Menyunting tulisan']],
    ['PPU', 'sedang', 'Urutkan peristiwa sejarah berikut dari yang paling awal.', ['Sumpah Pemuda (1928)', 'Proklamasi Kemerdekaan (1945)', 'Konferensi Asia Afrika (1955)', 'Reformasi (1998)']],
    ['PM', 'sedang', 'Urutkan pecahan berikut dari yang terkecil.', ['1/4', '1/3', '1/2', '3/4']]
  ];
  const PLS = [
    ['PK', 'sedang', 'Manakah yang merupakan bilangan prima?', ['2', '9', '11', '15', '17'], [0, 2, 4]],
    ['LBING', 'mudah', 'Which of the following words are verbs?', ['run', 'beautiful', 'write', 'quickly'], [0, 2]],
    ['PPU', 'mudah', 'Manakah yang termasuk sumber energi terbarukan?', ['Cahaya matahari', 'Batu bara', 'Angin', 'Minyak bumi'], [0, 2]]
  ];

  function questions() {
    const out = [];
    let n = 0;
    const base = (sub, diff, text, type) => ({
      id: 'gq_starter_' + String(++n).padStart(2, '0'), subject: S[sub], difficulty: diff, questionType: type,
      text: p(text), explanation: '', options: [], correctIndex: null, source: 'contoh', active: true, games: []
    });
    PG.forEach(([s, d, t, o, k, e]) => out.push(Object.assign(base(s, d, t, 'Pilihan Ganda'), { options: o.map(p), correctIndex: k, explanation: p(e) })));
    BS.forEach(([s, d, t, v]) => out.push(Object.assign(base(s, d, t, 'Benar/Salah'), { options: ['Benar', 'Salah'], correctIndex: v ? 0 : 1 })));
    BSM.forEach(([s, d, t, st]) => out.push(Object.assign(base(s, d, t, 'Benar/Salah Majemuk'), { statements: st.map(([x, v]) => ({ text: p(x), value: v })), columns: null })));
    ISIAN.forEach(([s, d, t, a, num]) => out.push(Object.assign(base(s, d, t, 'Isian Singkat'), { answers: a, numeric: num })));
    JODOH.forEach(([s, d, t, pr]) => out.push(Object.assign(base(s, d, t, 'Menjodohkan'), { pairs: pr.map(([l, r]) => ({ left: p(l), right: p(r) })) })));
    URUT.forEach(([s, d, t, it]) => out.push(Object.assign(base(s, d, t, 'Urutan'), { orderItems: it.map(p) })));
    PLS.forEach(([s, d, t, o, k]) => out.push(Object.assign(base(s, d, t, 'Pilihan Lebih dari Satu'), { options: o.map(p), correctIndices: k, correctIndex: k[0] })));
    return out;
  }

  /** Pasang soal contoh yang belum ada. @returns {number} jumlah soal baru */
  function install(user) {
    const have = new Set(Games.getGameQuestions().map(q => q.id));
    let added = 0;
    questions().forEach((q, i) => {
      if (have.has(q.id)) return;
      Games.upsertQuestion(Object.assign(q, { authorId: user.id, createdAt: Date.now() + i }));
      added++;
    });
    return added;
  }
  const installed = () => { const have = new Set(Games.getGameQuestions().map(q => q.id)); return questions().filter(q => have.has(q.id)).length; };

  global.GamesStarter = { questions, install, installed, count: () => questions().length };
})(window);
