import { describe, it, expect } from 'vitest';
import { ConductorError, ERRORS, createError } from '../src/core/errors.js';

describe('ConductorError', () => {
  it('extends Error', () => {
    const e = new ConductorError({ code: 'TEST-001', message: 'test' });
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ConductorError);
  });

  it('sets name to ConductorError', () => {
    const e = new ConductorError({ code: 'X', message: 'y' });
    expect(e.name).toBe('ConductorError');
  });

  it('stores code and message', () => {
    const e = new ConductorError({ code: 'COND-AUTH-001', message: 'Auth failed' });
    expect(e.code).toBe('COND-AUTH-001');
    expect(e.message).toBe('Auth failed');
  });

  it('stores optional fix and details', () => {
    const e = new ConductorError({
      code: 'X',
      message: 'msg',
      fix: 'do this',
      details: { extra: 'info' },
    });
    expect(e.fix).toBe('do this');
    expect(e.details).toEqual({ extra: 'info' });
  });

  it('toJSON returns all fields', () => {
    const e = new ConductorError({ code: 'C', message: 'M', fix: 'F', details: { d: 1 } });
    const json = e.toJSON();
    expect(json).toEqual({ code: 'C', message: 'M', fix: 'F', details: { d: 1 } });
  });

  it('toJSON omits undefined fix/details', () => {
    const e = new ConductorError({ code: 'C', message: 'M' });
    const json = e.toJSON();
    expect(json.fix).toBeUndefined();
    expect(json.details).toBeUndefined();
  });
});

describe('ERRORS constants', () => {
  it('has all expected categories', () => {
    const codes = Object.values(ERRORS).map((e) => e.code);
    expect(codes.some((c) => c.startsWith('COND-AUTH'))).toBe(true);
    expect(codes.some((c) => c.startsWith('COND-NET'))).toBe(true);
    expect(codes.some((c) => c.startsWith('COND-SEC'))).toBe(true);
    expect(codes.some((c) => c.startsWith('COND-CFG'))).toBe(true);
    expect(codes.some((c) => c.startsWith('COND-MCP'))).toBe(true);
    expect(codes.some((c) => c.startsWith('COND-PLG'))).toBe(true);
    expect(codes.some((c) => c.startsWith('COND-DB'))).toBe(true);
    expect(codes.some((c) => c.startsWith('COND-SYS'))).toBe(true);
  });

  it('AUTH_TOKEN_MISSING has correct code', () => {
    expect(ERRORS.AUTH_TOKEN_MISSING.code).toBe('COND-AUTH-001');
  });

  it('all errors have code and message', () => {
    for (const [key, err] of Object.entries(ERRORS)) {
      expect(err.code, `${key} missing code`).toBeTruthy();
      expect(err.message, `${key} missing message`).toBeTruthy();
    }
  });

  it('all codes are unique', () => {
    const codes = Object.values(ERRORS).map((e) => e.code);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });
});

describe('createError', () => {
  it('creates a ConductorError from error definition', () => {
    const err = createError(ERRORS.AUTH_TOKEN_MISSING as unknown as ConductorError);
    expect(err).toBeInstanceOf(ConductorError);
    expect(err.code).toBe('COND-AUTH-001');
  });

  it('interpolates variables in message', () => {
    const err = createError(ERRORS.NET_TIMEOUT as unknown as ConductorError, { timeout: '5000' });
    expect(err.message).toContain('5000');
    expect(err.message).not.toContain('{timeout}');
  });

  it('interpolates variables in fix', () => {
    const err = createError(ERRORS.NET_RATE_LIMITED as unknown as ConductorError, {
      service: 'GitHub',
      retryAfter: '30',
    });
    expect(err.fix).toContain('30');
    expect(err.fix).not.toContain('{retryAfter}');
  });

  it('handles multiple variable substitutions', () => {
    const err = createError(ERRORS.SEC_COMMAND_BLOCKED as unknown as ConductorError, { command: 'rm -rf /' });
    expect(err.message).toContain('rm -rf /');
  });

  it('works without variables', () => {
    const err = createError(ERRORS.AUTH_TOKEN_MISSING as unknown as ConductorError);
    expect(err.message).toBe(ERRORS.AUTH_TOKEN_MISSING.message);
  });

  it('handles numeric variables', () => {
    const err = createError(ERRORS.NET_TIMEOUT as unknown as ConductorError, { timeout: 3000 });
    expect(err.message).toContain('3000');
  });

  it('preserves error code from definition', () => {
    const err = createError(ERRORS.MCP_CIRCUIT_OPEN as unknown as ConductorError, {
      tool: 'shell.exec',
      retryAfter: '60',
    });
    expect(err.code).toBe('COND-MCP-002');
  });
});
