// Tes panel peringatan Credit/Debit di DashboardStandalone.html - DATA KARANGAN.
//
// Berkas ini tidak membaca snapshot produksi. Semua payload dirakit dari
// angka dan kategori fiktif supaya aman di-commit ke repo publik.
//
// Tes dengan payload hasil produksi ada di tests/panel-kpi-cd.lokal.mjs
// (tidak di-commit).
//
// Fungsi render dipecah dari HTML dan dijalankan di VM dengan DOM palsu,
// lalu diperiksa hasilnya. Tujuannya: panel hanya muncul kalau memang ada
// masalah, dan TEKS yang tampil benar (bukan "Rp0 belum masuk" saat kita
// memang tidak tahu, dan bukan sisa periode sebelumnya).
//
//   node tests/panel-kpi-cd.test.mjs
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

// ---------------------------------------------------------------
// DOM palsu: hanya 7 elemen yang dipakai panel, tidak perlu realistis
// ---------------------------------------------------------------
const ID = ['kpiCdPeringatan', 'kpiCdPeringatanJudul', 'kpiCdPeringatanTeks',
  'kpiCdRincian', 'kpiCdRincianJudul', 'kpiCdRincianTbody', 'kpiCdRincianFoot',
  'kpiCdRincianTbody-paginasi'];
function elemenPalsu() {
  return { _html: '', _text: '', hidden: true,
    set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; },
    set textContent(v) { this._text = String(v); }, get textContent() { return this._text; } };
}

// Ambil satu fungsi utuh dari sumber dengan menghitung kurung kurawal.
// Dipakai supaya tes menguji KODE YANG ADA DI HTML, bukan salinan yang
// bisa basi diam-diam setelah HTML diedit.
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

function muatPanel() {
  const html = fs.readFileSync(HTML, 'utf8');
  const blok = (html.match(/<script[^>]*>[\s\S]*?<\/script>/g) || [])
    .map((b) => b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''))
    .find((b) => b.includes('function renderPeringatanKpiCd'));
  if (!blok) throw new Error('blok script yang memuat renderPeringatanKpiCd tidak ada');

  // Potong satu deklarasi var utuh (dari penanda sampai akhir baris `sampai`).
  const potongVar = (penanda, sampai) => {
    const i = blok.indexOf(penanda);
    if (i < 0) throw new Error('deklarasi tidak ada di HTML: ' + penanda);
    const j = blok.indexOf('\n', blok.indexOf(sampai, i));
    if (j < 0) throw new Error('batas deklarasi tidak ditemukan: ' + sampai);
    return blok.slice(i, j + 1);
  };

  const konstanta =
    potongVar('var PAGINASI_BARIS_PER_HALAMAN', 'var paginasiState') + '\n'
    + potongVar('var ALASAN_CD', 'var BATAS_RINCIAN_CD');

  const dom = {};
  ID.forEach((id) => { dom[id] = elemenPalsu(); });

  const ctx = {
    console,
    document: { getElementById: (id) => dom[id] || null },
    formatIDR: (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID'),
    String, Number, Array, Object, JSON,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(konstanta + '\n'
    // escapeHtml ASLI dari HTML, bukan stub: supaya tes ini benar-benar
    // membuktikan markup di data tidak lolos jadi HTML.
    + potongFungsi(blok, 'function escapeHtml') + '\n'
    // Helper paginasi ikut dimuat: renderPeringatanKpiCd mengisi rinciannya
    // lewat paginasiSet, dan reset-nya lewat isiTbody.
    + potongFungsi(blok, 'function isiTbody') + '\n'
    + potongFungsi(blok, 'function paginasiSet') + '\n'
    + potongFungsi(blok, 'function paginasiRender') + '\n'
    + potongFungsi(blok, 'function paginasiKe') + '\n'
    + potongFungsi(blok, 'function paginasiLangkah') + '\n'
    + potongFungsi(blok, 'function paginasiKontrol') + '\n'
    + potongFungsi(blok, 'function barisRincian') + '\n'
    + potongFungsi(blok, 'function renderPeringatanKpiCd') + '\n'
    + potongFungsi(blok, 'function resetPeringatanKpiCd'), ctx, { filename: 'panel-cd.js' });
  return { ctx, dom };
}

// ---------------------------------------------------------------
// Payload KARANGAN - bentuknya sama dengan hasil _agregasiKpiCd, tapi
// angka dan kategorinya fiktif. 4 baris bermasalah, Rp43.800.
// 4.137 + 9.413 + 12.137 + 18.113 = 43.800
//
// Semua nominal berakhiran angka bukan nol supaya tidak mungkin sama dengan
// sel rupiah mana pun di sheet produksi (semuanya kelipatan 1.000).
// tests/bukti-sintetis.lokal.mjs memverifikasi itu sel per sel.
// ---------------------------------------------------------------
const PAYLOAD_KARANGAN = {
  rincianCreditDebit: {
    inventori: 1285713, campuran: 0, tidakDikenali: 43800,
    kolomJenisHilang: false, gagalDibaca: false,
  },
  perluTindakLanjut: [
    { tanggal: '2024-05-11', tipe: 'CREDIT', kategori: 'Perlengkapan', deskripsi: 'Karangan X', nominal: 4137, jenis: '', alasan: 'JENIS_KOSONG' },
    { tanggal: '2024-06-02', tipe: 'CREDIT', kategori: 'Perlengkapan', deskripsi: ' assorted', nominal: 9413, jenis: 'operasional', alasan: 'JENIS_TIDAK_DIKENAL' },
    { tanggal: '2024-07-19', tipe: 'CREDIT', kategori: 'Adonan', deskripsi: 'Karangan Y', nominal: 12137, jenis: 'operasional', alasan: 'JENIS_TIDAK_DIKENAL' },
    { tanggal: '2024-08-03', tipe: 'CREDIT', kategori: 'Karpet', deskripsi: 'Karangan Z', nominal: 18113, jenis: 'operasional', alasan: 'JENIS_TIDAK_DIKENAL' },
  ],
};
const TOTAL_MASALAH = 43800;

console.log('-- PANEL PERINGATAN CREDIT/DEBIT (data karangan) --');

uji('kedua elemen panel ada di HTML dengan id yang dipakai render', () => {
  const html = fs.readFileSync(HTML, 'utf8');
  ID.forEach((id) => {
    benar(html.includes('id="' + id + '"'), 'id tidak ada di HTML: ' + id);
  });
});

uji('updateKPI memanggil renderPeringatanKpiCd', () => {
  const html = fs.readFileSync(HTML, 'utf8');
  const m = html.match(/function updateKPI\([\s\S]*?\n    \}/);
  benar(m, 'fungsi updateKPI tidak ditemukan');
  benar(m[0].includes('renderPeringatanKpiCd(res)'), 'updateKPI tidak memanggil render');
});

uji('reset (kondisi kosong) menyembunyikan dan mengosongkan panel', () => {
  const { ctx, dom } = muatPanel();
  ctx.renderPeringatanKpiCd(PAYLOAD_KARANGAN);
  benar(dom.kpiCdPeringatan.hidden === false, 'panel harus tampil dulu');
  ctx.resetPeringatanKpiCd();
  benar(dom.kpiCdPeringatan.hidden === true, 'ringkasan tidak disembunyikan');
  benar(dom.kpiCdRincian.hidden === true, 'rincian tidak disembunyikan');
  eq(dom.kpiCdRincianTbody.innerHTML, '', 'tbody tidak dikosongkan');
  eq(dom.kpiCdRincianFoot.innerHTML, '', 'footer tidak dikosongkan');
  eq(dom.kpiCdPeringatanTeks.innerHTML, '', 'teks tidak dikosongkan');
  eq(dom.kpiCdRincianJudul.textContent, 'Rincian baris belum terkategori', 'judul rincian tidak direset');
});

uji('baris bermasalah: ringkasan tampil menyebut jumlah + nominal', () => {
  const { ctx, dom } = muatPanel();
  ctx.renderPeringatanKpiCd(PAYLOAD_KARANGAN);
  benar(dom.kpiCdPeringatan.hidden === false, 'ringkasan harus tampil');
  benar(dom.kpiCdPeringatanJudul.innerHTML.includes('4 baris'), 'judul tidak menyebut jumlah: ' + dom.kpiCdPeringatanJudul.innerHTML);
  benar(dom.kpiCdPeringatanTeks.innerHTML.includes('Rp43.800'), 'teks tidak menyebut nominal: ' + dom.kpiCdPeringatanTeks.innerHTML);
  benar(dom.kpiCdPeringatanTeks.innerHTML.includes('belum masuk Laba Bersih'), 'teks tidak menjelaskan dampaknya');
});

uji('baris bermasalah: tabel rincian menampilkan semuanya', () => {
  const { ctx, dom } = muatPanel();
  ctx.renderPeringatanKpiCd(PAYLOAD_KARANGAN);
  benar(dom.kpiCdRincian.hidden === false, 'rincian harus tampil');
  eq((dom.kpiCdRincianTbody.innerHTML.match(/<tr>/g) || []).length, 4, 'jumlah baris tabel');
  benar(dom.kpiCdRincianTbody.innerHTML.includes('2024-06-02'), 'tanggal baris kedua tidak ada');
  benar(dom.kpiCdRincianTbody.innerHTML.includes('Kolom Jenis kosong'), 'alasan JENIS_KOSONG tidak diterjemahkan');
  benar(dom.kpiCdRincianTbody.innerHTML.includes('Nilai Jenis tidak dikenal'), 'alasan JENIS_TIDAK_DIKENAL tidak diterjemahkan');
  benar(dom.kpiCdRincianTbody.innerHTML.includes('Rp9.413'), 'nominal baris tidak dirender');
});

uji('panel muncul di DUA tempat sekaligus (banner + tabel rincian)', () => {
  // Salah satu tempat yang lupa dirender = baris bermasalah hilang dari
  // layar, karena pengguna hanya melihat banner atau hanya tabel.
  const { ctx, dom } = muatPanel();
  ctx.renderPeringatanKpiCd(PAYLOAD_KARANGAN);
  benar(dom.kpiCdPeringatan.hidden === false && dom.kpiCdPeringatan.innerHTML !== undefined
    && dom.kpiCdPeringatanJudul.innerHTML !== '', 'banner di atas tidak dirender');
  benar(dom.kpiCdRincian.hidden === false && dom.kpiCdRincianJudul.textContent !== '', 'tabel rincian di bawah tidak dirender');
});

uji('semua baris terkategori: panel disembunyikan (tidak ada peringatan palsu)', () => {
  const { ctx, dom } = muatPanel();
  ctx.renderPeringatanKpiCd({ rincianCreditDebit: { tidakDikenali: 0, kolomJenisHilang: false, gagalDibaca: false }, perluTindakLanjut: [] });
  benar(dom.kpiCdPeringatan.hidden === true, 'ringkasan tidak disembunyikan padahal semua beres');
  benar(dom.kpiCdRincian.hidden === true, 'rincian tidak disembunyikan');
});

uji('kolom Jenis hilang (kasus DEV): tampil, dan menyebut cara memperbaiki', () => {
  const { ctx, dom } = muatPanel();
  ctx.renderPeringatanKpiCd({ rincianCreditDebit: { tidakDikenali: 1329513, kolomJenisHilang: true, gagalDibaca: false }, perluTindakLanjut: [] });
  benar(dom.kpiCdPeringatan.hidden === false, 'harus tampil');
  benar(dom.kpiCdPeringatanJudul.innerHTML.includes('tidak dapat dihitung'), 'judul tidak menyebut breakdown');
  benar(dom.kpiCdPeringatanTeks.innerHTML.includes('Jenis'), 'teks tidak menyebut kolom Jenis');
  benar(dom.kpiCdPeringatanTeks.innerHTML.includes('Rp1.329.513'), 'nominal total tidak disebut');
});

uji('gagal baca: tidak menulis "Rp0 belum masuk" dan tidak menyuruh tambah kolom', () => {
  const { ctx, dom } = muatPanel();
  ctx.renderPeringatanKpiCd({ rincianCreditDebit: { tidakDikenali: 0, kolomJenisHilang: false, gagalDibaca: true }, perluTindakLanjut: [] });
  const t = dom.kpiCdPeringatanTeks.innerHTML;
  benar(!t.includes('Rp0'), 'teks menyiratkan nominal nol: ' + t);
  benar(!t.includes('Tambahkan kolom'), 'saran tambah kolom salah untuk kasus gagal baca: ' + t);
  benar(t.includes('gagal dibaca'), 'teks tidak menyebut penyebab: ' + t);
});

uji('gagal baca: rincian disembunyikan karena tidak ada daftar baris', () => {
  const { ctx, dom } = muatPanel();
  ctx.renderPeringatanKpiCd({ rincianCreditDebit: { tidakDikenali: 0, kolomJenisHilang: false, gagalDibaca: true }, perluTindakLanjut: [] });
  benar(dom.kpiCdRincian.hidden === true, 'rincian tidak disembunyikan');
  eq(dom.kpiCdRincianTbody.innerHTML, '', 'tbody tidak dikosongkan');
});

uji('payload kosong / field tidak ada: tidak error, panel disembunyikan', () => {
  for (const res of [{}, { rincianCreditDebit: {} }, { rincianCreditDebit: {}, perluTindakLanjut: [] }, null, undefined]) {
    const { ctx, dom } = muatPanel();
    ctx.renderPeringatanKpiCd(res);
    benar(dom.kpiCdPeringatan.hidden === true, 'panel tampil untuk payload kosong: ' + JSON.stringify(res));
  }
});

uji('peralihan periode tidak menyisakan teks periode lama', () => {
  const { ctx, dom } = muatPanel();
  ctx.renderPeringatanKpiCd(PAYLOAD_KARANGAN);
  eq(dom.kpiCdRincianJudul.textContent, '4 baris belum terkategori - total Rp43.800 belum masuk Laba Bersih', 'judul awal salah');
  ctx.renderPeringatanKpiCd({ rincianCreditDebit: { tidakDikenali: 0, kolomJenisHilang: false, gagalDibaca: false }, perluTindakLanjut: [] });
  eq(dom.kpiCdRincianJudul.textContent, 'Rincian baris belum terkategori', 'judul basi periode lama tertinggal');
  ctx.renderPeringatanKpiCd(PAYLOAD_KARANGAN);
  benar(dom.kpiCdRincian.hidden === false, 'panel tidak muncul kembali setelah periode kedua');
  eq((dom.kpiCdRincianTbody.innerHTML.match(/<tr>/g) || []).length, 4, 'baris periode kedua tidak lengkap');
});

uji('alasan CAMPURAN punya terjemahan sendiri', () => {
  const { ctx, dom } = muatPanel();
  ctx.renderPeringatanKpiCd({
    rincianCreditDebit: { tidakDikenali: 27317, kolomJenisHilang: false, gagalDibaca: false },
    perluTindakLanjut: [{ tanggal: '2024-06-02', tipe: 'CREDIT', kategori: 'Adonan', deskripsi: '-', nominal: 27317, jenis: 'Campuran', alasan: 'CAMPURAN' }],
  });
  benar(dom.kpiCdRincianTbody.innerHTML.includes('belum bisa dipecah'), 'alasan CAMPURAN tidak diterjemahkan');
});

uji('isi baris di-escape: markup di data tidak menjadi HTML', () => {
  const { ctx, dom } = muatPanel();
  ctx.renderPeringatanKpiCd({
    rincianCreditDebit: { tidakDikenali: 1537, kolomJenisHilang: false, gagalDibaca: false },
    perluTindakLanjut: [{ tanggal: '2024-06-02', tipe: 'CREDIT', kategori: '<b>karangan</b>', deskripsi: '"kutip"', nominal: 1537, jenis: '', alasan: 'JENIS_KOSONG' }],
  });
  const t = dom.kpiCdRincianTbody.innerHTML;
  benar(t.includes('&lt;b&gt;karangan&lt;/b&gt;'), 'tag dari data tidak di-escape: ' + t);
  benar(!t.includes('<b>karangan</b>'), 'tag dari data lolos menjadi HTML: ' + t);
  benar(t.includes('&quot;kutip&quot;'), 'tanda kutip dari data tidak di-escape: ' + t);
});

uji('jumlah baris yang ditampilkan = jumlah baris bermasalah', () => {
  // Kalau render memotong daftar tanpa memberi tahu, pengguna mengira hanya
  // sebagian baris yang bermasalah.
  const { ctx, dom } = muatPanel();
  ctx.renderPeringatanKpiCd(PAYLOAD_KARANGAN);
  const banyak = PAYLOAD_KARANGAN.perluTindakLanjut;
  eq((dom.kpiCdRincianTbody.innerHTML.match(/<tr>/g) || []).length, banyak.length, 'jumlah baris');
  eq(TOTAL_MASALAH, banyak.reduce((s, b) => s + b.nominal, 0), 'total nominal payload harus cocok dengan isi baris');
});

// ---------------------------------------------------------------
// Pendanaan modal: baris "Uang Modal" / "Pengembalian uang modal"
// sudah diklasifikasi di backend (PENDANAAN_MODAL). Panel harus
// menampilkannya sebagai CATATAN NETRAL (nominalnya tetap terlihat,
// jangan hilang diam-diam) - bukan peringatan "belum terkategori".
uji('catatan pendanaan modal: tampil netral tanpa baris bermasalah', () => {
  const { ctx, dom } = muatPanel();
  ctx.renderPeringatanKpiCd({
    rincianCreditDebit: { tidakDikenali: 0, pendanaanModal: 3600137, kolomJenisHilang: false, gagalDibaca: false },
    perluTindakLanjut: [],
  });
  benar(dom.kpiCdPeringatan.hidden === false, 'catatan pendanaan harus tampil');
  benar(dom.kpiCdPeringatanJudul.innerHTML.includes('Catatan'), 'judul harus netral: ' + dom.kpiCdPeringatanJudul.innerHTML);
  benar(!dom.kpiCdPeringatanJudul.innerHTML.includes('belum terkategori'), 'judul tidak boleh jadi peringatan: ' + dom.kpiCdPeringatanJudul.innerHTML);
  benar(dom.kpiCdPeringatanTeks.innerHTML.includes('Rp3.600.137'), 'nominal pendanaan tidak disebut');
  benar(dom.kpiCdPeringatanTeks.innerHTML.includes('TIDAK dihitung'), 'penjelasan tidak dihitung sebagai biaya tidak ada');
  benar(dom.kpiCdRincian.hidden === true, 'tabel rincian baris bermasalah tidak boleh tampil');
  eq(dom.kpiCdRincianTbody.innerHTML, '', 'tbody harus kosong');
});

uji('catatan pendanaan modal menyatu dengan peringatan baris bermasalah', () => {
  const { ctx, dom } = muatPanel();
  const payload = JSON.parse(JSON.stringify(PAYLOAD_KARANGAN));
  payload.rincianCreditDebit.pendanaanModal = 900013;
  ctx.renderPeringatanKpiCd(payload);
  const t = dom.kpiCdPeringatanTeks.innerHTML;
  benar(t.includes('Rp43.800'), 'peringatan utama hilang: ' + t);
  benar(t.includes('Rp900.013'), 'catatan pendanaan tidak menyatu: ' + t);
  benar(dom.kpiCdPeringatanJudul.innerHTML.includes('4 baris'), 'judul peringatan utama berubah: ' + dom.kpiCdPeringatanJudul.innerHTML);
});

uji('tanpa pendanaan: perilaku lama dipertahankan (panel disembunyikan)', () => {
  const { ctx, dom } = muatPanel();
  ctx.renderPeringatanKpiCd({ rincianCreditDebit: { tidakDikenali: 0, kolomJenisHilang: false, gagalDibaca: false }, perluTindakLanjut: [] });
  benar(dom.kpiCdPeringatan.hidden === true, 'panel tidak boleh tampil tanpa alasan');
  eq(dom.kpiCdPeringatanJudul.innerHTML, 'Baris Credit/Debit belum terkategori', 'judul default berubah');
});

// ---------- ringkasan ----------
console.log('');
if (gagal.length) {
  console.log('=== ' + lulus + ' lulus, ' + gagal.length + ' gagal ===');
  gagal.forEach((g) => console.log('  - ' + g));
  process.exit(1);
} else {
  console.log('=== ' + lulus + ' lulus, 0 gagal ===');
}
