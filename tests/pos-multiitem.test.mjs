// Tes regresi: checkout kasir MULTI-ITEM harus mencatat SEMUA item.
//
// Latar belakang (laporan pemilik, 6 Nov 2026): setelah penyesuaian di
// aplikasi POS, satu checkout berisi beberapa item hanya tercatat 1 item.
//
// Akar yang terbukti: laporan membuang setiap baris yang kolom "ID Transaksi"
// kosong. Pola POS yang menulis ID hanya di baris pertama (atau sel ID
// digabung) membuat baris item ke-2..n hilang dari omset, qty, dan detail -
// padahal barisnya ADA di sheet. Tes ini mengunci tiga pola penulisan:
//
//   POLA-1 (lama)  : ID diulang di setiap baris  -> harus tetap benar
//   POLA-2 (baru)  : ID hanya di baris pertama   -> dulu HILANG, sekarang harus benar
//   POLA-3 (rusak) : ID kosong di semua baris    -> dulu omset 0, sekarang harus terhitung
//
// Cara pakai: node tests/pos-multiitem.test.mjs [path Code.gs]
import fs from 'node:fs';
import vm from 'node:vm';
import { targetGas } from './lib/jalur.mjs';

const target = targetGas();

function buatSheet(nama, baris) {
  const sh = {
    _nama: nama,
    _d: baris,
    getName() { return this._nama; },
    getLastRow() { return this._d.length; },
    getLastColumn() { return this._d.reduce((m, r) => Math.max(m, r.length), 0); },
    getDataRange() { const s = this; return { getValues() { return s._d.map((r) => r.slice()); } }; },
    insertColumnsAfter(pos, n) { for (const row of this._d) for (let k = 0; k < n; k++) row.splice(pos, 0, ''); },
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
        setValues(vals) {
          for (let i = 0; i < vals.length; i++) {
            if (!s._d[r - 1 + i]) s._d[r - 1 + i] = [];
            for (let j = 0; j < vals[i].length; j++) s._d[r - 1 + i][c - 1 + j] = vals[i][j];
          }
          return this;
        },
        setFontWeight() { return this; }
      };
    }
  };
  return sh;
}

const HEADER_V2 = [
  'ID Transaksi', 'Tanggal', 'Nama Produk', 'Volume (ml)', 'HPP Satuan', 'Jumlah',
  'Total Harga', 'Metode Pembayaran', 'Uang Dibayar', 'Uang Kembali', 'Modal',
  'Biaya Operasional', 'Laba bersih'
];

// Jalankan laporan atas baris yang dibuat DI DALAM sandbox (Date lintas realm).
function hitung(buatBaris, tglAwal, tglAkhir) {
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
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => '1', setProperty() {} }) };
  ctx.ScriptApp = {
    getProjectTriggers: () => [],
    newTrigger: () => ({ forSpreadsheet: () => ({ onChange: () => ({ create() {} }) }) })
  };
  ctx._verifyToken = () => ({ username: 'tester', role: 'ADMIN' });

  const penjualan = buatSheet('Penjualan', [HEADER_V2.slice(), ...buatBaris(SDate)]);
  const produk = buatSheet('Produk', [
    ['Nama Produk', 'Stok', 'HPP'],
    ['Semangka Leci 350 ml', 10, 8500],
    ['WNA 350 ml', 10, 12000],
    ['Semangka Susu 350 ml', 10, 10000]
  ]);
  const ss = {
    getSheetByName(n) {
      if (n === 'Penjualan') return penjualan;
      if (n === 'Produk') return produk;
      return null;
    }
  };
  ctx.getSpreadsheet = () => ss;

  const r = ctx.getReportByDateRange('token-test', tglAwal || '2026-10-25', tglAkhir || '2026-10-25');
  return r;
}

// Satu checkout = 3 item, subtotal 28.000 + 12.000 + 10.000 = 50.000.
// Gaya POS klasik: qty di Volume, subtotal di HPP Satuan, Jumlah kosong,
// Metode berisi kembalian, Total Harga berisi uang dibayar.
function item(D, id, nama, qty, subtotal) {
  // bulan 0-based: 9 = Oktober
  return [id, new D(2026, 9, 25, 10, 0), nama, qty, subtotal, '', 50000, 2000, 0, 0, subtotal, '', ''];
}

// Varian dengan tanggal bebas (hari), untuk menguji batas pewarisan ID.
function itemTgl(D, hari, id, nama, qty, subtotal) {
  return [id, new D(2026, 9, hari, 10, 0), nama, qty, subtotal, '', 50000, 2000, 0, 0, subtotal, '', ''];
}

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

console.log('Target Code.gs: ' + target);

// ---------- POLA-1: ID diulang setiap baris (perilaku lama, tidak boleh rusak) ----------
cek('POLA-1: 3 item, ID di setiap baris -> 3 detail, omset 50000, 1 transaksi', () => {
  const r = hitung((D) => [
    item(D, 'FR-M1', 'Semangci 350 ml', 2, 28000),
    item(D, 'FR-M1', 'Wonapel 350 ml', 1, 12000),
    item(D, 'FR-M1', 'Semangsu 350 ml', 1, 10000)
  ]);
  eq(r.data.length, 3, 'jumlah detail');
  eq(r.omsetKotor, 50000, 'omset');
  eq(r.totalTransaksi, 1, 'transaksi');
});

// ---------- POLA-2: ID hanya di baris pertama (gejala yang dilaporkan) ----------
cek('POLA-2: 3 item, ID hanya baris pertama -> 3 detail, omset 50000, 1 transaksi', () => {
  const r = hitung((D) => [
    item(D, 'FR-M2', 'Semangci 350 ml', 2, 28000),
    item(D, '', 'Wonapel 350 ml', 1, 12000),
    item(D, '', 'Semangsu 350 ml', 1, 10000)
  ]);
  eq(r.data.length, 3, 'jumlah detail');
  eq(r.omsetKotor, 50000, 'omset');
  eq(r.totalTransaksi, 1, 'transaksi');
});

// ---------- POLA-3: ID kosong di semua baris ----------
cek('POLA-3: semua ID kosong -> omset tetap 50000, tidak nol', () => {
  const r = hitung((D) => [
    item(D, '', 'Semangci 350 ml', 2, 28000),
    item(D, '', 'Wonapel 350 ml', 1, 12000),
    item(D, '', 'Semangsu 350 ml', 1, 10000)
  ]);
  eq(r.data.length, 3, 'jumlah detail');
  eq(r.omsetKotor, 50000, 'omset');
});

// ---------- POLA-4: baris tanpa ID di HARI LAIN tidak boleh menempel ke transaksi sebelumnya ----------
// Omset tetap dihitung (tidak hilang), tapi tidak boleh dianggap satu
// transaksi yang sama dengan transaksi hari sebelumnya.
cek('POLA-4: ID kosong beda hari -> omset 50000 utuh, tetap 2 transaksi', () => {
  const r = hitung((D) => [
    itemTgl(D, 25, 'FR-M4', 'Semangci 350 ml', 1, 20000),
    itemTgl(D, 26, '', 'Wonapel 350 ml', 1, 30000)
  ], '2026-10-25', '2026-10-26');
  eq(r.data.length, 2, 'jumlah detail');
  eq(r.omsetKotor, 50000, 'omset');
  eq(r.totalTransaksi, 2, 'transaksi');
});

console.log('');
if (gagal.length) {
  console.log('DARI ' + (lulus + gagal.length) + ' TES, GAGAL ' + gagal.length + ':');
  for (const g of gagal) console.log('  - ' + g);
  process.exit(1);
}
console.log('SEMUA LOLOS: ' + lulus + ' tes.');
