import * as fs from 'node:fs';
import * as path from 'node:path';

/** Candidate editor found in an extracted archive. */
type EditorCandidate = {
    filePath: string;
    depth: number;
    name: string;
};

/** Executable files in editor archives that are never the editor. */
const NON_EDITOR_FILE = /\.(?:so(?:\.\d+)*|dll|dylib|sh|py)$/;

/**
 * Locates the Godot editor inside an extracted archive from its contents,
 * not from the archive file name. Only the top level and one directory
 * below it are searched; symbolic links and the .NET `GodotSharp` folder
 * are ignored. Forks may rename the editor (`redot.linuxbsd.editor.x86_64`),
 * so any name is accepted, preferring names with `editor`, then names
 * starting with `godot`, then the shallowest file.
 *
 * - Linux: an executable regular file that is not a console wrapper, export
 *   template, shared library, or script.
 * - Windows: an `.exe` that is not the console wrapper.
 * - macOS: an `.app` bundle directory.
 *
 * @param root - Extraction directory.
 * @param platform - Platform the editor runs on.
 * @returns The editor path, or undefined when no editor is found.
 */
export async function findExtractedEditor(
    root: string,
    platform: NodeJS.Platform,
): Promise<string | undefined> {
    const candidates: EditorCandidate[] = [];
    const visit = async (directory: string, depth: number): Promise<void> => {
        for (const entry of await fs.promises.readdir(directory, {
            withFileTypes: true,
        })) {
            const filePath = path.join(directory, entry.name);
            const name = entry.name.toLowerCase();
            if (entry.isSymbolicLink()) {
                continue;
            }
            if (platform === 'darwin') {
                if (entry.isDirectory() && name.endsWith('.app')) {
                    candidates.push({ filePath, depth, name });
                    continue;
                }
            } else if (
                entry.isFile() &&
                !name.includes('console') &&
                !name.includes('template') &&
                (platform === 'win32'
                    ? name.endsWith('.exe')
                    : !NON_EDITOR_FILE.test(name) &&
                      ((await fs.promises.stat(filePath)).mode & 0o111) !== 0)
            ) {
                candidates.push({ filePath, depth, name });
                continue;
            }
            if (entry.isDirectory() && depth === 0 && name !== 'godotsharp') {
                await visit(filePath, depth + 1);
            }
        }
    };
    await visit(root, 0);

    const rank = (candidate: EditorCandidate) =>
        candidate.depth * 4 +
        (platform === 'darwin' || candidate.name.includes('editor') ? 0 : 2) +
        (candidate.name.startsWith('godot') ? 0 : 1);
    return candidates.sort(
        (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
    )[0]?.filePath;
}
