/* LitMag v2.0.1 defaults. All model credentials are supplied by the user in
 * Settings -> LitMag. Nothing here contacts a service or starts a process. */

/* Model / endpoint */
pref("extensions.litmag.provider", "openai");
pref("extensions.litmag.baseURL", "https://api.openai.com/v1");
pref("extensions.litmag.fullURL", false);
pref("extensions.litmag.apiKey", "");
pref("extensions.litmag.model", "gpt-4o-mini");
pref("extensions.litmag.temperature", "0.3");
pref("extensions.litmag.maxTokens", 4096);
pref("extensions.litmag.stream", true);
pref("extensions.litmag.systemPrompt", "你是嵌入在 Zotero 中的科研助手。基于提供的文献资料严谨作答，用简体中文，能标注页码时标注 (p. N)；资料没有依据时明确说明，不要编造。公式用 LaTeX。");
pref("extensions.litmag.profiles", "[]");

/* Context sent to the model */
pref("extensions.litmag.contextChars", 24000);
pref("extensions.litmag.includeFulltext", true);
pref("extensions.litmag.includeAnnotations", true);
pref("extensions.litmag.includeNotes", false);
pref("extensions.litmag.historyTurns", 8);

/* UI */
pref("extensions.litmag.enableSection", true);
pref("extensions.litmag.enableReader", true);
pref("extensions.litmag.enableMenus", true);
