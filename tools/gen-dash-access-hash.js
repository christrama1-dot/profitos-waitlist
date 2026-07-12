#!/usr/bin/env node
/**
 * tools/gen-dash-access-hash.js — Founder runs this LOCALLY to produce the
 * DASH_ACCESS_HASH env var value. The plaintext access code is read from stdin
 * (hidden), never echoed, never written to disk, never sent to chat/GitHub.
 *
 * Usage (from repo root):
 *   node tools/gen-dash-access-hash.js
 *   -> paste/type the access code at the prompt, press Enter
 *   -> copy the printed "DASH_ACCESS_HASH=scrypt$..." line into Vercel env vars
 *
 * Also generate SESSION_SECRET separately:
 *   node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
 *   (or: openssl rand -hex 32)  — store in Bitwarden, then add to Vercel.
 */
'use strict';
const readline = require('readline');
const { hashAccessCode } = require('../lib/auth.js');

function readHidden(promptText) {
  return new Promise(function (resolve) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Mute echo so the code is not shown on screen.
    const origWrite = rl.output.write.bind(rl.output);
    let muted = false;
    rl.output.write = function (chunk) { if (!muted) origWrite(chunk); };
    process.stdout.write(promptText);
    muted = true;
    rl.question('', function (answer) {
      muted = false;
      rl.output.write = origWrite;
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

(async function () {
  const code = (await readHidden('Founder dashboard access code (input hidden): ')).trim();
  if (!code || code.length < 12) {
    console.error('\nRefusing: use an access code of at least 12 characters (longer is better).');
    process.exit(1);
  }
  const hash = hashAccessCode(code);
  console.log('\n# Add BOTH of these to Vercel project env vars (Production), then redeploy:');
  console.log('DASH_ACCESS_HASH=' + hash);
  console.log('# SESSION_SECRET=<run: openssl rand -hex 32>   (store in Bitwarden as DASH_SESSION_SECRET)');
  console.log('\n# The plaintext code was NOT stored anywhere. Keep it in Bitwarden (DASH_ACCESS_CODE).');
})();
