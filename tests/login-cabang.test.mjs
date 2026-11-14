// Tes regresi: login berbasis header sheet User + cabang pada token sesi.
//
// Kenapa: checkLogin() dulu membaca kolom dengan posisi tetap (0,1,2,3).
// Begitu sheet User mendapat kolom Cabang, posisi kolom bergeser dan flag
// SUPER_ADMIN di kolom ke-4 bisa salah tafsir. Sekarang kolom dibaca lewat
// nama header, cabang ikut disimpan di token, dan penanda SUPER_ADMIN tetap
// punya jalur sendiri.
//
// Aturan yang dikunci:
//   1. Username/password/role/cabang dibaca dari header, bukan posisi.
//   2. Urutan kolom bebas (header acak) tetap terbaca benar.
//   3. Login sukses mengembalikan cabang dan menyimpannya di token sesi (c).
//   4. SUPER_ADMIN: kolom Flag khusus, atau warisan kolom ke-4 selama kolom
//      ke-4 bukan Cabang. Kolom Cabang tidak pernah dibaca sebagai flag.
//   5. Role kosong jatuh ke KASIR; username tidak peka huruf besar/kecil,
//      password peka huruf besar/kecil.
//   6. Sheet kosong / tanpa baris data / tanpa sheet User ditolak dengan pesan.
//   7. Tidak ada kredensial hardcoded saat sheet User tidak ada.
//
//   node tests/login-cabang.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import { targetGas } from './lib/jalur.mjs';

const gs = fs.readFileSync(targetGas(), 'utf8');

let lulus = 0;
const gagal = [];
function uji(nama, fn) {
  try { fn(); lulus++; console.log('  LULUS  ' + nama); }
  catch (e) { gagal.push(nama + ' :: ' + e.message); console.log('  GAGAL  ' + nama + ' :: ' + e.message); }
}
function benar(v, pesan) { if (!v) throw new Error(pesan || 'harus bernilai true'); }
function eq(a, b, pesan) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((pesan ? pesan + ': ' : '') + 'dapat ' + x + ', harus ' + y);
}

function potongFungsi(src, penanda) {
  const i = src.indexOf(penanda);
  if (i < 0) throw new Error('fungsi tidak ditemukan: ' + penanda);
  const buka = src.indexOf('{', i);
  let depth = 0;
  for (let k = buka; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('kurung kurawal tidak seimbang: ' + penanda);
}

// Potong blok: konstanta sesi + _createSessionToken + _verifyToken +
// _transportSafe + _guardToken + _num + checkLogin (kode asli dari Code.gs).
function blokLogin() {
  const mulai = gs.indexOf('var SESSION_TTL_SECONDS');
  const akhir = gs.indexOf('// Catatan: _requireSuperAdmin');
  if (mulai < 0 || akhir < 0 || akhir <= mulai) throw new Error('blok login tidak ditemukan di Code.gs');
  return gs.slice(mulai, akhir);
}

function sandboxLogin(rows, opsi) {
  const o = opsi || {};
  const cache = new Map();
  let uuid = 0;
  const sandbox = {
    ACTIVE_ENV: 'PROD',
    Date, String, Number, JSON, Object, Array, isFinite,
    Utilities: {
      getUuid: () => 'uuid-' + (++uuid),
      formatDate: () => ''
    },
    CacheService: {
      getScriptCache: () => ({
        put: (k, v, ttl) => cache.set(k, { v, ttl }),
        get: (k) => (cache.has(k) ? cache.get(k).v : null),
        remove: (k) => cache.delete(k)
      })
    },
    getSpreadsheet: () => ({
      getSheetByName: (nama) => {
        if (nama !== 'User') return null;
        if (o.tanpaSheet) return null;
        return { getDataRange: () => ({ getValues: () => rows }) };
      }
    })
  };
  vm.runInNewContext(blokLogin() + '\nthis.checkLogin = checkLogin;', sandbox);
  return { sandbox, cache };
}

const HEADER_CABANG = [['username', 'password', 'role', 'cabang']];

// ---------- 1. Pemetaan berdasarkan header --------------------------------
uji('login sukses mengembalikan role dan cabang dari kolom yang benar', () => {
  const rows = HEADER_CABANG.concat([['nina', 'rahasia', 'KASIR', 'Cabang A']]);
  const { sandbox } = sandboxLogin(rows);
  const res = sandbox.checkLogin('nina', 'rahasia');
  eq(res.status, 'success', 'status');
  eq(res.username, 'nina', 'username');
  eq(res.role, 'KASIR', 'role');
  eq(res.cabang, 'Cabang A', 'cabang');
  benar(!!res.token, 'token harus dibuat');
});

uji('urutan kolom bebas (header acak) tetap terbaca benar', () => {
  const rows = [
    ['Cabang', 'Role', 'Password', 'Username'],
    ['Cabang B', 'ADMIN', 'pw-b', 'budi']
  ];
  const { sandbox } = sandboxLogin(rows);
  const res = sandbox.checkLogin('budi', 'pw-b');
  eq(res.status, 'success', 'status');
  eq(res.username, 'budi', 'username dari kolom terakhir');
  eq(res.cabang, 'Cabang B', 'cabang dari kolom pertama');
});

uji('cabang ikut disimpan di token sesi (payload c) dengan TTL 6 jam', () => {
  const rows = HEADER_CABANG.concat([['nina', 'rahasia', 'KASIR', 'Cabang A']]);
  const { sandbox, cache } = sandboxLogin(rows);
  const res = sandbox.checkLogin('nina', 'rahasia');
  const tersimpan = cache.get('sess_' + res.token);
  benar(tersimpan, 'token harus tersimpan di cache');
  eq(tersimpan.ttl, 21600, 'TTL token');
  const sesi = JSON.parse(tersimpan.v);
  eq(sesi.u, 'nina', 'u');
  eq(sesi.r, 'KASIR', 'r');
  eq(sesi.c, 'Cabang A', 'c');
});

// ---------- 2. Penanda SUPER_ADMIN ---------------------------------------
uji('tanpa kolom cabang: flag kolom ke-4 (YA) tetap menaikkan role', () => {
  const rows = [
    ['Username', 'Password', 'Role', 'Flag'],
    ['sari', 'pw-s', 'KASIR', 'YA']
  ];
  const { sandbox } = sandboxLogin(rows);
  const res = sandbox.checkLogin('sari', 'pw-s');
  eq(res.status, 'success', 'status');
  eq(res.role, 'SUPER_ADMIN', 'role dari flag kolom ke-4');
  eq(res.cabang, '', 'cabang kosong karena tidak ada kolom cabang');
});

uji('dengan kolom cabang + kolom Flag: SUPER_ADMIN tetap dikenali', () => {
  const rows = [
    ['Username', 'Password', 'Role', 'Cabang', 'Flag'],
    ['sari', 'pw-s', 'KASIR', 'Cabang C', 'YA']
  ];
  const { sandbox } = sandboxLogin(rows);
  const res = sandbox.checkLogin('sari', 'pw-s');
  eq(res.role, 'SUPER_ADMIN', 'role dari kolom Flag');
  eq(res.cabang, 'Cabang C', 'cabang tetap terbaca');
});

uji('kolom Cabang di posisi ke-4 TIDAK dibaca sebagai flag', () => {
  const rows = HEADER_CABANG.concat([['budi', 'pw-b', 'KASIR', 'SUPER_ADMIN']]);
  const { sandbox } = sandboxLogin(rows);
  const res = sandbox.checkLogin('budi', 'pw-b');
  eq(res.role, 'KASIR', 'role tidak boleh naik hanya karena nama cabang berbunyi SUPER_ADMIN');
  eq(res.cabang, 'SUPER_ADMIN', 'nilai itu tetap tersimpan sebagai cabang');
});

// ---------- 3. Normalisasi nilai -----------------------------------------
uji('role kosong default KASIR, role diketik kecil dinormalisasi', () => {
  const rows = [
    ['Username', 'Password', 'Role', 'Cabang'],
    ['a', 'p', '', ''],
    ['b', 'p', 'super_admin', '']
  ];
  const { sandbox } = sandboxLogin(rows);
  eq(sandbox.checkLogin('a', 'p').role, 'KASIR', 'role kosong');
  eq(sandbox.checkLogin('b', 'p').role, 'SUPER_ADMIN', 'role huruf kecil');
});

uji('username tidak peka huruf besar/kecil, password peka huruf besar/kecil', () => {
  const rows = HEADER_CABANG.concat([['Nina', 'Rahasia', 'KASIR', 'Cabang A']]);
  const { sandbox } = sandboxLogin(rows);
  eq(sandbox.checkLogin('  nina ', 'Rahasia').status, 'success', 'username beda kapital + spasi');
  eq(sandbox.checkLogin('nina', 'rahasia').status, 'error', 'password beda kapital harus ditolak');
});

// ---------- 4. Penolakan ------------------------------------------------
uji('password/username salah ditolak tanpa membocorkan data', () => {
  const rows = HEADER_CABANG.concat([['nina', 'rahasia', 'KASIR', 'Cabang A']]);
  const { sandbox } = sandboxLogin(rows);
  const res = sandbox.checkLogin('nina', 'salah');
  eq(res.status, 'error', 'status');
  benar(!res.token, 'tidak boleh mengirim token');
  eq(res.message, 'Username atau password salah', 'pesan');
});

uji('sheet hanya berisi header ditolak sebagai kredensial salah', () => {
  const { sandbox } = sandboxLogin(HEADER_CABANG);
  const res = sandbox.checkLogin('nina', 'rahasia');
  eq(res.status, 'error', 'status');
  eq(res.message, 'Username atau password salah', 'pesan');
});

uji('sheet User kosong ditolak dengan pesan jelas', () => {
  const { sandbox } = sandboxLogin([]);
  const res = sandbox.checkLogin('nina', 'rahasia');
  eq(res.status, 'error', 'status');
  eq(res.message, 'Sheet User kosong', 'pesan');
});

uji('sheet User tidak ada: tidak ada kredensial hardcoded', () => {
  const { sandbox } = sandboxLogin([], { tanpaSheet: true });
  const res = sandbox.checkLogin('admin', 'admin');
  eq(res.status, 'error', 'status');
  benar(!res.token, 'tidak boleh ada token');
  benar(/tidak ditemukan/i.test(res.message), 'pesan harus menyebut sheet tidak ditemukan');
});

uji('kredensial kosong ditolak dan baris tanpa username/password tidak pernah cocok', () => {
  const rows = HEADER_CABANG.concat([
    ['', '', 'KASIR', 'Cabang A'],
    ['', 'pw', 'SUPER_ADMIN', 'Cabang A']
  ]);
  const { sandbox } = sandboxLogin(rows);
  const res = sandbox.checkLogin('', '');
  eq(res.status, 'error', 'status untuk kredensial kosong');
  eq(res.message, 'Username dan password wajib diisi', 'pesan kredensial kosong');
  benar(!res.token, 'tidak boleh ada token untuk kredensial kosong');
  eq(sandbox.checkLogin('', 'pw').status, 'error', 'username kosong harus ditolak');
  eq(sandbox.checkLogin('nina', '').status, 'error', 'password kosong harus ditolak');
});

// ---------- laporan ------------------------------------------------------
console.log('');
if (gagal.length) {
  console.log('=== ' + gagal.length + ' DARI ' + (lulus + gagal.length) + ' TEST GAGAL ===');
  for (const g of gagal) console.log('  - ' + g);
  process.exit(1);
}
console.log('=== SEMUA LOLOS (' + lulus + ' tes) ===');
