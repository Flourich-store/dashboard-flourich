// Kontrol karakter untuk pesan commit: tidak boleh ada karakter non-ASCII
// atau pipe liar (bug yang pernah terjadi: 4 karakter '|' palsu di pesan).
import fs from 'node:fs';

const f = process.argv[2];
if (!f) {
  console.error('Cara pakai: node tests/cek-pesan.mjs <file-berkas-pesan>');
  process.exit(2);
}
const txt = fs.readFileSync(f, 'utf8');
const nonAscii = [...txt].filter((c) => c.charCodeAt(0) > 127);
const pipe = txt.match(/(?<!\|)\|(?!\|)/g) || [];

console.log('file            :', f);
console.log('karakter non-ASCII:', nonAscii.length ? nonAscii.map((c) => `${c} (U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')})`).join(' ') : 'tidak ada');
console.log('pipe liar       :', pipe.length);
console.log('baris pertama   :', txt.split('\n')[0]);
if (nonAscii.length || pipe.length) {
  console.log('GAGAL: pesan commit tidak bersih');
  process.exit(1);
}
console.log('BERSIH');
