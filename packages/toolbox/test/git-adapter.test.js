import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gitHost, gitUrlAdapter } from '../src/git-adapter.mjs';

vi.mock('@refarm.dev/config', () => {
  const loadConfig = vi.fn(() => ({ infrastructure: { gitHost: 'github' } }));
  return {
    loadConfig,
  };
});

vi.mock('node:child_process', () => {
  const execFileSync = vi.fn();
  return {
    default: { execFileSync },
    execFileSync
  };
});

const mockedExecFileSync = execFileSync;

describe('Toolbox: Git Host Adapter', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should correctly expose the configured git host name', () => {
        expect(gitHost).toBeTypeOf('string');
        // Currently we only support github out of the box
        expect(gitHost).toBe('github');
    });

    it('should incorrectly fail checkCli if execFileSync throws', () => {
        mockedExecFileSync.mockImplementationOnce(() => {
            throw new Error('Command not found');
        });

        const hasCli = gitUrlAdapter.checkCli();
        expect(hasCli).toBe(false);
    });

    it('should pass checkCli if gh and auth status return successfully', () => {
        mockedExecFileSync.mockReturnValue('gh version 2.40.1'); // mock success

        const hasCli = gitUrlAdapter.checkCli();
        expect(hasCli).toBe(true);
        expect(execFileSync).toHaveBeenCalledTimes(2);
        expect(execFileSync).toHaveBeenCalledWith(
            'gh',
            ['--version'],
            expect.objectContaining({ encoding: 'utf8', stdio: 'pipe' })
        );
        expect(execFileSync).toHaveBeenCalledWith(
            'gh',
            ['auth', 'status'],
            expect.objectContaining({ encoding: 'utf8', stdio: 'pipe' })
        );
    });

    describe('Issue Management', () => {
        it('issue.view should parse and return title from gh json output', () => {
            const mockOutput = '{"title":"Test Issue Title"}';
            mockedExecFileSync.mockReturnValue(mockOutput);

            const result = gitUrlAdapter.issue.view('123');

            expect(result).toBe(mockOutput);
            expect(execFileSync).toHaveBeenCalledWith(
                'gh',
                ['issue', 'view', '123', '--json', 'title'],
                expect.objectContaining({ encoding: 'utf8', stdio: 'pipe' })
            );
        });

        it('issue.create should pass title/label/body as argv, never a shell string', () => {
            mockedExecFileSync.mockReturnValue('https://github.com/aretw0/refarm/issues/42');

            const url = gitUrlAdapter.issue.create('[Feature]: Test', 'kind:enhancement', 'Body text');

            expect(url).toBe('https://github.com/aretw0/refarm/issues/42');
            expect(execFileSync).toHaveBeenCalledWith(
                'gh',
                ['issue', 'create', '--title', '[Feature]: Test', '--label', 'kind:enhancement', '--body', 'Body text'],
                expect.objectContaining({ encoding: 'utf8', stdio: 'pipe' })
            );
        });

        it('issue.create keeps shell metacharacters inert — one argv element, no interpolation', () => {
            mockedExecFileSync.mockReturnValue('ok');
            const hostile = '"; echo pwned; $(touch /tmp/pwned) `id` #';

            gitUrlAdapter.issue.create(hostile, 'kind:bug', hostile);

            expect(execFileSync).toHaveBeenCalledWith(
                'gh',
                ['issue', 'create', '--title', hostile, '--label', 'kind:bug', '--body', hostile],
                expect.objectContaining({ encoding: 'utf8', stdio: 'pipe' })
            );
        });
    });

    describe('Label Management', () => {
        it('label.ensure passes name/color/description as argv', () => {
            mockedExecFileSync.mockReturnValue('');

            gitUrlAdapter.label.ensure('kind:bug', 'ff0000', 'A "quoted" description');

            expect(execFileSync).toHaveBeenCalledWith(
                'gh',
                ['label', 'create', 'kind:bug', '--color', 'ff0000', '--description', 'A "quoted" description'],
                expect.objectContaining({ stdio: 'pipe' })
            );
        });
    });

    describe('Pull Request Management', () => {
        it('pr.createCommand should append Fixes clause if issue ID is provided', () => {
            const cmd = gitUrlAdapter.pr.createCommand('123');
            expect(cmd).toContain('gh pr create');
            expect(cmd).toContain('--body "Fixes #123"');
        });

        it('pr.createCommand should be sparse if no issue ID is provided', () => {
            const cmd = gitUrlAdapter.pr.createCommand(null);
            expect(cmd).toBe('gh pr create ');
        });
    });
});
