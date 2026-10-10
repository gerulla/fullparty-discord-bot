import { createPreviewServer } from "./server.mjs";
import { loadWorkshopSender } from "./senderLoader.mjs";
const port = Number(process.env.PREVIEW_PORT || 4318);
const sender = await loadWorkshopSender();
createPreviewServer({ sender }).listen(port, "127.0.0.1", () =>
  console.log(`Response builder: http://127.0.0.1:${port}`),
);
