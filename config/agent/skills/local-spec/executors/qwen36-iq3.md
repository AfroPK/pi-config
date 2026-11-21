# Executor profile: Qwen3.6 35B-A3B UD-IQ3_XXS (local, Pi)

**Model:** Qwen3.6 35B-A3B (a mixture-of-experts model with about 3B active parameters) at IQ3_XXS. Pi model `qwen36iq3/qwen3.6-iq3-local`, served by llama.cpp through llama-swap.

**Hardware:** RX 6750 XT with 12 GB, plus 32 GB of system RAM.

**Harness:** Pi, with read, write, edit and bash tools. Every task starts in a fresh session, so nothing carries over except the files on disk.

## Limits to size tasks against
- **Context:** 128K maximum, but plan for each task to stay **under about 25K tokens**. That covers the spec section, the files it reads and its own tool output. Writing speed falls from about 55 tok/s when the context is short to about 42 tok/s at 70K, and its quality drops along with it.
- **Speed:** about 55 tok/s writing and about 1,300 tok/s reading, with thinking on low. Re-reading a big file costs real time, so keep files small and point to exact functions.
- **Thinking:** run it at **low**. It overthinks, using roughly 7–9 times the thinking tokens of a 27B dense model on the same tasks.
- **Vision:** none. It can't see the browser or screenshots, so anything visual is checked by Freddy by hand.

## Strengths (measured)
- **Executing plans:** it was the best executor in Freddy's benchmark (10/10). It handled a 12-step CLI built from a spec, a 9-step refactor across several files, wrong anchors in the plan, and a "do not touch" file.
- **Blockers:** when the spec asks for something impossible, it reports a blocker and leaves the code working.
- **Code quality:** the code it writes passes tests when the target is clearly stated.

## Weaknesses (plan around these)
- **It cannot plan.** Given open-ended work, it writes code immediately and skips planning, so every design decision must already be in the spec.
- **It loops on writing tests and harnesses.** It got stuck rewriting a `run_tests.sh` until it was aborted. Never ask it to create tests; give it a ready-made checker and its exact command.
- **Tool loops.** It can repeat the same edit or command over and over. Short tasks with one clear check command keep this rare.
- **Large files.** In big files its edits can drift. Keep files under about 400 lines and name the function to change.

## Rules block (copy into every SPEC.md word for word)

```markdown
## Executor rules (read before every task)
1. Do ONE task per session: the first unchecked task in TASKS.md. Then stop.
2. Read only what the task's "Read first" line lists. Do not explore the whole project.
3. Change only the files the task names. Never edit SPEC.md or anything in `checks/`.
4. Make small, targeted edits. Do not reformat or rewrite code you were not asked to change.
5. Do not write tests, test harnesses, mocks or extra scripts. Use the task's Check command.
6. Run the Check command. If it fails, fix your code and run it again, at most 5 times.
7. If the check still fails after 5 tries, or the task is impossible as written: stop. Mark the task BLOCKED in TASKS.md with the exact error and what you tried. If you think the check itself is wrong, say why.
8. When the check passes: tick the task in TASKS.md and add one line saying what you changed. Then stop.
```
