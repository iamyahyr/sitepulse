import { createFlakyServer } from "./server";

const port = Number(process.env.PORT ?? 8080);
const { server, close } = createFlakyServer();

server.listen(port, () => console.log(JSON.stringify({ level: "info", message: "flaky listening", port })));

const shutdown = () => void close().then(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
