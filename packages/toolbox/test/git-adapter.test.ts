import { execSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gitHost, gitUrlAdapter } from '../src/git-adapter.mjs';

vi.mock('node:fs', () => {
  const readFileSync = vi.fn(() => JSON.stringify({ infrastructure: { gitHost: 'github' } }));
  return {
    default: { readFileSync },
    readFileSync
  };
});

vi.mock('node:child_process', () => {
  const execSync = vi.fn();
  return {
    default: { execSync },
    execSync
  };
});

const mockedExecSync = vi.mocked(execSync);

describe('Toolbox: Git Host Adapter', () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should correctly expose the configured git host name', () => {
        expect(gitHost).toBeTypeOf('string');
        // Currently we only support github out of the box
        expect(gitHost).toBe('github');
    });

    it('should incorrectly fail checkCli if execSync throws', () => {
        mockedExecSync.mockImplementationOnce(() => {
            throw new Error('Command not found');
        });
        
        const hasCli = gitUrlAdapter.checkCli();
        expect(hasCli).toBe(false);
    });

    it('should pass checkCli if gh and auth status return successfully', () => {
        mockedExecSync.mockReturnValue('gh version 2.40.1'); // mock success
        
        const hasCli = gitUrlAdapter.checkCli();
        expect(hasCli).toBe(true);
        expect(execSync).toHaveBeenCalledTimes(2);
    });

    describe('Issue Management', () => {
        it('issue.view should parse and return title from gh json output', () => {
            const mockOutput = '{"title":"Test Issue Title"}';
            mockedExecSync.mockReturnValue(mockOutput);
            
            const result = gitUrlAdapter.issue.view('123');
            
            expect(result).toBe(mockOutput);
            expect(execSync).toHaveBeenCalledWith(
                'gh issue view 123 --json title',
                expect.objectContaining({ encoding: 'utf8', stdio: 'pipe' })
            );
        });

        it('issue.create should build the correct gh cli command', () => {
            mockedExecSync.mockReturnValue('https://github.com/refarm-dev/refarm/issues/42');
            
            const url = gitUrlAdapter.issue.create('[Feature]: Test', 'kind:enhancement', 'Body text');
            
            expect(url).toBe('https://github.com/refarm-dev/refarm/issues/42');
            expect(execSync).toHaveBeenCalledWith(
                'gh issue create --title "[Feature]: Test" --label "kind:enhancement" --body "Body text"',
                expect.objectContaining({ encoding: 'utf8', stdio: 'pipe' })
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
