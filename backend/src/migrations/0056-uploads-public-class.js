"use strict";

/**
 * S-01 / ADR-042 steps 3–4 — move what is PUBLIC into `uploads/public/`, and
 * stop storing URLs that pointed at the retired static mount.
 *
 * Before this change `/uploads` was ONE unauthenticated express.static mount
 * over the whole uploads tree. Now only `uploads/public/` is served (avatars,
 * tenant logos, CMS images); certificates and attachments stay where they are
 * on disk and are reached only through gated routes. So:
 *
 *  1. FILES. `uploads/profile/*` -> `uploads/public/profile/*` and
 *     `uploads/tenant/*` -> `uploads/public/tenant/*`. `users.avatar` and
 *     `tenants.logo` store bare filenames, so no row changes. A file already
 *     at its destination with the SAME bytes is simply removed from the old
 *     place; with DIFFERENT bytes the migration refuses, naming the file —
 *     it will not guess which one is the tenant's.
 *     SVG logos move too, but the public mount refuses SVG (ADR-042 step 3):
 *     such a tenant shows no logo until it uploads a raster one. They are
 *     counted in the log line so an operator can tell them.
 *  2. CERTIFICATES. `certificates.file_path` was `/uploads/certificates/<f>`,
 *     a URL on the old mount; it becomes the storage locator
 *     `certificates/<f>` (the file does not move — only its basename is ever
 *     read). Raw SQL across all tenants on purpose: this is a platform-wide
 *     data migration, not a request, and there is no tenant context to scope
 *     it by.
 *  3. CMS. Published posts embedded attachment URLs
 *     (`/uploads/attachments/<f>`) in `content_html`, `cover_image_url` and
 *     `author_avatar_url` — those stop resolving when attachments leave the
 *     mount. Each referenced file whose extension is in the public image
 *     allowlist is COPIED to `uploads/public/cms/<f>` (the attachment row and
 *     its file are left alone: an attachment may also be evidence) and the
 *     reference rewritten to `/uploads/public/cms/<f>`. A reference that
 *     cannot be carried over (not an allowlisted image, or its file is gone)
 *     is left as it is and counted in the log line. `posts` is
 *     platform-global content (no tenant_id).
 *
 * The reference deployment had zero certificates and zero attachments when
 * this was written (2026-09-23), so there it moves avatars/logos at most.
 *
 * Idempotent: a second run finds no source files, no `/uploads/certificates/`
 * path and no `/uploads/attachments/` reference, and changes nothing. The SQL
 * runs in one transaction. No try/catch: every failure propagates, so Umzug
 * cannot record this as applied while it did nothing (0008/0013/0014).
 *
 * Verify with psql and ls, not the log:
 *   SELECT count(*) FROM certificates WHERE file_path LIKE '/uploads/%';   -- 0
 *   SELECT count(*) FROM posts WHERE content_html LIKE '%/uploads/attachments/%'
 *     OR cover_image_url LIKE '%/uploads/attachments/%'
 *     OR author_avatar_url LIKE '%/uploads/attachments/%';                -- 0
 *   ls <storage>/uploads/profile <storage>/uploads/tenant                  -- empty
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const storagePath = require("../utils/storagePath.util");

const FILE_MOVES = [
  ["uploads/profile", "uploads/public/profile"],
  ["uploads/tenant", "uploads/public/tenant"],
];
const CMS_FOLDER = "uploads/public/cms";
const PUBLIC_IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
const POST_COLUMNS = ["content_html", "cover_image_url", "author_avatar_url"];
const ATTACHMENT_REF = /\/uploads\/attachments\/([A-Za-z0-9][A-Za-z0-9._-]*)/g;

const abs = (rel) => storagePath(...rel.split("/"));
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/**
 * Move every regular, non-dot file from one folder to another. Returns the
 * names moved (or de-duplicated). Throws on a conflicting destination.
 */
const moveFolderContents = (fromRel, toRel) => {
  const from = abs(fromRel);
  if (!fs.existsSync(from)) {return [];}
  const to = abs(toRel);
  fs.mkdirSync(to, { recursive: true });
  const moved = [];
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith(".")) {continue;}
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (fs.existsSync(dest)) {
      if (sha256(src) !== sha256(dest)) {
        throw new Error(
          `Migration 0056 refused: ${toRel}/${entry.name} already exists with different content ` +
            `from ${fromRel}/${entry.name}. Decide which is current, remove the other, and re-run.`,
        );
      }
      fs.unlinkSync(src);
    } else {
      fs.renameSync(src, dest);
    }
    moved.push(entry.name);
  }
  return moved;
};

/**
 * Carry a post field's attachment references over to the public CMS folder.
 * Returns the rewritten text and what could not be carried.
 */
const carryCmsReferences = (text) => {
  let skipped = 0;
  const rewritten = String(text).replace(ATTACHMENT_REF, (match, name) => {
    const src = path.join(abs("uploads/attachments"), name);
    if (!PUBLIC_IMAGE_EXTS.includes(path.extname(name).toLowerCase()) || !fs.existsSync(src)) {
      skipped += 1;
      return match;
    }
    const dest = path.join(abs(CMS_FOLDER), name);
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(abs(CMS_FOLDER), { recursive: true });
      fs.copyFileSync(src, dest);
    }
    return `/${CMS_FOLDER}/${name}`;
  });
  return { rewritten, skipped };
};

const tableNames = async (queryInterface, transaction) =>
  (await queryInterface.showAllTables({ transaction })).map((t) =>
    (typeof t === "object" ? t.tableName : t).toLowerCase(),
  );

module.exports = {
  async up({ context: queryInterface }) {
    const movedCounts = FILE_MOVES.map(([from, to]) => moveFolderContents(from, to));
    const svgLogos = movedCounts[1].filter((n) => n.toLowerCase().endsWith(".svg")).length;

    const { sequelize } = queryInterface;
    const summary = await sequelize.transaction(async (transaction) => {
      const tables = await tableNames(queryInterface, transaction);
      let certificates = 0;
      let posts = 0;
      let uncarried = 0;

      if (tables.includes("certificates")) {
        const [, meta] = await sequelize.query(
          "UPDATE certificates SET file_path = 'certificates/' || substring(file_path FROM '^/uploads/certificates/(.+)$') WHERE file_path LIKE '/uploads/certificates/%'",
          { transaction },
        );
        certificates = (meta && meta.rowCount) || 0;
      }

      if (tables.includes("posts")) {
        const [rows] = await sequelize.query(
          `SELECT id, ${POST_COLUMNS.join(", ")} FROM posts WHERE ${POST_COLUMNS.map(
            (c) => `${c} LIKE '%/uploads/attachments/%'`,
          ).join(" OR ")}`,
          { transaction },
        );
        for (const row of rows) {
          const changes = {};
          for (const column of POST_COLUMNS) {
            if (row[column] === null || row[column] === undefined) {continue;}
            const { rewritten, skipped } = carryCmsReferences(row[column]);
            uncarried += skipped;
            if (rewritten !== row[column]) {changes[column] = rewritten;}
          }
          const columns = Object.keys(changes);
          if (columns.length === 0) {continue;}
          await sequelize.query(
            `UPDATE posts SET ${columns.map((c) => `${c} = :${c}`).join(", ")} WHERE id = :id`,
            { transaction, replacements: { ...changes, id: row.id } },
          );
          posts += 1;
        }
      }
      return { certificates, posts, uncarried };
    });

    console.log(
      `[0056] public class: moved ${movedCounts[0].length} avatar(s), ${movedCounts[1].length} logo(s)` +
        ` (${svgLogos} SVG — no longer served; re-upload as PNG/JPEG/WebP);` +
        ` ${summary.certificates} certificate path(s) rewritten;` +
        ` ${summary.posts} post(s) rewritten, ${summary.uncarried} reference(s) left (not an image or file missing)`,
    );
  },

  async down({ context: queryInterface }) {
    // Back to the pre-ADR-042 shape, for the pre-ADR-042 code: that code
    // served the WHOLE uploads tree, so `/uploads/public/cms/...` references
    // keep resolving under it and are left as they are (as are the copies).
    // Certificate paths go back to the URL shape its verification endpoint
    // published, and avatars/logos back to the folders it built URLs from.
    const { sequelize } = queryInterface;
    await sequelize.transaction(async (transaction) => {
      const tables = await tableNames(queryInterface, transaction);
      if (tables.includes("certificates")) {
        await sequelize.query(
          "UPDATE certificates SET file_path = '/uploads/' || file_path WHERE file_path LIKE 'certificates/%'",
          { transaction },
        );
      }
    });
    for (const [from, to] of FILE_MOVES) {moveFolderContents(to, from);}
  },

  // Exported for tests.
  _moveFolderContents: moveFolderContents,
  _carryCmsReferences: carryCmsReferences,
};
