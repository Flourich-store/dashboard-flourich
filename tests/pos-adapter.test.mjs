// Tes regresi adapter POS <-> dashboard (Code.gs "ADAPTER SKEMA PENJUALAN").
//
// Aplikasi POS menulis baris Penjualan secara POSISIONAL mengikuti skema lama:
//
//   v2:    ID | Tanggal | Nama | Volume(ml) | HPP Satuan | Jumlah | Total |
//          Metode | Dibayar | Kembali | Modal | Biaya Ops | Laba
//   POS:   ID | Tanggal | Nama | [qty]     | [subtotal] | (kosong)| [dibayar tx] |
//          [kembalian] | 0 | 0 | [subtotal] | (kosong) | (kosong)
//
// Peta kanonik nama (Semangci/Wonapel/Semangsu -> Semangka Leci/WNA/Semangka
// Susu) adalah bagian pemetaan yang paling sering disalahpahami, jadi diuji di
// sini secara eksplisit dengan HPP master yang BERBEDA dari tabel katalog.
//
// Cara pakai: node tests/pos-adapter.test.mjs <path Code.gs> (default repo)
import fs from 'node:fs';
import vm from 'node:vm';
import { targetGas } from './lib/jalur.mjs';

const target = targetGas();

// ---------- spreadsheet palsu (cukup untuk _readMasterHppMap) ----------
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
        setFontWeight() { return this; },
        getValue() { return s._d[r - 1] ? s._d[r - 1][c - 1] : ''; }
      };
    }
  };
  return sh;
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(target, 'utf8'), ctx, { filename: 'Code.gs' });
ctx.Logger = { log() {} };

// Tanggal harus dibuat DI DALAM sandbox: `new Date(...)` dari realm Node tidak
// lolos `instanceof Date` di dalam Code.gs (lintas realm), meniru perilaku GAS
// asli di mana tanggal datang dari sheet (satu realm).
const SDate = vm.runInContext('Date', ctx);
const tglSep28 = new SDate(2026, 8, 28, 14, 5);

// Master HPP produk, HPP Semangka Leci 350 sengaja DIUBAH jadi 8.500 supaya
// beda dari tabel katalog (9.000): kalau pemetaan kanonik gagal, hasilnya
// jatuh ke 9.000 dan tes ini merah.
const MASTER_BARIS = [
  ['Nama Produk', 'Stok', 'HPP'],
  ['Semangka Leci 250 ml', 10, 8000],
  ['Semangka Leci 350 ml', 5, 8500],
  ['Semangka Leci 500 ml', 3, 0],
  ['WNA 350 ml', 2, 12000],
  ['Semangka Susu 350 ml', 4, 10000]
];
const masterHppMap = ctx._readMasterHppMap({
  getSheetByName: () => buatSheet('Produk', MASTER_BARIS.map((r) => r.slice()))
});

// Index kolom v2 (posisi lokal array 13 kolom).
const I = { idxTx: 0, idxTgl: 1, idxProduk: 2, idxVolume: 3, idxHppSat: 4, idxJumlah: 5, idxTotal: 6, idxMetode: 7, idxDibayar: 8, idxKembali: 9, idxModal: 10 };

function buatPosRow(over) {
  const r = [
    'FR-1720000000001', tglSep28, 'Semangci 350 ml',
    4, 36000, '', 36000, 0, 0, 0, 36000, '', ''
  ];
  if (over) for (const k of Object.keys(over)) r[I[k]] = over[k];
  return r;
}

// Baris v2 sah (hasil konversi / tulisan dashboard) — HARUS tidak terbaca POS.
function buatV2Row(over) {
  const r = [
    'FR-1720000000001', tglSep28, 'Semangka Leci 350 ml',
    350, 9000, 4, 36000, 'CASH', 36000, 0, 36000, 0, 0
  ];
  if (over) for (const k of Object.keys(over)) r[I[k]] = over[k];
  return r;
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

console.log('Bukti: HPP master Semangka Leci 350 = ' + masterHppMap['semangka leci 350 ml'] + ' | kunci kanonik leci|350 = ' + masterHppMap['leci|350']);

// POS-A1: baris POS dikenali sebagai gaya POS
cek('POS-A1: baris POS dikenali', () => {
  if (!ctx._isBarisGayaPos(buatPosRow(), I)) throw new Error('harus true');
});

// POS-A2: baris v2 sah TIDAK dikenali sebagai gaya POS
cek('POS-A2: baris v2 tidak dikenali POS', () => {
  if (ctx._isBarisGayaPos(buatV2Row(), I)) throw new Error('harus false');
});

// POS-A3: konversi penuh — tiap sel skema v2
cek('POS-A3: konversi POS -> v2 semua kolom', () => {
  const out = ctx._konversiBarisPosKeV2(buatPosRow(), masterHppMap);
  if (!out) throw new Error('konversi null');
  eq(out[0], 'FR-1720000000001', 'ID ');
  eq(out[2], 'Semangci 350 ml', 'Nama ');
  eq(out[3], 350, 'Volume ');
  eq(out[4], 8500, 'HPP Satuan (master via kunci kanonik) ');
  eq(out[5], 4, 'Jumlah (qty POS) ');
  eq(out[6], 36000, 'Total (subtotal POS) ');
  eq(out[7], '', 'Metode (kembalian POS, tidak boleh CASH) ');
  eq(out[8], 36000, 'Dibayar (dibayar tx POS) ');
  eq(out[9], 0, 'Kembali ');
  eq(out[10], 8500 * 4, 'Modal ');
  eq(out[11], 0, 'Biaya Ops ');
  eq(out[12], 36000 - 8500 * 4, 'Laba ');
});

// POS-A4: pemetaan kanonik — nama POS <-> nama katalog via kunci leci|350
cek('POS-A4: nama POS dapat HPP master nama katalog (kunci kanonik)', () => {
  const out = ctx._konversiBarisPosKeV2(buatPosRow(), masterHppMap);
  // master = 8.500 vs katalog = 9.000; 8.500 membuktikan pemetaan berhasil.
  eq(out[4], 8500, 'hppSatuan ');
});

// POS-A5: idempoten — baris hasil konversi tidak dibaca ulang sebagai POS
cek('POS-A5: hasil konversi tidak terdeteksi POS lagi', () => {
  const out = ctx._konversiBarisPosKeV2(buatPosRow(), masterHppMap);
  if (ctx._isBarisGayaPos(out, I)) throw new Error('baris v2 hasil konversi terbaca POS');
});

// POS-A6: kembalian dengan koma desimal
cek('POS-A6: kembalian koma desimal 500,00 -> 500', () => {
  const out = ctx._konversiBarisPosKeV2(buatPosRow({ idxMetode: '500,00' }), masterHppMap);
  eq(out[9], 500, 'kembali ');
});

// POS-A7: dibayar kosong -> jatuh ke subtotal
cek('POS-A7: dibayar kosong memakai subtotal', () => {
  const out = ctx._konversiBarisPosKeV2(buatPosRow({ idxTotal: '' }), masterHppMap);
  eq(out[8], 36000, 'dibayar ');
});

// POS-A8: tanggal teks '2026-09-28' diterima
cek('POS-A8: tanggal teks di-parse', () => {
  const out = ctx._konversiBarisPosKeV2(buatPosRow({ idxTgl: '2026-09-28' }), masterHppMap);
  if (!out) throw new Error('konversi null untuk tanggal teks');
  if (!(out[1] instanceof SDate) || isNaN(out[1].getTime())) throw new Error('tanggal bukan Date valid');
  eq(out[1].getFullYear(), 2026, 'tahun ');
});

// POS-A9: baris tanpa ID / tanpa nama / tanpa tanggal ditolak tanpa diubah
cek('POS-A9: baris tidak lengkap ditolak (null)', () => {
  if (ctx._konversiBarisPosKeV2(buatPosRow({ idxTx: '' }), masterHppMap) !== null) throw new Error('tanpa ID harus null');
  if (ctx._konversiBarisPosKeV2(buatPosRow({ idxProduk: '' }), masterHppMap) !== null) throw new Error('tanpa nama harus null');
  if (ctx._konversiBarisPosKeV2(buatPosRow({ idxTgl: '' }), masterHppMap) !== null) throw new Error('tanpa tanggal harus null');
});

// POS-B1: nama tanpa volume -> volume 250 + HPP getHppRate
cek('POS-B1: nama tanpa volume -> volume 250, HPP tabel katalog', () => {
  const out = ctx._konversiBarisPosKeV2(buatPosRow({ idxProduk: 'Semangci' }), masterHppMap);
  eq(out[3], 250, 'volume ');
  eq(out[4], 7500, 'hppSatuan 250 (katalog DEFAULT) ');
  const l2 = ctx._konversiBarisPosKeV2(buatPosRow({ idxProduk: 'Wonapel' }), masterHppMap);
  eq(l2[3], 250, 'volume WNA ');
  eq(l2[4], 9500, 'hppSatuan WNA 250 ');
});

// POS-B2: produk tidak ada di master (literal maupun kanonik) -> tabel katalog
cek('POS-B2: HPP produk tak dikenal jatuh ke katalog', () => {
  const out = ctx._konversiBarisPosKeV2(buatPosRow({ idxProduk: 'Semangka Leci 500 ml' }), masterHppMap);
  eq(out[4], 11000, 'hppSatuan leci 500 ');
});

console.log('');
console.log(lulus + ' lulus, ' + gagal.length + ' gagal');
if (gagal.length) {
  console.log('GAGAL: ' + gagal.join(', '));
  process.exit(1);
}