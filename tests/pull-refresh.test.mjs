// Tes tarik-untuk-menyegarkan (pull-to-refresh) di DashboardStandalone.html.
//
// Kenapa fitur ini dibuat: di HP, Chrome tidak lagi menyediakan gestur refresh
// untuk halaman ini karena scroll-nya ada di dalam .app-shell, bukan di
// dokumen. Jadi gestur buatan sendiri + muat ulang lewat frame paling atas.
//
// Yang dikunci tes ini:
//   1. Indikator tarik ada (markup + CSS) dan tidak menangkap klik.
//   2. Ambang tarik 70 px, jarak visual dibatasi 96 px.
//   3. Gestur memakai touchstart/touchmove/touchend + preventDefault saat
//      benar-benar menarik, supaya tidak ikut menggulir di tengah gestur.
//   4. Menyegarkan TIDAK memindahkan frame atas ke URL /exec dan TIDAK
//      menyentuh sesi login. Dulu window.top.location.href = getAppUrl(...)
//      memuat ulang seluruh aplikasi Apps Script sehingga iframe dibuat ulang
//      dan user dipaksa login ulang. location.reload() tetap dilarang karena
//      merusak iframe (/blank).
//   5. Penyegaran membuang cache laporan lalu memuat ulang data seksi yang
//      sedang aktif (Overview/Penjualan/Grafik/Produk/Bahan).
//   6. Gestur tidak aktif di halaman login dan saat ada modal terbuka.
//
// Tidak membaca data produksi: aman dijalankan di repo publik.
//
//   node tests/pull-refresh.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const diSini = path.dirname(fileURLToPath(import.meta.url));
const AKAR = path.resolve(diSini, '..');
const HTML = path.join(AKAR, 'DashboardStandalone.html');
const GS = path.join(AKAR, 'Code.gs');

let lulus = 0;
const gagal = [];
function uji(nama, fn) {
  try { fn(); lulus++; console.log('  LULUS  ' + nama); }
  catch (e) { gagal.push(nama + ' :: ' + e.message); console.log('  GAGAL  ' + nama + ' :: ' + e.message); }
}
function benar(v, pesan) { if (!v) throw new Error(pesan || 'harus bernilai true'); }
function eq(didapat, harap, pesan) {
  const a = JSON.stringify(didapat), b = JSON.stringify(harap);
  if (a !== b) throw new Error((pesan || '') + ' harap ' + b + ', dapat ' + a);
}

// Potong satu fungsi utuh dari sumber dengan menghitung kurung kurawal,
// supaya tes menguji KODE YANG ADA DI HTML, bukan salinan yang bisa basi.
function potongFungsi(src, penanda) {
  const i = src.indexOf(penanda);
  if (i < 0) throw new Error('fungsi tidak ditemukan di HTML: ' + penanda);
  const buka = src.indexOf('{', i);
  let depth = 0;
  for (let k = buka; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('kurung kurawal tidak seimbang: ' + penanda);
}

const html = fs.readFileSync(HTML, 'utf8');
const gs = fs.readFileSync(GS, 'utf8');
const cssDanMarkup = html.slice(0, html.indexOf('<script src="https://www.gstatic.com/charts/loader.js"'));

// ---------------------------------------------------------------
// 1. Indikator: markup + CSS
// ---------------------------------------------------------------
uji('markup indikator #pullRefresh ada', () => {
  benar(/<div[^>]+id=["']pullRefresh["']/i.test(html), 'div#pullRefresh tidak ditemukan');
  benar(/id=["']pullRefreshText["']/i.test(html), 'teks indikator #pullRefreshText tidak ada');
});

uji('CSS .pull-refresh ada dan tidak menangkap sentuhan', () => {
  const blok = cssDanMarkup.match(/\.pull-refresh\s*\{[\s\S]*?\}/);
  benar(blok, 'rule .pull-refresh tidak ditemukan');
  benar(/position:\s*fixed/i.test(blok[0]), '.pull-refresh harus position fixed');
  benar(/pointer-events:\s*none/i.test(blok[0]), '.pull-refresh harus pointer-events none');
});

uji('indikator punya keadaan tersembunyi (opacity 0)', () => {
  const blok = cssDanMarkup.match(/\.pull-refresh\s*\{[\s\S]*?\}/);
  benar(/opacity:\s*0\b/i.test(blok[0]), 'indikator harus opacity 0 saat diam');
});

// ---------------------------------------------------------------
// 2. Ambang dan batas jarak
// ---------------------------------------------------------------
uji('ambang tarik = 70 px, batas visual = 96 px', () => {
  benar(/var\s+PULL_AMBANG\s*=\s*70\s*;/.test(html), 'PULL_AMBANG harus 70');
  benar(/var\s+PULL_MAKS\s*=\s*96\s*;/.test(html), 'PULL_MAKS harus 96');
});

uji('hitungTarikSegarkan: jarak, batas, dan status siap', () => {
  const konstanta = html.match(/var\s+PULL_AMBANG\s*=\s*70\s*;/)[0] + '\n' +
    html.match(/var\s+PULL_MAKS\s*=\s*96\s*;/)[0];
  const fungsi = potongFungsi(html, 'function hitungTarikSegarkan');
  const sandbox = {};
  vm.runInNewContext(konstanta + '\n' + fungsi + '\nthis.hitung = hitungTarikSegarkan;', sandbox);
  const hitung = sandbox.hitung;

  eq(hitung(0), { jarak: 0, siap: false }, 'tarik 0 px');
  eq(hitung(-40), { jarak: 0, siap: false }, 'tarik ke atas (negatif)');
  eq(hitung(40), { jarak: 40, siap: false }, 'tarik 40 px');
  eq(hitung(69), { jarak: 69, siap: false }, 'tarik 69 px (di bawah ambang)');
  eq(hitung(70), { jarak: 70, siap: true }, 'tarik 70 px (tepat ambang)');
  eq(hitung(150), { jarak: 96, siap: true }, 'tarik 150 px dibatasi 96');
});

// ---------------------------------------------------------------
// 3. Gestur sentuh
// ---------------------------------------------------------------
uji('gestur memakai touchstart/touchmove/touchend', () => {
  benar(/addEventListener\(\s*['"]touchstart['"]/.test(html), 'touchstart tidak terpasang');
  benar(/addEventListener\(\s*['"]touchmove['"]/.test(html), 'touchmove tidak terpasang');
  benar(/addEventListener\(\s*['"]touchend['"]/.test(html), 'touchend tidak terpasang');
});

uji('touchmove mendaftar non-passive dan memanggil preventDefault', () => {
  const pasang = potongFungsi(html, 'function pasangTarikSegarkan');
  benar(/touchmove/.test(pasang), 'pasangTarikSegarkan tidak memasang touchmove');
  benar(/passive\s*:\s*false/.test(pasang), 'touchmove harus { passive: false }');
  const gerak = potongFungsi(html, 'function gerakTarik');
  benar(/preventDefault\s*\(/.test(gerak), 'gerakTarik harus preventDefault saat menarik');
});

uji('hanya aktif saat wadah gulir di posisi paling atas', () => {
  const mulai = potongFungsi(html, 'function mulaiTarik');
  benar(/posisiGulirAtas\s*\(/.test(mulai), 'mulaiTarik harus memeriksa posisiGulirAtas()');
  const gerak = potongFungsi(html, 'function gerakTarik');
  benar(/posisiGulirAtas\s*\(/.test(gerak), 'gerakTarik harus berhenti bila sudah tidak di atas');
});

uji('tidak aktif di halaman login dan saat modal terbuka', () => {
  const boleh = potongFungsi(html, 'function bolehTarikSegarkan');
  benar(/loginPage/.test(boleh), 'harus memeriksa #loginPage');
  benar(/modal/.test(boleh), 'harus memeriksa modal yang terbuka');
});

// ---------------------------------------------------------------
// 4. Cara menyegarkan: data dimuat ulang DI TEMPAT (tanpa navigasi)
// ---------------------------------------------------------------
uji('menyegarkan tidak memindahkan frame atas ke URL /exec', () => {
  const muat = potongFungsi(html, 'function muatUlangAplikasi');
  benar(!/window\.top\.location/.test(muat), 'tidak boleh mengarahkan window.top.location: seluruh app dimuat ulang dan sesi login hilang');
  benar(!/location\.href\s*=/.test(muat), 'tidak boleh mengubah location.href saat menyegarkan');
  benar(!/getAppUrl/.test(muat), 'tidak boleh meminta URL /exec dari server untuk navigasi');
});

uji('sesi login tidak disentuh saat menyegarkan', () => {
  const muat = potongFungsi(html, 'function muatUlangAplikasi');
  benar(!/clearSessionState|logout\s*\(|sessionStorage\.removeItem|dash_token/.test(muat),
    'penyegaran tidak boleh menghapus sesi/token (penyebab login ulang)');
});

uji('TIDAK memakai location.reload() (terbukti merusak iframe)', () => {
  // Abaikan komentar: yang dilarang adalah PEMANGGILAN, bukan penjelasan.
  const kodeSaja = html
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  benar(!/location\.reload\s*\(/.test(kodeSaja), 'location.reload() dipanggil lagi di HTML');
});

uji('menyegarkan membuang cache lalu memuat ulang data dari server', () => {
  const muat = potongFungsi(html, 'function muatUlangAplikasi');
  benar(/batalkanCacheLaporan\s*\(/.test(muat), 'cache laporan harus dibuang supaya data benar-benar diambil ulang');
  benar(/loadReport\s*\(/.test(muat), 'Overview harus memuat ulang laporan');
});

uji('menyegarkan mengikuti seksi yang sedang aktif', () => {
  const muat = potongFungsi(html, 'function muatUlangAplikasi');
  benar(/seksiAktifUntukSegarkan\s*\(/.test(muat), 'harus memakai seksiAktifUntukSegarkan()');
  benar(/section-produk[\s\S]*?muatProdukSekali\s*\(/.test(muat), 'tab Produk harus memuat ulang produk');
  benar(/section-bahan[\s\S]*?muatBahanSekali\s*\(/.test(muat), 'tab Bahan harus memuat ulang bahan');
  benar(/section-penjualan[\s\S]*?loadSalesByDateRange\s*\(/.test(muat), 'tab Penjualan harus memuat ulang tabel');
  benar(/section-chart[\s\S]*?loadChartByDateRange\s*\(/.test(muat), 'tab Grafik harus memuat ulang grafik');
});

uji('getAppUrl() di server tetap tersedia sebagai API (bukan jalur refresh)', () => {
  const fungsi = potongFungsi(gs, 'function getAppUrl');
  benar(/ScriptApp\.getService\(\)\.getUrl\(\)/.test(fungsi), 'getAppUrl harus mengembalikan ScriptApp.getService().getUrl()');
});

// ---------------------------------------------------------------
// 5. Sisi server
// ---------------------------------------------------------------
uji('Code.gs menyediakan getAppUrl() berbasis ScriptApp', () => {
  const fungsi = potongFungsi(gs, 'function getAppUrl');
  benar(/ScriptApp\.getService\(\)\.getUrl\(\)/.test(fungsi), 'getAppUrl harus mengembalikan ScriptApp.getService().getUrl()');
  benar(/page=/.test(fungsi), 'getAppUrl harus menambahkan parameter page supaya bukan landing page');
  benar(/encodeURIComponent/.test(fungsi), 'parameter page harus di-encode');
});

uji('getAppUrl: gabung parameter dengan benar (uji fungsi asli)', () => {
  const fungsi = potongFungsi(gs, 'function getAppUrl');
  const sandbox = {
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/UJI/exec' }) },
    encodeURIComponent
  };
  vm.runInNewContext(fungsi + '\nthis.getAppUrl = getAppUrl;', sandbox);
  eq(sandbox.getAppUrl('dashboard'), 'https://script.google.com/macros/s/UJI/exec?page=dashboard', 'tanpa query');
  sandbox.ScriptApp = { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/UJI/exec?x=1' }) };
  vm.runInNewContext(fungsi + '\nthis.getAppUrl = getAppUrl;', sandbox);
  eq(sandbox.getAppUrl('dashboard'), 'https://script.google.com/macros/s/UJI/exec?x=1&page=dashboard', 'sudah ada query');
  eq(sandbox.getAppUrl(''), 'https://script.google.com/macros/s/UJI/exec?x=1', 'tanpa page');
});

// ---------------------------------------------------------------
// laporan
// ---------------------------------------------------------------
console.log('');
if (gagal.length) {
  console.log('=== ' + gagal.length + ' DARI ' + (lulus + gagal.length) + ' TEST GAGAL ===');
  for (const g of gagal) console.log('  - ' + g);
  process.exit(1);
}
console.log('=== SEMUA LOLOS (' + lulus + ' tes) ===');
