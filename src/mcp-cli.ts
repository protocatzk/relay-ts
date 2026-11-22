#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/**
 * RELAY MCP CLI Stdio Wrapper
 *
 * Connects standard IO to RELAY either via local instances or remote API.
 * For local stdio setups with Claude Desktop, Cursor or Antigravity.
 */
async function runCli(): Promise<void> {
  const apiUrl = process.env.RELAY_URL || 'http://127.0.0.1:3000';
  const apiToken = process.env.RELAY_API_TOKEN || process.env.API_TOKEN || '';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiToken) {
    headers['Authorization'] = `Bearer ${apiToken}`;
  }

  // Use Stdio transport for client communication
  const transport = new StdioServerTransport();
  
  // Forward JSON-RPC messages via fetch or bridge
  process.stderr.write(`RELAY MCP Stdio Bridge active (Target: ${apiUrl})\n`);
  await transport.start();
}

void runCli();
