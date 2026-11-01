# play-listings-mcp

A local [MCP](https://modelcontextprotocol.io) server that lets AI assistants such as GitHub Copilot (agent mode) read and improve Google Play store listings for your Android apps, with a built-in safety net: **the AI proposes, you approve.**

```
Copilot (agent mode) → play-listings-mcp (local, stdio) → Google Play Developer API
```

The assistant never sees your service account key. It only sees the small set of tools this server exposes.

> **Status:** implemented according to [`docs/plan.md`](docs/plan.md). Not yet verified against a real Play Console account; see Known limitations.

## Features

- Fetch localized store listing texts (title, short description, full description) per app and language
- Propose changes as **local drafts** with a diff and character counts
- Propose a new localized listing as a draft without creating it on Google Play
- Validation against Google Play's character limits: title 30, short description 80, full description 4000
- Publishing to Google Play is **off by default** and requires explicit enabling plus per-draft confirmation
- Allowlist of the apps the server is allowed to touch
- No deletion, and no changes to releases, tracks, pricing, or app content

## Tools

| Tool                     | Type               | Description                                                     |
| ------------------------ | ------------------ | --------------------------------------------------------------- |
| `list_apps`              | read               | Lists the apps in the allowlist                                 |
| `list_listings`          | read               | All localized listings for an app                               |
| `get_listing`            | read               | One listing for an app and language                             |
| `propose_listing_update` | local write        | Validates and saves a draft, returns a diff                     |
| `list_drafts`            | read               | Lists saved drafts                                              |
| `get_draft`              | read               | Shows one full draft with a diff per field                      |
| `apply_draft`            | **writes to Play** | Publishes a draft. Only available when `PLAY_ENABLE_APPLY=true` |

`apply_draft` validates the draft again (drafts on disk are untrusted input), checks that the live text has not changed since the draft was created, re-validates the character limits, and requires `confirm: true` and the correct package name. A draft can only be published once; afterwards it is moved to `applied/`.

To propose a new language, call `propose_listing_update` with `createNew: true`, the target `language`, and all three fields: `title`, `shortDescription`, and `fullDescription`. The server verifies that the listing does not already exist. The draft's `base` and `base_hash` are `null`, and its diff shows the new text against empty fields. Review it with `get_draft`; only an explicit request to publish authorizes `apply_draft`. Before creating it, the server checks again in the publishing edit that the listing is still absent. Existing listings continue to use the normal update workflow.

## Requirements

- Node.js 24 or newer
- A Google Cloud project with the **Google Play Android Developer API** enabled
- Access to Google Play Console as account owner or admin
- VS Code with GitHub Copilot (agent mode), or another MCP client

## Setup

### 1. Create a service account

1. In Google Cloud Console: create a service account and download a JSON key.
2. In Play Console: **Users and permissions** → invite the service account email.
3. Grant only the **Manage store presence** permission, and only on the apps you want to use. That is enough for store listing texts.
4. Wait a while. It can take some time before the access takes effect.

Keep the key file outside the repository, for example in `~/.secrets/play-key.json`, and restrict its permissions (`chmod 600`).

### 2. Install and build

```bash
git clone https://github.com/FrankBurmo/google-play-listings-mcp.git
cd google-play-listings-mcp
npm install
npm run build
```

### 3. Configure

The server is configured with environment variables:

| Variable                | Required | Description                                                                                          |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `PLAY_KEY_FILE`         | yes      | Path to the service account JSON key                                                                 |
| `PLAY_ALLOWED_PACKAGES` | yes      | Comma-separated list of package names, e.g. `com.example.app1,com.example.app2`                      |
| `PLAY_DRAFT_DIR`        | no       | Directory for drafts. Default: `./drafts`. Published drafts are moved to `<PLAY_DRAFT_DIR>/applied/` |
| `PLAY_ENABLE_APPLY`     | no       | Set to `true` to enable `apply_draft`. Default: `false`                                              |
| `LOG_LEVEL`             | no       | `error`, `warn`, `info` or `debug`. Default: `info`                                                  |

The Google Play API has no endpoint for listing all apps on an account, so `PLAY_ALLOWED_PACKAGES` also serves as the list of which apps exist.

### 4. Register in VS Code

Copy `.vscode/mcp.example.json` to `.vscode/mcp.json` (or add it to your user settings) and adjust it. Copilot's MCP host does not support `${workspaceFolder}` or `${input:...}` substitutions, so use a relative entry point and set `PLAY_KEY_FILE` to the absolute path of your key:

```json
{
  "servers": {
    "play-listings": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/index.js"],
      "env": {
        "PLAY_KEY_FILE": "C:\\Users\\<username>\\.secrets\\play-key.json",
        "PLAY_ALLOWED_PACKAGES": "com.example.app1,com.example.app2",
        "PLAY_ENABLE_APPLY": "false"
      }
    }
  }
}
```

Open Copilot Chat, select **Agent**, and check that the tools from `play-listings` show up.

## Usage

Example prompts for Copilot:

- "Fetch the Norwegian listing for `com.example.app1` and suggest a better short description."
- "Go through all languages for the app and point out texts that are close to the character limits."
- "Suggest a clearer full description in `nb-NO`, and keep all factual information."

Recommended workflow:

1. Let the assistant fetch the listing and create a draft with `propose_listing_update`.
2. Read the full draft and diff yourself (`get_draft`).
3. Enable publishing (`PLAY_ENABLE_APPLY=true`) only when you actually intend to publish, then explicitly ask to apply that specific draft.
4. Turn publishing off again afterwards.

The repository also contains `.github/copilot-instructions.md` with guidelines for tone and rules for store texts (no keyword stuffing, no misleading claims, correct character limits).

## Security model

- **Least privilege:** the service account only needs _Manage store presence_.
- **Allowlist:** every tool rejects packages that are not in `PLAY_ALLOWED_PACKAGES`.
- **Writing is off by default**, and `apply_draft` requires `confirm`, the correct package name, and that the live text is unchanged since the draft was created.
- **Text is data:** content fetched from Play and from drafts must be treated as data, not instructions. Do not enable auto-approval of tool calls for `apply_draft`.
- **No secrets in logs.** All logging goes to stderr, since stdout is used by the MCP protocol.
- **Keep the key out of the repo.** `drafts/`, `applied/`, `.env` and key files are in `.gitignore`.

Found a security issue? Report it privately via GitHub Security Advisories rather than a public issue.

## Development

```bash
npm run dev        # compile with watch
npm run lint       # OxLint
npm run format     # OxFmt (use format:check to only verify)
npm run typecheck  # tsc --noEmit
npm test           # vitest (no tests talk to the real Google API)
npm run build      # compile to dist/
```

Project structure and phases are described in [`docs/plan.md`](docs/plan.md).

## Known limitations

- Not yet tested against the real Google Play API (all tests use mocks). Verify with one app and `PLAY_ENABLE_APPLY=false` first.
- Only store listing texts are supported. Screenshots, graphics, releases and tracks are out of scope.
- Google may require changes to go through review before they become visible in the store.
- Character limits are counted in Unicode code points. This is assumed to match Google Play and should be verified manually.
- The live-text check and the commit happen in separate edits, so there is a small window in which the live text could change in between.
- New-listing creation uses Google's `edits.listings.update` after an absence check in the same edit. Behavior with concurrent edits and Play review requirements should be verified against a real Play Console account.
- The server has no access to Play Console data (conversion rate, search terms, etc.). If you want data-driven optimization, you need to give the assistant the numbers yourself.
- You are responsible for ensuring that published texts comply with [Google Play's metadata policy](https://support.google.com/googleplay/android-developer/answer/9898842).

## Contributing

Issues and pull requests are welcome. Stick to the principle of a small tool set, and do not add deletion or other destructive operations without a strong security rationale.

## License

Choose a license (for example MIT) and add it as `LICENSE`.
