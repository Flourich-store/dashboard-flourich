# Tes & cek statis dashboard Flourich

Tes regresi dan sapuan statis untuk `Code.gs` (server) dan
`DashboardStandalone.html` (klien).

Tidak ada dependensi: cukup Node.js, tanpa `npm install`, tanpa framework.
Semua tes bisa dijalankan tanpa argumen dari folder mana pun.

## Menjalankan

```
node tests/jalankan-semua.mjs            # ringkas, exit bukan-nol bila ada yang gagal
node tests/jalankan-semua.mjs --lengkap  # cetak semua output
```

Atau per berkas, mis. `node tests/p2-nilai-stok.test.mjs`.

## Apa yang dijaga tiap cek

| Berkas | Yang dijaga |
| --- | --- |
| `add-penjualan.test.mjs` | `addPenjualan`: jumlah baris tersimpan, perhitungan HPP, ID transaksi, dan qty 0 ditolak (bukan dibalik jadi 1) |
| `pos-adapter.test.mjs` | Adapter POS→v2: deteksi baris gaya-POS, konversi 13 kolom, peta kanonik nama (Semangci→Semangka Leci), idempoten, HPP master vs katalog |
| `pos-laporan.test.mjs` | `getReportByDateRange` membaca baris v2 + baris gaya-POS belumlah terkonversi: omset, laba (HPP via kunci kanonik), qty, metode kosong, chart |
| `p2-nilai-stok.test.mjs` | Nilai Stok dihitung identik oleh `getProdukList` dan `getNilaiStok` (keduanya memakai `_hitungNilaiStok`) |
| `perf-p1.test.mjs` | Invarian performa klien: satu panggilan `getProdukList` per muat tab Produk, tidak ada panggilan `getNilaiStok` susulan,respons basi dikenali |
| `mutasi-perf12.mjs` | Uji mutasi: assertion `perf-p1` benar-benar menangkap pelanggaran, bukan hanya lulus diam-diam |
| `login-theme.test.mjs` | Kartu login memakai token warna tema terang/gelap, bukan warna hardcoded |
| `responsive-mobile.test.mjs` | Tata letak layar kecil (tabel, modal, tombol) |
| `cek-statis.mjs` | Sintaks tiap blok `<script>` di HTML + daftar nama fungsi yang dipanggil tapi tanpa deklarasi |
| `sapaan-komentar.mjs` | Kode yang tertelan baris komentar (`Code.gs` dan `DashboardStandalone.html`) |
| `sapaan-identitas.mjs` | Identifier yang dipakai tanpa dideklarasikan -> `ReferenceError` (hanya berkas `.gs`/`.js`) |
| `histogram-karakter.mjs` | Karakter asing baru yang menyelinap ke teks yang diketik/diedit (dibanding HEAD) |
| `cek-pesan.mjs` | Karakter non-ASCII dan pipe liar pada file pesan commit |

`lib/jalur.mjs` berisi pemuat lokasi berkas, supaya setiap tes tahu di mana
`Code.gs` dan `DashboardStandalone.html` tanpa harus diberi path manual.

## Bug nyata yang dicegah oleh cek ini

- **27 Sep — `hpp is not defined`.** Satu baris `var hpp = _resolveHpp(...)` ikut
  tertelan baris komentar di atasnya. `addPenjualan` gagal diam-diam: 0 baris
  tersimpan, error tertangkap jadi pesan biasa. Dicegah `sapaan-komentar.mjs`
  (mendeteksi langsung) dan `sapaan-identitas.mjs` (akibatnya `hpp` tanpa
  deklarasi).
- **29 Sep — qty 0 tersimpan jadi 1.** `Number(x) || 1` di server dan validasi
  klien yang membalik 0 jadi 1. Dikunci `add-penjualan.test.mjs` (AP-11).
- **29 Sep — respons server basi paints "Rp 0".** `terapkanNilaiStok()` hanya
  memeriksa `status === 'success'`, sehingga respons lama tanpa field `nilaiStok`
  ditampilkan dan fallback tidak pernah jalan. Dikunci PERF-12d di
  `perf-p1.test.mjs` + `mutasi-perf12.mjs`.

## Dua jebakan yang sudah ditemukan dan ditutup

1. **Lulus hampa.** `cek-statis.mjs` dulu membaca hanya argumen pertama. Kalau
   diberi `Code.gs` (bukan HTML), tidak menemukan blok `<script>` sama sekali
   tapi tetap mencetak "sintaks valid". Sekarang ia gagal kalau tidak ada blok
   script, dan otomatis memakai HTML sebagai target bawaan.
2. **Scanners yang tidak bisa gagal.** `sapaan-komentar.mjs` dan
   `sapaan-identitas.mjs` dulu hanya mencetak hasil tanpa kode keluar, jadi
   selalu "lulus" di mata `jalankan-semua.mjs`. Sekarang keduanya keluar dengan
   kode bukan-nol bila menemukan sesuatu.

`histogram-karakter.mjs` keluar dengan kode 1 bila ada karakter baru, tapi itu
judgment call: karakter baru belum tentu salah, jadi pesannya "PERIKAT" (tinjau
manual), bukan "GAGAL".

## Catatan tentang deploy

Berkas `.mjs` dan `.md` di folder ini **tidak** ikut ter-push ke Google Apps
Script. Ini sudah terbukti: `deploy.mjs` sendiri ada di repo dan setiap deploy
mendorong tepat 5 berkas (`appsscript.json`, `Code.gs`,
`DashboardStandalone.html`, `index.html`, `landingpage.html`). Karena itu tidak
ada `.claspignore` — menambahkannya tanpa bisa melakukan dry-run `clasp push`
justru berisiko membuat berkas GAS ikut hilang dari proyek, jauh lebih besar
daripada yang dicegah.

Menambah `tests/` tidak memerlukan deploy ulang karena tidak ada berkas GAS yang
berubah.

Karena itu juga **jangan** tambahkan `package.json` atau `*.json` baru di repo
ini hanya supaya bisa menjalankan `npm test`. clasp mendorong berkas `.json`, dan
satu `package.json` salah tempat bisa ikut ter-push ke proyek Apps Script.
Perintah tes di atas (`node tests/jalankan-semua.mjs`) sudah cukup.
