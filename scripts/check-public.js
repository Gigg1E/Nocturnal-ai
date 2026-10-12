// Inspect staged content without printing matching values. This is a basic guard,
// not a substitute for reviewing the diff or auditing already-published history.
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const git = async (...args) => (await run('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })).stdout;
async function main() {
const files = (await git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z')).split('\0').filter(Boolean);
const forbidden = /(^|\/)(?:data|logs|\.aws|\.codex|\.agents)\/|(^|\/)\.env(?:\..*)?$|\.(?:pem|key|db|db-shm|db-wal)$/i;
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/,
  /\b[A-Za-z0-9_-]{24,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/,
];
let failed = false;
for (const file of files) {
  if (file !== '.env.example' && forbidden.test(file)) {
    console.error('Private file staged (path withheld).'); failed = true; continue;
  }
  const content = await git('show', `:${file}`);
  if (patterns.some(pattern => pattern.test(content))) {
    console.error('Possible credential staged (value and path withheld).'); failed = true;
  }
}
if (failed) process.exitCode = 1;
else console.log(`Checked ${files.length} staged file(s); no basic credential patterns or private paths found. Review the staged diff before publishing.`);

}
main().catch(() => { console.error('Public check could not read staged content; publishing check failed.'); process.exitCode = 1; });
