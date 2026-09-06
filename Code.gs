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

function getSpreadsheet() {
  try {
    var sheetId = getActiveSheetId();
    Logger.log('DEBUG getSpreadsheet: Opening sheet ' + sheetId);
    var ss = SpreadsheetApp.openById(sheetId);
    Logger.log('DEBUG getSpreadsheet: Sheet opened successfully');
    return ss;
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
function checkLogin(username, password){
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('User');

    if (!sheet){
      // Fallback
      if (username === "admin" && password === "admin123") {
        return { status: "success", username: "admin", role: "SUPER_ADMIN", env: ACTIVE_ENV };
}
      return { status: "error", message: "Users sheet not found" };
    }

    var values = sheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++){
      var row = values[i];
      var u = String(row[0] || '').trim();
      var p = String(row[1] || '').trim();
      var r = String(row[2] || 'KASIR').trim().toUpperCase();
      if (u.toLowerCase() === String(username || '').trim().toLowerCase() && p === password){
        return { status: "success", username: u, role: r, env: ACTIVE_ENV };
      }
    }
    return { status: "error", message: "Username atau password salah" };
  } catch (e) {
    return { status: "error", message: e.toString() };
  }
}

function _requireSuperAdmin(role) {
  if (String(role || '').toUpperCase() !== 'SUPER_ADMIN') {
    throw new Error('Akses ditolak. Hanya SUPER_ADMIN yang boleh mengubah data.');
  }
}

// ============================================================
// REPORT BY DATE RANGE
// ============================================================
function getReportByDateRange(startDate, endDate) {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('Penjualan');
    if (!sheet) {
      return { status: 'success', data: [], totalTransaksi: 0, omsetKotor: 0, labaKotor: 0, labaBersih: 0 };
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

    var start = startDate ? new Date(startDate + 'T00:00:00') : null;
    var end = endDate ? new Date(endDate + 'T23:59:59') : null;

    // Inisialisasi variabel di satu tempat
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

      var rowDate = new Date(tanggalCell);
      if (isNaN(rowDate.getTime())) continue;
      if (start && rowDate < start) continue;
      if (end && rowDate > end) continue;

      txCount++;
      grossTotal += totalHarga;
      totalHPP += rowHPP > 0 ? rowHPP : getHppRate(namaProduk, row[idxVolume]) * jumlah;

      detailData.push({
        tanggal: Utilities.formatDate(rowDate, 'Asia/Jakarta', 'yyyy-MM-dd'),
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
  } catch (e) {
    Logger.log('ERROR di getReportByDateRange: ' + e.toString());
    Logger.log('ERROR Stack: ' + e.stack);
    return { status: 'error', message: 'Error: ' + e.toString() };
  }
}

// ============================================================
// ADD PENJUALAN
// ============================================================
function addPenjualan(data) {
  try {
    data = data || {};
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('Penjualan');
    if (!sheet) return { status: 'error', message: "Sheet Penjualan tidak ditemukan" };

    var tanggal = data.tanggal ? new Date(data.tanggal + 'T00:00:00') : new Date();
    var namaProduk = String(data.namaProduk || '').trim();
    var harga = Number(data.harga || 0);
    var jumlah = Number(data.jumlah || 1);
    var volume = Number(data.volume || 250);
    var metode = String(data.metode || 'Cash').trim();

    if (!namaProduk) return { status: 'error', message: 'Nama produk wajib diisi' };
    if (harga <= 0) return { status: 'error', message: 'Harga harus lebih dari 0' };
    if (jumlah <= 0) return { status: 'error', message: 'Jumlah harus lebih dari 0' };

    var totalHarga = harga * jumlah;
    var hpp = getHppRate(namaProduk, volume);
    var totalHPP = hpp * jumlah;
    var laba = totalHarga - totalHPP;

    var now = new Date();
    var idTx = 'TX' + Utilities.formatDate(now, 'Asia/Jakarta', 'yyyyMMddHHmmss') + Math.floor(Math.random() * 1000);

    sheet.appendRow([idTx, tanggal, namaProduk, volume, jumlah, harga, totalHarga, metode, totalHPP, laba]);
    var lastRow = sheet.getLastRow();
    var cell = sheet.getRange(lastRow, 10); // 10 adalah kolom J (Laba)
    cell.setFormula("=G" + lastRow + "-I" + lastRow); // Rumus: Total Harga - HPP

    // Update stock
    try {
      updateStock(namaProduk, jumlah);
    } catch (stockErr) {
      Logger.log('Stock update warning: ' + stockErr);
    }

    return { status: 'success', message: 'Penjualan berhasil disimpan', idTx: idTx };
  } catch (e) {
    Logger.log('addPenjualan error: ' + e);
    return { status: 'error', message: e.toString() };
  }
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
      break;
    }
  }
}

// ============================================================
// PRODUK CRUD
// ============================================================
function getProdukList() {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('Produk');
    if (!sheet) return { status: 'error', message: "Sheet Produk tidak ditemukan" };

    var values = sheet.getDataRange().getValues();
    if (!values || values.length <= 1) return { status: 'success', products: [] };

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

    return { status: 'success', products: products };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function createProduk(payload) {
  try {
    payload = payload || {};
    var role = String(payload.role || '').toUpperCase();
    _requireSuperAdmin(role);

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
    return { status: 'success', message: 'Produk berhasil ditambahkan' };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function updateProduk(idProduk, payload) {
  try {
    payload = payload || {};
    var role = String(payload.role || '').toUpperCase();
    _requireSuperAdmin(role);

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

        sheet.getRange(i + 1, idxId + 1).setValue(nextId);
        sheet.getRange(i + 1, idxNama + 1).setValue(nextNama);
        sheet.getRange(i + 1, idxStok + 1).setValue(nextStok);
        sheet.getRange(i + 1, idxHarga + 1).setValue(nextHarga);

        return { status: 'success', message: 'Produk berhasil diupdate' };
      }
    }

    return { status: 'error', message: 'ID Produk tidak ditemukan' };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

function deleteProduk(idProduk, role) {
  try {
    _requireSuperAdmin(String(role || '').toUpperCase());

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
        return { status: 'success', message: 'Produk berhasil dihapus' };
      }
    }

    return { status: 'error', message: 'ID Produk tidak ditemukan' };
  } catch (e) {
    return { status: 'error', message: e.toString() };
  }
}

// ============================================================
// CREDIT/DEBIT
// ============================================================
function addCreditDebit(type, data) {
  try {
    data = data || {};
    var role = String(data.role || '').toUpperCase();
    _requireSuperAdmin(role);

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
  } catch (e) {
    Logger.log('addCreditDebit error: ' + e);
    return { status: 'error', message: e.toString() };
  }
}

function _readCreditDebitItems(ss, startDate, endDate) {
  var sheet = ss.getSheetByName('Credit/Debit');
  if (!sheet) return [];

  var values = sheet.getDataRange().getValues();
  var start = startDate ? new Date(startDate + 'T00:00:00') : null;
  var end = endDate ? new Date(endDate + 'T23:59:59') : null;
  var items = [];

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var rowDate = new Date(row[0]);
    if (isNaN(rowDate.getTime())) continue;
    rowDate.setHours(0, 0, 0, 0);

    if (start && rowDate < start) continue;
    if (end && rowDate > end) continue;

    items.push({
      tanggal: Utilities.formatDate(rowDate, 'Asia/Jakarta', 'yyyy-MM-dd'),
      tipe: String(row[1] || ''),
      kategori: String(row[2] || ''),
      deskripsi: String(row[3] || ''),
      metodePembayaran: String(row[4] || ''),
      nominal: Number(row[5] || 0)
    });
  }

  return items;
}

function getCreditDebitByRange(startDate, endDate) {
  try {
    var ss = getSpreadsheet();
    var items = _readCreditDebitItems(ss, startDate, endDate);
    return { status: 'success', data: items };
  } catch (e) {
    Logger.log('ERROR getCreditDebitByRange: ' + e.toString());
    return { status: 'error', message: e.toString() };
  }
}

// ============================================================
// SETUP HELPER
// ============================================================
function setupDashboard() {
  initSheets();
  Logger.log('Dashboard setup complete untuk ENV: ' + ACTIVE_ENV);
}