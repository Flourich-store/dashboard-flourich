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
| `kpi-credit-debit.test.mjs` | KPI Credit/Debit: `_readCreditDebitItems` benar-benar mengembalikan array, deteksi kolom Jenis lewat header (bukan index), normalisasi + matriks klasifikasi baris, agregasi per periode, rumus Laba Bersih, sheet tanpa kolom Jenis tidak diam-diam jadi nol, parsing tanggal |
| `panel-kpi-cd.test.mjs` | Panel peringatan Credit/Debit di `DashboardStandalone.html`: muncul di dua tempat, hanya tampil kalau ada masalah, teks menyebut jumlah + nominal + dampak, `resetPeringatanKpiCd` mengosongkan semua, gagal baca tidak menulis "Rp0", isi baris di-escape |
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

## Data produksi tidak boleh masuk repo

Repo ini **publik** (`github.com/Flourich-store/dashboard-flourich`, GitHub
Pages aktif). Jadi dua aturan berlaku untuk folder `tests/`:

1. **Snapshot spreadsheet tidak boleh di-commit.** `tests/fixtures/` ada di
   `.gitignore`. Tes yang membutuhkannya hanya jalan di komputer pemilik
   usaha. Kalau repo di-clone di komputer lain, tes itu gagal dengan pesan
   "fixture tidak ditemukan" - itu disengaja, bukan bug.
2. **Nilai transaksi tidak boleh ditulis langsung di skrip tes.** Karena itu
   `kpi-credit-debit.test.mjs` dan `panel-kpi-cd.test.mjs` dirakit dari
   **data karangan**: tahun fiktif 2024, kategori fiktif, dan setiap nominal
   berakhiran angka bukan nol (`...137`, `...213`, `...417`). Semua nilai
   rupiah di sheet produksi adalah kelipatan 1.000, jadi bentuk itu secara
   struktural tidak mungkin sama dengan transaksi mana pun.

Yang tetap hidup di komputer pemilik usaha tapi tidak ter-commit:

| Pola | Isinya |
| --- | --- |
| `tests/fixtures/*.csv` | snapshot mentah dari spreadsheet |
| `tests/*.lokal.mjs` | tes yang datanya diturunkan dari snapshot produksi (angka asli) |
| `tests/TEMUAN-AUDIT-JENIS.md` | catatan temuan audit |
| daftar panjang di `.gitignore` | skrip hitung/cari-perbaikan yang isinya turunan data produksi |
| `tests/audit-data-tertanam.mjs` | pemindai data bisnis; pola lawful-nya sendiri memuat angka asli |

### Skrip diagnosis yang ter-commit tapi butuh fixture

Keempat skrip berikut ikut ter-commit karena isinya bersih, tapi karena
membaca `tests/fixtures/` mereka tidak bisa jalan di clone baru. Itu sebabnya
mereka **tidak** didaftarkan di `CEK` pada `jalankan-semua.mjs`.

| Berkas | Gunanya |
| --- | --- |
| `cari-cd.mjs` | Cari baris Credit/Debit yang memuat `<kata-kunci>`, lalu dump kolom lengkap. Kata kunci diambil dari argumen CLI dan **tidak pernah ditulis di dalam berkasnya** - kalau ditulis, nilai produksi ikut ter-push. |
| `cek-ukuran-fixture.mjs` | Mengukur fixture: ukuran, jumlah baris, dan apakah isi hasil parse kembali sama persis. |
| `diagnosa-indeks-cd.mjs` | Memetakan indeks kolom Credit/Debit lalu memeriksa apakah pembacaan di `Code.gs` cocok dengan header sebenarnya. |
| `pilah-commit.mjs` | Menggolongkan skrip `tests/` menjadi AMAN / SUDAH TER-PUSH / RAHASIA. |

`bukti-sintetis.lokal.mjs` dan `cek-sebelum-push.lokal.mjs` membuktikannya
dengan mencocokkan isi skrip ke setiap sel dari ketiga snapshot:

```
node tests/cek-sebelum-push.lokal.mjs                    # menyapu seluruh diff
node tests/cek-sebelum-push.lokal.mjs -- tests/a.mjs     # menyapu berkas tertentu
node tests/bukti-sintetis.lokal.mjs
```

Hasilnya: **0 tanggal transaksi, 0 nominal transaksi** yang cocok. Yang
cocok hanya kosakata skema (`CREDIT`, `Produk`) yang definisinya sudah ada
di `Code.gs` yang ter-push ke repo.

`cek-sebelum-push.lokal.mjs` wajib punya kontrol negatif sebelum dipakai
menyimpulkan "bersih" - jalankan terhadap `origin/main` yang isinya sudah
diketahui bocor, dan pastikan skrip itu melaporkan jumlah yang bukan 0. `git diff`
buta terhadap berkas untracked, jadi skrip bisa membaca berkas langsung
dengan mode `-- <berkas>`.

Menambah tes baru ke daftar `CEK` di `jalankan-semua.mjs`? Jangan pernah
membuatnya membaca `tests/fixtures/` - gerbang harus tetap hijau di
komputer mana pun.

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
