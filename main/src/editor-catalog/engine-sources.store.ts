import path from 'node:path';
import logger from 'electron-log';
import { z } from 'zod';
import { JsonFileStore } from '../json-store/json-file.store.js';
import type { JsonStoreCoordinatorService } from '../json-store/json-store-coordinator.service.js';
import {
    ENGINE_SOURCES_SCHEMA_VERSION,
    forkSourceId,
    GITHUB_NAME_PATTERN,
} from './editor-catalog.constants.js';
import type { EngineSourcesFile } from './editor-catalog.types.js';

const StoredForkSourceSchema = z.object({
    owner: z.string().regex(GITHUB_NAME_PATTERN),
    repo: z.string().regex(GITHUB_NAME_PATTERN),
    displayName: z.string().trim().min(1).max(100),
    requiresAuth: z.boolean(),
});

const EngineSourcesFileSchema = z.object({
    schemaVersion: z.literal(ENGINE_SOURCES_SCHEMA_VERSION),
    forks: z.array(StoredForkSourceSchema),
});

/**
 * Creates the engine source file used before the user changes anything.
 * New installs list no forks; users add their own fork repositories.
 *
 * @returns A file without fork sources.
 */
export function createDefaultEngineSources(): EngineSourcesFile {
    return { schemaVersion: ENGINE_SOURCES_SCHEMA_VERSION, forks: [] };
}

/**
 * Checks stored sources and removes duplicates by source ID.
 *
 * @param value - The source file contents to check.
 * @returns Valid source data.
 */
function normalizeEngineSources(value: unknown): EngineSourcesFile {
    const file = EngineSourcesFileSchema.parse(value);
    const forks = new Map(
        file.forks.map((fork) => [forkSourceId(fork.owner, fork.repo), fork]),
    );
    return { ...file, forks: [...forks.values()] };
}

/** Stores user-configured engine fork sources in one JSON file. */
export class EngineSourcesStore extends JsonFileStore<EngineSourcesFile> {
    /**
     * Creates the engine source store.
     *
     * @param coordinator - The service that keeps JSON writes in order.
     * @param filePath - Absolute path of the source file.
     */
    constructor(coordinator: JsonStoreCoordinatorService, filePath: string) {
        super(coordinator, {
            pathProvider: () => path.resolve(filePath),
            defaultValue: createDefaultEngineSources,
            parse: (raw) => {
                try {
                    return normalizeEngineSources(JSON.parse(raw));
                } catch (error) {
                    logger.error(
                        'Engine source file is invalid; using defaults',
                        error,
                    );
                    return createDefaultEngineSources();
                }
            },
            normalize: normalizeEngineSources,
        });
    }

    /**
     * Reads the configured sources.
     *
     * @returns The current source file.
     */
    async read(): Promise<EngineSourcesFile> {
        return (await this.readValue()).value;
    }

    /**
     * Updates the configured sources in the shared write queue.
     *
     * @param mutator - The function that creates the next source file.
     * @returns The stored source file.
     */
    async update(
        mutator: (current: EngineSourcesFile) => EngineSourcesFile,
    ): Promise<EngineSourcesFile> {
        return (await this.updateValue(mutator)).value;
    }
}
