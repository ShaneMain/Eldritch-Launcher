/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: used by electron-builder */

import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from 'dotenv';
import { expand } from 'dotenv-expand';
import type { AfterPackContext, Configuration } from 'electron-builder';

// load .env
expand(config());

const currentYear = new Date().getFullYear();

const linuxMetainfoFileName =
    'io.github.shanemain.eldritch-launcher.metainfo.xml';
const linuxMetainfoSource = `build-resources/linux/${linuxMetainfoFileName}`;
const linuxMetainfoRelativePath = `usr/share/metainfo/${linuxMetainfoFileName}`;
const linuxMetainfoPackagePath = `/${linuxMetainfoRelativePath}`;
const linuxMetainfoMapping = `${linuxMetainfoSource}=${linuxMetainfoPackagePath}`;
const bundledLinuxMetainfoPath = `/opt/Eldritch Launcher/${linuxMetainfoRelativePath}`;
const { version } = require('./package.json');
const isPrerelease =
    version.includes('beta') ||
    version.includes('alpha') ||
    version.includes('rc');
const channel: 'beta' | 'alpha' | 'rc' | 'latest' = version.includes('beta')
    ? 'beta'
    : version.includes('alpha')
      ? 'alpha'
      : version.includes('rc')
        ? 'rc'
        : 'latest';

console.log(
    `Building version ${version} as ${isPrerelease ? 'prerelease' : 'release'}`,
);

export default (<Configuration>{
    appId: 'io.github.shanemain.eldritch-launcher',
    productName: 'Eldritch Launcher',
    artifactName: 'Eldritch_Launcher-${version}-${os}_${arch}.${ext}',
    copyright: `Copyright © 2024-${currentYear} ${'${author}'}`,
    executableName: 'eldritch-launcher',

    files: ['dist-electron', 'dist-react'],
    afterPack: async ({
        appOutDir,
        electronPlatformName,
    }: AfterPackContext) => {
        if (electronPlatformName !== 'linux') {
            return;
        }

        const destination = join(
            appOutDir,
            ...linuxMetainfoRelativePath.split('/'),
        );
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(linuxMetainfoSource, destination);
    },
    extraResources: [
        {
            from: 'main/assets',
            to: 'assets',
            filter: ['**/*'],
        },
        {
            from: 'locales',
            to: 'locales',
            filter: ['**/*'],
        },
    ],
    mac: {
        icon: 'build-resources/mac/icon.icns',
        category: 'public.app-category.developer-tools',

        target: {
            target: 'default',
            arch: ['universal', 'arm64', 'x64'],
        },
        type: 'distribution',
        // Unsigned build: no Developer ID, so no signing or notarization.
        // Without a signature Squirrel.Mac cannot auto-update; the app
        // falls back to the manual download flow on macOS.
        identity: null,
    },
    linux: {
        icon: 'build-resources/linux/icon.png',
        syncDesktopName: true,
        packageCategory: 'devel',
        category: 'Development',

        synopsis: 'Godot Engine Launcher and Version Manager',

        target: [
            {
                target: 'AppImage',
                arch: ['x64', 'arm64'],
            },
            {
                target: 'deb',
                arch: ['x64', 'arm64'],
            },
            {
                target: 'rpm',
                arch: ['x64', 'arm64'],
            },
        ],
    },
    deb: {
        fpm: [
            '--license=MIT',
            '--exclude',
            bundledLinuxMetainfoPath,
            linuxMetainfoMapping,
        ],
    },
    rpm: {
        fpm: [
            '--license=MIT',
            '--exclude',
            bundledLinuxMetainfoPath,
            linuxMetainfoMapping,
        ],
    },
    win: {
        icon: 'build-resources/win/icon.ico',
        extraResources: [
            {
                from: 'native/git-credentials-helper/windows-askpass/out/win32-${arch}/eldritch-launcher-git-askpass.exe',
                to: 'git-credentials-helper/eldritch-launcher-git-askpass.exe',
            },
        ],

        target: [
            {
                target: 'nsis',
                arch: ['x64', 'arm64'],
            },
        ],
    },
    appImage: {
        license: 'build-resources/license_en.txt',
    },
    nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true,

        runAfterFinish: true,
        license: 'build-resources/license_en.txt',
        installerHeaderIcon: 'build-resources/win/installerHeaderIcon.ico',
        installerIcon: 'build-resources/win/installerIcon.ico',
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
    },

    publish: {
        provider: 'github',
        owner: 'ShaneMain',
        repo: 'Eldritch-Launcher',
        releaseType: isPrerelease ? 'prerelease' : 'release',
        vPrefixedTagName: true,
        channel,
    },
});
