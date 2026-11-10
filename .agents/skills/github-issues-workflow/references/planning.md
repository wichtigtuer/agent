# Planning work as GitHub issues

Use when asked to plan, break down, or organize work. Aim for a small, useful backlog, not an exhaustive one.

## Steps

1. **Clarify the outcome.** State the goal in one or two sentences. If it is ambiguous, ask the user before creating anything.
2. **Check what exists.**
   ```bash
   gh issue list --state all --limit 100 --json number,title,state,labels,parent
   gh issue list --state all --search "<keywords>"
   ```
   Reuse or extend an existing issue instead of duplicating it. Note any related issue to reference.
3. **Decide the shape.**
   - One independently verifiable outcome: one issue, no parent.
   - Several independent or separately verifiable parts: one parent issue (type epic or label `type:epic`) plus sub-issues.
   - Do not nest deeper than needed. Two levels is usually enough.
4. **Create the parent** with the overall outcome and overall acceptance criteria. Keep the detail in the children.
5. **Create the children** with `--parent <N>`. Each child gets:
   - A title naming an outcome.
   - A Description with enough context to work without this conversation.
   - Its own Acceptance criteria, each item verifiable.
   - A priority label only if order matters.
6. **Add dependencies** only for genuine execution order, using `--blocked-by`. Parent/child alone does not order work. Check for cycles first (see SKILL.md §1).
7. **Verify the structure.**
   ```bash
   gh issue view <parent> --json subIssues,subIssuesSummary
   gh issue view <child> --json parent,blockedBy,blocking
   ```
   Confirm every child has the right parent, dependencies point the right way, and at least one child is ready (see SKILL.md §3). If none is ready, a dependency is probably wrong.
8. **Report** the hierarchy to the user as a short tree with issue numbers. Do not paste full bodies.

## Sizing guidance

- A good leaf issue fits in one focused session and ends in something that can be tested or reviewed.
- If acceptance criteria exceed about six items or span unrelated areas, split it.
- If two issues always change together, merge them.
- Cross-cutting chores (docs, tests) belong in the issue they serve unless they are large enough to stand alone.

## Anti-patterns

- Creating issues for speculative or "someday" ideas. Mention them to the user instead, or use `priority:4` only if they ask.
- Turning every observation into a task.
- Using blocked-by to express "related". Use `Related to #N`.
- A chain of blocked-by links that makes everything sequential when parts could run in parallel.
- Titles that name a topic, not an outcome.
- Parents with a single child. Just write one issue.

## Example

Request: "Add authentication."

```text
#100 Implement authentication            (epic)
  #101 Design authentication model
  #102 Implement login endpoint          blocked by #101
  #103 Implement password reset          blocked by #101
  #104 Add authentication tests          blocked by #102, #103
  #105 Document authentication           blocked by #102, #103
```

After creation, #101 is the only ready leaf. Closing it makes #102 and #103 ready at the same time.
