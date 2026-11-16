// Tes regresi: pemilihan data transaksi PER CABANG.
//
// Kenapa: cabang sudah disimpan di token sesi sejak fitur login-cabang, tapi
// laporan tetap menjumlahkan semua cabang. Aturan yang dikunci di sini:
//   1. KASIR hanya melihat baris cabangnya sendiri (dari token), walaupun
//      frontend mengirim cabang lain.
//   2. SUPER_ADMIN tanpa filter ('' / 'ALL' / 'SEMUA') melihat semua cabang.
//   3. SUPER_ADMIN yang memilih satu cabang hanya melihat cabang itu.
//   4. Baris tanpa cabang TIDAK ikut tampil saat filter aktif (tidak bocor).
//   5. getDaftarCabang mengembalikan daftar unik & terurut dari sheet
//      Penjualan + User.
//   6. Kolom Cabang di sheet Penjualan ditambahkan di ujung kanan sehingga
//      posisi 13 kolom skema v2 tidak bergeser.
//
//   node tests/cabang-filter.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import { targetGas } from './lib/jalur.mjs';

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
  formatDate(d, tz, fmt) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
};

const HEADER = [
  'ID Transaksi', 'Tanggal', 'Nama Produk', 'Volume (ml)', 'HPP Satuan', 'Jumlah',
  'Total Harga', 'Metode Pembayaran', 'Uang Dibayar', 'Uang Kembali', 'Modal',
  'Biaya Operasional', 'Laba bersih', 'Cabang'
];

function baris(id, tgl, cabang, total, qty) {
  return [
    id, new SDate(tgl[0], tgl[1] - 1, tgl[2], 10, 0), 'Semangka Leci 350 ml', 350, 8000,
    qty, total, 'CASH', total, 0, 8000 * qty, 0, total - 8000 * qty, cabang
  ];
}

const penjualan = buatSheet('Penjualan', [
  HEADER.slice(),
  baris('FR-A1', [2026, 9, 1], 'Cabang A', 10000, 1),
  baris('FR-B1', [2026, 9, 2], 'Cabang B', 20000, 2),
  baris('FR-X1', [2026, 9, 3], '', 5000, 1)
]);
const produk = buatSheet('Produk', [
  ['Nama Produk', 'Stok', 'HPP'],
  ['Semangka Leci 350 ml', 10, 8000]
]);
const user = buatSheet('User', [
  ['username', 'password', 'role', 'cabang'],
  ['nina', 'rahasia', 'KASIR', 'Cabang A'],
  ['budi', 'rahasia', 'KASIR', 'Cabang B']
]);

const ss = {
  getSheetByName(n) {
    if (n === 'Penjualan') return penjualan;
    if (n === 'Produk') return produk;
    if (n === 'User') return user;
    return null; // Credit/Debit tidak ada -> angkanya 0
  }
};
ctx.getSpreadsheet = () => ss;

const SESI = {
  kasirA: { u: 'nina', r: 'KASIR', c: 'Cabang A' },
  kasirB: { u: 'budi', r: 'KASIR', c: 'Cabang B' },
  superadmin: { u: 'owner', r: 'SUPER_ADMIN', c: '' }
};
ctx._verifyToken = (token) => {
  const s = SESI[String(token || '')];
  if (!s) throw new Error('Unauthorized');
  return s;
};

let lulus = 0;
const gagal = [];
function cek(nama, fn) {
  try { fn(); lulus++; console.log('  LULUS  ' + nama); }
  catch (e) { gagal.push(nama); console.log('  GAGAL  ' + nama + ' -> ' + e.message); }
}
function eq(didapat, diharapkan, label) {
  if (didapat !== diharapkan) {
    throw new Error((label || '') + ' harap ' + JSON.stringify(diharapkan) + ' tapi dapat ' + JSON.stringify(didapat));
  }
}
function laporan(token, cabang) {
  const res = ctx.getReportByDateRange(token, '', '', cabang);
  if (!res || res.status !== 'success') throw new Error('respons laporan tidak success: ' + JSON.stringify(res));
  return res;
}

// 1. Kasir hanya melihat cabangnya sendiri.
cek('CBG-1: kasir Cabang A hanya melihat transaksi Cabang A', () => {
  const r = laporan('kasirA');
  eq(r.omsetKotor, 10000, 'omset ');
  eq(r.totalTransaksi, 1, 'jumlah transaksi ');
  eq(r.cabangAktif, 'Cabang A', 'cabangAktif ');
  eq(r.filterCabangAktif, true, 'filter aktif ');
});

// 2. Kasir tidak bisa mengintip cabang lain lewat parameter frontend.
cek('CBG-2: kasir Cabang A mengirim "Cabang B" tetap dapat Cabang A', () => {
  const r = laporan('kasirA', 'Cabang B');
  eq(r.omsetKotor, 10000, 'omset ');
  eq(r.cabangAktif, 'Cabang A', 'cabang aktif tetap dari token ');
});

// 3. Kasir Cabang B.
cek('CBG-3: kasir Cabang B hanya melihat transaksi Cabang B', () => {
  const r = laporan('kasirB');
  eq(r.omsetKotor, 20000, 'omset ');
  eq(r.totalTransaksi, 1, 'jumlah transaksi ');
});

// 4. Baris tanpa cabang tidak ikut tampil saat filter aktif.
cek('CBG-4: baris tanpa cabang tidak bocor ke kasir', () => {
  const r = laporan('kasirA');
  const ada5000 = (r.data || []).some((d) => Number(d.total) === 5000);
  eq(ada5000, false, 'baris tanpa cabang ikut tampil ');
});

// 5. SUPER_ADMIN tanpa filter melihat semua cabang (termasuk baris tanpa cabang).
cek('CBG-5: SUPER_ADMIN tanpa filter = semua cabang', () => {
  const r = laporan('superadmin');
  eq(r.omsetKotor, 35000, 'omset ');
  eq(r.totalTransaksi, 3, 'jumlah transaksi ');
  eq(r.filterCabangAktif, false, 'filter harus tidak aktif ');
});

// 6. SUPER_ADMIN memilih satu cabang.
cek('CBG-6: SUPER_ADMIN memilih Cabang B', () => {
  const r = laporan('superadmin', 'Cabang B');
  eq(r.omsetKotor, 20000, 'omset ');
  eq(r.totalTransaksi, 1, 'jumlah transaksi ');
  eq(r.cabangAktif, 'Cabang B', 'cabangAktif ');
});

// 7. 'ALL' / 'SEMUA' diperlakukan sebagai semua cabang.
cek('CBG-7: SUPER_ADMIN "ALL" dan "SEMUA" = semua cabang', () => {
  eq(laporan('superadmin', 'ALL').omsetKotor, 35000, 'ALL ');
  eq(laporan('superadmin', 'SEMUA').omsetKotor, 35000, 'SEMUA ');
});

// 8. Nama cabang tidak peka huruf besar/kecil.
cek('CBG-8: filter cabang tidak peka huruf besar/kecil', () => {
  const r = laporan('superadmin', 'cabang a');
  eq(r.omsetKotor, 10000, 'omset ');
});

// 9. Daftar cabang unik & terurut dari Penjualan + User.
cek('CBG-9: getDaftarCabang mengembalikan daftar unik terurut', () => {
  const res = ctx.getDaftarCabang('superadmin');
  eq(res.status, 'success', 'status ');
  eq(JSON.stringify(res.daftar), JSON.stringify(['Cabang A', 'Cabang B']), 'daftar ');
});

// 10. Kolom Cabang ditambahkan di ujung kanan (skema v2 tidak bergeser).
cek('CBG-10: kolom Cabang dibuat di kolom terakhir, header lama utuh', () => {
  const tanpaCabang = buatSheet('Penjualan', [[
    'ID Transaksi', 'Tanggal', 'Nama Produk', 'Volume (ml)', 'HPP Satuan', 'Jumlah',
    'Total Harga', 'Metode Pembayaran', 'Uang Dibayar', 'Uang Kembali', 'Modal',
    'Biaya Operasional', 'Laba bersih'
  ]]);
  const ssLokal = { getSheetByName: (n) => (n === 'Penjualan' ? tanpaCabang : null) };
  const idx = ctx._ensurePenjualanCabangColumn(ssLokal);
  eq(idx, 14, 'nomor kolom baru ');
  eq(tanpaCabang._d[0][13], 'Cabang', 'header kolom baru ');
  eq(tanpaCabang._d[0][2], 'Nama Produk', 'kolom lama tidak bergeser ');
  // Idempotent: pemanggilan kedua tidak menambah kolom lagi.
  eq(ctx._ensurePenjualanCabangColumn({ getSheetByName: () => buatSheet('Penjualan', [HEADER.slice()]) }), 14, 'nomor kolom saat sudah ada ');
});

// 11. Penjualan baru otomatis ditandai cabang kasir yang login.
cek('CBG-11: addPenjualan menulis cabang dari token kasir', () => {
  const sebelum = penjualan._d.length;
  const res = ctx.addPenjualan('kasirA', { namaProduk: 'Semangka Leci 350 ml', harga: 10000, jumlah: 1, volume: 350 });
  eq(res.status, 'success', 'status addPenjualan ');
  eq(penjualan._d.length, sebelum + 1, 'baris bertambah ');
  const barisBaru = penjualan._d[penjualan._d.length - 1];
  eq(String(barisBaru[13] || ''), 'Cabang A', 'cabang tersimpan ');
});

// 12. SUPER_ADMIN boleh menandai cabang lain lewat data.cabang.
cek('CBG-12: addPenjualan SUPER_ADMIN memakai data.cabang', () => {
  const res = ctx.addPenjualan('superadmin', { namaProduk: 'Semangka Leci 350 ml', harga: 12000, jumlah: 2, volume: 350, cabang: 'Cabang B' });
  eq(res.status, 'success', 'status addPenjualan ');
  const barisBaru = penjualan._d[penjualan._d.length - 1];
  eq(String(barisBaru[13] || ''), 'Cabang B', 'cabang dari data.cabang ');
});

console.log('');
// 13. Sheet lama tanpa kolom Cabang: filter tidak diterapkan supaya dashboard
//     kasir tidak kosong (perilaku transisi sebelum kolom diisi).
cek('CBG-13: sheet tanpa kolom Cabang -> kasir tetap melihat data (tidak kosong)', () => {
  const sheetLama = buatSheet('Penjualan', [
    HEADER.slice(0, 13),
    ['FR-1', new SDate(2026, 9, 1), 'Semangka Leci 350 ml', 350, 8000, 1, 10000, 'CASH', 10000, 0, 8000, 0, 2000],
    ['FR-2', new SDate(2026, 9, 2), 'Semangka Leci 350 ml', 350, 8000, 1, 5000, 'CASH', 5000, 0, 8000, 0, -3000]
  ]);
  const asli = ctx.getSpreadsheet;
  ctx.getSpreadsheet = () => ({
    getSheetByName: (n) => (n === 'Penjualan' ? sheetLama : (n === 'Produk' ? produk : null))
  });
  try {
    const r = ctx.getReportByDateRange('kasirA', '', '', '');
    eq(r.omsetKotor, 15000, 'omset semua baris ');
    eq(r.filterCabangAktif, false, 'filter tidak aktif tanpa kolom cabang ');
  } finally {
    ctx.getSpreadsheet = asli;
  }
});

console.log(lulus + ' lulus, ' + gagal.length + ' gagal');
if (gagal.length) { console.log('GAGAL: ' + gagal.join(', ')); process.exit(1); }
