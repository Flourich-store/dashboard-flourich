// Target: baris dengan kode DI DALAM KOMENTAR (proses edit manual yang menyelinap).
// Pola: setelah '//' ada pernyataan yang terlihat seperti kode DAN baris diakhiri ';'/'{'/'}'.
//
// Ini persis kelas bug yang dulu mematikan addPenjualan: di Code.gs satu baris
// `var hpp = _resolveHpp(...)` ikut tertelan baris komentar di atasnya, jadi
// hpp tidak pernah dideklarasi dan ReferenceError ditangkap jadi pesan error.
//
// Memindai KEDUA file (Code.gs dan DashboardStandalone.html), dan keluar dengan
// kode bukan-nol bila ada temuan supaya bisa dipakai sebagai gerbang tes.
import fs from 'node:fs';
import path from 'node:path';
import { akarRepo } from './lib/jalur.mjs';

const kode = /\b(var|let|const|return|if|for|while|throw)\b\s*[A-Za-z_(]/;

let total = 0;
// Argumen opsional = pindai hanya berkas itu (untuk menguji salinan/mutasi).
const berkas = process.argv[2]
  ? [process.argv[2]]
  : ['Code.gs', 'DashboardStandalone.html'].map((n) => path.join(akarRepo, n));

for (const file of berkas) {
  const nama = path.basename(file);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const temuan = [];
  lines.forEach((ln, i) => {
    const c = ln.indexOf('//');
    if (c <= 0) return;
    const ekor = ln.slice(c + 2);
    if (!kode.test(ekor)) return;
    if (!/[;{}]\s*$/.test(ln.trim()) && !/\)\s*$/.test(ln.trim())) return;
    temuan.push('   baris ' + (i + 1) + ': ' + ln.trim());
  });
  total += temuan.length;
  console.log((temuan.length ? 'DITEMUKAN ' : 'BERSIH    ') + nama + ' (' + temuan.length + ' baris)');
  for (const t of temuan) console.log(t);
}

console.log('');
if (total === 0) {
  console.log('BERSIH: tidak ada kode tertelan komentar pada ' + berkas.length + ' berkas yang dipindai.');
  process.exit(0);
}
console.log('GAGAL: ' + total + ' baris suspect. Periksa manual sebelum commit.');
process.exit(1);
