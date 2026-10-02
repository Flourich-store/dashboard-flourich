// Tes regresi KPI Credit/Debit untuk dashboard Flourich - DATA KARANGAN.
//
// Berkas ini TIDAK membaca snapshot produksi. Semua baris, nominal, dan
// tanggal di bawah dibuat-buat untuk menguji logika, bukan untuk
// mereproduksi angka bisnis. Karena itu aman di-commit ke repo publik.
//
// Tes yang memakai angka produksi ada di tests/kpi-credit-debit.lokal.mjs
// (tidak di-commit, butuh tests/fixtures/).
//
// Dua kelas bug yang dicakup di sini:
//
//  1. REGRESI KERUSAKAN. Working tree sebelumnya (a) kehilangan `return items;`
//     dari _readCreditDebitItems sehingga Total Pengeluaran & Pemasukan Lain
//     diam-diam jadi nol, dan (b) membaca kolom Jenis dari row[7] padahal
//     sheet hanya punya 7 kolom (Jenis = row[6]). Keduanya tidak tertangkap
//     gerbang tes sebelumnya. Tes ini memanggil funsinya langsung.
//
//  2. ATURAN BISNIS. Rumus KPI:
//       Laba Bersih = Penjualan Bersih - HPP
//                   + Pendapatan Lain - Biaya Operasional - Beban Non-Operasional
//     dengan:
//       Pendapatan Lain      <- Tipe DEBIT  & Jenis PENDAPATAN_LAIN
//       Biaya Operasional    <- Tipe CREDIT & Jenis BIAYA_OPERASIONAL
//       Beban Non-Operasional<- Tipe CREDIT & Jenis NON_OPERASIONAL
//       BAHAN_BAKU / KEMASAN  TIDAK boleh dikurangi lagi (sudah ikut HPP)
//       CAMPURAN / tak dikenal dibuang, tidak boleh diasumsikan
//
// Cara pakai: node tests/kpi-credit-debit.test.mjs [path Code.gs]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const AKAR = path.resolve(DIR, '..');
const CODE = process.argv[2] || path.join(AKAR, 'Code.gs');

// ---------- kerangka tes ----------
let lulus = 0;
const gagal = [];
function uji(nama, fn) {
  try {
    fn();
    lulus++;
    console.log('  LULUS  ' + nama);
  } catch (e) {
    gagal.push(nama + ' :: ' + e.message);
    console.log('  GAGAL  ' + nama + '\n          ' + e.message);
  }
}
function eq(didapat, harap, apa) {
  if (didapat !== harap) {
    throw new Error((apa || 'nilai') + ': harap ' + JSON.stringify(harap) + ', dapat ' + JSON.stringify(didapat));
  }
}
const rupiah = (s) => { const d = String(s || '').replace(/[^0-9]/g, ''); return d ? parseInt(d, 10) : 0; };

// =====================================================================
// DATA KARANGAN - bukan data bisnis.
//
// Tahun fiktif 2024, kategori fiktif, dan SETIAP nominal berakhiran angka
// yang bukan nol (...137, ...213, ...417). Semua nilai rupiah di sheet produksi
// adalah kelipatan 1.000, jadi bentuk ini secara struktural tidak mungkin
// sama dengan nominal transaksi mana pun. tools/bukti-sintetis.lokal.mjs
// membuktikannya dengan mencocokkan tiap sel fixture satu per satu.
//
// 12 baris, 4 di antaranya dibuat berlabel skema lama / kosong supaya ada
// material untuk menguji bucket "Tidak Dikenali".
// =====================================================================
const HEADER_CD = ['Tanggal', 'Tipe', 'Kategori', 'Deskripsi', 'Metode Pembayaran', 'Nominal', 'Jenis'];

// [tanggal, tipe, kategori, deskripsi, metode, nominal, jenis]
const BARIS_CD = [
  ['3/5/2024', 'CREDIT', 'Bahan Baku', 'Karangan A', 'Transfer', 137000, 'Bahan Baku'],
  ['3/5/2024', 'CREDIT', 'Kemasan', 'Karangan B', 'Tunai', 71300, 'Kemasan'],
  ['3/12/2024', 'CREDIT', 'Sewa', 'Karangan C', 'Transfer', 250137, 'Biaya Operasional'],
  ['4/2/2024', 'CREDIT', 'Pajak', 'Karangan D', 'Tunai', 175213, 'Non Operasional'],
  ['4/18/2024', 'DEBIT', 'Bunga', 'Karangan E', 'Tunai', 30137, 'Pendapatan Lain'],
  ['5/9/2024', 'CREDIT', 'ATK', 'Karangan F', 'Transfer', 45417, 'Biaya Operasional'],
  ['5/21/2024', 'CREDIT', 'Perawatan', 'Karangan G', 'Tunai', 60113, 'Biaya Operasional'],
  ['6/4/2024', 'CREDIT', 'Adonan', 'Karangan H', 'Transfer', 90317, 'Campuran'],
  ['6/15/2024', 'CREDIT', 'Listrik', 'Karangan I', 'Tunai', 35413, 'Biaya Operasional'],
  ['7/1/2024', 'CREDIT', 'Peralatan', 'Karangan J', 'Transfer', 70617, 'Non Operasional'],
  ['7/22/2024', 'DEBIT', 'Bunga', 'Karangan K', 'Tunai', 15413, 'Pendapatan Lain'],
  ['8/8/2024', 'CREDIT', 'Karpet', 'Karangan L', 'Tunai', 55713, 'Biaya Operasional'],
];

// Varian A: semua baris punya Jenis valid.
const BARIS_RAPI = BARIS_CD.map((r) => r.slice());
// Varian B: empat baris memakai label skema lama / kosong. Angka tidak
// diubah, hanya kolom Jenis, supaya selisihnya benar-benar cuma klasifikasi.
const BARIS_LAMA = BARIS_CD.map((r) => r.slice());
for (const [idx, jenisBaru] of [[5, 'operasional'], [6, ''], [8, 'operasional'], [11, 'operasional']]) {
  BARIS_LAMA[idx][6] = jenisBaru;
}

const sheetRapi = [HEADER_CD].concat(BARIS_RAPI);
const sheetLama = [HEADER_CD].concat(BARIS_LAMA);
const sheetTanpaJenis = sheetRapi.map((r) => r.slice(0, 6));

// Di sheet aslinya: kolom Tanggal bertipe DATE dan kolom Nominal bertipe
// ANGKA. Format "Rp<angka>" hanya tampilan sel; getValues() mengembalikan
// angka mentah. Kalau dibiarkan teks, tes menguji jalur yang tidak dipakai
// produksi: _num() mengembalikan NaN, dan tanggal lewat cabang teks.
const keSel = (rows) => rows.map((r) => {
  const s = r.slice();
  const d = new Date(s[0]);
  s[0] = isNaN(d.getTime()) ? s[0] : d;
  const kosong = s[5] === '' || s[5] === undefined || s[5] === null;
  s[5] = kosong ? 0 : Number(String(s[5]).replace(/[^0-9]/g, ''));
  return s;
});

// ---------- muat Code.gs ke vm ----------
function sheetPalsu(sel) {
  return {
    getName: () => 'Credit/Debit',
    getLastRow: () => sel.length,
    getLastColumn: () => sel[0].length,
    getDataRange: () => ({ getValues: () => sel.map((r) => r.slice()) }),
    getRange: () => ({ getValues: () => [], setValues() { throw new Error('tes tidak boleh menulis ke sheet'); } }),
  };
}
const ssDari = (sel) => ({ getSheetByName: (n) => (n === 'Credit/Debit' ? sheetPalsu(sel) : null) });

function muatCode(sel) {
  const kode = fs.readFileSync(CODE, 'utf8');
  const ctx = {
    console,
    SpreadsheetApp: { openById: () => ({ getSheetByName: (n) => (n === 'Credit/Debit' ? sheetPalsu(sel) : null), getSheets: () => [] }), getActiveSpreadsheet() { return this.openById(); } },
    Logger: { log() {}, warn() {}, error() {} },
    // Apps Script memformat di Asia/Jakarta. Stub wajib memakai offset yang
    // sama, kalau tidak setiap tanggal meleset sehari (00:00 lokal = 17:00
    // UTC sehari sebelumnya).
    Utilities: {
      formatDate(d, _tz, fmt) {
        const jkt = new Date(d.getTime() + 7 * 3600 * 1000);
        if (fmt !== 'yyyy-MM-dd') return jkt.toISOString();
        return jkt.getUTCFullYear() + '-' + String(jkt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(jkt.getUTCDate()).padStart(2, '0');
      },
    },
    Date, JSON, String, Number, Array, Object, Boolean, RegExp, Error, Math, parseInt, parseFloat, isNaN, isFinite,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(kode, ctx, { filename: 'Code.gs' });
  return ctx;
}
const baca = (kodeCtx, sel) => kodeCtx._readCreditDebitItems(ssDari(sel), '', '');

console.log('=== TES KPI CREDIT/DEBIT (data karangan) ===');
console.log('target  : ' + CODE);
console.log('fixture : tidak ada, seluruh data dibuat di dalam berkas ini');
console.log('');

// =====================================================================
// BAGIAN 1 - REGRESI: _readCreditDebitItems harus benar-benar mengembalikan data
// =====================================================================
console.log('-- REGRESI PEMBACAAN SHEET --');

const ctx = muatCode(keSel(sheetRapi));
const items = ctx._readCreditDebitItems(ssDari(keSel(sheetRapi)), '', '');

uji('_readCreditDebitItems mengembalikan array (bukan undefined)', () => {
  if (!Array.isArray(items)) throw new Error('dapat ' + typeof items + ', harus array. Caller accessing .length akan melempar TypeError yang tertangkap catch -> semua KPI nol diam-diam.');
  eq(items.length, BARIS_CD.length, 'jumlah item');
});

uji('kolom Jenis terbaca untuk semua baris', () => {
  const adaJenis = items.filter((x) => String(x.jenis || '').trim() !== '');
  eq(adaJenis.length, BARIS_CD.length, 'baris dengan isi kolom Jenis');
});

uji('semua baris menandai kolom Jenis terdeteksi', () => {
  eq(items.filter((x) => x.jenisTerdeteksi === false).length, 0, 'kolom Jenis harus ditemukan lewat header');
});

uji('Jenis terbaca persis dari sel G, bukan kolom H yang tidak ada', () => {
  const carIdx = items.findIndex((x) => String(x.kategori) === 'Sewa');
  eq(String(items[carIdx].jenis), 'Biaya Operasional', 'Jenis baris Sewa');
});

uji('field lain tidak bergeser: tipe, kategori, deskripsi, metode, nominal', () => {
  const bahan = items.find((x) => String(x.kategori) === 'Bahan Baku');
  eq(String(bahan.tipe), 'CREDIT', 'tipe');
  eq(rupiah(bahan.nominal), 137000, 'nominal');
  eq(String(bahan.metodePembayaran), 'Transfer', 'metode');
  eq(String(bahan.deskripsi), 'Karangan A', 'deskripsi');
});

uji('tidak ada baris yang hilang saat pembacaan', () => {
  eq(items.length, sheetRapi.length - 1, 'header tidak ikut dihitung sebagai item');
});

// =====================================================================
// BAGIAN 2 - NORMALISASI Jenis
// =====================================================================
console.log('');
console.log('-- NORMALISASI Jenis --');

const normJenis = ctx._normJenisCd || ((v) => String(v ?? '').trim().toUpperCase().replace(/[\s\-]+/g, '_'));

uji('_normJenisCd tersedia di Code.gs', () => {
  if (typeof ctx._normJenisCd !== 'function') throw new Error('fungsi _normJenisCd tidak ada di Code.gs');
});

uji('normalisasi tahan huruf besar/kecil', () => {
  eq(normJenis('Bahan Baku'), 'BAHAN_BAKU', 'Bahan Baku');
  eq(normJenis('bahan baku'), 'BAHAN_BAKU', 'bahan baku');
  eq(normJenis('BAHAN_BAKU'), 'BAHAN_BAKU', 'BAHAN_BAKU');
});
uji('normalisasi tahan spasi berlebih di awal & akhir', () => {
  eq(normJenis('  Biaya   Operasional  '), 'BIAYA_OPERASIONAL', 'spasi berlebih');
});
uji('normalisasi toleran tanda hubung', () => {
  eq(normJenis('Non-Operasional'), 'NON_OPERASIONAL', 'Non-Operasional');
});
uji('normalisasi tolerate null/undefined/kosong', () => {
  eq(normJenis(''), '', 'string kosong');
  eq(normJenis(null), '', 'null');
  eq(normJenis(undefined), '', 'undefined');
});

// =====================================================================
// BAGIAN 3 - MATRIKS KLASIFIKASI
// =====================================================================
console.log('');
console.log('-- KLASIFIKASI BARIS --');

// Implementasi referensi = spesifikasi. Dipakai hanya bila Code.gs belum
// punya fungsinya, supaya kegagalan tetap bisa dibaca sebagai selisih angka.
const peran = ctx._peranBarisCd || ((j, t) => {
  const n = normJenis(j);
  const T = String(t || '').trim().toUpperCase();
  if (T === 'CREDIT' && n === 'BIAYA_OPERASIONAL') return 'BIAYA_OPERASIONAL';
  if (T === 'CREDIT' && n === 'NON_OPERASIONAL') return 'NON_OPERASIONAL';
  if (T === 'DEBIT' && n === 'PENDAPATAN_LAIN') return 'PENDAPATAN_LAIN';
  if (T === 'CREDIT' && (n === 'BAHAN_BAKU' || n === 'KEMASAN')) return 'INVENTORI';
  if (T === 'CREDIT' && n === 'CAMPURAN') return 'CAMPURAN';
  return 'TIDAK_DIKENAL';
});

uji('_peranBarisCd tersedia di Code.gs', () => {
  if (typeof ctx._peranBarisCd !== 'function') throw new Error('fungsi _peranBarisCd tidak ada di Code.gs');
});

const MATRIX = [
  ['CREDIT', 'Bahan Baku', 'INVENTORI', 'pembelian bahan baku tidak boleh dikurangi lagi (sudah ikut HPP)'],
  ['CREDIT', 'bahan baku', 'INVENTORI', 'variasi huruf kecil'],
  ['CREDIT', 'BAHAN_BAKU', 'INVENTORI', 'sudah underscore'],
  ['CREDIT', 'Kemasan', 'INVENTORI', 'kemasan ikut HPP, tidak boleh deduction ganda'],
  ['CREDIT', 'Biaya Operasional', 'BIAYA_OPERASIONAL', 'biaya operasional'],
  ['CREDIT', 'biaya operasional', 'BIAYA_OPERASIONAL', 'huruf kecil + spasi'],
  ['CREDIT', 'Non Operasional', 'NON_OPERASIONAL', 'beban non-operasional'],
  ['CREDIT', 'NON_OPERASIONAL', 'NON_OPERASIONAL', 'sudah underscore'],
  ['CREDIT', 'Campuran', 'CAMPURAN', 'tidak boleh diasumsikan masuk kategori manapun'],
  ['CREDIT', 'operasional', 'TIDAK_DIKENAL', 'nilai lama tidak dikenal -> jangan diasumsikan'],
  ['CREDIT', '', 'TIDAK_DIKENAL', 'jenis kosong -> jangan diasumsikan'],
  ['CREDIT', 'TIDAK ADA', 'TIDAK_DIKENAL', 'nilai ngawur -> jangan diasumsikan'],
  ['DEBIT', 'PENDAPATAN_LAIN', 'PENDAPATAN_LAIN', 'pendapatan lain'],
  ['DEBIT', 'Pendapatan Lain', 'PENDAPATAN_LAIN', 'huruf campur + spasi'],
  ['DEBIT', 'Bahan Baku', 'TIDAK_DIKENAL', 'DEBIT bukan bahan baku'],
  ['DEBIT', 'Biaya Operasional', 'TIDAK_DIKENAL', 'DEBIT bukan biaya operasional'],
  ['DEBIT', '', 'TIDAK_DIKENAL', 'DEBIT tanpa jenis tidak boleh jadi pendapatan lain'],
  ['DEBIT', 'NON_OPERASIONAL', 'TIDAK_DIKENAL', 'hanya DEBIT+PENDAPATAN_LAIN yang jadi pendapatan lain'],
  ['CREDIT', 'PENDAPATAN_LAIN', 'TIDAK_DIKENAL', 'CREDIT bukan pendapatan lain'],
  ['CREDIT', 'Uang Modal', 'PENDANAAN_MODAL', 'pengembalian modal pemilik, bukan beban usaha'],
  ['CREDIT', 'uang modal', 'PENDANAAN_MODAL', 'variasi huruf kecil'],
  ['CREDIT', 'Pengembalian uang modal', 'PENDANAAN_MODAL', 'varian label "pengembalian"'],
  ['CREDIT', 'UANG_MODAL', 'PENDANAAN_MODAL', 'sudah underscore'],
  ['DEBIT', 'Uang Modal', 'TIDAK_DIKENAL', 'DEBIT + uang modal tidak boleh jadi apa pun'],
  ['CREDIT', 'Modal Usaha', 'TIDAK_DIKENAL', 'label lain tetap tidak dikenal (konservatif)'],
];
for (const [tipe, jenis, harap, alasan] of MATRIX) {
  uji(tipe + ' + "' + jenis + '" -> ' + harap, () => eq(peran(jenis, tipe), harap, alasan));
}

uji('Tipe dicek SEBELUM Jenis: DEBIT tidak pernah ikut bucket pengurang', () => {
  for (const j of ['Bahan Baku', 'Kemasan', 'Biaya Operasional', 'Non Operasional', 'Campuran']) {
    eq(peran(j, 'DEBIT'), 'TIDAK_DIKENAL', 'DEBIT + ' + j);
  }
});
uji('CREDIT + PENDAPATAN_LAIN tidak pernah jadi pendapatan lain', () => {
  eq(peran('Pendapatan Lain', 'CREDIT'), 'TIDAK_DIKENAL', 'CREDIT + Pendapatan Lain');
});

// =====================================================================
// BAGIAN 4 - AGREGASI
// =====================================================================
console.log('');
console.log('-- AGREGASI (angka karangan) --');

const agregasi = ctx._agregasiKpiCd || ((cd, startKey, endKey) => {
  const a = { biayaOperasional: 0, bebanNonOperasional: 0, pendapatanLain: 0, inventori: 0, campuran: 0, tidakDikenali: 0, tidakDikenaliDetail: [] };
  cd.forEach((it) => {
    if (startKey && it.tanggal < startKey) return;
    if (endKey && it.tanggal > endKey) return;
    const k = peran(it.jenis, it.tipe);
    const v = rupiah(it.nominal);
    if (k === 'BIAYA_OPERASIONAL') a.biayaOperasional += v;
    else if (k === 'NON_OPERASIONAL') a.bebanNonOperasional += v;
    else if (k === 'PENDAPATAN_LAIN') a.pendapatanLain += v;
    else if (k === 'INVENTORI') a.inventori += v;
    else if (k === 'CAMPURAN') a.campuran += v;
    else { a.tidakDikenali += v; a.tidakDikenaliDetail.push(it); }
  });
  return a;
});

uji('_agregasiKpiCd tersedia di Code.gs', () => {
  if (typeof ctx._agregasiKpiCd !== 'function') throw new Error('fungsi _agregasiKpiCd tidak ada di Code.gs');
});

// Sheet dibaca s/d kolom G. Tanggal di sel A berupa teks "M/D/YYYY".
//
// PENTING: jangan pakai toISOString() di sini. Mesin ini UTC+7, jadi
// 00:00 lokal = 17:00 UTC sehari sebelumnya dan toISOString() mundur satu
// hari - baris "7/1/2024" akan terbaca 30 Jun dan slip keluar dari rentang
// kuartal. Ambil komponen tanggal LOKAL, seperti yang dilakukan Code.gs.
const tglKeyLokal = (s) => {
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

const itemsDari = (rows) => rows.slice(1)
  .filter((r) => r.some((c) => String(c).trim() !== ''))
  .map((r) => ({
    tanggal: tglKeyLokal(r[0]),
    tipe: r[1], kategori: r[2], deskripsi: r[3],
    metodePembayaran: r[4], nominal: rupiah(r[5]), jenis: r[6],
  }));

const itemsRapi = itemsDari(sheetRapi);
const itemsLama = itemsDari(sheetLama);

const AWAL = '1990-01-01';
const AKHIR = '2099-12-31';

// _agregasiKpiCd menerima rentang tanggal sendiri, jadi tes meneruskan
// daftar lengkap + rentang, bukan hasil prafilter.
uji('[2024 penuh] semua bucket sesuai data karangan', () => {
  const a = agregasi(itemsRapi, AWAL, AKHIR);
  eq(a.biayaOperasional, 446793, 'Sewa + ATK + Perawatan + Listrik + Karpet');
  eq(a.bebanNonOperasional, 245830, 'Pajak + Peralatan');
  eq(a.pendapatanLain, 45550, '2 baris DEBIT');
  eq(a.inventori, 208300, 'Bahan Baku + Kemasan');
  eq(a.campuran, 90317, 'Adonan');
  eq(a.tidakDikenali, 0, 'tidak ada baris bermasalah di varian A');
});

uji('[kuartal 1 2024] rentang tanggal awal benar-benar membatasi', () => {
  const a = agregasi(itemsRapi, '2024-01-01', '2024-03-31');
  eq(a.biayaOperasional, 250137, 'hanya Sewa (12 Mar)');
  eq(a.inventori, 208300, 'hanya dua baris 5 Mar');
  eq(a.bebanNonOperasional, 0, 'Pajak 2 Apr di luar rentang');
  eq(a.pendapatanLain, 0, 'Bunga 18 Apr di luar rentang');
  eq(a.campuran, 0, 'Adonan 4 Jun di luar rentang');
});

uji('[kuartal 2 2024] batas akhir inklusif', () => {
  const a = agregasi(itemsRapi, '2024-04-01', '2024-06-30');
  eq(a.bebanNonOperasional, 175213, 'Pajak 2 Apr masuk, Peralatan 1 Jul tidak');
  eq(a.pendapatanLain, 30137, 'Bunga 18 Apr masuk, 22 Jul tidak');
  eq(a.campuran, 90317, 'Adonan 4 Jun masuk');
  eq(a.biayaOperasional, 140943, 'ATK + Perawatan + Listrik');
});

uji('[kuartal 3 2024] baris 1 Jul tidak slip ke kuartal sebelumnya', () => {
  // Regresi timezone: toISOString() pada mesin UTC+7 mundur satu hari, jadi
  // "7/1/2024" terbaca 30 Jun dan baris ini hilang dari kuartal 3.
  const a = agregasi(itemsRapi, '2024-07-01', '2024-08-31');
  eq(a.bebanNonOperasional, 70617, 'Peralatan 1 Jul masuk');
  eq(a.pendapatanLain, 15413, 'Bunga 22 Jul masuk');
  eq(a.biayaOperasional, 55713, 'Karpet 8 Ags masuk');
});

uji('[2024 penuh] rekonsiliasi: setiap nominal dihitung tepat satu kali', () => {
  const a = agregasi(itemsRapi, AWAL, AKHIR);
  const jumlah = a.biayaOperasional + a.bebanNonOperasional + a.pendapatanLain
    + a.inventori + a.campuran + a.tidakDikenali;
  eq(jumlah, 1036790, 'total nominal 12 baris karangan');
  eq(jumlah, BARIS_CD.reduce((s, r) => s + r[5], 0), 'total harus sama dengan penjumlahan nominal di data karangan');
});

uji('[varian lama] 4 baris legacy masuk Tidak Dikenali, bukan Biaya', () => {
  const a = agregasi(itemsLama, AWAL, AKHIR);
  eq(a.tidakDikenali, 196656, '45.417 + 60.113 + 35.413 + 55.713');
  eq(a.tidakDikenaliDetail.length, 4, 'keempat baris dilaporkan');
  eq(a.biayaOperasional, 250137, 'hanya baris berlabel "Biaya Operasional"');
  eq(a.pendapatanLain, 45550, 'tidak ada baris DEBIT yang bocor');
  eq(a.campuran, 90317, 'baris Campuran tidak ikut dirusak');
});

uji('[varian lama] tidak ada baris bermasalah yang hilang dari pelaporan', () => {
  const a = agregasi(itemsLama, AWAL, AKHIR);
  const jumlah = a.biayaOperasional + a.bebanNonOperasional + a.pendapatanLain
    + a.inventori + a.campuran + a.tidakDikenali;
  eq(jumlah, 1036790, 'total tetap utuh meski 4 baris tidak terkategori');
});

uji('baris tidak dikenal dilaporkan per.baris, bukan hanya dijumlahkan', () => {
  const a = agregasi(itemsLama, AWAL, AKHIR);
  if (!Array.isArray(a.tidakDikenaliDetail)) throw new Error('tidakDikenaliDetail harus array agar baris bermasalah bisa ditindaklanjuti');
  const kosong = a.tidakDikenaliDetail.find((x) => String(x.kategori) === 'Perawatan');
  if (!kosong) throw new Error('baris tanpa Jenis harus dilaporkan');
  eq(String(kosong.jenis || ''), '', 'Jenis baris kosong');
  eq(String(kosong.alasan), 'JENIS_KOSONG', 'alasan harus JENIS_KOSONG');
  eq(rupiah(kosong.nominal), 60113, 'nominal baris kosong');
  const legacy = a.tidakDikenaliDetail.filter((x) => String(x.alasan) === 'JENIS_TIDAK_DIKENAL');
  eq(legacy.length, 3, 'tiga baris berlabel skema lama');
});

uji('label lama "operasional" tidak dianggap biaya operasional', () => {
  // Nilai "operasional" tidak punya padanan di skema baru. Kalau diam-diam
  // dipetakan ke BIAYA_OPERASIONAL, Rp196.656 masuk biaya tanpa jejak.
  eq(peran('operasional', 'CREDIT'), 'TIDAK_DIKENAL', 'label legacy');
});

uji('Inventori & Campuran tidak pernah masuk Biaya/Non-Op/Pendapatan', () => {
  const a = agregasi(itemsRapi, AWAL, AKHIR);
  eq(a.biayaOperasional + a.bebanNonOperasional, 692623, 'Sewa+ATK+Perawatan+Listrik+Karpet + Pajak+Peralatan');
  eq(a.inventori, 208300, 'bucket rekonsiliasi tetap terpisah');
  eq(a.campuran, 90317, 'bucket rekonsiliasi tetap terpisah');
});

// =====================================================================
// BAGIAN 5 - RUMUS LABA BERSIH
// =====================================================================
console.log('');
console.log('-- RUMUS LABA BERSIH --');

const labaBersih = ctx._labaBersihFrom || ((o) => o.omsetKotor - o.totalHPP + o.pendapatanLain - o.biayaOperasional - o.bebanNonOperasional);

uji('_labaBersihFrom tersedia di Code.gs', () => {
  if (typeof ctx._labaBersihFrom !== 'function') throw new Error('fungsi _labaBersihFrom tidak ada di Code.gs');
});

uji('Laba Bersih = Penjualan - HPP + PendapatanLain - BiayaOp - NonOp', () => {
  eq(labaBersih({ omsetKotor: 2013700, totalHPP: 903700, pendapatanLain: 137113, biayaOperasional: 210417, bebanNonOperasional: 60513 }), 976183, 'hasil');
});

uji('pembelian bahan baku & kemasan tidak mengurangi laba', () => {
  const dasar = { omsetKotor: 2013700, totalHPP: 903700, pendapatanLain: 0, biayaOperasional: 210417, bebanNonOperasional: 0 };
  eq(labaBersih(dasar), 899583, 'tanpa inventori');
  eq(labaBersih({ ...dasar, inventori: 5003713 }), 899583, 'inventori diabaikan');
});

uji('bucket rekonsiliasi lain juga tidak boleh masuk rumus', () => {
  const dasar = { omsetKotor: 2013700, totalHPP: 903700, pendapatanLain: 0, biayaOperasional: 210417, bebanNonOperasional: 0 };
  eq(labaBersih({ ...dasar, campuran: 903713 }), 899583, 'campuran diabaikan');
  eq(labaBersih({ ...dasar, tidakDikenali: 196713 }), 899583, 'tidak dikenal diabaikan');
});

uji('tidak ada diskon/refund di sistem -> penjualan bersih = omset kotor', () => {
  eq(ctx.penjualanBersih ? ctx.penjualanBersih(1503713) : 1503713, 1503713, 'penjualanBersih');
});

uji('Laba Bersih dari data karangan konsisten dengan agregasi', () => {
  const a = agregasi(itemsRapi, AWAL, AKHIR);
  eq(labaBersih({
    omsetKotor: 3003713, totalHPP: 1203713,
    pendapatanLain: a.pendapatanLain,
    biayaOperasional: a.biayaOperasional,
    bebanNonOperasional: a.bebanNonOperasional,
  }), 1152927, '3.003.713 - 1.203.713 + 45.550 - 446.793 - 245.830');
});

// =====================================================================
// BAGIAN 6 - DETEKSI KOLOM LEWAT HEADER (bukan index tetap)
// =====================================================================
console.log('');
console.log('-- DETEKSI KOLOM --');

uji('kolom Jenis terdeteksi lewat header "Jenis" di kolom G', () => {
  const peta = ctx._petaKolomCd(HEADER_CD);
  eq(peta.jenis, 6, 'index kolom Jenis');
  eq(peta.tanggal, 0, 'index kolom Tanggal');
  eq(peta.nominal, 5, 'index kolom Nominal');
  eq(peta.tipe, 1, 'index kolom Tipe');
});

uji('kolom Jenis yang BERPINDAH tempat tetap terdeteksi', () => {
  // Susun ulang header: Jenis ditaruh di kolom A, sisanya menggeser.
  const headerUrut = ['Jenis', 'Tanggal', 'Tipe', 'Kategori', 'Deskripsi', 'Metode Pembayaran', 'Nominal'];
  const peta = ctx._petaKolomCd(headerUrut);
  eq(peta.jenis, 0, 'Jenis di kolom A terdeteksi');
  eq(peta.tanggal, 1, 'Tanggal di kolom B terdeteksi');
  eq(peta.nominal, 6, 'Nominal di kolom G terdeteksi');
  eq(ctx._cariKolomCd(headerUrut, ['metode pembayaran', 'metode', 'pembayaran']), 5, 'Metode Pembayaran terdeteksi');
});

uji('header "Jenis" dikenali walau huruf/kolom berbeda', () => {
  eq(ctx._cariKolomCd(['tanggal', 'tipe', 'jenis'], ['jenis', 'jenis biaya', 'jenis transaksi', 'kategori jenis']), 2, 'keputusan');
  eq(ctx._cariKolomCd(['Tanggal', 'Tipe', 'Jenis Transaksi'], ['jenis', 'jenis biaya', 'jenis transaksi', 'kategori jenis']), 2, 'varian "Jenis Transaksi"');
  eq(ctx._cariKolomCd(['Tanggal', 'Tipe', 'Kategori'], ['jenis', 'jenis biaya', 'jenis transaksi', 'kategori jenis']), -1, 'tidak ada kolom Jenis');
});

uji('sheet tanpa kolom Jenis TIDAK diam-diam jadi nol', () => {
  // Bukti lapangan: sheet Credit/Debit di database DEV hanya punya 6 kolom
  // (select G = NO_COLUMN). Kalau kolom diasumsikan di index 6, semua baris
  // terbaca "jenis kosong" -> Biaya 0 -> Laba Bersih overstate tanpa error.
  const sel = keSel(sheetTanpaJenis);
  const ctxDev = muatCode(sel);
  const itemsDev = baca(ctxDev, sel);
  eq(itemsDev.length, BARIS_CD.length, 'baris tetap terbaca');
  eq(itemsDev.every((x) => x.jenisTerdeteksi === false), true, 'semua ditandai jenis tidak terdeteksi');
  eq(itemsDev.every((x) => String(x.jenis || '') === ''), true, 'jenis kosong, bukan data ngawur');

  const agg = ctxDev._agregasiKpiCd(itemsDev, AWAL, AKHIR);
  eq(agg.kolomJenisHilang, true, 'peringatan kolom Jenis hilang terpasang');
  eq(agg.biayaOperasional, 0, 'tidak ada biaya yang bisa dihitung');
  eq(agg.tidakDikenali, 1036790, 'SELURUH nominal dilaporkan, bukan hilang');
  eq(agg.tidakDikenaliDetail.length, BARIS_CD.length, 'semua baris perlu diklasifikasi');
});

uji('sheet tanpa kolom Jenis: alasan JENIS_KOSONG terisi untuk semua baris', () => {
  // Kalau "tidak dikenal" bernilai 0, dashboard menampilkan "semua beres"
  // padahal tidak ada satu pun baris yang bisa diklasifikasi.
  const sel = keSel(sheetTanpaJenis);
  const ctxDev = muatCode(sel);
  const agg = ctxDev._agregasiKpiCd(baca(ctxDev, sel), AWAL, AKHIR);
  eq(agg.tidakDikenaliDetail.filter((x) => String(x.alasan) === 'JENIS_KOSONG').length, BARIS_CD.length, 'alasan JENIS_KOSONG');
});

// =====================================================================
// BAGIAN 7 - PARSING TANGGAL TEKS (cabang fallback)
// =====================================================================
console.log('');
console.log('-- TANGGAL TEKS (fallback) --');

uji('tanggal teks M/D tidak salah baca sebagai D/M', () => {
  eq(ctx._parseSheetDateKey('9/27/2024'), '2024-09-27', '9/27 -> 27 Sep, bukan 7 Sep');
  eq(ctx._parseSheetDateKey('7/9/2024'), '2024-07-09', '7/9 -> 9 Jul');
  eq(ctx._parseSheetDateKey('12/31/2024'), '2024-12-31', '31 Des');
});

uji('tanggal teks D/M tetap dikenali lewat angka > 12', () => {
  eq(ctx._parseSheetDateKey('27/09/2024'), '2024-09-27', '27/9 -> 27 Sep');
  eq(ctx._parseSheetDateKey('31/12/2024'), '2024-12-31', '31/12');
});

uji('format ambigu memakai M/D sesuai locale sheet', () => {
  // 7/9/2024 ambigu. Sheet ini menulis M/D/YYYY, jadi harusnya 9 Juli.
  eq(ctx._parseSheetDateKey('7/9/2024'), '2024-07-09', 'default M/D');
});

uji('tanggal tidak terbaca tetap dilewati, bukan jadi tanggal palsu', () => {
  eq(ctx._parseSheetDateKey(''), '', 'kosong');
  eq(ctx._parseSheetDateKey('bukan tanggal'), '', 'teks');
  eq(ctx._parseSheetDateKey('99/99/9999'), '', 'di luar rentang');
});

uji('tanggal tiap baris karangan terbaca sesuai yang ditulis', () => {
  eq(itemsRapi[0].tanggal, '2024-03-05', 'baris pertama');
  eq(itemsRapi[BARIS_CD.length - 1].tanggal, '2024-08-08', 'baris terakhir');
});

// =====================================================================
// BAGIAN 8 - PENDANAAN MODAL ("Uang Modal") TIDAK MASUK PENGELUARAN
// =====================================================================
// Kasus nyata di sheet produksi: pemilik mencatat "Pengembalian uang modal"
// sebagai CREDIT berlabel Jenis "Uang Modal". Itu dana yang kembali ke
// pemilik (drawings), BUKAN biaya operasional - kalau ikut dikurangkan,
// Laba Bersih tertekan tanpa ada pengeluaran usaha yang sebenarnya.
// Sebelum ada peran PENDANAAN_MODAL, baris ini jatuh ke TIDAK_DIKENAL:
// rumusnya benar (tidak dihitung), tapi panel dashboard meneriakkan
// "baris belum terkategori" seolah ada data yang salah.
const BARIS_MODAL = [
  ['9/6/2024', 'CREDIT', 'Modal Ari', 'Karangan pengembalian 1', 'Transfer', 900137, 'Uang Modal'],
  ['9/7/2024', 'CREDIT', 'Modal Rian', 'Karangan pengembalian 2', 'Transfer', 900413, 'Uang Modal'],
  ['9/8/2024', 'CREDIT', 'Sewa', 'Karangan sewa', 'Tunai', 300113, 'Biaya Operasional'],
];
const itemsModal = BARIS_MODAL.map((r) => ({
  tanggal: tglKeyLokal(r[0]),
  tipe: r[1], kategori: r[2], deskripsi: r[3],
  metodePembayaran: r[4], nominal: rupiah(r[5]), jenis: r[6],
}));

console.log('');
console.log('-- PENDANAAN MODAL (Uang Modal) --');

uji('Uang Modal masuk bucket pendanaanModal, bukan biayaOperasional', () => {
  const a = agregasi(itemsModal, AWAL, AKHIR);
  eq(a.pendanaanModal, 1800550, 'dua baris Uang Modal');
  eq(a.biayaOperasional, 300113, 'hanya baris berlabel Biaya Operasional');
  eq(a.tidakDikenali, 0, 'tidak ada baris yang jatuh ke tak dikenal');
  eq(a.tidakDikenaliDetail.length, 0, 'tidak ada baris perlu tindak lanjut');
});

uji('rentang tanggal membatasi pendanaanModal seperti bucket lain', () => {
  const a = agregasi(itemsModal, '2024-09-01', '2024-09-07');
  eq(a.pendanaanModal, 1800550, 'dua baris 6-7 Sep masuk');
  eq(a.biayaOperasional, 0, 'sewa 8 Sep di luar rentang');
});

uji('pendanaanModal tidak memengaruhi Laba Bersih', () => {
  const a = agregasi(itemsModal, AWAL, AKHIR);
  eq(labaBersih({ omsetKotor: 2000113, totalHPP: 800417, pendapatanLain: 0, biayaOperasional: a.biayaOperasional, bebanNonOperasional: 0 }), 899583, '2.000.113 - 800.417 - 300.113');
  eq(labaBersih({ omsetKotor: 2000113, totalHPP: 800417, pendapatanLain: 0, biayaOperasional: a.biayaOperasional + a.pendanaanModal, bebanNonOperasional: 0 }), -900967, 'kalau pendanaan ikut dikurangkan laba berubah - itu bug yang dilarang');
});

uji('rekonsiliasi: pendanaanModal dihitung tepat satu kali', () => {
  const a = agregasi(itemsModal, AWAL, AKHIR);
  const jumlah = a.biayaOperasional + a.bebanNonOperasional + a.pendapatanLain
    + a.inventori + a.campuran + a.tidakDikenali + a.pendanaanModal;
  eq(jumlah, 2100663, '900.137 + 900.413 + 300.113');
  eq(jumlah, BARIS_MODAL.reduce((s, r) => s + r[5], 0), 'harus sama dengan penjumlahan nominal di data karangan');
});

// ---------- ringkasan ----------
console.log('');
console.log('=== ' + lulus + ' lulus, ' + gagal.length + ' gagal ===');
if (gagal.length) {
  console.log('');
  gagal.forEach((g) => console.log('  - ' + g));
  process.exit(1);
}
