export async function getSelectionAsMarkdown(tabId, fallbackText = "", mode = "plain") {
  if (!tabId) {
    return { text: fallbackText, markdown: fallbackText };
  }

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: selectionToMarkdown,
      args: [fallbackText, mode]
    });

    return result?.result || { text: fallbackText, markdown: fallbackText };
  } catch {
    return { text: fallbackText, markdown: fallbackText };
  }
}

function selectionToMarkdown(fallbackText = "", mode = "plain") {
  const editableSelection = getEditableSelectionText();
  if (editableSelection) {
    return { text: editableSelection, markdown: editableSelection, codeLanguage: detectCodeLanguageFromPageContext(document.activeElement) };
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return { text: fallbackText, markdown: fallbackText };
  }

  const container = document.createElement("div");
  for (let index = 0; index < selection.rangeCount; index += 1) {
    container.appendChild(selection.getRangeAt(index).cloneContents());
  }

  const text = selection.toString();
  const plain = normalizePlainSelectionText(text);
  let markdown = plain;
  if (mode === "rich") {
    try {
      markdown = chooseSelectionMarkdown(text, nodesToMarkdown(Array.from(container.childNodes)).trim());
    } catch {
      markdown = plain;
    }
  }

  return {
    text,
    markdown,
    codeLanguage: detectCodeLanguageFromSelection(selection, container)
  };

  function chooseSelectionMarkdown(plainText, domMarkdown) {
    const normalizedPlain = normalizePlainSelectionText(plainText);
    if (!domMarkdown) {
      return normalizedPlain;
    }

    const plainLineCount = normalizedPlain.split("\n").filter((line) => line.trim()).length;
    const markdownLineCount = domMarkdown.split("\n").filter((line) => line.trim()).length;
    const plainHasStructure = /\n\s*(?:[-*+]\s+|\d+\.\s+|#{1,6}\s+|>|```)/.test(normalizedPlain);

    if (plainLineCount > markdownLineCount + 2 || plainHasStructure) {
      return normalizedPlain;
    }

    return domMarkdown;
  }

  function normalizePlainSelectionText(text) {
    return text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/g, ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function getEditableSelectionText() {
    const active = document.activeElement;
    if (!active) {
      return "";
    }

    const tag = active.tagName?.toLowerCase();
    if ((tag === "textarea" || tag === "input") && typeof active.selectionStart === "number" && typeof active.selectionEnd === "number") {
      return active.value.slice(active.selectionStart, active.selectionEnd);
    }

    if (active.isContentEditable) {
      return window.getSelection()?.toString() || "";
    }

    return "";
  }

  function detectCodeLanguageFromSelection(selection, container) {
    const explicitCodeNode = findLanguageNode(container);
    if (explicitCodeNode) {
      return explicitCodeNode;
    }

    const anchorLanguage = detectCodeLanguageFromPageContext(selection.anchorNode);
    if (anchorLanguage) {
      return anchorLanguage;
    }

    return detectCodeLanguageFromPageContext(selection.focusNode);
  }

  function detectCodeLanguageFromPageContext(node) {
    let current = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    while (current && current !== document.documentElement) {
      const language = languageFromElement(current);
      if (language) {
        return language;
      }
      current = current.parentElement;
    }
    return "";
  }

  function findLanguageNode(root) {
    if (root.nodeType === Node.ELEMENT_NODE) {
      const rootLanguage = languageFromElement(root);
      if (rootLanguage) {
        return rootLanguage;
      }
    }

    const node = root.querySelector?.("[class*='language-'], [class*='lang-'], [data-language], [data-lang], pre, code");
    return node ? languageFromElement(node) : "";
  }

  function languageFromElement(element) {
    const tag = element.tagName?.toLowerCase();
    const direct = [
      element.getAttribute("data-language"),
      element.getAttribute("data-lang")
    ].find(Boolean);
    if (direct) {
      return normalizeLanguageName(direct);
    }

    const classLanguage = Array.from(element.classList || [])
      .map((className) => /(?:^|[-_])(language|lang)[-_]([a-z0-9_+#.-]+)/i.exec(className)?.[2])
      .find(Boolean);
    if (classLanguage) {
      return normalizeLanguageName(classLanguage);
    }

    if (tag === "pre") {
      const nestedCode = element.querySelector?.("code");
      if (nestedCode && nestedCode !== element) {
        return languageFromElement(nestedCode);
      }
    }

    return "";
  }

  function normalizeLanguageName(value) {
    return String(value || "").trim().toLowerCase().replace(/^language-/, "").replace(/^lang-/, "");
  }

  function nodesToMarkdown(nodes) {
    return nodes.map(nodeToMarkdown).join("").replace(/\n{3,}/g, "\n\n");
  }

  function nodeToMarkdown(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent.replace(/\s+/g, " ");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const tag = node.tagName.toLowerCase();
    const content = nodesToMarkdown(Array.from(node.childNodes)).trim();

    if (!content && tag !== "img") {
      return "";
    }

    if (/^h[1-6]$/.test(tag)) {
      return `\n${"#".repeat(Number(tag.slice(1)))} ${content}\n\n`;
    }
    if (tag === "p" || tag === "div" || tag === "section" || tag === "article") {
      return `\n${content}\n\n`;
    }
    if (tag === "br") {
      return "\n";
    }
    if (tag === "strong" || tag === "b") {
      return `**${content}**`;
    }
    if (tag === "em" || tag === "i") {
      return `*${content}*`;
    }
    if (tag === "code") {
      return `\`${content.replaceAll("`", "\\`")}\``;
    }
    if (tag === "pre") {
      return `\n\`\`\`\n${node.textContent.trim()}\n\`\`\`\n\n`;
    }
    if (tag === "a") {
      const href = node.getAttribute("href") || "";
      return href ? `[${content}](${href})` : content;
    }
    if (tag === "img") {
      const alt = node.getAttribute("alt") || "";
      const src = node.getAttribute("src") || "";
      return src ? `![${alt}](${src})` : "";
    }
    if (tag === "ul") {
      return `\n${Array.from(node.children).map((child) => `- ${nodesToMarkdown(Array.from(child.childNodes)).trim()}`).join("\n")}\n\n`;
    }
    if (tag === "ol") {
      return `\n${Array.from(node.children).map((child, index) => `${index + 1}. ${nodesToMarkdown(Array.from(child.childNodes)).trim()}`).join("\n")}\n\n`;
    }
    if (tag === "blockquote") {
      return `\n${content.split(/\r?\n/).map((line) => `> ${line}`).join("\n")}\n\n`;
    }

    return content;
  }
}
