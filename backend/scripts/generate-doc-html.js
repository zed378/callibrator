/**
 * Generate HTML documentation from DOCUMENTATION.md
 * Usage: node scripts/generate-doc-html.js
 */

const fs = require("fs");
const path = require("path");

// Simple markdown to HTML converter
function markdownToHtml(markdown) {
  const lines = markdown.split("\n");
  let html = "";
  let inList = false;
  let inPre = false;
  let inTable = false;
  let tableRows = [];

  const flushTable = () => {
    if (tableRows.length > 0) {
      html += "<tbody>\n";
      tableRows.forEach((row, i) => {
        if (i === 0) {
          html += "<thead>\n<tr>\n";
        }
        html += "<tr>\n";
        row.cells.forEach((cell) => {
          const tag = i === 0 ? "th" : "td";
          html += `  <${tag}>${parseInline(cell)}</${tag}>\n`;
        });
        html += "</tr>\n";
        if (i === 0) {
          html += "</thead>\n";
        }
      });
      html += "</tbody>\n";
      html += "</table>\n";
      tableRows = [];
    }
    inTable = false;
  };

  const flushList = () => {
    if (inList) {
      html += inList === "ul" ? "</ul>\n" : "</ol>\n";
      inList = false;
    }
  };

  const closePre = () => {
    if (inPre) {
      html += "</pre>\n";
      inPre = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Code blocks
    if (line.trim().startsWith("```")) {
      if (inPre) {
        closePre();
      } else {
        flushTable();
        flushList();
        const lang = line.trim().slice(3).trim();
        html += `<pre class="language-${lang}"><code class="language-${lang}">`;
        inPre = true;
      }
      continue;
    }

    if (inPre) {
      html += escapeHtml(line) + "\n";
      continue;
    }

    // Headers
    if (line.match(/^### (.+)/)) {
      flushTable();
      flushList();
      html += `<h3>${parseInline(line.replace(/^### /, ""))}</h3>\n`;
      continue;
    }
    if (line.match(/^## (.+)/)) {
      flushTable();
      flushList();
      html += `<h2>${parseInline(line.replace(/^## /, ""))}</h2>\n`;
      continue;
    }
    if (line.match(/^# (.+)/)) {
      flushTable();
      flushList();
      html += `<h1>${parseInline(line.replace(/^# /, ""))}</h1>\n`;
      continue;
    }

    // Table rows
    if (line.trim().startsWith("|")) {
      flushList();
      const cells = line
        .split("|")
        .filter((_, idx) => idx > 0 && idx < line.split("|").length - 1);

      // Skip separator rows
      if (cells.every((c) => c.trim().match(/^[-:]+$/))) continue;

      if (!inTable) {
        inTable = true;
        html += "<table>\n";
      }
      tableRows.push({ cells });
      continue;
    } else if (inTable) {
      flushTable();
    }

    // List items
    const ulMatch = line.match(/^(\s*)-\s+(.+)/);

    if (ulMatch) {
      closePre();
      flushTable();
      const indent = ulMatch[1].length;
      const content = ulMatch[2];
      if (!inList || inList !== "ul") {
        flushList();
        html += `<ul>\n`;
        inList = "ul";
      }
      html += `  <li>${parseInline(content)}</li>\n`;
      continue;
    }

    if (line.match(/^\s*\d+\.\s+/)) {
      closePre();
      flushTable();
      if (!inList || inList !== "ol") {
        flushList();
        html += `<ol>\n`;
        inList = "ol";
      }
      const content = line.replace(/^\s*\d+\.\s+/, "");
      html += `  <li>${parseInline(content)}</li>\n`;
      continue;
    }

    if (inList && !line.match(/^\s/)) {
      flushList();
    }

    // Horizontal rule
    if (line.trim() === "---") {
      flushTable();
      flushList();
      html += "<hr />\n";
      continue;
    }

    // Empty lines
    if (line.trim() === "") {
      continue;
    }

    // Bold and inline
    flushTable();
    flushList();
    html += `<p>${parseInline(line)}</p>\n`;
  }

  closePre();
  flushTable();
  flushList();

  return html;
}

function parseInline(text) {
  // Escape HTML
  text = escapeHtml(text);
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  text = text.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Code
  text = text.replace(
    /`(.+?)`/g,
    '<code style="background:#f0f0f0;padding:2px 4px;border-radius:3px;">$1</code>',
  );
  // Links
  text = text.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
  return text;
}

function escapeHtml(text) {
  var amp = String.fromCharCode(38) + "amp;";
  var lt = String.fromCharCode(38) + "lt;";
  var gt = String.fromCharCode(38) + "gt;";
  var quot = String.fromCharCode(38) + "quot;";
  var apos = String.fromCharCode(38) + "#39;";
  return text
    .replace(/&/g, amp)
    .replace(/</g, lt)
    .replace(/>/g, gt)
    .replace(/"/g, quot)
    .replace(/'/g, apos);
}

function generateFullHtml(bodyHtml) {
  const dateStr = new Date().toISOString().split("T")[0];
  const mdash = String.fromCharCode(38) + "mdash;";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Callibrator Backend - Architecture & Documentation</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      line-height: 1.6;
      color: #1a1a2e;
      background: #f5f5fa;
      padding: 2rem;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      padding: 3rem;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 { font-size: 2.2rem; margin-bottom: 1rem; color: #16213e; border-bottom: 3px solid #0f3460; padding-bottom: 0.5rem; }
    h2 { font-size: 1.7rem; margin-top: 2.5rem; margin-bottom: 1rem; color: #0f3460; }
    h3 { font-size: 1.3rem; margin-top: 1.5rem; margin-bottom: 0.75rem; color: #1a1a5e; }
    p { margin-bottom: 1rem; }
    table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; }
    th, td { border: 1px solid #ddd; padding: 10px 14px; text-align: left; }
    thead { background: #16213e; color: white; }
    tbody tr:nth-child(even) { background: #f8f9fa; }
    tbody tr:hover { background: #e9ecef; }
    pre {
      background: #1a1a2e;
      color: #e0e0e0;
      padding: 1.5rem;
      border-radius: 6px;
      overflow-x: auto;
      margin: 1.5rem 0;
      font-size: 0.9rem;
      line-height: 1.5;
    }
    code {
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    }
    ul, ol { margin: 1rem 0 1rem 2rem; }
    li { margin-bottom: 0.4rem; }
    hr { border: none; border-top: 2px solid #e0e0e0; margin: 2rem 0; }
    a { color: #0f3460; text-decoration: none; }
    a:hover { text-decoration: underline; }
    strong { color: #16213e; }
    @media (max-width: 768px) {
      body { padding: 1rem; }
      .container { padding: 1.5rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    ${bodyHtml}
    <hr />
    <p style="text-align:center;color:#888;font-size:0.9rem;">
      Generated on ${dateStr} ${mdash} Callibrator Backend Documentation
    </p>
  </div>
</body>
</html>`;
}

// Main
const docsPath = path.join(__dirname, "..", "docs", "DOCUMENTATION.md");
const markdown = fs.readFileSync(docsPath, "utf-8");
const bodyHtml = markdownToHtml(markdown);
const fullHtml = generateFullHtml(bodyHtml);

const outPath = path.join(__dirname, "..", "docs", "DOCUMENTATION.html");
fs.writeFileSync(outPath, fullHtml, "utf-8");

console.log("Documentation generated:", outPath);
