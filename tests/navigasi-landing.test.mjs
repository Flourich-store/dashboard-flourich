// Tes regresi: tombol "Kembali ke Landing Page" harus benar-benar pindah.
//
// Temuan 7 Nov 2026: tombol di halaman login tidak bereaksi sama sekali.
// Penyebabnya BUKAN CSS/markup, melainkan dua deklarasi global dengan nama
// sama: goToLandingPage() didefinisikan dua kali di DashboardStandalone.html.
// Deklarasi di blok <script> terakhir menimpa yang pertama. Versi yang menang
// memanggil window.parent.postMessage('flourich-landing'); di Apps Script
// window.parent adalah frame internal userCodeAppPanel yang tidak punya
// pendengar pesan, jadi pesannya dibuang dan tombol tampak mati.
//
// Aturan yang dikunci:
//   1. Hanya ada SATU deklarasi goToLandingPage (tidak ada duplikat).
//   2. Fungsi mengarahkan frame paling atas ke landing page (bukan postMessage
//      ke window.parent yang hilang di dalam Apps Script).
//   3. Tombol login benar-benar memanggil fungsi itu.
//
//   node tests/navigasi-landing.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const diSini = path.dirname(fileURLToPath(import.meta.url));
const AKAR = path.resolve(diSini, '..');
const HTML = path.join(AKAR, 'DashboardStandalone.html');
const html = fs.readFileSync(HTML, 'utf8');

let lulus = 0;
const gagal = [];
function uji(nama, fn) {
  try { fn(); lulus++; console.log('  LULUS  ' + nama); }
  catch (e) { gagal.push(nama + ' :: ' + e.message); console.log('  GAGAL  ' + nama + ' :: ' + e.message); }
}
function benar(v, pesan) { if (!v) throw new Error(pesan || 'harus bernilai true'); }

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

const LANDING = 'https://flourich-store.github.io/dashboard-flourich/#beranda';

// --- 1. tidak ada deklarasi ganda -----------------------------------------
uji('hanya ada satu deklarasi goToLandingPage', () => {
  const jumlah = (html.match(/function\s+goToLandingPage\s*\(/g) || []).length;
  benar(jumlah === 1, 'ditemukan ' + jumlah + ' deklarasi; harus 1 (duplikat menimpa versi yang benar)');
});

// --- 2. tombol login memanggil fungsi --------------------------------------
uji('tombol login memanggil goToLandingPage()', () => {
  const tombol = html.match(/<button[^>]+id=["']loginLandingButton["'][^>]*>/i);
  benar(tombol, 'button#loginLandingButton tidak ditemukan');
  benar(/onclick=["']goToLandingPage\(\)["']/i.test(tombol[0]), 'tombol tidak memanggil goToLandingPage()');
});

// --- 2b. proporsi: tautan kecil di bawah kartu, bukan tombol selebar "Masuk"
uji('tombol kembali berada di luar form (di bawah kartu)', () => {
  const buka = html.indexOf('id="loginForm"');
  const tutup = html.indexOf('</form>', buka);
  benar(buka > 0 && tutup > buka, 'form login tidak ditemukan');
  const dalamForm = html.slice(buka, tutup);
  benar(!/id=["']loginLandingButton["']/.test(dalamForm), 'tombol kembali masih di dalam form; pindahkan ke bawah kartu');
  const sesudah = html.slice(tutup);
  benar(/id=["']loginLandingButton["']/.test(sesudah.slice(0, 400)), 'tombol kembali harus tepat setelah penutup form');
});

uji('gaya .login-back kecil dan tidak selebar kartu', () => {
  const m = html.match(/\.login-back\s*\{([\s\S]*?)\}/);
  benar(m, 'rule .login-back tidak ditemukan');
  const css = m[1];
  const ukuran = css.match(/font-size:\s*([\d.]+)px/);
  benar(ukuran, 'harus punya font-size eksplisit');
  benar(Number(ukuran[1]) <= 13, 'font-size harus <= 13px, dapat ' + ukuran[1] + 'px');
  benar(!/width:\s*100%/.test(css), 'tidak boleh width:100% (jangan sama dengan tombol Masuk)');
  benar(/background:\s*(none|transparent)/i.test(css), 'latar harus transparan agar terbaca sebagai tautan, bukan tombol kedua');
});

// --- 3. fungsi mengarahkan frame paling atas -------------------------------
uji('fungsi memakai window.top.location.href ke landing page', () => {
  const fungsi = potongFungsi(html, 'function goToLandingPage');
  // Abaikan komentar: yang diperiksa adalah kode yang benar-benar jalan.
  const kode = fungsi
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  benar(/window\.top\.location\.href\s*=/.test(kode), 'harus mengarahkan window.top.location.href');
  benar(kode.includes(LANDING), 'URL tujuan harus ' + LANDING);
  benar(!/postMessage/.test(kode), 'tidak boleh postMessage ke window.parent (hilang di dalam Apps Script)');
});

// --- 4. uji perilaku fungsi asli -------------------------------------------
uji('saat dijalankan, frame atas diarahkan ke landing', () => {
  const fungsi = potongFungsi(html, 'function goToLandingPage');
  const sandbox = { window: { top: { location: { href: 'https://script.google.com/macros/s/UJI/exec' } } } };
  vm.runInNewContext(fungsi + '\nthis.jalankan = goToLandingPage;', sandbox);
  sandbox.jalankan();
  const tujuan = sandbox.window.top.location.href;
  benar(tujuan === LANDING, 'href frame atas harus ' + LANDING + ', dapat ' + tujuan);
});

// --- laporan ---------------------------------------------------------------
console.log('');
if (gagal.length) {
  console.log('=== ' + gagal.length + ' DARI ' + (lulus + gagal.length) + ' TEST GAGAL ===');
  for (const g of gagal) console.log('  - ' + g);
  process.exit(1);
}
console.log('=== SEMUA LOLOS (' + lulus + ' tes) ===');
