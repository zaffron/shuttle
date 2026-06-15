import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  Config,
  EnvCheck,
  ExitEvent,
  LogEvent,
  RunState,
  Tunnel,
  TunnelStatus,
} from "./types";
import { TunnelForm } from "./TunnelForm";
import { SettingsPanel } from "./SettingsPanel";
import { ThemeToggle } from "./ThemeToggle";
import { useTheme } from "./useTheme";

const POLL_MS = 1500;
const MAX_LOG_LINES = 500;

interface LogLine {
  id: string;
  line: string;
  ts: number;
}

function newTunnel(): Tunnel {
  return {
    id: crypto.randomUUID(),
    name: "",
    localPort: 16379,
    remoteHost: "",
    remotePort: 6379,
  };
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [env, setEnv] = useState<EnvCheck | null>(null);
  const [states, setStates] = useState<Record<string, RunState>>({});
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [editing, setEditing] = useState<Tunnel | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const { theme, setTheme } = useTheme();

  const setState = useCallback((id: string, s: RunState) => {
    setStates((prev) => ({ ...prev, [id]: s }));
  }, []);

  const pushLog = useCallback((id: string, line: string) => {
    setLogs((prev) =>
      [...prev, { id, line, ts: Date.now() }].slice(-MAX_LOG_LINES),
    );
  }, []);

  const refresh = useCallback(async () => {
    const cfg = await invoke<Config>("get_config");
    setConfig(cfg);
    return cfg;
  }, []);

  const flash = useCallback((kind: "ok" | "err", msg: string) => {
    setBanner({ kind, msg });
    window.setTimeout(() => setBanner(null), 6000);
  }, []);

  const reportError = useCallback(
    (err: unknown) => {
      const msg = String(err);
      const missingProfile = msg.match(/config profile \(([^)]+)\) could not be found/i);
      if (missingProfile) {
        flash(
          "err",
          `AWS profile “${missingProfile[1]}” doesn't exist. Open Bastion settings to pick a configured profile.`,
        );
      } else if (/unable to locate credentials|you must specify a region|no credentials/i.test(msg)) {
        flash("err", "No AWS credentials found — click “Sign in” for SSO, or run `aws configure`.");
      } else if (/token has expired|sso session.*expired|refresh failed|expired or invalid|the sso session/i.test(msg)) {
        flash("err", `${msg} — click “Sign in” to refresh your AWS SSO session.`);
      } else if (/public key not found/i.test(msg)) {
        flash("err", `${msg}. Generate one with \`ssh-keygen -t ed25519\`.`);
      } else if (/not authorized|accessdenied|unauthorizedoperation|is not authorized/i.test(msg)) {
        flash("err", `${msg} — check your AWS permissions, or click “Sign in”.`);
      } else {
        flash("err", msg);
      }
    },
    [flash],
  );

  useEffect(() => {
    refresh();
    invoke<EnvCheck>("check_environment").then(setEnv);

    const unlistenLog = listen<LogEvent>("tunnel-log", (e) => {
      pushLog(e.payload.id, e.payload.line);
    });
    const unlistenExit = listen<ExitEvent>("tunnel-exited", (e) => {
      const { id, code } = e.payload;
      setStates((prev) => ({
        ...prev,
        [id]: code && code !== 0 ? "error" : "stopped",
      }));
    });

    const poll = setInterval(async () => {
      const list = await invoke<TunnelStatus[]>("tunnel_states");
      setStates((prev) => {
        const next = { ...prev };
        for (const s of list) {
          const cur = next[s.id];
          if (s.running) {
            next[s.id] = "running";
          } else if (cur === "running") {
            next[s.id] = "stopped";
          }
        }
        return next;
      });
    }, POLL_MS);

    return () => {
      unlistenLog.then((f) => f());
      unlistenExit.then((f) => f());
      clearInterval(poll);
    };
  }, [refresh, pushLog]);

  const start = useCallback(
    async (t: Tunnel) => {
      setState(t.id, "starting");
      setLogOpen(true);
      try {
        await invoke("start_tunnel", { id: t.id });
      } catch (err) {
        setState(t.id, "error");
        pushLog(t.id, `error: ${String(err)}`);
        reportError(err);
      }
    },
    [setState, pushLog, reportError],
  );

  const stop = useCallback(
    async (t: Tunnel) => {
      try {
        await invoke("stop_tunnel", { id: t.id });
        setState(t.id, "stopped");
      } catch (err) {
        flash("err", String(err));
      }
    },
    [setState, flash],
  );

  const saveConfig = useCallback(async (cfg: Config) => {
    await invoke("save_config", { config: cfg });
    setConfig(cfg);
  }, []);

  const onSaveTunnel = useCallback(
    async (t: Tunnel) => {
      if (!config) return;
      const exists = config.tunnels.some((x) => x.id === t.id);
      const tunnels = exists
        ? config.tunnels.map((x) => (x.id === t.id ? t : x))
        : [...config.tunnels, t];
      await saveConfig({ ...config, tunnels });
      setEditing(null);
    },
    [config, saveConfig],
  );

  const onDeleteTunnel = useCallback(
    async (t: Tunnel) => {
      if (!config) return;
      if (states[t.id] === "running" || states[t.id] === "starting") {
        await stop(t);
      }
      await saveConfig({
        ...config,
        tunnels: config.tunnels.filter((x) => x.id !== t.id),
      });
    },
    [config, saveConfig, states, stop],
  );

  const testConnection = useCallback(async () => {
    try {
      await invoke("test_connection");
      flash("ok", "Key pushed to bastion — connection looks good.");
    } catch (err) {
      reportError(err);
    }
  }, [flash, reportError]);

  const signIn = useCallback(async () => {
    setSigningIn(true);
    setLogOpen(true);
    try {
      await invoke("sso_login");
      flash("ok", "Signed in to AWS SSO.");
    } catch (err) {
      reportError(err);
    } finally {
      setSigningIn(false);
    }
  }, [flash, reportError]);

  const filteredLogs = useMemo(() => logs, [logs]);

  if (!config) {
    return <div className="loading">Loading…</div>;
  }

  return (
    <div className="flex h-full flex-col bg-zinc-50 font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-zinc-200 bg-white/80 px-5 py-3 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex items-center gap-2.5">
          <span className="text-xl">🛰️</span>
          <h1 className="text-base font-semibold tracking-tight">Shuttle</h1>
          <span className="hidden text-xs text-zinc-500 sm:inline dark:text-zinc-400">
            SSM bastion tunnels
          </span>
        </div>
        <div className="flex items-center gap-2">
          <EnvBadges env={env} />
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
            onClick={signIn}
            disabled={signingIn}
            title="aws sso login"
          >
            {signingIn && (
              <span
                className="inline-block h-3 w-3 rounded-full border-2 border-current border-t-transparent"
                style={{ animation: "spin 0.7s linear infinite" }}
              />
            )}
            {signingIn ? "Signing in…" : "Sign in"}
          </button>
          <button
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
            onClick={testConnection}
          >
            Test connection
          </button>
          <button
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
            onClick={() => setSettingsOpen(true)}
          >
            Bastion
          </button>
          <ThemeToggle theme={theme} setTheme={setTheme} />
        </div>
      </header>

      {banner && (
        <div
          className={`px-5 py-2 text-sm font-medium ${
            banner.kind === "ok"
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "bg-rose-500/10 text-rose-700 dark:text-rose-400"
          }`}
        >
          {banner.msg}
        </div>
      )}

      <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-5 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Tunnels
          </h2>
          <button
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 active:scale-[0.98]"
            onClick={() => setEditing(newTunnel())}
          >
            + Add tunnel
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {config.tunnels.map((t) => (
            <TunnelCard
              key={t.id}
              tunnel={t}
              state={states[t.id] ?? "stopped"}
              onStart={() => start(t)}
              onStop={() => stop(t)}
              onEdit={() => setEditing(t)}
              onDelete={() => onDeleteTunnel(t)}
            />
          ))}
          {config.tunnels.length === 0 && (
            <p className="rounded-xl border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              No tunnels yet. Add one to get started.
            </p>
          )}
        </div>
      </main>

      <LogPane
        logs={filteredLogs}
        open={logOpen}
        onToggle={() => setLogOpen((o) => !o)}
        onClear={() => setLogs([])}
      />

      {editing && (
        <TunnelForm
          tunnel={editing}
          onSave={onSaveTunnel}
          onCancel={() => setEditing(null)}
        />
      )}

      {settingsOpen && (
        <SettingsPanel
          bastion={config.bastion}
          onSave={async (bastion) => {
            await saveConfig({ ...config, bastion });
            setSettingsOpen(false);
            flash("ok", "Bastion settings saved.");
          }}
          onCancel={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

function EnvBadges({ env }: { env: EnvCheck | null }) {
  if (!env) return null;
  const items = [
    { label: "aws", ok: env.aws },
    { label: "ssh", ok: env.ssh },
    { label: "ssm-plugin", ok: env.sessionManagerPlugin },
  ];
  return (
    <div className="mr-1 hidden items-center gap-1.5 md:flex">
      {items.map((i) => (
        <span
          key={i.label}
          title={i.ok ? "found on PATH" : "not found on PATH"}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            i.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${i.ok ? "bg-emerald-500" : "bg-rose-500"}`}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

const DOT_CLASS: Record<RunState, string> = {
  stopped: "bg-zinc-400 dark:bg-zinc-600",
  starting: "bg-amber-500 animate-pulse",
  running: "bg-emerald-500",
  error: "bg-rose-500",
};

const STATE_LABEL: Record<RunState, string> = {
  stopped: "Stopped",
  starting: "Starting…",
  running: "Connected",
  error: "Error",
};

function TunnelCard({
  tunnel,
  state,
  onStart,
  onStop,
  onEdit,
  onDelete,
}: {
  tunnel: Tunnel;
  state: RunState;
  onStart: () => void;
  onStop: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const active = state === "running" || state === "starting";
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            {state === "running" && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            )}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${DOT_CLASS[state]}`} />
          </span>
          <span className="truncate font-medium">{tunnel.name || "(unnamed)"}</span>
          <span
            className={`text-xs ${
              state === "error"
                ? "text-rose-600 dark:text-rose-400"
                : state === "running"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {STATE_LABEL[state]}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <code className="selectable rounded bg-zinc-100 px-1.5 py-0.5 font-mono dark:bg-zinc-800">
            127.0.0.1:{tunnel.localPort}
          </code>
          <span className="text-zinc-400">→</span>
          <code className="selectable truncate rounded bg-zinc-100 px-1.5 py-0.5 font-mono dark:bg-zinc-800">
            {tunnel.remoteHost}:{tunnel.remotePort}
          </code>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {active ? (
          <button
            className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-500 active:scale-[0.98] disabled:opacity-50"
            onClick={onStop}
            disabled={state === "starting"}
          >
            Stop
          </button>
        ) : (
          <button
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500 active:scale-[0.98]"
            onClick={onStart}
          >
            Start
          </button>
        )}
        <button
          className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
          onClick={onEdit}
          disabled={active}
          title="Edit"
        >
          ✎
        </button>
        <button
          className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 transition hover:bg-rose-100 hover:text-rose-600 disabled:opacity-40 dark:hover:bg-rose-950/50 dark:hover:text-rose-400"
          onClick={onDelete}
          disabled={active}
          title="Delete"
        >
          🗑
        </button>
      </div>
    </div>
  );
}

function LogPane({
  logs,
  open,
  onToggle,
  onClear,
}: {
  logs: LogLine[];
  open: boolean;
  onToggle: () => void;
  onClear: () => void;
}) {
  return (
    <section className="border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <button
        className="flex w-full items-center justify-between px-5 py-2 text-xs font-medium text-zinc-500 transition hover:text-zinc-800 dark:hover:text-zinc-200"
        onClick={onToggle}
      >
        <span className="inline-flex items-center gap-1.5">
          <span className={`transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
          Logs
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] tabular-nums dark:bg-zinc-800">
            {logs.length}
          </span>
        </span>
        {logs.length > 0 && (
          <span
            className="rounded px-2 py-0.5 text-[11px] hover:bg-zinc-100 dark:hover:bg-zinc-800"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
          >
            Clear
          </span>
        )}
      </button>
      {open && (
        <div className="max-h-48 overflow-y-auto border-t border-zinc-100 px-5 py-2 font-mono text-xs dark:border-zinc-800">
          {logs.length === 0 && (
            <div className="py-1 text-zinc-400">No output yet.</div>
          )}
          {logs.map((l, i) => (
            <div key={i} className="flex gap-2 py-0.5">
              <span className="shrink-0 text-indigo-500 dark:text-indigo-400">
                {l.id}
              </span>
              <span className="selectable break-all text-zinc-700 dark:text-zinc-300">
                {l.line}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
