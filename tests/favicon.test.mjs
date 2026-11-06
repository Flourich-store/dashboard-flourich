#!/usr/bin/env node
/**
 * Regression test: favicon Flourich terpasang di semua halaman.
 *
 * Temuan 6 Nov 2026: tab browser menampilkan ikon globe generik. Penyebabnya
 * <link rel="icon"> menunjuk URL Google Drive yang TERPOTONG
 * (…/d/1kbCU9E4sSQTdBylR24DFnRvsX1cAT) sehingga Drive membalas HTTP 400.
 *
 * Aturan yang dikunci:
 *   1. DashboardStandalone.html, index.html, landingpage.html punya
 *      <link rel="icon"> berupa data URI PNG (tidak bergantung Drive/CORS).
 *   2. Ikon yang di-embed benar-benar PNG 192x192 (header IHDR valid).
 *   3. Tidak ada lagi favicon yang menunjuk URL http(s) yang bisa rusak.
 *   4. Dashboard juga punya apple-touch-icon (ikon layar utama iOS).
 *
 * Pakai:  node tests/favicon.test.mjs
 * Exit 0 = semua lolos, exit 1 = ada yang gagal.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const halaman = [
  { file: 'DashboardStandalone.html', wajibApple: true },
  { file: 'index.html', wajibApple: false },
  { file: 'landingpage.html', wajibApple: false }
];

const results = [];
const check = (id, title, pass, detail) => results.push({ id, title, pass, detail });

function bacaHtml(nama) {
  const p = path.join(REPO, nama);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8');
}

// --- 1. setiap halaman punya <link rel="icon"> data URI PNG ----------------
const isi = {};
for (const h of halaman) {
  isi[h.file] = bacaHtml(h.file);
  const html = isi[h.file];
  check(
    'ICON-ADA ' + h.file,
    h.file + ' punya <link rel="icon"> data URI PNG',
    Boolean(html && /<link[^>]+rel=["']icon["'][^>]*href=["']data:image\/png;base64,[A-Za-z0-9+/=]+["']/i.test(html)),
    !html
      ? 'berkas tidak ditemukan'
      : /<link[^>]+rel=["']icon["'][^>]*href=["']data:image\/png;base64,/i.test(html)
        ? 'ditemukan'
        : 'TIDAK ADA favicon data URI -> tab memakai ikon generik / URL luar'
  );
}

// --- 2. PNG valid 192x192 ---------------------------------------------------
for (const h of halaman) {
  const html = isi[h.file];
  let lulus = false;
  let detail = 'tidak ada data URI';
  const m = html && html.match(/rel=["']icon["'][^>]*href=["']data:image\/png;base64,([A-Za-z0-9+/=]+)["']/i);
  if (m) {
    const buf = Buffer.from(m[1], 'base64');
    const sig = buf.subarray(0, 8).toString('hex');
    const sigPng = '89504e470d0a1a0a';
    const w = buf.length >= 24 ? buf.readUInt32BE(16) : -1;
    const ht = buf.length >= 24 ? buf.readUInt32BE(20) : -1;
    lulus = sig === sigPng && w === 192 && ht === 192;
    detail = 'signature ' + (sig === sigPng ? 'PNG valid' : sig) + ', ' + w + 'x' + ht + ', ' + buf.length + ' byte';
  }
  check('ICON-PNG ' + h.file, h.file + ': ikon adalah PNG 192x192', lulus, detail);
}

// --- 3. tidak ada favicon yang menunjuk URL luar ---------------------------
for (const h of halaman) {
  const html = isi[h.file] || '';
  const luar = /<link[^>]+rel=["'](icon|apple-touch-icon)["'][^>]*href=["']https?:/i.test(html);
  check(
    'ICON-LOKAL ' + h.file,
    h.file + ': favicon tidak menunjuk URL http(s)',
    !luar,
    luar ? 'masih ada favicon ke URL luar -> rawan 400/CORS seperti kasus Drive' : 'bersih (data URI)'
  );
}

// --- 4. apple-touch-icon di dashboard --------------------------------------
const dash = isi['DashboardStandalone.html'] || '';
check(
  'ICON-APPLE',
  'DashboardStandalone.html punya apple-touch-icon',
  /<link[^>]+rel=["']apple-touch-icon["']/i.test(dash),
  /<link[^>]+rel=["']apple-touch-icon["']/i.test(dash) ? 'ditemukan' : 'TIDAK ADA apple-touch-icon'
);

// --- laporan ---------------------------------------------------------------
let failed = 0;
console.log('\nRepo : ' + REPO + '\n');
for (const r of results) {
  if (!r.pass) failed++;
  console.log((r.pass ? 'LULUS  ' : 'GAGAL  ') + '[' + r.id + '] ' + r.title);
  console.log('         ' + r.detail + '\n');
}
console.log(failed === 0 ? '=== SEMUA LOLOS ===' : '=== ' + failed + ' DARI ' + results.length + ' TEST GAGAL ===');
process.exit(failed === 0 ? 0 : 1);
