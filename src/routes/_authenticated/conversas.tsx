import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileText,
  Info,
  Loader2,
  Lock,
  Mic,
  Paperclip,
  Search,
  Send,
  Square,
  Star,
  Timer,
  UserCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/nexa/app-shell";
import { ConversationStatusBadge } from "@/components/nexa/status-badge";
import { LeadDetailSheet } from "@/components/nexa/lead-detail-sheet";
import { PurgeConversationsButton } from "@/components/nexa/purge-conversations-button";
import { InvitePersonalWhatsAppButton } from "@/components/nexa/invite-personal-whatsapp-button";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  CONVERSATION_STATUS_LABEL,
  OPEN_CONVERSATION_STATUSES,
  type ConversationStatus,
} from "@/lib/nexa/domain";
import {
  assignConversation,
  listConsultants,
  getConversationRating,
  listAbandonedConversations,

  listConversations,

  listMessages,
  markConversationRead,
  sendMessage,
  setConversationStatus,
  type ConversationListItem,
  type MessageRow,
} from "@/lib/nexa/crm";
import {
  getConversationMediaUrls,
  sendWhatsAppMediaMessage,
  forwardStickerFavorite,
} from "@/lib/whatsapp/whatsapp.functions";
import {
  copyMedia,
  EmojiGifPicker,
  useMediaFavorites,
  type FavoriteMedia,
} from "@/components/nexa/emoji-gif-picker";
import { PhoneNormalizationService } from "@/lib/nexa/phone";
import { cn } from "@/lib/utils";

type ConversasSearch = { c?: string };

export const Route = createFileRoute("/_authenticated/conversas")({
  validateSearch: (search: Record<string, unknown>): ConversasSearch =>
    typeof search["c"] === "string" ? { c: search["c"] } : {},
  head: () => ({
    meta: [
      { title: "Conversas — NexaAtende" },
      {
        name: "description",
        content: "Central de conversas do WhatsApp com histórico completo e atualização em tempo real.",
      },
      { property: "og:title", content: "Conversas — NexaAtende" },
      { property: "og:description", content: "Central de atendimento do NexaAtende." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ConversasPage,
});

const FILTERS: { key: string; label: string; statuses: ConversationStatus[] }[] = [
  { key: "OPEN", label: "Abertas", statuses: OPEN_CONVERSATION_STATUSES },
  { key: "AI_ACTIVE", label: "IA", statuses: ["AI_ACTIVE"] },
  { key: "QUEUE", label: "Fila", statuses: ["WAITING_HUMAN", "QUEUED"] },
  { key: "ABANDONED", label: "Lead abandonado", statuses: ["WAITING_HUMAN", "QUEUED"] },
  { key: "MINE", label: "Minhas", statuses: OPEN_CONVERSATION_STATUSES },
  { key: "CLOSED", label: "Encerradas", statuses: ["CLOSED"] },
];


/** Iniciais do lead para o avatar do cabeçalho e da lista. */
function initials(name?: string | null, fallback?: string | null) {
  const source = (name ?? "").trim();
  if (source) {
    const parts = source.split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
  }
  const digits = (fallback ?? "").replace(/\D/g, "");
  return digits.slice(-2) || "?";
}

function Avatar({
  name,
  phone,
  size = "md",
}: {
  name?: string | null | undefined;
  phone?: string | null | undefined;
  size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-chat-brand/12 font-semibold text-chat-brand-dark",
        size === "sm" ? "size-9 text-xs" : "size-10 text-sm",
      )}
    >
      {initials(name, phone)}
    </span>
  );
}

function ConversasPage() {
  const { companyId, user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { c: selectedId } = Route.useSearch();

  const [filter, setFilter] = useState("OPEN");
  const [search, setSearch] = useState("");
  const [leadSheet, setLeadSheet] = useState<string | null>(null);

  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0]!;

  const listKey = ["conversations", companyId, filter, search];
  const { data: conversations, isLoading } = useQuery({
    queryKey: listKey,
    queryFn: () =>
      filter === "ABANDONED"
        ? listAbandonedConversations({ companyId: companyId as string, search })
        : listConversations({
            companyId: companyId as string,
            statuses: active.statuses,
            assignedTo: filter === "MINE" ? (user?.id ?? null) : null,
            search,
          }),
    enabled: Boolean(companyId),

    // Realtime pode não entregar um UPDATE ao consultor que acabou de perder
    // acesso à linha por RLS. O polling curto é a garantia de revogação visual.
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });

  const selected = useMemo(
    () => (conversations ?? []).find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  useEffect(() => {
    if (!companyId) return;
    const channel = supabase
      .channel("conversations-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, (payload) => {
        void queryClient.invalidateQueries({ queryKey: ["conversations", companyId] });
        const changed = (payload.new ?? payload.old) as { id?: string };
        if (changed.id) {
          void queryClient.invalidateQueries({ queryKey: ["conversation-access", changed.id] });
        }
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "assignment_attempts" },
        (payload) => {
          void queryClient.invalidateQueries({ queryKey: ["conversations", companyId] });
          const changed = (payload.new ?? payload.old) as { conversation_id?: string };
          if (changed.conversation_id) {
            void queryClient.invalidateQueries({
              queryKey: ["conversation-access", changed.conversation_id],
            });
          }
        },
      )
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        void queryClient.invalidateQueries({ queryKey: ["conversations", companyId] });
        const convId = (payload.new as { conversation_id?: string }).conversation_id;
        if (convId) void queryClient.invalidateQueries({ queryKey: ["messages", convId] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [companyId, queryClient]);

  function select(id: string) {
    void navigate({ to: "/conversas", search: { c: id } });
    void markConversationRead(id);
  }

  return (
    <AppShell title="Conversas" description="Central de atendimento em tempo real">
      <div className="-mx-4 -my-6 grid h-[calc(100dvh-4rem)] gap-0 lg:mx-0 lg:my-0 lg:h-[calc(100dvh-9rem)] lg:gap-4 lg:grid-cols-[21rem_1fr]">
        <section
          className={cn(
            "min-h-0 flex-col overflow-hidden border-chat-line bg-card lg:rounded-xl lg:border lg:shadow-panel",
            selectedId ? "hidden lg:flex" : "flex",
          )}

          aria-label="Lista de conversas"
        >
          <div className="space-y-3 border-b border-chat-line bg-chat-shell/60 p-3">
            {isAdmin ? (
              <div className="flex justify-end">
                <PurgeConversationsButton />
              </div>
            ) : null}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-chat-ink-muted" />
              <Input
                className="rounded-full border-chat-line bg-card pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar lead ou telefone"
                aria-label="Buscar conversa"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  aria-pressed={filter === f.key}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chat-brand",
                    filter === f.key
                      ? "bg-chat-brand text-white"
                      : "bg-card text-chat-ink-muted ring-1 ring-chat-line hover:bg-chat-shell",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-lg" />
                ))}
              </div>
            ) : (conversations ?? []).length === 0 ? (
              <div className="px-6 py-14 text-center">
                <p className="text-sm font-medium text-chat-ink">Nenhuma conversa neste filtro</p>
                <p className="mt-1 text-xs text-chat-ink-muted">
                  Novos atendimentos aparecem aqui em tempo real.
                </p>
              </div>
            ) : (
              (conversations ?? []).map((conv) => (
                <div
                  key={conv.id}
                  className={cn(
                    "flex items-start gap-1 border-b border-chat-line/70 pr-2 transition-colors hover:bg-chat-shell",
                    selectedId === conv.id && "bg-chat-shell",
                  )}
                >
                <button
                  onClick={() => select(conv.id)}
                  aria-current={selectedId === conv.id}
                  className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-chat-brand"
                >
                  <Avatar name={conv.lead?.name} phone={conv.lead?.whatsapp ?? conv.lead?.phone} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-chat-ink">
                        {conv.lead?.name ??
                          PhoneNormalizationService.formatContact(conv.lead?.phone, conv.lead?.whatsapp)}
                      </span>
                      <span className="shrink-0 text-[11px] text-chat-ink-muted">
                        {conv.last_message_at
                          ? new Date(conv.last_message_at).toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </span>
                    </span>
                    <span className="mt-1 flex items-center justify-between gap-2">
                      <ConversationStatusBadge status={conv.status as ConversationStatus} />
                      {conv.unread_count > 0 ? (
                        <Badge className="shrink-0 bg-chat-brand text-white">{conv.unread_count}</Badge>
                      ) : null}
                    </span>
                    <span className="mt-1 block truncate text-xs text-chat-ink-muted">
                      {conv.consultant?.full_name ?? conv.consultant?.email ?? "Sem consultor"}
                    </span>
                  </span>
                </button>
                {isAdmin ? (
                  <DeleteConversationButton
                    conversationId={conv.id}
                    leadName={conv.lead?.name ?? conv.lead?.whatsapp ?? conv.lead?.phone ?? null}
                    className="mt-3"
                    onDeleted={() => {
                      if (selectedId === conv.id) void navigate({ to: "/conversas", search: {} });
                      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
                    }}
                  />
                ) : null}
                </div>
              ))
            )}
          </div>
        </section>

        {selected ? (
          <ConversationThread
            key={selected.id}
            conversation={selected}
            isAdmin={isAdmin}
            currentUserId={user?.id ?? null}
            companyId={companyId as string}
            onBack={() => void navigate({ to: "/conversas", search: {} })}
            onOpenLead={() => selected.lead && setLeadSheet(selected.lead.id)}
          />
        ) : (
          <section className="hidden min-h-0 items-center justify-center rounded-xl border border-chat-line bg-chat-canvas lg:flex">
            <div className="max-w-sm rounded-xl bg-card/90 px-8 py-10 text-center shadow-panel">
              <p className="text-sm font-semibold text-chat-ink">Selecione uma conversa</p>
              <p className="mt-1 text-xs text-chat-ink-muted">
                Todo o atendimento acontece aqui no NexaAtende e sai pelo WhatsApp da empresa.
              </p>
            </div>
          </section>
        )}
      </div>

      <LeadDetailSheet leadId={leadSheet} onOpenChange={(open) => !open && setLeadSheet(null)} />
    </AppShell>
  );
}

function ConversationThread({
  conversation,
  isAdmin,
  currentUserId,
  companyId,
  onOpenLead,
  onBack,
}: {
  conversation: ConversationListItem;
  isAdmin: boolean;
  currentUserId: string | null;
  companyId: string;
  onOpenLead: () => void;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);

  const { data: messages, isLoading } = useQuery({
    queryKey: ["messages", conversation.id],
    queryFn: () => listMessages(conversation.id),
  });

  const { data: consultants } = useQuery({
    queryKey: ["consultants", companyId],
    queryFn: () => listConsultants(companyId),
  });

  const { favorites, isFavorite, toggle: toggleFavorite } = useMediaFavorites();

  // Links temporários das mídias (áudios, imagens, documentos) da conversa
  // somados aos favoritos guardados pelo consultor (para prévia e reenvio).
  const mediaPaths = useMemo(() => {
    const fromMessages = (messages ?? [])
      .map((m) => m.media_url)
      .filter((p): p is string => Boolean(p));
    return Array.from(new Set([...fromMessages, ...favorites.map((f) => f.path)]));
  }, [messages, favorites]);
  const fetchMediaUrls = useServerFn(getConversationMediaUrls);
  const { data: freshMediaUrls } = useQuery({
    queryKey: ["media-urls", conversation.id, mediaPaths.join("|")],
    queryFn: () => fetchMediaUrls({ data: { paths: mediaPaths } }),
    enabled: mediaPaths.length > 0,
    staleTime: 30 * 60_000,
    placeholderData: (previous) => previous,
  });

  // Mantém os links já resolvidos em cache local: assim, quando chega uma nova
  // mídia, as anteriores continuam visíveis (sem "piscar" a conversa inteira).
  const mediaCache = useRef<Record<string, string>>({});
  const mediaUrls = useMemo(() => {
    if (freshMediaUrls) {
      mediaCache.current = { ...mediaCache.current, ...freshMediaUrls };
    }
    return mediaCache.current;
  }, [freshMediaUrls]);


  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["messages", conversation.id] });
    void queryClient.invalidateQueries({ queryKey: ["conversations", companyId] });
  }, [queryClient, conversation.id, companyId]);

  const sendMediaFn = useServerFn(sendWhatsAppMediaMessage);
  const sendMedia = useMutation({
    mutationFn: async (file: { blob: Blob; name: string; kind: MediaKind }) => {
      const base64 = await blobToBase64(file.blob);
      return sendMediaFn({
        data: {
          conversationId: conversation.id,
          base64,
          mimeType: file.blob.type || null,
          fileName: file.name,
          caption: draft.trim() || null,
          kind: file.kind,
        },
      });
    },
    onSuccess: () => {
      setDraft("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const forwardSticker = useServerFn(forwardStickerFavorite);
  const forward = useMutation({
    mutationFn: (sourceMessageId: string) =>
      forwardSticker({ data: { conversationId: conversation.id, sourceMessageId } }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  /** Reenvia uma figurinha/GIF/imagem guardada nos favoritos. */
  const sendFavorite = useCallback(
    async (favorite: FavoriteMedia) => {
      // Figurinha só chega como figurinha (animada e com transparência) se a
      // mensagem original for encaminhada pelo WhatsApp — nunca como imagem.
      if (favorite.type === "sticker") {
        if (!favorite.messageId) {
          toast.error(
            "Esta figurinha não possui os dados originais necessários para envio nativo. Salve-a novamente ao recebê-la pelo WhatsApp.",
          );
          return;
        }
        forward.mutate(favorite.messageId);
        return;
      }
      const url = mediaUrls?.[favorite.path];
      if (!url) {
        toast.error("Não consegui carregar este favorito.");
        return;
      }
      try {
        const blob = await (await fetch(url)).blob();
        const name = favorite.path.split("/").pop() ?? "favorito";
        sendMedia.mutate({ blob, name, kind: favorite.type === "video" ? "video" : "image" });
      } catch {
        toast.error("Não consegui enviar este favorito.");
      }
    },
    [mediaUrls, sendMedia, forward],
  );

  // Rola para a última mensagem apenas quem já estava no fim da conversa.
  useEffect(() => {
    if (atBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, atBottom]);

  const send = useMutation({
    mutationFn: () =>
      sendMessage({
        conversationId: conversation.id,
        content: draft.trim(),
        senderType: isAdmin ? "admin" : "consultant",
      }),
    onSuccess: () => {
      setDraft("");
      setAtBottom(true);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assign = useMutation({
    mutationFn: (consultantId: string) =>
      assignConversation(conversation.id, consultantId === "NONE" ? null : consultantId),
    onSuccess: (result) => {
      if (result.notification.notified) {
        toast.success("Atendimento atualizado e aviso enviado pelo WhatsApp");
      } else if (result.notification.reason) {
        toast.warning(result.notification.reason);
      } else {
        toast.success("Atendimento atualizado");
      }
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changeStatus = useMutation({
    mutationFn: (status: ConversationStatus) => setConversationStatus(conversation.id, status),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const isMine = conversation.assigned_user_id === currentUserId;

  // O link do rodízio expira: se a oferta já passou para outro consultor,
  // o servidor recusa e a interface fica somente leitura.
  const { data: access } = useQuery({
    queryKey: [
      "conversation-access",
      conversation.id,
      conversation.assigned_user_id,
      conversation.status,
      currentUserId,
      isAdmin,
    ],
    queryFn: async () => {
      if (isAdmin) return { allowed: true, reason: "OK" as const, message: null };
      if (conversation.status === "CLOSED" || conversation.status === "PAUSED") {
        return {
          allowed: false,
          reason: "CLOSED" as const,
          message: "Este atendimento está encerrado.",
        };
      }
      if (conversation.assigned_user_id) {
        const allowed = conversation.assigned_user_id === currentUserId;
        return {
          allowed,
          reason: allowed ? ("OK" as const) : ("EXPIRED" as const),
          message: allowed
            ? null
            : "Este link expirou: a oportunidade foi repassada a outro consultor.",
        };
      }
      if (!currentUserId) {
        return { allowed: false, reason: "NOT_FOUND" as const, message: "Usuário não identificado." };
      }

      const { data, error } = await supabase
        .from("assignment_attempts")
        .select("consultant_id, status")
        .eq("conversation_id", conversation.id);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      const mineWaiting = rows.some(
        (a) => a.status === "WAITING" && a.consultant_id === currentUserId,
      );
      // Lead abandonado: rodízio encerrado sem ninguém aceitar — livre para todos.
      const abandoned = rows.length > 0 && !rows.some((a) => a.status === "WAITING");
      const allowed = mineWaiting || abandoned;

      return {
        allowed,
        reason: allowed ? ("OK" as const) : ("EXPIRED" as const),
        message: allowed
          ? null
          : "Este link expirou: a oportunidade foi repassada a outro consultor.",
      };
    },
    enabled: Boolean(currentUserId) || isAdmin,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
    retry: 1,
  });

  const expired = access ? !access.allowed : false;
  const canWrite = (isAdmin || isMine) && !expired;
  const closed = conversation.status === "CLOSED";

  const offerOpen =
    !isAdmin &&
    !isMine &&
    !expired &&
    !closed &&
    Boolean(access?.allowed) &&
    (conversation.status === "QUEUED" || conversation.status === "WAITING_HUMAN");

  const busy = send.isPending || sendMedia.isPending;

  // Avaliação de atendimento (enviada ao lead quando ele fica abandonado).
  const { data: rating } = useQuery({
    queryKey: ["conversation-rating", conversation.id],
    queryFn: () => getConversationRating(conversation.id),
    refetchInterval: 15000,
  });


  return (
    <section className="flex min-h-0 flex-col overflow-hidden border-chat-line bg-card lg:rounded-xl lg:border lg:shadow-panel">
      {/* Cabeçalho */}
      <header className="flex items-center gap-2 border-b border-chat-line bg-card px-3 py-2.5">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Voltar para a lista de conversas"
          onClick={onBack}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <Avatar name={conversation.lead?.name} phone={conversation.lead?.whatsapp ?? conversation.lead?.phone} />
        <button
          className="min-w-0 flex-1 rounded-md px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chat-brand"
          onClick={onOpenLead}
        >
          <p className="truncate text-sm font-semibold text-chat-ink">
            {conversation.lead?.name ?? "Lead sem nome"}
          </p>
          <p className="truncate text-xs text-chat-ink-muted">
            {PhoneNormalizationService.formatContact(conversation.lead?.phone, conversation.lead?.whatsapp)}
            {conversation.consultant ? (
              <> · {conversation.consultant.full_name ?? conversation.consultant.email}</>
            ) : null}
          </p>
        </button>

        <div className="hidden items-center gap-2 sm:flex">
          {rating ? (
            <Badge
              variant="outline"
              className="gap-1 border-amber-400/50 text-amber-600 dark:text-amber-400"
              title={rating.rating ? "Avaliação do lead" : "Avaliação solicitada, sem resposta"}
            >
              {rating.rating
                ? `${"★".repeat(rating.rating)}${"☆".repeat(5 - rating.rating)} ${rating.rating}/5`
                : "Avaliação enviada"}
            </Badge>
          ) : null}
          <ConversationStatusBadge status={conversation.status as ConversationStatus} />

          {expired ? (
            <Badge variant="outline" className="gap-1 border-chat-danger/40 text-chat-danger">
              <Lock className="size-3" aria-hidden="true" /> Link expirado
            </Badge>
          ) : isMine ? (
            <Badge variant="outline" className="gap-1 border-chat-brand/40 text-chat-brand-dark">
              <UserCheck className="size-3" aria-hidden="true" /> Sua conversa
            </Badge>
          ) : null}
        </div>

        <Button variant="ghost" size="icon" aria-label="Detalhes do lead" onClick={onOpenLead}>
          <Info className="size-5 text-chat-ink-muted" />
        </Button>
      </header>

      {/* Ações */}
      <div className="flex flex-wrap items-center gap-2 border-b border-chat-line bg-chat-shell/60 px-3 py-2">
        <span className="sm:hidden">
          <ConversationStatusBadge status={conversation.status as ConversationStatus} />
        </span>

        {isAdmin ? (
          <Select value={conversation.assigned_user_id ?? "NONE"} onValueChange={(v) => assign.mutate(v)}>
            <SelectTrigger className="h-8 w-44 bg-card text-xs" aria-label="Consultor responsável">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">Sem consultor</SelectItem>
              {(consultants ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.full_name ?? c.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {!isMine && currentUserId && !expired && !closed ? (
          <Button size="sm" variant="outline" onClick={() => assign.mutate(currentUserId)}>
            <UserCheck className="size-4" /> Assumir
          </Button>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {canWrite && !closed ? (
            <InvitePersonalWhatsAppButton conversationId={conversation.id} onSent={refresh} />
          ) : null}
          {!closed ? (
            <Button size="sm" variant="ghost" onClick={() => changeStatus.mutate("CLOSED")}>
              <Check className="size-4" /> Encerrar
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => changeStatus.mutate("HUMAN_ACTIVE")}>
              <X className="size-4" /> Reabrir
            </Button>
          )}
        </div>
      </div>

      {offerOpen ? <OfferBanner startedAt={conversation.updated_at} /> : null}

      {/* Mensagens */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
        }}
        className="relative min-h-0 flex-1 space-y-2 overflow-y-auto bg-chat-canvas px-3 py-4 sm:px-6"
      >
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton
              key={i}
              className={cn("h-14 w-2/3 rounded-2xl", i % 2 ? "ml-auto" : "")}
            />
          ))
        ) : (messages ?? []).length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm font-medium text-chat-ink">Nenhuma mensagem ainda</p>
            <p className="mt-1 text-xs text-chat-ink-muted">
              As mensagens trocadas com o cliente aparecem aqui.
            </p>
          </div>
        ) : (
          (messages ?? []).map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              mediaUrl={m.media_url ? (mediaUrls?.[m.media_url] ?? null) : null}
              isFavorite={m.media_url ? isFavorite(m.media_url) : false}
              onToggleFavorite={() =>
                m.media_url &&
                toggleFavorite({ path: m.media_url, type: m.message_type, label: m.content, messageId: m.id })
              }
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {!atBottom ? (
        <div className="relative">
          <Button
            size="icon"
            variant="secondary"
            aria-label="Ir para a última mensagem"
            className="absolute -top-14 right-4 z-10 rounded-full shadow-panel"
            onClick={() => {
              setAtBottom(true);
              bottomRef.current?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            <ChevronDown className="size-5" />
          </Button>
        </div>
      ) : null}

      {/* Composer */}
      <div className="border-t border-chat-line bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {closed ? (
          <p className="rounded-lg bg-chat-shell px-4 py-3 text-center text-sm text-chat-ink-muted">
            Conversa encerrada. Reabra para responder.
          </p>
        ) : expired ? (
          <div
            role="status"
            className="rounded-lg border border-chat-danger/30 bg-chat-danger/8 px-4 py-3 text-center"
          >
            <p className="flex items-center justify-center gap-2 text-sm font-medium text-chat-danger">
              <Lock className="size-4" aria-hidden="true" />
              Esta oportunidade foi repassada para outro consultor.
            </p>
            <p className="mt-1 text-xs text-chat-ink-muted">
              {access?.message ?? "O link expirou."} Nenhuma mensagem será enviada ao cliente. O
              histórico continua visível apenas para consulta.
            </p>
          </div>
        ) : !canWrite ? (
          <p className="rounded-lg bg-chat-shell px-4 py-3 text-center text-sm text-chat-ink-muted">
            Assuma o atendimento para responder este cliente.
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <MediaComposer disabled={busy} onFile={(file) => sendMedia.mutate(file)} />
            <EmojiGifPicker
              disabled={busy}
              onEmoji={(emoji) => setDraft((current) => `${current}${emoji}`)}
              resolveUrl={(path) => mediaUrls?.[path] ?? null}
              onSendFavorite={(favorite) => void sendFavorite(favorite)}
            />
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (draft.trim() && !busy) send.mutate();
                }
              }}
              rows={1}
              aria-label="Mensagem para o cliente"
              className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border-chat-line bg-chat-shell px-4 py-3 text-base sm:text-sm"
              placeholder="Escreva sua mensagem…"
            />
            <Button
              size="icon"
              aria-label="Enviar mensagem"
              className="size-11 shrink-0 rounded-full bg-chat-brand text-white hover:bg-chat-brand-dark"
              disabled={!draft.trim() || busy}
              onClick={() => send.mutate()}
            >
              {send.isPending ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Send className="size-5" />
              )}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

/** Faixa de rodízio: prazo para assumir o atendimento enviando a primeira mensagem. */
function OfferBanner({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = Math.floor((now - new Date(startedAt).getTime()) / 1000);
  const left = Math.max(0, 60 - elapsed);
  const tone =
    left <= 10
      ? "border-chat-danger/40 bg-chat-danger/10 text-chat-danger"
      : left <= 25
        ? "border-chat-warning/50 bg-chat-warning/15 text-chat-ink"
        : "border-chat-brand/30 bg-chat-brand/10 text-chat-brand-dark";

  return (
    <div
      role="status"
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 text-sm", tone)}
    >
      <Timer className="size-4 shrink-0" aria-hidden="true" />
      <span className="font-medium">Novo lead disponível para você</span>
      <span className="rounded-full bg-card/80 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums">
        {left > 0 ? `${String(left).padStart(2, "0")}s restantes` : "prazo encerrado"}
      </span>
      <span className="w-full text-xs text-chat-ink-muted sm:w-auto">
        Envie sua primeira mensagem para assumir este atendimento.
      </span>
    </div>
  );
}

type MediaKind = "audio" | "image" | "video" | "document";

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buffer.length; i += chunk) {
    binary += String.fromCharCode(...buffer.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function kindFromMime(mime: string): MediaKind {
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

/** Anexos e gravação de áudio direto do navegador. */
function MediaComposer({
  disabled,
  onFile,
}: {
  disabled: boolean;
  onFile: (file: { blob: Blob; name: string; kind: MediaKind }) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // O WhatsApp entende melhor OGG/Opus: usamos quando o navegador permite.
      const preferred = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/mp4"].find(
        (type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const mime = recorder.mimeType || preferred || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mime });
        setRecording(false);
        if (blob.size === 0) return;

        void import("@/lib/whatsapp/audio-encoding")
          .then(({ recordingToWhatsAppAudio }) => recordingToWhatsAppAudio(blob))
          .then((mp3) => {
            onFile({ blob: mp3, name: `audio-${Date.now()}.mp3`, kind: "audio" });
          })
          .catch((error: unknown) => {
            console.error("[audio] conversão para WhatsApp falhou", error);
            toast.error("Não consegui preparar o áudio para o WhatsApp. Grave novamente.");
          });
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      toast.error("Não consegui acessar o microfone.");
    }
  }


  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile({ blob: file, name: file.name, kind: kindFromMime(file.type) });
        }}
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-11 shrink-0 rounded-full text-chat-ink-muted hover:bg-chat-shell"
        disabled={disabled}
        aria-label="Anexar foto, vídeo ou documento"
        onClick={() => inputRef.current?.click()}
      >
        {disabled ? <Loader2 className="size-5 animate-spin" /> : <Paperclip className="size-5" />}
      </Button>
      <Button
        type="button"
        size="icon"
        className={cn(
          "size-11 shrink-0 rounded-full",
          recording
            ? "bg-chat-danger text-white hover:bg-chat-danger/90"
            : "bg-transparent text-chat-ink-muted hover:bg-chat-shell",
        )}
        disabled={disabled}
        aria-label={recording ? "Parar gravação de áudio" : "Gravar áudio"}
        onClick={() => (recording ? recorderRef.current?.stop() : void startRecording())}
      >
        {recording ? <Square className="size-5" /> : <Mic className="size-5" />}
      </Button>
    </div>
  );
}

function MessageBubble({
  message,
  mediaUrl,
  isFavorite,
  onToggleFavorite,
}: {
  message: MessageRow;
  mediaUrl?: string | null;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
}) {
  const isCustomer = message.sender_type === "customer";
  const isSystem = message.sender_type === "system";
  const isAi = message.sender_type === "ai";

  if (isSystem) {
    return (
      <div className="flex justify-center py-1">
        <p className="max-w-[85%] rounded-lg bg-card/85 px-3 py-1 text-center text-[11px] text-chat-ink-muted shadow-sm">
          {message.content}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex", isCustomer ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-3 py-2 text-sm text-chat-ink shadow-sm sm:max-w-[70%]",
          isCustomer
            ? "rounded-tl-sm bg-chat-bubble-in"
            : isAi
              ? "rounded-tr-sm bg-chat-bubble-in ring-1 ring-chat-brand/25"
              : "rounded-tr-sm bg-chat-bubble-out",
        )}
      >
        {!isCustomer ? (
          <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-chat-brand-dark">
            {isAi ? <Bot className="size-3" aria-hidden="true" /> : null}
            {isAi ? "IA" : (message.sender_name ?? "Consultor")}
          </p>
        ) : null}
        {message.media_url ? (
          <>
            <MessageMedia type={message.message_type} url={mediaUrl ?? null} />
            {mediaUrl && message.message_type !== "audio" ? (
              <div className="mb-1 flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Copiar mídia"
                  title="Copiar"
                  className="rounded-md p-1 text-chat-ink-muted hover:bg-chat-shell"
                  onClick={() => void copyMedia(mediaUrl)}
                >
                  <Copy className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={isFavorite ? "Remover dos favoritos" : "Salvar nos favoritos"}
                  title={isFavorite ? "Remover dos favoritos" : "Favoritar"}
                  className="rounded-md p-1 text-chat-ink-muted hover:bg-chat-shell"
                  onClick={onToggleFavorite}
                >
                  <Star className={cn("size-3.5", isFavorite && "fill-chat-warning text-chat-warning")} />
                </button>
              </div>
            ) : null}
          </>
        ) : null}
        {message.content ? <p className="whitespace-pre-wrap break-words">{message.content}</p> : null}
        {message.transcription ? (
          <p className="mt-1 rounded-md bg-chat-shell px-2 py-1 text-xs italic text-chat-ink-muted">
            “{message.transcription}”
          </p>
        ) : message.message_type === "audio" && message.transcription_status === "PROCESSING" ? (
          <p className="mt-1 text-xs text-chat-ink-muted">Transcrevendo áudio…</p>
        ) : null}
        {!message.media_url && !message.content ? (
          <p className="text-chat-ink-muted">
            {message.message_type === "audio"
              ? "🎤 Áudio (não foi possível baixar a mídia)"
              : message.message_type === "image"
                ? "🖼️ Imagem (não foi possível baixar a mídia)"
                : message.message_type === "video"
                  ? "🎬 Vídeo (não foi possível baixar a mídia)"
                  : message.message_type === "sticker"
                    ? "🧩 Figurinha (não foi possível baixar a mídia)"
                  : message.message_type === "document"
                    ? "📄 Documento (não foi possível baixar a mídia)"
                    : "(sem conteúdo)"}
          </p>
        ) : null}

        <p className="mt-1 text-right text-[10px] text-chat-ink-muted">
          {new Date(message.created_at).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
}

export const CONVERSATION_LABELS = CONVERSATION_STATUS_LABEL;

/** Renderiza áudio, imagem, vídeo ou documento da mensagem. */
function MessageMedia({ type, url }: { type: string; url: string | null }) {
  if (!url) {
    return <p className="mb-1 text-xs text-chat-ink-muted">Carregando mídia…</p>;
  }
  if (type === "audio") {
    return <audio controls src={url} className="mb-1 w-60 max-w-full sm:w-64" />;
  }
  if (type === "sticker") {
    return (
      <img
        src={url}
        alt="Figurinha enviada na conversa"
        loading="lazy"
        className="mb-1 max-h-40 w-40 object-contain"
      />
    );
  }
  if (type === "image") {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img
          src={url}
          alt="Imagem enviada na conversa"
          loading="lazy"
          className="mb-1 max-h-72 rounded-lg"
        />
      </a>
    );
  }
  if (type === "video") {
    return <video controls src={url} className="mb-1 max-h-72 w-64 max-w-full rounded-lg" />;
  }
  return <DocumentMedia url={url} />;
}

/** Documentos são entregues como anexo pelo próprio domínio do app. */
function DocumentMedia({ url }: { url: string }) {
  const fileName = decodeURIComponent((url.split("?")[0] ?? "").split("/").pop() || "documento");
  const downloadUrl = `${url}${url.includes("?") ? "&" : "?"}download=1`;

  return (
    <div className="mb-1 flex min-w-0 items-center gap-2 rounded-lg bg-chat-shell px-2.5 py-2">
      <FileText className="size-5 shrink-0 text-chat-brand-dark" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-xs text-chat-ink" title={fileName}>
        Documento PDF
      </span>
      <Button asChild size="sm" variant="secondary" className="h-8 shrink-0 gap-1.5">
        <a href={downloadUrl} target="_top" aria-label={`Baixar ${fileName}`} title={`Baixar ${fileName}`}>
          <Download className="size-4" aria-hidden="true" />
          Baixar
        </a>
      </Button>
    </div>
  );
}
