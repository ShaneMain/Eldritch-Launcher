import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GitHubDeviceCode } from './github-device-code.component';

describe('GitHubDeviceCode', () => {
    it('shows a request status before GitHub returns a code', () => {
        const html = renderToStaticMarkup(
            <GitHubDeviceCode authorization={null} />,
        );

        expect(html).toContain('requestingCode');
        expect(html).not.toContain('github-device-user-code');
    });

    it('shows the copyable user code, the GitHub link, and the countdown', () => {
        const html = renderToStaticMarkup(
            <GitHubDeviceCode
                authorization={{
                    userCode: 'WDJB-MJHT',
                    verificationUri: 'https://github.com/login/device',
                    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
                }}
            />,
        );

        expect(html).toMatch(
            /data-testid="github-device-user-code"[^>]*>WDJB-MJHT</u,
        );
        expect(html).toContain('buttons.copy');
        expect(html).toContain('openGitHub');
        expect(html).toContain('waiting');
        expect(html).not.toContain('codeExpired');
    });

    it('marks an expired code', () => {
        const html = renderToStaticMarkup(
            <GitHubDeviceCode
                authorization={{
                    userCode: 'WDJB-MJHT',
                    verificationUri: 'https://github.com/login/device',
                    expiresAt: new Date(Date.now() - 1_000).toISOString(),
                }}
            />,
        );

        expect(html).toContain('codeExpired');
    });
});
