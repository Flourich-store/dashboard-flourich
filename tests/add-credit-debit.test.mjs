// Tes addCreditDebit: kolom Jenis wajib terisi, dan penulisan ke sheet
// harus berbasis NAMA HEADER (bukan index kolom).
//
// Latar belakang bug: form dashboard tidak punya field Jenis, dan fungsi
// tulis memakai appendRow([6 nilai]) sehingga kolom G (Jenis) tidak pernah
// tersentuh -> baris baru ber-Jenis kosong -> TIDAK_DIKENAL -> panel peringatan.
//
// Data 100% karangan di dalam berkas ini. Tidak membaca tests/fixtures/
// (di-gitignore) dan tidak menyentuh sheet produksi. Setiap nominal
// berakhiran angka selain nol, sehingga tidak mungkin sama dengan nominal
// produksi (kelipatan 1.000).
//
// Cara pakai: node tests/add-credit-debit.test.mjs [path Code.gs]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const AKAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODE = process.argv[2] || path.join(AKAR, 'Code.gs');
const HTML = path.join(AKAR, 'DashboardStandalone.html');

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
function ada(v, apa) {
  if (!v) throw new Error((apa || 'nilai') + ': seharusnya ada/true, dapat ' + JSON.stringify(v));
}

// =====================================================================
// SHEET PALSU - MENCATAT tulisan, MEMBANTING appendRow.
// getRange dipakai dua kali: (1) baca baris header, (2) tulis baris baru.
// =====================================================================
function sheetRekam(header, isi) {
  const rekam = { setValues: 0, appendRow: 0, koordinat: null, baris: null };
  return {
    __rekam: rekam,
    getName: () => 'Credit/Debit',
    getLastRow: () => 1 + isi.length,          // header + baris data
    getLastColumn: () => header.length,
    getDataRange: () => ({ getValues: () => [header.slice()].concat(isi.map((r) => r.slice())) }),
    getRange: (r, c, h, w) => ({
      // baca header: getRange(1,1,1,lastCol).getValues()[0]
      getValues: () => [header.slice()],
      // tulis: getRange(lastRow+1, 1, 1, lebar).setValues([baris])
      setValues: (vals) => {
        rekam.setValues++;
        rekam.koordinat = { r, c, h, w };
        rekam.baris = (vals && vals[0] ? vals[0] : []).slice();
      },
    }),
    // Penulisan posisional lama DILARANG. Kalau kode masih memakainya,
    // _guardToken menangkap error dan tes "berhasil tulis" menjadi gagal.
    appendRow: () => { rekam.appendRow++; throw new Error('appendRow dipakai — penulisan harus berbasis header'); },
  };
}

// ---------- muat Code.gs ke vm ----------
const KUNCI = 'kunci-sah-tesan';
const SESI = JSON.stringify({ u: 'penguji', r: 'SUPER_ADMIN' });

function muatCode(sheet) {
  const kode = fs.readFileSync(CODE, 'utf8');
  const ss = { getSheetByName: (n) => (n === 'Credit/Debit' ? sheet : null), getSheets: () => [] };
  const ctx = {
    console,
    SpreadsheetApp: { openById: () => ss, getActiveSpreadsheet() { return this.openById(); } },
    Logger: { log() {}, warn() {}, error() {} },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (k === 'sess_' + KUNCI ? SESI : null),
        put() {}, remove() {},
      }),
    },
    // Apps Script memformat di Asia/Jakarta. Stub wajib memakai offset sama,
    // kalau tidak tanggal meleset sehari.
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

// =====================================================================
// DATA KARANGAN
// =====================================================================
const HEADER = ['Tanggal', 'Tipe', 'Kategori', 'Deskripsi', 'Metode Pembayaran', 'Nominal', 'Jenis'];
const DATA = { tanggal: '2024-03-05', kategori: 'Karangan', deskripsi: 'Transaksi karangan', metodePembayaran: 'Cash', nominal: 137001 };

const DAFTAR_CREDIT = ['Bahan Baku', 'Kemasan', 'Biaya Operasional', 'Non Operasional', 'Uang Modal'];
const DAFTAR_DEBIT = ['Pendapatan Lain'];

function siapkan(header, isi) {
  const sheet = sheetRekam(header || HEADER, isi || []);
  const ctx = muatCode(sheet);
  return { ctx, sheet, jalan: (tipe, data) => ctx.addCreditDebit(KUNCI, tipe, data) };
}

console.log('=== TES ADD CREDIT/DEBIT - kolom Jenis & tulis berbasis header ===');
console.log('target  : ' + CODE);
console.log('fixture : tidak ada, seluruh data dibuat di dalam berkas ini');
console.log('');

// =====================================================================
// BAGIAN 1 - KONSTANTA TUNGGAL
// =====================================================================
console.log('-- KONSTANTA TUNGGAL CD_JENIS_VALID --');

const satu = siapkan();
const CD = satu.ctx.CD_JENIS_VALID;

uji('CD_JENIS_VALID tersedia sebagai konstanta tunggal', () => {
  ada(CD, 'CD_JENIS_VALID');
  if (typeof CD !== 'object' || Array.isArray(CD)) throw new Error('harus objek per tipe, dapat ' + (Array.isArray(CD) ? 'array' : typeof CD));
});

uji('daftar CREDIT persis 5 label yang disepakati', () => {
  eq(JSON.stringify(CD.CREDIT), JSON.stringify(DAFTAR_CREDIT), 'CREDIT');
});

uji('daftar DEBIT persis Pendapatan Lain', () => {
  eq(JSON.stringify(CD.DEBIT), JSON.stringify(DAFTAR_DEBIT), 'DEBIT');
});

uji('Campuran TIDAK ada di daftar input baru', () => {
  eq(CD.CREDIT.indexOf('Campuran'), -1, 'posisi Campuran di CREDIT');
  eq(CD.DEBIT.indexOf('Campuran'), -1, 'posisi Campuran di DEBIT');
});

uji('"Pengembalian uang modal" TIDAK ada di daftar input baru (hanya "Uang Modal")', () => {
  const gabung = CD.CREDIT.concat(CD.DEBIT).join('|');
  if (gabung.indexOf('Pengembalian') >= 0) throw new Error('varian Pengembalian bocor ke daftar: ' + gabung);
  eq(CD.CREDIT.indexOf('Uang Modal') >= 0, true, 'Uang Modal harus tetap ada');
});

uji('getCreditDebitJenisOptions mengembalikan daftar yang sama (dipakai form)', () => {
  const res = satu.ctx.getCreditDebitJenisOptions(KUNCI);
  eq(res.status, 'success', 'status');
  eq(JSON.stringify(res.data.CREDIT), JSON.stringify(CD.CREDIT), 'CREDIT yang diterima form');
  eq(JSON.stringify(res.data.DEBIT), JSON.stringify(CD.DEBIT), 'DEBIT yang diterima form');
});

// ---------- regresi: laporan baris lama tidak boleh tersentuh ----------
console.log('');
console.log('-- REGRESI _peranBarisCd (baris lama harus tetap dikenali) --');

uji('CAMPURAN tetap dikenali laporan untuk baris lama', () => {
  eq(satu.ctx._peranBarisCd('Campuran', 'CREDIT'), 'CAMPURAN', 'bucket');
});

uji('"Pengembalian uang modal" tetap dikenali laporan untuk baris lama', () => {
  eq(satu.ctx._peranBarisCd('Pengembalian uang modal', 'CREDIT'), 'PENDANAAN_MODAL', 'bucket');
  eq(satu.ctx._peranBarisCd('Uang Modal', 'CREDIT'), 'PENDANAAN_MODAL', 'bucket');
});

uji('Jenis kosong tetap TIDAK_DIKENAL (memicu panel peringatan)', () => {
  eq(satu.ctx._peranBarisCd('', 'CREDIT'), 'TIDAK_DIKENAL', 'bucket');
});

// =====================================================================
// BAGIAN 2 - VALIDASI SERVER MENOLAK
// =====================================================================
console.log('');
console.log('-- VALIDASI SERVER: DITOLAK & TIDAK MENULIS --');

function ditolak(tipe, jenis, alas) {
  const s = siapkan();
  const res = s.jalan(tipe, Object.assign({}, DATA, { jenis }));
  uji('ditolak: ' + alas, () => {
    eq(res.status, 'error', 'status');
    if (typeof res.message !== 'string' || !res.message.trim()) throw new Error('pesan error kosong — user tidak tahu apa yang salah');
    eq(s.sheet.__rekam.setValues, 0, 'tulisan ke sheet (harus 0)');
    eq(s.sheet.__rekam.appendRow, 0, 'appendRow (harus 0)');
  });
}

ditolak('CREDIT', '', 'Jenis kosong ditolak');
ditolak('CREDIT', '   ', 'Jenis berisi spasi saja ditolak');
ditolak('DEBIT', 'Biaya Operasional', 'DEBIT + Biaya Operasional = salah tipe');
ditolak('CREDIT', 'Pendapatan Lain', 'CREDIT + Pendapatan Lain = salah tipe');
ditolak('CREDIT', 'operasional', 'CREDIT + "operasional" (label lama huruf kecil)');
ditolak('CREDIT', 'biaya operasional', 'CREDIT + huruf kecil semua');
ditolak('CREDIT', 'Biaya-Operasional', 'CREDIT + tanda hubung');
ditolak('CREDIT', 'Biaya  Operasional', 'CREDIT + spasi ganda di tengah');
ditolak('CREDIT', 'Biaya Operasional.', 'CREDIT + titik tambahan');
ditolak('CREDIT', 'Campuran', 'CAMPURAN ditolak untuk input baru');
ditolak('DEBIT', 'Uang Modal', 'DEBIT + Uang Modal = salah tipe');
ditolak('CREDIT', 'Jenis Lain', 'CREDIT + label yang tidak ada di daftar');

// =====================================================================
// BAGIAN 3 - DITERIMA & DITULIS BERDASARKAN NAMA HEADER
// =====================================================================
console.log('');
console.log('-- DITERIMA & TULIS BERDASARKAN NAMA HEADER --');

function diterima(tipe, jenis) {
  const s = siapkan();
  const res = s.jalan(tipe, Object.assign({}, DATA, { jenis }));
  return { s, res };
}

uji('CREDIT + Biaya Operasional diterima dan Jenis masuk ke kolom G', () => {
  const { s, res } = diterima('CREDIT', 'Biaya Operasional');
  eq(res.status, 'success', 'status');
  eq(s.sheet.__rekam.appendRow, 0, 'appendRow tidak boleh dipakai');
  eq(s.sheet.__rekam.setValues, 1, 'setValues harus dipanggil tepat satu kali (all-or-nothing)');
  eq(s.sheet.__rekam.baris[6], 'Biaya Operasional', 'nilai di index 6 (kolom G)');
});

uji('DEBIT + Pendapatan Lain diterima dan Jenis masuk ke kolom G', () => {
  const { s, res } = diterima('DEBIT', 'Pendapatan Lain');
  eq(res.status, 'success', 'status');
  eq(s.sheet.__rekam.baris[6], 'Pendapatan Lain', 'nilai di index 6 (kolom G)');
});

uji('baris baru tertulis tepat di getLastRow() + 1', () => {
  const s = siapkan(HEADER, [['2024-01-01', 'CREDIT', 'Karangan', 'Lama', 'Cash', 117001, 'Kemasan']]);
  const res = s.jalan('CREDIT', Object.assign({}, DATA, { jenis: 'Uang Modal' }));
  eq(res.status, 'success', 'status');
  eq(s.sheet.__rekam.koordinat.r, 3, 'baris tujuan (header + 1 data = baris 3)');
});

uji('semua field tetap terisi pada index yang benar (tidak bergeser)', () => {
  const { s } = diterima('CREDIT', 'Kemasan');
  const b = s.sheet.__rekam.baris;
  eq(b.length, 7, 'lebar baris');
  eq(b[1], 'CREDIT', 'index 1 = Tipe');
  eq(b[2], 'Karangan', 'index 2 = Kategori');
  eq(b[3], 'Transaksi karangan', 'index 3 = Deskripsi');
  eq(b[4], 'Cash', 'index 4 = Metode');
  eq(b[5], 137001, 'index 5 = Nominal');
});

// --- urutan kolom DIACAK: posisi Jenis berpindah, nilai harus ikut ---
uji('kolom Jenis di index 0 (Jenis dulu) — nilai tetap mendarat di sana', () => {
  const h = ['Jenis', 'Nominal', 'Tanggal', 'Tipe', 'Kategori', 'Deskripsi', 'Metode Pembayaran'];
  const s = siapkan(h, []);
  const res = s.jalan('CREDIT', Object.assign({}, DATA, { jenis: 'Non Operasional' }));
  eq(res.status, 'success', 'status');
  const b = s.sheet.__rekam.baris;
  eq(b[0], 'Non Operasional', 'index 0');
  eq(b[3], 'CREDIT', 'index 3 = Tipe');
  eq(b[6], 'Cash', 'index 6 = Metode');
  eq(b.filter((x) => x === 'Non Operasional').length, 1, 'label Jenis hanya boleh muncul sekali');
});

uji('kolom Jenis di index 2 — nilai ikut ke index 2, index 6 berisi Metode', () => {
  const h = ['Tanggal', 'Tipe', 'Jenis', 'Nominal', 'Kategori', 'Deskripsi', 'Metode Pembayaran'];
  const s = siapkan(h, []);
  const res = s.jalan('DEBIT', Object.assign({}, DATA, { jenis: 'Pendapatan Lain' }));
  eq(res.status, 'success', 'status');
  const b = s.sheet.__rekam.baris;
  eq(b[2], 'Pendapatan Lain', 'index 2 = Jenis');
  eq(b[6], 'Cash', 'index 6 = Metode (bukan Jenis)');
  eq(b.filter((x) => x === 'Pendapatan Lain').length, 1, 'label Jenis hanya boleh muncul sekali');
});

// --- kegagalan harus BERSIH: nol tulisan ---
function gagalBersih(header, tipe, jenis, alas) {
  const s = siapkan(header, []);
  const res = s.jalan(tipe, Object.assign({}, DATA, { jenis }));
  uji('gagal tanpa tulis sebagian: ' + alas, () => {
    eq(res.status, 'error', 'status');
    eq(s.sheet.__rekam.setValues, 0, 'setValues (harus 0)');
    eq(s.sheet.__rekam.appendRow, 0, 'appendRow (harus 0)');
  });
}

gagalBersih(['Tanggal', 'Tipe', 'Kategori', 'Deskripsi', 'Metode Pembayaran', 'Nominal'], 'CREDIT', 'Biaya Operasional', 'kolom Jenis tidak ada di sheet');
gagalBersih(['Tanggal', 'Tipe', 'Kategori', 'Deskripsi', 'Nominal', 'Jenis'], 'CREDIT', 'Biaya Operasional', 'kolom Metode Pembayaran tidak ada');
gagalBersih(['Tanggal', 'Tipe', 'Kategori', 'Deskripsi', 'Metode Pembayaran', 'Jenis'], 'CREDIT', 'Biaya Operasional', 'kolom Nominal tidak ada');

// =====================================================================
// BAGIAN 4 - LABEL PERSIS, TIDAK BERUBAH BENTUK
// =====================================================================
console.log('');
console.log('-- LABEL TULIS PERSIS DENGAN DAFTAR VALIDASI --');

uji('setiap label yang ditulis persis sama dengan daftar validasi', () => {
  const tertulis = [];
  for (const tipe of ['CREDIT', 'DEBIT']) {
    for (const label of CD[tipe]) {
      const s = siapkan();
      const res = s.jalan(tipe, Object.assign({}, DATA, { jenis: label }));
      eq(res.status, 'success', 'terima ' + tipe + ' + ' + label);
      tertulis.push(s.sheet.__rekam.baris[6]);
    }
  }
  const harap = DAFTAR_CREDIT.concat(DAFTAR_DEBIT);
  eq(JSON.stringify(tertulis), JSON.stringify(harap), 'urutan & bentuk label yang masuk sheet');
});

uji('label tidak berubah kapitalisasi atau tanda saat ditulis', () => {
  const s = siapkan();
  s.jalan('CREDIT', Object.assign({}, DATA, { jenis: 'Bahan Baku' }));
  const v = s.sheet.__rekam.baris[6];
  eq(v, 'Bahan Baku', 'bentuk tersimpan');
  eq(v.toLowerCase(), 'bahan baku', 'huruf kecil (untuk membuktikan bukan hasil transformasi)');
  if (v.indexOf('-') >= 0) throw new Error('ada tanda hubung: ' + v);
});

uji('spasi di sekeliling dibuang, tapi isi label tidak diubah', () => {
  const s = siapkan();
  const res = s.jalan('CREDIT', Object.assign({}, DATA, { jenis: '  Kemasan  ' }));
  eq(res.status, 'success', 'status');
  eq(s.sheet.__rekam.baris[6], 'Kemasan', 'nilai tersimpan tanpa spasi berlebih');
});

// =====================================================================
// BAGIAN 5 - FORM DI HTML MEMAKAI KONSTANTA YANG SAMA (TIDAK MENYALIN)
// =====================================================================
console.log('');
console.log('-- FORM DashboardStandalone.html --');

const html = fs.existsSync(HTML) ? fs.readFileSync(HTML, 'utf8') : '';

uji('form punya select id="cdJenisInp"', () => {
  ada(/<select[^>]*id="cdJenisInp"/.test(html), 'select cdJenisInp tidak ditemukan di DashboardStandalone.html');
});

uji('dropdown punya opsi kosong tanpa default diam-diam (value="")', () => {
  const blok = html.match(/<select[^>]*id="cdJenisInp"[\s\S]*?<\/select>/);
  ada(blok, 'blok select cdJenisInp tidak ditemukan');
  ada(/<option[^>]*value=""/.test(blok[0]), 'tidak ada opsi value="" sebagai penanda belum dipilih');
});

uji('HTML TIDAK menyalin daftar label (konstanta hanya di Code.gs)', () => {
  const ops = [...html.matchAll(/<option[^>]*value="([^"]*)"/g)].map((m) => m[1]);
  const semua = DAFTAR_CREDIT.concat(DAFTAR_DEBIT);
  const tumpang = ops.filter((o) => semua.indexOf(o) >= 0);
  if (tumpang.length) {
    throw new Error('label Jenis hard-coded di HTML, bisa berbeda dari server: ' + tumpang.join(', '));
  }
});

uji('form mengambil daftar dari server lewat getCreditDebitJenisOptions', () => {
  ada(html.indexOf('getCreditDebitJenisOptions') >= 0, 'html tidak memanggil getCreditDebitJenisOptions');
  ada(html.indexOf('cdJenisInp') >= 0, 'html tidak menyentuh cdJenisInp');
});

uji('aksiAddCreditDebit mengirim field jenis', () => {
  const fn = html.match(/function aksiAddCreditDebit\(\)[\s\S]*?\n    \}/);
  ada(fn, 'fungsi aksiAddCreditDebit tidak ditemukan');
  ada(/jenis\s*:\s*[^\n]*cdJenisInp/.test(fn[0]), 'data yang dikirim tidak memuat jenis dari cdJenisInp');
});

uji('Jenis kosong ditolak di klien dengan toast "Jenis wajib dipilih"', () => {
  ada(html.indexOf("'Jenis wajib dipilih'") >= 0, 'toast persis "Jenis wajib dipilih" tidak ada');
});

uji('field Jenis diberi border merah + fokus saat kosong', () => {
  ada(html.indexOf('field-error') >= 0, 'kelas field-error tidak ada');
  ada(/field-error[\s\S]{0,400}\.focus\(\)/.test(html) || /\.focus\(\)[\s\S]{0,400}field-error/.test(html),
    'field-error dan focus tidak berdekatan');
});

uji('tombol Simpan tetap aktif (tidak memakai disabled)', () => {
  const tombol = html.match(/<button[^>]*onclick="aksiAddCreditDebit\(\)"[^>]*>/);
  ada(tombol, 'tombol Simpan Catatan tidak ditemukan');
  if (/disabled/i.test(tombol[0])) throw new Error('tombol Simpan ternyata memakai disabled: ' + tombol[0]);
});

uji('clearPengeluaranForm ikut mereset cdJenisInp', () => {
  const fn = html.match(/function clearPengeluaranForm\(\)[\s\S]*?\n    \}/);
  ada(fn, 'fungsi clearPengeluaranForm tidak ditemukan');
  ada(/cdJenisInp/.test(fn[0]), 'cdJenisInp tidak direset — sisa pilihan bisa bocor ke transaksi berikutnya');
});

// =====================================================================
console.log('');
if (gagal.length) {
  console.log('DARI ' + (lulus + gagal.length) + ' TEST, GAGAL ' + gagal.length + ':');
  for (const g of gagal) console.log('  - ' + g);
  process.exit(1);
}
console.log('SEMUA LOLOS: ' + lulus + ' test, 0 gagal.');
process.exit(0);
