export async function buildPageClip(tab) {
  if (!tab?.id) {
    throw new Error("没有找到可剪藏的当前页面");
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractPageClip
  });
  const clip = result?.result;
  if (!clip?.markdown?.trim()) {
    throw new Error("没有提取到可保存的页面正文");
  }

  return {
    type: "page",
    title: clip.title || tab.title || "Untitled",
    pageUrl: clip.pageUrl || tab.url || "",
    markdown: clip.markdown,
    images: clip.images || [],
    capturedAt: new Date().toISOString()
  };
}

function extractPageClip() {
  const root = cloneReadableRoot();
  const images = [];
  const markdown = nodesToMarkdown(Array.from(root.childNodes)).replace(/\n{3,}/g, "\n\n").trim();

  return {
    title: document.title || firstText("h1") || "Untitled",
    pageUrl: location.href,
    markdown,
    images
  };

  function cloneReadableRoot() {
    const source = document.querySelector("article, main, [role='main']") || document.body || document.documentElement;
    const clone = source.cloneNode(true);
    clone.querySelectorAll("script, style, noscript, nav, header, footer, form, iframe, button, input, select, textarea").forEach((node) => {
      node.remove();
    });
    return clone;
  }

  function firstText(selector) {
    return document.querySelector(selector)?.textContent?.trim() || "";
  }

  function nodesToMarkdown(nodes) {
    return nodes.map(nodeToMarkdown).join("");
  }

  function nodeToMarkdown(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return normalizeText(node.textContent || "");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const tag = node.tagName.toLowerCase();
    const content = nodesToMarkdown(Array.from(node.childNodes)).trim();

    if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) {
      const level = Number(tag.slice(1));
      return content ? `\n${"#".repeat(level)} ${content}\n\n` : "";
    }
    if (["p", "section", "article", "main", "div"].includes(tag)) {
      return content ? `${content}\n\n` : "";
    }
    if (tag === "br") {
      return "\n";
    }
    if (tag === "strong" || tag === "b") {
      return content ? `**${content}**` : "";
    }
    if (tag === "em" || tag === "i") {
      return content ? `*${content}*` : "";
    }
    if (tag === "code") {
      if (node.closest("pre")) {
        return content;
      }
      return content ? `\`${content.replaceAll("`", "\\`")}\`` : "";
    }
    if (tag === "pre") {
      const code = node.textContent?.replace(/\r\n?/g, "\n").trim() || content;
      return code ? `\n\`\`\`\n${code}\n\`\`\`\n\n` : "";
    }
    if (tag === "blockquote") {
      return content ? `\n${content.split("\n").map((line) => `> ${line}`).join("\n")}\n\n` : "";
    }
    if (tag === "a") {
      const href = absoluteUrl(node.getAttribute("href"));
      return href && content ? `[${content}](${href})` : content;
    }
    if (tag === "img") {
      const src = absoluteUrl(node.currentSrc || node.getAttribute("src"));
      if (!src) {
        return "";
      }
      const alt = (node.getAttribute("alt") || "").trim();
      if (!images.some((image) => image.url === src)) {
        images.push(alt ? { url: src, alt } : { url: src });
      }
      return `![${escapeBracketText(alt)}](${src})\n\n`;
    }
    if (tag === "ul" || tag === "ol") {
      const ordered = tag === "ol";
      const items = Array.from(node.children)
        .filter((child) => child.tagName?.toLowerCase() === "li")
        .map((child, index) => {
          const item = nodesToMarkdown(Array.from(child.childNodes)).trim().replace(/\n/g, "\n  ");
          return `${ordered ? `${index + 1}.` : "-"} ${item}`;
        })
        .filter((item) => item.trim());
      return items.length ? `\n${items.join("\n")}\n\n` : "";
    }
    if (tag === "table") {
      return tableToMarkdown(node);
    }

    return content;
  }

  function tableToMarkdown(table) {
    const rows = Array.from(table.querySelectorAll("tr")).map((row) =>
      Array.from(row.children).map((cell) => nodesToMarkdown(Array.from(cell.childNodes)).trim().replace(/\s*\n+\s*/g, " "))
    );
    if (!rows.length || !rows[0].length) {
      return "";
    }
    const header = rows[0];
    const separator = header.map(() => "---");
    const body = rows.slice(1);
    return `\n| ${header.join(" | ")} |\n| ${separator.join(" | ")} |\n${body.map((row) => `| ${row.join(" | ")} |`).join("\n")}\n\n`;
  }

  function absoluteUrl(value) {
    if (!value) {
      return "";
    }
    try {
      return new URL(value, document.baseURI).href;
    } catch {
      return "";
    }
  }

  function normalizeText(value) {
    return value.replace(/\s+/g, " ");
  }

  function escapeBracketText(value) {
    return value.replaceAll("[", "\\[").replaceAll("]", "\\]");
  }
}
