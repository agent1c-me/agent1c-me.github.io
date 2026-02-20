# TOOLS.md

Tool call format:
- Use inline tokens: `{{tool:name|arg=value}}`
- Examples:
  `{{tool:list_files}}`
  `{{tool:read_file|name=example.txt}}`
  `{{tool:wm_action|action=open_url|url=https://example.com}}`
  `{{tool:shell_exec|command=pwd}}`
- Do not use JSON unless explicitly asked.

Available tools:
1. `list_files`
- Returns local filenames with id/type/size.

2. `read_file`
- Args: `name` (preferred), `id` (fallback).
- Reads one local file (text, large-text excerpt, or sampled base64 for binary).

3. `wiki_search`
- Arg: `query`.
- Returns top Wikipedia matches.

4. `wiki_summary`
- Arg: `title`.
- Returns a concise Wikipedia summary.

5. `github_repo_read`
- Arg: `request` (owner/repo readme, issue, pr, file path).
- Reads public GitHub repo/issue/pr/file text.

6. `shell_exec`
- Args: `command`, `timeout_ms` (optional).
- Runs local relay shell command.

7. `wm_action`
- Args:
  `action = list_windows | list_apps | tile | arrange | focus_window | minimize_window | restore_window | open_app | open_url`
  `title/name/window` for window targets, `app/id/name` for app targets, `url/link` for open_url.
- Controls visible HedgeyOS windows/apps/browser.

Rules:
- Use tools only when needed.
- Never claim tool outcomes without matching `TOOL_RESULT`.
- For file-read claims, require `TOOL_RESULT read_file` first.
- For shell-command claims, require `TOOL_RESULT shell_exec` first.
- For visible desktop actions or URL opens, use `wm_action`.
- After `TOOL_RESULT`, answer naturally and briefly.
