# Claude Code on GPT-6.2 Astra

`bstack-claude` selects `gpt-6.2-astra` for the coordinator through a private [CLIProxyAPI v8.0.80](https://github.com/router-for-me/CLIProxyAPI/releases/tag/v8.0.80) instance. No patched binary, TLS interception, global Claude settings, or changes to worker model assignments are needed. Prompts and tool results sent to Astra use your Codex account and quota.

Set `B=/absolute/path/to/plugins/bstack/bin/bstack-claude`. For a new install, download the upstream archive for your platform, verify its SHA-256 against `checksums.txt` in the linked release, extract it and run `"$B" install /path/to/cli-proxy-api`. Install refuses to overwrite an existing runtime.

For a short command, link the launcher once: `mkdir -p ~/.local/bin && ln -s "$B" ~/.local/bin/bstack-claude`. Ensure `~/.local/bin` is on your `PATH`.

From the target project, run **`bstack-claude`**. It starts the private proxy in the background if needed, reuses an existing instance, and opens Claude Code in the current project. On first use in an interactive terminal it starts Codex browser sign-in if no account or models are configured. Subsequent launches reuse that login. No second terminal or login-time service is required.

The private runtime under `~/.local/share/bstack-cliproxyapi` contains its binary, configuration, local access key and OAuth state. Only `127.0.0.1:17891` is exposed. Use a shell without explicit Anthropic auth or endpoint overrides. The launcher checks the authenticated `/v1/models` list before starting. If access has expired, run `bstack-claude login`; it will not silently choose a different model. `bstack-claude serve` is still available for foreground diagnostics.

New sessions start on Astra. When the proxy also lists `gpt-6.2-sol`, open `/model` and select **GPT-6.2 Sol (Codex)**. Open `/model` again to switch back to **GPT-6.2 Astra (Codex)** in the same conversation.

Only the opted-in process tree gets the local endpoint. The `bstack-run` worker entrypoint drops the coordinator's proxy overrides, so Claude workers can use native Claude auth and OpenCode workers keep their own configuration. A plain Claude session started separately is unchanged.

**Rollback:** use `claude --plugin-dir /absolute/path/to/plugins/bstack` from a normal terminal. The automatic proxy stays available between sessions; exit proxy sessions and run `bstack-claude stop` to shut it down. A manually started `serve` is stopped with Ctrl-C in its own terminal. Then `bstack-claude remove` deletes only the marked runtime, including its local Codex login; it does not revoke an OAuth grant at the provider.
