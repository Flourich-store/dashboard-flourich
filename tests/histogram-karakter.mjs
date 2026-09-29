// Bandingkan himpunan karakter file sekarang vs HEAD untuk mendeteksi
// karakter asing yang tidak sengaja masuk ke teks yang diketik/diedit.
//
// Kenapa perlu: beberapa kali karakter non-ASCII (mis. satu ideogram CJK) dan
// kata Inggris yang tersisip menyelinap ke komentar dan pesan commit di repo ini.
// Karakter baru yang belum pernah ada di HEAD hampir selalu salah.
//
// KODE KELUAR: bukan-nol bila ada karakter baru (harus ditinjau manual lebih
// dulu, bukan otomatis dianggap benar).
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { akarRepo } from './lib/jalur.mjs';

const dir = process.argv[2] || akarRepo;
const daftar = ['Code.gs', 'DashboardStandalone.html'];

let baruTotal = 0;
for (const f of daftar) {
  let head;
  try {
    head = cp.execSync('git show HEAD:' + f, { cwd: dir, maxBuffer: 1e9 }).toString('utf8');
  } catch (e) {
    console.log(f + ' : lewati (belum ada di HEAD)');
    continue;
  }
  const now = fs.readFileSync(path.join(dir, f), 'utf8');
  const h1 = new Set(head);
  const h2 = new Set(now);
  const baru = [...h2].filter((c) => !h1.has(c) && c.charCodeAt(0) > 32);
  baruTotal += baru.length;
  const fmt = (a) =>
    a.length ? a.map((c) => JSON.stringify(c) + ' (U+' + c.charCodeAt(0).toString(16).toUpperCase() + ')').join(' ') : 'tidak ada';
  console.log(f);
  console.log('   karakter baru : ' + fmt(baru));
}

console.log('');
if (baruTotal === 0) {
  console.log('BERSIH: tidak ada karakter asing yang baru muncul.');
  process.exit(0);
}
console.log('PERIKAT: ' + baruTotal + ' karakter baru. Tinjau apakah benar-benar disengaja.');
process.exit(1);
