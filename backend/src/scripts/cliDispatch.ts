/**
 * P10-16 (ADR-099) — the compiled backend's subcommands.
 *
 * The runtime image has no Node: the pkg binary is the only thing that can run
 * code inside the container. `./backend <command> …` runs the command and exits
 * instead of starting the server (index.js). Only the commands listed here are
 * recognised; anything else (no argument, an unknown one) starts the server as
 * before, so a flag some tool passes cannot turn the server into a CLI.
 */
type Command = (args: readonly string[]) => Promise<number>;

const COMMANDS: Readonly<Record<string, () => Command>> = Object.freeze({
  // Loaded only when asked for: the server never loads the CLI.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: loaded only for this command
  "rotate-bootstrap-password": () => (require("./rotateBootstrapPassword") as { main: Command }).main,
});

/** The recognised command in `argv` (process.argv), or null. */
const cliCommandFrom = (argv: readonly string[]): string | null => {
  const candidate = argv[2];
  return candidate !== undefined && Object.prototype.hasOwnProperty.call(COMMANDS, candidate) ? candidate : null;
};

/** Run the command `argv` names; resolves with the exit code (2: none recognised). */
const runCliCommand = async (argv: readonly string[]): Promise<number> => {
  const name = cliCommandFrom(argv);
  const load = name === null ? undefined : COMMANDS[name];
  if (!load) {
    return 2;
  }
  return load()(argv.slice(3));
};

export { cliCommandFrom, runCliCommand };
