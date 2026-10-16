import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractTarGz } from './tar-gz.adapter.js';

type Member = {
    name: string;
    type?: string;
    mode?: number;
    body?: Buffer | string;
    linkname?: string;
    prefix?: string;
    /** Encodes the size field in GNU base-256 instead of octal. */
    base256Size?: boolean;
    /** Damages the header after its checksum has been computed. */
    corrupt?: boolean;
};

/** Writes one ustar header plus its padded body. */
function member(entry: Member): Buffer {
    const body = Buffer.from(entry.body ?? '');
    const header = Buffer.alloc(512);
    const octal = (value: number, width: number) =>
        `${value.toString(8).padStart(width - 1, '0')}\0`;
    header.write(entry.name, 0, 100, 'utf8');
    header.write(octal(entry.mode ?? 0o644, 8), 100, 'latin1');
    header.write(octal(0, 8), 108, 'latin1');
    header.write(octal(0, 8), 116, 'latin1');
    if (entry.base256Size) {
        header[124] = 0x80;
        header.writeUIntBE(body.length, 136 - 6, 6);
    } else header.write(octal(body.length, 12), 124, 'latin1');
    header.write(octal(0, 12), 136, 'latin1');
    header.fill(0x20, 148, 156);
    header.write(entry.type ?? '0', 156, 'latin1');
    header.write(entry.linkname ?? '', 157, 100, 'utf8');
    header.write('ustar\u000000', 257, 'latin1');
    header.write(entry.prefix ?? '', 345, 155, 'utf8');
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
    if (entry.corrupt) header[0] ^= 1;
    const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
    return Buffer.concat([header, body, padding]);
}

/** Encodes pax extended header records with self-describing lengths. */
function pax(records: Record<string, string>): Buffer {
    return Buffer.concat(
        Object.entries(records).map(([key, value]) => {
            const payload = ` ${key}=${value}\n`;
            const bytes = Buffer.byteLength(payload);
            let length = bytes + 1;
            while (String(length).length + bytes !== length) length++;
            return Buffer.from(`${length}${payload}`);
        }),
    );
}

/** Gzips members followed by the two-block end marker. */
function tarGz(members: Member[], end = true): Buffer {
    return gzipSync(
        Buffer.concat([...members.map(member), Buffer.alloc(end ? 1024 : 0)]),
    );
}

let root: string;
let archive: string;
let destination: string;
beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tar-gz-test-'));
    archive = path.join(root, 'editor.tar.gz');
    destination = path.join(root, 'out');
    await fs.promises.mkdir(destination);
});
afterEach(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
});

/** Writes an archive and extracts it into the empty destination. */
async function extract(members: Member[], signal?: AbortSignal) {
    await fs.promises.writeFile(archive, tarGz(members));
    return extractTarGz(archive, destination, { signal });
}
const modeOf = async (relative: string) =>
    (await fs.promises.stat(path.join(destination, relative))).mode & 0o777;

describe('tar.gz extraction', () => {
    it('extracts files and directories, preserving permission bits', async () => {
        const manifest = await extract([
            { name: 'GodotSharp/', type: '5', mode: 0o755 },
            {
                name: 'godot.linuxbsd.editor.x86_64.mono',
                mode: 0o755,
                body: '#!/bin/sh\n',
            },
            { name: 'GodotSharp/Api/GodotSharp.dll', body: 'dll' },
            { name: './README.txt', mode: 0o4755, body: 'readme' },
            { name: 'big.bin', body: 'x'.repeat(1000), base256Size: true },
        ]);
        expect(manifest.entries).toEqual([
            {
                path: 'GodotSharp',
                kind: 'directory',
                mode: 0o755,
                sizeBytes: 0,
            },
            {
                path: 'godot.linuxbsd.editor.x86_64.mono',
                kind: 'file',
                mode: 0o755,
                sizeBytes: 10,
            },
            {
                path: 'GodotSharp/Api/GodotSharp.dll',
                kind: 'file',
                mode: 0o644,
                sizeBytes: 3,
            },
            { path: 'README.txt', kind: 'file', mode: 0o755, sizeBytes: 6 },
            { path: 'big.bin', kind: 'file', mode: 0o644, sizeBytes: 1000 },
        ]);
        expect(await modeOf('godot.linuxbsd.editor.x86_64.mono')).toBe(0o755);
        expect(await modeOf('GodotSharp/Api/GodotSharp.dll')).toBe(0o644);
        expect(await modeOf('GodotSharp/Api')).toBe(0o755);
        expect(await modeOf('README.txt')).toBe(0o755);
        expect(
            await fs.promises.readFile(
                path.join(destination, 'GodotSharp/Api/GodotSharp.dll'),
                'utf8',
            ),
        ).toBe('dll');
        expect(
            (await fs.promises.stat(path.join(destination, 'big.bin'))).size,
        ).toBe(1000);
    });
    it('reads long names from pax, GNU and ustar prefix headers', async () => {
        const deep = `${'a'.repeat(60)}/${'b'.repeat(60)}/${'c'.repeat(60)}`;
        const manifest = await extract([
            {
                name: 'PaxHeader',
                type: 'x',
                body: pax({ path: `${deep}.pax` }),
            },
            { name: 'truncated', body: 'pax' },
            { name: 'pax global', type: 'g', body: pax({ comment: 'x' }) },
            { name: '././@LongLink', type: 'L', body: `${deep}.gnu\0` },
            { name: 'truncated', body: 'gnu' },
            { name: 'file.txt', prefix: deep.slice(0, 121), body: 'ustar' },
        ]);
        expect(manifest.entries.map((entry) => entry.path)).toEqual([
            `${deep}.pax`,
            `${deep}.gnu`,
            `${deep.slice(0, 121)}/file.txt`,
        ]);
        expect(
            await fs.promises.readFile(
                path.join(destination, `${deep}.gnu`),
                'utf8',
            ),
        ).toBe('gnu');
    });
    it('accepts end of stream without end-of-archive blocks', async () => {
        await fs.promises.writeFile(
            archive,
            tarGz([{ name: 'a.txt', body: 'a' }], false),
        );
        await expect(extractTarGz(archive, destination)).resolves.toMatchObject(
            { entries: [{ path: 'a.txt' }] },
        );
    });
    it.each(['../evil', '/abs', 'a/../../x', 'a\\b', 'C:/x', 'CON', ''])(
        'rejects unsafe entry paths: %s',
        async (name) => {
            await expect(
                extract([{ name, body: 'evil' }]),
            ).rejects.toMatchObject({ code: 'unsafe' });
            expect(fs.existsSync(path.join(root, 'evil'))).toBe(false);
            expect(fs.existsSync('/abs')).toBe(false);
        },
    );
    it.each(['../outside', '/etc/passwd', 'sub/../../outside', ''])(
        'rejects escaping symlink targets: %s',
        async (linkname) => {
            await expect(
                extract([{ name: 'link', type: '2', linkname }]),
            ).rejects.toMatchObject({ code: 'unsafe' });
        },
    );
    it('rejects climbing out of a symlink inside a target', async () => {
        await expect(
            extract([
                { name: 'd/e/up', type: '2', linkname: '../..' },
                { name: 'd/e/escape', type: '2', linkname: 'up/../..' },
            ]),
        ).rejects.toMatchObject({ code: 'unsafe' });
    });
    it('allows in-tree relative symlinks', async () => {
        const manifest = await extract([
            { name: 'bin/godot', mode: 0o755, body: 'elf' },
            { name: 'lib/link', type: '2', linkname: '../bin/godot' },
        ]);
        expect(manifest.entries[1]).toMatchObject({
            kind: 'symlink',
            linkTarget: '../bin/godot',
        });
        expect(
            await fs.promises.readFile(
                path.join(destination, 'lib/link'),
                'utf8',
            ),
        ).toBe('elf');
    });
    it('rejects writing through a symlinked parent, even inside the tree', async () => {
        await expect(
            extract([
                { name: 'sub/', type: '5', mode: 0o755 },
                { name: 'link', type: '2', linkname: 'sub' },
                { name: 'link/x', body: 'through' },
            ]),
        ).rejects.toMatchObject({ code: 'unsafe' });
        expect(fs.existsSync(path.join(destination, 'sub/x'))).toBe(false);
    });
    it('links in-tree hardlinks and rejects escaping or dangling ones', async () => {
        const manifest = await extract([
            { name: 'a.txt', body: 'shared' },
            { name: 'b.txt', type: '1', linkname: './a.txt' },
        ]);
        expect(manifest.entries[1]).toMatchObject({
            kind: 'hardlink',
            linkTarget: 'a.txt',
        });
        const [a, b] = await Promise.all(
            ['a.txt', 'b.txt'].map((name) =>
                fs.promises.stat(path.join(destination, name)),
            ),
        );
        expect(b.ino).toBe(a.ino);
        for (const linkname of ['../editor.tar.gz', '/etc/passwd', 'missing']) {
            await fs.promises.rm(destination, { recursive: true });
            await fs.promises.mkdir(destination);
            await expect(
                extract([{ name: 'h', type: '1', linkname }]),
            ).rejects.toMatchObject({ code: 'unsafe' });
        }
    });
    it('rejects duplicate files and special entry types', async () => {
        await expect(
            extract([
                { name: 'a.txt', body: 'one' },
                { name: 'a.txt', body: 'two' },
            ]),
        ).rejects.toMatchObject({ code: 'unsafe' });
        for (const type of ['3', '4', '6', '7', 'Z']) {
            await fs.promises.rm(destination, { recursive: true });
            await fs.promises.mkdir(destination);
            await expect(
                extract([{ name: 'special', type }]),
            ).rejects.toMatchObject({ code: 'unsafe' });
        }
    });
    it('reports bad header checksums and truncated gzip data as corrupt', async () => {
        await expect(
            extract([{ name: 'a.txt', body: 'a', corrupt: true }]),
        ).rejects.toMatchObject({ code: 'corrupt' });
        const whole = tarGz([{ name: 'a.txt', body: 'a'.repeat(4096) }]);
        await fs.promises.writeFile(
            archive,
            whole.subarray(0, whole.length - 12),
        );
        await fs.promises.rm(destination, { recursive: true });
        await fs.promises.mkdir(destination);
        await expect(extractTarGz(archive, destination)).rejects.toMatchObject({
            code: 'corrupt',
        });
    });
    it('rethrows the abort reason when cancelled', async () => {
        const reason = new Error('cancelled');
        await expect(
            extract([{ name: 'a.txt', body: 'a' }], AbortSignal.abort(reason)),
        ).rejects.toBe(reason);
        expect(fs.existsSync(path.join(destination, 'a.txt'))).toBe(false);

        const controller = new AbortController();
        const size = 64 * 1024 * 1024;
        await fs.promises.writeFile(
            archive,
            tarGz([{ name: 'big.bin', body: Buffer.alloc(size) }]),
        );
        const pending = extractTarGz(archive, destination, {
            signal: controller.signal,
        });
        setImmediate(() => controller.abort(reason));
        await expect(pending).rejects.toBe(reason);
        const written = await fs.promises
            .stat(path.join(destination, 'big.bin'))
            .then((stat) => stat.size)
            .catch(() => 0);
        expect(written).toBeLessThan(size);
    });
    it('requires absolute paths and an empty real destination directory', async () => {
        await fs.promises.writeFile(path.join(destination, 'existing'), '');
        await expect(
            extract([{ name: 'a.txt', body: 'a' }]),
        ).rejects.toMatchObject({ code: 'unsafe' });
        await expect(
            extractTarGz('editor.tar.gz', destination),
        ).rejects.toMatchObject({ code: 'unsafe' });
        const linked = path.join(root, 'linked');
        await fs.promises.symlink(destination, linked);
        await expect(extractTarGz(archive, linked)).rejects.toMatchObject({
            code: 'unsafe',
        });
    });
});
