// Tes regresi: keselarasan dan sinkronisasi tema landing page dengan dashboard
//
// Aturan yang dikunci:
//   1. landingpage.html memiliki tombol .theme-toggle di navbar.
//   2. landingpage.html memiliki script inisialisasi awal dash_theme di head.
//   3. landingpage.html memiliki fungsi toggleLandingTheme & applyLandingThemeIcons.
//   4. landingpage.html mendengarkan pesan flourich-theme dari luar/induk.
//   5. Aturan tema gelap di landingpage.html berada di dalam scope html.theme-dark / body.dark-mode
//      sehingga tema terang tidak tertimpa secara permanen.
//   6. index.html meneruskan pesan flourich-theme ke frame anak (landing & dashboard).
//
//   node tests/tema-landing.test.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const diSini = path.dirname(fileURLToPath(import.meta.url));
const AKAR = path.resolve(diSini, '..');
const LANDING = fs.readFileSync(path.join(AKAR, 'landingpage.html'), 'utf8');
const INDEX = fs.readFileSync(path.join(AKAR, 'index.html'), 'utf8');

let lulus = 0;
const gagal = [];
function uji(nama, fn) {
  try { fn(); lulus++; console.log('  LULUS  ' + nama); }
  catch (e) { gagal.push(nama + ' :: ' + e.message); console.log('  GAGAL  ' + nama + ' :: ' + e.message); }
}
function benar(v, pesan) { if (!v) throw new Error(pesan || 'harus bernilai true'); }

// --- 1. Tombol toggle tema di landing page ---------------------------------
uji('landingpage.html punya tombol .theme-toggle', () => {
  benar(/class=["'][^"']*theme-toggle[^"']*["']/.test(LANDING), 'tombol .theme-toggle tidak ditemukan di navbar landing page');
  benar(/toggleLandingTheme\(\)/.test(LANDING), 'tombol tidak memanggil toggleLandingTheme()');
});

// --- 2. Inisialisasi awal di head -----------------------------------------
uji('landingpage.html membaca dash_theme di head sebelum render', () => {
  const head = LANDING.slice(0, LANDING.indexOf('</head>'));
  benar(/localStorage\.getItem\(['"]dash_theme['"]\)/.test(head), 'head tidak membaca dash_theme');
  benar(/classList\.add\(['"]theme-dark['"]/.test(head), 'head tidak menerapkan class theme-dark');
});

// --- 3. Fungsi toggle dan listener pesan ----------------------------------
uji('landingpage.html memiliki fungsi toggle dan pendengar pesan flourich-theme', () => {
  benar(/function\s+toggleLandingTheme\s*\(/.test(LANDING), 'fungsi toggleLandingTheme tidak ditemukan');
  benar(/function\s+applyLandingThemeIcons\s*\(/.test(LANDING), 'fungsi applyLandingThemeIcons tidak ditemukan');
  benar(/event\.data\.type\s*===\s*['"]flourich-theme['"]/.test(LANDING), 'pendengar event flourich-theme tidak ditemukan');
});

// --- 4. Scoping tema gelap ------------------------------------------------
uji('aturan tema gelap di landingpage.html ber-scope html.theme-dark atau body.dark-mode', () => {
  const i = LANDING.indexOf('DARK MODERN THEME OVERRIDE');
  benar(i > 0, 'komentar penanda tema gelap tidak ditemukan');
  const blokGelap = LANDING.slice(i, LANDING.indexOf('</style>', i));
  benar(/html\.theme-dark\s+body/i.test(blokGelap), 'background-color gelap body tidak memiliki scope html.theme-dark');
  benar(!/^\s*body\s*\{/m.test(blokGelap), 'masih ada selector body tanpa scope yang menimpa light mode');
});

// --- 5. Relay pesan di index.html -----------------------------------------
uji('index.html meneruskan pesan tema ke frame landing dan dashboard', () => {
  benar(/landingFrame\.contentWindow\.postMessage/.test(INDEX), 'index.html tidak meneruskan tema ke landingFrame');
  benar(/dashFrame\.contentWindow\.postMessage/.test(INDEX), 'index.html tidak meneruskan tema ke dashFrame');
});

console.log('');
if (gagal.length) {
  console.log('=== ' + gagal.length + ' DARI ' + (lulus + gagal.length) + ' TEST GAGAL ===');
  for (const g of gagal) console.log('  - ' + g);
  process.exit(1);
}
console.log('=== SEMUA LOLOS (' + lulus + ' tes) ===');
