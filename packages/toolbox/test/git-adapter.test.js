"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var node_child_process_1 = require("node:child_process");
var vitest_1 = require("vitest");
var git_adapter_mjs_1 = require("../src/git-adapter.mjs");
vitest_1.vi.mock('node:fs', function () {
    var readFileSync = vitest_1.vi.fn(function () { return JSON.stringify({ infrastructure: { gitHost: 'github' } }); });
    return {
        default: { readFileSync: readFileSync },
        readFileSync: readFileSync
    };
});
vitest_1.vi.mock('node:child_process', function () {
    var execSync = vitest_1.vi.fn();
    return {
        default: { execSync: execSync },
        execSync: execSync
    };
});
var mockedExecSync = vitest_1.vi.mocked(node_child_process_1.execSync);
(0, vitest_1.describe)('Toolbox: Git Host Adapter', function () {
    (0, vitest_1.beforeEach)(function () {
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.it)('should correctly expose the configured git host name', function () {
        (0, vitest_1.expect)(git_adapter_mjs_1.gitHost).toBeTypeOf('string');
        // Currently we only support github out of the box
        (0, vitest_1.expect)(git_adapter_mjs_1.gitHost).toBe('github');
    });
    (0, vitest_1.it)('should incorrectly fail checkCli if execSync throws', function () {
        mockedExecSync.mockImplementationOnce(function () {
            throw new Error('Command not found');
        });
        var hasCli = git_adapter_mjs_1.gitUrlAdapter.checkCli();
        (0, vitest_1.expect)(hasCli).toBe(false);
    });
    (0, vitest_1.it)('should pass checkCli if gh and auth status return successfully', function () {
        mockedExecSync.mockReturnValue('gh version 2.40.1'); // mock success
        var hasCli = git_adapter_mjs_1.gitUrlAdapter.checkCli();
        (0, vitest_1.expect)(hasCli).toBe(true);
        (0, vitest_1.expect)(node_child_process_1.execSync).toHaveBeenCalledTimes(2);
    });
    (0, vitest_1.describe)('Issue Management', function () {
        (0, vitest_1.it)('issue.view should parse and return title from gh json output', function () {
            var mockOutput = '{"title":"Test Issue Title"}';
            mockedExecSync.mockReturnValue(mockOutput);
            var result = git_adapter_mjs_1.gitUrlAdapter.issue.view('123');
            (0, vitest_1.expect)(result).toBe(mockOutput);
            (0, vitest_1.expect)(node_child_process_1.execSync).toHaveBeenCalledWith('gh issue view 123 --json title', vitest_1.expect.objectContaining({ encoding: 'utf8', stdio: 'pipe' }));
        });
        (0, vitest_1.it)('issue.create should build the correct gh cli command', function () {
            mockedExecSync.mockReturnValue('https://github.com/refarm-dev/refarm/issues/42');
            var url = git_adapter_mjs_1.gitUrlAdapter.issue.create('[Feature]: Test', 'kind:enhancement', 'Body text');
            (0, vitest_1.expect)(url).toBe('https://github.com/refarm-dev/refarm/issues/42');
            (0, vitest_1.expect)(node_child_process_1.execSync).toHaveBeenCalledWith('gh issue create --title "[Feature]: Test" --label "kind:enhancement" --body "Body text"', vitest_1.expect.objectContaining({ encoding: 'utf8', stdio: 'pipe' }));
        });
    });
    (0, vitest_1.describe)('Pull Request Management', function () {
        (0, vitest_1.it)('pr.createCommand should append Fixes clause if issue ID is provided', function () {
            var cmd = git_adapter_mjs_1.gitUrlAdapter.pr.createCommand('123');
            (0, vitest_1.expect)(cmd).toContain('gh pr create');
            (0, vitest_1.expect)(cmd).toContain('--body "Fixes #123"');
        });
        (0, vitest_1.it)('pr.createCommand should be sparse if no issue ID is provided', function () {
            var cmd = git_adapter_mjs_1.gitUrlAdapter.pr.createCommand(null);
            (0, vitest_1.expect)(cmd).toBe('gh pr create ');
        });
    });
});
