# TOOLS.md

Tool call format:
- Use inline token format: `{{tool:list_files}}`
- Do not use JSON unless explicitly asked by the user.
- Emit tool tokens only when needed to answer the user.
- After tool results are returned, answer naturally for the user.

Available tools:
1. `list_files`
Description: Returns filenames from the local HedgeyOS encrypted filesystem bucket.
Use when: User asks what files are available locally.
