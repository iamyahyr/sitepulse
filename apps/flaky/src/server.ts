import http from "node:http";
import { DEMO_SITES, demoBehaviour } from "@sitepulse/core";

/**
 * Deliberately unreliable web service for the public demo. Each path follows
 * a scenario from @sitepulse/core (502s, hangs, slowdowns) driven by the UTC
 * clock, so visitors see real incidents open and close. Never expose it as a
 * real service: it exists to fail.
 */
export function createFlakyServer(clock: () => Date = () => new Date()) {
  const hanging = new Set<http.ServerResponse>();

  const server = http.createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://flaky").pathname;

    if (path === "/") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(DEMO_SITES.map(({ path, name, story }) => ({ path, name, story })), null, 2));
      return;
    }

    const behaviour = demoBehaviour(path, clock());
    if (!behaviour) {
      res.writeHead(404).end("not found");
      return;
    }
    if (behaviour.kind === "hang") {
      // Keep the socket open without answering; the client times out.
      hanging.add(res);
      res.on("close", () => hanging.delete(res));
      return;
    }

    const status = behaviour.kind === "status" ? behaviour.status : 200;
    setTimeout(() => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(status === 200 ? `<!doctype html><title>${path}</title><p>OK</p>` : `<h1>${status}</h1>`);
    }, behaviour.delayMs);
  });

  /** Closes the server, cutting any hanging requests. */
  const close = () =>
    new Promise<void>((resolve) => {
      for (const res of hanging) res.destroy();
      server.close(() => resolve());
    });

  return { server, close };
}
