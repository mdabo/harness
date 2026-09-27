---
name: harness-orchestrate
description: Run the harness loop on behalf of the user — plan, dispatch agents, verify contracts, repeat. Use whenever the user wants the roles to actually run: "launch the agents", "go ahead", "start the review", "run the harness", or right after roles were created. Also use to resume after a failed contract, or when the user asks where things stand.
---

# Running the harness

**You run the CLI. The user does not.**

The command is `.harness/bin/harness`, from the project root — a launcher written
at install time that knows where the framework lives. There is no `harness` on
the PATH; if you try a bare `harness` you will get *command not found* and
conclude, wrongly, that the tool is not installed. If `.harness/bin/harness` is
genuinely missing, say so and stop. **Do not reimplement the loop by hand** — a
contract you check yourself is not a contract.

The user's job is to say what they want, watch it happen, and rule on what only
a human can rule on. Everything between those is yours. If you find yourself
about to write "now run `.harness/bin/harness run`", stop — run it.

## The loop

```
.harness/bin/harness plan            → show the user who will run, and what it will cost
.harness/bin/harness run             → orders for the current wave
  dispatch each order   → one agent per order, exact text, stated model
.harness/bin/harness verify          → contracts met?
  ├─ all met            → next wave: .harness/bin/harness run again
  ├─ some failed        → re-dispatch those, with the failure detail
  └─ nothing left       → report to the user
```

Repeat until `.harness/bin/harness run` reports nothing to execute. Then read the
contre-expertise artifact and bring its "Pour l'orchestrateur" section to the
user — that is the part that needs them.

## Dispatching an order

Each order from `.harness/bin/harness run` carries four things. Honour all four:

| | |
|---|---|
| **The prompt text** | Give it **verbatim**. Do not summarise, do not add your own framing, do not "improve" it. It encodes the contract. |
| **The model** | Use it. This is the main cost lever in the whole system; overriding it upward silently multiplies the bill. |
| **The tools** | Use the allowlist as given. A read-only role that can write is no longer read-only. |
| **subagent / session** | `subagent` → spawn one, they run in parallel. `session` → it needs a terminal pane and human eyes; see below. |

Dispatch every `subagent` order of a wave **in one go**, in parallel. Waiting for
one before starting the next wastes the main thing waves are for.

## When a contract fails

`.harness/bin/harness verify` tells you exactly which condition failed and by how much. That
message is actionable — pass it on.

1. Re-dispatch the failing role, appending the verify output to its order:
   *"Your previous output failed its contract: min_bytes 206/1000. Continue from
   the existing file; do not restart from scratch."*
2. If it fails **twice**, stop retrying. A third attempt rarely succeeds and
   always costs. Report to the user: what was asked, what came back, and your
   read on whether the contract is wrong or the work is.

A contract that keeps failing is often a badly written contract, not a lazy
agent. Say so when you think it.

## Semantic reviews

A contract can carry a second layer that `verify` cannot evaluate itself:

```
✓ tenant-isolation
      ✓ min_bytes        1592 / 1200 attendus
      ? review sémantique — modèle minimal, à lancer :
        « Chaque constat nomme-t-il un fichier ? Réponds PASS ou FAIL. »
```

`must` is mechanical and free. `review` needs a model to judge it, so **you** run
it: once the mechanical checks pass, dispatch a sub-agent **on the model named
there** — it is the cheapest one on purpose — with the artifact and that exact
question, expecting `PASS` or `FAIL` plus one line.

A `FAIL` is handled like a failed contract: re-dispatch the role with the
reviewer's line attached. Never run the review on a bigger model than the one
declared; judging "does each finding name a file?" does not need reasoning, and
this is the one place where cost silently multiplies by the number of artifacts.

Skip the review entirely while the mechanical checks are still failing — there is
nothing to judge yet.

## When an agent asks you something

Agents are told, in every order, that they may stop and ask rather than guess.
`verify` and `run` list what is waiting, before anything else:

```
2 question(s) en attente de réponse
  bloquant  revue-business         .harness/questions/revue-business.md
  avis      revue-design           .harness/questions/revue-design.md
```

**`bloquant`** — the agent stopped on purpose. It did not fail. Re-dispatching it
unchanged just makes it stop again, at full price. Read the question, write the
answer into the same file under `## Réponse`, then re-dispatch.

**`avis`** — the agent did the work and disagrees with how it was asked to. Read
it before you read its artifact: an agent that says "you asked me to judge screens
from screenshots, and the error states aren't in them" has just told you the
result is partial, and that matters more than the result.

### Answer, or ask the human — but never guess

Answer yourself only when the answer is **in the project** and you can point to
where. Anything else goes to the human, quoted, with what you already checked:

| The question is about | You |
|---|---|
| A fact in the code, the docs, the history | answer, and say where you found it |
| A convention this project already follows | answer, and name the precedent |
| What the product is *supposed* to do | **ask the human** |
| Which of two directions to take | **ask the human**, with both costs |
| Whether something is in scope | **ask the human** |
| Anything where you'd write "I assume…" | **ask the human** |

A plausible guess is the expensive failure mode here: the agent does the work on
your assumption, the contract passes, and nobody finds out until someone reads
the artifact and recognises the wrong premise. If you are not sure, say you are
not sure. That sentence costs one line and saves a wave.

When you do ask the human, ask **all** pending questions at once. Three separate
interruptions for one wave is how people stop reading.

## What you escalate to the user

Escalate — and wait — for:

- **A structuring decision**: two roles disagree on direction, and picking one
  closes off the other. Present both positions and their costs; do not arbitrate
  silently.
- **Anything outside the declared scope**: a role reports something real that no
  role owns. Do not widen a scope on your own.
- **A contract failing twice** (above).
- **Spending that outstrips the point**: if a wave is heading well past what the
  question is worth, say so before the next one, not after.

Do **not** escalate: which model to use, which order to dispatch in, how to phrase
a prompt, whether to retry once. Those are yours.

## What you never do

- **Never write an artifact yourself.** If a role fails to produce it, that is a
  result, and the user needs to know. Writing it for them turns the whole
  verification layer into theatre.
- **Never edit a role file to make a failing contract pass.** Loosening a contract
  to get green is the one move that destroys the product's value. If a contract
  is genuinely wrong, say so and ask.
- **Never read every artifact into your own context** to summarise them. `verify`
  already tells you the state mechanically, for free. Read an artifact when you
  have a reason to read *that* artifact.

## Session roles

If `plan` shows any `session` role, lay out the terminal first:

```
.harness/bin/harness layout           # preview
.harness/bin/harness layout --apply   # create the tmux session
```

Then start each session role in its pane and tell the user which pane is which.
Those roles are the ones they can interrupt and correct mid-flight — that is the
whole reason they are sessions rather than sub-agents.

## Keeping the user in the picture

Before a wave: one line — which roles, which models, roughly what it will cost.
After `verify`: the pass/fail table as it came out, not a paraphrase.
At the end: what was produced, what failed, and the contre-expertise's verdict.

Report what happened, including what did not work. A run where two roles out of
four met their contracts is a normal outcome and useful information. Presenting
it as a success is not.

Answer in the user's language. The CLI currently prints in French.
