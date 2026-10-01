// Tes paginasi tabel di DashboardStandalone.html - DATA KARANGAN.
//
// Berkas ini tidak membaca snapshot produksi. Semua data dirakit dari
// angka fiktif supaya aman di-commit ke repo publik (repo ini publik).
//
// Paginasi ini MURNI tampilan UI:
//   - data di memori selalu diambil utuh
//   - yang dipotong hanya baris yang dirender ke DOM
//   - export CSV membaca dari memori (trendRows), jadi tidak pernah
//     terbatas halaman aktif
//
//   node tests/paginasi.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const diSini = path.dirname(fileURLToPath(import.meta.url));
const AKAR = path.resolve(diSini, '..');
const HTML = path.join(AKAR, 'DashboardStandalone.html');

let lulus = 0;
const gagal = [];
function uji(nama, fn) {
  try { fn(); lulus++; console.log('  LULUS  ' + nama); }
  catch (e) { gagal.push(nama + ' :: ' + e.message); console.log('  GAGAL  ' + nama + ' :: ' + e.message); }
}
function eq(didapat, harap, pesan) {
  const a = JSON.stringify(didapat), b = JSON.stringify(harap);
  if (a !== b) throw new Error((pesan || '') + ' harap ' + b + ', dapat ' + a);
}
function benar(v, pesan) { if (!v) throw new Error(pesan || 'harus bernilai true'); }

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
const blok = (html.match(/<script[^>]*>[\s\S]*?<\/script>/g) || [])
  .map((b) => b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''))
  .find((b) => b.includes('function paginasiSet'));
if (!blok) throw new Error('blok script yang memuat paginasiSet tidak ada');

// Dua deklarasi var sengaja bersebelahan di HTML, jadi bisa diambil satu blok.
const IDX_AWAL = blok.indexOf('var PAGINASI_BARIS_PER_HALAMAN');
const IDX_AKHIR = blok.indexOf('\n', blok.indexOf('var paginasiState'));
if (IDX_AWAL < 0 || IDX_AKHIR < 0) throw new Error('deklarasi var paginasi tidak ditemukan');
const konstanta = blok.slice(IDX_AWAL, IDX_AKHIR + 1);

// ---------------------------------------------------------------
// DOM palsu: hanya tbody + panel kontrol per tabel
// ---------------------------------------------------------------
function muatHalaman(idTbody) {
  const dom = {};
  const buat = () => ({ _html: '', set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; } });
  dom[idTbody] = buat();
  dom[idTbody + '-paginasi'] = buat();

  const ctx = {
    console,
    document: { getElementById: (id) => dom[id] || null },
    Math, Number, String, Array, Object, JSON,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(
    konstanta + '\n'
    + potongFungsi(blok, 'function isiTbody') + '\n'
    + potongFungsi(blok, 'function paginasiSet') + '\n'
    + potongFungsi(blok, 'function paginasiRender') + '\n'
    + potongFungsi(blok, 'function paginasiKe') + '\n'
    + potongFungsi(blok, 'function paginasiLangkah') + '\n'
    + potongFungsi(blok, 'function paginasiKontrol'),
    ctx, { filename: 'paginasi.js' });
  return { ctx, dom };
}

const barisHtml = (el) => (el.innerHTML.match(/<tr/g) || []).length;
// renderRow karangan: satu <tr> berisi nomor baris, untuk memudahkan cek irisan.
const renderBaris = (row) => '<tr><td>' + row + '</td></tr>';

console.log('-- PAGINASI TABEL (data karangan) --');

// ---------------------------------------------------------------
// SPEC 4: total <= batas per halaman -> kontrol disembunyikan
// ---------------------------------------------------------------
uji('4. 5 baris -> kontrol kosong persis (\":empty\" CSS bisa menendang)', () => {
  const { ctx, dom } = muatHalaman('cdTbody');
  ctx.paginasiSet('cdTbody', [1, 2, 3, 4, 5], renderBaris);
  eq(dom['cdTbody-paginasi'].innerHTML, '', 'panel harus persis kosong');
  eq(barisHtml(dom.cdTbody), 5, 'semua baris harus tampil');
});

uji('4. 0 baris -> pakai pesan kosong, kontrol tetap kosong', () => {
  const { ctx, dom } = muatHalaman('cdTbody');
  ctx.paginasiSet('cdTbody', [], renderBaris, { kosong: '<tr><td>tidak ada</td></tr>' });
  eq(dom.cdTbody.innerHTML, '<tr><td>tidak ada</td></tr>', 'pesan kosong tidak dipakai');
  eq(dom['cdTbody-paginasi'].innerHTML, '', 'panel harus kosong saat data kosong');
});

uji('4. tepat 20 baris -> masih satu halaman, kontrol disembunyikan', () => {
  const { ctx, dom } = muatHalaman('cdTbody');
  ctx.paginasiSet('cdTbody', Array.from({ length: 20 }, (_, i) => i + 1), renderBaris);
  eq(dom['cdTbody-paginasi'].innerHTML, '', '20 baris masih muat satu halaman');
  eq(barisHtml(dom.cdTbody), 20, 'harus tampil 20 baris');
});

// ---------------------------------------------------------------
// SPEC 1: maksimal baris per halaman + indikator + tombol
// ---------------------------------------------------------------
uji('1. 50 baris -> hanya 20 baris di DOM, indikator "Halaman 1 / 3"', () => {
  const { ctx, dom } = muatHalaman('cdTbody');
  ctx.paginasiSet('cdTbody', Array.from({ length: 50 }, (_, i) => i + 1), renderBaris);
  eq(barisHtml(dom.cdTbody), 20, 'harus dipotong jadi 20');
  benar(dom['cdTbody-paginasi'].innerHTML.includes('Halaman 1 / 3'), 'indikator halaman hilang');
  benar(dom['cdTbody-paginasi'].innerHTML.includes('Sebelumnya'), 'tombol Sebelumnya hilang');
  benar(dom['cdTbody-paginasi'].innerHTML.includes('Selanjutnya'), 'tombol Selanjutnya hilang');
  benar(dom['cdTbody-paginasi'].innerHTML.includes('1&#8211;20 dari 50') ||
        dom['cdTbody-paginasi'].innerHTML.includes('1-20 dari 50'),
        'ringkasan irisan baris hilang: ' + dom['cdTbody-paginasi'].innerHTML);
});

uji('1. "Sebelumnya" disabled di halaman pertama, "Selanjutnya" di halaman terakhir', () => {
  const { ctx, dom } = muatHalaman('cdTbody');
  ctx.paginasiSet('cdTbody', Array.from({ length: 50 }, (_, i) => i + 1), renderBaris);
  const hal1 = dom['cdTbody-paginasi'].innerHTML;
  benar(/<button[^>]*\bdisabled\b[^>]*>Sebelumnya</.test(hal1),
        'Sebelumnya harus nonaktif di halaman 1: ' + hal1);
  benar(!/<button[^>]*\bdisabled\b[^>]*>Selanjutnya</.test(hal1),
        'Selanjutnya harus AKTIF di halaman 1: ' + hal1);

  ctx.paginasiKe('cdTbody', 3);
  const hal3 = dom['cdTbody-paginasi'].innerHTML;
  benar(/<button[^>]*\bdisabled\b[^>]*>Selanjutnya</.test(hal3),
        'Selanjutnya harus nonaktif di halaman terakhir: ' + hal3);
  benar(!/<button[^>]*\bdisabled\b[^>]*>Sebelumnya</.test(hal3),
        'Sebelumnya harus AKTIF di halaman terakhir: ' + hal3);
});

// ---------------------------------------------------------------
// SPEC 1b: kontrol dibuat SIMPEL - hanya Sebelumnya / halaman / Selanjutnya
// ---------------------------------------------------------------
uji('1. kontrol cuma Sebelumnya + halaman + Selanjutnya (tanpa lompat/awal/akhir)', () => {
  const { ctx, dom } = muatHalaman('cdTbody');
  ctx.paginasiSet('cdTbody', Array.from({ length: 50 }, (_, i) => i + 1), renderBaris);
  const panel = dom['cdTbody-paginasi'].innerHTML;
  benar(panel.includes('>Sebelumnya<'), 'tombol Sebelumnya hilang');
  benar(panel.includes('Halaman 1 / 3'), 'indikator halaman hilang');
  benar(panel.includes('>Selanjutnya<'), 'tombol Selanjutnya hilang');

  benar(!panel.includes('Pertama'), 'tombol Pertama harus dibuang');
  benar(!panel.includes('Terakhir'), 'tombol Terakhir harus dibuang');
  benar(!panel.includes('Lompat'), 'input Lompat ke harus dibuang');
  benar(!panel.includes('type="number"'), 'input angka harus dibuang');
  benar(!panel.includes('data-aksi'), 'penanda aksi lama harus dibuang');
  benar(!panel.includes('paginasiKe('), 'tombol tidak boleh memanggil paginasiKe langsung');
});

// ---------------------------------------------------------------
// SPEC 2: lompat ke nomor halaman tertentu
// ---------------------------------------------------------------
uji('2. lompat ke halaman 3 -> render irisan 41..50', () => {
  const { ctx, dom } = muatHalaman('cdTbody');
  ctx.paginasiSet('cdTbody', Array.from({ length: 50 }, (_, i) => i + 1), renderBaris);
  ctx.paginasiKe('cdTbody', 3);
  // 50 baris = 20 + 20 + 10. Halaman terakhir memang lebih pendek.
  eq(barisHtml(dom.cdTbody), 10, 'halaman 3 harus berisi sisa 10 baris');
  benar(dom.cdTbody.innerHTML.includes('<td>41</td>'), 'baris pertama halaman 3 harus 41');
  benar(dom.cdTbody.innerHTML.includes('<td>50</td>'), 'baris terakhir halaman 3 harus 50');
  benar(dom.cdTbody.innerHTML.includes('<td>20</td>') === false, 'baris halaman 1 tidak boleh ikut');
  benar(dom['cdTbody-paginasi'].innerHTML.includes('Halaman 3 / 3'), 'indikator tidak ikut pindah');
});

uji('2. nomor halaman di luar rentang -> dijepit ke batas yang sah', () => {
  const { ctx, dom } = muatHalaman('cdTbody');
  ctx.paginasiSet('cdTbody', Array.from({ length: 50 }, (_, i) => i + 1), renderBaris);
  ctx.paginasiKe('cdTbody', 99);
  eq(barisHtml(dom.cdTbody), 10, '99 dijepit ke halaman terakhir (sisa 10 baris)');
  benar(dom.cdTbody.innerHTML.includes('<td>41</td>'), '99 dijepit jadi halaman 3');
  ctx.paginasiKe('cdTbody', 0);
  benar(dom.cdTbody.innerHTML.includes('<td>1</td>'), '0 dijepit jadi halaman 1');
  ctx.paginasiKe('cdTbody', -7);
  benar(dom.cdTbody.innerHTML.includes('<td>1</td>'), 'negatif dijepit jadi halaman 1');
  ctx.paginasiKe('cdTbody', 'angka');
  benar(dom.cdTbody.innerHTML.includes('<td>1</td>'), 'bukan angka dijepit jadi halaman 1');
});

uji('2. tombol Selanjutnya menggeser satu halaman, lalu berhenti di akhir', () => {
  const { ctx, dom } = muatHalaman('cdTbody');
  ctx.paginasiSet('cdTbody', Array.from({ length: 50 }, (_, i) => i + 1), renderBaris);
  ctx.paginasiLangkah('cdTbody', 1);
  benar(dom.cdTbody.innerHTML.includes('<td>21</td>'), 'Selanjutnya harus ke baris 21');
  ctx.paginasiLangkah('cdTbody', 1);
  ctx.paginasiLangkah('cdTbody', 1);
  ctx.paginasiLangkah('cdTbody', 1);
  benar(dom.cdTbody.innerHTML.includes('<td>41</td>'), 'maju 4x dari halaman 1 harus mentok di 3');
  benar(dom['cdTbody-paginasi'].innerHTML.includes('Halaman 3 / 3'), 'tidak boleh lewat halaman 3');
});

// ---------------------------------------------------------------
// SPEC 3: ganti filter -> reset ke halaman 1
// ---------------------------------------------------------------
uji('3. set data baru SELALU mengembalikan halaman ke 1', () => {
  const { ctx, dom } = muatHalaman('tabelData');
  ctx.paginasiSet('tabelData', Array.from({ length: 60 }, (_, i) => i + 1), renderBaris);
  ctx.paginasiKe('tabelData', 3);
  eq(barisHtml(dom.tabelData), 20, 'bersiap di halaman 3');
  // klik "Tampilkan" lagi: data baru masuk lewat paginasiSet yang sama
  ctx.paginasiSet('tabelData', Array.from({ length: 60 }, (_, i) => i + 1000), renderBaris);
  eq(barisHtml(dom.tabelData), 20, 'tetap 20 baris per halaman');
  benar(dom.tabelData.innerHTML.includes('<td>1001</td>'),
        'harus kembali ke baris PERTAMA dataset baru, bukan nyangkut di halaman 3');
  benar(dom['tabelData-paginasi'].innerHTML.includes('Halaman 1 / 3'),
        'indikator harus reset ke halaman 1');
});

uji('3. dataset baru yang lebih pendek juga di-reset (halaman lama tidak basi)', () => {
  const { ctx, dom } = muatHalaman('tabelData');
  ctx.paginasiSet('tabelData', Array.from({ length: 90 }, (_, i) => i + 1), renderBaris);
  ctx.paginasiKe('tabelData', 5);
  ctx.paginasiSet('tabelData', [7, 8, 9], renderBaris, { kosong: '<tr><td>kosong</td></tr>' });
  eq(dom.tabelData.innerHTML, '<tr><td>7</td></tr><tr><td>8</td></tr><tr><td>9</td></tr>',
    'dataset baru harus dirender utuh di halaman 1');
  eq(dom['tabelData-paginasi'].innerHTML, '', 'kontrol harus hilang saat data muat satu halaman');
});

// ---------------------------------------------------------------
// Jalur loading/error/reset tidak boleh meninggalkan kontrol basi
// ---------------------------------------------------------------
uji('isiTbody menghapus state + kontrol sisa dari render sebelumnya', () => {
  const { ctx, dom } = muatHalaman('cdTbody');
  ctx.paginasiSet('cdTbody', Array.from({ length: 50 }, (_, i) => i + 1), renderBaris);
  benar(dom['cdTbody-paginasi'].innerHTML.length > 0, 'kontrol harus ada dulu');
  ctx.isiTbody('cdTbody', '<tr><td>Gagal memuat data</td></tr>');
  eq(dom.cdTbody.innerHTML, '<tr><td>Gagal memuat data</td></tr>', 'pesan error masuk');
  eq(dom['cdTbody-paginasi'].innerHTML, '', 'kontrol basi harus ikut hilang');
  // setelah state dibersihkan, langkah navigasi tidak boleh melempar
  ctx.paginasiLangkah('cdTbody', 1);
  eq(dom.cdTbody.innerHTML, '<tr><td>Gagal memuat data</td></tr>', 'tbody tidak boleh tersentuh');
  eq(dom['cdTbody-paginasi'].innerHTML, '', 'panel tetap kosong');
});

// ---------------------------------------------------------------
// SPEC 6: variabel tema, tanpa warna hardcoded
// ---------------------------------------------------------------
uji('6. CSS .paginasi tidak memuat warna hardcoded', () => {
  const i = html.indexOf('.paginasi {');
  benar(i >= 0, 'bloc CSS .paginasi tidak ditemukan');
  // Batas akhir: blok @media pertama setelah .paginasi { - di situ blok CSS
  // paginasi berakhir, termasuk aturan layar kecilnya.
  const media = html.indexOf('@media (max-width: 640px)', i);
  if (media < 0) throw new Error('blok media paginasi tidak ditemukan');
  const buka = html.indexOf('{', media);
  let kedalaman = 0, akhir = -1;
  for (let k = buka; k < html.length; k++) {
    if (html[k] === '{') kedalaman++;
    else if (html[k] === '}') { kedalaman--; if (kedalaman === 0) { akhir = k + 1; break; } }
  }
  // Gagal keras kalau batasnya tidak ketemu, jangan jatuh ke potongan yang
  // bisa diam-diam melewatkan bagian CSS yang belum diperiksa.
  if (akhir < 0) throw new Error('batas akhir CSS .paginasi tidak ditemukan');
  const css = html.slice(i, akhir);
  const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  const rgb = css.match(/\brgba?\s*\(/g) || [];
  eq(hex, [], 'ada warna hex di CSS paginasi');
  eq(rgb, [], 'ada warna rgb()/rgba() di CSS paginasi');
  benar(css.includes('--text-primary'), 'tidak pakai --text-primary');
  benar(css.includes('--bg-surface'), 'tidak pakai --bg-surface');
  benar(css.includes('--border-color'), 'tidak pakai --border-color');
});

uji('6. semua variabel CSS paginasi benar-benar didefinisikan', () => {
  const i = html.indexOf(':root {');
  const terang = html.slice(i, html.indexOf('html.theme-dark', i));
  const d = html.indexOf('html.theme-dark,');
  const b = html.indexOf('body.dark-mode {', d);
  // Blok itu tanpa kurung bersarang, jadi kurung tutup pertama mengakhirinya.
  const gelap = html.slice(d, html.indexOf('}', b) + 1);

  // Variabel yang dipakai .paginasi. Yang berwarna harus ada di KEDUA blok,
  // kalau tidak mode gelap akan memakai nilai mode terang - itulah bug
  // theming yang dulu membuat tombol tampak bening di latar gelap.
  const warna = ['--text-primary', '--text-secondary', '--bg-surface', '--card-bg',
    '--border-color', '--primary', '--focus', '--focus-glow'];
  // Geometri sengaja dipakai bersama: `--radius-sm` tidak didefinisikan ulang
  // di blok gelap, tapi tetap terpakai karena :root dan html.theme-dark adalah
  // ELEMEN YANG SAMA (<html>). Cukup dijamin ada di :root.
  const geometri = ['--radius-sm', '--radius', '--shadow-sm'];

  for (const v of warna) {
    benar(terang.includes(v + ':'), v + ' tidak ada di :root');
    benar(gelap.includes(v + ':'), v + ' tidak ada di blok tema gelap');
  }
  for (const v of geometri) benar(terang.includes(v + ':'), v + ' tidak ada di :root');
});

// ---------------------------------------------------------------
// SPEC 5: export CSV tidak terpengaruh paginasi
// ---------------------------------------------------------------
uji('5. exportReportCSV membaca data dari memori, bukan dari DOM', () => {
  const f = potongFungsi(blok, 'function exportReportCSV');
  benar(f.includes('trendRows'), 'export harus membaca trendRows (memori)');
  benar(!f.includes('paginasi'), 'export tidak boleh menyentuh paginasi');
  benar(!f.includes('tabelData'), 'export tidak boleh membaca baris dari DOM');
  benar(f.includes('for (var r2 = 0; r2 < trendRows.length'), 'export harus menelusuri SELURUH trendRows');
});

// ---------------------------------------------------------------
// Wiring: ketiga render memang melewati paginasiSet
// ---------------------------------------------------------------
uji('renderCreditDebit mengisi data lewat paginasiSet', () => {
  const f = potongFungsi(blok, 'function renderCreditDebit');
  benar(f.includes("paginasiSet('cdTbody'"), 'renderCreditDebit tidak memakai paginasiSet');
});

uji('renderReport mengisi data lewat paginasiSet', () => {
  const f = potongFungsi(blok, 'function renderReport');
  benar(f.includes("paginasiSet('tabelData'"), 'renderReport tidak memakai paginasiSet');
});

uji('renderPeringatanKpiCd mengisi rincian lewat paginasiSet', () => {
  const f = potongFungsi(blok, 'function renderPeringatanKpiCd');
  benar(f.includes("paginasiSet('kpiCdRincianTbody'"), 'renderPeringatanKpiCd tidak memakai paginasiSet');
});

// ---------------------------------------------------------------
// HTML: ketiga elemen panel ada dengan id yang benar
// ---------------------------------------------------------------
uji('HTML punya tiga div .paginasi dengan id yang cocok', () => {
  const id = ['cdTbody-paginasi', 'tabelData-paginasi', 'kpiCdRincianTbody-paginasi'];
  for (const s of id) {
    benar(html.includes('id="' + s + '"'), 'div paginasi tidak ada: ' + s);
  }
  benar(html.includes('.paginasi:empty'), 'CSS .paginasi:empty tidak ada - kontrol tidak akan bisa sembunyi sendiri');
});

// ---------------------------------------------------------------
// Invarian anti-regresi: kalau ada yang menulis ke tbody secara langsung,
// ia akan meninggalkan tombol halaman basi di sebelah pesan error/kosong.
// satu-satunya penulis yang boleh berisi ID literal adalah helper paginasi
// sendiri (yang memakai ID lewat variabel, jadi pola ini tidak menangkapnya).
// ---------------------------------------------------------------
uji('tidak ada penulisan literal langsung ke tbody ketiga', () => {
  const pola = /getElementById\(\s*['"](?:tabelData|cdTbody|kpiCdRincianTbody)['"]\s*\)\.innerHTML\s*=/g;
  const ketemu = [];
  html.split(/\r?\n/).forEach((baris, n) => {
    if (pola.test(baris)) ketemu.push('L' + (n + 1) + ': ' + baris.trim().slice(0, 90));
    pola.lastIndex = 0;
  });
  eq(ketemu, [], 'semua penulian harus lewat isiTbody/paginasiSet: ' + ketemu.join(' | '));
});

console.log('');
console.log('=== ' + lulus + ' lulus, ' + gagal.length + ' gagal ===');
process.exit(gagal.length === 0 ? 0 : 1);
