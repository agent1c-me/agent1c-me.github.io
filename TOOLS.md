# TOOLS.md

Tool call format:
- Use inline token format: `{{tool:list_files}}`
- For reading one file use: `{{tool:read_file|name=example.txt}}`
- For Wikipedia search use: `{{tool:wiki_search|query=hedgehog}}`
- For Wikipedia summary use: `{{tool:wiki_summary|title=Hedgehog}}`
- For GitHub public reads use: `{{tool:github_repo_read|request=owner/repo issue 123}}`
- Do not use JSON unless explicitly asked by the user.
- Emit tool tokens only when needed to answer the user.
- After tool results are returned, answer naturally for the user.

Available tools:
1. `list_files`
Description: Returns filenames from the local HedgeyOS encrypted filesystem bucket.
Use when: User asks what files are available locally.

2. `read_file`
Parameters:
- `name`: filename from `list_files` output (preferred)
- `id`: file id (optional fallback)
Description: Returns text content for text files. For large files returns head/tail excerpt.
Use when: User asks to open, inspect, summarize, or extract data from a specific file.

3. `wiki_search`
Parameters:
- `query`: topic or phrase
Description: Searches Wikipedia titles and snippets.
Use when: User asks factual questions and you need source grounding.

4. `wiki_summary`
Parameters:
- `title`: exact or likely page title
Description: Fetches a concise summary for one Wikipedia page.
Use when: User asks for explanation/background on a topic.

5. `github_repo_read`
Parameters:
- `request`: natural text (repo/path/issue/pr)
- `repo`: owner/repo (optional structured override)
- `path`: file path (optional)
- `issue`: issue number (optional)
- `pr`: pull request number (optional)
- `branch`: ref name (optional)
Description: Reads public GitHub repo metadata, issues, PRs, and file contents.
Use when: User asks about public GitHub repos, files, issues, or pull requests.

Policy:
- You can access local files via these tools. Do not claim you cannot access files without trying tools first.
- Use `list_files` when you need current file inventory to answer a user request.
- If user asks to open/read/summarize a specific file, call `read_file` first when a target can be identified.
- Use `list_files` only when file target is unclear or lookup fails.
- Do not narrate "I will read/open now" without emitting the tool call in the same reply.
- Do not claim file contents were read unless a `TOOL_RESULT read_file` was returned.
- If user asks factual web context, prefer Wikipedia tools before guessing.
- If user asks GitHub repo/file/issue/PR questions, use `github_repo_read` before claiming details.
