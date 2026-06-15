import { useState } from "react";
import type { Bastion } from "./types";
import { ButtonRow, Field, GhostButton, ModalShell, PrimaryButton, TextInput } from "./ui";

const FIELDS: { key: keyof Bastion; label: string; placeholder: string }[] = [
  { key: "awsProfile", label: "AWS profile", placeholder: "default" },
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

  const set = (key: keyof Bastion, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <ModalShell title="Bastion settings" onClose={onCancel}>
      <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
        Used to push your key (EC2 Instance Connect) and connect via the SSM
        ProxyCommand. Shared by every tunnel.
      </p>
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
