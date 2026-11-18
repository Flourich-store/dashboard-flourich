// Tes regresi teks mobile (320-390px): label filter, subjudul KPI, header
// tabel, label bottom nav, subjudul tile aksi cepat, dan nama cabang di select.
//
// Audit render pada 320/360/390px menemukan dua potongan teks nyata:
//   - select Cabang (Overview/Grafik/Catatan Keuangan/Penjualan) butuh 240px
//     tetapi kotaknya hanya 212-218px di 320px, sehingga nama cabang panjang
//     terpotong di tengah kata. <select> tidak bisa membungkus teks, jadi
//     helper JS memasang kelas .cabang-modul--padat saat tidak muat.
//   - .quick-sub dipaksa satu baris + ellipsis, sehingga "Pemasukan & biaya
//     operasional" terpotong 28px dan "Tambah, ubah & hapus produk" 19px.
//
// Yang TIDAK terpotong (sudah dicek): label filter, subjudul/label KPI, label
// bottom nav, dan header tabel (tabel memang digeser horizontal).
//
//   node tests/teks-mobile.test.mjs
import fs from 'node:fs';
import { targetHtml } from './lib/jalur.mjs';

const html = fs.readFileSync(targetHtml(), 'utf8').replace(/\r\n/g, '\n');

let lulus = 0;
const gagal = [];
function uji(nama, fn) {
  try { fn(); lulus++; console.log('  LULUS  ' + nama); }
  catch (e) { gagal.push(nama); console.log('  GAGAL  ' + nama + ' -> ' + e.message); }
}
function perlu(kondisi, pesan) { if (!kondisi) throw new Error(pesan); }

function potong(mulai, akhir) {
  const i = html.indexOf(mulai);
  if (i === -1) throw new Error('tidak ditemukan: ' + mulai);
  const j = html.indexOf(akhir, i);
  if (j === -1) throw new Error('batas tidak ditemukan: ' + akhir);
  return html.slice(i, j);
}

const fnPadat = potong('function sesuaikanPadatCabang', '\n    }\n');
const fnRender = potong('function renderFilterCabangModul() {', '\n      simpanCabangModul();');
const blok360 = potong('@media (max-width: 360px) {', '\n      }\n');

uji('TM-1: varian padat select cabang ada dan cukup kecil', () => {
  const i = html.indexOf('.cabang-modul--padat {');
  perlu(i !== -1, 'aturan .cabang-modul--padat tidak ada');
  const aturan = html.slice(i, html.indexOf('}', i));
  perlu(/font-size:\s*11\.5px/.test(aturan), 'font varian padat bukan 11.5px');
  perlu(/padding:\s*9px 5px/.test(aturan), 'padding varian padat bukan 9px 5px');
});

uji('TM-2: helper mengukur lebar intrinsik select tiruan (bukan menebak)', () => {
  perlu(/document\.createElement\('select'\)/.test(fnPadat), 'tidak membuat select tiruan');
  perlu(/ukur\.innerHTML = pilih\.innerHTML/.test(fnPadat), 'opsi tiruan tidak disalin');
  perlu(/width:auto/.test(fnPadat) && /visibility:hidden/.test(fnPadat), 'select tiruan tidak diukur lebar intrinsiknya');
  perlu(/ukur\.getBoundingClientRect\(\)\.width/.test(fnPadat), 'lebar kebutuhan tidak diukur');
  perlu(/classList\.toggle\('cabang-modul--padat',\s*butuh > lebar \+ 0\.5\)/.test(fnPadat), 'kelas tidak dipasang berdasarkan hasil ukur');
});

uji('TM-3: modul tersembunyi (lebar 0) tidak mengubah kelas', () => {
  const iLebar = fnPadat.indexOf('if (!lebar) return;');
  const iToggle = fnPadat.indexOf("classList.toggle('cabang-modul--padat'");
  perlu(iLebar !== -1, 'penjaga lebar 0 tidak ada');
  perlu(iToggle !== -1 && iLebar < iToggle, 'penjaga lebar 0 harus sebelum pemasangan kelas');
});

uji('TM-4: dipanggil untuk kasir (terkunci) dan admin (pilihan)', () => {
  const n = (fnRender.match(/sesuaikanPadatCabang\(pilih\);/g) || []).length;
  perlu(n === 2, 'pemanggilan di renderFilterCabangModul = ' + n + ', harus 2');
});

uji('TM-5: dihitung ulang saat modul dibuka (select awalnya lebar 0)', () => {
  const fnAktif = potong('function activateSection(targetId) {', 'navItems.forEach(function (navItem) {');
  perlu(/sesuaikanPadatCabang\(pilihCabang\)/.test(fnAktif), 'activateSection tidak menghitung ulang varian padat');
});

uji('TM-6: dihitung ulang saat lebar layar berubah (rotasi)', () => {
  perlu(/addEventListener\('resize'/.test(html), 'tidak ada listener resize');
  perlu(/timerPadatCabang/.test(html), 'tidak ada penunda (debounce) hitung ulang');
});

uji('TM-7: subjudul tile aksi cepat boleh membungkus di 360px ke bawah', () => {
  perlu(/\.quick-sub\s*{[^}]*white-space:\s*normal/.test(blok360), '.quick-sub masih nowrap di 320-360px');
  perlu(/\.quick-sub\s*{[^}]*overflow:\s*visible/.test(blok360), '.quick-sub masih memotong (overflow hidden)');
});

uji('TM-8: desktop tidak berubah (ellipsis dasar & lebar minimum select)', () => {
  const dasar = html.slice(html.indexOf('    .quick-sub {'), html.indexOf('    @media (max-width: 900px)'));
  perlu(/white-space:\s*nowrap/.test(dasar), 'aturan dasar .quick-sub berubah');
  perlu(/text-overflow:\s*ellipsis/.test(dasar), 'aturan dasar .quick-sub berubah');
  const iSel = html.indexOf('    .cabang-modul {');
  const aturanSel = html.slice(iSel, html.indexOf('}', iSel));
  perlu(/min-width:\s*140px/.test(aturanSel), 'lebar minimum select desktop berubah');
});

console.log('');
console.log(lulus + ' lulus, ' + gagal.length + ' gagal');
if (gagal.length) { console.log('GAGAL: ' + gagal.join(', ')); process.exit(1); }
