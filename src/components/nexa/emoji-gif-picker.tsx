/**
 * Emojis e favoritos da central de conversas.
 * Os favoritos (figurinhas, GIFs e imagens) ficam salvos no próprio navegador
 * do usuário, para reenviar com um clique sem depender do histórico.
 */
import { useCallback, useEffect, useState } from "react";
import { Send, Smile, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const EMOJI_KEY = "nexa:favoritos:emojis";
const MEDIA_KEY = "nexa:favoritos:midias";
const FAVORITES_EVENT = "nexa:favoritos";

export type FavoriteMedia = {
  /** Caminho do arquivo no storage — o link assinado é gerado na hora do envio. */
  path: string;
  type: string;
  label?: string | null;
  /** Mensagem original (figurinhas): necessária para reenvio nativo no WhatsApp. */
  messageId?: string | null;
};


import { EMOJIS, EMOJI_CATEGORIES } from "./emoji-data";

export { EMOJIS, EMOJI_CATEGORIES };

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event(FAVORITES_EVENT));
  } catch {
    /* armazenamento indisponível */
  }
}

function useStoredList<T>(key: string): [T[], (next: T[]) => void] {
  const [items, setItems] = useState<T[]>([]);

  useEffect(() => {
    const sync = () => setItems(read<T[]>(key, []));
    sync();
    window.addEventListener(FAVORITES_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(FAVORITES_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [key]);

  const save = useCallback(
    (next: T[]) => {
      setItems(next);
      write(key, next);
    },
    [key],
  );

  return [items, save];
}

/** Favoritos de mídia (figurinhas/GIFs/imagens) usados no chat. */
export function useMediaFavorites() {
  const [items, save] = useStoredList<FavoriteMedia>(MEDIA_KEY);

  const isFavorite = useCallback(
    (path: string) => items.some((item) => item.path === path),
    [items],
  );

  const toggle = useCallback(
    (item: FavoriteMedia) => {
      const exists = items.some((current) => current.path === item.path);
      save(exists ? items.filter((current) => current.path !== item.path) : [item, ...items].slice(0, 60));
      toast.success(exists ? "Removido dos favoritos." : "Salvo nos favoritos.");
    },
    [items, save],
  );

  const remove = useCallback(
    (path: string) => save(items.filter((current) => current.path !== path)),
    [items, save],
  );

  return { favorites: items, isFavorite, toggle, remove };
}

/** Copia a imagem/GIF para a área de transferência (com link como alternativa). */
export async function copyMedia(url: string) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const canCopyImage =
      typeof window !== "undefined" && "ClipboardItem" in window && blob.type.startsWith("image/");
    if (canCopyImage) {
      const type = blob.type === "image/webp" ? "image/png" : blob.type;
      if (type === blob.type) {
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        toast.success("Imagem copiada.");
        return;
      }
      // WebP (figurinhas) não é aceito pela área de transferência: converte para PNG.
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (png) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
        toast.success("Figurinha copiada como imagem.");
        return;
      }
    }
    await navigator.clipboard.writeText(url);
    toast.success("Link copiado.");
  } catch {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado.");
    } catch {
      toast.error("Não consegui copiar.");
    }
  }
}

/** Seletor de emojis + favoritos de figurinhas/GIFs para o compositor. */
export function EmojiGifPicker({
  disabled,
  onEmoji,
  onSendFavorite,
  resolveUrl,
}: {
  disabled?: boolean;
  onEmoji: (emoji: string) => void;
  onSendFavorite: (favorite: FavoriteMedia) => void;
  resolveUrl: (path: string) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const [recent, saveRecent] = useStoredList<string>(EMOJI_KEY);
  const { favorites, remove } = useMediaFavorites();
  const [confirmFavorite, setConfirmFavorite] = useState<FavoriteMedia | null>(null);

  function pickEmoji(emoji: string) {
    onEmoji(emoji);
    saveRecent([emoji, ...recent.filter((item) => item !== emoji)].slice(0, 16));
  }

  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={disabled}
          aria-label="Emojis e favoritos"
          className="size-11 shrink-0 rounded-full text-chat-ink-muted hover:bg-chat-shell"
        >
          <Smile className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <Tabs defaultValue="emojis">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="emojis">Emojis</TabsTrigger>
            <TabsTrigger value="favoritos">Favoritos</TabsTrigger>
          </TabsList>

          <TabsContent value="emojis" className="mt-2">
            {recent.length ? (
              <>
                <p className="mb-1 text-xs text-muted-foreground">Usados recentemente</p>
                <div className="mb-2 grid grid-cols-8 gap-1">
                  {recent.map((emoji) => (
                    <button
                      key={`recent-${emoji}`}
                      type="button"
                      className="rounded-md p-1 text-xl hover:bg-muted"
                      onClick={() => pickEmoji(emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
              {EMOJI_CATEGORIES.map((category) => (
                <div key={category.name}>
                  <p className="sticky top-0 z-10 bg-popover py-1 text-xs text-muted-foreground">
                    {category.name}
                  </p>
                  <div className="grid grid-cols-8 gap-1">
                    {category.emojis.map((emoji) => (
                      <button
                        key={`${category.name}-${emoji}`}
                        type="button"
                        aria-label={`Inserir ${emoji}`}
                        className="rounded-md p-1 text-xl hover:bg-muted"
                        onClick={() => pickEmoji(emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="favoritos" className="mt-2">
            {favorites.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                Toque na estrela de uma figurinha, GIF ou imagem da conversa para guardá-la aqui.
              </p>
            ) : (
              <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto">
                {favorites.map((item) => {
                  const url = resolveUrl(item.path);
                  return (
                    <button
                      key={item.path}
                      type="button"
                      className={cn(
                        "aspect-square w-full overflow-hidden rounded-lg border bg-muted",
                        "transition hover:ring-2 hover:ring-chat-brand",
                      )}
                      aria-label="Abrir figurinha favorita"
                      onClick={() => setConfirmFavorite(item)}
                    >
                      {url ? (
                        <img src={url} alt="" className="size-full object-cover" loading="lazy" />
                      ) : (
                        <span className="flex size-full items-center justify-center text-[10px] text-muted-foreground">
                          prévia indisponível
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>

    <Dialog
      open={!!confirmFavorite}
      onOpenChange={(next) => {
        if (!next) setConfirmFavorite(null);
      }}
    >
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>Favorito</DialogTitle>
          <DialogDescription>
            Confirme o que deseja fazer com este favorito.
          </DialogDescription>
        </DialogHeader>
        {confirmFavorite ? (
          <div className="flex justify-center">
            {(() => {
              const url = resolveUrl(confirmFavorite.path);
              return url ? (
                <img
                  src={url}
                  alt="Prévia do favorito"
                  className="max-h-48 w-auto rounded-lg border object-contain"
                />
              ) : (
                <span className="flex h-32 items-center text-xs text-muted-foreground">
                  prévia indisponível
                </span>
              );
            })()}
          </div>
        ) : null}
        <DialogFooter className="flex-row gap-2 sm:justify-center">
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              if (confirmFavorite) {
                remove(confirmFavorite.path);
                toast.success("Favorito removido.");
                setConfirmFavorite(null);
              }
            }}
          >
            <Trash2 className="mr-1.5 size-4" />
            Deletar
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (confirmFavorite) {
                onSendFavorite(confirmFavorite);
                setConfirmFavorite(null);
                setOpen(false);
              }
            }}
          >
            <Send className="mr-1.5 size-4" />
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

export { Star };
