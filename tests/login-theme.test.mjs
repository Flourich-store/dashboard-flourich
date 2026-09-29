#!/usr/bin/env node
/**
 * Regression test: form login harus mengikuti tema aktif (dark/light)
 *
 * Defect yang diperbaiki:
 *   BUG-T  Kartu login dikunci gelap di KEDUA tema. Root cause: aturan base
 *          .login-card memakai token "ink" (--ink, --ink-2, --ink-text,
 *          --ink-border) yang hanya bermakna di panel gelap, dan tidak ada
 *          padanannya di html.theme-dark. Akibatnya di light mode tetap gelap.
 *
 * Perbaikan: aturan base sekarang memakai token tema (--bg-surface, --bg,
 * --border-color, --text-primary, --text-secondary, --card-bg, --border,
 * --slate-600, --primary-light), dan identitas "ink" dipindahkan ke
 * overrides html.theme-dark supaya dark mode TIDAK BERUBAH.
 *
 * Test ini guard CSS statis. Bukti perilaku sesungguhnya = pengukuran
 * computed style di browser pada kedua tema.
 *
 * Pakai:  node login-theme.test.mjs [path/DashboardStandalone.html]
 * Exit 0 = semua lolos, exit 1 = ada yang gagal.
 */

import { readFileSync } from 'node:fs';
import { targetHtml } from './lib/jalur.mjs';

const target = targetHtml();
const html = readFileSync(target, 'utf8');

const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
  .map((m) => m[1])
  .join('\n');

/** Parse CSS jadi daftar aturan top-level. Isi @media/@supports/@keyframes
 *  diperlakukan sebagai blok opaque, sehingga aturan di dalamnya tidak
 *  ikut terambil (aturan login base & tema gelap keduanya top-level). */
function parseRules(source) {
  // Komentar dibuang dulu (panjang dipertahankan) supaya kurung kurawal
  // di dalam komentar tidak ikut terhitung sebagai blok.
  const src = source.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
  const rules = [];
  let i = 0;
  let sel = '';
  while (i < src.length) {
    const ch = src[i];
    if (ch === '{') {
      let depth = 1;
      let j = i + 1;
      while (j < src.length && depth > 0) {
        const c = src[j];
        if (c === '{') depth++;
        else if (c === '}') depth--;
        j++;
      }
      const body = src.slice(i + 1, j - 1);
      const selector = sel.trim();
      if (selector && !selector.startsWith('@')) rules.push({ selector, body });
      sel = '';
      i = j;
      continue;
    }
    if (ch === '}') {
      sel = '';
      i++;
      continue;
    }
    sel += ch;
    i++;
  }
  return rules;
}

const rules = parseRules(css);

/** Deklarasi terakhir (cascade) untuk selector TEPAT di luar @media. */
function decls(selector) {
  let last = null;
  for (const r of rules) {
    const parts = r.selector.split(',').map((p) => p.replace(/\s+/g, ' ').trim());
    if (parts.includes(selector)) last = r.body;
  }
  return last === null ? null : last.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
}

/** true bila deklarasi (terakhir) selector memuat pola re. */
const has = (selector, re) => {
  const d = decls(selector);
  return d !== null && re.test(d);
};

const results = [];
const check = (id, title, pass, detail) => results.push({ id, title, pass, detail });

// --- LIGHT-1: kartu login pakai token tema, bukan token ink ------------------
const cardDecls = decls('.login-card');
const inkLeft = cardDecls === null ? [] : cardDecls.match(/var\(--ink[^)]*\)/g) || [];

check(
  'LIGHT-1a',
  'Kartu login (base/light) memakai token tema untuk latar, border, teks',
  has('.login-card', /background:\s*linear-gradient\(160deg,\s*var\(--bg-surface\)\s*0%,\s*var\(--bg\)\s*100%\)/) &&
    has('.login-card', /border:\s*1px solid var\(--border-color\)/) &&
    has('.login-card', /color:\s*var\(--text-primary\)/),
  cardDecls || 'blok .login-card tidak ditemukan'
);
check(
  'LIGHT-1b',
  'Kartu login (light) tidak lagi memakai token ink (--ink, --ink-2, --ink-text, --ink-border)',
  cardDecls !== null && inkLeft.length === 0,
  inkLeft.length ? 'MASIH ADA: ' + inkLeft.join(', ') : 'bersih dari token ink'
);
check(
  'LIGHT-1c',
  'Bayangan kartu login disetel untuk latar terang (bukan hitam pekat 0.45)',
  has('.login-card', /box-shadow:[^;]*rgba\(15,\s*23,\s*42/),
  (cardDecls && cardDecls.match(/box-shadow:[^;]*/i)) || 'tidak ada box-shadow'
);

// --- LIGHT-2: judul & subjudul kontras benar di light -------------------------
check(
  'LIGHT-2',
  'Judul & subjudul login mengikuti tema (text-primary / text-secondary)',
  has('.login-card .login-title', /color:\s*var\(--text-primary\)/) &&
    has('.login-card .login-sub', /color:\s*var\(--text-secondary\)/),
  'title= ' + decls('.login-card .login-title') + ' | sub= ' + decls('.login-card .login-sub')
);

// --- LIGHT-3: input login terang dengan placeholder terbaca ------------------
check(
  'LIGHT-3',
  'Input login di light mode: latar putih, border abu, teks gelap, placeholder kontras',
  has('.login-card input', /background:\s*var\(--card-bg\)/) &&
    has('.login-card input', /border:\s*1px solid var\(--border\)/) &&
    has('.login-card input', /color:\s*var\(--text-primary\)/) &&
    has('.login-card input::placeholder', /color:\s*var\(--slate-600\)/),
  'input= ' + decls('.login-card input') + ' | placeholder= ' + decls('.login-card input::placeholder')
);

// --- LIGHT-4: tombol sekunder memakai gaya dashboard light -------------------
check(
  'LIGHT-4',
  'Tombol "Kembali ke Landing Page" ghost transparan, lebih kecil, token tema + hover hijau',
  has('.login-card .btn-secondary', /color:\s*var\(--slate-600\)/) &&
    has('.login-card .btn-secondary', /border-color:\s*var\(--border\)/) &&
    has('.login-card .btn-secondary', /background:\s*transparent/) &&
    has('.login-card .btn-secondary', /padding:\s*9px 14px/) &&
    has('.login-card .btn-secondary', /font-size:\s*13px/) &&
    has('.login-card .btn-secondary', /font-weight:\s*600/) &&
    has('.login-card .btn-secondary:hover', /background:\s*var\(--primary-light\)/),
  'normal= ' + decls('.login-card .btn-secondary') + ' | hover= ' + decls('.login-card .btn-secondary:hover')
);

// --- LIGHT-5: latar halaman login ikut tema ----------------------------------
check(
  'LIGHT-5',
  'Latar .login-wrapper di light mode memakai warna dasar tema (--bg-main)',
  has('.login-wrapper', /var\(--bg-main\)/),
  decls('.login-wrapper') || 'tidak ada'
);

// --- LIGHT-6: kotak pesan error dibingkai di light mode -----------------------
check(
  'LIGHT-6',
  'Kotak error login (#loginError) punya border di light mode',
  has('html:not(.theme-dark) #loginError', /border:\s*1px solid #fecaca/),
  decls('html:not(.theme-dark) #loginError') || 'tidak ada aturan border #loginError untuk light mode'
);

// --- DARK-1..3: dark mode harus tetap sama persis -----------------------------
check(
  'DARK-1',
  'Dark mode: kartu login tetap gradasi ink #0a101c -> #0e1b33 + bayangan + teks ink lama',
  has('html.theme-dark .login-card', /background:\s*linear-gradient\(160deg,\s*#0a101c 0%,\s*#0e1b33 100%\)/) &&
    has('html.theme-dark .login-card', /border:\s*1px solid var\(--ink-border\)/) &&
    has('html.theme-dark .login-card', /box-shadow:\s*0 30px 80px rgba\(0,\s*0,\s*0,\s*0\.5\)/) &&
    has('html.theme-dark .login-card', /color:\s*var\(--ink-text\)/),
  decls('html.theme-dark .login-card') || 'tidak ada'
);
check(
  'DARK-2',
  'Dark mode: input login = gaya input global dark (#0b1424, border .22, var(--text), placeholder #475569)',
  has('html.theme-dark .login-card input', /background-color:\s*#0b1424/) &&
    has('html.theme-dark .login-card input', /border:\s*1px solid rgba\(148,\s*163,\s*184,\s*0\.22\)/) &&
    has('html.theme-dark .login-card input', /color:\s*var\(--text\)/) &&
    has('html.theme-dark .login-card input::placeholder', /color:\s*#475569/),
  'input= ' + decls('html.theme-dark .login-card input') + ' | placeholder= ' + decls('html.theme-dark .login-card input::placeholder')
);
check(
  'DARK-3',
  'Dark mode: tombol sekunder = gaya tombol sekunder global dark (rgba .12, border .25, var(--text), hover .22)',
  has('html.theme-dark .login-card .btn-secondary', /background:\s*rgba\(148,\s*163,\s*184,\s*0\.12\)/) &&
    has('html.theme-dark .login-card .btn-secondary', /border:\s*1px solid rgba\(148,\s*163,\s*184,\s*0\.25\)/) &&
    has('html.theme-dark .login-card .btn-secondary', /color:\s*var\(--text\)/) &&
    has('html.theme-dark .login-card .btn-secondary:hover', /background:\s*rgba\(148,\s*163,\s*184,\s*0\.22\)/),
  'normal= ' + decls('html.theme-dark .login-card .btn-secondary') + ' | hover= ' + decls('html.theme-dark .login-card .btn-secondary:hover')
);

// --- LIGHT-7 / DARK-4: ikon lihat-sandi ---------------------------------------
check(
  'LIGHT-7',
  'Ikon lihat-sandi punya kontras cukup di light mode (--slate-600)',
  has('.login-card .btn-toggle-pass', /color:\s*var\(--slate-600\)/),
  decls('.login-card .btn-toggle-pass') || 'tidak ada override untuk .btn-toggle-pass di kartu login'
);
check(
  'DARK-4',
  'Dark mode: ikon lihat-sandi tetap #64748b (tidak ikut berubah)',
  has('html.theme-dark .login-card .btn-toggle-pass', /color:\s*#64748b/),
  decls('html.theme-dark .login-card .btn-toggle-pass') || 'tidak ada override dark untuk .btn-toggle-pass'
);

// --- laporan ------------------------------------------------------------------
let failed = 0;
console.log('\nTarget : ' + target);
console.log('CSS    : ' + css.length + ' karakter (top-level ' + rules.length + ')\n');
for (const r of results) {
  if (!r.pass) failed++;
  console.log((r.pass ? 'LULOS  ' : 'GAGAL  ') + ' [' + r.id + '] ' + r.title);
  console.log('         ' + r.detail + '\n');
}
console.log(
  failed === 0 ? '=== SEMUA LOLOS ===' : '=== ' + failed + ' DARI ' + results.length + ' TEST GAGAL ==='
);
process.exit(failed === 0 ? 0 : 1);
