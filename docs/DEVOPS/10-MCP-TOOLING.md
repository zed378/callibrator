# MCP Toolkit Setup Guide

This guide explains how to connect your MCP client to the MCP Toolkit gateway.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed and running
- An MCP-compatible client (e.g., Cline, Continue, or other MCP clients)

## Configuration

### SSE Configuration (Recommended for Cline)

The Docker MCP Toolkit gateway can expose an SSE endpoint that Cline connects to via HTTP.

**Get the SSE endpoint URL from Docker Desktop:**

1. Open Docker Desktop
2. Go to **MCP Toolkit → AI coding** profile
3. Look for the **SSE endpoint** or **Connection URL** in the UI
4. It will be in the format: `http://localhost:PORT/sse`

**Cline configuration (edit `%USERPROFILE%\.cline\mcp.json`):**

```json
{
  "mcpServers": {
    "mcp-toolkit": {
      "type": "sse",
      "url": "http://localhost:PORT/sse"
    }
  }
}
```

Replace `PORT` with the actual port shown in Docker Desktop (e.g., `3100`).

## Setup for Different Clients

### Cline (VS Code Extension)

The Docker MCP Toolkit gateway exposes an SSE endpoint that Cline can connect to via HTTP.

**Step 1: Start the MCP Gateway**

The gateway is already running in Docker Desktop under **MCP Toolkit → AI coding** profile.
Note the connection details shown in the Docker Desktop MCP Toolkit UI.

**Step 2: Get the SSE Endpoint URL**

The gateway exposes an SSE endpoint. Check the Docker Desktop MCP Toolkit UI for the connection URL, or it is typically:

```
http://localhost:3100/sse
```

**Step 3: Configure Cline**

1. Open VS Code Settings (`Ctrl + ,`)
2. Search for "Cline MCP" settings
3. Find the **MCP Servers** or **MCP Configuration** section
4. Switch to **SSE** mode (not STDIO)
5. Add the SSE endpoint URL: `http://localhost:3100/sse`

Alternatively, edit Cline's configuration file directly. Find it at:

- Windows: `%USERPROFILE%\.cline\mcp.json`

Add the following configuration:

```json
{
  "mcpServers": {
    "mcp-toolkit": {
      "type": "sse",
      "url": "http://localhost:3100/sse"
    }
  }
}
```

6. Restart Cline

**Verification:**

- In Docker Desktop MCP Toolkit UI, the "Clients" section should show "1 client connected"
- In Cline, the MCP tools (Context7, Sequential Thinking, Next.js DevTools, etc.) should appear

### Continue (VS Code Extension)

1. Open VS Code Settings (`Ctrl + ,`)
2. Search for "Continue" settings
3. Find the **MCP Servers** configuration
4. Add the server configuration as shown above

Or edit your `~/.continue/config.json` file directly:

```json
{
  "mcpServers": {
    "mcp-toolkit": {
      "command": "docker",
      "args": ["mcp", "gateway", "run", "--profile", "ai_coding"]
    }
  }
}
```

### Manual/Custom MCP Client

If your client supports a custom config file path, point it to:

- `@./mcp-config.json` (relative to this project)

## Verification

After configuring your MCP client:

1. Restart your MCP client / VS Code
2. Check the MCP client logs for successful connection to the gateway
3. Test by calling a tool from the MCP Toolkit

## Troubleshooting

### Docker not running

Ensure Docker Desktop (or Docker daemon) is running before starting your MCP client.

### Profile not found

The `--profile ai_coding` flag requires the `ai_coding` Docker profile to be configured. Create it if needed:

```bash
docker profile ls
docker profile create ai_coding  # if it doesn't exist
```

### MCP CLI not available

If `docker mcp` command is not recognized, ensure you have the latest Docker CLI with MCP support:

```bash
docker mcp --version
```

## Project Structure

```
Callibrator/
├── backend/           # Express.js backend
├── frontend/          # Next.js frontend
├── mcp-config.json    # MCP server configuration
└── MCP_SETUP.md       # This file
```
