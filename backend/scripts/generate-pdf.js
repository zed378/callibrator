/**
 * PDF Documentation Generator
 * Converts Markdown documentation with Mermaid diagrams to PDF
 */

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const markdownIt = require("markdown-it");

// Paths
const DOC_DIR = path.join(__dirname, "..", "docs");
const MD_PATH = path.join(DOC_DIR, "DOCUMENTATION.md");
const PDF_PATH = path.join(DOC_DIR, "DOCUMENTATION.pdf");
const HTML_PATH = path.join(DOC_DIR, "DOCUMENTATION-temp.html");

async function generatePDF() {
  console.log("📚 Documentation PDF Generator");
  console.log("=".repeat(40));

  // Check if markdown file exists
  if (!fs.existsSync(MD_PATH)) {
    console.error("❌ Error: Documentation file not found at", MD_PATH);
    process.exit(1);
  }

  // Read markdown content
  let markdownContent = fs.readFileSync(MD_PATH, "utf-8");
  console.log(`\n✅ Read documentation file`);
  console.log(`   Size: ${(markdownContent.length / 1024).toFixed(2)} KB`);

  // Count sections and diagrams
  const sections = markdownContent.match(/^## /gm);
  const diagrams = markdownContent.match(/```mermaid/g);
  console.log(`   Sections: ${sections ? sections.length : 0}`);
  console.log(`   Diagrams: ${diagrams ? diagrams.length : 0}`);

  // Extract mermaid diagrams
  const mermaidRegex = /```mermaid\n([\s\S]*?)```/g;
  const mermaidDiagrams = [];
  let match;
  let diagramIndex = 0;

  const contentWithoutMermaid = markdownContent.replace(
    mermaidRegex,
    (match, code) => {
      const svgId = `mermaid-${diagramIndex++}`;
      mermaidDiagrams.push({ id: svgId, code: code.trim() });
      return `<div class="mermaid-container" data-mermaid="${svgId}">
      <div class="mermaid-placeholder" id="${svgId}">
        <svg width="800" height="400" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" style="stop-color:#3498db;stop-opacity:1" />
              <stop offset="100%" style="stop-color:#2c3e50;stop-opacity:1" />
            </linearGradient>
          </defs>
          <rect width="100%" height="100%" fill="url(#grad1)" rx="10"/>
          <text x="50%" y="45%" text-anchor="middle" fill="white" font-size="18" font-family="Arial">Diagram: ${svgId}</text>
          <text x="50%" y="60%" text-anchor="middle" fill="#bdc3c7" font-size="14" font-family="Arial">Render with mermaid.live</text>
        </svg>
      </div>
    </div>`;
    },
  );

  // Initialize markdown-it
  const md = new markdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: true,
  });

  // Convert markdown to HTML
  let htmlBody = md.render(contentWithoutMermaid);

  // Build complete HTML document
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Boilerplate PG MySQL - Complete Documentation</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #3498db;
            --primary-dark: #2980b9;
            --secondary: #2c3e50;
            --text: #333;
            --text-light: #666;
            --bg: #ffffff;
            --bg-light: #f8f9fa;
            --border: #e1e4e8;
            --code-bg: #f6f8fa;
            --pre-bg: #1e1e2e;
            --pre-color: #cdd6f4;
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            line-height: 1.7;
            color: var(--text);
            max-width: 900px;
            margin: 0 auto;
            padding: 40px 50px;
            background: var(--bg);
        }
        
        /* Header */
        h1 {
            font-size: 2.5em;
            color: var(--secondary);
            border-bottom: 4px solid var(--primary);
            padding-bottom: 15px;
            margin-bottom: 30px;
            font-weight: 700;
        }
        
        h2 {
            font-size: 1.8em;
            color: var(--secondary);
            border-bottom: 2px solid var(--primary);
            padding-bottom: 10px;
            margin-top: 45px;
            margin-bottom: 20px;
            font-weight: 600;
            page-break-after: avoid;
        }
        
        h3 {
            font-size: 1.4em;
            color: #34495e;
            margin-top: 30px;
            margin-bottom: 15px;
            font-weight: 600;
            page-break-after: avoid;
        }
        
        h4 {
            font-size: 1.1em;
            color: #555;
            margin-top: 20px;
            margin-bottom: 10px;
        }
        
        /* Paragraphs & Lists */
        p {
            margin-bottom: 15px;
        }
        
        ul, ol {
            margin-bottom: 15px;
            padding-left: 30px;
        }
        
        li {
            margin-bottom: 8px;
        }
        
        /* Links */
        a {
            color: var(--primary);
            text-decoration: none;
            border-bottom: 1px solid transparent;
            transition: border-color 0.2s;
        }
        
        a:hover {
            border-bottom-color: var(--primary);
        }
        
        /* Code */
        code {
            background: var(--code-bg);
            padding: 2px 8px;
            border-radius: 4px;
            font-family: 'JetBrains Mono', 'Courier New', monospace;
            font-size: 0.9em;
            color: #e74c3c;
            border: 1px solid var(--border);
        }
        
        pre {
            background: var(--pre-bg);
            color: var(--pre-color);
            padding: 20px;
            border-radius: 8px;
            overflow-x: auto;
            margin: 20px 0;
            border: 1px solid #333;
        }
        
        pre code {
            background: none;
            padding: 0;
            color: inherit;
            border: none;
            font-size: 0.85em;
        }
        
        /* Tables */
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            font-size: 0.95em;
            page-break-inside: avoid;
        }
        
        thead {
            background: linear-gradient(135deg, var(--primary), var(--primary-dark));
        }
        
        th {
            color: white;
            padding: 12px 15px;
            text-align: left;
            font-weight: 600;
        }
        
        td {
            padding: 12px 15px;
            border-bottom: 1px solid var(--border);
        }
        
        tbody tr:nth-child(even) {
            background: var(--bg-light);
        }
        
        tbody tr:hover {
            background: #e8f4fd;
        }
        
        /* Mermaid Containers */
        .mermaid-container {
            text-align: center;
            margin: 30px 0;
            page-break-inside: avoid;
        }
        
        .mermaid-placeholder {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 12px;
            padding: 40px;
            display: inline-block;
            min-width: 600px;
            min-height: 300px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.15);
        }
        
        .mermaid-placeholder svg {
            width: 100%;
            height: auto;
        }
        
        /* Blockquotes */
        blockquote {
            border-left: 4px solid var(--primary);
            padding: 15px 20px;
            margin: 20px 0;
            background: var(--bg-light);
            border-radius: 0 8px 8px 0;
        }
        
        /* Horizontal Rule */
        hr {
            border: none;
            height: 2px;
            background: linear-gradient(to right, var(--primary), transparent);
            margin: 40px 0;
        }
        
        /* Print Styles */
        @media print {
            body {
                padding: 20px 30px;
            }
            
            pre {
                page-break-inside: avoid;
            }
            
            h2, h3 {
                page-break-after: avoid;
            }
            
            table {
                page-break-inside: avoid;
            }
        }
        
        /* TOC */
        .toc {
            background: var(--bg-light);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 25px 30px;
            margin: 25px 0 40px 0;
        }
        
        .toc h2 {
            margin-top: 0;
            border: none;
            padding: 0;
        }
        
        .toc ul {
            list-style: none;
            padding-left: 0;
        }
        
        .toc li {
            padding: 4px 0;
        }
        
        .toc a {
            color: var(--text);
        }
    </style>
</head>
<body>
    <h1>📘 Boilerplate PG MySQL<br><span style="font-size:0.5em;color:var(--text-light);font-weight:400;">Complete Application Documentation</span></h1>
    
    <div class="toc">
        <h2>📑 Table of Contents</h2>
        ${htmlBody
          .split("\n")
          .filter((line) => line.startsWith("<h2") || line.startsWith("<h3"))
          .map((line) => {
            const match = line.match(
              /<h[23](?: class="[^"]*")?>(.*?)<\/h[23]>/,
            );
            if (match) {
              const text = match[1].replace(/<[^>]*>/g, "").trim();
              const level = line.includes("h2")
                ? ""
                : "&nbsp;&nbsp;&nbsp;&nbsp;";
              const id = text
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "-")
                .replace(/-+/g, "-")
                .substring(0, 30);
              return `${level}<li><a href="#${id}">${text}</a></li>`;
            }
            return "";
          })
          .join("")}
    </div>
    
    ${htmlBody}
    
    <hr>
    <footer style="text-align:center;padding:30px 0;color:var(--text-light);font-size:0.9em;">
        <p>Generated on ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
        <p>Boilerplate PG MySQL - Enterprise Multi-Tenant Express.js Boilerplate</p>
    </footer>
</body>
</html>`;

  // Write HTML file
  fs.writeFileSync(HTML_PATH, htmlContent, "utf-8");
  console.log(`\n✅ Generated HTML file`);
  console.log(`   Path: ${HTML_PATH}`);

  // Launch browser and generate PDF
  console.log(`\n🔄 Launching browser...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  const page = await browser.newPage();

  // Set viewport for print
  await page.setViewport({ width: 1200, height: 800 });

  // Load HTML
  await page.goto(`file://${HTML_PATH}`, {
    waitUntil: "networkidle0",
    timeout: 30000,
  });

  console.log(`🔄 Generating PDF...`);

  // Generate PDF
  await page.pdf({
    path: PDF_PATH,
    format: "A4",
    printBackground: true,
    margin: {
      top: "1.5cm",
      bottom: "1.5cm",
      left: "1.5cm",
      right: "1.5cm",
    },
    displayHeaderFooter: true,
    headerTemplate: `<div style="font-size:8px;font-family:Arial;justify-content:space-between;width:100%;">
      <span>Boilerplate PG MySQL Documentation</span>
      <span><span class="page"></span> / <span class="totalpages"></span></span>
    </div>`,
    footerTemplate: `<div style="font-size:8px;font-family:Arial;justify-content:space-between;width:100%;">
      <span>Generated: ${new Date().toISOString().split("T")[0]}</span>
      <span>Page <span class="page"></span> of <span class="totalpages"></span></span>
    </div>`,
  });

  console.log(`\n✅ PDF generated successfully!`);
  console.log(`   Path: ${PDF_PATH}`);

  // Cleanup
  await browser.close();

  // Remove temp HTML
  if (fs.existsSync(HTML_PATH)) {
    fs.unlinkSync(HTML_PATH);
    console.log(`\n🧹 Cleaned up temporary files`);
  }

  // Stats
  const stats = fs.statSync(PDF_PATH);
  const pdfSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`\n📊 Final PDF Statistics:`);
  console.log(`   Size: ${pdfSizeMB} MB`);
  console.log(`   Sections: ${sections ? sections.length : 0}`);
  console.log(`   Diagrams: ${diagrams ? diagrams.length : 0}`);

  console.log(`\n✨ Documentation generation complete!`);

  await process.exit(0);
}

// Run
generatePDF().catch((err) => {
  console.error("❌ Error generating PDF:", err.message);
  process.exit(1);
});
