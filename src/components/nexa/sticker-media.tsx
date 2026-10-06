import { useEffect, useRef, useState } from "react";

/** Figurinha: imagem normal ou animação Lottie (ZIP do WhatsApp). */
export function StickerMedia({
  url,
  className = "mb-1 size-40 max-w-full",
  alt = "Figurinha enviada na conversa",
}: {
  url: string;
  className?: string;
  alt?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [animationFailed, setAnimationFailed] = useState(false);

  useEffect(() => {
    if (!imageFailed || !containerRef.current) return;
    let disposed = false;
    let animation: { destroy: () => void } | null = null;
    const container = containerRef.current;

    async function loadAnimation() {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Mídia respondeu ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const [{ unzipSync, strFromU8 }, { default: lottie }] = await Promise.all([
          import("fflate"),
          import("lottie-web/build/player/lottie_light"),
        ]);
        if (disposed) return;
        const files = unzipSync(bytes);
        const animationFile = Object.entries(files).find(([name]) =>
          /(^|\/)animation\.json$/i.test(name),
        );
        if (!animationFile) throw new Error("Pacote sem animação");
        const animationData = JSON.parse(strFromU8(animationFile[1])) as Record<string, unknown>;
        if (disposed) return;
        animation = lottie.loadAnimation({
          container,
          renderer: "svg",
          loop: true,
          autoplay: true,
          animationData,
        });
      } catch (error) {
        console.error("[figurinha] animação não pôde ser exibida", error);
        if (!disposed) setAnimationFailed(true);
      }
    }

    void loadAnimation();
    return () => {
      disposed = true;
      animation?.destroy();
      container.replaceChildren();
    };
  }, [imageFailed, url]);

  if (!imageFailed) {
    return (
      <img
        src={url}
        alt={alt}
        loading="lazy"
        className={`${className} object-contain`}
        onError={() => setImageFailed(true)}
      />
    );
  }

  if (animationFailed) {
    return <p className="mb-1 text-xs text-chat-ink-muted">Figurinha indisponível</p>;
  }

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={alt}
      className={className}
    />
  );
}
