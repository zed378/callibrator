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

import * as fs from "fs";
import * as path from "path";
import type * as TsEstreeModule from "@typescript-eslint/typescript-estree";

interface EspreeModule {
  parse(source: string, options: { ecmaVersion: string; sourceType: string; loc: boolean }): unknown;
}

const espreePath = require.resolve("espree", {
  paths: [path.dirname(require.resolve("eslint/package.json"))],
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const espree = require(espreePath) as EspreeModule;
const tsEstree = jest.requireActual<typeof TsEstreeModule>("@typescript-eslint/typescript-estree");

const SRC = path.join(__dirname, "..", "..");
const SIGNATURE_MODELS = /^(SignatureWorkflow|SignatureWorkflowStep|SignatureRecord)s?$/;

interface AstNode {
  type: string;
  loc?: { start: { line: number } };
  callee?: AstNode;
  object?: AstNode;
  property?: AstNode;
  arguments?: AstNode[];
  computed?: boolean;
  name?: string;
  value?: unknown;
  key?: AstNode;
  properties?: AstNode[];
  [key: string]: unknown;
}

const keyOf = (p: AstNode): string | null => {
  if (p.type !== "Property") {
    return null;
  }
  if (p.key?.type === "Identifier") {
    return p.key.name as string;
  }
  const literal = p.key?.value as { value?: unknown } | undefined;
  return typeof literal?.value === "string" ? literal.value : null;
};
const hasForce = (arg: AstNode | undefined): boolean => {
  if (arg?.type !== "ObjectExpression") {
    return false;
  }
  return (arg.properties ?? []).some((p) => {
    if (keyOf(p) !== "force") {
      return false;
    }
    const literal = p.value as { type?: string; value?: unknown } | undefined;
    return !(literal?.type === "Literal" && literal.value === false);
  });
};

const eachChild = (node: AstNode, visit: (child: AstNode) => void): void => {
  for (const [k, child] of Object.entries(node)) {
    if (k === "loc") {
      continue;
    }
    if (Array.isArray(child)) {
      (child as unknown[]).forEach((c) => { visit(c as AstNode); });
    } else if (child && typeof (child as AstNode).type === "string") {
      visit(child as AstNode);
    }
  }
};

/**
 * In a file that touches a signature model: every `<Model>.destroy(...)` on a
 * signature model (a bulk delete), and every `x.destroy({ force })` at all.
 */
// ADR-087 Amendment 4: a converted (.ts) file is parsed with typescript-estree,
// which yields the same ESTree node shapes espree does (plus TS-only nodes the
// visitor walks past), so the rule reads converted files exactly as before.
const scan = (source: string, file = ""): { line: number; what: string }[] => {
  const ast = file.endsWith(".ts")
    ? (tsEstree.parse(source, { loc: true }) as unknown as AstNode)
    : (espree.parse(source, { ecmaVersion: "latest", sourceType: "script", loc: true }) as AstNode);
  const found: { line: number; what: string }[] = [];
  const visit = (node: AstNode): void => {
    if (node.type === "CallExpression") {
      const callee = node.callee as AstNode;
      if (
        callee.type === "MemberExpression" &&
        callee.computed !== true &&
        (callee.property as AstNode).name === "destroy"
      ) {
        const object = callee.object as AstNode;
        const name =
          object.type === "Identifier"
            ? (object.name as string)
            : object.type === "MemberExpression" && object.computed !== true
              ? ((object.property as AstNode).name as string)
              : "";
        if (SIGNATURE_MODELS.test(name)) {
          found.push({ line: node.loc?.start.line as number, what: `${name}.destroy (bulk)` });
        } else if (hasForce(node.arguments?.[0])) {
          found.push({ line: node.loc?.start.line as number, what: `${name}.destroy({ force })` });
        }
      }
    }
    eachChild(node, visit);
  };
  visit(ast);
  return found;
};

const filesTouchingSignatures = (): [string, string][] => {
  const out: [string, string][] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        if (!["tests", "migrations", "models"].includes(name)) {
          walk(full);
        }
      } else if (/\.(js|ts)$/.test(name) && !name.endsWith(".d.ts")) {
        const text = fs.readFileSync(full, "utf8");
        if (/\bSignature(Workflow|WorkflowStep|Record)s?\b/.test(text)) {
          out.push([full, text]);
        }
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
    expect(files).toContain(path.join("services", "eSignature.service.ts"));
  });

  it("no force: true destroy and no bulk destroy of SignatureWorkflow / SignatureWorkflowStep / SignatureRecord", () => {
    const offenders: string[] = [];
    for (const [file, text] of filesTouchingSignatures()) {
      for (const f of scan(text, file)) {
        offenders.push(`${path.relative(SRC, file)}:${String(f.line)} ${f.what}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
