#!/usr/bin/env node
/**
 * FOLD YANG BOLEH DI-COMMIT vs YANG HARUS DIJAGA DI LOKAL
 * ---------------------------------------------------
 * Menjawab pertanyaan: "skrip tes (.mjs) mana yang aman di-commit ke repo
 * publik, dan mana yang membawa data bisnis asli?"
 *
 *   node tests/pilah-commit.mjs            -> ringkasan per kelompok
 *   node tests/pilah-commit.mjs --detail   ->Reasonsional per berkas
 *
 * Klasifikasi (lihat tests/audit-data-tertanam.mjs untuk deteksi):
 *   AMAN     tidak ada nominal / nama produk / tanggal produksi di skrip
 *   SEKARANG skrip sudah ter-push sebelumnya, jadi tidak menambah risiko
 *             baru; keputusan ada di tangan pemilik usaha
 *   RAHASIA  data transaksi asli, tidak boleh masuk repo publik
 *
 * Tidak menulis apa pun. Hanya membaca.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const AKAR = path.resolve(DIR, '..');
const detail = process.argv.includes('--detail');

const rp = (n) => 'Rp' + Number(n).toLocaleString('id-ID');

function sh(cmd) {
  try { return execSync(cmd + ' 2>&1', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (e) { return ''; }
}

// ---------- 1. berkas yang sudah ter-push ----------
const pushed = new Set(
  sh('git ls-tree -r origin/main --name-only')
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean));

// ---------- 2. audit data tertanam per berkas ----------
// Dijalankan sebagai subprocess supaya tidak menduplikasi logika.
const hasilAudit = JSON.parse(sh(`node "${path.join(DIR, 'audit-data-tertanam.mjs')}" --json`));

// ---------- 3. kelompokkan ----------
const AMAN = [];
const SEKARANG = [];
const RAHASIA = [];

for (const f of hasilAudit) {
  const rel = f.rel;
  if (pushed.has(rel)) { SEKARANG.push(f); continue; }
  if (f.temuan.length === 0) { AMAN.push(f); continue; }
  RAHASIA.push(f);
}

function rincian(f) {
  const perJenis = new Map();
  for (const t of f.temuan) {
    if (!perJenis.has(t.jenis)) perJenis.set(t.jenis, new Set());
    perJenis.get(t.jenis).add(t.nilai);
  }
  const baris = [];
  for (const [jenis, set] of perJenis) {
    baris.push(jenis + ': ' + [...set].slice(0, 8).map((v) => JSON.stringify(v)).join(' ')
      + (set.size > 8 ? ' (+' + (set.size - 8) + ')' : ''));
  }
  return baris;
}

console.log('=== PEMISAHAN BERKAS UNTUK COMMIT ===');
console.log('Repo  : https://github.com/Flourich-store/dashboard-flourich  (PUBLIK, Pages aktif)');
console.log('');

const cetak = (judul, arr, warna) => {
  console.log(judul + '  (' + arr.length + ')');
  for (const f of arr.sort((a, b) => a.rel.localeCompare(b.rel))) {
    console.log('  ' + f.rel + (f.temuan.length ? '   ' + f.temuan.length + ' temuan' : ''));
    if (detail && f.temuan.length) {
      for (const b of rincian(f)) console.log('       ' + b);
    }
  }
  console.log('');
};

cetak('--- AMAN: tidak ada data bisnis, boleh di-commit ---', AMAN);
cetak('--- SUDAH TER-PUSH: tidak menambah risiko baru ---', SEKARANG);
cetak('--- RAHASIA: data transaksi asli, JANGAN di-commit ---', RAHASIA);

console.log('Catatan:');
console.log('  tests/fixtures/ sudah masuk .gitignore, jadi file CSV tidak ikut ter-push.');
console.log('  Skrip di kelompok RAHASIA menunjuk ke fixture itu. Kalau skripnya di-commit');
console.log('  tanpa fixture, ia akan gagal di komputer lain - itu bisa diterima, tapi');
console.log('  angka yang tertanam di skrip tetap bocor. Pilihannya: sanitize');
console.log('  (ganti nominal dengan angka bulat karangan) atau biarkan lokal saja.');
console.log('');
console.log('Tidak ada yang ditulis ke mana pun.');
