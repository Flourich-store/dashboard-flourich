/**
 * FLOURICH DASHBOARD - Backend
 * Auto-initialization untuk sheet yang belum ada
 */

// ============================================================
// KONFIGURASI ENVIRONMENT (DEV / PROD)
// ============================================================
// Ubah nilai ACTIVE_ENV ke 'PROD' jika ingin menggunakan database asli/live, 
// atau 'DEV' untuk database testing/development.
var ACTIVE_ENV = 'PROD'; 

// Ganti dengan ID Spreadsheet untuk masing-masing environment
var SHEET_ID_PROD = '17nWhZx32MhOWI6OnADqisHwjsmAYrBug4-rRT_CjUJQ'; // Database Asli
var SHEET_ID_DEV = '1CVrF7B3TfTF8LYM5neg14gHfhgRS5O7hELlEMwCAWzk';       // Database Testing

// Dipakai sebagai fallback terakhir HPP baris lama tanpa Modal saat master
// produk tidak ditemukan; tidak pernah dipakai mengestimasi pengeluaran.
var BIAYA_OPERASIONAL_CATATAN = 'Laba bersih = laba kotor - pengeluaran tercatat (sheet Credit/Debit).';

// ============================================================
// HPP - REFERENSI (fallback terakhir bila master produk belum punya HPP)
// ============================================================
// Sumber utama HPP laporan adalah kolom HPP di sheet Produk (master).
// Tabel ini hanya fallback bila produk tidak ditemukan / HPP-nya kosong,
// dan hanya untuk produk lama (Leci/WNA). Angka = harga katalog 2026.
var HPP_RATES = {
  DEFAULT: { 250: 7500, 350: 9000, 500: 11000 },
  WNA: { 250: 9500, 350: 10500, 500: 17500 }
};

function getHppRate(namaProduk, volume) {
  var nama = String(namaProduk || '').toUpperCase();
  var isWNA = nama.indexOf('WNA') !== -1 || nama.indexOf('WORTEL NANAS APEL') !== -1;
  var rates = isWNA ? HPP_RATES.WNA : HPP_RATES.DEFAULT;
  var volNum = Number(volume || 250);
  return rates[volNum] || (isWNA ? 9500 : 7500);
}

// Extract volume (250/350/500) dari nama produk, mis. "Semangka Leci 350 ml"
// -> 350. Return 0 bila tidak ada volume di nama.
function _extractVolumeFromName(namaProduk) {
  var m = String(namaProduk || '').match(/\b(250|350|500)\b/);
  return m ? Number(m[1]) : 0;
}

// ============================================================
// MASTER PRODUK - BACA KOLOM HPP (schema v2)
// ============================================================
// Pastikan sheet Produk punya kolom HPP (schema: ID | Nama | Stok | Harga | HPP).
// Aman dipanggil berulang: sheet lama tanpa HPP ditambah kolomnya sekali,
// header ditulis, isi baris lama TIDAK diubah (tetap kosong = fallback tabel).
function _ensureProdukHppColumn(ss) {
  var sheet = ss.getSheetByName('Produk');
  if (!sheet) return null;
  var lastCol = sheet.getLastColumn();
  if (lastCol >= 5 && String(sheet.getRange(1, 5).getValue()).trim().toUpperCase() === 'HPP') return sheet;
  // Cari header HPP di kolom manapun (mis. sheet sudah diatur manual)
  if (lastCol >= 1) {
    var head = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    for (var i = 0; i < head.length; i++) {      if (String(head[i] || '').trim().toUpperCase() === 'HPP') return sheet;
    }
  }
  var col = sheet.getLastColumn() + 1;
  sheet.getRange(1, col).setValue('HPP');
  sheet.getRange(1, col).setFontWeight('bold');
  return sheet;
}

// Ambil HPP/unit dari master Produk. Return {rate, found} — found=false
// berarti produk tidak ada di master / HPP kosong (pemanggil memakai fallback).
function _getMasterHpp(ss, namaProduk) {
  var sheet = ss.getSheetByName('Produk');
  if (!sheet) return { rate: 0, found: false };
  var values = sheet.getDataRange().getValues();
  if (!values || values.length <= 1) return { rate: 0, found: false };
  var header = values[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
  var idxNama = header.indexOf('nama produk');
  if (idxNama === -1) idxNama = header.indexOf('nama');
  var idxHpp = header.indexOf('hpp');
  if (idxNama === -1 || idxHpp === -1) return { rate: 0, found: false };
  var target = String(namaProduk || '').trim().toLowerCase();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][idxNama] || '').trim().toLowerCase() === target) {
      var hpp = Number(values[i][idxHpp] || 0);
      return hpp > 0 ? { rate: hpp, found: true } : { rate: 0, found: false };
    }
}
  return { rate: 0, found: false };
}

// HPP efektif per transaksi: master produk dulu, fallback tabel referensi
// (nama+volume) terakhir. Volume diambil dari nama produk bila kolom Volume
// tidak tersedia, lalu default 250.
function _resolveHpp(ss, namaProduk, volume) {
  var master = _getMasterHpp(ss, namaProduk);
  if (master.found) return master.rate;
  var vol = Number(volume || 0) || _extractVolumeFromName(namaProduk) || 250;
  return getHppRate(namaProduk, vol);
}

// Peta HPP master {namaLower: hpp} — dibaca SEKALI per eksekusi laporan
// (jangan panggil _getMasterHpp per baris: tiap panggilan membaca ulang sheet).
function _readMasterHppMap(ss) {
  var map = {};
  try {
    var sheet = ss.getSheetByName('Produk');
    if (!sheet) return map;
    var values = sheet.getDataRange().getValues();
    if (!values || values.length <= 1) return map;
    var header = values[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
    var idxNama = header.indexOf('nama produk') !== -1 ? header.indexOf('nama produk') : (header.indexOf('nama') !== -1 ? header.indexOf('nama') : 1);
    var idxHpp = header.indexOf('hpp');
    if (idxNama === -1 || idxHpp === -1) return map;
    for (var i = 1; i < values.length; i++) {
      var nm = String(values[i][idxNama] || '').trim();
      var hpp = Number(values[i][idxHpp] || 0);
      if (nm && hpp > 0) map[nm.toLowerCase()] = hpp;
    }
  } catch (e) { Logger.log('ERROR _readMasterHppMap: ' + e); }
  return map;
}

// ============================================================
// NILAI STOK (inventory: kondisi saat ini, bebas filter tanggal)
// Nilai Stok = Qty stok saat ini x HPP/unit (master produk).
// ============================================================
function getNilaiStok(token) {
  return _guardToken(function () {
    _verifyToken(token, false);
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('Produk');
    if (!sheet) return { status: 'success', nilaiStok: 0, totalUnit: 0, rincian: [] };
    _ensureProdukHppColumn(ss);
    var values = sheet.getDataRange().getValues();
    if (!values || values.length <= 1) return { status: 'success', nilaiStok: 0, totalUnit: 0, rincian: [] };
    var header = values[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
    var idxNama = header.indexOf('nama produk') !== -1 ? header.indexOf('nama produk') : (header.indexOf('nama') !== -1 ? header.indexOf('nama') : 1);
    var idxStok = header.indexOf('stok') !== -1 ? header.indexOf('stok') : 2;
    var idxHpp = header.indexOf('hpp');
    var total = 0, unit = 0, rincian = [];
    for (var i = 1; i < values.length; i++) {
      var nm = String(values[i][idxNama] || '').trim();
      if (!nm) continue;
      var stok = Number(values[i][idxStok] || 0);
      var hppRef = null;
      for (var r = 0; r < PRODUK_REFERENSI.length; r++) {
        if (PRODUK_REFERENSI[r].nama.toLowerCase() === nm.toLowerCase()) { hppRef = PRODUK_REFERENSI[r]; break; }
      }
      var hpp = (idxHpp !== -1 && Number(values[i][idxHpp] || 0) > 0) ? Number(values[i][idxHpp])
        : (hppRef ? hppRef.hpp : getHppRate(nm, _extractVolumeFromName(nm) || 250));
      total += hpp * stok;
      unit += stok;
      rincian.push({ nama: nm, stok: stok, hpp: hpp, nilai: hpp * stok });
    }
    return { status: 'success', nilaiStok: total, totalUnit: unit, rincian: rincian };
  });
}

// ============================================================
// BACKFILL MANUAL (opsional, TIDAK dijalankan otomatis)
// Tulis ulang kolom Modal baris Penjualan sesuai HPP master saat ini,
// bila ingin laporan historis mengikuti HPP baru. Panggil dari editor
// Apps Script; histori asli TIDAK diubah kecuali fungsi ini dijalankan.
// ============================================================
function backfillHppPenjualan() {
  var ss = getSpreadsheet();
  var pj = _ensurePenjualanHppColumns(ss);
  if (!pj.sheet) return { status: 'error', message: 'Sheet Penjualan tidak ditemukan' };
  var masterHppMap = _readMasterHppMap(ss);
  var values = pj.sheet.getDataRange().getValues();
  var header = values[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
  var idxJumlah = header.indexOf('jumlah');
  var idxModal = header.indexOf('modal');
  var idxNama = header.indexOf('nama produk');
  if (idxJumlah === -1 || idxModal === -1 || idxNama === -1) {
    return { status: 'error', message: 'Kolom Jumlah/Modal/Nama Produk tidak terdeteksi' };
  }
  var changed = 0;
  for (var i = 1; i < values.length; i++) {
    var nm = String(values[i][idxNama] || '').trim();
    var jml = Number(values[i][idxJumlah] || 0);
    if (!nm || jml <= 0) continue;
    var hppSat = masterHppMap[nm.toLowerCase()] || getHppRate(nm, _extractVolumeFromName(nm) || 250);
    var modalBaru = hppSat * jml;
    if (Number(values[i][idxModal] || 0) !== modalBaru) {
      pj.sheet.getRange(i + 1, idxModal + 1).setValue(modalBaru);
      changed++;
    }
  }
  return { status: 'success', message: 'Kolom Modal diperbarui pada ' + changed + ' baris.' };
}

// Daftar produk referensi awal (HPP & harga jual katalog 2026).
// Dipakai _seedHppDefaults: mengisi kolom HPP master yang masih KOSONG dan
// menambah produk yang belum ada — TIDAK pernah menimpa nilai yang sudah diisi.
var PRODUK_REFERENSI = [
  { id: 'PRD001', nama: 'Semangka Leci 250 ml', stok: 0, harga: 10000, hpp: 7500 },
  { id: 'PRD002', nama: 'Semangka Leci 350 ml', stok: 0, harga: 14000, hpp: 9000 },
  { id: 'PRD003', nama: 'Semangka Leci 500 ml', stok: 0, harga: 20000, hpp: 11000 },
  { id: 'PRD004', nama: 'WNA 250 ml', stok: 0, harga: 12000, hpp: 9500 },
  { id: 'PRD005', nama: 'WNA 350 ml', stok: 0, harga: 15000, hpp: 10500 },
  { id: 'PRD006', nama: 'WNA 500 ml', stok: 0, harga: 23000, hpp: 17500 },
  { id: 'PRD007', nama: 'Semangka Susu 350 ml', stok: 0, harga: 15000, hpp: 10000 }
];

// Isi HPP master yang masih kosong + tambahkan produk referensi yang belum ada.
// Hanya SUPER_ADMIN. Aman dijalankan berulang (idempotent).
function isiHppMasterProduk(token) {
  return _guardToken(function () {
    _verifyToken(token, true);
    var ss = getSpreadsheet();
    var sheet = _ensureProdukHppColumn(ss);
    if (!sheet) return { status: 'error', message: 'Sheet Produk tidak ditemukan' };
    var values = sheet.getDataRange().getValues();
    var header = values[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
    var idxId = header.indexOf('id produk') !== -1 ? header.indexOf('id produk') : 0;
    var idxNama = header.indexOf('nama produk') !== -1 ? header.indexOf('nama produk') : (header.indexOf('nama') !== -1 ? header.indexOf('nama') : 1);
    var idxStok = header.indexOf('stok') !== -1 ? header.indexOf('stok') : 2;
    var idxHarga = header.indexOf('harga') !== -1 ? header.indexOf('harga') : 3;
    var idxHpp = header.indexOf('hpp');
    if (idxHpp === -1) return { status: 'error', message: 'Kolom HPP gagal disiapkan' };

    var byName = {};
    for (var i = 1; i < values.length; i++) {
      var nm = String(values[i][idxNama] || '').trim();
      if (nm) byName[nm.toLowerCase()] = i + 1; // row number sheet
    }
    var diisi = 0, ditambah = 0;
    for (var r = 0; r < PRODUK_REFERENSI.length; r++) {
      var ref = PRODUK_REFERENSI[r];
      var rowNum = byName[ref.nama.toLowerCase()];
      if (rowNum) {
        if (Number(values[rowNum - 1][idxHpp] || 0) <= 0) {
          sheet.getRange(rowNum, idxHpp + 1).setValue(ref.hpp);
          diisi++;
        }
      } else {
        sheet.appendRow([ref.id, ref.nama, ref.stok, ref.harga, ref.hpp]);
        ditambah++;
      }
    }
    _invalidateProdukCache();
    return {
      status: 'success',
      message: 'HPP master diisi untuk ' + diisi + ' produk' + (ditambah ? ', ' + ditambah + ' produk referensi ditambahkan' : '') + '.'
    };
  });
}

// ============================================================
// TANGGAL - HELPERS (aman untuk Date sheet & teks dd/mm/yyyy)
// ============================================================
// Filter periode memakai key string 'yyyy-MM-dd' (bukan objek Date) agar
// perbandingan bebas pergeseran timezone: new Date('yyyy-MM-ddT00:00:00')
// di Apps Script dievaluasi sebagai UTC, sehingga membandingkan Date
// membuat transaksi di tanggal batas bisa terlewat/tergandung sehari.
function _normDateKey(value) {
  var s = String(value || '').trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return '';
  var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
}

// Membaca sel tanggal sheet yang bisa berupa objek Date atau teks
// ('yyyy-MM-dd' maupun 'dd/MM/yyyy' hasil setelan locale). Return '' bila
// tidak bisa dibaca — sebelumnya new Date('dd/MM/yyyy') menghasilkan
// Invalid Date dan barisnya diam-diam dilewati dari laporan.
function _parseSheetDateKey(cell) {
  if (cell instanceof Date) {
    if (isNaN(cell.getTime())) return '';
    return Utilities.formatDate(cell, 'Asia/Jakarta', 'yyyy-MM-dd');
  }
  var s = String(cell || '').trim();
  if (!s) return '';
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
    }
    return '';
  }
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) {
    var d2 = Number(m[1]), mo2 = Number(m[2]), y2 = Number(m[3]);
    if (mo2 >= 1 && mo2 <= 12 && d2 >= 1 && d2 <= 31) {
      return y2 + '-' + ('0' + mo2).slice(-2) + '-' + ('0' + d2).slice(-2);
    }
  }
  return '';
}

// Menggeser key tanggal 'yyyy-MM-dd' sebanyak days (bisa negatif).
// Aritmetika via Date.UTC supaya bebas timezone (Aritmetika Date lokal
// di Apps Script bisa bergeser sehari).''
function _shiftDateKey(key, days) {
  var m = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  var t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  t.setUTCDate(t.getUTCDate() + Number(days || 0));
  return t.getUTCFullYear() + '-' + ('0' + (t.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + t.getUTCDate()).slice(-2);
}

// Selisih hari antara dua key 'yyyy-MM-dd' (b - a).
function _diffDaysKey(a, b) {
  var ma = String(a || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  var mb = String(b || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!ma || !mb) return 0;
  return Math.round((Date.UTC(Number(mb[1]), Number(mb[2]) - 1, Number(mb[3])) - Date.UTC(Number(ma[1]), Number(ma[2]) - 1, Number(ma[3]))) / 86400000);
}

// ============================================================
// GET SPREADSHEET (Mendukung Multi-Environment)
// ============================================================
function getActiveSheetId() {
  var sheetId = (ACTIVE_ENV === 'PROD') ? SHEET_ID_PROD : SHEET_ID_DEV;
  Logger.log('DEBUG getActiveSheetId: ACTIVE_ENV=' + ACTIVE_ENV + ', returning: ' + sheetId);
  return sheetId;
}

var __ssCache = null;

function getSpreadsheet() {
  try {
    if (__ssCache) return __ssCache; // cache dalam satu eksekusi script
    var sheetId = getActiveSheetId();
    Logger.log('DEBUG getSpreadsheet: Opening sheet ' + sheetId);
    __ssCache = SpreadsheetApp.openById(sheetId);
    Logger.log('DEBUG getSpreadsheet: Sheet opened successfully');
    return __ssCache;
  } catch (e) {
    Logger.log('ERROR getSpreadsheet: Failed to open - ' + e.toString());
    throw e;
  }
}

// ============================================================
// AUTO-INITIALIZE SHEETS
// ============================================================
function initSheets() {
  var ss = getSpreadsheet();
  var requiredSheets = ['Produk', 'Penjualan', 'User', 'Credit/Debit'];
  
  requiredSheets.forEach(function(sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      // Tambahkan setup header sesuai kebutuhan di sini...
      Logger.log('Sheet ' + sheetName + ' created di ENV: ' + ACTIVE_ENV);
    }
  });
}

// ============================================================
// GET HTML
// ============================================================
function doGet(e) {
  var page = e && e.parameter ? String(e.parameter.page || '').trim().toLowerCase() : '';
  var fileName = page === 'dashboard' ? 'DashboardStandalone' : 'landingpage';
  Logger.log('doGet: page=' + page + ', file=' + fileName);
  try {
    return HtmlService.createHtmlOutputFromFile(fileName)
        .setTitle(page === 'dashboard' ? 'Flourich Dashboard' : 'Flourich App')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (error) {
    var message = String(error && error.message ? error.message : error)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return HtmlService.createHtmlOutput(
      '<main style="font-family:Arial,sans-serif;max-width:680px;margin:48px auto;padding:24px;color:#172033">' +
      '<h1>Halaman gagal dimuat</h1>' +
      '<p>File <strong>' + fileName + '</strong> tidak dapat dibuka.</p>' +
      '<pre style="white-space:pre-wrap;background:#f1f5f9;padding:16px;border-radius:8px">' + message + '</pre>' +
      '<p>Periksa nama file, deployment, dan Execution log Apps Script.</p>' +
      '</main>'
    ).setTitle('Flourich - Error');
  }
}

// Fungsi pembantu untuk memuat DashboardStandalone
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ============================================================
// AUTHENTICATION
// ============================================================
// ============================================================
// SESSION TOKEN (keamanan: role tidak pernah dipercaya dari client)
// ============================================================
// Token disimpan di CacheService (server-side, 6 jam). Frontend TIDAK PERNAH
// mengirim role/username untuk otorisasi — hanya token. Ini menutup celah
// pemanggilan backend langsung dari console browser dengan role palsu.
var SESSION_TTL_SECONDS = 21600; // 6 jam
var ERR_UNAUTH = 'Sesi tidak valid atau telah berakhir. Silakan login kembali.';

function _createSessionToken(username, role) {
  var token = Utilities.getUuid() + '-' + Date.now();
  CacheService.getScriptCache().put(
    'sess_' + token,
    JSON.stringify({ u: String(username || ''), r: String(role || 'KASIR') }),
    SESSION_TTL_SECONDS
  );
  return token;
}

// Verifikasi token -> { username, role }. Melempar Error bila tidak valid.
// Super admin ditandai flag di sheet User (kolom 4 = SUPER_ADMIN/ADMIN/YA).
function _verifyToken(token, needSuperAdmin) {
  var raw = CacheService.getScriptCache().get('sess_' + String(token || '').trim());
  if (!raw) throw new Error(ERR_UNAUTH);
  var sess;
  try { sess = JSON.parse(raw); } catch (e) { throw new Error(ERR_UNAUTH); }
  if (needSuperAdmin && String(sess.r || '').toUpperCase() !== 'SUPER_ADMIN') {
    throw new Error('Akses ditolak. Hanya SUPER_ADMIN yang boleh mengubah data.');
  }
  return sess;
}

// Wrapper agar semua fungsi ber-token punya penanganan error yang konsisten
function _guardToken(fn) {
  try {
    return fn();
  } catch (e) {
    var msg = String(e && e.message || e);
    if (msg.indexOf(ERR_UNAUTH) !== -1 || msg.indexOf('Akses ditolak') !== -1) {
      return { status: 'error', auth: false, message: msg };
    }
    return { status: 'error', message: msg };
  }
}

function checkLogin(username, password){
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('User');

    if (!sheet){
      // Tidak ada fallback kredensial hardcoded (keamanan).
      // Buat sheet User di spreadsheet (kolom: Username | Password | Role).
      return { status: "error", message: "Sheet User tidak ditemukan di spreadsheet. Hubungi admin untuk setup." };
    }

    var values = sheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++){
      var row = values[i];
      var u = String(row[0] || '').trim();
      var p = String(row[1] || '').trim();
      var r = String(row[2] || 'KASIR').trim().toUpperCase();
      // Flag super admin opsional di kolom ke-4 (SUPER_ADMIN/ADMIN/YA/TRUE)
      var flag = String(row[3] || '').trim().toUpperCase();
      if (r === 'SUPER_ADMIN' || flag === 'SUPER_ADMIN' || flag === 'ADMIN' || flag === 'YA' || flag === 'TRUE') r = 'SUPER_ADMIN';
      if (u.toLowerCase() === String(username || '').trim().toLowerCase() && p === password){
        var token = _createSessionToken(u, r);
        return { status: "success", username: u, role: r, token: token, env: ACTIVE_ENV };
      }
    }
    return { status: "error", message: "Username atau password salah" };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

// Catatan: _requireSuperAdmin(role) LAMA dihapus — role dari client tidak
// dianggap bukti. Semua otorisasi kini lewat _verifyToken(token, true).

// Hapus token sesi dari cache (dipakai saat logout dari dashboard).
function revokeSessionToken(token) {
  try {
    var key = 'sess_' + String(token || '').trim();
    if (String(token || '').trim()) CacheService.getScriptCache().remove(key);
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function _ensurePenjualanHppColumns(ss) {
  var sheet = ss.getSheetByName('Penjualan');
  if (!sheet) return { sheet: null, idxVolume: -1, idxHppSat: -1 };
  var lastCol = sheet.getLastColumn();
  var head = lastCol >= 1 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); }) : [];
  var lower = head.map(function (h) { return h.toLowerCase(); });
  var idxVolume = lower.indexOf('volume (ml)');
  var idxHppSat = lower.indexOf('hpp satuan');
  // Tambah kolom Volume (ml) + HPP Satuan tepat setelah "Nama Produk"
  // agar skema lama (ID|Tanggal|Nama|Jumlah|Total Harga|Metode|Uang|Kembali|Modal|Biaya|Laba) tetap utuh di posisinya.
  if (idxVolume === -1 || idxHppSat === -1) {
    var idxNama = lower.indexOf('nama produk') !== -1 ? lower.indexOf('nama produk') : 2;
    var insertAt = idxNama + 2; // sisip setelah Nama Produk + (kolom baru pertama)
    if (idxVolume === -1) {
      sheet.insertColumnsAfter(idxNama + 1);
      sheet.getRange(1, idxNama + 2).setValue('Volume (ml)');
      sheet.getRange(1, idxNama + 2).setFontWeight('bold');
    }
    if (idxHppSat === -1) {
      var lower2 = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
      var idxNama2 = lower2.indexOf('nama produk') !== -1 ? lower2.indexOf('nama produk') : 2;
      sheet.insertColumnsAfter(idxNama2 + 2);
      sheet.getRange(1, idxNama2 + 3).setValue('HPP Satuan');
      sheet.getRange(1, idxNama2 + 3).setFontWeight('bold');
    }
    head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').trim(); });
    lower = head.map(function (h) { return h.toLowerCase(); });
    idxVolume = lower.indexOf('volume (ml)');
    idxHppSat = lower.indexOf('hpp satuan');
  }
  return { sheet: sheet, idxVolume: idxVolume, idxHppSat: idxHppSat };
}
function getReportByDateRange(token, startDate, endDate) {
  return _guardToken(function () {
    _verifyToken(token, false);
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('Penjualan');
    if (!sheet) {
        return { status: 'success', data: [], totalTransaksi: 0, omsetKotor: 0, prevOmsetKotor: 0, prevLabaBersih: 0, prevRange: null, labaKotor: 0, labaBersih: 0 };
    }

    // Migrasi kolom Volume (ml) & HPP Satuan (sekali, idempotent) SEBELUM data dibaca
    var pj = _ensurePenjualanHppColumns(ss);
    var values = sheet.getDataRange().getValues();

    // Auto-detect column indices from header
    var header = values[0] || [];
    var headerLower = header.map(function(h) { return String(h || '').toLowerCase(); });

    var idxTx = -1, idxTgl = -1, idxProduk = -1, idxJumlah = -1, idxHarga = -1;
    var idxTotalHarga = -1, idxMetode = -1, idxHPP = -1, idxLaba = -1, idxVolume = -1;
    var idxHppSatuan = -1;

    for (var hIdx = 0; hIdx < headerLower.length; hIdx++) {
      var h = headerLower[hIdx];
      if (h.includes('id') && h.includes('transaksi')) idxTx = hIdx;
      if (h.includes('tanggal')) idxTgl = hIdx;
      if (h.includes('produk') || h.includes('nama produk')) idxProduk = hIdx;
      if (h.includes('jumlah') && !h.includes('kembali')) idxJumlah = hIdx;
      if (h.includes('harga satuan') || (h.includes('harga') && !h.includes('total'))) idxHarga = hIdx;
      if (h.includes('total') && h.includes('harga')) idxTotalHarga = hIdx;
      if (h.includes('metode') || h.includes('pembayaran')) idxMetode = hIdx;
      if (h.includes('hpp') && h.includes('satuan')) idxHppSatuan = hIdx;
      // Kolom Modal (HPP penjualan baris lama): cari eksplisit, JANGAN sampai
      // tertimpa 'HPP Satuan' atau 'Biaya Operasional' yang juga mengandung
      // kata hpp/biaya — sebelumnya idxHPP mendarat di kolom Biaya (selalu 0)
      // sehingga Modal historis diabaikan dari perhitungan.
      if (h.includes('modal')) idxHPP = hIdx;
      if ((h.includes('hpp') || h.includes('biaya')) && !h.includes('satuan') && idxHPP === -1) idxHPP = hIdx;
      if (h.includes('laba') || h.includes('bersih')) idxLaba = hIdx;
      if (h.includes('volume')) idxVolume = hIdx;
    }

    // Fallback ke index standard jika tidak ketemu
    if (idxTx === -1) idxTx = 0;
    if (idxTgl === -1) idxTgl = 1;
    if (idxProduk === -1) idxProduk = 2;
    if (idxJumlah === -1) idxJumlah = 4;
    if (idxTotalHarga === -1) idxTotalHarga = 6;
    if (idxMetode === -1) idxMetode = 7;
    if (idxLaba === -1) idxLaba = 9;

    var startKey = _normDateKey(startDate);
    var endKey = _normDateKey(endDate);

    // Periode pembanding untuk badge delta hero: durasi sama, tepat
    // sebelum periode terpilih (mis. 1–22 Sep -> 10–31 Agu).
    var prevStartKey = '', prevEndKey = '', prevGrossTotal = 0, prevTotalHPP = 0;
    if (startKey && endKey && startKey <= endKey) {
      var durDays = _diffDaysKey(startKey, endKey) + 1;
      prevStartKey = _shiftDateKey(startKey, -durDays);
      prevEndKey = _shiftDateKey(endKey, -durDays);
    }

    var productMap = {}, chartMap = { 'Cash': 0, 'QRIS': 0 }, detailData = [];
    var txCount = 0, grossTotal = 0, totalHPP = 0, totalQtyTerjual = 0;
    var seenTx = {};
    var masterHppMap = _readMasterHppMap(ss);

    for (var i = 1; i < values.length; i++) {
      var row = values[i];

      var idTx = row[idxTx];
      var tanggalCell = row[idxTgl];
      var namaProduk = String(row[idxProduk] || '').trim();
      var jumlah = Number(row[idxJumlah] || 0);
      var hargaSatuan = idxHarga !== -1 ? Number(row[idxHarga] || 0) : 0;
      var totalHargaSheet = idxTotalHarga !== -1 ? Number(row[idxTotalHarga] || 0) : 0;
      var totalHarga = hargaSatuan > 0 && jumlah > 0 ? hargaSatuan * jumlah : totalHargaSheet;
      var metode = String(row[idxMetode] || 'CASH').trim();
      var rowHPP = idxHPP !== -1 ? Number(row[idxHPP] || 0) : 0;
      var rowVol = (pj.idxVolume !== -1) ? Number(row[pj.idxVolume] || 0) : 0;
      var rowHppSat = (pj.idxHppSat !== -1) ? Number(row[pj.idxHppSat] || 0) : 0;
      // HPP penjualan baris (biaya barang yang TERJUAL, bukan nilai stok):
      // Modal lama > HPP Satuan (transaksi baru) > master produk > tabel referensi.
      var hppSatuanRow = rowHppSat > 0 ? rowHppSat
        : (masterHppMap[namaProduk.toLowerCase()] || getHppRate(namaProduk, rowVol || _extractVolumeFromName(namaProduk) || 250));
      var hppBaris = rowHPP > 0 ? rowHPP : hppSatuanRow * jumlah;

      if (!idTx || !namaProduk) continue;

      var rowKey = _parseSheetDateKey(tanggalCell);
      if (!rowKey) continue;
      if (startKey && rowKey < startKey) {
        // Baris sebelum periode terpilih tapi masuk periode pembanding
        // tetap dihitung omsetnya untuk badge naik/turun di hero.
        if (prevStartKey && rowKey >= prevStartKey && rowKey <= prevEndKey) {
          prevGrossTotal += totalHarga;
          prevTotalHPP += hppBaris;
        }
        continue;
      }
      if (endKey && rowKey > endKey) continue;

      // Total transaksi = jumlah ID transaksi UNIK (bukan baris)
      var txKey = String(idTx || '').trim();
      if (!seenTx[txKey]) { seenTx[txKey] = true; txCount++; }
      totalQtyTerjual += jumlah;
      grossTotal += totalHarga;
      totalHPP += hppBaris;

      detailData.push({
        tanggal: rowKey,
        namaProduk: namaProduk,
        harga: totalHarga / jumlah, // Calculate harga satuan
        jumlah: jumlah,
        total: totalHarga,
        metode: metode
      });

      // Deteksi metode pembayaran
      var metodeKey = metode.toUpperCase().includes('QR') ? 'QRIS' : 'Cash';
      chartMap[metodeKey] += totalHarga;

      // Map untuk Top Produk
      if (!productMap[namaProduk]) {
        productMap[namaProduk] = { nama: namaProduk, qty: 0, omset: 0, metodeCount: {} };
      }
      productMap[namaProduk].qty += jumlah;
      productMap[namaProduk].omset += totalHarga;
      if (!productMap[namaProduk].metodeCount[metodeKey]) {
        productMap[namaProduk].metodeCount[metodeKey] = 0;
      }
      productMap[namaProduk].metodeCount[metodeKey] += 1;
    }

    var topProducts = [];
    Object.keys(productMap).forEach(function(key) {
      var item = productMap[key];
      var dominantMethod = 'Cash';
      var dominantCount = 0;
      Object.keys(item.metodeCount).forEach(function(method) {
        if (item.metodeCount[method] > dominantCount) {
          dominantMethod = method;
          dominantCount = item.metodeCount[method];
        }
      });
      topProducts.push({
        nama: item.nama,
        qty: item.qty,
        omset: item.omset,
        metodeDominan: dominantMethod
      });
    });

    topProducts.sort(function(a, b) {
      return b.omset - a.omset;
    });

    // Hitung Credit (Pengeluaran) dan Debit (Pemasukan Tambahan).
    // Dibaca sekali pada rentang gabungan (periode pembanding + periode
    // terpilih) lalu dipartisi per baris, sehingga laba bersih periode
    // pembanding untuk badge delta bisa dihitung tanpa baca sheet ekstra.
    var totalExpenses = 0;
    var totalIncomeOther = 0;
    var prevExpenses = 0, prevIncomeOther = 0;
    try {
      var cdBounds = [prevStartKey, startKey].filter(Boolean).sort();
      var cdItems = _readCreditDebitItems(ss, cdBounds[0] || '', endKey || '');
      for (var c = 0; c < cdItems.length; c++) {
        var it = cdItems[c];
        var tipeUpper = String(it.tipe || '').toUpperCase();
        var nominal = Number(it.nominal || 0);
        var inCur = (!startKey || it.tanggal >= startKey) && (!endKey || it.tanggal <= endKey);
        var inPrev = !!prevStartKey && it.tanggal >= prevStartKey && it.tanggal <= prevEndKey;
        if (tipeUpper === 'CREDIT') {
          if (inCur) totalExpenses += nominal;
          if (inPrev) prevExpenses += nominal;
        } else if (tipeUpper === 'DEBIT') {
          if (inCur) totalIncomeOther += nominal;
          if (inPrev) prevIncomeOther += nominal;
        }
      }
    } catch (e) {
      Logger.log('ERROR hitung credit/debit: ' + e.toString());
    }

    // Rumus final: Laba Bersih = Laba Kotor - Pengeluaran tercatat (+ Debit).
    // Tanpa estimasi persen — angka harus bisa direkonsiliasi dengan sheet.
    var grossProfit = grossTotal - totalHPP;
    var biayaOperasional = totalExpenses;
    var netTotal = grossProfit + totalIncomeOther - biayaOperasional;

    // Laba bersih periode pembanding (kebijakan biaya operasional sama
    // dengan periode terpilih: expenses aktual, atau persen bila kosong)
    var prevGrossProfit = prevGrossTotal - prevTotalHPP;
    var prevNetTotal = prevGrossProfit + prevIncomeOther - prevExpenses;
    var topProduct = topProducts[0] || null;

    return {
      status: 'success',
      data: detailData,
      totalTransaksi: txCount,
      totalQtyTerjual: totalQtyTerjual,
      omsetKotor: grossTotal,
      prevOmsetKotor: prevGrossTotal,
      prevLabaBersih: prevNetTotal,
      prevRange: (prevStartKey && prevEndKey) ? { start: prevStartKey, end: prevEndKey } : null,
      totalHPP: totalHPP,
      totalPengeluaran: totalExpenses,
      totalBiayaOperasional: biayaOperasional,
      totalPemasukanLain: totalIncomeOther,
      labaKotor: grossProfit,
      labaBersih: netTotal,
      topProducts: topProducts.slice(0, 5),
      topProductName: topProduct ? topProduct.nama : '',
      topProductQty: topProduct ? topProduct.qty : 0,
      chartData: [{ kategori: 'Cash', omset: chartMap['Cash'] }, { kategori: 'QRIS', omset: chartMap['QRIS'] }]
    };
  });
}

// ============================================================
// ADD PENJUALAN
// ============================================================
function addPenjualan(token, data) {
  return _guardToken(function () {
    _verifyToken(token, false);
    data = data || {};
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('Penjualan');
    if (!sheet) return { status: 'error', message: "Sheet Penjualan tidak ditemukan" };

    var now = new Date();
    // Tanggal & jam mengikuti aplikasi POS (datetime): tanggal terpilih + jam saat input
    var tanggal = data.tanggal ? new Date(data.tanggal + 'T00:00:00') : new Date();
    if (data.tanggal) tanggal.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), 0);
    var namaProduk = String(data.namaProduk || '').trim();
    var harga = Number(data.harga || 0);
    var jumlah = Number(data.jumlah || 1);
    var volume = Number(data.volume || 250);
    var metodeRaw = String(data.metode || 'Cash').trim();
    // Hanya CASH / QRIS yang diterima (mengikuti gaya POS)
    var metode = (metodeRaw.toUpperCase().indexOf('QR') !== -1) ? 'QRIS' : 'CASH';

    if (!namaProduk) return { status: 'error', message: 'Nama produk wajib diisi' };
    if (harga <= 0) return { status: 'error', message: 'Harga harus lebih dari 0' };
    if (jumlah <= 0) return { status: 'error', message: 'Jumlah harus lebih dari 0' };

    var totalHarga = harga * jumlah;
    // HPP satuan: master produk dulu, fallback tabel referensi nama+volume.
    // Ditulis ke sheet (kolom HPP Satuan) agar laporan historis tetap akurat
    // walau master berubah di masa depan.
    var hpp = _resolveHpp(getSpreadsheet(), namaProduk, volume);
    var totalHPP = hpp * jumlah;
    var laba = totalHarga - totalHPP;

    // TRX ID mengikuti format aplikasi POS: FR-<timestamp milidetik>
    // Cek unik cukup baca kolom A saja (bukan seluruh 11 kolom sheet)
    var existingIds = {};
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var idCol = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var vi = 0; vi < idCol.length; vi++) {
        existingIds[String(idCol[vi][0] || '').trim()] = true;
      }
    }
    var idTx;
    do { idTx = 'FR-' + Date.now(); } while (existingIds[idTx]);

    // Metode mengikuti gaya POS: CASH / QRIS
    var metodePos = metode.toUpperCase().indexOf('QR') !== -1 ? 'QRIS' : 'CASH';

    // Pastikan kolom Volume (ml) & HPP Satuan ada (migrasi idempotent)
    _ensurePenjualanHppColumns(ss);

    // Susunan kolom skema v2 (13 kolom):
    // ID Transaksi | Tanggal | Nama Produk | Volume (ml) | HPP Satuan | Jumlah |
    // Total Harga | Metode Pembayaran | Uang Dibayar | Uang Kembali | Modal |
    // Biaya Operasional | Laba bersih
    sheet.appendRow([idTx, tanggal, namaProduk, volume, hpp, jumlah, totalHarga, metodePos, totalHarga, 0, totalHPP, 0, laba]);

    // Update stock
    try {
      updateStock(namaProduk, jumlah);
    } catch (stockErr) {
      Logger.log('Stock update warning: ' + stockErr);
    }

    return { status: 'success', message: 'Penjualan berhasil disimpan', idTx: idTx };
  });
}

function updateStock(namaProduk, qtySold) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Produk');
  if (!sheet || !namaProduk) return;
  var values = sheet.getDataRange().getValues();
  var header = [];
  for (var h = 0; h < values[0].length; h++) {
    header.push(String(values[0][h] || '').trim().toLowerCase());
  }

  var idxNama = header.indexOf('nama produk') !== -1 ? header.indexOf('nama produk') : header.indexOf('namaproduk');
  var idxStok = header.indexOf('stok') !== -1 ? header.indexOf('stok') : header.indexOf('stock');

  if (idxNama === -1 || idxStok === -1) return;

  for (var i = 1; i < values.length; i++) {
    var rowNama = String(values[i][idxNama] || '').trim();
    if (rowNama && namaProduk && rowNama.toLowerCase() === namaProduk.toString().toLowerCase()) {
      var currentStok = Number(values[i][idxStok] || 0);
      var newStok = currentStok - qtySold;
      if (newStok < 0) newStok = 0;
      sheet.getRange(i + 1, idxStok + 1).setValue(newStok);
      _invalidateProdukCache();
      break;
    }
  }
}

// ============================================================
// PRODUK CRUD
// ============================================================
// Cache daftar produk dengan TTL pendek: getProdukList bisa dipanggil
// beberapa kali per sesi (load awal + buka modal), dan setiap pemanggilan
// membaca ulang seluruh sheet dari Sheets API. TTL 30 detik menjaga data
// tetap "real" — perubahan stok dari POS/sheet maksimal basi 30 detik,
// dan tetap dibuang seketika setiap CRUD produk lewat dashboard.
var __produkCache = null;
var __produkCacheAt = 0;
var PRODUK_CACHE_TTL_MS = 30000;

function _invalidateProdukCache() {
  __produkCache = null;
  __produkCacheAt = 0;
}

function getProdukList(token) {
  return _guardToken(function () {
    _verifyToken(token, false);
    if (__produkCache && (Date.now() - __produkCacheAt) < PRODUK_CACHE_TTL_MS) {
      return { status: 'success', products: __produkCache, cached: true };
    }

    var ss = getSpreadsheet();
    var sheet = _ensureProdukHppColumn(ss);
    if (!sheet) return { status: 'error', message: "Sheet Produk tidak ditemukan" };

    var values = sheet.getDataRange().getValues();
    if (!values || values.length <= 1) { __produkCache = []; __produkCacheAt = Date.now(); return { status: 'success', products: [] }; }

    var header = [];
    for (var h = 0; h < values[0].length; h++) {
      header.push(String(values[0][h] || '').trim());
    }

    var idxId = 0, idxNama = 1, idxStok = 2, idxHarga = 3, idxHpp = -1;
    for (var hi = 0; hi < header.length; hi++) {
      var hLow = header[hi].toLowerCase();
      if (hLow === 'id produk' || hLow === 'idproduk' || hLow === 'id_produk' || hLow === 'id') idxId = hi;
      if (hLow === 'nama produk' || hLow === 'namaproduk' || hLow === 'nama_produk' || hLow === 'nama') idxNama = hi;
      if (hLow === 'stok' || hLow === 'stock' || hLow === 'qty' || hLow === 'jumlah') idxStok = hi;
      if (hLow === 'harga') idxHarga = hi;
      if (hLow === 'hpp') idxHpp = hi;
    }

    var products = [];
    for (var i = 1; i < values.length; i++) {
      var row = values[i];
      var idProduk = String(row[idxId] || '').trim();
      if (!idProduk) continue;

      products.push({
        idProduk: idProduk,
        namaProduk: String(row[idxNama] || '').trim(),
        stok: Number(row[idxStok] || 0),
        hpp: idxHpp !== -1 ? Number(row[idxHpp] || 0) : 0,
        harga: Number(row[idxHarga] || 0)
      });
    }

    __produkCache = products;
    __produkCacheAt = Date.now();
    return { status: 'success', products: products };
  });
}

function createProduk(token, payload) {
  return _guardToken(function () {
    _verifyToken(token, true);
    payload = payload || {};

    var idProduk = String(payload.idProduk || '').trim();
    var namaProduk = String(payload.namaProduk || '').trim();
    var stok = Number(payload.stok || 0);
    var harga = Number(payload.harga || 0);
    var hpp = Number(payload.hpp || 0);

    if (!idProduk) return { status: 'error', message: 'ID Produk wajib diisi' };
    if (!namaProduk) return { status: 'error', message: 'Nama Produk wajib diisi' };
    if (isNaN(stok) || stok < 0) return { status: 'error', message: 'Stok harus angka >= 0' };
    if (isNaN(harga) || harga < 0) return { status: 'error', message: 'Harga harus angka >= 0' };
    if (isNaN(hpp) || hpp < 0) return { status: 'error', message: 'HPP harus angka >= 0' };

    var ss = getSpreadsheet();
    var sheet = _ensureProdukHppColumn(ss);
    if (!sheet) return { status: 'error', message: "Sheet Produk tidak ditemukan" };

    var values = sheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      var rowId = String(values[i][0] || '').trim();
      if (rowId && rowId === idProduk) {
        return { status: 'error', message: 'ID Produk sudah ada' };
      }
    }

    sheet.appendRow([idProduk, namaProduk, stok, harga, hpp > 0 ? hpp : '']);
    _invalidateProdukCache();
    return { status: 'success', message: 'Produk berhasil ditambahkan' };
  });
}

function updateProduk(token, idProduk, payload) {
  return _guardToken(function () {
    _verifyToken(token, true);
    payload = payload || {};

    var id = String(idProduk || '').trim();
    if (!id) return { status: 'error', message: 'ID Produk wajib diisi' };

    var namaProduk = payload.namaProduk !== undefined ? String(payload.namaProduk || '').trim() : null;
    var stok = payload.stok !== undefined ? Number(payload.stok || 0) : null;
    var harga = payload.harga !== undefined ? Number(payload.harga || 0) : null;
    var hpp = payload.hpp !== undefined ? Number(payload.hpp || 0) : null;

    if (namaProduk !== null && !namaProduk) return { status: 'error', message: 'Nama Produk wajib diisi' };
    if (stok !== null && (isNaN(stok) || stok < 0)) return { status: 'error', message: 'Stok harus angka >= 0' };
    if (harga !== null && (isNaN(harga) || harga < 0)) return { status: 'error', message: 'Harga harus angka >= 0' };
    if (hpp !== null && (isNaN(hpp) || hpp < 0)) return { status: 'error', message: 'HPP harus angka >= 0' };

    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('Produk');
    if (!sheet) return { status: 'error', message: "Sheet Produk tidak ditemukan" };

    var values = sheet.getDataRange().getValues();
    if (!values || values.length <= 1) {
      return { status: 'error', message: 'ID Produk tidak ditemukan' };
    }

    var header = [];
    for (var h = 0; h < values[0].length; h++) {
      header.push(String(values[0][h] || '').trim());
    }

    var idxId = 0, idxNama = 1, idxStok = 2, idxHarga = 3, idxHpp = header.indexOf('hpp');
    for (var hi = 0; hi < header.length; hi++) {
      var hLow = header[hi].toLowerCase();
      if (hLow === 'id produk' || hLow === 'idproduk' || hLow === 'id_produk' || hLow === 'id') idxId = hi;
      if (hLow === 'nama produk' || hLow === 'namaproduk' || hLow === 'nama_produk' || hLow === 'nama') idxNama = hi;
      if (hLow === 'stok' || hLow === 'stock' || hLow === 'qty' || hLow === 'jumlah') idxStok = hi;
      if (hLow === 'harga') idxHarga = hi;
    }

    for (var i = 1; i < values.length; i++) {
      var rowId = String(values[i][idxId] || '').trim();
      if (rowId === id) {
        var newIdInp = payload.idProduk ? String(payload.idProduk).trim() : '';
        var nextId = newIdInp !== '' ? newIdInp : id;
        var nextNama = namaProduk !== null ? namaProduk : String(values[i][idxNama] || '').trim();
        var nextStok = stok !== null ? stok : Number(values[i][idxStok] || 0);
        var nextHarga = harga !== null ? harga : Number(values[i][idxHarga] || 0);
        var nextHpp = hpp !== null ? hpp : (idxHpp !== -1 ? Number(values[i][idxHpp] || 0) : 0);

        // Tulis semua kolom yang tersentuh dalam SATU setValues (round-trip minimal)
        var touched = [
          { idx: idxId, val: nextId },
          { idx: idxNama, val: nextNama },
          { idx: idxStok, val: nextStok },
          { idx: idxHarga, val: nextHarga }
        ];
        if (idxHpp !== -1) touched.push({ idx: idxHpp, val: nextHpp > 0 ? nextHpp : '' });
        var colMin = Math.min.apply(null, touched.map(function (t) { return t.idx; }));
        var colMax = Math.max.apply(null, touched.map(function (t) { return t.idx; }));
        var rowVals = values[i].slice(colMin, colMax + 1);
        for (var t = 0; t < touched.length; t++) rowVals[touched[t].idx - colMin] = touched[t].val;
        sheet.getRange(i + 1, colMin + 1, 1, colMax - colMin + 1).setValues([rowVals]);

        _invalidateProdukCache();
        return { status: 'success', message: 'Produk berhasil diupdate' };
      }
    }

    return { status: 'error', message: 'ID Produk tidak ditemukan' };
  });
}

function deleteProduk(token, idProduk) {
  return _guardToken(function () {
    _verifyToken(token, true);

    var id = String(idProduk || '').trim();
    if (!id) return { status: 'error', message: 'ID Produk wajib diisi' };

    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('Produk');
    if (!sheet) return { status: 'error', message: "Sheet Produk tidak ditemukan" };

    var values = sheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      var rowId = String(values[i][0] || '').trim();
      if (rowId === id) {
        sheet.deleteRow(i + 1);
        _invalidateProdukCache();
        return { status: 'success', message: 'Produk berhasil dihapus' };
      }
    }

    return { status: 'error', message: 'ID Produk tidak ditemukan' };
  });
}

// ============================================================
// STOK BAHAN BAKU (Botol / Stiker / Sirop)
// Manajemen stok manual: penambahan (restock/belanja) dan pengurangan
// (koreksi rusak/hilang). Sengaja TIDAK terhubung ke transaksi kasir —
// penjualan hanya mengurangi stok Produk jadi, bukan bahan baku ini.
// ============================================================
var STOK_BAHAN_SHEET = 'Stok Bahan';
var STOK_BAHAN_LOG_SHEET = 'Riwayat Stok Bahan';
var BAHAN_DEFAULT_SATUAN = 'pcs';
// Bahan awal hanya di-seed saat sheet masih kosong; setelah itu daftar
// sepenuhnya dikelola lewat CRUD (tambah/ubah/hapus bahan).
var BAHAN_DEFAULTS = ['Botol', 'Stiker', 'Sirop'];

// Pastikan sheet stok & log ada dengan header yang benar. Aman dipanggil
// berulang; sheet yang sudah ada tidak disentuh. Layout lama (tanpa kolom
// Satuan) dimigrasikan sekali on-the-fly.
function _ensureStokBahanSheets(ss) {
  var stokSheet = ss.getSheetByName(STOK_BAHAN_SHEET);
  if (!stokSheet) {
    stokSheet = ss.insertSheet(STOK_BAHAN_SHEET);
    var seed = [['Bahan', 'Satuan', 'Sisa Stok', 'Diupdate']];
    for (var s = 0; s < BAHAN_DEFAULTS.length; s++) seed.push([BAHAN_DEFAULTS[s], BAHAN_DEFAULT_SATUAN, 0, '']);
    stokSheet.getRange(1, 1, seed.length, 4).setValues(seed);
    stokSheet.getRange(1, 1, 1, 4).setFontWeight('bold');
  } else {
    // Migrasi layout lama (Bahan | Sisa Stok | Diupdate) -> + kolom Satuan
    var head = stokSheet.getRange(1, 1, 1, Math.max(3, stokSheet.getLastColumn() || 3)).getValues()[0];
    if (String(head[0]).trim() === 'Bahan' && String(head[1]).trim() === 'Sisa Stok') {
      var old = stokSheet.getDataRange().getValues();
      var rows = [['Bahan', 'Satuan', 'Sisa Stok', 'Diupdate']];
      for (var r = 1; r < old.length; r++) {
        var nm = String(old[r][0] || '').trim();
        if (!nm) continue;
        rows.push([nm, BAHAN_DEFAULT_SATUAN, Number(old[r][1] || 0), String(old[r][2] || '')]);
      }
      if (rows.length === 1) {
        for (var d = 0; d < BAHAN_DEFAULTS.length; d++) rows.push([BAHAN_DEFAULTS[d], BAHAN_DEFAULT_SATUAN, 0, '']);
      }
      stokSheet.getRange(1, 1, rows.length, 4).setValues(rows);
    }
  }
  var logSheet = ss.getSheetByName(STOK_BAHAN_LOG_SHEET);
  if (!logSheet) {
    logSheet = ss.insertSheet(STOK_BAHAN_LOG_SHEET);
    logSheet.getRange(1, 1, 1, 6).setValues([['Timestamp', 'Jenis', 'Bahan', 'Perubahan', 'Sisa', 'Catatan']]);
    logSheet.getRange(1, 1, 1, 6).setFontWeight('bold');
  }
  return { stokSheet: stokSheet, logSheet: logSheet };
}

// Daftar bahan DINAMIS dari sheet -> { status, stok: [{bahan, satuan, sisa, diupdate}] }
function getStokBahan(token) {
  return _guardToken(function () {
    _verifyToken(token, false);
    var ss = getSpreadsheet();
    var sheets = _ensureStokBahanSheets(ss);
    var values = sheets.stokSheet.getDataRange().getValues();

    var stok = [];
    for (var i = 1; i < values.length; i++) {
      var nama = String(values[i][0] || '').trim();
      if (!nama) continue;
      stok.push({
        bahan: nama,
        satuan: String(values[i][1] || BAHAN_DEFAULT_SATUAN).trim() || BAHAN_DEFAULT_SATUAN,
        sisa: Number(values[i][2] || 0),
        diupdate: String(values[i][3] || '')
      });
    }

    return { status: 'success', stok: stok };
  });
}

// Penyesuaian stok manual.
// token   : sesi login (hanya SUPER_ADMIN, konsisten dengan CRUD produk)
// bahan   : nama bahan apa pun yang terdaftar di sheet (dinamis)
// aksi    : 'tambah' (restock/belanja) | 'kurangi' (rusak/hilang/koreksi)
// jumlah  : angka > 0
// catatan : opsional, disimpan di riwayat untuk audit
function adjustStokBahan(token, bahan, aksi, jumlah, catatan) {
  return _guardToken(function () {
    var sess = _verifyToken(token, true);
    bahan = String(bahan || '').trim();
    aksi = String(aksi || '').trim().toLowerCase();
    catatan = String(catatan || '').trim().slice(0, 200);
    jumlah = Number(jumlah);

    if (aksi !== 'tambah' && aksi !== 'kurangi') return { status: 'error', message: 'Aksi harus tambah atau kurangi' };
    if (isNaN(jumlah) || jumlah <= 0) return { status: 'error', message: 'Jumlah harus angka lebih dari 0' };

    var ss = getSpreadsheet();
    var sheets = _ensureStokBahanSheets(ss);
    var values = sheets.stokSheet.getDataRange().getValues();

    var targetRow = -1, sisa = 0, satuan = BAHAN_DEFAULT_SATUAN, matchName = '';
    var daftar = [];
    for (var i = 1; i < values.length; i++) {
      var nm = String(values[i][0] || '').trim();
      if (!nm) continue;
      daftar.push(nm);
      if (nm.toLowerCase() === bahan.toLowerCase()) {
        targetRow = i + 1;
        matchName = nm;
        satuan = String(values[i][1] || BAHAN_DEFAULT_SATUAN).trim() || BAHAN_DEFAULT_SATUAN;
        sisa = Number(values[i][2] || 0);
      }
    }
    if (targetRow === -1) {
      return { status: 'error', message: 'Bahan "' + bahan + '" tidak ditemukan. Pilih: ' + (daftar.join(', ') || '-') };
    }

    var delta = aksi === 'tambah' ? jumlah : -jumlah;
    var sisaBaru = sisa + delta;
    // Stok tidak pernah minus: pengurangan melebihi sisa ditolak
    if (sisaBaru < 0) {
      return { status: 'error', message: 'Pengurangan melebihi sisa stok (' + sisa + ' ' + satuan + '). Maksimal kurang ' + sisa + '.' };
    }

    var now = new Date();
    var stamp = Utilities.formatDate(now, 'Asia/Jakarta', 'yyyy-MM-dd HH:mm');
    sheets.stokSheet.getRange(targetRow, 1, 1, 4).setValues([[matchName, satuan, sisaBaru, stamp]]);

    // Riwayat untuk audit: kapan, apa, berapa, sisa akhir, catatan + user
    sheets.logSheet.appendRow([now, aksi === 'tambah' ? 'TAMBAH' : 'KURANGI', matchName, jumlah, sisaBaru, (catatan ? catatan + ' — ' : '') + String(sess.u || '')]);

    return {
      status: 'success',
      message: 'Stok ' + matchName + (aksi === 'tambah' ? ' berhasil ditambah ' : ' berhasil dikurangi ') + jumlah + ' ' + satuan + '. Sisa: ' + sisaBaru + ' ' + satuan + '.',
      bahan: matchName, satuan: satuan, aksi: aksi, jumlah: jumlah, sisa: sisaBaru
    };
  });
}

// ============================================================
// CRUD BAHAN (tambah / ubah / hapus daftar bahan baku)
// Semua hanya SUPER_ADMIN, konsisten dengan CRUD produk.
// ============================================================
function createBahanBaku(token, payload) {
  return _guardToken(function () {
    var sess = _verifyToken(token, true);
    payload = payload || {};
    var nama = String(payload.nama || '').trim();
    var satuan = String(payload.satuan || '').trim().toLowerCase() || BAHAN_DEFAULT_SATUAN;
    if (!nama) return { status: 'error', message: 'Nama bahan wajib diisi' };
    if (nama.length > 40) return { status: 'error', message: 'Nama bahan maksimal 40 karakter' };
    if (satuan.length > 12) return { status: 'error', message: 'Satuan maksimal 12 karakter' };

    var ss = getSpreadsheet();
    var sheets = _ensureStokBahanSheets(ss);
    var values = sheets.stokSheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0] || '').trim().toLowerCase() === nama.toLowerCase()) {
        return { status: 'error', message: 'Bahan "' + nama + '" sudah terdaftar' };
      }
    }

    var now = new Date();
    sheets.stokSheet.appendRow([nama, satuan, 0, '']);
    sheets.logSheet.appendRow([now, 'BAHAN BARU', nama, 0, 0, 'Bahan ditambahkan ke daftar — ' + String(sess.u || '')]);
    return { status: 'success', message: 'Bahan "' + nama + '" berhasil ditambahkan. Atur sisa stoknya lewat tombol Tambah.', bahan: nama, satuan: satuan };
  });
}

function updateBahanBaku(token, namaLama, payload) {
  return _guardToken(function () {
    var sess = _verifyToken(token, true);
    payload = payload || {};
    namaLama = String(namaLama || '').trim();
    var namaBaru = String(payload.nama || '').trim();
    var satuan = String(payload.satuan || '').trim().toLowerCase() || BAHAN_DEFAULT_SATUAN;
    if (!namaLama) return { status: 'error', message: 'Nama bahan lama tidak boleh kosong' };
    if (!namaBaru) return { status: 'error', message: 'Nama bahan wajib diisi' };
    if (namaBaru.length > 40) return { status: 'error', message: 'Nama bahan maksimal 40 karakter' };
    if (satuan.length > 12) return { status: 'error', message: 'Satuan maksimal 12 karakter' };

    var ss = getSpreadsheet();
    var sheets = _ensureStokBahanSheets(ss);
    var values = sheets.stokSheet.getDataRange().getValues();

    var targetRow = -1, sisa = 0;
    for (var i = 1; i < values.length; i++) {
      var nm = String(values[i][0] || '').trim();
      if (!nm) continue;
      if (nm.toLowerCase() === namaLama.toLowerCase()) {
        targetRow = i + 1;
        sisa = Number(values[i][2] || 0);
      } else if (nm.toLowerCase() === namaBaru.toLowerCase()) {
        return { status: 'error', message: 'Nama "' + namaBaru + '" sudah dipakai bahan lain' };
      }
    }
    if (targetRow === -1) return { status: 'error', message: 'Bahan "' + namaLama + '" tidak ditemukan' };

    // Rename/satuan BUKAN perubahan stok: sisa & kolom Diupdate dipertahankan
    sheets.stokSheet.getRange(targetRow, 1, 1, 2).setValues([[namaBaru, satuan]]);
    sheets.logSheet.appendRow([new Date(), 'UBAH BAHAN', namaBaru, 0, sisa, 'Diubah dari "' + namaLama + '" (satuan: ' + satuan + ') — ' + String(sess.u || '')]);
    return { status: 'success', message: 'Bahan "' + namaLama + '" berhasil diperbarui menjadi "' + namaBaru + '"', bahan: namaBaru, satuan: satuan };
  });
}

function deleteBahanBaku(token, nama) {
  return _guardToken(function () {
    var sess = _verifyToken(token, true);
    nama = String(nama || '').trim();
    if (!nama) return { status: 'error', message: 'Nama bahan wajib diisi' };

    var ss = getSpreadsheet();
    var sheets = _ensureStokBahanSheets(ss);
    var values = sheets.stokSheet.getDataRange().getValues();

    var targetRow = -1, sisa = 0, satuan = BAHAN_DEFAULT_SATUAN;
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0] || '').trim().toLowerCase() === nama.toLowerCase()) {
        targetRow = i + 1;
        satuan = String(values[i][1] || BAHAN_DEFAULT_SATUAN).trim() || BAHAN_DEFAULT_SATUAN;
        sisa = Number(values[i][2] || 0);
        break;
      }
    }
    if (targetRow === -1) return { status: 'error', message: 'Bahan "' + nama + '" tidak ditemukan' };

    sheets.stokSheet.deleteRow(targetRow);
    sheets.logSheet.appendRow([new Date(), 'HAPUS BAHAN', nama, 0, sisa, 'Bahan dihapus dari daftar (sisa terakhir ' + sisa + ' ' + satuan + ') — ' + String(sess.u || '')]);
    return { status: 'success', message: 'Bahan "' + nama + '" berhasil dihapus. Riwayat penyesuaian tetap tersimpan.', bahan: nama };
  });
}

// Baris log terakhir (untuk baris "riwayat penyesuaian terakhir" di dashboard)
function getLastStokBahanLog(token) {
  return _guardToken(function () {
    _verifyToken(token, false);
    var ss = getSpreadsheet();
    var logSheet = ss.getSheetByName(STOK_BAHAN_LOG_SHEET);
    if (!logSheet) return { status: 'success', last: '' };
    var lastRow = logSheet.getLastRow();
    if (lastRow < 2) return { status: 'success', last: '' };
    var row = logSheet.getRange(lastRow, 1, 1, 6).getValues()[0];
    var stamp = row[0] instanceof Date
      ? Utilities.formatDate(row[0], 'Asia/Jakarta', 'dd MMM HH:mm')
      : String(row[0] || '');
    var last = (String(row[1] || '') + ' ' + String(row[3] || '') + ' ' + String(row[2] || '') +
      ' → sisa ' + String(row[4] || '') +
      (String(row[5] || '') ? ' — ' + String(row[5]) : '') +
      ' • ' + stamp);
    return { status: 'success', last: last };
  });
}

// ============================================================
// CREDIT/DEBIT
// ============================================================
function addCreditDebit(token, type, data) {
  return _guardToken(function () {
    _verifyToken(token, true);
    data = data || {};

    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('Credit/Debit');
    if (!sheet) {
      return { status: 'error', message: "Sheet CreditDebit tidak ditemukan" };
    }

    var tipeVal = String(type || data.tipe || '').trim().toUpperCase();
    if (tipeVal !== 'CREDIT' && tipeVal !== 'DEBIT') {
      return { status: 'error', message: "Type harus CREDIT atau DEBIT" };
    }
    var tanggal = data.tanggal ? new Date(data.tanggal + 'T00:00:00') : new Date();
    var kategori = String(data.kategori || '').trim();
    var deskripsi = String(data.deskripsi || '').trim();
    var metodePembayaran = String(data.metodePembayaran || data.paymentMethod || 'Cash').trim();
    var nominal = Number(data.nominal || 0);

    if (!kategori) return { status: 'error', message: 'Kategori wajib diisi' };
    if (!deskripsi) return { status: 'error', message: 'Deskripsi wajib diisi' };
    if (isNaN(nominal) || nominal <= 0) return { status: 'error', message: 'Nominal harus angka > 0' };

    var paymentMethod = metodePembayaran.toUpperCase();
    if (paymentMethod === 'QRIS' || paymentMethod === 'QR' || paymentMethod === 'TRANSFER') {
      paymentMethod = 'QRIS';
    } else {
      paymentMethod = 'Cash';
    }

    sheet.appendRow([tanggal, tipeVal, kategori, deskripsi, paymentMethod, nominal]);

    return { status: 'success', message: 'Catatan keuangan berhasil disimpan' };
  });
}

function _readCreditDebitItems(ss, startDate, endDate) {
  var sheet = ss.getSheetByName('Credit/Debit');
  if (!sheet) return [];

  var values = sheet.getDataRange().getValues();
  var startKey = _normDateKey(startDate);
  var endKey = _normDateKey(endDate);
  var items = [];

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var rowKey = _parseSheetDateKey(row[0]);
    if (!rowKey) continue;

    if (startKey && rowKey < startKey) continue;
    if (endKey && rowKey > endKey) continue;

    items.push({
      tanggal: rowKey,
      tipe: String(row[1] || ''),
      kategori: String(row[2] || ''),
      deskripsi: String(row[3] || ''),
      metodePembayaran: String(row[4] || ''),
      nominal: Number(row[5] || 0)
    });
  }

  return items;
}

function getCreditDebitByRange(token, startDate, endDate) {
  return _guardToken(function () {
    _verifyToken(token, false);
    var ss = getSpreadsheet();
    var items = _readCreditDebitItems(ss, startDate, endDate);
    return { status: 'success', data: items };
  });
}

// ============================================================
// SETUP HELPER
// ============================================================
function setupDashboard() {
  initSheets();
  Logger.log('Dashboard setup complete untuk ENV: ' + ACTIVE_ENV);
}