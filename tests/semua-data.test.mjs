// Tes regresi: perilaku filter periode di dashboard.
//
// Aturan yang dikunci:
//   1. Setelah login dashboard menampilkan SEMUA data (periode kosong),
//      bukan layar kosong "Pilih periode dan klik Tampilkan".
//   2. Filter tanggal baru aktif setelah user mengisi Periode Mulai DAN
//      Periode Selesai lalu menekan "Tampilkan".
//   3. Mengisi hanya satu tanggal tidak boleh memuat apa pun (toast saja),
//      supaya rentang setengah jadi tidak diam-diam dianggap "semua data".
//   4. Tab Penjualan dan Grafik memakai aturan yang sama dan memuat semua
//      data sekali saat tabnya pertama dibuka.
//   5. Tombol Reset mengembalikan tampilan ke semua data, bukan layar kosong.
//
//   node tests/semua-data.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import { targetHtml } from './lib/jalur.mjs';

const target = targetHtml();
const html = fs.readFileSync(target, 'utf8');

let lulus = 0;
const gagal = [];
function uji(nama, fn) {
  try { fn(); lulus++; console.log('  LULUS  ' + nama); }
  catch (e) { gagal.push(nama + ' :: ' + e.message); console.log('  GAGAL  ' + nama + ' :: ' + e.message); }
}
function benar(v, pesan) { if (!v) throw new Error(pesan || 'harus bernilai true'); }
function eq(a, b, pesan) {
  if (a !== b) throw new Error((pesan ? pesan + ': ' : '') + 'dapat ' + JSON.stringify(a) + ', harus ' + JSON.stringify(b));
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

// Sandbox minimal: cukup untuk menjalankan fungsi tanpa DOM/browser sungguhan.
// safeGoogleRun hanya mencatat panggilan (tidak menjalankan success handler),
// jadi yang diuji adalah nilai yang benar-benar dikirim ke server.
function sandboxDengan(nilaiInput) {
  const dicatat = [];
  const elemen = {};
  Object.keys(nilaiInput || {}).forEach(function (id) {
    elemen[id] = { value: nilaiInput[id], innerHTML: '', textContent: '' };
  });
  const sandbox = {
    reportLoading: false,
    showToast: function (pesan) { dicatat.push({ toast: pesan }); },
    escapeHtml: function (s) { return String(s); },
    formatIDR: function (n) { return 'Rp ' + n; },
    setButtonsDisabled: function () { },
    isiTbody: function () { },
    getToken: function () { return 'TOKEN'; },
    safeGoogleRun: function (nama, args) { dicatat.push({ fn: nama, args: args }); },
    ambilCacheLaporan: function () { return null; },
    perbaruiCacheLaporan: function () { },
    renderReport: function () { },
    renderTopProducts: function () { },
    renderChart: function () { },
    renderHeroDelta: function () { },
    renderNetDelta: function () { },
    renderDailyTrend: function () { },
    renderInsights: function () { },
    updateKPI: function () { },
    resetPeringatanKpiCd: function () { },
    cachedPenjualan: [],
    localStorage: {
      setItem: function (k, v) { dicatat.push({ set: [k, v] }); },
      removeItem: function (k) { dicatat.push({ hapus: k }); }
    },
    document: {
      getElementById: function (id) {
        if (!elemen[id]) elemen[id] = { value: '', innerHTML: '', textContent: '' };
        return elemen[id];
      }
    }
  };
  return { sandbox: sandbox, dicatat: dicatat, elemen: elemen };
}

function jalankanFungsi(nama, kota) {
  const fungsi = potongFungsi(html, 'function ' + nama);
  vm.runInNewContext(fungsi + '\nthis.__panggil = ' + nama + ';', kota.sandbox);
  kota.sandbox.__panggil();
  return kota;
}

const panggilanServer = (kota) => kota.dicatat.filter((d) => d.fn === 'getReportByDateRange')[0];
const adaToast = (kota) => kota.dicatat.some((d) => d.toast);

// ---------- 1. Login: semua data, tanpa filter -----------------------------
uji('initDashboardData(): periode dikosongkan dan semua data dimuat', () => {
  const b = potongFungsi(html, 'function initDashboardData');
  benar(/startEl\.value\s*=\s*''/.test(b), 'Periode Mulai harus dikosongkan saat login');
  benar(/endEl\.value\s*=\s*''/.test(b), 'Periode Selesai harus dikosongkan saat login');
  benar(/loadReport\(true\)/.test(b), 'harus memuat semua data lewat loadReport(true)');
  benar(!/=\s*today/.test(b), 'periode tidak boleh otomatis diisi tanggal hari ini');
  benar(!/showEmptyPeriodState/.test(b), 'setelah login jangan tampilkan layar kosong');
});

uji('initDashboardData(): prefetch produk/bahan tetap tidak di jalur login', () => {
  const b = potongFungsi(html, 'function initDashboardData');
  benar(!/(^|[^.\w])loadProduk\s*\(\s*\)/.test(b), 'loadProduk() tidak boleh dipanggil langsung');
  benar(!/(^|[^.\w])loadStokBahan\s*\(\s*\)/.test(b), 'loadStokBahan() tidak boleh dipanggil langsung');
});

// ---------- 2. loadReport: rentang kosong = semua data ---------------------
uji('loadReport(): menerima mode tanpa filter sebelum validasi tanggal', () => {
  const b = potongFungsi(html, 'function loadReport');
  benar(/tanpaFilter\s*===\s*true/.test(b), 'harus punya cabang tanpaFilter === true');
  benar(/\(!start\s*&&\s*!end\)/.test(b), 'dua tanggal kosong harus dianggap semua data');
  const posMode = b.indexOf('semuaData');
  const posValidasi = b.indexOf('if (!start || !end)');
  benar(posMode !== -1 && posValidasi !== -1 && posMode < posValidasi, 'mode semua-data harus ditentukan sebelum validasi tanggal');
  benar(/'getReportByDateRange', \[getToken\(\), start, end\]/.test(b), 'rentang yang dikirim harus start/end (boleh kosong)');
});

uji('loadReport(): tanggal kosong mengirim rentang kosong ke server', () => {
  const kota = jalankanFungsi('loadReport', sandboxDengan({ startDate: '', endDate: '' }));
  const p = panggilanServer(kota);
  benar(p, 'getReportByDateRange tidak dipanggil');
  eq(p.args[1], '', 'start harus kosong (tanpa batas bawah)');
  eq(p.args[2], '', 'end harus kosong (tanpa batas atas)');
  benar(!adaToast(kota), 'tidak boleh ada toast error saat memuat semua data');
});

uji('loadReport(): tanggal terisi mengirim rentang terpilih', () => {
  const kota = jalankanFungsi('loadReport', sandboxDengan({ startDate: '2026-11-01', endDate: '2026-11-10' }));
  const p = panggilanServer(kota);
  benar(p, 'getReportByDateRange tidak dipanggil');
  eq(p.args[1], '2026-11-01', 'start');
  eq(p.args[2], '2026-11-10', 'end');
  benar(kota.dicatat.some((d) => d.set && d.set[0] === 'startDate'), 'periode terpilih harus disimpan');
});

uji('loadReport(): hanya satu tanggal diisi -> toast, tanpa permintaan server', () => {
  const kota = jalankanFungsi('loadReport', sandboxDengan({ startDate: '2026-11-01', endDate: '' }));
  benar(!panggilanServer(kota), 'tidak boleh memanggil server dengan rentang setengah jadi');
  benar(adaToast(kota), 'user harus diberi tahu untuk mengisi kedua tanggal');
});

uji('loadReport(): periode terbalik ditolak', () => {
  const kota = jalankanFungsi('loadReport', sandboxDengan({ startDate: '2026-11-10', endDate: '2026-11-01' }));
  benar(!panggilanServer(kota), 'tidak boleh memanggil server untuk periode terbalik');
  benar(adaToast(kota), 'harus ada toast periode tidak valid');
});

// ---------- 3. Tab Penjualan ----------------------------------------------
uji('loadSalesByDateRange(): dua tanggal kosong mengirim rentang kosong', () => {
  const kota = jalankanFungsi('loadSalesByDateRange', sandboxDengan({ salesStartDate: '', salesEndDate: '' }));
  const p = panggilanServer(kota);
  benar(p, 'getReportByDateRange tidak dipanggil');
  eq(p.args[1], '', 'start');
  eq(p.args[2], '', 'end');
});

uji('loadSalesByDateRange(): tanggal terisi mengirim rentang terpilih', () => {
  const kota = jalankanFungsi('loadSalesByDateRange', sandboxDengan({ salesStartDate: '2026-10-01', salesEndDate: '2026-10-31' }));
  const p = panggilanServer(kota);
  benar(p, 'getReportByDateRange tidak dipanggil');
  eq(p.args[1], '2026-10-01', 'start');
  eq(p.args[2], '2026-10-31', 'end');
});

uji('loadSalesByDateRange(): hanya satu tanggal diisi ditolak', () => {
  const kota = jalankanFungsi('loadSalesByDateRange', sandboxDengan({ salesStartDate: '', salesEndDate: '2026-10-31' }));
  benar(!panggilanServer(kota), 'tidak boleh memanggil server');
  benar(adaToast(kota), 'harus ada toast');
});

// ---------- 4. Tab Grafik --------------------------------------------------
uji('loadChartByDateRange(): dua tanggal kosong mengirim rentang kosong', () => {
  const kota = jalankanFungsi('loadChartByDateRange', sandboxDengan({ chartStartDate: '', chartEndDate: '' }));
  const p = panggilanServer(kota);
  benar(p, 'getReportByDateRange tidak dipanggil');
  eq(p.args[1], '', 'start');
  eq(p.args[2], '', 'end');
});

uji('loadChartByDateRange(): tanggal terisi mengirim rentang terpilih', () => {
  const kota = jalankanFungsi('loadChartByDateRange', sandboxDengan({ chartStartDate: '2026-09-01', chartEndDate: '2026-09-30' }));
  const p = panggilanServer(kota);
  benar(p, 'getReportByDateRange tidak dipanggil');
  eq(p.args[1], '2026-09-01', 'start');
  eq(p.args[2], '2026-09-30', 'end');
});

uji('loadChartByDateRange(): hanya satu tanggal diisi ditolak', () => {
  const kota = jalankanFungsi('loadChartByDateRange', sandboxDengan({ chartStartDate: '2026-09-01', chartEndDate: '' }));
  benar(!panggilanServer(kota), 'tidak boleh memanggil server');
  benar(adaToast(kota), 'harus ada toast');
});

// ---------- 5. Reset kembali ke semua data ---------------------------------
uji('resetFilters()/resetSalesFilters()/resetChartFilters() memuat semua data', () => {
  const kasus = [
    ['function resetFilters', /loadReport\(true\)/, 'loadReport(true)'],
    ['function resetSalesFilters', /loadSalesByDateRange\(true\)/, 'loadSalesByDateRange(true)'],
    ['function resetChartFilters', /loadChartByDateRange\(true\)/, 'loadChartByDateRange(true)']
  ];
  for (const [penanda, pola, harap] of kasus) {
    const b = potongFungsi(html, penanda);
    benar(pola.test(b), penanda + ' harus memanggil ' + harap);
    benar(!/showEmptyPeriodState/.test(b), penanda + ' tidak boleh kembali ke layar kosong');
    benar(!/=\s*today/.test(b), penanda + ' tidak boleh mengisi tanggal hari ini otomatis');
  }
});

uji('input periode tab Penjualan/Grafik tidak diisi tanggal hari ini saat init', () => {
  benar(!/(chartStartEl|chartEndEl|salesStartEl|salesEndEl)\.value\s*=\s*today/.test(html),
    'input periode tab Grafik/Penjualan harus dibiarkan kosong (kosong = semua data)');
});

// ---------- 6. Tab Penjualan & Grafik auto-load semua data ------------------
uji('activateSection(): tab Penjualan/Grafik memuat semua data sekali saat dibuka', () => {
  const b = potongFungsi(html, 'function activateSection');
  benar(/targetId\s*===\s*'section-penjualan'[\s\S]{0,160}?loadSalesByDateRange\(true\)/.test(b),
    'membuka tab Penjualan harus memuat semua data (loadSalesByDateRange(true))');
  benar(/targetId\s*===\s*'section-chart'[\s\S]{0,160}?loadChartByDateRange\(true\)/.test(b),
    'membuka tab Grafik harus memuat semua data (loadChartByDateRange(true))');
  benar(/!salesTabAutoLoaded/.test(b), 'tab Penjualan harus dijaga flag sekali-muat');
  benar(/!chartTabAutoLoaded/.test(b), 'tab Grafik harus dijaga flag sekali-muat');
});

// ---------- laporan --------------------------------------------------------
console.log('');
if (gagal.length) {
  console.log('=== ' + gagal.length + ' DARI ' + (lulus + gagal.length) + ' TEST GAGAL ===');
  for (const g of gagal) console.log('  - ' + g);
  process.exit(1);
}
console.log('=== SEMUA LOLOS (' + lulus + ' tes) ===');
