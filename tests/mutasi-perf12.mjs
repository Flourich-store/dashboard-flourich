// Uji mutasi: pastikan assertion PERF-12/12b/12c benar-benar menangkap
// pelanggaran (bukan sekadar selalu lulus). Setiap mutasi diterapkan pada
// salinan HTML di folder temp; file asli tidak disentuh.
import fs from 'node:fs';
import cp from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const diSini = path.dirname(fileURLToPath(import.meta.url));
const asli = process.argv[2] || path.join(diSini, '..', 'DashboardStandalone.html');
const test = process.argv[3] || path.join(diSini, 'perf-p1.test.mjs');
// Normalkan akhir baris ke LF. Pola mutasi di bawah ditulis dengan '\n', tapi
// core.autocrlf=true membuat `git checkout` menulis CRLF, sehingga tanpa ini
// semua pola "tidak ditemukan" dan mutasi tidak pernah benar-benar diuji.
const src = fs.readFileSync(asli, 'utf8').replace(/\r\n/g, '\n');

const mutasi = [
  {
    nama: 'loadProduk: hapus panggilan fallback (kotak nilai stok tak terisi)',
    dari: '        if (!terapkanNilaiStok(res)) loadNilaiStok();\n      }, function () {\n        var t = document.getElementById(\'produkTbody\');',
    ke: '      }, function () {\n        var t = document.getElementById(\'produkTbody\');'
  },
  {
    nama: 'loadProduk: ganti apply dari respons menjadi panggilan terpisah',
    dari: '        if (!terapkanNilaiStok(res)) loadNilaiStok();\n',
    ke: '        loadNilaiStok();\n'
  },
  {
    nama: 'loadProdukCRUD: kembalikan loadNilaiStok() terpisah',
    dari: '          if (!terapkanNilaiStok(res)) loadNilaiStok();\n',
    ke: '          loadNilaiStok();\n'
  },
  {
    nama: 'aksiInputPenjualan: kembalikan loadNilaiStok() terpisah',
    dari: '          loadProduk();\n        } else {\n          showToast(res.message',
    ke: '          loadProduk();\n          loadNilaiStok();\n        } else {\n          showToast(res.message'
  },
  {
    nama: 'terapkanNilaiStok: hilangkan cek field -> respons server lama paints Rp 0 palsu',
    dari: "      if (typeof res.nilaiStok !== 'number' || !isFinite(res.nilaiStok)) return false;\n",
    ke: ''
  }
];

let gagal = 0;
for (const m of mutasi) {
  if (src.indexOf(m.dari) === -1) {
    console.log('  LEWAT  ' + m.nama + ' -> pola tidak ditemukan, mutasi tidak diuji');
    gagal++;
    continue;
  }
  const tmp = path.join(os.tmpdir(), 'mutasi-' + Math.random().toString(36).slice(2) + '.html');
  fs.writeFileSync(tmp, src.replace(m.dari, m.ke));
  let rc = 0;
  let out = '';
  try {
    out = cp.execFileSync('node', [test, tmp], { encoding: 'utf8' });
  } catch (e) {
    rc = e.status;
    out = (e.stdout || '') + (e.stderr || '');
  }
  const baris = out.split('\n').filter((l) => /PERF-12/.test(l) && /GAGAL/.test(l));
  if (rc !== 0 && baris.length > 0) {
    console.log('  TANGKAP  ' + m.nama + ' -> ' + baris.length + ' assertion pecah');
  } else {
    console.log('  LOLOS  ' + m.nama + ' -> TIDAK tertangkap (test lemah!)');
    gagal++;
  }
  fs.unlinkSync(tmp);
}
console.log(gagal === 0 ? '\nSemua mutasi tertangkap.' : '\n' + gagal + ' mutasi tidak tertangkap.');
process.exit(gagal === 0 ? 0 : 1);
