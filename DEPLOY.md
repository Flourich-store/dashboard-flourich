# Catatan Deploy — Flourich Dashboard (Apps Script)

## Project aktif

| Item | Nilai |
| --- | --- |
| scriptId (`.clasp.json`) | `1rGYmSYFFy7_3VYlTWqUeFaF1mD6F8eM8TLDGB8_9yzfhGJfnjUMK5ESM` |
| deploymentId (satu-satunya) | `AKfycbw3uq3m8fwEv5bQeOJhGvxo_Fm74LrQ_fpv98h0mu1RhsXGkbdADAUdK9WRz0cQUTxq` |
| Web app | `https://script.google.com/macros/s/<deploymentId>/exec` |
| Editor | `https://script.google.com/d/<scriptId>/edit` |

`deploymentId` di atas dipakai **tepat satu kali** di `index.html` (`DASHBOARD_URL`) dan
`landingpage.html`. Jangan menambah ID kedua; `deploy.mjs` membaca ID dari dua file itu.

## Kenapa pindah project

Project lama (`1PUHWTYa1H8…`) sudah mencapai batas **200 versi**, jadi tidak bisa membuat
version baru lagi (`Cannot create more versions…`). Solusinya clone ke project baru di atas.
Project lama dibiarkan apa adanya dan **tidak dipakai lagi**. Link/deployment lama mati.

## Otorisasi owner (wajib sekali, setelah clone/deploy pertama)

Project baru tidak melayani pengunjung anonim sebelum owner memberi izin. Gejalanya:
URL `/exec` mengembalikan **HTTP 403 "Akses Ditolak"** (halaman Drive), bukan halaman aplikasi.

1. Login browser sebagai akun Google pemilik spreadsheet dashboard.
2. Buka `https://script.google.com/macros/s/<deploymentId>/exec?page=dashboard`.
3. Klik **Continue / Izinkan (Allow)** sampai muncul "Authorization successful".
4. Buka ulang URL; harus tampil `Flourich Dashboard` (HTTP 200).

Manifest tetap `webapp: { executeAs: USER_DEPLOYING, access: ANYONE_ANONYMOUS }`; izin owner
di atas hanya perlu sekali per project (ulangi bila scope/script berubah dan Google meminta ulang).

## Perintah deploy

```bash
clasp login                       # sekali per mesin
node deploy.mjs --message "..."   # push + redeploy deploymentId di atas + verifikasi build
node tests/jalankan-semua.mjs     # tes regresi (harus 27/27 lulus)
```

Manual, bila perlu:

```bash
clasp push --force                                   # pakai --force bila clasp bilang "Skipping push"
clasp deploy -i <deploymentId> -d "flourich-dashboard"  # version baru, URL tetap
clasp deployments                                     # cek hanya ada satu deployment publik
```

## Hal yang sering bikin bingung

- **Verifikasi `deploy.mjs` gagal 403** → owner belum otorisasi (lihat bagian di atas), bukan
  masalah kode/deployment.
- **`clasp create` gagal "Project file already exists."** → dijalankan di dalam folder yang
  sudah punya `.clasp.json`; buat project baru dari folder kosong di luar repo.
- **Project baru hasil `clasp create`** hanya berisi `appsscript.json` dan `clasp push` pertama
  bisa "Skipping push"; jalankan `clasp push --force` sebelum deploy pertama.
- **URL `@HEAD`** (`…/dev` atau deployment HEAD) selalu meminta login Google — jangan dipakai
  sebagai URL publik; pakai deployment bernomor.
- **Jangan hapus semua versi** untuk "membersihkan": batas 200 versi hanya relevan di project
  lama, dan versi yang dipakai deployment tidak boleh dihapus.

## Data per cabang

- **Sheet User**: kolom `Cabang` (nama header, bukan posisi) menentukan cabang tiap
  akun. Akun `SUPER_ADMIN` boleh tanpa cabang (melihat semua).
- **Sheet Penjualan**: kolom `Cabang` dibuat otomatis di ujung kanan saat transaksi
  baru ditulis lewat `addPenjualan` — posisi 13 kolom skema v2 tidak bergeser.
- **Baris lama** belum punya cabang: isi manual kolom `Cabang` per baris. Selama
  kolomnya belum ada, filter tidak diterapkan (dashboard menampilkan semua data)
  agar layar kasir tidak kosong. Baris ber-cabang kosong TIDAK tampil saat filter
  cabang aktif.
- **Kasir** terkunci ke cabang dari token (parameter dari frontend diabaikan).
  **SUPER_ADMIN** memilih cabang lewat dropdown di header, termasuk "Semua cabang".
- Regresi: `node tests/cabang-filter.test.mjs` (13 cek) — ikut gerbang
  `node tests/jalankan-semua.mjs`.
