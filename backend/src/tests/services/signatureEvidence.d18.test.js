/**
 * D-18 — signature evidence is never hard-deleted by the application.
 *
 * Two layers hold it:
 *  - the database: every foreign key INTO a signature record's parents is
 *    ON DELETE RESTRICT (0030, 0037, and 0066 for workflow_step_id — proven
 *    on PostgreSQL in dataLayer.dbB.live.test.js), so a hard delete of a
 *    workflow, step, signer or tenant is REFUSED rather than cascading;
 *  - the application: signature workflows and steps are paranoid and the
 *    service soft-deletes them; a workflow with any signature is refused with
 *    a 409 that names its state (eSignature.service#deleteWorkflow, A-130 —
 *    tests/services/esignature.*). This file pins the part a well-meant edit
 *    would break: no `force: true` destroy, and no bulk destroy, of any of
 *    the three signature models anywhere in backend/src.
 */

const fs = require("fs");
const path = require("path");

const espree = require(
  require.resolve("espree", { paths: [path.dirname(require.resolve("eslint/package.json"))] }),
);

const SRC = path.join(__dirname, "..", "..");
const SIGNATURE_MODELS = /^(SignatureWorkflow|SignatureWorkflowStep|SignatureRecord)s?$/;

const keyOf = (p) =>
  p.type === "Property" ? (p.key.type === "Identifier" ? p.key.name : p.key.value) : null;
const hasForce = (arg) =>
  arg && arg.type === "ObjectExpression" &&
  arg.properties.some((p) => keyOf(p) === "force" && !(p.value.type === "Literal" && p.value.value === false));

/**
 * In a file that touches a signature model: every `<Model>.destroy(...)` on a
 * signature model (a bulk delete), and every `x.destroy({ force })` at all.
 */
const scan = (source) => {
  const ast = espree.parse(source, { ecmaVersion: "latest", sourceType: "script", loc: true });
  const found = [];
  const visit = (node) => {
    if (!node || typeof node.type !== "string") {return;}
    if (
      node.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      !node.callee.computed &&
      node.callee.property.name === "destroy"
    ) {
      const object = node.callee.object;
      const name = object.type === "Identifier" ? object.name :
        object.type === "MemberExpression" && !object.computed ? object.property.name : "";
      if (SIGNATURE_MODELS.test(name)) {
        found.push({ line: node.loc.start.line, what: `${name}.destroy (bulk)` });
      } else if (hasForce(node.arguments[0])) {
        found.push({ line: node.loc.start.line, what: `${name}.destroy({ force })` });
      }
    }
    for (const [k, child] of Object.entries(node)) {
      if (k === "loc") {continue;}
      if (Array.isArray(child)) {child.forEach(visit);}
      else if (child && typeof child.type === "string") {visit(child);}
    }
  };
  visit(ast);
  return found;
};

const filesTouchingSignatures = () => {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        if (!["tests", "migrations", "models"].includes(name)) {walk(full);}
      } else if (name.endsWith(".js")) {
        const text = fs.readFileSync(full, "utf8");
        if (/\bSignature(Workflow|WorkflowStep|Record)s?\b/.test(text)) {out.push([full, text]);}
      }
    }
  };
  walk(SRC);
  return out;
};

describe("D-18 — no hard delete of signature evidence", () => {
  it("the scanner bites", () => {
    // Inside an async function: the scanner parses as a CommonJS script, where
    // a top-level await is a syntax error.
    const found = scan(`async function sample() {
      await workflow.destroy({ transaction });
      await workflow.destroy({ transaction, force: true });   // 3
      await SignatureRecord.destroy({ where: { workflowId } }); // 4
      await step.destroy({ force: false });
    }`);
    expect(found.map((f) => f.line)).toEqual([3, 4]);
  });

  it("scans the files that use the signature models (eSignature.service among them)", () => {
    const files = filesTouchingSignatures().map(([f]) => path.relative(SRC, f));
    expect(files).toContain(path.join("services", "eSignature.service.js"));
  });

  it("no force: true destroy and no bulk destroy of SignatureWorkflow / SignatureWorkflowStep / SignatureRecord", () => {
    const offenders = [];
    for (const [file, text] of filesTouchingSignatures()) {
      for (const f of scan(text)) {offenders.push(`${path.relative(SRC, file)}:${f.line} ${f.what}`);}
    }
    expect(offenders).toEqual([]);
  });
});
