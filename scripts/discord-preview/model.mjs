export const copy = (value) => JSON.parse(JSON.stringify(value));
export const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const isV2 = (message) => Boolean(Number(message?.flags) & 32768);

// Optional media alt text must be omitted, rather than sent as an empty string.
export function normalizeMessage(message) {
  const normalized = copy(message);
  const omitBlankDescription = (media) => {
    if (
      isObject(media) &&
      typeof media.description === "string" &&
      !media.description.trim()
    )
      delete media.description;
  };
  function visit(component) {
    if (!isObject(component)) return;
    if (component.type === 11) omitBlankDescription(component);
    if (component.type === 12 && Array.isArray(component.items))
      component.items.forEach(omitBlankDescription);
    if (Array.isArray(component.components)) component.components.forEach(visit);
    if (component.accessory) visit(component.accessory);
  }
  if (Array.isArray(normalized.components)) normalized.components.forEach(visit);
  return normalized;
}

// Seed a new design from the original without changing the reference payload.
export function createV2Message(original) {
  const message = copy(original);
  if (isV2(message)) return message;
  const components = [];
  const text = (content) => ({ type: 10, content });
  if (message.content) components.push(text(String(message.content)));
  for (const embed of Array.isArray(message.embeds) ? message.embeds : []) {
    if (!isObject(embed)) continue;
    const body = [];
    const heading = [
      embed.author?.name ? `-# ${embed.author.name}` : "",
      embed.title
        ? `## ${embed.url ? `[${embed.title}](${embed.url})` : embed.title}`
        : "",
      embed.description,
    ]
      .filter(Boolean)
      .join("\n");
    if (embed.thumbnail?.url) {
      body.push({
        type: 9,
        components: [text(heading || "\u200b")],
        accessory: { type: 11, media: { url: embed.thumbnail.url } },
      });
    } else if (heading) body.push(text(heading));
    const fields = (Array.isArray(embed.fields) ? embed.fields : [])
      .map((field) =>
        [field?.name ? `**${field.name}**` : "", field?.value].filter(Boolean).join("\n"),
      )
      .filter(Boolean)
      .join("\n\n");
    if (fields) body.push(text(fields));
    if (embed.image?.url)
      body.push({ type: 12, items: [{ media: { url: embed.image.url } }] });
    const timestamp = Date.parse(embed.timestamp);
    const footer = [
      embed.footer?.text,
      Number.isFinite(timestamp) ? `<t:${Math.floor(timestamp / 1000)}:f>` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    if (footer) body.push(text(`-# ${footer}`));
    if (body.length)
      components.push({
        type: 17,
        ...(Number.isInteger(embed.color) ? { accent_color: embed.color } : {}),
        components: body,
      });
  }
  components.push(...(Array.isArray(message.components) ? message.components : []));
  for (const file of Array.isArray(message.files) ? message.files : []) {
    const name =
      typeof file === "string"
        ? file.split(/[\\/]/).at(-1)
        : (file?.name ?? file?.filename);
    if (name)
      components.push({
        type: 13,
        file: { url: "attachment://" + name },
        ...(file?.spoiler ? { spoiler: true } : {}),
      });
  }
  if (!components.length) components.push(newComponent(17));
  message.flags = ((Number(message.flags) || 0) & ~4) | 32768;
  message.components = components;
  for (const key of [
    "content",
    "embeds",
    "poll",
    "stickers",
    "sticker_ids",
    "shared_client_theme",
  ])
    delete message[key];
  if (!message.allowedMentions && !message.allowed_mentions)
    message.allowedMentions = { parse: [], repliedUser: false };
  return message;
}
export const sourceKey = (record) =>
  record.previewSourceKey ?? `${record.source.replace(/:\d+$/, "")}::${record.title}`;
// A single source expression can produce several distinct reply branches.
export function assignSourceKeys(records) {
  const counts = new Map();
  for (const record of records) {
    const base = sourceKey(record);
    const occurrence = (counts.get(base) ?? 0) + 1;
    counts.set(base, occurrence);
    record.previewSourceKey = base + (occurrence === 1 ? "" : `::branch-${occurrence}`);
  }
}
export const componentNames = {
  1: "Action row",
  2: "Button",
  3: "String select",
  5: "User select",
  6: "Role select",
  7: "Mentionable select",
  8: "Channel select",
  9: "Section",
  10: "Text display",
  11: "Thumbnail",
  12: "Media gallery",
  13: "File",
  14: "Separator",
  17: "Container",
};
export function newComponent(type) {
  const id = "design_" + Math.random().toString(36).slice(2, 10);
  switch (Number(type)) {
    case 1:
      return { type: 1, components: [] };
    case 2:
      return { type: 2, style: 1, label: "View run", custom_id: id };
    case 3:
      return {
        type: 3,
        custom_id: id,
        placeholder: "Choose an option",
        options: [{ label: "First option", value: "first" }],
      };
    case 5:
    case 6:
    case 7:
    case 8:
      return {
        type: Number(type),
        custom_id: id,
        placeholder: "Choose…",
        min_values: 1,
        max_values: 1,
      };
    case 9:
      return {
        type: 9,
        components: [{ type: 10, content: "## Run confirmed\nYour place is ready." }],
        accessory: { type: 2, style: 5, label: "View run", url: "https://fullparty.gg" },
      };
    case 10:
      return { type: 10, content: "## New heading\nAdd your message here." };
    case 11:
      return { type: 11, media: { url: "" } };
    case 12:
      return { type: 12, items: [{ media: { url: "" } }] };
    case 13:
      return { type: 13, file: { url: "attachment://example.pdf" } };
    case 14:
      return { type: 14, divider: true, spacing: 1 };
    case 17:
      return {
        type: 17,
        accent_color: 0x5865f2,
        components: [{ type: 10, content: "## FullParty\nDesign your next response." }],
      };
    default:
      return { type: Number(type) };
  }
}
export function assertDraft(body) {
  if (!isObject(body) || !isObject(body.message))
    throw new Error("A version needs a message object.");
  for (const key of ["sourceKey", "sourceTitle", "name"])
    if (typeof body[key] !== "string" || !body[key].trim() || body[key].length > 1500)
      throw new Error(`Invalid ${key}.`);
  if (body.name.length > 120)
    throw new Error("Version names can have up to 120 characters.");
  if (
    body.notes !== undefined &&
    (typeof body.notes !== "string" || body.notes.length > 10000)
  )
    throw new Error("Notes must be text, up to 10,000 characters.");
  if (body.preview !== undefined && !isObject(body.preview))
    throw new Error("Preview settings must be an object.");
  if (
    body.assets !== undefined &&
    (!Array.isArray(body.assets) ||
      body.assets.length > 10 ||
      body.assets.some(
        (a) =>
          !isObject(a) || typeof a.name !== "string" || typeof a.dataUrl !== "string",
      ))
  )
    throw new Error("Attachments must be a list of up to 10 local assets.");
  let count = 0;
  function walk(value, depth) {
    if (++count > 20000 || depth > 32) throw new Error("The version is too complex.");
    if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) {
        if (["__proto__", "prototype", "constructor"].includes(key))
          throw new Error("Unsupported object key.");
        walk(child, depth + 1);
      }
  }
  walk(body, 0);
}
// Advisory diagnostics: unfinished designs can still be saved as drafts.
export function validateMessage(m) {
  const issues = [],
    warn = (x) => issues.push(x),
    arr = (x) => (Array.isArray(x) ? x : []),
    len = (x) => (typeof x === "string" ? x.trim().length : 0);
  const limit = (v, max, label) => {
    if (v !== undefined && typeof v !== "string") warn(`${label} must be text.`);
    else if (len(v) > max) warn(`${label}: ${len(v)} / ${max} characters.`);
  };
  const url = (v, label, attachment = false) => {
    if (
      v &&
      (typeof v !== "string" ||
        (!/^https?:\/\//i.test(v) && !(attachment && /^attachment:\/\//.test(v))))
    )
      warn(`${label} needs an HTTP(S)${attachment ? " or attachment://" : ""} URL.`);
  };
  if (!isObject(m)) return ["The message must be a JSON object."];
  for (const key of ["embeds", "components", "files", "attachments"])
    if (m[key] !== undefined && !Array.isArray(m[key])) warn(`${key} must be an array.`);
  limit(m.content, 2000, "Message content");
  if (arr(m.embeds).length > 10) warn("Discord allows at most 10 embeds.");
  let total = 0;
  arr(m.embeds).forEach((e, i) => {
    if (!isObject(e)) {
      warn(`Embed ${i + 1} must be an object.`);
      return;
    }
    const p = `Embed ${i + 1}`;
    for (const [v, max, l] of [
      [e.title, 256, "title"],
      [e.description, 4096, "description"],
      [e.author?.name, 256, "author"],
      [e.footer?.text, 2048, "footer"],
    ]) {
      limit(v, max, `${p} ${l}`);
      total += len(v);
    }
    if (arr(e.fields).length > 25) warn(`${p} allows at most 25 fields.`);
    arr(e.fields).forEach((f, j) => {
      limit(f?.name, 256, `${p} field ${j + 1} name`);
      limit(f?.value, 1024, `${p} field ${j + 1} value`);
      total += len(f?.name) + len(f?.value);
      if (!len(f?.name) || !len(f?.value))
        warn(`${p} field ${j + 1} needs a name and value.`);
    });
    if (
      e.color !== undefined &&
      (!Number.isInteger(e.color) || e.color < 0 || e.color > 0xffffff)
    )
      warn(`${p} colour must be between #000000 and #FFFFFF.`);
    if (e.timestamp && !Number.isFinite(Date.parse(e.timestamp)))
      warn(`${p} timestamp is invalid.`);
    url(e.url, `${p} title link`);
    url(e.author?.url, `${p} author link`);
    for (const [v, l] of [
      [e.image?.url, "image"],
      [e.thumbnail?.url, "thumbnail"],
      [e.author?.icon_url, "author icon"],
      [e.footer?.icon_url, "footer icon"],
    ])
      url(v, `${p} ${l}`, true);
    if (
      !e.title &&
      !e.description &&
      !e.image?.url &&
      !e.thumbnail?.url &&
      !e.author?.name &&
      !e.footer?.text &&
      !arr(e.fields).length
    )
      warn(`${p} is empty.`);
    if (e.video || e.provider || (e.type && e.type !== "rich"))
      warn(
        `${p}: video, provider and other embed types are supplied by Discord, not bot-authored rich embeds.`,
      );
  });
  if (total > 6000) warn(`Combined embed text: ${total} / 6000 characters.`);
  const v2 = Boolean(Number(m.flags) & 32768);
  if (
    v2 &&
    (m.content ||
      arr(m.embeds).length ||
      m.poll ||
      m.stickers?.length ||
      m.sticker_ids?.length)
  )
    warn("Components V2 cannot be combined with content, embeds, polls or stickers.");
  if (!v2 && arr(m.components).length > 5)
    warn("Classic messages allow up to 5 action rows.");
  let count = 0,
    textLength = 0;
  const ids = new Set();
  function check(c, parent) {
    if (!isObject(c)) {
      warn("Each component must be an object.");
      return;
    }
    count++;
    if (!componentNames[c.type])
      warn(`Component type ${c.type} is not a supported message component.`);
    if (!v2 && [9, 10, 11, 12, 13, 14, 17].includes(c.type))
      warn(`${componentNames[c.type]} requires Components V2.`);
    if (!parent && !v2 && c.type !== 1)
      warn("Classic controls must be inside an action row.");
    if (c.custom_id) {
      limit(c.custom_id, 100, "Component custom ID");
      if (ids.has(c.custom_id)) warn("Component custom IDs must be unique.");
      ids.add(c.custom_id);
    }
    if (c.type === 1) {
      const children = arr(c.components);
      if (!children.length) warn("An action row needs controls.");
      if (
        (children.some((x) => x?.type !== 2) && children.length !== 1) ||
        children.length > 5
      )
        warn("An action row supports up to 5 buttons or one select menu.");
      if (children.some((x) => ![2, 3, 5, 6, 7, 8].includes(x?.type)))
        warn("Action rows only support buttons and select menus.");
    }
    if (c.type === 2) {
      limit(c.label, 80, "Button label");
      if (![1, 2, 3, 4, 5, 6].includes(c.style)) warn("Choose a valid button style.");
      if (!c.label && !c.emoji && c.style !== 6) warn("A button needs a label or emoji.");
      if (c.style === 5) {
        url(c.url, "Button link");
        if (!c.url || c.custom_id || c.sku_id)
          warn("Link buttons need a URL and no custom ID or SKU.");
      } else if (c.style === 6) {
        if (!c.sku_id || c.label || c.emoji || c.url || c.custom_id)
          warn(
            "Premium buttons need only a SKU ID, with no label, emoji, URL or custom ID.",
          );
      } else if (!c.custom_id || c.url || c.sku_id)
        warn("Interactive buttons need a custom ID and no URL or SKU.");
      if (parent !== 1 && parent !== 9)
        warn("Buttons belong in action rows or section accessories.");
    }
    if ([3, 5, 6, 7, 8].includes(c.type)) {
      if (!c.custom_id) warn("Select menus need a custom ID.");
      limit(c.placeholder, 150, "Select placeholder");
      const min = c.min_values ?? 1,
        max = c.max_values ?? 1;
      if (
        !Number.isInteger(min) ||
        !Number.isInteger(max) ||
        min < 0 ||
        max > 25 ||
        min > max ||
        max < 1
      )
        warn("Select min/max must be 0–25, with min ≤ max and max ≥ 1.");
      if (c.type === 3) {
        const options = arr(c.options);
        if (!options.length || options.length > 25)
          warn("String selects need 1–25 options.");
        if (max > options.length) warn("Select maximum exceeds its option count.");
        const values = new Set();
        options.forEach((o) => {
          if (!o?.label || !o?.value) warn("Each select option needs a label and value.");
          limit(o?.label, 100, "Option label");
          limit(o?.value, 100, "Option value");
          limit(o?.description, 100, "Option description");
          if (values.has(o?.value)) warn("Select option values must be unique.");
          values.add(o?.value);
        });
      }
      if (parent !== 1) warn("Select menus belong in action rows.");
    }
    if (c.type === 10) {
      limit(c.content, 4000, "Text display");
      textLength += len(c.content);
      if (!c.content) warn("Text displays need content.");
    }
    if (c.type === 9) {
      if (
        arr(c.components).length < 1 ||
        arr(c.components).length > 3 ||
        arr(c.components).some((x) => x?.type !== 10)
      )
        warn("Sections need 1–3 text displays.");
      if (![2, 11].includes(c.accessory?.type))
        warn("Sections need a button or thumbnail accessory.");
    }
    if (c.type === 11) {
      url(c.media?.url, "Thumbnail media", true);
      limit(c.description, 1024, "Thumbnail description");
    }
    if (c.type === 12) {
      if (arr(c.items).length < 1 || arr(c.items).length > 10)
        warn("Media galleries need 1–10 items.");
      arr(c.items).forEach((x) => {
        url(x?.media?.url, "Gallery media", true);
        limit(x?.description, 1024, "Gallery media description");
      });
    }
    if (c.type === 13 && !/^attachment:\/\//.test(c.file?.url ?? ""))
      warn("File components need an attachment:// URL.");
    if (
      c.type === 17 &&
      arr(c.components).some((x) => ![1, 9, 10, 12, 13, 14].includes(x?.type))
    )
      warn("Containers accept rows, sections, text, galleries, files and separators.");
    arr(c.components).forEach((child) => check(child, c.type));
    if (c.accessory) check(c.accessory, c.type);
  }
  arr(m.components).forEach((c) => check(c, 0));
  if (v2 && count > 40) warn("Components V2 allows up to 40 components total.");
  if (textLength > 4000) warn("Combined text displays exceed 4000 characters.");
  if (m.poll) {
    const p = m.poll;
    limit(p.question?.text, 300, "Poll question");
    if (!p.question?.text) warn("A poll needs a question.");
    if (arr(p.answers).length < 2 || arr(p.answers).length > 10)
      warn("Polls need 2–10 answers.");
    arr(p.answers).forEach((a) => limit(a?.poll_media?.text, 55, "Poll answer"));
    if (
      p.duration !== undefined &&
      (!Number.isInteger(p.duration) || p.duration < 1 || p.duration > 768)
    )
      warn("Poll duration must be 1–768 hours.");
    if (Number(m.flags) & 64) warn("Polls cannot be ephemeral.");
  }
  const mentions = m.allowedMentions ?? m.allowed_mentions;
  if (mentions) {
    if (
      (arr(mentions.parse).includes("users") && mentions.users?.length) ||
      (arr(mentions.parse).includes("roles") && mentions.roles?.length)
    )
      warn("Mention parsing and explicit IDs cannot both select the same mention type.");
    if (arr(mentions.users).length > 100 || arr(mentions.roles).length > 100)
      warn("Explicit mention lists support up to 100 IDs each.");
  }
  if (arr(m.files).length > 10 || arr(m.attachments).length > 10)
    warn("A message supports up to 10 attachments.");
  if (
    !m.content &&
    !arr(m.embeds).length &&
    !arr(m.components).length &&
    !m.poll &&
    !arr(m.files).length &&
    !arr(m.attachments).length &&
    !arr(m.stickers ?? m.sticker_ids).length
  )
    warn("The message is empty.");
  return [...new Set(issues)];
}
