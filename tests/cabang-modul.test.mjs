// Tes regresi: filter cabang untuk SEMUA modul (bukan hanya laporan).
//
// Yang dikunci:
//   1. getCreditDebitByRange menyaring catatan Credit/Debit per cabang.
//   2. KPI Credit/Debit ikut tersaring lewat getReportByDateRange.
//   3. getProdukList menyaring produk + Nilai Stok per cabang (cache terpisah).
//   4. getNilaiStok menyaring nilai stok per cabang.
//   5. Role ADMIN/OWNER boleh memilih cabang; KASIR tetap terkunci token.
//   6. Sheet tanpa kolom Cabang tidak difilter (data tidak hilang).
//
//   node tests/cabang-modul.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import { targetGas, targetHtml } from './lib/jalur.mjs';

const target = targetGas();

function buatSheet(nama, baris) {
  return {
    _nama: nama,
    _d: baris,
    getName() { return this._nama; },
    getLastRow() { return this._d.length; },
    getLastColumn() { return this._d.reduce((m, r) => Math.max(m, r.length), 0); },
    getDataRange() { const s = this; return { getValues() { return s._d.map((r) => r.slice()); } }; },
    appendRow(r) { this._d.push(r.slice()); },
    getRange(r, c, nR, nC) {
      const s = this;
      nR = nR === undefined ? 1 : nR;
      nC = nC === undefined ? 1 : nC;
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < nR; i++) {
            const row = [];
            for (let j = 0; j < nC; j++) row.push(s._d[r - 1 + i] ? s._d[r - 1 + i][c - 1 + j] : '');
            out.push(row);
          }
          return out;
        },
        setValue(v) { if (!s._d[r - 1]) s._d[r - 1] = []; s._d[r - 1][c - 1] = v; return this; },
        getValue() { const v = this.getValues(); return v[0] ? v[0][0] : ''; },
        setFontWeight() { return this; }
      };
    }
  };
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(target, 'utf8'), ctx, { filename: 'Code.gs' });
const SDate = vm.runInContext('Date', ctx);
ctx.Logger = { log() {} };
ctx.Utilities = {
  formatDate(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
};

const SESI = {
  kasirA: { u: 'nina', r: 'KASIR', c: 'Cabang A' },
  admin: { u: 'manajer', r: 'ADMIN', c: '' },
  superadmin: { u: 'owner', r: 'SUPER_ADMIN', c: '' }
};
ctx._verifyToken = (token) => {
  const s = SESI[String(token || '')];
  if (!s) throw new Error('Unauthorized');
  return s;
};

// --- Sheet Penjualan (punya kolom Cabang) ---
const HEADER_PJ = [
  'ID Transaksi', 'Tanggal', 'Nama Produk', 'Volume (ml)', 'HPP Satuan', 'Jumlah',
  'Total Harga', 'Metode Pembayaran', 'Uang Dibayar', 'Uang Kembali', 'Modal',
  'Biaya Operasional', 'Laba bersih', 'Cabang'
];
const penjualan = buatSheet('Penjualan', [
  HEADER_PJ.slice(),
  ['FR-A1', new SDate(2026, 9, 1), 'Semangka Leci 350 ml', 350, 8000, 1, 10000, 'CASH', 10000, 0, 8000, 0, 2000, 'Cabang A'],
  ['FR-B1', new SDate(2026, 9, 2), 'Semangka Leci 350 ml', 350, 8000, 1, 20000, 'CASH', 20000, 0, 8000, 0, 12000, 'Cabang B']
]);

// --- Sheet Credit/Debit (punya kolom Cabang) ---
const HEADER_CD = ['Tanggal', 'Tipe', 'Kategori', 'Deskripsi', 'Metode', 'Nominal', 'Jenis', 'Cabang'];
const cd = buatSheet('Credit/Debit', [
  HEADER_CD.slice(),
  [new SDate(2026, 9, 1), 'CREDIT', 'OPERASIONAL', 'Listrik A', 'CASH', 1000, 'BIAYA_OPERASIONAL', 'Cabang A'],
  [new SDate(2026, 9, 2), 'CREDIT', 'OPERASIONAL', 'Listrik B', 'CASH', 2000, 'BIAYA_OPERASIONAL', 'Cabang B'],
  [new SDate(2026, 9, 3), 'CREDIT', 'OPERASIONAL', 'Listrik tanpa cabang', 'CASH', 4000, 'BIAYA_OPERASIONAL', '']
]);

// --- Sheet Produk (punya kolom Cabang) ---
const produk = buatSheet('Produk', [
  ['ID Produk', 'Nama Produk', 'Stok', 'Harga', 'HPP', 'Cabang'],
  ['P1', 'Semangka Leci 350 ml', 10, 14000, 8000, 'Cabang A'],
  ['P2', 'Semangka Leci 350 ml', 5, 14000, 8000, 'Cabang B'],
  ['P3', 'Melon 250 ml', 7, 12000, 6000, 'Cabang B']
]);

const user = buatSheet('User', [
  ['username', 'password', 'role', 'cabang'],
  ['nina', 'x', 'KASIR', 'Cabang A']
]);

const ss = {
  getSheetByName(n) {
    if (n === 'Penjualan') return penjualan;
    if (n === 'Credit/Debit') return cd;
    if (n === 'Produk') return produk;
    if (n === 'User') return user;
    return null;
  }
};
ctx.getSpreadsheet = () => ss;

let lulus = 0;
const gagal = [];
function uji(nama, fn) {
  try { fn(); lulus++; console.log('  LULUS  ' + nama); }
  catch (e) { gagal.push(nama); console.log('  GAGAL  ' + nama + ' -> ' + e.message); }
}
function eq(a, b, label) {
  if (a !== b) throw new Error((label || '') + ' harap ' + JSON.stringify(b) + ' tapi dapat ' + JSON.stringify(a));
}
function jumlahNominal(items) { return (items || []).reduce((a, x) => a + Number(x.nominal || 0), 0); }

// 1. Credit/Debit per cabang (kasir)
uji('MOD-1: Credit/Debit kasir hanya cabangnya', () => {
  const res = ctx.getCreditDebitByRange('kasirA', '', '', '');
  eq(res.status, 'success', 'status ');
  eq(jumlahNominal(res.data), 1000, 'nominal ');
  eq(res.data.length, 1, 'baris ');
});

// 2. Credit/Debit admin: semua dan cabang tertentu
uji('MOD-2: Credit/Debit ADMIN semua vs cabang B', () => {
  eq(jumlahNominal(ctx.getCreditDebitByRange('admin', '', '', '').data), 7000, 'semua cabang ');
  const b = ctx.getCreditDebitByRange('admin', '', '', 'Cabang B').data;
  eq(jumlahNominal(b), 2000, 'cabang B ');
  eq(b.length, 1, 'baris cabang B ');
});

// 3. KPI di laporan ikut cabang (biaya operasional tersaring)
uji('MOD-3: KPI laporan memakai biaya operasional per cabang', () => {
  const a = ctx.getReportByDateRange('kasirA', '', '', '');
  eq(a.totalBiayaOperasional, 1000, 'biaya cabang A ');
  const semua = ctx.getReportByDateRange('admin', '', '', '');
  eq(semua.totalBiayaOperasional, 7000, 'biaya semua cabang ');
});

// 4. Produk & nilai stok per cabang
uji('MOD-4: getProdukList menyaring produk + nilai stok per cabang', () => {
  const a = ctx.getProdukList('kasirA', '');
  eq(a.products.length, 1, 'jumlah produk cabang A ');
  eq(a.products[0].idProduk, 'P1', 'produk cabang A ');
  eq(a.nilaiStok, 10 * 8000, 'nilai stok cabang A ');

  const admin = ctx.getProdukList('admin', 'Cabang B');
  eq(admin.products.length, 2, 'jumlah produk cabang B ');
  eq(admin.nilaiStok, 5 * 8000 + 7 * 6000, 'nilai stok cabang B ');
});

// 5. Cache tidak bocor antar cabang
uji('MOD-5: cache produk terpisah per cabang', () => {
  const a = ctx.getProdukList('kasirA', '');
  const b = ctx.getProdukList('admin', 'Cabang B');
  const aLagi = ctx.getProdukList('kasirA', '');
  eq(a.products.length, 1, 'kasir A ');
  eq(b.products.length, 2, 'admin B ');
  eq(aLagi.products.length, 1, 'kasir A setelah cache admin ');
});

// 6. getNilaiStok per cabang
uji('MOD-6: getNilaiStok per cabang', () => {
  eq(ctx.getNilaiStok('kasirA', '').nilaiStok, 80000, 'cabang A ');
  eq(ctx.getNilaiStok('admin', 'Cabang B').nilaiStok, 82000, 'cabang B ');
  eq(ctx.getNilaiStok('admin', '').nilaiStok, 162000, 'semua cabang ');
});

// 7. Role ADMIN boleh memilih cabang, KASIR tidak
uji('MOD-7: ADMIN pilih cabang, KASIR tetap token', () => {
  eq(ctx.getReportByDateRange('admin', '', '', 'Cabang A').omsetKotor, 10000, 'admin pilih A ');
  eq(ctx.getReportByDateRange('kasirA', '', '', 'Cabang B').omsetKotor, 10000, 'kasir tetap A ');
});

// 8. Sheet tanpa kolom Cabang: tidak difilter (data tidak hilang)
uji('MOD-8: sheet tanpa kolom Cabang tidak difilter', () => {
  const cdTanpa = buatSheet('Credit/Debit', [
    HEADER_CD.slice(0, 7),
    [new SDate(2026, 9, 1), 'CREDIT', 'OPERASIONAL', 'Listrik', 'CASH', 5000, 'BIAYA_OPERASIONAL'],
    [new SDate(2026, 9, 2), 'CREDIT', 'OPERASIONAL', 'Air', 'CASH', 3000, 'BIAYA_OPERASIONAL']
  ]);
  const asli = ctx.getSpreadsheet;
  ctx.getSpreadsheet = () => ({ getSheetByName: (n) => (n === 'Credit/Debit' ? cdTanpa : ss.getSheetByName(n)) });
  try {
    eq(jumlahNominal(ctx.getCreditDebitByRange('kasirA', '', '', '').data), 8000, 'nominal ');
  } finally {
    ctx.getSpreadsheet = asli;
  }
});

// 9. getDaftarCabang melaporkan ada/tidaknya kolom Cabang di Penjualan
uji('MOD-9: getDaftarCabang melaporkan punyaKolomCabangPenjualan', () => {
  const res = ctx.getDaftarCabang('admin');
  eq(res.punyaKolomCabangPenjualan, true, 'flag kolom ');
  eq(JSON.stringify(res.daftar), JSON.stringify(['Cabang A', 'Cabang B']), 'daftar ');
});

// ---------- 10-12: pemeriksaan statis UI dashboard ----------
// Bagian ini menjaga dua perbaikan UI: ganti cabang harus membuang angka
// cabang lama di semua tab, dan login tidak boleh menunggu animasi 200 ms.
const html = fs.readFileSync(targetHtml(), 'utf8');
const badanFungsi = (nama) => {
  const mulai = html.indexOf('function ' + nama + '(');
  if (mulai === -1) throw new Error('fungsi ' + nama + ' tidak ada');
  // Ambil sampai kira-kira fungsi berikutnya (cukup untuk pemeriksaan teks).
  const BARIS = String.fromCharCode(10);
  const potong = html.indexOf(BARIS + '    function ', mulai + 10);
  return html.slice(mulai, potong === -1 ? undefined : potong);
};

uji('MOD-10: tiap modul punya filter cabang sendiri, header tidak', () => {
  // Pemilih cabang harus ada di dalam modulnya, bukan di header.
  ['cabangOverview', 'cabangPenjualan', 'cabangChart', 'cabangCatatan', 'cabangProduk'].forEach((id) => {
    if (!html.includes('id="' + id + '"')) throw new Error('select modul hilang: ' + id);
  });
  if (html.includes('id="cabangSelect"')) throw new Error('select cabang di header masih ada');
  if (html.includes('function gantiCabang(')) throw new Error('gantiCabang lama masih ada');
  if (!html.includes('function gantiCabangModul(')) throw new Error('gantiCabangModul tidak ada');
  // Tiap modul mengirim cabangnya sendiri ke server.
  [['overview', 'loadReport'], ['penjualan', 'loadSalesByDateRange'], ['chart', 'loadChartByDateRange'], ['catatan', 'loadCreditDebit']]
    .forEach(([modul, fn]) => {
      const badan = badanFungsi(fn);
      if (!badan.includes("getCabangFilterModul('" + modul + "')")) throw new Error(fn + ' belum memakai filter ' + modul);
    });
  ['loadProduk', 'loadProdukCRUD', 'loadNilaiStok'].forEach((fn) => {
    if (!badanFungsi(fn).includes("getCabangFilterModul('produk')")) throw new Error(fn + ' belum memakai filter produk');
  });
});

uji('MOD-13: ganti cabang satu modul hanya memuat ulang modul itu', () => {
  const g = badanFungsi('gantiCabangModul');
  ['overview', 'penjualan', 'chart', 'catatan', 'produk'].forEach((m) => {
    if (!g.includes("'" + m + "'")) throw new Error('cabang modul tidak ditangani: ' + m);
  });
  if (!g.includes('batalkanCacheLaporan()')) throw new Error('cache laporan tidak dibuang');
  // Cache laporan harus sadar cabang supaya angka cabang lain tidak dipakai.
  if (!html.includes('reportCache.cabang')) throw new Error('cache laporan belum sadar cabang');
});

uji('MOD-11: login menampilkan dashboard tanpa jeda 200 ms', () => {
  const tr = badanFungsi('transitionToDashboard');
  const posisiTampil = tr.indexOf('showDashboard()');
  const posisiTunda = tr.indexOf('setTimeout');
  if (posisiTampil === -1) throw new Error('showDashboard tidak dipanggil');
  if (posisiTunda !== -1 && posisiTunda < posisiTampil) throw new Error('showDashboard masih ditunda setTimeout');
});

uji('MOD-12: pekerjaan berat setelah login ditunda ke frame berikutnya', () => {
  const init = badanFungsi('initDashboardData');
  if (!init.includes('requestAnimationFrame')) throw new Error('tidak memakai requestAnimationFrame');
  [['preloadCharts()', 'preloadCharts'], ['jadwalkanPrefetchProdukBahan()', 'prefetch produk/bahan']]
    .forEach(([kunci, label]) => { if (!init.includes(kunci)) throw new Error('hilang: ' + label); });
  // Laporan tetap diminta langsung, bukan ditunda.
  if (init.indexOf('loadReport(true)') === -1) throw new Error('loadReport(true) tidak dipanggil');
});

// ---------- 14. Gabungan cabang dari semua sheet terkait ----------
uji('MOD-14: daftar cabang digabung dari Produk + Credit/Debit + User', () => {
  // Penjualan sengaja TIDAK punya kolom Cabang.
  const pjTanpaCabang = buatSheet('Penjualan', [
    HEADER_PJ.slice(0, 13),
    ['FR-X1', new SDate(2026, 9, 1), 'Semangka Leci 350 ml', 350, 8000, 1, 10000, 'CASH', 10000, 0, 8000, 0, 2000]
  ]);
  const cdB = buatSheet('Credit/Debit', [
    HEADER_CD.slice(),
    [new SDate(2026, 9, 1), 'CREDIT', 'OPERASIONAL', 'Listrik', 'CASH', 1000, 'BIAYA_OPERASIONAL', 'Cabang B']
  ]);
  const produkC = buatSheet('Produk', [
    ['ID Produk', 'Nama Produk', 'Stok', 'Harga', 'HPP', 'Cabang'],
    ['P9', 'Melon 250 ml', 3, 12000, 6000, 'Cabang C']
  ]);
  const userD = buatSheet('User', [
    ['username', 'password', 'role', 'cabang'],
    ['nina', 'x', 'KASIR', 'Cabang A'],
    ['budi', 'x', 'KASIR', 'cabang a']   // ejaan beda huruf, cabang sama
  ]);

  const asli = ctx.getSpreadsheet;
  ctx.getSpreadsheet = () => ({
    getSheetByName: (n) => {
      if (n === 'Penjualan') return pjTanpaCabang;
      if (n === 'Credit/Debit') return cdB;
      if (n === 'Produk') return produkC;
      if (n === 'User') return userD;
      return null;
    }
  });
  try {
    const res = ctx.getDaftarCabang('admin');
    eq(JSON.stringify(res.daftar), JSON.stringify(['Cabang A', 'Cabang B', 'Cabang C']), 'gabungan cabang ');
    eq(res.punyaKolomCabangPenjualan, false, 'flag kolom Penjualan ');
  } finally {
    ctx.getSpreadsheet = asli;
  }
});

console.log('');
console.log(lulus + ' lulus, ' + gagal.length + ' gagal');
if (gagal.length) { console.log('GAGAL: ' + gagal.join(', ')); process.exit(1); }
