// Deteksi identifier yang DIPAKAI tapi tidak pernah dideklarasikan -> biasanya
// "ReferenceError" yang hanya muncul saat fungsi dijalankan.
//
// Kelas bug ini nyata: pada 27 Sep satu baris `var hpp = _resolveHpp(...)` ikut
// tertelan baris komentar di atasnya, sehingga hpp tidak pernah ada ->
// ReferenceError -> tombol Simpan penjualan mati. Skrip sapaan-komentar.mjs
// menangkap kasus itu langsung; skrip ini jaring pengaman kedua untuk kasus
// yang tidak terlihat jelas sebagai kode di dalam komentar.
//
// Cara kerja: buang komentar dan string dengan state machine (bukan regex,
// karena regex salah memotong identifier di dekat tanda kutip), lalu bandingkan
// nama yang dipakai dengan nama yang dideklarasikan + keyword + bawaan GAS.
import fs from 'node:fs';
import path from 'node:path';
import { akarRepo } from './lib/jalur.mjs';

const file = process.argv[2] || path.join(akarRepo, 'Code.gs');
if (/[.]html?$/i.test(file)) {
  console.error('Cek ini hanya untuk berkas .gs atau .js. "' + path.basename(file) + '" bukan JavaScript murni.');
  console.error('Untuk DashboardStandalone.html pakai: node tests/cek-statis.mjs');
  process.exit(2);
}
const src = fs.readFileSync(file, 'utf8');
console.log('Target: ' + file);

/**
 * Ganti komentar, isi string, dan regex literal dengan spasi, sehingga nomor
 * baris tetap sama (baris baru dipertahankan) dan pesan error bisa menunjuk
 * baris asli.
 *
 * Regex literal butuh tebakan: tanda '/' memulai regex hanya kalau karakter
 * sebelumnya adalah operator atau pembuka, bukan hasil atau nama variabel.
 */
function buangKomentarDanString(kode) {
  const keluar = [];
  let i = 0;
  let sebelumnya = '';
  const n = kode.length;
  const dibukaRegex = '([{,;=:?&|!+-*%~^<>';
  while (i < n) {
    const c = kode[i];
    const d = kode[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && kode[i] !== '\n') { keluar.push(' '); i++; }
    } else if (c === '/' && d === '*') {
      keluar.push(' ', ' ');
      i += 2;
      while (i < n && !(kode[i] === '*' && kode[i + 1] === '/')) {
        keluar.push(kode[i] === '\n' ? '\n' : ' ');
        i++;
      }
      keluar.push(' ', ' ');
      i += 2;
    } else if (c === "'" || c === '"' || c === '`') {
      const kutip = c;
      keluar.push(' ');
      i++;
      while (i < n && kode[i] !== kutip) {
        if (kode[i] === '\\') { keluar.push(' ', ' '); i += 2; }
        else { keluar.push(kode[i] === '\n' ? '\n' : ' '); i++; }
      }
      keluar.push(' ');
      i++;
    } else if (c === '/' && (sebelumnya === '' || dibukaRegex.indexOf(sebelumnya) !== -1)) {
      // regex literal: buang sampai penutup, perhatikan kelas karakter agar
      // ']' di dalam [...] tidak menutup lebih awal.
      keluar.push(' ');
      i++;
      let dalamKelas = false;
      while (i < n) {
        const ch = kode[i];
        if (ch === '\\') { keluar.push(' ', ' '); i += 2; continue; }
        if (ch === '\n') break; // bukan regex: biarkan '/' jadi operator
        if (ch === '[') dalamKelas = true;
        else if (ch === ']') dalamKelas = false;
        else if (ch === '/' && !dalamKelas) break;
        keluar.push(' ');
        i++;
      }
      keluar.push(' ');
      i++;
      // huruf penanda regex (g, i, m, s, u, y) juga bukan identifier
      while (i < n && /[a-z]/.test(kode[i])) { keluar.push(' '); i++; }
    } else {
      keluar.push(c);
      if (!/\s/.test(c)) sebelumnya = c;
      i++;
    }
  }
  return keluar.join('');
}

const kode = buangKomentarDanString(src);

const KUNCI = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
  'let', 'new', 'of', 'return', 'static', 'super', 'switch', 'this', 'throw', 'try', 'typeof',
  'var', 'void', 'while', 'with', 'yield', 'await', 'async',
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'arguments'
]);

const BAWAAN = new Set([
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Math', 'JSON', 'RegExp', 'Error',
  'TypeError', 'RangeError', 'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'console',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'queueMicrotask',
  'Promise', 'Symbol', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'Function',
  'BigInt', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  // GAS / Google Apps Script
  'SpreadsheetApp', 'Utilities', 'Logger', 'HtmlService', 'DriveApp', 'UrlFetchApp', 'MailApp',
  'GmailApp', 'ScriptApp', 'TimeZone', 'PropertiesService', 'CacheService', 'LockService',
  'Session', 'UserProperties', 'DataSourceBuilder', 'Apps'
]);

// --- nama yang dideklarasikan di seluruh file ---
const dideklarasi = new Set();
let m;
for (const re of [/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g, /\bclass\s+([A-Za-z_$][\w$]*)/g]) {
  while ((m = re.exec(kode))) dideklarasi.add(m[1]);
}

// Pernyataan var/let/const bisa punya banyak deklarator dipisah koma
// (var total = 0, unit = 0, rincian = [];). Hanya nama di sisi kiri '=' yang
// merupakan deklarasi; nama di dalam panggilan fungsi bukan.
const stmtRe = /\b(?:var|let|const)\s+/g;
while ((m = stmtRe.exec(kode))) {
  let j = m.index + m[0].length;
  let depth = 0;
  while (j < kode.length) {
    const ch = kode[j];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (depth === 0 && ch === ';') break;
    else if (depth === 0 && ch === '\n' && !/^\s*,/.test(kode.slice(j + 1))) break;
    j++;
  }
  const badan = kode.slice(m.index + m[0].length, j);
  const bagian = [];
  let d = 0;
  let cur = '';
  for (const ch of badan) {
    if ('([{'.includes(ch)) d++;
    else if (')]}'.includes(ch)) d--;
    if (ch === ',' && d === 0) { bagian.push(cur); cur = ''; } else cur += ch;
  }
  bagian.push(cur);
  for (const b of bagian) {
    const kiri = b.split('=')[0];
    for (const id of kiri.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)) dideklarasi.add(id[1]);
  }
}

// parameter fungsi dan catch
for (const re of [/\bfunction\b[^{;]*\(([^)]*)\)/g, /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g]) {
  while ((m = re.exec(kode))) m[1].split(',').forEach((p) => {
    const bersih = p.trim().replace(/=[\s\S]*$/, '').replace(/^\.\.\./, '').trim();
    if (/^[A-Za-z_$][\w$]*$/.test(bersih)) dideklarasi.add(bersih);
  });
}

// --- nama yang dipakai ---
// Nama yang diikuti tanda ':' adalah kunci objek ({ status: 'success' }) atau
// nama di sisi benar ternary, bukan variabel yang perlu dideklarasikan.
// Tanda ':' ditangkap sebagai grup opsional (bukan lookahead): lookahead
// negatif membuat regex mundur dan memotong huruf terakhir nama.
const hits = new Map();
const baris = kode.split('\n');
baris.forEach((ln, i) => {
  const idRe = /(?<![.\w$])([A-Za-z_$][\w$]*)(\s*:)?/g;
  let t;
  while ((t = idRe.exec(ln))) {
    if (t[2]) continue; // kunci objek atau sisi kanan ternary
    const nama = t[1];
    if (KUNCI.has(nama) || BAWAAN.has(nama) || dideklarasi.has(nama)) continue;
    if (!hits.has(nama)) hits.set(nama, []);
    hits.get(nama).push(i + 1);
  }
});

if (hits.size === 0) {
  console.log('BERSIH: tidak ada identifier tanpa deklarasi.');
  process.exit(0);
}
for (const [nama, di] of hits) {
  const contoh = di.slice(0, 5).join(', ');
  console.log('TIDAK TERDEKLARASI  ' + nama + '  -> baris ' + contoh + (di.length > 5 ? ' ...' : ''));
}
console.log('');
console.log('GAGAL: ' + hits.size + ' identifier dipakai tanpa deklarasi.');
process.exit(1);
