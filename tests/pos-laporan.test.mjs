// Tes integrasi: getReportByDateRange memetakan baris gaya-POS + baris v2
// dengan benar ke laporan (omset, HPP/laba, metode, qty, detail), termasuk
// nama POS (Semangci) -> nama katalog (Semangka Leci) via kunci kanonik.
//
// Skema v2 (13 kolom):
//   ID Transaksi | Tanggal | Nama Produk | Volume (ml) | HPP Satuan | Jumlah |
//   Total Harga | Metode Pembayaran | Uang Dibayar | Uang Kembali | Modal |
//   Biaya Operasional | Laba bersih
// Baris gaya-POS menaruh qty di Volume, subtotal di HPP Satuan, Jumlah kosong,
// metode angka (kembalian) di kolom Metode.

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
  return sh;
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(target, 'utf8'), ctx, { filename: 'Code.gs' });
const SDate = vm.runInContext('Date', ctx);

ctx.Logger = { log() {} };
// formatDate dipakai _parseSheetDateKey untuk sel Date. Implementasi minimal.
ctx.Utilities = {
  formatDate(d, tz, fmt) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
};

// --- Sheets ---
const HEADER_V2 = [
  'ID Transaksi', 'Tanggal', 'Nama Produk', 'Volume (ml)', 'HPP Satuan', 'Jumlah',
  'Total Harga', 'Metode Pembayaran', 'Uang Dibayar', 'Uang Kembali', 'Modal',
  'Biaya Operasional', 'Laba bersih'
];
const I = (n) => HEADER_V2.indexOf(n);

// Baris v2 sah (scenario dashboard/terkonversi).
// Semangka Leci 350 ml: harga jual 14000, HPP master 8500 (sengaja beda dari
// katalog 9000 agar pemetaan master terbukti dipakai, bukan katalog).
function buatBarisV2(over) {
  const r = [
    'FR-1', new SDate(2026, 8, 28, 10, 0), 'Semangka Leci 350 ml', 350, 8500, 2,
    28000, 'QRIS', 28000, 0, 17000, 0, 11000
  ];
  if (over) for (const k of Object.keys(over)) r[I(k)] = over[k];
  return r;
}

// Baris gaya-POS (belum dikonversi): qty=2 di col Volume, subtotal 28000 di
// col HPP Satuan, Jumlah kosong, metode berisi kembalian 0, modal berisi
// subtotal. Nama memakai istilah POS: "Semangci 350 ml".
function buatBarisPos(over) {
  const r = [
    'FR-POS-1', new SDate(2026, 8, 29, 14, 30), 'Semangci 350 ml', 2, 28000, '',
    28000, 0, 0, 0, 28000, '', ''
  ];
  if (over) for (const k of Object.keys(over)) r[I(k)] = over[k];
  return r;
}

const penjualan = buatSheet('Penjualan', [HEADER_V2.slice(), buatBarisV2(), buatBarisPos()]);
const produk = buatSheet('Produk', [
  ['Nama Produk', 'Stok', 'HPP'],
  ['Semangka Leci 350 ml', 10, 8500]
]);
const ss = {
  getSheetByName(n) {
    if (n === 'Penjualan') return penjualan;
    if (n === 'Produk') return produk;
    return null; // Credit/Debit tidak ada -> _readCreditDebitItems kembali []
  }
};
ctx.getSpreadsheet = () => ss;
ctx._verifyToken = () => ({ username: 'tester', role: 'ADMIN' });

let lulus = 0;
const gagal = [];
function cek(nama, fn) {
  try { fn(); lulus++; console.log('  LULUS  ' + nama); }
  catch (e) { gagal.push(nama); console.log('  GAGAL  ' + nama + ' -> ' + e.message); }
}
function eq(didapat, diharapkan, label) {
  if (didapat !== diharapkan) throw new Error((label || '') + ' harap ' + JSON.stringify(diharapkan) + ' tapi dapat ' + JSON.stringify(didapat));
}
function hampir(didapat, diharapkan, label) {
  if (Math.abs(didapat - diharapkan) > 0.0001) throw new Error((label || '') + ' harap ~' + diharapkan + ' tapi dapat ' + didapat);
}

const resp = ctx.getReportByDateRange('token-test', '2026-09-28', '2026-09-29');
if (!resp || resp.status !== 'success') {
  console.log('RESPONS LAPORAN: ' + JSON.stringify(resp));
  process.exit(1);
}

console.log('Resp omsetKotor=' + resp.omsetKotor + ' labaKotor=' + resp.labaKotor + ' totalTransaksi=' + resp.totalTransaksi + ' chartData=' + JSON.stringify(resp.chartData));

// LAP-1: omset = v2(28000) + POS(28000) = 56000
cek('LAP-1: omset kotor = 56000 (v2 + POS)', () => eq(resp.omsetKotor, 56000, 'omset '));

// LAP-2: laba kotor. Baris v2: HPP 8500*2=17000 -> laba 11000.
// Baris POS (nama 'Semangci 350 ml' -> master 8500 via kunci kanonik): HPP
// 8500*2=17000 -> laba 11000. Total HPP 34000, laba kotor 22000.
cek('LAP-2: laba kotor = 22000 (HPP via master kanonik)', () => {
  hampir(resp.labaKotor, 22000, 'labaKotor ');
  hampir(resp.totalHPP || 0, 34000, 'totalHPP ');
});

// LAP-3: jumlah transaksi unik = 2
cek('LAP-3: totalTransaksi = 2', () => eq(resp.totalTransaksi, 2, 'tx '));

// LAP-4: detail memuat kedua baris dengan nilai benar (pos melaporkan qty dari
// kolom Volume dan total dari kolom HPP Satuan)
cek('LAP-4: detail baris POS + v2 lengkap', () => {
  const d = resp.data || [];
  eq(d.length, 2, 'jumlah detail ');
  const pos = d.find((x) => String(x.namaProduk).indexOf('Semangci') !== -1);
  const v2 = d.find((x) => String(x.namaProduk).indexOf('Semangka Leci') !== -1);
  if (!pos || !v2) throw new Error('detail tidak memuat kedua baris');
  eq(pos.jumlah, 2, 'qty POS ');
  eq(pos.total, 28000, 'total POS ');
  eq(String(pos.metode), '', 'metode POS harus kosong (bukan CASH karangan) ');
  eq(v2.jumlah, 2, 'qty v2 ');
  eq(v2.total, 28000, 'total v2 ');
});

// LAP-5: chartData — v2 QRIS 28000, POS metode kosong -> bukan QRIS (Cash)
cek('LAP-5: chart memetakan qris dan cash', () => {
  const ch = resp.chartData || [];
  const cari = (k) => ch.reduce((a, x) => (String(x.kategori) === String(k) ? a + Number(x.omset || 0) : a), 0);
  eq(cari('QRIS'), 28000, 'QRIS ');
  eq(cari('Cash'), 28000, 'Cash ');
});

// LAP-6: topProducts — HPP produk POS terpetakan ke nama katalog? Kelompok nama
// asli baris POS tetap 'Semangci 350 ml' (tidak dipaksa rename).
cek('LAP-6: topProducts berisi kedua produk', () => {
  const tp = resp.topProducts || [];
  eq(tp.length, 2, 'jumlah top ');
  const pos = tp.find((x) => String(x.nama).indexOf('Semangci') !== -1);
  if (pos) eq(pos.omset, 28000, 'omset POS top ');
});

// LAP-7: POS yang TIDAK dikonversi TIDAK menyusut menjadi qty=0 (jumlah diisi
// dari kolom HPP Satuan) — bug lama "baris POS tidak terbaca".
cek('LAP-7: qty total = 4 (2+2)', () => {
  const d = resp.data || [];
  const qty = d.reduce((a, x) => a + Number(x.jumlah || 0), 0);
  eq(qty, 4, 'qty total ');
});

console.log('');
console.log(lulus + ' lulus, ' + gagal.length + ' gagal');
if (gagal.length) { console.log('GAGAL: ' + gagal.join(', ')); process.exit(1); }