import {
  LayoutDashboard,
  MessagesSquare,
  Users,
  UserCog,
  Smartphone,
  BookOpen,
  ListOrdered,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react";

import type { AppRole } from "./domain";

export type NavItem = {
  label: string;
  to: string;
  icon: LucideIcon;
  roles: AppRole[];
  description: string;
};

export const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    to: "/dashboard",
    icon: LayoutDashboard,
    roles: ["ADMIN", "CONSULTANT"],
    description: "Indicadores operacionais em tempo real",
  },
  {
    label: "Conversas",
    to: "/conversas",
    icon: MessagesSquare,
    roles: ["ADMIN", "CONSULTANT"],
    description: "Central de atendimento",
  },
  {
    label: "Leads",
    to: "/leads",
    icon: Users,
    roles: ["ADMIN", "CONSULTANT"],
    description: "CRM e memória do cliente",
  },
  {
    label: "Consultores",
    to: "/consultores",
    icon: UserCog,
    roles: ["ADMIN"],
    description: "Equipe, papéis e disponibilidade",
  },
  {
    label: "WhatsApp",
    to: "/whatsapp",
    icon: Smartphone,
    roles: ["ADMIN"],
    description: "Conexões e instâncias",
  },
  {
    label: "Conhecimento IA",
    to: "/conhecimento",
    icon: BookOpen,
    roles: ["ADMIN"],
    description: "Base usada pela inteligência artificial",
  },
  {
    label: "Fila",
    to: "/fila",
    icon: ListOrdered,
    roles: ["ADMIN"],
    description: "Rodízio, SLA e distribuição",
  },
  {
    label: "Relatórios",
    to: "/relatorios",
    icon: BarChart3,
    roles: ["ADMIN"],
    description: "Desempenho e histórico",
  },
  {
    label: "Configurações",
    to: "/configuracoes",
    icon: Settings,
    roles: ["ADMIN"],
    description: "Empresa, horários e LGPD",
  },
];
