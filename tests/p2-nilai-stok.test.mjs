// Tes regresi P2: getNilaiStok dilipat ke respons getProdukList.
// Tujuannya: satu panggilan server untuk tab Produk (bukan dua), TANPA
// menambah pembacaan sheet, dan angka Nilai Stok TIDAK boleh berubah.
//
// Cara pakai: node p2-nilai-stok.test.mjs <path Code.gs>
//
// AP-20 : respons getProdukList membawa nilaiStok/totalUnit/rincian
// AP-21 : nilaiStok dari getProdukList IDENTIK dengan getNilaiStok
//         (termasuk produk ber-HPP master kosong -> fallback referensi/katalog)
// AP-22 : getNilaiStok sendiri tidak berubah setelah refactor
// AP-23 : getProdukList tetap membaca sheet Produk SATU kali (tidak ada
//         pembacaan tambahan yang dibuatkan oleh penggabungan)
// AP-24 : baris tanpa ID tetap dihitung di Nilai Stok (paritas dengan
//         getNilaiStok lama yang hanya menyaring nama kosong)

import fs from 'node:fs';
import vm from 'node:vm';
import { targetGas } from './lib/jalur.mjs';

const target = targetGas();

function buatSheet(nama, baris, hitung) {
  const sh = {
    _nama: nama,
    _d: baris,
    getName() { return this._nama; },
    getLastRow() { return this._d.length; },
    getLastColumn() { return this._d.reduce((m, r) => Math.max(m, r.length), 0); },
    getDataRange() {
      hitung && hitung.dataRange++;
      const s = this;
      return { getValues() { return s._d.map((r) => r.slice()); } };
    },
    getRange(r, c, nR, nC) {
      const s = this;
      hitung && hitung.range++;
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
        setFontWeight() { return this; },
        getValue() { return s._d[r - 1] ? s._d[r - 1][c - 1] : ''; }
      };
    },
    appendRow(r) { this._d.push(r.slice()); return this; },
    insertColumnsAfter(p, h) { for (const r of this._d) r.splice(p, 0, ...new Array(h).fill('')); return this; }
  };
  return sh;
}

const HEADER = ['ID Produk', 'Nama Produk', 'Stok', 'Harga', 'HPP'];
// Baris 4 sengaja tanpa ID dan tanpa HPP master: menguji paritas dengan
// getNilaiStok lama (baris tanpa ID TETAP dihitung Nilai Stok, HPP-nya jatuh
// ke fallback getHppRate = 9.000 untuk "Semangka Leci 350 ml").
const BARIS = [
  HEADER.slice(),
  ['PRD001', 'Semangka Leci 250 ml', 10, 10000, 8000],   // HPP master 8.000 (katalog 7.500)
  ['PRD002', 'Semangka Leci 350 ml', 5, 14000, 0],       // HPP master kosong -> fallback 9.000
  ['PRD003', 'WNA 350 ml', 2, 15000, 12000],             // HPP master 12.000 (katalog 10.500)
  ['', 'Semangka Leci 500 ml', 3, 20000, 0]              // tanpa ID, HPP kosong -> fallback 11.000
];
// Harapan: 10*8000 + 5*9000 + 2*12000 + 3*11000 = 80000 + 45000 + 24000 + 33000 = 182.000
const HARAPAN = { nilaiStok: 182000, totalUnit: 20 };

function buatKonteks() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(target, 'utf8'), ctx, { filename: 'Code.gs' });
  const hitung = { dataRange: 0, range: 0 };
  const produk = buatSheet('Produk', BARIS.map((r) => r.slice()), hitung);
  const ss = {
    getSheetByName: (n) => (n === 'Produk' ? produk : null),
    getActiveSpreadsheet() { return this; }
  };
  ctx.getSpreadsheet = () => ss;
  ctx._verifyToken = () => ({ r: 'ADMIN' });
  return { ctx, hitung, produk };
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

console.log('Tes regresi P2 - Nilai Stok ikut respons getProdukList\n');

{
  const { ctx, hitung } = buatKonteks();
  const list = ctx.getProdukList('t');
  const nilai = ctx.getNilaiStok('t');

  cek('AP-20 respons getProdukList membawa nilaiStok + totalUnit + rincian', () => {
    eq(list && list.status, 'success', 'status');
    if (!Object.prototype.hasOwnProperty.call(list, 'nilaiStok')) {
      throw new Error('field nilaiStok tidak ada di respons getProdukList');
    }
    eq(list.totalUnit, HARAPAN.totalUnit, 'totalUnit');
    eq(Array.isArray(list.rincian), true, 'rincian berupa array');
  });

  cek('AP-21 nilaiStok di getProdukList == getNilaiStok (angka sama persis)', () => {
    eq(list.nilaiStok, nilai.nilaiStok, 'nilaiStok');
    eq(list.totalUnit, nilai.totalUnit, 'totalUnit');
    eq(JSON.stringify(list.rincian), JSON.stringify(nilai.rincian), 'rincian');
  });

  cek('AP-21b getNilaiStok lama tetap menghasilkan angka yang benar', () => {
    eq(nilai.nilaiStok, HARAPAN.nilaiStok, 'nilaiStok');
    eq(nilai.totalUnit, HARAPAN.totalUnit, 'totalUnit');
  });

  cek('AP-21c fallback HPP dipakai saat master kosong (bukan 0)', () => {
    const r = list.rincian || [];
    const leci350 = r.find((x) => x.nama === 'Semangka Leci 350 ml');
    const wna350 = r.find((x) => x.nama === 'WNA 350 ml');
    const leci500 = r.find((x) => x.nama === 'Semangka Leci 500 ml');
    eq(leci350 && leci350.hpp, 9000, 'Semangka Leci 350 ml -> fallback 9.000');
    eq(wna350 && wna350.hpp, 12000, 'WNA 350 ml -> HPP master 12.000');
    eq(leci500 && leci500.hpp, 11000, 'baris tanpa ID -> tetap dihitung, fallback 11.000');
  });

  cek('AP-23 getProdukList membaca sheet Produk satu kali saja', () => {
    const { ctx: c2, hitung: h2 } = buatKonteks();
    h2.dataRange = 0; h2.range = 0;
    c2.getProdukList('t');
    eq(h2.dataRange, 1, 'getDataRange() untuk sheet Produk');
  });
}

console.log('\n' + lulus + ' lulus, ' + gagal.length + ' gagal');
if (gagal.length) {
  console.log('GAGAL: ' + gagal.join(' | '));
  process.exit(1);
}
