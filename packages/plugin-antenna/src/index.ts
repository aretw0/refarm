import { type Tractor } from "@refarm.dev/tractor";

export interface AntennaOptions {
  fallbackRoute?: string;
  enableEasterEggs?: boolean;
}

export class AntennaPlugin {
  private tractor: Tractor;
  private options: AntennaOptions;

  constructor(tractor: Tractor, options: AntennaOptions = {}) {
    this.tractor = tractor;
    this.options = { fallbackRoute: "/", enableEasterEggs: true, ...options };
  }

  public async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (this.options.enableEasterEggs && path === "/.well-known/sovereign-signal") {
      return new Response(this.getEasterEggAscii(), {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    try {
      const nodes = await this.tractor.queryNodes(`SELECT * WHERE url = '${path}'`);
      if (!nodes || nodes.length === 0) return new Response("404 - Not Found", { status: 404 });
      
      const html = await this.materializeHtml(nodes[0]);
      const headers = new Headers({ "Content-Type": "text/html" });
      if (this.options.enableEasterEggs) headers.set("X-Broadcasted-By", "Refarm Antenna (The Sovereign Signal)");

      return new Response(html, { status: 200, headers });
    } catch (error: any) {
      return new Response(`500 - Radio Failure: ${error.message}`, { status: 500 });
    }
  }

  private async materializeHtml(node: any): Promise<string> {
    return `<!DOCTYPE html><html><head><title>${node.name}</title></head><body><h1>${node.content}</h1></body></html>`;
  }

  private getEasterEggAscii(): string {
    return `
    .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .
   .                                                       .
  .     (((((        R E F A R M   S O V E R E I G N       .
  .    (((((((       ===============================       .
  .    (((((((       You have intercepted the signal.      .
  .     (((((        The soil is fertile. The graph is     .
  .       |          yours.                                .
  .      /|\\                                               .
  .     / | \\                                              .
  .    /  |  \\                                             .
   .  ......................................................
    `;
  }
}
