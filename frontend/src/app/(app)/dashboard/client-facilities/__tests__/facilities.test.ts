/**
 * P22-09 — the facility administration's plain rules: the create body (blank optionals left out),
 * the edit body (only what changed, a cleared field as null, the code compared case-free), the
 * contracts' own problems (a reserved or malformed code, a malformed e-mail, a blank name), the
 * statuses offered, the list query, the reason.
 */
import type { ClientFacility } from "@/api/services/clientFacility.service";
import { createBody, editBody, emptyForm, formOf, listQuery, nextStatuses, problemsOf, reasonValid } from "../facilities";

const facility: ClientFacility = {
  id: "f1",
  name: "Synthetic Clinic",
  code: "SC",
  kind: "clinic",
  isSelf: false,
  status: "active",
  statusReason: null,
  statusChangedAt: null,
  address: "Jalan Contoh 1",
  city: "Jakarta",
  province: null,
  postalCode: null,
  phone: null,
  contactName: "Synthetic Contact",
  contactEmail: "contact@synthetic.example",
  contactPhone: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("P22-09 — facility rules", () => {
  it("create: name, code and kind, blank optionals left out", () => {
    expect(createBody({ ...emptyForm(), name: " New Clinic ", code: " nc-1 ", city: " Bandung ", contactEmail: " " })).toEqual({ name: "New Clinic", code: "nc-1", kind: "hospital", city: "Bandung" });
  });

  it("edit: only what changed; a cleared field is null; the code compared without case", () => {
    const before = formOf(facility);
    expect(editBody(before, before)).toEqual({});
    expect(editBody({ ...before, code: "sc" }, before)).toEqual({});
    expect(editBody({ ...before, name: "Renamed", kind: "hospital", city: "", phone: "021" }, before)).toEqual({ name: "Renamed", kind: "hospital", city: null, phone: "021" });
    expect(editBody({ ...before, code: "SC2" }, before)).toEqual({ code: "SC2" });
  });

  it("the contracts' problems: SELF reserved, a malformed code or e-mail, a blank name; an edit with nothing", () => {
    expect(problemsOf(createBody({ ...emptyForm(), name: "A", code: "SC" }), true)).toEqual({});
    expect(Object.keys(problemsOf(createBody({ ...emptyForm(), name: "A", code: "self" }), true))).toEqual(["code"]);
    expect(Object.keys(problemsOf(createBody({ ...emptyForm(), name: " ", code: "bad code!", contactEmail: "nope" }), true)).sort()).toEqual(["code", "contactEmail", "name"]);
    expect(Object.keys(problemsOf({}, false))).toEqual(["form"]);
  });

  it("statuses offered, the list query, the reason", () => {
    expect(nextStatuses("active")).toEqual(["inactive", "ended"]);
    expect(nextStatuses("ended")).toEqual(["active", "inactive"]);
    expect(listQuery({ q: "", status: "", kind: "" }, 1)).toEqual({ page: 1, limit: 25, sort: "name" });
    expect(listQuery({ q: " cl ", status: "ended", kind: "clinic" }, 2)).toEqual({ page: 2, limit: 25, sort: "name", q: "cl", status: "ended", kind: "clinic" });
    expect(reasonValid("ab")).toBe(false);
    expect(reasonValid("abc")).toBe(true);
    expect(reasonValid("x".repeat(501))).toBe(false);
  });
});
