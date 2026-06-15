import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Bastion } from "./types";
import {
  ButtonRow,
  Field,
  GhostButton,
  ModalShell,
  PrimaryButton,
  Select,
  TextInput,
} from "./ui";

const FIELDS: { key: keyof Bastion; label: string; placeholder: string }[] = [
  { key: "region", label: "Region", placeholder: "us-east-1" },
  { key: "instanceId", label: "Instance ID", placeholder: "i-0123456789abcdef0" },
  { key: "osUser", label: "Instance OS user", placeholder: "ec2-user" },
  { key: "identityFile", label: "SSH private key", placeholder: "~/.ssh/id_ed25519" },
  { key: "publicKeyFile", label: "SSH public key", placeholder: "~/.ssh/id_ed25519.pub" },
];

export function SettingsPanel({
  bastion,
  onSave,
  onCancel,
}: {
  bastion: Bastion;
  onSave: (b: Bastion) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Bastion>(bastion);
  const [profiles, setProfiles] = useState<string[] | null>(null);

  useEffect(() => {
    invoke<string[]>("aws_profiles")
      .then(setProfiles)
      .catch(() => setProfiles([]));
  }, []);

  const set = (key: keyof Bastion, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const hasProfiles = profiles !== null && profiles.length > 0;
  // Keep the current value selectable even if it isn't in the discovered list.
  const options = Array.from(
    new Set([...(profiles ?? []), draft.awsProfile].filter(Boolean)),
  );

  return (
    <ModalShell title="Bastion settings" onClose={onCancel}>
      <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
        Used to push your key (EC2 Instance Connect) and connect via the SSM
        ProxyCommand. Shared by every tunnel.
      </p>

      <Field label="AWS profile">
        {hasProfiles ? (
          <Select
            value={draft.awsProfile}
            onChange={(e) => set("awsProfile", e.target.value)}
          >
            {options.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        ) : (
          <>
            <TextInput
              value={draft.awsProfile}
              placeholder="default"
              onChange={(e) => set("awsProfile", e.target.value)}
            />
            {profiles !== null && (
              <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                No AWS profiles found. Run <code>aws configure sso</code> (or{" "}
                <code>aws configure</code>) in a terminal to set one up.
              </p>
            )}
          </>
        )}
      </Field>

      {FIELDS.map((f) => (
        <Field key={f.key} label={f.label}>
          <TextInput
            value={draft[f.key]}
            placeholder={f.placeholder}
            onChange={(e) => set(f.key, e.target.value)}
          />
        </Field>
      ))}

      <ButtonRow>
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
        <PrimaryButton onClick={() => onSave(draft)}>Save</PrimaryButton>
      </ButtonRow>
    </ModalShell>
  );
}
