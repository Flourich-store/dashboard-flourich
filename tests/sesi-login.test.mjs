// Tes regresi: sesi login bertahan saat browser di-refresh.
//
// Kenapa: sesi disimpan di sessionStorage iframe Apps Script. Saat halaman
// dimuat ulang, iframe dibuat baru dan sessionStorage bisa kosong, sehingga
// user dipaksa login ulang walau belum logout. Sekarang sesi dicadangkan di
// localStorage bersama masa berlakunya.
//
// Aturan yang dikunci:
//   1. Masa berlaku sesi 30 menit, disimpan di sessionStorage DAN localStorage.
//   2. Cadangan localStorage berisi username, role, token, dan expiry.
//   3. restoreSessionIfValid() memulihkan sesi dari localStorage bila
//      sessionStorage kosong, lalu memperpanjang masa berlakunya.
//   4. Sesi kedaluwarsa / tidak lengkap dihapus, tidak pernah dipakai.
//   5. Logout & clearSessionState() menghapus sessionStorage dan localStorage.
//   6. Login baru tetap menyimpan token + expiry lewat jalur yang sama.
//
//   node tests/sesi-login.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import { targetHtml } from './lib/jalur.mjs';

const html = fs.readFileSync(targetHtml(), 'utf8');

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

// Blok kode sesi utuh: konstanta + helper localStorage + setSessionExpiry +
// clearSessionState + getToken + restoreSessionIfValid. Dipotong dari HTML
// supaya yang diuji adalah kode yang benar-benar dikirim ke browser.
function blokSesi() {
  const mulai = html.indexOf('var SESSION_TIMEOUT_MS');
  const akhir = html.indexOf('function handleLogin');
  if (mulai < 0 || akhir < 0 || akhir <= mulai) throw new Error('blok sesi tidak ditemukan di HTML');
  return html.slice(mulai, akhir);
}

function buatStore(map) {
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}

function sandboxSesi() {
  const sesi = new Map();
  const lokal = new Map();
  const panggilan = [];
  const sandbox = {
    sessionStorage: buatStore(sesi),
    localStorage: buatStore(lokal),
    Date, isFinite, JSON, String, Number, Math,
    window: { addEventListener: function () { } },
    document: { addEventListener: function () { }, visibilityState: 'visible' },
    showDashboard: function () { panggilan.push('showDashboard'); },
    initDashboardData: function () { panggilan.push('initDashboardData'); },
    startSessionTimer: function () { panggilan.push('startSessionTimer'); },
    bindSessionActivity: function () { panggilan.push('bindSessionActivity'); },
    logout: function () { panggilan.push('logout'); }
  };
  vm.runInNewContext(
    blokSesi() + '\n' +
    'this.setSessionExpiry = setSessionExpiry;\n' +
    'this.clearSessionState = clearSessionState;\n' +
    'this.restoreSessionIfValid = restoreSessionIfValid;\n' +
    'this.simpanSesiPersisten = simpanSesiPersisten;\n' +
    'this.bacaSesiPersisten = bacaSesiPersisten;\n' +
    'this.SESSION_STORE_KEY = SESSION_STORE_KEY;',
    sandbox
  );
  return { sandbox, sesi, lokal, panggilan };
}

// ---------- 1. Masa berlaku sesi ------------------------------------------
uji('masa berlaku sesi 30 menit', () => {
  benar(/var\s+SESSION_TIMEOUT_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000\s*;/.test(html), 'SESSION_TIMEOUT_MS harus 30 * 60 * 1000');
});

uji('setSessionExpiry(): expiry diperbarui di sessionStorage', () => {
  const kota = sandboxSesi();
  kota.sesi.set('dash_username', 'nina');
  kota.sesi.set('dash_role', 'KASIR');
  kota.sesi.set('dash_token', 'tok-123');
  kota.sandbox.setSessionExpiry();
  const exp = Number(kota.sesi.get('dash_session_expiry'));
  const sisa = exp - Date.now();
  benar(sisa > 29 * 60 * 1000 && sisa <= 30 * 60 * 1000 + 2000, 'expiry harus ~30 menit ke depan, dapat ' + Math.round(sisa / 1000) + ' detik');
});

uji('sesi login dicadangkan ke localStorage beserta masa berlaku', () => {
  const kota = sandboxSesi();
  kota.sesi.set('dash_username', 'nina');
  kota.sesi.set('dash_role', 'SUPER_ADMIN');
  kota.sesi.set('dash_token', 'tok-abc');
  kota.sandbox.setSessionExpiry();

  const mentah = kota.lokal.get(kota.sandbox.SESSION_STORE_KEY);
  benar(mentah, 'cadangan localStorage tidak dibuat');
  const data = JSON.parse(mentah);
  eq(data.username, 'nina', 'username');
  eq(data.role, 'SUPER_ADMIN', 'role');
  eq(data.token, 'tok-abc', 'token');
  eq(Number(data.expiry), Number(kota.sesi.get('dash_session_expiry')), 'expiry harus sama dengan sessionStorage');
});

// ---------- 2. Pemulihan setelah refresh ----------------------------------
uji('restoreSessionIfValid(): memulihkan sesi dari localStorage saat sessionStorage kosong', () => {
  const kota = sandboxSesi();
  kota.lokal.set(kota.sandbox.SESSION_STORE_KEY, JSON.stringify({
    username: 'nina', role: 'KASIR', token: 'tok-pulih', expiry: Date.now() + 10 * 60 * 1000
  }));

  eq(kota.sandbox.restoreSessionIfValid(), true, 'sesi harus dipulihkan');
  eq(kota.sesi.get('dash_username'), 'nina', 'username harus dikembalikan ke sessionStorage');
  eq(kota.sesi.get('dash_token'), 'tok-pulih', 'token harus dikembalikan ke sessionStorage');
  eq(kota.sesi.get('dash_role'), 'KASIR', 'role harus dikembalikan ke sessionStorage');
  benar(kota.panggilan.indexOf('showDashboard') !== -1, 'dashboard harus ditampilkan tanpa login');
  benar(kota.panggilan.indexOf('initDashboardData') !== -1, 'data dashboard harus dimuat setelah sesi dipulihkan');
});

uji('restoreSessionIfValid(): masa berlaku diperpanjang setelah dipulihkan', () => {
  const kota = sandboxSesi();
  const sisaAwal = 5 * 60 * 1000;
  kota.lokal.set(kota.sandbox.SESSION_STORE_KEY, JSON.stringify({
    username: 'nina', role: 'KASIR', token: 'tok-pulih', expiry: Date.now() + sisaAwal
  }));
  kota.sandbox.restoreSessionIfValid();
  const exp = Number(kota.sesi.get('dash_session_expiry'));
  benar(exp - Date.now() > sisaAwal + 20 * 60 * 1000, 'expiry harus diperpanjang menjadi ~30 menit');
});

uji('restoreSessionIfValid(): sesi kedaluwarsa dibuang, bukan dipakai', () => {
  const kota = sandboxSesi();
  kota.lokal.set(kota.sandbox.SESSION_STORE_KEY, JSON.stringify({
    username: 'nina', role: 'KASIR', token: 'tok-basi', expiry: Date.now() - 1000
  }));
  eq(kota.sandbox.restoreSessionIfValid(), false, 'sesi kedaluwarsa tidak boleh dipulihkan');
  benar(!kota.lokal.has(kota.sandbox.SESSION_STORE_KEY), 'cadangan kedaluwarsa harus dihapus');
  benar(kota.panggilan.indexOf('showDashboard') === -1, 'dashboard tidak boleh ditampilkan');
});

uji('restoreSessionIfValid(): cadangan tanpa token dianggap tidak sah', () => {
  const kota = sandboxSesi();
  kota.lokal.set(kota.sandbox.SESSION_STORE_KEY, JSON.stringify({
    username: 'nina', role: 'KASIR', expiry: Date.now() + 10 * 60 * 1000
  }));
  eq(kota.sandbox.restoreSessionIfValid(), false, 'tanpa token harus ditolak');
  benar(!kota.lokal.has(kota.sandbox.SESSION_STORE_KEY), 'cadangan tidak lengkap harus dihapus');
});

// ---------- 2b. Sesi bertahan saat tab ditutup lalu dibuka lagi -----------
// Tab ditutup = sessionStorage hilang, localStorage bertahan. Sesi harus
// dipulihkan selama masih di dalam masa berlaku 30 menit.
uji('tab ditutup lalu dibuka lagi dalam 30 menit: sesi tetap pulih tanpa login', () => {
  const tab1 = sandboxSesi();
  tab1.sesi.set('dash_username', 'nina');
  tab1.sesi.set('dash_role', 'KASIR');
  tab1.sesi.set('dash_token', 'tok-tab');
  tab1.sandbox.setSessionExpiry(true); // keadaan terakhir disimpan saat tab ditutup

  const tab2 = sandboxSesi(); // tab baru: sessionStorage kosong
  for (const [k, v] of tab1.lokal) tab2.lokal.set(k, v);

  eq(tab2.sandbox.restoreSessionIfValid(), true, 'sesi harus dipulihkan tanpa login ulang');
  eq(tab2.sesi.get('dash_username'), 'nina', 'username');
  eq(tab2.sesi.get('dash_token'), 'tok-tab', 'token');
  benar(tab2.panggilan.indexOf('showDashboard') !== -1, 'dashboard harus langsung tampil');
  benar(tab2.panggilan.indexOf('logout') === -1, 'tidak boleh ada logout');
});

uji('tab dibuka lagi setelah 30 menit: sesi dibuang, user harus login', () => {
  const tab1 = sandboxSesi();
  tab1.sesi.set('dash_username', 'nina');
  tab1.sesi.set('dash_role', 'KASIR');
  tab1.sesi.set('dash_token', 'tok-basi');
  tab1.sandbox.setSessionExpiry(true);

  // Lewatkan masa berlaku: 30 menit lebih 1 detik.
  const kunci = tab1.sandbox.SESSION_STORE_KEY;
  const data = JSON.parse(tab1.lokal.get(kunci));
  data.expiry = Date.now() - 1000;
  tab1.lokal.set(kunci, JSON.stringify(data));

  const tab2 = sandboxSesi();
  for (const [k, v] of tab1.lokal) tab2.lokal.set(k, v);

  eq(tab2.sandbox.restoreSessionIfValid(), false, 'sesi kedaluwarsa tidak boleh dipulihkan');
  benar(!tab2.lokal.has(kunci), 'cadangan kedaluwarsa harus dihapus');
  benar(tab2.panggilan.indexOf('showDashboard') === -1, 'dashboard tidak boleh tampil');
});

uji('menutup/menyembunyikan tab menyimpan masa berlaku terakhir', () => {
  const b = potongFungsi(html, 'function bindSessionActivity');
  benar(/visibilitychange/.test(b), 'harus mendengarkan visibilitychange');
  benar(/pagehide/.test(b), 'harus mendengarkan pagehide');
  benar(/setSessionExpiry\(true\)/.test(b), 'saat tab ditinggalkan expiry harus disimpan paksa (melewati batas 60 detik)');
});

// ---------- 3. Logout membersihkan keduanya -------------------------------
uji('clearSessionState(): menghapus sessionStorage dan localStorage', () => {
  const kota = sandboxSesi();
  kota.sesi.set('dash_username', 'nina');
  kota.sesi.set('dash_role', 'KASIR');
  kota.sesi.set('dash_token', 'tok');
  kota.sesi.set('dash_session_expiry', String(Date.now() + 1000));
  kota.lokal.set(kota.sandbox.SESSION_STORE_KEY, JSON.stringify({ username: 'nina', role: 'KASIR', token: 'tok', expiry: Date.now() + 1000 }));

  kota.sandbox.clearSessionState();
  benar(!kota.sesi.has('dash_username'), 'dash_username harus terhapus');
  benar(!kota.sesi.has('dash_token'), 'dash_token harus terhapus');
  benar(!kota.sesi.has('dash_session_expiry'), 'dash_session_expiry harus terhapus');
  benar(!kota.lokal.has(kota.sandbox.SESSION_STORE_KEY), 'cadangan localStorage harus ikut terhapus');
});

// ---------- 4. Jalur login baru -------------------------------------------
uji('handleLogin(): menyimpan token lalu memperbarui expiry (ikut dicadangkan)', () => {
  const b = potongFungsi(html, 'function handleLogin');
  benar(/sessionStorage\.setItem\(\s*'dash_token'/.test(b), 'token harus disimpan ke sessionStorage');
  benar(/setSessionExpiry\s*\(\s*\)/.test(b), 'login harus memperbarui masa berlaku (yang juga menulis localStorage)');
  benar(/cachedSession\s*=/.test(b), 'token harus di-cache di memori');
});

uji('logout(): memakai clearSessionState sehingga cadangan ikut hilang', () => {
  const b = potongFungsi(html, 'function logout');
  benar(/clearSessionState\s*\(\s*\)/.test(b), 'logout harus memanggil clearSessionState()');
});

uji('cadangan tidak pernah berisi password', () => {
  const b = potongFungsi(html, 'function simpanSesiPersisten');
  benar(!/password|passInp/i.test(b), 'cadangan sesi tidak boleh menyimpan password');
});

// ---------- laporan --------------------------------------------------------
console.log('');
if (gagal.length) {
  console.log('=== ' + gagal.length + ' DARI ' + (lulus + gagal.length) + ' TEST GAGAL ===');
  for (const g of gagal) console.log('  - ' + g);
  process.exit(1);
}
console.log('=== SEMUA LOLOS (' + lulus + ' tes) ===');
