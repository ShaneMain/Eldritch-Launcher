import { describe, expect, it } from 'vitest';
import { parseGithubRepositoryUrl } from './github-repository-url.util.js';

describe('parseGithubRepositoryUrl', () => {
    it.each([
        'https://github.com/godotengine/godot',
        'https://github.com/godotengine/godot/',
        'https://github.com/godotengine/godot.git',
        'https://github.com/godotengine/godot/releases',
        'https://github.com/godotengine/godot/releases/tag/4.4-stable',
        'https://github.com/godotengine/godot/tree/master',
        'https://github.com/godotengine/godot?tab=readme#top',
        'HTTPS://GitHub.com/godotengine/godot',
        'http://github.com/godotengine/godot',
        'https://www.github.com/godotengine/godot',
        'github.com/godotengine/godot',
        'www.github.com/godotengine/godot/releases',
        'git@github.com:godotengine/godot.git',
        'git@github.com:godotengine/godot',
        'ssh://git@github.com/godotengine/godot.git',
        'godotengine/godot',
        'godotengine/godot/',
        '  https://github.com/godotengine/godot  ',
    ])('parses %s', (input) => {
        expect(parseGithubRepositoryUrl(input)).toEqual({
            owner: 'godotengine',
            repo: 'godot',
        });
    });

    it('keeps dots, dashes, and underscores in names', () => {
        expect(
            parseGithubRepositoryUrl(
                'https://github.com/Eldritch-Game-Studio/godot.fork_x',
            ),
        ).toEqual({ owner: 'Eldritch-Game-Studio', repo: 'godot.fork_x' });
    });

    it.each([
        '',
        '   ',
        'godot',
        'godotengine',
        'godotengine/godot/releases',
        'https://github.com',
        'https://github.com/godotengine',
        'https://gitlab.com/godotengine/godot',
        'gitlab.com/godotengine/godot',
        'https://github.com.evil.com/godotengine/godot',
        'https://api.github.com/repos/godotengine/godot',
        'https://github.com:8443/godotengine/godot',
        'https://user:pass@github.com/godotengine/godot',
        'git@gitlab.com:godotengine/godot.git',
        'ssh://root@github.com/godotengine/godot.git',
        'ftp://github.com/godotengine/godot',
        'file:///github.com/godotengine/godot',
        'https://github.com/-bad/godot',
        'https://github.com/godotengine/god ot',
        'https://github.com/godotengine/.git',
        'constructor/owner/repo',
        'c:/owner/repo',
    ])('rejects %j', (input) => {
        expect(parseGithubRepositoryUrl(input)).toBeNull();
    });
});
