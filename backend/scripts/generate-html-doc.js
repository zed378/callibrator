/**
 * HTML Documentation Generator
 * Creates interactive HTML documentation with embedded SVG illustrations
 */

const fs = require("fs");
const path = require("path");

const DOC_DIR = path.join(__dirname, "..", "docs");
const ILLUSTRATIONS_DIR = path.join(DOC_DIR, "illustrations");
const HTML_OUTPUT = path.join(DOC_DIR, "DOCUMENTATION.html");

// List all SVG files
const svgFiles = fs
  .readdirSync(ILLUSTRATIONS_DIR)
  .filter((f) => f.endsWith(".svg"))
  .sort();

console.log("HTML Documentation Generator");
console.log("=".repeat(40));
console.log(`Found ${svgFiles.length} SVG illustrations`);
console.log(`Output: ${HTML_OUTPUT}`);

// Function to embed SVG content directly into HTML
function embedSVG(filePath) {
  try {
    const svgContent = fs.readFileSync(filePath, "utf-8");
    // Remove XML declaration and any processing instructions
    return svgContent
      .replace(/^<\?xml[^?]*\?>/, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .trim();
  } catch (e) {
    console.error(`Error reading SVG: ${filePath}`, e.message);
    return "<p>Failed to load SVG</p>";
  }
}

// Map of SVG file to its display info
const svgMap = {
  "01-system-architecture.svg": {
    id: "fig-system-architecture",
    title: "System Architecture",
    caption:
      "Three-tier architecture: Client Layer, Application Layer, and Data Layer",
  },
  "02-authentication-flow.svg": {
    id: "fig-authentication-flow",
    title: "Authentication Flow",
    caption:
      "Complete authentication lifecycle from registration to token refresh",
  },
  "03-rbac-abac.svg": {
    id: "fig-rbac-abac",
    title: "RBAC & ABAC Authorization",
    caption:
      "Dual authorization model with role hierarchy and attribute conditions",
  },
  "04-database-schema.svg": {
    id: "fig-database-schema",
    title: "Database Schema",
    caption:
      "Entity relationship diagram showing 12 core models and their relationships",
  },
  "05-middleware-pipeline.svg": {
    id: "fig-middleware-pipeline",
    title: "Middleware Pipeline",
    caption: "Request processing flow through the middleware stack",
  },
  "06-api-endpoints.svg": {
    id: "fig-api-endpoints",
    title: "API Endpoints",
    caption: "Complete RESTful API endpoint reference organized by module",
  },
  "07-multi-tenancy.svg": {
    id: "fig-multi-tenancy",
    title: "Multi-Tenancy Architecture",
    caption: "Tenant identification, isolation, and feature management",
  },
  "08-backup-logging.svg": {
    id: "fig-backup-logging",
    title: "Backup & Logging System",
    caption: "Automated backup scheduling and Winston logging architecture",
  },
  "09-security-layers.svg": {
    id: "fig-security-layers",
    title: "Security Layers",
    caption: "Defense in depth: Helmet, CORS, HPP, Rate Limiting, JWT, Bcrypt",
  },
  "10-project-structure.svg": {
    id: "fig-project-structure",
    title: "Project Structure",
    caption:
      "Organized source tree with controllers, services, models, and middlewares",
  },
  "11-docker-architecture.svg": {
    id: "fig-docker-architecture",
    title: "Docker Architecture",
    caption:
      "Containerized deployment with app, database, Redis cache, and RabbitMQ message queue",
  },
};

// Generate HTML
const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Boilerplate PG MySQL - Complete Documentation</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #3498db;
            --primary-dark: #2980b9;
            --secondary: #2c3e50;
            --success: #2ecc71;
            --warning: #f39c12;
            --danger: #e74c3c;
            --text: #2c3e50;
            --text-light: #7f8c8d;
            --bg: #ffffff;
            --bg-light: #f8f9fa;
            --border: #e1e4e8;
        }
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html { scroll-behavior: smooth; }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            line-height: 1.7; color: var(--text); background: var(--bg);
        }
        
        /* Sidebar */
        .sidebar {
            position: fixed; top: 0; left: 0; width: 280px; height: 100vh;
            background: var(--secondary); color: white; overflow-y: auto; z-index: 1000;
        }
        .sidebar-header { padding: 25px 20px; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .sidebar-header h2 { font-size: 16px; font-weight: 600; }
        .sidebar-header p { font-size: 12px; opacity: 0.7; margin-top: 5px; }
        .sidebar-nav { padding: 15px 0; }
        .sidebar-nav a {
            display: block; padding: 8px 20px; color: rgba(255,255,255,0.8);
            text-decoration: none; font-size: 13px; transition: all 0.2s;
        }
        .sidebar-nav a:hover, .sidebar-nav a.active {
            background: rgba(255,255,255,0.1); color: white; border-left: 3px solid var(--primary);
        }
        
        /* Main Content */
        .main-content {
            margin-left: 280px; padding: 40px 60px; max-width: 1000px;
        }
        .page-header { margin-bottom: 40px; padding-bottom: 20px; border-bottom: 3px solid var(--primary); }
        .page-header h1 { font-size: 2.5em; color: var(--secondary); margin-bottom: 10px; }
        .page-header .subtitle { font-size: 1.1em; color: var(--text-light); }
        
        h2 {
            font-size: 1.8em; color: var(--secondary); margin-top: 50px; margin-bottom: 20px;
            padding-bottom: 10px; border-bottom: 2px solid var(--primary); scroll-margin-top: 20px;
        }
        h3 { font-size: 1.4em; color: #34495e; margin-top: 30px; margin-bottom: 15px; }
        p { margin-bottom: 15px; }
        
        table {
            width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 0.95em;
        }
        thead { background: linear-gradient(135deg, var(--primary), var(--primary-dark)); }
        th { color: white; padding: 12px 15px; text-align: left; font-weight: 600; }
        td { padding: 12px 15px; border-bottom: 1px solid var(--border); }
        tbody tr:nth-child(even) { background: var(--bg-light); }
        tbody tr:hover { background: #e8f4fd; }
        
        code {
            background: var(--bg-light); padding: 2px 8px; border-radius: 4px;
            font-family: 'JetBrains Mono', monospace; font-size: 0.9em;
            color: var(--danger); border: 1px solid var(--border);
        }
        pre {
            background: #1e1e2e; color: #cdd6f4; padding: 20px; border-radius: 8px;
            overflow-x: auto; margin: 20px 0;
        }
        pre code { background: none; padding: 0; color: inherit; border: none; }
        
        .illustration-container {
            text-align: center; margin: 30px 0; padding: 20px;
            background: var(--bg-light); border-radius: 12px; border: 1px solid var(--border);
        }
        .illustration-container img { max-width: 100%; height: auto; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
        .illustration-caption { margin-top: 10px; font-size: 13px; color: var(--text-light); font-style: italic; }
        
        ul, ol { margin: 15px 0; padding-left: 30px; }
        li { margin-bottom: 8px; }
        a { color: var(--primary); text-decoration: none; }
        a:hover { text-decoration: underline; }
        
        .menu-toggle {
            display: none; position: fixed; top: 15px; left: 15px; z-index: 1100;
            background: var(--secondary); color: white; border: none;
            padding: 10px 15px; border-radius: 5px; cursor: pointer; font-size: 18px;
        }
        
        @media (max-width: 768px) {
            .sidebar { transform: translateX(-100%); }
            .sidebar.open { transform: translateX(0); }
            .main-content { margin-left: 0; padding: 60px 20px 40px; }
            .menu-toggle { display: block; }
        }
        @media print {
            .sidebar, .menu-toggle { display: none !important; }
            .main-content { margin-left: 0; }
        }
        
        .back-to-top {
            position: fixed; bottom: 30px; right: 30px; background: var(--primary);
            color: white; width: 45px; height: 45px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            text-decoration: none; opacity: 0; transition: opacity 0.3s;
            box-shadow: 0 4px 15px rgba(52,152,219,0.4);
        }
        .back-to-top.visible { opacity: 1; }
    </style>
</head>
<body>
    <button class="menu-toggle" onclick="document.querySelector('.sidebar').classList.toggle('open')">Menu</button>
    
    <nav class="sidebar">
        <div class="sidebar-header">
            <h2>Documentation</h2>
            <p>Boilerplate PG MySQL v1.0</p>
        </div>
        <div class="sidebar-nav">
            <a href="#overview">1. Overview</a>
            <a href="#architecture">2. Architecture</a>
            <a href="#installation">3. Installation</a>
            <a href="#configuration">4. Configuration</a>
            <a href="#database-schema">5. Database Schema</a>
            <a href="#authentication">6. Authentication</a>
            <a href="#authorization">7. Authorization</a>
            <a href="#multi-tenancy">8. Multi-Tenancy</a>
            <a href="#api-endpoints">9. API Endpoints</a>
            <a href="#middlewares">10. Middlewares</a>
            <a href="#backup-recovery">11. Backup & Recovery</a>
            <a href="#logging">12. Logging</a>
            <a href="#security">13. Security</a>
            <a href="#testing">14. Testing</a>
            <a href="#deployment">15. Deployment</a>
            <div style="border-top: 1px solid rgba(255,255,255,0.1); margin: 10px 0;"></div>
            <a href="#illustrations" style="opacity: 0.5; font-size: 12px;">Illustrations</a>
            <a href="#fig-system-architecture" style="padding-left: 35px; font-size: 11px;">Fig 1: System Architecture</a>
            <a href="#fig-authentication-flow" style="padding-left: 35px; font-size: 11px;">Fig 2: Authentication Flow</a>
            <a href="#fig-rbac-abac" style="padding-left: 35px; font-size: 11px;">Fig 3: RBAC/ABAC</a>
            <a href="#fig-database-schema" style="padding-left: 35px; font-size: 11px;">Fig 4: Database Schema</a>
            <a href="#fig-middleware-pipeline" style="padding-left: 35px; font-size: 11px;">Fig 5: Middleware Pipeline</a>
            <a href="#fig-api-endpoints" style="padding-left: 35px; font-size: 11px;">Fig 6: API Endpoints</a>
            <a href="#fig-multi-tenancy" style="padding-left: 35px; font-size: 11px;">Fig 7: Multi-Tenancy</a>
            <a href="#fig-backup-logging" style="padding-left: 35px; font-size: 11px;">Fig 8: Backup & Logging</a>
            <a href="#fig-security-layers" style="padding-left: 35px; font-size: 11px;">Fig 9: Security Layers</a>
            <a href="#fig-project-structure" style="padding-left: 35px; font-size: 11px;">Fig 10: Project Structure</a>
            <a href="#fig-docker-architecture" style="padding-left: 35px; font-size: 11px;">Fig 11: Docker Architecture</a>
        </div>
    </nav>
    
    <main class="main-content">
        <div class="page-header">
            <h1>Boilerplate PG MySQL</h1>
            <p class="subtitle">Enterprise Multi-Tenant Express.js Boilerplate</p>
        </div>

        <div id="overview">
            <h2>1. Overview</h2>
            <p>A production-ready Express.js boilerplate for building multi-tenant SaaS applications with complete authentication, authorization, and enterprise-grade security.</p>
            <h3>Key Features</h3>
            <table>
                <thead><tr><th>Feature</th><th>Description</th></tr></thead>
                <tbody>
                    <tr><td>Framework</td><td>Express.js v5 with Node.js 18+</td></tr>
                    <tr><td>Database</td><td>PostgreSQL 14+ or MySQL 8+ (Sequelize ORM)</td></tr>
                    <tr><td>Authentication</td><td>JWT with access and refresh tokens</td></tr>
                    <tr><td>Authorization</td><td>RBAC + ABAC with 3 role levels</td></tr>
                    <tr><td>Multi-Tenancy</td><td>Full tenant isolation with feature flags</td></tr>
                    <tr><td>Rate Limiting</td><td>Token-based multi-layer rate limiter</td></tr>
                    <tr><td>Caching</td><td>Redis-based caching for frequently accessed data</td></tr>
                    <tr><td>Message Queue</td><td>RabbitMQ-based async email queue</td></tr>
                    <tr><td>Distributed Locks</td><td>Redis-based distributed locking</td></tr>
                    <tr><td>API Docs</td><td>Swagger/OpenAPI auto-generated</td></tr>
                    <tr><td>Logging</td><td>Winston with daily rotating files</td></tr>
                </tbody>
            </table>
        </div>

        <div id="architecture">
            <h2>2. Architecture</h2>
            <p>The application follows a layered architecture pattern with clear separation of concerns.</p>
            <div class="illustration-container">
                ${embedSVG(path.join(ILLUSTRATIONS_DIR, "01-system-architecture.svg"))}
                <p class="illustration-caption">Figure 1: System Architecture - Three-tier design</p>
            </div>
            <div class="illustration-container">
                ${embedSVG(path.join(ILLUSTRATIONS_DIR, "10-project-structure.svg"))}
                <p class="illustration-caption">Figure 2: Project Structure - Organized source tree</p>
            </div>
        </div>

        <div id="installation">
            <h2>3. Installation</h2>
            <h3>Prerequisites</h3>
            <ul>
                <li>Node.js 18 or higher</li>
                <li>PostgreSQL 14+ or MySQL 8+</li>
                <li>npm or bun package manager</li>
            </ul>
            <h3>Quick Start with Docker</h3>
            <pre><code>git clone https://github.com/zed378/boilerplate-pg-mysql.git
cd boilerplate-pg-mysql
cp local.env .env
docker-compose up -d</code></pre>
        </div>

        <div id="configuration">
            <h2>4. Configuration</h2>
            <p>The application uses environment variables for configuration.</p>
            <div class="illustration-container">
                ${embedSVG(path.join(ILLUSTRATIONS_DIR, "11-docker-architecture.svg"))}
                <p class="illustration-caption">Figure 3: Docker Architecture - Four container services (Backend, PostgreSQL, Redis, RabbitMQ)</p>
            </div>
            <h3>Key Environment Variables</h3>
            <table>
                <thead><tr><th>Variable</th><th>Description</th><th>Default</th></tr></thead>
                <tbody>
                    <tr><td>PORT</td><td>Server port</td><td>3000</td></tr>
                    <tr><td>DB_HOST</td><td>Database host</td><td>localhost</td></tr>
                    <tr><td>DB_DIALECT</td><td>Database type</td><td>postgres</td></tr>
                    <tr><td>JWT_ACCESS_SECRET</td><td>JWT secret key</td><td>-</td></tr>
                    <tr><td>BACKUP_SCHEDULER</td><td>Backup cron</td><td>0 0 * * *</td></tr>
                    <tr><td>REDIS_HOST</td><td>Redis host</td><td>localhost</td></tr>
                    <tr><td>RABBITMQ_URL</td><td>RabbitMQ connection URL</td><td>amqp://localhost:5672</td></tr>
                </tbody>
            </table>
        </div>

        <div id="database-schema">
            <h2>5. Database Schema</h2>
            <p>The application uses Sequelize ORM with 12 core models for multi-tenant data management.</p>
            <div class="illustration-container">
                ${embedSVG(path.join(ILLUSTRATIONS_DIR, "04-database-schema.svg"))}
                <p class="illustration-caption">Figure 4: Database Schema - Entity Relationship Diagram</p>
            </div>
            <h3>Core Models</h3>
            <table>
                <thead><tr><th>Model</th><th>Purpose</th><th>Key Fields</th></tr></thead>
                <tbody>
                    <tr><td>Users</td><td>User accounts</td><td>username, email, password, roleId</td></tr>
                    <tr><td>Tenants</td><td>Organizations</td><td>name, code, status, maxUsers</td></tr>
                    <tr><td>Permissions</td><td>System permissions</td><td>name, module, action</td></tr>
                    <tr><td>Roles</td><td>Global roles</td><td>name, roleLevel (1-3)</td></tr>
                    <tr><td>Sessions</td><td>User sessions</td><td>token, userId, expiredAt</td></tr>
                    <tr><td>TenantFeatures</td><td>Feature flags</td><td>tenantId, featureKey, isEnabled</td></tr>
                </tbody>
            </table>
        </div>

        <div id="authentication">
            <h2>6. Authentication</h2>
            <p>JWT-based authentication with access and refresh tokens, session management, and email verification.</p>
            <div class="illustration-container">
                ${embedSVG(path.join(ILLUSTRATIONS_DIR, "02-authentication-flow.svg"))}
                <p class="illustration-caption">Figure 5: Authentication Flow - Registration, login, and JWT structure</p>
            </div>
            <h3>Authentication Endpoints</h3>
            <table>
                <thead><tr><th>Method</th><th>Endpoint</th><th>Description</th></tr></thead>
                <tbody>
                    <tr><td>POST</td><td>/api/v1/auth/register</td><td>Register new user</td></tr>
                    <tr><td>GET</td><td>/api/v1/auth/activation</td><td>Activate account</td></tr>
                    <tr><td>POST</td><td>/api/v1/auth/login</td><td>Login</td></tr>
                    <tr><td>POST</td><td>/api/v1/auth/send-otp</td><td>Send OTP</td></tr>
                    <tr><td>POST</td><td>/api/v1/auth/logout</td><td>Logout</td></tr>
                </tbody>
            </table>
        </div>

        <div id="authorization">
            <h2>7. Authorization</h2>
            <p>Dual authorization system combining Role-Based (RBAC) and Attribute-Based (ABAC) access control.</p>
            <div class="illustration-container">
                ${embedSVG(path.join(ILLUSTRATIONS_DIR, "03-rbac-abac.svg"))}
                <p class="illustration-caption">Figure 6: RBAC & ABAC - Role hierarchy and permission types</p>
            </div>
            <h3>Role Levels</h3>
            <table>
                <thead><tr><th>Role</th><th>Level</th><th>Access</th></tr></thead>
                <tbody>
                    <tr><td>SUPER_ADMIN</td><td>3</td><td>Full system access, all tenants</td></tr>
                    <tr><td>TENANT_ADMIN</td><td>2</td><td>Manage users within their tenant</td></tr>
                    <tr><td>USER</td><td>1</td><td>Manage own profile only</td></tr>
                </tbody>
            </table>
        </div>

        <div id="multi-tenancy">
            <h2>8. Multi-Tenancy</h2>
            <p>Complete multi-tenant architecture with identification, scoping, and feature flags.</p>
            <div class="illustration-container">
                ${embedSVG(path.join(ILLUSTRATIONS_DIR, "07-multi-tenancy.svg"))}
                <p class="illustration-caption">Figure 7: Multi-Tenancy - Tenant identification and isolation</p>
            </div>
            <h3>Tenant Identification (Priority Order)</h3>
            <ol>
                <li><code>X-Tenant-Code</code> header</li>
                <li><code>X-Tenant-ID</code> header</li>
                <li>Subdomain extraction (e.g., acme.api.example.com)</li>
                <li>Query parameters (<code>?tenantCode=</code>)</li>
            </ol>
        </div>

        <div id="api-endpoints">
            <h2>9. API Endpoints</h2>
            <p>RESTful API with Swagger/OpenAPI documentation available at <code>/docs</code>.</p>
            <div class="illustration-container">
                ${embedSVG(path.join(ILLUSTRATIONS_DIR, "06-api-endpoints.svg"))}
                <p class="illustration-caption">Figure 8: API Endpoints - Complete endpoint reference</p>
            </div>
        </div>

        <div id="middlewares">
            <h2>10. Middlewares</h2>
            <p>Comprehensive middleware stack for security, validation, and tenant management.</p>
            <div class="illustration-container">
                ${embedSVG(path.join(ILLUSTRATIONS_DIR, "05-middleware-pipeline.svg"))}
                <p class="illustration-caption">Figure 9: Middleware Pipeline - Request processing flow</p>
            </div>
            <h3>Key Middlewares</h3>
            <table>
                <thead><tr><th>Middleware</th><th>Purpose</th></tr></thead>
                <tbody>
                    <tr><td>auth</td><td>JWT authentication & session validation</td></tr>
                    <tr><td>rbac</td><td>Role-based access control</td></tr>
                    <tr><td>abac</td><td>Attribute-based access control</td></tr>
                    <tr><td>tenantContext</td><td>Tenant identification</td></tr>
                    <tr><td>tenantScope</td><td>Query scoping for tenant isolation</td></tr>
                    <tr><td>tokenRateLimiter</td><td>Rate limiting with token bucket</td></tr>
                </tbody>
            </table>
        </div>

        <div id="backup-recovery">
            <h2>11. Backup & Recovery</h2>
            <p>Automated backup system for both system data and individual tenant data.</p>
            <table>
                <thead><tr><th>Type</th><th>Schedule</th><th>Description</th></tr></thead>
                <tbody>
                    <tr><td>System Backup</td><td>Daily midnight</td><td>Zips data and log directories</td></tr>
                    <tr><td>Session Cleanup</td><td>Daily 2 AM</td><td>Removes expired sessions</td></tr>
                    <tr><td>Tenant Backup</td><td>On-demand</td><td>Export tenant data to ZIP</td></tr>
                </tbody>
            </table>
        </div>

        <div id="logging">
            <h2>12. Logging</h2>
            <p>Winston-based logging with daily rotation and multiple transport levels.</p>
            <div class="illustration-container">
                ${embedSVG(path.join(ILLUSTRATIONS_DIR, "08-backup-logging.svg"))}
                <p class="illustration-caption">Figure 10: Backup & Logging - System backup and logging architecture</p>
            </div>
        </div>

        <div id="security">
            <h2>13. Security</h2>
            <p>Multi-layered security approach protecting against common web vulnerabilities.</p>
            <div class="illustration-container">
                ${embedSVG(path.join(ILLUSTRATIONS_DIR, "09-security-layers.svg"))}
                <p class="illustration-caption">Figure 11: Security Layers - Defense in depth</p>
            </div>
            <h3>Security Features</h3>
            <table>
                <thead><tr><th>Feature</th><th>Implementation</th></tr></thead>
                <tbody>
                    <tr><td>Helmet</td><td>Security headers (XSS, clickjacking)</td></tr>
                    <tr><td>CORS</td><td>Origin whitelist configuration</td></tr>
                    <tr><td>HPP</td><td>HTTP Parameter Pollution prevention</td></tr>
                    <tr><td>Rate Limiting</td><td>Token bucket + IP-based</td></tr>
                    <tr><td>JWT</td><td>Signed access & refresh tokens</td></tr>
                    <tr><td>Bcrypt</td><td>Password hashing with salt</td></tr>
                    <tr><td>Sanitization</td><td>XSS input filtering</td></tr>
                </tbody>
            </table>
        </div>

        <div id="testing">
            <h2>14. Testing</h2>
            <p>Jest-based test suite covering services, utilities, and validators.</p>
            <pre><code># Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage</code></pre>
        </div>

        <div id="deployment">
            <h2>15. Deployment</h2>
            <p>Containerized deployment with Docker Compose for development and production.</p>
            <h3>Deployment Checklist</h3>
            <ul>
                <li>Set <code>NODE_ENV=production</code></li>
                <li>Update all secrets in environment variables</li>
                <li>Configure production database</li>
                <li>Set up SSL/TLS</li>
                <li>Configure CORS origins</li>
                <li>Run database migrations</li>
                <li>Seed initial data</li>
            </ul>
        </div>

        </div>

        <div id="illustrations">
            <h2>Illustrations Gallery</h2>
            <p>Complete collection of system illustrations and diagrams.</p>
            
            <div id="fig-system-architecture">
                <h3>Figure 1: System Architecture</h3>
                <div class="illustration-container">
                    ${embedSVG(path.join(ILLUSTRATIONS_DIR, "01-system-architecture.svg"))}
                    <p class="illustration-caption">Three-tier architecture: Client Layer, Application Layer, and Data Layer</p>
                </div>
            </div>
            
            <div id="fig-authentication-flow">
                <h3>Figure 2: Authentication Flow</h3>
                <div class="illustration-container">
                    ${embedSVG(path.join(ILLUSTRATIONS_DIR, "02-authentication-flow.svg"))}
                    <p class="illustration-caption">Complete authentication lifecycle from registration to token refresh</p>
                </div>
            </div>
            
            <div id="fig-rbac-abac">
                <h3>Figure 3: RBAC & ABAC Authorization</h3>
                <div class="illustration-container">
                    ${embedSVG(path.join(ILLUSTRATIONS_DIR, "03-rbac-abac.svg"))}
                    <p class="illustration-caption">Dual authorization model with role hierarchy and attribute conditions</p>
                </div>
            </div>
            
            <div id="fig-database-schema">
                <h3>Figure 4: Database Schema</h3>
                <div class="illustration-container">
                    ${embedSVG(path.join(ILLUSTRATIONS_DIR, "04-database-schema.svg"))}
                    <p class="illustration-caption">Entity relationship diagram showing 12 core models and their relationships</p>
                </div>
            </div>
            
            <div id="fig-middleware-pipeline">
                <h3>Figure 5: Middleware Pipeline</h3>
                <div class="illustration-container">
                    ${embedSVG(path.join(ILLUSTRATIONS_DIR, "05-middleware-pipeline.svg"))}
                    <p class="illustration-caption">Request processing flow through the middleware stack</p>
                </div>
            </div>
            
            <div id="fig-api-endpoints">
                <h3>Figure 6: API Endpoints</h3>
                <div class="illustration-container">
                    ${embedSVG(path.join(ILLUSTRATIONS_DIR, "06-api-endpoints.svg"))}
                    <p class="illustration-caption">Complete RESTful API endpoint reference organized by module</p>
                </div>
            </div>
            
            <div id="fig-multi-tenancy">
                <h3>Figure 7: Multi-Tenancy Architecture</h3>
                <div class="illustration-container">
                    ${embedSVG(path.join(ILLUSTRATIONS_DIR, "07-multi-tenancy.svg"))}
                    <p class="illustration-caption">Tenant identification, isolation, and feature management</p>
                </div>
            </div>
            
            <div id="fig-backup-logging">
                <h3>Figure 8: Backup & Logging System</h3>
                <div class="illustration-container">
                    ${embedSVG(path.join(ILLUSTRATIONS_DIR, "08-backup-logging.svg"))}
                    <p class="illustration-caption">Automated backup scheduling and Winston logging architecture</p>
                </div>
            </div>
            
            <div id="fig-security-layers">
                <h3>Figure 9: Security Layers</h3>
                <div class="illustration-container">
                    ${embedSVG(path.join(ILLUSTRATIONS_DIR, "09-security-layers.svg"))}
                    <p class="illustration-caption">Defense in depth: Helmet, CORS, HPP, Rate Limiting, JWT, Bcrypt</p>
                </div>
            </div>
            
            <div id="fig-project-structure">
                <h3>Figure 10: Project Structure</h3>
                <div class="illustration-container">
                    ${embedSVG(path.join(ILLUSTRATIONS_DIR, "10-project-structure.svg"))}
                    <p class="illustration-caption">Organized source tree with controllers, services, models, and middlewares</p>
                </div>
            </div>
            
            <div id="fig-docker-architecture">
                <h3>Figure 11: Docker Architecture</h3>
                <div class="illustration-container">
                    ${embedSVG(path.join(ILLUSTRATIONS_DIR, "11-docker-architecture.svg"))}
                    <p class="illustration-caption">Containerized deployment with app, database, and cache services</p>
                </div>
            </div>
        </div>

        <hr>
        <footer style="text-align:center;padding:30px 0;color:var(--text-light);font-size:14px;">
            <p>Generated on ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
            <p>Boilerplate PG MySQL - Enterprise Multi-Tenant Express.js Boilerplate</p>
        </footer>
    </main>
    
    <a href="#" class="back-to-top" id="backToTop">Up</a>
    
    <script>
        const backToTop = document.getElementById('backToTop');
        window.addEventListener('scroll', () => {
            backToTop.classList.toggle('visible', window.scrollY > 300);
        });
        
        const sections = document.querySelectorAll('[id]');
        const navLinks = document.querySelectorAll('.sidebar-nav a');
        window.addEventListener('scroll', () => {
            let current = '';
            sections.forEach(section => {
                if (window.scrollY >= section.offsetTop - 100) {
                    current = section.getAttribute('id');
                }
            });
            navLinks.forEach(link => {
                link.classList.toggle('active', link.getAttribute('href') === '#' + current);
            });
        });
        
        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth <= 768) {
                    document.querySelector('.sidebar').classList.remove('open');
                }
            });
        });
    </script>
</body>
</html>`;

// Write HTML file
fs.writeFileSync(HTML_OUTPUT, htmlContent, "utf-8");

console.log(`\nHTML documentation generated!`);
console.log(`   Path: ${HTML_OUTPUT}`);
console.log(`   Size: ${Math.round(htmlContent.length / 1024)} KB`);
console.log(`\nOpen in browser: ${HTML_OUTPUT}`);
