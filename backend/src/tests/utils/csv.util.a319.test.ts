/**
 * A-319 — utils/csv.util: RFC 4180 quoting and OWASP formula neutralisation.
 *
 * The cases are written out by hand (not generated from the helper's own
 * pattern), so removing a prefix from the helper fails a case here.
 */
import { csvDocument, csvField, csvRecord, csvText } from "../../utils/csv.util";

describe("A-319 — csvText neutralises a cell a spreadsheet would evaluate", () => {
  it.each([
    ["=1+1", "'=1+1"],
    ["+SUM(A1)", "'+SUM(A1)"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tcmd", "'\tcmd"],
    ["\rcalc", "'\rcalc"],
    ["=cmd|' /c calc'!A1", "'=cmd|' /c calc'!A1"],
  ])("%j -> %j", (input, expected) => {
    expect(csvText(input)).toBe(expected);
  });

  it.each([
    ["-5", "-5"],
    ["-2.50", "-2.50"],
    [-3, "-3"],
    [0, "0"],
    ["plain text", "plain text"],
    [" =padded", " =padded"],
    ["a=b", "a=b"],
    [true, "true"],
  ])("leaves %j as %j", (input, expected) => {
    expect(csvText(input)).toBe(expected);
  });

  it("writes null and undefined as empty", () => {
    expect(csvText(null)).toBe("");
    expect(csvText(undefined)).toBe("");
  });

  it("does not treat a negative number followed by text as a number", () => {
    expect(csvText("-5 or =1")).toBe("'-5 or =1");
  });
});

describe("A-319 — csvField / csvRecord / csvDocument quote per RFC 4180", () => {
  it("quotes every field and doubles an inner quote", () => {
    expect(csvField("plain")).toBe('"plain"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField("line\nbreak")).toBe('"line\nbreak"');
    expect(csvField(null)).toBe('""');
    expect(csvField('="x"')).toBe('"\'=""x"""');
  });

  it("joins fields with commas and records with CRLF, with no trailing terminator", () => {
    expect(csvRecord(["a", 1, null])).toBe('"a","1",""');
    expect(csvDocument([["h1", "h2"], ["v1", "v2"]])).toBe('"h1","h2"\r\n"v1","v2"');
    expect(csvDocument([])).toBe("");
  });
});
