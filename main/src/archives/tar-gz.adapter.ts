import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { isPortablePathSegment } from '../utils/portable-path.util.js';
import { ArchiveError } from './archive.error.js';
import type { TarEntry, TarGzOptions, TarManifest } from './archives.types.js';

const BLOCK = 512;
const MAX_ENTRIES = 100_000;
const MAX_METADATA_BYTES = 1024 * 1024;

/** Pulls exact byte ranges from a decompressed stream without buffering file bodies. */
class TarReader {
    readonly #chunks: AsyncIterator<Buffer>;
    #pending: Buffer = Buffer.alloc(0);

    /** @param chunks - Decompressed archive chunks. */
    constructor(chunks: AsyncIterator<Buffer>) {
        this.#chunks = chunks;
    }

    /** Appends the next chunk; false at end of stream. */
    async #fill(): Promise<boolean> {
        const next = await this.#chunks.next();
        if (next.done) return false;
        this.#pending = this.#pending.length
            ? Buffer.concat([this.#pending, next.value])
            : next.value;
        return true;
    }

    /** Reads exactly `size` bytes; null only at a clean end of stream.
     * @param size - Byte count.
     */
    async read(size: number): Promise<Buffer | null> {
        while (this.#pending.length < size) {
            if (await this.#fill()) continue;
            if (!this.#pending.length) return null;
            throw new ArchiveError('corrupt');
        }
        const value = this.#pending.subarray(0, size);
        this.#pending = this.#pending.subarray(size);
        return value;
    }

    /** Yields the next `size` bytes as they arrive.
     * @param size - Byte count.
     */
    async *body(size: number): AsyncGenerator<Buffer> {
        let remaining = size;
        while (remaining > 0) {
            if (!this.#pending.length && !(await this.#fill()))
                throw new ArchiveError('corrupt');
            const piece = this.#pending.subarray(0, remaining);
            this.#pending = this.#pending.subarray(piece.length);
            remaining -= piece.length;
            yield piece;
        }
    }

    /** Discards the next `size` bytes.
     * @param size - Byte count.
     * @param signal - Optional cancellation.
     */
    async skip(size: number, signal?: AbortSignal): Promise<void> {
        for await (const _piece of this.body(size)) signal?.throwIfAborted();
    }

    /** Consumes the rest of the stream so gzip trailers are verified.
     * @param signal - Optional cancellation.
     */
    async drain(signal?: AbortSignal): Promise<void> {
        this.#pending = Buffer.alloc(0);
        while (!(await this.#chunks.next()).done) signal?.throwIfAborted();
    }
}

/** Bytes needed to pad a body to the block size.
 * @param size - Body size.
 */
function padding(size: number): number {
    return (BLOCK - (size % BLOCK)) % BLOCK;
}

/** Decodes a NUL-terminated header string.
 * @param block - Header block.
 * @param start - Field offset.
 * @param length - Field width.
 */
function text(block: Buffer, start: number, length: number): string {
    const field = block.subarray(start, start + length);
    const end = field.indexOf(0);
    return field.subarray(0, end < 0 ? length : end).toString('utf8');
}

/** Parses an octal or GNU base-256 numeric header field.
 * @param block - Header block.
 * @param start - Field offset.
 * @param length - Field width.
 */
function numeric(block: Buffer, start: number, length: number): number {
    const field = block.subarray(start, start + length);
    let value: number;
    if (field[0] & 0x80) {
        if (field[0] === 0xff) throw new ArchiveError('corrupt');
        value = field[0] & 0x7f;
        for (const byte of field.subarray(1)) value = value * 256 + byte;
    } else {
        const digits = field.toString('latin1').split('\0')[0].trim();
        if (!/^[0-7]*$/.test(digits)) throw new ArchiveError('corrupt');
        value = digits ? Number.parseInt(digits, 8) : 0;
    }
    if (!Number.isSafeInteger(value)) throw new ArchiveError('unsafe');
    return value;
}

/** Parses a pax decimal size.
 * @param value - Untrusted record value.
 */
function decimal(value: string): number {
    if (!/^\d+$/.test(value)) throw new ArchiveError('corrupt');
    const size = Number(value);
    if (!Number.isSafeInteger(size)) throw new ArchiveError('unsafe');
    return size;
}

/** Validates the header checksum, accepting historic signed sums.
 * @param block - Header block.
 */
function checksumMatches(block: Buffer): boolean {
    const stored = numeric(block, 148, 8);
    let unsigned = 0;
    let signed = 0;
    for (let index = 0; index < BLOCK; index++) {
        const byte = index >= 148 && index < 156 ? 0x20 : block[index];
        unsigned += byte;
        signed += (byte << 24) >> 24;
    }
    return stored === unsigned || stored === signed;
}

/** Parses pax extended header records.
 * @param body - Extended header data.
 */
function paxRecords(body: Buffer): Map<string, string> {
    const records = new Map<string, string>();
    let offset = 0;
    while (offset < body.length) {
        const space = body.indexOf(0x20, offset);
        const length = space < 0 ? '' : body.toString('latin1', offset, space);
        if (!/^[1-9]\d*$/.test(length)) throw new ArchiveError('corrupt');
        const end = offset + Number(length);
        if (end > body.length || end <= space + 1 || body[end - 1] !== 0x0a)
            throw new ArchiveError('corrupt');
        const record = body.toString('utf8', space + 1, end - 1);
        const equals = record.indexOf('=');
        if (equals <= 0) throw new ArchiveError('corrupt');
        records.set(record.slice(0, equals), record.slice(equals + 1));
        offset = end;
    }
    return records;
}

/** Splits an archive-root-relative entry path into portable segments.
 * @param name - Untrusted entry or hardlink path.
 */
function entrySegments(name: string): string[] {
    if (name.includes('\\') || name.includes('\0') || name.startsWith('/'))
        throw new ArchiveError('unsafe');
    const relative = name.replace(/\/+$/, '').replace(/^(?:\.\/+)+/, '');
    if (!relative || relative === '.') return [];
    const segments = relative.split('/');
    if (!segments.every(isPortablePathSegment))
        throw new ArchiveError('unsafe');
    return segments;
}

/** Requires a relative symlink target that cannot leave the extraction root.
 * Leading `..` segments only climb real directories; descending segments may
 * cross in-tree symlinks, so `..` after them is refused.
 * @param link - Segments of the symlink entry.
 * @param target - Untrusted link target.
 */
function checkSymlinkTarget(link: readonly string[], target: string): void {
    if (
        !target ||
        target.includes('\\') ||
        target.includes('\0') ||
        target.startsWith('/')
    )
        throw new ArchiveError('unsafe');
    let depth = link.length - 1;
    let descended = false;
    for (const part of target.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') {
            if (descended || --depth < 0) throw new ArchiveError('unsafe');
        } else if (isPortablePathSegment(part)) descended = true;
        else throw new ArchiveError('unsafe');
    }
}

/** Case- and normalisation-folds a path for collision checks.
 * @param segments - Portable path segments.
 */
function fold(segments: readonly string[]): string {
    return segments.join('/').normalize('NFC').toLowerCase();
}

/** Maps a failure to the caller-facing archive error or abort reason.
 * @param error - Raw failure.
 * @param signal - Optional cancellation.
 */
function classify(error: unknown, signal: AbortSignal | undefined): unknown {
    if (signal?.aborted) return signal.reason;
    if (error instanceof ArchiveError) return error;
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (typeof code === 'string' && code.startsWith('Z_'))
        return new ArchiveError('corrupt', { cause: error });
    if (code === 'ENOSPC') return new ArchiveError('space', { cause: error });
    return new ArchiveError('unsafe', { cause: error });
}

/** Streams a gzip-compressed tar into an existing empty directory.
 * Rejects the whole archive on any unsafe entry; partial output is caller-owned.
 * @param archive - Absolute path to a regular .tar.gz file.
 * @param destination - Absolute path to an existing empty real directory.
 * @param options - Optional cancellation.
 */
export async function extractTarGz(
    archive: string,
    destination: string,
    options: TarGzOptions = {},
): Promise<TarManifest> {
    try {
        return await extract(archive, destination, options.signal);
    } catch (error) {
        throw classify(error, options.signal);
    }
}

/** Performs extraction; errors are classified by the caller.
 * @param archive - Archive path.
 * @param destination - Extraction root.
 * @param signal - Optional cancellation.
 */
async function extract(
    archive: string,
    destination: string,
    signal: AbortSignal | undefined,
): Promise<TarManifest> {
    signal?.throwIfAborted();
    if (!path.isAbsolute(archive) || !path.isAbsolute(destination))
        throw new ArchiveError('unsafe');
    const [source, root] = await Promise.all([
        fs.promises.lstat(archive),
        fs.promises.lstat(destination),
    ]);
    if (
        !source.isFile() ||
        source.isSymbolicLink() ||
        !root.isDirectory() ||
        root.isSymbolicLink()
    )
        throw new ArchiveError('unsafe');
    if ((await fs.promises.readdir(destination)).length)
        throw new ArchiveError('unsafe');
    signal?.throwIfAborted();

    const input = fs.createReadStream(archive);
    const gunzip = createGunzip();
    input.on('error', (error) => gunzip.destroy(error));
    input.pipe(gunzip);
    const abort = () => gunzip.destroy(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const reader = new TarReader(gunzip[Symbol.asyncIterator]());
    const kinds = new Map<string, TarEntry['kind']>();
    const directoryModes = new Map<string, number>();
    const entries: TarEntry[] = [];

    /** Creates missing directories below the root, refusing non-directories and links.
     * @param segments - Directory path segments.
     */
    const ensureDirectories = async (segments: readonly string[]) => {
        let current = destination;
        for (let index = 0; index < segments.length; index++) {
            current = path.join(current, segments[index]);
            const stat = await fs.promises.lstat(current).catch((error) => {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                    return undefined;
                throw error;
            });
            if (!stat) {
                await fs.promises.mkdir(current, { mode: 0o755 });
                directoryModes.set(current, 0o755);
                kinds.set(fold(segments.slice(0, index + 1)), 'directory');
            } else if (!stat.isDirectory() || stat.isSymbolicLink())
                throw new ArchiveError('unsafe');
        }
    };

    try {
        let pax: Map<string, string> | undefined;
        let longName: string | undefined;
        let longLink: string | undefined;
        for (;;) {
            signal?.throwIfAborted();
            const header = await reader.read(BLOCK);
            if (!header) break;
            if (header.every((byte) => byte === 0)) {
                const next = await reader.read(BLOCK);
                if (next && !next.every((byte) => byte === 0))
                    throw new ArchiveError('corrupt');
                break;
            }
            if (!checksumMatches(header)) throw new ArchiveError('corrupt');
            const type = String.fromCharCode(header[156]);
            const headerSize = numeric(header, 124, 12);
            if (type === 'x' || type === 'g' || type === 'L' || type === 'K') {
                if (headerSize > MAX_METADATA_BYTES)
                    throw new ArchiveError('unsafe');
                const body = await reader.read(headerSize);
                if (!body) throw new ArchiveError('corrupt');
                await reader.skip(padding(headerSize));
                if (type === 'x') pax = paxRecords(body);
                else if (type === 'L') longName = text(body, 0, body.length);
                else if (type === 'K') longLink = text(body, 0, body.length);
                continue;
            }

            const name = text(header, 0, 100);
            const prefix =
                header.toString('latin1', 257, 263) === 'ustar\0'
                    ? text(header, 345, 155)
                    : '';
            const entryName =
                pax?.get('path') ??
                longName ??
                (prefix ? `${prefix}/${name}` : name);
            const link =
                pax?.get('linkpath') ?? longLink ?? text(header, 157, 100);
            const paxSize = pax?.get('size');
            const size = paxSize === undefined ? headerSize : decimal(paxSize);
            pax = longName = longLink = undefined;
            const mode = numeric(header, 100, 8) & 0o777;

            let kind: TarEntry['kind'];
            if (type === '0' || type === '\0')
                kind = entryName.endsWith('/') ? 'directory' : 'file';
            else if (type === '5') kind = 'directory';
            else if (type === '2') kind = 'symlink';
            else if (type === '1') kind = 'hardlink';
            else throw new ArchiveError('unsafe');
            if (entries.length >= MAX_ENTRIES) throw new ArchiveError('unsafe');

            const segments = entrySegments(entryName);
            if (!segments.length) {
                // `./` names the extraction root itself; nothing else may be empty.
                if (kind !== 'directory' || !entryName)
                    throw new ArchiveError('unsafe');
                await reader.skip(size + padding(size), signal);
                continue;
            }
            for (let index = 1; index < segments.length; index++) {
                const parent = kinds.get(fold(segments.slice(0, index)));
                if (parent && parent !== 'directory')
                    throw new ArchiveError('unsafe');
            }
            const key = fold(segments);
            const existing = kinds.get(key);
            if (existing && (existing !== 'directory' || kind !== 'directory'))
                throw new ArchiveError('unsafe');
            const target = path.join(destination, ...segments);
            let linkTarget: string | undefined;

            if (kind === 'directory') {
                await ensureDirectories(segments);
                directoryModes.set(target, mode);
            } else {
                await ensureDirectories(segments.slice(0, -1));
                if (kind === 'file') {
                    await pipeline(
                        Readable.from(reader.body(size)),
                        fs.createWriteStream(target, { flags: 'wx', mode }),
                        { signal },
                    );
                    // Explicit chmod so umask cannot strip executable bits.
                    await fs.promises.chmod(target, mode);
                } else if (kind === 'symlink') {
                    checkSymlinkTarget(segments, link);
                    linkTarget = link;
                    await fs.promises.symlink(link, target);
                } else {
                    const linked = entrySegments(link);
                    const linkedKind = kinds.get(fold(linked));
                    if (
                        !linked.length ||
                        (linkedKind !== 'file' && linkedKind !== 'hardlink')
                    )
                        throw new ArchiveError('unsafe');
                    linkTarget = linked.join('/');
                    await fs.promises.link(
                        path.join(destination, ...linked),
                        target,
                    );
                }
            }
            await reader.skip(
                (kind === 'file' ? 0 : size) + padding(size),
                signal,
            );
            kinds.set(key, kind);
            entries.push({
                path: segments.join('/'),
                kind,
                mode,
                sizeBytes: kind === 'file' ? size : 0,
                ...(linkTarget === undefined ? {} : { linkTarget }),
            });
        }
        await reader.drain(signal);
        // Deepest first, so restrictive parent modes cannot block later chmods.
        const directories = [...directoryModes].sort(
            ([left], [right]) => right.length - left.length,
        );
        for (const [directory, mode] of directories)
            await fs.promises.chmod(directory, mode);
        signal?.throwIfAborted();
        return { entries };
    } finally {
        signal?.removeEventListener('abort', abort);
        input.destroy();
        gunzip.destroy();
    }
}
