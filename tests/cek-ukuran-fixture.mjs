// Diagnosis: kenapa credit-debit-prod-final.csv lebih kecil dari snapshot
// padahal hanya 6 sel yang berubah?
//
//   node tests/cek-ukuran-fixture.mjs
//
// Skrip ini hanya membaca berkas di tests/fixtures. Tidak menulis apa pun.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const F = (n) => path.join(DIR, 'fixtures', n);

const nama = ['snapshot-CreditDebit.csv', 'credit-debit-prod-final.csv', 'credit-debit-prod-usulan-lama.csv'];
for (const n of nama) {
  const b = fs.readFileSync(F(n));
  let cr = 0, lf = 0, kutip = 0;
  for (const x of b) { if (x === 13) cr++; if (x === 10) lf++; if (x === 34) kutip++; }
  console.log(n.padEnd(36) + ' byte=' + String(b.length).padStart(5)
    + '  CR=' + cr + '  LF=' + lf + '  tanda-kutip=' + kutip
    + '  akhir-newline=' + (b[b.length - 1] === 10));
}
console.log('');

// Mana saja byte yang hilang? Bandingkan per baris mentah.
const snap = fs.readFileSync(F('snapshot-CreditDebit.csv'), 'utf8').split('\n');
const fin = fs.readFileSync(F('credit-debit-prod-final.csv'), 'utf8').split('\n');
console.log('baris snapshot=' + snap.length + '   baris final=' + fin.length);
console.log('');
console.log('baris yang panjangnya berubah:');
let nBeda = 0;
let totalBeda = 0;
for (let i = 0; i < Math.max(snap.length, fin.length); i++) {
  const a = snap[i] === undefined ? '' : snap[i];
  const b = fin[i] === undefined ? '' : fin[i];
  if (a !== b) {
    nBeda++;
    totalBeda += a.length - b.length;
    if (nBeda <= 12) {
      console.log('  [' + (i + 1) + '] panjang ' + a.length + ' -> ' + b.length);
      console.log('      SNAP: ' + a);
      console.log('      FIN : ' + b);
    }
  }
}
console.log('  total baris berbeda=' + nBeda + '   total selisih panjang=' + totalBeda);
console.log('');

// Berapa banyak field pada snapshot yang diberi tanda kutip tanpa alasan?
const perluKutip = (s) => /[",\n]/.test(s);
let nKutipTakPerlu = 0;
let nKutipPerlu = 0;
snap.forEach((baris, bi) => {
  // hitung kemunculan tanda kutip di luar konteks
  let dalam = false;
  for (let i = 0; i < baris.length; i++) {
    if (baris[i] === '"') {
      if (!dalam) {
        // awal field: cari isi field
        const akhir = baris.indexOf('"', i + 1);
        const isi = akhir >= 0 ? baris.slice(i + 1, akhir).replace(/""/g, '"') : '';
        if (perluKutip(isi)) nKutipPerlu++; else nKutipTakPerlu++;
      }
      dalam = !dalam;
    }
  }
});
console.log('field di snapshot yang diberi tanda kutip:');
console.log('  perlu kutip (berisi , " atau newline) : ' + nKutipPerlu);
console.log('  TIDAK perlu kutip (kutip dibuang di final) : ' + nKutipTakPerlu);
console.log('  selisih byte dari buang kutip           : ' + (nKutipTakPerlu * 2));
console.log('');

// Apakah isi yang di-parsing sama persis (di luar 6 sel keputusan)?
function pecahBaris(t) {
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { f += c; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const pSnap = pecahBaris(fs.readFileSync(F('snapshot-CreditDebit.csv'), 'utf8'));
const pFin = pecahBaris(fs.readFileSync(F('credit-debit-prod-final.csv'), 'utf8'));
let bedaSel = 0;
const rincian = [];
for (let i = 0; i < Math.max(pSnap.length, pFin.length); i++) {
  const a = pSnap[i] || [], b = pFin[i] || [];
  for (let c = 0; c < Math.max(a.length, b.length); c++) {
    const x = a[c] === undefined ? '' : a[c];
    const y = b[c] === undefined ? '' : b[c];
    if (x !== y) { bedaSel++; rincian.push((i + 1) + ':' + String.fromCharCode(65 + c) + ' ' + JSON.stringify(x) + '->' + JSON.stringify(y)); }
  }
}
console.log('=== ISI SETELAH DI-PARSE ===');
console.log('  sel berbeda snapshot vs final : ' + bedaSel);
for (const r of rincian) console.log('    ' + r);
console.log('');
console.log('  Isi parsed=' + (bedaSel === 6 ? 'BENAR (tepat 6 sel keputusan)' : 'PERIKSA ULANG'));
console.log('');
console.log('Tidak ada yang ditulis ke spreadsheet mana pun.');
