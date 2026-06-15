export interface Bastion {
  awsProfile: string;
  region: string;
  instanceId: string;
  osUser: string;
  identityFile: string;
  publicKeyFile: string;
}

export interface Tunnel {
  id: string;
  name: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
}

export interface Config {
  bastion: Bastion;
  tunnels: Tunnel[];
}

export interface TunnelStatus {
  id: string;
  running: boolean;
}

export interface EnvCheck {
  aws: boolean;
  ssh: boolean;
  sessionManagerPlugin: boolean;
}

export interface LogEvent {
  id: string;
  line: string;
}

export interface ExitEvent {
  id: string;
  code: number | null;
}

export type RunState = "stopped" | "starting" | "running" | "error";
