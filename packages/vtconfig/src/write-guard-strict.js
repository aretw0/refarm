import { installWriteGuard } from "./write-guard.js";

/**
 * Layer 1 in enforcing mode, for every project that inherits `baseConfig`.
 *
 * A test that writes outside the OS temp dir now FAILS, naming the path and the test. That is
 * the whole point: it turns a silent side effect into a red test, on the machine where it
 * happens, instead of into a file somebody finds in their working tree three sessions later
 * (which is exactly how ISS-109 was discovered — `escape.txt` and
 * `refarm-guard-fixture-escape.txt`, the second containing the words "this must never land on
 * disk").
 *
 * A package that legitimately needs to write elsewhere should write into the sandbox instead;
 * `testHomeSandbox.home` is a real directory and HOME already points at it.
 */
installWriteGuard({ mode: "throw" });
