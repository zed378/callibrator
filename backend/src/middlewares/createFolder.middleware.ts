// P9-19 (ADR-087): converted from createFolder.middleware.js with no behaviour
// change. `fs` and `path` are the module objects themselves (default imports),
// so `fs.existsSync` is read at call time as before; the logger and
// `isPackaged` are captured at load, as the .js destructured them.
import fs from "fs";
import path from "path";

import storagePath from "../utils/storagePath.util";
import { logger as activityLogger } from "./activityLog.middleware";
import { isPackaged as packagedIsPackaged } from "../utils/packaged.util";

const logger = activityLogger;
const isPackaged = packagedIsPackaged;

// Root Directory
const rootDir = storagePath();

// Folder Definitions
const folders = [
  // Backup
  path.join(rootDir, "backup"),

  // Logs
  path.join(rootDir, "log"),
  path.join(rootDir, "log/access"),
  path.join(rootDir, "log/activity"),
  path.join(rootDir, "log/activity/combined"),
  path.join(rootDir, "log/activity/error"),
  path.join(rootDir, "log/activity/exception"),
  path.join(rootDir, "log/activity/rejection"),

  // Uploads
  path.join(rootDir, "uploads"),
  path.join(rootDir, "uploads/public/tenant"),
  path.join(rootDir, "uploads/public/profile"),
  path.join(rootDir, "uploads/public/cms"),
  path.join(rootDir, "uploads/attachments"),
  path.join(rootDir, "uploads/certificates"),

  // P8-01 (ADR-086 Amendment 1): the local storage driver's default root
  // (STORAGE_LOCAL_ROOT unset), where every stored file now lives. The driver
  // refuses a write under a root that does not exist — it cannot tell a
  // missing local directory from an unmounted NFS export — so the boot makes
  // the local one, as it makes the folders above.
  path.join(rootDir, "storage"),
];

// Only create data folders during development
if (!isPackaged) {
  folders.push(
    // Data
    path.join(rootDir, "data"),
    path.join(rootDir, "data/pgadmin"),
    path.join(rootDir, "data/postgres"),
  );
}

// Ensure Folders Exist
export const ensureFolderExisted = (): void => {
  try {
    for (const folder of folders) {
      if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, {
          recursive: true,
        });

        logger.info(`[FOLDER CREATED] ${folder}`);
      }
    }
  } catch (error) {
    // As built: the message of whatever was thrown, interpolated as the .js did
    // (undefined for a non-Error; a thrown null still throws here).
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: `${error.message}`
    logger.error(`Failed to initialize folders: ${(error as { message?: string }).message}`);

    process.exit(1);
  }
};
