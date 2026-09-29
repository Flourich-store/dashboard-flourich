// Tes regresi bug Code.gs:960 (tombol Simpan dashboard tidak pernah berhasil).
// Fokus: addPenjualan() harus menyelesaikan baris lengkap (HPP -> Modal -> Laba)
// dan MENYIMPAN baris ke sheet Penjualan, tidak melempar ReferenceError.
//
// Cara pakai: node add-penjualan.test.mjs <path Code.gs>
//
// Setiap assert menunjuk perubahan produksi yang membuatnya gagal:
// AP-1  : addPenjualan() mengembalikan status success (dulu: error
//         "hpp is not defined" karena deklarasi var hpp tertelan komentar)
// AP-2  : variabel hpp benar-benar ditulis ke sheet (kolom HPP Satuan)
// AP-3  : Modal = HPP Satuan x Jumlah
// AP-4  : Laba bersih = Total Harga - Modal
// AP-5  : updateStock() dipanggil dengan qty yang sama -> stok ikut turun
// AP-6  : HPP master produk lebih diutamakan daripada tabel fallback
// AP-7  : produk di luar master memakai fallback getHppRate (volume ikut dipakai)
// AP-8  : validasi tetapolak harga/jumlah 0 (tidak ditembus error ReferenceError)
// AP-9  : ID transaksi format FR-<timestamp> dan unik

import fs from 'node:fs';
import vm from 'node:vm';
import { targetGasDanHtml } from './lib/jalur.mjs';

const { gas: target, html } = targetGasDanHtml();

// ---------- spreadsheet palsu (API GAS yang dipakai addPenjualan) ----------
function buatSheet(nama, baris) {
  return {
    _nama: nama,
    _d: baris,
    getName() { return this._nama; },
    getLastRow() { return this._d.length; },
    getLastColumn() { return this._d.reduce((m, r) => Math.max(m, r.length), 0); },
    getDataRange() {
      const sh = this;
      return { getValues() { return sh._d.map((r) => r.slice()); } };
    },
    getRange(r, c, nR, nC) {
      const sh = this;
      nR = nR === undefined ? 1 : nR;
      nC = nC === undefined ? 1 : nC;
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < nR; i++) {
            const row = [];
            for (let j = 0; j < nC; j++) {
              row.push(sh._d[r - 1 + i] ? sh._d[r - 1 + i][c - 1 + j] : '');
            }
            out.push(row);
          }
          return out;
        },
        setValue(v) {
          if (!sh._d[r - 1]) sh._d[r - 1] = [];
          sh._d[r - 1][c - 1] = v;
          return this;
        },
        setFontWeight() { return this; },
        getValue() { return sh._d[r - 1] ? sh._d[r - 1][c - 1] : ''; }
      };
    },
    appendRow(row) { this._d.push(row.slice()); return this; },
    insertColumnsAfter(pos, howMany) {
      for (const row of this._d) row.splice(pos, 0, ...new Array(howMany).fill(''));
      return this;
    }
  };
}

const HEADER_V2 = [
  'ID Transaksi', 'Tanggal', 'Nama Produk', 'Volume (ml)', 'HPP Satuan', 'Jumlah',
  'Total Harga', 'Metode Pembayaran', 'Uang Dibayar', 'Uang Kembali', 'Modal',
  'Biaya Operasional', 'Laba bersih'
];
const idx = (nama) => HEADER_V2.indexOf(nama);

// Konteks GAS: fungsi Code.gs yang benar-benar dijalankan, spreadsheet palsu.
function buatKonteks() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(target, 'utf8'), ctx, { filename: 'Code.gs' });

  const penjualan = buatSheet('Penjualan', [HEADER_V2.slice()]);
  const produk = buatSheet('Produk', [
    ['Nama Produk', 'Stok', 'HPP'],
    ['Semangka Leci 250 ml', 10, 8000]
  ]);
  const ss = {
    getSheetByName(n) {
      if (n === 'Penjualan') return penjualan;
      if (n === 'Produk') return produk;
      return null;
    },
    getActiveSpreadsheet() { return this; }
  };
  ctx.getSpreadsheet = () => ss;
  // Token & stok di luar cakupan tes ini (butuh CacheService/Sheet Produk penuh).
  ctx._verifyToken = () => ({ username: 'tester', role: 'ADMIN' });
  const panggilanStok = [];
  ctx.updateStock = (nama, qty) => { panggilanStok.push([nama, qty]); };

  return { ctx, penjualan, produk, panggilanStok };
}

function simpan(ctx, data) {
  return ctx.addPenjualan('token-test', Object.assign({
    tanggal: '2026-09-29', namaProduk: 'Semangka Leci 250 ml',
    harga: 15000, jumlah: 1, volume: 250, metode: 'Cash'
  }, data));
}

// ---------- util assert ----------
let lulus = 0;
const gagal = [];
function cek(nama, fn) {
  try {
    fn();
    lulus++;
    console.log('  LULUS  ' + nama);
  } catch (e) {
    gagal.push(nama);
    console.log('  GAGAL  ' + nama + ' -> ' + e.message);
  }
}
function eq(didapat, diharapkan, label) {
  if (didapat !== diharapkan) {
    throw new Error((label || '') + ' harap ' + JSON.stringify(diharapkan) +
      ' tapi dapat ' + JSON.stringify(didapat));
  }
}

console.log('Tes regresi Code.gs:960 - addPenjualan (tombol Simpan dashboard)\n');

{
  const { ctx, penjualan, panggilanStok } = buatKonteks();
  const res = simpan(ctx, {});

  console.log('  [info] hasil panggil pertama: ' + JSON.stringify(res));
  console.log('  [info] baris di sheet Penjualan: ' + (penjualan.getLastRow() - 1));
  console.log('');

  cek('AP-1 status success (tidak ReferenceError)', () => {
    if (!res || res.status !== 'success') {
      throw new Error('status=' + JSON.stringify(res && res.status) +
        ' message=' + JSON.stringify(res && res.message));
    }
  });

  cek('AP-2 baris benar-benar tersimpan', () => {
    eq(penjualan.getLastRow(), 2, 'jumlah baris data');
  });

  cek('AP-2b kolom terisi sesuai skema v2', () => {
    const r = penjualan._d[1];
    eq(r[idx('ID Transaksi')], res.idTx, 'ID Transaksi');
    eq(r[idx('Nama Produk')], 'Semangka Leci 250 ml', 'Nama Produk');
    eq(r[idx('Volume (ml)')], 250, 'Volume (ml)');
    eq(r[idx('Jumlah')], 1, 'Jumlah');
    eq(r[idx('Total Harga')], 15000, 'Total Harga');
    eq(r[idx('Metode Pembayaran')], 'CASH', 'Metode Pembayaran');
  });

  cek('AP-2c HPP Satuan diambil dari master produk (8000)', () => {
    eq(penjualan._d[1][idx('HPP Satuan')], 8000, 'HPP Satuan');
  });

  cek('AP-3 Modal = HPP Satuan x Jumlah', () => {
    eq(penjualan._d[1][idx('Modal')], 8000, 'Modal');
  });

  cek('AP-4 Laba bersih = Total Harga - Modal', () => {
    eq(penjualan._d[1][idx('Laba bersih')], 7000, 'Laba bersih');
  });

  cek('AP-5 updateStock dipanggil dengan qty yang sama', () => {
    eq(panggilanStok.length, 1, 'jumlah panggilan updateStock');
    eq(panggilanStok[0][0], 'Semangka Leci 250 ml', 'nama produk');
    eq(panggilanStok[0][1], 1, 'qty');
  });

  cek('AP-9 ID transaksi format FR-<timestamp>', () => {
    if (!/^FR-\d{10,}$/.test(String(res.idTx || ''))) {
      throw new Error('idTx=' + JSON.stringify(res.idTx));
    }
  });
}

{
  // AP-6: master produk menang atas tabel fallback (7.500 untuk 250 ml).
  const { ctx, penjualan } = buatKonteks();
  simpan(ctx, { namaProduk: 'Semangka Leci 250 ml' });
  cek('AP-6 HPP master (8000) mengalahkan fallback katalog (7500)', () => {
    eq(penjualan._d[1][idx('HPP Satuan')], 8000, 'HPP Satuan');
  });
}

{
  // AP-7: produk di luar master -> fallback getHppRate, volume ikut dipakai.
  const { ctx, penjualan } = buatKonteks();
  const res = simpan(ctx, { namaProduk: 'WNA 350 ml', harga: 20000 });
  cek('AP-7 fallback HPP 350 ml = 10.500 (kelompok WNA)', () => {
    if (!res || res.status !== 'success') {
      throw new Error('status=' + JSON.stringify(res));
    }
    eq(penjualan._d[1][idx('HPP Satuan')], 10500, 'HPP Satuan');
    eq(penjualan._d[1][idx('Laba bersih')], 20000 - 10500, 'Laba bersih');
  });
}

{
  // AP-8: validasi tetap hidup (tidak ikut terlempar ReferenceError).
  const { ctx, penjualan } = buatKonteks();
  const h0 = simpan(ctx, { harga: 0 });
  const j0 = simpan(ctx, { jumlah: 0 });
  const k0 = simpan(ctx, { namaProduk: '  ' });
  cek('AP-8a harga 0 ditolak dengan pesan yang tepat', () => {
    eq(h0.status, 'error', 'status');
    eq(h0.message, 'Harga harus lebih dari 0', 'message');
  });
  cek('AP-8b jumlah 0 ditolak, TIDAK diam-diam jadi 1', () => {
    // Number(data.jumlah || 1) membalik 0 -> 1 karena 0 falsy, sehingga
    // penjualan qty 0 TERCATAT sebagai 1 unit (UI bahkan menampilkan "Rp 0").
    // Default 1 hanya boleh berlaku bila kolom benar-benar kosong.
    eq(j0.status, 'error', 'status');
    eq(j0.message, 'Jumlah harus lebih dari 0', 'message');
  });

  cek('AP-10a jumlah bukan angka (NaN) ditolak, bukan ditulis', () => {
    const n = simpan(ctx, { jumlah: 'abc' });
    eq(n.status, 'error', 'status');
    eq(n.message, 'Jumlah harus lebih dari 0', 'message');
  });

  cek('AP-10b jumlah kosong tetap memakai default 1', () => {
    const kosong = simpan(ctx, { jumlah: '' });
    if (!kosong || kosong.status !== 'success') {
      throw new Error('status=' + JSON.stringify(kosong));
    }
    eq(kosong.idTx ? penjualan._d[penjualan.getLastRow() - 1][idx('Jumlah')] : 0, 1, 'Jumlah');
  });

  cek('AP-8d input invalid tidak menambah baris', () => {
    // 5 panggilan: harga 0, qty 0, 'abc', nama kosong (ditolak) + 1 default
    // jumlah kosong (ditulis) -> tepat 1 baris tambahan.
    eq(penjualan.getLastRow(), 2, 'header + 1 baris (dari jumlah kosong)');
    eq(penjualan._d[1][idx('Nama Produk')], 'Semangka Leci 250 ml', 'Nama Produk');
  });
  cek('AP-8c nama produk kosong ditolak', () => {
    eq(k0.status, 'error', 'status');
    eq(k0.message, 'Nama produk wajib diisi', 'message');
  });
}

{
  // AP-9b: ID unik walau dipanggil berkali-kali.
  const { ctx } = buatKonteks();
  cek('AP-9b tiga transaksi menghasilkan tiga ID unik', () => {
    const ids = new Set();
    for (let i = 0; i < 3; i++) {
      const r = simpan(ctx, { jumlah: i + 1 });
      if (!r || !r.idTx) throw new Error('transaksi ke-' + (i + 1) + ' gagal: ' + JSON.stringify(r));
      if (ids.has(r.idTx)) throw new Error('ID duplikat: ' + r.idTx);
      ids.add(r.idTx);
    }
    eq(ids.size, 3, 'jumlah ID unik');
  });
}

{
  // AP-11: sisi frontend tidak boleh membalik qty 0 -> 1 sebelum validasi
  // (bug yang sama di dua lapisan: UI menampilkan "Rp 0" lalu menyimpan 1 unit).
  // html sudah punya nilai dari lib/jalur.mjs; guard hanya untuk berkas hilang.
  if (!fs.existsSync(html)) {
    console.log('  (lewati AP-11: DashboardStandalone.html tidak ditemukan di ' + html + ')');
  } else {
    const src = fs.readFileSync(html, 'utf8');
    const bodyAksi = (function () {
      const start = src.indexOf('function aksiInputPenjualan(');
      if (start === -1) return '';
      let depth = 0, i = src.indexOf('{', start);
      for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
      }
      return src.slice(start);
    })();

    cek('AP-11a jumlah tidak lagi dipaksa jadi 1 saat 0 diketik', () => {
      const baris = bodyAksi.split('\n').filter((l) => /^\s*jumlah\s*:/.test(l));
      if (!baris.length) throw new Error('baris jumlah tidak ditemukan');
      const buruk = baris.filter((l) => /\|\|\s*1\s*,?\s*$/.test(l));
      if (buruk.length) throw new Error('masih ada default paksa "|| 1": ' + buruk[0].trim());
    });

    cek('AP-11b validasi frontend menolak jumlah 0 dan NaN', () => {
      if (!/if\s*\(\s*!isFinite\(\s*data\.jumlah\s*\)\s*\|\|\s*data\.jumlah\s*<=\s*0\s*\)/.test(bodyAksi)) {
        throw new Error('validasi jumlah di frontend tidak memakai !isFinite || <= 0');
      }
    });

    cek('AP-11c kolom Jumlah tidak menyuruh mengetik 0 (placeholder)', () => {
      const m = /<input[^>]*id="inJumlah"[^>]*>/.exec(src);
      if (!m) throw new Error('input inJumlah tidak ditemukan');
      if (/placeholder="0"/.test(m[0])) {
        throw new Error('placeholder masih "0": ' + m[0]);
      }
    });

    cek('AP-11d input Jumlah tetap punya min="1"', () => {
      const m = /<input[^>]*id="inJumlah"[^>]*>/.exec(src);
      if (!/min="1"/.test(m[0])) throw new Error('min="1" hilang: ' + m[0]);
    });
  }
}

console.log('\n' + lulus + ' lulus, ' + gagal.length + ' gagal');
if (gagal.length) {
  console.log('GAGAL: ' + gagal.join(' | '));
  process.exit(1);
}
