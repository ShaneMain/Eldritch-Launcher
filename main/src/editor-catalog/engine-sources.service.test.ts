import type { AddEngineSourceInput } from '@shared/contracts';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { EngineSourcesFile } from './editor-catalog.types.js';
import { EngineSourcesService } from './engine-sources.service.js';
import type { EngineSourcesStore } from './engine-sources.store.js';
import type { GithubSourceAccessService } from './github-source-access.service.js';

describe('EngineSourcesService.add', () => {
    let file: EngineSourcesFile;
    let request: Mock;
    let service: EngineSourcesService;

    beforeEach(() => {
        file = { schemaVersion: 1, forks: [] };
        request = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        name: 'godot',
                        full_name: 'Eldritch-Game-Studio/godot',
                        private: false,
                        owner: { login: 'Eldritch-Game-Studio' },
                    }),
                ),
        );
        const store = {
            read: async () => file,
            update: async (
                mutator: (current: EngineSourcesFile) => EngineSourcesFile,
            ) => {
                file = mutator(file);
                return file;
            },
        } as unknown as EngineSourcesStore;
        const access = {
            withToken: <T>(operation: (token: string | null) => Promise<T>) =>
                operation(null),
            request,
        } as unknown as GithubSourceAccessService;
        service = new EngineSourcesService(store, access);
    });

    it('adds the repository named by a pasted GitHub URL', async () => {
        const result = await service.add({
            url: 'https://github.com/Eldritch-Game-Studio/godot/releases',
        });

        expect(result).toMatchObject({
            ok: true,
            source: {
                owner: 'Eldritch-Game-Studio',
                repo: 'godot',
                displayName: 'godot',
            },
        });
        expect(request).toHaveBeenCalledWith(
            '/repos/Eldritch-Game-Studio/godot',
            null,
            {
                owner: 'Eldritch-Game-Studio',
                repo: 'godot',
                requiresAuth: true,
            },
        );
        expect(file.forks).toHaveLength(1);
    });

    it('keeps a trimmed display name', async () => {
        const result = await service.add({
            url: 'git@github.com:Eldritch-Game-Studio/godot.git',
            displayName: '  Studio fork ',
        });

        expect(result).toMatchObject({
            ok: true,
            source: { displayName: 'Studio fork' },
        });
    });

    it.each([
        { url: 'https://gitlab.com/Eldritch-Game-Studio/godot' },
        { url: 'not a url' },
        { url: '' },
        { url: 42 },
        { owner: 'Eldritch-Game-Studio', repo: 'godot' },
        { url: 'Eldritch-Game-Studio/godot', displayName: 7 },
        { url: 'Eldritch-Game-Studio/godot', displayName: 'x'.repeat(101) },
    ])('refuses invalid input %j without contacting GitHub', async (input) => {
        const result = await service.add(
            input as unknown as AddEngineSourceInput,
        );

        expect(result).toEqual({ ok: false, reason: 'invalid' });
        expect(request).not.toHaveBeenCalled();
        expect(file.forks).toHaveLength(0);
    });

    it('refuses a repository that is already configured', async () => {
        await service.add({ url: 'Eldritch-Game-Studio/godot' });
        request.mockClear();

        const result = await service.add({
            url: 'https://github.com/eldritch-game-studio/GODOT.git',
        });

        expect(result).toEqual({ ok: false, reason: 'duplicate' });
        expect(request).not.toHaveBeenCalled();
    });
});
