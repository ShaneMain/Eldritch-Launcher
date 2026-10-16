import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AtomicJsonFileAdapter } from '../json-store/atomic-json-file.adapter.js';
import { JsonStoreCoordinatorService } from '../json-store/json-store-coordinator.service.js';
import { EngineSourcesStore } from './engine-sources.store.js';

vi.mock('electron-log', () => ({ default: { error: vi.fn() } }));

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

describe('EngineSourcesStore', () => {
    it('starts a new install without fork sources', async () => {
        const filePath = path.join(
            await createTemporaryDirectory(),
            'engine-sources.json',
        );

        await expect(createStore(filePath).read()).resolves.toEqual({
            schemaVersion: 1,
            forks: [],
        });
    });

    it('keeps the forks of an existing source file', async () => {
        const filePath = path.join(
            await createTemporaryDirectory(),
            'engine-sources.json',
        );
        const existing = {
            schemaVersion: 1,
            forks: [
                {
                    owner: 'Redot-Engine',
                    repo: 'redot-engine',
                    displayName: 'Redot',
                    requiresAuth: false,
                },
            ],
        };
        await fs.writeFile(filePath, JSON.stringify(existing), 'utf-8');

        await expect(createStore(filePath).read()).resolves.toEqual(existing);
    });
});

/**
 * Creates a store for one source file.
 *
 * @param filePath - Absolute source file path.
 * @returns The engine source store.
 */
function createStore(filePath: string): EngineSourcesStore {
    return new EngineSourcesStore(
        new JsonStoreCoordinatorService(new AtomicJsonFileAdapter()),
        filePath,
    );
}

/**
 * Creates a temporary directory removed after each test.
 *
 * @returns The directory path.
 */
async function createTemporaryDirectory(): Promise<string> {
    const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), 'launcher-engine-sources-'),
    );
    temporaryDirectories.push(directory);
    return directory;
}
