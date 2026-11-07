// Tes regresi: tombol "Masuk ke Dashboard" di landing page harus bisa diklik.
//
// Temuan 7 Nov 2026: di layar HP (lebar sempit) tombol utama "Masuk ke
// Dashboard" tidak bereaksi. Logika goToLogin() sendiri benar; masalahnya
// hit-testing: lingkaran dekoratif .hero::before (420x420, right:-190px)
// berada DI ATAS tombol karena pseudo-element berposisi absolute ikut
// menangkap sentuhan. Di desktop lingkarannya jauh di kanan sehingga tidak
// terasa; di HP tombolnya melebar penuh sehingga tertutup.
//
// Aturan yang dikunci:
//   1. Pseudo-element dekoratif (.hero::before, .cta::after) tidak boleh
//      menangkap sentuhan: pointer-events:none.
//   2. goToLogin hanya dideklarasikan sekali.
//   3. Jalur pesan ke induk SPA tetap ada (flourich-dashboard).
//
//   node tests/tombol-landing.test.mjs
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

function aturan(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(esc + '\\s*\\{([\\s\\S]*?)\\}'));
  return m ? m[1] : null;
}

function potongFungsi(src, penanda) {
  const i = src.indexOf(penanda);
  if (i < 0) throw new Error('fungsi tidak ditemukan: ' + penanda);
  const buka = src.indexOf('{', i);
  let depth = 0;
  for (let k = buka; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('kurung kurawal tidak seimbang: ' + penanda);
}

// --- 1. pseudo-element dekoratif tidak menangkap sentuhan -------------------
for (const sel of ['.hero::before', '.cta::after']) {
  uji(sel + ' punya pointer-events:none', () => {
    const isi = aturan(LANDING, sel);
    benar(isi, 'rule ' + sel + ' tidak ditemukan');
    benar(/pointer-events\s*:\s*none/i.test(isi), sel + ' harus pointer-events:none, kalau tidak ia menutupi tombol');
  });
}

// --- 2. tidak ada deklarasi ganda -----------------------------------------
uji('goToLogin hanya dideklarasikan sekali', () => {
  const jumlah = (LANDING.match(/function\s+goToLogin\s*\(/g) || []).length;
  benar(jumlah === 1, 'ditemukan ' + jumlah + ' deklarasi goToLogin');
});

// --- 3. jalur navigasi ke dashboard tetap utuh ----------------------------
uji('goToLogin mengirim flourich-dashboard saat di dalam iframe', () => {
  const isi = potongFungsi(LANDING, 'function goToLogin');
  benar(/postMessage\(\s*\{\s*type:\s*['"]flourich-dashboard['"]/.test(isi), 'harus mengirim pesan flourich-dashboard ke induk');
  benar(/window\.open\([^)]*'_top'\)/.test(isi), 'saat berdiri sendiri harus membuka dashboard di frame atas');
});

uji('index.html menerima flourich-dashboard dari landing dan pindah tampilan', () => {
  benar(/flourich-dashboard/.test(INDEX), 'index.html tidak menangani pesan flourich-dashboard');
  benar(/switchView\(\s*['"]dashboard['"]\s*\)/.test(INDEX), 'harus memanggil switchView(dashboard)');
});

// --- laporan ---------------------------------------------------------------
console.log('');
if (gagal.length) {
  console.log('=== ' + gagal.length + ' DARI ' + (lulus + gagal.length) + ' TEST GAGAL ===');
  for (const g of gagal) console.log('  - ' + g);
  process.exit(1);
}
console.log('=== SEMUA LOLOS (' + lulus + ' tes) ===');
