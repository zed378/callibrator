const fs = require("fs");
const path = require("path");

const storagePath = require("../utils/storagePath.util");
const { logger } = require("./activityLog.middleware");
const { isPackaged } = require("../utils/packaged.util");

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
  path.join(rootDir, "uploads/tenant"),
  path.join(rootDir, "uploads/profile"),
  path.join(rootDir, "uploads/attachments"),
  path.join(rootDir, "uploads/certificates"),
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
exports.ensureFolderExisted = () => {
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
    logger.error(`Failed to initialize folders: ${error.message}`);

    process.exit(1);
  }
};
