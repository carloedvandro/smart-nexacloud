import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, Download, FileText, Loader2, Mic, Paperclip, Search, Send, Square, UserCheck, X } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/nexa/app-shell";
import { ConversationStatusBadge } from "@/components/nexa/status-badge";
import { LeadDetailSheet } from "@/components/nexa/lead-detail-sheet";
import { PurgeConversationsButton } from "@/components/nexa/purge-conversations-button";
import { InvitePersonalWhatsAppButton } from "@/components/nexa/invite-personal-whatsapp-button";


import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
} from "@/lib/whatsapp/whatsapp.functions";
import { getConversationAccess } from "@/lib/queue/access.functions";
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
  { key: "MINE", label: "Minhas", statuses: OPEN_CONVERSATION_STATUSES },
  { key: "CLOSED", label: "Encerradas", statuses: ["CLOSED"] },
];

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
      listConversations({
        companyId: companyId as string,
        statuses: active.statuses,
        assignedTo: filter === "MINE" ? (user?.id ?? null) : null,
        search,
      }),
    enabled: Boolean(companyId),
  });

  const selected = useMemo(
    () => (conversations ?? []).find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  useEffect(() => {
    if (!companyId) return;
    const channel = supabase
      .channel("conversations-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["conversations", companyId] });
      })
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
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <Card className="flex h-[calc(100vh-10rem)] flex-col shadow-panel">
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-3">
            {isAdmin ? (
              <div className="flex justify-end">
                <PurgeConversationsButton />
              </div>
            ) : null}
            <div className="relative">

              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar lead ou telefone"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <Button
                  key={f.key}
                  size="sm"
                  variant={filter === f.key ? "default" : "outline"}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </Button>
              ))}
            </div>

            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
              ) : (conversations ?? []).length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nenhuma conversa neste filtro.
                </p>
              ) : (
                (conversations ?? []).map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => select(conv.id)}
                    className={cn(
                      "w-full rounded-lg border border-transparent p-3 text-left transition-colors hover:bg-muted",
                      selectedId === conv.id && "border-border bg-muted",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {conv.lead?.name ?? PhoneNormalizationService.formatContact(conv.lead?.phone, conv.lead?.whatsapp)}
                      </span>
                      {conv.unread_count > 0 ? (
                        <Badge className="shrink-0">{conv.unread_count}</Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <ConversationStatusBadge status={conv.status as ConversationStatus} />
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {conv.last_message_at
                          ? new Date(conv.last_message_at).toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {conv.consultant?.full_name ?? conv.consultant?.email ?? "Sem consultor"}
                    </p>
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {selected ? (
          <ConversationThread
            key={selected.id}
            conversation={selected}
            isAdmin={isAdmin}
            currentUserId={user?.id ?? null}
            companyId={companyId as string}
            onOpenLead={() => selected.lead && setLeadSheet(selected.lead.id)}
          />
        ) : (
          <Card className="flex h-[calc(100vh-10rem)] items-center justify-center shadow-panel">
            <p className="text-sm text-muted-foreground">Selecione uma conversa para atender.</p>
          </Card>
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
}: {
  conversation: ConversationListItem;
  isAdmin: boolean;
  currentUserId: string | null;
  companyId: string;
  onOpenLead: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const { data: messages, isLoading } = useQuery({
    queryKey: ["messages", conversation.id],
    queryFn: () => listMessages(conversation.id),
  });

  const { data: consultants } = useQuery({
    queryKey: ["consultants", companyId],
    queryFn: () => listConsultants(companyId),
  });

  // Links temporários das mídias (áudios, imagens, documentos) da conversa.
  const mediaPaths = useMemo(
    () => (messages ?? []).map((m) => m.media_url).filter((p): p is string => Boolean(p)),
    [messages],
  );
  const fetchMediaUrls = useServerFn(getConversationMediaUrls);
  const { data: mediaUrls } = useQuery({
    queryKey: ["media-urls", conversation.id, mediaPaths.join("|")],
    queryFn: () => fetchMediaUrls({ data: { paths: mediaPaths } }),
    enabled: mediaPaths.length > 0,
    staleTime: 30 * 60_000,
  });

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["messages", conversation.id] });
    void queryClient.invalidateQueries({ queryKey: ["conversations", companyId] });
  };

  const send = useMutation({
    mutationFn: () =>
      sendMessage({
        conversationId: conversation.id,
        content: draft.trim(),
        senderType: isAdmin ? "admin" : "consultant",
      }),
    onSuccess: () => {
      setDraft("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assign = useMutation({
    mutationFn: (consultantId: string) =>
      assignConversation(conversation.id, consultantId === "NONE" ? null : consultantId),
    onSuccess: () => {
      toast.success("Atendimento atualizado");
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
    queryKey: ["conversation-access", conversation.id],
    queryFn: () => checkAccess({ data: { conversationId: conversation.id } }),
    refetchInterval: 20000,
  });
  const expired = access ? !access.allowed : false;
  const canWrite = (isAdmin || isMine) && !expired;

  return (
    <Card className="flex h-[calc(100vh-10rem)] flex-col shadow-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <button className="min-w-0 flex-1 text-left" onClick={onOpenLead}>
          <p className="truncate text-sm font-semibold">
            {conversation.lead?.name ?? "Lead sem nome"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {PhoneNormalizationService.formatContact(conversation.lead?.phone, conversation.lead?.whatsapp)}
          </p>
        </button>
        <ConversationStatusBadge status={conversation.status as ConversationStatus} />

        {isAdmin ? (
          <Select
            value={conversation.assigned_user_id ?? "NONE"}
            onValueChange={(v) => assign.mutate(v)}
          >
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">Sem consultor</SelectItem>
              {(consultants ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.full_name ?? c.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {!isMine && currentUserId ? (
          <Button size="sm" variant="outline" onClick={() => assign.mutate(currentUserId)}>
            <UserCheck className="size-4" /> Assumir
          </Button>
        ) : null}

        {canWrite && conversation.status !== "CLOSED" ? (
          <InvitePersonalWhatsAppButton conversationId={conversation.id} onSent={refresh} />
        ) : null}

        {conversation.status !== "CLOSED" ? (
          <Button size="sm" variant="outline" onClick={() => changeStatus.mutate("CLOSED")}>
            <Check className="size-4" /> Encerrar
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => changeStatus.mutate("HUMAN_ACTIVE")}>
            <X className="size-4" /> Reabrir
          </Button>
        )}
      </div>


      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-muted/30 p-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-2/3" />)
        ) : (messages ?? []).length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma mensagem nesta conversa ainda.
          </p>
        ) : (
          (messages ?? []).map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              mediaUrl={m.media_url ? (mediaUrls?.[m.media_url] ?? null) : null}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border p-3">
        {conversation.status === "CLOSED" ? (
          <p className="text-center text-sm text-muted-foreground">
            Conversa encerrada. Reabra para responder.
          </p>
        ) : !canWrite ? (
          <p className="text-center text-sm text-muted-foreground">
            Assuma o atendimento para responder este cliente.
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <MediaComposer
              disabled={sendMedia.isPending}
              onFile={(file) => sendMedia.mutate(file)}
            />
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (draft.trim()) send.mutate();
                }
              }}
              rows={2}
              placeholder="Escreva sua mensagem… (Enter envia, Shift+Enter quebra linha)"
            />
            <Button disabled={!draft.trim() || send.isPending} onClick={() => send.mutate()}>
              <Send className="size-4" />
            </Button>
          </div>
        )}
      </div>
    </Card>
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
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setRecording(false);
        if (blob.size > 0) onFile({ blob, name: `audio-${Date.now()}.webm`, kind: "audio" });
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
        variant="outline"
        disabled={disabled}
        aria-label="Anexar arquivo"
        onClick={() => inputRef.current?.click()}
      >
        {disabled ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
      </Button>
      <Button
        type="button"
        size="icon"
        variant={recording ? "destructive" : "outline"}
        disabled={disabled}
        aria-label={recording ? "Parar gravação" : "Gravar áudio"}
        onClick={() => (recording ? recorderRef.current?.stop() : void startRecording())}
      >
        {recording ? <Square className="size-4" /> : <Mic className="size-4" />}
      </Button>
    </div>
  );
}

function MessageBubble({ message, mediaUrl }: { message: MessageRow; mediaUrl?: string | null }) {
  const isCustomer = message.sender_type === "customer";
  const isSystem = message.sender_type === "system";
  const isAi = message.sender_type === "ai";

  if (isSystem) {
    return (
      <p className="text-center text-xs text-muted-foreground">{message.content}</p>
    );
  }

  return (
    <div className={cn("flex", isCustomer ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2 text-sm shadow-sm",
          isCustomer
            ? "rounded-bl-sm bg-card text-card-foreground"
            : isAi
              ? "rounded-br-sm bg-primary/10 text-foreground"
              : "rounded-br-sm bg-primary text-primary-foreground",
        )}
      >
        {!isCustomer ? (
          <p className="mb-1 flex items-center gap-1 text-[11px] opacity-80">
            {isAi ? <Bot className="size-3" /> : null}
            {isAi ? "IA" : (message.sender_name ?? "Consultor")}
          </p>
        ) : null}
        {message.media_url ? (
          <MessageMedia type={message.message_type} url={mediaUrl ?? null} />
        ) : null}
        {message.content ? <p className="whitespace-pre-wrap">{message.content}</p> : null}
        {message.transcription ? (
          <p className="mt-1 rounded-md bg-background/40 px-2 py-1 text-xs italic opacity-90">
            “{message.transcription}”
          </p>
        ) : message.message_type === "audio" && message.transcription_status === "PROCESSING" ? (
          <p className="mt-1 text-xs opacity-70">Transcrevendo áudio…</p>
        ) : null}
        {!message.media_url && !message.content ? (
          <p className="opacity-70">
            {message.message_type === "audio"
              ? "🎤 Áudio (não foi possível baixar a mídia)"
              : message.message_type === "image"
                ? "🖼️ Imagem (não foi possível baixar a mídia)"
                : message.message_type === "video"
                  ? "🎬 Vídeo (não foi possível baixar a mídia)"
                  : message.message_type === "document"
                    ? "📄 Documento (não foi possível baixar a mídia)"
                    : "(sem conteúdo)"}
          </p>
        ) : null}

        <p className="mt-1 text-right text-[10px] opacity-70">
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
    return <p className="mb-1 text-xs opacity-70">Carregando mídia…</p>;
  }
  if (type === "audio") {
    return <audio controls src={url} className="mb-1 w-64 max-w-full" />;
  }
  if (type === "image") {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt="Imagem enviada na conversa" className="mb-1 max-h-64 rounded-lg" />
      </a>
    );
  }
  if (type === "video") {
    return <video controls src={url} className="mb-1 max-h-64 w-64 max-w-full rounded-lg" />;
  }
  return <DocumentMedia url={url} />;
}

/** Documentos são entregues como anexo pelo próprio domínio do app. */
function DocumentMedia({ url }: { url: string }) {
  const fileName = decodeURIComponent(
    (url.split("?")[0] ?? "").split("/").pop() || "documento",
  );
  const downloadUrl = `${url}${url.includes("?") ? "&" : "?"}download=1`;

  return (
    <div className="mb-1 flex min-w-0 items-center gap-2">
      <FileText className="size-5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-xs" title={fileName}>
        Documento PDF
      </span>
      <Button asChild size="sm" variant="secondary" className="h-8 shrink-0 gap-1.5">
        <a
          href={downloadUrl}
          target="_top"
          aria-label={`Baixar ${fileName}`}
          title={`Baixar ${fileName}`}
        >
          <Download className="size-4" aria-hidden="true" />
          Baixar
        </a>
      </Button>
    </div>
  );
}




