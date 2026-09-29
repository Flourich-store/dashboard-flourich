// Lokasi file yang diuji. Semua tes memakai helper ini supaya bisa dijalankan
// tanpa argumen dari folder mana pun:
//
//   node tests/perf-p1.test.mjs
//   node tests/add-penjualan.test.mjs            (Code.gs + DashboardStandalone.html)
//
// Argumen eksplisit tetap dihormati (berguna saat menguji salinan file).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// tests/lib/jalur.mjs -> tests/lib -> tests -> akar repo
export const akarRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const diRepo = (nama) => path.join(akarRepo, nama);

/** Target untuk tes sisi server saja (Code.gs). */
export const targetGas = () => process.argv[2] || diRepo('Code.gs');

/** Target untuk tes sisi klien saja (DashboardStandalone.html). */
export const targetHtml = () => process.argv[2] || diRepo('DashboardStandalone.html');

/**
 * Target untuk tes dua file: argumen 1 = Code.gs, argumen 2 = HTML.
 * Argumen opsional tetap dipakai kalau diberikan, sehingga tes yang hanya satu
 * target tidak salah mengambil argv[2] miliknya sendiri sebagai HTML.
 */
export const targetGasDanHtml = () => ({
  gas: process.argv[2] || diRepo('Code.gs'),
  html: process.argv[3] || diRepo('DashboardStandalone.html')
});

/** Keluar dengan pesan jelas kalau argumen wajib tidak ada. */
export function wajibArgumen(kebutuhan) {
  console.error('Butuh argumen: ' + kebutuhan);
  process.exit(2);
}
