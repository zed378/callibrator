const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");

const idxPath = path.join(root, "MEMORY", "MEMORY-INDEX.md");
let idx = fs.readFileSync(idxPath, "utf8");
const X = " \u00d7 ";
const l22 = `| 2026-10-24 | P9-26 | [Batch 22: billing, session, tenantLifecycle validators](./records/2026-10-24-p9-26-batch-22.md) | **DONE.** 3${X}\`.js\` to \`.ts\`, same 27 cases, eslint + typecheck clean, ratchet 637 to 634 |`;
const l21 = `| 2026-10-24 | P9-26 | [Batch 21: storage.route, roles.route, notification.validator](./records/2026-10-24-p9-26-batch-21.md) | **DONE.** 3${X}\`.js\` to \`.ts\`, same 17 cases, eslint + typecheck clean, ratchet 640 to 637 |`;
const l20 = `| 2026-10-24 | P9-26 | [Batch 20: dbRole.p603, publicBaseUrl.a189, maxFileSize.p701](./records/2026-10-24-p9-26-batch-20.md) | **DONE.** 3${X}\`.js\` to \`.ts\`, same 37 cases, eslint + typecheck clean, ratchet 643 to 640 |`;
const anchor = "|---|---|---|---|";
if (!idx.includes("batch-22") && idx.includes(l21.slice(0, 40))) {
    idx = idx.replace(anchor + "\n", anchor + "\n" + l22 + "\n");
    fs.writeFileSync(idxPath, idx);
    console.log("index: batch-22 line added (20/21 already present)");
} else if (!idx.includes("batch-22")) {
    idx = idx.replace(anchor + "\n", anchor + "\n" + l22 + "\n" + l21 + "\n" + l20 + "\n");
    fs.writeFileSync(idxPath, idx);
    console.log("index: batch-20/21/22 lines added");
} else {
    console.log("index: already has batch-22, no change");
}

const clPath = path.join(root, "MEMORY", "CHANGELOG.md");
let cl = fs.readFileSync(clPath, "utf8");
const entry =
    `### 2026-10-24 \u2014 P9-26 batch 22: billing, session, tenantLifecycle validators to TypeScript ([record](./records/2026-10-24-p9-26-batch-22.md))\n` +
    `- **DONE:** 3${X}\`.js\` to \`.ts\`, same 27 cases, eslint + typecheck clean, ratchet 637 to 634.\n\n`;
if (!cl.includes("batch-22")) {
    const marker =
        "### 2026-10-24 \u2014 P9-26 batch 21: storage.route, roles.route, notification.validator to TypeScript";
    if (cl.includes(marker)) {
        cl = cl.replace(marker, entry + marker);
        fs.writeFileSync(clPath, cl);
        console.log("changelog: batch-22 entry added before batch-21");
    } else {
        console.log("changelog: batch-21 marker NOT found, no change");
    }
} else {
    console.log("changelog: already has batch-22, no change");
}
