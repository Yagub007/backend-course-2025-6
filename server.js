import { program } from "commander";

program
  .requiredOption("--host <host>", "Server host")
  .requiredOption("--port <port>", "Server port")
  .requiredOption("--cache <dir>", "Cache directory");

program.parse(process.argv);

const options = program.opts();
console.log("CLI arguments:", options);
