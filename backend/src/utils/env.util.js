const path = require("path");

const dotenv = require("dotenv");
const { isPackaged } = require("./packaged.util");

// Development
if (!isPackaged) {
  dotenv.config({
    path: path.resolve(__dirname, "../../.env"),

    quiet: true,
  });
}

// Packaged EXE
else {
  dotenv.config({
    path: path.join(path.dirname(process.execPath), ".env"),

    quiet: true,
  });
}
