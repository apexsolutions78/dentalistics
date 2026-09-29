export type Role = 'owner' | 'receptionist' | 'admin';

export interface SessionUser {
  id: number;
  email: string;
  role: Role;
  organizationId: number;
}

export type ConfigSource = 'org' | 'deployment' | 'default';

export interface BusinessDay {
  open: string;
  close: string;
}

export type BusinessHours = Record<string, BusinessDay | null>;

export interface ClinicSettings {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  logoUrl: string | null;
  businessHours: BusinessHours | null;
  timezone: string | null;
  reviewUrl: string | null;
}

export interface QuietHours {
  enabled: boolean;
  start: string;
  end: string;
}

export interface ReminderConfig {
  enabled: boolean;
  channel: 'SMS' | 'WHATSAPP';
  provider: string;
  offsetsHours: number[];
  quietHours: QuietHours;
  templates: Record<string, string>;
  maxAttempts: number;
}

export interface NoShowConfig {
  enabled: boolean;
  channel: 'SMS' | 'WHATSAPP';
  provider: string;
  followUpDelayHours: number;
  templates: { initial: string; followUp: string };
  maxAttempts: number;
}

export interface RecallConfig {
  enabled: boolean;
  channel: 'SMS' | 'WHATSAPP';
  provider: string;
  intervalDays: number;
  followUpDelayHours: number;
  templates: { recall: string; followUp: string };
  maxAttempts: number;
}

export interface ReviewConfig {
  enabled: boolean;
  channel: 'SMS' | 'WHATSAPP';
  provider: string;
  delayHours: number;
  suppressionPeriodDays: number;
  template: string;
  maxAttempts: number;
}

export interface AckConfig {
  enabled: boolean;
  channel: 'SMS' | 'WHATSAPP';
  provider: string;
  sources: string[];
  template: string;
}

export interface MissedCallConfig {
  enabled: boolean;
  channel: 'SMS' | 'WHATSAPP';
  provider: string;
  template: string;
}

export interface AutomationSection<C> {
  config: C;
  source: ConfigSource;
}

export interface TelephonyProviderView {
  enabled: boolean;
  configured: { signingSecret: boolean };
  source: ConfigSource;
}

export interface WhatsAppProviderView {
  enabled: boolean;
  configured: { verifyToken: boolean; appSecret: boolean; accessToken: boolean };
  graph: { phoneNumberId: string; apiVersion: string };
  source: ConfigSource;
}

export interface TemplateVariableDef {
  name: string;
  source: string | null;
}

export interface SettingsDefinitions {
  automationKeys: string[];
  providerKeys: string[];
  deploymentGlobal: { automations: string[]; note: string };
  templateNames: string[];
  templateVariables: TemplateVariableDef[];
  roleMatrix: Record<string, string[]>;
  businessHourDays: string[];
  clinicFields: string[];
}

export interface Settings {
  clinic: ClinicSettings;
  automations: {
    reminder: AutomationSection<ReminderConfig>;
    noShow: AutomationSection<NoShowConfig>;
    recall: AutomationSection<RecallConfig>;
    review: AutomationSection<ReviewConfig>;
    leadAck: AutomationSection<AckConfig>;
    missedCall: AutomationSection<MissedCallConfig>;
  };
  providers: {
    telephony: TelephonyProviderView;
    whatsapp: WhatsAppProviderView;
  };
  templates: Record<string, string>;
  definitions: SettingsDefinitions;
}

export interface MemberUser {
  id: number;
  email: string;
  role: Role;
  status: 'active' | 'disabled';
  createdAt: string | null;
  lastLoginAt: string | null;
}

export interface PreviewResult {
  rendered: string;
  unknownVariables: string[];
}
