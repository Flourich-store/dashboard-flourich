// Cek statis integritas DashboardStandalone.html:
// 1) sintaks tiap blok <script> (node --check via new Function)
// 2) konsistensi nama fungsi: setiap NAMA( yang dipanggil harus punya deklarasi
//    (kecuali daftar API bawaan browser/GAS)
//
// PENTING: kalau file yang diberikan tidak punya blok <script> sama sekali,
// skrip ini GAGAL, bukan lulus diam-diam. Dulu ia tetap mencetak "sintaks valid"
// sehingga salah argumen (mis. Code.gs, bukan HTML) lolos tanpa memeriksa apa pun.
import fs from 'node:fs';
import vm from 'node:vm';
import { targetHtml } from './lib/jalur.mjs';

const file = targetHtml();
const html = fs.readFileSync(file, 'utf8');
console.log('Target: ' + file);

// --- 1. sintaks ---
const blok = [];
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m;
while ((m = re.exec(html)) !== null) {
  const attrs = m[1] || '';
  if (/\bsrc\s*=/.test(attrs)) continue;
  blok.push({ attrs: attrs.trim(), code: m[2], mulai: m.index });
}
let syntaxGagal = 0;
blok.forEach((b, i) => {
  try {
    new vm.Script(b.code, { filename: 'blok' + i });
    console.log(`SINTAKS OK   blok#${i}  ${b.code.length} char  attrs="${b.attrs}"`);
  } catch (e) {
    syntaxGagal++;
    console.log(`SINTAKS GAGAL blok#${i} attrs="${b.attrs}": ${e.message}`);
    const baris = (e.stack || '').split('\n').slice(0, 3).join(' | ');
    console.log('   ' + baris);
  }
});

// --- 2. konsistensi nama fungsi ---
const semuaKode = blok.map((b) => b.code).join('\n');
const deklarasi = new Set();
for (const d of semuaKode.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) deklarasi.add(d[1]);
for (const d of semuaKode.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*function/g)) deklarasi.add(d[1]);

const bawaan = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'new', 'do', 'else',
  'Array', 'Object', 'Number', 'String', 'Boolean', 'Date', 'Math', 'JSON', 'RegExp', 'Error',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'console', 'alert', 'confirm', 'prompt', 'Promise', 'Map', 'Set', 'Infinity', 'NaN',
  'Intl', 'URLSearchParams', 'Blob', 'FileReader', 'FormData', 'fetch', 'ResizeObserver',
  'IntersectionObserver', 'MutationObserver', 'getComputedStyle', 'matchMedia', 'btoa', 'atob',
  'requestIdleCallback', 'cancelIdleCallback', 'structuredClone', 'queueMicrotask',
]);

const dipanggil = new Set();
for (const d of semuaKode.matchAll(/(?<![\w.$])([A-Za-z_$][\w$]*)\s*\(/g)) dipanggil.add(d[1]);

const hilang = [...dipanggil]
  .filter((n) => !deklarasi.has(n) && !bawaan.has(n) && !/^[A-Z]/.test(n))
  .sort();

console.log('');
if (!blok.length) {
  console.log('GAGAL: tidak ada blok <script> inline di ' + file);
  console.log('      hampir pasti file yang salah diberikan ke skrip ini.');
  process.exit(1);
}
console.log('blok <script> diperiksa: ' + blok.length);
console.log(`deklarasi fungsi: ${deklarasi.size}`);
if (hilang.length) {
  console.log('DIPANGGIL TAPI TIDAK ADA DEKLARASI (daftar laporan, tidak menentukan gagal):');
  for (const n of hilang) console.log('  - ' + n);
} else {
  console.log('semua nama yang dipanggil punya deklarasi (atau API bawaan)');
}
console.log('');
console.log(syntaxGagal === 0 ? 'HASIL: sintaks semua blok script valid' : `HASIL: ${syntaxGagal} blok script GAGAL sintaks`);
process.exit(syntaxGagal === 0 ? 0 : 1);
