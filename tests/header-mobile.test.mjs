// Tes regresi header mobile: teks tidak boleh terpotong.
//
// Dulu, di layar 360px:
//   - logo persegi (1600x1600) menyusut jadi 30x30 sehingga wordmark FLOURICH
//     tak terbaca,
//   - username terpotong "manajer.flo…" karena badge berbagi baris dengan
//     tombol tema dan tombol Keluar.
//
// Tes ini mengunci aturan CSS yang memperbaikinya. Pemeriksaan bersifat teks
// (bukan render) supaya cepat, dan sudah divalidasi manual pada 320/360/390px.
//
//   node tests/header-mobile.test.mjs
import fs from 'node:fs';
import { targetHtml } from './lib/jalur.mjs';

const html = fs.readFileSync(targetHtml(), 'utf8');

let lulus = 0;
const gagal = [];
function uji(nama, fn) {
  try { fn(); lulus++; console.log('  LULUS  ' + nama); }
  catch (e) { gagal.push(nama); console.log('  GAGAL  ' + nama + ' -> ' + e.message); }
}
function wajib(teks, label) {
  if (!html.includes(teks)) throw new Error('tidak ada: ' + label);
}

// Blok media query mobile yang memuat aturan header.
function blokMobile() {
  const mulai = html.indexOf('@media (max-width: 768px) {');
  if (mulai === -1) throw new Error('media query mobile tidak ditemukan');
  const selesai = html.indexOf('\n    }', html.indexOf('.modal.show', mulai));
  return html.slice(mulai, selesai === -1 ? undefined : selesai);
}

uji('HDR-1: logo tidak menyusut dan tetap terbaca di mobile', () => {
  const b = blokMobile();
  const i = b.indexOf('.brand-wrapper .logo-left');
  if (i === -1) throw new Error('aturan logo mobile tidak ada');
  const aturan = b.slice(i, i + 320);
  if (!/flex:\s*0\s+0\s+auto/.test(aturan)) throw new Error('logo masih boleh menyusut');
  if (!/height:\s*44px/.test(aturan)) throw new Error('tinggi logo mobile bukan 44px');
});

uji('HDR-2: baris header boleh membungkus, badge tidak dipecah', () => {
  const b = blokMobile();
  if (!/\.brand-wrapper\s*{[^}]*flex-wrap:\s*wrap/.test(b)) throw new Error('brand-wrapper tidak wrap');
  if (!/\.header-info\s*{[^}]*flex-wrap:\s*wrap/.test(b)) throw new Error('header-info tidak wrap');
  if (!/\.brand-wrapper \.live-badge\s*{[^}]*white-space:\s*nowrap/.test(b)) throw new Error('badge status bisa terpotong');
});

uji('HDR-3: username diberi satu baris penuh (tidak dipotong)', () => {
  const b = blokMobile();
  const i = b.indexOf('.header-info > .user-badge');
  if (i === -1) throw new Error('aturan user-badge mobile tidak ada');
  const aturan = b.slice(i, i + 220);
  if (!/flex:\s*1\s+1\s+100%/.test(aturan)) throw new Error('user-badge belum memakai satu baris penuh');
  if (!/max-width:\s*100%/.test(aturan)) throw new Error('user-badge belum dibatasi 100%');
});

uji('HDR-4: tombol tema dan Keluar utuh', () => {
  const b = blokMobile();
  const i = b.indexOf('.header-info .theme-toggle,');
  if (i === -1) throw new Error('aturan tombol header tidak ada');
  const aturan = b.slice(i, i + 260);
  if (!/flex:\s*0\s+0\s+auto/.test(aturan)) throw new Error('tombol bisa menyusut');
  if (!/white-space:\s*nowrap/.test(aturan)) throw new Error('teks tombol bisa terpotong');
});

uji('HDR-5: header mobile dirapatkan (padding 10px 12px)', () => {
  const b = blokMobile();
  const i = b.indexOf('.app-header {');
  if (i === -1) throw new Error('aturan app-header mobile tidak ada');
  const aturan = b.slice(i, i + 420);
  if (!/padding:\s*10px 12px/.test(aturan)) throw new Error('padding header mobile bukan 10px 12px');
  if (!/flex-direction:\s*column/.test(aturan)) throw new Error('header mobile harus bertumpuk');
});

uji('HDR-6: desktop tidak ikut berubah', () => {
  // Aturan dasar logo (desktop) tetap memakai tinggi 35px dan tidak dipaksa wrap.
  const dasar = html.slice(html.indexOf('    .app-header {'), html.indexOf('    .live-badge {'));
  if (/\n\s+flex-wrap:/.test(dasar)) throw new Error('aturan dasar header tidak boleh wrap');
  if (!/height:\s*35px/.test(dasar)) throw new Error('tinggi logo desktop berubah');
});

console.log('');
console.log(lulus + ' lulus, ' + gagal.length + ' gagal');
if (gagal.length) { console.log('GAGAL: ' + gagal.join(', ')); process.exit(1); }
