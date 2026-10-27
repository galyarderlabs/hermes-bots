// Host contract types, mirroring port-spec §3. Field names mirror the host.
export type RosterProfile = {
  name: string;
  display_name?: string;
  model?: string;
  provider?: string;
  description?: string;
  has_avatar?: boolean;
  ui_meta?: {
    'hermes-bots'?: {
      color?: string;
      image?: string | null;
      imageKind?: string;
      shape?: string;
      groups?: string[];
      group?: string;
    };
  };
  canonical_session?: ActivitySession | null;
  last_session?: ActivitySession | null;
};

export type ActivitySession = {
  id: string;
  resolved_id?: string;
  preview?: string;
  last_active?: number;
  message_count?: number;
  title?: string;
};

export type LiveSession = {
  id: string;
  title: string;
  preview: string;
  profile: string;
  model?: string;
  unread?: boolean;
  last_active?: number;
};

export type LiveUsage = {
  model?: string;
  input?: number;
  output?: number;
  reasoning?: number;
  prompt?: number;
  completion?: number;
  total?: number;
  calls?: number;
  avg_tps?: number;
  avg_latency_s?: number;
};

export type LiveMessage = {
  id: number;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  tool_name?: string | null;
  tool_status?: 'running' | 'done' | 'failed';
  duration_s?: number;
  reasoning?: string | null;
  timestamp?: number;
  token_count?: number | null;
  usage?: LiveUsage;
};

export type ToolActivity = {
  id: string;
  name: string;
  status: 'running' | 'done' | 'failed';
  duration_s?: number;
  summary?: string;
};

export type BotGroup = { name: string; members: string[] };
export type GroupMember = { member_id?: string; profile?: string; handle?: string; display_name?: string };
export type GroupRoom = {
  room_id: string;
  name: string;
  members?: GroupMember[];
  revision?: number;
  latest_seq?: number | null;
  disbanded_at?: number | null;
};
export type GroupEvent = {
  seq: number;
  kind: string;
  actor?: { kind: string; id: string };
  payload?: Record<string, unknown>;
  created_at?: number;
};

export type CronJob = {
  job_id: string;
  id?: string;
  name?: string;
  prompt?: string;
  prompt_preview?: string;
  schedule?: string;
  enabled?: boolean;
  state?: string;
  next_run_at?: string;
  last_run_at?: string;
  last_status?: string;
  last_error?: string;
  deliver?: string;
  model?: string;
  provider?: string;
  profile?: string;
};
export type CronRun = { id: string; title?: string; preview?: string; last_active?: number; started_at?: number };
export type CronDeliveryTarget = { id: string; name: string; home_target_set: boolean };
export type AutomationBlueprintField = {
  name: string;
  type: 'enum' | 'text' | 'time' | 'weekdays';
  label: string;
  default: string | null;
  options: string[];
  optional: boolean;
  help: string;
};
export type AutomationBlueprint = {
  key: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  fields: AutomationBlueprintField[];
};

export type Capability = { name: string; description?: string; label?: string; tool_count?: number; enabled: boolean };
export type ProfileDetails = {
  name: string;
  description?: string;
  soul?: string;
  model?: { provider?: string; default?: string };
  skills?: Capability[];
  toolsets?: Capability[];
};
export type ModelProvider = { name: string; slug: string; models?: string[]; featured_models?: string[]; authenticated?: boolean };

export type DisplayStatus = {
  profile: string;
  supported: boolean;
  installed: boolean;
  missing: string[];
  running: boolean;
  pid?: number | null;
  display?: string | null;
  geometry: string;
  install_command?: string | null;
  blocker?: string | null;
  placement?: string;
  lease: { holder: 'agent' | 'human'; viewer_hash?: string | null; since: number; epoch: number; reason: string };
  profile_key: string;
};
export type DisplayObserve = DisplayStatus & { ticket: string; path: string; viewer_id: string };
export type DisplayPaneState =
  | { kind: 'unsupported' }
  | { kind: 'needs-install'; command: string }
  | { kind: 'blocked'; reason: string }
  | { kind: 'stopped' }
  | { kind: 'running'; heldByHuman: boolean; controllable: boolean; watching: boolean };

export type NotificationPreferences = {
  enabled: boolean;
  includeProfiles: string[];
  alertOnFinish: boolean;
  quietHours: { enabled: boolean; startHour: number; endHour: number };
};

export type GatewayInfo = {
  version?: string;
  auth_required?: boolean;
  auth_flows?: string[];
  auth_providers?: unknown[];
};

export type RosterEntry =
  | { kind: 'bot'; profile: RosterProfile; lastActive: number }
  | { kind: 'group'; name: string; members: string[]; lastActive: number };
