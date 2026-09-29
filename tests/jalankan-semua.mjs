// Jalankan seluruh gerbang tes repo ini dalam satu perintah.
//
//   node tests/jalankan-semua.mjs           ringkas (baris ringkasan per cek)
//   node tests/jalankan-semua.mjs --lengkap cetak semua output
//
// KODE KELUAR: 0 bila semua lulus, 1 bila ada yang gagal. Semua tes di folder
// ini sengaja tidak memakai framework: cukup `node <file>` tanpa dependensi.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const diSini = path.dirname(fileURLToPath(import.meta.url));
const lengkap = process.argv.includes('--lengkap');

const CEK = [
  { nama: 'add-penjualan',        file: 'add-penjualan.test.mjs',        soal: 'addPenjualan: baris tersimpan, HPP, qty 0 ditolak (Code.gs:960)' },
  { nama: 'p2-nilai-stok',        file: 'p2-nilai-stok.test.mjs',        soal: 'Nilai Stok identik antara getProdukList dan getNilaiStok' },
  { nama: 'perf-p1',              file: 'perf-p1.test.mjs',              soal: 'invariant performa frontend (satu panggilan per muat)' },
  { nama: 'login-theme',          file: 'login-theme.test.mjs',          soal: 'warna kartu login ikut tema terang/gelap' },
  { nama: 'responsive-mobile',    file: 'responsive-mobile.test.mjs',    soal: 'tata letak layar kecil' },
  { nama: 'mutasi-perf12',        file: 'mutasi-perf12.mjs',             soal: 'assertion perf benar-benar menangkap pelanggaran' },
  { nama: 'cek-statis',           file: 'cek-statis.mjs',                soal: 'sintaks blok script + daftar nama fungsi' },
  { nama: 'sapaan-komentar',      file: 'sapaan-komentar.mjs',           soal: 'kode yang tertelan komentar' },
  { nama: 'sapaan-identitas',     file: 'sapaan-identitas.mjs',          soal: 'identifier dipakai tanpa deklarasi' },
  { nama: 'histogram-karakter',   file: 'histogram-karakter.mjs',        soal: 'karakter asing baru yang menyelinap' }
];

const bersihkan = (s) => s.replace(/\u001b\[[0-9;]*m/g, '').replace(/\r/g, '');

function ringkas(teks) {
  const baris = bersihkan(teks).split('\n').map((b) => b.trim()).filter((b) => b !== '');
  // Cari baris ringkasan: yang memuat jumlah lulus/gagal.
  const jumlah = baris.find((b) => /lulus,\s*\d+\s+gagal/i.test(b) || /DARI\s+\d+\s+TEST\s+GAGAL/i.test(b));
  if (jumlah) return jumlah;
  const baik = baris.find((b) => /SEMUA LOLOS|BERSIH|mutasi tertangkap/i.test(b));
  if (baik) return baik;
  return baris.length ? baris[baris.length - 1] : '(tanpa output)';
}

let gagal = 0;
const hasil = [];
for (const c of CEK) {
  const jalankan = spawnSync(process.execPath, [path.join(diSini, c.file)], { encoding: 'utf8' });
  const out = (jalankan.stdout || '') + (jalankan.stderr || '');
  const kode = jalankan.status === null ? 1 : jalankan.status;
  const lulus = kode === 0;
  if (!lulus) gagal++;
  hasil.push({ cek: c, lulus, kode, out, ringkas: ringkas(out) });
}

console.log('=== GERBANG TES FLOURICH DASHBOARD ===');
console.log('');
for (const h of hasil) {
  console.log((h.lulus ? 'LULUS  ' : 'GAGAL  ') + h.cek.nama.padEnd(19) + h.ringkas);
  console.log('       ' + h.cek.soal);
  if (!h.lulus || lengkap) {
    for (const b of bersihkan(h.out).split('\n')) if (b.trim() !== '') console.log('       | ' + b);
  }
  console.log('');
}

const total = hasil.length;
console.log('=== ' + (total - gagal) + '/' + total + ' cek lulus ===');
process.exit(gagal === 0 ? 0 : 1);
