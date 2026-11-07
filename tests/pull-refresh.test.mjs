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
//   4. Muat ulang memakai window.top.location.href ke URL aplikasi dari
//      server (getAppUrl), BUKAN location.reload() yang terbukti merusak
//      iframe dashboard (menjadi /blank).
//   5. Server menyediakan getAppUrl() berbasis ScriptApp.getService().getUrl().
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
// 4. Cara muat ulang: top frame, BUKAN location.reload()
// ---------------------------------------------------------------
uji('muat ulang lewat window.top.location.href', () => {
  const muat = potongFungsi(html, 'function muatUlangAplikasi');
  benar(/window\.top\.location\.href\s*=/.test(muat), 'harus mengarahkan window.top.location.href');
});

uji('TIDAK memakai location.reload() (terbukti merusak iframe)', () => {
  // Abaikan komentar: yang dilarang adalah PEMANGGILAN, bukan penjelasan.
  const kodeSaja = html
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  benar(!/location\.reload\s*\(/.test(kodeSaja), 'location.reload() dipanggil lagi di HTML');
});

uji('meminta URL aplikasi dari server lewat getAppUrl', () => {
  const muat = potongFungsi(html, 'function muatUlangAplikasi');
  benar(/getAppUrl\('dashboard'\)/.test(muat), "harus memanggil getAppUrl('dashboard') agar mendarat di dashboard, bukan landing page");
  benar(/google\.script\.run/.test(muat), 'harus lewat google.script.run');
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
