/** Tiny scoped console logger shared by the voice-agent scripts and the estimate server. */

const tty = process.stdout.isTTY === true;
const paint = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const C = {
  dim: paint("2"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  blue: paint("34"),
  cyan: paint("36"),
  gray: paint("90"),
};

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}

export function createLogger(scope: string) {
  const prefix = C.cyan(`[${scope}]`);
  const head = () => `${C.gray(ts())} ${prefix}`;
  return {
    info(msg: string, ...rest: unknown[]) {
      console.log(`${head()} ${msg}`, ...rest);
    },
    ok(msg: string, ...rest: unknown[]) {
      console.log(`${head()} ${C.green("✓")} ${msg}`, ...rest);
    },
    warn(msg: string, ...rest: unknown[]) {
      console.warn(`${head()} ${C.yellow("!")} ${msg}`, ...rest);
    },
    error(msg: string, ...rest: unknown[]) {
      console.error(`${head()} ${C.red("✗")} ${msg}`, ...rest);
    },
    step(msg: string) {
      console.log(`${head()} ${C.blue("→")} ${msg}`);
    },
    dim(msg: string) {
      console.log(`${head()} ${C.dim(msg)}`);
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
