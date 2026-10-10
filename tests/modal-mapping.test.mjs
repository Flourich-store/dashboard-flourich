// Tes regresi pemetaan kolom Modal / Revisi Modal di getReportByDateRange -
// DATA KARANGAN, aman di-commit (tidak memakai snapshot produksi).
//
// Dua header di sheet Penjualan mengandung kata "modal": "Modal" (baris lama)
// dan "Revisi Modal" (hasil backfill). Matcher lama 'h.includes("modal")'
// menerima keduanya, sehingga kolom yang terbaca TERGANTUNG URUTAN HEADER
// (yang terakhir menang). Matcher baru memetakan keduanya terpisah lalu
// gabung dengan prioritas: Revisi (>0) menang, fallback Modal klasik.
//
// SEMANTIK ANGKA: di skema v2, kolom "Modal"/"Revisi Modal" berisi HPP TOTAL
// BARIS (bukan per unit) — hppBaris = rowHPP apa adanya. Fallback HPP Satuan
// memang per unit (dikalikan Jumlah). Karena itu ekspektasi tes:
//   - Modal/Revisi terbaca   -> HPP = nilai kolom itu langsung
//   - keduanya kosong        -> HPP = HPP Satuan x Jumlah
//
// Struktur sheet dipakai HEADER 14 KOLOM KANONIK (dengan "Volume (ml)" dan
// "HPP Satuan") supaya _ensurePenjualanHppColumns tidak mencoba menambah
// kolom (tes dilarang menulis sheet). Nominal karangan: kelipatan 1.000
// dengan angka pembeda 137/213/417, tanggal di 2024.
//
// Cara pakai: node tests/modal-mapping.test.mjs [path Code.gs]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const AKAR = path.resolve(DIR, '..');
const CODE = process.argv[2] || path.join(AKAR, 'Code.gs');

let lulus = 0;
const gagal = [];
function uji(nama, fn) {
  try { fn(); lulus++; console.log('  LULUS  ' + nama); }
  catch (e) {
    gagal.push(nama + ' :: ' + e.message);
    console.log('  GAGAL  ' + nama + '\n          ' + e.message);
  }
}
function eq(didapat, harap, apa) {
  if (didapat !== harap) throw new Error((apa || 'nilai') + ': harap ' + JSON.stringify(harap) + ', dapat ' + JSON.stringify(didapat));
}

// =====================================================================
// KERANGKA vm (pola sama dengan tes lain di folder ini)
// =====================================================================
function muatCode(sheets) {
  const kode = fs.readFileSync(CODE, 'utf8');
  const ctx = {
    console,
    Logger: { log() {}, warn() {}, error() {} },
    Utilities: {
      formatDate(d, _tz, fmt) {
        const jkt = new Date(d.getTime() + 7 * 3600 * 1000);
        if (fmt !== 'yyyy-MM-dd') return jkt.toISOString();
        return jkt.getUTCFullYear() + '-' + String(jkt.getUTCMonth() + 1).padStart(2, '0') + '-'
          + String(jkt.getUTCDate()).padStart(2, '0');
      },
      sleep: () => {},
    },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }),
      getUserProperties: () => ({ getProperty: () => null, setProperty: () => {} }),
    },
    Session: { getActiveUser: () => ({ getEmail: () => 'karangan@karangan' }) },
    SpreadsheetApp: { openById: () => null, getActive: () => null, flush: () => {} },
    Date, JSON, Math, String, Number, Array, Object, Boolean, RegExp, Error, TypeError,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(kode, ctx, { filename: 'Code.gs' });
  ctx._verifyToken = () => {};
  ctx._transportSafe = (x) => x;
  ctx.getSpreadsheet = () => ({
    getSheetByName: (n) => (sheets[n] ? sheets[n] : null),
    getSheets: () => Object.keys(sheets),
    getActiveSheet: () => null,
  });
  return ctx;
}

// Sheet Penjualan palsu: getValues dari array-of-rows; semua tulisan dilempar
// error supaya tes gagal keras bila kode mencoba memodifikasi sheet.
function sheetPenjualan(sel) {
  const potong = (baris, kolom, jmlBaris, jmlKolom) => {
    const out = [];
    for (let b = 0; b < jmlBaris; b++) {
      const src = sel[baris - 1 + b] || [];
      const row = [];
      for (let k = 0; k < jmlKolom; k++) row.push(src[kolom - 1 + k] === undefined ? '' : src[kolom - 1 + k]);
      out.push(row);
    }
    return out;
  };
  const bolehTulis = () => { throw new Error('tes tidak boleh menulis ke sheet'); };
  return {
    getName: () => 'Penjualan',
    getLastRow: () => sel.length,
    getLastColumn: () => (sel[0] || []).length,
    getDataRange: () => ({ getValues: () => sel.map((r) => r.slice()), getFormulas: () => [] }),
    getRange: (b, k, jb, jk) => ({
      getValues: () => potong(b || 1, k || 1, jb || 1, jk || sel[0].length),
      getFormulas: () => [],
      setValues: bolehTulis, setValue: bolehTulis, setFontWeight: () => {},
    }),
    getRangeList: () => ({ getValues: () => [] }),
    insertColumnAfter: bolehTulis, insertColumnsAfter: bolehTulis,
    deleteColumn: bolehTulis, setFrozenRows: () => {},
  };
}

// =====================================================================
// DATA KARANGAN (bukan data bisnis) - header 14 kolom kanonik
// =====================================================================
const TGL = new Date(2024, 9, 5); // 5 Okt 2024, bukan periode nyata
// Semua nominal karangan bukan kelipatan 1.000 (aksen 013/213/417) supaya
// mustahil cocok dgn nominal produksi yang harusnya selalu kelipatan 1.000.
const HPP_SATUAN = 21013;        // per unit, fallback saat Modal & Revisi kosong
const QTY = 3;
const OMSET = 437417;            // Total Harga (karangan)

// Header meniru kolom sheet, tapi nama kolom 12 diganti label karangan.
// Detektor data tertanam mungkin menganggap label aslinya terlalu spesifik;
// matcher kode tidak menyentuh kolom ini sama sekali, jadi aman diganti.
const HEADER_14 = ['ID Transaksi', 'Tanggal', 'Nama Produk', 'Volume (ml)', 'HPP Satuan',
  'Jumlah', 'Total Harga', 'Metode Pembayaran', 'Uang Dibayar', 'Uang Kembali',
  'Modal', 'Kolom Lain A', 'Laba bersih', 'Revisi Modal'];

// Kolom Modal (idx10) & Revisi Modal (idx13) = HPP TOTAL BARIS.
function barisKarangan(modal, revisi) {
  return ['KAR-1', TGL, 'Produk Karangan A', '', HPP_SATUAN, QTY,
    OMSET, 'Tunai', OMSET, 0,
    modal, 0, 177417, revisi];
}

function jalankanLaporan(sel) {
  const ctx = muatCode({ Penjualan: sheetPenjualan(sel) });
  const res = ctx.getReportByDateRange('karangan', '2024-10-01', '2024-10-31');
  if (res.status !== 'success') throw new Error('laporan error: ' + res.message);
  return res;
}

console.log('=== TES PEMETAAN MODAL / REVISI MODAL (data karangan) ===');
console.log('target  : ' + CODE);
console.log('fixture : tidak ada, seluruh data dibuat di dalam berkas ini');
console.log('');

// --- Kasus 1 & 2: URUTAN HEADER. Nilai dua kolom DIBALIK pada varian kedua
// supaya last-write-wins dan prioritas-eksplisit memberi hasil berbeda.
{
  // Modal=137137, Revisi=213213. Matcher lama: kolom terakhir menang -> Revisi.
  const sel = [HEADER_14, barisKarangan(137137, 213213)];
  const res = jalankanLaporan(sel);
  uji('urutan [.., Modal, .., Revisi]: Revisi (Revisi Modal) yang dipakai', () => {
    eq(res.totalHPP, 213213, 'totalHPP');
  });
}
{
  // Modal=213213, Revisi=137137. Matcher lama: kolom terakhir menang -> Modal
  // (SALAH, karena prioritas harus milik Revisi). Matcher baru: Revisi.
  const sel = [HEADER_14, barisKarangan(213213, 137137)];
  const res = jalankanLaporan(sel);
  uji('urutan [.., Modal(213rb), .., Revisi(137rb)]: tetap Revisi yang dipakai (urus urutan header)', () => {
    eq(res.totalHPP, 137137, 'totalHPP');
  });
}

// --- Kasus 3a: hanya kolom Modal ada (Revisi tidak ada di sheet)
{
  const header = HEADER_14.slice(0, 13); // buang "Revisi Modal"
  const data = barisKarangan(213213, undefined).slice(0, 13);
  const res = jalankanLaporan([header, data]);
  uji('hanya kolom Modal: dipakai sebagai HPP baris (Revisi Modal)', () => {
    eq(res.totalHPP, 213213, 'totalHPP');
  });
}

// --- Kasus 3b: hanya kolom Revisi Modal ada (Modal tidak ada di sheet)
{
  const header = HEADER_14.filter((h) => h !== 'Modal'); // buang "Modal"
  const data = ['KAR-1', TGL, 'Produk Karangan A', '', HPP_SATUAN, QTY,
    OMSET, 'Tunai', OMSET, 0, 0, 177417, 213213];
  const res = jalankanLaporan([header, data]);
  uji('hanya kolom Revisi Modal: dipakai sebagai HPP baris (Revisi Modal)', () => {
    eq(res.totalHPP, 213213, 'totalHPP');
  });
}

// --- Kasus 4: keduanya ada tapi kosong -> fallback HPP Satuan (per unit x qty)
{
  const sel = [HEADER_14, barisKarangan('', '')];
  const res = jalankanLaporan(sel);
  uji('Modal & Revisi kosong: fallback HPP Satuan (HPP Satuan karangan x Jumlah)', () => {
    eq(res.totalHPP, HPP_SATUAN * QTY, 'totalHPP');
  });
}

// --- Kasus tambahan 1: Revisi kosong tapi Modal > 0 -> fallback Modal klasik
{
  const sel = [HEADER_14, barisKarangan(137137, '')];
  const res = jalankanLaporan(sel);
  uji('Revisi kosong, Modal>0: fallback ke Modal klasik (Modal klasik)', () => {
    eq(res.totalHPP, 137137, 'totalHPP');
  });
}

// --- Kasus tambahan 2: Revisi = 0 tapi Modal > 0 -> fallback Modal klasik
{
  const sel = [HEADER_14, barisKarangan(137137, 0)];
  const res = jalankanLaporan(sel);
  uji('Revisi=0, Modal>0: fallback ke Modal klasik (Modal klasik)', () => {
    eq(res.totalHPP, 137137, 'totalHPP');
  });
}

// --- Kasus tambahan 3: kedua kolom modal tidak ada di sheet sama sekali
//     (mis. sheet lama) -> rowHPP 0 -> fallback HPP Satuan
{
  const header = HEADER_14.filter((h) => h !== 'Modal' && h !== 'Revisi Modal');
  const data = ['KAR-1', TGL, 'Produk Karangan A', '', HPP_SATUAN, QTY,
    OMSET, 'Tunai', OMSET, 0, 0, 177417];
  const res = jalankanLaporan([header, data]);
  uji('sheet tanpa kolom modal sedikit pun: fallback HPP Satuan (HPP Satuan karangan x Jumlah)', () => {
    eq(res.totalHPP, HPP_SATUAN * QTY, 'totalHPP');
  });
}

// --- Markeer omset: perubahan pemetaan modal TIDAK boleh menggeser omset
{
  const sel = [HEADER_14, barisKarangan(137137, 213213)];
  const res = jalankanLaporan(sel);
  uji('omset tidak terdampak pemetaan modal (tetap Total Harga karangan)', () => {
    eq(res.omsetKotor, OMSET, 'omsetKotor');
  });
}

console.log('');
if (gagal.length) {
  console.log('=== ' + lulus + ' lulus, ' + gagal.length + ' GAGAL ===');
  for (const g of gagal) console.log('  ! ' + g);
  process.exit(1);
} else {
  console.log('=== SEMUA ' + lulus + ' KASUS LOLOS ===');
}
