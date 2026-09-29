// Tes regresi P1 audit performa dashboard (jalur data frontend).
// Fokus: jumlah round-trip google.script.run berkurang pada alur nyata:
//   login -> tampilkan laporan -> buka tab Grafik/Penjualan.
// Cara pakai: node perf-p1.test.mjs <path DashboardStandalone.html>
//
// Setiap assert menunjuk perubahan produksi yang membuatnya gagal:
// PERF-1..2  : Nilai Stok tidak lagi menunggu laporan (berurutan -> paralel)
// PERF-3..6  : Produk/Bahan tidak lagi di jalur login (lazy per tab + prefetch
//              yang mengalah saat laporan sedang dimuat)
// PERF-7..11 : periode yang sama tidak diambil ulang dari server, dan
//              tombol "Tampilkan" tetap berarti "muat ulang"
// PERF-12..13: rantai serial getProdukList->getNilaiStok hilang, dan data tetap
//              tersedia saat modal butuh (bukan sampai tab dibuka)
// PERF-14..15: placeholder awal jujur (tidak mengklaim "sedang memuat" padahal
//              tidak ada permintaan berjalan)

import fs from 'node:fs';
import { targetHtml } from './lib/jalur.mjs';

const target = targetHtml();
const source = fs.readFileSync(target, 'utf8');

// ---------- util ----------
const komentarDibuang = source.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
const tanpaKomentarBaris = komentarDibuang
  .split('\n')
  .map((l) => l.replace(/\/\/.*$/, ''))
  .join('\n');

function bodyFungsi(nama) {
  const re = new RegExp('function\\s+' + nama + '\\s*\\(', 'g');
  const m = re.exec(tanpaKomentarBaris);
  if (!m) return null;
  let i = tanpaKomentarBaris.indexOf('{', m.index);
  if (i === -1) return null;
  let depth = 0;
  const start = i;
  for (; i < tanpaKomentarBaris.length; i++) {
    const c = tanpaKomentarBaris[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return tanpaKomentarBaris.slice(start, i + 1);
    }
  }
  return null;
}

function posisi(body, needle) {
  if (body === null) return -1;
  return body.indexOf(needle);
}

const hasil = [];
function check(id, deskripsi, lulus, detail) {
  hasil.push({ id, deskripsi, lulus: !!lulus, detail: detail || '' });
}

// ---------- PERF-1: laporan tidak lagi memikul panggilan nilai stok ----------
// #nilaiStokBox berada di section-produk (bukan Overview), jadi pemilik datanya
// adalah tab Produk. Jalur laporan tidak boleh menambah round-trip untuk itu.
{
  const b = bodyFungsi('loadReport');
  const masihAda = /(^|[^.\w])loadNilaiStok\s*\(\s*\)/.test(b || '');
  check(
    'PERF-1',
    'loadReport(): tidak ada lagi panggilan getNilaiStok (KPI nilai stok milik tab Produk, bukan jalur laporan)',
    b !== null && !masihAda,
    b === null ? 'body loadReport tidak terbaca' : 'masih memanggil loadNilaiStok=' + masihAda
  );

  const p = bodyFungsi('muatProdukSekali');
  check(
    'PERF-1b',
    'muatProdukSekali(): nilai stok ikut respons produk, tanpa permintaan kedua',
    p !== null &&
      /loadProduk\s*\(/.test(p) &&
      !/(^|[^.\w])(loadNilaiStok|getNilaiStok)\s*\(/.test(p),
    p === null ? 'fungsi muatProdukSekali tidak ada' : p.replace(/\s+/g, ' ').slice(0, 160)
  );
}

// ---------- PERF-2: satu permintaan Nilai Stok saja ----------
{
  const b = bodyFungsi('loadNilaiStok');
  check(
    'PERF-2',
    'loadNilaiStok(): ada penjaga anti-duplikat (permintaan kedua diabaikan, bukan ditolak toast)',
    b !== null && /nilaiStokInFlight/.test(b) && /if\s*\(\s*nilaiStokInFlight\s*\)/.test(b),
    b === null ? 'body loadNilaiStok tidak terbaca' : b.replace(/\s+/g, ' ').slice(0, 160)
  );
}

// ---------- PERF-3: jalur login bebas 3 panggilan produk/bahan/log ----------
{
  const b = bodyFungsi('initDashboardData');
  const langsungProduk = /(^|[^.\w])loadProduk\s*\(\s*\)/.test(b || '');
  const langsungBahan = /(^|[^.\w])loadStokBahan\s*\(\s*\)/.test(b || '');
  const langsungLog = /(^|[^.\w])fetchLastBahanLog\s*\(\s*\)/.test(b || '');
  check(
    'PERF-3',
    'initDashboardData(): tidak memanggil loadProduk()/loadStokBahan()/fetchLastBahanLog() langsung di jalur login',
    b !== null && !langsungProduk && !langsungBahan && !langsungLog,
    `loadProduk=${langsungProduk} loadStokBahan=${langsungBahan} fetchLastBahanLog=${langsungLog}`
  );
}

// ---------- PERF-4: tab memicu pemuatan datanya ----------
{
  const b = bodyFungsi('activateSection');
  check(
    'PERF-4',
    'activateSection(): membuka tab Produk/Bahan memicu muat idempoten (muatProdukSekali/muatBahanSekali)',
    b !== null && /muatProdukSekali\s*\(/.test(b) && /muatBahanSekali\s*\(/.test(b),
    b === null ? 'body activateSection tidak terbaca' : 'ada=' + /muatProdukSekali/.test(b) + '/' + /muatBahanSekali/.test(b)
  );
}

// ---------- PERF-5: hanya sekali per sesi ----------
{
  const p = bodyFungsi('muatProdukSekali');
  const b = bodyFungsi('muatBahanSekali');
  const okP = p !== null && /produkSudahDimuat/.test(p) && /return/.test(p) === true;
  const okB = b !== null && /bahanSudahDimuat/.test(b) && /return/.test(b) === true;
  check(
    'PERF-5',
    'muatProdukSekali()/muatBahanSekali(): dijaga flag sekali-muat agar tab bolak-balik tidak memicu panggilan ulang',
    okP && okB,
    'produk=' + okP + ' bahan=' + okB
  );
}

// ---------- PERF-6: prefetch mengalah saat laporan sedang dimuat ----------
{
  const b = bodyFungsi('jadwalkanPrefetchProdukBahan');
  check(
    'PERF-6',
    'jadwalkanPrefetchProdukBahan(): menunda diri selama reportLoading (tidak berebut server dengan laporan yang ditunggu user)',
    b !== null && /reportLoading/.test(b),
    b === null ? 'fungsi prefetch tidak ada' : 'ada reportLoading=' + /reportLoading/.test(b)
  );
}

// ---------- PERF-7..8: Grafik & Penjualan memakai cache sebelum ke server ----------
{
  const g = bodyFungsi('loadChartByDateRange');
  const posAmbilG = posisi(g, 'ambilCacheLaporan');
  const posCallG = posisi(g, "safeGoogleRun('getReportByDateRange'");
  check(
    'PERF-7',
    'loadChartByDateRange(): memakai laporan periode sama yang sudah dimuat sebelum memanggil server',
    g !== null && posAmbilG !== -1 && posCallG !== -1 && posAmbilG < posCallG,
    `ambilCacheLaporan=${posAmbilG} panggilanServer=${posCallG}`
  );

  const s = bodyFungsi('loadSalesByDateRange');
  const posAmbilS = posisi(s, 'ambilCacheLaporan');
  const posCallS = posisi(s, "safeGoogleRun('getReportByDateRange'");
  check(
    'PERF-8',
    'loadSalesByDateRange(): memakai laporan periode sama yang sudah dimuat sebelum memanggil server',
    s !== null && posAmbilS !== -1 && posCallS !== -1 && posAmbilS < posCallS,
    `ambilCacheLaporan=${posAmbilS} panggilanServer=${posCallS}`
  );
}

// ---------- PERF-9: cache dibatasi sekali pakai per section ----------
{
  const b = bodyFungsi('ambilCacheLaporan');
  check(
    'PERF-9',
    'ambilCacheLaporan(): satu periode hanya dilayani cache SEKALI per section (klik "Tampilkan" berikutnya = muat ulang nyata)',
    b !== null && /dipakai/.test(b) && /section/.test(b),
    b === null ? 'fungsi ambilCacheLaporan tidak ada' : b.replace(/\s+/g, ' ').slice(0, 180)
  );
}

// ---------- PERF-10: cache dibuang setelah data berubah ----------
{
  const p = bodyFungsi('aksiInputPenjualan');
  const c = bodyFungsi('aksiAddCreditDebit');
  const okP = p !== null && /batalkanCacheLaporan\s*\(/.test(p);
  const okC = c !== null && /batalkanCacheLaporan\s*\(/.test(c);
  check(
    'PERF-10',
    'Cache laporan dibatalkan setelah menulis data (aksiInputPenjualan & aksiAddCreditDebit)',
    okP && okC,
    'penjualan=' + okP + ' creditDebit=' + okC
  );
}

// ---------- PERF-11: laporan segar mengisi cache ----------
{
  const b = bodyFungsi('loadReport');
  check(
    'PERF-11',
    'loadReport(): hasil permintaan segar disimpan sebagai cache untuk periode itu',
    b !== null && /perbaruiCacheLaporan\s*\(/.test(b),
    b === null ? 'body loadReport tidak terbaca' : 'ada=' + /perbaruiCacheLaporan/.test(b)
  );
}

// ---------- PERF-12: rantai serial getProdukList -> getNilaiStok hilang ----------
// Nilai Stok sekarang ikut di respons getProdukList, jadi loadProduk() tidak
// lagi membuka permintaan kedua. Panggilan loadNilaiStok() hanya boleh muncul
// sebagai fallback, yaitu setelah terapkanNilaiStok() gagal (server lama).
{
  const b = bodyFungsi('loadProduk');
  const datar = (b || '').replace(/\s+/g, ' ');
  const langsung = /(^|[^.\w])loadNilaiStok\(\)/.test(datar);
  const adaFallback = datar.indexOf('!terapkanNilaiStok(res)) loadNilaiStok();') !== -1;
  const adaPakaiLangsung = datar.indexOf('terapkanNilaiStok(res)') !== -1;
  check(
    'PERF-12',
    'loadProduk(): pakai nilai stok dari respons sendiri; loadNilaiStok() hanya sebagai fallback',
    b !== null && adaPakaiLangsung && (!langsung || adaFallback),
    b === null ? 'body loadProduk tidak terbaca' : 'pakaiLangsung=' + adaPakaiLangsung + ' langsung=' + langsung + ' adaFallback=' + adaFallback
  );
}

// ---------- PERF-12d: respons server lama tidak boleh paints "Rp 0" palsu ----------
// Kalau terapkanNilaiStok() hanya mengecek status, respons versi lama (tanpa
// field nilaiStok) akan dianggap valid dan kotak menampilkan "Rp 0" statt
// menjalankan jalur fallback.
{
  const b = bodyFungsi('terapkanNilaiStok');
  const cekField = /typeof\s+res\.nilaiStok\s*!==?=\s*.number./.test(b || '') || /hasOwnProperty[^)]*nilaiStok/.test(b || '');
  const cekAngka = /isFinite\s*\(\s*res\.nilaiStok\s*\)/.test(b || '');
  check(
    'PERF-12d',
    'terapkanNilaiStok(): menolak respons tanpa field nilaiStok (server lama) -> fallback jalan',
    b !== null && cekField && cekAngka,
    b === null ? 'body terapkanNilaiStok tidak terbaca' : 'cekField=' + cekField + ' cekAngka=' + cekAngka
  );
}

// ---------- PERF-12b: jalur CRUD produk juga tidak membuka permintaan kedua ----------
{
  const b = bodyFungsi('loadProdukCRUD');
  const datar = (b || '').replace(/\s+/g, ' ');
  const langsung = /(^|[^.\w])loadNilaiStok\(\)/.test(datar);
  const adaFallback = datar.indexOf('!terapkanNilaiStok(res)) loadNilaiStok();') !== -1;
  const adaPakaiLangsung = datar.indexOf('terapkanNilaiStok(res)') !== -1;
  check(
    'PERF-12b',
    'loadProdukCRUD(): nilai stok dari respons getProdukList yang sama, bukan permintaan terpisah',
    b !== null && adaPakaiLangsung && (!langsung || adaFallback),
    b === null ? 'body loadProdukCRUD tidak terbaca' : 'pakaiLangsung=' + adaPakaiLangsung + ' langsung=' + langsung + ' adaFallback=' + adaFallback
  );
}

// ---------- PERF-12c: setelah simpan penjualan tidak ada permintaan nilai stok kedua ----------
// Angka lama sempat tampil dulu sebelum respons baru masuk, jadi jalur ini
// harus benar-benar cuma loadProduk().
{
  const b = bodyFungsi('aksiInputPenjualan');
  check(
    'PERF-12c',
    'aksiInputPenjualan(): setelah simpan hanya loadProduk() (tidak ada loadNilaiStok() terpisah)',
    b !== null && /loadProduk\s*\(\s*\)/.test(b) && !/(^|[^.\w])loadNilaiStok\s*\(\s*\)/.test(b),
    b === null ? 'body aksiInputPenjualan tidak terbaca' : b.replace(/\s+/g, ' ').slice(0, 160)
  );
}

// ---------- PERF-13: modal yang butuh data produk/bahan tetap terisi ----------
{
  const b = bodyFungsi('openModal');
  const okPenjualan = b !== null && /modalPenjualan[\s\S]{0,400}?muatProdukSekali\s*\(/.test(b);
  const okBahan = b !== null && /modalBahan[\s\S]{0,400}?muatBahanSekali\s*\(/.test(b);
  check(
    'PERF-13',
    'openModal(): modal Penjualan/Bahan memuat datanya saat dibutuhkan (datalist produk & daftar bahan tetap terisi)',
    okPenjualan && okBahan,
    'modalPenjualan=' + okPenjualan + ' modalBahan=' + okBahan
  );
}

// ---------- PERF-14..15: placeholder awal jujur ----------
{
  const tbody = /<tbody id="produkTbody">([\s\S]*?)<\/tbody>/.exec(source);
  const grid = /<div class="bahan-grid" id="bahanGrid">([\s\S]*?)<\/div>\s*<div class="bahan-note">/.exec(source);
  const okProduk = !!tbody && !/fa-spin/.test(tbody[1]);
  const okBahan = !!grid && !/fa-spin/.test(grid[1]);
  check(
    'PERF-14',
    'Placeholder awal tabel produk tidak lagi mengklaim "sedang memuat" (datanya belum diminta)',
    okProduk,
    tbody ? 'masih ada fa-spin=' + /fa-spin/.test(tbody[1]) : 'tidak ketemu #produkTbody'
  );
  check(
    'PERF-15',
    'Placeholder awal grid bahan tidak lagi mengklaim "sedang memuat" (datanya belum diminta)',
    okBahan,
    grid ? 'masih ada fa-spin=' + /fa-spin/.test(grid[1]) : 'tidak ketemu #bahanGrid'
  );
}

// ---------- laporan ----------
let gagal = 0;
console.log('=== TES REGRESI PERFORMA P1 ===');
console.log('target: ' + target);
console.log('');
for (const h of hasil) {
  if (!h.lulus) gagal++;
  console.log((h.lulus ? 'LULOS  ' : 'GAGAL  ') + '[' + h.id + '] ' + h.deskripsi);
  if (!h.lulus) console.log('        detail: ' + h.detail);
}
console.log('');
console.log('=== ' + gagal + ' DARI ' + hasil.length + ' TEST GAGAL ===');
process.exit(gagal === 0 ? 0 : 1);
