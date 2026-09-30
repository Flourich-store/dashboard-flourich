// Cari baris Credit/Debit yang memuat suatu kata, lalu dump kolom lengkap.
//
// Kata kunci DIBERIKAN sebagai argumen baris perintah, bukan ditulis di
// dalam berkas ini. Alasannya: nilai-nilai sheet produksi (kategori,
// deskripsi) tidak boleh ikut ter-commit ke repo publik. Kalau kata kuncinya
// ditulis di sini, dia akan ikut ter-push bersama repo.
//
// CATATAN: jangan pernah menulis kata kunci, nama kategori, atau nama produk
// nyata sebagai contoh di berkas ini - contoh pun akan ikut ter-push. Pakai
// placeholder.
//
//   node tests/cari-cd.mjs <kata-kunci>
//   node tests/cari-cd.mjs "dua kata" --semua
//   node tests/cari-cd.mjs <kata-kunci> --tanpa-nominal
//
// Opsi:
//   --semua   pindai ketiga snapshot, bukan hanya Credit/Debit
//   --tanpa-nominal  jangan tampilkan kolom nominal
//
// Memerlukan tests/fixtures/ (gitignored), jadi tidak bisa jalan di clone
// baru. Bukan bagian dari gerbang tests/jalankan-semua.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR_FIX = path.join(AKAR, 'tests', 'fixtures');
const HURUF = (i) => String.fromCharCode(65 + i);

const SNAP_DEFAULT = 'snapshot-CreditDebit.csv';
const SNAP_SEMUA = [
  'snapshot-CreditDebit.csv',
  'snapshot-Penjualan.csv',
  'snapshot-Produk.csv',
];

function parseCsv(t) {
  const rows = [];
  let row = [];
  let f = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') { f += '"'; i++; } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

// Nilai rupiah di sheet ini bertipe TEKS, jadi harus dibersihkan dulu sebelum
// dihitung. Tanpa ini kolom nominal akan terbaca 0.
const KE_RUPIAH = (v) => String(v).replace(/^rp\s*/i, '').replace(/[.,]/g, '');
const sebagaiRupiah = (v) => {
  const n = Number(KE_RUPIAH(v));
  return Number.isFinite(n) ? 'Rp' + Math.round(n).toLocaleString('id-ID') : '(bukan angka)';
};

const argv = process.argv.slice(2);
const pakaiSemua = argv.includes('--semua');
const tanpaNominal = argv.includes('--tanpa-nominal');
const kata = argv.filter((a) => !a.startsWith('--')).join(' ').trim();

if (!kata) {
  console.log('Kata kunci belum diberikan. Contoh:');
  console.log('  node tests/cari-cd.mjs <kata>');
  console.log('  node tests/cari-cd.mjs <kata> --semua');
  process.exit(2);
}

const pola = new RegExp(kata.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
const target = pakaiSemua ? SNAP_SEMUA : [SNAP_DEFAULT];
let total = 0;
let totalBaris = 0;

for (const nama of target) {
  const p = path.join(DIR_FIX, nama);
  if (!fs.existsSync(p)) {
    console.log('SNAPSHOT TIDAK ADA  ' + nama + '  (lewati)');
    continue;
  }
  const rows = parseCsv(fs.readFileSync(p, 'utf8'));
  const header = rows[0] || [];
  // Kolom nominal dicari dari header, bukan dikodekan posisinya.
  const idxNominal = header.findIndex((h) => /nominal/i.test(String(h)));

  const kena = [];
  for (let r = 1; r < rows.length; r++) {
    const gab = header.map((_, c) => String(rows[r][c] || '')).join(' ');
    if (pola.test(gab)) kena.push(r);
  }

  console.log('=== ' + nama + ' ===');
  console.log('  kata kunci: "' + kata + '"   baris cocok: ' + kena.length);
  if (kena.length === 0) { console.log(''); continue; }
  for (const r of kena) {
    totalBaris++;
    console.log('  -- baris sheet ' + (r + 1) + '  (sel di kolom ' + HURUF(idxNominal) + ')');
    header.forEach((h, c) => {
      const v = String(rows[r][c] || '');
      const kolom = HURUF(c) + '  ' + String(h).padEnd(20) + ' = ' + JSON.stringify(v);
      if (!tanpaNominal && c === idxNominal) {
        console.log('      ' + kolom);
        console.log('        -> dibaca sebagai rupiah: ' + sebagaiRupiah(v));
      } else {
        console.log('      ' + kolom);
      }
    });
    console.log('');
  }
  total += kena.length;
}

console.log('RINGKASAN: ' + total + ' baris cocok dari ' + totalBaris + ' baris di ' + target.length + ' snapshot');
if (total === 0) {
  console.log('Tidak ada baris yang memuat kata itu. Salah eja, atau kata tidak ada di snapshot ini.');
}
console.log('Tidak ada yang ditulis ke sheet mana pun.');
