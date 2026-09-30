import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DI = path.dirname(fileURLToPath(import.meta.url));
const AKAR = path.resolve(DI, '..');
const p = path.join(AKAR, 'tests/fixtures/snapshot-CreditDebit.csv');

const t = (() => {
  try { return fs.readFileSync(p, 'utf8'); }
  catch (e) { return fs.readFileSync(fs.realpathSync(p), 'utf8'); }
})();

const rows = []; let row = []; let f = ''; let q = false;
for (let i = 0; i < t.length; i++) {
  const c = t[i];
  if (q) {
    if (c === '"') { if (t[i + 1] === '"') { f += c; i++; } else q = false; }
    else f += c;
  } else if (c === '"') q = true;
  else if (c === ',') { row.push(f); f = ''; }
  else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
  else if (c !== '\r') f += c;
}
if (f !== '' || row.length) { row.push(f); rows.push(row); }

console.log('baris mentah dari parser : ' + rows.length);
const nonKosong = rows.map((r, i) => ({ i, r })).filter((x) => x.r.some((c) => String(c).trim() !== ''));
console.log('baris tidak kosong       : ' + nonKosong.length);
const kosong = rows.map((r, i) => ({ i, r })).filter((x) => !x.r.some((c) => String(c).trim() !== ''));
console.log('baris kosong (dibuang)    : ' + kosong.length + (kosong.length ? ' -> indeks ' + kosong.map((x) => x.i).join(',') : ''));
console.log('');
console.log('indeks  | kolom A mentah        | kolom F | kolom G');
for (let k = 0; k < Math.min(18, nonKosong.length); k++) {
  const r = nonKosong[k].r;
  console.log('  ' + String(k).padStart(2) + '     | ' + JSON.stringify(r[0]).padEnd(24)
    + ' | ' + JSON.stringify(r[5]).padEnd(9) + ' | ' + JSON.stringify(r[6]));
}
console.log('');
console.log('versi date dari kolom A:');
for (let k = 0; k < Math.min(10, nonKosong.length); k++) {
  const s = String(nonKosong[k].r[0]);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?$/);
  if (!m) { console.log('  ' + k + ' tidak cocok pola: ' + JSON.stringify(s)); continue; }
  const d = new Date(+m[3], +m[1] - 1, +m[2], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const lokal = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  console.log('  ' + String(k).padStart(2) + '  teks=' + JSON.stringify(s).padEnd(22) + ' toISOString=' + d.toISOString().slice(0, 10) + '  lokal=' + lokal);
}