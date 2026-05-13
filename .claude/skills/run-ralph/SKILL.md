---
name: run-ralph
description: This skill should be used when the user asks to "run ralph", "start ralph", "run the ralph loop", "kick off ralph", "execute ralph.sh", "run ralph until done", "finish ralph", "rerun ralph", or otherwise asks to drive the autonomous Ralph agent loop to completion. Runs `ralph/ralph.sh` with a default of 10 iterations, monitors progress in the background, and automatically reruns when Ralph exits with user stories still marked `passes: false`.
version: 0.1.0
---

# Run Ralph to Completion

Drive the Ralph autonomous agent loop (`ralph/ralph.sh`) until every user story in `ralph/prd.json` has `passes: true`, or until a safety cap on reruns is reached. Ralph itself iterates up to N times per invocation (default 10) and exits when it either signals `COMPLETE` or runs out of iterations — this skill wraps that with a supervisor loop that restarts Ralph when more work remains.

## Inputs and defaults

- **Iterations per invocation**: 10. Override only when the user explicitly asks (e.g. "run ralph with 5 iterations").
- **Max supervisor reruns**: 5. Prevents runaway when Ralph cannot make progress (e.g. the same story fails every iteration). Override only on explicit user request.
- **Working directory**: the repository root, where `ralph/ralph.sh` and `ralph/prd.json` live.

Treat these as the canonical knobs. Do not invent extra flags unless the user asks.

## Preflight checks

Before launching anything, verify the environment in one batch:

1. `ralph/ralph.sh` exists and is executable.
2. `ralph/prd.json` exists.
3. `jq` is on `PATH` (Ralph itself uses it; the supervisor needs it too).
4. The current git working tree status is acceptable for an autonomous agent loop. If it is dirty in a way the user did not authorise, surface this and ask before proceeding — Ralph will create commits.

If any check fails, stop and report the specific problem to the user instead of pressing on.

Also record the initial count of remaining stories so the user gets a useful summary at the end:

```bash
$SKILL_DIR/scripts/check-remaining.sh ralph/prd.json
```

Save it; report it again at the end.

## Run procedure

Launch Ralph as a background Bash command, redirecting combined stdout/stderr to a timestamped log inside `ralph/logs/`. This keeps the conversation transcript clean and gives the user a permanent record they can `tail` from another terminal.

```bash
mkdir -p ralph/logs
LOG=ralph/logs/run-$(date +%Y%m%d-%H%M%S).log
echo "Ralph log: $LOG"
bash ralph/ralph.sh 10 >"$LOG" 2>&1
```

Run this with `run_in_background: true` on the Bash tool. Tell the user where the log is and that they will be notified when this invocation finishes. **Do not poll.** The harness will deliver a completion notification; spinning on `BashOutput` wastes context and burns the prompt cache.

If the user has overridden the iteration count, substitute it for `10` above. Pass nothing else — `ralph.sh` already has sensible defaults for `--retries` and `--hang-timeout`.

## When the invocation finishes

On completion, inspect two signals:

1. **Exit code** of the background shell.
   - `0` → Ralph emitted `<promise>COMPLETE</promise>`; it believes everything is done.
   - `1` → Ralph hit max iterations without completing. Rerun is expected.
   - Anything else → unexpected failure. Tail the tail of the log (`tail -50 $LOG`) and surface the error to the user before deciding whether to rerun.

2. **PRD state**, regardless of exit code, via the helper script:

   ```bash
   $SKILL_DIR/scripts/check-remaining.sh ralph/prd.json
   ```

   Treat the PRD as the source of truth. Exit code `0` with `remaining > 0` is possible if Ralph misreports completion; in that case the supervisor must rerun. Exit code `1` with `remaining == 0` is also possible (a final iteration that completed and wrote PRD but did not emit the sentinel) and means done.

Decision matrix:

| exit | remaining | action |
|------|-----------|--------|
| 0    | 0         | **Done.** Report success. |
| 0    | >0        | Rerun (Ralph misreported). |
| 1    | 0         | **Done.** Report success. |
| 1    | >0        | Rerun. |
| other| any       | Stop. Surface the error and last 50 log lines; ask the user how to proceed. |

## Rerun loop

Maintain a rerun counter starting at 0. After each completion that lands in a "rerun" bucket:

1. Increment the counter.
2. If the counter exceeds the max (default 5), stop. Report the remaining story count, the path to the latest log, and the path to `ralph/progress.txt`. Do not silently keep restarting.
3. If the count of `passes: false` stories has not decreased compared to the previous run, warn the user that Ralph is stuck and confirm before kicking off another rerun. A stuck loop usually means a story has a real blocker that needs human input.
4. Otherwise, launch another `bash ralph/ralph.sh 10` exactly as in the run procedure (new log file each time) and wait for its completion.

Between reruns there is no need to clean up — `ralph.sh` archives its own state when the branch in `prd.json` changes, and progress accumulates in `ralph/progress.txt` across runs.

## Reporting

While the supervisor loop is running, keep user-facing text concise. One line when a run starts, one line when a run finishes ("iteration finished, N stories remaining, rerunning" / "all stories complete"). Do not paste the log into the conversation; point at the file instead.

Final report (after success or after hitting the rerun cap) should include:

- Total Ralph invocations driven by the supervisor.
- Stories remaining at start vs. now.
- Path to each log file produced.
- Path to `ralph/progress.txt` for the human-readable history.
- Whether the loop exited because everything completed, because the rerun cap was hit, or because Ralph errored.

## Safety notes

- Never edit `ralph/prd.json`, `ralph/progress.txt`, `ralph/CLAUDE.md`, or `ralph/ralph.sh` from this skill. Ralph manages those.
- Never run `git clean`, `rm -rf ralph/`, or any other destructive command against the `ralph/` tree — the loop script and prompts live there.
- Never bypass git hooks or amend Ralph's commits.
- If the user asks to stop mid-loop, kill the background shell and do not start another rerun.

## Additional resources

- **`scripts/check-remaining.sh`** — prints the count of stories with `passes != true`. Exit codes distinguish "missing PRD" / "missing jq" / "malformed PRD" from a normal zero count. The skill uses this both before and after each Ralph invocation.
