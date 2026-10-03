export type Role = 'owner' | 'receptionist' | 'admin';

export interface SessionUser {
  id: number;
  email: string;
  role: Role;
  organizationId: number | null;
}

export interface SessionOrganization {
  id: number;
  name: string;
  plan: 'trial' | 'full';
  trialEndsAt: string | null;
  onboardingCompletedAt: string | null;
}

export interface PublicPlan {
  id: 'trial' | 'full';
  name: string;
  headline: string;
  priceUsdCents: number;
  interval: 'trial' | 'month';
  trialDays: number | null;
}

export type ConfigSource = 'org' | 'deployment' | 'default';

export interface TrialRow {
  id: number;
  name: string;
  status: 'active' | 'disabled';
  trialEndsAt: string | null;
}

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

export type LeadStatus =
  | 'NEW'
  | 'CONTACTED'
  | 'QUALIFIED'
  | 'APPOINTMENT_BOOKED'
  | 'LOST'
  | 'CLOSED';

export type LeadSource = 'WEBSITE' | 'MISSED_CALL' | 'MANUAL' | 'OTHER';

export interface Lead {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  requestedService: string | null;
  source: string;
  status: string;
  assignedUserId: number | null;
  assignedUserEmail: string | null;
  notes: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadActivityItem {
  id: number;
  action: string;
  detail: string | null;
  actorUserId: number | null;
  actorEmail: string | null;
  createdAt: string;
}

export interface LeadDetail {
  lead: Lead;
  notes: string | null;
  activity: LeadActivityItem[];
  communicationHistory: Message[];
  appointments: Appointment[];
}

export interface Patient {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  notes: string | null;
  smsOptOut: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Appointment {
  id: number;
  organizationId: number;
  patientId: number;
  leadId: number | null;
  date: string;
  time: string;
  status: string;
  service: string | null;
  provider: string | null;
  previousAppointmentId: number | null;
  patient: { id: number; firstName: string; lastName: string; phone: string };
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export type MessageDirection = 'OUTBOUND' | 'INBOUND';

export interface Message {
  id: number;
  organizationId: number;
  channel: string;
  recipient: string;
  body: string;
  status: string;
  direction: MessageDirection;
  messageType: string | null;
  template: string | null;
  leadId: number | null;
  providerKey: string | null;
  attempts: number;
  sentAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RecallStatus = 'DUE' | 'CONTACTED' | 'BOOKED' | 'COMPLETED' | 'CLOSED';

export interface Recall {
  id: number;
  patientId: number;
  patient: { id: number; firstName: string; lastName: string; phone: string };
  recallType: string;
  dueDate: string;
  status: RecallStatus;
  lastContactedAt: string | null;
  rebookedAppointmentId: number | null;
  anchorAppointmentId: number | null;
  closeReason: string | null;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DashboardResult {
  window: { from: string; to: string; basis: string };
  metrics: {
    leads: { new: number; contacted: number; converted: number; responseRate: number | null };
    leadResponses: number;
    appointments: {
      booked: number;
      scheduled: number;
      confirmed: number;
      completed: number;
      noShows: number;
      rebooked: number;
    };
    recall: { due: number; contacted: number; booked: number };
    messages: { sent: number; patientReplies: number };
    delivery: { delivered: number; deliveredRate: number | null };
    failures: { failed: number; failedRate: number | null };
  };
  definitions: {
    metrics: Record<string, string>;
    planMetrics: Record<string, string[]>;
  };
  trends: {
    daily: Array<{ date: string; newLeads: number; messagesSent: number; patientReplies: number }>;
  };
}

export interface WorkspaceQueue<T> {
  count: number;
  items: T[];
}

export interface ReceptionistWorkspace {
  date: string;
  timezone: string;
  generatedAt: string;
  queues: {
    newLeads: WorkspaceQueue<{
      id: number;
      firstName: string;
      lastName: string;
      phone: string;
      source: string;
      createdAt: string;
    }>;
    missedCalls: WorkspaceQueue<{
      id: number;
      callerNumber: string;
      calledNumber: string;
      callOutcome: string;
      disposition: string;
      occurredAt: string;
      leadId: number | null;
      patientId: number | null;
    }>;
    patientReplies: WorkspaceQueue<{
      id: number;
      channel: string;
      recipient: string;
      body: string;
      leadId: number | null;
      createdAt: string;
    }>;
    upcomingAppointments: WorkspaceQueue<{
      id: number;
      patientId: number;
      patientName: string;
      date: string;
      time: string;
      status: string;
      service: string | null;
      needsConfirmation: boolean;
    }>;
    noShows: WorkspaceQueue<{
      id: number;
      patientId: number;
      patientName: string;
      date: string;
      time: string;
    }>;
    recallOpportunities: WorkspaceQueue<{
      id: number;
      patientId: number;
      patientName: string;
      dueDate: string;
      daysSinceDue: number;
    }>;
    tasks: WorkspaceQueue<{
      queue: string;
      type: string;
      id: number;
      label: string;
      at: string;
    }>;
  };
  definitions: Record<string, string>;
}

export type { Paged } from './useApi';
