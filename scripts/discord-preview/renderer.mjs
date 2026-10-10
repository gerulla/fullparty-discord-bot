export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const arr = (x) => (Array.isArray(x) ? x : []);
const obj = (x) => (x && typeof x === "object" ? x : {});
export const safeUrl = (value) =>
  typeof value === "string" && /^https?:\/\//i.test(value) ? value : "";
export function createRenderer(catalog) {
  const time = (stamp, style = "f") => {
    const date = new Date(stamp);
    if (!Number.isFinite(date.getTime())) return "Invalid date";
    if (style === "R") {
      const delta = (date - Date.parse(catalog.sampleNow)) / 60000;
      const unit =
        Math.abs(delta) >= 1440 ? "day" : Math.abs(delta) >= 60 ? "hour" : "minute";
      return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
        Math.round(delta / (unit === "day" ? 1440 : unit === "hour" ? 60 : 1)),
        unit,
      );
    }
    return date.toLocaleString("en-GB", {
      timeZone: "Europe/London",
      ...(style === "t" ? {} : { day: "numeric", month: "long", year: "numeric" }),
      ...(style === "D" ? {} : { hour: "2-digit", minute: "2-digit" }),
    });
  };
  function md(value) {
    const tokens = [];
    const token = (html) => {
      tokens.push(html);
      return "\uE000" + (tokens.length - 1) + "\uE001";
    };
    let s = String(value ?? "").replace(/[\uE000\uE001]/g, "");
    s = s
      .replace(/```(?:[a-z]*\n)?([\s\S]*?)```/g, (_, v) =>
        token("<pre><code>" + esc(v.trimEnd()) + "</code></pre>"),
      )
      .replace(/`([^`]+)`/g, (_, v) => token("<code>" + esc(v) + "</code>"))
      .replace(/<t:(\d+)(?::([a-zA-Z]))?>/g, (_, v, k) =>
        token(
          '<span class="timestamp">' + esc(time(Number(v) * 1000, k || "f")) + "</span>",
        ),
      )
      .replace(/<(@&|@!?|#)(\d+)>/g, (_, kind, id) =>
        token(
          '<span class="mention">' +
            (kind === "#" ? "#" : "@") +
            esc(catalog.mentions[id] || id) +
            "</span>",
        ),
      )
      .replace(/\[([^\]]+)\]\(<?(https?:\/\/[^\s)>]+)>?\)/g, (_, label, url) =>
        token(
          '<a href="' +
            esc(safeUrl(url)) +
            '" target="_blank" rel="noreferrer">' +
            esc(label) +
            "</a>",
        ),
      );
    s = esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<u>$1</u>")
      .replace(/~~([^~]+)~~/g, "<del>$1</del>")
      .replace(/\|\|(.+?)\|\|/g, '<span class="spoiler" tabindex="0">$1</span>')
      .replace(
        /(?<!\w)_([^_\n]+)_(?!\w)|(?<!\*)\*([^*\n]+)\*(?!\*)/g,
        (_, a, b) => "<em>" + (a || b) + "</em>",
      )
      .replace(/^#{1,3} (.*)$/gm, '<div class="message-heading">$1</div>')
      .replace(/^-# (.*)$/gm, '<span class="smalltext">$1</span>')
      .replace(/^&gt; (.*)$/gm, "<blockquote>$1</blockquote>")
      .replace(/\n/g, "<br>");
    return s.replace(/\uE000(\d+)\uE001/g, (_, n) => tokens[Number(n)] ?? "");
  }
  return function renderMessage(message, preview = {}, assets = []) {
    const m = obj(message),
      p = obj(preview);
    function mediaUrl(url) {
      if (typeof url !== "string") return "";
      if (url.startsWith("attachment://")) {
        const asset = arr(assets).find((a) => a?.name === url.slice(13));
        return asset && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(asset.dataUrl)
          ? asset.dataUrl
          : "";
      }
      return safeUrl(url);
    }
    const image = (url, cls, alt = "") => {
      const src = mediaUrl(url);
      return src
        ? '<img class="' +
            cls +
            '" src="' +
            esc(src) +
            '" alt="' +
            esc(alt) +
            '" loading="lazy" referrerpolicy="no-referrer">'
        : url
          ? '<span class="media-placeholder">Image: ' + esc(url) + "</span>"
          : "";
    };
    const galleryMedia = (url, description) => {
      const asset =
        typeof url === "string" && url.startsWith("attachment://")
          ? arr(assets).find((a) => a?.name === url.slice(13))
          : undefined;
      const video = asset
        ? /^data:video\/(mp4|webm|quicktime);base64,/i.test(asset.dataUrl)
        : /\.(mp4|webm|mov)(?:[?#]|$)/i.test(String(url));
      const src = video ? (asset?.dataUrl ?? safeUrl(url)) : "";
      return src
        ? '<video class="gallery-video" controls preload="metadata" aria-label="' +
            esc(description || "Video") +
            '" src="' +
            esc(src) +
            '"></video>'
        : image(url, "embed-image", description);
    };
    const link = (url, text) =>
      safeUrl(url)
        ? '<a href="' +
          esc(safeUrl(url)) +
          '" target="_blank" rel="noreferrer">' +
          text +
          "</a>"
        : text;
    const color = (n, fallback) =>
      Number.isInteger(n) && n >= 0 && n <= 0xffffff
        ? "#" + n.toString(16).padStart(6, "0")
        : fallback;
    const emoji = (e) =>
      obj(e).id
        ? image(
            "https://cdn.discordapp.com/emojis/" +
              encodeURIComponent(e.id) +
              (e.animated ? ".gif" : ".png"),
            "custom-emoji",
            e.name || "emoji",
          )
        : esc(obj(e).name || "");
    function embed(value) {
      const e = obj(value);
      return (
        '<div class="embed" style="--color:' +
        color(e.color, "#4e5058") +
        '">' +
        image(e.thumbnail?.url, "thumbnail") +
        (e.author?.name
          ? '<div class="embed-author">' +
            image(e.author.icon_url, "embed-icon") +
            link(e.author.url, esc(e.author.name)) +
            "</div>"
          : "") +
        (e.title
          ? '<div class="embed-title">' + link(e.url, esc(e.title)) + "</div>"
          : "") +
        (e.description ? '<div class="embed-desc">' + md(e.description) + "</div>" : "") +
        (arr(e.fields).length
          ? '<div class="fields">' +
            arr(e.fields)
              .map(
                (f) =>
                  '<div class="field ' +
                  (f?.inline ? "inline" : "") +
                  '"><div class="field-name">' +
                  esc(f?.name) +
                  '</div><div class="field-value">' +
                  md(f?.value) +
                  "</div></div>",
              )
              .join("") +
            "</div>"
          : "") +
        image(e.image?.url, "embed-image") +
        (e.footer || e.timestamp
          ? '<div class="embed-footer">' +
            image(e.footer?.icon_url, "embed-icon") +
            esc(e.footer?.text) +
            (e.timestamp ? " • " + esc(time(e.timestamp)) : "") +
            "</div>"
          : "") +
        "</div>"
      );
    }
    function component(value, depth = 0) {
      if (depth > 20) return "";
      const c = obj(value);
      switch (c.type) {
        case 1:
          return (
            '<div class="component-row">' +
            arr(c.components)
              .map((x) => component(x, depth + 1))
              .join("") +
            "</div>"
          );
        case 2:
          return (
            '<button type="button" class="discord-button ' +
            ({ 1: "primary", 3: "success", 4: "danger" }[c.style] || "") +
            '" ' +
            (c.disabled ? "disabled" : "") +
            ' tabindex="-1">' +
            emoji(c.emoji) +
            (c.emoji ? " " : "") +
            esc(c.label || (c.style === 6 ? "Premium purchase" : "")) +
            (c.style === 5 ? " ↗" : "") +
            "</button>"
          );
        case 3:
        case 5:
        case 6:
        case 7:
        case 8:
          return (
            '<div class="discord-select ' +
            (c.disabled ? "disabled" : "") +
            '"><span>' +
            esc(
              arr(c.options)
                .filter((x) => x?.default)
                .map((x) => x.label)
                .join(", ") ||
                arr(c.default_values)
                  .map(
                    (x) =>
                      (x?.type === "channel" ? "#" : "@") +
                      (catalog.mentions[x?.id] || x?.id || ""),
                  )
                  .join(", ") ||
                c.placeholder ||
                "Make a selection",
            ) +
            "</span><span>⌄</span></div>"
          );
        case 9:
          return (
            '<div class="v2-section"><div>' +
            arr(c.components)
              .map((x) => component(x, depth + 1))
              .join("") +
            "</div><div>" +
            component(c.accessory, depth + 1) +
            "</div></div>"
          );
        case 10:
          return '<div class="content">' + md(c.content) + "</div>";
        case 11:
          return (
            '<div class="' +
            (c.spoiler ? "spoiler" : "") +
            '">' +
            image(c.media?.url, "thumbnail", c.description) +
            "</div>"
          );
        case 12:
          return (
            '<div class="media-gallery">' +
            arr(c.items)
              .map(
                (x) =>
                  '<div class="' +
                  (x?.spoiler ? "spoiler" : "") +
                  '">' +
                  galleryMedia(x?.media?.url, x?.description) +
                  "</div>",
              )
              .join("") +
            "</div>"
          );
        case 13:
          return (
            '<div class="attachment ' +
            (c.spoiler ? "spoiler" : "") +
            '">📄 ' +
            esc(String(c.file?.url || "File").replace("attachment://", "")) +
            "</div>"
          );
        case 14:
          return (
            '<div class="v2-separator" style="height:' +
            (c.spacing === 2 ? "28" : "12") +
            'px">' +
            (c.divider === false ? "" : "<hr>") +
            "</div>"
          );
        case 17:
          return (
            '<div class="v2-container ' +
            (c.spoiler ? "spoiler" : "") +
            '" style="border-color:' +
            color(c.accent_color, "#41434a") +
            '">' +
            arr(c.components)
              .map((x) => component(x, depth + 1))
              .join("") +
            "</div>"
          );
        default:
          return (
            '<div class="smalltext">Component ' +
            esc(c.type ?? "?") +
            " — inspect JSON for details</div>"
          );
      }
    }
    const v2 = Number(m.flags) & 32768;
    const poll = m.poll
      ? '<div class="poll"><strong>' +
        esc(m.poll.question?.text) +
        "</strong>" +
        arr(m.poll.answers)
          .map(
            (a) =>
              '<div class="poll-option">◯ ' +
              emoji(a?.poll_media?.emoji) +
              " " +
              esc(a?.poll_media?.text) +
              "</div>",
          )
          .join("") +
        '<div class="smalltext">' +
        (m.poll.allow_multiselect ? "Select multiple answers" : "Select one answer") +
        " • " +
        esc(m.poll.duration ?? 24) +
        ' hours</div><button class="discord-button primary" tabindex="-1">Vote</button></div>'
      : "";
    const attachments = arr(m.files ?? m.attachments)
      .map((f) => {
        const name = String(
          typeof f === "string" ? f : (f?.name ?? f?.filename ?? "Attachment"),
        );
        const url = f && typeof f === "object" ? (f.attachment ?? f.url) : "";
        const picture = mediaUrl(url || "attachment://" + name);
        return (
          '<div class="attachment ' +
          (f?.spoiler || name.startsWith("SPOILER_") ? "spoiler" : "") +
          '">' +
          (picture
            ? image(url || "attachment://" + name, "embed-image", f?.description)
            : "📄 " + esc(name)) +
          (f?.description
            ? '<div class="smalltext">' + esc(f.description) + "</div>"
            : "") +
          "</div>"
        );
      })
      .join("");
    return (
      '<div class="discord-message"><div class="avatar">' +
      (safeUrl(p.avatarUrl) ? image(p.avatarUrl, "avatar-image") : "FP") +
      '</div><div class="message-main">' +
      (p.replyText ? '<div class="reply-context">↳ ' + esc(p.replyText) + "</div>" : "") +
      '<div class="author">' +
      esc(p.displayName || "FullParty") +
      ' <span class="botbadge">✓ APP</span><span class="time">' +
      esc(p.timeLabel || "Today at 18:00") +
      "</span></div>" +
      (!v2
        ? (m.content ? '<div class="content">' + md(m.content) + "</div>" : "") +
          (Number(m.flags) & 4
            ? '<div class="smalltext">Embeds suppressed</div>'
            : arr(m.embeds).map(embed).join("")) +
          attachments +
          poll
        : "") +
      '<div class="components">' +
      arr(m.components)
        .map((x) => component(x))
        .join("") +
      "</div>" +
      (arr(m.stickers ?? m.sticker_ids).length
        ? '<div class="attachment">Sticker IDs: ' +
          esc((m.stickers ?? m.sticker_ids).join(", ")) +
          "</div>"
        : "") +
      '<div class="visibility">' +
      (Number(m.flags) & 64 || p.audience === "Only you"
        ? "◉ Only you can see this · Dismiss message"
        : esc(p.audience || "")) +
      (m.tts ? " · Text to speech" : "") +
      (Number(m.flags) & 4096 ? " · Silent" : "") +
      "</div></div></div>"
    );
  };
}
