/** Metadata for one validated ZIP entry; paths have no trailing slash. */
export type ZipEntry = {
    readonly path: string;
    readonly kind: 'file' | 'directory';
    readonly sizeBytes: number;
};
/** Declared expanded size and entry metadata, without third-party ZIP types. */
export type ZipManifest = {
    readonly entries: readonly ZipEntry[];
    readonly uncompressedBytes: number;
};
/** Controls checked extraction without exposing backend-specific options. */
export type CheckedZipOptions = {
    signal: AbortSignal;
    onProgress?: (completedBytes: number, totalBytes: number) => void;
    validateEntries: (manifest: ZipManifest) => void;
};
/** Metadata for one extracted tar entry; paths are POSIX, no trailing slash. */
export type TarEntry = {
    readonly path: string;
    readonly kind: 'file' | 'directory' | 'symlink' | 'hardlink';
    /** Permission bits as written, masked to 0o777. */
    readonly mode: number;
    readonly sizeBytes: number;
    readonly linkTarget?: string;
};
/** Entries extracted from a tar archive, in archive order. */
export type TarManifest = { readonly entries: readonly TarEntry[] };
/** Controls tar.gz extraction. */
export type TarGzOptions = { signal?: AbortSignal };
