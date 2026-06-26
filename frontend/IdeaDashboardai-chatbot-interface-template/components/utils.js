export const cls = (...c) => c.filter(Boolean).join(" ");

/**
 * Markdown-to-HTML renderer for chat messages and report previews.
 * Supports: # headers, **bold**, *italic*, `code`, [links](url), --- hr, and \n newlines.
 */
export function renderMarkdown(text) {
  if (!text) return ""
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  // Headers (must come before bold/italic to avoid interference)
  html = html.replace(/^### (.+)$/gm, "<h3 class='text-sm font-semibold mt-2 mb-1'>$1</h3>")
  html = html.replace(/^## (.+)$/gm, "<h2 class='text-base font-bold mt-3 mb-1'>$1</h2>")
  html = html.replace(/^# (.+)$/gm, "<h1 class='text-lg font-bold mt-4 mb-1'>$1</h1>")
  // Horizontal rule
  html = html.replace(/^---$/gm, "<hr class='my-3 border-zinc-200 dark:border-zinc-700'>")
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>")
  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code class='bg-zinc-100 dark:bg-zinc-800 px-1 rounded text-xs'>$1</code>")
  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="underline text-blue-600 dark:text-blue-400 hover:text-blue-800">$1</a>',
  )
  html = html.replace(/\n/g, "<br>")
  return html
}

export function timeAgo(date) {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const sec = Math.max(1, Math.floor((now - d) / 1000));
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const ranges = [
    [60, "seconds"], [3600, "minutes"], [86400, "hours"],
    [604800, "days"], [2629800, "weeks"], [31557600, "months"],
  ];
  let unit = "years";
  let value = -Math.floor(sec / 31557600);
  for (const [limit, u] of ranges) {
    if (sec < limit) {
      unit = u;
      const div =
        unit === "seconds" ? 1 :
        limit / (unit === "minutes" ? 60 :
        unit === "hours" ? 3600 :
        unit === "days" ? 86400 :
        unit === "weeks" ? 604800 : 2629800);
      value = -Math.floor(sec / div);
      break;
    }
  }
  return rtf.format(value, /** @type {Intl.RelativeTimeFormatUnit} */ (unit));
}

export const makeId = (p) => `${p}${Math.random().toString(36).slice(2, 10)}`;
