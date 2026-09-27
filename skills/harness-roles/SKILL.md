---
name: harness-roles
description: Turn a plain-language need into a harness role file (.harness/roles/*.yaml). Use whenever the user wants to add an agent, a role, a reviewer, a checker or a second opinion to their project — phrasings like "I want an agent that…", "add a role to review…", "can something check…", "create a reviewer for…". Also use to fix a role that fails to load, or to make a role's output contract actually verifiable.
license: MIT
---

# Writing harness roles

The user describes what they want in their own words. **You** turn it into a
valid role file. Never ask them to learn the YAML format — that is the whole
point of this skill.

Answer in the user's language. Write the role file's prose (`mission`, `brief`)
in that language too; keep the YAML keys in English.

## Process

**1. Explore before you ask.** You have the codebase; the user does not have to
describe it to you. Anything you can establish by reading — which framework, where
the migrations live, whether there is already an auth layer — you establish. A
question whose answer was in the repo spends the user's attention on your work.

**2. Decide whether the brief is already complete.** It is complete when you can
name, without guessing: the **perimeter** (what this role reads, and what it must
not judge), the **artifact** (what the user will do with it), and the **failure**
(what would make this role's output useless). If all three are settled, skip
straight to step 4 — but say in one line what you concluded, so a wrong reading
can be caught: *"I'm scoping this to the API layer and leaving the admin console
out — say if that's wrong."*

**3. Otherwise, run a completeness pass.** This is the step that decides whether
the run is worth its tokens. A role built on a misread need produces a perfectly
verified artifact that answers the wrong question.

If the `interroge` skill is available, use it — it encodes this exactly. Otherwise
follow the same protocol:

- **One question at a time.** Wait for the answer before the next one. A block of
  five questions gets one block of half-answers.
- **Descend the tree, resolve dependencies first.** The answer to "should this
  role also propose fixes?" changes what you need to ask about the artifact. Ask
  in an order where each answer narrows the next question.
- **Every question carries your recommendation and why.** Not *"should it cover
  the admin console?"* but *"I'd leave the admin console out: it bypasses tenant
  scoping by design, so every finding there would be a false positive. Include it?"*
  The user should be able to answer "yes, go on" and be confident they've been
  understood.
- **Stop when the next question wouldn't change the file.** That is the only
  stopping rule. Often it is one question. Rarely more than three. Length is not
  a sign of rigour — the pass exists to remove ambiguity, not to demonstrate it.

What is worth asking, roughly in this order:

| | |
|---|---|
| **Boundary** | What is explicitly *not* this role's business? The out-of-scope shapes the result more than the in-scope. |
| **Use** | What will they do with the artifact — triage a list, send it to someone, decide something? That determines its shape. |
| **Failure** | What would make this output useless? That sentence becomes the `must` contract. |
| **Order** | Only with several roles: does this one need another's output first? |

What you never ask: the model, the budget, the execution mode, the file name,
the artifact path. Those are yours to decide, and asking turns a briefing into a
form to fill in.

**4. Write the file** to `.harness/roles/<name>.yaml`.

**5. Run `.harness/bin/harness plan`** and show the user the line concerning their
new role. That is how they see it was understood, without reading YAML.

## The format

```yaml
role: security-audit                    # identifier, lowercase, unique
name: "Personal data audit"             # human label

mission: >
  One or two sentences. What this role is for, and what would make it useless.

scope:
  reads:  ["**"]                        # read wide — every role may read everything
  writes: ["{{artifacts}}/security.md"] # write narrow — one artifact, ideally

depends_on: [ux-review]                 # optional: wait for these roles' valid output

context:
  files: ["README.md", "docs/**/*.md"]  # what this role must read
  from_roles: [ux-review]               # their ARTIFACTS, never their conversation
  max_bytes: 150000

outputs:
  - id: audit
    path: "{{artifacts}}/security.md"
    must:                               # machine-checked, free, no model involved
      min_bytes: 1000
      frontmatter: [role, date]
      matches:
        - pattern: "^## Finding"
          min_count: 5
    review:                             # optional, semantic, cheapest model only
      model: minimal
      asks: >
        Does each finding name a concrete file or screen?
        Answer strictly PASS or FAIL followed by one line.

execution:
  model: standard                       # minimal | standard | maximal
  budget: { max_turns: 15, max_tokens: 120000 }
  on_failure: continue                  # block | continue | retry:2

brief: |
  The detailed instructions. Written as if speaking to the person doing the work.
  Say what method to follow, and say what you do NOT want.
```

## The hard part: making `must` verifiable

This is where most roles go wrong. A condition written in prose — *"contains at
least three solid objections"* — cannot be checked without a model, so it never
gets checked, so it becomes decoration.

Translate the intent into **structure the artifact will have**:

| The user says | You write |
|---|---|
| "review the screens" | `matches: [{ pattern: "^## Observation", min_count: 4 }]` |
| "list what data we store" | `matches: [{ pattern: "^## Data", min_count: 5 }]` |
| "each point must cite a file" | `matches: [{ pattern: "`[^`]+:[0-9]+`", min_count: 3 }]` |
| "a real analysis, not three lines" | `min_bytes: 1200` |
| "I want to know who wrote it and when" | `frontmatter: [role, date]` |

Then put the same requirement in the `brief`, in plain words, so the agent knows
what shape to produce. **The contract and the brief must agree** — a contract the
brief never mentions is a trap.

Use `review` only for what no regular expression can catch, and always with
`model: minimal`: checking is reading, not creating.

## Design rules

**Read wide, write narrow.** Every role may read everything — that is how roles
communicate. What you restrict is writing. A role that writes in more than three
places is probably two roles.

**A checker must be able to fail.** A role whose job is to contradict others and
that finds nothing has not done its job:

```yaml
role: second-opinion
depends_on: [ux-review, security-audit]
context:
  from_roles: [ux-review, security-audit]
outputs:
  - id: objections
    path: "{{artifacts}}/objections.md"
    must:
      matches:
        - pattern: "^## Objection"
          min_count: 3            # finding nothing = failing the contract
```

**Never pass the whole repository.** `context.files` lists what the role needs.
A role that must read everything is a role that was defined too broadly.

**Do not set `execution.mode`.** Leave it out; `harness` decides, and explains
its choice in `plan`. Force it only when the user explicitly wants to watch the
role work — then set `mode: session` and fill `execution.reason`.

## Choosing the model

| Value | Use for |
|---|---|
| `minimal` | Searching, listing, summarising, checking a format |
| `standard` | Most reviews and audits — the default |
| `maximal` | Judgement calls: strategy, architecture, contradicting others |

This single field is the main cost lever. A role set to `maximal` when
`standard` would do multiplies its cost for no gain.

## After writing

Run `.harness/bin/harness plan`. If the role does not appear, it failed to load — the error
names the file and the line. Fix it before telling the user it is ready.
