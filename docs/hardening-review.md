# Local hardening review

These changes are prepared locally for owner review. No commits, pushes, history rewrites, server connections, or deployments were performed. This document intentionally omits deployment identifiers and credential values.

## What changed

| Area | Previous behavior | Current behavior |
| --- | --- | --- |
| Server isolation | Missing and partially saved server configurations shared nested defaults; changing a blacklist or channel list could affect another server. | Every loaded configuration gets independent nested objects and arrays. |
| Diagram rendering | Generated text could remain HTML; rendering downloaded a CDN script and disabled the Chromium sandbox. | Fully escapes diagram HTML, uses installed Mermaid, sets strict rendering security, blocks browser requests, and explicitly enables the Chromium sandbox. Concurrent requests share one browser launch. |
| Request deadlines | Main model requests, tool lookups, memory extraction, startup probes, and notification API requests lacked explicit deadlines. | Model requests use a 60-second deadline; tool and notification API requests use 15 seconds. Deadlines remain active during body reads and preserve existing cancellation signals. Existing media-specific deadlines remain in place. |
| Memory races | Clearing memory could be undone by a pending extraction; numbered updates could overwrite a different fact after another update moved slots. | Memory mutations advance a per-user revision. Extraction results are discarded when the revision changed during the model call. Debug messages no longer include remembered fact text. |
| Response length | The chat formatter used the global length despite the server command saving a server-specific length. | Mention and reply paths pass the server limit into the formatter. Unsafe legacy limits are clamped. |
| Configuration commands | Numbers accepted partial strings, infinity, fractions for counts, and negative values; unrecognized boolean strings became false. | Explicit types and ranges reject invalid values. Three unused legacy controls are no longer offered as editable settings. |
| Logging | Logging settings were saved but the logger always used fixed settings and file output. | Loaded logging settings configure the logger, including level, directory, and whether file output is enabled. Changing the level takes effect immediately. |
| Interaction authorization | Channel menus relied on the original command authorization; an unused config modal wrote global settings without checking the current actor. | Channel menus recheck Administrator permission. The unused editor is retired and directs users to the validated `/config set` command. |
| Agent loop | Malformed tool JSON aborted the entire reply; the model could request unlimited tools in one step. | Invalid arguments consume a failure budget and allow a fallback. Tool execution has a total eight-call cap. Disabled tools cannot execute even if proposed by the model. Invalid or failed chat API bodies produce a controlled error. |
| Chat rate limits | Only successful completed replies consumed limits. | Accepted work consumes limits before model generation, reducing rapid concurrent requests and repeated failed-request abuse. Failed attempts now count toward limits. |
| Public repository protection | Only the main `.env` and selected data paths were ignored. | Environment variants, runtime data, database files, private key files, and local agent settings are ignored. A basic staged-content publication guard checks sensitive paths and common credential patterns without printing matching values. |

Legacy `bot.responseFormat`, `bot.cooldownSeconds`, and `tools.triggerThreshold` remain in stored configurations for compatibility. Use `rateLimit.cooldownMs` for the active chat cooldown. Answer Machine retains its separate engagement cooldowns and does not use chat's per-user minute/hour quotas.

## Validation

- TypeScript compilation passes.
- Ten regression tests pass via `npm test`: independent guild defaults, partial configuration isolation, setting validation, deadline/cancellation behavior, memory clear/update races, response limits, renderer security configuration, malformed tool arguments, disabled tools, active logging settings, and staged publication checks.
- Memory tests execute the actual memory SQL against Node's built-in in-memory SQLite here because the project's native SQLite binding cannot load on this workspace's Node 26. A normal environment with the binding installed uses the project's database initialization instead.
- Renderer tests mock the browser to verify HTML escaping, local script loading, strict security, sandbox options, and blocked network requests. They do **not** establish that Chromium can launch or produce valid diagram images on the server.
- Publication guard tests use a disposable Git repository with synthetic values. Running the guard in the working repository currently checks zero staged files; nothing has been staged.
- `git diff --check` passes.

## Environment hiccups and deployment checks

The installed native SQLite dependency failed to compile against this workspace's Node 26. An isolated Node 22 installation and a Playwright Chromium download could not proceed because DNS/network access failed. The locally available Chromium-based browser also could not launch under the workspace's process restrictions.

Before deploying, confirm the server's Node version and service user. Install dependencies and the Playwright browser there, run the test suite with the native SQLite binding, and smoke-test an ordinary diagram and table with the Chromium sandbox enabled. If sandboxed rendering cannot start, the existing renderer failure handling keeps text replies available and displays a diagram fallback; there is no automatic switch to an unsandboxed browser.

Discord login, real Ollama responses, companion tools, notification delivery, and the full image-generation path were not tested against live services. Memory revisions currently assume one bot process owns writes; they do not coordinate multiple bot instances or external database writers. The chat and reply paths still duplicate some logic; consolidating them can follow once the behavior fixes are verified.

## Existing public Git history

The earlier scan found **12 historical deployment JSON blob versions**, not twelve distinct files, containing Discord identifiers. Those versions remain accessible in this clone's history. A limited scan for several common token/private-key patterns found no matches; this does not establish that all historical content is free of sensitive information.

The local code fixes and ignore rules do not remove already-published content. History cleanup requires a separate, coordinated review of affected paths and commits, followed by a deliberate rewrite and remote update. Any credentials discovered during that audit should be rotated. Existing forks or clones may retain older history after a rewrite.

No history cleanup or remote update has been attempted.

## Before publishing

Review the changed files, then stage only the intended source, tests, and documentation. Run `npm run check:public` against that actual staged content and review the staged diff. The guard is a basic check, not a comprehensive secret scanner; arbitrary personal information and unknown credential formats still require review.
