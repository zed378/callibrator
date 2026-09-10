const path = require("path");
const { isPackaged } = require("./packaged.util");

function getAppRoot() {
  if (isPackaged) {
    return path.dirname(process.execPath);
  }

  return path.resolve(__dirname, "../../");
}

module.exports = (...paths) => path.join(getAppRoot(), ...paths);
