import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openApiDocument } from '../src/api/openapi.js';
import { VERSION } from '../src/version.js';

type Operation = Record<string, unknown>;

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch'] as const;

function specOperations(): string[] {
  const operations: string[] = [];
  for (const [path, methods] of Object.entries(
    openApiDocument.paths as Record<string, Record<string, Operation>>,
  )) {
    for (const method of Object.keys(methods)) {
      operations.push(`${method.toUpperCase()} ${path}`);
    }
  }
  return operations.sort();
}

function routeOperations(): string[] {
  const directory = join(process.cwd(), 'src/api/routes');
  const operations: string[] = [];
  for (const file of readdirSync(directory).filter((entry) => entry.endsWith('.ts'))) {
    const source = readFileSync(join(directory, file), 'utf8');
    for (const match of source.matchAll(/app\.(get|post|put|delete|patch)\(\s*'([^']+)'/g)) {
      operations.push(`${(match[1] ?? '').toUpperCase()} ${match[2] ?? ''}`);
    }
  }
  return operations.sort();
}

function collectRefs(value: unknown, refs: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === '$ref' && typeof entry === 'string') refs.add(entry);
    else collectRefs(entry, refs);
  }
}

describe('OpenAPI specification', () => {
  it('documents every registered API route', () => {
    expect(specOperations()).toEqual(routeOperations());
  });

  it('has complete operation metadata and resolvable refs', () => {
    const refs = new Set<string>();
    collectRefs(openApiDocument, refs);
    const schemas = new Set(Object.keys(openApiDocument.components.schemas));
    for (const reference of refs) {
      expect(reference.startsWith('#/components/schemas/')).toBe(true);
      expect(schemas.has(reference.replace('#/components/schemas/', ''))).toBe(true);
    }

    for (const methods of Object.values(
      openApiDocument.paths as Record<string, Record<string, Operation>>,
    )) {
      for (const operation of Object.values(methods)) {
        expect(operation.tags).toBeTruthy();
        expect(operation.summary).toBeTruthy();
        expect(operation.responses).toBeTruthy();
        const parameters = (operation.parameters ?? []) as Array<Record<string, unknown>>;
        const keys = parameters.map((parameter) => `${parameter.in}:${parameter.name}`);
        expect(new Set(keys).size).toBe(keys.length);
      }
    }
  });

  it('marks only the documented endpoints as public', () => {
    const publicRoutes = new Set([
      'GET /health',
      'GET /api/auth/methods',
      'POST /api/auth/login',
      'POST /api/auth/telegram/request',
      'POST /api/auth/telegram/check',
      'POST /api/auth/telegram/webapp',
      'GET /api/auth/me',
      'GET /api/youtube/oauth/callback',
    ]);
    for (const [path, methods] of Object.entries(
      openApiDocument.paths as Record<string, Record<string, Operation>>,
    )) {
      for (const [method, operation] of Object.entries(methods)) {
        const key = `${method.toUpperCase()} ${path}`;
        expect(operation.security).toEqual(publicRoutes.has(key) ? [] : undefined);
      }
    }
  });

  it('matches the version and the checked-in document', () => {
    expect(openApiDocument.info.version).toBe(VERSION);
    const checkedIn = JSON.parse(readFileSync(join(process.cwd(), 'docs/openapi.json'), 'utf8'));
    expect(checkedIn).toEqual(openApiDocument);
  });

  it('uses only supported HTTP methods', () => {
    for (const methods of Object.values(
      openApiDocument.paths as Record<string, Record<string, Operation>>,
    )) {
      for (const method of Object.keys(methods)) {
        expect(HTTP_METHODS).toContain(method as (typeof HTTP_METHODS)[number]);
      }
    }
  });
});
