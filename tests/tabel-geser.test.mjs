#!/usr/bin/env node
/**
 * Regression test: tabel dashboard bisa digeser & tidak memotong isi.
 *
 * Keluhan pemilik (6 Nov 2026): tabel yang terbuka harus menyesuaikan isi
 * seperti tabel spreadsheet, dan bisa digeser kanan-kiri kalau kolomnya
 * banyak. Sebelumnya `table-layout: fixed; width: 100%` membagi kolom rata
 * lalu memangkas teks dengan `...` (desktop), dan di layar kecil sebagian
 * kolom justru disembunyikan (`hide-mobile`) sehingga data tidak terlihat.
 *
 * Aturan yang dikunci:
 *   1. Tabel memakai lebar mengikuti ISI (auto + max-content), bukan rata.
 *   2. Tidak ada ellipsis/pemotongan pada sel tabel.
 *   3. Wadah .table-responsive menggeser horizontal (overflow-x auto).
 *   4. Tidak ada kolom tabel yang disembunyikan lewat hide-mobile/display:none.
 *   5. Tidak ada media query yang memaksa lebar minimum tabel (480/520px).
 *   6. Angka & tanggal tidak melipat (nowrap); kolom teks panjang dibatasi
 *      lebarnya supaya tidak melebar ekstrem.
 *
 * Pakai:  node tests/tabel-geser.test.mjs [path/DashboardStandalone.html]
 * Exit 0 = semua lolos, exit 1 = ada yang gagal.
 */

import { readFileSync } from 'node:fs';
import { targetHtml } from './lib/jalur.mjs';

const target = targetHtml();
const html = readFileSync(target, 'utf8');

const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
  .map((m) => m[1])
  .join('\n');

// --- pembaca blok @media (brace matching, bisa bersarang) -------------------
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

// --- ambil isi satu aturan CSS berdasarkan selektor persis ------------------
// Toleran terhadap spasi/baris baru: "th, td" harus cocok dengan "th,\n    td".
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function aturanCss(selektor) {
  const bagian = selektor.split(',').map((s) =>
    s.trim().split(/\s+/).map(escapeRe).join('\\s+')
  );
  const re = new RegExp('(?:^|\\})\\s*' + bagian.join('\\s*,\\s*') + '\\s*\\{([^}]*)\\}', 'm');
  const m = css.match(re);
  return m ? m[1] : null;
}

const results = [];
const check = (id, title, pass, detail) => results.push({ id, title, pass, detail });

// --- 1. tabel mengikuti isi -------------------------------------------------
const tabel = aturanCss('table');
const layoutAuto = Boolean(tabel && /table-layout:\s*auto/i.test(tabel));
const lebarIsi = Boolean(tabel && /width:\s*max-content/i.test(tabel));
const lebarMinimum = Boolean(tabel && /min-width:\s*100%/i.test(tabel));

check(
  'TABEL-1a',
  'table-layout: auto (lebar kolom mengikuti isi, bukan dibagi rata)',
  layoutAuto,
  layoutAuto ? 'ditemukan table-layout: auto' : 'TIDAK ADA table-layout: auto -> layout fixed membagi kolom rata'
);
check(
  'TABEL-1b',
  'table { width: max-content } (tabel melebar sesuai isi)',
  lebarIsi,
  lebarIsi ? 'ditemukan width: max-content' : 'TIDAK ADA width: max-content -> tabel dipaksa muat wadah'
);
check(
  'TABEL-1c',
  'table { min-width: 100% } (tetap mengisi kartu saat isi pendek)',
  lebarMinimum,
  lebarMinimum ? 'ditemukan min-width: 100%' : 'TIDAK ADA min-width: 100% -> tabel bisa lebih sempit dari kartu'
);

// --- 2. tidak ada pemotongan teks pada sel ----------------------------------
const sel = aturanCss('th, td');
const adaEllipsis = Boolean(sel && /text-overflow:\s*ellipsis/i.test(sel));
const adaOverflowHidden = Boolean(sel && /overflow:\s*hidden/i.test(sel));

check(
  'TABEL-2a',
  'Sel tabel tidak memakai text-overflow: ellipsis',
  !adaEllipsis,
  adaEllipsis ? 'masih ada text-overflow: ellipsis pada th, td -> isi dipotong "..."' : 'bersih'
);
check(
  'TABEL-2b',
  'Sel tabel tidak memakai overflow: hidden',
  !adaOverflowHidden,
  adaOverflowHidden ? 'masih ada overflow: hidden pada th, td -> isi terpotong tanpa bisa digeser' : 'bersih'
);

// --- 3. wadah bisa digeser ---------------------------------------------------
const wadah = aturanCss('.table-responsive');
const geser = Boolean(wadah && /overflow-x:\s*(auto|scroll)/i.test(wadah));
const os = Boolean(wadah && /overscroll-behavior(-x)?:\s*contain/i.test(wadah));

check(
  'TABEL-3a',
  '.table-responsive punya overflow-x auto/scroll',
  geser,
  geser ? 'ditemukan overflow-x' : 'TIDAK ADA overflow-x -> kolom di luar layar tidak bisa dijangkau'
);
check(
  'TABEL-3b',
  '.table-responsive memakai overscroll-behavior-x: contain (geser tidak merembet ke halaman)',
  os,
  os ? 'ditemukan overscroll-behavior' : 'TIDAK ADA overscroll-behavior-x -> geser tabel ikut menggeser halaman'
);

// --- 4. tidak ada kolom tabel yang disembunyikan ----------------------------
const selTersembunyi =
  /<t[hd][^>]*class="[^"]*hide-mobile/i.test(html) ||
  /'<td class="hide-mobile">/i.test(html);

check(
  'TABEL-4a',
  'Tidak ada <th>/<td> tabel yang memakai hide-mobile',
  !selTersembunyi,
  selTersembunyi
    ? 'masih ada kolom tabel ber-class hide-mobile -> data hilang di layar kecil'
    : 'bersih: semua kolom tabel selalu tampil'
);

const kolomDisplayNone = /\.tabel-[a-z-]+\s+t[hd]:nth-child\([^)]*\)[^{]*\{[^}]*display:\s*none/i.test(css);
check(
  'TABEL-4b',
  'Tidak ada CSS yang menyembunyikan kolom tabel (display: none)',
  !kolomDisplayNone,
  kolomDisplayNone ? 'ada aturan .tabel-* th/td { display: none } -> kolom hilang' : 'bersih'
);

// --- 5. tidak ada lebar minimum paksa di media query ------------------------
const paksa = medias.filter((b) => /(^|[^-\w])table\s*\{[^}]*min-width:\s*(480|520)px/i.test(b.body));
check(
  'TABEL-5',
  'Tidak ada @media yang memaksa table { min-width: 480/520px }',
  paksa.length === 0,
  paksa.length ? 'masih dipaksa pada @media ' + paksa.map((b) => b.cond).join(', ') : 'bersih'
);

// --- 6. angka nowrap, teks panjang dibatasi --------------------------------
const nowrap = Boolean(sel && /white-space:\s*nowrap/i.test(sel));
check(
  'TABEL-6a',
  'Sel tabel default nowrap (angka & tanggal tidak melipat)',
  nowrap,
  nowrap ? 'ditemukan white-space: nowrap' : 'TIDAK ADA white-space: nowrap -> angka bisa melipat tak terbaca'
);

const teksDibatasi =
  /\.tabel-[a-z-]+[^{]*\{[^}]*overflow-wrap:\s*(anywhere|break-word)/i.test(css) &&
  /\.tabel-[a-z-]+[^{]*\{[^}]*max-width:\s*\d+px/i.test(css);
check(
  'TABEL-6b',
  'Kolom teks panjang (Produk/Kategori/Deskripsi) dibatasi lebarnya',
  teksDibatasi,
  teksDibatasi
    ? 'ditemukan overflow-wrap + max-width pada kolom teks'
    : 'TIDAK ADA batas lebar kolom teks -> tabel bisa melebar ekstrem'
);

// --- laporan ----------------------------------------------------------------
let failed = 0;
console.log('\nTarget : ' + target);
console.log('CSS    : ' + css.length + ' karakter, ' + medias.length + ' blok @media\n');
for (const r of results) {
  if (!r.pass) failed++;
  console.log((r.pass ? 'LULUS  ' : 'GAGAL  ') + '[' + r.id + '] ' + r.title);
  console.log('         ' + r.detail + '\n');
}
console.log(failed === 0 ? '=== SEMUA LOLOS ===' : '=== ' + failed + ' DARI ' + results.length + ' TEST GAGAL ===');
process.exit(failed === 0 ? 0 : 1);
