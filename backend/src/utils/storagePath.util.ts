// P9-05a (ADR-087): converted from storagePath.util.js with no behaviour change.
// `export =` keeps the module's shape: `require()` returns the function itself,
// as before. The storage root is computed once, at load, as before.
import * as path from "path";
import { isPackaged } from "./packaged.util";
import { envOr } from "../config/env";

// An EMPTY APP_STORAGE_PATH has always meant "unset" (envOr: unset or "" -> fallback).
const packagedRoot = (): string => envOr("APP_STORAGE_PATH", path.join(path.dirname(process.execPath), "storage"));

const storageRoot: string = isPackaged ? packagedRoot() : path.resolve(__dirname, "../../");

const storagePath = (...paths: string[]): string => path.join(storageRoot, ...paths);

export = storagePath;
