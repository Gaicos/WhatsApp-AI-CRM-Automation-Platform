(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const prefersReduced =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReduced) return;

  function iniciarMatrix() {
    if (document.getElementById("matrixCanvas")) return;

    const opacidadeAttr = Number(document.body?.dataset?.matrixOpacity);
    const opacidade = Number.isFinite(opacidadeAttr) ? opacidadeAttr : 0.06;

    const canvas = document.createElement("canvas");
    canvas.id = "matrixCanvas";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText =
      `position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:${opacidade};`;
    document.body.prepend(canvas);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const chars = "01<>/{}[]$#アイウエオカキクケコ";
    const fontSize = 14;
    let width = 0;
    let height = 0;
    let columns = 0;
    let drops = [];

    function redimensionar() {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
      const novasColunas = Math.max(1, Math.floor(width / fontSize));
      const novasDrops = new Array(novasColunas);
      for (let i = 0; i < novasColunas; i++) {
        novasDrops[i] = i < drops.length ? drops[i] : Math.floor(Math.random() * -40);
      }
      columns = novasColunas;
      drops = novasDrops;
    }

    redimensionar();
    window.addEventListener("resize", redimensionar);

    let lastFrame = 0;
    const intervalMs = 1000 / 18;
    let rafId = null;

    function desenhar(ts) {
      if (document.hidden) {
        rafId = null;
        return;
      }
      if (ts - lastFrame >= intervalMs) {
        lastFrame = ts;
        ctx.fillStyle = "rgba(5, 9, 7, 0.08)";
        ctx.fillRect(0, 0, width, height);

        ctx.font = `${fontSize}px "JetBrains Mono", Consolas, monospace`;
        for (let i = 0; i < columns; i++) {
          const text = chars[Math.floor(Math.random() * chars.length)];
          const x = i * fontSize;
          const y = drops[i] * fontSize;

          ctx.fillStyle = Math.random() > 0.92 ? "#9effc6" : "#00e676";
          ctx.fillText(text, x, y);

          if (y > height && Math.random() > 0.975) {
            drops[i] = 0;
          } else {
            drops[i] += 1;
          }
        }
      }
      rafId = requestAnimationFrame(desenhar);
    }

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && rafId === null) {
        rafId = requestAnimationFrame(desenhar);
      }
    });

    rafId = requestAnimationFrame(desenhar);
  }

  if (document.body) {
    iniciarMatrix();
  } else {
    window.addEventListener("DOMContentLoaded", iniciarMatrix);
  }
})();
