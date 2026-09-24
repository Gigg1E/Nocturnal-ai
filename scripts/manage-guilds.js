// Operator CLI for the guild allowlist.
// Usage:
//   node scripts/manage-guilds.js list
//   node scripts/manage-guilds.js add <guildId> "<name>"
//   node scripts/manage-guilds.js remove <guildId>
const fs = require('fs');
const path = require('path');

const ALLOWLIST_PATH = path.join(__dirname, '..', 'data', 'guilds.json');

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
    return Array.isArray(data.guilds) ? data.guilds : [];
  } catch {
    return [];
  }
}

function save(guilds) {
  fs.writeFileSync(ALLOWLIST_PATH, JSON.stringify({ guilds }, null, 2));
}

const [, , cmd, arg1, arg2] = process.argv;

if (cmd === 'list') {
  const guilds = load();
  if (!guilds.length) {
    console.log('No guilds in the allowlist.');
  } else {
    guilds.forEach(g => console.log(`${g.id}  ${g.name}`));
  }
} else if (cmd === 'add') {
  if (!arg1) {
    console.error('Usage: node scripts/manage-guilds.js add <guildId> "<name>"');
    process.exit(1);
  }
  const guilds = load();
  if (guilds.some(g => g.id === arg1)) {
    console.log(`${arg1} is already in the allowlist.`);
  } else {
    guilds.push({ id: arg1, name: arg2 || '(unnamed)' });
    save(guilds);
    console.log(`Added ${arg1} (${arg2 || '(unnamed)'}).`);
  }
  console.log('Restart the bot (pm2 restart NETai) to register commands there and pick up the invite if it joined while unlisted.');
} else if (cmd === 'remove') {
  if (!arg1) {
    console.error('Usage: node scripts/manage-guilds.js remove <guildId>');
    process.exit(1);
  }
  const guilds = load();
  const next = guilds.filter(g => g.id !== arg1);
  if (next.length === guilds.length) {
    console.log(`${arg1} was not in the allowlist.`);
  } else {
    save(next);
    console.log(`Removed ${arg1}. Restart the bot (pm2 restart NETai) to have it leave automatically.`);
  }
} else {
  console.log('Usage:\n  node scripts/manage-guilds.js list\n  node scripts/manage-guilds.js add <guildId> "<name>"\n  node scripts/manage-guilds.js remove <guildId>');
}
