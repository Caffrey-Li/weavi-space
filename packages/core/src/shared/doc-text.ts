/** 文本转 HTML 的小工具（浏览器也会引用，单独放一个文件，避免把清洗库打进前端包） */
export function escapeHtml(v: string) {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 纯文本（旧数据 / ITR 同步）转成段落 HTML，交给富文本编辑器 */
export function textToHtml(text: string) {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
