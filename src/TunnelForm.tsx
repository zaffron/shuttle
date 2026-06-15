import { useState } from "react";
import type { Tunnel } from "./types";
import { ButtonRow, Field, GhostButton, ModalShell, PrimaryButton, TextInput } from "./ui";

export function TunnelForm({
  tunnel,
  onSave,
  onCancel,
}: {
  tunnel: Tunnel;
  onSave: (t: Tunnel) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Tunnel>(tunnel);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Tunnel>(key: K, value: Tunnel[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const submit = () => {
    if (!draft.name.trim()) return setError("Name is required.");
    if (!draft.remoteHost.trim()) return setError("Remote host is required.");
    if (!draft.localPort || draft.localPort < 1 || draft.localPort > 65535)
      return setError("Local port must be 1–65535.");
    if (!draft.remotePort || draft.remotePort < 1 || draft.remotePort > 65535)
      return setError("Remote port must be 1–65535.");
    onSave({
      ...draft,
      name: draft.name.trim(),
      remoteHost: draft.remoteHost.trim(),
    });
  };

  return (
    <ModalShell title={tunnel.name ? "Edit tunnel" : "New tunnel"} onClose={onCancel} wide>
      <Field label="Name">
        <TextInput
          value={draft.name}
          placeholder="Redis — Some Env"
          onChange={(e) => set("name", e.target.value)}
          autoFocus
        />
      </Field>

      <Field label="Remote host">
        <TextInput
          value={draft.remoteHost}
          placeholder="redis.internal.example.com"
          onChange={(e) => set("remoteHost", e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="font-mono text-xs"
        />
      </Field>

      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Field label="Local port">
            <TextInput
              type="number"
              value={draft.localPort}
              onChange={(e) => set("localPort", Number(e.target.value))}
            />
          </Field>
        </div>
        <span className="mb-5 text-zinc-400">→</span>
        <div className="flex-1">
          <Field label="Remote port">
            <TextInput
              type="number"
              value={draft.remotePort}
              onChange={(e) => set("remotePort", Number(e.target.value))}
            />
          </Field>
        </div>
      </div>

      <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-950/50 dark:text-zinc-400">
        Forwards{" "}
        <code className="rounded bg-zinc-200/60 px-1 py-0.5 font-mono dark:bg-zinc-800">
          127.0.0.1:{draft.localPort || "?"}
        </code>{" "}
        →{" "}
        <code className="break-all rounded bg-zinc-200/60 px-1 py-0.5 font-mono dark:bg-zinc-800">
          {draft.remoteHost || "host"}:{draft.remotePort || "?"}
        </code>{" "}
        through the bastion.
      </p>

      {error && (
        <div className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-400">
          {error}
        </div>
      )}

      <ButtonRow>
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
        <PrimaryButton onClick={submit}>Save</PrimaryButton>
      </ButtonRow>
    </ModalShell>
  );
}
