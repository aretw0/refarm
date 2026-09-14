# @refarm.dev/rate-limiter

Per-platform publish pacing: a minimum gap between sends, plus a burst ceiling per window.

Promoted from `@aretw0/dgk-channels`, whose ROADMAP named this package as its destination and
itself as a temporary bridge. The mechanism and the platform table are that package's; what
changed is everything that tied them to one consumer.

```js
import { rateLimitStatePath, throttle } from "@refarm.dev/rate-limiter";

const statePath = rateLimitStatePath("/home/me/.refarm");
await throttle("telegram", { statePath, onWait: (wait) => console.log(wait) });
```

- **No state path is baked in.** The caller names the directory its machine-local state lives in.
- **It does not print.** Waits are reported through `onWait`; the caller decides whether that is a
  log line, a spinner, or a notice on a phone.
- **The write cannot corrupt the file.** Temporary sibling, then rename.
- **An unknown platform is not paced.** Inventing a limit for a provider nobody measured would be
  a guessed number in a durable place.

Two processes pacing the same platform can lose an update — each reads, waits, and writes back
what it read. The cost is a send that goes out sooner than intended, never a crash or a corrupt
file. Closing it needs a lock, and a lock needs a consumer that sends from two processes at once.
