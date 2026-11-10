# gh command cheatsheet (needs gh >= 2.94.0)

Confirm available flags and JSON fields with `gh issue <cmd> --help` before relying on anything here.

## Read

| Goal             | Command                                                                       |
| ---------------- | ----------------------------------------------------------------------------- |
| Open issues      | `gh issue list --state open --limit 100`                                      |
| Mine             | `gh issue list --state open --assignee @me`                                   |
| By label         | `gh issue list --state open --label "status:in-progress"`                     |
| By type (native) | `gh issue list --type Bug`                                                    |
| Search           | `gh issue list --state all --search "<keywords>"`                             |
| One issue        | `gh issue view N`                                                             |
| Structure        | `gh issue view N --json parent,subIssues,subIssuesSummary,blockedBy,blocking` |
| Comments         | `gh issue view N --json comments`                                             |

JSON fields on `list`/`view` include: assignees, author, blockedBy, blocking, body, closed, comments, createdAt, issueType, labels, milestone, number, parent, state, stateReason, subIssues, subIssuesSummary, title, updatedAt, url.

`blockedBy` and `blocking` are objects of the form `{nodes: [...], totalCount: n}`, not arrays.

## Create

```bash
gh issue create --title "T" --body-file - [--label a,b] [--type Task] \
  [--parent N] [--blocked-by A,B] [--blocking C] <<'EOF'
body
EOF
```

## Edit

| Goal                   | Flags (with `gh issue edit N`)                 |
| ---------------------- | ---------------------------------------------- |
| Labels                 | `--add-label x` / `--remove-label x`           |
| Assign                 | `--add-assignee @me` / `--remove-assignee @me` |
| Set parent             | `--parent P`                                   |
| Remove parent          | `--remove-parent`                              |
| Add / remove sub-issue | `--add-sub-issue C` / `--remove-sub-issue C`   |
| Blocked by             | `--add-blocked-by A` / `--remove-blocked-by A` |
| Blocking               | `--add-blocking C` / `--remove-blocking C`     |
| Type                   | `--type Bug` / `--remove-type`                 |
| Body                   | `--body-file -`                                |
| Milestone              | `--milestone "Name"` / `--remove-milestone`    |

`gh issue edit A --add-blocking B` is the same relationship as `gh issue edit B --add-blocked-by A`.
`--add-sub-issue` moves a child that already has another parent. Do not use it on several parents at once.
Relationship flags accept issue numbers or full URLs; use URLs across repositories.

## Lifecycle

```bash
gh issue comment N --body-file - <<'EOF'
text
EOF
gh issue close N --reason completed --comment "..."
gh issue close N --reason "not planned" --comment "..."
gh issue reopen N
```

## Labels

```bash
gh label list --limit 100
gh label create "status:in-progress" --color FBCA04 || true
```
