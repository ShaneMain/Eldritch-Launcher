import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findExtractedEditor } from './extracted-editor-locator.util.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map((directory) =>
                fs.rm(directory, { recursive: true, force: true }),
            ),
    );
});

/**
 * Creates an extraction directory holding the given files.
 *
 * @param files - Relative file paths and whether each is executable.
 * @returns The extraction directory.
 */
async function extracted(
    files: ReadonlyArray<[string, boolean]>,
): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-locator-'));
    temporaryDirectories.push(root);
    for (const [file, executable] of files) {
        const filePath = path.join(root, file);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, '');
        await fs.chmod(filePath, executable ? 0o755 : 0o644);
    }
    return root;
}

describe('findExtractedEditor with official Godot archive layouts', () => {
    it('finds the Linux editor at the top of a standard archive', async () => {
        const root = await extracted([
            ['Godot_v4.3-stable_linux.x86_64', true],
        ]);

        await expect(findExtractedEditor(root, 'linux')).resolves.toBe(
            path.join(root, 'Godot_v4.3-stable_linux.x86_64'),
        );
    });

    it('finds the Linux editor inside the folder of a .NET archive', async () => {
        const root = await extracted([
            [
                'Godot_v4.3-stable_mono_linux_x86_64/Godot_v4.3-stable_mono_linux.x86_64',
                true,
            ],
            [
                'Godot_v4.3-stable_mono_linux_x86_64/GodotSharp/Api/Release/GodotSharp.dll',
                false,
            ],
        ]);

        await expect(findExtractedEditor(root, 'linux')).resolves.toBe(
            path.join(
                root,
                'Godot_v4.3-stable_mono_linux_x86_64',
                'Godot_v4.3-stable_mono_linux.x86_64',
            ),
        );
    });

    it('finds the Windows editor and skips the console wrapper', async () => {
        const root = await extracted([
            ['Godot_v4.3-stable_win64_console.exe', true],
            ['Godot_v4.3-stable_win64.exe', true],
        ]);

        await expect(findExtractedEditor(root, 'win32')).resolves.toBe(
            path.join(root, 'Godot_v4.3-stable_win64.exe'),
        );
    });

    it('finds the Windows editor inside the folder of a .NET archive', async () => {
        const root = await extracted([
            [
                'Godot_v4.3-stable_mono_win64/Godot_v4.3-stable_mono_win64.exe',
                true,
            ],
            [
                'Godot_v4.3-stable_mono_win64/Godot_v4.3-stable_mono_win64_console.exe',
                true,
            ],
            ['Godot_v4.3-stable_mono_win64/GodotSharp/Tools/x.dll', false],
        ]);

        await expect(findExtractedEditor(root, 'win32')).resolves.toBe(
            path.join(
                root,
                'Godot_v4.3-stable_mono_win64',
                'Godot_v4.3-stable_mono_win64.exe',
            ),
        );
    });

    it('finds a renamed fork editor next to GodotSharp, skipping scripts and libraries', async () => {
        const root = await extracted([
            ['GodotSharp/Api/Release/GodotSharp.dll', true],
            ['GodotSharp/Tools/tool', true],
            ['libsomething.so.1', true],
            ['install.sh', true],
            ['redot.linuxbsd.editor.x86_64.mono', true],
        ]);

        await expect(findExtractedEditor(root, 'linux')).resolves.toBe(
            path.join(root, 'redot.linuxbsd.editor.x86_64.mono'),
        );
    });

    it('finds the macOS application bundle', async () => {
        const root = await extracted([
            ['Godot_mono.app/Contents/MacOS/Godot', true],
        ]);

        await expect(findExtractedEditor(root, 'darwin')).resolves.toBe(
            path.join(root, 'Godot_mono.app'),
        );
    });
});
