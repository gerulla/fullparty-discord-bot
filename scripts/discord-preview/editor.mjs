import {
  copy,
  isObject,
  sourceKey,
  componentNames,
  newComponent,
  assertDraft,
  validateMessage,
  isV2,
  createV2Message,
  normalizeMessage,
} from "./model.mjs";
import { createRenderer, esc } from "./renderer.mjs";
export { createRenderer };
const arr = (x) => (Array.isArray(x) ? x : []);
const get = (object, path) =>
  path.split(".").reduce((value, key) => value?.[key], object);
function set(object, path, value) {
  const keys = path.split(".");
  if (keys.some((k) => ["__proto__", "constructor", "prototype"].includes(k))) return;
  let target = object;
  keys.slice(0, -1).forEach((key, i) => {
    if (!target[key] || typeof target[key] !== "object")
      target[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    target = target[key];
  });
  if (value === undefined) delete target[keys.at(-1)];
  else target[keys.at(-1)] = value;
}
const download = (name, value) => {
  const link = document.createElement("a");
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export function start({ catalog, refresh }) {
  const renderMessage = createRenderer(catalog);
  let versions = [],
    draft = null,
    baseline = "",
    activeTab = "message",
    embedIndex = 0,
    busy = false,
    sending = false,
    sendResult = null,
    sendCapability = {
      enabled: false,
      reason:
        window.location.protocol === "file:"
          ? "Open the local workshop at http://127.0.0.1:4318/ to send previews."
          : "Checking Discord preview availability…",
    },
    loaded = false,
    lastRemoved = null;
  const invalid = new Map();
  const v2 = () => isV2(draft?.message);
  const tabs = () => [
    ...(v2()
      ? [
          ["controls", "Layout"],
          ["message", "Details"],
        ]
      : [
          ["message", "Message"],
          ["embeds", "Embeds"],
          ["controls", "Controls"],
        ]),
    ["attachments", "Files"],
    ["settings", "Settings"],
    ["json", "JSON"],
  ];
  const sidebar = document.createElement("aside");
  sidebar.id = "response-editor";
  sidebar.hidden = true;
  sidebar.setAttribute("aria-label", "Response editor");
  document.body.append(sidebar);
  const toast = document.createElement("div");
  toast.className = "editor-toast";
  toast.setAttribute("role", "status");
  document.body.append(toast);
  let toastTimer;
  function notify(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 6000);
  }
  const dirty = () => draft && (JSON.stringify(draft) !== baseline || invalid.size > 0);
  async function api(path = "", method = "GET", body) {
    const response = await fetch("/api/versions" + path, {
      method,
      headers:
        method === "GET"
          ? {}
          : { "Content-Type": "application/json", "X-Preview-Editor": "1" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        "The response editor server is unavailable. Start it with npm.cmd run preview:discord.",
      );
    }
    if (!response.ok) throw new Error(data.error || "The local save failed.");
    return data;
  }
  async function sendApi(method = "GET", body) {
    let response;
    try {
      response = await fetch("/api/send-version", {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Preview-Editor": "1",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error(
        method === "POST"
          ? "Could not reach the preview server. Check it is running, and check your Discord DMs before trying again."
          : "Discord preview sending is unavailable. Start the local workshop server and refresh this page.",
      );
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        method === "POST"
          ? "The preview server returned an unreadable response. Check your Discord DMs before sending again."
          : "Discord preview sending is unavailable. Restart the local workshop server and refresh this page.",
      );
    }
    if (!response.ok)
      throw new Error(
        typeof data?.error === "string"
          ? data.error
          : `The preview server rejected the request (HTTP ${response.status}).`,
      );
    return data;
  }
  function replaceVersion(version) {
    const i = versions.findIndex((v) => v.id === version.id);
    if (i < 0) versions.push(version);
    else versions[i] = version;
  }
  function decorate() {
    document.querySelectorAll("#catalog article.card").forEach((card) => {
      const record = catalog.records.find((r) => r.id === card.id);
      if (!record) return;
      let area = card.querySelector(".version-area");
      if (!area) {
        area = document.createElement("div");
        area.className = "version-area";
        card.append(area);
      }
      const openIds = new Set(
        [...area.querySelectorAll("details[open]")].map((d) => d.dataset.version),
      );
      const saved = versions.filter(
        (v) => !v.archivedAt && v.sourceKey === sourceKey(record),
      );
      area.innerHTML =
        '<div class="version-heading"><span>Current + ' +
        saved.length +
        " alternative" +
        (saved.length === 1 ? "" : "s") +
        '</span><div class="version-create"><button class="workshop-button" data-mode="v1" data-open="' +
        record.id +
        '">＋ Add Version V1</button><button class="workshop-button accent" data-mode="v2" data-open="' +
        record.id +
        '">＋ Add Version V2</button></div></div>' +
        saved
          .map(
            (v) =>
              '<details class="saved-version" data-version="' +
              v.id +
              '" ' +
              (openIds.has(v.id) ? "open" : "") +
              "><summary>" +
              esc(v.name) +
              '<small class="version-mode">' +
              (isV2(v.message) ? "V2" : "V1") +
              "</small>" +
              "<span>" +
              new Date(v.updatedAt).toLocaleDateString() +
              '</span></summary><div class="version-actions"><button class="workshop-button" data-edit="' +
              v.id +
              '">Edit</button><button class="workshop-button" data-clone="' +
              v.id +
              '">Duplicate</button><button class="workshop-button" data-export="' +
              v.id +
              '">Export JSON</button><button class="workshop-button subtle" data-archive="' +
              v.id +
              '">Remove</button></div>' +
              (v.notes ? '<p class="version-note">' + esc(v.notes) + "</p>" : "") +
              renderMessage(v.message, v.preview, v.assets) +
              "</details>",
          )
          .join("");
    });
    const counter = document.querySelector("#saved-version-count");
    if (counter)
      counter.textContent =
        versions.filter((v) => !v.archivedAt).length + " saved alternatives";
  }
  const toolbar = document.querySelector(".toolbar");
  toolbar.insertAdjacentHTML(
    "beforeend",
    '<button class="workshop-button" id="export-versions">Export alternatives</button><button class="workshop-button" id="import-versions">Import JSON</button><input type="file" id="import-versions-file" accept="application/json,.json" hidden><span id="saved-version-count" class="storage-status" role="status">Connecting to local storage…</span><button class="workshop-button" id="undo-version-remove" hidden>Undo remove</button>',
  );
  const storageStatus = document.querySelector("#saved-version-count");
  document.querySelector("#export-versions").onclick = () =>
    download("fullparty-alternatives.json", {
      schemaVersion: 1,
      versions: versions.map((version) => ({
        ...version,
        message: normalizeMessage(version.message),
      })),
    });
  document.querySelector("#import-versions").onclick = () =>
    document.querySelector("#import-versions-file").click();
  document.querySelector("#import-versions-file").onchange = async (e) => {
    if (busy) return;
    const file = e.target.files[0];
    if (!file) return;
    busy = true;
    lockEditor();
    try {
      if (file.size > 32 * 1024 * 1024)
        throw new Error("Import files must be under 32 MB.");
      const value = JSON.parse(await file.text());
      if (!Array.isArray(value.versions)) {
        if (!draft)
          throw new Error(
            "Open Add Version first to import a single message, or import an exported alternatives library.",
          );
        const message = isObject(value.message) ? value.message : value;
        assertDraft({ ...draft, message });
        draft.message = normalizeMessage(message);
        invalid.clear();
        paint();
        notify("Message imported into this draft. Save Version to keep it.");
        return;
      }
      const incoming = value.versions.filter((v) => !v.archivedAt);
      incoming.forEach(assertDraft);
      let count = 0;
      try {
        for (const item of incoming) {
          replaceVersion(
            await api("", "POST", {
              ...item,
              message: normalizeMessage(item.message),
              name: item.name.slice(0, 110) + " (imported)",
            }),
          );
          count++;
        }
      } catch (error) {
        throw new Error(`${count} versions imported; import stopped: ${error.message}`);
      }
      decorate();
      notify(`${count} versions imported as new alternatives.`);
    } catch (error) {
      decorate();
      notify(error.message);
    } finally {
      busy = false;
      lockEditor();
      if (draft) update();
      e.target.value = "";
    }
  };
  document.querySelector("#undo-version-remove").onclick = async () => {
    if (!lastRemoved) return;
    try {
      replaceVersion(
        await api("/" + lastRemoved.id + "/restore", "POST", {
          revision: lastRemoved.revision,
        }),
      );
      lastRemoved = null;
      document.querySelector("#undo-version-remove").hidden = true;
      decorate();
      notify("Version restored.");
    } catch (error) {
      notify(error.message);
    }
  };
  document.querySelector("#catalog").addEventListener("click", async (e) => {
    if (busy) return;
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.open) {
      const record = catalog.records.find((r) => r.id === b.dataset.open);
      open(record, null, false, b.dataset.mode);
    }
    if (b.dataset.edit || b.dataset.clone) {
      const v = versions.find((v) => v.id === (b.dataset.edit || b.dataset.clone));
      open(null, v, Boolean(b.dataset.clone));
    }
    if (b.dataset.export) {
      const v = versions.find((v) => v.id === b.dataset.export);
      download(v.name + ".json", normalizeMessage(v.message));
    }
    if (b.dataset.archive) {
      const v = versions.find((v) => v.id === b.dataset.archive);
      if (
        draft?.id === v.id &&
        dirty() &&
        !confirm("Discard the unsaved edits before removing this version?")
      )
        return;
      try {
        lastRemoved = await api("/" + v.id, "DELETE", { revision: v.revision });
        replaceVersion(lastRemoved);
        if (draft?.id === v.id) close(true);
        document.querySelector("#undo-version-remove").hidden = false;
        decorate();
        notify("Version removed. Use Undo remove to restore it.");
      } catch (error) {
        notify(error.message);
      }
    }
  });
  function open(record, version, clone = false, mode = "v1") {
    if (busy) return;
    if (
      dirty() &&
      !confirm("Discard the current unsaved edits and open another version?")
    )
      return;
    if (version) {
      draft = copy(version);
      if (clone) {
        delete draft.id;
        delete draft.revision;
        draft.name = version.name.slice(0, 110) + " (copy)";
      }
    } else
      draft = {
        sourceKey: sourceKey(record),
        sourceTitle: record.title,
        sourceGroup: record.group,
        sourceId: record.id,
        name:
          (mode === "v2" ? "V2 · Option " : "V1 · Option ") +
          String.fromCharCode(
            65 +
              (versions.filter(
                (v) =>
                  !v.archivedAt &&
                  v.sourceKey === sourceKey(record) &&
                  isV2(v.message) === (mode === "v2"),
              ).length %
                26),
          ),
        notes: "",
        message: mode === "v2" ? createV2Message(record.message) : copy(record.message),
        preview: { audience: record.audience, displayName: "FullParty" },
        assets: [],
      };
    draft.message = normalizeMessage(draft.message);
    baseline = JSON.stringify(draft);
    invalid.clear();
    sendResult = null;
    activeTab = v2() ? "controls" : "message";
    embedIndex = 0;
    sidebar.hidden = false;
    document.body.classList.add("editor-open");
    paint();
    sidebar.querySelector('[data-path="name"]').focus();
  }
  function close(force = false) {
    if (busy) return;
    if (!force && dirty() && !confirm("Discard unsaved changes to this version?")) return;
    draft = null;
    invalid.clear();
    sidebar.hidden = true;
    document.body.classList.remove("editor-open");
  }
  const button = (text, action, path = "", extra = "") =>
    '<button type="button" class="workshop-button" data-action="' +
    action +
    '" data-target="' +
    esc(path) +
    '" ' +
    extra +
    ">" +
    esc(text) +
    "</button>";
  function field(path, label, type = "text", options = {}) {
    let value = get(draft, path);
    const id = "field-" + path.replaceAll(".", "-");
    const attrs =
      ' id="' +
      id +
      '" data-path="' +
      path +
      '" ' +
      (options.convert ? 'data-convert="' + options.convert + '" ' : "") +
      (options.placeholder ? 'placeholder="' + esc(options.placeholder) + '" ' : "");
    if (type === "checkbox")
      return (
        '<label class="check-field"><input type="checkbox" ' +
        attrs +
        (value ? "checked" : "") +
        "><span>" +
        esc(label) +
        "</span></label>"
      );
    if (options.convert === "json")
      value = value === undefined ? "" : JSON.stringify(value, null, 2);
    if (options.convert === "list") value = arr(value).join(", ");
    if (options.convert === "color")
      value =
        value === undefined ? "" : "#" + Number(value).toString(16).padStart(6, "0");
    let control =
      type === "textarea"
        ? "<textarea " +
          attrs +
          ' rows="' +
          (options.rows || 3) +
          '">' +
          esc(value) +
          "</textarea>"
        : type === "select"
          ? "<select " +
            attrs +
            ">" +
            options.choices
              .map(
                ([v, text]) =>
                  '<option value="' +
                  esc(v) +
                  '" ' +
                  (String(value ?? "") === String(v) ? "selected" : "") +
                  ">" +
                  esc(text) +
                  "</option>",
              )
              .join("") +
            "</select>"
          : '<input type="' +
            type +
            '" ' +
            attrs +
            ' value="' +
            esc(value) +
            '" ' +
            (options.min !== undefined ? 'min="' + options.min + '" ' : "") +
            (options.max !== undefined ? 'max="' + options.max + '" ' : "") +
            ">";
    if (options.convert === "color")
      control =
        '<div class="color-input">' +
        control +
        '<input aria-label="' +
        esc(label) +
        ' picker" type="color" data-path="' +
        path +
        '" data-convert="color" value="' +
        esc(value || "#5865f2") +
        '"></div>';
    return (
      '<label class="editor-field" for="' +
      id +
      '"><span>' +
      esc(label) +
      (options.limit
        ? '<small data-counter="' +
          path +
          '">' +
          String(String(get(draft, path) ?? "").length) +
          " / " +
          options.limit +
          "</small>"
        : "") +
      "</span>" +
      control +
      "</label>"
    );
  }
  const section = (title, body, open = false) =>
    '<details class="editor-section" ' +
    (open ? "open" : "") +
    "><summary>" +
    esc(title) +
    '</summary><div class="section-body">' +
    body +
    "</div></details>";
  const row = (html) => '<div class="form-row">' + html + "</div>";
  const jsonField = (path, label) =>
    field(path, label, "textarea", { convert: "json", rows: 4 });
  function tools(path) {
    return (
      '<div class="item-tools">' +
      button("↑", "up", path) +
      button("↓", "down", path) +
      button("Duplicate", "duplicate", path) +
      button("Remove", "remove", path) +
      "</div>"
    );
  }
  function embedForm() {
    const embeds = arr(draft.message.embeds);
    embedIndex = Math.max(0, Math.min(embedIndex, embeds.length - 1));
    const chooser =
      '<div class="embed-chooser">' +
      embeds
        .map((e, i) =>
          button(
            "Embed " + (i + 1),
            "select-embed",
            String(i),
            'aria-pressed="' + (embedIndex === i) + '"',
          ),
        )
        .join("") +
      button("＋ Add embed", "add-embed") +
      "</div>";
    if (!embeds.length)
      return (
        chooser +
        '<p class="editor-hint">Add an embed to build a title, description, fields, images and footer.</p>'
      );
    const p = "message.embeds." + embedIndex,
      e = embeds[embedIndex];
    if (!isObject(e))
      return (
        chooser +
        '<p class="editor-hint">This embed is not an object. Correct it in JSON.</p>' +
        tools(p)
      );
    return (
      chooser +
      tools(p) +
      field(p + ".title", "Embed " + (embedIndex + 1) + " title", "text", {
        limit: 256,
      }) +
      field(p + ".url", "Title link URL", "url") +
      field(p + ".description", "Description", "textarea", { rows: 5, limit: 4096 }) +
      row(
        field(p + ".color", "Accent colour", "text", { convert: "color" }) +
          field(p + ".timestamp", "Timestamp (ISO 8601)", "text", {
            placeholder: "2026-10-16T18:00:00Z",
          }),
      ) +
      section(
        "Author",
        field(p + ".author.name", "Author name", "text", { limit: 256 }) +
          field(p + ".author.url", "Author link URL", "url") +
          field(p + ".author.icon_url", "Author icon URL", "text"),
      ) +
      section(
        "Images",
        field(p + ".thumbnail.url", "Thumbnail URL", "text", {
          placeholder: "https://… or attachment://image.png",
        }) +
          field(p + ".image.url", "Large image URL", "text", {
            placeholder: "https://… or attachment://image.png",
          }),
      ) +
      section(
        "Footer",
        field(p + ".footer.text", "Footer text", "textarea", { limit: 2048 }) +
          field(p + ".footer.icon_url", "Footer icon URL", "text"),
      ) +
      section(
        "Fields (" + arr(e.fields).length + "/25)",
        arr(e.fields)
          .map(
            (f, i) =>
              '<div class="edit-item">' +
              tools(p + ".fields." + i) +
              field(p + ".fields." + i + ".name", "Field " + (i + 1) + " name", "text", {
                limit: 256,
              }) +
              field(
                p + ".fields." + i + ".value",
                "Field " + (i + 1) + " value",
                "textarea",
                { limit: 1024 },
              ) +
              field(p + ".fields." + i + ".inline", "Display inline", "checkbox") +
              "</div>",
          )
          .join("") + button("＋ Add field", "add-field", p + ".fields"),
        true,
      )
    );
  }
  function addComponent(path, types) {
    return (
      '<div class="add-component"><select aria-label="New component for ' +
      esc(path) +
      '" data-component-type="' +
      path +
      '">' +
      types
        .map((t) => '<option value="' + t + '">' + componentNames[t] + "</option>")
        .join("") +
      "</select>" +
      button("＋ Add", "add-component", path) +
      "</div>"
    );
  }
  function componentForm(value, p, depth = 0) {
    if (depth > 12) return "<p>Use JSON to edit deeper nesting.</p>";
    const c = isObject(value) ? value : {};
    let body = tools(p);
    if (c.type === 2)
      body +=
        field(p + ".style", "Button style", "select", {
          convert: "number",
          choices: [
            [1, "Primary · blurple"],
            [2, "Secondary · grey"],
            [3, "Success · green"],
            [4, "Danger · red"],
            [5, "Link"],
            [6, "Premium · SKU"],
          ],
        }) +
        (c.style !== 6
          ? field(p + ".label", "Button label", "text", { limit: 80 }) +
            row(
              field(p + ".emoji.name", "Emoji") +
                field(p + ".emoji.id", "Custom emoji ID"),
            ) +
            field(p + ".emoji.animated", "Animated emoji", "checkbox")
          : "") +
        (c.style === 5
          ? field(p + ".url", "Button URL", "url")
          : c.style === 6
            ? field(p + ".sku_id", "SKU ID")
            : field(p + ".custom_id", "Button custom ID")) +
        field(p + ".disabled", "Disabled", "checkbox");
    if ([3, 5, 6, 7, 8].includes(c.type)) {
      body +=
        field(p + ".custom_id", "Select custom ID") +
        field(p + ".placeholder", "Placeholder", "text", { limit: 150 }) +
        row(
          field(p + ".min_values", "Minimum selections", "number") +
            field(p + ".max_values", "Maximum selections", "number"),
        ) +
        field(p + ".disabled", "Disabled", "checkbox");
      if (c.type === 3)
        body +=
          arr(c.options)
            .map((o, i) =>
              section(
                "Option " + (i + 1),
                tools(p + ".options." + i) +
                  field(p + ".options." + i + ".label", "Option label") +
                  field(p + ".options." + i + ".value", "Option value") +
                  field(p + ".options." + i + ".description", "Option description") +
                  row(
                    field(p + ".options." + i + ".emoji.name", "Option emoji") +
                      field(p + ".options." + i + ".emoji.id", "Option emoji ID"),
                  ) +
                  field(
                    p + ".options." + i + ".default",
                    "Selected by default",
                    "checkbox",
                  ),
              ),
            )
            .join("") + button("＋ Add option", "add-option", p + ".options");
      else body += jsonField(p + ".default_values", "Default values · [{id, type}]");
      if (c.type === 8)
        body += jsonField(p + ".channel_types", "Allowed channel types · numeric array");
    }
    if (c.type === 10)
      body += field(p + ".content", "Text display content", "textarea", {
        rows: 5,
        limit: 4000,
      });
    if (c.type === 11)
      body +=
        field(p + ".media.url", "Thumbnail media URL") +
        field(p + ".description", "Image description (optional)", "text", {
          limit: 1024,
        }) +
        field(p + ".spoiler", "Spoiler", "checkbox");
    if (c.type === 12)
      body +=
        arr(c.items)
          .map((x, i) =>
            section(
              "Media " + (i + 1),
              tools(p + ".items." + i) +
                field(p + ".items." + i + ".media.url", "Media URL") +
                field(
                  p + ".items." + i + ".description",
                  "Media description (optional)",
                  "text",
                  { limit: 1024 },
                ) +
                field(p + ".items." + i + ".spoiler", "Spoiler", "checkbox"),
              true,
            ),
          )
          .join("") + button("＋ Add media", "add-media", p + ".items");
    if (c.type === 13)
      body +=
        field(p + ".file.url", "File URL · attachment://filename") +
        field(p + ".spoiler", "Spoiler", "checkbox");
    if (c.type === 14)
      body +=
        field(p + ".divider", "Show divider", "checkbox") +
        field(p + ".spacing", "Spacing", "select", {
          convert: "number",
          choices: [
            [1, "Small"],
            [2, "Large"],
          ],
        });
    if (c.type === 17)
      body +=
        field(p + ".accent_color", "Container accent colour", "text", {
          convert: "color",
        }) + field(p + ".spoiler", "Spoiler", "checkbox");
    if ([1, 9, 17].includes(c.type))
      body +=
        arr(c.components)
          .map((child, i) => componentForm(child, p + ".components." + i, depth + 1))
          .join("") +
        addComponent(
          p + ".components",
          c.type === 1
            ? [2, 3, 5, 6, 7, 8]
            : c.type === 9
              ? [10]
              : [1, 9, 10, 12, 13, 14],
        );
    if (c.type === 9)
      body += section(
        "Section accessory",
        componentForm(c.accessory, p + ".accessory", depth + 1) +
          button("Use button", "accessory-button", p + ".accessory") +
          button("Use thumbnail", "accessory-thumbnail", p + ".accessory"),
      );
    body += section(
      "Advanced",
      field(p + ".id", "Numeric component ID (optional)", "number"),
    );
    return section(
      (componentNames[c.type] || "Component") +
        " · " +
        (c.label ||
          c.placeholder ||
          (typeof c.content === "string"
            ? c.content
                .split("\n")[0]
                .replace(/^#+\s*/, "")
                .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
                .slice(0, 60)
            : "") ||
          (Number.isFinite(Number(p.split(".").at(-1)))
            ? Number(p.split(".").at(-1)) + 1
            : "Accessory")),
      body,
      depth === 0,
    );
  }
  function messageForm() {
    return (
      (v2()
        ? '<p class="editor-hint">Write your response using Text displays in Layout. Keep design notes and preview appearance here.</p>'
        : field("message.content", "Message text", "textarea", { rows: 7, limit: 2000 }) +
          '<p class="editor-hint">Markdown, mentions, links and Discord timestamps are supported. Add embeds in the Embeds tab.</p>') +
      field("notes", "Design notes", "textarea", { rows: 3 }) +
      (v2()
        ? ""
        : section(
            "Poll",
            draft.message.poll
              ? field("message.poll.question.text", "Poll question", "text", {
                  limit: 300,
                }) +
                  row(
                    field("message.poll.duration", "Duration in hours", "number", {
                      min: 1,
                      max: 768,
                    }) +
                      field(
                        "message.poll.allow_multiselect",
                        "Allow multiple answers",
                        "checkbox",
                      ),
                  ) +
                  arr(draft.message.poll.answers)
                    .map(
                      (a, i) =>
                        '<div class="edit-item">' +
                        tools("message.poll.answers." + i) +
                        field(
                          "message.poll.answers." + i + ".poll_media.text",
                          "Answer " + (i + 1),
                          "text",
                          { limit: 55 },
                        ) +
                        field(
                          "message.poll.answers." + i + ".poll_media.emoji.name",
                          "Answer emoji",
                        ) +
                        "</div>",
                    )
                    .join("") +
                  button("＋ Add answer", "add-answer", "message.poll.answers") +
                  button("Remove poll", "remove", "message.poll")
              : button("＋ Add poll", "add-poll"),
          )) +
      section(
        "Preview appearance",
        field("preview.displayName", "Bot display name (preview only)") +
          field("preview.avatarUrl", "Bot avatar URL (preview only)", "url") +
          field("preview.audience", "Audience label", "select", {
            choices: [
              ["Only you", "Only you"],
              ["Direct message", "Direct message"],
              ["#run-schedule", "#run-schedule"],
              ["#bot-log", "#bot-log"],
              ["#raid-chat", "#raid-chat"],
              ["Owner DM", "Owner DM"],
            ],
          }) +
          field("preview.timeLabel", "Message time label") +
          field("preview.replyText", "Reply context (preview only)"),
      )
    );
  }
  function attachmentForm() {
    return (
      '<p class="editor-hint">Upload local images or files for this design. Use <code>attachment://filename.png</code> in an image field. Files stay in the local version library; they are not sent to Discord.</p><label class="workshop-button upload-label">＋ Upload attachments<input id="editor-uploads" type="file" multiple></label><p class="editor-hint">Up to 10 files; 4 MB per file and 10 MB total for this demo.</p>' +
      arr(draft.assets)
        .map(
          (asset, i) =>
            '<div class="edit-item"><strong>' +
            esc(asset.name) +
            '</strong><span class="editor-hint"> ' +
            Math.round(asset.size / 1024) +
            " KB</span>" +
            button("Remove asset", "remove-asset", String(i)) +
            "</div>",
        )
        .join("") +
      arr(draft.message.files)
        .map((file, i) =>
          section(
            "Attachment " + (i + 1),
            tools("message.files." + i) +
              field("message.files." + i + ".name", "Filename") +
              field(
                "message.files." + i + ".attachment",
                "Source URL or attachment://filename",
              ) +
              field("message.files." + i + ".description", "Description / alt text") +
              field("message.files." + i + ".spoiler", "Spoiler", "checkbox"),
            true,
          ),
        )
        .join("") +
      button("＋ Add attachment URL", "add-attachment") +
      jsonField("message.attachments", "Existing attachment metadata (advanced)")
    );
  }
  function settingsForm() {
    const flags = Number(draft.message.flags) || 0;
    return (
      '<h3>Delivery options</h3><p class="editor-hint">These describe the proposed response. Controls in this workshop never send a message.</p>' +
      [
        [64, "Ephemeral (interaction replies only)"],
        ...(!v2() ? [[4, "Suppress embeds"]] : []),
        [4096, "Suppress notifications"],
      ]
        .map(
          ([bit, label]) =>
            '<label class="check-field"><input type="checkbox" data-flag="' +
            bit +
            '" ' +
            (flags & bit ? "checked" : "") +
            "><span>" +
            label +
            "</span></label>",
        )
        .join("") +
      field("message.tts", "Text to speech", "checkbox") +
      field("message.flags", "Flags bitfield (advanced)", "number") +
      section(
        "Allowed mentions",
        jsonField(
          "message.allowedMentions",
          "Discord.js allowed mentions · parse, users, roles, repliedUser",
        ) +
          '<p class="editor-hint">Example: {"parse": [], "repliedUser": false}. REST-style allowed_mentions keys are preserved in JSON as well.</p>',
      ) +
      section(
        "Reply / message reference",
        field("message.reply.messageReference", "Reply to message ID") +
          field(
            "message.reply.failIfNotExists",
            "Fail if referenced message is missing",
            "checkbox",
          ),
      ) +
      section(
        "Other options",
        field("message.nonce", "Nonce") +
          field("message.enforceNonce", "Enforce nonce", "checkbox") +
          (v2()
            ? ""
            : field("message.stickers", "Sticker IDs (comma separated)", "text", {
                convert: "list",
              })) +
          field("message.threadId", "Thread ID (webhook context)") +
          field("message.username", "Webhook username override") +
          field("message.avatarURL", "Webhook avatar override", "url") +
          jsonField("message.appliedTags", "Forum tag IDs (webhook context)"),
      ) +
      section(
        "Discord reference",
        '<p class="editor-hint">' +
          (v2()
            ? "All message component types are available in Layout. Thumbnails are section accessories; buttons and selects use rows. Modal-only inputs belong in separate dialogs."
            : "All writable rich embed fields are available in Embeds. Received-message metadata such as reactions, provider and video embeds is generated by Discord.") +
          ' Context-specific or future properties can be kept in JSON.</p><a target="_blank" rel="noreferrer" href="https://docs.discord.com/developers/resources/message">Message reference ↗</a> · <a target="_blank" rel="noreferrer" href="https://docs.discord.com/developers/components/reference">Component reference ↗</a>',
      )
    );
  }
  function controlsForm() {
    return (
      '<p class="editor-hint">' +
      (v2()
        ? "Build your message with text, containers, sections, media and controls. Buttons and selects are placed in action rows; thumbnails are placed beside section text. V2 uses components for all content, with no legacy embeds, polls or stickers."
        : "Add buttons and select menus in action rows. Use Add Version V2 on the original to design a component layout.") +
      "</p>" +
      addComponent(
        "message.components",
        v2() ? [17, 9, 10, 12, 13, 14, 1, 2, 3, 5, 6, 7, 8, 11] : [1],
      ) +
      arr(draft.message.components)
        .map((c, i) => componentForm(c, "message.components." + i))
        .join("")
    );
  }
  function paint() {
    if (!tabs().some(([tab]) => tab === activeTab))
      activeTab = v2() ? "controls" : "message";
    sidebar.dataset.mode = v2() ? "v2" : "v1";
    sidebar.innerHTML =
      '<div class="editor-header"><div><div class="eyebrow">RESPONSE WORKSHOP · ' +
      (v2() ? "V2 COMPONENTS" : "V1 MESSAGE & EMBEDS") +
      "</div><h2>" +
      esc(draft.sourceTitle) +
      "</h2></div>" +
      button("✕", "close", "", 'aria-label="Close response editor"') +
      '</div><div class="editor-save-row">' +
      field("name", "Version name") +
      '<div class="editor-version-actions"><button class="workshop-button accent" data-action="save">Save Version</button><button class="workshop-button" data-action="send" aria-describedby="editor-send-status">Send Version</button></div></div><div class="editor-state" id="editor-state" role="status"></div><div class="editor-send-status" id="editor-send-status" role="status" aria-live="polite" aria-atomic="true"></div><nav class="editor-tabs" aria-label="Editor sections">' +
      tabs()
        .map(
          ([tab, label]) =>
            '<button type="button" data-tab="' +
            tab +
            '" aria-pressed="' +
            (tab === activeTab) +
            '">' +
            label +
            "</button>",
        )
        .join("") +
      '</nav><div class="editor-form">' +
      (activeTab === "message"
        ? messageForm()
        : activeTab === "embeds"
          ? embedForm()
          : activeTab === "controls"
            ? controlsForm()
            : activeTab === "attachments"
              ? attachmentForm()
              : activeTab === "settings"
                ? settingsForm()
                : '<p class="editor-hint">Edit the full message payload. Unknown properties are retained. JSON syntax must be valid before saving; Discord compatibility warnings do not block drafts.</p>' +
                  jsonField("message", "Message JSON") +
                  '<div class="item-tools">' +
                  button("Copy JSON", "copy-json") +
                  button("Download JSON", "export-json") +
                  button(
                    v2() ? "Reset V2 layout from original" : "Reset to original",
                    "reset",
                  ) +
                  "</div>") +
      '</div><details class="editor-diagnostics" id="editor-diagnostics"><summary id="diagnostic-title"></summary><ul id="diagnostic-list"></ul></details><div class="editor-preview-heading"><span>LIVE PREVIEW</span><span>Discord-style approximation</span></div><div id="editor-preview" class="editor-preview"></div>';
    update();
  }
  function update() {
    if (!draft) return;
    const errors = [...invalid.values(), ...validateMessage(draft.message)];
    document.querySelector("#editor-preview").innerHTML = renderMessage(
      draft.message,
      draft.preview,
      draft.assets,
    );
    document.querySelector("#diagnostic-title").textContent = errors.length
      ? errors.length +
        " design warning" +
        (errors.length === 1 ? "" : "s") +
        " · drafts can still be saved"
      : "No common Discord limit issues";
    document.querySelector("#diagnostic-list").innerHTML = errors
      .map((x) => "<li>" + esc(x) + "</li>")
      .join("");
    document.querySelector("#editor-state").textContent = busy
      ? sending
        ? "Sending…"
        : "Saving…"
      : invalid.size
        ? "Fix invalid input before saving or sending."
        : dirty()
          ? "Unsaved changes"
          : draft.id
            ? "Saved locally · " + new Date(draft.updatedAt).toLocaleTimeString()
            : "New alternative · not saved yet";
    sidebar.querySelector('[data-action="save"]').disabled =
      busy || !loaded || invalid.size > 0 || !draft.name.trim();
    const sendButton = sidebar.querySelector('[data-action="send"]');
    const sendDisabledReason = !sendCapability.enabled
      ? sendCapability.reason || "Discord preview sending is not configured."
      : invalid.size
        ? "Fix invalid input before sending."
        : busy
          ? sending
            ? "Sending this preview to your Discord DMs…"
            : "Wait for the current operation to finish."
          : "";
    sendButton.disabled = Boolean(sendDisabledReason);
    sendButton.textContent = sending ? "Sending…" : "Send Version";
    sendButton.title =
      sendDisabledReason || "Send the current draft to your Discord DMs without saving.";
    const sendStatus = sidebar.querySelector("#editor-send-status");
    sendStatus.dataset.state = sendResult?.state || "info";
    sendStatus.textContent = sendResult?.text || sendDisabledReason;
    sendStatus.hidden = !sendStatus.textContent;
    sidebar.querySelectorAll("[data-counter]").forEach((n) => {
      const max = n.textContent.split("/")[1]?.trim();
      n.textContent =
        String(String(get(draft, n.dataset.counter) ?? "").length) +
        (max ? " / " + max : "");
    });
  }
  function lockEditor() {
    sidebar.inert = busy;
    toolbar.inert = busy;
    document.querySelector("#catalog").inert = busy;
  }
  async function save() {
    if (!draft || busy || invalid.size) return;
    busy = true;
    lockEditor();
    update();
    try {
      const version = await api(
        draft.id ? "/" + draft.id : "",
        draft.id ? "PUT" : "POST",
        { ...draft, message: normalizeMessage(draft.message) },
      );
      draft = version;
      baseline = JSON.stringify(draft);
      replaceVersion(version);
      decorate();
      notify("Version saved locally.");
    } catch (error) {
      notify(error.message);
    } finally {
      busy = false;
      lockEditor();
      update();
    }
  }
  async function send() {
    if (!draft || busy || invalid.size || !sendCapability.enabled) return;
    const snapshot = copy(draft);
    snapshot.message = normalizeMessage(snapshot.message);
    busy = true;
    sending = true;
    sendResult = { state: "info", text: "Sending this preview to your Discord DMs…" };
    lockEditor();
    update();
    try {
      const result = await sendApi("POST", snapshot);
      if (typeof result?.messageId !== "string" || !result.messageId)
        throw new Error(
          "The preview server did not confirm delivery. Check your Discord DMs before sending again.",
        );
      sendResult = {
        state: "success",
        text: `Sent preview to your Discord DMs at ${new Date().toLocaleTimeString()}.`,
      };
    } catch (error) {
      sendResult = { state: "error", text: error.message };
    } finally {
      busy = false;
      sending = false;
      lockEditor();
      update();
    }
  }
  sidebar.addEventListener("input", (e) => {
    if (busy) return;
    const el = e.target,
      path = el.dataset.path;
    if (!path || !draft) return;
    const previousMode = v2();
    try {
      let value = el.type === "checkbox" ? el.checked : el.value;
      if (el.dataset.convert === "json") {
        value = value.trim() ? JSON.parse(value) : undefined;
        if (path === "message" && !isObject(value))
          throw new Error("Message JSON must be an object.");
        if (value !== undefined)
          assertDraft({
            ...draft,
            message: path === "message" ? value : { test: value },
          });
      } else if (el.dataset.convert === "color") {
        if (value && !/^#[\da-f]{6}$/i.test(value))
          throw new Error("Use a six-digit hex colour, such as #5865F2.");
        value = value ? parseInt(value.slice(1), 16) : undefined;
      } else if (el.type === "number" || el.dataset.convert === "number") {
        value = value === "" ? undefined : Number(value);
        if (value !== undefined && !Number.isFinite(value))
          throw new Error("Enter a valid number.");
      } else if (el.dataset.convert === "list")
        value = value
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
      else if (value === "" && !["name", "notes", "message.content"].includes(path))
        value = undefined;
      set(draft, path, value);
      invalid.delete(path);
      if (el.dataset.convert === "color")
        sidebar.querySelectorAll('[data-path="' + path + '"]').forEach((n) => {
          if (n !== el)
            n.value =
              value === undefined ? "#5865f2" : "#" + value.toString(16).padStart(6, "0");
        });
    } catch (error) {
      invalid.set(path, error.message);
    }
    update();
    if (v2() !== previousMode) paint();
  });
  sidebar.addEventListener("change", async (e) => {
    if (busy || !draft) return;
    const el = e.target;
    if (el.dataset.flag) {
      draft.message.flags = el.checked
        ? (Number(draft.message.flags) || 0) | Number(el.dataset.flag)
        : (Number(draft.message.flags) || 0) & ~Number(el.dataset.flag);
      update();
      const flagsInput = sidebar.querySelector('[data-path="message.flags"]');
      if (flagsInput) flagsInput.value = draft.message.flags;
    }
    if (el.dataset.path?.endsWith(".style")) {
      const p = el.dataset.path.slice(0, -6);
      const c = get(draft, p);
      if (c.style === 5) {
        delete c.custom_id;
        delete c.sku_id;
        c.url ||= "https://fullparty.gg";
      } else if (c.style === 6) {
        delete c.custom_id;
        delete c.url;
        delete c.label;
        delete c.emoji;
        c.sku_id ||= "";
      } else {
        delete c.url;
        delete c.sku_id;
        c.custom_id ||= newComponent(2).custom_id;
      }
      paint();
    }
    if (el.id === "editor-uploads") {
      busy = true;
      lockEditor();
      try {
        const files = [...el.files];
        if (arr(draft.assets).length + files.length > 10)
          throw new Error("Use up to 10 local attachments.");
        if (
          files.some((f) => f.size > 4 * 1024 * 1024) ||
          files.reduce(
            (s, f) => s + f.size,
            arr(draft.assets).reduce((s, a) => s + a.size, 0),
          ) >
            10 * 1024 * 1024
        )
          throw new Error("Use files under 4 MB each and 10 MB total.");
        const names = new Set(arr(draft.assets).map((a) => a.name));
        for (const f of files) {
          if (names.has(f.name))
            throw new Error(
              "An attachment named " +
                f.name +
                " already exists. Rename it before uploading.",
            );
          names.add(f.name);
        }
        const data = await Promise.all(
          files.map(
            (f) =>
              new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () =>
                  resolve({
                    name: f.name,
                    size: f.size,
                    mimeType: f.type,
                    dataUrl: reader.result,
                  });
                reader.onerror = () => reject(new Error("Could not read " + f.name));
                reader.readAsDataURL(f);
              }),
          ),
        );
        draft.assets.push(...data);
        draft.message.files = arr(draft.message.files);
        for (const a of data)
          draft.message.files.push({
            name: a.name,
            attachment: "attachment://" + a.name,
          });
        if (v2()) {
          draft.message.components = arr(draft.message.components);
          for (const asset of data)
            draft.message.components.push(
              asset.mimeType.startsWith("image/") || asset.mimeType.startsWith("video/")
                ? { type: 12, items: [{ media: { url: "attachment://" + asset.name } }] }
                : { type: 13, file: { url: "attachment://" + asset.name } },
            );
        }
        paint();
      } catch (error) {
        notify(error.message);
      } finally {
        busy = false;
        lockEditor();
        update();
        el.value = "";
      }
    }
  });
  sidebar.addEventListener("click", async (e) => {
    if (busy) return;
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.tab) {
      if (invalid.size) {
        notify("Fix the invalid input before switching tabs.");
        return;
      }
      activeTab = b.dataset.tab;
      paint();
      return;
    }
    const action = b.dataset.action,
      p = b.dataset.target;
    if (!action) return;
    if (action === "close") {
      close();
      return;
    }
    if (action === "save") {
      await save();
      return;
    }
    if (action === "send") {
      await send();
      return;
    }
    if (action === "copy-json") {
      try {
        await navigator.clipboard.writeText(
          JSON.stringify(normalizeMessage(draft.message), null, 2),
        );
        notify("Message JSON copied.");
      } catch {
        notify("Clipboard unavailable. Use Download JSON.");
      }
      return;
    }
    if (action === "export-json") {
      download(draft.name + ".json", normalizeMessage(draft.message));
      return;
    }
    if (invalid.size) {
      notify("Fix the invalid input before changing the structure.");
      return;
    }
    const push = (path, item) => {
      const list = arr(get(draft, path));
      list.push(item);
      set(draft, path, list);
    };
    if (action === "select-embed") embedIndex = Number(p);
    if (action === "add-embed") {
      push("message.embeds", {
        title: "New embed",
        description: "Write your message here.",
        color: 0x5865f2,
      });
      embedIndex = draft.message.embeds.length - 1;
    }
    if (action === "add-field")
      push(p, { name: "Field name", value: "Field value", inline: false });
    if (action === "add-option")
      push(p, {
        label: "New option",
        value: "option_" + Math.random().toString(36).slice(2, 7),
      });
    if (action === "add-media") push(p, { media: { url: "" } });
    if (action === "add-component") {
      const select = sidebar.querySelector('[data-component-type="' + p + '"]');
      const type = Number(select.value);
      let component = newComponent(type);
      if (p === "message.components" && [2, 3, 5, 6, 7, 8].includes(type))
        component = { type: 1, components: [component] };
      if (p === "message.components" && type === 11)
        component = { type: 9, components: [newComponent(10)], accessory: component };
      push(p, component);
    }
    if (action === "accessory-button") set(draft, p, newComponent(2));
    if (action === "accessory-thumbnail") set(draft, p, newComponent(11));
    if (action === "add-poll")
      draft.message.poll = {
        question: { text: "Which time works for you?" },
        answers: [
          { poll_media: { text: "Friday" } },
          { poll_media: { text: "Saturday" } },
        ],
        duration: 24,
        allow_multiselect: false,
        layout_type: 1,
      };
    if (action === "add-answer") push(p, { poll_media: { text: "Another option" } });
    if (action === "add-attachment")
      push("message.files", {
        name: "example.png",
        attachment: "https://",
        description: "",
      });
    if (action === "remove-asset") {
      const asset = draft.assets[Number(p)];
      draft.assets.splice(Number(p), 1);
      draft.message.files = arr(draft.message.files).filter((f) => f.name !== asset.name);
    }
    if (["up", "down", "remove", "duplicate"].includes(action)) {
      const keys = p.split("."),
        key = keys.pop(),
        parent = get(draft, keys.join("."));
      if (Array.isArray(parent)) {
        const i = Number(key);
        if (action === "remove") parent.splice(i, 1);
        if (action === "duplicate") parent.splice(i + 1, 0, copy(parent[i]));
        const j = i + (action === "up" ? -1 : 1);
        if (["up", "down"].includes(action) && j >= 0 && j < parent.length)
          [parent[i], parent[j]] = [parent[j], parent[i]];
      } else if (action === "remove") set(draft, p, undefined);
    }
    if (action === "reset") {
      const original = catalog.records.find((r) => sourceKey(r) === draft.sourceKey);
      if (original && confirm("Replace this draft message with the original?"))
        draft.message = v2() ? createV2Message(original.message) : copy(original.message);
    }
    paint();
  });
  window.addEventListener("beforeunload", (e) => {
    if (dirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  window.addEventListener("keydown", (e) => {
    if (draft && (e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      save();
    }
    if (draft && e.key === "Escape") close();
  });
  window.addEventListener("catalog-render", decorate);
  if (window.location.protocol !== "file:") {
    sendApi()
      .then((data) => {
        sendCapability = {
          enabled: data?.enabled === true,
          reason:
            typeof data?.reason === "string"
              ? data.reason
              : "Discord preview sending is not configured.",
        };
        if (draft) update();
      })
      .catch((error) => {
        sendCapability = { enabled: false, reason: error.message };
        if (draft) update();
      });
  }
  api()
    .then((data) => {
      versions = data.versions;
      loaded = true;
      decorate();
      if (draft) update();
    })
    .catch((error) => {
      storageStatus.textContent = "Storage unavailable · view only";
      notify(error.message);
      if (draft) update();
    });
  decorate();
  return { decorate, refresh };
}
