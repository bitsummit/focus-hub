import { createTestDatabase } from './postgres-fixture.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRuntime } from '../server/runtime.ts';
test('every server entry point can derive the exact Codespaces origin and secure cookies', () => {
    const config = resolveRuntime({ CODESPACES: 'true', CODESPACE_NAME: 'fictional-focus', GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev', PORT: '3000', COOKIE_SECURE: 'false' });
    assert.equal(config.origin, 'https://fictional-focus-3000.app.github.dev');
    assert.equal(config.secure, true);
    assert.equal(config.port, 3000);
    assert.equal(resolveRuntime({ CODESPACES: 'true', FOCUS_PUBLIC_ORIGIN: 'https://private.example.test/' }).origin, 'https://private.example.test');
    assert.equal(resolveRuntime({}).origin, undefined);
    assert.equal(resolveRuntime({}).secure, false);
});
test('invalid or incomplete server origin configuration fails instead of trusting arbitrary hosts', () => {
    for (const origin of ['https://private.example.test/path', 'https://name:password@private.example.test', 'https://private.example.test?token=invalid', 'http://private.example.test'])
        assert.throws(() => resolveRuntime({ CODESPACES: 'true', FOCUS_PUBLIC_ORIGIN: origin }));
    assert.throws(() => resolveRuntime({ CODESPACES: 'true' }));
    assert.throws(() => resolveRuntime({ CODESPACES: 'true', CODESPACE_NAME: 'fictional-focus', GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev/path' }));
    assert.throws(() => resolveRuntime({ PORT: 'invalid' }));
});
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createOwner } from '../server/auth.ts';
test('direct server startup in Codespaces accepts HTTPS login without the shell launcher', async () => {
    const reservation = createServer().listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const address = reservation.address();
    assert.ok(address && typeof address !== 'string');
    const port = address.port;
    await new Promise<void>((r) => reservation.close(() => r()));
    const dir = mkdtempSync(join(tmpdir(), 'focus-direct-start-')), path = join(dir, 'fixture.sqlite');
    const credentials = { email: 'direct-entry@example.test', password: randomBytes(24).toString('hex') };
    const fixtureDB = await createTestDatabase();
    const db = fixtureDB.db;
    (await createOwner(db, credentials));
    const child = spawn(process.execPath, ['--import', 'tsx', resolve('server/index.ts')], { env: { ...process.env, PORT: String(port), DATABASE_URL: fixtureDB.url, DATABASE_SCHEMA: fixtureDB.schema, CODESPACES: 'true', CODESPACE_NAME: 'fictional-focus', GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev', FOCUS_PUBLIC_ORIGIN: undefined, COOKIE_SECURE: undefined }, stdio: 'ignore' });
    try {
        const base = `http://127.0.0.1:${port}`, origin = `https://fictional-focus-${port}.app.github.dev`;
        let response: Response | undefined;
        for (let i = 0; i < 100; i++) {
            try {
                response = await fetch(base + '/api/health', { headers: { Origin: origin }, signal: AbortSignal.timeout(500) });
                break;
            }
            catch {
                await new Promise(r => setTimeout(r, 100));
            }
        }
        assert.equal(response?.status, 200, 'The real server entry point must configure Codespaces before handling requests');
        const challenge = await fetch(base + '/api/session/challenge', { headers: { Origin: origin } });
        assert.equal(challenge.status, 200);
        const { loginToken } = await challenge.json();
        const challengeCookie = challenge.headers.get('set-cookie')!.split(';')[0];
        const login = await fetch(base + '/api/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: challengeCookie, 'X-Login-CSRF': loginToken }, body: JSON.stringify(credentials) });
        assert.equal(login.status, 200);
        assert.match(login.headers.get('set-cookie') || '', /;\s*Secure(?:;|$)/);
    }
    finally {
        if (child.exitCode === null) {
            const exited = once(child, 'exit');
            child.kill('SIGTERM');
            await exited;
        }
        await fixtureDB.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
