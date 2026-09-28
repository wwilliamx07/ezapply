// Stands in for `claude` in the chat tests: records how it was started, then runs until killed.
// With STUB_EXIT_ON=n, the nth start exits by itself (code 3) instead.
import { appendFileSync, readFileSync } from "node:fs";

const log = process.env.STUB_LOG;
appendFileSync(
  log,
  `${JSON.stringify({ pid: process.pid, session: process.env.EZAPPLY_CHAT_SESSION, args: process.argv.slice(2) })}\n`,
);
const starts = readFileSync(log, "utf8").trim().split("\n").length;
if (Number(process.env.STUB_EXIT_ON) === starts) setTimeout(() => process.exit(3), 50);
else setInterval(() => {}, 1000);
