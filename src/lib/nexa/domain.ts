/**
 * Estados e vocabulário do domínio NexaAtende.
 * Nunca espalhar strings de status pelo código: importar sempre daqui.
 */

export const CONVERSATION_STATUS = {
  AI_ACTIVE: "AI_ACTIVE",
  WAITING_HUMAN: "WAITING_HUMAN",
  QUEUED: "QUEUED",
  ASSIGNED: "ASSIGNED",
  HUMAN_ACTIVE: "HUMAN_ACTIVE",
  WAITING_CUSTOMER: "WAITING_CUSTOMER",
  CLOSED: "CLOSED",
  PAUSED: "PAUSED",
} as const;
export type ConversationStatus = keyof typeof CONVERSATION_STATUS;

export const CONVERSATION_STATUS_LABEL: Record<ConversationStatus, string> = {
  AI_ACTIVE: "IA atendendo",
  WAITING_HUMAN: "Aguardando consultor",
  QUEUED: "Na fila",
  ASSIGNED: "Atribuída",
  HUMAN_ACTIVE: "Consultor atendendo",
  WAITING_CUSTOMER: "Aguardando cliente",
  CLOSED: "Encerrada",
  PAUSED: "Pausada",
};

export const OPEN_CONVERSATION_STATUSES: ConversationStatus[] = [
  "AI_ACTIVE",
  "WAITING_HUMAN",
  "QUEUED",
  "ASSIGNED",
  "HUMAN_ACTIVE",
  "WAITING_CUSTOMER",
];

export const LEAD_STATUS = {
  NEW: "NEW",
  AI_QUALIFYING: "AI_QUALIFYING",
  QUALIFIED: "QUALIFIED",
  IN_SERVICE: "IN_SERVICE",
  WON: "WON",
  LOST: "LOST",
  ARCHIVED: "ARCHIVED",
} as const;
export type LeadStatus = keyof typeof LEAD_STATUS;

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: "Novo",
  AI_QUALIFYING: "Em qualificação (IA)",
  QUALIFIED: "Qualificado",
  IN_SERVICE: "Em atendimento",
  WON: "Ganho",
  LOST: "Perdido",
  ARCHIVED: "Arquivado",
};

export const LEAD_SOURCE_LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  site: "Site",
  indicacao: "Indicação",
  outro: "Outro",
};

export const AVAILABILITY = {
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
  PAUSED: "PAUSED",
  BUSY: "BUSY",
} as const;
export type Availability = keyof typeof AVAILABILITY;

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  ONLINE: "Online",
  OFFLINE: "Offline",
  PAUSED: "Pausado",
  BUSY: "Ocupado",
};

export const ASSIGNMENT_ATTEMPT_STATUS = {
  WAITING: "WAITING",
  RESPONDED: "RESPONDED",
  TIMEOUT: "TIMEOUT",
  CANCELLED: "CANCELLED",
} as const;
export type AssignmentAttemptStatus = keyof typeof ASSIGNMENT_ATTEMPT_STATUS;

export const APP_ROLE = { ADMIN: "ADMIN", CONSULTANT: "CONSULTANT" } as const;
export type AppRole = keyof typeof APP_ROLE;

export const AUDIT_ACTION = {
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  CREATE_COMPANY: "CREATE_COMPANY",
  CREATE_LEAD: "CREATE_LEAD",
  UPDATE_LEAD: "UPDATE_LEAD",
  ASSIGN_CONVERSATION: "ASSIGN_CONVERSATION",
  TRANSFER_CONVERSATION: "TRANSFER_CONVERSATION",
  TIMEOUT: "TIMEOUT",
  SEND_MESSAGE: "SEND_MESSAGE",
  TAKEOVER: "ADMIN_TAKEOVER",
  CLOSE_CONVERSATION: "CLOSE_CONVERSATION",
  CONNECT_WHATSAPP: "CONNECT_WHATSAPP",
  DISCONNECT_WHATSAPP: "DISCONNECT_WHATSAPP",
  UPDATE_USER: "UPDATE_USER",
  UPDATE_SETTINGS: "UPDATE_SETTINGS",
} as const;

/** SLA padrão de primeira resposta do consultor (segundos). */
export const DEFAULT_SLA_SECONDS = 60;

/** Tamanho padrão de página em listagens. */
export const PAGE_SIZE = 25;

export const BRAND = {
  name: "NexaAtende",
  tagline: "Atendimento inteligente. Leads nunca mais sem resposta.",
} as const;
