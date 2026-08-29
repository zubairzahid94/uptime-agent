# Personal Uptime Agent

Self-hosted, single-owner Discord bot that acts as a conversational agent for
HTTP endpoint monitoring. A learning project for AI agent design patterns
(tool calling, guardrails, evals) as much as a useful tool.

DM the bot in plain English:

```
monitor https://myapp.com every 10 min, alert if not 200
stop the one for hanifautos
how many monitors are on?
```

An LLM interprets intent via tool calling and maps it to structured actions.
Every mutating action (create, edit, pause, resume, delete) is confirmed with
a deterministic yes/no prompt before it runs, so the bot never mutates state
on the model's say-so alone. A separate, deterministic scheduler with zero
LLM involvement polls due jobs on a plain loop, evaluates responses against
each monitor's alert condition, and notifies only on state change (up to
down, down to up).

This is a v1 scoped for a single owner: one Discord user ID is allowed to
talk to the bot, DM-only, no guild/multi-tenant permission logic.

## Self-hosting

Requires Docker and Docker Compose.

1. Clone the repo:

   ```bash
   git clone <this-repo-url>
   cd uptime-agent
   ```

2. Copy the example env file and fill it in:

   ```bash
   cp .env.example .env
   ```

   - `DISCORD_TOKEN` - your bot's token, from the
     [Discord Developer Portal](https://discord.com/developers/applications).
   - `OWNER_DISCORD_ID` - the only Discord user ID the bot will respond to
     (right-click your name in Discord -> Copy User ID; requires Developer
     Mode enabled).
   - `GEMINI_API_KEY` - from [Google AI Studio](https://aistudio.google.com/apikey).
   - `MAX_MONITORS` - optional, soft cap on total monitors for this
     deployment, defaults to 50.

   `DATABASE_URL` is already set correctly for the Docker Compose setup and
   normally doesn't need to change.

3. Start the bot:

   ```bash
   docker compose up -d
   ```

   The container entrypoint runs database migrations before starting the
   app, and monitor data persists in `./data` on the host via the volume
   mount in `docker-compose.yml`.

Your real `.env` is gitignored and should never be committed; only
`.env.example` (with annotated placeholder values) is tracked.

## Tools (v1)

The LLM only ever acts through this fixed set of tools; every call's
arguments are re-validated against a Zod schema before any handler runs.

| Tool | Description | Mutating (needs confirmation) |
| --- | --- | --- |
| `create_monitor` | Create a new HTTP monitor | Yes |
| `list_monitors` | List all monitors | No |
| `get_monitor_status` | Get the current status of one monitor | No |
| `pause_monitor` | Pause a monitor so it stops being polled | Yes |
| `resume_monitor` | Resume a paused monitor | Yes |
| `delete_monitor` | Permanently delete a monitor | Yes |
| `edit_monitor` | Change a monitor's interval, expected status, url, or label | Yes |
| `get_summary` | Get a count/overview of all monitors | No |

Read-only tools never require confirmation. Every mutating tool requires a
yes/no confirmation, uniformly, no risk-tiering - and the confirmation
message itself is built from a deterministic template, never LLM-phrased.

## Before shipping a prompt/tool/provider change

`npm run eval` runs the golden-dataset eval harness (single-turn tool/arg
matching plus multi-turn disambiguation sequences) against the live LLM
provider. It is deliberately **not** wired into blocking CI/CD - most merges
(scheduler fixes, logging, Docker config) don't touch tool-calling accuracy,
and tying the eval to every commit would spend API budget and reintroduce
flakiness on changes that couldn't have broken it.

Instead, `npm run eval` is a **required manual step** whenever you change:

- the system prompt,
- a tool's name, description, or Zod schema (`src/llm/tools.ts`), or
- the LLM provider or adapter (`src/llm/`).

Run it locally (needs `GEMINI_API_KEY` set) and review the results before
merging any such change. A separate, path-filtered GitHub Actions workflow
(`.github/workflows/eval.yml`) also runs the eval against the live provider
on PRs touching `src/llm/**`, `src/tools/**`, or `eval/**`, but it runs with
`continue-on-error: true` - report-only, not a merge gate. `npm run eval`
locally is still the step you're responsible for running and reviewing
before shipping.

## License

[MIT](./LICENSE)
