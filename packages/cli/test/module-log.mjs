// Preloaded (`node --import`) by cli.test.ts: on exit, prints to stderr every module the process resolved, so a
// test can check what a command loads.
import { registerHooks } from "node:module";

const urls = [];
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    urls.push(result.url);
    return result;
  },
});
process.on("exit", () => process.stderr.write(`modules ${JSON.stringify(urls)}\n`));
