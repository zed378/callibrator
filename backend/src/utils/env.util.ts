// P9-09 (ADR-087): converted from env.util.js with no behaviour change. A
// side-effect module: loading it runs dotenv once; it exports nothing.
import { dirname, join, resolve } from "path";

import { config } from "dotenv";
import { isPackaged } from "./packaged.util";

// Development
if (!isPackaged) {
  config({
    path: resolve(__dirname, "../../.env"),

    quiet: true,
  });
}

// Packaged EXE
else {
  config({
    path: join(dirname(process.execPath), ".env"),

    quiet: true,
  });
}
