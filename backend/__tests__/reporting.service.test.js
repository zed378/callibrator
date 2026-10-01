const { toCsv } = require("../src/services/reporting.service");

describe("reporting.service", () => {
  describe("toCsv", () => {
    it("should convert headers and empty rows to CSV", () => {
      const headers = [
        { key: "name", label: "Name" },
        { key: "value", label: "Value" },
      ];
      const result = toCsv(headers, []);
      // Empty rows still produces header + a record separator.
      // A-319: every field quoted (RFC 4180), records end in CRLF (utils/csv.util).
      expect(result).toBe('"Name","Value"\r\n');
    });

    it("should convert headers and rows to CSV", () => {
      const headers = [
        { key: "name", label: "Name" },
        { key: "value", label: "Value" },
      ];
      const rows = [
        { name: "Alice", value: 100 },
        { name: "Bob", value: 200 },
      ];
      const result = toCsv(headers, rows);
      expect(result).toBe('"Name","Value"\r\n"Alice","100"\r\n"Bob","200"');
    });

    it("should escape values containing commas", () => {
      const headers = [{ key: "text", label: "Text" }];
      const rows = [{ text: "hello, world" }];
      const result = toCsv(headers, rows);
      expect(result).toBe('"Text"\r\n"hello, world"');
    });

    it("should escape values containing double quotes", () => {
      const headers = [{ key: "text", label: "Text" }];
      const rows = [{ text: 'say "hi"' }];
      const result = toCsv(headers, rows);
      expect(result).toBe('"Text"\r\n"say ""hi"""');
    });

    it("should handle null and undefined values", () => {
      const headers = [
        { key: "name", label: "Name" },
        { key: "value", label: "Value" },
      ];
      const rows = [{ name: "Test", value: null }];
      const result = toCsv(headers, rows);
      expect(result).toBe('"Name","Value"\r\n"Test",""');
    });

    it("should handle rows with missing keys", () => {
      const headers = [
        { key: "name", label: "Name" },
        { key: "value", label: "Value" },
      ];
      const rows = [{ name: "Test" }];
      const result = toCsv(headers, rows);
      expect(result).toBe('"Name","Value"\r\n"Test",""');
    });

    it("should handle newlines in values", () => {
      const headers = [{ key: "text", label: "Text" }];
      const rows = [{ text: "line1\nline2" }];
      const result = toCsv(headers, rows);
      expect(result).toBe('"Text"\r\n"line1\nline2"');
    });

    it("should handle empty headers array", () => {
      const result = toCsv([], [{ foo: "bar" }]);
      expect(result).toBe("\r\n");
    });

    it("should handle empty rows array with single header", () => {
      const headers = [{ key: "name", label: "Name" }];
      const result = toCsv(headers, []);
      expect(result).toBe('"Name"\r\n');
    });

    it("should handle multiple columns with data", () => {
      const headers = [
        { key: "id", label: "ID" },
        { key: "name", label: "Name" },
        { key: "email", label: "Email" },
      ];
      const rows = [
        { id: 1, name: "Alice", email: "alice@example.com" },
        { id: 2, name: "Bob", email: "bob@example.com" },
      ];
      const result = toCsv(headers, rows);
      expect(result).toBe(
        '"ID","Name","Email"\r\n"1","Alice","alice@example.com"\r\n"2","Bob","bob@example.com"',
      );
    });

    it("should handle special characters in values", () => {
      const headers = [{ key: "text", label: "Text" }];
      const rows = [{ text: "normal text" }];
      const result = toCsv(headers, rows);
      expect(result).toBe('"Text"\r\n"normal text"');
    });

    it("should handle empty string values", () => {
      const headers = [
        { key: "name", label: "Name" },
        { key: "value", label: "Value" },
      ];
      const rows = [{ name: "", value: "" }];
      const result = toCsv(headers, rows);
      expect(result).toBe('"Name","Value"\r\n"",""');
    });
  });
});
