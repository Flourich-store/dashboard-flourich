#!/usr/bin/env node
/**
 * FLOURICH AUTO-DEPLOY
 * --------------------
 * Alur otomatis:
 *   1. Deteksi deployment ID + URL dari index.html / landingpage.html
 *   2. Suntik penanda build unik (timestamp) ke DashboardStandalone.html
 *   3. clasp push
 *   4. Redeploy tiap deployment (clasp otomatis membuat version baru; URL tidak berubah)
 *   5. Verifikasi: fetch tiap URL dan pastikan penanda build muncul
 *   6. Pulihkan file lokal (tanpa perubahan sisa di git)
 *
 * Pemakaian:
 *   node deploy.mjs                      -> deploy lengkap + verifikasi
 *   node deploy.mjs --message "teks"     -> keterangan deploy (opsional)
 *   node deploy.mjs --skip-verify        -> lewati verifikasi URL
 *
 * Syarat: clasp sudah login (clasp login) dan .clasp.json menunjuk project GAS.
 */

import { execSync } from 'node:child_process';
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DASHBOARD_FILE = 'DashboardStandalone.html';
const SOURCE_FILES = ['index.html', 'landingpage.html'];
const BACKUP_PATH = join(tmpdir(), 'DashboardStandalone.autodeploy.backup.html');
const VERIFY_RETRIES = 6;
const VERIFY_DELAY_MS = 3000;

// ---------- argumen CLI ----------
const argv = process.argv.slice(2);
const msgIdx = argv.indexOf('--message');
const rawMessage = msgIdx !== -1 ? argv[msgIdx + 1] || '' : '';
const message = rawMessage.replace(/["`$]/g, '').trim() || 'auto deploy';
// clasp di Windows menghapus tanda kutip: deskripsi harus satu token tanpa spasi.
const safeMessage = message.replace(/\s+/g, '-').replace(/[^\w.-]/g, '') || 'auto-deploy';
const skipVerify = argv.includes('--skip-verify');

const log = (...a) => console.log(...a);

function sh(cmd) {
  // Gabungkan stderr ke stdout: clasp 3.x mencetak hasil (mis. "Created version N") ke stderr.
  try {
    return execSync(cmd + ' 2>&1', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const out = (err.stdout || '') + (err.stderr || '');
    throw new Error(`Perintah gagal: ${cmd}\n${out.trim()}`);
  }
}

// ---------- langkah 1: deteksi target ----------
function detectTargets() {
  const deploymentIds = new Set();
  const urls = new Set();
  const re = /https:\/\/script\.google\.com\/macros\/s\/(AKfycb[A-Za-z0-9_-]+)\/exec[^\s'"]*/g;

  for (const file of SOURCE_FILES) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(re)) {
      deploymentIds.add(m[1]);
      urls.add(m[0]);
    }
  }
  return { deploymentIds: [...deploymentIds], urls: [...urls] };
}

// ---------- langkah 2: penanda build ----------
function injectMarker() {
  const html = readFileSync(DASHBOARD_FILE, 'utf8');
  copyFileSync(DASHBOARD_FILE, BACKUP_PATH);

  const buildId =
    new Date().toISOString().replace(/\D/g, '').slice(0, 14) +
    '-' +
    Math.random().toString(16).slice(2, 6);

  // Hapus penanda lama jika ada (misal run sebelumnya gagal sebelum pulih).
  let next = html.replace(/<!--\s*BUILD:[^>]*-->\s*\r?\n?/g, '');
  next = next.replace(/(<html[^>]*?)\s+data-build="[^"]*"/i, '$1');

  const marker = `<!-- BUILD: ${buildId} -->`;
  if (/^<!DOCTYPE html>/i.test(next)) {
    next = next.replace(/^<!DOCTYPE html>/i, `<!DOCTYPE html>\n${marker}`);
  } else {
    next = `${marker}\n${next}`;
  }
  next = next.replace(/<html(\s|>)/i, `<html data-build="${buildId}"$1`);

  writeFileSync(DASHBOARD_FILE, next);
  return buildId;
}

function restoreFile() {
  try {
    copyFileSync(BACKUP_PATH, DASHBOARD_FILE);
    rmSync(BACKUP_PATH, { force: true });
  } catch {
    /* backup sudah tidak ada; abaikan */
  }
}

// ---------- langkah 3-5: push, version, redeploy ----------
function push() {
  const out = sh('clasp push');
  log(out.trim() || '(push selesai)');
}

function redeploy(deploymentId) {
  // Tanpa -V: clasp membuat version baru dari HEAD lalu mengarahkan deployment ke sana.
  const out = sh(`clasp deploy -i ${deploymentId} -d "${safeMessage}"`).trim();
  log(out || `(redeploy ${deploymentId} selesai)`);
  const m = out.match(/@(\d+)\s*$/m);
  return m ? Number(m[1]) : null;
}

// ---------- langkah 6: verifikasi ----------
async function verifyUrl(url, buildId) {
  for (let attempt = 1; attempt <= VERIFY_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      const text = await res.text();
      if (text.includes(buildId)) return { ok: true, status: res.status };
      log(`   percobaan ${attempt}/${VERIFY_RETRIES}: build belum terlihat (HTTP ${res.status}), menunggu ${VERIFY_DELAY_MS / 1000}s...`);
    } catch (err) {
      log(`   percobaan ${attempt}/${VERIFY_RETRIES}: gagal fetch (${err.message})`);
    }
    await new Promise((r) => setTimeout(r, VERIFY_DELAY_MS));
  }
  return { ok: false };
}

// ---------- utama ----------
async function main() {
  log('=== FLOURICH AUTO-DEPLOY ===');
  log(`Keterangan: ${message}\n`);

  const { deploymentIds, urls } = detectTargets();
  if (deploymentIds.length === 0) {
    throw new Error(`Tidak ada URL deployment GAS ditemukan di ${SOURCE_FILES.join(' / ')}.`);
  }
  log(`[1/5] Deployment terdeteksi (${deploymentIds.length}):`);
  for (const id of deploymentIds) log(`      - ${id}`);
  for (const u of urls) log(`      URL: ${u}`);

  log('\n[2/5] Cek koneksi ke project Apps Script...');
  sh('clasp deployments');
  log('      Koneksi OK.');

  let markerInjected = false;
  try {
    log('\n[3/5] Suntik penanda build + clasp push...');
    const buildId = injectMarker();
    markerInjected = true;
    log(`      Build ID: ${buildId}`);
    push();

    log('\n[4/5] Redeploy deployment yang dipakai (version baru dibuat otomatis)...');
    for (const id of deploymentIds) {
      const v = redeploy(id);
      log(v ? `      ${id} -> version ${v}` : `      ${id} -> version tidak terdeteksi (periksa output di atas)`);
    }

    if (skipVerify) {
      log('\n[5/5] Verifikasi dilewati (--skip-verify).');
    } else {
      log('\n[5/5] Verifikasi URL live...');
      const results = [];
      for (const url of urls) {
        log(`   Cek: ${url}`);
        const r = await verifyUrl(url, buildId);
        results.push({ url, ok: r.ok });
        log(r.ok ? '   OK - build terbaru sudah tayang.' : '   GAGAL - build tidak terlihat di URL ini.');
      }
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        throw new Error(`Verifikasi gagal untuk ${failed.length} URL. Cek kembali deployment/URL-nya.`);
      }
    }
  } finally {
    if (markerInjected) restoreFile();
  }

  log('\n=== SELESAI: deploy berhasil dan terverifikasi ===');
  log('Tips: bila tampilan browser masih lama, lakukan hard refresh (Ctrl+Shift+R).');
}

main().catch((err) => {
  console.error('\n[ERROR] ' + err.message);
  process.exit(1);
});
