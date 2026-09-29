#!/usr/bin/env node
/**
 * Regression test: layout responsif DashboardStandalone.html
 *
 * Menguji 3 defect yang ditemukan lewat pengukuran viewport sungguhan
 * (iframe 320/360/390/768 + landscape) di browser:
 *
 *   BUG-1  Halaman login tidak bisa di-scroll saat viewport tinggi < 620px
 *          (landscape HP, atau potret 320x568) -> tombol "Masuk" unreachable.
 *          Root cause: `html,body{overflow:hidden}` (container-scroll) +
 *          #loginPage bukan anak .app-shell sehingga tanpa scroller.
 *   BUG-2  Chip tren (Semua/Cash/QRIS) meluber di layar <=340px.
 *          Root cause: .tchip dipaksa padding 16px demi touch target 44px.
 *   BUG-3  Username di header terpotong kasar tanpa ellipsis.
 *          Root cause: text-overflow dipasang di container flex, bukan di <span> anak.
 *
 * Test ini adalah guard CSS statis (memastikan aturan perbaikannya ada).
 * Bukti perilaku yang sesungguhnya adalah pengukuran geometri di browser
 * (lihat ringkasan audit: 320px -> toggle butuh 215px vs tempat 186px).
 *
 * Pakai:  node responsive-mobile.test.mjs [path/DashboardStandalone.html]
 * Exit 0 = semua lolos, exit 1 = ada yang gagal.
 */

import { readFileSync } from 'node:fs';
import { targetHtml } from './lib/jalur.mjs';

const target = targetHtml();

const html = readFileSync(target, 'utf8');

// --- kumpulkan semua blok <style> -------------------------------------------
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
  .map((m) => m[1])
  .join('\n');

// --- ekstrak blok @media (brace matching, bisa bersarang) --------------------
function mediaBlocks(source) {
  const out = [];
  const re = /@media([^{]+)\{/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const cond = m[1].trim();
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    out.push({ cond, body: source.slice(re.lastIndex, i - 1) });
    re.lastIndex = i;
  }
  return out;
}

const medias = mediaBlocks(css);

/** Cari blok @media yang kondisinya cocok pola(regex) DAN isinya punya pola. */
function findInMedia(condRe, bodyRe) {
  return medias.find((b) => condRe.test(b.cond) && bodyRe.test(b.body));
}

const results = [];
const check = (id, title, pass, detail) => results.push({ id, title, pass, detail });

// --- BUG-1: .login-wrapper harus jadi scroller sendiri di mobile -------------
const loginScroll =
  findInMedia(
    /max-width:\s*768px/i,
    /\.login-wrapper[^{]*\{[^}]*overflow-y:\s*(auto|scroll)/i
  ) || findInMedia(/max-width/i, /\.login-wrapper[^{]*\{[^}]*overflow-y:\s*(auto|scroll)/i);

check(
  'BUG-1a',
  'Halaman login punya scroller sendiri di mobile (.login-wrapper overflow-y auto/scroll)',
  Boolean(loginScroll),
  loginScroll
    ? `ditemukan pada @media ${loginScroll.cond}`
    : 'TIDAK ADA aturan .login-wrapper { overflow-y: auto|scroll } -> kartu login terpotong & tidak bisa digeser'
);

// --- BUG-1b: logo login diperkecil di layar pendek ---------------------------
const shortLogo = medias.find((b) => {
  if (!/max-height/i.test(b.cond)) return false;
  const m = b.body.match(/\.logo-login[^{]*\{([^}]*)\}/i);
  if (!m) return false;
  const w = m[1].match(/width:\s*(\d+)px/i);
  return w ? Number(w[1]) < 210 : false; // default logo-login 210px
});

check(
  'BUG-1b',
  'Logo login diperkecil pada layar pendek (@media max-height)',
  Boolean(shortLogo),
  shortLogo
    ? `ditemukan pada @media ${shortLogo.cond}`
    : 'TIDAK ADA @media (max-height: ...) yang mengecilkan .logo-login dari 210px -> kartu login >620px'
);

// --- BUG-2: chip tren tidak boleh meluber di <=360px -------------------------
const chipFix =
  findInMedia(
    /max-width:\s*(3[0-9]{2}|4[0-2][0-9])px/i,
    /\.hero-trend-toggle[^{]*\{[^}]*width:\s*100%/i
  ) ||
  findInMedia(
    /max-width:\s*(3[0-9]{2}|4[0-2][0-9])px/i,
    /\.tchip[^{]*\{[^}]*flex:\s*1\s+1\s+0/i
  ) ||
  findInMedia(/max-width/i, /\.tchip[^{]*\{[^}]*flex:\s*1\s+1\s+0/i);

check(
  'BUG-2',
  'Chip tren (Semua/Cash/QRIS) dibuat rata & tidak meluber di layar kecil',
  Boolean(chipFix),
  chipFix
    ? `ditemukan pada @media ${chipFix.cond}`
    : 'TIDAK ADA aturan .tchip { flex: 1 1 0 } atau .hero-trend-toggle { width:100% } -> 3 chip butuh 215px vs tempat 186px di 320px'
);

// --- BUG-3: ellipsis username di dalam span ---------------------------------
const spanEllipsis =
  /\.user-badge\s+span[^{]*\{[^}]*text-overflow:\s*ellipsis/i.test(css) ||
  /#lblUserEmail[^{]*\{[^}]*text-overflow:\s*ellipsis/i.test(css);

check(
  'BUG-3',
  'Username di header dipotong dengan ellipsis (aturan pada elemen <span> anak)',
  spanEllipsis,
  spanEllipsis
    ? 'aturan ellipsis ditemukan pada span anak .user-badge'
    : 'TIDAK ADA .user-badge span/#lblUserEmail { text-overflow: ellipsis } -> username terpotong keras tanpa "..."'
);

// --- laporan -----------------------------------------------------------------
let failed = 0;
console.log(`\nTarget : ${target}`);
console.log(`CSS    : ${css.length} karakter, ${medias.length} blok @media\n`);
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'LULOS  ' : 'GAGAL  '} [${r.id}] ${r.title}`);
  console.log(`         ${r.detail}\n`);
}
console.log(
  failed === 0
    ? '=== SEMUA LOLOS ==='
    : `=== ${failed} DARI ${results.length} TEST GAGAL ===`
);
process.exit(failed === 0 ? 0 : 1);
