/**
 * A SYNTHETIC upstream dump (P24-06) — shaped like the `mysqldump` of the
 * upstream `skp_ipm` database (docs/UPSTREAM/03-DATABASE.md § 4: the same table
 * and column names and types, the dump's header, LOCK / UNLOCK, extended
 * INSERTs, a DELIMITER region) and filled with GENERATED values only. No real
 * upstream value appears here or in what it writes (CLAUDE.md, the privacy rule
 * of Phase 24): names are "Synthetic Facility 0001", e-mails end in
 * `.example`, hashes are a fixed marker.
 *
 * Deterministic: the same options give the same bytes. `expected` is what a
 * correct import of the dump stages, table by table — computed here from what
 * was written, so a test compares the import against the generator, never the
 * import against itself.
 */
import { gzipSync } from "zlib";

/** What the generator writes. */
export interface SyntheticDumpOptions {
  /** Health facilities (`mst_faskes`). */
  readonly facilities?: number;
  /** Devices (`trx_inventory`). */
  readonly devices?: number;
  /** Rows per extended INSERT (mysqldump's packet split). */
  readonly rowsPerInsert?: number;
  /** End the file inside a string (a truncated dump). */
  readonly truncate?: boolean;
}

/** One table's expected outcome. */
export interface ExpectedTable {
  readonly staged: boolean;
  readonly rowsLoaded: number;
  readonly rowsRejected: number;
  readonly rowsNotExtracted: number;
  readonly rejections: Readonly<Record<string, number>>;
  readonly notes: Readonly<Record<string, number>>;
  readonly reason: string | null;
}

/** The dump and what importing it must stage. */
export interface SyntheticDump {
  readonly sql: string;
  readonly expected: Readonly<Record<string, ExpectedTable>>;
  /** Strings that must never leave the import (a credential marker, a synthetic name, an e-mail). */
  readonly secrets: readonly string[];
}

/** A marker standing in for a password hash: it must never be staged. */
export const SYNTHETIC_HASH_MARKER = "$2y$10$SYNTHETICxHASHxMUSTxNEVERxBExSTAGEDxxxxxxxxxxxxxxxx";
/** A marker standing in for a login IP address (auth_logins is not extracted). */
export const SYNTHETIC_LOGIN_IP = "198.51.100.77";

const pad = (n: number, width = 4): string => String(n).padStart(width, "0");

/** A tiny deterministic PRNG (mulberry32). */
const prng = (seed: number): (() => number) => {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** A MariaDB string literal (mysqldump's escaping). */
export const sqlString = (value: string): string =>
  `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r")}'`;

const value = (v: string | number | null): string => (v === null ? "NULL" : typeof v === "number" ? String(v) : sqlString(v));

const table = (name: string, columns: readonly string[], keys: readonly string[] = ["PRIMARY KEY (`id`)"]): string =>
  [
    `DROP TABLE IF EXISTS \`${name}\`;`,
    "/*!40101 SET @saved_cs_client     = @@character_set_client */;",
    "/*!40101 SET character_set_client = utf8 */;",
    `CREATE TABLE \`${name}\` (`,
    [...columns, ...keys].map((c) => `  ${c}`).join(",\n"),
    ") ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;",
    "/*!40101 SET character_set_client = @saved_cs_client */;",
    "",
  ].join("\n");

const inserts = (name: string, rows: readonly (readonly (string | number | null)[])[], perInsert: number): string => {
  if (rows.length === 0) {
    return "";
  }
  const out = [`LOCK TABLES \`${name}\` WRITE;`, `/*!40000 ALTER TABLE \`${name}\` DISABLE KEYS */;`];
  for (let i = 0; i < rows.length; i += perInsert) {
    const tuples = rows.slice(i, i + perInsert).map((r) => `(${r.map(value).join(",")})`);
    out.push(`INSERT INTO \`${name}\` VALUES ${tuples.join(",")};`);
  }
  out.push(`/*!40000 ALTER TABLE \`${name}\` ENABLE KEYS */;`, "UNLOCK TABLES;", "");
  return out.join("\n");
};

const loaded = (rowsLoaded: number, extra: Partial<ExpectedTable> = {}): ExpectedTable => ({
  staged: true,
  rowsLoaded,
  rowsRejected: 0,
  rowsNotExtracted: 0,
  rejections: {},
  notes: {},
  reason: null,
  ...extra,
});

const notExtracted = (rows: number, reason: string): ExpectedTable => ({
  staged: false,
  rowsLoaded: 0,
  rowsRejected: 0,
  rowsNotExtracted: rows,
  rejections: {},
  notes: {},
  reason,
});

/** Generate the dump. */
export const syntheticUpstreamDump = (options: SyntheticDumpOptions = {}): SyntheticDump => {
  const facilities = options.facilities ?? 12;
  const devices = options.devices ?? 60;
  const per = options.rowsPerInsert ?? 25;
  const random = prng(20261007);
  const parts: string[] = [];
  const expected: Record<string, ExpectedTable> = {};

  parts.push(
    "/*M!999999\\- enable the sandbox mode */ ",
    "-- MariaDB dump 10.19-10.5.29-MariaDB, for debian-linux-gnu (x86_64)",
    "--",
    "-- Host: localhost    Database: skp_ipm_synthetic",
    "-- ------------------------------------------------------",
    "-- Server version\t10.5.29-MariaDB-ubu2004",
    "",
    "/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;",
    "/*!40101 SET NAMES utf8 */;",
    "/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;",
    "/*!40103 SET TIME_ZONE='+00:00' */;",
    "/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;",
    "/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;",
    "",
  );

  // users — the credential columns must never be staged (07 § 2.1).
  const userRows: (string | number | null)[][] = [];
  for (let i = 1; i <= 6; i++) {
    userRows.push([
      i,
      `synthetic.user.${pad(i)}@callibrator.example`,
      `synth_user_${pad(i)}`,
      i % 3 === 0 ? "" : `Synthetic User ${pad(i)}`,
      "default.svg",
      SYNTHETIC_HASH_MARKER,
      null,
      null,
      null,
      null,
      null,
      null,
      1,
      0,
      `2024-01-${pad(i, 2)} 08:00:00`,
      `2024-01-${pad(i, 2)} 08:00:00`,
      null,
    ]);
  }
  parts.push(
    table("users", [
      "`id` int(11) unsigned NOT NULL AUTO_INCREMENT",
      "`email` varchar(255) NOT NULL",
      "`username` varchar(30) DEFAULT NULL",
      "`fullname` varchar(50) DEFAULT NULL",
      "`user_image` varchar(255) NOT NULL DEFAULT 'default.svg'",
      "`password_hash` varchar(255) NOT NULL",
      "`reset_hash` varchar(255) DEFAULT NULL",
      "`reset_at` datetime DEFAULT NULL",
      "`reset_expires` datetime DEFAULT NULL",
      "`activate_hash` varchar(255) DEFAULT NULL",
      "`status` varchar(255) DEFAULT NULL",
      "`status_message` varchar(255) DEFAULT NULL",
      "`active` tinyint(1) NOT NULL DEFAULT 0",
      "`force_pass_reset` tinyint(1) NOT NULL DEFAULT 0",
      "`created_at` datetime DEFAULT NULL",
      "`updated_at` datetime DEFAULT NULL",
      "`deleted_at` datetime DEFAULT NULL",
    ], ["PRIMARY KEY (`id`)", "UNIQUE KEY `email` (`email`)", "UNIQUE KEY `username` (`username`)"]),
    inserts("users", userRows, per),
  );
  expected["users"] = loaded(userRows.length);

  // auth_groups / auth_groups_users — USE-ONLY, staged.
  const groups = [
    [1, "admin", "Administrators"],
    [2, "user", "Technicians"],
    [3, "client", "Facility staff"],
    [4, "teknisi_client", "Facility technicians"],
  ];
  parts.push(
    table("auth_groups", ["`id` int(11) unsigned NOT NULL AUTO_INCREMENT", "`name` varchar(255) NOT NULL", "`description` varchar(255) NOT NULL"]),
    inserts("auth_groups", groups, per),
    table("auth_groups_users", ["`group_id` int(11) unsigned NOT NULL DEFAULT 0", "`user_id` int(11) unsigned NOT NULL DEFAULT 0"], ["KEY `auth_groups_users_user_id_foreign` (`user_id`)"]),
    inserts("auth_groups_users", userRows.map((u, i) => [1 + (i % 4), u[0] as number]), per),
  );
  expected["auth_groups"] = loaded(groups.length);
  expected["auth_groups_users"] = loaded(userRows.length);

  // auth_logins — NOT MIGRATED: never staged.
  const logins: (string | number | null)[][] = [];
  for (let i = 1; i <= 9; i++) {
    logins.push([i, SYNTHETIC_LOGIN_IP, `synthetic.user.${pad(1 + (i % 6))}@callibrator.example`, 1 + (i % 6), `2025-02-0${String(1 + (i % 9))} 07:30:00`, 1]);
  }
  parts.push(
    table("auth_logins", [
      "`id` int(11) unsigned NOT NULL AUTO_INCREMENT",
      "`ip_address` varchar(255) DEFAULT NULL",
      "`email` varchar(255) DEFAULT NULL",
      "`user_id` int(11) unsigned DEFAULT NULL",
      "`date` datetime NOT NULL",
      "`success` tinyint(1) NOT NULL",
    ]),
    inserts("auth_logins", logins, per),
  );
  expected["auth_logins"] = notExtracted(logins.length, "not_migrated");

  // mst_faskes — with a zero date (a NULL, noted) and an escaped name.
  const faskes: (string | number | null)[][] = [];
  for (let i = 1; i <= facilities; i++) {
    faskes.push([
      i,
      i === 2 ? "Synthetic Facility 0002 \"North\" O'Neil\\Wing" : `Synthetic Facility ${pad(i)}`,
      i % 2 === 0 ? null : `+62 000 ${pad(i)}`,
      `Synthetic Street ${String(i)}, Synthetic City`,
      null,
      i === 1 ? "0000-00-00 00:00:00" : "2024-01-23 09:15:00",
      null,
    ]);
  }
  parts.push(
    table("mst_faskes", [
      "`id` int(11) unsigned NOT NULL AUTO_INCREMENT",
      "`name_faskes` varchar(255) NOT NULL",
      "`phone` varchar(50) DEFAULT NULL",
      "`address` varchar(255) DEFAULT NULL",
      "`img_logo` varchar(255) DEFAULT NULL",
      "`created_at` datetime DEFAULT NULL",
      "`updated_at` datetime DEFAULT NULL",
    ], ["KEY `id` (`id`)"]),
    inserts("mst_faskes", faskes, per),
  );
  expected["mst_faskes"] = loaded(faskes.length, { notes: { zero_date: 1 } });

  // mst_alat — device types.
  const types: (string | number | null)[][] = [];
  for (let i = 1; i <= 8; i++) {
    types.push([i, `Synthetic Device Type ${pad(i)}`, null, null]);
  }
  parts.push(
    table("mst_alat", ["`id` int(11) unsigned NOT NULL AUTO_INCREMENT", "`nama_alat` varchar(255) DEFAULT NULL", "`created_at` datetime DEFAULT NULL", "`updated_at` datetime DEFAULT NULL"], ["KEY `id` (`id`)"]),
    inserts("mst_alat", types, per),
  );
  expected["mst_alat"] = loaded(types.length);

  // trx_inventory — the register; one row with a value its column cannot hold (rejected).
  const inventory: (string | number | null)[][] = [];
  for (let i = 1; i <= devices; i++) {
    const condition = random() < 0.95 ? "Baik" : "Tidak Baik";
    inventory.push([
      i,
      1 + (i % facilities),
      1 + (i % types.length),
      1 + (i % 6),
      `SYN-QR-${pad(i, 6)}`,
      `Synthetic Device ${pad(i, 5)}`,
      `SynthBrand ${String(1 + (i % 7))}`,
      `SM-${String(100 + (i % 50))}`,
      i % 17 === 0 ? "-" : `SN-SYN-${pad(i, 6)}`,
      `Synthetic Room ${String(1 + (i % 9))}`,
      String(1 + (i % 4)),
      condition,
      i % 11 === 0 ? "Tidak" : "Ada",
      "Synthetic Lab",
      `https://synthetic.example/uploads/foto_depan/syn-${pad(i, 6)}.jpg`,
      `https://synthetic.example/uploads/foto_sn/syn-${pad(i, 6)}.jpg`,
      i === 3 ? "2024-02-30" : `2024-${pad(1 + (i % 12), 2)}-${pad(1 + (i % 28), 2)}`,
      i % 5 === 0 ? null : "2025-06-15",
      null,
      null,
    ]);
  }
  parts.push(
    table("trx_inventory", [
      "`id` int(11) unsigned NOT NULL AUTO_INCREMENT",
      "`id_client` int(11) unsigned NOT NULL",
      "`id_alat` int(11) unsigned NOT NULL",
      "`id_user` int(10) DEFAULT NULL",
      "`no_qrcode` varchar(255) NOT NULL",
      "`nama_alat` varchar(255) DEFAULT NULL",
      "`merk` varchar(255) DEFAULT NULL",
      "`type` varchar(255) DEFAULT NULL",
      "`sn` varchar(255) DEFAULT NULL",
      "`nama_ruangan` varchar(255) DEFAULT NULL",
      "`lantai` varchar(255) DEFAULT NULL",
      "`kondisi_alat` varchar(255) DEFAULT NULL",
      "`aksesoris` varchar(5) DEFAULT NULL",
      "`lab_kalibrasi` varchar(255) DEFAULT NULL",
      "`foto_depan` varchar(255) DEFAULT NULL",
      "`foto_sn` varchar(255) DEFAULT NULL",
      "`tgl_inventory` date DEFAULT NULL",
      "`tgl_kalibrasi` date DEFAULT NULL",
      "`created_at` datetime DEFAULT NULL",
      "`updated_at` datetime DEFAULT NULL",
    ], ["UNIQUE KEY `no_qrcode` (`no_qrcode`)", "KEY `id_client` (`id_client`)"]),
    inserts("trx_inventory", inventory, per),
  );
  // Row 3's tgl_inventory is 2024-02-30: not a calendar date — rejected, counted.
  expected["trx_inventory"] = loaded(devices - (devices >= 3 ? 1 : 0), devices >= 3 ? { rowsRejected: 1, rejections: { invalid_date: 1 } } : {});

  // trx_catatan — a free-text note per session, with a newline and a tab.
  const notes: (string | number | null)[][] = [];
  for (let i = 1; i <= Math.min(devices, 20); i++) {
    notes.push([i, 1 + (i % facilities), 1 + (i % 6), 1 + (i % types.length), `SYN-QR-${pad(i, 6)}`, i % 4 === 0 ? "Synthetic note line 1\nline 2\twith a tab" : "", `2025-03-${pad(1 + (i % 28), 2)} 10:00:00`, null]);
  }
  parts.push(
    table("trx_catatan", [
      "`id` int(11) unsigned NOT NULL AUTO_INCREMENT",
      "`id_client` int(11) DEFAULT NULL",
      "`id_user` int(11) DEFAULT NULL",
      "`id_alat` int(11) DEFAULT NULL",
      "`no_qrcode` varchar(45) DEFAULT NULL",
      "`description` text DEFAULT NULL",
      "`created_at` datetime DEFAULT NULL",
      "`updated_at` datetime DEFAULT NULL",
    ]),
    inserts("trx_catatan", notes, per),
  );
  expected["trx_catatan"] = loaded(notes.length);

  // migrations — NOT MIGRATED.
  parts.push(
    table("migrations", ["`id` bigint(20) unsigned NOT NULL AUTO_INCREMENT", "`version` varchar(255) NOT NULL", "`class` varchar(255) NOT NULL"]),
    inserts("migrations", [[1, "2025-01-21-000000", "App\\Database\\Migrations\\TrxKalibrasi"]], per),
  );
  expected["migrations"] = notExtracted(1, "not_migrated");

  // A trigger in a DELIMITER region: discarded whole, never executed — its INSERT is not a row.
  parts.push(
    "DELIMITER ;;",
    "CREATE TRIGGER `synthetic_trigger` BEFORE INSERT ON `trx_catatan` FOR EACH ROW BEGIN",
    "  INSERT INTO `mst_alat` VALUES (999,'Injected Type',NULL,NULL);",
    "END ;;",
    "DELIMITER ;",
    "",
  );

  // A table no policy names: counted, never staged.
  parts.push(
    table("synthetic_unknown_table", ["`id` int(11) NOT NULL", "`payload` varchar(64) DEFAULT NULL"]),
    inserts("synthetic_unknown_table", [[1, "Synthetic payload"]], per),
  );
  expected["synthetic_unknown_table"] = notExtracted(1, "not_in_policy");

  parts.push(
    "/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;",
    "/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;",
    "",
    "-- Dump completed on 2026-10-07  1:23:45",
    "",
  );
  let sql = parts.join("\n");
  if (options.truncate === true) {
    sql = `${sql}INSERT INTO \`mst_alat\` VALUES (9998,'Synthetic unterminated`;
  }
  return {
    sql,
    expected,
    secrets: [SYNTHETIC_HASH_MARKER, SYNTHETIC_LOGIN_IP, "Synthetic Facility 0003", "synthetic.user.0001@callibrator.example", "Synthetic Device 00007"],
  };
};

/** The dump, gzip-compressed. */
export const gzipped = (sql: string): Buffer => gzipSync(Buffer.from(sql, "utf8"));
