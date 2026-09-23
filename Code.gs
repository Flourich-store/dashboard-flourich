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

// Dipakai sebagai estimasi hanya jika belum ada data CREDIT pada periode laporan.
// Ubah menjadi 0 jika seluruh biaya operasional sudah dicatat di sheet Credit/Debit.
var BIAYA_OPERASIONAL_PERSEN = 10;

// ============================================================
// HPP RATES
// ============================================================
var HPP_RATES = {
  DEFAULT: { 250: 7000, 350: 8000, 500: 12000 },
  WNA: { 250: 8500, 350: 11700, 500: 17000 }
};

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

function getHppRate(namaProduk, volume) {
  var nama = String(namaProduk || '').toUpperCase();
  var isWNA = nama.indexOf('WNA') !== -1 || nama.indexOf('WORTEL NANAS APEL') !== -1;
  var rates = isWNA ? HPP_RATES.WNA : HPP_RATES.DEFAULT;
  var volNum = Number(volume || 250);
  return rates[volNum] || (isWNA ? 8500 : 7000);
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

// ============================================================
// REPORT BY DATE RANGE
// ============================================================
function getReportByDateRange(token, startDate, endDate) {
  return _guardToken(function () {
    _verifyToken(token, false);
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('Penjualan');
    if (!sheet) {
        return { status: 'success', data: [], totalTransaksi: 0, omsetKotor: 0, prevOmsetKotor: 0, prevRange: null, labaKotor: 0, labaBersih: 0 };
    }

    var values = sheet.getDataRange().getValues();

    // Auto-detect column indices from header
    var header = values[0] || [];
    var headerLower = header.map(function(h) { return String(h || '').toLowerCase(); });

    var idxTx = -1, idxTgl = -1, idxProduk = -1, idxJumlah = -1, idxHarga = -1;
    var idxTotalHarga = -1, idxMetode = -1, idxHPP = -1, idxLaba = -1, idxVolume = -1;

    for (var hIdx = 0; hIdx < headerLower.length; hIdx++) {
      var h = headerLower[hIdx];
      if (h.includes('id') && h.includes('transaksi')) idxTx = hIdx;
      if (h.includes('tanggal')) idxTgl = hIdx;
      if (h.includes('produk') || h.includes('nama produk')) idxProduk = hIdx;
      if (h.includes('jumlah') && !h.includes('kembali')) idxJumlah = hIdx;
      if (h.includes('harga satuan') || (h.includes('harga') && !h.includes('total'))) idxHarga = hIdx;
      if (h.includes('total') && h.includes('harga')) idxTotalHarga = hIdx;
      if (h.includes('metode') || h.includes('pembayaran')) idxMetode = hIdx;
      if (h.includes('hpp') || h.includes('modal') || h.includes('biaya')) idxHPP = hIdx;
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
    var prevStartKey = '', prevEndKey = '', prevGrossTotal = 0;
    if (startKey && endKey && startKey <= endKey) {
      var durDays = _diffDaysKey(startKey, endKey) + 1;
      prevStartKey = _shiftDateKey(startKey, -durDays);
      prevEndKey = _shiftDateKey(endKey, -durDays);
    }

    var productMap = {}, chartMap = { 'Cash': 0, 'QRIS': 0 }, detailData = [];
    var txCount = 0, grossTotal = 0, totalHPP = 0;

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

      if (!idTx || !namaProduk) continue;

      var rowKey = _parseSheetDateKey(tanggalCell);
      if (!rowKey) continue;
      if (startKey && rowKey < startKey) {
        // Baris sebelum periode terpilih tapi masuk periode pembanding
        // tetap dihitung omsetnya untuk badge naik/turun di hero.
        if (prevStartKey && rowKey >= prevStartKey && rowKey <= prevEndKey) {
          prevGrossTotal += totalHarga;
        }
        continue;
      }
      if (endKey && rowKey > endKey) continue;

      txCount++;
      grossTotal += totalHarga;
      totalHPP += rowHPP > 0 ? rowHPP : getHppRate(namaProduk, row[idxVolume]) * jumlah;

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

    // Hitung Credit (Pengeluaran) dan Debit (Pemasukan Tambahan)
    var totalExpenses = 0;
    var totalIncomeOther = 0;
    try {
      var cdItems = _readCreditDebitItems(ss, startDate, endDate);
      for (var c = 0; c < cdItems.length; c++) {
        var it = cdItems[c];
        var tipeUpper = String(it.tipe || '').toUpperCase();
        if (tipeUpper === 'CREDIT') {
          totalExpenses += Number(it.nominal || 0);
        } else if (tipeUpper === 'DEBIT') {
          totalIncomeOther += Number(it.nominal || 0);
        }
      }
    } catch (e) {
      Logger.log('ERROR hitung credit/debit: ' + e.toString());
    }

    var grossProfit = grossTotal - totalHPP;
    var biayaOperasional = totalExpenses;
    if (biayaOperasional <= 0 && BIAYA_OPERASIONAL_PERSEN > 0) {
      biayaOperasional = Math.max(grossProfit, 0) * BIAYA_OPERASIONAL_PERSEN / 100;
    }
    var netTotal = grossProfit + totalIncomeOther - biayaOperasional;
    var topProduct = topProducts[0] || null;

    return {
      status: 'success',
      data: detailData,
      totalTransaksi: txCount,
      omsetKotor: grossTotal,
      prevOmsetKotor: prevGrossTotal,
      prevRange: (prevStartKey && prevEndKey) ? { start: prevStartKey, end: prevEndKey } : null,
      totalHPP: totalHPP,
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
    var hpp = getHppRate(namaProduk, volume);
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

    // Susunan kolom mengikuti skema sheet aplikasi POS (11 kolom):
    // ID Transaksi | Tanggal | Nama Produk | Jumlah | Total Harga | Metode Pembayaran |
    // Uang Dibayar | Uang Kembali | Modal | Biaya Operasional | Laba bersih
    sheet.appendRow([idTx, tanggal, namaProduk, jumlah, totalHarga, metodePos, totalHarga, 0, totalHPP, 0, laba]);

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
// Cache daftar produk dalam satu eksekusi script: getProdukList bisa
// dipanggil beberapa kali per sesi (load awal + buka modal), dan setiap
// pemanggilan tadinya membaca ulang seluruh sheet dari Sheets API.
var __produkCache = null;

function _invalidateProdukCache() {
  __produkCache = null;
}

function getProdukList(token) {
  return _guardToken(function () {
    _verifyToken(token, false);
    if (__produkCache) return { status: 'success', products: __produkCache, cached: true };

    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('Produk');
    if (!sheet) return { status: 'error', message: "Sheet Produk tidak ditemukan" };

    var values = sheet.getDataRange().getValues();
    if (!values || values.length <= 1) { __produkCache = []; return { status: 'success', products: [] }; }

    var header = [];
    for (var h = 0; h < values[0].length; h++) {
      header.push(String(values[0][h] || '').trim());
    }

    var idxId = 0, idxNama = 1, idxStok = 2, idxHarga = 3;
    for (var hi = 0; hi < header.length; hi++) {
      var hLow = header[hi].toLowerCase();
      if (hLow === 'id produk' || hLow === 'idproduk' || hLow === 'id_produk' || hLow === 'id') idxId = hi;
      if (hLow === 'nama produk' || hLow === 'namaproduk' || hLow === 'nama_produk' || hLow === 'nama') idxNama = hi;
      if (hLow === 'stok' || hLow === 'stock' || hLow === 'qty' || hLow === 'jumlah') idxStok = hi;
      if (hLow === 'harga') idxHarga = hi;
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
        harga: Number(row[idxHarga] || 0)
      });
    }

    __produkCache = products;
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

    if (!idProduk) return { status: 'error', message: 'ID Produk wajib diisi' };
    if (!namaProduk) return { status: 'error', message: 'Nama Produk wajib diisi' };
    if (isNaN(stok) || stok < 0) return { status: 'error', message: 'Stok harus angka >= 0' };
    if (isNaN(harga) || harga < 0) return { status: 'error', message: 'Harga harus angka >= 0' };

    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('Produk');
    if (!sheet) return { status: 'error', message: "Sheet Produk tidak ditemukan" };

    var values = sheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      var rowId = String(values[i][0] || '').trim();
      if (rowId && rowId === idProduk) {
        return { status: 'error', message: 'ID Produk sudah ada' };
      }
    }

    sheet.appendRow([idProduk, namaProduk, stok, harga]);
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

    if (namaProduk !== null && !namaProduk) return { status: 'error', message: 'Nama Produk wajib diisi' };
    if (stok !== null && (isNaN(stok) || stok < 0)) return { status: 'error', message: 'Stok harus angka >= 0' };
    if (harga !== null && (isNaN(harga) || harga < 0)) return { status: 'error', message: 'Harga harus angka >= 0' };

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

    var idxId = 0, idxNama = 1, idxStok = 2, idxHarga = 3;
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

        // Satu tulisan untuk 4 kolom (sebelumnya 4x setValue = 4 round-trip ke Sheets API)
        var colMin = Math.min(idxId, idxNama, idxStok, idxHarga);
        var colMax = Math.max(idxId, idxNama, idxStok, idxHarga);
        var rowVals = values[i].slice(colMin, colMax + 1);
        rowVals[idxId - colMin] = nextId;
        rowVals[idxNama - colMin] = nextNama;
        rowVals[idxStok - colMin] = nextStok;
        rowVals[idxHarga - colMin] = nextHarga;
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
    if (!deskripsi) return { status: 'deskripsi wajib diisi' };
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