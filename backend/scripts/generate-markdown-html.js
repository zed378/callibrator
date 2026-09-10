/**
 * Markdown to HTML Generator
 * Generates HTML files from markdown with sidebar/menu navigation
 * Usage: node scripts/generate-markdown-html.js [filename]
 *
 * Examples:
 *   node scripts/generate-markdown-html.js DOCUMENTATION.md
 *   node scripts/generate-markdown-html.js CODING_STANDARDS.md
 */

const fs = require("fs");
const path = require("path");

const DOC_DIR = path.join(__dirname, "..", "docs");

// HTML entity map using character codes
var AMP = String.fromCharCode(38) + "amp;";
var LT = String.fromCharCode(60) + "lt;";
var GT = String.fromCharCode(62) + "gt;";
var QUOT = String.fromCharCode(34) + "quot;";

function escapeHtml(str) {
  return str.replace(/&/g, AMP).replace(/</g, LT).replace(/>/g, GT);
}

// ============================================================
// MARKDOWN PARSER
// ============================================================

function parseMarkdown(md) {
  // Normalize Windows line endings (\r\n -> \n)
  md = md.replace(/\r\n/g, "\n");
  const lines = md.split("\n");
  let html = "";
  let inCodeBlock = false;
  let codeContent = "";
  let inTable = false;
  let tableRows = [];
  let inList = false;
  let listType = "";

  function closeList() {
    if (inList) {
      html += "</" + listType + ">";
      inList = false;
      listType = "";
    }
  }

  function processTable() {
    if (tableRows.length === 0) return "";

    let result = '<table class="table"><thead><tr>';
    const headers = tableRows[0].split("|").filter((c) => c.trim() !== "");
    headers.forEach((h) => {
      result += "<th>" + inlineFormat(h.trim()) + "</th>";
    });
    result += "</tr></thead><tbody>";

    for (let i = 1; i < tableRows.length; i++) {
      const cells = tableRows[i].split("|").filter((c) => c.trim() !== "");
      result += "<tr>";
      cells.forEach((cell) => {
        result += "<td>" + inlineFormat(cell.trim()) + "</td>";
      });
      result += "</tr>";
    }
    result += "</tbody></table>";
    tableRows = [];
    return result;
  }

  function inlineFormat(text) {
    // Escape HTML first
    text = escapeHtml(text);
    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    // Italic
    text = text.replace(/\*(.+?)\*/g, "<em>$1</em>");
    // Inline code
    text = text.replace(/`(.+?)`/g, '<code class="inline-code">$1</code>');
    // Links
    text = text.replace(
      /\[(.+?)\]\((.+?)\)/g,
      '<a href="$2" class="doc-link">$1</a>',
    );
    return text;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        html +=
          '<pre><code class="code-block">' +
          escapeHtml(codeContent) +
          "</code></pre>";
        codeContent = "";
        inCodeBlock = false;
      } else {
        closeList();
        html += processTable();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent += (codeContent ? "\n" : "") + line;
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      closeList();
      html += processTable();
      continue;
    }

    // Horizontal rule
    if (line.trim() === "---") {
      closeList();
      html += processTable();
      html += '<hr class="doc-hr">';
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      closeList();
      html += processTable();
      const level = headingMatch[1].length;
      const text = inlineFormat(headingMatch[2]);
      const id = headingMatch[2]
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-");
      html +=
        "<h" + level + ' id="heading-' + id + '">' + text + "</h" + level + ">";
      continue;
    }

    // Table rows
    if (line.includes("|") && line.trim().startsWith("|")) {
      if (line.match(/^\|?[\s\-:|]+\|$/)) {
        continue;
      }
      tableRows.push(line);
      inTable = true;
      continue;
    } else if (inTable) {
      html += processTable();
    }

    // Unordered list
    if (line.match(/^\s*[-*]\s+/)) {
      if (!inList || listType !== "ul") {
        closeList();
        html += "<ul>";
        inList = true;
        listType = "ul";
      }
      const content = line.replace(/^\s*[-*]\s+/, "");
      html += "<li>" + inlineFormat(content) + "</li>";
      continue;
    }

    // Ordered list
    if (line.match(/^\s*\d+\.\s+/)) {
      if (!inList || listType !== "ol") {
        closeList();
        html += "<ol>";
        inList = true;
        listType = "ol";
      }
      const content = line.replace(/^\s*\d+\.\s+/, "");
      html += "<li>" + inlineFormat(content) + "</li>";
      continue;
    }

    // Image
    const imageMatch = line.match(/!\[(.+?)\]\((.+?)\)/);
    if (imageMatch) {
      closeList();
      html += processTable();
      const alt = imageMatch[1];
      const src = imageMatch[2];
      const finalSrc = src.includes("illustrations/")
        ? src.replace("illustrations/", "../illustrations/")
        : src;
      html +=
        '<div class="illustration-container"><img src="' +
        finalSrc +
        '" alt="' +
        alt +
        '"><p class="illustration-caption">' +
        alt +
        "</p></div>";
      continue;
    }

    // Paragraph
    closeList();
    html += processTable();
    html += "<p>" + inlineFormat(line) + "</p>";
  }

  closeList();
  html += processTable();
  if (inCodeBlock) {
    html +=
      '<pre><code class="code-block">' +
      escapeHtml(codeContent) +
      "</code></pre>";
  }

  return html;
}

// ============================================================
// EXTRACT TABLE OF CONTENTS
// ============================================================

function extractTOC(md) {
  // Normalize Windows line endings (\r\n -> \n)
  md = md.replace(/\r\n/g, "\n");
  const lines = md.split("\n");
  const toc = [];

  for (const line of lines) {
    const match = line.match(/^(#{2,4})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].replace(/[*_`]/g, "");
      const id = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-");
      toc.push({ level, text, id });
    }
  }

  return toc;
}

// ============================================================
// GENERATE SIDEBAR HTML
// ============================================================

function generateSidebar(toc, title) {
  let sidebar =
    '\n    <nav class="doc-sidebar">\n' +
    '        <div class="sidebar-header">\n' +
    "            <h2>" +
    title +
    "</h2>\n" +
    "        </div>\n" +
    '        <div class="sidebar-nav">';

  if (toc.length === 0) {
    sidebar += '<p class="no-toc">No navigation available</p>';
  } else {
    toc.forEach(function (item) {
      var indent = "";
      if (item.level === 2) {
        indent = "";
      } else if (item.level === 3) {
        indent = "  ";
      } else {
        indent = "    ";
      }
      sidebar +=
        "\n" +
        indent +
        '<a href="#heading-' +
        item.id +
        '">' +
        item.text +
        "</a>";
    });
  }

  sidebar += "\n        </div>\n    </nav>";
  return sidebar;
}

// ============================================================
// GENERATE FULL HTML
// ============================================================

function generateHTML(title, toc, contentHTML, outputFile) {
  const outputPath = path.join(DOC_DIR, outputFile);
  var date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  var htmlParts = [];

  htmlParts.push(
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
      '    <meta charset="UTF-8">\n' +
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      "    <title>" +
      title +
      " - Callibrator Backend Documentation</title>\n" +
      '    <link rel="preconnect" href="https://fonts.googleapis.com">\n' +
      '    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
      '    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">\n' +
      "    <style>\n",
  );

  // CSS
  htmlParts.push(getCSS());

  htmlParts.push(
    "\n    </style>\n" +
      "</head>\n" +
      "<body>\n" +
      '    <button class="menu-toggle" aria-label="Toggle menu" onclick="document.querySelector(\'.doc-sidebar\').classList.toggle(\'open\')">\n' +
      "        Menu\n" +
      "    </button>\n",
  );

  htmlParts.push(generateSidebar(toc, title));

  htmlParts.push(
    '\n    <main class="main-content">\n' +
      '        <div class="page-header">\n' +
      "            <h1>" +
      title +
      "</h1>\n" +
      '            <p class="generated-date">Generated on ' +
      date +
      "</p>\n" +
      "        </div>\n\n" +
      contentHTML +
      "\n",
  );

  htmlParts.push(
    "\n        <footer>\n" +
      "            <p>Callibrator Backend Documentation</p>\n" +
      "            <p>Generated on " +
      date +
      "</p>\n" +
      "        </footer>\n" +
      "    </main>\n    \n" +
      '    <a href="#" class="back-to-top" id="backToTop">Up</a>\n    \n' +
      "    <script>\n" +
      "        var backToTop = document.getElementById('backToTop');\n" +
      "        window.addEventListener('scroll', function() {\n" +
      "            backToTop.classList.toggle('visible', window.scrollY > 300);\n" +
      "        });\n" +
      "\n" +
      "        var headings = document.querySelectorAll('[id^=\"heading-\"]');\n" +
      "        var navLinks = document.querySelectorAll('.sidebar-nav a');\n" +
      "\n" +
      "        window.addEventListener('scroll', function() {\n" +
      "            var current = '';\n" +
      "            headings.forEach(function(heading) {\n" +
      "                if (window.scrollY >= heading.offsetTop - 50) {\n" +
      "                    current = heading.getAttribute('id');\n" +
      "                }\n" +
      "            });\n" +
      "            navLinks.forEach(function(link) {\n" +
      "                var target = link.getAttribute('href');\n" +
      "                link.classList.toggle('active', target === '#' + current);\n" +
      "            });\n" +
      "        });\n" +
      "\n" +
      "        navLinks.forEach(function(link) {\n" +
      "            link.addEventListener('click', function() {\n" +
      "                if (window.innerWidth <= 768) {\n" +
      "                    document.querySelector('.doc-sidebar').classList.remove('open');\n" +
      "                }\n" +
      "            });\n" +
      "        });\n" +
      "    </script>\n" +
      "</body>\n" +
      "</html>",
  );

  var fullHtml = htmlParts.join("");

  fs.writeFileSync(outputPath, fullHtml, "utf-8");
  console.log("Generated: " + outputPath);
  return outputPath;
}

function getCSS() {
  var css =
    ":root {\n" +
    "            --primary: #3498db;\n" +
    "            --primary-dark: #2980b9;\n" +
    "            --secondary: #2c3e50;\n" +
    "            --success: #2ecc71;\n" +
    "            --warning: #f39c12;\n" +
    "            --danger: #e74c3c;\n" +
    "            --text: #2c3e50;\n" +
    "            --text-light: #7f8c8d;\n" +
    "            --bg: #ffffff;\n" +
    "            --bg-light: #f8f9fa;\n" +
    "            --border: #e1e4e8;\n" +
    "            --sidebar-width: 300px;\n" +
    "        }\n" +
    "        * { margin: 0; padding: 0; box-sizing: border-box; }\n" +
    "        html { scroll-behavior: smooth; scroll-padding-top: 20px; }\n" +
    "        body {\n" +
    "            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;\n" +
    "            line-height: 1.7; color: var(--text); background: var(--bg);\n" +
    "        }\n" +
    "        .doc-sidebar {\n" +
    "            position: fixed; top: 0; left: 0;\n" +
    "            width: var(--sidebar-width); height: 100vh;\n" +
    "            background: var(--secondary); color: white;\n" +
    "            overflow-y: auto; z-index: 1000;\n" +
    "            transition: transform 0.3s ease;\n" +
    "        }\n" +
    "        .sidebar-header { padding: 25px 20px; border-bottom: 1px solid rgba(255,255,255,0.1); }\n" +
    "        .sidebar-header h2 { font-size: 15px; font-weight: 600; line-height: 1.4; }\n" +
    "        .sidebar-nav { padding: 15px 0; }\n" +
    "        .sidebar-nav a {\n" +
    "            display: block; padding: 6px 20px;\n" +
    "            color: rgba(255,255,255,0.7); text-decoration: none;\n" +
    "            font-size: 13px; transition: all 0.2s;\n" +
    "            border-left: 3px solid transparent;\n" +
    "        }\n" +
    "        .sidebar-nav a:hover,\n" +
    "        .sidebar-nav a.active {\n" +
    "            background: rgba(255,255,255,0.1); color: white;\n" +
    "            border-left-color: var(--primary);\n" +
    "        }\n" +
    '        .sidebar-nav a[href^="  "] { padding-left: 35px; font-size: 12px; }\n' +
    '        .sidebar-nav a[href^="    "] { padding-left: 50px; font-size: 11px; color: rgba(255,255,255,0.5); }\n' +
    "        .no-toc { padding: 20px; font-size: 12px; color: rgba(255,255,255,0.5); font-style: italic; }\n" +
    "        .menu-toggle {\n" +
    "            display: none; position: fixed; top: 15px; left: 15px;\n" +
    "            z-index: 1100; background: var(--secondary); color: white;\n" +
    "            border: none; padding: 10px 15px; border-radius: 5px;\n" +
    "            cursor: pointer; font-size: 18px;\n" +
    "            box-shadow: 0 2px 10px rgba(0,0,0,0.2);\n" +
    "        }\n" +
    "        .main-content {\n" +
    "            margin-left: var(--sidebar-width);\n" +
    "            padding: 40px 60px; max-width: 900px;\n" +
    "        }\n" +
    "        .page-header { margin-bottom: 40px; padding-bottom: 20px; border-bottom: 3px solid var(--primary); }\n" +
    "        .page-header h1 { font-size: 2.2em; color: var(--secondary); margin-bottom: 10px; }\n" +
    "        .page-header .generated-date { font-size: 0.9em; color: var(--text-light); }\n" +
    "        h2 {\n" +
    "            font-size: 1.6em; color: var(--secondary);\n" +
    "            margin-top: 50px; margin-bottom: 20px;\n" +
    "            padding-bottom: 10px; border-bottom: 2px solid var(--primary);\n" +
    "            scroll-margin-top: 20px;\n" +
    "        }\n" +
    "        h3 { font-size: 1.3em; color: #34495e; margin-top: 30px; margin-bottom: 15px; }\n" +
    "        h4, h5, h6 { color: #555; margin-top: 25px; margin-bottom: 10px; }\n" +
    "        p { margin-bottom: 15px; }\n" +
    "        .table {\n" +
    "            width: 100%; border-collapse: collapse;\n" +
    "            margin: 20px 0; font-size: 0.95em;\n" +
    "            overflow-x: auto; display: block;\n" +
    "        }\n" +
    "        .table thead {\n" +
    "            background: linear-gradient(135deg, var(--primary), var(--primary-dark));\n" +
    "        }\n" +
    "        .table th { color: white; padding: 12px 15px; text-align: left; font-weight: 600; }\n" +
    "        .table td { padding: 12px 15px; border-bottom: 1px solid var(--border); }\n" +
    "        .table tbody tr:nth-child(even) { background: var(--bg-light); }\n" +
    "        .table tbody tr:hover { background: #e8f4fd; }\n" +
    "        .inline-code {\n" +
    "            background: var(--bg-light); padding: 2px 8px;\n" +
    "            border-radius: 4px; font-family: 'JetBrains Mono', monospace;\n" +
    "            font-size: 0.9em; color: var(--danger);\n" +
    "            border: 1px solid var(--border);\n" +
    "        }\n" +
    "        .code-block {\n" +
    "            background: #1e1e2e; color: #cdd6f4; padding: 20px;\n" +
    "            border-radius: 8px; overflow-x: auto; margin: 20px 0;\n" +
    "            font-family: 'JetBrains Mono', monospace;\n" +
    "            font-size: 0.9em; line-height: 1.6;\n" +
    "        }\n" +
    "        .illustration-container {\n" +
    "            text-align: center; margin: 30px 0; padding: 20px;\n" +
    "            background: var(--bg-light); border-radius: 12px;\n" +
    "            border: 1px solid var(--border);\n" +
    "        }\n" +
    "        .illustration-container img { max-width: 100%; height: auto; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }\n" +
    "        .illustration-caption { margin-top: 10px; font-size: 13px; color: var(--text-light); font-style: italic; }\n" +
    "        .doc-link { color: var(--primary); text-decoration: none; }\n" +
    "        .doc-link:hover { text-decoration: underline; }\n" +
    "        .doc-hr { border: none; height: 2px; background: var(--border); margin: 30px 0; }\n" +
    "        ul, ol { margin: 15px 0; padding-left: 30px; }\n" +
    "        li { margin-bottom: 8px; }\n" +
    "        .back-to-top {\n" +
    "            position: fixed; bottom: 30px; right: 30px;\n" +
    "            background: var(--primary); color: white;\n" +
    "            width: 45px; height: 45px; border-radius: 50%;\n" +
    "            display: flex; align-items: center; justify-content: center;\n" +
    "            text-decoration: none; opacity: 0;\n" +
    "            transition: opacity 0.3s;\n" +
    "            box-shadow: 0 4px 15px rgba(52,152,219,0.4);\n" +
    "            font-size: 12px; font-weight: 600;\n" +
    "        }\n" +
    "        .back-to-top.visible { opacity: 1; }\n" +
    "        footer {\n" +
    "            text-align: center; padding: 30px 0;\n" +
    "            color: var(--text-light); font-size: 14px;\n" +
    "            border-top: 1px solid var(--border);\n" +
    "            margin-top: 50px;\n" +
    "        }\n" +
    "        @media (max-width: 1024px) {\n" +
    "            .main-content { padding: 80px 30px 40px; }\n" +
    "        }\n" +
    "        @media (max-width: 768px) {\n" +
    "            .doc-sidebar { transform: translateX(-100%); }\n" +
    "            .doc-sidebar.open { transform: translateX(0); }\n" +
    "            .main-content { margin-left: 0; padding: 60px 20px 40px; }\n" +
    "            .menu-toggle { display: block; }\n" +
    "        }\n" +
    "        @media print {\n" +
    "            .doc-sidebar, .menu-toggle, .back-to-top { display: none !important; }\n" +
    "            .main-content { margin-left: 0; }\n" +
    "        }";
  return css;
}

// ============================================================
// MAIN
// ============================================================

async function generateFromMarkdown(filename) {
  const inputPath = path.join(DOC_DIR, filename);

  if (!fs.existsSync(inputPath)) {
    console.error("Error: File not found: " + inputPath);
    process.exit(1);
  }

  const mdContent = fs.readFileSync(inputPath, "utf-8");
  const title = filename.replace(".md", "");
  const outputFile = title + ".html";

  console.log("");
  console.log("=== Markdown to HTML Generator ===");
  console.log("Input:  " + inputPath);
  console.log("Output: " + path.join(DOC_DIR, outputFile));

  const toc = extractTOC(mdContent);
  console.log("Found " + toc.length + " navigation items");

  if (toc.length > 0) {
    console.log("TOC entries:");
    toc.forEach(function (item) {
      console.log(
        "  H" + item.level + ": " + item.text + " (id: " + item.id + ")",
      );
    });
  }

  const contentHTML = parseMarkdown(mdContent);

  generateHTML(title, toc, contentHTML, outputFile);

  console.log("");
  console.log("Done! Open " + outputFile + " in a browser.");
  console.log("");
}

// ============================================================
// ENTRY POINT
// ============================================================

const args = process.argv.slice(2);
const filename = args[0];

if (!filename) {
  console.log("Usage: node scripts/generate-markdown-html.js <filename.md>");
  console.log("\nAvailable files in docs/:");
  const files = fs
    .readdirSync(DOC_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
  files.forEach((f) => console.log("  - " + f));
  console.log("");
  process.exit(0);
}

generateFromMarkdown(filename);
