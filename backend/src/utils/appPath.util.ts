// P9-05a (ADR-087): converted from appPath.util.js with no behaviour change.
// `export =` keeps the module's shape: `require()` returns the function itself,
// as before. `isPackaged` is read once, at load, as the destructuring
// `require` did.
import * as path from "path";
import { isPackaged } from "./packaged.util";

const packagedAtLoad = isPackaged;

function getAppRoot(): string {
  if (packagedAtLoad) {
    return path.dirname(process.execPath);
  }

  return path.resolve(__dirname, "../../");
}

const appPath = (...paths: string[]): string => path.join(getAppRoot(), ...paths);

export = appPath;
