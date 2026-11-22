import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openAsBlob } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const SERVER = (process.env.ARTIFACT_SERVER_URL ?? "http://localhost:3000").replace(/\/$/, "");

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

const json = async (res: Response) => {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json();
};

const mcp = new McpServer({ name: "artifact-server", version: "0.1.0" });

mcp.registerTool(
  "generate",
  {
    description:
      "Upload local files as one artifact bundle and get shareable URLs. Use this to share files you produced (HTML, images, code, etc.) with a person or another agent.",
    inputSchema: { paths: z.array(z.string()).min(1).describe("Local file paths to upload") },
  },
  async ({ paths }) => {
    const fd = new FormData();
    for (const p of paths) fd.append("files", await openAsBlob(resolve(p)), basename(p));
    return text(await json(await fetch(`${SERVER}/artifacts`, { method: "POST", body: fd })));
  }
);

mcp.registerTool(
  "pull",
  {
    description:
      "Download an artifact bundle into the local workspace so you can read or edit its files. Accepts a bundle id or any URL returned by `generate`.",
    inputSchema: {
      ref: z.string().describe("Bundle id, or a share URL like http://host:3000/artifacts/<id>/<file>"),
      dir: z.string().optional().describe("Destination directory. Defaults to ./.artifacts/<id>"),
    },
  },
  async ({ ref, dir }) => {
    const id = ref.match(/artifacts\/([^/?#]+)/)?.[1] ?? ref;
    const base = URL.canParse(ref) ? new URL(ref).origin : SERVER;
    const { files } = (await json(await fetch(`${base}/artifacts/${id}`))) as { files: string[] };
    const out = resolve(dir ?? join(".artifacts", id));
    await mkdir(out, { recursive: true });
    const saved = await Promise.all(
      files.map(async (name) => {
        const res = await fetch(`${base}/artifacts/${id}/${encodeURIComponent(name)}`);
        if (!res.ok) throw new Error(`${name}: ${res.status}`);
        const path = join(out, basename(name));
        await writeFile(path, Buffer.from(await res.arrayBuffer()));
        return path;
      })
    );
    return text({ id, files: saved });
  }
);

await mcp.connect(new StdioServerTransport());
