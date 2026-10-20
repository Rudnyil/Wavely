import path from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { hashPassword, validatePassword, validateUsername } from './auth.js';
import { now } from './util.js';

const [, , command, ...args] = process.argv;

function usage() {
  console.log(`Usage:
  npm run create-admin -- <username> [password]
      Creates an administrator, or promotes/resets an existing user.
      The password can also be passed in the WAVELY_PASSWORD environment variable
      (preferred: command-line arguments are visible to other users of the machine).`);
}

if (command !== 'create-admin') {
  usage();
  process.exit(command ? 1 : 0);
}

const [username, passwordArg] = args;
const password = process.env.WAVELY_PASSWORD || passwordArg;
if (!username || !validateUsername(username) || !validatePassword(password)) {
  console.error('Username must be 3-24 letters/digits/underscore; password 8-200 characters.');
  usage();
  process.exit(1);
}

const config = loadConfig();
const db = openDb(path.join(config.dataDir, 'wavely.db'));
const hash = await hashPassword(password);
const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (existing) {
  db.prepare("UPDATE users SET role = 'admin', disabled = 0, password_hash = ? WHERE id = ?").run(hash, existing.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
  console.log(`User "${username}" is now an administrator and the password was updated.`);
} else {
  db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,'admin',?)")
    .run(username, username, hash, now());
  console.log(`Administrator "${username}" created.`);
}
db.close();
